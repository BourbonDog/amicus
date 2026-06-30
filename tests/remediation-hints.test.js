// tests/remediation-hints.test.js
'use strict';
const hints = require('../src/utils/remediation-hints');

describe('remediation-hints helper', () => {
  test('exports copy-paste fix strings as non-empty strings', () => {
    for (const key of ['reinstall', 'reinstallEngine', 'reinstallElectron', 'rebuildElectron', 'cacheClean', 'runDoctor']) {
      expect(typeof hints[key]).toBe('string');
      expect(hints[key].length).toBeGreaterThan(0);
    }
  });

  test('reinstall hint is the canonical global reinstall command', () => {
    expect(hints.reinstall).toMatch(/npm install -g amicus/);
  });

  test('reinstallEngine hint covers the transient-rollback retry path', () => {
    expect(hints.reinstallEngine).toMatch(/transient/i);
    expect(hints.reinstallEngine).toMatch(/npm install -g amicus/);
    expect(hints.reinstallEngine).toMatch(/npm cache clean --force/);
  });

  test('reinstallElectron hint mentions reinstalling to add Electron', () => {
    expect(hints.reinstallElectron).toMatch(/npm install -g amicus/i);
    expect(hints.reinstallElectron).toMatch(/electron/i);
  });

  test('rebuildElectron hint covers deleting node_modules/electron and rebuilding', () => {
    expect(hints.rebuildElectron).toMatch(/node_modules[/\\]electron/i);
    expect(hints.rebuildElectron).toMatch(/rebuild|reinstall/i);
  });

  test('cacheClean hint is the npm cache clean command', () => {
    expect(hints.cacheClean).toMatch(/npm cache clean --force/);
  });

  test('runDoctor hint points at amicus doctor', () => {
    expect(hints.runDoctor).toMatch(/amicus doctor/);
  });

  test('module surface is frozen (stable copy-paste contract)', () => {
    expect(Object.isFrozen(hints)).toBe(true);
  });
});
