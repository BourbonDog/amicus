// src/council/street-cred.js
'use strict';

/**
 * @module council/street-cred
 * The street-cred half of the tally: rank positions, the seat universe, and
 * `computeStreetCred` itself. Split out of ./tally at v4.8 T3.3 because the
 * seat-keying work took that file to 301 of 300 lines — release Constraint 6
 * is EXTRACT, never shave a comment to fit. ./tally re-exports
 * `computeStreetCred`, so no import path in the tree moved.
 *
 * ⚠️ REQUIRE-FREE by design, the ./seats · ./run-stats-entry · ./peer-split
 * precedent: this is a leaf, so the dependency runs one way (tally.js ->
 * street-cred.js) and cannot cycle.
 *
 * ⚠️ SEVEN named mutants guard the expressions below — RANKALIAS, ALIASSELF,
 * JUDGEALIAS, SEATALWAYS, ALIASDRIVER, NOFALLBACK and EXPANDONCE (v4.8
 * follow-up). Each mutation and its MEASURED red set is recorded beside the
 * others, in tests/council/street-cred-mutants.js :: RANKALIAS and its six
 * siblings there, following the tests/council/peer-split-mutants.js ::
 * SPLITDROP precedent. RE-RUN them, never renumber them, whenever anything
 * here or any of its consumers changes.
 */

function mean(arr) { return arr.reduce((s, x) => s + x, 0) / arr.length; }

/**
 * Map each ranked IDENTITY to its (possibly fractional) rank position in one
 * judge's order — its SEAT id where the parallel `orderSeats` channel names
 * one, its alias otherwise.
 *
 * v4.8 T3.3, the first of SI-20's three collapse sites. `pos.set(m, …)` was
 * last-wins BY ALIAS, so a twin bench's `order ['a','a','b']` overwrote the
 * first twin's position 1 with the second's 2 instead of giving each its own
 * entry. MEASURED at BASE `b341b273` on that bench: both `a` street-cred rows
 * came back `withSelf 2.667 / peersOnly 3` off the SAME collapsed map, and
 * `JSON.stringify(row0) === JSON.stringify(row1)` was `true`. Seat keys are
 * what make those two rows diverge — which is why the ledger's join had to be
 * seat-aware in the same commit; the hazard is written out in full at
 * ledger-join.js :: credFor.
 *
 * `order` itself is UNTOUCHED: still alias-valued, still the array
 * briefings-chair.js :: buildChairPacket and the tally schema read.
 * `orderSeats` mirrors `order` slot for slot — anonymize.js :: rankingToOrder
 * builds both from the same `slots` array in the same pass, so a tie group is
 * an array in both. Where it is absent, shorter, or holds `null` (every
 * pre-T3.2 caller, every unique-alias bench, and any hand-assembled input the
 * seat machinery never touched) `|| group[k]` falls back to the alias and this
 * function returns byte-for-byte what it returned before.
 * @param {Array<string|string[]>} order alias-valued rank slots
 * @param {?Array<?string|Array<?string>>} orderSeats parallel seat ids, null per unseated slot
 */
function rankPositions(order, orderSeats) {
  const pos = new Map();
  let p = 1;
  for (let i = 0; i < order.length; i += 1) {
    const group = Array.isArray(order[i]) ? order[i] : [order[i]];
    const seatSlot = orderSeats ? orderSeats[i] : null;
    const seatGroup = Array.isArray(seatSlot) ? seatSlot : [seatSlot];
    const meanPos = p + (group.length - 1) / 2;
    for (let k = 0; k < group.length; k += 1) { pos.set(seatGroup[k] || group[k], meanPos); }
    p += group.length;
  }
  return pos;
}

