// tests/sidecar/aliases-review.test.js
'use strict';

const DAY = 24 * 60 * 60 * 1000;

// R3 (#249 r2 C4) hostile-fragment fixtures. Built with String.fromCharCode
// so this SOURCE FILE never carries a raw control/bidi byte itself -- only
// the runtime string value carries the ESC/RLO codepoint.
const HOSTILE_ESC = String.fromCharCode(0x1b);
const HOSTILE_RLO = String.fromCharCode(0x202e); // right-to-left override
const HOSTILE_ALIAS = `${HOSTILE_ESC}[31mred${HOSTILE_ESC}[0m`;
const HOSTILE_ID = `openrouter/x/${HOSTILE_RLO}evil\nNotice: forged`;

function makeDeps({ proposals, rows = [], fetchedAt = Date.now(), answers = [], models = [], providerFailures = [], readCache } = {}) {
  const out = [];
  const err = [];
  const writes = { addAlias: [], removeAlias: [], recordDismissal: [] };
  const calls = { collectAliasView: [] };
  const queue = [...answers];
  return {
    deps: {
      isTTY: true,
      write: (s) => out.push(String(s)),
      ask: async () => { if (queue.length === 0) { throw new Error('no more scripted answers'); } return queue.shift(); },
      collectAliasView: async (opts) => { calls.collectAliasView.push(opts); return { rows, proposals, catalogInfo: { models, fetchedAt, providerFailures }, catalogAvailable: models.length > 0 }; },
      renderAliasList: () => 'LIST\n',
      addAlias: (a, id) => writes.addAlias.push([a, id]),
      removeAlias: (a) => { writes.removeAlias.push(a); return true; },
      recordDismissal: (k) => writes.recordDismissal.push(k),
      effectiveAliasNames: () => new Set(rows.map(r => r.alias)),
      stderr: (s) => err.push(String(s)),
      ...(readCache ? { readCache } : {}),
    },
    out: () => out.join(''), err: () => err.join(''), writes, calls,
  };
}

const glm = {
  alias: 'glm', state: 'pinned', current: 'openrouter/z-ai/glm-5.2', shipped: 'openrouter/z-ai/glm-5.3', curated: true,
  reasons: ['newer-sibling', 'differs-from-shipped'],
  candidates: [{ id: 'openrouter/z-ai/glm-5.4', why: 'newer-sibling', evidence: {} }, { id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }],
  dismissKey: 'glm@openrouter/z-ai/glm-5.4',
};
const atlas = {
  alias: 'atlas', state: 'unmapped', current: null, shipped: null, curated: false, reasons: ['notable-unmapped'],
  candidates: [{ id: 'openrouter/newco/atlas-1', why: 'notable', evidence: { note: 'new frontier entrant' } }],
  dismissKey: 'atlas@openrouter/newco/atlas-1',
};

