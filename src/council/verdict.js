// src/council/verdict.js
'use strict';
const fs = require('fs');
const path = require('path');
const { parseChairTerminal, CHAIR_VERDICTS, CHAIR_ANSWERS } = require('./parse-stage2');
// v4.9 PR #200 fix round 3: the seat-loss pair lives in its own leaf module (the
// 300-line gate), re-exported below so every existing caller and pin is unchanged.
const { summarizeSeatLoss, deriveSeatLoss } = require('./verdict-seat-loss');

// v4.0 §7: council family v2 — verdict docs carry {schemaVersion, type} and a
// nullable overallVerdict (the chair's terminal line — `VERDICT:` on a review
// run, `ANSWER:` on a task one; populated by the headless engine in Plan B via
// opts.overallVerdict, null in every Stage-4 manual path).
const VERDICT_SCHEMA_VERSION = 2;

// #202: the bench-seat census leaf (the 300-line gate — same reason
// verdict-seat-loss.js is its own module).
const { seatsReviewedOf } = require('./verdict-seats-reviewed');

/**
 * Merge a tally record with Claude's Stage-4 decisions into the verdict record.
 * @param {object} record  tally() output
 * @param {Array<{id,decision,applied,duplicateOf,tierOverride}>} decisions
 * @param {{overallVerdict?: (string|null), intent?: (string|null),
 *   seatLoss?: object, degrades?: Array<object>}} [opts]
 *   `overallVerdict` is the engine hook (Plan B): the parsed chair terminal line
 *   (`VERDICT:` on a review run, `ANSWER:` on a task run — v4.9 W5/W7);
 *   omitted/undefined → null. `intent` is the Stage-5 rebuild's carrier (v4.9 fix
 *   round 2 — see the emit-when-'task' line below). `seatLoss` (v4.5.2) and
 *   `degrades` (v4.6 Plan 2) are additive and OPTIONAL — each lands only when
 *   truthy/non-empty, absent otherwise (never fabricated).
 */
