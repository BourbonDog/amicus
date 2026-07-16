/**
 * Route-launch views (#61 gateway routing integration, Task 4.2).
 *
 * Read-only helpers consumed by resolveRouteForLaunch, which IS wired into
 * live launch paths (start-helpers.js, mcp-server.js, sidecar/fanout-validate.js).
 * Pure-ish: all I/O goes through the stubbable api-key-store / auth-json /
 * model-catalog modules.
 */
'use strict';

const { readApiKeys } = require('./api-key-store');
const { readAuthJsonKeys } = require('./auth-json');
const { KNOWN_PROVIDERS } = require('./provider-registry');

/**
 * Per-provider key presence across BOTH sources: env/.env (readApiKeys) and
 * OpenCode's auth.json (readAuthJsonKeys). True if either source has a key
 * for that provider (Foundation carry-forward, Decision 5).
 * @returns {Object<string,boolean>} map of provider id -> key present
 */
function buildLaunchKeys() {
  const env = readApiKeys(); // {openrouter:bool, google:bool, openai:bool, anthropic:bool, deepseek:bool}
  const authKeys = readAuthJsonKeys(); // {provider:string,...} (only providers with keys)
  const out = {};
  for (const p of KNOWN_PROVIDERS) {
    out[p] = !!env[p] || !!authKeys[p];
  }
  return out;
}

/**
 * Thin wrapper over model-catalog.getCatalogInfo() for route-resolution
 * callers that only need the models list and the last-refresh error, not the
 * full cache metadata. Never throws: a catalog error resolves to an empty
 * list with a sentinel error string.
 * @returns {Promise<{models: Array, lastRefreshError: string|null}>}
 */
async function getRouteCatalogInfo() {
  // Lazy-required so jest.doMock('./model-catalog', ...) can intercept it
  // per-test, matching the pattern model-catalog.js itself uses for its deps.
  const { getCatalogInfo } = require('./model-catalog');
  try {
    const info = await getCatalogInfo();
    return { models: info.models || [], lastRefreshError: info.lastRefreshError || null };
  } catch {
    return { models: [], lastRefreshError: 'catalog-unavailable' };
  }
}

/** Module version stamped onto `resolved` results' provenance (carry-forward). */
const ROUTE_VERSION = 1;

/**
 * Build up to ~6 labeled alternatives for a `selection_required` RouteResult
 * (#61 Task 6.3, spec Decision 10). Pure: reads only the already-parsed
 * descriptor plus the live keys/catalogInfo/gatewayIds the caller already
 * assembled.
 *
 * Two categories, in order:
 *  1. The SAME model via OpenRouter — only when an OpenRouter key is present
 *     AND the OR-namespaced id is actually present in the catalog (never
 *     suggest an id we can't confirm exists). For divergent vendors (e.g.
 *     Anthropic) `descriptor.model` may be the DASH-form direct id, so a
 *     reconstructed `openrouter/<vendor>/<model>` would never match the
 *     catalog's dot-form OR id -- when the caller's `gatewayIds.openrouter`
 *     is available (the catalog-correct form), it is used instead of
 *     reconstructing. Falls back to reconstruction when `gatewayIds` is
 *     absent (non-alias / full-id / non-divergent requests), so behavior
 *     there is unchanged.
 *  2. Up to 5 OTHER models in the same direct vendor namespace (ids starting
 *     `<vendor>/`, excluding the requested id itself and excluding any
 *     `openrouter/`-prefixed rows, which share the `<vendor>/` prefix check
 *     only when vendor === 'openrouter' and are filtered out defensively).
 *
 * @param {{vendor?: string, model?: string}} descriptor parsed Descriptor for
 *   the request that produced the selection_required (canonical or
 *   openrouter-literal — both carry vendor/model)
 * @param {Object<string,boolean>} keys per-provider key-presence map (buildLaunchKeys() shape)
 * @param {{models: Array<{id:string}>}} catalogInfo
 * @param {{direct?: string, openrouter?: string}} [gatewayIds] the same
 *   per-gateway id map resolveRouteForLaunch threads through resolveRoute
 *   (Task 3's bridge for divergent curated aliases); absent for non-alias /
 *   full-id / non-divergent requests
 * @returns {Array<{model:string, gateway:string, note:string}>}
 */
function buildSuggestions(descriptor, keys, catalogInfo, gatewayIds) {
  const suggestions = [];
  const vendor = descriptor && descriptor.vendor;
  const model = descriptor && descriptor.model;
  if (!vendor || !model) { return suggestions; }

  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  const requestedDirectId = `${vendor}/${model}`;

  if (keys && keys.openrouter) {
    const orId = (gatewayIds && gatewayIds.openrouter) || `openrouter/${vendor}/${model}`;
    if (models.some(m => m && m.id === orId)) {
      suggestions.push({ model: orId, gateway: 'openrouter', note: 'same model via OpenRouter' });
    }
  }

  const nsPrefix = `${vendor}/`;
  const sameVendor = models.filter(m =>
    m && typeof m.id === 'string' &&
    m.id.startsWith(nsPrefix) &&
    !m.id.startsWith('openrouter/') &&
    m.id !== requestedDirectId
  ).slice(0, 5);
  for (const m of sameVendor) {
    suggestions.push({ model: m.id, gateway: 'direct', note: `${vendor} model` });
  }

  return suggestions.slice(0, 6);
}

