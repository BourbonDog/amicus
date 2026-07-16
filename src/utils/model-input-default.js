'use strict';

/**
 * @module model-input-default
 * Shared "no --model given" default-lookup, extracted so it lives in exactly
 * one place (#61 Task 6.2 review follow-up): both the CLI's resolveLaunchModel
 * (start-helpers.js) and the MCP amicus_start handler (mcp-server.js) need to
 * fall back to the configured default before handing a model off to
 * resolveRouteForLaunch — without it, an omitted model reaches
 * resolveRouteForLaunch as undefined -> parseDescriptor(undefined) -> an
 * `invalid` descriptor, breaking the common "no --model" launch case.
 * A leaf module (no other src/ module requires/mocks it), so introducing it
 * doesn't reshape any existing jest.doMock('../src/utils/route-launch', ...)
 * or jest.doMock('../src/utils/config', ...) call shape.
 */

/**
 * Resolve the raw model input for a launch: an explicit value (including one
 * a caller may have already normalized) passes through unchanged; otherwise
 * falls back to the configured default.
 * @param {string|null|undefined} inputModel
 * @returns {string|undefined} inputModel as-is, the configured default, or
 *   undefined if neither exists (the caller decides how to report that).
 */
function resolveModelInputOrDefault(inputModel) {
  if (inputModel !== undefined && inputModel !== null) { return inputModel; }
  const { loadConfig } = require('./config');
  const cfg = loadConfig();
  return (cfg && cfg.default) ? cfg.default : undefined;
}

module.exports = { resolveModelInputOrDefault };
