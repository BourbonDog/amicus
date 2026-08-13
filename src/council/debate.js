// src/council/debate.js
'use strict';

/**
 * @module council/debate
 * PURE final-tally reassembly for headless debate mode (spec §5.5). DI-free —
 * takes the provisional tally input + parsed defense/re-vote maps and returns a
 * new tally input plus the debate.json findings rows. run.js then re-runs
 * tally() on the returned input and decorates the record. Keeps run.js under the
 * line gate.
 * Also holds the pure pre-debate helpers (target selection, dispute detection, re-vote bundling) moved from run-debate.js (v4.7 PR0).
 */

const PAST_TENSE = { defend: 'defended', amend: 'amended', withdraw: 'withdrawn', 'no-response': 'no-response' };

// The debate-role vocabulary: a debate leg is an extra leg by an already-benched model,
// never an extra ledger row and never that model's ledger identity. Through v4.6 this Set
// ALSO drove ledger.js's join skip-set directly; Task 7 (v4.7 D4) replaced that with
// ledger.js's own LEDGER_JOIN_ROLES allowlist (fail-closed: everything not named there is
// excluded, not just DEBATE_ROLES), so this Set no longer has any runtime consumer outside
// this module — kept exported because debate.test.js pins its exact contents.
const DEBATE_ROLES = new Set(['rebuttal', 'revote']);

/**
 * Reassemble the tally input after the debate round.
 *
 * v4.8 PR3 Task 6 (spec §4.5): `defenseByRaiser` and `revoteByJudge` are keyed
 * on the SEAT (`seat.id`), which equals the alias for every bench without a
 * repeated entry. `aliasOf` is the ONE seat→alias projection run-debate.js
 * builds from `o.seats`; it is the identity for any key that is not a known
 * seat id, so a direct-require caller with no seats and the reserved 'claude'
 * key both behave exactly as before.
 *
 * ⚠️ This block used to declare a `provisionalRecord` param the destructure has
 * never taken (pre-existing doc rot). Callers still pass one and it is still
 * ignored — the DOC is what was wrong, so only the doc was fixed. Deliberately
 * not wired up: applyDebate reads `previousTier` off `tallyInput.findings[]`,
 * which run-debate.js stamps, and a second source of that fact is how it
 * silently read null before.
 *
 * @param {{tallyInput: object,
 *   defenseByRaiser: Object<string, Object<string, object>>,
 *   revoteByJudge: Object<string, Object<string, {verdict, reason?}>>,
 *   aliasOf?: function(string): string}} args
 * @returns {{input: object, debateFindings: Array}}
 */
function applyDebate({ tallyInput, defenseByRaiser, revoteByJudge, aliasOf }) {
  // Deep-ish clone the mutable arrays we touch (findings + adjudications).
  const findings = tallyInput.findings.map(f => ({ ...f }));
  const adjudications = tallyInput.adjudications.map(a => ({ ...a }));

  // Flatten the per-raiser defense map to a per-id lookup + debate.json rows.
  const byId = {};
  const debateFindings = [];
  for (const [raiser, perId] of Object.entries(defenseByRaiser || {})) {
    for (const [id, resp] of Object.entries(perId)) {
      byId[id] = resp;
      const src = findings.find(f => f.id === id) || {};
      const row = { id, raiser, action: resp.action, previousTier: src.previousTier || null };
      if (resp.argument) { row.argument = resp.argument; }
      if (resp.claim) { row.claim = resp.claim; }
      debateFindings.push(row);
    }
  }

  // Amend: swap claim text in place. Withdraw/defend/no-response: findings[] unchanged.
  for (const f of findings) {
    const resp = byId[f.id];
    if (resp && resp.action === 'amend' && typeof resp.claim === 'string') { f.claim = resp.claim; }
    delete f.previousTier; // provisional-only scratch field, never written to tally input
  }

  // Re-vote replacement: replace the wave SEAT's entry on each bundled id.
  // `(a.seat || a.judge)` is the seat-space read every consumer uses — `seat` is
  // emit-when-different (Task 5), so a bench with no repeated alias reduces this
  // to today's `a.judge === key` exactly. Matching on the alias instead is D5:
  // two twins share one `judge` value, so the first row wins and the second
  // twin's re-vote is silently dropped.
  for (const [key, perId] of Object.entries(revoteByJudge || {})) {
    for (const [id, rv] of Object.entries(perId)) {
      const entry = adjudications.find(a => a.findingId === id && (a.seat || a.judge) === key);
      if (entry) { entry.verdict = rv.verdict; }
      else {
        // Fail-open push (a stateless leg re-voting an id it never adjudicated).
        // `judge` MUST stay alias-space: it reaches tally.js's `v.judge !==
        // f.raiser` and report.js's `byJudge[adj.judge]`, where a seat id
        // silently retiers the finding. The seat rides beside it, emitted only
        // when it differs — so a unique bench pushes today's exact row.
        const alias = aliasOf ? aliasOf(key) : key;
        adjudications.push({ findingId: id, judge: alias, verdict: rv.verdict,
          ...(alias !== key ? { seat: key } : {}) });
      }
    }
  }

  return { input: { ...tallyInput, findings, adjudications }, debateFindings };
}

/**
 * Inject the additive past-tense debate decoration onto the tally record's
 * findings (spec §5.6). Mutates + returns the record.
 * @param {object} record tally() output
 * @param {Array<{id, action, previousTier}>} debateFindings
 * @returns {object} record
 */
function decorateRecord(record, debateFindings) {
  const byId = new Map((debateFindings || []).map(d => [d.id, d]));
  for (const f of record.findings) {
    const d = byId.get(f.id);
    if (d) { f.debate = { action: PAST_TENSE[d.action] || 'no-response', previousTier: d.previousTier }; }
  }
  return record;
}

