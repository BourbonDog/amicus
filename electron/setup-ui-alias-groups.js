/**
 * Setup UI - Alias grouping rule (issue 213)
 *
 * The Step 3 alias editor used to bucket rows with a hardcoded list of alias
 * NAMES, and `Other` was itself a fixed key list rather than a catch-all — so
 * any alias whose name was not on the list (a local-provider route, a `free-*`
 * council member, a case variant like `GLM`) rendered nowhere at all.
 *
 * Grouping is now derived from the alias's ROUTE VENDOR, which every alias has.
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
 *
 * SHARED-WITH-THE-BROWSER NOTE — deliberately NOT shared. The wizard's inline
 * script cannot `require`, so the browser could only get this rule as a copy:
 * hand-written (silent divergence — a 3-segment direct id like `a/b/c` already
 * splits differently under the two obvious spellings) or serialised from the
 * source below (which would put `slice('openrouter/'.length)` back into the
 * page). The page carrying its own gateway-prefix strip is the exact shape
 * issue 214 removed and that tests/setup-ui.test.js still guards
 * ("ships no routing policy to the page: ... no prefix derivation"), because
 * that copy is how a direct id gets fabricated for a namespace that never
 * served it.
 *
 * So there is ONE grouping rule and it lives here, server-side. The client
 * (setup-ui-alias-script.js) never derives a vendor: a route added during the
 * session goes into its own clearly-labelled "New routes" group, and vendor
 * filing happens when the server next renders the editor.
 */

const { vendorOf } = require('../src/sidecar/fallback-chains');
const { PROVIDER_FAMILY_NAMES, listDirectProviders } = require('../src/utils/provider-registry');

/**
 * Display names for vendors seen in alias routes.
 *
 * DISPLAY ONLY — deliberately not folded into provider-registry's PROVIDERS,
 * which is a *capability* registry (env var, direct-vs-gateway, live fetch).
 * KNOWN_PROVIDERS / PROVIDER_ENV_MAP are derived from that list, so adding
 * `z-ai` there would claim Amicus can hold a z-ai API key. The five real
 * providers keep their single source of truth via PROVIDER_FAMILY_NAMES.
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

/** `some-new-vendor` -> `Some New Vendor`, so an unmapped vendor is not a raw slug. */
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

/** Direct-route vendors render first; everything else sorts by label. */
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

/**
 * Heading for the client-side group that holds routes added during THIS
 * wizard session. Exported so the inline script and the tests name the same
 * string. Wording is deliberately non-committal about filing: the wizard's
 * Step 3 HTML is built from getDefaultAliases(), not from the saved config
 * (electron/setup-ui.js:45), so a custom alias is NOT vendor-filed on reopen
 * today — promising that in the label would be a falsehood.
 */
const NEW_ROUTES_GROUP_LABEL = 'New routes (this session)';

module.exports = {
  ALIAS_VENDOR_LABELS,
  NEW_ROUTES_GROUP_LABEL,
  aliasVendorOf,
  vendorLabel,
  groupAliases,
};
