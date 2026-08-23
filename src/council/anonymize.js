// src/council/anonymize.js
'use strict';

/**
 * @module council/anonymize
 * Pure label-map helpers for the headless council engine (spec §6).
 * Each surviving Stage-1 review gets a stable letter label ('Review A',
 * 'Review B', …) in bench order. The label↔model map lives ONLY in
 * orchestrator memory and run.json — never in any judge-visible file.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Assign stable labels in the given model order.
 * @param {string[]} models reviewed model ids (bench order)
 * @param {?Array<?{id: string, alias: string}>} [seats] (v4.8 T3.2) the bound
 *   seat (or null/undefined) for each entry, SAME length/order as `models`.
 *   Optional — every pre-T3.2 caller omits it. This is NOT the positional join
 *   run-assemble.js's buildTallyInput docblock forbids for meta.seats (that one
 *   joins meta.seats to the INDEPENDENTLY-sourced/filtered meta.models or
 *   streetCred[]): here both arrays are built by the ONE caller from the SAME
 *   source list in the SAME pass (run.js's `s1.reviews.map(...)`, twice), the
 *   same positional pairing run.js already relies on one block below
 *   (`labels.entries[i]` against `s1.reviews[i]`).
 * @returns {{entries: Array<{label: string, letter: string, model: string}>,
 *   labelMap: Object<string, string>, seatMap: Object<string, string>}}
 *   `labelMap` is UNCHANGED by this task — label -> alias, byte-identical.
 *   This is a controller ruling (P-3): `labelMap` is persisted to run.json and
 *   schemas/council-run.schema.json:45 declares its shape, and
 *   src/workspace/blind-mode.js :: labelFor does an EXACT-STRING match against
 *   its VALUE — measured 2026-08-20, `labelFor("gemini", {'Review A':'gemini#1'})`
 *   -> `null`, the label silently lost. Seat identity rides the separate,
 *   additive `seatMap` below instead.
 *   `seatMap` (label -> seat id) is sparse by construction: a label lands in
 *   it only when `seats[i]` is a real bound seat that differs from its own
 *   alias — the shared emit-when-DIFFERENT predicate every other seat-emit
 *   producer uses (run-stats-entry.js:64: `seat.id !== seat.alias`). On a
 *   unique-alias bench, or when `seats` is omitted entirely, `seatMap` is
 *   `{}` — so no pre-T3.2 caller (or consumer of just `{entries, labelMap}`)
 *   can observe a change. T3.2 wired `seatMap` only as far as
 *   `rankingToOrder`'s `orderSeats` below; consuming it into street cred was
 *   T3.3's, and T3.3 SHIPPED — street-cred.js :: computeStreetCred now keys on
 *   it, so this channel has a live consumer rather than a forecast one.
 */
function assignLabels(models, seats) {
  if (!Array.isArray(models) || models.length === 0 || models.length > LETTERS.length) {
    throw new Error(`assignLabels needs 1-${LETTERS.length} models`);
  }
  const entries = models.map((model, i) => ({
    label: `Review ${LETTERS[i]}`, letter: LETTERS[i], model,
  }));
  const labelMap = {};
  for (const e of entries) {
    labelMap[e.label] = e.model;
  }
  const seatMap = {};
  if (Array.isArray(seats)) {
    entries.forEach((e, i) => {
      const seat = seats[i];
      if (seat && seat.id !== seat.alias) { seatMap[e.label] = seat.id; }
    });
  }
  return { entries, labelMap, seatMap };
}

/** Rewrite a review's local integer finding id to its run-global label id. */
function toGlobalId(letter, localId) {
  return `${letter}${localId}`;
}

