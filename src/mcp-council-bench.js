// src/mcp-council-bench.js
'use strict';

/**
 * @module mcp-council-bench
 * Bench resolution for `amicus_council_run` (models XOR council preset). Split
 * out of mcp-council-run.js (v4.6 Plan 4 Task 4b): that file sat at 298/300
 * lines and the --dropped-members producer (the MCP→child transport-parity
 * fix) needed the room. `resolveBenchInput` is self-contained — no dependency
 * on the handler's validation/spawn-argv logic — so it moves verbatim to its
 * own leaf; the old home (mcp-council-run.js) requires it back, so its one
 * call site keeps working unchanged. Never part of mcp-council-run.js's
 * module.exports (an internal helper, not a re-exported API), so no re-export
 * shim is needed there.
 */

/**
 * Resolve the bench: models XOR council preset (amicus_fanout parity).
 * Also returns `presetName` (v4.3 Task 3, spec §7.1): the trimmed council
 * preset name when that branch was taken, else null — this handler always
 * spawns the CLI child with an already-expanded `--models` list (never
 * `--council`), so the preset name would otherwise be lost; the caller
 * forwards it via the internal `--council-name` passthrough instead.
 */
function resolveBenchInput(input) {
  const inputModels = Array.isArray(input.models) ? input.models : [];
  const hasModels = inputModels.length > 0;
  const hasCouncil = typeof input.council === 'string' && input.council.trim();
  if (hasModels && hasCouncil) { return { error: "Pass exactly one of 'models' / 'council', not both." }; }
  if (!hasModels && !hasCouncil) { return { error: "Provide 'models' or 'council'." }; }
  if (hasCouncil) {
    const { resolveCouncilMembers } = require('./utils/config');
    const { readCache } = require('./utils/model-catalog');
    const catalog = (readCache() || {}).models || [];
    const presetName = input.council.trim();
    const expanded = resolveCouncilMembers(presetName, catalog);
    if (expanded.error) { return { error: expanded.error }; }
    // v4.5 Wave 2: the child never re-resolves (bench is spawned pre-expanded
    // to --models) — the pre-seed below is the only place this is recorded.
    return { bench: expanded.models, presetName, droppedMembers: expanded.droppedMembers || [] };
  }
  return { bench: inputModels, presetName: null, droppedMembers: [] };
}

module.exports = { resolveBenchInput };
