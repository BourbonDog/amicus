// tests/council/peer-split-mutants.js
//
// NAMED MUTANT RECORDS for src/council/peer-split.js: the mutation, the
// MEASURED red set, and the history of how that red set moved, for every named
// mutant that mutates that module.
//
// ⚠️ NOT A JEST SUITE, AND NOT MEANT TO BECOME ONE. jest.config.js :: testMatch
// collects **/tests/**/*.test.js only, so nothing here is loaded and the suite
// count does not move. It is a .js file rather than a doc for ONE reason:
// scripts/check-citations.js :: scanSet covers tests/**/*.js and deliberately
// does NOT cover the doc tree, so deleting or renaming this file breaks the
// anchors in peer-split.js loudly, at the commit that does it, instead of
// silently. That property is measured, not argued: drop this path from the
// tracked set and all three anchors report "no tracked file matches".
// ⚠️ It is the ONLY reason. An earlier draft of this header also claimed the
// gate "enforces the citations inside these records"; measured with the real
// exported parseCitations, the 108 moved lines contain ZERO parseable
// citations, and every citation this file does carry is header prose written
// for it. The records do name six files in passing — tally.test.js,
// debate.test.js, peer-split.test.js, run-schema-debate.test.js,
// schemas.test.js and council-tally.schema.json, that list itself measured —
// but never with a line or a symbol, so no gate ever read them. Note what is
// NOT among them: tally.js, debate.js and mcp-tools.js appear nowhere in the
// moved text, though all three are cited from peer-split.js itself.
//
// FIVE named mutants mutate that module. Four are on
// src/council/peer-split.js :: peersOf — SPLITDROP, NAIVESPLIT, SELFCORROB and
// SEATBLIND — and one is on src/council/peer-split.js :: unattributedPeerDrops
// — ZEROEMIT. The release's SIXTH named mutant is not here because it does not
// mutate this module: SCHEMADROP mutates council-tally.schema.json, and its
// record lives with its own pin, at
// tests/council/run-schema-debate.test.js :: SCHEMADROP.
//
// ⚠️ RE-RUN, NEVER RENUMBER. A recorded red set ASSERTS that the set still
// holds; editing the number instead of re-running the mutant is the defect that
// produced T-B3's Critical. Re-run every record below whose guarded expression
// OR its consumers changed, and re-take the denominator with it.
//
// ⚠️ AND "ITS CONSUMERS" INCLUDES THE PINS. Every red set below was re-run at
// v4.8 T-B5 fix round 2, against HEAD, because T-B5 added a volume pin to
// tests/council/peer-split.test.js — see its own docblock — that fires on any
// edit changing peer-split.js's executable LINE COUNT. Four of the five mutants
// here respell the ternary at a different line count, so each gained exactly one
// red test: the P3 REQUIRE-FREE pin. That one test is NOT a behavioural catch,
// and each record below says so. ZEROEMIT was unchanged because it mutates the
// two producers, not this module. Nobody re-ran them when the pin landed, which
// is how three records went stale inside the commit that added it.
//
// ⚠️ These records LEFT the predicate they guard, and the cost of that is worth
// naming rather than discovering: a number beside its expression is re-read by
// anyone editing that expression, and a number in another file is not. Both
// predicates therefore carry a one-line anchor back here, and this is why they
// do.
//
// Moved at v4.8 T-B5 (council C4) out of src/council/peer-split.js, which stood
// at 289 of its 300-line ceiling carrying 14 lines of executable text and 271 of
// comment (measured at 7aa71d1e; the council said "roughly 20" and this is the
// counted figure).
// Every line below is byte-for-byte as it stood at
// src/council/peer-split.js@7aa71d1e :: peersOf and
// src/council/peer-split.js@7aa71d1e :: unattributedPeerDrops — leading
// indentation included — so every measured number below is the number that was
// measured.

