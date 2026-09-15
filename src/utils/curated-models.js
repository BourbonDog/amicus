/** Family definitions (match rules) over the shipped pins in ./curated-pins.json (v3). */
/*
 * Families are MATCH RULES over the live catalog, not pinned truths:
 * src/utils/quick-picks.js resolves each family to the current catalog
 * flagship at setup time. The pinned routes live in ./curated-pins.json
 * (#238 D8 — `pins[alias].routes`, one executable id per gateway namespace,
 * with the `verifiedOn` date and an optional owner `ruling` beside each);
 * they are used only when the catalog cannot resolve a route (offline /
 * unkeyed provider) and to derive the static DEFAULT_ALIASES (runtime alias
 * resolution must never wait on the network). `amicus models --check` audits
 * every pinned route against the live catalog, warns when a family fallback
 * falls behind the live resolution, and names a newer same-tier sibling of a
 * cardless pin (informational, #238 Q7); `amicus aliases --review --owner`
 * (sidecar/aliases-owner.js) is the flow that MOVES a pin — a pin reaches
 * users only after a human accepted it there and committed the JSON.
 */

'use strict';

const { isDirectProvider } = require('./provider-registry');
const { loadCuratedPins } = require('./curated-pins');

/**
 * Wizard quick-pick families. `idPattern` matches the model segment after
 * `<vendorPath>/` (openrouter ns) or `<provider>/` (direct ns).
 * `directProviders` lists direct namespaces the quick-picks resolver may
 * resolve live from the catalog. Beyond `openrouter`, a per-provider route
 * in the family's pin (curated-pins.json) is OPTIONAL: when absent and the
 * catalog cannot resolve that namespace, the direct route is omitted (no
 * pinned guess is better than a wrong one).
 * `gpt`'s pattern intentionally matches a plain numeric flagship id
 * (gpt-5.5, gpt-6) OR that id's `-terra` tier variant (gpt-5.6-terra), and
 * excludes every other suffixed variant (-pro/-mini/-codex/-sol/-luna) —
 * see the tier-semantics comment on the entry below.
 */
const FAMILIES = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/,
    directProviders: ['google'] },
  { alias: 'gemini-pro', label: 'Gemini Pro-class', blurb: 'advanced reasoning',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-pro(-preview|-exp|-latest)?$/,
    directProviders: ['google'] },
  // 5.6 split the flagship into tiers: sol (premium, $5/$30), terra (mid,
  // $1/$6), luna (economy, $0.10/$0.60), each with a -pro sibling, plus the
  // unrelated gpt-5.3-codex family. Owner ruling: `gpt` tracks the TERRA
  // (mid) tier — sol/luna/pro variants and codex are excluded deliberately.
  // Bare numeric ids (gpt-5.5-style) stay matched as a within-family
  // fallback if the terra naming ever disappears from the catalog.
  { alias: 'gpt', label: 'GPT flagship', blurb: 'strong coding',
    vendorPath: 'openai',
    idPattern: /^gpt-[\d.]+(-terra)?$/,
    directProviders: ['openai'] },
  { alias: 'opus', label: 'Claude Opus-class', blurb: 'deep analysis',
    vendorPath: 'anthropic',
    idPattern: /^claude-opus-[\d.-]+$/,
    directProviders: ['anthropic'] },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    vendorPath: 'deepseek',
    idPattern: /^deepseek-v[\d.]+(-pro)?$/,
    directProviders: ['deepseek'] },
];
const FAMILY_ALIASES = new Set(FAMILIES.map(f => f.alias));

/**
 * @param {string} alias a family alias
 * @param {object} pins `loadCuratedPins().pins`
 * @returns {{routes: Object<string,string>, gatewayOnly?: true}} that family's pin
 * @throws {Error} when the data file has no pin for the family — a shipped-file
 *   defect that must be named, never a silently route-less family
 */
function pinFor(alias, pins) {
  if (!Object.prototype.hasOwnProperty.call(pins, alias)) {
    throw new Error(`curated-pins.json: no pin for family '${alias}'`);
  }
  return pins[alias];
}

/**
 * Alias-only entries (no wizard quick pick): every pin in curated-pins.json
 * whose alias is not a family alias, in file order. Every entry authors an
 * openrouter route; entries whose vendor's direct API genuinely serves the
 * model also author a direct route (claude/sonnet/haiku/fable). These pins
 * are the FALLBACK FLOOR — a fork with no CI alias map resolves its bench
 * here; the owner's machine and .github/amicus-ci-aliases.json run newer ids.
 * Cardless entries have no `idPattern`, so `models --check` asks whether the
 * OLD id still EXISTS and (#238 Q7) whether a newer same-tier sibling is
 * listed; scripts/check-ci-alias-pins.js asks the sibling question of the CI
 * alias map.
 * @param {object} pins `loadCuratedPins().pins`
 * @returns {Array<{alias: string, routes: Object<string,string>, gatewayOnly?: true}>}
 */
