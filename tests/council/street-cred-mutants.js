// tests/council/street-cred-mutants.js
//
// NAMED MUTANT RECORDS for v4.8 T3.3 — seat-keyed street cred and the
// seat-aware ledger join — AND its v4.8 follow-up (2026-08-21) — seat
// resolution under partial/mixed seat information (three council findings on
// PR #176). The mutation, the MEASURED red set, and what that set does and
// does not prove, for every named mutant on src/council/street-cred.js,
// src/council/ledger-join.js, the join key in src/council/ledger.js, and the
// `orderSeats` emit rule in src/council/run-assemble.js.
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
// ledger.js -> LEDGERALIAS, ledger-join.js -> CHAIRWINS, CREDALIAS,
// ALIASLASTWINS and ANYSEATED, street-cred.js -> RANKALIAS, ALIASDRIVER and
// EXPANDONCE, run-assemble.js -> EMITSET. NINE of the thirteen records below
// are anchored that way (re-measured at this task, which added a citation for
// ALIASDRIVER that did not exist before, alongside its two new siblings); the
// other four (ALIASSELF, JUDGEALIAS, SEATALWAYS, NOFALLBACK) are named in
// prose beside them and ride those anchors' protection of the FILE rather
// than of their own names.
// A citation must also sit on ONE line — the regex does not span a wrapped
// comment, which is how two of these anchors were silently inert when first
// written, and it is why they were measured instead of assumed.
//
// ⚠️ RE-RUN, NEVER RENUMBER. A recorded red set ASSERTS that the set still
// holds. Re-run every record below whose guarded expression OR its consumers
// changed, and re-take the DENOMINATOR with it.
//
// DENOMINATOR: 542 suites / 7795 passed / 8 skipped / 4 snapshots / 0 failed,
// at this task's commit (v48-seat-resolution, source+tests), which is the
// tree every red set below was measured against. Baseline before this task,
// at `13cd0a2d`: 542 / 7782 / 8. Each mutant was applied by exact-string
// replacement via a small Node script (the peer-split-mutants.js precedent's
// "exact-string replacement" done programmatically rather than by hand, to
// keep 13 applications honest), run with the full `npx jest`, then restored
// from a FILE COPY taken before the run — never `git checkout`/`restore`/
// `stash` — and re-verified with `git diff --quiet -- src/`.
//
// ⚠️ ALL THIRTEEN WERE RE-RUN AT THIS TASK (v4.8 follow-up, 2026-08-21), not
// just the two whose guarded code this task edited (CREDALIAS, ALIASDRIVER)
// plus the two new ones (ANYSEATED, EXPANDONCE), because a red set rots when
// its CONSUMERS move and this task added 13 tests (9 to street-cred.test.js,
// 4 to ledger.test.js). SIX sets GREW and are re-recorded below with the
// reason; none SHRANK. LEDGERALIAS 2/1, CREDALIAS 2/1, CHAIRWINS 3/1,
// JUDGEALIAS 3/2 and EMITSET 2/2 did not move. RANKALIAS 13/2 -> 14/3,
// ALIASSELF 5/2 -> 6/3, SEATALWAYS 10/5 -> 11/5, ALIASDRIVER 12/3 -> 15/3 (its
// MUTATION TEXT also changed — the code it guards was rewritten for Rule A, so
// the old single-conditional flip no longer exists to mutate; see its record),
// NOFALLBACK 3/2 -> 4/2 and ALIASLASTWINS 5/2 -> 8/2. ANYSEATED and EXPANDONCE
// are new. Fix round 1's denominator was 542 / 7782 at `8027391b`; every
// number here is from this task's re-run, against the tree with Rule A and
// Rule B and all 13 new tests in place (this file's own record excluded, since
// it loads in no suite).
//
// ⚠️ READ THIS BEFORE READING ANY NUMBER BELOW — the T3.3 header's point
// still holds and this task adds to it, not against it: every NEW test this
// task wrote targets exactly the two shapes BASE (pre-T3.3 AND pre-this-task)
// could not produce — a seat table that disagrees with `models` in COUNT
// (Rule A) and a pair group that is seated in PART (Rule B). Nothing in the
// tree before this task could tell "row dropped" from "row present but
// alias-keyed", or "MIXED" from "none seated", because nothing produced those
// shapes. Where a mutant here reds an OLDER pin as well as this task's new
// ones, the record says so by name.

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
  // "unique-alias bench: on-disk artifact parity" describe in
  // tests/council/seat-parity-ondisk.test.js stays GREEN. It drives the real
  // `runCouncil` over a three-alias `--debate` bench and reads all five
  // documents off disk; this mutant is invisible there because every key in
  // `sc` is the alias in both spellings. If it ever starts reding on a
  // unique-alias bench, the byte-identity property is what broke, not the join.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS. Stated plainly rather than left to be
  // inferred — see the header.
  //
  // ⚠️ RE-RUN at this task (v4.8 follow-up, credFor rewritten for Rule B —
  // §0.5's composition concern is exactly "does a mutant here still catch the
  // same defect once the other function changed shape"). UNCHANGED at 2/1:
  // this mutant disables the SEAT lookup entirely, and Rule B only changes
  // WHEN that lookup is allowed to win, not what happens once it is disabled
  // — none of this task's new MIXED/composition tests depend on `sc`'s key.

