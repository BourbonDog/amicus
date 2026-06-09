/**
 * mark-test-passed Script Tests
 *
 * Tests the helper that writes the current git HEAD SHA to .test-passed for
 * the pre-push SHA cache. This is the cross-platform replacement for the bash
 * one-liner `git rev-parse HEAD > .test-passed 2>/dev/null || true`, which
 * fails under npm's cmd.exe shell on Windows.
 */

const { existsSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const { getHeadSha, markTestPassed } = require('../../scripts/mark-test-passed');

describe('mark-test-passed', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `amicus-test-passed-${process.pid}.txt`);
    rmSync(tmpFile, { force: true });
  });

  afterEach(() => {
    rmSync(tmpFile, { force: true });
  });

  describe('getHeadSha', () => {
    it('returns the trimmed SHA from the git runner', () => {
      const runGit = () => 'abc123def456\n';
      expect(getHeadSha(runGit)).toBe('abc123def456');
    });

    it('returns null when the git runner throws (not a repo / git missing)', () => {
      const runGit = () => {
        throw new Error('not a git repository');
      };
      expect(getHeadSha(runGit)).toBeNull();
    });

    it('returns null when the git runner yields only whitespace', () => {
      const runGit = () => '   \n';
      expect(getHeadSha(runGit)).toBeNull();
    });
  });

  describe('markTestPassed', () => {
    it('writes the SHA to the target path and returns true', () => {
      const runGit = () => 'deadbeef\n';
      const result = markTestPassed({ path: tmpFile, runGit });
      expect(result).toBe(true);
      expect(readFileSync(tmpFile, 'utf-8').trim()).toBe('deadbeef');
    });

    it('returns false and writes nothing when the SHA is unavailable', () => {
      const runGit = () => {
        throw new Error('git missing');
      };
      const result = markTestPassed({ path: tmpFile, runGit });
      expect(result).toBe(false);
      expect(existsSync(tmpFile)).toBe(false);
    });

    it('never throws when the write fails (returns false)', () => {
      // Parent directory does not exist -> writeFileSync throws -> swallowed.
      const badPath = join(tmpFile, 'cannot', 'write', 'here.txt');
      const runGit = () => 'cafe\n';
      let result;
      expect(() => {
        result = markTestPassed({ path: badPath, runGit });
      }).not.toThrow();
      expect(result).toBe(false);
    });

    it('writes a real 40-character hex SHA when run against the actual repo', () => {
      // No runGit injection -> uses the real `git rev-parse HEAD` in this repo.
      const result = markTestPassed({ path: tmpFile });
      expect(result).toBe(true);
      expect(readFileSync(tmpFile, 'utf-8').trim()).toMatch(/^[0-9a-f]{40}$/);
    });
  });
});
