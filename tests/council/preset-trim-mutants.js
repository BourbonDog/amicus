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
// ⚠️ SECOND DENOMINATOR, fix round 2 (2026-08-23): **549 suites / 7935 passed /
// 8 skipped / 4 snapshots / 0 failed (7943 collected)**. The suite count is
// unchanged — round 2 added six tests to two EXISTING suites
// (classify-members-trim.test.js 10→15, config.test.js +1) and no new file.
// NOTRIM / TRIMDROPPED / KEEPEMPTY / ROWSEATDROP above were measured against
// the FIRST denominator and are left as taken; PROTOALIASES below is measured
// against this one. Annotated, not renumbered.
//
// ⚠️ THIRD DENOMINATOR, fix round 3 (2026-08-23): **549 suites / 7940 passed /
// 8 skipped / 4 snapshots / 0 failed (7948 collected)**. Suite count again
// unchanged — round 3 added five tests to tests/config-null-alias.test.js
// (21→26) and no new file. BUILDERPROTO below is measured against THIS one;
// every record above keeps the denominator it was taken with.
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
// MUTANT "ROWSEATDROP" — src/council/report-md.js AND src/council/report-html.js
//
// ⚠️ NAMED "ROWSEATDROP", NOT "CREDALIAS". This mutant was called CREDALIAS
// until fix round 1, which collided with tests/council/street-cred-mutants.js
// :: CREDALIAS — a DIFFERENT mutant, on ledger-join.js :: credFor, with its
// own red set (2 suites / 1 test). Two mutants, one name, different red
// sets: any reader comparing counts would have read one as a regression of
// the other. The new name shares no substring with it deliberately.
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
// stay GREEN under ROWSEATDROP, all 4 snapshots pass (report-claude-column,
// report-debate), and every other report test stays green. That is correct —
// they are unique-alias documents, where the two expressions agree by
// construction — but it means the suite as it stood before this task could not
// have caught the rider's absence, and a future reader must not read those green
// snapshots as coverage of this line.
//
// ─────────────────────────────────────────────────────────────────────────────
// MUTANT "PROTOALIASES" — src/utils/config.js :: getEffectiveAliases
//
//   -  return { __proto__: null, ...DEFAULT_ALIASES, ...userAliases };
//   +  return { ...DEFAULT_ALIASES, ...userAliases };
//
// This is the pre-fix expression exactly, so the mutant IS the shipped v4.7
// behaviour. It restores `Object.prototype` on the alias table, which five
// gates read by bare indexing.
//
// WHAT IT GUARDS (council B1, fix round 2). Measured on the real function,
// BASE `ecf90f19` vs the fixed tree:
//
//     member          BASE          fixed
//     'toString'      ACCEPTED      dropped     <- PRE-EXISTING hole
//     'toString '     dropped       dropped     <- SI-22.4 had WIDENED it
//     'gpt '          dropped       ACCEPTED    <- SI-22.4's intended effect
//     'nope '         dropped       dropped     <- unchanged control
//
// The middle row is why this fix belongs to SI-22.4: at BASE the padded
// spelling MISSED the prototype and was correctly dropped, and trimming before
// the lookup landed it on the inherited property. The unpadded spelling was
// already broken, so a fix restoring only the padded case would have taken more
// code AND deliberately preserved a known hole (owner ruling, fix round 2).
//
// RED SET (measured): 2 suites, 6 tests.
//   tests/council/classify-members-trim.test.js — 5 of 15
//       (all four 'fix round 2 (council B1)' cases, PLUS the rewritten
//        'R22.4-4 … EXACTLY TWO distinct `reason` strings' tripwire, which
//        catches it independently: its `['toString'], []` driver stops being
//        dropped, so the reason count falls 5→4 and the accepted count rises
//        1→2. That the behavioural rewrite kills this mutant — which the
//        textual version could not have — is the clearest evidence for A1.)
//   tests/config.test.js — 1 of 64
//       ('getEffectiveAliases › has a NULL prototype, so an inherited key is
//        not a known alias')
//
// ⚠️ WHAT IT DOES NOT PROVE, measured rather than assumed. The four OTHER gates
// that read this table by bare indexing — `config.js :: resolveModel` `:111`
// and `:142`, `council/presets-cli.js:41`, `pack/pack-validate.js:71`,
// `utils/route-launch.js:205` — have NO test that reds under this mutant except
// the resolveModel case pinned above. The one-line fix closes all five; only two
// are pinned. That is the honest blast radius, recorded so a later reader does
// not mistake the fix's reach for the pin's.
//
// ⚠️ CORRECTED IN FIX ROUND 3 (council G-4). This record used to claim "a THIRD
// SUITE GOES RED AND IT IS NOT A KILL — check-citations fails under the mutation
// and ALSO without it". **That is FALSE at HEAD.** Re-measured with the real
// gate at the final tree: `npm run check:citations` exits 0 and
// tests/scripts/check-citations.test.js passes 62/62 WITH the mutation applied.
// check-citations is not in this mutant's red set at all, and never was at a
// tree where this file's own records exist.
//
// ⚠️ THE EXCLUSION WAS RIGHT; THE PREMISE AND THE CONTROL WERE NOT — and the
// reasoning is worth more than the correction. The transient red was real, but
// only while the PROTOALIASES record below did not yet exist: the two new pins
// cite `preset-trim-mutants.js :: PROTOALIASES` BY SYMBOL, so the citation gate
// failed on a symbol that had not been written. The control used to settle it
// was a LINE-NEUTRAL variant of the same mutation — and that control CANNOT
// settle this question. Both variants delete `__proto__: null`, so their
// agreeing only rules out a LINE-SHIFT artifact; it says nothing about whether
// the mutation itself is the cause. The decisive control is a run at the FINAL
// tree with the record in place, which is exactly what this file's own COUNTING
// RULE already demands ("with the mutation applied and NOTHING ELSE changed").
// The rule was right and was not followed. Every red set in this file is now
// taken that way — records first, measurement second.