/**
 * The street-cred universe: exactly one entry per `models` OCCURRENCE, never
 * fewer and never more. `seats` NAMES rows; it never changes how many exist.
 *
 * v4.8 follow-up (2026-08-21) — council findings 1+2 on PR #176, reproduced at
 * BASE `13cd0a2d`. The row count used to follow `seats` wherever it disagreed
 * with `models`'s repeat count for an alias: the FIRST occurrence the table
 * named expanded into ALL of that alias's registered ids at once, and every
 * LATER occurrence of the same alias was skipped outright. So an alias the
 * table OVER-registers (more ids than `models` repeats it) INVENTED an extra
 * row on its first occurrence, and an alias it UNDER-registers (fewer ids than
 * `models` repeats it) DROPPED a row on its later occurrence(s) once the
 * table's ids for it ran out. Both are reachable only on the two
 * hand-assembled `appendRun` paths — `mcp-tools.js :: amicus_council_tally`
 * declares `meta.seats` independently of `meta.models` and
 * `cli-handlers-council.js` passes user JSON through verbatim — never on the
 * engine's own output, where `seats[]` and `models` always agree by
 * construction: `seats.js :: buildSeats` is `aliases.map(...)` over the same
 * bench array, so it is structurally one-to-one with the bench and cannot
 * itself over- or under-register an alias, independent of anything
 * `preflightSeats` separately rejects (id collisions, critic placement).
 *
 * FIX: the k-th occurrence of alias `m` in `models` takes the k-th id
 * `byAlias.get(m)` registered for it, in table order. Once that list is
 * exhausted (or the table never named `m` at all) the occurrence gets an
 * ALIAS-KEYED row (`key: m, seat: null`) instead of being dropped, and a
 * surplus registered id simply goes unused instead of being invented into an
 * extra row — so `credSeats(models, seats).length === models.length` always.
 *
 * ⚠️ JOINED BY VALUE — never positionally. run-assemble.js :: buildTallyInput
 * forbids the positional join in-code and the reasons are all live here:
 * `seats[]` is BENCH-ONLY, `meta.models` carries a `claude` tail it never has,
 * and two of appendRun's three call sites feed hand-assembled input no seat
 * machinery touches — exactly the input shape where `models` and `seats` can
 * disagree in COUNT, not merely in content.
 * @param {string[]} models meta.models (the ALIAS list)
 * @param {?Array<{id: string, alias: string}>} seats meta.seats, absent on most runs
 * @returns {Array<{model: string, key: string, seat: ?string}>} always
 *   `models.length` entries. `key` is what rankPositions keyed by; `seat` is
 *   the id, null unless it DIFFERS from the alias — the emit-when-DIFFERENT
 *   predicate every seat producer shares (run-stats-entry.js ::
 *   buildRunStatsEntry), so a unique-alias bench emits no seat field anywhere
 *   and its documents stay byte-identical.
 */
function credSeats(models, seats) {
  const byAlias = new Map();
  for (const s of (Array.isArray(seats) ? seats : [])) {
    if (!s || typeof s.alias !== 'string' || typeof s.id !== 'string') { continue; }
    if (!byAlias.has(s.alias)) { byAlias.set(s.alias, []); }
    byAlias.get(s.alias).push(s.id);
  }
  // Named mutant "EXPANDONCE": revert this whole loop to the pre-fix form —
  // the first occurrence of a named alias expands into EVERY id it has
  // registered, and `expanded.has(m) -> continue` skips every later
  // occurrence outright. That is a wholesale swap rather than a token flip
  // because the two algorithms track different state (a Set of aliases
  // already expanded vs. a per-alias occurrence count) — there is no smaller
  // edit that reproduces the drop/invent pair. tests/council/street-cred-mutants.js :: EXPANDONCE.
  const seen = new Map(), rows = [];
  for (const m of models) {
    const k = seen.get(m) || 0;
    seen.set(m, k + 1);
    // Named mutant "ALIASDRIVER": force `id` to always be falsy, so the table
    // built above is never consulted and every row is alias-keyed —
    // tests/council/street-cred-mutants.js :: ALIASDRIVER.
    const id = (byAlias.get(m) || [])[k];
    rows.push(id ? { model: m, key: id, seat: id === m ? null : id }
                 : { model: m, key: m, seat: null });
  }
  return rows;
}

