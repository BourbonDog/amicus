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
 *
 * Council round 1 (#238 PR #250, F1) MEASURED 2026-09-15 on the committed
 * tree, RE-MEASURED same day after the round-1 review's residuals landed
 * (`npx jest tests/sidecar/aliases-owner.test.js
 * tests/sidecar/aliases-review.test.js`; restored from a scratchpad backup
 * copy, not `git checkout --`, since the residuals were uncommitted at
 * measurement time — restoring via checkout would have discarded them; `git
 * diff` empty against the backup after):
 *   NOCAS — commit()'s disk-bytes comparison deleted (write unconditionally,
 *     `onDisk` computed but unused). RED (exactly 2, both in runOwnerReview):
 *     "F1(a) (#238 council r1 B1): a mid-walk external edit refuses the
 *     accept with a CAS message, the file keeps the edit, and the session
 *     exits 1 with a restart notice, never "no pin changed" (mutant NOCAS)";
 *     "F1(c) (#238 council r1 B1): the rulings phase refuses a write the same
 *     way when the file changed after the walk, exits 1 with the restart
 *     notice instead of "N pin(s) changed" (mutant NOCAS)". Every other test
 *     in both files, including SAVEFIRST's own test (a mocked saveCuratedPins
 *     throw still short-circuits before the CAS-only regression), stayed
 *     green. Also verified (scratch mutant, not committed): moving `const
 *     prompt = d.ask ? null : d.createPrompt();`'s effective call earlier —
 *     before the F3 load/catalog guards — reddens all three
 *     "…no write, no prompt" tests once `ask` is deleted from their deps
 *     (review item 2: the assertion is vacuous while `ask` stays injected,
 *     since `createPrompt` is then dead code regardless of guard order).
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

