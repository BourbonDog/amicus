// tests/sidecar/aliases-owner.test.js
'use strict';
/**
 * #238 Phase 2 — `amicus aliases --review --owner` (D3/D4/D8). Everything
 * external is injected: git (the gate), the TTY, the prompt, today's date,
 * the catalog, and the data file (a temp copy — NO test may write the shipped
 * src/utils/curated-pins.json; in CI the real gate would pass). The picker
 * (aliases-review.js :: runReview) and the engine run for real.
 *
 * Round-1 review Important: the walk tests are NOT welded to the live
 * shipped src/utils/curated-pins.json — the feature's first real use (the
 * owner's D3 baseline session, right after this merges) changes those pins
 * and would redden every number/string a live-data test hardcodes. Every
 * `runOwnerReview` test below runs against the SYNTHETIC `DOC` fixture
 * (6 pins, 9 routes, the same four namespaces in the same file-order as the
 * shipped file); `routesByProvider`/`routeDisagreements`'s shipped-data
 * invariants are pinned instead to the FROZEN `tests/fixtures/curated-pins-
 * b803a2a.json` snapshot, which never moves, plus one cheap assertion that
 * the LIVE shipped file also holds the invariant today.
 *
 * Named mutants, MEASURED red (fix round 1, command:
 * `npx jest tests/sidecar/aliases-owner.test.js tests/sidecar/aliases-review.test.js`,
 * one mutant applied at a time, restored on the committed tree after each):
 *   GATEPREFIX — ownerGate ignores a non-empty `--show-prefix`.
 *     RED: aliases-owner.test.js > ownerGate > "refuses an installed copy — a
 *     non-empty --show-prefix (mutant GATEPREFIX)".
 *   DIRTYTREE  — ownerGate ignores a non-empty `status --porcelain`.
 *     RED: aliases-owner.test.js > ownerGate > "refuses a dirty tree — a
 *     non-empty porcelain status (mutant DIRTYTREE)".
 *   PROVREFUSE — the sink calls setPinRoute with providerOf(id) instead of the pass's namespace.
 *     RED: aliases-owner.test.js > runOwnerReview > "choose another with an
 *     id from another namespace is refused by the sink in EITHER direction,
 *     document unchanged (mutant PROVREFUSE)" — visibly: gemini's GOOGLE
 *     route is silently rewritten while the openrouter pass is refusing it.
 *   SAVEFIRST  — the sink assigns `doc = next` before saveCuratedPins (a failed write would be kept in memory).
 *     RED: aliases-owner.test.js > runOwnerReview > "a failed write keeps the
 *     in-memory document unchanged, so a later accept does not carry it
 *     (mutant SAVEFIRST)".
 *   NODISMISS  — menuFor pushes `never ask again` unconditionally.
 *     RED (2 tests): aliases-owner.test.js > runOwnerReview > "one pass per
 *     namespace: a namespace with no authoritative row is announced and
 *     skipped; a failed one too"; and aliases-review.test.js > "aliases
 *     --review (#238 §4, Q2, Q4)" > 'a proposal without a dismissKey offers
 *     no "never ask again" (owner mode, #238 Phase 2; mutant NODISMISS)'.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_MAX_AGE_MS } = require('../../src/utils/model-catalog');

const FROZEN_SHIPPED = path.resolve(__dirname, '../fixtures/curated-pins-b803a2a.json');
const pinsModule = () => require('../../src/utils/curated-pins');

/**
 * Synthetic baseline (round-1 review Important, item 1): 6 pins, 9 routes,
 * across the same four namespaces (openrouter, google, anthropic, deepseek)
 * in the same file-order the shipped file happens to use today — but this
 * object, not that file, is what every walk test below is welded to.
 */
