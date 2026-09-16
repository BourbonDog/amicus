// tests/utils/alias-notice.test.js
'use strict';
/**
 * #238 D5 — the exit hook's decision, count, stamp and spawn, with every
 * collaborator injected (no config dir, no catalog file, no child process).
 * Spec §6 row 7: fires on stderr; not within 24 h of lastNotified (Q5); the
 * detached refresh only at exit 0 with a cache older than 7 days (Q1), never
 * on a failed run. `exitHookAllowed`'s terms are tested one by one in
 * tests/utils/alias-refresh-state.test.js; here the predicate is one gate.
 * The engines (normalizeAliases, buildAliasProposals) are the real ones —
 * pure — over a synthetic `defaults` map (never the live shipped pins).
 * Council #254 round 1: the two stamps live in `alias-notice-state.json`,
 * never in config — `saveConfig` stays in the recorder only as a TRIPWIRE
 * (mutant CONFIGWRITE), asserted empty in every test below that fires.
 */
const { runExitHook, countProposals, refreshDue, spawnDetachedRefresh } = require('../../src/utils/alias-notice');
const { REFRESH_MAX_AGE_MS } = require('../../src/utils/alias-refresh-state');

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = 1_800_000_000_000;
const DEFAULTS = { __proto__: null, glm: 'openrouter/z-ai/glm-5.3' };
const CATALOG = {
  schemaVersion: 2, fetchedAt: NOW - H,
  models: [{ id: 'openrouter/z-ai/glm-5.2' }, { id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }],
};

/**
 * A collaborator set over a "disk" of one config object, one catalog doc and one notice-state
 * doc; every write, spawn and stderr byte is recorded. `saveConfig` is a tripwire only — the
 * hook must never call it (mutant CONFIGWRITE) — and `rec.calls` counts the three reads whose
 * ORDER R-P4-17 depends on (loadConfig, readCache, readNoticeState).
 */
function deps(over = {}) {
  const disk = {
    config: over.config === undefined ? { aliases: { mine: 'openrouter/z-ai/glm-5.2' } } : over.config,
    catalog: over.catalog === undefined ? CATALOG : over.catalog,
    state: { lastNotified: null, lastRefreshSpawned: null, ...over.state },
  };
  const rec = {
    saves: [], stateWrites: [], spawns: [], stderr: '', unrefs: 0, listened: [],
    calls: { loadConfig: 0, readCache: 0, readNoticeState: 0 },
  };
  const d = {
    loadConfig: () => { rec.calls.loadConfig += 1; return disk.config === null ? null : JSON.parse(JSON.stringify(disk.config)); },
    saveConfig: (c) => { rec.saves.push(JSON.parse(JSON.stringify(c))); disk.config = c; },   // TRIPWIRE (mutant CONFIGWRITE) — never called by runExitHook
    getDefaultAliases: () => DEFAULTS,
    normalizeAliases: require('../../src/utils/alias-state').normalizeAliases,
    buildAliasProposals: require('../../src/utils/alias-proposals').buildAliasProposals,
    readDismissals: () => (disk.config && disk.config.aliasReview && disk.config.aliasReview.dismissed) || {},
    loadCuratedPins: () => ({ retired: {}, notable: [] }),
    readCache: () => { rec.calls.readCache += 1; return disk.catalog; },
    readNoticeState: () => { rec.calls.readNoticeState += 1; return { ...disk.state }; },
    writeNoticeState: (patch) => { rec.stateWrites.push({ ...patch }); Object.assign(disk.state, patch); return true; },
    spawn: (file, args, opts) => {
      rec.spawns.push({ file, args, opts });
      return { on: (ev) => { rec.listened.push(ev); }, unref: () => { rec.unrefs += 1; } };
    },
    execPath: '/usr/bin/node',
    binPath: '/repo/bin/amicus.js',
    env: { PATH: 'x', CI: '0' },
    stderr: { write: (s) => { rec.stderr += s; return true; } },
    now: () => NOW,
    ...over.deps,
  };
  return { d, rec, disk };
}
const RUN = { code: 0, command: 'list', args: {}, stdinIsTTY: true };
const STALE = { ...CATALOG, fetchedAt: NOW - 8 * D };

