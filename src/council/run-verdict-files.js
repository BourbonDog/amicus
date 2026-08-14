// src/council/run-verdict-files.js
'use strict';

/**
 * @module council/run-verdict-files
 * The verdict half of the run-dir artifact set: verdict.json (with the nullable
 * overallVerdict and the derived seatLoss), report.html and chair-output.md.
 *
 * Lifted VERBATIM out of run-assemble.js for the 300-line gate (v4.8 PR4c
 * Task 2), on the same precedent as seats.js/preflightSeats: the body lives
 * here and run-assemble re-exports it, so `asm.writeVerdictFiles(...)` — the
 * only production call spelling (run-finish.js:63) — is untouched and no test
 * moved. This was the only consumer of run-assemble's `./verdict` and
 * `./report` requires, so the two came with it.
 */

const fs = require('fs');
const path = require('path');
const { buildVerdict, summarizeSeatLoss, deriveSeatLoss, writeVerdictAtomic } = require('./verdict');
const { buildReport } = require('./report');

/**
 * Undecided verdict + deterministic report. Sets the nullable overallVerdict
 * (council family v2, Plan A) on buildVerdict's output — independent of
 * buildVerdict's own signature.
 * @param {{runDir: string, record: object, overallVerdict?: (string|null),
 *   chairText?: string, critic?: string, deadWaves?: Array<object>,
 *   degrades?: Array<object>}} o `degrades` (v4.6 Plan 2), when present, is
 *   both carried onto the verdict and used to DERIVE `seatLoss` (deriveSeatLoss)
 *   in preference to summarizing it from `deadWaves` (summarizeSeatLoss).
 * @returns {object} the verdict written to disk
 */
function writeVerdictFiles({ runDir, record, overallVerdict, chairText, critic, deadWaves, degrades }) {
  // v4.6 Plan 2 (spec D3): when the sink's records are available they are the
  // single source of truth — seatLoss derives from them so it can never
  // disagree with degrades[]. deadWaves remains the fallback for direct
  // callers that predate the sink (their tests pass unedited).
  const seatLoss = degrades
    ? deriveSeatLoss({ runId: record.meta.runId, critic, degrades })
    : summarizeSeatLoss({ runId: record.meta.runId, critic, deadWaves });
  const verdict = buildVerdict(record, [], { seatLoss, degrades });
  verdict.overallVerdict = (overallVerdict === undefined) ? null : overallVerdict;
  writeVerdictAtomic(path.join(runDir, 'verdict.json'), verdict);
  const html = buildReport({ verdict }, { format: 'html' });
  fs.writeFileSync(path.join(runDir, 'report.html'), html, { mode: 0o600 });
  if (chairText) {
    fs.writeFileSync(path.join(runDir, 'chair-output.md'), chairText, { mode: 0o600 });
  }
  return verdict;
}

module.exports = { writeVerdictFiles };
