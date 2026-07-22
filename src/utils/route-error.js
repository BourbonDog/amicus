/**
 * @module route-error
 * Shared renderer (#61 Task 6.1): turns a router RouteResult — an error or a
 * selection_required — into the two surfaces that need to explain it:
 *   - `toStructuredError` -> the MCP-facing structured object
 *   - `toCliMessage`      -> a human stderr string for the CLI
 *
 * Pure module: no I/O, no requires of launch modules (cli.js/headless.js/
 * mcp-server.js/etc). Wired into live launch paths — start-helpers.js,
 * sidecar/fanout-leg.js, and mcp-server.js all render RouteResults through
 * toStructuredError/toCliMessage.
 *
 * Router error shape (src/utils/model-descriptor.js `routeError()`):
 *   {kind:'error', type:'model_route_error', field, requested, reason,
 *    preferredGateway, suggestions}
 * Selection shape (`selectionRequired()`):
 *   {kind:'selection_required', requested, suggestions}
 *
 * The router's error `reason` is NOT limited to the 7 values in
 * ROUTE_ERROR_REASONS below — that array is just the original/base set,
 * intentionally pinned as-is (see its own doc comment). The router can also
 * emit availability reasons (`direct_unavailable`, `openrouter_unavailable`),
 * which have REASON_TEXT/FIX_HINTS entries but are deliberately excluded from
 * ROUTE_ERROR_REASONS. A `selection_required` result has no `reason` of its
 * own — it is synthesized here as SELECTION_REQUIRED_REASON, kept in the same
 * documented REASON_TEXT map rather than invented ad hoc, so callers can
 * treat every rendered structured error the same way regardless of which
 * RouteResult produced it.
 */
'use strict';

/**
 * The original/base set of router error reasons — NOT an exhaustive list of
 * every reason a router error can carry. Pinned to exactly these 7 values by
 * a back-compat test (route-error.test.js:14-24), so this array must not be
 * extended when new reasons are added. The router also emits
 * `direct_unavailable` and `openrouter_unavailable` (REASON_TEXT/FIX_HINTS
 * below have entries for both); those are intentionally left out of this
 * array. Do not use ROUTE_ERROR_REASONS as an exhaustive switch/allow-list.
 */
const ROUTE_ERROR_REASONS = Object.freeze([
  'gateway_conflict',
  'no_openrouter_key',
  'no_direct_integration',
  'no_direct_key',
  'no_key_for_vendor',
  'model_not_found',
  'invalid_descriptor',
]);

/**
 * Synthesized reason for a `selection_required` RouteResult. Deliberately
 * distinct from 'model_not_found': the model wasn't missing, it was ambiguous
 * (multiple catalog candidates) and the router is asking the caller to pick.
 */
const SELECTION_REQUIRED_REASON = 'selection_required';

/** One-line, non-technical explanation of what went wrong, keyed by reason. */
const REASON_TEXT = Object.freeze({
  gateway_conflict: 'This model must go through OpenRouter, but --gateway direct was forced.',
  no_openrouter_key: 'No OpenRouter API key is configured.',
  no_direct_integration: 'This vendor has no direct API integration.',
  no_direct_key: "No API key is configured for this vendor's direct API.",
  no_key_for_vendor: 'No API key was found for this vendor via any gateway.',
  model_not_found: 'The requested model was not found in the catalog.',
  invalid_descriptor: 'The model identifier could not be parsed.',
  direct_unavailable: "This model isn't available on the vendor's direct API; use OpenRouter or a different model.",
  openrouter_unavailable: "This model isn't on OpenRouter; use --gateway direct or a different model.",
  no_openrouter_route: "Local providers can't be routed through OpenRouter.",
  no_local_key: 'No bearer token is configured for this local provider.',
  local_endpoint_unreachable: "The local endpoint didn't respond.",
  [SELECTION_REQUIRED_REASON]: 'Multiple models match your request; a specific one must be selected.',
});