function cardlessEntries(pins) {
  return Object.keys(pins).filter(a => !FAMILY_ALIASES.has(a))
    .map(a => ({ alias: a, routes: pins[a].routes, gatewayOnly: pins[a].gatewayOnly }));
}

/**
 * @returns {Array} shallow-spread copies of the family definitions with
 * `fallback` attached from the data file (`pins[alias].routes`); `idPattern`
 * is intentionally a shared RegExp reference — safe because none use the g/y
 * flags (no lastIndex state) and callers treat it read-only.
 */
function getFamilies() {
  const { pins } = loadCuratedPins();
  return FAMILIES.map(f => ({
    ...f,
    directProviders: [...f.directProviders],
    fallback: { ...pinFor(f.alias, pins).routes },
  }));
}

/**
 * ⚠️ MECHANICAL primitive, NOT a routing decision (renamed from `toCanonicalDefault`,
 * issue 214 — model-canonicalization.js explains why that name was a trap). An id that
 * will be CALLED or STORED must come from directFormIfSafe/directFormIfProven. Strips
 * the `openrouter/` prefix off a pinned route when `<vendor>` has a direct integration
 * (provider-registry `isDirectProvider`), so the resulting bare
 * `<vendor>/<rest>` id is policy-routed by the gateway router (direct when a
 * direct key exists, OpenRouter otherwise). Gateway-only vendors (no direct
 * integration — e.g. qwen, x-ai, z-ai, mistralai, minimax, moonshotai,
 * bytedance-seed) are returned unchanged, since OpenRouter is their only
 * route anyway. Non-openrouter routes (already bare, or malformed) pass
 * through unchanged.
 * @param {string} route
 * @returns {string}
 */
function stripGatewayPrefix(route) {
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
  const { pins } = loadCuratedPins();
  const out = [];
  for (const f of FAMILIES) {
    for (const [provider, model] of Object.entries(pinFor(f.alias, pins).routes)) {
      out.push({ alias: f.alias, provider, model });
    }
  }
  for (const e of cardlessEntries(pins)) {
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
  const bare = stripGatewayPrefix(obj.openrouter); // safe only when ids are identical across gateways
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
 * authoring openrouter route is live. `gatewayOnly` mirrors a pin's
 * explicit routing-choice annotation (owner-ruled, in curated-pins.json):
 * suppress derived-form findings unconditionally and never suggest a direct
 * pairing.
 * @returns {Object<string, {directForm: 'authored'|'derived'|'none', gatewayOnly: boolean}>}
 */
function directFormProvenance() {
  const { pins } = loadCuratedPins();
  const out = {};
  const entryProv = (vendorPath, obj, gatewayOnly) => {
    const direct = directFormFor(vendorPath, obj);
    const directForm = !direct ? 'none' : (obj[vendorPath] ? 'authored' : 'derived');
    return { directForm, gatewayOnly: gatewayOnly === true };
  };
  for (const f of FAMILIES) { const pin = pinFor(f.alias, pins); out[f.alias] = entryProv(f.vendorPath, pin.routes, pin.gatewayOnly); }
  for (const e of cardlessEntries(pins)) { out[e.alias] = entryProv(vendorOf(e.routes.openrouter), e.routes, e.gatewayOnly); }
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
  // `__proto__: null` — v4.8 SI-22.4 round 3 (G-1). Read by BARE INDEXING
  // downstream, so a plain `{}` let an alias named 'toString'/'constructor'/
  // 'valueOf'/'hasOwnProperty' resolve off Object.prototype to a truthy
  // Function — including on the auto-repair path (`alias-resolver.js ::
  // autoRepairAlias`), which `getEffectiveAliases`'s own fix could never reach.
  // Full measurement + why THREE seeds were needed:
  // tests/council/preset-trim-mutants.js :: BUILDERPROTO (the named mutant).
  const { pins } = loadCuratedPins();
  const out = { __proto__: null };
  for (const f of FAMILIES) { out[f.alias] = gatewayRoutesFor(f.vendorPath, pinFor(f.alias, pins).routes); }
  for (const e of cardlessEntries(pins)) { out[e.alias] = gatewayRoutesFor(vendorOf(e.routes.openrouter), e.routes); }
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
 * `amicus doctor` and `amicus models --check` warn about the product's own
 * shipped defaults.
 */
function toDefaultAliases() {
  // `__proto__: null` — see toGatewayRoutes above. Becomes DEFAULT_ALIASES.
  const out = { __proto__: null };
  for (const [alias, routes] of Object.entries(toGatewayRoutes())) {
    out[alias] = routes.direct || routes.openrouter;
  }
  return out;
}

module.exports = {
  getFamilies, toDefaultAliases, stripGatewayPrefix, listCuratedRoutes, toGatewayRoutes,
  directFormProvenance, DIVERGENT_VENDORS
};
