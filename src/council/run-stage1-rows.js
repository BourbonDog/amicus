// src/council/run-stage1-rows.js
'use strict';
// Superseded-seat rows + primary-error dead-seat rows (v4.7 D2/E4), moved
// verbatim from run-stages.js:230-279 (v4.8 PR0 size-gate split, zero
// behavior). The code ran inline in runStage1; it is now a function.
// roleFor is a PARAMETER, not a require — requiring it back from
// run-stages would recreate the parent-child cycle that file's tail
// comment documents eliminating (v4.4.1 F5).
const { buildRunStatsEntry } = require('./run-assemble');

/** Push superseded-seat and primary-error dead-seat rows onto extraRows. */
function pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows, roleFor }) {
  // v4.7 D2/E4 — superseded rows: a leg-origin seat's FIRST leg stops being
  // primary the moment a retry was actually attempted for it, healed or not
  // (deadLegs0 × recovered-or-still-dead seats — mirrors the healed-set idiom
  // above, extended to the still-dead half E4 also requires). A skipped seat
  // (cost ceiling / unmappable — never got a second leg) keeps NO superseded
  // row: nothing replaced it. Wave-origin seats never had a first leg at all,
  // so they can never appear here regardless of healed/dead outcome (E4).
  const supersededAliases = new Set([
    ...retry.recoveredLegs.map(l => l.modelInput || l.model),
    ...retry.stillDeadLegs.map(l => l.modelInput || l.model),
  ]);
  for (const dead of deadLegs0) {
    const alias = dead.modelInput || dead.model;
    if (supersededAliases.has(alias)) {
      extraRows.push(buildRunStatsEntry({ leg: dead, model: alias, role: 'superseded', wasChair: false }));
    }
  }

  // v4.7 D2/E4 — primary error rows: one per seat with NO surviving review
  // (every alias still in stillDeadLegs/stillDeadWaves after retry). E5
  // amended (Task-4 review, owner-ruled): run-retry.js now surfaces the real
  // retry leg (stillDeadRetryLegs), from the ONE branch it exists in —
  // retryLegStillDeadNote, a retry leg that came back unusable. Prefer that
  // REAL leg: status/waveId/usage/duration all real, all from the SAME
  // attempt (no more pairing a retry's waveId with a different attempt's
  // status). The other two dead-leg note classes — srcLegStillDeadNote (retry
  // wave died wholesale, zero legs) and missingLegStillDeadNote (partial
  // return never named this seat) — never get a real leg, so `leg: null`
  // (no phantom waveId: one must never appear without a real billed leg).
  // No 'dead-leg' note at all ⇒ never retried (skipped) ⇒ the original dead
  // leg is this seat's only, and therefore final, leg.
  const retryLegByAlias = new Map();
  for (const leg of retry.stillDeadRetryLegs) { retryLegByAlias.set(leg.modelInput || leg.model, leg); }
  const attemptedAliases = new Set();
  for (const n of retry.stillDeadNotes) {
    if (n.channel === 'dead-leg' && n.data && n.data.seat) { attemptedAliases.add(n.data.seat); }
  }
  const deadAliases = new Set([
    ...stillDeadLegs.map(l => l.modelInput || l.model),
    ...stillDeadWaves.flatMap(w => w.models || []),
  ]);
  for (const alias of deadAliases) {
    let finalLeg = retryLegByAlias.get(alias);
    if (!finalLeg) {
      finalLeg = attemptedAliases.has(alias)
        ? null                                                              // retried; no leg at all for this seat
        : (deadLegs0.find(l => (l.modelInput || l.model) === alias) || null); // never retried
    }
    extraRows.push(buildRunStatsEntry({ leg: finalLeg, model: alias, role: roleFor(o, alias), wasChair: false }));
  }
}

module.exports = { pushDeadSeatRows };
