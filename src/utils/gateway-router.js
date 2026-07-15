/**
 * Pure gateway router (#61). Decides direct vs OpenRouter for a request using
 * only injected state (keys, catalogInfo, gatewayMode) — no I/O. Returns a
 * RouteResult (resolved | selection_required | error). Wiring into launch paths
 * is Plan 2; this module is behavior-neutral until then.
 */
'use strict';

const { resolved, routeError, selectionRequired, parseDescriptor } = require('./model-descriptor');
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
function finish(gateway, vendor, model, req) {
  const id = executableFor(gateway, vendor, model);
  const gate = catalogGate({ id, gateway, req });
  if (!gate.ok) { return gate.result; }
  return resolved({ model: id, gateway, executableId: id,
    provenance: { source: req.source, requested: req.descriptor.raw, gatewayMode: req.gatewayMode }, notice: gate.notice });
}

/**
 * @param {object} req see Task 5 Interfaces
 * @returns RouteResult
 */
function resolveRoute(req) {
  // 1. Normalize: req.descriptor may arrive as a parsed Descriptor object or a
  // raw canonical/OR-literal id string. Only canonical/openrouter-literal kinds
  // are routable; alias/invalid/garbage descriptors are rejected right here,
  // before any branch below touches vendor/model. All downstream code reads
  // from the normalized `d` (via the cloned `rq`), never from req.descriptor.
  let d = req.descriptor;
  if (typeof d === 'string') {
    d = parseDescriptor(d, { aliases: {} });
  }
  if (!d || (d.kind !== 'canonical' && d.kind !== 'openrouter-literal')) {
    const requested = d ? d.raw : (typeof req.descriptor === 'string' ? req.descriptor : String(req && req.descriptor));
    return routeError({ requested, reason: 'invalid_descriptor', preferredGateway: req.gatewayMode, suggestions: [] });
  }
  const rq = { ...req, descriptor: d };
  const vendor = d.vendor;
  const model = d.model;

  // 2. Explicit conflict: force-OR literal vs --gateway direct
  if (d.isExplicitOpenRouter && rq.gatewayMode === 'direct') {
    return routeError({ requested: d.raw, reason: 'gateway_conflict', preferredGateway: 'direct', suggestions: [] });
  }
  // 3. Explicit OR literal
  if (d.isExplicitOpenRouter) {
    if (!rq.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, rq);
  }
  // 4. Gateway-only vendor (no direct integration)
  if (!isDirectProvider(vendor)) {
    if (rq.gatewayMode === 'direct') {
      return routeError({ requested: d.raw, reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [] });
    }
    if (!rq.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, rq);
  }
  // 5. Explicit --gateway openrouter
  if (rq.gatewayMode === 'openrouter') {
    if (!rq.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, rq);
  }
  // 6. Explicit --gateway direct
  if (rq.gatewayMode === 'direct') {
    if (!rq.keys[vendor]) {
      return routeError({ requested: d.raw, reason: 'no_direct_key', preferredGateway: 'direct', suggestions: [] });
    }
    return finish('direct', vendor, model, rq);
  }
  // 7. auto (direct-first)
  if (rq.keys[vendor]) {
    return finish('direct', vendor, model, rq);
  }
  if (rq.keys.openrouter) {
    return finish('openrouter', vendor, model, rq);
  }
  return routeError({ requested: d.raw, reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [] });
}

module.exports = { resolveRoute };