function buildVerdict(record, decisions = [], opts = {}) {
  const byId = new Map(decisions.map(d => [d.id, d]));
  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    type: 'council-verdict',
    runId: record.meta.runId,
    runType: record.meta.runType,
    date: record.meta.date,
    chair: record.meta.chair,
    council: record.meta.models,
    // v4.8 PR4c §3.2: this projection RENAMES meta.models to `council`, so
    // nothing from meta reaches verdict.json unless it is named here — which is
    // why the seat table needs its own line rather than riding tally's verbatim
    // meta copy. Emitted only when the record carries one (a twin bench), so a
    // unique-alias verdict is byte-for-byte unchanged. The key is `seats`,
    // matching the `seatLoss` sibling below; PR5 codes against that name.
    ...(record.meta.seats ? { seats: record.meta.seats } : {}),
    claudeInCouncil: record.meta.claudeInCouncil,
    // v4.9 W5.3: task-mode marker — emit-when-'task' (the W4/W5 plan's §7.5
    // byte-identity ruling): a review record never materializes the key, so a
    // review verdict.json is unchanged byte for byte, and an explicit
    // meta.intent 'review' (hand-assembled input) is NOT forwarded either.
    // ⚠️ v4.9 fix round 2 (council C1): `opts.intent` is a SECOND carrier, not a
    // redundant one. MEASURED: the run dir's tally.json copies `meta` verbatim
    // (tally.js), so the canonical Stage-5 rebuild already came through the first
    // guard — but a hand-assembled or MCP-supplied record has none (mcp-tools.js
    // :: amicus_verdict types `record` as `z.record(z.any())`), and on THAT leg
    // the rebuild dropped the key, regressing the fold line and Workspace chip to
    // review scale. Passed through `opts` rather than assigned after the call, so
    // the key keeps its SLOT here and a rebuilt document's key order still
    // matches the engine's (pinned, cli-council-verdict-chair-carry.test.js).
    // PR #200 round-5 B3: parens on the whole disjunction — behaviour-identical.
    ...(((record.meta && record.meta.intent === 'task') || opts.intent === 'task')
      ? { intent: 'task' } : {}),
    overallVerdict: opts.overallVerdict === undefined ? null : opts.overallVerdict,
    findings: record.findings.map(f => {
      const d = byId.get(f.id) || {};
      const tierOverride = d.tierOverride || f.tierOverride || null;
      const out = {
        id: f.id, raiser: f.raiser, severity: f.severity,
        tier: tierOverride ? tierOverride.to : f.tier,
        basis: f.basis, confidence: f.confidence, tierOverride,
        duplicateOf: d.duplicateOf || null,
        adjudications: f.adjudications,
        decision: d.decision || null,
        applied: d.applied === true,
        // v4.8 PR4c §3.4: this literal is CLOSED — it names every key and copies
        // nothing else off `f` — so the two fields tally() stamps need their own
        // lines or verdict.json names seats it cannot resolve (§1.2). Appended as
        // a pure TAIL, leaving the shipped eleven-key order untouched.
        // ⚠️ NOT `|| null`, even though `duplicateOf` and `decision` above are:
        // `JSON.stringify({raiserSeat: null})` still WRITES `"raiserSeat":`, so
        // that idiom changes the shape of every unique-alias verdict.json and
        // fails seat-parity-ondisk's needles. `applied` is the sibling to copy —
        // it computes a value rather than defaulting one. Emit-when-set matches
        // both producers (tally.js) and keeps a non-twin verdict byte-identical.
        ...(f.raiserSeat ? { raiserSeat: f.raiserSeat } : {}),
        ...(f.sameModelCorroboration ? { sameModelCorroboration: true } : {}),
      };
      if (f.debate) { out.debate = f.debate; }   // v4.1: additive debate decoration carry-through (spec §5.6)
      return out;
    }),
    // v4.8 fix round 1 (review finding): emit-when-DIFFERENT, adapted to this
    // row's flat {model, seat} shape — model is the alias, seat is the seat
    // id, so on a unique-alias bench they are byte-equal and nothing is
    // emitted (same semantics as `seat.id !== seat.alias` one layer up,
    // run-stats-entry.js :: buildRunStatsEntry). NOT a plain pass-through like `raiserSeat`
    // in the findings literal above — that field's upstream producer already holds a real
    // {id, alias} seat OBJECT at its own decision point (run.js:212:
    // `r.seat && r.seat.id !== r.seat.alias`), so passing its verdict
    // through here is safe. The street-cred producer never has such an object
    // at this point, only a flat row, so a pass-through here would leak `seat`
    // onto every unique-alias verdict.json the moment that producer's own
    // guard slipped — silently, since nothing else guards this closed literal.
    // This check is deliberate defense in depth: buildVerdict is also reachable
    // on externally-supplied records that never touched computeStreetCred
    // in-process at all — the MCP `record` param of mcp-tools.js ::
    // amicus_verdict is `z.record(z.any())`, fully permissive — so this
    // literal's own byte-identity cannot be contingent on that producer alone;
    // this file's own tests exercise that exact shape (hand-built rec objects,
    // never calling tally()). tally.json keeps its own pin regardless — a
    // genuine producer bug still reds at seat-parity-ondisk.test.js — this
    // check exists so verdict.json is never the ONE document such a bug (or an
    // externally-supplied record) masks.
    // ⚠️ NO LONGER INERT. This comment said "computeStreetCred emits no `seat`
    // at all yet" until v4.8 T3.3 shipped that producer — street-cred.js ::
    // computeStreetCred, one row per SEAT with the id emitted when it differs
    // from the alias. Both guards now fire on the same real documents, and the
    // pin that proves this literal carries the field through lives at
    // seat-parity-ondisk.test.js on a real runCouncil twin bench.
    streetCred: record.streetCred.map(s => ({ model: s.model, withSelf: s.withSelf, peersOnly: s.peersOnly,
      ...(s.seat && s.seat !== s.model ? { seat: s.seat } : {}) })),
    runStats: record.runStats,
    tierCounts: record.tierCounts,
    // Additive and OPTIONAL (schemaVersion stays 2): present only when a critic
    // was requested, so its absence never has to be interpreted.
    ...(opts.seatLoss ? { seatLoss: opts.seatLoss } : {}),
    // #202: how much of the bench actually reviewed. DERIVED here rather than
    // passed in, because every caller that could pass it already has the same
    // `runStats` this reads — and a parameter is one more thing a rebuild path
    // can forget (the `intent` key needed a SECOND carrier for exactly that).
    //
    // Its sibling `seatLoss` cannot serve: `deriveSeatLoss` returns null when no
    // `--critic` was requested, and CI runs `CRITIC: ''` — so seat loss is
    // STRUCTURALLY absent from every CI verdict. MEASURED on run 4424218c, a
    // two-seat bench that published a four-model street-cred table with the dead
    // seats rendered `n/a`, indistinguishable from the legend's "neutral".
    //
    // Counts the BENCH roles buildSeats mints — `seat`, `critic` and `lens:<slug>`
    // (#219 r2: this said "`role:'seat'` ONLY" after the filter was widened, and
    // two seats caught the stale sentence). One row per bench seat POST-retry, so a
    // healed seat is counted once (its first attempt is `role:'superseded'`), and
    // judges/chair/repairs are not bench seats. Emit-when-set — a record with no
    // bench rows carries no key, because `0 of 0` would read as a measurement of
    // an empty bench rather than as the absence it is.
    ...seatsReviewedOf(record.runStats),
    // v4.6 Plan 2 (spec §4): the canonical what-was-lost surface. Additive and
    // OPTIONAL — present only when the run actually degraded, so a clean run's
    // verdict is byte-for-byte unchanged. schemaVersion stays 2 (the v4.5.2
    // seatLoss precedent).
    ...(opts.degrades && opts.degrades.length ? { degrades: opts.degrades } : {}),
  };
}

