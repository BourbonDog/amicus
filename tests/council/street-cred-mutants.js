// tests/council/street-cred-mutants.js
//
// NAMED MUTANT RECORDS for v4.8 T3.3 — seat-keyed street cred and the
// seat-aware ledger join. The mutation, the MEASURED red set, and what that
// set does and does not prove, for every named mutant on
// src/council/street-cred.js, src/council/ledger-join.js, the join key in
// src/council/ledger.js, and the `orderSeats` emit rule in
// src/council/run-assemble.js.
//
// ⚠️ NOT A JEST SUITE, AND NOT MEANT TO BECOME ONE — the
// tests/council/peer-split-mutants.js precedent, for its reason:
// jest.config.js :: testMatch collects **/tests/**/*.test.js only, so nothing
// here loads and the suite count does not move, while
// scripts/check-citations.js :: scanSet DOES cover tests/**/*.js. Deleting or
// renaming this file therefore breaks the anchors that point at it loudly, at
// the commit that does it, instead of silently.
//
// ⚠️ THAT PROPERTY IS MEASURED, AND IT IS NARROWER THAN IT SOUNDS. Only the
// `path :: SYMBOL` form parses as a citation — a bare path in prose does not,
// measured with the real exported `parseCitations` against a first draft of
// these anchors, which returned ZERO citations from all four files. Rewritten
// to the symbol form and re-measured with `checkCitation` against a tracked
// set with this file removed, every one reports `no tracked file matches`:
// ledger.js -> LEDGERALIAS, ledger-join.js -> CHAIRWINS, CREDALIAS and
// ALIASLASTWINS, street-cred.js -> RANKALIAS, run-assemble.js -> EMITSET. SIX
// of the eleven records below are anchored that way; the other five (ALIASSELF,
// JUDGEALIAS, SEATALWAYS, ALIASDRIVER, NOFALLBACK) are named in prose beside
// them and ride those anchors' protection of the FILE rather than of their own
// names.
// A citation must also sit on ONE line — the regex does not span a wrapped
// comment, which is how two of these anchors were silently inert when first
// written, and it is why they were measured instead of assumed.
//
// ⚠️ RE-RUN, NEVER RENUMBER. A recorded red set ASSERTS that the set still
// holds. Re-run every record below whose guarded expression OR its consumers
// changed, and re-take the DENOMINATOR with it.
//
// DENOMINATOR: 542 suites / 7782 passed / 8 skipped / 4 snapshots / 0 failed,
// at `8027391b`, which is the tree every red set below was measured against.
// Baseline before this task, at `b341b273`: 541 suites / 7740 passed / 8
// skipped. Each mutant was applied by exact-string replacement into a
// COMMITTED tree, run with the full `npx jest`, then restored from a file copy
// taken before the run and re-verified with `git diff --quiet -- src/`.
//
// ⚠️ ALL ELEVEN WERE RE-RUN AT FIX ROUND 1 (`8027391b`), not just the two that
// round edited, because a red set rots when its CONSUMERS move and that round
// added three tests to ledger.test.js. Five sets moved and are re-recorded
// below with the reason: LEDGERALIAS 5/2 -> 2/1, CREDALIAS 5/2 -> 2/1,
// SEATALWAYS 9/4 -> 10/5, ALIASDRIVER 11/2 -> 12/3, NOFALLBACK 2/1 -> 3/2.
// CHAIRWINS, RANKALIAS, ALIASSELF, JUDGEALIAS and EMITSET did not move.
// ALIASLASTWINS is new in that round. The first-round denominator was
// 542 / 7779 at `fb3fa09d`; every number here is from the re-run.
//
// ⚠️ READ THIS BEFORE READING ANY NUMBER BELOW — nine of the eleven mutants
// red ONLY tests this task wrote, and that is a structural fact rather than a
// coverage excuse. At BASE the two street-cred rows of a twin bench were
// BYTE-IDENTICAL (measured on `['a','a','b']`: `withSelf 2.667 / peersOnly 3 /
// perJudgeRank {"a":3,"b":3}` on both, `JSON.stringify(row0) ===
// JSON.stringify(row1)` true). No fixture in the tree could tell a seat-keyed
// join from an alias-keyed one, because nothing in the tree produced two rows
// that differed. `ledger.test.js` T12 is the proof: it was TITLED "street cred
// stays alias-keyed on EVERY row", it is the pin the plan named for
// replacement, and it stayed GREEN against both this change and its own
// mutant — its fixture has no seated runStats row, so it takes the alias
// branch either way. That is why it was retitled and why the SEATED T12b was
// built beside it. Where a mutant DOES red something older, the record says so
// by name. SEATALWAYS is the one that reds four.

