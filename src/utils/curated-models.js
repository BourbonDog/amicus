/** Family definitions + pinned fallbacks for the wizard model picker (v2). */
/*
 * Families are MATCH RULES over the live catalog, not pinned truths:
 * src/utils/quick-picks.js resolves each family to the current catalog
 * flagship at setup time. The pinned `fallback` ids are used only when
 * the catalog cannot resolve a route (offline / unkeyed provider) and to
 * derive the static DEFAULT_ALIASES (runtime alias resolution must never
 * wait on the network). `amicus models --check` audits every pinned route
 * here against the live catalog AND warns when a fallback falls behind
 * the live resolution.
 */

'use strict';

const { isDirectProvider } = require('./provider-registry');

/**
 * Wizard quick-pick families. `idPattern` matches the model segment after
 * `<vendorPath>/` (openrouter ns) or `<provider>/` (direct ns).
 * `directProviders` lists direct namespaces the quick-picks resolver may
 * resolve live from the catalog. A per-provider `fallback` entry is
 * OPTIONAL: when absent and the catalog cannot resolve that namespace,
 * the direct route is omitted (no pinned guess is better than a wrong one).
 * `gpt`'s pattern intentionally matches a plain numeric flagship id
 * (gpt-5.5, gpt-6) OR that id's `-terra` tier variant (gpt-5.6-terra), and
 * excludes every other suffixed variant (-pro/-mini/-codex/-sol/-luna) —
 * see the tier-semantics comment on the entry below.
 * Pinned ids verified against the live catalog 2026-08-04.
 */
const FAMILIES = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/,
    directProviders: ['google'],
    fallback: { openrouter: 'openrouter/google/gemini-3.6-flash',
                google: 'google/gemini-3.6-flash' } },
  { alias: 'gemini-pro', label: 'Gemini Pro-class', blurb: 'advanced reasoning',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-pro(-preview|-exp|-latest)?$/,
    directProviders: ['google'],
    fallback: { openrouter: 'openrouter/google/gemini-3.1-pro-preview' } },
  // 5.6 split the flagship into tiers: sol (premium, $5/$30), terra (mid,
  // $1/$6), luna (economy, $0.10/$0.60), each with a -pro sibling, plus the
  // unrelated gpt-5.3-codex family. Owner ruling: `gpt` tracks the TERRA
  // (mid) tier — sol/luna/pro variants and codex are excluded deliberately.
  // Bare numeric ids (gpt-5.5-style) stay matched as a within-family
  // fallback if the terra naming ever disappears from the catalog.
  { alias: 'gpt', label: 'GPT flagship', blurb: 'strong coding',
    vendorPath: 'openai',
    idPattern: /^gpt-[\d.]+(-terra)?$/,
    directProviders: ['openai'],
    fallback: { openrouter: 'openrouter/openai/gpt-5.6-terra' } },
  { alias: 'opus', label: 'Claude Opus-class', blurb: 'deep analysis',
    vendorPath: 'anthropic',
    idPattern: /^claude-opus-[\d.-]+$/,
    directProviders: ['anthropic'],
    // claude-opus-5 has no dotted version segment, so the two forms coincide —
    // the anthropic: route is still AUTHORED (DIVERGENT_VENDORS), never derived.
    // Direct id verified against Anthropic docs 2026-08-04.
    fallback: { openrouter: 'openrouter/anthropic/claude-opus-5',
                anthropic: 'anthropic/claude-opus-5' } },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    vendorPath: 'deepseek',
    idPattern: /^deepseek-v[\d.]+(-pro)?$/,
    directProviders: ['deepseek'],
    fallback: { openrouter: 'openrouter/deepseek/deepseek-v4-pro',
                deepseek: 'deepseek/deepseek-v4-pro' } },
];

/**
 * Alias-only entries (no wizard quick pick). Every entry authors an
 * openrouter route; entries whose vendor's direct API genuinely serves the
 * model also author a direct route (claude/sonnet/haiku/fable).
 * Refreshed against the live catalog 2026-08-04.
 */
