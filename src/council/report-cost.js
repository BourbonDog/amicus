// src/council/report-cost.js
'use strict';

/**
 * @module council/report-cost
 * The report model's COST TABLE: `runStats[]` (+ the optional wave total) to the
 * `{rows, total}` half of the neutral model `council/report.js :: toModel`
 * returns. Extracted from ./report (v4.9 W8 T-A) for the same reason
 * ./report-md exists — report.js was at 296/300 and the task-intent fork it had
 * to grow did not fit. Nothing here is task-aware: this moved to make ROOM, and
 * the rendered bytes of every existing report are unchanged (measured: the four
 * report suites, including both .snap documents, are green across the move).
 *
 * ⚠️ NO back-require of ./report, unlike ./report-md and ./report-html — this
 * module needs neither TIER_ORDER nor SYMBOL, so report.js requires it eagerly
 * at load and there is no cycle to keep lazy.
 */

const { sumWaveUsage } = require('../utils/pricing');

// Cost-row role tag (Plan 2 final review F1, extended v4.7 D6): #83 gave
// judges their own runStats row, so a bench model can now appear twice
// (seat + judge), indistinguishable by `model` alone. v4.7's row-per-launch
// producers (chair-attempt/repair/superseded) create the exact same
// collision for their model. Tag ONLY these four roles — old verdicts have
// none of them, so chair/critic/lens/seat rows stay byte-identical to their
// historical rendering (report.test.js:189-199 pins the judge case exactly).
// Object.create(null): a plain `{...}` literal inherits Object.prototype, so a role
// literally named 'constructor'/'toString'/etc would resolve to an inherited (truthy)
// function via bracket lookup instead of `undefined` — silently corrupting that row's
// rendered model label. A null-prototype object has no inherited keys to collide with.
// ⚠️ Module scope, where toModel rebuilt it per call: it is a constant lookup that no
// caller can reach (not exported) and nothing mutates. Behaviour is identical — the
// digests in the T-A step-1 evidence are byte-for-byte the pre-move ones.
const ROLE_SUFFIX = Object.create(null);
ROLE_SUFFIX.judge = 'judge';
ROLE_SUFFIX['chair-attempt'] = 'chair-attempt';
ROLE_SUFFIX.repair = 'repair';
ROLE_SUFFIX.superseded = 'superseded';

/**
 * @param {Array<object>} runStats the verdict's runStats rows (already defaulted to [])
 * @param {object} [wave] optional wave.json — its usage total WINS when it carries one
 * @returns {{rows: Array<{model: string, status: string, durationMs: number, cost: object|null}>, total: object|null}}
 */
function buildCostModel(runStats, wave) {
  // v4.8 PR5a T5: name the row by its SEAT when it has one. On a twin bench the four
  // seat/judge rows were previously indistinguishable. Depends on T4 — with T5 alone only
  // the two seat rows separate, because judge rows carried no seat until then.
  // ⚠️ Only seat and judge rows carry one: repair, superseded and debate rows still
  // collapse on a twin, and the chair row is not a bench seat at all. Disclosed, not fixed.
  const rows = runStats.map(r => ({
    model: ROLE_SUFFIX[r.role] ? `${r.seat || r.model} (${ROLE_SUFFIX[r.role]})` : (r.seat || r.model),
    status: r.status, durationMs: r.durationMs,
    cost: r.usage && r.usage.cost ? r.usage.cost : null,
  }));
  const total = (wave && wave.usage && wave.usage.cost) ? wave.usage.cost : sumWaveUsage(runStats).cost;
  return { rows, total };
}

module.exports = { buildCostModel };
