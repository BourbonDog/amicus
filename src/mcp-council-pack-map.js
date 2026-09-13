/**
 * @module mcp-council-pack-map
 * COUNCIL_PACK_PARAM_MAP, split out of mcp-council-run.js for the 300-line size gate (P2-R16).
 */

'use strict';

/**
 * v4.5 Task 15 (B7/F5): maps amicus_council_run's MCP input keys to the CLI
 * arg-key names applyPackToArgs's knob tables use (pack-resolve.js), so
 * applyPackToMcpInput can reuse those tables unchanged. `template` has no
 * Zod-declared counterpart on this tool (MCP has no template param of its
 * own — template/apply.js's own docblock: "MCP has no template params of its
 * own") — a pack's briefing.template is the ONLY way a template reaches this
 * handler, carried through as a plain (non-schema) `input.template` property
 * consumed by the render step in mcp-council-run.js.
 */
const COUNCIL_PACK_PARAM_MAP = {
  models: 'models', council: 'council', chair: 'chair', critic: 'critic', lenses: 'lenses',
  debate: 'debate', timeoutMinutes: 'timeout', maxCost: 'max-cost', gateway: 'gateway',
  template: 'template',
};

module.exports = { COUNCIL_PACK_PARAM_MAP };
