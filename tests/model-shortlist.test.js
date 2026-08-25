'use strict';

const { buildModelShortlist, SHORTLIST_LIMIT } = require('../src/utils/model-shortlist');

function row(id, promptPrice, name) {
  return {
    id,
    name: name || id.split('/').pop(),
    contextLength: 128000,
    pricing: promptPrice === null ? null : { prompt: String(promptPrice / 1e6) },
  };
}

// Nine DeepSeek models so the 8-row limit actually splits.
const CATALOG = [
  row('openrouter/deepseek/deepseek-v4-pro', 0.52),
  row('openrouter/deepseek/deepseek-v4-flash', 0.06),
  row('openrouter/deepseek/deepseek-chat', 0.26),
  row('openrouter/deepseek/deepseek-r1', 0.70),
  row('openrouter/deepseek/deepseek-v3.2', 0.26),
  row('openrouter/deepseek/deepseek-v3.2-exp', 0.27),
  row('openrouter/deepseek/deepseek-chat-v3-0324', 0.25),
  row('openrouter/deepseek/deepseek-v3.1-terminus', 0.27),
  row('openrouter/deepseek/deepseek-r1-distill-llama-70b', 0.80),
];

describe('buildModelShortlist', () => {
  test('honours the caller-supplied recommendedId over the tier preselect', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    expect(out.recommendedId).toBe('deepseek/deepseek-v4-pro');
    expect(out.suggested[0].id).toBe('deepseek/deepseek-v4-pro');
    expect(out.suggested[0].isRecommended).toBe(true);
  });

  test('splits at the limit and reports the true total', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    expect(SHORTLIST_LIMIT).toBe(8);
    expect(out.suggested).toHaveLength(8);
    expect(out.rest).toHaveLength(1);
    expect(out.total).toBe(9);
  });

  test('every model appears exactly once across suggested + rest', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const ids = out.suggested.concat(out.rest).map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('deepseek/deepseek-r1');
  });

  test('after the recommended row, ordering is price-ascending', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const prices = out.suggested.slice(1).map(r => r.pricePerMInput);
    const sorted = prices.slice().sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  test('falls back to the picker preselect when recommendedId matches no row', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/does-not-exist',
    });
    expect(out.recommendedId).not.toBeNull();
    expect(out.suggested[0].isRecommended).toBe(true);
    expect(out.suggested.concat(out.rest).map(r => r.id))
      .toContain(out.recommendedId);
  });

  test('annotates both route forms so an explicit OpenRouter pick is expressible', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const r1 = out.suggested.concat(out.rest).find(r => r.id === 'deepseek/deepseek-r1');
    expect(r1.openrouterId).toBe('openrouter/deepseek/deepseek-r1');
  });

  test('empty or unknown vendor degrades to an empty shortlist, never throws', () => {
    expect(buildModelShortlist('deepseek', { catalog: [] }))
      .toEqual({ recommendedId: null, suggested: [], rest: [], total: 0 });
    expect(buildModelShortlist('', { catalog: CATALOG }).total).toBe(0);
  });
});

// F13: every test above uses 'deepseek' -- the one family where alias ==
// vendorPath AND a direct fallback is authored, so a caller-supplied
// recommendedId is ALREADY in the bare `vendor/model` form the shortlist's
// rows use, no matter how it was derived. That coincidence is exactly what
// let F1 ship: electron/main.js computed
//   recommendedId: p.routes && (p.routes[p.vendorPath] || p.routes.openrouter)
// -- toStorableRoute's DIVERGENT-vendor branch applied to EVERY vendor --
// and no existing test could see it disagree with the card. This covers
// 'gemini-pro' (non-divergent, and its vendorPath 'google' is SHARED with
// the 'gemini' family, so buildModelShortlist('google', ...) sees both
// families' rows in one pool -- this is what turns the bug from "falls
// back to a coincidentally-correct preselect" into an ACTUAL wrong pick)
// against a first-run-shaped catalog: openrouter rows only, no
// direct-namespace route yet, matching a brand-new user's very first
// catalog fetch (src/utils/model-fetcher.js: providersToFetch always adds
// 'anthropic' too, hence the hardcoded floor rows below).
describe('F13: the card write and the shortlist preselect must agree (pairs with F1)', () => {
  const { resolveQuickPicks, toStorableRoute } = require('../src/utils/quick-picks');

  const FIRST_RUN_CATALOG = [
    row('openrouter/google/gemini-3.6-flash', 0.10),  // the gemini family's pinned fallback id
    row('openrouter/google/gemini-3.7-flash', 0.10),  // a newer live flash pick the gemini family resolves to instead
    row('openrouter/google/gemini-3.1-pro-preview', 1.0), // the gemini-pro family's only live row
    row('openrouter/openai/gpt-5.6-terra', 1.0),
    row('openrouter/anthropic/claude-opus-5', 15.0),
    row('openrouter/deepseek/deepseek-v4-pro', 0.52),
    row('anthropic/claude-opus-5', null),
    row('anthropic/claude-sonnet-5', null),
  ];

  test('gemini-pro (openrouter-only, non-divergent): the shortlist preselect equals the id the card actually writes', () => {
    const picks = resolveQuickPicks(FIRST_RUN_CATALOG);
    const geminiPro = picks.find(p => p.alias === 'gemini-pro');
    expect(geminiPro).toBeTruthy();
    expect(geminiPro.routes.google).toBeUndefined(); // sanity: no direct route resolved this run

    const cardWrite = toStorableRoute(geminiPro); // what Finish actually writes for this alias (F1's fix)
    expect(cardWrite).toBe('google/gemini-3.1-pro-preview'); // canonicalised, bare form -- matches a shortlist row id

    const shortlist = buildModelShortlist(geminiPro.vendorPath, {
      catalog: FIRST_RUN_CATALOG,
      recommendedId: cardWrite,
    });
    expect(shortlist.recommendedId).toBe(cardWrite);
    const rec = shortlist.suggested.concat(shortlist.rest).find(r => r.id === shortlist.recommendedId);
    expect(rec).toBeTruthy();
    expect(rec.isRecommended).toBe(true);
  });

  test('F1 regression: the reverted expression makes the dropdown preselect a DIFFERENT model than the card displays', () => {
    const picks = resolveQuickPicks(FIRST_RUN_CATALOG);
    const geminiPro = picks.find(p => p.alias === 'gemini-pro');
    // toStorableRoute's DIVERGENT-vendor branch, applied to a non-divergent
    // vendor -- exactly the bug electron/main.js shipped.
    const buggyRecommendedId = geminiPro.routes && (geminiPro.routes[geminiPro.vendorPath] || geminiPro.routes.openrouter);
    expect(buggyRecommendedId).toBe('openrouter/google/gemini-3.1-pro-preview'); // un-canonicalised, unmatchable form

    const shortlist = buildModelShortlist(geminiPro.vendorPath, {
      catalog: FIRST_RUN_CATALOG,
      recommendedId: buggyRecommendedId,
    });
    // Not a graceful "falls back to the same answer" -- the 'google' vendor
    // pool is shared with the 'gemini' family, so the cost-tier fallback
    // lands on the CHEAPER flash row instead: the dropdown would preselect
    // a model the gemini-pro card never showed the user at all.
    expect(shortlist.recommendedId).not.toBe(buggyRecommendedId);
    expect(shortlist.recommendedId).not.toBe(toStorableRoute(geminiPro));
    expect(shortlist.recommendedId).toBe('google/gemini-3.7-flash'); // the actual wrong pick, measured
  });
});
