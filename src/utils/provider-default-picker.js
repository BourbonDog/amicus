/**
 * Provider-default picker core (Part 2, Task 4).
 *
 * Builds the priced, tier-preselected choice list a vendor's model picker
 * (CLI/Electron/readline, later tasks) renders. This module is PURE and
 * transport-agnostic: the catalog is always injected by the caller, and it
 * never imports a renderer's formatting helper (e.g. Electron's `fmtPrice`)
 * -- `pricePerMInput` is returned as a raw number; each surface formats it.
 *
 * The one documented impurity: when `tier` is omitted, `getCostTier()` reads
 * the user's persisted config (Task 1). Callers that need full purity can
 * always pass `tier` explicitly to skip that read entirely.
 */

'use strict';

const { resolveTier } = require('./model-tiers');
const { getCostTier, loadConfig, saveConfig } = require('./config');
const { pairAcrossGateways } = require('./gateway-route-catalog');
const { toCanonicalDefault, DIVERGENT_VENDORS } = require('./curated-models');
const { isLocalProvider } = require('./local-providers');
const { classifyModel } = require('./model-classification');

/**
 * @param {{pricing?: {prompt?: string|number|null}|null}|null|undefined} orRow
 *   the OpenRouter-namespace catalog row paired to a logical model, if any.
 * @returns {number|null} `pricing.prompt * 1e6` ($/M input tokens), or null
 *   when there is no priced OpenRouter twin.
 */
function pricePerMInputFrom(orRow) {
  if (!orRow || !orRow.pricing || orRow.pricing.prompt === null || orRow.pricing.prompt === undefined) {
    return null;
  }
  const n = Number(orRow.pricing.prompt);
  return Number.isFinite(n) ? n * 1e6 : null;
}

/**
 * Every catalog row belonging to `vendor`, in either namespace (direct
 * `<vendor>/<model>` or OpenRouter `openrouter/<vendor>/<model>`).
 * @param {Array<{id:string}>} catalog
 * @param {string} vendor
 * @returns {Array<{id:string}>}
 */
function vendorRowsIn(catalog, vendor) {
  const directPrefix = `${vendor}/`;
  const orPrefix = `openrouter/${vendor}/`;
  return catalog.filter(r => r && typeof r.id === 'string' &&
    (r.id.startsWith(directPrefix) || r.id.startsWith(orPrefix)));
}

/**
 * Direct-first canonicalization for a non-divergent vendor's OpenRouter id,
 * guarded by `classifyModel` (model-classification.js): only strips the
 * `openrouter/<vendor>/` prefix when the bare result would NOT classify
 * `invalid` against `catalogInfo` -- i.e. the vendor's direct namespace is
 * either empty (`unknown`; e.g. `deepseek`, no key ever fetched) or the bare
 * id is itself present (`valid`). When the namespace carries authoritative
 * rows that omit the bare id (`invalid`; e.g. `google`/`openai`, issue 195),
 * `orId` is returned unchanged rather than fabricating an id no row carries
 * and no key can ever resolve. Reuses `classifyModel` rather than
 * re-deriving its namespace/authoritative logic. Callers must gate
 * `DIVERGENT_VENDORS` (anthropic -- different strings, dash vs. dot) first.
 * @param {string} vendor
 * @param {string} orId an `openrouter/<vendor>/<rest>` id (or already-bare)
 * @param {{models: Array<{id:string, authoritative?: boolean}>}} catalogInfo
 * @returns {string} the bare direct id when safe, else `orId` unchanged
 */
function directFormIfSafe(vendor, orId, catalogInfo) {
  const bare = toCanonicalDefault(orId);
  if (bare === orId) { return orId; } // gateway-only vendor -- no direct integration at all
  return classifyModel(bare, 'direct', catalogInfo) === 'invalid' ? orId : bare;
}

