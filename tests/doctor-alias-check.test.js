// tests/doctor-alias-check.test.js
'use strict';

/**
 * B3 (council review of PR 198, issue 195): `doctor --fix` repairs a stored
 * alias whose value is a bare `<vendor>/<model>` id that classifies
 * `invalid` on the `direct` gateway AND has an unambiguous OpenRouter twin
 * (`findFabricatedAliasRepairs`, src/utils/alias-audit.js). See that
 * module's docstring for why this is narrower than "stale".
 *
 * This file has two halves:
 *   - Deps-injected unit tests against evaluateAliasesCheck(d) directly
 *     (no real I/O — mirrors doctor-fix.test.js's brokenElectronDeps idiom).
 *   - A realistic end-to-end test against an isolated AMICUS_CONFIG_DIR,
 *     using the REAL alias-audit + config read/write, proving the whole
 *     chain: seed -> detect -> --fix rewrites config.json on disk -> a heal
 *     degrade names both ids -> a second --fix run is a no-op.
 */

const { evaluateAliasesCheck, repairAlias } = require('../src/utils/doctor-alias-check');

// The exact fabricated-id example from the task brief: google's direct
// namespace is populated + authoritative but omits this exact model; the
// real openrouter row is the twin the pre-fix picker stripped the prefix
// from.
const FABRICATED_CATALOG = [
  { id: 'google/gemini-3.7-flash', authoritative: true },
  { id: 'google/gemini-2.5-pro', authoritative: true },
  { id: 'openrouter/google/gemma-4-31b-it:free' },
];

const OLD_ID = 'google/gemma-4-31b-it:free';
const NEW_ID = 'openrouter/google/gemma-4-31b-it:free';

function baseDeps(overrides = {}) {
  return {
    readCache: () => ({ fetchedAt: Date.now(), models: FABRICATED_CATALOG }),
    collectAliasSources: () => [{ alias: 'google', model: OLD_ID, source: 'user-config' }],
    findStaleAliases: () => [{ alias: 'google', model: OLD_ID, source: 'user-config' }],
    findDriftedStoredAliases: () => [],
    findFabricatedAliasRepairs: () => [{ alias: 'google', oldId: OLD_ID, newId: NEW_ID }],
    repairAlias: jest.fn(),
    ...overrides,
  };
}

describe('evaluateAliasesCheck — deps-injected (no real I/O)', () => {
  // Rule 1: only under --fix.
  test('without --fix: reports the repairable count and the doctor --fix hint, changes nothing', () => {
    const d = baseDeps();
    const row = evaluateAliasesCheck(d);
    expect(d.repairAlias).not.toHaveBeenCalled();
    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/1 fixable via doctor --fix/);
    expect(row.hint).toMatch(/amicus doctor --fix/);
    expect(row.fixed).toBeUndefined();
  });

  test('--fix with nothing repairable is a no-op (does not call repairAlias)', () => {
    const d = baseDeps({ findFabricatedAliasRepairs: () => [], fix: true });
    const row = evaluateAliasesCheck(d);
    expect(d.repairAlias).not.toHaveBeenCalled();
    expect(row.fixed).toBeUndefined();
  });

  test('--fix repairs the fabricated alias and marks the row fixed with a detail naming both ids', () => {
    // Simulate the post-repair reality the second computeState() pass reads:
    // findFabricatedAliasRepairs and findStaleAliases both go clean once the
    // config has been rewritten.
    let calls = 0;
    const d = baseDeps({
      fix: true,
      findFabricatedAliasRepairs: () => (calls++ === 0
        ? [{ alias: 'google', oldId: OLD_ID, newId: NEW_ID }] : []),
      findStaleAliases: () => [],
    });
    const row = evaluateAliasesCheck(d);
    expect(d.repairAlias).toHaveBeenCalledTimes(1);
    expect(d.repairAlias).toHaveBeenCalledWith('google', NEW_ID);
    expect(row.fixed).toBe(true);
    expect(row.fixDetail).toContain('google');
    expect(row.fixDetail).toContain(OLD_ID);
    expect(row.fixDetail).toContain(NEW_ID);
    expect(row.status).toBe('ok');
  });

  test('a throwing repairAlias is best-effort: the alias stays a warning, never marked fixed', () => {
    const d = baseDeps({
      fix: true,
      repairAlias: jest.fn(() => { throw new Error('disk full'); }),
    });
    const row = evaluateAliasesCheck(d);
    expect(row.fixed).toBeUndefined();
    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/1 stale/);
  });

  test('bare (no --fix) hint falls back to "amicus models --check" when nothing is repairable', () => {
    const d = baseDeps({ findFabricatedAliasRepairs: () => [] });
    const row = evaluateAliasesCheck(d);
    expect(row.hint).toBe('amicus models --check');
  });

  // A3 (council review of PR 198): the repair ACTION requires a FRESH cached
  // catalog -- doctor's 'catalog' check reads the exact same cache and would
  // independently call this one 'stale (25h old)'; --fix must not rewrite
  // config.aliases from data the same run just called untrustworthy.
  describe('--fix declines to repair from a stale catalog (A3)', () => {
    const staleReadCache = () => (
      { fetchedAt: Date.now() - 25 * 60 * 60 * 1000, models: FABRICATED_CATALOG });

    test('repairAlias is never called; the row stays unfixed and names the reason', () => {
      const d = baseDeps({ fix: true, readCache: staleReadCache });
      const row = evaluateAliasesCheck(d);
      expect(d.repairAlias).not.toHaveBeenCalled();
      expect(row.fixed).toBeUndefined();
      expect(row.status).toBe('warn');
      expect(row.message).toMatch(/1 fixable via doctor --fix once the catalog is refreshed \(catalog is stale\)/);
      expect(row.hint).toMatch(/amicus models --refresh/);
    });

    test('a cache with no fetchedAt at all is treated as not fresh (same as doctor\'s catalog check)', () => {
      const d = baseDeps({ fix: true, readCache: () => ({ models: FABRICATED_CATALOG }) });
      const row = evaluateAliasesCheck(d);
      expect(d.repairAlias).not.toHaveBeenCalled();
      expect(row.fixed).toBeUndefined();
    });

    test('exactly at the freshness boundary (24h old, inclusive) still repairs', () => {
      const d = baseDeps({
        fix: true,
        readCache: () => ({ fetchedAt: Date.now() - 24 * 60 * 60 * 1000, models: FABRICATED_CATALOG }),
      });
      const row = evaluateAliasesCheck(d);
      expect(d.repairAlias).toHaveBeenCalledTimes(1);
    });

    test('one second past the freshness boundary declines', () => {
      const d = baseDeps({
        fix: true,
        readCache: () => ({ fetchedAt: Date.now() - (24 * 60 * 60 * 1000 + 1000), models: FABRICATED_CATALOG }),
      });
      const row = evaluateAliasesCheck(d);
      expect(d.repairAlias).not.toHaveBeenCalled();
      expect(row.fixed).toBeUndefined();
    });
  });

  test('an already-healthy alias set stays ok and untouched even with --fix', () => {
    const d = baseDeps({
      fix: true,
      findStaleAliases: () => [],
      findDriftedStoredAliases: () => [],
      findFabricatedAliasRepairs: () => [],
      collectAliasSources: () => [],
    });
    const row = evaluateAliasesCheck(d);
    expect(d.repairAlias).not.toHaveBeenCalled();
    expect(row.status).toBe('ok');
    expect(row.fixed).toBeUndefined();
  });
});