/**
 * Both-numbers street-cred, ONE ROW PER SEAT. Lower mean rank = better.
 *
 * v4.8 T3.3 closes SI-06 and the rest of SI-20 here. Three things move, and
 * all three are no-ops on a bench with no repeated alias:
 *
 * 1. THE DRIVER is `credSeats` above, not `models.map`. A twin bench used to
 *    emit two BYTE-IDENTICAL rows for the one alias (measured at BASE); it now
 *    emits one row per seat, each carrying its own numbers and its own `seat`.
 * 2. THE PEER SPLIT was `judge !== m`, the THIRD alias comparison in the engine
 *    (SI-06). It now compares SEATS when both sides carry one and aliases
 *    otherwise — the same two-branch shape as peer-split.js :: peersOf (P0 then
 *    P3), reused rather than re-derived. ⚠️ CONTROLLER RULING (ledger C-2):
 *    self-exclusion drops only the judge that IS this seat; the twin's OTHER
 *    seat COUNTS AS A PEER. That matches peersOf's P0 branch, where a vote
 *    whose seat differs from the raiser's is a real peer, and the
 *    `sameModelCorroboration` stamp in tally.js :: tally already exists to mark
 *    such support as concurrence rather than independence. Counting-and-marking
 *    is this release's settled shape (owner ruling R2). The alias arm is what a
 *    bench with no seat channel keeps, so today's numbers do not move there.
 * 3. `perJudgeRank` was `[judge] = rank` — last-wins by judge alias while
 *    `all`/`peers` accumulate into ARRAYS, so on a twin-JUDGE bench the map and
 *    the averages disagreed about the SAME row (the phasing doc's row `| 24 |`
 *    data-loss site). MEASURED at BASE on judges `['a','a','b']` all ranking
 *    `a`: `perJudgeRank {"a":3,"b":3}` — 2 entries for 3 judges, implying mean
 *    3, while `withSelf` reported 2.667. Keying on the judge's SEAT closes it
 *    wherever a seat channel exists, which is every engine-produced twin bench
 *    (run-assemble.js emits `rankings[].seat` for both twins).
 *    ⚠️ RESIDUAL, stated rather than left to be discovered: hand-assembled or
 *    MCP input that repeats a judge alias and carries NO seat still collapses,
 *    because nothing in that document can tell the two judges apart. Ruling R2
 *    governs — attribute nothing where there is nothing to attribute.
 *
 * @param {Array<{judge:string, order:Array<string|string[]>, seat?:string,
 *   orderSeats?:Array<?string|Array<?string>>}>} rankings
 * @param {string[]} models all reviewed models (incl. claude when in-council)
 * @param {?Array<{id: string, alias: string}>} seats meta.seats, when the document has one
 */
function computeStreetCred(rankings, models, seats) {
  const judgePos = rankings.map(r => ({
    judge: r.judge, seat: r.seat || null, pos: rankPositions(r.order, r.orderSeats),
  }));
  return credSeats(models, seats).map(({ model, key, seat }) => {
    const all = [], peers = [], perJudgeRank = {};
    for (const j of judgePos) {
      // Seat key first, ALIAS SECOND. `meta.seats` and `rankings[].orderSeats`
      // are independent channels: a document can carry the seat table while its
      // rankings are alias-only (both hand-assembled `appendRun` paths, and an
      // MCP caller that omits orderSeats). Without the fallback both seat rows
      // would find nothing in an alias-keyed map and report null street cred —
      // strictly worse than the collapse this task exists to fix. With it they
      // read the same collapsed position today's code gives, and only the new
      // `seat` field distinguishes them.
      const rank = j.pos.has(key) ? j.pos.get(key) : j.pos.get(model);
      if (rank === undefined) { continue; }   // absent from this judge's ranking → skip
      perJudgeRank[j.seat || j.judge] = rank;
      all.push(rank);
      if ((j.seat && seat) ? j.seat !== seat : j.judge !== model) { peers.push(rank); }
    }
    return {
      model,
      withSelf: all.length ? mean(all) : null,
      peersOnly: peers.length ? mean(peers) : null,
      perJudgeRank,
      // Last, matching verdict.js :: buildVerdict's streetCred literal, which
      // already carries this field through under the same predicate (T3.2).
      ...(seat ? { seat } : {}),
    };
  });
}

module.exports = { computeStreetCred, rankPositions, credSeats };