/**
 * Choose the id a single catalog `row` should surface as in the picker.
 * Prefers a real, verbatim catalog id; only SYNTHESISES one (delegating to
 * `directFormIfSafe`, above -- see its docstring for the guard) for a
 * non-divergent vendor with no direct twin at all.
 *
 * A direct-namespace row always keeps its own (real, direct-callable) id,
 * regardless of what `pairAcrossGateways` could resolve for it -- this is
 * what keeps BOTH direct rows around when two direct ids are ambiguous to
 * `pairAcrossGateways` (e.g. a bare alias and a dated pinned snapshot that
 * normalize to the same key): each is still a real, distinct, callable id
 * and must not be dropped or silently merged.
 *
 * An OpenRouter-namespace row is collapsed onto a direct id only when
 * `pairAcrossGateways` found exactly one (unambiguous) direct twin. For
 * `DIVERGENT_VENDORS` (direct ids don't share a string form with
 * OpenRouter's, e.g. anthropic's dash-vs-dot versioning), the row keeps its
 * OpenRouter-prefixed id as-is -- `directFormIfSafe` is never reached for
 * them, since stripping is not even a string-safe operation on their ids.
 * @param {string} vendor
 * @param {boolean} isDirect whether `row.id` is itself a direct-namespace id
 * @param {{id:string}} row
 * @param {{direct?:string, openrouter?:string}} paired
 * @param {{models: Array<{id:string, authoritative?: boolean}>}} catalogInfo
 * @returns {string|null}
 */
function chooseRowId(vendor, isDirect, row, paired, catalogInfo) {
  if (isDirect) { return row.id; }
  if (paired.direct) { return paired.direct; }
  if (!paired.openrouter) { return null; }
  if (DIVERGENT_VENDORS.has(vendor)) { return paired.openrouter; }
  return directFormIfSafe(vendor, paired.openrouter, catalogInfo);
}

/**
 * Dedupe `vendor`'s catalog rows across gateways into one row per logical
 * model, reusing `pairAcrossGateways` (never re-deriving the pairing logic).
 * A direct row is never dropped even when its OpenRouter twin is ambiguous.
 *
 * Row ids are verbatim catalog ids whenever a real row carries them: a
 * direct row keeps its own id, and an OpenRouter row collapses onto a
 * direct twin only when `pairAcrossGateways` found exactly one. For a
 * NON-divergent vendor with no direct twin at all, `chooseRowId` derives
 * the bare form via `directFormIfSafe` -- SYNTHESISED, not verbatim, only
 * when the vendor's namespace can't prove it invalid (issue 195). Measured
 * 2026-08-24 against a real 601-row catalog: all 14 `deepseek` rows derive
 * this way (empty namespace); `google` (19/69) and `openai` (51/175) rows
 * used to derive the same unconditional way despite a populated,
 * authoritative namespace omitting that specific id, and now stay
 * OpenRouter-prefixed instead. Once a bare id IS synthesized (the deepseek
 * case), it is safe for routing, but not for the reason an earlier version
 * of this comment claimed: a bare id is NOT failure-routed direct-first-
 * with-OpenRouter-fallback. gateway-router.js's auto-mode step 7 is
 * `if (rq.keys[vendor] && hasForm(rq, 'direct'))`, and `hasForm` is
 * `!req.gatewayIds || req.gatewayIds[gateway] !== undefined` -- a bare id
 * carries no `gatewayIds` at all, so `hasForm(rq, 'direct')` is VACUOUSLY
 * true on this path; the only real gate is `rq.keys[vendor]`. The fallback
 * to OpenRouter is therefore KEY-ABSENCE-driven (no key for `vendor`), not
 * a check that the direct form actually resolves -- that check only fires
 * on the ALIAS path, where `gatewayIds` IS attached and `hasForm` can
 * genuinely be false. It is not a catalog-confirmed direct id either way,
 * and callers that need that distinction should consult
 * `curated-models.js`'s `directFormProvenance()`.
 * @param {Array<{id:string,name:string,contextLength:(number|null)}>} catalog
 * @param {string} vendor
 * @returns {Array<{id:string,name:string,contextLength:(number|null),pricePerMInput:(number|null),isPreselected:boolean}>}
 */
