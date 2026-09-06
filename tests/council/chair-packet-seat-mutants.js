// tests/council/chair-packet-seat-mutants.js
//
// NAMED MUTANT RECORDS for v4.8 SI-25 — the mutation, the MEASURED red set, and
// why each set is the size it is. Five mutants: four on
// src/council/briefings-chair.js :: buildChairPacket and
// src/council/briefings-chair.js :: seatKeyedOrder, one on
// src/council/run-assemble.js :: buildChairPacketFile.
//
// ⚠️ NOT A JEST SUITE, AND NOT MEANT TO BECOME ONE. jest.config.js :: testMatch
// collects **/tests/**/*.test.js only, so nothing here is loaded and the suite
// count does not move. It is a .js file rather than a doc for the same single
// reason tests/council/peer-split-mutants.js is: scripts/check-citations.js ::
// scanSet covers tests/**/*.js and deliberately does NOT cover the doc tree, so
// deleting or renaming this file breaks the anchors in briefings-chair.js
// loudly, at the commit that does it, instead of silently.
//
// ⚠️ RE-RUN, NEVER RENUMBER. A recorded red set ASSERTS that the set still
// holds; editing the number instead of re-running the mutant is the defect that
// produced T-B3's Critical. Re-run every record below whose guarded expression
// OR its pins changed, and re-take the denominator with it.
//
// DENOMINATOR for every number below: 546 suites / 7914 tests
// (8 skipped, 7906 passing), `npx jest --no-coverage` at
// f7fe180d. Every mutant was applied by hand, run at FULL suite scope, reverted
// by hand, and byte-verified with `git diff` plus a SHA-1 against
// `git show HEAD:<path>` — never `git checkout --`/`restore`/`stash`.
//
// ⚠️ ALIASBACK and SEATONLY (below) now carry a DIFFERENT denominator — 605
// suites / 9414 tests (8 skipped, 9406 passing), `npx jest --no-coverage` at
// f7f122e1 (#218 PR 3 council r2 fix round 2b) — because the site (1)
// expression both mutants guard changed there (it grew the `r.cut` clause) and
// both records' pins moved with it. NULLLEAK, FLATTIE, and HDRSEATFWD are
// UNCHANGED since the 546/7914 measurement — `seatKeyedOrder` and the
// run-assemble.js seat spread are byte-identical across f7fe180d..f7f122e1 —
// and keep that denominator. SHAPESWAP already carries its own denominator for
// the same reason (see below). A denominator split across records in one file
// is not an error; it is what "re-take the denominator with it" produces when
// only some records are re-run.