// ─────────────────────────────────────────────────────────────────────────────
// MUTANT "BUILDERPROTO" — the THREE producers of the default-alias map
//
//   src/utils/curated-models.js :: toGatewayRoutes   `const out = { __proto__: null }` -> `{}`
//   src/utils/curated-models.js :: toDefaultAliases  `const out = { __proto__: null }` -> `{}`
//   src/utils/config.js         :: getDefaultAliases `{ __proto__: null, ...D }` -> `{ ...D }`
//
// ⚠️ `directFormProvenance` in the same file also seeds `const out = {}` and is
// deliberately NOT part of this mutation. ⚠️ CORRECTED 2026-08-23 — this said
// "its ONLY indexed read ... never user input". There are TWO readers, and the
// second IS reachable from user input:
//   gateway-route-audit.js :: auditGatewayRoutes  — keyed from curated aliases
//   alias-audit.js :: findStaleAliases         — keyed from `collectAliasSources()`,
//     which pushes the user's own `cfg.aliases` entries (source:'user-config')
//     and a raw CLI arg via cli-handlers.js.
// The DECISION still stands, on two independent grounds rather than the one
// claimed: that read is guarded by `source === 'defaults' && prov.directForm
// === 'derived'`, and (a) a user-config alias carries source:'user-config', so
// the first conjunct already fails; (b) an inherited value is a Function, whose
// `.directForm` is undefined, so the second fails too. Fail-open either way,
// which is that function's documented behaviour for stale provenance.
// ⚠️ The lesson, not the fix: the conclusion was right and the stated PREMISE
// was false — an "only reader" claim resting on a sweep that found one of two.
//
// WHY THREE SITES AND NOT ONE. `toDefaultAliases` derives from `toGatewayRoutes`
// via Object.entries, so the two builders travel together. `getDefaultAliases`
// needs its OWN seed because it spreads into a fresh literal — a spread into a
// bare `{}` re-materialises Object.prototype, so fixing the builders alone does
// NOT reach it. Measured, not assumed.
//
// WHAT IT GUARDS (council G-1, fix round 3). Round 2 closed `getEffectiveAliases`
// and that was correct but INCOMPLETE: `resolveModel:114`/`:145` hand
// `DEFAULT_ALIASES` ITSELF to `alias-resolver.js :: autoRepairAlias`, whose gate
// is `defaultAliases[alias]`. That path never touches `getEffectiveAliases`, so
// no round-2 pin could reach it. Measured on the real function with a
// null-valued alias named `toString` on disk:
//
//   round 2:  resolveModel('toString') -> [Function: toString], and it ANNOUNCED
//             "Auto-repaired null alias 'toString' -> 'function toString()
//              { [native code] }'"
//   round 3:  throws "Alias 'toString' is configured but has no model value"
//
// RED SET (measured at the FINAL tree, records in place): 1 suite, 3 tests.
//   tests/config-null-alias.test.js — 3 of 26
//       ('Layer 2b … throws instead of repairing a null alias to an inherited
//        Function', '… never announces an auto-repair for one', and '… the maps
//        the repair path reads are null-prototype at the source')
//
// ⚠️ 'still repairs a REAL null alias' stays GREEN, deliberately — it is the
// control proving the fix is surgical, not a kill.
//
// ⚠️ WHAT IT DOES NOT PROVE. `sidecar/setup.js`'s own two literals — in
// `:: createDefaultConfig` and `:: resolveChoice`, anchored BY SYMBOL because
// this very record first wrote them as `:54`/`:137` and my own comment
// insertions had already moved them to `:58`/`:142` — restate `__proto__: null`
// themselves and are NOT covered by this mutant or any other: the readline gate
// lives in `resolveChoice`, which
// `setup.js` does not export, so it cannot be driven from a unit test without
// mocking readline end to end. The FIX is measured (all four inherited keys go
// from `!== undefined` true to false at that exact expression); the PIN is
// absent. Filed in BACKLOG.md with an owner and a gate rather than left as an
// unstated gap.

'use strict';
module.exports = {};
