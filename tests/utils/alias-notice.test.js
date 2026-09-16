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

/** A collaborator set over a "disk" of one config object and one catalog doc; every write, spawn and stderr byte is recorded. */
function deps(over = {}) {
  const disk = {
    config: over.config === undefined ? { aliases: { mine: 'openrouter/z-ai/glm-5.2' } } : over.config,
    catalog: over.catalog === undefined ? CATALOG : over.catalog,
  };
  const rec = { saves: [], spawns: [], stderr: '', unrefs: 0, errorListeners: 0 };
  const d = {
    loadConfig: () => (disk.config === null ? null : JSON.parse(JSON.stringify(disk.config))),
    saveConfig: (c) => { rec.saves.push(JSON.parse(JSON.stringify(c))); disk.config = c; },
    getDefaultAliases: () => DEFAULTS,
    normalizeAliases: require('../../src/utils/alias-state').normalizeAliases,
    buildAliasProposals: require('../../src/utils/alias-proposals').buildAliasProposals,
    readDismissals: () => (disk.config && disk.config.aliasReview && disk.config.aliasReview.dismissed) || {},
    loadCuratedPins: () => ({ retired: {}, notable: [] }),
    readCache: () => disk.catalog,
    spawn: (file, args, opts) => {
      rec.spawns.push({ file, args, opts });
      return { on: () => { rec.errorListeners += 1; }, unref: () => { rec.unrefs += 1; } };
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
    expect(rec.errorListeners).toBe(1);
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
    expect(rec.saves).toHaveLength(1);
    expect(rec.saves[0].aliasReview.lastNotified).toBe(NOW);
  });
  test('plural for two', () => {
    const { d, rec } = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2', other: 'openrouter/z-ai/glm-5.3' } } });
    runExitHook(RUN, d);
    expect(rec.stderr).toContain('2 alias updates available');
  });
  test('the stamp is the ONLY write: the saved config is the loaded one plus lastNotified (mutant STAMPMORE)', () => {
    const cfg = {
      default: 'gemini', aliases: { mine: 'openrouter/z-ai/glm-5.2' },
      aliasReview: { dismissed: { 'x@y/z': '2026-01-01T00:00:00.000Z' } }, routing: { prefer: 'direct' },
    };
    const { d, rec } = deps({ config: cfg });
    runExitHook(RUN, d);
    expect(rec.saves[0]).toEqual({ ...cfg, aliasReview: { ...cfg.aliasReview, lastNotified: NOW } });
  });
  test('Q5: silent within 24 h of lastNotified; fires again at 24 h while proposals remain', () => {
    const within = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2' }, aliasReview: { lastNotified: NOW - D + 1 } } });
    expect(runExitHook(RUN, within.d).notice).toBe(false);
    expect(within.rec.stderr).toBe('');
    expect(within.rec.saves).toEqual([]);
    const at = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2' }, aliasReview: { lastNotified: NOW - D } } });
    expect(runExitHook(RUN, at.d).notice).toBe(true);
  });
  test('nothing to review: no line, no stamp', () => {
    const { d, rec } = deps({ config: { aliases: {} } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.stderr).toBe('');
    expect(rec.saves).toEqual([]);
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
  });
  test('a failing stamp still lets the line print (best-effort, the markMigrationNotified shape)', () => {
    const { d, rec } = deps({ deps: { saveConfig: () => { throw new Error('EROFS'); } } });
    expect(runExitHook(RUN, d).notice).toBe(true);
    expect(rec.stderr).toContain('1 alias update available');
  });
  test("the notice does not depend on the exit code (the update notice's precedent); the refresh does", () => {
    const { d, rec } = deps({ catalog: STALE });
    expect(runExitHook({ ...RUN, code: 1 }, d)).toEqual({ notice: true, refresh: false });
    expect(rec.spawns).toEqual([]);
  });
});

describe('runExitHook — the refresh', () => {
  test('exit 0 with a cache older than a week spawns the detached refresh (mutant FAILEDRUN: code 1 would too)', () => {
    const { d, rec } = deps({ config: { aliases: {} }, catalog: STALE });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: true });
    expect(rec.spawns).toHaveLength(1);
    expect(rec.spawns[0].args).toEqual(['/repo/bin/amicus.js', 'models', '--refresh']);
    expect(runExitHook({ ...RUN, code: 1 }, deps({ config: { aliases: {} }, catalog: STALE }).d).refresh).toBe(false);
  });
  test('a fresh cache, no cache, or a day-old failed attempt: no spawn', () => {
    expect(runExitHook(RUN, deps({ config: { aliases: {} } }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: null }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: { ...STALE, lastRefreshAttempt: NOW - H } }).d).refresh).toBe(false);
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
});