/**
 * One-time per-vendor notice when auto-routing migrates a both-key holder off
 * OpenRouter onto direct (#61 Task 5.1 — visible-migration guarantee: never
 * silent). Advisory only — never changes the routing decision, and a failed
 * persist (markMigrationNotified is itself best-effort) never blocks the
 * launch. Fires only when ALL of these hold:
 *  - the result actually resolved to gateway 'direct'
 *  - the caller did NOT explicitly force a gateway (gatewayMode === 'auto');
 *    an explicit --gateway direct means the user chose direct, no notice
 *  - the descriptor is not itself an explicit `openrouter/...` literal
 *  - the user holds an OpenRouter key (otherwise nothing is being migrated
 *    FROM)
 *  - this vendor hasn't already been notified (getRoutingConfig().migration_notified)
 * @param {{result:object, descriptor:object, gatewayMode:string, keys:object}} args
 * @returns {object} the (possibly mutated) result
 */
function maybeMigrationNotice({ result, descriptor, gatewayMode, keys }) {
  if (result.kind !== 'resolved' || result.gateway !== 'direct') { return result; }
  if (gatewayMode !== 'auto') { return result; }
  if (descriptor.isExplicitOpenRouter) { return result; }
  if (!keys.openrouter) { return result; }
  try {
    // Lazy-required so jest.doMock('./config', ...) can intercept it per-test.
    const { getRoutingConfig, markMigrationNotified } = require('./config');
    if (getRoutingConfig().migration_notified[descriptor.vendor]) { return result; }
    const notice = `Routing ${descriptor.vendor} via direct API (previously OpenRouter). ` +
      'Set routing.prefer: "openrouter" (or use --gateway openrouter) to restore.';
    result.notice = result.notice ? `${result.notice} ${notice}` : notice;
    markMigrationNotified(descriptor.vendor);
  } catch (_err) {
    // Advisory only: never let a lookup/persist failure change the routing
    // decision or block the launch.
  }
  return result;
}

/**
 * Comparison-only key for a gateway-native id: strip a leading `openrouter/`
 * prefix, lowercase, unify dot/dash separators. Lets a divergent vendor's
 * dash-form direct id, dot-form OpenRouter id, and a stale/reformatted
 * variant (e.g. toDefaultAliases()'s dotted default) collapse to one key
 * when they name the same model. Never used to construct/emit an id.
 * @param {string} id @returns {string|null}
 */
function normalizeForModelIndex(id) {
  if (typeof id !== 'string' || !id) { return null; }
  const rest = id.startsWith('openrouter/') ? id.slice('openrouter/'.length) : id;
  return rest.toLowerCase().replace(/\./g, '-');
}

/**
 * By-model index of every curated route pair (Task 3 Part 2 / spec D2): each
 * `{direct?, openrouter}` pair from toGatewayRoutes() is indexed under the
 * normalized form of BOTH its values, so a lookup BY RESOLVED MODEL (not
 * alias name) finds the pair regardless of which alias produced it or which
 * gateway-native form the caller's id is in.
 * @returns {Object<string,{direct?:string, openrouter?:string}>}
 */
function buildGatewayRoutesByModel() {
  const { toGatewayRoutes } = require('./curated-models');
  const byModel = {};
  for (const pair of Object.values(toGatewayRoutes())) {
    const directKey = normalizeForModelIndex(pair.direct);
    const orKey = normalizeForModelIndex(pair.openrouter);
    if (directKey) { byModel[directKey] = pair; }
    if (orKey) { byModel[orKey] = pair; }
  }
  return byModel;
}

/**
 * @param {string} resolvedId direct (`vendor/model`) or OR-prefixed
 *   (`openrouter/vendor/model`) gateway-native id
 * @returns {{vendor:string, bareModel:string}|null}
 */
function splitVendorAndModel(resolvedId) {
  if (typeof resolvedId !== 'string') { return null; }
  const rest = resolvedId.startsWith('openrouter/') ? resolvedId.slice('openrouter/'.length) : resolvedId;
  const idx = rest.indexOf('/');
  if (idx <= 0 || idx === rest.length - 1) { return null; }
  return { vendor: rest.slice(0, idx), bareModel: rest.slice(idx + 1) };
}

