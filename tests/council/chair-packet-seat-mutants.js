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

// ── on src/council/briefings-chair.js :: buildChairPacket ────────────────────

  // Named mutant "ALIASBACK": revert site (1) to its pre-SI-25 alias-only
  // expression — `` `--- Review by ${r.model} ---` `` — i.e. delete the
  // `displayName(r.seat) ||` half. It is the "SI-25 never happened" mutant for
  // the review header, and it is the shape the packet actually shipped.
  // MEASURED red set: 1 suite / 3 tests, out of 546 / 7914. By suite:
  //   chair-packet-seats 3 —
  //     "site (1) — the two review headers are distinguishable"
  //     "the packet a paid chair reads carries no bare alias for a twinned seat"
  //     "a TWIN seat DOES ride the projection into the header"
  // ⚠️ NOTHING ELSE IN 546 SUITES NOTICES, and that is the measurement this item
  // exists because of: the collapsed twin-bench header was invisible to the whole
  // tree before these pins. Do not read 3/7914 as a weak pin.

  // Named mutant "SEATONLY": drop the `|| <alias>` fallback at ALL THREE sites at
  // once — `${displayName(r.seat)}`, `${r.seat}` for the ranking key, and
  // `${a.seat}` for the adjudication key. THIS IS THE MUTANT THAT PROVES R25-2
  // (spec §4.2 byte identity) IS LOAD-BEARING rather than decorative.
  // MEASURED red set: 4 suites / 12 tests, out of 546 / 7914. By suite:
  //   chair-packet-seats 9 · run-all-clean 1 · run-claude-review 1 ·
  //   briefings-stage2 1.
  //   The three OUTSIDE this item's own file are the pre-existing pins §0.7
  //   named, and they fire for three different reasons:
  //     run-claude-review "claude joins the bundle as review N+1…" — the Claude
  //       review carries NO seat at all, so site (1) renders `undefined`. The
  //       fallback is load-bearing there, not defensive.
  //     briefings-stage2 "the rankings the judges DID produce still reach the
  //       chair" and run-all-clean "the chair packet says the bench was clean…"
  //       — ordinary unique-alias benches, where the seat channel is ABSENT by
  //       the emit-when-DIFFERENT rule and every site falls back.
  // ⚠️ The R25-3 tie test does NOT red here: its ranking carries a seat, and
  // SEATONLY does not touch seatKeyedOrder. A smaller-than-expected overlap
  // between two mutants is information, not an error.

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