describe('countProposals — cache only, through the engine', () => {
  test('a custom pin behind a newer sibling counts one; a following alias counts nothing', () => {
    expect(countProposals(deps().d)).toBe(1);
    expect(countProposals(deps({ config: { aliases: {} } }).d)).toBe(0);
  });
  test('a dismissed pairing does not count (Q5)', () => {
    const config = { aliases: { mine: 'openrouter/z-ai/glm-5.2' }, aliasReview: { dismissed: { 'mine@openrouter/z-ai/glm-5.4': '2026-09-16T00:00:00.000Z' } } };
    expect(countProposals(deps({ config }).d)).toBe(0);
  });
  test('no cache, or no config at all: zero, never a throw', () => {
    expect(countProposals(deps({ catalog: null }).d)).toBe(0);
    expect(countProposals(deps({ config: null }).d)).toBe(0);
  });
  test('a seeded key equal to the shipped pin is normalized IN MEMORY (no write) and counts nothing', () => {
    const { d, rec } = deps({ config: { aliases: { glm: 'openrouter/z-ai/glm-5.3' } } });
    expect(countProposals(d)).toBe(0);
    expect(rec.saves).toEqual([]);
  });
  test('a throwing collaborator yields zero and prints nothing (mutant THROWLEAK)', () => {
    const { d, rec } = deps({ deps: { readCache: () => { throw new Error('EACCES'); } } });
    expect(countProposals(d)).toBe(0);
    expect(rec.stderr).toBe('');
  });
});

describe('refreshDue — Q1 with the daily back-off', () => {
  test('older than a week: due; exactly a week or fresher: not (mutant BOUNDARY)', () => {
    expect(refreshDue({ fetchedAt: NOW - REFRESH_MAX_AGE_MS - 1 }, NOW)).toBe(true);
    expect(refreshDue({ fetchedAt: NOW - REFRESH_MAX_AGE_MS }, NOW)).toBe(false);
    expect(refreshDue({ fetchedAt: NOW - H }, NOW)).toBe(false);
  });
  test('no cache, or a doc without fetchedAt (a first attempt that failed): not due — nothing to age (mutant NOCACHESPAWN)', () => {
    expect(refreshDue(null, NOW)).toBe(false);
    expect(refreshDue({ lastRefreshAttempt: NOW - 2 * D, lastRefreshError: 'network-error' }, NOW)).toBe(false);
  });
  test("a future fetchedAt reads as fresh, as getCatalog's rule", () => { expect(refreshDue({ fetchedAt: NOW + D }, NOW)).toBe(false); });
  test('a failed attempt within the last day backs off; an older one does not (mutant BACKOFF)', () => {
    const old = NOW - 10 * D;
    expect(refreshDue({ fetchedAt: old, lastRefreshAttempt: NOW - 2 * H }, NOW)).toBe(false);
    expect(refreshDue({ fetchedAt: old, lastRefreshAttempt: NOW - 25 * H }, NOW)).toBe(true);
    expect(refreshDue({ fetchedAt: old, lastRefreshAttempt: null }, NOW)).toBe(true);
    expect(refreshDue({ fetchedAt: old, lastRefreshAttempt: NOW + D }, NOW)).toBe(true);   // future attempt = never
  });
  test('R-P4-11: a background refresh started within the last day is not started again; an older or FUTURE start is (mutant NOSPAWNSTAMP)', () => {
    expect(refreshDue(STALE, NOW, NOW - H)).toBe(false);
    expect(refreshDue(STALE, NOW, NOW - 25 * H)).toBe(true);
    expect(refreshDue(STALE, NOW, NOW + D)).toBe(true);
  });
});

