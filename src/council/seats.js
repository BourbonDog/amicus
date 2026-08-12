// src/council/seats.js
'use strict';
// Seat identity (v4.8 workstream A, spec §4). A SEAT is one bench position:
// derived, never minted, stable for the life of a run. For every bench that
// has ever run — no alias repeated — a seat id equals its alias byte-for-byte,
// which is what keeps run.json, tally.json, verdict.json, report.html,
// artifact filenames and ledger rows unchanged.
//
// This module requires NOTHING, deliberately: its consumers (run-stages,
// run-launch, run-retry, run-stage2, run-assemble, run.js) all require IT, so
// any back-require would be a cycle. That is why slug and sanitizeName live
// here and are re-exported from their previous homes.

/** URL/role-safe token from free text (moved from run-stages.js, v4.8 PR1). */
function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Filesystem-safe model name for review-/judge- artifact filenames. */
function sanitizeName(model) {
  return String(model).replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Derive the seat table from data run.json already persists (run-state.js
 * seeds bench/critic/lenses). Pure and TOTAL: critic and lenses are
 * schema-optional and a legacy dir may carry a mismatched pair, so this never
 * throws and never guesses.
 *
 * Seat id (spec §4.2): the alias when it occupies exactly one bench seat, else
 * `alias#N` with N 1-based among the seats sharing that alias.
 *
 * Roles follow run-stages.js roleFor's PRECEDENCE — under lenses every seat is
 * a lens seat and 'critic' is unreachable — and match it for every bench the
 * CLI can produce (no repeated alias; lenses.length === bench.length, enforced
 * at cli-handlers-council-run.js:161). They DELIBERATELY diverge where roleFor
 * is wrong: roles here are POSITIONAL, so twins under lenses get their own
 * lens instead of both getting the first twin's (roleFor uses
 * o.models.indexOf). An empty lenses array counts as no lenses (roleFor treats
 * [] as truthy and yields 'lens:undefined'), and a lenses array shorter than
 * the bench leaves the trailing seats plain for the same reason. Do not
 * "restore parity" — the divergence IS the feature, and it is pinned by tests.
 *
 * The `claude` seat is deliberately absent: 'claude' is rejected from --models
 * (run-assemble.js:92-103) and synthesized onto meta.models downstream (:170).
 * seats[] is bench-only — never assume meta.models.length === seats.length.
 *
 * @param {?Array<string>} bench run.json's bench (o.models)
 * @param {?string} critic run.json's critic
 * @param {?Array<string>} lenses positionally bound to bench
 * @returns {Array<{id: string, alias: string, role: string, lens: ?string, position: number}>}
 */
function buildSeats(bench, critic, lenses) {
  const aliases = Array.isArray(bench) ? bench : [];
  const lensed = Array.isArray(lenses) && lenses.length > 0;
  const counts = new Map();
  for (const a of aliases) { counts.set(a, (counts.get(a) || 0) + 1); }
  const seen = new Map();
  return aliases.map((alias, i) => {
    const n = (seen.get(alias) || 0) + 1;
    seen.set(alias, n);
    const lens = lensed && lenses[i] !== undefined ? lenses[i] : null;
    const role = lensed
      ? (lens === null ? 'seat' : `lens:${slug(lens)}`)
      : (alias === critic ? 'critic' : 'seat');
    return {
      id: counts.get(alias) > 1 ? `${alias}#${n}` : alias,
      alias, role, lens, position: i + 1,
    };
  });
}

/**
 * Role of a seat by its id. Returns 'seat' for an unknown id, matching
 * roleFor's fallthrough for any alias that is not the critic. (roleFor returns
 * 'critic' for an OFF-BENCH critic because run-stages.js:40 is not gated on
 * bench membership; buildSeats never mints a seat for one and preflightSeats
 * rejects that state pre-spend, so 'seat' is right for every run v4.8 creates.)
 * @param {?Array<object>} seats
 * @param {string} seatId
 * @returns {string}
 */
function roleAt(seats, seatId) {
  const hit = (Array.isArray(seats) ? seats : []).find(s => s && s.id === seatId);
  return hit ? hit.role : 'seat';
}

/**
 * Resolve a wave's legs to its seats. Pure: it reports, it never emits a
 * degrade and never guesses — silent mis-attribution is the failure this whole
 * mechanism exists to kill (spec §4.4).
 *
 * `seats` is THE WAVE'S LAUNCH ROSTER, in launch order — not necessarily the
 * full seat table. The -s1 wave is critic-filtered (run-stage1-launch.js:47)
 * and a retry wave is the loss subset (run-retry.js:93), so a legId's `-N`
 * suffix indexes this roster, never bench position.
 *
 * Callers legitimately hold legs from several waves at once, so a leg stamped
 * with a DIFFERENT waveId is ignored rather than reported — call once per wave
 * over the same array. A leg with NO waveId (result-schema.js:61 falls back to
 * `metadata.parentWave || null`, and the council fixtures omit it) may bind
 * ONLY by an exact roster-slot id: adopting it by alias would silently claim a
 * foreign wave's leg.
 *
 * Resolution order per leg:
 *   1. `leg.legId || leg.taskId` matching `${waveId}-${n}` → roster slot n.
 *      Both are read because legId is never persisted, so every disk-rebuilt
 *      wave is taskId-only.
 *   2. alias (`leg.modelInput || leg.model`), only for a wave-stamped leg and
 *      only when that alias holds exactly one seat in this roster — for every
 *      bench that has ever run, this is today's exact behaviour.
 *   3. neither → the leg is an orphan and the seat stays unbound.
 *
 * The greedy `.*` is safe because no waveId generator mints an id ending in
 * `-<digits>` (verified across all 13: -s1, -c1, -l{i}, -s2, -d{n}, -rv,
 * -ch1..4, -p{n}, -q{n}, and the r1 retry forms). A future generator that
 * did would break slot matching.
 *
 * `bound` says nothing about USABILITY: a leg that ran and died still binds
 * (run-launch.js:194-196 drops non-complete legs later). PR2's dead-seat set is
 * `unbound ∪ deadWave.seats ∪ {bound seats materializeReviews rejected}`.
 *
 * @param {string} waveId
 * @param {?Array<object>} seats the wave's launch roster, in launch order
 * @param {?Array<object>} legs
 * @returns {{bound: Array<{seat: object, leg: object}>, unbound: Array<object>, orphanLegs: Array<object>}}
 */
function bindSeats(waveId, seats, legs) {
  const roster = Array.isArray(seats) ? seats.filter(Boolean) : [];
  const all = Array.isArray(legs) ? legs.filter(Boolean) : [];
  const mine = all.filter(l => !l.waveId || l.waveId === waveId);
  const takenBy = new Map();
  const bound = [];
  const orphanLegs = [];
  for (const leg of mine) {
    const id = leg.legId || leg.taskId;
    const m = typeof id === 'string' ? id.match(/^(.*)-(\d+)$/) : null;
    let seat = (m && m[1] === waveId) ? roster[Number(m[2]) - 1] : undefined;
    if (!seat && leg.waveId === waveId) {
      const alias = leg.modelInput || leg.model;
      const hits = roster.filter(s => s.alias === alias);
      seat = hits.length === 1 ? hits[0] : undefined;
    }
    if (!seat || takenBy.has(seat.id)) { orphanLegs.push(leg); continue; }
    takenBy.set(seat.id, leg);
    bound.push({ seat, leg });
  }
  return { bound, unbound: roster.filter(s => !takenBy.has(s.id)), orphanLegs };
}

module.exports = { slug, sanitizeName, buildSeats, roleAt, bindSeats };