// ── on src/council/ledger-join.js :: credFor ─────────────────────────────────

  // Named mutant "CREDALIAS": disable the seat lookup outright, so the alias
  // fallback wins even on a genuinely fully-seated group.
  //   const rows = fully ? [...new Set(ids)].map(id => sc.get(id))
  //   -> const rows = false ? [...new Set(ids)].map(id => sc.get(id))
  //     : (streetCred || []).filter(s => s && s.model === model);
  //
  // ⚠️ MUTATION TEXT CHANGED at this task (v4.8 follow-up): the guarded line
  // used to read `const rows = seated.length ? seated`, `seated` computed by
  // `[...new Set(group.map(r => r.seat).filter(Boolean))].map(id =>
  // sc.get(id)).filter(Boolean)`. Rule B (below, see ANYSEATED) replaced that
  // computation with an ALL-OR-NOTHING gate (`fully`), so the condition this
  // mutant forces to `false` is `fully`, not `seated.length`. The MUTATION
  // ITSELF — force the seat lookup to never win — is unchanged; only the
  // variable it forces is renamed by the surrounding rewrite.
  //
  // RE-RUN at this task. RED: 2 tests / 1 suite — UNCHANGED, the SAME set as
  // LEDGERALIAS, byte for byte:
  //   tests/council/ledger.test.js — T12b:
  //     "twins SPLIT across executables: each row reads its OWN seat, neither
  //      is dropped" · "SI-19: a leg-less SEATED twin no longer borrows its
  //      live twin's numbers"
  // None of this task's new tests depend on the seat lookup being ABLE to
  // win at all — the two new MIXED tests are already fallback-bound before
  // this mutant touches anything (that is Rule B's whole point, guarded by
  // ANYSEATED instead), and the composition tests read a group whose OTHER
  // seat is genuinely unresolvable regardless of this gate.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

  /**
   * v4.8 follow-up (2026-08-21) — Rule B, council finding 3 on PR #176.
   * Named mutant "ANYSEATED": revert the ALL-OR-NOTHING gate to its pre-fix
   * "any resolves" form.
   *   const ids = group.map(r => r.seat);
   *   const fully = ids.length > 0 && ids.every(id => id && sc.has(id));
   *   const rows = fully ? [...new Set(ids)].map(id => sc.get(id)) : fallback;
   *   ->
   *   const seated = [...new Set(group.map(r => r.seat).filter(Boolean))]
   *     .map(id => sc.get(id)).filter(Boolean);
   *   const rows = seated.length ? seated : fallback;
   * A wholesale revert rather than a token flip, matching EXPANDONCE's reason
   * below: the two algorithms track different state (a filtered/deduped array
   * of RESOLVED seats vs. an `ids` array that keeps every seat, resolved or
   * not, so `.every` can see the unresolved ones) and there is no smaller edit
   * that reproduces the "any resolves wins" defect this mutant exists to pin.
   *
   * RED: 2 tests / 1 suite.
   *   tests/council/ledger.test.js — "Rule B — MIXED groups read the SAME as
   *     none-seated, never narrower":
   *     "one seated row + one unseated row in the SAME pair group == the
   *      alias mean, not the seated row alone" · "both rows carry A seat, but
   *      only one of them RESOLVES: still not fully identified"
   *
   * ⚠️ WHY NOT 4: this mutant does NOT red either composition test in "Rule A
   * x Rule B composition, end to end through tally()". Both of those groups
   * carry TWO real seat ids ('a#1' and 'a#2'), and 'a#1' resolves in `sc`
   * either way — under "any resolves" that is enough to take the seated
   * branch, same as under the real ALL-OR-NOTHING gate, because the OTHER
   * seat's streetCred row is null in one composition test (filtered out by
   * meanCred either way) and numerically IDENTICAL to its twin in the other
   * (so the mean and the single seated value coincide). MEASURED, not
   * assumed: both composition tests stayed GREEN with this mutant applied.
   * The distinction ANYSEATED exists to catch needs a group where the
   * UNRESOLVED seat's own street-cred number would have moved the result if
   * counted — exactly what the two MIXED tests above construct and the
   * composition tests do not.
   *
   * NO PIN THAT PRE-DATES THIS TASK REDS.
   */

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
  // RE-RUN at this task. RED: 8 tests / 2 suites — GREW from 5/2. The four
  // fix-round-1 tests still red:
  //   tests/council/ledger.test.js — T12b:
  //     "the alias fallback MEANS its rows, it does not take the last one" ·
  //     "twins SHARING one executable: one row, and it reads BOTH seats (mean)"
  //     · "a null half is skipped, not averaged as zero" · "streetCred SEATED
  //     but runStats NOT: the alias still resolves — no null"
  //   tests/council/seat-parity-ondisk.test.js —
  //     "the ONE ledger row covering both seats reads both — not whichever the
  //      Map kept"
  // PLUS three new ones this task added, all in ledger.test.js:
  //   "Rule B — MIXED groups …" — "one seated row + one unseated row in the
  //     SAME pair group == the alias mean, not the seated row alone" · "both
  //     rows carry A seat, but only one of them RESOLVES: still not fully
  //     identified" — both fallback-mean over TWO street-cred rows whose
  //     numbers differ (1 vs 5, and 1 vs 5 again), so last-wins (5) disagrees
  //     with the mean (3).
  //   "Rule A x Rule B composition …" — "the unregistered twin position is NOT
  //     dropped from streetCred, and its ONE recoverable number reaches the
  //     ledger" — the fallback array is `[seatedRow, nullRow]`; last-wins
  //     returns the null row's OWN fields (both null), where the mean (with
  //     the null half skipped by meanCred) reads the seated row's real number.
  //   ⚠️ WHY NOT THE OTHER COMPOSITION TEST: "with NO orderSeats either …"
  //   builds two street-cred rows that are numerically IDENTICAL (neither
  //   channel distinguishes the two bench positions), so last-wins and the
  //   mean agree by construction — the same reason three fix-round-1 tests
  //   left LEDGERALIAS/CREDALIAS's sets for this one, seen again.
  //
  // ⚠️ Note which tests these are: three of the fix-round-1 four LEFT
  // LEDGERALIAS/CREDALIAS's sets in that round. That is the redistribution,
  // seen from the other side — those fixtures pin the COMBINATION RULE, not
  // which lookup found the rows, and this mutant is the one that can now tell.
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
  // RE-RUN at this task. RED: 3 tests / 1 suite — UNCHANGED; `benchLegs` is
  // untouched by Rule A or Rule B and this task added no test that exercises
  // SI-17's normalise.
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
  // RE-RUN at this task. RED: 14 tests / 3 suites — GREW from 13/2, the
  // widest set here, because every downstream number is computed off this map.
  //   tests/council/street-cred.test.js — all four seated `rankPositions`
  //     cases, plus "a twin bench emits one row per seat, and the two rows
  //     DIVERGE", "SI-06 / ruling C-2 …", "`| 24 |`: perJudgeRank now has one
  //     entry per JUDGE …", and "orderSeats but NO seat table …"
  //   tests/council/seat-parity-ondisk.test.js — both T3.3 tests in the twin
  //     describe and all three in the asymmetric one.
  //   tests/council/ledger.test.js (NEW suite for this mutant) — "Rule A x
  //     Rule B composition …" — "the unregistered twin position is NOT
  //     dropped from streetCred, and its ONE recoverable number reaches the
  //     ledger": that test's seated row (key `a#1`) depends on `pos` holding a
  //     REAL `a#1` entry; alias-keyed, `pos` never gets one and the row's
  //     `withSelf`/`peersOnly` collapse to null right alongside its already-null
  //     twin, failing the `toBeCloseTo(4 / 3)` pin. ⚠️ The OTHER composition
  //     test ("with NO orderSeats either …") stays green: it never relies on a
  //     seat-keyed `pos` entry to begin with, since neither channel names one.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