// ── on src/council/ledger.js :: buildLedgerRows (the join key) ───────────────

  // Named mutant "LEDGERALIAS": key the street-cred index by the ALIAS, so the
  // seat lookup can never resolve.
  //   const sc = new Map(streetCred.filter(s => s && s.seat).map(s => [s.seat, s]));
  //   ->                                                    .map(s => [s.model, s]));
  // This is the brief's mutant (a) and the release's central hazard: with the
  // rows diverging, dropping the seat lookup loses a real seat's numbers into
  // an append-only file that is never migrated.
  //
  // RED: 2 tests / 1 suite.
  //   tests/council/ledger.test.js — T12b:
  //     "twins SPLIT across executables: each row reads its OWN seat, neither
  //      is dropped" · "SI-19: a leg-less SEATED twin no longer borrows its
  //      live twin's numbers"
  //
  // ⚠️ THIS SET SHRANK AT FIX ROUND 1, from 5 tests / 2 suites, and the reason
  // is a PROPERTY rather than a gap — re-recorded rather than quietly kept.
  // Before that round the mutant fell back to `sc.get(model)`, a LAST-WINS
  // single row; it now falls back to the MEAN of the alias's street-cred rows.
  // On any fixture where the pair group's seats are exactly the alias's whole
  // row set, seat-mean and alias-mean are the same number BY CONSTRUCTION, so
  // three tests can no longer tell the two apart and moved to ALIASLASTWINS's
  // set below. What still reds is precisely the shapes where the group's seats
  // are a strict SUBSET of the alias's rows: split executables, and the
  // leg-less twin. Between them the two records cover what the old five did,
  // plus the quadrant that round added.
  //
  // ⚠️ THE ASYMMETRY IS THE POINT, and it is measured, not argued: the
  // "unique-alias bench: on-disk artifact parity" describe in that same file
  // stays GREEN. It drives the real `runCouncil` over a three-alias `--debate`
  // bench and reads all five documents off disk; this mutant is invisible
  // there because every key in `sc` is the alias in both spellings. If it ever
  // starts reding on a unique-alias bench, the byte-identity property is what
  // broke, not the join.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS. Stated plainly rather than left to be
  // inferred — see the header.

// ── on src/council/ledger-join.js :: credFor ─────────────────────────────────

  // Named mutant "CREDALIAS": the other half of the same revert — make the
  // alias fallback unconditional so the seat lookup never wins.
  //   const rows = seated.length ? seated
  //   -> const rows = false ? seated
  //
  // RED: 2 tests / 1 suite — the SAME set as LEDGERALIAS, byte for byte, and it
  // moved with it (5/2 -> 2/1) for the same reason recorded there. Kept as a
  // separate record because the two are independent edits to two files and
  // either alone disables the seat lookup; a reviewer who reverts one and sees
  // green from the other's pins would draw the wrong conclusion.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

  // Named mutant "ALIASLASTWINS": keep both lookups, but COMBINE by last-wins
  // instead of by mean.
  //   return { withSelf: meanCred(rows, 'withSelf'), peersOnly: meanCred(rows, 'peersOnly') };
  //   -> return rows[rows.length - 1];
  // Added at fix round 1. It exists because that round made the alias fallback
  // a MEAN, and the mean is INDISTINGUISHABLE from last-wins on every shape
  // BASE could produce — brute-forced at BASE over 4374 cases yielding 3402
  // duplicated-alias groups, ZERO of which had rows that differ. A design
  // choice that no mutant can kill is a design choice nothing pins.
  //
  // RED: 5 tests / 2 suites.
  //   tests/council/ledger.test.js — T12b:
  //     "the alias fallback MEANS its rows, it does not take the last one" ·
  //     "twins SHARING one executable: one row, and it reads BOTH seats (mean)"
  //     · "a null half is skipped, not averaged as zero" · "streetCred SEATED
  //     but runStats NOT: the alias still resolves — no null"
  //   tests/council/seat-parity-ondisk.test.js —
  //     "the ONE ledger row covering both seats reads both — not whichever the
  //      Map kept"
  //
  // ⚠️ Note which tests these are: three of them LEFT LEDGERALIAS/CREDALIAS's
  // sets in the same round. That is the redistribution, seen from the other
  // side — those fixtures pin the COMBINATION RULE, not which lookup found the
  // rows, and this mutant is the one that can now tell.
  // ⚠️ `rows[rows.length - 1]` returns the street-cred ROW itself, which carries
  // `model`/`perJudgeRank`/`seat` alongside the two numbers. That is deliberate
  // and harmless: buildLedgerRows reads only `s.withSelf` and `s.peersOnly`, so
  // the mutation changes the VALUES and nothing else.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

