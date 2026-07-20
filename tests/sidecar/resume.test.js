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