/**
 * Recover the chair's overall verdict for a run folder.
 *
 * The chair's synthesis is the council's most valuable output and it is stored
 * in exactly two places: the engine's `verdict.json` (parsed) and
 * `chair-output.md` (prose). Neither `tally.json` nor `run.json` carries a
 * copy — so the Stage-5 step that REPLACES `verdict.json` from `tally.json`
 * must read the verdict back out of the run folder first, or it destroys it.
 *
 * Preference order, both anchored on the run dir (never on the `-o` path — the
 * verdict belongs to the run, not to wherever the caller writes the result):
 *   1. `<runDir>/verdict.json` `overallVerdict` — the value the engine already
 *      parsed. Guarded by `runId`: a stale or foreign verdict.json sitting in
 *      the folder must never inject another run's chair line. Guarded by SCALE
 *      too (v4.9 fix round 3, council A1/B1 — see below).
 *   2. `<runDir>/chair-output.md`, re-parsed with the engine's OWN parser, so
 *      there is no second parser to drift. This also recovers runs whose
 *      verdict.json was already nulled by the defect.
 *
 * ⚠️ ONE scale, chosen by the run's INTENT (v4.9 fix round 2, council B1/C2 —
 * CORRECTING W7's MEDIUM F2, recorded because it was wrong instructively). W7 was
 * right that a VERDICT-only fallback recovered null for every task run; its fix
 * tried BOTH parsers unconditionally, justified thus — the two scales are
 * DISJOINT by pinned construction (tests/council/chair-scale-drift.test.js), so
 * neither can read the other's phrase and the order of the two calls cannot
 * change an outcome. The premise is true; the conclusion does not follow.
 * Disjointness is a property of the PHRASE SETS, not of the DOCUMENT: chair prose
 * that quotes, contrasts or merely mentions the other scale carries BOTH keyword
 * lines, and then order decides everything — measured red in both directions, now
 * pinned in both (cli-council-verdict-chair-carry.test.js, SCALEFREEFALLBACK).
 *
 * So `intent` dispatches through `parseChairTerminal` — one parser, never both.
 * W7 rejected that call believing a Stage-5 rebuild has no intent to pass; it has
 * THREE, and the caller reads all of them (cli-handlers-council.js :: runVerdict):
 * the record's `meta.intent`, `run.json`'s `intent` from the run folder this
 * function already anchors on, and — since fix round 3, council C3 — the prior
 * verdict.json's own `intent` (readPriorVerdictIntent below), which is the last
 * carrier standing when the other two are absent. Absent — and anything but 'task' — is review,
 * restoring pre-W7 review behaviour exactly. Never invents: an absent, skipped or
 * unstructured chair yields null.
 *
 * ⚠️ AND THE CARRY OBEYS THE SAME SCALE (v4.9 fix round 3, council A1+B1 — one
 * mechanism, one fix). Round 2 dispatched branch 2 and left branch 1 with no
 * scale check at all, so the whole guard was inert whenever a prior verdict.json
 * existed: `overallVerdict: 'Ship it'` was carried onto a task rebuild verbatim
 * and every downstream surface then labelled a CHAIR_VERDICTS phrase `ANSWER:`
 * — the defect round 2 measured on the prose leg, one branch earlier. So the
 * carried phrase must be a member of the scale `intent` selects; off-scale is
 * treated as NO CARRY and falls through to branch 2, which is intent-dispatched
 * and therefore already right. This also subsumes the old string/non-empty
 * check: every member of both scales is a non-empty string, and `includes`
 * refuses a number, null or object without a separate typeof.
 * @param {string} runDir
 * @param {string} [runId] record.meta.runId — the run being rebuilt
 * @param {?string} [intent] 'task' selects the ANSWER scale; anything else review
 * @returns {string|null} a canonical chair verdict OR answer phrase, or null
 */