const CARDLESS = [
  // gpt-pro: the 5.6 premium (sol) tier's pro sibling, priced at its base
  // tier ($5/$30 per Mtok). Owner ruling 2026-08-04: retargeted off
  // gpt-5.5-pro ($30/$180 — still served, but expected to sunset with the
  // 5.5 line). `gpt-pro` tracks SOL while the `gpt` family tracks terra —
  // see the tier-semantics comment on the `gpt` family above.
  // gatewayOnly (owner ruling 2026-08-05, recorded in the v4.6.3 spec): the
  // openrouter-only route is a deliberate routing choice — OpenAI's direct
  // namespace does not serve gpt-5.6-sol-pro, so the DERIVED direct form
  // must never be audited as stale and no direct pairing may be suggested.
  { alias: 'gpt-pro', gatewayOnly: true,
    routes: { openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } },
  // codex: newest codex-specific model on OpenRouter (verified 2026-06-09).
  { alias: 'codex', routes: { openrouter: 'openrouter/openai/gpt-5.3-codex' } },
  { alias: 'claude', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-5',
                                anthropic: 'anthropic/claude-sonnet-5' } },
  { alias: 'sonnet', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-5',
                                anthropic: 'anthropic/claude-sonnet-5' } },
  { alias: 'haiku', routes: { openrouter: 'openrouter/anthropic/claude-haiku-4.5',
                              anthropic: 'anthropic/claude-haiku-4-5-20251001' } },
  // fable: direct route authored 2026-08-05 (owner ruling R2, v4.6.3 spec §3).
  // Anthropic's /v1/models lists claude-fable-5 AND the direct route serves
  // (live smoke wave 47278069) — the entry was OpenRouter-only at authoring.
  { alias: 'fable', routes: { openrouter: 'openrouter/anthropic/claude-fable-5',
                              anthropic: 'anthropic/claude-fable-5' } },
  { alias: 'qwen', routes: { openrouter: 'openrouter/qwen/qwen3.7-max' } },
  { alias: 'qwen-coder', routes: { openrouter: 'openrouter/qwen/qwen3-coder-next' } },
  { alias: 'qwen-flash', routes: { openrouter: 'openrouter/qwen/qwen3.6-flash' } },
  { alias: 'mistral', routes: { openrouter: 'openrouter/mistralai/mistral-medium-3-5' } },
  // devstral was dropped 2026-08-04 (owner ruling): OpenRouter delisted the
  // whole devstral family and the alias had no other route. No retarget — no
  // served model is a devstral successor ("no pinned guess is better than a
  // wrong one"); `mistral` remains the vendor's alias.
  { alias: 'glm', routes: { openrouter: 'openrouter/z-ai/glm-5.1' } },
  { alias: 'minimax', routes: { openrouter: 'openrouter/minimax/minimax-m2.7' } },
  { alias: 'grok', routes: { openrouter: 'openrouter/x-ai/grok-4.3' } },
  { alias: 'kimi', routes: { openrouter: 'openrouter/moonshotai/kimi-k2.6' } },
  { alias: 'seed', routes: { openrouter: 'openrouter/bytedance-seed/seed-2.0-lite' } },
];

/**
 * @returns {Array} shallow-spread copies of the family definitions;
 * `idPattern` is intentionally a shared RegExp reference — safe because
 * none use the g/y flags (no lastIndex state) and callers treat it read-only.
 */
function getFamilies() {
  return FAMILIES.map(f => ({
    ...f,
    directProviders: [...f.directProviders],
    fallback: { ...f.fallback },
  }));
}

/**
 * Direct-first canonicalization for a pinned `openrouter/<vendor>/<rest>`
 * route: when `<vendor>` has a direct integration (provider-registry
 * `isDirectProvider`), strip the `openrouter/` prefix so the resulting bare
 * `<vendor>/<rest>` id is policy-routed by the gateway router (direct when a
 * direct key exists, OpenRouter otherwise). Gateway-only vendors (no direct
 * integration — e.g. qwen, x-ai, z-ai, mistralai, minimax, moonshotai,
 * bytedance-seed) are returned unchanged, since OpenRouter is their only
 * route anyway. Non-openrouter routes (already bare, or malformed) pass
 * through unchanged.
 * @param {string} route
 * @returns {string}
 */
function toCanonicalDefault(route) {
  if (typeof route === 'string' && route.startsWith('openrouter/')) {
    const rest = route.slice('openrouter/'.length); // '<vendor>/<rest...>'
    const slashIdx = rest.indexOf('/');
    const vendor = slashIdx > 0 ? rest.slice(0, slashIdx) : null;
    if (vendor && isDirectProvider(vendor)) { return rest; }
  }
  return route;
}

/**
 * @returns {Array<{alias,provider,model}>} every pinned route, flattened (for the alias audit).
 */
function listCuratedRoutes() {
  const out = [];
  for (const f of FAMILIES) {
    for (const [provider, model] of Object.entries(f.fallback)) {
      out.push({ alias: f.alias, provider, model });
    }
  }
  for (const e of CARDLESS) {
    for (const [provider, model] of Object.entries(e.routes)) {
      out.push({ alias: e.alias, provider, model });
    }
  }
  return out;
}

/**
 * Vendors whose direct-API ids differ from OpenRouter's (dot vs. dash
 * versioning, distinct model names, etc.). NEVER derive a direct form for
 * these — derivation would emit the wrong (dot) id, or invent a direct id
 * for a model the direct API does not serve (fable was that case until its
 * direct route was verified and authored, 2026-08-05).
 * Frozen so consumers can only read it (`.has()`) — a frozen Set still
 * supports lookups, it just can't be `.add()`/`.delete()`/`.clear()`-ed.
 */
