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
const { getCostTier } = require('./config');
const { pairAcrossGateways } = require('./gateway-route-catalog');
const { toCanonicalDefault, DIVERGENT_VENDORS } = require('./curated-models');

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
 * Choose the verbatim catalog id a single catalog `row` should surface as in
 * the picker -- NEVER fabricates an id.
 *
 * A direct-namespace row always keeps its own (real, direct-callable) id,
 * regardless of what `pairAcrossGateways` could resolve for it -- this is
 * what keeps BOTH direct rows around when two direct ids are ambiguous to
 * `pairAcrossGateways` (e.g. a bare alias and a dated pinned snapshot that
 * normalize to the same key): each is still a real, distinct, callable id
 * and must not be dropped or silently merged.
 *
 * An OpenRouter-namespace row is collapsed onto a direct id only when
 * `pairAcrossGateways` found exactly one (unambiguous) direct twin -- that's
 * a real catalog id, safe to reuse for dedup. Otherwise: for
 * `DIVERGENT_VENDORS` (direct ids don't share a string form with
 * OpenRouter's -- e.g. anthropic's dash-vs-dot versioning), the row keeps
 * its OpenRouter-prefixed id as-is; stripping the prefix would fabricate a
 * non-direct-callable dot-form id no row actually carries. Non-divergent
 * vendors keep the pre-existing strip via `toCanonicalDefault`, which is
 * safe because their direct and OpenRouter ids are identical once the
 * `openrouter/<vendor>/` prefix is removed (mirrors curated-models.js's
 * `directFormFor` policy).
 * @param {string} vendor
 * @param {boolean} isDirect whether `row.id` is itself a direct-namespace id
 * @param {{id:string}} row
 * @param {{direct?:string, openrouter?:string}} paired
 * @returns {string|null}
 */
function chooseRowId(vendor, isDirect, row, paired) {
  if (isDirect) { return row.id; }
  if (paired.direct) { return paired.direct; }
  if (!paired.openrouter) { return null; }
  return DIVERGENT_VENDORS.has(vendor) ? paired.openrouter : toCanonicalDefault(paired.openrouter);
}

/**
 * Dedupe `vendor`'s catalog rows across gateways into one row per logical
 * model, reusing `pairAcrossGateways` (never re-deriving the pairing logic).
 * Every row id is verbatim from the catalog (see `chooseRowId`) -- never
 * fabricated, and a direct row is never dropped even when its OpenRouter
 * twin is ambiguous.
 * @param {Array<{id:string,name:string,contextLength:(number|null)}>} catalog
 * @param {string} vendor
 * @returns {Array<{id:string,name:string,contextLength:(number|null),pricePerMInput:(number|null),isPreselected:boolean}>}
 */
function buildRows(catalog, vendor) {
  const byId = new Map(catalog.filter(r => r && typeof r.id === 'string').map(r => [r.id, r]));
  const catalogInfo = { models: catalog };
  const directPrefix = `${vendor}/`;
  const orPrefix = `openrouter/${vendor}/`;

  const rows = [];
  const seenIds = new Set();

  for (const row of vendorRowsIn(catalog, vendor)) {
    const isDirect = row.id.startsWith(directPrefix);
    const token = isDirect ? row.id.slice(directPrefix.length) : row.id.slice(orPrefix.length);
    const paired = pairAcrossGateways(vendor, token, catalogInfo);
    const chosenId = chooseRowId(vendor, isDirect, row, paired);
    if (!chosenId || seenIds.has(chosenId)) { continue; }
    seenIds.add(chosenId);

    const orRow = paired.openrouter ? byId.get(paired.openrouter) : null;
    const sourceRow = isDirect ? row : ((paired.direct && byId.get(paired.direct)) || orRow || row);

    rows.push({
      id: chosenId,
      name: sourceRow.name,
      contextLength: (sourceRow.contextLength === undefined ? null : sourceRow.contextLength),
      pricePerMInput: pricePerMInputFrom(orRow),
      isPreselected: false,
    });
  }
  return rows;
}

/**
 * Canonicalize `resolveTier`'s verbatim catalog-id output the same way row
 * ids are built (`chooseRowId`), so it can be matched against `rows`
 * exactly. `resolveTier` already prefers a real direct id when one matches
 * the tier pattern (`model-tiers.js`'s `pickForTier` tries the direct
 * namespace first), so this only has an effect when it fell back to an
 * OpenRouter id (no matching direct-namespace row at all). For
 * `DIVERGENT_VENDORS`, that OpenRouter id must stay OpenRouter-prefixed --
 * stripping it would fabricate a non-direct-callable dot-form id that no row
 * carries. Non-divergent vendors keep the pre-existing strip, safe because
 * their direct and OpenRouter ids are identical once the prefix is removed.
 * @param {string} vendor
 * @param {string|null} resolved verbatim catalog id from `resolveTier`, or null
 * @returns {string|null}
 */
function canonicalizeResolved(vendor, resolved) {
  if (!resolved) { return null; }
  return DIVERGENT_VENDORS.has(vendor) ? resolved : toCanonicalDefault(resolved);
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
  const canonical = canonicalizeResolved(vendor, resolved);
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

module.exports = { buildProviderDefaultChoices };
