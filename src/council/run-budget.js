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
 *
 * v4.4.1 CA-6 completes that posture at the EXIT CODE (see inexactUnderCeiling
 * below): a ceiling never blocks, but a run under a ceiling no longer exits 0
 * while publishing a total it knows is only a floor.
 */

const { sumWaveUsage } = require('../utils/pricing');

/**
 * @param {object} opts
 * @param {Array<object>} [opts.allLegs] live array the driver pushes every wave's legs into
 * @param {number|null|undefined} opts.maxCost the `--max-cost` ceiling, if any
 * @param {string} [opts.runDir] run directory; when given, budget refusals are
 *   checkpointed into run.json so the record outlives the stderr notice
 * @param {{value: boolean}} [opts.degraded] the driver's degrade flag; a budget
 *   refusal sets it so the run can never exit 0 with a silently shrunken bench
 * @param {(s:string)=>void} [opts.write] stderr writer seam (defaults to process.stderr)
 * @returns {{spendState:Function, spent:Function, overBudget:Function,
 *   remainingBudget:Function, noticeUnknownSpend:Function, usageBlock:Function,
 *   addWave:Function, reserveBudget:Function, releaseBudget:Function,
 *   noteBudgetRefusal:Function, budgetRefusals:Function, inexactUnderCeiling:Function}}
 */
