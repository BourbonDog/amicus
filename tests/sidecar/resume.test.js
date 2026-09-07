/**
 * Sidecar Resume Tests
 *
 * Tests for session resumption, including OpenCode session reconnection,
 * file drift detection, and metadata handling.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const {
  loadSessionMetadata,
  loadInitialContext,
  checkFileDrift,
  buildDriftWarning,
  updateSessionStatus,
  buildResumeUserMessage
} = require('../../src/sidecar/resume');

describe('Resume Operations', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-resume-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadSessionMetadata', () => {
    it('should load metadata from session directory', () => {
      const meta = {
        taskId: 'abc123',
        model: 'openrouter/google/gemini-3-flash-preview',
        status: 'complete',
        opencodeSessionId: 'ses_test123'
      };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const loaded = loadSessionMetadata(tmpDir);
      expect(loaded.taskId).toBe('abc123');
      expect(loaded.opencodeSessionId).toBe('ses_test123');
    });

    it('should throw if metadata file missing', () => {
      expect(() => loadSessionMetadata('/nonexistent/path'))
        .toThrow('Session metadata not found');
    });
  });

  describe('loadInitialContext', () => {
    it('should load initial context from file', () => {
      fs.writeFileSync(path.join(tmpDir, 'initial_context.md'), '# System Prompt\nTest prompt');

      const context = loadInitialContext(tmpDir);
      expect(context).toContain('Test prompt');
    });

    it('should return empty string if file missing', () => {
      const context = loadInitialContext(tmpDir);
      expect(context).toBe('');
    });
  });

  describe('checkFileDrift', () => {
    it('should detect changed files', () => {
      const testFile = path.join(tmpDir, 'test.js');
      fs.writeFileSync(testFile, 'content');

      const metadata = {
        filesRead: ['test.js'],
        completedAt: new Date(Date.now() - 60000).toISOString()
      };

      const drift = checkFileDrift(metadata, tmpDir);
      expect(drift.hasChanges).toBe(true);
      expect(drift.changedFiles).toContain('test.js');
    });

    it('should not detect drift when no files changed', () => {
      const metadata = {
        filesRead: ['nonexistent.js'],
        completedAt: new Date().toISOString()
      };

      const drift = checkFileDrift(metadata, tmpDir);
      expect(drift.hasChanges).toBe(false);
    });

    it("falls back to resumedAt when the crashed attempt's completedAt is gone (council #235 r5, J2/A4)", () => {
      // The J2 delete removes `completedAt` on every running write, so the ONE legitimate reader
      // needs its fallback: after a crashed resume "last activity" is when THAT attempt started
      // (`resumedAt`, written on the same line as the delete), which is strictly more accurate
      // than the previous attempt's completion. Named mutant "DRIFTNORESUMEDAT": drop the
      // `metadata.resumedAt ||` term — lastActivity falls all the way back to createdAt and every
      // file touched between session creation and this resume is reported as drift.
      const testFile = path.join(tmpDir, 'test.js');
      fs.writeFileSync(testFile, 'content');
      const resumedAt = new Date(Date.now() + 60000).toISOString();
      const drift = checkFileDrift({
        filesRead: ['test.js'],
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        resumedAt,
      }, tmpDir);
      expect(drift.lastActivityTime).toBe(new Date(resumedAt).getTime());
      expect(drift.hasChanges).toBe(false); // the file predates THIS attempt's start, so it is not drift
    });

    it('should handle empty filesRead', () => {
      const metadata = {
        filesRead: [],
        completedAt: new Date().toISOString()
      };

      const drift = checkFileDrift(metadata, tmpDir);
      expect(drift.hasChanges).toBe(false);
    });
  });

  describe('buildDriftWarning', () => {
    it('should format drift warning with changed files', () => {
      const warning = buildDriftWarning(['src/index.js', 'src/utils.js'], Date.now() - 7200000);
      expect(warning).toContain('RESUME NOTICE');
      expect(warning).toContain('src/index.js');
      expect(warning).toContain('src/utils.js');
    });
  });

  describe('updateSessionStatus', () => {
    it('should update session status and add resumedAt', () => {
      const meta = { taskId: 'abc123', status: 'complete' };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const updated = updateSessionStatus(tmpDir, 'running');
      expect(updated.status).toBe('running');
      expect(updated.resumedAt).toBeDefined();
    });

    it("the running write drops the previous attempt's finish / variant / variantUnverified (#218 PR 4 whole-branch review, REC-3)", () => {
      // Named mutant "RESUMESTALEVARIANT": drop the three deletes — all three keys survive and an abort of this attempt ships them.
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify({ taskId: 'abc123', status: 'complete', thinking: 'high', finish: 'length', variant: 'low', variantUnverified: true }));
      updateSessionStatus(tmpDir, 'running');
      const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'metadata.json'), 'utf-8'));
      expect(onDisk.status).toBe('running');
      expect(onDisk.thinking).toBe('high'); // the REQUEST is not per-attempt state
      expect('finish' in onDisk).toBe(false);
      expect('variant' in onDisk).toBe(false);
      expect('variantUnverified' in onDisk).toBe(false);
    });

    it("the running write also drops the previous attempt's reason / completedAt (council #235 r5, J2/A4)", () => {
      // Named mutant "RESUMESTALEREASON": drop the `reason`/`completedAt` deletes — a resume that
      // crashes mid-attempt leaves metadata reading `status: 'running'` while still carrying the
      // PREVIOUS attempt's failure reason and completion time, and both are read: the result
      // schema reports `metadata.reason` as the run's error for every non-complete status and the
      // MCP server prints it as the Reason for a timed-out or aborted run.
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify({
        taskId: 'abc123', status: 'error', thinking: 'high',
        reason: 'OUTPUT_LENGTH: the previous attempt died', completedAt: '2026-01-01T00:00:00.000Z',
      }));
      updateSessionStatus(tmpDir, 'running');
      const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'metadata.json'), 'utf-8'));
      expect(onDisk.status).toBe('running');
      expect('reason' in onDisk).toBe(false);
      expect('completedAt' in onDisk).toBe(false);
      expect(onDisk.resumedAt).toBeDefined(); // written on the same line as the deletes
    });
  });

  describe('buildResumeUserMessage', () => {
    it('should include conversation excerpt and briefing', () => {
      const briefing = 'Debug the auth issue';
      const conversation = '[assistant @ 10:00] Analyzing code\n[assistant @ 10:01] Found the bug in auth.js';

      const result = buildResumeUserMessage(briefing, conversation);

      expect(result).toContain('PREVIOUS CONVERSATION');
      expect(result).toContain('Analyzing code');
      expect(result).toContain('Found the bug in auth.js');
      expect(result).toContain('Debug the auth issue');
    });

    it('should skip conversation section when conversation is empty', () => {
      const result = buildResumeUserMessage('Fix the tests', '');

      expect(result).toContain('Fix the tests');
      expect(result).not.toContain('PREVIOUS CONVERSATION');
    });

    it('should include resume instruction', () => {
      const result = buildResumeUserMessage('Task', 'some conversation');

      // Should tell the model to continue from where it left off
      expect(result).toMatch(/continue|resume|pick up/i);
    });

    it('should work with no briefing', () => {
      const result = buildResumeUserMessage('', 'conversation data');

      expect(result).toContain('PREVIOUS CONVERSATION');
      expect(result).toContain('conversation data');
    });

    it('strips a nonced fold marker from the replayed conversation (v4.0 §9 — BL-7 done-done)', () => {
      const conversation = '[assistant @ 10:01] work done\n[SIDECAR_FOLD:cafef00d12345678]\n';
      const result = buildResumeUserMessage('Task', conversation);
      expect(result).not.toContain('SIDECAR_FOLD');
      expect(result).toContain('work done');
      expect(result).toContain('## PREVIOUS CONVERSATION');
    });

    it('strips a legacy bare fold marker from the replayed conversation', () => {
      const conversation = 'earlier summary\n[SIDECAR_FOLD]\nmore turns';
      const result = buildResumeUserMessage('', conversation);
      expect(result).not.toContain('[SIDECAR_FOLD]');
      expect(result).toContain('earlier summary');
      expect(result).toContain('more turns');
    });
  });

  describe('OpenCode session ID in metadata', () => {
    it('should persist opencodeSessionId when stored in metadata', () => {
      const meta = {
        taskId: 'test123',
        model: 'openrouter/google/gemini-3-flash-preview',
        status: 'complete',
        opencodeSessionId: 'ses_abc123def456'
      };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const loaded = loadSessionMetadata(tmpDir);
      expect(loaded.opencodeSessionId).toBe('ses_abc123def456');
    });

    it('should handle metadata without opencodeSessionId (legacy sessions)', () => {
      const meta = {
        taskId: 'old123',
        model: 'openrouter/google/gemini-2.5-flash',
        status: 'complete'
      };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const loaded = loadSessionMetadata(tmpDir);
      expect(loaded.opencodeSessionId).toBeUndefined();
    });
  });
});