function buildRows(catalog, vendor) {
  const byId = new Map(catalog.filter(r => r && typeof r.id === 'string').map(r => [r.id, r]));
  const catalogInfo = { models: catalog };
  const directPrefix = `${vendor}/`;
  const orPrefix = `openrouter/${vendor}/`;
  // Hoisted: `vendor` is fixed for the whole call, so this is decided once
  // rather than re-reading config.providers on every row.
  const isLocal = isLocalProvider(vendor);

  const rows = [];
  const seenIds = new Set();

  for (const row of vendorRowsIn(catalog, vendor)) {
    const isDirect = row.id.startsWith(directPrefix);
    const token = isDirect ? row.id.slice(directPrefix.length) : row.id.slice(orPrefix.length);
    const paired = pairAcrossGateways(vendor, token, catalogInfo);
    const chosenId = chooseRowId(vendor, isDirect, row, paired, catalogInfo);
    if (!chosenId || seenIds.has(chosenId)) { continue; }
    seenIds.add(chosenId);

    const orRow = paired.openrouter ? byId.get(paired.openrouter) : null;
    const sourceRow = isDirect ? row : ((paired.direct && byId.get(paired.direct)) || orRow || row);

    // A local vendor (v4.2 §4.5) has no OpenRouter twin BY CONSTRUCTION --
    // OpenRouter cannot proxy a localhost model -- so `orRow` is always null
    // here and `pricePerMInputFrom(orRow)` would always be null too, no
    // matter that the local catalog row carries its own real
    // `pricing: {prompt:0, completion:0}`. Price local rows from their OWN
    // pricing (`sourceRow`, which for a local/direct row IS the catalog row
    // itself) instead. Gated on `isLocal`, NOT on "no OpenRouter twin", so a
    // direct (non-local) row with no twin still renders `pricePerMInput:
    // null` (tests/provider-default-picker.test.js:60, pinned).
    const localPrice = isLocal ? pricePerMInputFrom(sourceRow) : null;

    rows.push({
      id: chosenId,
      name: sourceRow.name,
      contextLength: (sourceRow.contextLength === undefined ? null : sourceRow.contextLength),
      pricePerMInput: localPrice !== null ? localPrice : pricePerMInputFrom(orRow),
      isPreselected: false,
    });
  }
  return rows;
}

/**
 * Canonicalize `resolveTier`'s verbatim catalog-id output the same way row
 * ids are built (`chooseRowId`/`directFormIfSafe`), so it matches `rows`
 * exactly. Only matters when `resolveTier` fell back to an OpenRouter id (no
 * matching direct-namespace row for the tier). `DIVERGENT_VENDORS` keep that
 * id OpenRouter-prefixed; non-divergent vendors go through the same
 * `classifyModel`-guarded strip `chooseRowId` uses (issue 195) -- an
 * unconditional strip here would produce a canonical id `rows` no longer
 * carries whenever `directFormIfSafe` kept the row itself OpenRouter-
 * prefixed, defeating the match below.
 * @param {string} vendor
 * @param {string|null} resolved verbatim catalog id from `resolveTier`, or null
 * @param {{models: Array<{id:string, authoritative?: boolean}>}} catalogInfo
 * @returns {string|null}
 */
function canonicalizeResolved(vendor, resolved, catalogInfo) {
  if (!resolved) { return null; }
  return DIVERGENT_VENDORS.has(vendor) ? resolved : directFormIfSafe(vendor, resolved, catalogInfo);
}

/**
 * Decide which row (by id) should be preselected.
 * Primary: `resolveTier(vendor, tier, catalog)`, canonicalized the same way
 * row ids are (direct-first) so it can match a row exactly. Falls back to
 * the cheapest priced row, then the first row, whenever the primary result
 * is null OR (defensively) doesn't correspond to any built row.
 * @param {string} vendor
 * @param {string|undefined} tier
 * @param {Array<{id:string}>} catalog
 * @param {Array<{id:string,pricePerMInput:(number|null)}>} rows non-empty
 * @returns {string} a row id from `rows`
 */
function computePreselectedId(vendor, tier, catalog, rows) {
  const effectiveTier = tier || getCostTier();
  const resolved = resolveTier(vendor, effectiveTier, catalog);
  const canonical = canonicalizeResolved(vendor, resolved, { models: catalog });
  if (canonical && rows.some(r => r.id === canonical)) { return canonical; }

  const priced = rows.filter(r => r.pricePerMInput !== null);
  if (priced.length > 0) {
    return priced.reduce((cheapest, r) => (r.pricePerMInput < cheapest.pricePerMInput ? r : cheapest)).id;
  }
  return rows[0].id;
}

