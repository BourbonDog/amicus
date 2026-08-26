// src/council/run-stats-entry.js
'use strict';

/**
 * @module council/run-stats-entry
 * One runStats row from a leg run document. Extracted verbatim from
 * ./run-assemble (v4.8 Phase 1 T1.1) to give that file headroom under the
 * 300-line gate, and re-exported there so every existing call spelling —
 * `asm.buildRunStatsEntry(...)` and pulling `buildRunStatsEntry` off
 * `./run-assemble`'s own exports — survives the move untouched.
 *
 * ⚠️ This module is REQUIRE-FREE by design, like ./seats. Consumers that cannot
 * take run-assemble's graph (./debate.js is dependency-injection-free) must be
 * able to import it. Do not add a `require` call here — the pin (P3,
 * tests/council/run-stats-entry.test.js) scans this file's raw text for the
 * word `require` immediately followed by an opening parenthesis, so it fires
 * on that sequence ANYWHERE, including inside a comment, not only inside a
 * real statement.
 */

/**
 * One runStats row from a leg run document. Verbatim copies only — a missing
 * leg doc yields durationMs/usage null (never invent a value). `model` (the
 * council alias) overrides leg.model (the resolved executable id) so ledger
 * rows join meta.models by exact string (ledger.js:20-24).
 * `resolvedModel` (v4.7 GOA-7) preserves leg.model — the executable id that
 * actually served, post-fallback-substitution — emit-only-when-set and never
 * sourced from modelInput (an alias must never masquerade as a resolved id).
 *
 * ⚠️ LC-11 / review F1: `findingsUnverified` and `repairRefused` are the same
 * class of fact as `conformance` and ride the same row. They are the two halves
 * of the repair contract's outcome: `findingsUnverified` marks a 'repaired' seat
 * whose contract could NOT be checked (the original block was absent or
 * unparseable, so there was no finding count to compare), and `repairRefused`
 * ({code, detail}) marks the stronger case — the contract WAS checked and broken,
 * which is otherwise indistinguishable from a seat that never emitted JSON at
 * all. Both are additive and present only when set, so a run without either is
 * byte-for-byte unchanged.
 *
 * `seat` (v4.8 PR4c §3.1) is the seat OBJECT — {id, alias, role, lens, position}
 * or null — never an id string. Callers pass `r.seat` / the dead-seat loop's own
 * `seat` verbatim, so the object IS the contract instead of a prose one.
 *
 * `ttftMs` (v4.9 W13 Task A) is time-to-first-token for this row's leg, read off
 * the leg document and emitted only when it is a number. PROBE ONLY — nothing
 * derives a backstop, threshold, or routing decision from it yet (ruling R12:
 * probe first, derive later). Absent means no substantive tick was observed,
 * which is neither `0` (a real measurement) nor `null`.
 */
function buildRunStatsEntry({ leg, model, role, wasChair, conformance, findingsUnverified,
  repairRefused, seat }) {
  // v4.9 W13 Task A: the TTFT probe's last hop, read off the LEG document the
  // same way `waveId` and `resolvedModel` below are. DEVIATION from the plan's
  // literal "thread from the leg at the callers": ten call sites across seven
  // council modules hold a leg, and threading a parameter through each would
  // (a) reach outside this task's file scope and (b) make a forgotten caller a
  // SILENT gap. Sourcing it here covers every caller that holds a leg by
  // construction, and a dead seat (`leg: null`) still carries no key.
  const ttftMs = leg ? leg.ttftMs : undefined;
  return {
    model: model !== undefined ? model : (leg ? leg.model : null),
    role,
    wasChair: !!wasChair,
    conformance: conformance || 'clean',
    ...(findingsUnverified ? { findingsUnverified: true } : {}),
    ...(repairRefused ? { repairRefused } : {}),
    ...(leg && leg.waveId ? { waveId: leg.waveId } : {}),
    ...(leg && leg.model ? { resolvedModel: leg.model } : {}),
    // v4.8 PR4c §3.1 / R4c-9: emit-when-DIFFERENT, compared against the seat's
    // OWN alias — never against `model`. buildSeats mints `alias#N` only when
    // an alias repeats (seats.js:67), so `id !== alias` IS "the bench repeats
    // this alias": the single predicate all four seat-emit producers now share,
    // which is what stops them disagreeing. `model` is the LEG's modelInput,
    // which is NOT the alias when a leg reports none (it falls back to the
    // RESOLVED id, the same fallback run-launch.js :: materializeReviews uses)
    // or when a --council preset carries a padded member — either would ship a
    // seat id with no seat table behind it, on a bench with no twin at all.
    ...(seat && seat.id !== seat.alias ? { seat: seat.id } : {}),
    status: leg ? leg.status : 'error',
    durationMs: leg && typeof leg.durationMs === 'number' ? leg.durationMs : null,
    // Emit-when-set, NOT `durationMs`'s null-coercion one line above: this row
    // is the C2 derivation's future input, and a null there would be read as a
    // measurement. Absent means "never observed" and must stay absent.
    ...(typeof ttftMs === 'number' ? { ttftMs } : {}),
    usage: (leg && leg.usage) || null,
  };
}

module.exports = { buildRunStatsEntry };
