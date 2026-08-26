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

const { peersOf, unattributedPeerDrops } = require('./peer-split');
// v4.9 W11 (PR1F-2): the ONE runStats row builder. This module is DI-free, not
// require-free (it already takes ./peer-split), and ./run-stats-entry is
// require-FREE by its own design contract precisely so consumers outside
// ./run-assemble's graph can import it — so this adds only a leaf edge.
const { buildRunStatsEntry } = require('./run-stats-entry');

// __proto__: null — an inherited/unknown action (e.g. "toString") must fall
// through the `|| 'no-response'` guards below and in run-debate.js, never
// resolve off Object.prototype: a function value there survives in memory
// but JSON.stringify drops it, silently deleting `action` from the finding.
// Defense-in-depth: `parse-stage2.js :: parseDebateDefense` is an
// allowlist that normalises every foreign action to `'no-response'`
// before this table is consulted — no real run reaches it with a
// foreign key. See `run-debate.test.js :: DOUBLEBREACH`.
const PAST_TENSE = { __proto__: null, defend: 'defended', amend: 'amended', withdraw: 'withdrawn', 'no-response': 'no-response' };

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
 * ⚠️ SI-13: when `aliasOf` is omitted, the fail-open push below uses the raw
 * key unchanged (`alias = key`), leaving the SEAT id in the alias-space
 * `judge` field instead of projecting it to its alias. `judge` must stay
 * alias-space: via `peer-split.js :: peersOf`'s `v.judge !== f.raiser`, a
 * seat id there can silently retier a finding. `report.js :: toModel` never
 * retiers — it copies `f.tier`, never recomputes it — but the same seat id
 * still reaches its `columnFor` join as an out-of-contract `judge`.
 * `applyDebate` has no seat roster of its own, so building that projection
 * stays the caller's obligation.
 *
 * The gap needs a caller that both omits `aliasOf` and hits a repeated alias,
 * and none exists today: the sole non-test caller, `run-debate.js`, always
 * supplies `aliasOf` (see the warning comment at its call site), and
 * `package.json`'s `exports` map publishes only `./opencode-client`, blocking
 * a deep import of `amicus/src/council/debate` from outside this package.
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
        // `judge` MUST stay alias-space: via peer-split.js :: peersOf's
        // `v.judge !== f.raiser`, a seat id there can silently retier a
        // finding. report.js :: toModel never retiers — it copies `f.tier`,
        // never recomputes it — but the same seat id still reaches its
        // `columnFor` join as an out-of-contract `judge`.
        // The seat rides beside it, emitted only when it differs — so a unique
        // bench pushes today's exact row.
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
 * runStats rows for the debate legs (spec §5.5), plus v4.7 D2/E4's row-per-launch extras: role is
 * 'rebuttal' | 'revote' for the primary defense/re-vote legs, 'superseded' for an original leg a
 * successful repair replaced, and 'repair' for a repair attempt that itself never became usable
 * (error status rides naturally off the raw leg). The rebuttal/revote legs never enter meta.models,
 * so the ledger stays one row per (run × model × resolvedModel) pair — a debate round can never ADD
 * a row (v4.8 PR4b: meta.models is still the row driver, and the pair fan-out only splits an alias
 * whose own joinable rows resolved differently). DEBATE_ROLES remains the debate-role vocabulary
 * (rebuttal/revote); the ledger's overwrite protection for ALL FOUR of these row-per-launch roles —
 * rebuttal, revote, superseded AND repair — lives in ledger.js's own LEDGER_JOIN_ROLES allowlist
 * (v4.7 D4, Task 7): a role not named there never joins, full stop, regardless of which module
 * produced the row or whether it is even in DEBATE_ROLES.
 * @param {{defenseLegs: Array, revoteLegs: Array, supersededLegs?: Array,
 *   repairLegs?: Array}} args leg metadata
 * @returns {Array<object>}
 */
