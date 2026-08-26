// src/mcp-council-bench.js
'use strict';

/**
 * @module mcp-council-bench
 * Bench resolution for `amicus_council_run` (models XOR council preset), plus
 * the MCP transport's alias-shadow notice site (`auditBenchAliases`, PR #207
 * round 2 A1 — the mirror of what cli-council-run-bench.js owns for the CLI).
 * Split out of mcp-council-run.js (v4.6 Plan 4 Task 4b): that file sat at 298/300
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
 * Parallel twin: cli-council-run-bench.js's `resolveBench` wraps the same
 * `resolveCouncilMembers` core with its own XOR rules (CLI failJson docs there,
 * plain `{error}` strings here) and carries one guard this side lacks. The two
 * wrappers evolve independently — change a validation rule on one, change both.
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

/**
 * THE MCP-SIDE alias-shadow notice site (PR #207 council round 2, finding A1).
 *
 * The CLI's twin lives in `cli-council-run-bench.js :: resolveBench`; each
 * transport's bench module owns its own audit site, and both call the shared
 * `auditAliasShadows` entry point and nothing else.
 *
 * ⚠️ WHY A SECOND SITE AT ALL. Round 1 (finding A4) measured that the CLI seam
 * EXECUTES on the MCP path — `mcp-council-run.js` always spawns the child with
 * an expanded `--models` — but SURFACES nothing there: `spawnSidecarProcess`
 * gives the child `stdio: ['ignore','ignore',<fd>]` on `<runDir>/debug.log`, so
 * its stderr is a file the client never reads. This site writes into the tool
 * result instead, so the MCP caller actually sees it. The two copies live on
 * different surfaces (a tool-result block here; `debug.log` there), so neither
 * surface ever double-prints.
 *
 * Called from the HANDLER rather than from `resolveBenchInput` above, because
 * only the handler has the chair and the critic — and because the handler runs
 * on every council_run call while a wiring inside `resolveBenchInput` would sit
 * on both of its branches but still miss nothing else. Diagnosis only: this
 * changes no id, no exit code and no artifact.
 *
 * ⚠️ WHERE IN THE HANDLER, and why it moved (PR #207 round 5, A1). The call used
 * to sit beside the bench validation, ABOVE the critic+lenses mutual exclusion,
 * the lens-count mismatch and every later rejection. `notices` is only ever read
 * at the very end, when the tool result is assembled, so each of those
 * rejections computed an audit — reading the user's `config.json` off disk,
 * comparing two alias tables, formatting lines — and then discarded every line
 * with the rest of the result. Dead work, and it contradicted the CLI's "a
 * rejected bench is silent by construction" as well as the suite's own
 * rejected-run control (which passed only because it exercised the ONE rejection
 * that returns before the audit).
 *
 * So the site is now immediately after the spawn succeeds — the first point from
 * which the handler is guaranteed to return the success content. Everything left
 * below it is best-effort (the pid write, the notify request, auto-open), and
 * none of it can return early. "Never computed on a rejected call" is therefore
 * structural rather than a property of which rejections happen to sit above it,
 * which is what the previous placement got wrong.
 *
 * ⚠️ AND THE LINE IS RE-SHAPED FOR THIS SURFACE (PR #207 round 5, D3).
 * `formatAliasShadow` terminates every notice with `\n`, because both of its
 * stream writers need it to make the text a line. An MCP content block is not a
 * stream: its sibling notices (`pack-resolve.js`) carry no trailing newline, so
 * an un-trimmed alias-shadow block rendered with a stray blank line after it.
 * The trim lives HERE, at the one writer whose sink is not a stream, rather than
 * in `formatAliasShadow` — the newline is correct for the CLI and `models
 * --check`, and the round-4 sanitizing pins assert `endsWith('\n')` on that side.
 * @param {string[]} bench resolved bench seats (already expanded)
 * @param {string} chair explicit or default chair alias
 * @param {string|null} critic critic alias, when one was named
 * @param {string[]} notices the handler's per-call notice array (tool-result blocks)
 */
function auditBenchAliases(bench, chair, critic, notices) {
  require('./utils/alias-shadow').auditAliasShadows(
    [...bench, chair, ...(critic ? [critic] : [])],
    (line) => notices.push(String(line).trimEnd()));
}

module.exports = { resolveBenchInput, auditBenchAliases };
