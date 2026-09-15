// tests/utils/alias-proposals.test.js
'use strict';
const { buildAliasProposals, gatedCatalogIds } = require('../../src/utils/alias-proposals');

const defaults = {
  __proto__: null,
  gemini: 'google/gemini-3.6-flash',
  glm: 'openrouter/z-ai/glm-5.3',
  gpt: 'openai/gpt-5.6-terra',
};
const row = (id, extra = {}) => ({ id, ...extra });
const CATALOG = [
  row('openrouter/google/gemini-3.6-flash'), row('google/gemini-3.6-flash'),
  row('openrouter/z-ai/glm-5.3'), row('openrouter/z-ai/glm-5.4'), row('openrouter/z-ai/glm-5.4:free'),
  row('openrouter/openai/gpt-5.6-terra'), row('openrouter/openai/gpt-5.6-sol'), row('openai/gpt-5.6-terra'),
  row('openrouter/mistralai/mistral-medium-3-5'),
];
const info = (models = CATALOG, providerFailures = []) => ({ models, providerFailures });
const run = (userAliases, opts = {}) => buildAliasProposals({ userAliases, defaults, catalogInfo: info(), ...opts });

describe('alias-proposals — one proposal per alias, pinned only (#238 D1/D7/§2)', () => {
  test('a following alias never proposes; an empty catalog proposes nothing', () => {
    expect(run({})).toEqual([]);
    expect(buildAliasProposals({ userAliases: { glm: 'openrouter/z-ai/glm-5.2' }, defaults, catalogInfo: info([]) })).toEqual([]);
    expect(buildAliasProposals({ userAliases: { glm: 'x/y-1' }, defaults, catalogInfo: null })).toEqual([]);
  });
  // Fix round 1, Finding 2 (Minor #4; rule 11 "never throws on odd input"): a
  // truthy non-array providerFailures (e.g. `{}`) must not reach `.map` and
  // must behave exactly as an empty one.
  test('a non-array providerFailures ({}) never throws and is treated as no failures', () => {
    expect(run({ glm: 'openrouter/z-ai/glm-5.4' }, { catalogInfo: { models: CATALOG, providerFailures: {} } }))
      .toEqual(run({ glm: 'openrouter/z-ai/glm-5.4' }));
  });
  test('pinned behind a newer sibling AND behind the shipped pin: ONE proposal, sibling first, follow second', () => {
    const [p, ...rest] = run({ glm: 'openrouter/z-ai/glm-5.2' }, { catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')]) });
    expect(rest).toEqual([]);
    expect(p.alias).toBe('glm');
    expect(p.state).toBe('pinned');
    expect(p.reasons).toEqual(['newer-sibling', 'differs-from-shipped']);
    expect(p.candidates.map(c => [c.id, c.why])).toEqual([
      ['openrouter/z-ai/glm-5.4', 'newer-sibling'],
      ['openrouter/z-ai/glm-5.3', 'follow'],
    ]);
    expect(p.dismissKey).toBe('glm@openrouter/z-ai/glm-5.4');
    expect(p.shipped).toBe('openrouter/z-ai/glm-5.3');
    expect(p.curated).toBe(true);
  });
  test('pinned AHEAD of the shipped pin with no newer sibling: follow is still offered (differs-from-shipped)', () => {
    const [p] = run({ glm: 'openrouter/z-ai/glm-5.4' });
    expect(p.reasons).toEqual(['differs-from-shipped']);
    expect(p.candidates).toEqual([{ id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }]);
    expect(p.dismissKey).toBe('glm@openrouter/z-ai/glm-5.3');
  });
  // Fix round 1, Finding 3 (Minor #2/#3 ruling): when the newest sibling IS
  // the shipped model, it is not listed twice as both "newer-sibling" and
  // "follow" — the follow entry alone covers it.
  test('a sibling that IS the shipped model is not listed twice: follow alone', () => {
    const [p] = run({ glm: 'openrouter/z-ai/glm-5.2' }, { catalogInfo: info([row('openrouter/z-ai/glm-5.2'), row('openrouter/z-ai/glm-5.3')]) });
    expect(p.candidates).toEqual([{ id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }]);
    expect(p.dismissKey).toBe('glm@openrouter/z-ai/glm-5.3');
    // F2: reasons must describe the CANDIDATES actually offered -- the sibling
    // was found, but it is not a distinct candidate (it's the same id as
    // `follow`), so 'newer-sibling' must not appear alongside it.
    expect(p.reasons).toEqual(['differs-from-shipped']);
  });
  test('same model under another gateway form is not a difference (alias-shadow rule)', () => {
    expect(run({ gemini: 'openrouter/google/gemini-3.6-flash' })).toEqual([]);
  });
  // Renamed (fix round 1, Finding 3) from "tier crossing is never proposed: a
  // sol pin never sees terra" — same body, clearer about what "sibling" means
  // here now that candidate order/dedup changed elsewhere in this suite.
  test('a live sol pin never sees terra as a sibling', () => {
    expect(run({ gpt: 'openrouter/openai/gpt-5.6-sol' }).map(p => p.candidates.map(c => c.why)))
      .toEqual([['follow']]);   // differs from shipped, no sibling
  });
  test('stale pinned custom alias: replacements from the same vendor, no follow (nothing shipped)', () => {
    const [p] = run({ mistral2: 'openrouter/mistralai/mistral-medium-3-4' });
    expect(p.reasons).toEqual(['stale']);
    expect(p.curated).toBe(false);
    expect(p.shipped).toBeNull();
    expect(p.candidates).toEqual([{ id: 'openrouter/mistralai/mistral-medium-3-5', why: 'replacement', evidence: {} }]);
    expect(p.dismissKey).toBe('mistral2@openrouter/mistralai/mistral-medium-3-5');
  });
  // Fix round 1, Finding 3: a stale CURATED pin whose id shares no catalog
  // entry's prefix (the sibling comparator finds nothing — 'glm-x1' parses to
  // prefix 'glm-x', which no shipped 'glm-' id matches) offers `follow`
  // first, then similarity-ranked replacements.
  test('a stale curated pin with no matching sibling: follow first, then replacements', () => {
    const [p] = run({ glm: 'openrouter/z-ai/glm-x1' });
    expect(p.reasons).toEqual(['stale', 'differs-from-shipped']);
    // Fix round 2 (ruling: DEDUPE): suggestReplacements (alias-audit.js,
    // unmodified by this task) ranks by same-vendor similarity, not recency,
    // and on its own would repeat glm-5.3 (already shown as `follow`) as a
    // third "replacement" — the same id under two rationales reads as a
    // picker bug, so the engine drops any replacement id already present
    // earlier in `candidates`. Only the two genuinely new same-vendor ids
    // survive.
    expect(p.candidates).toEqual([
      { id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} },
      { id: 'openrouter/z-ai/glm-5.4:free', why: 'replacement', evidence: {} },
      { id: 'openrouter/z-ai/glm-5.4', why: 'replacement', evidence: {} },
    ]);
    expect(p.dismissKey).toBe('glm@openrouter/z-ai/glm-5.3');
  });
  test('stale with no replacement still proposes, keyed on the stale id itself', () => {
    const [p] = run({ lonely: 'openrouter/nobody/thing-1' }, { catalogInfo: info([...CATALOG, row('openrouter/nobody/other-2')]) });
    expect(p.reasons).toEqual(['stale']);
    expect(p.candidates.map(c => c.why)).toEqual(['replacement']);
    const [q] = run({ lonely: 'openrouter/nobody/thing-1' }, { catalogInfo: info([...CATALOG, row('openrouter/nobodyelse/x-1')]) });
    expect(q.candidates).toEqual([]);
    expect(q.dismissKey).toBe('lonely@openrouter/nobody/thing-1');
  });
});

describe('alias-proposals — the §5 display gate', () => {
  // Named mutant "FLOORSIBLING" — drop the `authoritative !== false` filter from candidateIds.
  // Measured red (npx jest tests/utils/alias-proposals.test.js, fix round 1), 1/21 failed:
  //   "alias-proposals — the §5 display gate › a non-authoritative row is never a candidate"
  test('a non-authoritative row is never a candidate', () => {
    const models = [...CATALOG, row('openrouter/z-ai/glm-5.9', { authoritative: false })];
    const [p] = run({ glm: 'openrouter/z-ai/glm-5.4' }, { catalogInfo: info(models) });
    expect(p.candidates.map(c => c.id)).not.toContain('openrouter/z-ai/glm-5.9');
  });
  // Named mutant "FAILEDCANDIDATE" — drop the providerFailures filter from candidateIds.
  // Measured red (npx jest tests/utils/alias-proposals.test.js, fix round 1) — now also
  // reddens the notable path (Finding 4 added coverage for it), 2/21 failed:
  //   "alias-proposals — the §5 display gate › a row from a rejected namespace is never a
  //     candidate, and a pin in a rejected namespace is not judged"
  //   "alias-proposals — dismissal, retired, notable › a notable whose id is in a rejected
  //     namespace is never a candidate"
  test('a row from a rejected namespace is never a candidate, and a pin in a rejected namespace is not judged', () => {
    const failures = [{ provider: 'openrouter', reason: 'http-status', status: 403 }];
    expect(run({ glm: 'openrouter/z-ai/glm-5.2' }, { catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')], failures) })).toEqual([]);
    const gFail = [{ provider: 'google', reason: 'http-status', status: 401 }];
    const out = run({ gemini: 'google/gemini-3.1-flash' }, { catalogInfo: info(CATALOG, gFail) });
    expect(out).toEqual([]);
  });
  // Named mutant "OLDERSIBLING" — compare with `>= 0` instead of `> 0` in the lifted comparator's caller (i.e. accept equal/older).
  // Measured red (npx jest tests/utils/alias-proposals.test.js, fix round 1) via the
  // engine-side substitute
  // `ctx.candidateIds.find(id => id !== r.id && id.startsWith(r.id.slice(0, r.id.lastIndexOf('-'))))`
  // in place of `newestSibling(r.id, ctx.candidateIds)` — cruder than a real `>= 0` flip (no
  // vendor/prefix/suffix/version structure, first match wins), so it also breaks sibling
  // selection generally; 7/21 failed (one more than fix round 0's 6/15, since the new
  // Finding-3/Finding-4 tests also exercise sibling-shaped behavior), named test included:
  //   "alias-proposals — the §5 display gate › an older sibling is never proposed"
  //   "alias-proposals — one proposal per alias, pinned only (#238 D1/D7/§2) › pinned behind a
  //     newer sibling AND behind the shipped pin: ONE proposal, sibling first, follow second"
  //   "alias-proposals — one proposal per alias, pinned only (#238 D1/D7/§2) › pinned AHEAD of
  //     the shipped pin with no newer sibling: follow is still offered (differs-from-shipped)"
  //   "alias-proposals — one proposal per alias, pinned only (#238 D1/D7/§2) › stale pinned
  //     custom alias: replacements from the same vendor, no follow (nothing shipped)"
  //   "alias-proposals — one proposal per alias, pinned only (#238 D1/D7/§2) › a stale curated
  //     pin with no matching sibling: follow first, then replacements"
  //   "alias-proposals — dismissal, retired, notable › a dismissed key is skipped; a newer
  //     proposed id is a new key and asks again"
  //   "alias-proposals — dismissal, retired, notable › notable already mapped by a default or a
  //     user alias is skipped"
  test('an older sibling is never proposed', () => {
    const models = [row('openrouter/z-ai/glm-5.1'), row('openrouter/z-ai/glm-5.4')];
    expect(run({ glm: 'openrouter/z-ai/glm-5.4' }, { catalogInfo: info(models) })
      .flatMap(p => p.candidates).map(c => c.id)).not.toContain('openrouter/z-ai/glm-5.1');
  });
});

// R2 (#249 r1 A2/D5): the picker's "choose another" free-text entry must be
// gated by the exact same §5 display rule the engine already applies to its
// own candidates -- otherwise typing a floor row or a rejected-namespace id
// bypasses the gate the numbered menu never offers it through.
describe('gatedCatalogIds — the §5 display gate, exposed for the picker (#249 r1 R2)', () => {
  test('excludes a non-authoritative row and a rejected-namespace row, includes the rest', () => {
    const failures = [{ provider: 'openrouter', reason: 'http-status', status: 403 }];
    const models = [
      row('openrouter/z-ai/glm-5.3'),
      row('openrouter/z-ai/glm-5.9', { authoritative: false }),
      row('google/gemini-3.6-flash'),
    ];
    expect(gatedCatalogIds({ models, providerFailures: failures })).toEqual(['google/gemini-3.6-flash']);
  });
  test('never throws on odd input: null, a non-array models, a non-array providerFailures', () => {
    expect(gatedCatalogIds(null)).toEqual([]);
    expect(gatedCatalogIds(undefined)).toEqual([]);
    expect(gatedCatalogIds({ models: null })).toEqual([]);
    expect(gatedCatalogIds({ models: CATALOG, providerFailures: {} })).toEqual(CATALOG.map(m => m.id));
  });
});

describe('alias-proposals — dismissal, retired, notable', () => {
  test('a dismissed key is skipped; a newer proposed id is a new key and asks again', () => {
    const dismissed = { 'glm@openrouter/z-ai/glm-5.4': '2026-09-14T00:00:00.000Z' };
    expect(run({ glm: 'openrouter/z-ai/glm-5.2' }, { dismissed, catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')]) })).toEqual([]);
    const withNewer = info([...CATALOG, row('openrouter/z-ai/glm-5.2'), row('openrouter/z-ai/glm-5.5')]);
    expect(run({ glm: 'openrouter/z-ai/glm-5.2' }, { dismissed, catalogInfo: withNewer })[0].dismissKey).toBe('glm@openrouter/z-ai/glm-5.5');
  });
  test('a retired alias never proposes, even when pinned and stale', () => {
    expect(run({ devstral: 'openrouter/mistralai/devstral-2' }, { retired: { devstral: { on: '2026-08-04' } } })).toEqual([]);
  });
  test('notable: unmapped + authoritative + not already aliased -> an unmapped proposal', () => {
    const notable = [{ id: 'openrouter/mistralai/mistral-medium-3-5', suggestedAlias: 'mistral', note: 'flagship' },
      { id: 'openrouter/z-ai/glm-5.4', suggestedAlias: 'glm-new', note: 'already aliased? no — glm pins 5.3 by default' },
      { id: 'openrouter/nowhere/x-1', suggestedAlias: 'ghost', note: 'not in catalog' }];
    const out = run({}, { notable });
    expect(out.map(p => [p.alias, p.state, p.reasons[0]])).toEqual([
      ['mistral', 'unmapped', 'notable-unmapped'], ['glm-new', 'unmapped', 'notable-unmapped']]);
    expect(out[0].candidates).toEqual([{ id: 'openrouter/mistralai/mistral-medium-3-5', why: 'notable', evidence: { note: 'flagship' } }]);
    expect(out[0].dismissKey).toBe('mistral@openrouter/mistralai/mistral-medium-3-5');
  });
  // Extended (fix round 1, Finding 4 / Minor #5) to also exercise the
  // USER-alias branch of the "already mapped" check — 'glm4' is blocked only
  // because 'myclaude' (a custom row, not a default) already maps to the
  // same model. 'flash' keeps the original default-mapped case.
  test('notable already mapped by a default or a user alias is skipped', () => {
    const notable = [
      { id: 'openrouter/google/gemini-3.6-flash', suggestedAlias: 'flash', note: '' },
      { id: 'openrouter/z-ai/glm-5.4', suggestedAlias: 'glm4', note: '' },
    ];
    expect(run({ myclaude: 'openrouter/z-ai/glm-5.4' }, { notable })).toEqual([]);
  });
  // Fix round 1, Finding 4 (Minor #5): the candidate-side providerFailures
  // filter (candidateRows) also gates the notable path — until now only the
  // pin's-own-namespace early return (proposeForRow) was covered.
  test('a notable whose id is in a rejected namespace is never a candidate', () => {
    const failures = [{ provider: 'openrouter', reason: 'http-status', status: 403 }];
    const notable = [{ id: 'openrouter/mistralai/mistral-medium-3-5', suggestedAlias: 'mistral', note: 'flagship' }];
    expect(run({}, { notable, catalogInfo: info(CATALOG, failures) })).toEqual([]);
  });
  // Fix round 1, Finding 1 (Important, plan-mandated): rule 10 checked the
  // notable's MODEL against already-mapped models but never checked whether
  // suggestedAlias is already an alias NAME — so an unrelated model could
  // still "claim" a name that is already taken. Here 'mistral' is already a
  // custom alias name (pointing at a wholly different model); the notable
  // must not produce a second, conflicting 'mistral' proposal.
  test('a notable naming an existing custom alias is skipped, even for a wholly unrelated model', () => {
    const catalogInfo = info([...CATALOG, row('openrouter/mistralai/mistral-large-2')]);
    const notable = [{ id: 'openrouter/mistralai/mistral-medium-3-5', suggestedAlias: 'mistral', note: 'flagship' }];
    expect(run({ mistral: 'openrouter/mistralai/mistral-large-2' }, { notable, catalogInfo })).toEqual([]);
  });
  // Fix round 1, Finding 1: the sharper case — the notable's model IS a
  // plausible (unmapped-looking) candidate, so before this fix it produced a
  // SECOND 'glm' proposal (state 'unmapped') alongside the real pinned one,
  // sometimes even sharing a dismissKey with it.
  test('a notable naming a pinned curated alias never doubles it: one glm proposal, not two', () => {
    const notable = [{ id: 'openrouter/z-ai/glm-5.4', suggestedAlias: 'glm', note: 'already a name' }];
    const out = run({ glm: 'openrouter/z-ai/glm-5.2' }, { notable });
    expect(out).toHaveLength(1);
    expect(out[0].alias).toBe('glm');
    expect(out[0].state).toBe('pinned');
  });
  // F12 (#238 council r1 D6, singleton): every proposal this engine builds
  // carries a non-empty string dismissKey by construction (proposeForRow's
  // and proposeNotable's own template-literal composition) -- the picker's
  // menuFor only omits "never ask again" for a NULLED key (owner mode's own
  // doing, aliases-owner.js, not the engine's), so a real engine proposal
  // must never hand out a falsy one. Mechanism held (D6); this pins it.
  test('F12: every proposal — a pinned-row one and a notable-unmapped one — carries a non-empty string dismissKey', () => {
    const pinned = run({ glm: 'openrouter/z-ai/glm-5.2' });
    expect(pinned).toHaveLength(1);
    expect(typeof pinned[0].dismissKey).toBe('string');
    expect(pinned[0].dismissKey.length).toBeGreaterThan(0);

    const notable = [{ id: 'openrouter/mistralai/mistral-medium-3-5', suggestedAlias: 'mistral', note: 'flagship' }];
    const unmapped = run({}, { notable });
    expect(unmapped).toHaveLength(1);
    expect(typeof unmapped[0].dismissKey).toBe('string');
    expect(unmapped[0].dismissKey.length).toBeGreaterThan(0);
  });
  test('prototype-named aliases are ordinary custom rows', () => {
    const out = run({ toString: 'openrouter/z-ai/glm-5.2' }, { catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')]) });
    expect(out).toHaveLength(1);
    expect(out[0].curated).toBe(false);
    expect(out[0].candidates.map(c => c.why)).toEqual(['newer-sibling']);
  });
});