// ── on src/council/briefings-chair.js :: buildChairPacket ────────────────────

  // Named mutant "ALIASBACK": revert site (1) to its pre-SI-25 alias-only
  // expression — `` `--- Review by ${r.model}${r.cut ? ' — CUT at its output
  // reservation (…)' : ''} ---` `` — i.e. delete the `displayName(r.seat) ||`
  // half, leaving the #218 PR 3 r2 B1 `r.cut` clause untouched. It is the
  // "SI-25 never happened" mutant for the review header, and it is the shape
  // the packet actually shipped.
  // RE-MEASURED at f7f122e1 (#218 PR 3 council r2 fix round 2b): the guarded
  // expression grew the `r.cut` clause and chair-packet-seats.test.js gained a
  // twin-bench cut-marker pin that reads site (1), so the red set gained one
  // test.
  // MEASURED red set: 1 suite / 4 tests, out of 605 / 9414. By suite:
  //   chair-packet-seats 4 —
  //     "site (1) — the two review headers are distinguishable"
  //     "the packet a paid chair reads carries no bare alias for a twinned seat"
  //     "a TWIN seat DOES ride the projection into the header"
  //     "the marker follows the seat name, not the alias, on a twin bench" —
  //       the #218 PR 3 r2 B1 pin; ALIASBACK renders the bare `r.model`
  //       (`deepseek`, not `deepseek#1`) even though the mutation leaves the
  //       `r.cut` clause itself intact.
  // ⚠️ NOTHING ELSE IN 605 SUITES NOTICES, and that is the measurement this item
  // exists because of: the collapsed twin-bench header was invisible to the whole
  // tree before these pins. Do not read 4/9414 as a weak pin.

  // Named mutant "SEATONLY": drop the `|| <alias>` fallback at ALL THREE sites at
  // once — `${displayName(r.seat)}`, `${r.seat}` for the ranking key, and
  // `${a.seat}` for the adjudication key. THIS IS THE MUTANT THAT PROVES R25-2
  // (spec §4.2 byte identity) IS LOAD-BEARING rather than decorative.
  // RE-MEASURED at f7f122e1 (#218 PR 3 council r2 fix round 2b): site (1)'s
  // expression grew the `r.cut` clause (irrelevant to this mutant's own sites,
  // but it re-ran the file anyway per the guarded-expression rule), and two new
  // seatless pins were added since the 546/7914 measurement — one in
  // chair-packet-seats.test.js (the #218 PR 3 r2 B1 cut-marker test whose
  // reviews carry no `seat`) and one in run-assemble.test.js (the cut-leg
  // projection test, same reason) — plus briefings-chair-task.test.js, a whole
  // suite that did not exist at the 546/7914 measurement and exercises the same
  // three fallback sites through the task-intent twin packet.
  // MEASURED red set: 6 suites / 18 tests, out of 605 / 9414. By suite:
  //   chair-packet-seats 12 · briefings-chair-task 2 · briefings-stage2 1 ·
  //   run-all-clean 1 · run-assemble 1 · run-claude-review 1.
  //   Every failure here is a seatless ranking, adjudication, or review losing
  //   its `judge`/`model` fallback — never a seat-carrying fixture:
  //     run-claude-review "claude joins the bundle as review N+1…" — the Claude
  //       review carries NO seat at all, so site (1) renders `undefined`. The
  //       fallback is load-bearing there, not defensive.
  //     briefings-stage2 "the rankings the judges DID produce still reach the
  //       chair", run-all-clean "the chair packet says the bench was clean…",
  //       and briefings-chair-task's two pins ("every section header and review
  //       label is shared with the review packet", "the ranking and
  //       adjudication rows render identically in both intents") — ordinary
  //       unique-alias benches (or the task-intent packet built from one),
  //       where the seat channel is ABSENT by the emit-when-DIFFERENT rule and
  //       every site falls back.
  //     Inside chair-packet-seats (12): all three R25-2 pins (byte-identity,
  //       the pre-SI-25 rendering, and the Claude fallback), five of the six
  //       R25-3 ranking pins (every one whose fixture omits `seat` — see the
  //       tie-slot exception below), both R25-5 pins whose reviews omit `seat`,
  //       and the new #218 PR 3 r2 B1 cut-marker pin, whose reviews also omit
  //       `seat`.
  // ⚠️ The R25-3 TIE-SLOT test ("a TIE slot zips element-wise…") does NOT red
  // here: its ranking is the one R25-3 fixture that carries an explicit `seat`
  // ('gemini#1'), and SEATONLY does not touch seatKeyedOrder — only the
  // fallback around it. A smaller-than-expected overlap between two mutants is
  // information, not an error.

// ── on src/council/briefings-chair.js :: seatKeyedOrder ──────────────────────

  // Named mutant "NULLLEAK": in the zip, read `orderSeats[i]` unconditionally in
  // the SCALAR arm — `: seats` in place of `: (seats || slot)` — so a `null` or a
  // short array reaches JSON.stringify. `orderSeats` legitimately holds nulls
  // (anonymize.js :: rankingToOrder's `seatOne` returns `… || null`) and
  // run-assemble.js ships a MIXED array, so this is the live shape, not a
  // hypothetical one.
  // MEASURED red set: 1 suite / 4 tests, out of 546 / 7914. By suite:
  //   chair-packet-seats 4 —
  //     "a null in a SCALAR slot falls back to the alias — no null reaches the JSON"
  //     "an orderSeats SHORTER than order neither drops nor nulls the trailing slots"
  //       (a MISSING index stringifies as `null` too — the same leak by a second
  //        route, which is why the short-array shape is pinned separately)
  //     "the two packets are byte-identical"
  //     "and that identity is the pre-SI-25 rendering, not a new one"
  // ⚠️ The last two are R25-2 pins, not R25-3 pins: a unique-alias bench's
  // `orderSeats` is `[null, null]`, so a null leak breaks byte identity as well
  // as correctness. The two invariants are not independent here.

  // Named mutant "FLATTIE": drop the tie arm — replace the whole
  // `Array.isArray(slot) ? … : …` ternary with a bare `return (seats || slot);`
  // — so a tie GROUP is replaced wholesale by its seat array instead of being
  // zipped element-wise.
  // MEASURED red set: 1 suite / 1 test, out of 546 / 7914. By suite:
  //   chair-packet-seats 1 —
  //     "a TIE slot zips element-wise, keeping the alias wherever the seat is null"
  // ⚠️ ONE test, and the narrowness is a property of the mutation, not a gap.
  // Only a tie whose `orderSeats` slot is NON-NULL separates FLATTIE from the
  // shipped form: where that slot is `null` (the sibling pin "a tie whose
  // orderSeats slot is a bare null keeps the whole group") FLATTIE falls through
  // to `slot` and agrees exactly. If you widen the tie fixture, re-run this.

