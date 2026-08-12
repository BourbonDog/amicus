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

/**
 * The artifact filename for one seat. Reproduces the four shapes shipping
 * today — review-/judge-/rebuttal-/revote-<name>.md, the exact key set
 * workspace/artifact-guard.js enumerates — with the seat id in place of the
 * alias. Identical output for every bench that has ever run; a twin sanitizes
 * to `review-deepseek-2.md`, which is the collision surface preflightSeats
 * rejects pre-spend.
 * @param {{id: string}} seat
 * @param {'review'|'judge'|'rebuttal'|'revote'} kind
 * @returns {string}
 */
function artifactName(seat, kind) {
  return `${kind}-${sanitizeName(seat && seat.id)}.md`;
}

/**
 * How a seat is named to a human — chair packet review headers today.
 * Deliberately the seat id and nothing more: spec §4.2's byte-identical
 * promise means a unique-alias seat MUST render as its bare alias, so lens
 * text, position and role can never be appended unconditionally. It exists as
 * a named seam so a later rev changes presentation in one place instead of at
 * every call site.
 * @param {{id: string}} seat
 * @returns {string}
 */
function displayName(seat) {
  return seat && seat.id;
}

const SEATS_ERROR = 'COUNCIL_SEATS_INVALID';

/**
 * Mint the seat table and validate it, pre-spend. Runs AFTER initRun (so the
 * error doc lands in a run dir that exists) and BEFORE any launch, exactly like
 * its sibling preflightClaudeReview.
 *
 * Rejects four ways, all zero-spend:
 *   - two bench entries resolving to the SAME seat id (a bench alias spelling
 *     another alias's disambiguated id, e.g. 'deepseek#2' beside twin
 *     'deepseek' entries) — that table would be incoherent as a join key,
 *   - a collision in which a DISAMBIGUATED (#N) id participates, i.e. two seats
 *     whose review files would be the same name. Deliberately narrow: a
 *     pure-alias collision ('vendor/a' vs 'vendor?a') runs today and
 *     workspace/artifact-guard.js exists to detect and surface it, so v4.8
 *     refuses only the collisions its own id scheme creates,
 *   - a --critic alias occupying more than one seat,
 *   - a critic that is not on the bench at all. runCouncil never checked this
 *     (only the CLI/MCP handlers did), so a direct require() caller silently
 *     launched an N+1th leg meta.models never mentioned.
 *
 * Remedies ride INSIDE message: the engine error is {code, message} and both
 * render paths discard anything else. The message never suggests naming a seat
 * id — every entry point requires bench.includes(critic), so that spelling
 * cannot work until PR2 teaches the handlers.
 *
 * @param {{models: ?Array<string>, critic: ?string, lenses: ?Array<string>}} o
 * @returns {{seats: ?Array<object>, criticSeat: ?string, error: ?{code: string, message: string}}}
 */
function preflightSeats(o) {
  const bad = (detail) => ({ seats: null, criticSeat: null,
    error: { code: SEATS_ERROR, message: `council_seats_invalid: ${detail}` } });
  const seats = buildSeats(o.models, o.critic, o.lenses);

  const byId = new Set();
  const byFile = new Map();
  for (const s of seats) {
    if (byId.has(s.id)) {
      return bad(`two bench entries both resolve to seat id '${s.id}' — a bench alias may not `
        + "spell another alias's disambiguated seat id; rename one entry");
    }
    byId.add(s.id);
    const file = artifactName(s, 'review');
    const prev = byFile.get(file);
    // Only reject collisions this id scheme created: at least one side must be
    // a disambiguated id. Pure-alias collisions are artifact-guard's to surface.
    if (prev && (prev.includes('#') || s.id.includes('#'))) {
      return bad(`seats '${prev}' and '${s.id}' would both write ${file} — rename one bench entry`);
    }
    if (!prev) { byFile.set(file, s.id); }
  }

  if (o.critic) {
    const hits = seats.filter(s => s.alias === o.critic);
    if (hits.length === 0) {
      return bad(`--critic '${o.critic}' is not on the bench (${seats.map(s => s.id).join(', ') || 'empty'})`);
    }
    if (hits.length > 1) {
      return bad(`--critic '${o.critic}' is ambiguous: that alias occupies ${hits.length} bench seats `
        + '— remove the duplicate bench entry, or use two distinct aliases');
    }
    return { seats, criticSeat: hits[0].id, error: null };
  }
  return { seats, criticSeat: null, error: null };
}

module.exports = { slug, sanitizeName, buildSeats, roleAt, bindSeats, artifactName, displayName, preflightSeats };