describe('spawnDetachedRefresh — the workspace-window.js shape', () => {
  test("this binary, models --refresh, detached, silent, hidden, unref'd, error-listened", () => {
    const { d, rec } = deps();
    expect(spawnDetachedRefresh(d)).toBe(true);
    expect(rec.spawns).toEqual([{
      file: '/usr/bin/node',
      args: ['/repo/bin/amicus.js', 'models', '--refresh'],
      opts: { detached: true, stdio: 'ignore', windowsHide: true, env: d.env },
    }]);
    expect(rec.unrefs).toBe(1);
    expect(rec.listened).toEqual(['error']);
  });
  test('a throwing spawn is false, not a throw', () => {
    const { d } = deps({ deps: { spawn: () => { throw new Error('ENOENT'); } } });
    expect(spawnDetachedRefresh(d)).toBe(false);
  });
});

describe('runExitHook — the notice', () => {
  test('fires once: the stamp, then the singular line on stderr (mutant PLURAL: "1 alias updates")', () => {
    const { d, rec } = deps();
    expect(runExitHook(RUN, d)).toEqual({ notice: true, refresh: false });
    expect(rec.stderr).toBe('\n  1 alias update available — amicus aliases --review\n');
    expect(rec.stateWrites).toEqual([{ lastNotified: NOW }]);
    expect(rec.saves).toEqual([]);
  });
  test('plural for two', () => {
    const { d, rec } = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2', other: 'openrouter/z-ai/glm-5.3' } } });
    runExitHook(RUN, d);
    expect(rec.stderr).toContain('2 alias updates available');
    expect(rec.saves).toEqual([]);
  });
  test('config is never written: a notice and a refresh both fire in one exit (mutant CONFIGWRITE)', () => {
    const cfg = {
      default: 'gemini', aliases: { mine: 'openrouter/z-ai/glm-5.2' },
      aliasReview: { dismissed: { 'x@y/z': '2026-01-01T00:00:00.000Z' } }, routing: { prefer: 'direct' },
    };
    const { d, rec } = deps({ config: cfg, catalog: STALE });
    expect(runExitHook(RUN, d)).toEqual({ notice: true, refresh: true });
    expect(rec.saves).toEqual([]);
  });
  test('Q5: silent within 24 h of lastNotified; fires again at 24 h while proposals remain', () => {
    const within = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2' } }, state: { lastNotified: NOW - D + 1 } });
    expect(runExitHook(RUN, within.d).notice).toBe(false);
    expect(within.rec.stderr).toBe('');
    expect(within.rec.stateWrites).toEqual([]);
    const at = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2' } }, state: { lastNotified: NOW - D } });
    expect(runExitHook(RUN, at.d).notice).toBe(true);
  });
  test('a FUTURE lastNotified (wrong clock) does not silence the notice: it fires and re-stamps now (mutant FUTURESILENT)', () => {
    const { d, rec } = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2' } }, state: { lastNotified: NOW + D } });
    expect(runExitHook(RUN, d).notice).toBe(true);
    expect(rec.stateWrites).toEqual([{ lastNotified: NOW }]);
    expect(rec.saves).toEqual([]);
  });
  test('nothing to review: no line, no stamp', () => {
    const { d, rec } = deps({ config: { aliases: {} } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.stderr).toBe('');
    expect(rec.stateWrites).toEqual([]);
  });
  test('the predicate is one gate: a --json run does nothing and reads no catalog', () => {
    let reads = 0;
    const { d, rec } = deps({ deps: { readCache: () => { reads += 1; return CATALOG; } } });
    expect(runExitHook({ ...RUN, args: { json: true } }, d)).toEqual({ notice: false, refresh: false });
    expect(rec.stderr).toBe('');
    expect(reads).toBe(0);
  });
  test('`amicus aliases` gets no echo of its own footer, but its refresh is still considered (mutant ALIASESECHO)', () => {
    const { d, rec } = deps({ catalog: STALE });
    expect(runExitHook({ ...RUN, command: 'aliases' }, d)).toEqual({ notice: false, refresh: true });
    expect(rec.stderr).toBe('');
    expect(rec.saves).toEqual([]);
  });
  test('R-P4-15: a state file that cannot be written means no receipt, no notice — the line stays unprinted (mutant NORECEIPT-NOTICE)', () => {
    const { d, rec } = deps({ deps: { writeNoticeState: () => false } });
    expect(runExitHook(RUN, d).notice).toBe(false);
    expect(rec.stderr).toBe('');
  });
  test("the notice does not depend on the exit code (the update notice's precedent); the refresh does", () => {
    const { d, rec } = deps({ catalog: STALE });
    expect(runExitHook({ ...RUN, code: 1 }, d)).toEqual({ notice: true, refresh: false });
    expect(rec.spawns).toEqual([]);
    expect(rec.saves).toEqual([]);
  });
});

describe('runExitHook — the refresh', () => {
  test('exit 0 with a cache older than a week spawns the detached refresh (mutant FAILEDRUN: code 1 would too)', () => {
    const cfg = { aliases: {} };
    const { d, rec } = deps({ config: cfg, catalog: STALE });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: true });
    expect(rec.spawns).toHaveLength(1);
    expect(rec.spawns[0].args).toEqual(['/repo/bin/amicus.js', 'models', '--refresh']);
    expect(rec.stateWrites).toEqual([{ lastRefreshSpawned: NOW }]);
    expect(rec.saves).toEqual([]);
    expect(runExitHook({ ...RUN, code: 1 }, deps({ config: { aliases: {} }, catalog: STALE }).d).refresh).toBe(false);
  });
  test('a fresh cache, no cache, or a day-old failed attempt: no spawn', () => {
    expect(runExitHook(RUN, deps({ config: { aliases: {} } }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: null }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: { ...STALE, lastRefreshAttempt: NOW - H } }).d).refresh).toBe(false);
  });
  test('R-P4-11: a background refresh spawned within the last day is not started again; an older one is (mutant NOSPAWNSTAMP)', () => {
    const within = deps({ config: { aliases: {} }, catalog: STALE, state: { lastRefreshSpawned: NOW - H } });
    expect(runExitHook(RUN, within.d).refresh).toBe(false);
    expect(within.rec.stateWrites).toEqual([]);
    const at = deps({ config: { aliases: {} }, catalog: STALE, state: { lastRefreshSpawned: NOW - 25 * H } });
    expect(runExitHook(RUN, at.d).refresh).toBe(true);
  });
  test('both fire in one exit: the notice stamp lands first, the refresh stamp second — disk.state holds both', () => {
    const { d, rec, disk } = deps({ catalog: STALE });
    expect(runExitHook(RUN, d)).toEqual({ notice: true, refresh: true });
    expect(rec.stateWrites).toEqual([{ lastNotified: NOW }, { lastRefreshSpawned: NOW }]);
    expect(disk.state).toEqual({ lastNotified: NOW, lastRefreshSpawned: NOW });
    expect(rec.saves).toEqual([]);
  });
  test('the standing half vetoes the refresh too: autoRefresh false, the env literal, CI', () => {
    expect(runExitHook(RUN, deps({ config: { aliases: {}, aliasReview: { autoRefresh: false } }, catalog: STALE }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: STALE, deps: { env: { AMICUS_NO_NETWORK_PROBES: '1' } } }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: STALE, deps: { env: { CI: 'true' } } }).d).refresh).toBe(false);
  });
  test('a throw anywhere is swallowed: both false, nothing printed (mutant THROWLEAK)', () => {
    const { d, rec } = deps({ deps: { loadConfig: () => { throw new Error('boom'); } } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.stderr).toBe('');
  });
  test('R-P4-16: a spawn that fails synchronously clears the start stamp it just wrote, so the next exit retries (mutant SYNCFAIL)', () => {
    const { d, rec } = deps({ config: { aliases: {} }, catalog: STALE, deps: { spawn: () => { throw new Error('ENOENT'); } } });
    expect(runExitHook(RUN, d).refresh).toBe(false);
    expect(rec.stateWrites).toEqual([{ lastRefreshSpawned: NOW }, { lastRefreshSpawned: null }]);
  });
});

