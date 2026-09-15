// tests/sidecar/aliases-owner.test.js
'use strict';
/**
 * #238 Phase 2 — `amicus aliases --review --owner` (D3/D4/D8). Everything
 * external is injected: git (the gate), the TTY, the prompt, today's date,
 * the catalog, and the data file (a temp copy — NO test may write the shipped
 * src/utils/curated-pins.json; in CI the real gate would pass). The picker
 * (aliases-review.js :: runReview) and the engine run for real.
 *
 * Named mutants (measured red against this file):
 *   GATEPREFIX — ownerGate ignores a non-empty `--show-prefix`.
 *   DIRTYTREE  — ownerGate ignores a non-empty `status --porcelain`.
 *   PROVREFUSE — the sink calls setPinRoute with providerOf(id) instead of the pass's namespace.
 *   NODISMISS  — menuFor pushes `never ask again` unconditionally.
 *   SAVEFIRST  — the sink assigns `doc = next` before saveCuratedPins (a failed write would be kept in memory).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHIPPED = path.resolve(__dirname, '../../src/utils/curated-pins.json');
const pinsModule = () => require('../../src/utils/curated-pins');

/** Every shipped route id, so a pass finds its routes LIVE unless a test omits them — a route absent from a namespace the catalog covers reads as STALE and would flood the pass with proposals. */
const shippedRouteIds = () => Object.values(pinsModule().loadCuratedPins().pins).flatMap(p => Object.values(p.routes));
function catalogWith({ extra = [], omit = () => false, failures = [], fetchedAt = Date.now() } = {}) {
  const base = shippedRouteIds().filter(id => !omit(id)).map(id => ({ id }));
  return { models: [...base, ...extra.map(e => (typeof e === 'string' ? { id: e } : e))], fetchedAt, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: failures };
}
const EMPTY_CATALOG = { models: [], fetchedAt: null, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [] };