/**
 * Resolve `{direct?, openrouter?}` for `resolvedId`, for ANY alias — curated
 * default, user override, or vendor alias (Task 3 Part 2 / spec D2; retires
 * Part 1's curated-default-NAME-only guard). Two-step:
 *  1. By-model curated lookup (buildGatewayRoutesByModel()) — covers curated
 *     defaults byte-identically to Part 1, plus any alias resolving to the
 *     same underlying curated model.
 *  2. Catalog pairing fallback: for a DIVERGENT vendor not covered by (1),
 *     ask the live catalog (gateway-route-catalog's pairAcrossGateways,
 *     Task 5) to pair the two forms. Non-divergent vendors skip this — their
 *     ids already match across gateways, so `executableFor`'s fallback is
 *     already correct with no gatewayIds.
 * FAIL-OPEN: any miss/malformed-input/thrown-error resolves to `undefined`
 * (no gatewayIds) — never raises, never blocks a launch.
 * @param {string} resolvedId @param {{models: Array}} catalogInfo
 * @returns {{direct?:string, openrouter?:string}|undefined}
 */
function resolveGatewayIdsByModel(resolvedId, catalogInfo) {
  try {
    const key = normalizeForModelIndex(resolvedId);
    const byModel = key ? buildGatewayRoutesByModel() : null;
    if (byModel && byModel[key]) { return byModel[key]; }

    const split = splitVendorAndModel(resolvedId);
    if (!split) { return undefined; }
    const { DIVERGENT_VENDORS } = require('./curated-models');
    if (!DIVERGENT_VENDORS.has(split.vendor)) { return undefined; }

    const { pairAcrossGateways } = require('./gateway-route-catalog');
    const paired = pairAcrossGateways(split.vendor, split.bareModel, catalogInfo);
    return (paired && (paired.direct || paired.openrouter)) ? paired : undefined;
  } catch (_err) {
    return undefined; // fail-open: a lookup error must never block the launch.
  }
}

/**
 * Bridge: alias -> descriptor -> resolveRoute (Task 4.4; gatewayIds bridging
 * Task 3, generalized by-model in Part 2 Task 3 / spec D2).
 * Resolves a raw model string to a Descriptor — a known no-slash alias (per
 * getEffectiveAliases()) has its concrete id parsed instead, so an alias
 * pointing at an `openrouter/...` value is an explicit force-OR literal
 * while one pointing at a bare `vendor/model` is policy-routed normally.
 *
 * For ANY alias, the resolved concrete id is looked up BY MODEL via
 * resolveGatewayIdsByModel() and, when found, threaded through as
 * `gatewayIds` — the descriptor is then parsed from the gateway-native
 * direct form (falling back to openrouter) rather than the resolved alias
 * string itself, which can be the wrong per-gateway form for a divergent
 * vendor (e.g. Anthropic's dash ids vs. OpenRouter's dot ids). A user
 * override or vendor alias pointing at the same underlying model now gets
 * the same correct ids; one pointing at an uncovered model gets no
 * gatewayIds (fail-open). Full-id / non-alias inputs are unaffected.
 *
 * Assembles live key/catalog state and delegates the actual decision to the
 * pure gateway-router. Wired into start-helpers.js, mcp-server.js, and
 * sidecar/fanout-validate.js.
 * @param {{model:string, gatewayMode:string, source:string, allowSelection?:boolean, validateModel?:boolean}} opts
 * @returns {Promise<object>} RouteResult (resolved | selection_required | error)
 */
async function resolveRouteForLaunch({ model, gatewayMode, source, allowSelection, validateModel }) {
  // Lazy-required so jest.doMock('./config' | './model-descriptor' | './gateway-router', ...)
  // can intercept them per-test, matching the pattern already used above for model-catalog.
  const { getEffectiveAliases } = require('./config');
  const { parseDescriptor } = require('./model-descriptor');
  const { resolveRoute } = require('./gateway-router');
  const aliases = getEffectiveAliases();
  const isAlias = typeof model === 'string' && !model.includes('/') && !!aliases[model];
  let concrete = isAlias ? aliases[model] : model;
  const keys = buildLaunchKeys();
  // Skip the catalog fetch entirely under --no-validate-model (catalogGate
  // short-circuits without consulting catalogInfo when validateModel===false,
  // so fetching would be wasted network/latency). Moved up from after
  // descriptor parsing because the catalog-pairing fallback below needs it;
  // otherwise independent of the descriptor/alias, so no other effect.
  const catalogInfo = validateModel === false ? { models: [], lastRefreshError: null } : await getRouteCatalogInfo();
  let gatewayIds;
  if (isAlias) {
    gatewayIds = resolveGatewayIdsByModel(concrete, catalogInfo);
    if (gatewayIds) { concrete = gatewayIds.direct || gatewayIds.openrouter; }
  }
  const descriptor = parseDescriptor(concrete, { aliases });
  let result = resolveRoute({ descriptor, source, gatewayMode, allowSelection, validateModel, keys, catalogInfo, gatewayIds });
  if (result.kind === 'resolved') {
    result.provenance = { ...result.provenance, resolutionVersion: ROUTE_VERSION };
    result = maybeMigrationNotice({ result, descriptor, gatewayMode, keys });
  } else if (result.kind === 'selection_required') {
    result.suggestions = buildSuggestions(descriptor, keys, catalogInfo, gatewayIds);
  }
  return result;
}

module.exports = { buildLaunchKeys, getRouteCatalogInfo, resolveRouteForLaunch, buildSuggestions, ROUTE_VERSION };
