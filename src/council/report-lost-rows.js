// src/council/report-lost-rows.js
'use strict';

/**
 * @module council/report-lost-rows
 * "What was lost" rows the tally already knows (#242, spec §5): one per runStats seat whose
 * findings came from a repair nothing could verify (`findingsUnverified`), one per refused
 * repair (`repairRefused`). Derived at RENDER time from `verdict.runStats` — never written into
 * run.json or verdict.json's `degrades[]`, never handed to the degrade sink — so the run's exit
 * code, its `degraded` state and every on-disk artifact are unchanged, and re-rendering an
 * older verdict.json shows the rows too.
 *
 * A LEAF over utils/degrade: the rows are `makeDegrade` records so both renderers print them
 * through `formatDegrade`, the report's one voice, and their channels sit in DEGRADE_CHANNELS
 * (the degrade-contract drift pin reads this file's `channel:` literals).
 *
 * ⚠️ The wording never says "stub". The flag means exactly what run-stages.js :: runStage1 says:
 * the ORIGINAL response carried no parseable findings block, so nothing could check the repair —
 * true of a vacuous repair and of a good review whose trailing JSON was malformed alike (study
 * run B2: a 19,064-byte review carried it). Both facts are tested with `=== true` / a plain
 * object, matching what tally.js emits; a hand-assembled truthy string is not a flag.
 *
 * `data.seat` is the row's label: the seat id when the bench repeats an alias, else the alias —
 * the `seat || model` rule the street-cred rows use in both renderers.
 *
 * Role and status are not consulted, on purpose: on every engine-written record a flagged row is a
 * completed bench seat (run-launch.js :: materializeReviews drops non-complete legs before any
 * repair runs; run-stages.js :: roleFor and seats.js :: buildSeats mint only bench roles), and
 * verdict-seats-reviewed.js :: seatsReviewedOf reads the same flag with the same trust — the two
 * never disagree on an engine-written record. A hand-assembled record that flags a judge or a
 * timed-out leg renders a row all the same; the row's wording describes an engine-written record.
 */

const { makeDegrade } = require('../utils/degrade');

function seatLabel(r) {
  if (typeof r.seat === 'string' && r.seat) { return r.seat; }
  if (typeof r.model === 'string' && r.model) { return r.model; }
  return 'unknown';
}

function unverifiedRow(r) {
  const seat = seatLabel(r);
  return makeDegrade({
    channel: 'unverified-repair',
    what: `seat ${seat}'s findings came from a repair of a response with no findings block`,
    why: 'nothing verified them',
    effect: 'the tiers they were given rest on the repair alone; the seat still counts as reviewed',
    data: { seat },
  });
}

function refusedRow(r) {
  const seat = seatLabel(r);
  const { code: rawCode, detail: rawDetail } = r.repairRefused;
  const code = (typeof rawCode === 'string' && rawCode.trim()) ? rawCode.trim() : 'REPAIR_REFUSED';
  const detail = (typeof rawDetail === 'string' && rawDetail.trim()) ? rawDetail.trim() : 'the repair broke its contract';
  return makeDegrade({
    channel: 'repair-refused',
    what: `seat ${seat}'s repair was refused (${code})`,
    why: detail,
    effect: 'the seat contributed no findings; its review text still reached the judges and it counts as reviewed',
    data: { seat, code },
  });
}

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/**
 * @param {*} runStats `verdict.runStats` — any shape: the report's entry points are schema-free
 *   JSON.parse (see report.js :: isSeatSpace), so THIS LEAF yields no rows rather than a throw on a
 *   non-array. That is the leaf's contract only — the cost table (report-cost.js) still throws on a
 *   non-array runStats, pre-existing and untouched here.
 * @returns {Array<object>} frozen makeDegrade records, in runStats order; `[]` when none.
 */
function lostRowsOf(runStats) {
  const rows = [];
  for (const r of (Array.isArray(runStats) ? runStats : [])) {
    if (!isPlainObject(r)) { continue; }
    if (r.findingsUnverified === true) { rows.push(unverifiedRow(r)); }
    if (isPlainObject(r.repairRefused)) { rows.push(refusedRow(r)); }
  }
  return rows;
}

module.exports = { lostRowsOf };
