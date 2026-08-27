// src/council/tally.js
'use strict';
const { peersOf, unattributedPeerDrops } = require('./peer-split');
// The street-cred half (rankPositions / credSeats / computeStreetCred) lives in
// ./street-cred (v4.8 T3.3 size-gate split; this file stood at 301 of 300 with
// the seat-keying in it — release Constraint 6 is EXTRACT, never shave).
// computeStreetCred is re-exported below, so no existing import path moved.
const { computeStreetCred } = require('./street-cred');
// #202: the TTFT probe's LAST emit gate — a RE-PROJECTION, so omitting the field
// here destroyed one already produced rather than failing to produce it. Through
// v4.9.1 utils/ttft.js's docblock enumerated only the four PRODUCER gates and
// stopped one short of this one; it now names all five.
const { isMeasuredTtft } = require('../utils/ttft');

/**
 * Peers-only tier cascade. a/d are agree/dispute counts among PEER judges
 * (the raiser's own adjudication is excluded by the caller).
 * Exhaustive and mutually exclusive over all (a,d).
 *
 * Uncontested agreement is Confirmed: either a strong majority (a>=2 && a>d)
 * or a lone corroborating peer with no dispute (a=1 && d===0). The latter must
 * not rank weaker than a lone disputing peer (a=0,d=1, which is Contested); the
 * `confidence` flag ('thin' when a+d<=1) is what separates single-peer
 * corroboration from a multi-peer majority. Singleton is now reserved for the
 * no-signal case (a=0,d=0).
 * @param {number} a - peer agree count
 * @param {number} d - peer dispute count
 * @returns {{tier:string, confidence:'thin'|'solid'}}
 */
function assignTier(a, d) {
  let tier;
  if (d >= 2 && d > a) { tier = 'Disputed'; }
  else if ((a >= 2 && a > d) || (a === 1 && d === 0)) { tier = 'Confirmed'; }
  else if (d >= 1) { tier = 'Contested'; }
  else { tier = 'Singleton'; }
  const confidence = (a + d <= 1) ? 'thin' : 'solid';
  return { tier, confidence };
}

// v4.0 §7: council family v2 — every council doc carries {schemaVersion, type}.
const COUNCIL_SCHEMA_VERSION = 2;
const VERDICTS = { __proto__: null, agree: 'a', dispute: 'd', neutral: 'n' };

function countTiers(findings) {
  const counts = { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 };
  for (const f of findings) { counts[f.tier] += 1; }
  return counts;
}

/**
 * Deterministic council tally. Pure: no IO. Claude assembles `input`
 * (de-anonymized) and may override margin tiers afterward.
 * @returns {object} record
 */