describe('aliases --review (#238 §4, Q2, Q4)', () => {
  let runReview;
  beforeEach(() => { jest.resetModules(); ({ runReview } = require('../../src/sidecar/aliases-review')); });

  test('Q2: without a TTY it prints the list, one reason line on stderr, exit 1, writes nothing', async () => {
    const t = makeDeps({ proposals: [glm], models: [{ id: 'x/y' }] });
    t.deps.isTTY = false;
    expect(await runReview({}, t.deps)).toBe(1);
    expect(t.out()).toBe('LIST\n');
    expect(t.err()).toContain('aliases --review is interactive');
    expect(t.writes.addAlias).toEqual([]);
  });
  test('nothing to review exits 0 with a sentence', async () => {
    const t = makeDeps({ proposals: [], rows: [{ alias: 'gemini' }], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('Nothing to review');
  });
  test('accept [1] pins the sibling; the screen shows current, shipped, proposed and a numbered menu', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toMatch(/\[1\/1\] glm/);
    // Minor: "(pinned by you)" -> "(pinned)" -- every proposal here is
    // necessarily the user's own pin (D1: a following alias never proposes).
    expect(t.out()).toContain('currently  openrouter/z-ai/glm-5.2      (pinned)');
    expect(t.out()).not.toContain('pinned by you');
    expect(t.out()).toContain('shipped    openrouter/z-ai/glm-5.3');
    expect(t.out()).toContain('[1] accept openrouter/z-ai/glm-5.4');
    expect(t.out()).toContain('[2] follow the shipped pin (openrouter/z-ai/glm-5.3)');
    expect(t.out()).toContain('[3] choose another');
    expect(t.writes.addAlias).toEqual([['glm', 'openrouter/z-ai/glm-5.4']]);
    expect(t.out()).toContain('✓ glm → openrouter/z-ai/glm-5.4 (pinned)');
    expect(t.out()).toContain('Reviewed 1 proposal: 1 accepted, 0 skipped, 0 dismissed.');
  });
  test('follow [2] removes the key (Q4: the encoding decides the state)', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['2'], models: [{ id: 'x/y' }] });
    await runReview({}, t.deps);
    expect(t.writes.removeAlias).toEqual(['glm']);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('✓ glm now follows the shipped recommendation (openrouter/z-ai/glm-5.3)');
  });
  test('choose another [3] validates against the catalog and pins; blank cancels back to the menu', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'nope', 'openrouter/z-ai/glm-5.9', 'openrouter/z-ai/glm-5.4'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    await runReview({}, t.deps);
    expect(t.out()).toContain('not in the catalog');
    expect(t.writes.addAlias).toEqual([['glm', 'openrouter/z-ai/glm-5.4']]);
  });
  test('skip [4] writes nothing; never ask again [5] records the dismissKey', async () => {
    const t = makeDeps({ proposals: [glm, { ...glm, alias: 'glm2', dismissKey: 'glm2@openrouter/z-ai/glm-5.4' }], answers: ['4', '5'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.recordDismissal).toEqual(['glm2@openrouter/z-ai/glm-5.4']);
    expect(t.out()).toContain('Reviewed 2 proposals: 0 accepted, 1 skipped, 1 dismissed.');
  });
  test('an invalid answer re-prompts', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['9', 'x', '4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect((t.out().match(/choose 1-5/g) || []).length).toBe(2);
  });
  test('§5 write gate: a stale catalog shows proposals but refuses accept and choose; follow still works', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '2'], fetchedAt: Date.now() - 3 * DAY, models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('catalog is 3 days old and could not be refreshed');
    expect(t.out()).toContain('cannot accept: the catalog is not fresh');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual(['glm']);
  });
  test('notable accept adds the alias, suffixing -2 when the suggested name is already taken (M4)', async () => {
    const t = makeDeps({ proposals: [atlas], rows: [{ alias: 'atlas', id: 'x/z' }], answers: ['1'], models: [{ id: 'openrouter/newco/atlas-1' }] });
    await runReview({}, t.deps);
    expect(t.writes.addAlias).toEqual([['atlas-2', 'openrouter/newco/atlas-1']]);
    expect(t.out()).toContain('[1] add atlas → openrouter/newco/atlas-1');
    expect(t.out()).toContain('✓ atlas-2 → openrouter/newco/atlas-1 (pinned)');
  });

  test('R3: a future fetchedAt (clock skew) never reads as fresh — its own banner, never a bogus negative-age label; accept refused, follow still works', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '2'], fetchedAt: Date.now() + 3 * DAY, models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('catalog timestamp is in the future (clock skew?) — proposals are shown, but accepting is disabled until `amicus models --refresh` succeeds');
    expect(t.out()).not.toContain('days old');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual(['glm']);
  });

  test('IMPORTANT 1: no cache at all (fetchedAt: null) shows the no-cache banner, never a bogus day count; follow still works, accept refused', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '2'], fetchedAt: null, models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('no catalog cache and it could not be fetched');
    expect(t.out()).not.toContain('days old');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual(['glm']);
  });

  test('IMPORTANT 2a: a stale catalog also gates "choose another" — a catalog-valid id is still refused, not pinned', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.4', '4'], fetchedAt: Date.now() - 3 * DAY, models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('cannot accept: the catalog is not fresh');
  });

  test('IMPORTANT 2b: collectAliasView is called with { maxAgeMs: Infinity } off a TTY and {} on a TTY', async () => {
    const t1 = makeDeps({ proposals: [], rows: [], models: [] });
    t1.deps.isTTY = false;
    await runReview({}, t1.deps);
    expect(t1.calls.collectAliasView).toEqual([{ maxAgeMs: Number.POSITIVE_INFINITY }]);

    const t2 = makeDeps({ proposals: [], rows: [{ alias: 'gemini' }], models: [{ id: 'x/y' }] });
    await runReview({}, t2.deps);
    expect(t2.calls.collectAliasView).toEqual([{}]);
  });

  test('IMPORTANT 2c: a blank answer to "choose another" cancels back to the menu with no write', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', '', '4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('Reviewed 1 proposal: 0 accepted, 1 skipped, 0 dismissed.');
  });

  test('M1: an aborted ask (Ctrl-C/D mid-prompt) does not exit silently — it interrupts with a running summary and exit 1', async () => {
    const t = makeDeps({ proposals: [glm, { ...glm, alias: 'glm2', dismissKey: 'glm2@x' }], models: [{ id: 'x/y' }] });
    let calls = 0;
    t.deps.ask = async () => {
      calls += 1;
      if (calls === 2) { const e = new Error('aborted'); e.code = 'REVIEW_ABORTED'; throw e; }
      return '4';
    };
    expect(await runReview({}, t.deps)).toBe(1);
    expect(t.out()).toContain('review interrupted — 0 accepted, 1 skipped, 0 dismissed so far');
  });

  test('M2: a throwing write does not abort the review — it reports and re-shows the menu, then continues', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '4'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    t.deps.addAlias = () => { throw new Error('disk full'); };
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('could not write: disk full');
    expect(t.out()).toContain('Reviewed 1 proposal: 0 accepted, 1 skipped, 0 dismissed.');
  });

  test('F3: a candidate-less stale proposal explains why, instead of showing no reason at all', async () => {
    const ghost = {
      alias: 'ghost', state: 'pinned', current: 'openrouter/nobody/thing-1', shipped: null, curated: false,
      reasons: ['stale'], candidates: [], dismissKey: 'ghost@openrouter/nobody/thing-1',
    };
    const t = makeDeps({ proposals: [ghost], answers: ['2'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('stale      current id is gone from the catalog — no same-vendor replacement found');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('Reviewed 1 proposal: 0 accepted, 1 skipped, 0 dismissed.');
  });

  test('Minor: a stale readCache() prints "refreshing catalog (N days old)…" once, before the picker itself refreshes', async () => {
    const t = makeDeps({
      proposals: [glm], answers: ['4'], models: [{ id: 'x/y' }],
      readCache: () => ({ fetchedAt: Date.now() - 3 * DAY }),
    });
    expect(await runReview({}, t.deps)).toBe(0);
    expect((t.out().match(/refreshing catalog \(3 days old\)…/g) || []).length).toBe(1);
  });

  test('Minor: readCache omitted (a fully-mocked deps object) never throws and prints no refresh banner', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).not.toContain('refreshing catalog');
  });

  // R7 (#249 r1 D3): a throwing readCache (disk error, corrupt cache) must
  // not crash the review over a best-effort banner -- no banner, continue.
  test('R7: a throwing readCache() prints no banner and the review proceeds normally', async () => {
    const t = makeDeps({
      proposals: [glm], answers: ['4'], models: [{ id: 'x/y' }],
      readCache: () => { throw new Error('ENOENT: corrupt cache'); },
    });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).not.toContain('refreshing catalog');
    expect(t.out()).toContain('Reviewed 1 proposal: 0 accepted, 1 skipped, 0 dismissed.');
  });

  test('F1: no catalog at all refuses to review before "Nothing to review", exit 1, no writes', async () => {
    const t = makeDeps({ proposals: [], rows: [], models: [] });
    expect(await runReview({}, t.deps)).toBe(1);
    expect(t.out()).toContain('no catalog — cannot review; run amicus models --refresh');
    expect(t.out()).not.toContain('Nothing to review');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual([]);
    expect(t.writes.recordDismissal).toEqual([]);
  });

  test('R2: a typed floor-row id (authoritative: false) is refused — in the catalog but not verified — and never pins', async () => {
    const t = makeDeps({
      proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.9', '', '4'],
      models: [{ id: 'openrouter/z-ai/glm-5.9', authoritative: false }, { id: 'x/y' }],
    });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('openrouter/z-ai/glm-5.9 is in the catalog but was not verified this run (floor row or rejected provider) — refresh and try again');
    expect(t.writes.addAlias).toEqual([]);
  });
  test('R2: a typed id from a rejected namespace is refused the same way', async () => {
    const t = makeDeps({
      proposals: [glm], answers: ['3', 'google/gemini-9.9-flash', '', '4'],
      models: [{ id: 'google/gemini-9.9-flash' }, { id: 'x/y' }],
      providerFailures: [{ provider: 'google', reason: 'http-status', status: 401 }],
    });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('google/gemini-9.9-flash is in the catalog but was not verified this run (floor row or rejected provider) — refresh and try again');
    expect(t.writes.addAlias).toEqual([]);
  });
  test('R2: a gated (verified) typed id still pins normally', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.4'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([['glm', 'openrouter/z-ai/glm-5.4']]);
  });

  test('M3: "choose another" typed with the shipped id follows, never pins a redundant copy', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.3'], models: [{ id: 'openrouter/z-ai/glm-5.3' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.removeAlias).toEqual(['glm']);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('✓ glm now follows the shipped recommendation (openrouter/z-ai/glm-5.3)');
  });

  // R1 (#249 r2 A1/C2): typing the shipped id IS the menu's `follow` action,
  // exempt from BOTH the §5 display gate and the freshness gate -- it
  // removes a key rather than writing a catalog-vouched one. Mutant
  // GATEFIRST (restore the old classify-then-fresh-then-follow order in
  // `chooseAnother`) turns (a) and (c) red: (a) because the stale-catalog
  // refusal would fire before `follows` is ever checked, (c) because
  // `classifyTypedId` would call the shipped id "unknown" first.
  test('R1(a): a STALE catalog — choose another, type the shipped id — still follows, no addAlias', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.3'], fetchedAt: Date.now() - 3 * DAY, models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.removeAlias).toEqual(['glm']);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('✓ glm now follows the shipped recommendation (openrouter/z-ai/glm-5.3)');
  });

  test('R1(b): same stale catalog — a gated NON-shipped id is still refused (the fresh gate still binds a real pin)', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.4', '4'], fetchedAt: Date.now() - 3 * DAY, models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('cannot accept: the catalog is not fresh');
    expect(t.writes.addAlias).toEqual([]);
  });

  test('R1(c): a FRESH catalog that does not carry the shipped id at all — typing it still follows, never "not in the catalog"', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'openrouter/z-ai/glm-5.3'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.removeAlias).toEqual(['glm']);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).not.toContain('not in the catalog');
    expect(t.out()).toContain('✓ glm now follows the shipped recommendation (openrouter/z-ai/glm-5.3)');
  });

  // R3 (#249 r2 C4): a hostile alias name/id must never reach the terminal
  // raw -- ANSI/bidi controls dropped, and the smuggled '\n' must never
  // forge a second, independent line (the attack `alias-shadow.js` names).
  // Mutant RAWFRAG (drop the `safeFragment` call in `renderScreen`) turns
  // this test red.
  test('R3: renderScreen + menuFor sanitize a hostile alias, id and catalog note in a proposal', async () => {
    const hostile = {
      alias: HOSTILE_ALIAS, state: 'unmapped', current: null, shipped: null, curated: false,
      reasons: ['notable-unmapped'],
      candidates: [{ id: HOSTILE_ID, why: 'notable', evidence: { note: HOSTILE_ID } }],
      dismissKey: `x@${HOSTILE_ID}`,
    };
    const t = makeDeps({ proposals: [hostile], answers: ['4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    const out = t.out();
    expect(out).not.toContain(HOSTILE_ESC);
    expect(out).not.toContain(HOSTILE_RLO);
    expect(out).not.toMatch(/^Notice: forged/m);
    expect(out).toContain('red');
    expect(out).toContain('evil');
  });

  test('R3: "choose another" sanitizes a hostile typed id that is not in the catalog (notInCatalogLine)', async () => {
    // Unlike a "not fresh" refusal, an 'unknown' classification does not
    // return to the outer menu -- it re-prompts inside chooseAnother, so a
    // blank answer is needed to cancel back before the next menu digit.
    const t = makeDeps({ proposals: [glm], answers: ['3', HOSTILE_ID, '', '4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    const out = t.out();
    expect(out).not.toContain(HOSTILE_RLO);
    expect(out).not.toMatch(/^Notice: forged/m);
    expect(out).toContain('not in the catalog');
    expect(out).toContain('evil');
  });

  test('R3: chooseAnother\'s ✓ line sanitizes a hostile alias and a hostile typed id when pinning', async () => {
    const hostile = {
      alias: HOSTILE_ALIAS, state: 'unmapped', current: null, shipped: null, curated: false,
      reasons: ['notable-unmapped'],
      candidates: [{ id: 'openrouter/x/y', why: 'notable', evidence: {} }],
      dismissKey: 'x@openrouter/x/y',
    };
    // menu: [1] add <alias> -> openrouter/x/y, [2] choose another, [3] skip, [4] never ask again
    const t = makeDeps({ proposals: [hostile], answers: ['2', HOSTILE_ID], models: [{ id: HOSTILE_ID }] });
    expect(await runReview({}, t.deps)).toBe(0);
    const out = t.out();
    expect(out).not.toContain(HOSTILE_ESC);
    expect(out).not.toContain(HOSTILE_RLO);
    expect(out).not.toMatch(/^Notice: forged/m);
    expect(out).toContain('red');
    expect(out).toContain('evil');
    // the WRITE itself stays raw -- only the terminal line is sanitized.
    expect(t.writes.addAlias).toEqual([[HOSTILE_ALIAS, HOSTILE_ID]]);
  });

  // F5(a) (#249 r2 review): the committed R3 renderScreen test used
  // `current: null, curated: false`, so `safeFragment(p.current)` and
  // `safeFragment(p.shipped)` were never exercised -- p.current is the
  // config-PINNED id, the most common third-party fragment on this screen.
  test('F5(a): renderScreen sanitizes a hostile p.current, alongside a clean shipped line', async () => {
    const hostile = {
      alias: 'mine', state: 'pinned', current: HOSTILE_ID, shipped: 'openrouter/x/y', curated: true,
      reasons: ['differs-from-shipped'],
      candidates: [{ id: 'openrouter/x/y', why: 'follow', evidence: {} }],
      dismissKey: 'mine@openrouter/x/y',
    };
    // menu: [1] follow the shipped pin (openrouter/x/y), [2] choose another, [3] skip, [4] never ask again
    const t = makeDeps({ proposals: [hostile], answers: ['3'], models: [{ id: 'openrouter/x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    const out = t.out();
    expect(out).not.toContain(HOSTILE_ESC);
    expect(out).not.toContain(HOSTILE_RLO);
    expect(out).not.toMatch(/^Notice: forged/m);
    expect(out).toContain('currently');
    expect(out).toContain('shipped');
    expect(out).toContain('evil');
  });

  // F5(b) (#249 r2 review): notVerifiedLine had no hostile test at all --
  // dropping its safeFragment prints a raw RLO with no test going red.
  test('F5(b): notVerifiedLine sanitizes a hostile typed id present in the catalog but not verified', async () => {
    const t = makeDeps({
      proposals: [glm], answers: ['3', HOSTILE_ID, '', '4'],
      models: [{ id: HOSTILE_ID, authoritative: false }, { id: 'x/y' }],
    });
    expect(await runReview({}, t.deps)).toBe(0);
    const out = t.out();
    expect(out).not.toContain(HOSTILE_ESC);
    expect(out).not.toContain(HOSTILE_RLO);
    expect(out).not.toMatch(/^Notice: forged/m);
    expect(out).toContain('is in the catalog but was not verified');
    expect(out).toContain('evil');
    expect(t.writes.addAlias).toEqual([]);
  });

  test('"Nothing to review" names pins that name a RETIRED alias instead of calling them up to date (R-P2-11), and pluralizes 1 alias', async () => {
    const rows = [{ alias: 'devstral', id: 'openrouter/mistralai/devstral-medium', state: 'pinned', curated: false, shipped: null }];
    const t = makeDeps({ proposals: [], rows, models: [{ id: 'openrouter/z-ai/glm-5.3' }] });
    t.deps.collectAliasView = async () => ({ rows, proposals: [], catalogInfo: { models: [{ id: 'x/y' }], fetchedAt: Date.now(), providerFailures: [] }, catalogAvailable: true, retired: { devstral: { on: '2026-08-04', ruling: 'gone' } } });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('Nothing to review — 1 alias; 1 pin names a retired alias (see amicus aliases), the rest follow or are up to date.');
  });
  test('"Nothing to review" without retired pins keeps the old sentence', async () => {
    const rows = [{ alias: 'gemini', id: 'google/gemini-3.6-flash', state: 'following', curated: true, shipped: 'google/gemini-3.6-flash' }, { alias: 'glm', id: 'openrouter/z-ai/glm-5.3', state: 'following', curated: true, shipped: 'openrouter/z-ai/glm-5.3' }];
    const t = makeDeps({ proposals: [], rows, models: [{ id: 'openrouter/z-ai/glm-5.3' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('Nothing to review — 2 aliases, all following or up to date.');
  });

  test('a proposal without a dismissKey offers no "never ask again" (owner mode, #238 Phase 2; mutant NODISMISS)', async () => {
    // `models` non-empty, or runReview refuses with "no catalog" before any menu renders
    const t = makeDeps({ proposals: [{ ...glm, dismissKey: null }], answers: ['4'], models: [{ id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }] }); // [1] accept [2] follow [3] choose another [4] skip
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).not.toContain('never ask again');
    expect(t.out()).toContain('[4] skip');
    expect(t.out()).not.toContain('[5]');
  });
});
