// tests/project-root-sanity.test.js
'use strict';
const { assessProjectRoot } = require('../src/utils/project-root-sanity');

describe('assessProjectRoot', () => {
  // A real-looking repo with markers → ok.
  const okMarkers = { hasGit: true, hasPackageJson: true, hasClaude: false };

  test('a normal repo path with .git/package.json → ok', () => {
    const r = assessProjectRoot('C:\\Users\\me\\code\\amicus', okMarkers);
    expect(r.status).toBe('ok');
  });

  test('a posix repo path with markers → ok', () => {
    const r = assessProjectRoot('/home/me/code/amicus', okMarkers);
    expect(r.status).toBe('ok');
  });

  test('an AnthropicClaude install dir → warn (app/install pattern)', () => {
    const r = assessProjectRoot(
      'C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\app-1.2.3',
      { hasGit: false, hasPackageJson: false, hasClaude: false }
    );
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/install|app/i);
    expect(r.hint).toMatch(/project|cd/i);
  });

  test('a versioned app- dir → warn', () => {
    const r = assessProjectRoot(
      'C:\\Users\\me\\AppData\\Local\\Programs\\someapp\\app-2.0.0',
      okMarkers // even with markers, an install pattern still warns
    );
    expect(r.status).toBe('warn');
  });

  test('an AppData\\Local path → warn', () => {
    const r = assessProjectRoot(
      'C:\\Users\\me\\AppData\\Local\\Temp',
      { hasGit: false, hasPackageJson: false, hasClaude: false }
    );
    expect(r.status).toBe('warn');
  });

  test('a Program Files path → warn', () => {
    const r = assessProjectRoot(
      'C:\\Program Files\\AnApp',
      { hasGit: false, hasPackageJson: false, hasClaude: false }
    );
    expect(r.status).toBe('warn');
  });

  test('a non-install dir LACKING any markers → warn (no project markers)', () => {
    const r = assessProjectRoot(
      'C:\\Users\\me\\Documents\\random',
      { hasGit: false, hasPackageJson: false, hasClaude: false }
    );
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/marker|\.git|package\.json/i);
  });

  test('a dir with only .claude marker → ok', () => {
    const r = assessProjectRoot('/home/me/notes', { hasGit: false, hasPackageJson: false, hasClaude: true });
    expect(r.status).toBe('ok');
  });

  test('never throws on odd input', () => {
    expect(() => assessProjectRoot('', {})).not.toThrow();
    expect(() => assessProjectRoot(null, null)).not.toThrow();
  });
});
