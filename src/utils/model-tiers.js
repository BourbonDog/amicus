/**
 * Per-vendor cost tiers (economy/balanced/frontier) + resolution against the
 * live model catalog.
 *
 * Tier ordering: frontier = MOST expensive/capable, economy = CHEAPEST,
 * balanced = the middle ground.
 *
 * Mirrors quick-picks.pickCurrent's "newest live-catalog id matching a
 * pattern in a vendor namespace" approach rather than reinventing it: each
 * tier's regex is matched over the model segment in BOTH the direct
 * namespace (`<vendor>/<model>`) and the OpenRouter namespace
 * (`openrouter/<vendor>/<model>`); the direct-namespace pick wins when both
 * exist, since storage is direct-first (see gateway-router.js).
 *
 * Gateway-only vendors (no direct API integration — provider-registry
 * `isDirectProvider` false) have no tier regexes here: OpenRouter is their
 * only route, and curated-models' CARDLESS/family-fallback entries don't
 * carry a per-alias match pattern the way FAMILIES does, so there is no
 * live-catalog rule to reuse for them. All three tiers resolve to the same
 * curated flagship — the static canonical pin `toDefaultAliases()` already
 * maintains for that vendor's alias (the same pin `resolveQuickPicks` falls
 * back to when live resolution is unavailable).
 */

'use strict';

const { pickCurrent } = require('./quick-picks');
const { isDirectProvider } = require('./provider-registry');
const { toDefaultAliases, listCuratedRoutes } = require('./curated-models');

/**
 * Tier pattern table: each tier holds a regex — or an ORDERED regex list,
 * tried first-match-wins — over the model segment after `<vendor>/` (or
 * `openrouter/<vendor>/`). List order expresses preference, which a single
 * regex cannot: ids sort numeric-descending, so `-pro` siblings would
 * otherwise outrank their same-priced base.
 */
const TIERS = {
  anthropic: {
    economy: /^claude-haiku-/,
    balanced: /^claude-sonnet-/,
    frontier: /^claude-opus-/,
  },
  openai: {
    // The 5.6 line renamed the flagship into tiers — luna ($0.10/$0.60 per
    // Mtok in/out), terra ($1/$6), sol ($5/$30), each with a -pro sibling
    // priced at its base tier; no bare/-mini/-pro 5.6 ids exist. Owner
    // ruling 2026-08-04: economy→luna, balanced→terra, frontier→sol, each
    // preferring the base name, then its -pro sibling, then the 5.5-era
    // naming so a stale catalog still resolves. balanced's primary is the
    // same bare-or-terra pattern the `gpt` family uses (curated-models.js),
    // so a future return to bare flagship ids is tracked automatically.
    economy: [/^gpt-[\d.]+-luna$/, /^gpt-[\d.]+-luna-pro$/, /^gpt-[\d.]+-mini$/],
    balanced: [/^gpt-[\d.]+(-terra)?$/, /^gpt-[\d.]+-terra-pro$/],
    frontier: [/^gpt-[\d.]+-sol$/, /^gpt-[\d.]+-sol-pro$/, /^gpt-[\d.]+-pro$/],
  },
  google: {
    economy: /^gemini-[\d.]+-flash-lite/,
    balanced: /^gemini-[\d.]+-flash(?!-lite)/,
    frontier: /^gemini-[\d.]+-pro/,
  },
  deepseek: {
    economy: /^deepseek-v[\d.]+$/,
    balanced: /^deepseek-v[\d.]+$/,
    frontier: /^deepseek-v[\d.]+-pro$/,
  },
};

/** Fallback preference order when the requested tier's pattern matches nothing. */
const TIER_ORDER = ['economy', 'balanced', 'frontier'];

/**
 * vendor -> curated alias, for vendors with no direct integration and no
 * TIERS entry. Built once from curated-models' OpenRouter-routed entries;
 * the first alias found per vendor wins (e.g. 'qwen' over its
 * 'qwen-coder'/'qwen-flash' siblings, since CARDLESS lists it first).
 * @returns {Object<string,string>}
 */
function buildGatewayOnlyAliasMap() {
  const map = {};
  for (const { alias, provider, model } of listCuratedRoutes()) {
    if (provider !== 'openrouter' || !model.startsWith('openrouter/')) { continue; }
    const rest = model.slice('openrouter/'.length); // '<vendor>/<rest...>'
    const slash = rest.indexOf('/');
    const vendor = slash > 0 ? rest.slice(0, slash) : null;
    if (!vendor || isDirectProvider(vendor) || TIERS[vendor] || map[vendor]) { continue; }
    map[vendor] = alias;
  }
  return map;
}

const GATEWAY_ONLY_ALIAS = buildGatewayOnlyAliasMap();

/**
 * First match wins over a tier's ordered patterns; within each pattern the
 * newest matching id is picked, direct namespace preferred over OpenRouter's.
 */
function pickForTier(catalog, vendor, patterns) {
  for (const regex of [].concat(patterns)) {
    const pick = pickCurrent(catalog, '', vendor, regex) || pickCurrent(catalog, 'openrouter/', vendor, regex);
    if (pick) { return pick; }
  }
  return null;
}

/** True when the catalog has ANY row (any tier) under this vendor's namespace, in either gateway. */
function vendorHasModels(catalog, vendor) {
  return Boolean(pickForTier(catalog, vendor, /./));
}

/**
 * @param {string} vendor
 * @param {'economy'|'balanced'|'frontier'} tier
 * @param {Array<{id:string}>} catalog
 * @returns {string|null} current live-catalog full id for vendor+tier
 *   (e.g. `anthropic/claude-sonnet-5`), or null when the vendor is unknown
 *   or absent from the catalog.
 */
function resolveTier(vendor, tier, catalog) {
  if (typeof vendor !== 'string' || !vendor) { return null; }
  if (!TIER_ORDER.includes(tier)) { return null; }

  const gatewayAlias = GATEWAY_ONLY_ALIAS[vendor];
  if (gatewayAlias) { return toDefaultAliases()[gatewayAlias] || null; }

  const table = TIERS[vendor];
  if (!table) { return null; }

  const direct = pickForTier(catalog, vendor, table[tier]);
  if (direct) { return direct; }

  if (!vendorHasModels(catalog, vendor)) { return null; }

  for (const t of TIER_ORDER) {
    const pick = pickForTier(catalog, vendor, table[t]);
    if (pick) { return pick; }
  }
  return null;
}

module.exports = { TIERS, TIER_ORDER, resolveTier };