const DOC = {
  version: 1,
  pins: {
    gemini: { routes: { openrouter: 'openrouter/google/gemini-3.6-flash', google: 'google/gemini-3.6-flash' }, verifiedOn: '2026-08-04' },
    glm: { routes: { openrouter: 'openrouter/z-ai/glm-5.3' }, verifiedOn: '2026-08-04', ruling: 'why glm' },
    gpt: { routes: { openrouter: 'openrouter/openai/gpt-5.6-terra' }, verifiedOn: '2026-08-04', ruling: 'tracks the terra (mid) tier' },
    grok: { routes: { openrouter: 'openrouter/x-ai/grok-4.3' }, verifiedOn: '2026-08-04' },
    opus: { routes: { openrouter: 'openrouter/anthropic/claude-opus-5', anthropic: 'anthropic/claude-opus-5' }, verifiedOn: '2026-08-04' },
    deepseek: { routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro', deepseek: 'deepseek/deepseek-v4-pro' }, verifiedOn: '2026-08-04' },
  },
  retired: {},
  notable: [],
};

/** Every DOC route id, so a pass finds its routes LIVE unless a test omits them — a route absent from a namespace the catalog covers reads as STALE and would flood the pass with proposals. */
const docRouteIds = () => Object.values(DOC.pins).flatMap(p => Object.values(p.routes));
function catalogWith({ extra = [], omit = () => false, failures = [], fetchedAt = Date.now() } = {}) {
  const base = docRouteIds().filter(id => !omit(id)).map(id => ({ id }));
  return { models: [...base, ...extra.map(e => (typeof e === 'string' ? { id: e } : e))], fetchedAt, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: failures };
}
const EMPTY_CATALOG = { models: [], fetchedAt: null, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [] };

function harness({ answers = [], catalog, git = () => '', isTTY = true, today = '2026-09-20', doc = DOC } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliases-owner-'));
  const file = path.join(dir, 'curated-pins.json');
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
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

describe('routesByProvider / routeDisagreements (pinned to a frozen shipped-pins snapshot, never the live file)', () => {
  const { routesByProvider, routeDisagreements } = require('../../src/sidecar/aliases-owner');
  const frozenPins = () => JSON.parse(fs.readFileSync(FROZEN_SHIPPED, 'utf8')).pins;

  test('groups every route by its namespace, openrouter first, file order within', () => {
    const pins = frozenPins();
    const g = routesByProvider(pins);
    expect(Object.keys(g)).toEqual(['openrouter', 'google', 'anthropic', 'deepseek']);
    expect(Object.keys(g.openrouter)).toHaveLength(21);
    expect(g.google).toEqual({ gemini: 'google/gemini-3.6-flash' });
    expect(Object.keys(g.anthropic)).toEqual(['opus', 'claude', 'sonnet', 'haiku', 'fable']);
    expect(Object.getPrototypeOf(g)).toBeNull();
    expect(Object.getPrototypeOf(g.openrouter)).toBeNull();
  });
  test('the frozen shipped pins have no route disagreements; a non-divergent mismatch is named; a divergent vendor never is', () => {
    const pins = frozenPins();
    expect(routeDisagreements(pins)).toEqual([]);
    const bent = JSON.parse(JSON.stringify(pins));
    bent.gemini.routes.openrouter = 'openrouter/google/gemini-3.7-flash';
    bent.haiku.routes.openrouter = 'openrouter/anthropic/claude-haiku-4.6';
    const lines = routeDisagreements(bent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('gemini: google route google/gemini-3.6-flash ≠ google/gemini-3.7-flash');
  });
  test('the LIVE shipped file also has no route disagreements today (a genuine invariant of the shipped data, cheap to check)', () => {
    expect(routeDisagreements(pinsModule().loadCuratedPins().pins)).toEqual([]);
  });
  test('round-1 review Small 5: a route under a vendor stripGatewayPrefix cannot derive (not a registered direct provider) is never read as a disagreement', () => {
    // 'z-ai' has no direct-API integration (curated-models.js's DIVERGENT_VENDORS/provider-registry
    // do not know it), so stripGatewayPrefix returns the openrouter route unchanged; a hand-authored
    // extra route under that same vendor name must not manufacture a false "disagreement".
    const pins = { widget: { routes: { openrouter: 'openrouter/z-ai/glm-5.3', 'z-ai': 'z-ai/glm-5.3' }, verifiedOn: '2026-08-04' } };
    expect(routeDisagreements(pins)).toEqual([]);
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

  test('round-1 review Small 3: a stale readCache does not repeat the refreshing-catalog banner once per namespace pass', async () => {
    // Every DOC route lives in the catalog (nothing to propose anywhere), so
    // all four passes run clean with zero `ask` calls -- isolating whether
    // the banner (from a stale cache the "refresh" never actually updated)
    // prints once overall or once per pass.
    const stale = catalogWith({ fetchedAt: Date.now() - (3 * DEFAULT_MAX_AGE_MS) });
    h = harness({ catalog: stale });
    h.deps.readCache = () => stale;
    h.deps.getCatalogInfo = async () => stale;
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    const matches = h.out().match(/refreshing catalog/g) || [];
    expect(matches).toHaveLength(1);
  });

  test('one pass per namespace: a namespace with no authoritative row is announced and skipped; a failed one too', async () => {
    // every DOC route live, plus a newer glm sibling; the deepseek namespace only as a FLOOR row; anthropic rejected
    const catalog = catalogWith({
      extra: ['openrouter/z-ai/glm-5.4', { id: 'deepseek/deepseek-v4-pro', authoritative: false }],
      omit: id => id.startsWith('deepseek/'),
      failures: [{ provider: 'anthropic', reason: 'http-status', status: 401 }] });
    h = harness({ catalog, answers: ['3'] }); // glm: [1] accept 5.4 [2] choose another [3] skip
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    const out = h.out();
    expect(out).toContain('owner mode — reviewing the shipped pins in src/utils/curated-pins.json (6 pins, 9 routes)');
    expect(out).toContain('openrouter routes (6):');
    expect(out).toContain('[1/1] glm');
    expect(out).toContain('google routes (1):');
    expect(out).toContain('Nothing to review — 1 alias, all following or up to date.'); // T4's wording; the google route is live
    expect(out).toContain('anthropic routes (1): provider fetch failed this run — not reviewed');
    expect(out).toContain('deepseek routes (1): no authoritative rows in the catalog (no key?) — not reviewed');
    expect(out).not.toContain('never ask again'); // mutant NODISMISS
    expect(out).toContain('no pin changed — src/utils/curated-pins.json is untouched');
    expect(h.log).not.toContain('SAVE');
  });

  test('accept: the route is replaced in ITS namespace, verifiedOn stamped with the injected UTC date, the write lands BEFORE the ✓, canonical format, ruling prompt keeps the current text on enter', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog, answers: ['1', ''] }); // accept glm-5.4 (the only proposal across all four passes); ruling: enter keeps
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    const doc = h.read();
    expect(doc.pins.glm.routes).toEqual({ openrouter: 'openrouter/z-ai/glm-5.4' });
    expect(doc.pins.glm.verifiedOn).toBe('2026-09-20');
    expect(doc.pins.glm.ruling).toBe('why glm'); // pre-existing ruling: blank answer KEEPS it, does not clear it
    expect(doc.pins.gemini).toEqual(DOC.pins.gemini); // untouched
    expect(fs.readFileSync(h.file, 'utf8')).toBe(JSON.stringify(doc, null, 2) + '\n');
    const saveAt = h.log.indexOf('SAVE');
    const tickAt = h.log.findIndex(l => l.includes('✓ glm → openrouter/z-ai/glm-5.4'));
    expect(saveAt).toBeGreaterThan(-1);
    expect(saveAt).toBeLessThan(tickAt);
    expect(h.out()).toContain('rulings — a sentence on WHY');
    expect(h.out()).toContain('current: why glm');
    expect(h.out()).toContain('1 pin changed — review with: git diff src/utils/curated-pins.json');
  });

  test('ruling typed after the walk is trimmed and written; the current (pre-existing) ruling is shown first', async () => {
    const catalog = catalogWith({ extra: ['openrouter/openai/gpt-5.7-terra'] }); // gpt's sibling
    h = harness({ catalog, answers: ['1', '  terra tier confirmed live 2026-09-20  '] });
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('current: tracks the terra (mid) tier');
    expect(h.read().pins.gpt.ruling).toBe('terra tier confirmed live 2026-09-20');
    expect(h.read().pins.gpt.routes.openrouter).toBe('openrouter/openai/gpt-5.7-terra');
    expect(h.log.filter(l => l === 'SAVE')).toHaveLength(2);
  });

  test('choose another with an id from another namespace is refused by the sink in EITHER direction, document unchanged (mutant PROVREFUSE)', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'google/gemini-3.7-flash', 'openrouter/google/gemini-3.7-flash'] });
    // openrouter pass: gemini (sibling of its OWN openrouter route) -> [2] choose another -> type a GOOGLE id (real, gated) -> refused -> [3] skip;
    //                  glm (sibling) -> [3] skip;
    // google pass:     gemini (sibling of its OWN google route) -> [2] choose another -> type an OPENROUTER id (real, gated) -> refused -> [3] skip.
    h = harness({ catalog, answers: ['2', 'google/gemini-3.7-flash', '3', '3', '2', 'openrouter/google/gemini-3.7-flash', '3'] });
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain("could not write: curated-pins.json: 'google/gemini-3.7-flash' is not in the openrouter/ namespace");
    expect(h.out()).toContain("could not write: curated-pins.json: 'openrouter/google/gemini-3.7-flash' is not in the google/ namespace");
    expect(h.read()).toEqual(DOC);
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
    jest.doMock('../../src/sidecar/aliases-owner', () => { throw new Error('must not load aliases-owner.js'); });
    const { handleAliases } = require('../../src/sidecar/aliases');
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await handleAliases({ _: ['aliases'], owner: true })).toBe(1);
    expect(err.mock.calls.map(c => c[0]).join('')).toContain('--owner requires --review');
    err.mockRestore();
    jest.dontMock('../../src/sidecar/aliases-owner');
  });
  test('--review --owner --json is still the --review argument error', async () => {
    jest.resetModules();
    jest.doMock('../../src/sidecar/aliases-owner', () => { throw new Error('must not load aliases-owner.js'); });
    const { handleAliases } = require('../../src/sidecar/aliases');
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await handleAliases({ _: ['aliases'], review: true, owner: true, json: true })).toBe(1);
    expect(err.mock.calls.map(c => c[0]).join('')).toContain('--review is interactive');
    err.mockRestore();
    jest.dontMock('../../src/sidecar/aliases-owner');
  });
});