function createBudget({ allLegs, maxCost, runDir, degraded, write }) {
  const legs = allLegs || [];
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
    const c = sumWaveUsage(legs).cost;
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

  // ---- Concurrency-safe reservations (v4.4 cost-council finding 1) ----------
  /**
   * THE DEFECT. `launchStage1()` builds the seat wave and the critic wave
   * concurrently under one `Promise.all`, and each launcher called
   * `remainingBudget()` BEFORE either wave's legs had been appended to `legs`.
   * Both therefore observed the full, unreduced allowance, and both could pass
   * a soft gate that — taken together — exceeded `--max-cost`. Only run.js's
   * post-Stage-1 `overBudget()` noticed, by which point the money was committed.
   * A read is not a claim.
   *
   * THE FIX. `reserveBudget` is a SYNCHRONOUS read-and-claim. Synchronicity is
   * the entire guarantee: the JS event loop cannot interleave two callers inside
   * a synchronous function, so a second concurrent wave necessarily observes the
   * first wave's claim. No mutex, no async barrier, nothing to deadlock.
   *
   * WHY NOT SPLIT THE QUOTA. Handing each concurrent wave a fixed share is also
   * safe but is strictly MORE refusing than the ceiling requires: three cheap
   * seats plus one expensive critic can fit a ceiling that no proportional split
   * admits. The owner's standing ruling is fail LOUD, not fail CLOSED — so the
   * gate must refuse only what genuinely does not fit. First claim wins; a wave
   * refused here does not stop the run (see noteBudgetRefusal).
   */
  const reservations = new Map(); // waveId -> pre-flight estimate ($)
  const reserved = () => { let t = 0; for (const v of reservations.values()) { t += v; } return t; };

  /** Ceiling minus known spend MINUS outstanding reservations, floored at 0;
   *  null when no ceiling is set. Threaded into each wave's fanout pre-flight
   *  estimate as its starting allowance (run-launch.js). */
  const remainingBudget = () => (hasCeiling ? Math.max(maxCost - spent() - reserved(), 0) : null);

  /**
   * Atomically claim `estimate` against the allowance no sibling wave has taken.
   * @returns {boolean} false ONLY when the estimate genuinely does not fit.
   *   A $0 / unpriced / non-numeric estimate always fits: unknown cost must
   *   never halt a run (the same ruling that keeps it out of `overBudget`).
   */
  const reserveBudget = (waveId, estimate) => {
    if (!hasCeiling) { return true; }
    const est = (typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0) ? estimate : 0;
    if (est > remainingBudget()) { return false; }
    reservations.set(waveId, (reservations.get(waveId) || 0) + est);
    return true;
  };

  /** Drop a wave's outstanding claim (its real spend now speaks for it). */
  const releaseBudget = (waveId) => { reservations.delete(waveId); };

  /**
   * Record a finished wave: its ESTIMATE stops counting and its MEASURED legs
   * start counting, in one synchronous step so no concurrent launcher can ever
   * observe a moment where the wave counts twice or not at all.
   */
  const addWave = (wave) => {
    if (!wave) { return; }
    if (wave.waveId) { releaseBudget(wave.waveId); }
    if (Array.isArray(wave.legs)) { legs.push(...wave.legs); }
  };

  /**
   * A wave the ceiling refused. POLICY (the owner's ruling applied to
   * concurrency): the run CONTINUES with a partial bench — it never rolls back
   * waves already launched (that would destroy paid work) and never aborts
   * (that is fail-closed). What it must never do is lose the seat SILENTLY, so
   * every refusal is announced on stderr, kept on run.json, and degrades the
   * run's exit code. Stage 1's existing quorum gate still refuses to call a
   * bench of fewer than two reviews a council.
   */
  const refusals = [];
  const noteBudgetRefusal = (info) => {
    const rec = { waveId: (info && info.waveId) || null, models: (info && info.models) || [],
      reason: 'max-cost', at: new Date().toISOString() };
    refusals.push(rec);
    if (degraded) { degraded.value = true; }
    emit(`Notice: the $${maxCost} --max-cost ceiling refused wave ${rec.waveId} `
      + `(${rec.models.join(', ') || 'no models'}) — those seats DID NOT LAUNCH and are missing from `
      + 'this council. The run continues with the bench that did launch and will exit degraded (2). '
      + 'Raise --max-cost, or pass --no-cost-gate, to seat them.\n');
    if (runDir) {
      // Never let bookkeeping sink a run that is otherwise fine.
      try { require('./run-state').checkpoint(runDir, { budgetRefusals: refusals.slice() }); }
      catch (e) { emit(`Notice: could not record the budget refusal in run.json: ${e.message}\n`); }
    }
  };
  const budgetRefusals = () => refusals.slice();

  // ⚠️ v4.4.1 CA-3: a plain `noticed` boolean announced the FIRST unknown leg and
  // silently swallowed every one created afterwards (Stage 2, repairs, debate,
  // chair) — run.json kept the correct final count, so the data was right and
  // only the announcement was wrong, which is exactly the failure mode the
  // fail-loud posture exists to prevent. Track the count that was last announced
  // instead, so a GROWING total re-announces while an unchanged one stays quiet:
  // the notice keeps its "once per new fact" character without going silent on
  // the later stages. (The alternative — deferring every notice to finalize() —
  // was rejected: the notice exists to inform a decision still in flight.)
  let noticedAt = -1;
  /**
   * One prominent, un-missable notice each time the incomplete total GROWS (see
   * `noticedAt` above; re-calling it with nothing new is silent) — for EITHER
   * reason, which are different statements and are worded differently:
   *   - `unknownLegs`        — the leg reported no usage at all.
   *   - `subtreeUnknownLegs` — the leg's own cost is known, but it spawned a
   *     subagent whose CHILD session is billed separately and whose spend the
   *     walk could NOT account for. This is the one that made
   *     `council-wsgate01` report `costExact: true` while $0.0215 short — 100%
   *     of that gap was one `explore` child session.
   *
   * v4.4.1 CA-1: child sessions are now enumerated and their measured spend IS
   * attributed (`cost.subtreeCost`), so this second bucket has narrowed to the
   * subtrees the walk genuinely could not price. It is deliberately still a
   * separate statement from an unpriced leg: "we could not see this leg at all"
   * and "we saw this leg but not what it spawned" are different facts.
   */
  const noticeUnknownSpend = () => {
    const s = spendState();
    const n = s.unknownLegs + s.subtreeUnknownLegs;
    if (n === 0 || n === noticedAt) { return; }
    noticedAt = n;
    const ceiling = hasCeiling ? ` or the $${maxCost} --max-cost ceiling` : '';
    const parts = [];
    if (s.unknownLegs > 0) {
      parts.push(`${s.unknownLegs} council leg(s) reported NO usage — their cost is UNKNOWN`);
    }
    if (s.subtreeUnknownLegs > 0) {
      parts.push(`${s.subtreeUnknownLegs} council leg(s) spawned a subagent whose CHILD session spend `
        + 'is billed separately and could NOT be determined');
    }
    // v4.4.1 A3: the counts are CUMULATIVE, and re-announcing a grown total
    // ("1 council leg(s)…" then "4 council leg(s)…") reads as two separate
    // findings that a reader can reasonably add up to five. "so far this run"
    // says once, for both clauses, that each number is a running total.
    emit(`Notice: so far this run, ${parts.join('; and ')} and is NOT included in the `
      + `$${s.known.toFixed(4)} total${ceiling}. Real spend is HIGHER than reported — this total `
      + 'is at least, not exactly, what was spent. See run.json usage (unknownLegs / '
      + 'subtreeUnknownLegs), or `amicus spend --json` (sourceMix.unknown).'
      // v4.4.1 CA-6: with a ceiling set, an inexact total is not a clean run — say
      // so where the uncertainty is announced, so exit 2 is never a surprise.
      //
      // ⚠️ Review F2: hedged to "is on track to" rather than "will". This notice
      // fires from noticeUnknownSpend(), which run.js calls immediately BEFORE
      // the overBudget() check — so a run whose KNOWN spend also crosses the
      // ceiling right here prints this sentence and then exits 1
      // (COST_EXCEEDED), not 2. A signalled run exits 130/143. "Will" would be a
      // guarantee this code cannot make; "is on track to" states the tendency
      // that holds in the common case without promising an outcome decided
      // later, downstream of this call.
      + (hasCeiling ? ' Because a ceiling is set and this total is inexact, the run is on track '
        + 'to exit degraded (2); the ceiling itself still never halts a run.' : '') + '\n');
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

  /**
   * v4.4.1 CA-6 (OWNER RULING, 2026-07-26). Is a `--max-cost` ceiling in force
   * over a total we already know to be incomplete?
   *
   * `--max-cost` bounds KNOWN spend: an unknown leg contributes nothing to it and
   * never halts a run — see `overBudget` above, which this deliberately does NOT
   * touch, and which must keep ignoring unknown legs. That policy is right and it
   * stays. What was wrong was the REPORT. A run could exit 0 — read by every
   * script and every human as "clean, and inside your ceiling" — while knowingly
   * publishing a floor: `council-wsgate02` really spent $0.9859 against a $0.75
   * ceiling (131%) while amicus believed $0.3720, and exited 0.
   *
   * So the exit code degrades to 2, through the SAME `degraded` channel
   * `noteBudgetRefusal` already uses for a shrunken bench: the run finished, its
   * answer is good, and the cost figure underneath it is not the whole bill.
   * With NO ceiling there is nothing to be inexact against and the exit code is
   * untouched — an unpriced leg on an unbounded run is a fact, not a degradation.
   * @returns {boolean}
   */
  const inexactUnderCeiling = () => hasCeiling && !usageBlock().costExact;

  return { spendState, spent, overBudget, remainingBudget, noticeUnknownSpend, usageBlock,
    addWave, reserveBudget, releaseBudget, noteBudgetRefusal, budgetRefusals, inexactUnderCeiling };
}

module.exports = { createBudget };