function readOverallVerdict(runDir, runId, intent) {
  const scale = intent === 'task' ? CHAIR_ANSWERS : CHAIR_VERDICTS;
  try {
    const prior = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    if (scale.includes(prior.overallVerdict)
      && (!runId || prior.runId === runId)) {
      return prior.overallVerdict;
    }
  } catch { /* no prior verdict.json, or unreadable — try the chair prose */ }
  try {
    const text = fs.readFileSync(path.join(runDir, 'chair-output.md'), 'utf-8');
    return parseChairTerminal(text, intent);
  } catch { /* no chair-output.md — the chair genuinely produced nothing */ }
  return null;
}

/**
 * Recover the additive loss surfaces for a Stage-5 rebuild (#87, v4.6 Plan 4).
 * Same contract as readOverallVerdict directly above: the run folder's own
 * verdict.json is the only source, a foreign runId never leaks, and absence
 * yields nulls — the rebuild preserves, never invents. tally.json carries
 * neither field, which is why the pre-#87 rebuild silently destroyed both.
 * @param {string} runDir
 * @param {string} [runId]
 * @returns {{seatLoss: (object|null), degrades: (Array<object>|null)}}
 */
function readPriorVerdictSurfaces(runDir, runId) {
  try {
    const prior = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    if (!runId || prior.runId === runId) {
      return {
        seatLoss: (prior.seatLoss && typeof prior.seatLoss === 'object') ? prior.seatLoss : null,
        degrades: Array.isArray(prior.degrades) && prior.degrades.length ? prior.degrades : null,
      };
    }
  } catch { /* no prior verdict.json, or unreadable — nothing to preserve */ }
  return { seatLoss: null, degrades: null };
}

/**
 * The run's intent as the prior verdict.json records it (v4.9 fix round 3,
 * council C3) — the THIRD carrier for a Stage-5 rebuild, after the record's
 * `meta.intent` and run.json's checkpoint.
 *
 * A SEPARATE function rather than a fourth key on readPriorVerdictSurfaces
 * directly above: intent has to be resolved BEFORE readOverallVerdict runs
 * (it selects that call's scale), while the loss surfaces are recovered after
 * the parse; and #87's pins assert that function's return shape exactly
 * (verdict-degrades.test.js), so widening it would edit a pin to fit a change
 * rather than the other way round.
 *
 * Same contract as both siblings: the run folder's own verdict.json, the same
 * `!runId || prior.runId === runId` guard — waived only when the RECORD names
 * no run, never when the DOCUMENT does not — and absence yields null.
 * Emit-when-'task' at the source (buildVerdict), so ONLY 'task' is reported;
 * anything else, including a hand-written `intent: 'review'`, is no vote.
 * @param {string} runDir
 * @param {string} [runId]
 * @returns {'task'|null}
 */
function readPriorVerdictIntent(runDir, runId) {
  try {
    const prior = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    if ((!runId || prior.runId === runId) && prior.intent === 'task') { return 'task'; }
  } catch { /* no prior verdict.json, or unreadable — no vote */ }
  return null;
}

/** Atomic write: tmp + rename (matches the repo's wave.json convention). */
function writeVerdictAtomic(filePath, verdict) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(verdict, null, 2));
  fs.renameSync(tmp, filePath);
}

module.exports = {
  buildVerdict, summarizeSeatLoss, deriveSeatLoss, readOverallVerdict, readPriorVerdictSurfaces,
  readPriorVerdictIntent, writeVerdictAtomic, VERDICT_SCHEMA_VERSION,
};