/**
 * runStats rows for the debate legs (spec §5.5), plus v4.7 D2/E4's row-per-launch
 * extras: role is 'rebuttal' | 'revote' for the primary defense/re-vote legs,
 * 'superseded' for an original leg a successful repair replaced, and 'repair' for
 * a repair attempt that itself never became usable (error status rides naturally
 * off the raw leg). The rebuttal/revote legs never enter meta.models, so the
 * ledger stays one row per (run×model). DEBATE_ROLES remains the debate-role
 * vocabulary (rebuttal/revote); the ledger's overwrite protection for ALL FOUR
 * of these row-per-launch roles — rebuttal, revote, superseded AND repair —
 * lives in ledger.js's own LEDGER_JOIN_ROLES allowlist (v4.7 D4, Task 7):
 * a role not named there never joins, full stop, regardless of which module
 * produced the row or whether it is even in DEBATE_ROLES.
 * @param {{defenseLegs: Array, revoteLegs: Array, supersededLegs?: Array,
 *   repairLegs?: Array}} args leg metadata
 * @returns {Array<object>}
 */
function debateRunStatsRows({ defenseLegs, revoteLegs, supersededLegs, repairLegs }) {
  const mk = (role) => (l) => ({
    model: l.model, role, wasChair: false, conformance: l.conformance || 'clean',
    status: l.status || 'unknown',
    durationMs: typeof l.durationMs === 'number' ? l.durationMs : null,
    usage: l.usage || null,
    ...(l.waveId ? { waveId: l.waveId } : {}),
    ...(l.resolvedModel ? { resolvedModel: l.resolvedModel } : {}),
  });
  return [
    ...(defenseLegs || []).map(mk('rebuttal')),
    ...(revoteLegs || []).map(mk('revote')),
    ...(supersededLegs || []).map(mk('superseded')),
    ...(repairLegs || []).map(mk('repair')),
  ];
}

/** Spec §5.7 fallback: a dead/unparseable defense means every bundled id's original stands. */
function allNoResponse(ids) {
  const byId = {};
  for (const id of ids) { byId[id] = { action: 'no-response' }; }
  return byId;
}

/** True when there is nothing to challenge (spec §5.1). */
function nothingToDebate(provisionalRecord) {
  if (!provisionalRecord || provisionalRecord.judged === false) { return true; }
  const n = provisionalRecord.findings.filter(f => f.tier === 'Contested' || f.tier === 'Disputed').length;
  return n === 0;
}

/**
 * Seats whose provisional adjudications dispute at least one bundled id.
 * v4.8 PR3 Task 6: returns SEAT ids and dedups by seat (D6) — deduping by alias
 * collapses two disputing bench positions into one re-vote leg, so the twin that
 * never re-voted keeps a verdict the round meant to replace. run-debate.js
 * projects these back to aliases for the launcher.
 */
function disputingJudges(provisionalRecord, bundledIds) {
  const ids = new Set(bundledIds);
  const judges = new Set();
  for (const f of provisionalRecord.findings) {
    if (!ids.has(f.id)) { continue; }
    for (const adj of f.adjudications || []) {
      if (adj.verdict === 'dispute') { judges.add(adj.seat || adj.judge); }
    }
  }
  return [...judges];
}

/**
 * Group Contested+Disputed findings by raiser SEAT (defense targets).
 * v4.8 PR3 Task 6: keyed on `f.raiserSeat || f.raiser`. Claude's findings carry
 * no `raiserSeat`, so its key stays the literal 'claude' and run-debate.js's
 * `.filter(m => m !== 'claude')` / `byRaiser.claude` keep working unchanged.
 * ⚠️ `peerVerdicts`' `a.judge !== f.raiser` below stays ALIAS-space on purpose:
 * it is a second copy of the #137 class (a twin judge's vote on its twin's
 * finding is wrongly excluded) and belongs to PR4 with `tally.js`'s identical
 * comparison — fixing one without the other would make the brief's peer split
 * disagree with the tally the chair reads.
 */
function debateTargets(provisionalRecord, tallyInput) {
  const claimById = new Map(tallyInput.findings.map(f => [f.id, f]));
  const byRaiser = {};
  const previousTier = {};
  for (const f of provisionalRecord.findings) {
    if (f.tier !== 'Contested' && f.tier !== 'Disputed') { continue; }
    previousTier[f.id] = f.tier;
    const src = claimById.get(f.id) || {};
    const peerVerdicts = (f.adjudications || []).filter(a => a.judge !== f.raiser).map(a => a.verdict);
    const raiserKey = f.raiserSeat || f.raiser;
    (byRaiser[raiserKey] = byRaiser[raiserKey] || []).push({ id: f.id, claim: src.claim,
      severity: f.severity, location: src.location, peerVerdicts, disputeReasons: [] });
  }
  return { byRaiser, previousTier };
}

/** The re-vote bundle: defended-or-amended findings ONLY (spec §5.1 — withdrawn never appear). */
function bundleFor(defenseResults, tallyInput) {
  const out = [];
  for (const dr of defenseResults) {
    for (const [id, resp] of Object.entries(dr.byId)) {
      if (resp.action !== 'defend' && resp.action !== 'amend') { continue; }
      const src = tallyInput.findings.find(f => f.id === id) || {};
      out.push({ id, severity: src.severity, amended: resp.action === 'amend',
        claim: resp.action === 'amend' ? resp.claim : src.claim,
        argument: resp.argument || 'defended without extra argument' });
    }
  }
  return out;
}

module.exports = { applyDebate, decorateRecord, debateRunStatsRows, PAST_TENSE, DEBATE_ROLES,
  allNoResponse, nothingToDebate, disputingJudges, debateTargets, bundleFor };
