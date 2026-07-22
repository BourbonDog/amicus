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
const { buildSuggestions, applySuggestions } = require('./route-suggestions');

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
 * resolveGatewayIdsByModel() and threaded through as `gatewayIds` — the
 * descriptor is then re-parsed from the gateway-native form (not the raw
 * alias string, which can be the wrong per-gateway form for a divergent
 * vendor, e.g. Anthropic's dash vs. OpenRouter's dot ids). Preserves Part
 * 1's force-OR contract: an alias whose ORIGINAL value is an explicit
 * `openrouter/...` literal prefers `gatewayIds.openrouter` (else falls back
 * to that original value); any other alias value prefers `gatewayIds.direct`
 * (else `.openrouter`) as before. Uncovered models get no gatewayIds
 * (fail-open); full-id/non-alias inputs are unaffected.
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
    const originalConcrete = concrete; // pre-gatewayIds alias value; may itself be an explicit `openrouter/...` literal
    gatewayIds = resolveGatewayIdsByModel(concrete, catalogInfo);
    if (gatewayIds) {
      // Force-OR contract (Part 1): an explicit openrouter/... alias value
      // stays on OpenRouter; only a bare vendor/model value prefers direct.
      concrete = originalConcrete.startsWith('openrouter/')
        ? (gatewayIds.openrouter || originalConcrete)
        : (gatewayIds.direct || gatewayIds.openrouter);
    }
  }
  const descriptor = parseDescriptor(concrete, { aliases });
  // v4.2: local-provider inputs (assembled in local-providers.js — 300-line gate).
  const { getLocalProviders, resolveLocalRouteInputs } = require('./local-providers');
  const { localProviders, localLive } =
    await resolveLocalRouteInputs(descriptor, { validateModel, providers: getLocalProviders() });
  let result = resolveRoute({ descriptor, source, gatewayMode, allowSelection, validateModel,
    keys, catalogInfo, gatewayIds, localProviders, localLive });
  if (result.kind === 'resolved') {
    result.provenance = { ...result.provenance, resolutionVersion: ROUTE_VERSION };
    result = maybeMigrationNotice({ result, descriptor, gatewayMode, keys });
  } else if (result.kind === 'selection_required') {
    applySuggestions(result, { descriptor, keys, catalogInfo, gatewayIds, localProviders });
  }
  return result;
}

module.exports = { buildLaunchKeys, getRouteCatalogInfo, resolveRouteForLaunch, buildSuggestions, ROUTE_VERSION };
