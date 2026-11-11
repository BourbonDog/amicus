/**
 * Session Manager Tests
 *
 * Spec Reference: Section 8.1 What Gets Persisted, Section 7.4 Metadata Tracking
 * Tests session persistence for sidecar sessions.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { getSessionDir } = require('../src/session-manager');

describe('Session Manager', () => {
  let tempDir;
  let projectDir;

  beforeEach(() => {
    // Create temporary project directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-session-mgr-test-'));
    projectDir = tempDir;
  });

  afterEach(() => {
    // Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getSessionDir', () => {
    it('should return the session directory path', () => {
      const taskId = 'abc123';
      const result = getSessionDir(projectDir, taskId);

      expect(result).toBe(path.join(projectDir, '.claude', 'amicus_sessions', taskId));
    });

    it('should throw when taskId escapes the sessions directory (path traversal)', () => {
      expect(() => getSessionDir(projectDir, path.join('..', '..', 'etc'))).toThrow(/path traversal/);
    });

    it('should return the expected path for a normal taskId', () => {
      const taskId = 'wave-abc123-1';
      expect(getSessionDir(projectDir, taskId)).toBe(
        path.join(projectDir, '.claude', 'amicus_sessions', taskId)
      );
    });
  });
});