// ── on src/council/ledger-join.js :: benchLegs (SI-17's normalise) ───────────

  // Named mutant "CHAIRWINS": give the chair-synthesis row its old power over
  // a bench leg's role and conformance.
  //   return bench.length ? bench : group;
  //   -> return bench.length ? group : group;
  //
  // RED: 3 tests / 1 suite.
  //   tests/council/ledger.test.js — the whole replaced T14:
  //     "the BENCH leg decides role and conformance; wasChair still rides
  //      along" · "the REVERSE direction — the one the old pin could not see —
  //      no longer contaminates" · "a group of ONLY chair rows is untouched —
  //      there is no bench leg to prefer"
  //
  // The RED-BEFORE-GREEN evidence for SI-17 is separate and stronger, because
  // it came from the pin that PRE-DATED this task: run against the implemented
  // source with the ORIGINAL T14 still in place, the suite reported
  // `Expected: "chair" / Received: "council"` at ledger.test.js:863 — one
  // failure in 541 suites, and the only one the source change caused. That old
  // T14 was the BACKLOG's "today's answer" for chair-on-bench, which owner
  // ruling R4 rules against, so it was replaced rather than adjusted.
  //
  // ⚠️ The third red above is the one that matters for scope: `benchLegs` must
  // fall BACK to the whole group when a group holds only chair rows, or T16's
  // split-resolution chair leg and the give-up row lose their own role and
  // conformance to a 'clean'/'council' default. The mutant reds it because the
  // two arms become the same expression, not because that arm is wrong.

// ── on src/council/street-cred.js :: rankPositions ───────────────────────────

  // Named mutant "RANKALIAS": revert to alias keying — the brief's mutant (b),
  // and SI-20's first collapse site.
  //   for (let k = 0; k < group.length; k += 1) { pos.set(seatGroup[k] || group[k], meanPos); }
  //   -> ...                                    { pos.set(group[k], meanPos); }
  //
  // RED: 13 tests / 2 suites — the widest set here, because every downstream
  // number is computed off this map.
  //   tests/council/street-cred.test.js — all four seated `rankPositions`
  //     cases, plus "a twin bench emits one row per seat, and the two rows
  //     DIVERGE", "SI-06 / ruling C-2 …", "`| 24 |`: perJudgeRank now has one
  //     entry per JUDGE …", and "orderSeats but NO seat table …"
  //   tests/council/seat-parity-ondisk.test.js — both T3.3 tests in the twin
  //     describe and all three in the asymmetric one.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

