// tests/remediation-hints.test.js
'use strict';
const hints = require('../src/utils/remediation-hints');

describe('remediation-hints helper', () => {
  test('exports copy-paste fix strings as non-empty strings', () => {
    for (const key of ['reinstall', 'reinstallEngine', 'reinstallElectron', 'cacheClean', 'runDoctor']) {
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

describe('unverified-cause voice (v4.6 Plan 3)', () => {
  test('engineMissing states the cause as unverified, never asserts one', () => {
    expect(hints.engineMissing).toMatch(/the cause was not verified/);
    expect(hints.engineMissing).toMatch(/Common causes \(unverified\)/);
    expect(hints.engineMissing).not.toMatch(/likely/);
  });

  test('reinstallEngineAv labels the antivirus cause unverified', () => {
    expect(hints.reinstallEngineAv).toMatch(/unverified, but a known cause/);
  });

  test('the copy-paste commands survived the prose rewrite byte-identical', () => {
    expect(hints.engineMissing).toContain('npm i -g amicus');
    expect(hints.engineMissing).toContain('amicus doctor');
    expect(hints.reinstallEngineAv).toContain('npm install -g amicus');
    expect(hints.reinstallEngineAv).toContain('npm cache clean --force && npm install -g amicus');
  });

  // Owner ruling 2026-08-03, closing Plan 3's queued hint-voice question: the
  // unverified-cause voice applies only where the cause is genuinely a guess.
  test('rebuildElectron stays deleted: no live call site, doctor --fix is the convergence target — a reintroduction must adopt the unverified-cause voice', () => {
    expect(hints).not.toHaveProperty('rebuildElectron');
  });

  test('sweepSessionIndexTmp keeps its confident voice: the cause is definitional, not guessed', () => {
    expect(hints.sweepSessionIndexTmp).toMatch(/left by an interrupted write/);
    expect(hints.sweepSessionIndexTmp).not.toMatch(/unverified/i);
  });

  // v4.6.3 PR3 Task 3 (D8): same ruling applies to the metadata sibling sweep.
  test('sweepSessionMetadataTmp keeps its confident voice: the cause is definitional, not guessed', () => {
    expect(hints.sweepSessionMetadataTmp).toMatch(/left by an interrupted write/);
    expect(hints.sweepSessionMetadataTmp).not.toMatch(/unverified/i);
  });
});

// Review round 2, finding 3: `npm cache clean --force` removes
// flatOptions.cache (<cache>/_cacache — registry metadata) but npx trees live
// at flatOptions.npxCache (<cache>/_npx) — a DIFFERENT directory (verified
// against npm 11's own lib/commands/cache.js). Since doctor --fix has no
// skew branch, this hint is the ONLY remedy the user gets, so it must name a
// command that actually clears the npx tree: `npm cache npx rm` with no keys
// and --force (npmRootG's own cache.js: npxRm with empty keys + force wipes
// the whole npxCache dir).
describe('engineVersionSkew hint (#133 R-A, review round 2 finding 3)', () => {
  test('names the real npx-cache-clearing command, not the registry-metadata-only npm cache clean --force', () => {
    expect(hints.engineVersionSkew).toMatch(/npm cache npx rm/);
    expect(hints.engineVersionSkew).not.toMatch(/npm cache clean --force/);
  });

  test('still tells the user to reinstall the global engine to the exact pinned version (verified-accurate clause, unchanged)', () => {
    expect(hints.engineVersionSkew).toMatch(/npm install -g amicus/);
    expect(hints.engineVersionSkew).toMatch(/4\.7\.1/);
  });
});