/** Copy-paste fix guidance appended after the REASON_TEXT sentence. */
const FIX_HINTS = Object.freeze({
  gateway_conflict: "An openrouter/... model can't be forced with --gateway direct.",
  no_openrouter_key: 'Set OPENROUTER_API_KEY, or use --gateway direct.',
  no_direct_integration: 'This vendor has no direct integration; drop --gateway direct.',
  no_direct_key: 'Add a key with `amicus key <vendor> <key>`, or use --gateway openrouter.',
  no_key_for_vendor: 'Add a provider key or an OpenRouter key.',
  model_not_found: 'Run `amicus models --refresh`, or pass --no-validate-model.',
  invalid_descriptor: 'Use a vendor/model id or a configured alias.',
  direct_unavailable: 'Drop --gateway direct (use auto or --gateway openrouter), or pick a different model.',
  openrouter_unavailable: 'Use --gateway direct, or pick a different model.',
  no_openrouter_route: 'Drop --gateway openrouter — local endpoints route direct.',
  no_local_key: 'Add one with `amicus key <id> <token>`.',
  local_endpoint_unreachable: 'Start the local server, or pass --no-validate-model to skip the reachability check.',
  [SELECTION_REQUIRED_REASON]: 'Pick one of the suggestions below, or narrow the model id.',
});

/** @returns {Array} suggestions normalized to an array. */
function normalizeSuggestions(suggestions) {
  return Array.isArray(suggestions) ? suggestions : [];
}

/**
 * Render a router RouteResult (error or selection_required) into the
 * MCP-facing structured object. Pass-through/normalize for an `error` result;
 * synthesized for a `selection_required` result.
 * @param {object} result a RouteResult with kind 'error' or 'selection_required'
 * @returns {{type:'model_route_error', field:string, requested:*, reason:string,
 *   preferredGateway:(string|null), suggestions:Array}}
 */
function toStructuredError(result) {
  const r = result || {};
  if (r.kind === 'selection_required') {
    return {
      type: 'model_route_error',
      field: 'model',
      requested: r.requested,
      reason: SELECTION_REQUIRED_REASON,
      preferredGateway: null,
      suggestions: normalizeSuggestions(r.suggestions),
    };
  }
  // Router `error` result (kind:'error'): pass through/normalize.
  return {
    type: 'model_route_error',
    field: r.field || 'model',
    requested: r.requested,
    reason: r.reason,
    preferredGateway: r.preferredGateway || null,
    suggestions: normalizeSuggestions(r.suggestions),
  };
}

/**
 * Render a router RouteResult into a human stderr message: the reason's
 * one-line explanation, an optional "Did you mean" suggestion list, and a
 * fix hint.
 * @param {object} result a RouteResult with kind 'error' or 'selection_required'
 * @returns {string}
 */
function toCliMessage(result) {
  const err = toStructuredError(result);
  const sentence = REASON_TEXT[err.reason] || `Model routing error (${err.reason}).`;
  const lines = [err.requested ? `${sentence} (requested "${err.requested}")` : sentence];

  if (err.suggestions.length > 0) {
    lines.push('Did you mean:');
    for (const s of err.suggestions) {
      const note = s && s.note ? ` — ${s.note}` : '';
      lines.push(`  - ${s && s.model} (${s && s.gateway})${note}`);
    }
  }

  const hint = (result && result.hint) || FIX_HINTS[err.reason];
  if (hint) { lines.push(hint); }

  return lines.join('\n');
}

/**
 * v4.0 §7: map a RouteResult onto error-doc fields ({code, message, hint})
 * for buildErrorDoc/failJson — the CLI --json and MCP failure surfaces.
 * Key-shaped reasons map to MISSING_KEY; everything else is BAD_MODEL.
 * Suggestions are inlined into the message text (the error doc has no
 * structured suggestions slot; the hint carries the fix line).
 * @param {object} result a RouteResult with kind 'error' or 'selection_required'
 * @returns {{code: string, message: string, hint: (string|null)}}
 */
function toErrorDocFields(result) {
  const { ERROR_CODES } = require('./error-doc');
  // v4.2: a missing local bearer is key-shaped, not model-shaped (D12).
  const KEY_REASONS = ['no_openrouter_key', 'no_direct_key', 'no_key_for_vendor', 'no_local_key'];
  const err = toStructuredError(result);
  const sentence = REASON_TEXT[err.reason] || `Model routing error (${err.reason}).`;
  let message = err.requested ? `${sentence} (requested "${err.requested}")` : sentence;
  if (err.suggestions.length > 0) {
    message += ` Did you mean: ${err.suggestions.map((s) => s && s.model).filter(Boolean).join(', ')}?`;
  }
  return {
    code: KEY_REASONS.includes(err.reason) ? ERROR_CODES.MISSING_KEY : ERROR_CODES.BAD_MODEL,
    message,
    hint: (result && result.hint) || FIX_HINTS[err.reason] || null,
  };
}

module.exports = {
  toStructuredError,
  toCliMessage,
  toErrorDocFields,
  REASON_TEXT,
  ROUTE_ERROR_REASONS,
  SELECTION_REQUIRED_REASON,
};