// ── on src/council/street-cred.js :: computeStreetCred ───────────────────────

  // Named mutant "ALIASSELF": revert the peer split to the third alias
  // comparison — SI-06 itself, and the mutant that tests controller ruling C-2.
  //   if ((j.seat && seat) ? j.seat !== seat : j.judge !== model) { peers.push(rank); }
  //   -> if (j.judge !== model) { peers.push(rank); }
  //
  // RED: 5 tests / 2 suites.
  //   tests/council/street-cred.test.js — "SI-06 / ruling C-2: only the judge
  //     that IS this seat is excluded; the TWIN counts"
  //   tests/council/seat-parity-ondisk.test.js — all three of the asymmetric
  //     describe, plus "T3.3: verdict.json carries the seat through its own
  //     closed streetCred literal"
  //
  // ⚠️ WHAT THE NUMBER PROVES. On the asymmetric twin bench each seat has
  // exactly ONE peer and it is the other seat of its own alias, so the alias
  // compare drops it. MEASURED with the mutant applied: `peersOnly` goes from
  // 1 and 2 to `null` on BOTH rows, while `withSelf` stays 1 and 2. That is
  // why the pins assert the peers-only VALUES rather than merely that the two
  // rows differ — the rows differ either way.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

  // Named mutant "JUDGEALIAS": revert `perJudgeRank`'s key to the judge alias
  // — the phasing doc's unfiled `| 24 |` data-loss site.
  //   perJudgeRank[j.seat || j.judge] = rank;  ->  perJudgeRank[j.judge] = rank;
  //
  // RED: 3 tests / 2 suites.
  //   tests/council/street-cred.test.js — "`| 24 |`: perJudgeRank now has one
  //     entry per JUDGE, and agrees with withSelf"
  //   tests/council/seat-parity-ondisk.test.js — "the two seats report
  //     DIFFERENT numbers, and each row names which seat it is" · "T3.3:
  //     tally.json carries one street-cred row per SEAT, with a per-judge map
  //     each"
  //
  // ⚠️ SMALLEST SET HERE, and deliberately so: `perJudgeRank` feeds no
  // arithmetic — `withSelf`/`peersOnly` accumulate into arrays independently —
  // so collapsing it changes only the map itself. That is exactly the defect
  // (the map and the averages disagreed about the same row), and it also means
  // three pins are the whole of its coverage. Do not thin them.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

  // Named mutant "SEATALWAYS": emit `seat` on every street-cred row instead of
  // only when it differs from the alias.
  //   ...(seat ? { seat } : {}),  ->  seat,
  //
  // RED: 10 tests / 5 suites (was 9/4 before fix round 1, which added the
  // end-to-end quadrant test named at the end of this list). The ONLY mutant
  // here with real pre-existing coverage, and the four older pins are named
  // because that is the point:
  //   tests/schemas.test.js — "council-tally.schema.json accepts tally()
  //     output"                                          (PRE-DATES T3.3)
  //   tests/council/run-schema-debate.test.js — "a REAL tally() document
  //     carrying the mark validates, and really carries it" · "a document that
  //     does not orphan a twin leg omits the key and still validates"
  //                                                      (both PRE-DATE T3.3)
  //   tests/council/seat-parity-ondisk.test.js — "all five documents exist and
  //     none contains a seat key or a placeholder id"     (PRE-DATES T3.3, and
  //     so does the `"seat":` needle that fires here — PR3's)
  //   tests/council/street-cred.test.js — five, including both byte-identity
  //     cases and "the seat field is emit-when-DIFFERENT …"
  //   tests/council/ledger.test.js — "the same quadrant end to end through the
  //     real tally(): the BASE numbers, not null"      (added at fix round 1)
  // The schema pins red because `{ seat: undefined }` is a PRESENT property
  // whose value fails `"type": "string"`, even though JSON.stringify omits it —
  // which is why they catch the in-memory record while the on-disk pin catches
  // the serialised document. Two different failure surfaces, both needed.

  // Named mutant "ALIASDRIVER": revert the driver to `models.map`, so the seat
  // table is built and then never consulted.
  //   if (!ids)         { rows.push({ model: m, key: m, seat: null }); continue; }
  //   -> if (ids || !ids) { rows.push({ model: m, key: m, seat: null }); continue; }
  //
  // RED: 12 tests / 3 suites (was 11/2 before fix round 1) — both `credSeats`
  // expansion cases, three of the `computeStreetCred` seated cases, "seat table
  // but alias-only rankings …", all five seat-parity tests that read a twin
  // bench off disk, and — new in that round — ledger.test.js's "the same
  // quadrant end to end through the real tally(): the BASE numbers, not null",
  // which is what carries the third suite.
  //
  // ⚠️ Spelled as a tautological CONDITION rather than by deleting the branch,
  // so the mutation is one token and the two arms stay visibly parallel. A
  // deletion would also remove the `continue`, which changes control flow for
  // reasons unrelated to the property under test.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

  // Named mutant "NOFALLBACK": drop the alias fallback in the position lookup,
  // so a seated ROW can only ever read a seated MAP.
  //   const rank = j.pos.has(key) ? j.pos.get(key) : j.pos.get(model);
  //   -> const rank = j.pos.get(key);
  //
  // RED: 3 tests / 2 suites (was 2/1 before fix round 1). Two are in the "the
  // two channels are INDEPENDENT" describe of
  // tests/council/street-cred.test.js: "seat table but alias-only rankings:
  // rows are seated, NUMBERS stay at BASE" and "⚠️ RESIDUAL, pinned
  // deliberately: alias-only judges still collapse perJudgeRank". The third,
  // added at fix round 1, is ledger.test.js's "the same quadrant end to end
  // through the real tally(): the BASE numbers, not null" — the SAME quadrant
  // one layer down, which is why the two rounds' fixes meet here: this mutant
  // nulls the street-cred rows and the fix-round-1 defect nulled the ledger row
  // built from them.
  //
  // ⚠️ THIS MUTANT EXISTS BECAUSE THE FALLBACK LOOKS LIKE DECORATION AND IS
  // NOT. `meta.seats` and `rankings[].orderSeats` come from different
  // producers, and both hand-assembled `appendRun` callers can supply one
  // without the other. MEASURED with the mutant applied, on `['a','a','b']`
  // with meta.seats but alias-only rankings: both `a#N` rows report
  // `withSelf: null, peersOnly: null` while the unique alias `b` — whose key
  // IS its alias, so the seat lookup hits — still reads 2/2. That is a
  // REGRESSION past the collapse this task exists to fix, since today those
  // two rows at least carry a number. Two pins are its whole coverage.

