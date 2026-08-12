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

module.exports = { slug, sanitizeName, buildSeats, roleAt };