/** Preselected first; then price ascending; null prices last. Stable otherwise. */
function compareRows(a, b) {
  if (a.isPreselected !== b.isPreselected) { return a.isPreselected ? -1 : 1; }
  if (a.pricePerMInput === null && b.pricePerMInput === null) { return 0; }
  if (a.pricePerMInput === null) { return 1; }
  if (b.pricePerMInput === null) { return -1; }
  return a.pricePerMInput - b.pricePerMInput;
}

/**
 * Build the choice list for a vendor's model picker.
 * @param {string} vendor e.g. 'anthropic'
 * @param {{catalog?: Array<{id:string,name:string,contextLength:(number|null),pricing:(object|null)}>, tier?: string}} [options]
 * @returns {{preselectedId: (string|null), rows: Array<{id:string,name:string,contextLength:(number|null),pricePerMInput:(number|null),isPreselected:boolean}>}}
 */
function buildProviderDefaultChoices(vendor, options = {}) {
  if (typeof vendor !== 'string' || !vendor) { return { preselectedId: null, rows: [] }; }

  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  const rows = buildRows(catalog, vendor);
  if (rows.length === 0) { return { preselectedId: null, rows: [] }; }

  const preselectedId = computePreselectedId(vendor, options.tier, catalog, rows);
  for (const r of rows) { r.isPreselected = r.id === preselectedId; }
  rows.sort(compareRows);

  return { preselectedId, rows };
}

/**
 * Apply a picker choice: store the vendor-named alias and (optionally) seed
 * `config.default` on first use. Read-modify-write, NO-CLOBBER -- preserves
 * an already-set `config.default` and every other existing alias/key.
 *
 * `chosenId` comes straight from `buildProviderDefaultChoices`: a real
 * direct id; an `openrouter/`-prefixed id (`DIVERGENT_VENDORS`, or -- since
 * issue 195 -- a non-divergent vendor whose bare form would classify
 * `invalid`); or a bare id already SYNTHESISED via `directFormIfSafe`.
 * **Never** unconditionally strip a divergent vendor's id -- fabricates a
 * non-direct-callable dot-form id no row carries. Non-divergent vendors
 * re-run the SAME `classifyModel`-guarded strip `chooseRowId` used to pick
 * `chosenId` (`directFormIfSafe`, passed `catalog`): an unconditional strip
 * would silently re-fabricate the id `chooseRowId` just refused, undoing
 * the fix where the id is persisted and routed on. Without `catalog`, an
 * empty namespace reads `unknown` and strips unconditionally (pre-195
 * behavior) -- callers that built choices from a catalog should pass it.
 * @param {string} vendor e.g. 'anthropic'
 * @param {string} chosenId id from the picker (see above -- not always
 *   catalog-verbatim)
 * @param {{seedDefaultIfAbsent?: boolean, catalog?: Array<{id:string}>}} [options]
 * @returns {{alias: string, setAsDefault: boolean}}
 */
function applyProviderDefault(vendor, chosenId, { seedDefaultIfAbsent = true, catalog } = {}) {
  const catalogInfo = { models: Array.isArray(catalog) ? catalog : [] };
  const storedId = DIVERGENT_VENDORS.has(vendor) ? chosenId : directFormIfSafe(vendor, chosenId, catalogInfo);

  const config = loadConfig() || {};
  if (!config.aliases || typeof config.aliases !== 'object') { config.aliases = {}; }
  config.aliases[vendor] = storedId;

  const hasDefault = typeof config.default === 'string' && config.default.trim().length > 0;
  const setAsDefault = seedDefaultIfAbsent && !hasDefault;
  if (setAsDefault) { config.default = vendor; }

  saveConfig(config);
  return { alias: vendor, setAsDefault };
}

module.exports = { buildProviderDefaultChoices, applyProviderDefault, pricePerMInputFrom };