// ── on src/council/run-assemble.js :: buildChairPacketFile ───────────────────

  // Named mutant "HDRSEATFWD" (header seat forward): forward the seat
  // UNCONDITIONALLY through the packet's review projection —
  // `...(r.seat ? { seat: r.seat } : {})` in place of the
  // emit-when-DIFFERENT `r.seat && r.seat.id !== r.seat.alias`. This is
  // the implementation SI-25's own plan prescribed, and it is WRONG: `r.model`
  // there is run-stages.js's `m.modelInput`, i.e. the leg's `modelInput ||
  // model`, which falls back to the RESOLVED id when a leg reports no
  // modelInput — so an unconditional forward rewrites the header from
  // `google/gemini-3.5-pro` to the bare alias `gemini` on a bench with NO TWIN,
  // which is exactly the spec §4.2 break R25-2 forbids.
  // MEASURED red set: 1 suite / 1 test, out of 546 / 7914. By suite:
  //   chair-packet-seats 1 —
  //     "a UNIQUE seat is withheld, so a resolved model id still renders verbatim"
  // ⚠️ ONE test in 7914 stands between this tree and that regression, and before
  // this item there were ZERO — the naive form would have shipped green. That is
  // the whole reason this record exists rather than a comment saying the
  // predicate "is needed".
  // ⚠️ NAMED HDRSEATFWD, NOT "SEATALWAYS", ON PURPOSE (fix round 1, 2026-08-23).
  // This is the chair-packet-HEADER analogue of street-cred's own SEATALWAYS
  // (tests/council/street-cred-mutants.js :: SEATALWAYS, v4.8 Phase 3, red set
  // 11 tests / 5 suites) — both defeat emit-when-DIFFERENT, on different files.
  // They were briefly the same name, which made two forward-looking "re-run the
  // existing mutants" lists ambiguous and made 11/5 next to 1/1 read as a
  // SHRINKING red set, this project's signature for an unpinned property. The
  // names are now such that NEITHER IS A SUBSTRING OF THE OTHER, so a grep for
  // either full name finds only its own. (They do share `SEAT` — the earlier
  // wording here said "share no substring", which is false and would mislead
  // anyone who grepped a shorter key.)

// ---------------------------------------------------------------------------
// SHAPESWAP — briefings-chair.js :: seatKeyedOrder, the scalar arm.
// MUTATION: drop the `Array.isArray(seats) ?` guard, i.e. restore
//   `: (seats || slot)`.
// RED SET, measured 2026-08-23 at FULL `npx jest --no-coverage` scope:
// 1 test, 1 suite.
// ⚠️ DENOMINATOR 546 suites / **7916** tests — NOT the 7914 this file's header
// states for every mutant above it. Both are correct on their own tree: the
// two pins added alongside this fix took the suite 7914 -> 7916, and every
// record above was measured before them. Raised by PR #189's council as B1
// (solid, a3/d0/n0) against an earlier draft that gave 7916 with no basis —
// a number without its basis is not admissible, and a 2-test gap with no
// explanation reads as a measurement error.
//   tests/council/chair-packet-seats.test.js
//     "a SCALAR order slot against an ARRAY orderSeats slot keeps the scalar
//      — no null, no reshape"
// Discriminating output: expected `gemini: ["deepseek"]`, mutant renders
// `gemini: [[null,null]]` — a null in the artifact a paid chair reads as
// authoritative, AND a scalar slot silently promoted to an array.
//
// ⚠️ Its SIBLING pin ("an ARRAY order slot against a SCALAR orderSeats slot
// keeps every alias") does NOT red under SHAPESWAP, and that is correct, not a
// weak pin: that direction was already safe before the fix, because the tie arm
// reads `Array.isArray(seats) ? seats[k] : null`. It is a PRESERVATION pin and
// needs a mutant of its own if that arm is ever touched — FLATTIE is the closest.
//
// PROVENANCE: raised by PR #189's council as A1 (minor, thin — one judge on a
// bench that returned 2 of 4 seats) AND independently by the whole-branch
// reviewer, which called the shape unreachable. Both were right about
// reachability: `anonymize.js :: rankingToOrder` mints `order` and `orderSeats`
// from ONE `slots.map` off the same `Array.isArray` test, so no producer in this
// tree can emit a disagreement. It was fixed anyway, because the docblock's
// no-null promise was stated UNCONDITIONALLY and this arm exists precisely for
// input that no producer minted. "Unreachable today" is the claim that rots.
// The council proposed throwing; that was declined — crashing a paid chair
// packet is worse than a shape-preserving fallback.