describe('runExitHook — R-P4-13 (no config, nothing to tell) and R-P4-11 (no receipt, no spawn)', () => {
  test('no config at all: a skipped exit, not a config created from nothing (mutant NULLCONFIG)', () => {
    const { d, rec } = deps({ config: null, catalog: STALE });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.saves).toEqual([]);
    expect(rec.spawns).toEqual([]);
    expect(rec.calls.readCache).toBe(0);
    expect(rec.calls.readNoticeState).toBe(0);
  });
  test('loadConfig is read exactly once, and the notice never lands through saveConfig (mutant CONFIGWRITE)', () => {
    const full = { default: 'gemini', aliases: { mine: 'openrouter/z-ai/glm-5.2' }, routing: { prefer: 'direct' } };
    const { d, rec } = deps({ config: full });
    expect(runExitHook(RUN, d).notice).toBe(true);
    expect(rec.calls.loadConfig).toBe(1);
    expect(rec.saves).toEqual([]);
    expect(rec.stateWrites).toEqual([{ lastNotified: NOW }]);
  });
  test('a state file that cannot be written spawns nothing: no receipt, no spawn (mutant NORECEIPT)', () => {
    const { d, rec } = deps({ config: { aliases: {} }, catalog: STALE, deps: { writeNoticeState: () => false } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.spawns).toEqual([]);
  });
  test('both fire in one exit: the catalog cache is read exactly once (mutant ONEREAD)', () => {
    let reads = 0;
    const { d } = deps({ catalog: STALE, deps: { readCache: () => { reads += 1; return STALE; } } });
    expect(runExitHook(RUN, d)).toEqual({ notice: true, refresh: true });
    expect(reads).toBe(1);
  });
});

