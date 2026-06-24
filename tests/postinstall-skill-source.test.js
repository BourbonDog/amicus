'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installSkill } = require('../scripts/postinstall');

describe('postinstall installs the chat skill from skills/sidecar/', () => {
  test('repo source lives at skills/sidecar/SKILL.md (not skill/)', () => {
    const root = path.join(__dirname, '..');
    expect(fs.existsSync(path.join(root, 'skills', 'sidecar', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'skill', 'SKILL.md'))).toBe(false);
  });

  test('installSkill copies to ~/.claude/skills/sidecar/', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-home-'));
    const homeSpy = jest.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      installSkill();
      const dest = path.join(fakeHome, '.claude', 'skills', 'sidecar', 'SKILL.md');
      expect(fs.existsSync(dest)).toBe(true);
    } finally {
      homeSpy.mockRestore();
      logSpy.mockRestore();
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