// ── on src/council/peer-split.js :: peersOf ──────────────────────────────────

  // Named mutant "SPLITDROP": delete the `f.raiser ? … :` condition in the
  // FALLBACK arm so the ALIAS compare runs for every finding, raiser or not —
  // which deletes the named-judge arm along with the condition. ⚠️ Its MEANING
  // moved twice inside T-B4, and this record says so rather than reading as if
  // it never had: at 64b835b8 the condition was the OUTER `f.raiser ? … : votes`;
  // round 1 kept it outer over a filtering arm; round 2 lifted the seat compare
  // above it, so what is left to delete is the fallback's own condition. The
  // mutation is one idea throughout — make the alias compare unconditional — and
  // it is what the witnesses in tests/council/peer-split.test.js are named for.
  // Never shipped — applied, run against the FULL suite, reverted by hand,
  // byte-verified against `git show HEAD:`.
  // MEASURED red set, re-run at T-B5 fix round 2 against HEAD:
  // 1 suite / 5 tests, out of 541 / 7665. By suite:
  // peer-split 5 — witness A, C1c, P0d, the exhaustive cross-product
  // invariant, and the P3 REQUIRE-FREE pin.
  // ⚠️ FOUR of those five are behavioural. The fifth, P3, is the volume pin
  // firing because this mutation respells the ternary at 3 lines instead of 4 —
  // it catches a reformat, not the behaviour change. The behavioural set is
  // unchanged at 4; the recorded TOTAL moved from 1/4 to 1/5 purely because the
  // pin landed. Do not read the extra test as a stronger pin on this mutant.
  // ⚠️ It has SHRUNK at every step (2 suites / 9 tests at 64b835b8 — peer-split 5
  // · debate 4; 2 / 6 after round 1 — peer-split 4 · tally 2; 1 / 4 now —
  // peer-split only), because each round moved the shipped behaviour closer to
  // this mutant's on the shapes the other tests use. ROUND 1 took debate.test.js
  // away: its T5 block stopped separating the two once the shipped falsy arm
  // began dropping same-falsy pairs, exactly as this mutant does. ROUND 2 took
  // tally.test.js away: T7b/T7d reach the SEAT compare, and P0 settles that
  // before the fallback this mutant edits. What still
  // separates them is a MIXED-falsy raiser/judge pair — `''` beside `undefined`,
  // where the alias compare reads true and `!!v.judge` reads false. Do not read
  // a smaller red set as a weaker pin: it is a narrower TRUE one.
  //
  // Named mutant "NAIVESPLIT" (v4.8 T-B2): replace the whole seat-guarded
  // ternary with the unguarded, seat-valued `v.seat !== f.raiserSeat`, i.e. drop
  // both the `(v.seat && f.raiserSeat)` guard and every fallback branch. (The
  // `f.raiser ?` condition inside the fallback is SPLITDROP's, not this one's.) Never shipped —
  // applied, run against the FULL suite, reverted by hand, byte-verified
  // against `git show HEAD:`. RE-MEASURED at T-B4 against the tree that ships —
  // re-run, never renumbered, because editing a recorded number ASSERTS the red
  // set still holds and that assertion is what produced T-B3's Critical.
  // MEASURED red set, re-run at T-B5 fix round 2 against HEAD:
  // 17 suites / 110 tests, out of 541 / 7665. By suite:
  //   run-debate 50 · tally 13 · peer-split 12 · debate 8 ·
  //   seat-parity-ondisk 5 · report 4 · report-claude-column 4 ·
  //   report-debate 2 · run-claude-review 2 · run-no-cost-gate 2 ·
  //   seat-matrix 2 · cli-handlers-council 1 · council-events 1 · ledger 1 ·
  //   mcp-server 1 · run-assemble 1 · run-cost-bijection 1.
  // It has GROWN across T-B4 (97 at 64b835b8, 98 after round 1, 109 at the end
  // of T-B4) purely because T-B4 added tests in the files NAIVE already broke —
  // the suite list is unchanged at 17.
  // ⚠️ 110 NOW, and the last one is a different KIND. peer-split went 11 -> 12
  // when T-B5 added the volume pin; that twelfth test is P3 REQUIRE-FREE, firing
  // on the line-count change rather than on behaviour. The behavioural red set
  // is still 109. This is the finding that forced fix round 2: the number 109
  // was re-stamped across nine tracked sites while the pin that invalidated it
  // was being added in the same round.
  // ⚠️ That measurement RETIRES a claim this repo carried in three places —
  // "T1 and T2 are the ONLY tests separating GUARDED from NAIVE". They are
  // not, and not even within their own file: 11 of tally.test.js's 13 reds are
  // neither (8 of 10 at the first reading, 9 of 11 after T-B4 round 1). NAIVE breaks the ORDINARY unique-alias bench, where it reads
  // `undefined !== undefined` and drops a real peer, so most of this suite
  // separates the two spellings. T1/T2 remain the only tests pinning the
  // one-side-seated TWIN directions, which is the narrower true statement.

  // Named mutant "SELFCORROB" (v4.8 T-B4): restore `64b835b8`'s whole predicate
  // — `f.raiser ? <the inner ternary> : votes` — so an unnamed raiser
  // corroborates itself again. It is the "T-B4 never happened" mutant and its
  // red set is the whole T-B4 pin surface. Never shipped — applied, run against
  // the FULL suite, reverted by hand, byte-verified against `git show HEAD:`.
  // MEASURED red set, re-run at T-B5 fix round 2 against HEAD:
  // 3 suites / 16 tests, out of 541 / 7665. By suite:
  // peer-split 11 · debate 4 · tally 1.
  // ⚠️ peer-split 10 -> 11 is the T-B5 volume pin (P3 REQUIRE-FREE), not a new
  // behavioural catch: this mutation restores 64b835b8's 3-line predicate where
  // the shipped one is 4 lines. The behavioural set is unchanged at 15.
  // ⚠️ The TOTAL is identical to round 1's reading and the COMPOSITION is not
  // (peer-split 8 -> 10, tally 3 -> 1), which is why it was re-run rather than
  // carried: T7b and T7d stopped separating this mutant, because reverting to
  // `: votes` also keeps the seat-DIFFER vote those two fixtures assert is
  // counted. Two matching totals are not evidence of a matching red set.
  //
  // Named mutant "SEATBLIND" (v4.8 T-B4 round 2), guarding P0's reach: restore
  // round 1's placement — `f.raiser ? <the inner ternary> : votes.filter(v =>
  // !!v.judge)` — so the seat compare runs only for a NAMED raiser. It differs
  // from the shipped form on exactly the shapes P0 was added for, and it is a
  // separate mutant from SELFCORROB because it keeps the C1 fix while dropping
  // the correction to it. Never shipped, same application/revert/verify
  // discipline. MEASURED red set, re-run at T-B5 fix round 2 against HEAD:
  // 2 suites / 6 tests, out of 541 / 7665. By suite: peer-split 4 · tally 2
  // (T7b, T7d). The behavioural three are P0a, P0b and P0c — exactly the set
  // that was RED before round 2's source change and GREEN after it.
  // ⚠️ The fourth peer-split red is the T-B5 volume pin (P3 REQUIRE-FREE),
  // firing on the line-count change rather than on behaviour. The behavioural
  // set is unchanged at 5.