const DIVERGENT_VENDORS = Object.freeze(new Set(['anthropic']));

/**
 * @param {string} orRoute e.g. 'openrouter/anthropic/claude-sonnet-5'
 * @returns {string} the vendor segment, e.g. 'anthropic'
 */
function vendorOf(orRoute) {
  const rest = orRoute.slice('openrouter/'.length);
  return rest.slice(0, rest.indexOf('/'));
}

/**
 * @param {string} vendorPath
 * @param {Object<string,string>} obj a family.fallback or cardless.routes map
 * @returns {string|undefined} the direct-API executable id, or undefined
 * when no direct form is available for this alias.
 */
function directFormFor(vendorPath, obj) {
  if (obj[vendorPath]) { return obj[vendorPath]; } // explicit, authored, current direct id
  if (DIVERGENT_VENDORS.has(vendorPath)) { return undefined; } // no explicit form + divergent → omit
  const bare = toCanonicalDefault(obj.openrouter); // safe only when ids are identical across gateways
  return bare !== obj.openrouter ? bare : undefined; // gateway-only vendor → undefined
}

/**
 * @param {string} vendorPath
 * @param {Object<string,string>} obj a family.fallback or cardless.routes map
 * @returns {{direct?: string, openrouter: string}}
 */
function gatewayRoutesFor(vendorPath, obj) {
  const routes = { openrouter: obj.openrouter };
  const direct = directFormFor(vendorPath, obj);
  if (direct) { routes.direct = direct; }
  return routes;
}

/**
 * Per-alias provenance of the `direct` form in toGatewayRoutes(), for the
 * auditors (alias-audit.js / gateway-route-audit.js): an AUTHORED direct
 * form absent from its namespace is stale; a DERIVED one is a computed
 * convenience whose absence is a routing fact, not staleness, while the
 * authoring openrouter route is live. `gatewayOnly` mirrors an entry's
 * explicit routing-choice annotation (owner-ruled): suppress derived-form
 * findings unconditionally and never suggest a direct pairing.
 * @returns {Object<string, {directForm: 'authored'|'derived'|'none', gatewayOnly: boolean}>}
 */
function directFormProvenance() {
  const out = {};
  const entryProv = (vendorPath, obj, gatewayOnly) => {
    const direct = directFormFor(vendorPath, obj);
    const directForm = !direct ? 'none' : (obj[vendorPath] ? 'authored' : 'derived');
    return { directForm, gatewayOnly: gatewayOnly === true };
  };
  for (const f of FAMILIES) { out[f.alias] = entryProv(f.vendorPath, f.fallback, f.gatewayOnly); }
  for (const e of CARDLESS) { out[e.alias] = entryProv(vendorOf(e.routes.openrouter), e.routes, e.gatewayOnly); }
  return out;
}

/**
 * @returns {Object<string,{direct?: string, openrouter: string}>} alias →
 * per-gateway executable ids. Unlike `toDefaultAliases` (a single pinned
 * string per alias, used for display/`config.default`), this carries BOTH
 * gateway-native forms so the router (Task 3) can route direct-first
 * without corrupting divergent-vendor ids (e.g. Anthropic's dash format).
 */
function toGatewayRoutes() {
  const out = {};
  for (const f of FAMILIES) { out[f.alias] = gatewayRoutesFor(f.vendorPath, f.fallback); }
  for (const e of CARDLESS) { out[e.alias] = gatewayRoutesFor(vendorOf(e.routes.openrouter), e.routes); }
  return out;
}

/**
 * @returns {Object<string,string>} alias → the SINGLE pinned route used for
 * display and `config.default`: the alias's authored direct form when one
 * exists, else its OpenRouter route. STATIC — runtime-safe, never networks.
 *
 * Derived from `toGatewayRoutes()` on purpose, so the two builders can never
 * disagree. It previously string-stripped `openrouter/` itself, which emitted
 * OpenRouter's dot ids for divergent vendors (`anthropic/claude-opus-4.8` —
 * the direct API only serves the dash form) and invented a bare direct id for
 * then-OpenRouter-only models (`fable`, direct-authored 2026-08-05). Both made
 * `amicus doctor` and `amicus
 * models --check` warn about the product's own shipped defaults.
 */
function toDefaultAliases() {
  const out = {};
  for (const [alias, routes] of Object.entries(toGatewayRoutes())) {
    out[alias] = routes.direct || routes.openrouter;
  }
  return out;
}

module.exports = {
  getFamilies, toDefaultAliases, toCanonicalDefault, listCuratedRoutes, toGatewayRoutes,
  directFormProvenance, DIVERGENT_VENDORS
};