describe('runExitHook — R-P4-17 (the cheap terms run before any file read)', () => {
  test('no terminal on stdin: no file touched at all (mutant EAGERLOAD)', () => {
    const { d, rec } = deps();
    expect(runExitHook({ ...RUN, stdinIsTTY: false }, d)).toEqual({ notice: false, refresh: false });
    expect(rec.calls).toEqual({ loadConfig: 0, readCache: 0, readNoticeState: 0 });
  });
  test('--json: no file touched at all (mutant EAGERLOAD)', () => {
    const { d, rec } = deps();
    expect(runExitHook({ ...RUN, args: { json: true } }, d)).toEqual({ notice: false, refresh: false });
    expect(rec.calls).toEqual({ loadConfig: 0, readCache: 0, readNoticeState: 0 });
  });
  test('AMICUS_NO_NETWORK_PROBES=1: config is never loaded (mutant EAGERLOAD)', () => {
    const { d, rec } = deps({ deps: { env: { AMICUS_NO_NETWORK_PROBES: '1' } } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.calls.loadConfig).toBe(0);
  });
  test('aliasReview.autoRefresh: false loads config once but never reads the catalog (mutant EAGERLOAD)', () => {
    const { d, rec } = deps({ config: { aliases: {}, aliasReview: { autoRefresh: false } } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.calls.loadConfig).toBe(1);
    expect(rec.calls.readCache).toBe(0);
  });
});

test('never throws: no arguments, a null run, a throwing loadConfig in countProposals', () => {
  // No deps supplied: runExitHook falls back to the real loadDeps()/loadConfig() (the
  // hermetic scratch config dir, per tests/setup/hermetic-config-dir.js) — reading an
  // empty scratch dir must still return both false, and print nothing.
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  expect(runExitHook()).toEqual({ notice: false, refresh: false });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  expect(runExitHook(null, deps().d)).toEqual({ notice: false, refresh: false });
  expect(countProposals({ ...deps().d, loadConfig: () => { throw new Error('boom'); } })).toBe(0);
});