// Realistic end-to-end test: isolated AMICUS_CONFIG_DIR, REAL alias-audit +
// REAL config read/write (repairAlias). Only readCache is mocked (avoids a
// real catalog fetch) — everything else is the production code path.
describe('doctor --fix alias repair — realistic end-to-end (isolated AMICUS_CONFIG_DIR)', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dirs = [];
  const orig = { cfg: process.env.AMICUS_CONFIG_DIR, env: process.env.AMICUS_ENV_DIR };

  afterEach(() => {
    jest.resetModules();
    for (const [k, v] of [['AMICUS_CONFIG_DIR', orig.cfg], ['AMICUS_ENV_DIR', orig.env]]) {
      if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; }
    }
    while (dirs.length) { fs.rmSync(dirs.pop(), { recursive: true, force: true }); }
  });

  function seedConfig(configJson) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-alias-fix-'));
    dirs.push(dir);
    process.env.AMICUS_CONFIG_DIR = dir;
    process.env.AMICUS_ENV_DIR = dir;
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(configJson, null, 2));
    jest.resetModules();
    return dir;
  }

  function realDeps(fix) {
    const aliasAudit = require('../src/utils/alias-audit');
    const doctorAliasCheck = require('../src/utils/doctor-alias-check');
    return {
      readCache: () => ({ fetchedAt: Date.now(), models: FABRICATED_CATALOG }),
      // Real collectAliasSources() — reads the real, isolated config.json via
      // loadConfig() underneath — but filtered to 'user-config' rows only, so
      // the always-present shipped defaults (gemini/gpt/deepseek/...), which
      // this test's small FABRICATED_CATALOG was never built to cover, don't
      // drown out the one alias this test seeded and cares about. The write
      // path (repairAlias) and every audit function below stay 100% real.
      collectAliasSources: () => aliasAudit.collectAliasSources().filter((s) => s.source === 'user-config'),
      findStaleAliases: (s, c) => aliasAudit.findStaleAliases(s, c),
      findDriftedStoredAliases: (s, c) => aliasAudit.findDriftedStoredAliases(s, c),
      findFabricatedAliasRepairs: (s, c) => aliasAudit.findFabricatedAliasRepairs(s, c),
      repairAlias: (alias, newId) => doctorAliasCheck.repairAlias(alias, newId),
      ...(fix ? { fix: true } : {}),
    };
  }

  test('--fix rewrites config.json on disk to the OpenRouter twin, preserving every other key', () => {
    const dir = seedConfig({
      default: 'google',
      aliases: { google: OLD_ID, gemini: 'openrouter/google/gemini-3.7-flash' },
      providers: { google: { key: 'redacted' } },
    });
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');
    const row = evaluate(realDeps(true));

    expect(row.fixed).toBe(true);
    expect(row.fixDetail).toContain('google');
    expect(row.fixDetail).toContain(OLD_ID);
    expect(row.fixDetail).toContain(NEW_ID);

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
    expect(onDisk.aliases.google).toBe(NEW_ID);
    // No-clobber: everything else survives byte-for-byte.
    expect(onDisk.aliases.gemini).toBe('openrouter/google/gemini-3.7-flash');
    expect(onDisk.default).toBe('google');
    expect(onDisk.providers).toEqual({ google: { key: 'redacted' } });
  });

  test('a heal degrade is emitted naming the alias and both the old and new id', () => {
    seedConfig({ aliases: { google: OLD_ID } });
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');
    const { collectDoctorDegrades } = require('../src/utils/doctor-degrade');
    const row = evaluate(realDeps(true));
    const degrades = collectDoctorDegrades([row]);
    const heal = degrades.find((r) => r.kind === 'heal');
    expect(heal).toBeTruthy();
    expect(heal.channel).toBe('doctor-fix');
    expect(heal.why).toContain('google');
    expect(heal.why).toContain(OLD_ID);
    expect(heal.why).toContain(NEW_ID);
  });

  test('without --fix: config.json is byte-identical on disk (change nothing)', () => {
    const seeded = { aliases: { google: OLD_ID } };
    const dir = seedConfig(seeded);
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');
    const row = evaluate(realDeps(false));
    expect(row.fixed).toBeUndefined();
    expect(row.message).toMatch(/1 fixable via doctor --fix/);
    const after = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(after).toBe(before);
  });

  test('empty catalog: --fix never writes (no evidence, no repair)', () => {
    const seeded = { aliases: { google: OLD_ID } };
    const dir = seedConfig(seeded);
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');
    const deps = { ...realDeps(true), readCache: () => ({ fetchedAt: Date.now(), models: [] }) };
    const row = evaluate(deps);
    expect(row.fixed).toBeUndefined();
    expect(row.message).toMatch(/catalog empty/);
    const after = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(after).toBe(before);
  });

  // A3 (council review of PR 198), realistic end-to-end: the SAME class B3
  // repairs when the catalog is fresh must be LEFT UNTOUCHED ON DISK when
  // the cached catalog is stale (25h old) -- proves the freshness gate holds
  // through the real config read/write path, not just the deps-injected unit.
  test('stale catalog: --fix never writes even though the alias would otherwise be repairable', () => {
    const dir = seedConfig({ aliases: { google: OLD_ID } });
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const deps = {
      ...realDeps(true),
      readCache: () => ({ fetchedAt: Date.now() - 25 * 60 * 60 * 1000, models: FABRICATED_CATALOG }),
    };
    const row = evaluate(deps);
    expect(row.fixed).toBeUndefined();
    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/1 fixable via doctor --fix once the catalog is refreshed \(catalog is stale\)/);
    expect(row.hint).toMatch(/amicus models --refresh/);
    const after = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(after).toBe(before); // untouched -- no write on stale evidence
  });

  test('a genuinely stale (typo) alias is reported but never rewritten', () => {
    const dir = seedConfig({ aliases: { google: 'google/gemna-4-31b-it:free' } }); // typo
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const row = evaluate(realDeps(true));
    expect(row.fixed).toBeUndefined();
    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/1 stale: google/);
    expect(row.message).not.toMatch(/fixable/);
    const after = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(after).toBe(before); // untouched
  });

  test('an ambiguous OpenRouter twin is reported but never rewritten', () => {
    const ambiguousCatalog = [
      { id: 'google/gemini-3.7-flash', authoritative: true },
      { id: 'openrouter/google/gemma-5-flash' },
      { id: 'openrouter/google/gemma.5-flash' }, // normalizes to the same key -> ambiguous
    ];
    const dir = seedConfig({ aliases: { google: 'google/gemma-5-flash' } });
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const deps = { ...realDeps(true), readCache: () => ({ fetchedAt: Date.now(), models: ambiguousCatalog }) };
    const row = evaluate(deps);
    expect(row.fixed).toBeUndefined();
    expect(row.status).toBe('warn');
    const after = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(after).toBe(before);
  });

  test('idempotent: a second --fix run is a no-op', () => {
    const dir = seedConfig({ aliases: { google: OLD_ID } });
    const { evaluateAliasesCheck: evaluate } = require('../src/utils/doctor-alias-check');

    const first = evaluate(realDeps(true));
    expect(first.fixed).toBe(true);
    const afterFirst = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');

    const second = evaluate(realDeps(true));
    expect(second.fixed).toBeUndefined();
    expect(second.status).toBe('ok');
    const afterSecond = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(afterSecond).toBe(afterFirst); // byte-identical — no further write
  });
});
