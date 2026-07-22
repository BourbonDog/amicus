/**
 * Pure gateway router (#61). Decides direct vs OpenRouter for a request using
 * only injected state (keys, catalogInfo, gatewayMode) — no I/O. Returns a
 * RouteResult (resolved | selection_required | error). Wired into live launch
 * paths via route-launch.js's resolveRouteForLaunch (start-helpers.js,
 * mcp-server.js, sidecar/fanout-validate.js).
 */
'use strict';

const { resolved, routeError, selectionRequired, parseDescriptor } = require('./model-descriptor');
const { classifyModel } = require('./model-classification');
const { isDirectProvider } = require('./provider-registry');

/** Build the executable id for a gateway. */
function executableFor(gateway, vendor, model) {
  return gateway === 'openrouter' ? `openrouter/${vendor}/${model}` : `${vendor}/${model}`;
}

/** Per-flavor remediation hint for an unreachable local endpoint / missing model. */
function localHint(entry, kind) {
  const f = entry && entry.flavor;
  if (kind === 'unreachable') {
    if (f === 'ollama') { return 'Is Ollama running? `ollama serve`'; }
    if (f === 'lmstudio') { return 'Start the LM Studio server (Developer → Start Server).'; }
    return `Check the server at ${entry && entry.baseURL}.`;
  }
  // model_not_found
  return f === 'ollama' ? `Model not pulled — \`ollama pull ${(entry && entry.model) || '<model>'}\`.`
    : `Load the model in ${f === 'lmstudio' ? 'LM Studio' : 'the server'} first.`;
}

/**
 * Local-provider branch (v4.2 §4.2). The vendor is a configured local provider
 * (key in req.localProviders). Returns a RouteResult; never consults the cached
 * catalog (route-time truth is the injected live probe).
 */
function resolveLocal(d, req) {
  const entry = req.localProviders[d.vendor];
  const executableId = executableFor('direct', d.vendor, d.model); // `<id>/<model>`, no openrouter/ prefix
  // 1. OpenRouter is never a local route.
  if (d.isExplicitOpenRouter || req.gatewayMode === 'openrouter') {
    return routeError({ requested: d.raw, reason: 'no_openrouter_route', preferredGateway: 'direct', suggestions: [] });
  }
  // 2. Declared-but-missing bearer.
  if (entry.apiKeyEnv && !entry.keyPresent) {
    return routeError({ requested: d.raw, reason: 'no_local_key', preferredGateway: 'direct', suggestions: [] });
  }
  const live = req.localLive || { status: 'skipped', models: [] };
  // 3. Unreachable (never reached under --no-validate-model — status is 'skipped' then).
  if (live.status === 'unreachable') {
    const e = routeError({ requested: d.raw, reason: 'local_endpoint_unreachable', preferredGateway: 'direct', suggestions: [] });
    e.hint = localHint(entry, 'unreachable');
    return e;
  }
  // 4. Reachable but the model is absent from the live roster.
  if (live.status === 'ok' && !live.models.includes(executableId)) {
    if (req.allowSelection) {
      const suggestions = live.models.slice(0, 6).map((id) => ({ model: id, gateway: 'local', note: 'available locally' }));
      return selectionRequired({ requested: d.raw, suggestions });
    }
    const e = routeError({ requested: d.raw, reason: 'model_not_found', preferredGateway: 'direct', suggestions: [] });
    e.hint = localHint({ ...entry, model: d.model }, 'model_not_found');
    return e;
  }
  // 5. Resolve. status 'skipped' → unverified notice (tri-state 'unknown').
  const notice = live.status === 'skipped'
    ? 'Local endpoint unverified (--no-validate-model); attempting anyway.' : undefined;
  return resolved({ model: executableId, gateway: 'local', executableId,
    provenance: { source: req.source, requested: d.raw, gatewayMode: req.gatewayMode }, notice });
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

/**
 * True when the given gateway is usable for this request: either the caller
 * didn't supply per-gateway ids at all (back-compat: nothing to check), or it
 * did and this specific gateway has a form in it.
 */
function hasForm(req, gateway) {
  return !req.gatewayIds || req.gatewayIds[gateway] !== undefined;
}

/** Resolve to a concrete gateway after the catalog gate passes. */
function finish(gateway, vendor, model, req) {
  const id = (req.gatewayIds && req.gatewayIds[gateway]) || executableFor(gateway, vendor, model);
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
  if (d.isExplicitOpenRouter && rq.gatewayMode === 'direct' && !(rq.localProviders && rq.localProviders[vendor])) {
    return routeError({ requested: d.raw, reason: 'gateway_conflict', preferredGateway: 'direct', suggestions: [] });
  }
  // 3. Explicit OR literal
  if (d.isExplicitOpenRouter && !(rq.localProviders && rq.localProviders[vendor])) {
    if (!rq.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, rq);
  }
  // 3.5 Local / OpenAI-compatible provider (v4.2 §4.2). Placed before the
  // gateway-only-vendor check so a local id shadows an OR vendor namespace for
  // bare descriptors (resolved Q6). Steps 2 and 3 above are BYPASSED for a local
  // vendor (see the two guards above), so an explicit openrouter/<id>/... literal
  // — with any gatewayMode — falls through to here and resolveLocal returns
  // no_openrouter_route. Grammar still outranks shadowing; it just reports the
  // local-specific reason instead of no_openrouter_key / gateway_conflict.
  if (rq.localProviders && Object.prototype.hasOwnProperty.call(rq.localProviders, vendor)) {
    return resolveLocal(d, rq);
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
    if (!hasForm(rq, 'openrouter')) {
      return routeError({ requested: d.raw, reason: 'openrouter_unavailable', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, rq);
  }
  // 6. Explicit --gateway direct
  if (rq.gatewayMode === 'direct') {
    if (!rq.keys[vendor]) {
      return routeError({ requested: d.raw, reason: 'no_direct_key', preferredGateway: 'direct', suggestions: [] });
    }
    if (!hasForm(rq, 'direct')) {
      return routeError({ requested: d.raw, reason: 'direct_unavailable', preferredGateway: 'direct', suggestions: [] });
    }
    return finish('direct', vendor, model, rq);
  }
  // 7. auto (direct-first)
  if (rq.keys[vendor] && hasForm(rq, 'direct')) {
    return finish('direct', vendor, model, rq);
  }
  if (rq.keys.openrouter && hasForm(rq, 'openrouter')) {
    return finish('openrouter', vendor, model, rq);
  }
  return routeError({ requested: d.raw, reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [] });
}

module.exports = { resolveRoute };
