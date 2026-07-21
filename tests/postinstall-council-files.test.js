// tests/postinstall-council-files.test.js
'use strict';
const { COUNCIL_FILES } = require('../scripts/postinstall');

describe('COUNCIL_FILES install list (spec §4.8)', () => {
  const byFile = Object.fromEntries(COUNCIL_FILES.map(f => [f.file, f.mode]));

  test('SEAT-BRIEFS.md is now installed (overwrite) — closes the shipped-but-uninstalled gap', () => {
    expect(byFile['SEAT-BRIEFS.md']).toBe('overwrite');
  });
  test('SKILL.md and COUNCIL-DESIGN.md stay overwrite (product code)', () => {
    expect(byFile['SKILL.md']).toBe('overwrite');
    expect(byFile['COUNCIL-DESIGN.md']).toBe('overwrite');
  });
  test('MODEL-NOTES.md stays if-missing (machine-local user data)', () => {
    expect(byFile['MODEL-NOTES.md']).toBe('if-missing');
  });
  test('MANUAL-ORCHESTRATION.md is installed (overwrite)', () => {
    expect(byFile['MANUAL-ORCHESTRATION.md']).toBe('overwrite');
  });
});
