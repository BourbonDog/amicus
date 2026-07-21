/** Tests for the skill-install half of scripts/postinstall.js (MCP registration not exercised). */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installSkill, installCouncilSkill, COUNCIL_FILES } = require('../../scripts/postinstall');

describe('postinstall skill installation', () => {
  let homeDir;
  let homeSpy;
  let logSpy;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-postinstall-'));
    homeSpy = jest.spyOn(os, 'homedir').mockReturnValue(homeDir);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    homeSpy.mockRestore();
    logSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const councilDest = () => path.join(homeDir, '.claude', 'skills', 'second-opinion');

  test('installSkill copies the chat skill to ~/.claude/skills/sidecar/', () => {
    installSkill();
    const dest = path.join(homeDir, '.claude', 'skills', 'sidecar', 'SKILL.md');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8')).toContain('name: sidecar');
  });

  test('COUNCIL_FILES declares overwrite semantics per file', () => {
    expect(COUNCIL_FILES).toEqual([
      { file: 'SKILL.md', mode: 'overwrite' },
      { file: 'COUNCIL-DESIGN.md', mode: 'overwrite' },
      { file: 'SEAT-BRIEFS.md', mode: 'overwrite' },
      { file: 'MODEL-NOTES.md', mode: 'if-missing' },
    ]);
  });

  test('fresh install copies all council files', () => {
    installCouncilSkill();
    for (const { file } of COUNCIL_FILES) {
      expect(fs.existsSync(path.join(councilDest(), file))).toBe(true);
    }
  });

  test('MODEL-NOTES.md is NEVER overwritten (user data)', () => {
    fs.mkdirSync(councilDest(), { recursive: true });
    fs.writeFileSync(path.join(councilDest(), 'MODEL-NOTES.md'), 'USER LEARNED DATA');
    installCouncilSkill();
    expect(fs.readFileSync(path.join(councilDest(), 'MODEL-NOTES.md'), 'utf-8')).toBe('USER LEARNED DATA');
  });

  test('SKILL.md and COUNCIL-DESIGN.md ARE overwritten on update', () => {
    fs.mkdirSync(councilDest(), { recursive: true });
    fs.writeFileSync(path.join(councilDest(), 'SKILL.md'), 'stale');
    fs.writeFileSync(path.join(councilDest(), 'COUNCIL-DESIGN.md'), 'stale');
    installCouncilSkill();
    expect(fs.readFileSync(path.join(councilDest(), 'SKILL.md'), 'utf-8')).not.toBe('stale');
    expect(fs.readFileSync(path.join(councilDest(), 'COUNCIL-DESIGN.md'), 'utf-8')).not.toBe('stale');
  });

  test('a missing source file warns but never throws (warn-don\'t-fail)', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => installCouncilSkill(path.join(homeDir, 'no-such-source'))).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Warning'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Council skill installed'));
    errSpy.mockRestore();
  });
});