function debateRunStatsRows({ defenseLegs, revoteLegs, supersededLegs, repairLegs }) {
  // v4.9 W11 (PR1F-2): ONE builder — debate rows take the entry's key order, its defaults and its
  // emit-when-set rules instead of a fourth hand-rolled body. ⚠️ Nothing propagates on its OWN (claim
  // corrected in W14): `mk` hands the entry a SYNTHETIC leg of five fields plus three explicit params,
  // so seat/findingsUnverified/repairRefused/summary — and any future leg-sourced field — reach these
  // rows ONLY by widening THIS list. MEASURED, already shipped: W13's `ttftMs` rides the leg into the
  // entry and debate rows do not carry it. Widening is a behaviour change needing its own pins; filed.
  // ⚠️ The four lists hold NORMALIZED rows, not leg docs, and their model fields MIRROR the entry's
  // `leg` contract: `l.model` is the ALIAS and `l.resolvedModel` the executable id, where the entry
  // reads `leg.model` AS the resolved id and takes the alias as its own `model` — passing `l`
  // unchanged would stamp the alias into `resolvedModel` on 118 of the 137 measured rows. Holding
  // `summary`/`seat` back is deliberate too: no runStats row has ever carried review prose, and
  // `seat` here is a materializeDebate filename input, not a seat OBJECT (pin G1b). ⚠️ The re-key's
  // ONE divergence from the hand-rolled body is MEASURED-DEAD — a normalized row with `model`
  // undefined but `resolvedModel` set now emits the resolved id AS `model`, where the old body left
  // the key out of the JSON; `l.model` was an alias STRING on 137/137 census invocations, so no
  // producer emits that shape today (pin G1d — dead, not impossible). ⚠️ `l.status || 'unknown'` is
  // GONE, not moved: it never fired and cannot — result-schema.js :: buildRunResult applies its own
  // `metadata.status || 'unknown'` a layer below. The MEASURED census and every pin named here live
  // in tests/council/runstats-byte-order.test.js.
  const mk = (role) => (l) => buildRunStatsEntry({
    leg: { status: l.status, durationMs: l.durationMs, usage: l.usage,
      waveId: l.waveId, model: l.resolvedModel },
    model: l.model, role, conformance: l.conformance });
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
 * v4.8 Phase 2 T-B2: `peerVerdicts` below CALLS peer-split.js :: peersOf —
 * the one predicate tally.js also calls — so the defense brief's peer split and
 * the tally the chair reads agree by construction rather than by two spellings
 * kept in step by hand. Until T-B2 this file spelled its own copy with TWO
 * branches while `peersOf` had THREE: the outer `f.raiser ? … : …` arm was
 * missing here, so a finding whose raiser is falsy ('' from the MCP path,
 * `undefined` from the CLI path) was briefed a peer split the tally never
 * computed. `unattributedPeerDrops` rides beside it under the same emit rule as
 * tally.js's, so the two documents also carry the same mark.
 * v4.8 T-B4 then changed what that branch COMPUTES — a falsy raiser no longer
 * corroborates itself, and the seat compare was lifted ABOVE the raiser test so
 * the seats decide first whatever `f.raiser` says (P0). Because both documents
 * read the one function, the brief moved with the tally at no cost here. Two
 * consequences are visible from this file: the briefed peer split of a
 * falsy-raiser finding changes, and some such findings no longer reach a brief
 * at all, because dropping their unattributable votes moves them off
 * Contested/Disputed and `debateTargets` skips every other tier.
 * debate.js :: applyDebate reads `(a.seat || a.judge)` and
 * debate.js :: disputingJudges reads `adj.seat || adj.judge` — both already
 * seat-space, both read at T-B2 — so this was the last hand-rolled peer filter
 * left in this file.
 */
function debateTargets(provisionalRecord, tallyInput) {
  const claimById = new Map(tallyInput.findings.map(f => [f.id, f]));
  const byRaiser = {};
  const previousTier = {};
  for (const f of provisionalRecord.findings) {
    if (f.tier !== 'Contested' && f.tier !== 'Disputed') { continue; }
    previousTier[f.id] = f.tier;
    const src = claimById.get(f.id) || {};
    // ⚠️ The trailing `.map(a => a.verdict)` is load-bearing: briefings-debate's
    // verdictCounts indexes its counter BY THE ELEMENT, so a list of
    // adjudication OBJECTS renders "0 dispute, 0 agree, 0 neutral" — a silent
    // all-zero byte-identical to the no-data case, i.e. a paid brief telling the
    // model nobody disputed it.
    const adjs = f.adjudications || [];
    const peerVerdicts = peersOf(f, adjs).map(a => a.verdict);
    // Emitted only when > 0, exactly as tally.js emits it, so a run that does
    // not orphan one side of a twin pair produces a byte-identical row.
    const drops = unattributedPeerDrops(f, adjs);
    const raiserKey = f.raiserSeat || f.raiser;
    (byRaiser[raiserKey] = byRaiser[raiserKey] || []).push({ id: f.id, claim: src.claim,
      severity: f.severity, location: src.location, peerVerdicts,
      ...(drops > 0 ? { unattributedPeerDrops: drops } : {}), disputeReasons: [] });
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
