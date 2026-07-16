/**
 * Route-launch views (#61 gateway routing integration, Task 4.2).
 *
 * Additive, read-only helpers consumed by Task 4.4's resolveRouteForLaunch
 * (not wired into any launch path yet). Pure-ish: all I/O goes through the
 * stubbable api-key-store / auth-json / model-catalog modules.
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
 * descriptor plus the live keys/catalogInfo the caller already assembled.
 *
 * Two categories, in order:
 *  1. The SAME model via OpenRouter — only when an OpenRouter key is present
 *     AND the OR-namespaced id (`openrouter/<vendor>/<model>`) is actually
 *     present in the catalog (never suggest an id we can't confirm exists).
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
 * @returns {Array<{model:string, gateway:string, note:string}>}
 */
function buildSuggestions(descriptor, keys, catalogInfo) {
  const suggestions = [];
  const vendor = descriptor && descriptor.vendor;
  const model = descriptor && descriptor.model;
  if (!vendor || !model) { return suggestions; }

  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  const requestedDirectId = `${vendor}/${model}`;

  if (keys && keys.openrouter) {
    const orId = `openrouter/${vendor}/${model}`;
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
 * Bridge: alias -> descriptor -> resolveRoute (Task 4.4).
 * Resolves a raw model string to a Descriptor — if it is a known no-slash
 * alias (per getEffectiveAliases()), its concrete id is parsed instead, so an
 * alias pointing at an `openrouter/...` value is treated as an explicit,
 * force-OR literal while an alias pointing at a bare `vendor/model` is
 * policy-routed like any other canonical id. Assembles live key/catalog state
 * and delegates the actual decision to the pure gateway-router. Additive:
 * not wired into any launch path yet.
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
  const concrete = (typeof model === 'string' && !model.includes('/') && aliases[model]) ? aliases[model] : model;
  const descriptor = parseDescriptor(concrete, { aliases });
  const keys = buildLaunchKeys();
  // Skip the catalog fetch entirely under --no-validate-model: gateway-router's
  // catalogGate short-circuits to { ok:true } as soon as validateModel === false,
  // never consulting catalogInfo, so fetching it here would be wasted
  // latency/network (and can hit the network on a cold cache) for no benefit.
  // Strict === false (not just falsy) so this stays in lockstep with catalogGate's
  // own `=== false` guard: any other value (incl. an omitted flag) still fetches,
  // so a caller can never skip the fetch while the gate still classifies against it.
  const catalogInfo = validateModel === false ? { models: [], lastRefreshError: null } : await getRouteCatalogInfo();
  let result = resolveRoute({ descriptor, source, gatewayMode, allowSelection, validateModel, keys, catalogInfo });
  if (result.kind === 'resolved') {
    result.provenance = { ...result.provenance, resolutionVersion: ROUTE_VERSION };
    result = maybeMigrationNotice({ result, descriptor, gatewayMode, keys });
  } else if (result.kind === 'selection_required') {
    result.suggestions = buildSuggestions(descriptor, keys, catalogInfo);
  }
  return result;
}

module.exports = { buildLaunchKeys, getRouteCatalogInfo, resolveRouteForLaunch, buildSuggestions, ROUTE_VERSION };