// ── on src/council/peer-split.js :: unattributedPeerDrops ────────────────────

  // Named mutant "ZEROEMIT" (v4.8 T-B2), guarding the EMIT rule both callers
  // share — present only when > 0, so a run that does not orphan one side of a
  // twin pair is byte-for-byte unchanged. Mutation: emit unconditionally at
  // both sites (`unattributedPeerDrops: drops`, zero included). Never shipped —
  // applied, run against the FULL suite, reverted by hand, byte-verified.
  // MEASURED red set, re-taken at T-B4 round 2 and RE-RUN AGAIN at T-B5 fix
  // round 2 against HEAD: 4 suites / 8 tests, out of 541 / 7665 — UNCHANGED,
  // and the invariance is the informative part. This mutation edits the two
  // PRODUCERS (tally.js and debate.js), never peer-split.js, so T-B5's volume
  // pin cannot fire on it. That is why it is one of only two records fix round 2
  // did not have to move.
  //   BEHAVIOURAL — the three absence pins written for this change, plus three
  //   T-B4 added:
  //     tally.test.js T3b · debate.test.js T6b · debate.test.js T6c ·
  //     tally.test.js T8b (the C1 control) · tally.test.js T7b · T7d (the two
  //     P0 shapes, which assert the key is ABSENT on a seat-decided vote — a
  //     drop nobody made, so a zero there would be doubly wrong).
  //   SCHEMA-MEDIATED — both caused by `"minimum": 1` on
  //   council-tally.schema.json's `findings[].unattributedPeerDrops`, which
  //   rejects a present-and-zero key:
  //     run-schema-debate.test.js "a document that does not orphan a twin leg
  //     omits the key and still validates" · schemas.test.js
  //     "council-tally.schema.json accepts tally() output" — the PRE-EXISTING
  //     whole-family check, which nobody wrote for this field.
  //
  // ⚠️ THIS RECORD WAS WRONG BETWEEN e23e56cd AND ITS CORRECTION, and how it
  // went wrong matters more than the number. It read "exactly 3 tests … nothing
  // else in 541 suites notices a stray zero-valued key … that byte-identity
  // property rests on those three pins and nothing else." That was TRUE when
  // written. Then c2e1f9d0 — the SAME task's own fix round — added the schema
  // declaration with `minimum: 1`, which silently made it false, and nothing
  // re-measured the record against the final tree. A number that lives in
  // `src/` is reachable by no gate; only a re-run reaches it. Re-run any mutant
  // record in this file whose guarded expression OR its consumers changed.
  //
  // The correction runs in the SAFE direction, which is why it had to be made
  // rather than left: an engineer reading "rests on those three pins and
  // nothing else" would conclude `minimum: 1` is removable decoration. It is
  // not — it is the fourth and fifth guard. run-schema-debate.test.js says the
  // same thing from its own side and defers the count to here.
