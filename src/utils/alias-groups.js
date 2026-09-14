/**
 * @module utils/alias-groups
 * Vendor-derived alias grouping (issue 213). Moved VERBATIM out of
 * `electron/setup-ui-alias-groups.js` (#238 PR1 fix wave F5): `src/` code
 * (src/sidecar/aliases.js — the CLI `amicus aliases` list) must not require
 * from `electron/`, a layering violation the whole-branch review caught.
 * `electron/setup-ui-alias-groups.js` re-exports every symbol here so its
 * own callers (setup-ui-aliases.js, setup-ui.js) and their tests keep
 * working untouched.
 *
 * REUSE NOTE: the vendor parse is `vendorOf` from src/sidecar/fallback-chains.js
 * — the existing primitive, imported, not re-implemented. It PARSES a vendor
 * segment (it never emits an id that gets called), which is the same
 * ban-exempt category as the other allowlisted `vendorOf` callers in
 * .eslintrc.js. `groupModelsByFamily` (src/utils/model-fetcher.js) is
 * deliberately NOT reused: it keys on `id.split('/')[0]`, so every
 * `openrouter/...` alias would collapse into a single "OpenRouter" bucket —
 * exactly the grouping this file exists to avoid. Its DISPLAY half
 * (PROVIDER_FAMILY_NAMES) is reused below.
 */

'use strict';

const { vendorOf } = require('../sidecar/fallback-chains');
const { PROVIDER_FAMILY_NAMES, listDirectProviders } = require('./provider-registry');

/**
 * Display names for vendors seen in alias routes.
 *
 * DISPLAY ONLY — deliberately not folded into provider-registry's PROVIDERS,
 * which is a *capability* registry (env var, direct-vs-gateway, live fetch).
 * KNOWN_PROVIDERS / PROVIDER_ENV_MAP are derived from that list, so adding
 * `z-ai` there would claim Amicus can hold a z-ai API key. The five real
 * providers keep their single source of truth via PROVIDER_FAMILY_NAMES.
 * Module-private: nothing outside this file requires it directly.
 */
const ALIAS_VENDOR_LABELS = {
  ...PROVIDER_FAMILY_NAMES,
  // Vendors reachable through the gateway (curated + commonly pinned)
  'qwen': 'Qwen',
  'mistralai': 'Mistral AI',
  'z-ai': 'Z.AI',
  'minimax': 'MiniMax',
  'x-ai': 'xAI',
  'moonshotai': 'Moonshot AI',
  'bytedance-seed': 'ByteDance Seed',
  'thinkingmachines': 'Thinking Machines',
  'cognitivecomputations': 'Cognitive Computations',
  'inclusionai': 'InclusionAI',
  'nvidia': 'NVIDIA',
  'cohere': 'Cohere',
  'meta-llama': 'Meta Llama',
  'nousresearch': 'Nous Research',
  'perplexity': 'Perplexity',
  'microsoft': 'Microsoft',
  'ai21': 'AI21',
  'amazon': 'Amazon',
  // Local providers (src/utils/local-providers.js PRESETS / VALID_FLAVORS)
  'ollama': 'Ollama',
  'lmstudio': 'LM Studio',
  'vllm': 'vLLM',
};

/**
 * `some-new-vendor` -> `Some New Vendor`, so an unmapped vendor is not a raw slug.
 * @param {string} vendor
 * @returns {string}
 */
function titleCaseVendor(vendor) {
  return String(vendor).split(/[-_]/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Vendor key for an alias route. Wraps the shared `vendorOf` with the two
 * normalisations issue 213 flagged: case, and the leading `~` of a floating
 * OpenRouter id (`openrouter/~z-ai/glm-latest` must not form a second group
 * next to `z-ai`).
 * @param {string} route @returns {string} '' when there is no usable route
 */
function aliasVendorOf(route) {
  const v = vendorOf(route).toLowerCase();
  return v.charAt(0) === '~' ? v.slice(1) : v;
}

/**
 * Display label for a vendor key.
 * hasOwnProperty, not a bare lookup: vendor is derived from a user-editable
 * route, and `__proto__`/`constructor` would otherwise return prototype junk.
 * @param {string} vendor @returns {string}
 */
function vendorLabel(vendor) {
  if (!vendor) { return 'Other'; }
  const hit = Object.prototype.hasOwnProperty.call(ALIAS_VENDOR_LABELS, vendor)
    ? ALIAS_VENDOR_LABELS[vendor] : null;
  return hit || titleCaseVendor(vendor);
}

/** Direct-route vendors render first; everything else sorts by label. @type {string[]} */
const PREFERRED_VENDOR_ORDER = listDirectProviders();

/**
 * Bucket an alias map by route vendor.
 * INVARIANT: every own key of `aliases` lands in exactly one returned group —
 * there is no whitelist to miss, and the empty vendor is a real catch-all.
 * Order within a group follows the config's own key order.
 * @param {Object<string,string>} aliases
 * @returns {Array<{vendor: string, label: string, keys: string[]}>}
 */
function groupAliases(aliases) {
  const byVendor = new Map();
  for (const key of Object.keys(aliases || {})) {
    const vendor = aliasVendorOf(aliases[key]);
    if (!byVendor.has(vendor)) { byVendor.set(vendor, []); }
    byVendor.get(vendor).push(key);
  }
  const rank = (vendor) => {
    if (!vendor) { return Number.MAX_SAFE_INTEGER; } // catch-all group last
    const i = PREFERRED_VENDOR_ORDER.indexOf(vendor);
    return i === -1 ? PREFERRED_VENDOR_ORDER.length : i;
  };
  return Array.from(byVendor.entries())
    .map(([vendor, keys]) => ({ vendor, label: vendorLabel(vendor), keys }))
    .sort((a, b) => rank(a.vendor) - rank(b.vendor) ||
      a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
}

module.exports = { groupAliases, aliasVendorOf, vendorLabel, titleCaseVendor, PREFERRED_VENDOR_ORDER };
