// src/cli-council-run-render.js
'use strict';

/**
 * @module cli-council-run-render
 * Human-readable render of a finished `amicus council run` (the non-`--json`
 * output path, v4.0 spec §4). Split out of cli-handlers-council-run.js (v4.6
 * Plan 4 Task 2): that file sat at 298/300 lines and Plan 4 Task 3 adds the
 * #81 Workspace notice, which needed the room. `renderRunHuman` is
 * self-contained — no dependency on the handler's flag-parsing or engine
 * dispatch — so it moves verbatim to its own leaf; the old home
 * (cli-handlers-council-run.js) requires it back and re-exports it, so every
 * existing import path keeps working unchanged.
 */

function renderRunHuman(run) {
  const lines = [
    `Council run ${run.runId}: ${run.status} (exit ${run.exitCode})`,
    `  bench: ${(run.bench || []).join(', ')}  chair: ${run.chair}`,
    `  dir:   ${run.options && run.options.outDir}`,
  ];
  // v4.4: a cost line that omits unpriced legs reads as the whole bill. The
  // diagnosis measured council-wsgate02 printing $0.3720 for a run that really
  // spent $0.9859. Say what we know, then say what we cannot know — and print
  // the line even when NOTHING resolved (the old `typeof amount === 'number'`
  // guard silently dropped it, so a fully unpriced run looked free).
  const u = run.usage || null;
  const unknownLegs = u && typeof u.unknownLegs === 'number'
    ? u.unknownLegs
    : (u && u.cost && u.cost.unpricedLegs) || 0;
  // v4.4 Task 2: a fully-priced run can still be short. `council-wsgate01`
  // printed an unqualified $0.2821 for a run that really spent $0.3036 — every
  // leg `reported`, and 100% of the gap one unattributed `explore` child session.
  const subtreeLegs = u && typeof u.subtreeUnknownLegs === 'number'
    ? u.subtreeUnknownLegs
    : (u && u.cost && u.cost.subtreeUnknownLegs) || 0;
  if (u && u.cost && (typeof u.cost.amount === 'number' || unknownLegs > 0 || subtreeLegs > 0)) {
    const known = typeof u.cost.amount === 'number' ? `$${u.cost.amount.toFixed(4)}` : '$0.0000';
    const gaps = [];
    if (unknownLegs > 0) { gaps.push(`${unknownLegs} leg(s) unknown`); }
    if (subtreeLegs > 0) { gaps.push(`${subtreeLegs} leg(s) with unattributed subagent child-session spend`); }
    const tail = gaps.length > 0
      ? ` + ${gaps.join(' + ')} — real spend is at least this much`
      : '';
    lines.push(`  cost:  ${known} (${u.cost.source})${tail}`);
  }
  if (run.error) { lines.push(`  error: ${run.error.code}: ${run.error.message}`); }
  return lines.join('\n') + '\n';
}

module.exports = { renderRunHuman };
