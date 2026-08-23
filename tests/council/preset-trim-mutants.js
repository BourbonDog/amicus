// tests/council/preset-trim-mutants.js
//
// NAMED MUTANT RECORDS for v4.8 SI-22.4 — the `--council` preset member trim
// (`src/utils/config.js :: classifyCouncilMembers`) and its renderer rider
// (`src/council/report-md.js`, `src/council/report-html.js`). The mutation, the
// MEASURED red set, and what that set does and does not prove.
//
// ⚠️ NOT A JEST SUITE, AND NOT MEANT TO BECOME ONE — the
// tests/council/street-cred-mutants.js and tests/council/peer-split-mutants.js
// precedent, for its reason: jest.config.js :: testMatch collects
// **/tests/**/*.test.js only, so nothing here loads and the suite count does not
// move, while scripts/check-citations.js :: scanSet DOES cover tests/**/*.js.
// Deleting or renaming this file therefore breaks the anchors that point at it
// loudly, at the commit that does it, instead of silently.
//
// ⚠️ RE-RUN, NEVER RENUMBER. A recorded red set ASSERTS that the set still
// holds. Re-run every record below whose guarded expression OR its consumers
// changed, and re-take the DENOMINATOR with it.
//
// DENOMINATOR: 549 suites / 7929 passed / 8 skipped / 4 snapshots / 0 failed
// (7937 tests collected), measured with `npx jest --no-coverage` at FULL scope
// on the substantive commit `1c7a9087`, which is the tree every red set below
// reflects. The three new suites are classify-members-trim.test.js (10 tests),
// preset-trim-twin-bench.test.js (4) and report-cred-seat.test.js (6).
// ⚠️ BASE `276d5a18` is 546 suites / 7917 tests BY SUBTRACTION of those three
// suites, DERIVED and not separately measured — stated that way on purpose.
//
// COUNTING RULE for every "red set" below: the set is the list of test-suite
// FILES jest reports as FAIL under `npx jest --no-coverage` at FULL scope with
// the mutation applied and nothing else changed, taken against the denominator
// above. Individual failing test names are quoted where a file goes red for
// only one of its cases. Each mutant was applied by hand as an exact-string
// edit, measured, then hand-reverted and byte-verified with `git diff` (empty)
// plus a SHA-1 against `git show HEAD:<path>` — never `git checkout`/`restore`/
// `stash`, which would discard uncommitted work by effect whatever the spelling.
//
// ─────────────────────────────────────────────────────────────────────────────
// MUTANT "NOTRIM" — src/utils/config.js :: classifyCouncilMembers
//
//   -    const member = typeof raw === 'string' ? raw.trim() : raw;
//   +    const member = raw;
//
// The whole fix, removed. This is the RESURRECTION guard: four of the six
// shapes in §0.1's table have a member that is dropped without the trim and runs
// with it.
//
// RED SET (measured): 2 suites, 9 tests.
//   tests/council/classify-members-trim.test.js  — 6 of 10
//       (all six shapes of the table; every one of them moves)
//   tests/council/preset-trim-twin-bench.test.js — 3 of 4
//       ('resolveBench collapses the preset…', 'buildSeats mints gemini#1/#2…',
//        and the CONTROL, which reds because `['gemini ', 'gpt']` keeps its
//        padding and the run writes `review-gemini-.md` instead of
//        `review-gemini.md`)
//
// ⚠️ THE R22.4-2 PIN DOES **NOT** GO RED UNDER NOTRIM, and the prediction that
// it would was wrong. Measured: both of its members (`'  openai/ghost  '` and
// `' nosuchalias '`) miss their gate whether or not they are trimmed, and the
// drop branches report `raw`, which IS the member when nothing is trimmed — so
// the outcome is byte-identical. That pin guards TRIMDROPPED, not NOTRIM.
//
// ⚠️ WHAT IT DOES NOT PROVE: no test OUTSIDE these two new files moves. That is
// the honest reading of the blast radius — before this task nothing in the tree
// exercised a padded preset member THROUGH classifyCouncilMembers at all (the
// only padded fixtures, in run-assemble.test.js and run-raiserseat-call.test.js,
// construct the bench directly and never call it).
//
// ─────────────────────────────────────────────────────────────────────────────
// MUTANT "TRIMDROPPED" — src/utils/config.js :: classifyCouncilMembers
//
//   Both drop branches: report the TRIMMED value instead of the raw one.
//   -      dropped.push(raw);
//   -      droppedMembers.push({ member: raw, reason: … });
//   +      dropped.push(member);
//   +      droppedMembers.push({ member, reason: … });
//
// R22.4-2: a member still dropped after trimming must be echoed as the user
// wrote it, or they cannot grep their own config for it.
//
// RED SET (measured): 1 suite, 2 tests.
//   tests/council/classify-members-trim.test.js — 2 of 10
//       ('R22.4-2: `dropped` and `droppedMembers` report the RAW string', and
//        'R22.4-3: an all-whitespace member never reaches `models`', which reds
//        because `dropped` comes back `['']` instead of `['   ']`)
//
// ─────────────────────────────────────────────────────────────────────────────
// MUTANT "KEEPEMPTY" — src/utils/config.js :: classifyCouncilMembers
//
//   Let an empty-after-trim member through to `models`, ahead of gate 1:
//   +    if (member === '') { models.push(member); continue; }
//
// R22.4-3 is a PRESERVATION property, not new behaviour: an all-whitespace
// member trims to `''`, which no alias table names, so gate 1 has always dropped
// it and still does — measured identical BEFORE and AFTER the trim on both
// catalog states. There is therefore no token in the shipped code to flip, and
// the mutant is an ADDITION: the smallest edit that produces the defect the pin
// exists to refuse. (This is why R22.4-3 is pinned with a named mutant instead
// of RED-before-GREEN.) ⚠️ Deliberately NOT closed with an explicit guard in the
// shipped code: a guard needs a `reason` string, and a THIRD reason string is
// exactly what classifyCouncilMembers's docblock tripwire says to stop and
// re-decide rather than add on a hygiene fix (R22.4-4).
//
// RED SET (measured): 1 suite, 1 test.
//   tests/council/classify-members-trim.test.js — 1 of 10
//       ('R22.4-3: an all-whitespace member never reaches `models`')
//
// ─────────────────────────────────────────────────────────────────────────────
// MUTANT "CREDALIAS" — src/council/report-md.js AND src/council/report-html.js
//
//   Revert both street-cred row labels to the alias:
//   -  `| ${s.seat || s.model} | …`      +  `| ${s.model} | …`
//   -  `<td>${esc(s.seat || s.model)}</td>`  +  `<td>${esc(s.model)}</td>`
//
// This is BASE `276d5a18`'s expression exactly, so the mutant IS the pre-rider
// renderer. Measured at BASE by loading that commit's own report-md.js and
// rendering report-cred-seat.test.js's TWIN fixture through it: two rows,
// `| gemini | 1.00 | 1.33 |` and `| gemini | 2.00 | 2.00 |` — different numbers,
// one label. The same run confirmed the byte-identity half: on the UNIQ fixture
// BASE and HEAD returned the SAME 733 bytes from renderMd and the SAME 9667
// from renderHtml, whole documents, not just the block.
//
// RED SET (measured): 2 suites, 3 tests.
//   tests/council/report-cred-seat.test.js — 2 of 6
//       (the two 'a twin bench renders two DISTINGUISHABLE street-cred rows'
//        cases, one per renderer)
//   tests/council/seat-matrix.test.js — 1 of 88
//       ('markdown: EVERY reader of the raiser moves together …', whose
//        street-cred assertion this task updated) — a STRONGER witness than
//        report-cred-seat's synthetic fixture, because that suite renders the
//        markdown of an artifact a real `runCouncil` twin bench wrote to disk.
//
// ⚠️ WHAT IT DOES NOT PROVE, measured and not merely expected — and this is
// the reason the rider needed its own pins at all: the two BYTE-IDENTITY cases
// stay GREEN under CREDALIAS, all 4 snapshots pass (report-claude-column,
// report-debate), and every other report test stays green. That is correct —
// they are unique-alias documents, where the two expressions agree by
// construction — but it means the suite as it stood before this task could not
// have caught the rider's absence, and a future reader must not read those green
// snapshots as coverage of this line.

'use strict';
module.exports = {};