function tally(input) {
  const { meta, findings, rankings, adjudications, runStats } = input;
  const byFinding = new Map();
  for (const adj of adjudications) {
    if (!byFinding.has(adj.findingId)) { byFinding.set(adj.findingId, []); }
    byFinding.get(adj.findingId).push({ judge: adj.judge, verdict: adj.verdict, ...(adj.seat ? { seat: adj.seat } : {}) });
  }
  const outFindings = findings.map(f => {
    const votes = byFinding.get(f.id) || [];
    const peers = peersOf(f, votes);
    // v4.8 T-B2: how many votes `peersOf` excluded without being able to
    // attribute them — the one-sided alias fallback, plus (T-B4) the falsy
    // judges of a falsy raiser. ⚠️ NOT the votes the SEAT ids attributed: when
    // both sides carry a seat id the engine knows whose vote it is, so that
    // exclusion is announced by nothing. Same function and same emit rule
    // (> 0 only) as debate.js :: debateTargets, so this document and the
    // defense brief can never announce different numbers.
    // ⚠️ On the SEATED shapes — tally.test.js T1 and T2, the one-sided twin
    // pair — `basis` deliberately does NOT move: counting the ambiguous vote
    // reproduces the naive filter's outcome, measured Confirmed on both, which
    // re-arms #137. Announced, not counted. ⚠️ T-B4 is the deliberate exception
    // and the scope of that sentence narrowed with it: on a finding whose
    // raiser is FALSY, `basis` DOES move, because there the ambiguous vote is
    // the raiser's own inflating its own basis rather than a twin's signal
    // going uncounted (council C1 — see peer-split.js :: peersOf).
    const drops = unattributedPeerDrops(f, votes);
    const basis = { a: 0, d: 0, n: 0 };
    // Skip unknown verdict strings so a stray value can't corrupt the basis via
    // basis[undefined] = NaN (L9). Guaranteed by VERDICTS's `__proto__: null`,
    // not `!== undefined` alone — measured, all four Object.prototype keys
    // (toString/__proto__/constructor/valueOf) read undefined on it. VERDICTS
    // is module-local, absent from module.exports, so this isn't observable
    // outside this file.
    for (const v of peers) {
      const key = VERDICTS[v.verdict];
      if (key !== undefined) { basis[key] += 1; }
    }
    const { tier, confidence } = assignTier(basis.a, basis.d);
    // v4.8 PR4c §3.3 (R8): `peers` has already excluded the raiser BY SEAT, so a
    // surviving peer whose ALIAS equals the raiser's is a different seat of the
    // same model — corroboration that is not independent. Emitted only when TRUE
    // (an unconditional `false` would change every document's shape).
    // ⚠️ The leading `f.raiser &&` is LOAD-BEARING, not decoration — and the
    // interesting part is that this sentence was FALSE for one commit inside
    // v4.8 T-B4, so it is written with its measurement rather than its
    // adjective. It is load-bearing because `peersOf` can hand back a
    // seat-carrying vote whose `judge` is falsy, and then `v.judge === f.raiser`
    // reads `undefined === undefined` on the CLI path (cli-handlers-council.js
    // is a raw JSON.parse with no schema) and `'' === ''` on the MCP path
    // (mcp-tools.js's z.string() accepts the empty string) — so without the
    // guard this stamp fires on documents that name no models at all.
    // MEASURED at each step over the 768-shape cross-product of (f.raiser,
    // f.raiserSeat, v.judge, v.seat, verdict): deleting the guard flipped 8
    // shapes at 64b835b8, ZERO after T-B4 round 1 — which had made `peersOf`
    // drop every falsy-judge vote of a falsy raiser, briefly disarming the very
    // pins that guarded this — and 4 after round 2, whose P0 rule counts the
    // ones the SEAT ids prove are real peers. The 4 are the seat-DIFFER shapes
    // of the T7b and T7d families, i.e. exactly those two tests. Re-run this
    // after any edit to peer-split.js :: peersOf; do not infer it.
    // ⚠️ Alias-only in BOTH directions, and the CHANGELOG says so: it misses
    // `gpt-5,openai/gpt-5` (one model, two aliases — votes carry no
    // resolvedModel) and it fires falsely on a SPLIT alias, whose two seats
    // resolved to different executables. PR4b's ledger treats
    // (alias, resolvedModel) as identity; this stamp is same-ALIAS only.
    // SI-23 (R10): `location` is declared on the MCP schema now
    // (mcp-tools.js :: getTools) so it survives zod validation, but
    // surviving validation and reaching THIS document are two different
    // properties — the round-trip pin below only holds if this map also
    // forwards it, emit-when-present, the same convention as `raiserSeat`
    // two lines up. Scoped to `location` alone AT R10: `claim` was already
    // reaching this function on both the CLI and MCP paths (declared on the
    // MCP schema since before R10) and was ALREADY not forwarded here — R10
    // named the gap and left it for a separate PR rather than widening its
    // own mandate to close it. SI-23 fix round 1 (paid council on PR #183,
    // findings A1/B1, two independent raisers) ruled that indefensible one
    // line from the fix it sits beside: `claim` is forwarded below too,
    // same round.
    // A2 (nit) / C1 (major, contested a0/d1/n2, thin): the truthiness checks
    // below drop an empty string that zod would accept. Deliberate, not a
    // bug — `raiserSeat` above uses the identical pattern, and diverging
    // `location`/`claim` from their own immediate sibling is worse than the
    // edge case, so "" is treated as absent on all three fields.
    return { id: f.id, raiser: f.raiser, severity: f.severity, tier, basis, confidence,
             tierOverride: null, adjudications: votes, ...(f.raiserSeat ? { raiserSeat: f.raiserSeat } : {}),
             ...(f.location ? { location: f.location } : {}),
             ...(f.claim ? { claim: f.claim } : {}),
             ...(f.raiser
               && peers.some(v => v.seat && f.raiserSeat && VERDICTS[v.verdict] === 'a' && v.judge === f.raiser)
               ? { sameModelCorroboration: true } : {}),
             ...(drops > 0 ? { unattributedPeerDrops: drops } : {}) };
  });
  return {
    schemaVersion: COUNCIL_SCHEMA_VERSION,
    type: 'council-tally',
    meta,
    judged: Array.isArray(rankings) && rankings.length >= 2,
    // v4.8 T3.3: `meta.seats` joins BY VALUE inside computeStreetCred (never
    // positionally against meta.models — run-assemble.js :: buildTallyInput
    // forbids that). The ENGINE emits it only when the bench repeats an alias,
    // so a unique-alias run leaves the rows alias-driven and byte-identical.
    // ⚠️ DO NOT READ THAT AS "hand-assembled input is always alias-driven" —
    // this sentence said so until fix round 1 and it was false, in the way that
    // hides a defect rather than merely misinforming. `meta` is copied verbatim
    // from user JSON on both hand-assembled appendRun paths, and
    // mcp-tools.js :: amicus_council_tally DECLARES `meta.seats`, so such a
    // record produces SEAT-driven street-cred rows here while its `runStats`
    // rows — declared `z.array(z.record(z.any()))`, so never asked for a seat —
    // carry none. That asymmetry is a live quadrant, not a hypothetical; it is
    // what ledger-join.js :: credFor's second lookup exists for.
    streetCred: computeStreetCred(rankings || [], meta.models, meta.seats),
    findings: outFindings,
    runStats: (runStats || []).map(r => ({
      model: r.model, role: r.role, wasChair: !!r.wasChair, conformance: r.conformance || 'clean',
      // ⚠️ Review F3: this allowlist already carries `conformance`, which makes
      // tally.json (and verdict.json, which copies runStats verbatim) THE per-run
      // artifact showing a seat's conformance — so the two facts that qualify it
      // travel with it: LC-11's `findingsUnverified` (contract uncheckable) and
      // F1's `repairRefused` (contract checked and broken). Additive, emitted only
      // when set, and the runStats schema declares no additionalProperties, so a
      // run without either is byte-for-byte unchanged. v4.7 GOA-7 exercised the
      // ledger's schema-versioned extension slot: `resolvedModel` rides this
      // allowlist and reaches ledger rows via the ledger's model-keyed join of
      // primary rows (ledger.js, LEDGER_SCHEMA_VERSION 2).
      ...(r.findingsUnverified ? { findingsUnverified: true } : {}),
      ...(r.repairRefused ? { repairRefused: r.repairRefused } : {}),
      ...(r.waveId ? { waveId: r.waveId } : {}),
      ...(r.resolvedModel ? { resolvedModel: r.resolvedModel } : {}),
      // v4.8 PR4c §3.1: `seat` rides the same slot. It is emitted upstream only
      // when the bench repeats that alias (run-assemble.js's buildRunStatsEntry),
      // so a unique-alias run is byte-for-byte unchanged here and in verdict.json,
      // which copies this array verbatim (verdict.js :: buildVerdict).
      ...(r.seat ? { seat: r.seat } : {}),
      status: r.status || 'unknown',
      durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
      // #202: emit-when-VALID, in buildRunStatsEntry's own slot (between
      // durationMs and usage) so G7b's key-order invariant holds for a row that
      // carries it. NOT `durationMs`'s null-coercion above: a null here would be
      // read as a measurement, and absence must keep its one meaning — "no
      // substantive tick was ever observed". The shared predicate is imported
      // rather than hand-spelled; this file has no require-free pin.
      ...(isMeasuredTtft(r.ttftMs) ? { ttftMs: r.ttftMs } : {}),
      usage: r.usage || null,
    })),
    tierCounts: countTiers(outFindings),
  };
}

module.exports = { assignTier, computeStreetCred, tally, COUNCIL_SCHEMA_VERSION };
