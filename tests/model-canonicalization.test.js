'use strict';

/**
 * Unit tests for the two canonicalization primitives extracted out of
 * provider-default-picker.js (issue 195 follow-up F1/B4/B6, council review
 * of PR 198): `directFormIfSafe` (list-building, optimistic) and
 * `directFormIfProven` (persistence, requires positive evidence). See
 * src/utils/model-canonicalization.js's module docstring for why they are
 * two separately-named functions instead of one with a mode flag.
 */

const {
  directFormIfSafe, directFormIfProven,
} = require('../src/utils/model-canonicalization');

const populatedGoogleCatalog = [
  // Authoritative, populated direct namespace that OMITS the gemma id below.
  { id: 'google/gemini-3.7-flash' },
  { id: 'openrouter/google/gemini-3.7-flash' },
  { id: 'openrouter/google/gemma-4-31b-it:free' },
];

describe('directFormIfSafe — list-building (optimistic: strip unless proven invalid)', () => {
  // The catalog here DELIBERATELY also carries a row at the stripped-prefix
  // (dot-preserved) form -- coincidental in reality, but it forces
  // classifyModel to return 'valid' for that bare id, so this test can only
  // pass if DIVERGENT_VENDORS is checked FIRST and unconditionally, before
  // classifyModel runs at all. A weaker fixture (no such row) would still
  // pass even with the gate deleted, since classifyModel would separately
  // return 'invalid' for the dot-form against a dash-only namespace --
  // proving nothing about the gate itself.
  test('divergent vendor (anthropic): always passed through, even when classifyModel would otherwise say the stripped form is valid', () => {
    const catalog = [
      { id: 'anthropic/claude-opus-4-8' },
      { id: 'anthropic/claude-opus-4.8' }, // coincidental dot-form row -- would classify 'valid'
      { id: 'openrouter/anthropic/claude-opus-4.8' },
    ];
    expect(directFormIfSafe('anthropic', 'openrouter/anthropic/claude-opus-4.8', { models: catalog }))
      .toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('gateway-only vendor (no direct integration at all): passed through unchanged', () => {
    expect(directFormIfSafe('qwen', 'openrouter/qwen/qwen3-max', { models: [] }))
      .toBe('openrouter/qwen/qwen3-max');
  });

  test('no evidence (empty catalog): strips -- a bare guess is reasonable when nothing disproves it', () => {
    expect(directFormIfSafe('deepseek', 'openrouter/deepseek/deepseek-v3.2', { models: [] }))
      .toBe('deepseek/deepseek-v3.2');
  });

  test('proven invalid (populated, authoritative namespace omits the bare id): kept OpenRouter-prefixed', () => {
    expect(directFormIfSafe('google', 'openrouter/google/gemma-4-31b-it:free', { models: populatedGoogleCatalog }))
      .toBe('openrouter/google/gemma-4-31b-it:free');
  });

  test('proven valid (bare id present in the catalog): strips', () => {
    expect(directFormIfSafe('google', 'openrouter/google/gemini-3.7-flash', { models: populatedGoogleCatalog }))
      .toBe('google/gemini-3.7-flash');
  });
});

describe('directFormIfProven — persistence (conservative: strip only on positive evidence)', () => {
  // Same reasoning as directFormIfSafe's equivalent test above: the
  // coincidental dot-form row forces classifyModel to return 'valid' for
  // the stripped id, so this only passes if DIVERGENT_VENDORS is gated
  // FIRST and unconditionally -- otherwise "positive evidence" (F1) would
  // wrongly authorize the strip.
  test('divergent vendor (anthropic): always passed through, even when classifyModel would otherwise say the stripped form is valid', () => {
    const catalog = [
      { id: 'anthropic/claude-opus-4-8' },
      { id: 'anthropic/claude-opus-4.8' }, // coincidental dot-form row -- would classify 'valid'
      { id: 'openrouter/anthropic/claude-opus-4.8' },
    ];
    expect(directFormIfProven('anthropic', 'openrouter/anthropic/claude-opus-4.8', { models: catalog }))
      .toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('gateway-only vendor: passed through unchanged', () => {
    expect(directFormIfProven('qwen', 'openrouter/qwen/qwen3-max', { models: [] }))
      .toBe('openrouter/qwen/qwen3-max');
  });

  // F1 (council review of PR 198): this is the corrected behavior. A failed
  // or absent catalog fetch is NO evidence either way -- directFormIfSafe's
  // "strip unless proven invalid" default would fabricate a direct id here
  // (the exact bug issue 195 fixed, reintroduced on every degraded fetch).
  // directFormIfProven instead preserves chosenId exactly as given.
  test('no evidence (empty catalog): id is preserved VERBATIM, never fabricated', () => {
    expect(directFormIfProven('deepseek', 'openrouter/deepseek/deepseek-v3.2', { models: [] }))
      .toBe('openrouter/deepseek/deepseek-v3.2');
  });

  // A5 (council review of PR 198): the previous version of this test passed
  // { models: [] } -- byte-identical to the "empty catalog" test above -- so
  // it never actually exercised catalogInfo.models being undefined at all.
  // Passes { models: undefined } directly here to pin classifyModel's OWN
  // coercion (`Array.isArray(catalogInfo.models) ? catalogInfo.models : []`,
  // model-classification.js) at this call boundary. The OTHER absent-catalog
  // shape -- the `catalog` OPTION omitted entirely from applyProviderDefault,
  // which is what actually produces `{models: undefined}` in production via
  // `{ models: Array.isArray(catalog) ? catalog : [] }` -- is covered by
  // tests/provider-default-picker.test.js's "without catalog: chosenId is
  // preserved VERBATIM" test (applyProviderDefault called with no options at
  // all), so both coercion sites are pinned.
  test('no evidence ({models: undefined}): id is preserved verbatim', () => {
    expect(directFormIfProven('deepseek', 'openrouter/deepseek/deepseek-v3.2', { models: undefined }))
      .toBe('openrouter/deepseek/deepseek-v3.2');
  });

  test('proven invalid (populated, authoritative namespace omits the bare id): kept OpenRouter-prefixed', () => {
    expect(directFormIfProven('google', 'openrouter/google/gemma-4-31b-it:free', { models: populatedGoogleCatalog }))
      .toBe('openrouter/google/gemma-4-31b-it:free');
  });

  test('proven valid (bare id present in the catalog): strips -- happy path unaffected', () => {
    expect(directFormIfProven('google', 'openrouter/google/gemini-3.7-flash', { models: populatedGoogleCatalog }))
      .toBe('google/gemini-3.7-flash');
  });

  // A4 (council review of PR 198): a bare `chosenId` that is ALREADY bare
  // (no `openrouter/` prefix -- stripGatewayPrefix is a no-op on it) short-
  // circuits BEFORE classifyModel ever runs, so a bare id the catalog proves
  // `invalid` is persisted VERBATIM even when an unambiguous OpenRouter twin
  // sits right there in the same catalog. This is a DELIBERATE, pinned
  // decision, not an oversight: `directFormIfProven` only ever handles the
  // strip direction (OR-prefixed -> bare, on positive evidence); it never
  // performs the inverse repair (bare -> OR twin). That repair already
  // exists as a SEPARATE, explicit, user-visible step --
  // `findFabricatedAliasRepairs`/`doctor --fix` (alias-audit.js, B3) --
  // which announces the rewrite as a `heal` degrade naming both ids, rather
  // than this pure canonicalization primitive silently substituting a
  // DIFFERENT id than the one the caller actually handed in. Reachability is
  // narrow by measurement: both `runProviderDefaultFlow` (CLI/readline) and
  // `runProviderDefaultPickers` (setup wizard) fetch the catalog exactly
  // ONCE and reuse that same array for both `buildProviderDefaultChoices`
  // (which never offers a bare id classifying invalid under that catalog)
  // and `applyProviderDefault` -- so this path is unreachable there. It IS
  // reachable via `electron/ipc-setup.js`'s two separate IPC calls
  // (`save-key` builds choices from one `getCatalog()` fetch,
  // `sidecar:set-provider-default` re-fetches independently before
  // applying) -- a real, if narrow, TOCTOU window between the two. See
  // .superpowers/sdd/issue-195-report.md for the fuller reasoning.
  test('A4: an ALREADY-BARE chosenId proven invalid is persisted verbatim, not upgraded to its OR twin (deliberate -- doctor --fix is the remediation layer)', () => {
    const catalogWithUnambiguousTwin = [
      ...populatedGoogleCatalog,
      { id: 'openrouter/google/gemma-4-31b-it:free' }, // the twin doctor --fix WOULD use
    ];
    expect(directFormIfProven('google', 'google/gemma-4-31b-it:free', { models: catalogWithUnambiguousTwin }))
      .toBe('google/gemma-4-31b-it:free'); // unchanged -- NOT upgraded to the OR twin here
  });
});

// F1/B4: provider-default-picker.js's module.exports re-exports these two
// functions rather than wrapping or re-implementing them, so a caller using
// either import path gets the SAME function object -- pins the extraction
// as a pure move, not a fork that could silently diverge.
describe('extraction identity (pure move, not a duplicate)', () => {
  test('provider-default-picker.js re-exports the SAME function objects as model-canonicalization.js', () => {
    const picker = require('../src/utils/provider-default-picker');
    expect(picker.directFormIfSafe).toBe(directFormIfSafe);
    expect(picker.directFormIfProven).toBe(directFormIfProven);
  });
});

/**
 * Issue #208: an empty direct namespace has TWO causes, and only one of them
 * justifies optimism. "Never fetched" (offline, no key) cannot disprove the
 * bare form, so stripping is reasonable. "Fetched and REJECTED" is not
 * evidence of absence either -- but it is evidence that we know nothing, and
 * synthesising a direct id from no knowledge is how an unservable id
 * (`deepseek/deepseek-v4-flash-0731`) reached a real config.
 */
describe('directFormIfSafe — namespace fetch failure suppresses optimism (#208)', () => {
  test('vendor whose namespace fetch was REJECTED: passed through, not stripped', () => {
    expect(directFormIfSafe('deepseek', 'openrouter/deepseek/deepseek-v4-flash-0731', {
      models: [{ id: 'openrouter/deepseek/deepseek-v4-flash-0731' }],
      providerFailures: [{ provider: 'deepseek', reason: 'http-status', status: 401 }],
    })).toBe('openrouter/deepseek/deepseek-v4-flash-0731');
  });

  // Named mutant: implementing the gate as "any recorded failure suppresses
  // stripping" passes the test above and fails this one. The gate must be
  // keyed on THIS vendor's namespace.
  test('a failure recorded for a DIFFERENT provider does not suppress stripping', () => {
    expect(directFormIfSafe('deepseek', 'openrouter/deepseek/deepseek-v3.2', {
      models: [],
      providerFailures: [{ provider: 'openai', reason: 'http-status', status: 401 }],
    })).toBe('deepseek/deepseek-v3.2');
  });

  // Preserves the legitimate optimism the module was designed around: a
  // catalog that is empty because nothing was ever fetched still strips.
  test('empty catalog with NO recorded failures still strips (never-attempted stays optimistic)', () => {
    expect(directFormIfSafe('deepseek', 'openrouter/deepseek/deepseek-v3.2', {
      models: [], providerFailures: [],
    })).toBe('deepseek/deepseek-v3.2');
  });
});