// `today` is an arbitrary injected date (#238 council r2 C2/C3, deepseek
// misread made unmissable) -- tests assert the stamp equals what was
// injected, nothing about the calendar.
function harness({ answers = [], catalog, git = () => '', isTTY = true, today = '2026-09-20', doc = DOC } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliases-owner-'));
  const file = path.join(dir, 'curated-pins.json');
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  const log = [];
  const queue = [...answers];
  const { saveCuratedPins } = pinsModule();
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
    saveCuratedPins: (d) => { log.push('SAVE'); saveCuratedPins(d, file); },
    // G1 (#238 council r2 A2): the ONE read owner mode makes -- both the CAS
    // baseline and the in-memory doc are parsed from these SAME bytes; there
    // is no separate `loadCuratedPins` dependency any more (it is not called).
    readCuratedPinsBytes: () => fs.readFileSync(file, 'utf8'),
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
  // whole-branch review Minor #6: a missing git binary is a different defect
  // from "not a checkout" and must say so, not be folded into that message.
  test('refuses with a distinct message when git itself is not installed (ENOENT)', () => {
    const git = () => { const e = new Error('spawn git ENOENT'); e.code = 'ENOENT'; throw e; };
    expect(ownerGate({ isTTY: true, git })).toBe('git is not installed or not on PATH — owner mode needs it');
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
  // whole-branch review Minor #7: the docblock promises "openrouter first",
  // but without seeding it that was only true because every pin HAPPENS to
  // list openrouter first in its own JSON key order today — a pin whose own
  // key order lists another provider first must not change the OUTPUT order.
  test('openrouter is always first, even when the first pin lists another provider first in its own key order', () => {
    const pins = { gemini: { routes: { google: 'google/gemini-3.6-flash', openrouter: 'openrouter/google/gemini-3.6-flash' }, verifiedOn: '2026-08-04' } };
    expect(Object.keys(routesByProvider(pins))[0]).toBe('openrouter');
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
    h.deps.readCuratedPinsBytes = jest.fn();
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.err()).toMatch(/^ERR:Error: aliases --review --owner is interactive/);
    expect(h.deps.readCuratedPinsBytes).not.toHaveBeenCalled();
    expect(h.out()).toBe('');
  });

  test('no catalog: refuses with the models --refresh hint, exit 1, no write', async () => {
    h = harness({ catalog: EMPTY_CATALOG });
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('no catalog — cannot review');
    expect(h.log).not.toContain('SAVE');
  });

  // Review residual: `harness()` always injects `ask`, so `d.ask ? null :
  // d.createPrompt()` never calls createPrompt regardless of WHERE the guard
  // sits -- `not.toHaveBeenCalled()` was vacuous (a scratch mutant moving
  // prompt creation earlier still passed it, since `ask` truthy short-
  // circuits the call either way). Deleting `ask` and stubbing `createPrompt`
  // to a real ask/close pair makes the assertion load-bearing: it only stays
  // green if the guard truly returns before that line is ever reached.
  // G1 (#238 council r2 A2) retires the old "throwing loadCuratedPins" test:
  // that dependency is no longer called at all, so injecting a throwing one
  // would be vacuous. The two failure modes now live INSIDE the same guarded
  // read -- a malformed JSON.parse and a validateCuratedPins defect -- get
  // their own tests instead.
  test('G1: malformed bytes from readCuratedPinsBytes (JSON.parse failure) is a named error on stderr, exit 1, no write, no prompt', async () => {
    h = harness({ catalog: EMPTY_CATALOG }); // never reached
    h.deps.readCuratedPinsBytes = () => '{not valid json';
    delete h.deps.ask;
    h.deps.createPrompt = jest.fn(() => ({ ask: async () => '3', close: jest.fn() }));
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.err()).toMatch(/^ERR:Error: /);
    expect(h.out()).toBe('');
    expect(h.log).not.toContain('SAVE');
    expect(h.deps.createPrompt).not.toHaveBeenCalled();
  });
  test('G1: an invalid document (fails validateCuratedPins) from readCuratedPinsBytes is a named error on stderr, exit 1, no write, no prompt', async () => {
    h = harness({ catalog: EMPTY_CATALOG });
    h.deps.readCuratedPinsBytes = () => JSON.stringify({ ...DOC, version: 2 });
    delete h.deps.ask;
    h.deps.createPrompt = jest.fn(() => ({ ask: async () => '3', close: jest.fn() }));
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.err()).toContain('ERR:Error: curated-pins.json: unsupported version 2 (expected 1)');
    expect(h.out()).toBe('');
    expect(h.log).not.toContain('SAVE');
    expect(h.deps.createPrompt).not.toHaveBeenCalled();
  });

  test('F3 (#238 council r1 C1): a throwing getCatalogInfo is a named error on stderr, exit 1, no write, no prompt', async () => {
    h = harness({ catalog: EMPTY_CATALOG });
    h.deps.getCatalogInfo = async () => { throw new Error('ETIMEDOUT'); };
    delete h.deps.ask;
    h.deps.createPrompt = jest.fn(() => ({ ask: async () => '3', close: jest.fn() }));
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.err()).toContain('ERR:Error: catalog unavailable (ETIMEDOUT) — run amicus models --refresh');
    expect(h.log).not.toContain('SAVE');
    expect(h.deps.createPrompt).not.toHaveBeenCalled();
  });

  // Review residual, item 1: `state.diskBytes = d.readCuratedPinsBytes()`
  // used to sit AFTER the load's try/catch, unguarded -- a throw there
  // escaped uncaught. Moved inside the same try; this is its test.
  test('F3 residual: a throwing readCuratedPinsBytes is a named error on stderr, exit 1, no write, no prompt', async () => {
    h = harness({ catalog: EMPTY_CATALOG });
    h.deps.readCuratedPinsBytes = () => { throw new Error('EACCES: permission denied'); };
    delete h.deps.ask;
    h.deps.createPrompt = jest.fn(() => ({ ask: async () => '3', close: jest.fn() }));
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.err()).toContain('ERR:Error: EACCES: permission denied');
    expect(h.out()).toBe('');
    expect(h.log).not.toContain('SAVE');
    expect(h.deps.createPrompt).not.toHaveBeenCalled();
  });

  test('F11 (#238 council r1 C4): every namespace lacking catalog coverage exits 1 with its own line, nothing written', async () => {
    // every DOC route present, but ONLY as a floor row (authoritative: false)
    // -- namespaceGap reads that as "no authoritative rows" for every namespace,
    // so nothing is ever reviewable.
    const catalog = { models: docRouteIds().map(id => ({ id, authoritative: false })), fetchedAt: Date.now(), lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [] };
    h = harness({ catalog });
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    const out = h.out();
    expect(out).toContain('openrouter routes (6): no authoritative rows in the catalog (no key?) — not reviewed');
    expect(out).toContain('nothing could be reviewed — no namespace had catalog coverage (keys? fetch failures above)');
    expect(out).not.toContain('no pin changed'); // F11 exits before the ordinary closing summary
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
    // F10 (#238 council r1 B6): owner rows are all `pinned`, never `following`
    // -- "1 pin, all up to date." replaces the misleading user-mode wording.
    expect(out).toContain('Nothing to review — 1 pin, all up to date.'); // the google route is live
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

  // G4 (#238 council r2 A5): askRulings' alias line used to print the alias
  // raw -- the only alias render site that skipped safeFragment. A genuinely
  // hostile alias is refused at load now (G3), so prove the safeFragment call
  // a different way: an alias past the 96-char fragment cap renders
  // truncated with a trailing ellipsis.
  test('G4: askRulings\' alias line rides safeFragment (a 100-char alias renders truncated with a trailing ellipsis)', async () => {
    const longAlias = 'a'.repeat(100); // valid under G3's NAME_RE, but past safeFragment's 96-char cap
    const doc = { version: 1, pins: { [longAlias]: { routes: { openrouter: 'openrouter/z-ai/glm-5.3' }, verifiedOn: '2026-08-04' } }, retired: {}, notable: [] };
    const catalog = { models: [{ id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }], fetchedAt: Date.now(), lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [] };
    h = harness({ catalog, doc, answers: ['1', ''] }); // accept the sibling; ruling: enter
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain(`  ${'a'.repeat(95)}… → `);
    expect(h.out()).not.toContain('a'.repeat(96));
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

  // G1 (#238 council r2 A2): the CAS baseline and the in-memory doc used to
  // come from DIFFERENT reads -- state.doc from d.loadCuratedPins() (the
  // require-cached SHIPPED, parsed at process boot) and state.diskBytes from
  // a fresh disk read. An edit landing between boot and the baseline read was
  // adopted as the baseline while missing from the doc, so the session's
  // first accept silently reverted it with NO CAS mismatch. Now there is one
  // read for both, and loadCuratedPins is not called at all.
  test('G1: the CAS baseline and the in-memory doc come from the SAME read — a stale loadCuratedPins is never consulted (mutant SKEW)', async () => {
    const freshDoc = JSON.parse(JSON.stringify(DOC));
    freshDoc.pins.glm.routes.openrouter = 'openrouter/z-ai/glm-5.9'; // "an edit landed between boot and the baseline read"
    const catalog = {
      // every OTHER route from freshDoc is live (no proposals elsewhere), plus glm's own fresh route and a genuinely newer sibling
      models: [
        ...Object.entries(freshDoc.pins).filter(([a]) => a !== 'glm').flatMap(([, p]) => Object.values(p.routes)).map(id => ({ id })),
        { id: 'openrouter/z-ai/glm-5.9' },
        { id: 'openrouter/z-ai/glm-6.0' },
      ],
      fetchedAt: Date.now(), lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [],
    };
    h = harness({ catalog, doc: freshDoc, answers: ['1', ''] }); // the temp file is seeded with freshDoc -- the edit already landed on disk
    h.deps.loadCuratedPins = jest.fn(() => DOC); // the STALE doc a pre-fix loadCuratedPins would have returned (glm still at 5.3)
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('currently  openrouter/z-ai/glm-5.9      (pinned)'); // the walk's proposal reflects the FRESH bytes, not the stale 5.3
    const onDisk = h.read();
    expect(onDisk.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-6.0'); // the accept wrote on top of the fresh baseline -- the stale 5.3 is nowhere in the file
    expect(h.deps.loadCuratedPins).not.toHaveBeenCalled();
  });

  // Review residual, item 3: a CAS refusal used to still close with "no pin
  // changed -- untouched" and exit 0, which is FALSE (the file WAS changed,
  // externally) and indistinguishable from a genuine no-op session. Both
  // tests below now assert the dedicated restart notice and exit 1 instead.
  test('F1(a) (#238 council r1 B1): a mid-walk external edit refuses the accept with a CAS message, the file keeps the edit, and the session exits 1 with a restart notice, never "no pin changed" (mutant NOCAS)', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog });
    let calls = 0;
    h.deps.ask = async () => {
      calls += 1;
      if (calls === 1) {
        // simulate a concurrent session or a hand edit landing on disk between
        // this session's load and its first write attempt
        const external = JSON.parse(fs.readFileSync(h.file, 'utf8'));
        external.pins.glm.verifiedOn = '2099-01-01';
        fs.writeFileSync(h.file, JSON.stringify(external, null, 2) + '\n');
        return '1'; // accept -- but the disk now disagrees with what this session loaded
      }
      return '3'; // skip, once the accept is refused and the menu redisplays
    };
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('could not write: curated-pins.json changed on disk since this session loaded it — restart the review to pick up the change (nothing was written)');
    const onDisk = h.read();
    expect(onDisk.pins.glm.verifiedOn).toBe('2099-01-01'); // the external edit survives, untouched
    expect(onDisk.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.3'); // the refused accept never landed
    expect(h.out()).toContain('curated-pins.json changed on disk during this session — nothing from this session was written after that point; restart the review');
    expect(h.out()).not.toContain('no pin changed');
    expect(h.log).not.toContain('SAVE');
  });

  test('F1(c) (#238 council r1 B1): the rulings phase refuses a write the same way when the file changed after the walk, exits 1 with the restart notice instead of "N pin(s) changed" (mutant NOCAS)', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog });
    let calls = 0;
    h.deps.ask = async () => {
      calls += 1;
      if (calls === 1) { return '1'; } // walk: accept glm-5.4 -- this DOES land, its own commit runs first
      // something else writes the file between the walk's own commit and the rulings prompt
      const external = JSON.parse(fs.readFileSync(h.file, 'utf8'));
      external.pins.grok.verifiedOn = '2099-01-01';
      fs.writeFileSync(h.file, JSON.stringify(external, null, 2) + '\n');
      return 'terra tier confirmed live 2026-09-20'; // the ruling answer for glm
    };
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('    could not write: curated-pins.json changed on disk since this session loaded it — restart the review to pick up the change (nothing was written)');
    const onDisk = h.read();
    expect(onDisk.pins.grok.verifiedOn).toBe('2099-01-01'); // the external edit survives, untouched
    expect(onDisk.pins.glm.ruling).toBe('why glm'); // the ruling write never landed
    expect(onDisk.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.4'); // the walk's own accept DID land before the external edit
    expect(h.out()).toContain('curated-pins.json changed on disk during this session — nothing from this session was written after that point; restart the review');
    expect(h.out()).not.toContain('pin changed — review with');
  });

  // G2(a) (#238 council r2 A4/B2): casRefused is STICKY -- the disk will
  // never re-match this session's baseline again, so a CAS refusal during
  // the FIRST ruling must stop the loop before ever asking for the second
  // (every remaining ruling is guaranteed to fail and discard typed text).
  test('G2(a): a CAS refusal during the first ruling stops askRulings before asking for the second (no break -> mutant)', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'openrouter/x-ai/grok-4.4'] });
    h = harness({ catalog });
    let calls = 0;
    h.deps.ask = async () => {
      calls += 1;
      if (calls === 1) { return '1'; } // walk: accept glm-5.4
      if (calls === 2) { return '1'; } // walk: accept grok-4.4
      if (calls === 3) {
        // an external edit lands right as the FIRST ruling (glm, touched first) is being answered
        const external = JSON.parse(fs.readFileSync(h.file, 'utf8'));
        external.pins.deepseek.verifiedOn = '2099-01-01';
        fs.writeFileSync(h.file, JSON.stringify(external, null, 2) + '\n');
        return 'glm ruling text';
      }
      return 'SECOND RULING SHOULD NEVER BE ASKED'; // grok's ruling, if the break is missing
    };
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(calls).toBe(3); // the second ruling (grok) was never asked
    expect(h.out()).toContain('    could not write: curated-pins.json changed on disk since this session loaded it — restart the review to pick up the change (nothing was written)');
    expect(h.out()).toContain('curated-pins.json changed on disk during this session — nothing from this session was written after that point; restart the review');
    const onDisk = h.read();
    expect(onDisk.pins.deepseek.verifiedOn).toBe('2099-01-01'); // the external edit survives, untouched
    expect(onDisk.pins.glm.ruling).toBe('why glm'); // glm's own ruling write never landed either
  });

  // G2(b) (#238 council r2 A4/B2): a CAS refusal during the WALK must also
  // end the session immediately -- the very next ask() aborts through the
  // picker's own REVIEW_ABORTED path rather than re-showing the menu for a
  // second (guaranteed-doomed) answer.
  test('G2(b): a CAS refusal on the first accept aborts the walk immediately — the menu is not re-shown for a second answer', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'openrouter/x-ai/grok-4.4'] });
    h = harness({ catalog });
    let calls = 0;
    h.deps.ask = async () => {
      calls += 1;
      if (calls === 1) {
        // an external edit lands right as the FIRST proposal (glm) is being accepted
        const external = JSON.parse(fs.readFileSync(h.file, 'utf8'));
        external.pins.deepseek.verifiedOn = '2099-01-01';
        fs.writeFileSync(h.file, JSON.stringify(external, null, 2) + '\n');
        return '1'; // accept -- but the disk now disagrees
      }
      // A non-numeric answer would otherwise loop forever re-prompting "choose
      // 1-N" (reviewOne's own for(;;)) -- throw instead, so a missing abort
      // fails this test cleanly (a rejected runOwnerReview) rather than
      // hanging/OOMing the run.
      throw new Error('ask() called a second time -- the CAS-refusal abort did not fire');
    };
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    // Only ONE real ask() call ever happens: the wrapper in passDeps checks
    // state.casRefused BEFORE delegating to the real ask, so the very next
    // prompt aborts WITHOUT ever reaching this mock a second time.
    expect(calls).toBe(1);
    expect(h.out()).toContain('could not write: curated-pins.json changed on disk since this session loaded it — restart the review to pick up the change (nothing was written)');
    expect(h.out()).toContain('review interrupted — 0 accepted, 0 skipped, 0 dismissed so far'); // the picker's own REVIEW_ABORTED tally
    expect(h.out()).toContain('curated-pins.json changed on disk during this session — nothing from this session was written after that point; restart the review');
    const onDisk = h.read();
    expect(onDisk.pins.deepseek.verifiedOn).toBe('2099-01-01'); // the external edit survives, untouched
    expect(onDisk.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.3'); // the refused accept never landed
    expect(onDisk.pins.grok.routes.openrouter).toBe('openrouter/x-ai/grok-4.3'); // grok's own pass never even started
    expect(h.log).not.toContain('SAVE');
  });

  test('Ctrl-C mid-walk: tally, exit 1, no ruling prompts, summary still prints', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'openrouter/x-ai/grok-4.4'] });
    h = harness({ catalog });
    h.deps.ask = (() => { const q = ['1']; return async () => { if (q.length) { return q.shift(); } throw aborted(); }; })(); // glm accepted, then Ctrl-C on grok's menu
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('review interrupted — 1 accepted, 0 skipped, 0 dismissed so far');
    // whole-branch review Minor #4: the `!== 0` branch prints its own line
    // before breaking out of the namespace loop (the REVIEW_ABORTED tally
    // above is the picker's own; this one covers any other non-zero return).
    expect(h.out()).toContain('  pass ended early — rulings skipped');
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

  // whole-branch review Minor #3: the comparator's dash-version limit means
  // the anthropic pass can never propose the matching move for a sibling
  // accepted on openrouter (the smoke's `fable → claude-fable-5.1` on
  // openrouter only is the live case) — opus (openrouter + anthropic) is
  // DOC's own divergent-vendor pin.
  test('a touched alias whose pin also has an untouched divergent-vendor route gets an ℹ notice to verify by hand', async () => {
    const catalog = catalogWith({ extra: ['openrouter/anthropic/claude-opus-5.1'] });
    h = harness({ catalog, answers: ['1', ''] }); // openrouter pass: opus -> accept 5.1; anthropic pass: nothing; ruling: enter
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('  ℹ opus: anthropic route anthropic/claude-opus-5 not compared (divergent vendor) — verify it by hand');
  });
  test('a touched alias with no divergent-vendor route at all gets no ℹ notice', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog, answers: ['1', ''] }); // accept glm-5.4; ruling: enter
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).not.toContain('not compared (divergent vendor)');
  });

  // F4 (#238 council r1 D1 test gap; mechanism held -- the prompt can only
  // ever throw REVIEW_ABORTED, see aliases-review-prompt.js :: abortedError):
  // an interruption AFTER a successful walk accept, at the ruling prompt
  // itself, was untested. Same setup as the ℹ-notice test above (opus is
  // DOC's own divergent-vendor pin), so the routes-disagree/ℹ summary has
  // something concrete to print through the interruption.
  test('F4: an interrupted rulings phase after a successful accept still prints the ℹ summary and the closing line, exit 1', async () => {
    const catalog = catalogWith({ extra: ['openrouter/anthropic/claude-opus-5.1'] });
    h = harness({ catalog });
    let calls = 0;
    h.deps.ask = async () => {
      calls += 1;
      if (calls === 1) { return '1'; } // openrouter pass: opus -> accept 5.1
      throw aborted(); // Ctrl-C/EOF at the ruling prompt
    };
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('rulings interrupted — edit them by hand');
    expect(h.out()).toContain('  ℹ opus: anthropic route anthropic/claude-opus-5 not compared (divergent vendor) — verify it by hand');
    expect(h.out()).toContain('1 pin changed — review with: git diff src/utils/curated-pins.json');
    expect(h.read().pins.opus.routes.openrouter).toBe('openrouter/anthropic/claude-opus-5.1'); // the walk's own accept still landed
  });
});

describe('ownerView (#238 council r1 F9 — the picker view contract)', () => {
  const { ownerView } = require('../../src/sidecar/aliases-owner');
  test('catalogAvailable reflects the catalog actually given (not hardcoded), and retired carries the document\'s retired map', () => {
    const doc = { ...DOC, retired: { devstral: { on: '2026-08-04', ruling: 'gone' } } };
    const d = { buildAliasProposals: () => [] };
    const withModels = ownerView({}, { models: [{ id: 'x/y' }] }, doc, d);
    expect(withModels.catalogAvailable).toBe(true);
    expect(withModels.retired).toEqual({ devstral: { on: '2026-08-04', ruling: 'gone' } });
    expect(ownerView({}, { models: [] }, doc, d).catalogAvailable).toBe(false);
    expect(ownerView({}, {}, doc, d).catalogAvailable).toBe(false);
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
