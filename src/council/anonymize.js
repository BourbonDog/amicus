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
 * @returns {{entries: Array<{label: string, letter: string, model: string}>,
 *   labelMap: Object<string, string>, letterByModel: Object<string, string>}}
 */
function assignLabels(models) {
  if (!Array.isArray(models) || models.length === 0 || models.length > LETTERS.length) {
    throw new Error(`assignLabels needs 1-${LETTERS.length} models`);
  }
  const entries = models.map((model, i) => ({
    label: `Review ${LETTERS[i]}`, letter: LETTERS[i], model,
  }));
  const labelMap = {};
  const letterByModel = {};
  for (const e of entries) {
    labelMap[e.label] = e.model;
    letterByModel[e.model] = e.letter;
  }
  return { entries, labelMap, letterByModel };
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
 * @returns {{order: Array<string|string[]>, errors: string[]}}
 */
function rankingToOrder(ranking, labelMap) {
  const errors = [];
  const mapOne = (label) => {
    const model = labelMap[label];
    if (!model) { errors.push(`unknown label '${label}'`); }
    return model;
  };
  const order = (Array.isArray(ranking) ? ranking : [])
    .map(slot => (Array.isArray(slot) ? slot.map(mapOne) : mapOne(slot)));
  return { order, errors };
}

module.exports = { assignLabels, toGlobalId, toGlobalFindings, rankingToOrder, LETTERS };
