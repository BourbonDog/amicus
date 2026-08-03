// src/council/verdict.js
'use strict';
const fs = require('fs');
const path = require('path');
const { parseChairVerdict } = require('./parse-stage2');

// v4.0 §7: council family v2 — verdict docs carry {schemaVersion, type} and a
// nullable overallVerdict (the chair's Ship-it line; populated by the headless
// engine in Plan B via opts.overallVerdict, null in every Stage-4 manual path).
const VERDICT_SCHEMA_VERSION = 2;

/**
 * Describe which requested seats actually reviewed, for the verdict's own face.
 *
 * ⚠️ ADDED v4.5.2 from a field report. The critic is a SOLO wave with one leg,
 * so losing it loses 100% of the adversarial role — and unlike a dead bench wave
 * (which trips the quorum gate and fails the run loudly) a dead critic is
 * survivable, so the run continues to a full verdict, tally and chair synthesis
 * that never saw the critic's findings. Run `dfb6a692` did exactly that and the
 * only record was `deadWaves` in run.json, a file nobody opens when the verdict
 * reads clean. A user who typed `--critic` asked for adversarial review; a
 * verdict produced without it must say so where the verdict is read.
 *
 * Returns null when no critic was requested — there is nothing to report, and an
 * always-present block would train readers to ignore it.
 *
 * @param {{runId: string, critic: ?string,
 *   deadWaves: Array<{waveId: string, models: string[], reason: string}>}} o
 * @returns {?{criticRequested: string, criticSeated: boolean, reason: ?string,
 *   deadBenchSeats: string[]}}
 */
function summarizeSeatLoss({ runId, critic, deadWaves = [] } = {}) {
  if (!critic) { return null; }
  // Match on EITHER carrier. The `-c1` suffix is the convention run-stages.js
  // uses, but a wave that names the critic model is the critic wave whatever it
  // is called — and relying on the id alone would silently under-report if that
  // convention ever changes.
  const isCriticWave = w =>
    w.waveId === `${runId}-c1` || (w.models || []).includes(critic);
  const dead = deadWaves.find(isCriticWave) || null;
  return {
    criticRequested: critic,
    criticSeated: !dead,
    reason: dead ? dead.reason : null,
    deadBenchSeats: deadWaves.filter(w => !isCriticWave(w))
      .flatMap(w => w.models || []),
  };
}

/**
 * seatLoss, derived from the sink's records (v4.6 Plan 2, spec D3 — closes #84).
 *
 * WHY A DERIVATION: two fields reporting lost seats can disagree; deriving one
 * from the other makes contradiction inexpressible. `summarizeSeatLoss` stays
 * exactly as v4.5.2 shipped it (its tests pass unedited — that is the proof the
 * shape survived); this function rebuilds its wave input from `dead-wave`
 * records and then adds the losses waves can never show: `dead-leg` records —
 * a solo critic wave that STARTED but whose one leg died is invisible to
 * deadWaves, which is #84's second half.
 *
 * Reads ONLY record.data (Task 1's machine surface) — never the prose fields.
 * @param {{runId: string, critic: ?string, degrades: Array<object>}} o
 * @returns {?object} the summarizeSeatLoss shape, or null when no critic was requested
 */
function deriveSeatLoss({ runId, critic, degrades = [] } = {}) {
  if (!critic) { return null; }
  const real = degrades.filter(d => d.kind !== 'heal' && d.data);
  const waves = real.filter(d => d.channel === 'dead-wave')
    .map(d => ({ waveId: d.data.waveId, models: d.data.models || [], reason: d.data.reason }));
  const base = summarizeSeatLoss({ runId, critic, deadWaves: waves });
  const legs = real.filter(d => d.channel === 'dead-leg');
  const criticLeg = legs.find(l => l.data.seat === critic) || null;
  return {
    ...base,
    criticSeated: base.criticSeated && !criticLeg,
    // SL-2 handoff: a reconciliation note (run-retry-notes.js's
    // missingLegStillDeadNote) carries data.status: null when the retry
    // produced no leg for the seat at all — there is no status to name, so
    // the old `ended '${status}'` template rendered the literal string
    // "ended 'null'". A status-carrying record keeps the original text.
    reason: base.reason || (criticLeg
      ? (criticLeg.data.reason || (criticLeg.data.status
        ? `the critic leg ended '${criticLeg.data.status}' with no usable output`
        : 'the critic leg produced no usable output'))
      : null),
    deadBenchSeats: [...base.deadBenchSeats,
      ...legs.filter(l => l.data.seat !== critic).map(l => l.data.seat)],
  };
}

/**
 * Merge a tally record with Claude's Stage-4 decisions into the verdict record.
 * @param {object} record  tally() output
 * @param {Array<{id,decision,applied,duplicateOf,tierOverride}>} decisions
 * @param {{overallVerdict?: (string|null), seatLoss?: object, degrades?: Array<object>}} [opts]
 *   `overallVerdict` is the engine hook (Plan B): the parsed chair `VERDICT:`
 *   line; omitted/undefined → null. `seatLoss` (v4.5.2) and `degrades` (v4.6
 *   Plan 2) are additive and OPTIONAL — each lands on the verdict only when
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
    claudeInCouncil: record.meta.claudeInCouncil,
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
      };
      if (f.debate) { out.debate = f.debate; }   // v4.1: additive debate decoration carry-through (spec §5.6)
      return out;
    }),
    streetCred: record.streetCred.map(s => ({ model: s.model, withSelf: s.withSelf, peersOnly: s.peersOnly })),
    runStats: record.runStats,
    tierCounts: record.tierCounts,
    // Additive and OPTIONAL (schemaVersion stays 2): present only when a critic
    // was requested, so its absence never has to be interpreted.
    ...(opts.seatLoss ? { seatLoss: opts.seatLoss } : {}),
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
 *      the folder must never inject another run's chair line.
 *   2. `<runDir>/chair-output.md`, re-parsed with the engine's own
 *      `parseChairVerdict`, so there is no second parser to drift. This also
 *      recovers runs whose verdict.json was already nulled by the defect.
 *
 * Never invents: an absent, skipped, or unstructured chair yields null.
 * @param {string} runDir
 * @param {string} [runId] record.meta.runId — the run being rebuilt
 * @returns {string|null} a canonical chair verdict phrase, or null
 */
function readOverallVerdict(runDir, runId) {
  try {
    const prior = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    if (typeof prior.overallVerdict === 'string' && prior.overallVerdict
      && (!runId || prior.runId === runId)) {
      return prior.overallVerdict;
    }
  } catch { /* no prior verdict.json, or unreadable — try the chair prose */ }
  try {
    return parseChairVerdict(fs.readFileSync(path.join(runDir, 'chair-output.md'), 'utf-8'));
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

/** Atomic write: tmp + rename (matches the repo's wave.json convention). */
function writeVerdictAtomic(filePath, verdict) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(verdict, null, 2));
  fs.renameSync(tmp, filePath);
}

module.exports = {
  buildVerdict, summarizeSeatLoss, deriveSeatLoss, readOverallVerdict, readPriorVerdictSurfaces,
  writeVerdictAtomic, VERDICT_SCHEMA_VERSION,
};