function harness({ answers = [], catalog, git = () => '', isTTY = true, today = '2026-09-20', doc } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliases-owner-'));
  const file = path.join(dir, 'curated-pins.json');
  fs.writeFileSync(file, doc ? JSON.stringify(doc, null, 2) + '\n' : fs.readFileSync(SHIPPED));
  const log = [];
  const queue = [...answers];
  const { loadCuratedPins, saveCuratedPins } = pinsModule();
  const deps = {
    isTTY,
    git,
    today: () => today,
    now: () => Date.now(),
    write: (s) => log.push(String(s)),
    stderr: (s) => log.push('ERR:' + String(s)),
    ask: async () => { if (queue.length === 0) { throw new Error('no more scripted answers'); } return queue.shift(); },
    getCatalogInfo: async () => catalog,
    readCache: () => catalog,
    loadCuratedPins: () => loadCuratedPins(file),
    saveCuratedPins: (d) => { log.push('SAVE'); saveCuratedPins(d, file); },
  };
  return { deps, file, dir, out: () => log.filter(l => !l.startsWith('ERR:')).join(''), err: () => log.filter(l => l.startsWith('ERR:')).join(''), log, read: () => JSON.parse(fs.readFileSync(file, 'utf8')), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const aborted = () => { const e = new Error('aliases --review interrupted'); e.code = 'REVIEW_ABORTED'; return e; };

describe('ownerGate', () => {
  const { ownerGate } = require('../../src/sidecar/aliases-owner');
  test('refuses without a TTY before touching git', () => {
    const git = jest.fn();
    expect(ownerGate({ isTTY: false, git })).toMatch(/interactive: run it in a terminal/);
    expect(git).not.toHaveBeenCalled();
  });
  test('refuses when git fails (not a checkout)', () => {
    expect(ownerGate({ isTTY: true, git: () => { throw new Error('fatal: not a git repository'); } })).toMatch(/not inside a git work tree/);
  });
  test('refuses an installed copy — a non-empty --show-prefix (mutant GATEPREFIX)', () => {
    const git = (args) => (args[1] === '--show-prefix' ? 'node_modules/amicus/' : '');
    expect(ownerGate({ isTTY: true, git })).toMatch(/not an installed copy .*node_modules\/amicus\//);
  });
  test('refuses a dirty tree — a non-empty porcelain status (mutant DIRTYTREE)', () => {
    const git = (args) => (args[0] === 'status' ? ' M src/x.js\n?? scratch' : '');
    expect(ownerGate({ isTTY: true, git })).toMatch(/clean working tree .*2 changed file/);
  });
  test('passes on a clean source checkout and asked git with --untracked-files=no', () => {
    const calls = [];
    const git = (args) => { calls.push(args); return ''; };
    expect(ownerGate({ isTTY: true, git })).toBeNull();
    expect(calls).toEqual([['rev-parse', '--show-prefix'], ['status', '--porcelain', '--untracked-files=no']]);
  });
});

describe('routesByProvider / routeDisagreements', () => {
  const { routesByProvider, routeDisagreements } = require('../../src/sidecar/aliases-owner');
  test('groups every route by its namespace, openrouter first, file order within', () => {
    const { pins } = pinsModule().loadCuratedPins();
    const g = routesByProvider(pins);
    expect(Object.keys(g)).toEqual(['openrouter', 'google', 'anthropic', 'deepseek']);
    expect(Object.keys(g.openrouter)).toHaveLength(21);
    expect(g.google).toEqual({ gemini: 'google/gemini-3.6-flash' });
    expect(Object.keys(g.anthropic)).toEqual(['opus', 'claude', 'sonnet', 'haiku', 'fable']);
    expect(Object.getPrototypeOf(g)).toBeNull();
    expect(Object.getPrototypeOf(g.openrouter)).toBeNull();
  });
  test('the shipped pins have no route disagreements; a non-divergent mismatch is named; a divergent vendor never is', () => {
    const { pins } = pinsModule().loadCuratedPins();
    expect(routeDisagreements(pins)).toEqual([]);
    const bent = JSON.parse(JSON.stringify(pins));
    bent.gemini.routes.openrouter = 'openrouter/google/gemini-3.7-flash';
    bent.haiku.routes.openrouter = 'openrouter/anthropic/claude-haiku-4.6';
    const lines = routeDisagreements(bent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('gemini: google route google/gemini-3.6-flash ≠ google/gemini-3.7-flash');
  });
});

describe('runOwnerReview', () => {
  const { runOwnerReview } = require('../../src/sidecar/aliases-owner');
  let h;
  afterEach(() => { if (h) { h.cleanup(); h = null; } });

  test('gate refusal: one stderr line, exit 1, nothing loaded or written', async () => {
    h = harness({ isTTY: false, catalog: EMPTY_CATALOG });
    h.deps.loadCuratedPins = jest.fn();
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.err()).toMatch(/^ERR:Error: aliases --review --owner is interactive/);
    expect(h.deps.loadCuratedPins).not.toHaveBeenCalled();
    expect(h.out()).toBe('');
  });

  test('no catalog: refuses with the models --refresh hint, exit 1, no write', async () => {
    h = harness({ catalog: EMPTY_CATALOG });
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('no catalog — cannot review');
    expect(h.log).not.toContain('SAVE');
  });

  test('one pass per namespace: a namespace with no authoritative row is announced and skipped; a failed one too', async () => {
    // every shipped route live, plus a newer glm sibling; the deepseek namespace only as a FLOOR row; anthropic rejected
    const catalog = catalogWith({
      extra: ['openrouter/z-ai/glm-5.4', { id: 'deepseek/deepseek-v4-pro', authoritative: false }],
      omit: id => id.startsWith('deepseek/'),
      failures: [{ provider: 'anthropic', reason: 'http-status', status: 401 }] });
    h = harness({ catalog, answers: ['3'] }); // glm: [1] accept 5.4 [2] choose another [3] skip
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    const out = h.out();
    expect(out).toContain('owner mode — reviewing the shipped pins in src/utils/curated-pins.json (21 pins, 28 routes)');
    expect(out).toContain('openrouter routes (21):');
    expect(out).toContain('[1/1] glm');
    expect(out).toContain('google routes (1):');
    expect(out).toContain('Nothing to review — 1 alias, all following or up to date.'); // T4's wording; the google route is live
    expect(out).toContain('anthropic routes (5): provider fetch failed this run — not reviewed');
    expect(out).toContain('deepseek routes (1): no authoritative rows in the catalog (no key?) — not reviewed');
    expect(out).not.toContain('never ask again'); // mutant NODISMISS
    expect(out).toContain('no pin changed — src/utils/curated-pins.json is untouched');
    expect(h.log).not.toContain('SAVE');
  });

  test('accept: the route is replaced in ITS namespace, verifiedOn stamped with the injected UTC date, the write lands BEFORE the ✓, canonical format, ruling prompt keeps on enter', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog, answers: ['1', ''] }); // accept glm-5.4 (the only proposal across all four passes); ruling: enter keeps
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    const doc = h.read();
    expect(doc.pins.glm.routes).toEqual({ openrouter: 'openrouter/z-ai/glm-5.4' });
    expect(doc.pins.glm.verifiedOn).toBe('2026-09-20');
    expect(doc.pins.glm.ruling).toBeUndefined();
    expect(doc.pins.gemini).toEqual(pinsModule().loadCuratedPins().pins.gemini); // untouched
    expect(fs.readFileSync(h.file, 'utf8')).toBe(JSON.stringify(doc, null, 2) + '\n');
    const saveAt = h.log.indexOf('SAVE');
    const tickAt = h.log.findIndex(l => l.includes('✓ glm → openrouter/z-ai/glm-5.4'));
    expect(saveAt).toBeGreaterThan(-1);
    expect(saveAt).toBeLessThan(tickAt);
    expect(h.out()).toContain('rulings — a sentence on WHY');
    expect(h.out()).toContain('current: (none)');
    expect(h.out()).toContain('1 pin changed — review with: git diff src/utils/curated-pins.json');
  });

  test('ruling typed after the walk is trimmed and written; the current ruling is shown first', async () => {
    const catalog = catalogWith({ extra: ['openrouter/openai/gpt-5.7-terra'] }); // gpt's sibling; not gpt-pro's (suffix -sol-pro) — measured
    h = harness({ catalog, answers: ['1', '  terra tier confirmed live 2026-09-20  '] });
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('current: tracks the terra (mid) tier');
    expect(h.read().pins.gpt.ruling).toBe('terra tier confirmed live 2026-09-20');
    expect(h.read().pins.gpt.routes.openrouter).toBe('openrouter/openai/gpt-5.7-terra');
    expect(h.log.filter(l => l === 'SAVE')).toHaveLength(2);
  });

  test('choose another with an id from another namespace is refused by the sink and the menu returns (mutant PROVREFUSE)', async () => {
    const catalog = catalogWith({ extra: ['google/gemini-3.7-flash', 'openrouter/z-ai/glm-5.4'] });
    // openrouter pass: glm proposal → [2] choose another → type a google id (a real, gated catalog row, so only the sink can refuse it) → refused → [3] skip; google pass: gemini has a newer sibling → [3] skip
    h = harness({ catalog, answers: ['2', 'google/gemini-3.7-flash', '3', '3'] });
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain("could not write: curated-pins.json: 'google/gemini-3.7-flash' is not in the openrouter/ namespace");
    expect(h.read()).toEqual(pinsModule().loadCuratedPins());
    expect(h.log).not.toContain('SAVE');
  });

  test('a failed write keeps the in-memory document unchanged, so a later accept does not carry it (mutant SAVEFIRST)', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'openrouter/x-ai/grok-4.4'] });
    h = harness({ catalog, answers: ['1', '3', '1', ''] }); // glm (file order: before grok) accept → write FAILS → menu again → skip; grok accept (write ok); ruling enter
    const realSave = h.deps.saveCuratedPins;
    let first = true;
    h.deps.saveCuratedPins = (d) => { if (first) { first = false; throw new Error('EACCES: disk says no'); } realSave(d); };
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('could not write: EACCES: disk says no');
    const doc = h.read();
    expect(doc.pins.grok.routes.openrouter).toBe('openrouter/x-ai/grok-4.4');
    expect(doc.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.3'); // the failed accept never reached disk through the later save
  });

  test('Ctrl-C mid-walk: tally, exit 1, no ruling prompts, summary still prints', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'openrouter/x-ai/grok-4.4'] });
    h = harness({ catalog });
    h.deps.ask = (() => { const q = ['1']; return async () => { if (q.length) { return q.shift(); } throw aborted(); }; })(); // glm accepted, then Ctrl-C on grok's menu
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('review interrupted — 1 accepted, 0 skipped, 0 dismissed so far');
    expect(h.out()).not.toContain('rulings — a sentence on WHY');
    expect(h.out()).toContain('1 pin changed — review with: git diff');
    expect(h.read().pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.4');
  });

  test('the routes-disagree summary names a non-divergent pair the session left inconsistent', async () => {
    const catalog = catalogWith({ extra: ['openrouter/google/gemini-3.7-flash'] }); // no google/gemini-3.7-flash row, so the google pass has nothing newer
    h = harness({ catalog, answers: ['1', ''] }); // openrouter pass: gemini → accept 3.7; google pass: nothing; ruling enter
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('⚠ gemini: google route google/gemini-3.6-flash ≠ google/gemini-3.7-flash derived from its openrouter route — reconcile by hand in src/utils/curated-pins.json');
  });

  test('never offers follow, never unpins: a shipped pin equal to nothing — the engine sees custom rows only', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog, answers: ['3'] });
    await runOwnerReview({}, h.deps);
    expect(h.out()).not.toContain('follow the shipped pin');
    expect(h.out()).not.toMatch(/^\s+shipped\s/m);
  });
});

describe('handleAliases dispatch', () => {
  test('--owner without --review is an argument error (exit 1) and never loads owner mode', async () => {
    jest.resetModules();
    const { handleAliases } = require('../../src/sidecar/aliases');
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await handleAliases({ _: ['aliases'], owner: true })).toBe(1);
    expect(err.mock.calls.map(c => c[0]).join('')).toContain('--owner requires --review');
    err.mockRestore();
  });
  test('--review --owner --json is still the --review argument error', async () => {
    jest.resetModules();
    const { handleAliases } = require('../../src/sidecar/aliases');
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await handleAliases({ _: ['aliases'], review: true, owner: true, json: true })).toBe(1);
    expect(err.mock.calls.map(c => c[0]).join('')).toContain('--review is interactive');
    err.mockRestore();
  });
});
