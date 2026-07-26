// src/council/run-budget.js
'use strict';

/**
 * @module council/run-budget
 * The council driver's budget position (v4.4). Split out of src/council/run.js
 * to stay under the 300-line size gate; it is pure except for the one stderr
 * notice, and every member is injectable/observable so run.js's behaviour is
 * unchanged by the move.
 *
 * WHY THIS EXISTS AS ITS OWN CONCEPT. Before v4.4 the driver had a single
 * `spent()` that mapped a null cost amount to `0` and discarded
 * `sumWaveUsage`'s `unpricedLegs`/`source` entirely. Unknown spend was
 * therefore invisible to `--max-cost` AND to every reader of run.json:
 * `council-wsgate02` really spent $0.9859 against a $0.75 ceiling — a 131%
 * overrun — while `spent()` believed $0.3720 and never emitted COST_EXCEEDED
 * (.superpowers/sdd/v44/zero-usage-diagnosis.md §0/§9).
 *
 * OWNER'S RULING (Christian, v4.4): fail LOUD, not fail CLOSED —
 * "I don't want hitting a ceiling to stop us from solving real problems."
 * So an unknown-cost leg must NOT halt a run and must NOT by itself trip the
 * ceiling; the ceiling trips on KNOWN spend only. The uncertainty is instead
 * made impossible to miss. The failure mode being eliminated is SILENT
 * UNDER-REPORTING, not "continuing in the presence of uncertainty" — and
 * nothing here converts uncertainty into a fabricated number in either
 * direction (no rounding unknown up to a guess, no rounding it down to zero).
 */

const { sumWaveUsage } = require('../utils/pricing');

/**
 * @param {object} opts
 * @param {Array<object>} opts.allLegs live array the driver pushes every wave's legs into
 * @param {number|null|undefined} opts.maxCost the `--max-cost` ceiling, if any
 * @param {(s:string)=>void} [opts.write] stderr writer seam (defaults to process.stderr)
 * @returns {{spendState:Function, spent:Function, overBudget:Function,
 *   remainingBudget:Function, noticeUnknownSpend:Function}}
 */
function createBudget({ allLegs, maxCost, write }) {
  const emit = write || ((s) => process.stderr.write(s));
  const hasCeiling = maxCost !== null && maxCost !== undefined;

  /**
   * The run's position, split into what we KNOW was spent and how many legs we
   * cannot price at all. `known` is the sum of resolved amounts only — a leg
   * whose cost is `unknown` contributes nothing, because inventing a number for
   * it would be a fabrication. `unknownLegs` is what makes that omission
   * visible instead of silent: it is the count the run summary, the envelope,
   * `amicus spend` and the GUI all read to say "this total is a floor".
   */
  const spendState = () => {
    const c = sumWaveUsage(allLegs).cost;
    return {
      known: typeof c.amount === 'number' ? c.amount : 0,
      unknownLegs: c.unpricedLegs || 0,
      subtreeUnknownLegs: c.subtreeUnknownLegs || 0,
      cost: c,
    };
  };

  const spent = () => spendState().known;

  /** Trips on KNOWN spend only — see the ruling in the module docblock. */
  const overBudget = () => hasCeiling && spent() >= maxCost;

  /** Ceiling minus known spend, floored at 0; null when no ceiling is set.
   *  Threaded into each wave's fanout pre-flight estimate (run-launch.js). */
  const remainingBudget = () => (hasCeiling ? Math.max(maxCost - spent(), 0) : null);

  let noticed = false;
  /**
   * One prominent, un-missable notice per run when the total is incomplete — for
   * EITHER reason, which are different statements and are worded differently:
   *   - `unknownLegs`        — the leg reported no usage at all.
   *   - `subtreeUnknownLegs` — the leg's own cost is known, but it spawned a
   *     subagent whose CHILD session is billed separately and never enumerated.
   *     This is the one that made `council-wsgate01` report `costExact: true`
   *     while $0.0215 short — 100% of that gap was one `explore` child session.
   */
  const noticeUnknownSpend = () => {
    const s = spendState();
    if ((s.unknownLegs === 0 && s.subtreeUnknownLegs === 0) || noticed) { return; }
    noticed = true;
    const ceiling = hasCeiling ? ` or the $${maxCost} --max-cost ceiling` : '';
    const parts = [];
    if (s.unknownLegs > 0) {
      parts.push(`${s.unknownLegs} council leg(s) reported NO usage — their cost is UNKNOWN`);
    }
    if (s.subtreeUnknownLegs > 0) {
      parts.push(`${s.subtreeUnknownLegs} council leg(s) spawned a subagent whose CHILD session spend `
        + 'is billed separately and is NOT attributed');
    }
    emit(`Notice: ${parts.join('; and ')} and is NOT included in the $${s.known.toFixed(4)} `
      + `total${ceiling}. Real spend is HIGHER than reported — this total is at least, not exactly, `
      + 'what was spent. See run.json usage (unknownLegs / subtreeUnknownLegs), or '
      + '`amicus spend --json` (sourceMix.unknown).\n');
  };

  /**
   * The run summary's `usage` block. `costExact`/`unknownLegs` sit at the TOP of
   * it on purpose: `cost.unpricedLegs` always carried the count, but every reader
   * of `usage` looked one level up and saw only a number that read as
   * authoritative — the silent under-report the diagnosis measured at 62.3% on
   * council-wsgate02. Consumers: src/workspace/run-detail.js costPanel (the GUI
   * gauge + total), src/cli-handlers-council-run.js renderRunHuman, and the
   * `--json` manifest, which emits run.json verbatim.
   */
  const usageBlock = () => {
    const s = spendState();
    return {
      cost: s.cost,
      unknownLegs: s.unknownLegs,
      subtreeUnknownLegs: s.subtreeUnknownLegs,
      // v4.4 Task 2: `costExact` used to be `unknownLegs === 0`, which asks "did
      // every leg report tokens" — a statement about observation coverage of each
      // leg's OWN session, NOT about whether the total is complete. That is how
      // `council-wsgate01` asserted exactness while $0.0215 short: all 7 legs were
      // `source: 'reported'`, and 100% of the gap was one unattributed `explore`
      // child session. costExact must mean "this is the whole bill", so it now
      // requires BOTH: every leg observed, AND no leg with an unattributed subtree.
      costExact: s.unknownLegs === 0 && s.subtreeUnknownLegs === 0,
    };
  };

  return { spendState, spent, overBudget, remainingBudget, noticeUnknownSpend, usageBlock };
}

module.exports = { createBudget };