/**
 * Rewrite a validated review's findings to run-global tally-input entries.
 * @param {string} letter review letter (e.g. 'A')
 * @param {string} raiser de-anonymized model id
 * @param {Array<{id: number, severity: string, claim: string, location: string}>} findings
 * @param {?string} raiserSeat (v4.8 PR3 Task 5) the raiser's bound seat id —
 *   emitted ONLY when truthy AND different from `raiser` (emit-when-DIFFERENT,
 *   not emit-when-set). On a unique-alias bench seat.id === alias, so the
 *   field stays absent and tally-input.json/tally.json/verdict.json stay
 *   byte-identical artifacts. Absent entirely on the Claude review call site
 *   (3 args) — Claude is never a seat.
 *   ⚠️ v4.8 PR4c R4c-9: the `raiserSeat !== raiser` half is now provably DEAD on
 *   the engine path. run.js's call site gates on `seat.id !== seat.alias`, and
 *   for every bench preflightSeats admits that implies `seat.id !== r.model`.
 *   It is KEPT as defense in depth for the hand-assembled callers (this module
 *   is pure and has no seat table to consult), and tests/council/
 *   run-raiserseat-call.test.js exists so that removing EITHER guard fails a
 *   test — but do not read it as a second, independent decision about an
 *   engine-produced run.
 * @returns {Array<{id: string, raiser: string, severity: string, claim: string, location: string}>}
 */
function toGlobalFindings(letter, raiser, findings, raiserSeat) {
  // claim + location must reach tally-input.json — Action v2 (Plan C) joins on
  // them for file:line annotations; tally() reads only id/raiser/severity.
  return findings.map(f => ({
    id: toGlobalId(letter, f.id), raiser, severity: f.severity, claim: f.claim,
    location: f.location,
    ...(raiserSeat && raiserSeat !== raiser ? { raiserSeat } : {}),
  }));
}

/**
 * Translate a judge's anonymized ranking (labels; ties as nested arrays) into
 * a tally rankings[].order array of model ids via the private label map.
 * @param {Array<string|string[]>} ranking
 * @param {Object<string, string>} labelMap
 * @param {Object<string, string>} [seatMap] (v4.8 T3.2) assignLabels' additive
 *   label -> seat-id channel. Optional; every pre-T3.2 caller omits it.
 * @returns {{order: Array<string|string[]>,
 *   orderSeats: Array<?string|Array<?string>>, errors: string[]}}
 *   `order` and `errors` are UNCHANGED — same expression, same call to
 *   `mapOne`, so briefings-chair.js and the tally schema stay unmoved
 *   (SI-25 site (3) becomes *possible*, not *done*: T3.2 does not touch that
 *   call site). ⚠️ THAT PARENTHESIS IS T3.2's OWN HISTORY, NOT THE PRESENT
 *   STATE — kept because it says what T3.2 did and did not do. SI-25 has since
 *   DONE site (3): `briefings-chair.js :: seatKeyedOrder` consumes `orderSeats`
 *   to render the chair packet's rankings block. Only the tally schema still
 *   stays unmoved. `orderSeats` is the NEW, separate, parallel channel: the SAME
 *   slots resolved through `seatMap` instead of `labelMap` — a by-VALUE
 *   (label) lookup mirroring `order`'s own resolution, never a positional
 *   join across two independently-sourced arrays. `null` marks a slot whose
 *   label has no distinguishing seat (unique-alias bench, or no `seatMap`
 *   given at all — every pre-T3.2 call site). T3.2 wired `orderSeats` no
 *   further than its `judgeResults[]` call site in run-stage2.js. T3.3 carried
 *   it one hop on, to `rankings[]` in run-assemble.js :: buildTallyInput, and
 *   seat-keyed street-cred.js :: rankPositions with it — emitting the field
 *   only when it holds a non-null, because THIS function returns an all-null
 *   parity shape rather than an absence.
 */
function rankingToOrder(ranking, labelMap, seatMap) {
  const errors = [];
  const mapOne = (label) => {
    const model = labelMap[label];
    if (!model) { errors.push(`unknown label '${label}'`); }
    return model;
  };
  const seatOne = (label) => (seatMap && seatMap[label]) || null;
  const slots = Array.isArray(ranking) ? ranking : [];
  const order = slots.map(slot => (Array.isArray(slot) ? slot.map(mapOne) : mapOne(slot)));
  const orderSeats = slots.map(slot => (Array.isArray(slot) ? slot.map(seatOne) : seatOne(slot)));
  return { order, orderSeats, errors };
}

module.exports = { assignLabels, toGlobalId, toGlobalFindings, rankingToOrder, LETTERS };
