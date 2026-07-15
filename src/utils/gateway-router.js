/**
 * Pure gateway router (#61). Decides direct vs OpenRouter for a request using
 * only injected state (keys, catalogInfo, gatewayMode) — no I/O. Returns a
 * RouteResult (resolved | selection_required | error). Wiring into launch paths
 * is Plan 2; this module is behavior-neutral until then.
 */
'use strict';

const { resolved, routeError, selectionRequired } = require('./model-descriptor');
const { classifyModel } = require('./model-classification');
const { isDirectProvider } = require('./provider-registry');

/** Build the executable id for a gateway. */
function executableFor(gateway, vendor, model) {
  return gateway === 'openrouter' ? `openrouter/${vendor}/${model}` : `${vendor}/${model}`;
}

/**
 * Catalog gate: returns { ok:true, notice? } to proceed, or { ok:false, result }
 * carrying a selection_required/error to return to the caller.
 */
function catalogGate({ id, gateway, req }) {
  if (req.validateModel === false) {
    return { ok: true, notice: 'Model availability not validated (--no-validate-model).' };
  }
  const verdict = classifyModel(id, gateway, req.catalogInfo);
  if (verdict === 'valid') { return { ok: true }; }
  if (verdict === 'unknown') {
    return { ok: true, notice: `Model '${id}' is unverified against the ${gateway} catalog; attempting anyway.` };
  }
  // invalid
  if (req.allowSelection) {
    return { ok: false, result: selectionRequired({ requested: req.descriptor.raw, suggestions: [] }) };
  }
  return { ok: false, result: routeError({ requested: req.descriptor.raw, reason: 'model_not_found',
    preferredGateway: gateway, suggestions: [] }) };
}

/** Resolve to a concrete gateway after the catalog gate passes. */
function finish(gateway, vendor, model, req, extraNotice) {
  const id = executableFor(gateway, vendor, model);
  const gate = catalogGate({ id, gateway, req });
  if (!gate.ok) { return gate.result; }
  const notice = [extraNotice, gate.notice].filter(Boolean).join(' ') || undefined;
  return resolved({ model: id, gateway, executableId: id,
    provenance: { source: req.source, requested: req.descriptor.raw, gatewayMode: req.gatewayMode }, notice });
}

/**
 * @param {object} req see Task 5 Interfaces
 * @returns RouteResult
 */
function resolveRoute(req) {
  const d = req.descriptor;
  if (!d || d.kind === 'invalid') {
    return routeError({ requested: d ? d.raw : String(req && req.descriptor),
      reason: 'invalid_descriptor', preferredGateway: req.gatewayMode, suggestions: [] });
  }
  const vendor = d.vendor;
  const model = d.model;

  // 2. Explicit conflict: force-OR literal vs --gateway direct
  if (d.isExplicitOpenRouter && req.gatewayMode === 'direct') {
    return routeError({ requested: d.raw, reason: 'gateway_conflict', preferredGateway: 'direct', suggestions: [] });
  }
  // 3. Explicit OR literal
  if (d.isExplicitOpenRouter) {
    if (!req.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, req);
  }
  // 4. Gateway-only vendor (no direct integration)
  if (!isDirectProvider(vendor)) {
    if (req.gatewayMode === 'direct') {
      return routeError({ requested: d.raw, reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [] });
    }
    if (!req.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, req);
  }
  // 5. Explicit --gateway openrouter
  if (req.gatewayMode === 'openrouter') {
    if (!req.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, req);
  }
  // 6. Explicit --gateway direct
  if (req.gatewayMode === 'direct') {
    if (!req.keys[vendor]) {
      return routeError({ requested: d.raw, reason: 'no_direct_key', preferredGateway: 'direct', suggestions: [] });
    }
    return finish('direct', vendor, model, req);
  }
  // 7. auto (direct-first)
  if (req.keys[vendor]) {
    return finish('direct', vendor, model, req);
  }
  if (req.keys.openrouter) {
    return finish('openrouter', vendor, model, req);
  }
  return routeError({ requested: d.raw, reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [] });
}

module.exports = { resolveRoute };
