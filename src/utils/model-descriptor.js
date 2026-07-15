/**
 * Model-descriptor grammar + RouteResult factories (#61).
 * Pure string classification — no I/O, no provider lookups. The resolver
 * (gateway-router.js) consumes Descriptors and returns RouteResults.
 */
'use strict';

const GATEWAY_MODES = ['auto', 'direct', 'openrouter'];
const OR_PREFIX = 'openrouter/';

/**
 * Classify a raw model string into a normalized descriptor.
 * Grammar:
 *   - `openrouter/<vendor>/<model>`  -> openrouter-literal (explicit force-OR)
 *   - `<vendor>/<model...>`          -> canonical (policy-routed)
 *   - known no-slash alias            -> alias (resolution deferred to caller)
 *   - anything else                   -> invalid (incl. unknown no-slash token)
 * @param {string} raw
 * @param {{aliases: Object<string,string>}} ctx
 * @returns {{raw:string, kind:string, vendor?:string, model?:string, isExplicitOpenRouter:boolean, error?:string}}
 */
function parseDescriptor(raw, ctx = {}) {
  const aliases = ctx.aliases || {};
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return { raw, kind: 'invalid', isExplicitOpenRouter: false, error: 'Empty model identifier' };
  }
  if (trimmed.startsWith(OR_PREFIX)) {
    const rest = trimmed.slice(OR_PREFIX.length);
    const parts = rest.split('/');
    if (parts.length < 2 || !parts[0] || !parts.slice(1).join('/')) {
      return { raw: trimmed, kind: 'invalid', isExplicitOpenRouter: true,
        error: `Malformed OpenRouter model id '${trimmed}' (expected openrouter/vendor/model)` };
    }
    return { raw: trimmed, kind: 'openrouter-literal', vendor: parts[0],
      model: parts.slice(1).join('/'), isExplicitOpenRouter: true };
  }
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length < 2 || !parts[0] || !parts.slice(1).join('/')) {
      return { raw: trimmed, kind: 'invalid', isExplicitOpenRouter: false,
        error: `Malformed model id '${trimmed}' (expected vendor/model)` };
    }
    return { raw: trimmed, kind: 'canonical', vendor: parts[0],
      model: parts.slice(1).join('/'), isExplicitOpenRouter: false };
  }
  if (Object.prototype.hasOwnProperty.call(aliases, trimmed)) {
    return { raw: trimmed, kind: 'alias', isExplicitOpenRouter: false };
  }
  return { raw: trimmed, kind: 'invalid', isExplicitOpenRouter: false,
    error: `Unknown model alias '${trimmed}'. Run 'amicus setup' to configure aliases, or use a vendor/model id.` };
}

/** @returns {{kind:'resolved', model:string, gateway:string, executableId:string, provenance:object, notice?:string}} */
function resolved({ model, gateway, executableId, provenance, notice }) {
  const out = { kind: 'resolved', model, gateway, executableId, provenance: provenance || {} };
  if (notice) { out.notice = notice; }
  return out;
}

/** @returns {{kind:'selection_required', requested:string, suggestions:Array}} */
function selectionRequired({ requested, suggestions }) {
  return { kind: 'selection_required', requested, suggestions: suggestions || [] };
}

/** @returns {{kind:'error', type:'model_route_error', ...}} */
function routeError({ field, requested, reason, preferredGateway, suggestions }) {
  return { kind: 'error', type: 'model_route_error', field: field || 'model',
    requested, reason, preferredGateway, suggestions: suggestions || [] };
}

module.exports = { GATEWAY_MODES, parseDescriptor, resolved, selectionRequired, routeError };