// ── on src/council/street-cred.js :: computeStreetCred ───────────────────────

  // Named mutant "ALIASSELF": revert the peer split to the third alias
  // comparison — SI-06 itself, and the mutant that tests controller ruling C-2.
  //   if ((j.seat && seat) ? j.seat !== seat : j.judge !== model) { peers.push(rank); }
  //   -> if (j.judge !== model) { peers.push(rank); }
  //
  // RE-RUN at this task. RED: 6 tests / 3 suites — GREW from 5/2.
  //   tests/council/street-cred.test.js — "SI-06 / ruling C-2: only the judge
  //     that IS this seat is excluded; the TWIN counts"
  //   tests/council/seat-parity-ondisk.test.js — all three of the asymmetric
  //     describe, plus "T3.3: verdict.json carries the seat through its own
  //     closed streetCred literal"
  //   tests/council/ledger.test.js (NEW suite for this mutant) — "Rule A x
  //     Rule B composition …" — "the unregistered twin position is NOT
  //     dropped from streetCred, and its ONE recoverable number reaches the
  //     ledger": the seated row's `peersOnly` (1.5) depends on excluding only
  //     the judge that IS seat `a#1`, keeping its twin `a#2` as a peer; the
  //     alias compare excludes every judge sharing alias `a` instead, changing
  //     the pinned 1.5.
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
  // RE-RUN at this task. RED: 3 tests / 2 suites — UNCHANGED. `perJudgeRank`
  // is not read by anything this task's new tests assert on.
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
  // RE-RUN at this task. RED: 11 tests / 5 suites — GREW from 10/5 (which was
  // 9/4 before fix round 1, which added the first end-to-end quadrant test).
  // The suite count is unchanged; ledger.test.js gains a second test. The ONLY
  // mutant here with real pre-existing coverage, and the four older pins are
  // named because that is the point:
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
  //     real tally(): the BASE numbers, not null" (fix round 1) AND, new at
  //     this task, "Rule A x Rule B composition …" — "the unregistered twin
  //     position is NOT dropped from streetCred, and its ONE recoverable
  //     number reaches the ledger": the alias-keyed row's `seat` field goes
  //     from OMITTED to a PRESENT `null`, and `record.streetCred.map(s =>
  //     s.seat)` distinguishes an absent property (`undefined`) from an
  //     explicit `null` in a plain-array `toEqual`, so the pinned
  //     `['a#1', undefined, undefined]` fails.
  // The schema pins red because `{ seat: undefined }` is a PRESENT property
  // whose value fails `"type": "string"`, even though JSON.stringify omits it —
  // which is why they catch the in-memory record while the on-disk pin catches
  // the serialised document. Two different failure surfaces, both needed.

  // Named mutant "ALIASDRIVER": force the table lookup to always miss, so the
  // seat table is built and then never consulted — every row is alias-keyed.
  //   const id = (byAlias.get(m) || [])[k];
  //   -> const id = undefined;
  //
  // ⚠️ MUTATION TEXT CHANGED at this task (v4.8 follow-up): Rule A replaced
  // the pre-fix `if (!ids) {…continue;} if (expanded.has(m)) {continue;}
  // expanded.add(m); for (id of ids) {…}` loop with a per-alias occurrence
  // count (`seen`), so the old tautological-condition mutation
  // (`if (ids || !ids)`) no longer has a matching line to apply to. The
  // MUTATION'S INTENT is unchanged — disable the seat table lookup, nothing
  // else — and the new one-line form (`id` forced `undefined`) is its most
  // direct translation onto the new code: every occurrence takes the
  // `: { model: m, key: m, seat: null }` arm, exactly as the old mutation's
  // `if (ids || !ids)` forced every occurrence down its own "no seat" arm.
  // ⚠️ THIS MUTATION PRESERVES `rows.length === models.length` — forcing `id`
  // to `undefined` changes every row's CONTENT, never the row COUNT, so it is
  // a genuinely different property from the one EXPANDONCE (below) guards; the
  // two do not overlap in what a shrink would mean.
  //
  // RE-RUN at this task. RED: 15 tests / 3 suites — GREW from 12/3 (which was
  // 11/2 before fix round 1). Suite count unchanged; two suites gained tests.
  //   tests/council/street-cred.test.js (8, up from 6) — both original
  //     `credSeats` expansion cases ("a seated alias expands ONCE …", "the
  //     `claude` tail gets an alias entry …"), three of the `computeStreetCred`
  //     seated cases, "seat table but alias-only rankings …", AND — new at
  //     this task — "partial: the SECOND occurrence is no longer dropped …"
  //     and "over-specified: the surplus registered seat no longer invents an
  //     extra row": both assert EXACT seat ids (`a#1`), which this mutant
  //     erases from every row.
  //   tests/council/seat-parity-ondisk.test.js (5, unchanged) — all five
  //     seat-parity tests that read a twin bench off disk.
  //   tests/council/ledger.test.js (2, up from 1) — the fix-round-1 "the same
  //     quadrant end to end through the real tally(): the BASE numbers, not
  //     null" AND, new at this task, "Rule A x Rule B composition …" — "the
  //     unregistered twin position is NOT dropped from streetCred, and its ONE
  //     recoverable number reaches the ledger": with every row alias-keyed,
  //     the FIRST 'a' occurrence's `withSelf`/`peersOnly` collapse to null
  //     exactly like the second already does, failing the `toBeCloseTo(4 / 3)`
  //     pin. The OTHER composition test ("with NO orderSeats either …") again
  //     stays green — see EXPANDONCE below for the same reasoning restated.
  //
  // NO PIN THAT PRE-DATES T3.3 REDS.

  /**
   * v4.8 follow-up (2026-08-21) — Rule A, council findings 1+2 on PR #176.
   * Named mutant "EXPANDONCE": revert `credSeats`'s whole loop to its pre-fix
   * form — the first occurrence of a named alias expands into EVERY id it has
   * registered at once, and every LATER occurrence of that alias is skipped.
   *   const seen = new Map(), rows = [];
   *   for (const m of models) {
   *     const k = seen.get(m) || 0; seen.set(m, k + 1);
   *     const id = (byAlias.get(m) || [])[k];
   *     rows.push(id ? { model: m, key: id, seat: id === m ? null : id }
   *                  : { model: m, key: m, seat: null });
   *   }
   *   ->
   *   const rows = [], expanded = new Set();
   *   for (const m of models) {
   *     const ids = byAlias.get(m);
   *     if (!ids) { rows.push({ model: m, key: m, seat: null }); continue; }
   *     if (expanded.has(m)) { continue; }
   *     expanded.add(m);
   *     for (const id of ids) { rows.push({ model: m, key: id, seat: id === m ? null : id }); }
   *   }
   * A wholesale revert rather than a token flip, and named separately from
   * ALIASDRIVER above for exactly the reason stated there: the two algorithms
   * track different state (a per-alias occurrence COUNT vs. a Set of aliases
   * already expanded), so there is no smaller edit that reproduces the
   * drop/invent pair this mutant exists to pin, and — unlike ALIASDRIVER —
   * this mutation DOES change the row count on the two shapes that matter.
   *
   * RED: 6 tests / 2 suites.
   *   tests/council/street-cred.test.js — "credSeats — Rule A: exactly one row
   *     per `models` entry" — the `partial` and `over-specified` length-
   *     invariant cases from the `test.each` table, PLUS "partial: the SECOND
   *     occurrence is no longer dropped …" and "over-specified: the surplus
   *     registered seat no longer invents an extra row" (both length AND exact
   *     shape fail).
   *   tests/council/ledger.test.js — "Rule A x Rule B composition …" — both
   *     tests: "the unregistered twin position is NOT dropped …" (streetCred
   *     reverts to 2 rows, not 3) and "with NO orderSeats either, the
   *     unregistered position reads the SAME collapsed number as its twin …"
   *     (same — 2 rows, not 3).
   *
   * ⚠️ WHY NOTHING ELSE REDS. On every case this task did NOT change
   * (consistent / alien-alias / no-seats / claude-tail) the pre-fix algorithm
   * and Rule A produce IDENTICAL output — measured in the brief before this
   * task started, and re-confirmed here by the fact that no OLDER pin (every
   * `computeStreetCred` seated test, all five seat-parity tests, the
   * fix-round-1 ledger quadrant test) appears in this red set. Contrast
   * ALIASDRIVER just above, which reds every one of those by nulling every
   * seat regardless of case — the two mutants are complementary rather than
   * redundant: ALIASDRIVER catches "is the table consulted at all",
   * EXPANDONCE catches "is the row COUNT right when the table disagrees with
   * `models`".
   *
   * NO PIN THAT PRE-DATES THIS TASK REDS.
   */

  // Named mutant "NOFALLBACK": drop the alias fallback in the position lookup,
  // so a seated ROW can only ever read a seated MAP.
  //   const rank = j.pos.has(key) ? j.pos.get(key) : j.pos.get(model);
  //   -> const rank = j.pos.get(key);
  //
  // RE-RUN at this task. RED: 4 tests / 2 suites — GREW from 3/2 (which was
  // 2/1 before fix round 1). Suite count unchanged. Two are in the "the
  // two channels are INDEPENDENT" describe of
  // tests/council/street-cred.test.js: "seat table but alias-only rankings:
  // rows are seated, NUMBERS stay at BASE" and "⚠️ RESIDUAL, pinned
  // deliberately: alias-only judges still collapse perJudgeRank". The third,
  // added at fix round 1, is ledger.test.js's "the same quadrant end to end
  // through the real tally(): the BASE numbers, not null" — the SAME quadrant
  // one layer down, which is why the two rounds' fixes meet here: this mutant
  // nulls the street-cred rows and the fix-round-1 defect nulled the ledger row
  // built from them. The fourth, new at this task and also in ledger.test.js,
  // is "Rule A x Rule B composition …" — "with NO orderSeats either, the
  // unregistered position reads the SAME collapsed number as its twin — not
  // null, not dropped": the SEATED row (key `a#1`) has no real `a#1` entry in
  // an alias-only `pos` map either, so without the fallback to `pos.get(model)`
  // it collapses to null too, breaking the "both rows equal, neither null"
  // pin. ⚠️ The OTHER composition test does NOT red here — its seated row's
  // key `a#1` resolves through the REAL fallback (`orderSeats` names it), which
  // is exactly what this mutant removes only when the direct lookup misses.
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
  // RE-RUN at this task. RED: 2 tests / 2 suites — UNCHANGED. `run-assemble.js`
  // is untouched by Rule A or Rule B (explicitly out of scope — this task's
  // brief forbids touching it), and every new test builds its `tally()` input
  // by hand rather than through `buildTallyInput`.
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
  //
  // ⚠️ NOT RE-RUN at this task (v4.8 follow-up), by scope rather than by
  // oversight, and the reason is structural rather than assumed: Rule A and
  // Rule B are BOTH measured no-ops on every case an engine-produced document
  // can be in — `consistent` (Rule A) and every case unmodified by Rule B —
  // because `run-assemble.js :: buildTallyInput` is the one `appendRun` call
  // site (of three) where `meta.seats`/`meta.models` and
  // `runStats[].seat`/`streetCred[].seat` are built from the SAME `seats[]`
  // table in the same pass (credSeats' own docblock: "two of appendRun's three
  // call sites feed hand-assembled input no seat machinery touches" — this is
  // the third). The `partial`/`over-specified`/MIXED shapes this task fixes
  // are unreachable from that path by construction, not merely unobserved on
  // this one fixture, so a byte-identity re-run would re-prove a premise this
  // task did not touch rather than test anything Rule A or Rule B changed.