// ── on src/council/run-assemble.js :: buildTallyInput (the emit rule) ────────

  // Named mutant "EMITSET": emit `orderSeats` whenever the field is an array,
  // rather than when it carries at least one non-null.
  //   ...(Array.isArray(j.orderSeats) && j.orderSeats.flat().some(Boolean)
  //   -> ...(Array.isArray(j.orderSeats)
  //
  // RED: 2 tests / 2 suites.
  //   tests/council/run-assemble.test.js — "⚠️ an ALL-NULL parity shape emits
  //     NOTHING — the unique-alias byte-identity guard"
  //   tests/council/seat-parity-ondisk.test.js — "all five documents exist and
  //     none contains a seat key or a placeholder id"    (the TEST pre-dates
  //     T3.3 — PR3 wrote it; the `"orderSeats":` needle that makes it fire is
  //     this task's addition to its FORBIDDEN list)
  //
  // ⚠️ THE ONLY SEAT CHANNEL WHOSE PRODUCER DOES NOT HAND BACK AN ABSENCE.
  // Every other emit-when-DIFFERENT guard in v4.8 compares a seat id to its
  // alias, so the "nothing to say" case is falsy on its own.
  // anonymize.js :: rankingToOrder returns a PARITY-SHAPED `[null, null, null]`
  // instead, which is truthy, so emit-when-SET adds a key to rankings[] in
  // tally-input.json, tally.json and tally-provisional.json on every
  // unique-alias run that has ever happened. Two pins, one unit and one
  // end-to-end, because the unit one alone would not have caught a mutation
  // further down the thread.

// ── the byte-identity proof, which is not a mutant ───────────────────────────

  // The plan's definition of done asks for byte-identity on a unique-alias
  // bench PROVED BY EXECUTION, so it was proved that way rather than by
  // reasoning from the emit predicates. The same `runCouncil` --debate bench
  // the parity suite drives (`models ['gemini','gpt','qwen']`, chair
  // 'deepseek', pinned runId and date) was run twice into two directories —
  // once at HEAD, once with tally.js, ledger.js and run-assemble.js swapped for
  // their `b341b273` contents — and every artifact compared.
  // ⚠️ RE-RUN AT FIX ROUND 1 against `8027391b`, because that round changed the
  // ledger join itself and an inherited proof would have been a proof about a
  // different function. Same result: 20 artifacts identical by raw sha256, and
  // run.json identical once timestamps, pid and the run-directory path are
  // normalised.
  //
  // IDENTICAL, raw sha256, no normalisation: tally-input.json · tally.json ·
  // tally-provisional.json · verdict.json · debate.json · report.html ·
  // chair-packet.md · briefing-stage1.md · bundle-stage2.md · chair-output.md ·
  // the three judge-*.md · the three review-*.md · rebuttal-gemini.md ·
  // revote-bundle.md · both revote-*.md · and the buildLedgerRows output.
  // run.json differs ONLY in `startedAt`/`completedAt`/`createdAt`, `pid` and
  // the run-directory path, and is identical once those are normalised.
