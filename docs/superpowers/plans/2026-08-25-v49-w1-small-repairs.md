# v4.9 W1 — small-repairs batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the nine independent small repairs triaged at the v4.9 kickoff — every one
measured, none touching the task-mode surface.

**Architecture:** Nine disjoint-file repairs on one branch (`v49-w1-repairs`). Each task is
TDD where behavior changes, pin-only where a string changes, and carries its own sweep
obligations. BACKLOG past-tense ticks land in one final task so present-tense filings are
falsified only in the commit that fixes them.

**Tech Stack:** Node 22, Jest, no new dependencies.

**Spec:** `docs/superpowers/plans/2026-08-25-v49-phasing-and-rulings.md` §3 (dispositions) and
§2 rulings V16, V17, V18.

## Global Constraints

- Gate rule: 300 lines max per gated file (`scripts/check-file-sizes.js`); `run-stages.js` is
  294/300 and `cli-handlers-doctor.js` 296/300 — net growth in those files must be ≤ 0 unless
  measured otherwise.
- Never `git add -A` (untracked `site-src/` trips the secret scanner). Stage explicit paths.
- A literal `#` + digits in any `electron/**` file trips the hex-colour guard — write
  "issue NNN".
- After ANY change: sweep the three axes — the phrase you wrote, the symbol you moved, and
  bare `file.js:NNN` pointers into files you touched.
- `npm test` summary is invisible past `tail -5` (posttest hook) — use `tail -10`.
- Agents run focused suites only; the full suite runs once at wave end.

---

### Task 1: second-opinion Stage-4 gloss headings

**Files:** Modify `skills/second-opinion/SKILL.md:285`, `skills/second-opinion/COUNCIL-DESIGN.md:113`; tick `BACKLOG.md` (Task 9 does the tick).
- [ ] Change both headings' parenthetical from `(≥ 2 peer agreements, agrees dominate)` to
  `(≥ 2 peer agreements with agrees dominating — or a lone corroborating peer with zero disputes)`.
  The cascade prose at SKILL.md:270-272 and the COUNCIL-DESIGN.md:156 table row are ALREADY
  correct — do not touch them.
- [ ] Re-grep BOTH old phrasings (`agrees dominate` and `peer agreements`) repo-wide; the only
  surviving hits must be: BACKLOG.md's filing, CHANGELOG.md:346-348 (historical, leave),
  docs/superpowers/specs/2026-06-23-…:236 (frozen, leave), MODEL-NOTES.md incident narrations
  (leave). Then grep the NEW phrasing to confirm exactly the two edited lines carry it.
- [ ] Run `npx jest tests/docs-anchors.test.js tests/skills-doc-facts.test.js 2>/dev/null || true`
  plus any suite matching `skills` in tests/ — must stay green.

### Task 2: fmtProbeLine stops asserting endpoint acceptance

**Files:** Modify `src/sidecar/models.js:160` (`fmtProbeLine`),
`tests/sidecar/models-command.test.js:497`, `docs/usage.md:406`.
- [ ] models.js:160: `(accepted but not serving)` → `(no output within the probe window)`.
- [ ] Update the standalone `toContain` pin at models-command.test.js:497 to the new string
  (keep it standalone — it pins the parenthetical independently of the SILENT prefix at :496).
- [ ] docs/usage.md:406 quotes the runtime line verbatim in the SILENT table row — co-edit it
  to the new string, keeping the honest caveat beside it.
- [ ] Sweep: grep the OLD phrase repo-wide (survivors allowed: CHANGELOG/class-label uses at
  docs/configuration.md:111 and src/utils/no-output-backstop.js:4 — those name the CLASS, not
  the CLI line); grep the NEW phrase to confirm carriers = models.js + test + usage.md only.
- [ ] `npx jest tests/sidecar/models-command.test.js` green.

### Task 3: setup-ui far-side null-prototype seed

**Files:** Modify `electron/setup-ui.js:84` (`buildWizardScript`); Create
`tests/electron/setup-ui-proto.test.js`.
- [ ] Write the failing pin FIRST (measured RED at HEAD): require `electron/setup-ui.js`,
  call `buildSetupHTML()`, regex-extract the `var defaultAliases = …;` initializer, vm-eval
  it, assert `Object.getPrototypeOf(obj) === null` is **not required** — instead assert the
  observable: `obj['toString'] === undefined` and `obj['constructor'] === undefined` (the
  far-side seed makes inherited names unreachable). Name the test after the rule: *"a
  null-prototype table cannot cross a serialization boundary and stay null-prototype"*.
- [ ] Fix: `var defaultAliases = ${defaultAliasesJson};` →
  `var defaultAliases = Object.assign(Object.create(null), ${defaultAliasesJson});`
- [ ] Pin green; `npx jest tests/electron/` green.

### Task 4: MAX_CATALOG_AGE_MS single source

**Files:** Modify `src/utils/model-catalog.js` (export `DEFAULT_MAX_AGE_MS`),
`src/cli-handlers-doctor.js:21`, `src/utils/doctor-alias-check.js:41`.
- [ ] Add `DEFAULT_MAX_AGE_MS` to model-catalog.js's module.exports (:155 list).
- [ ] cli-handlers-doctor.js: replace the `const MAX_CATALOG_AGE_MS = 24 * 60 * 60 * 1000`
  literal with a require from model-catalog (the file already lazy-requires model-catalog at
  :43 — but a TOP-LEVEL require is fine: model-catalog's eager deps are fs/path only, no
  cycle; measured). Keep the exported name `MAX_CATALOG_AGE_MS` stable (it is exported at
  :296). Net lines ≤ 0 in this 296/300 file.
- [ ] doctor-alias-check.js:41: same replacement; delete the :37-40 "duplicated rather than
  imported" comment (its cycle claim is about cli-handlers-doctor, not model-catalog) and
  replace with one line naming the single source.
- [ ] `npx jest tests/ -t "doctor" --listTests | head` → run the doctor-related suites (at
  minimum any suite requiring cli-handlers-doctor or doctor-alias-check) green.

### Task 5: PR1F-3 — explicit 'unstructured' at the two repair-loop pushes (V18)

**Files:** Modify `src/council/run-stages.js:222`, `src/council/run-stage2.js:178`.
- [ ] At both pushes, add an explicit `conformance: 'unstructured'` argument to the
  `buildRunStatsEntry({...})` call (today they omit it and inherit `|| 'clean'` — a live
  falsehood-in-waiting since `res.ok`/`parsed.ok` are provably false there). Zero behavior
  change: the rows already read 'clean'?? NO — measure first: with the default they emit
  `conformance: 'clean'`; making it 'unstructured' IS a behavior change to those rows'
  bytes. **Write the pin first**: a test driving the repair path and asserting the repair
  row's conformance value; run it at HEAD to record the CURRENT value; then decide with the
  measurement — per the kickoff ruling V18 the repair-attempt row should say 'unstructured'
  (the attempt being pushed is by construction a failed parse). If an existing test pins
  'clean' on those rows, STOP and re-read the original PR1F-3 filing (BACKLOG.md:1480 area)
  before overriding it; the do-not-flip sites are run-finish.js:32 and
  run-stage1-rows.js:208 — do not touch those.
- [ ] Focused suites: `npx jest tests/council/run-stages.test.js tests/council/run-stage2*.test.js
  tests/council/run-retry*.test.js` green (fixture updates expected if any pin the old rows).
- [ ] Net lines: run-stages.js is 294/300 — adding one argument on an existing line keeps
  net 0; verify with `node scripts/check-file-sizes.js`.

### Task 6: KNOWN_VARIABLES single source

**Files:** Modify `src/template/render.js` (:17, :49, :78-84).
- [ ] Derive the :49 inline validation array from `KNOWN_VARIABLES` (filter out `var.<key>`),
  and replace the :78-84 hand-enumerated replacement chain with a lookup driven by the same
  set (the third copy the filing never counted). File is 90 lines — room is fine.
- [ ] `npx jest tests/ --listTests | grep -i template` → run those suites green; add one
  drift-shaped test if none pins that an entry added to KNOWN_VARIABLES validates AND
  renders.

### Task 7: MCP client helper timer leaks (three suites)

**Files:** Modify `tests/mcp-headless-e2e.integration.test.js`,
`tests/mcp-protocol.integration.test.js`, `tests/shared-server-e2e.integration.test.js`.
- [ ] In each file's `createMcpClient` helper: (a) `request()` — capture
  `const timer = setTimeout(...)` and `clearTimeout(timer)` on BOTH the resolve path (the
  stdout pending-delete at mcp-headless :53-55 and twins) and the timeout rejection; (b)
  `close()` — capture the 3 s SIGKILL fallback timer and clear it inside the child 'close'
  handler before resolve.
- [ ] mcp-headless-e2e only: in `afterAll`, if the run never reached 'complete', call
  `amicus_abort` for the taskId before `client.close()` (stops billing on failure paths); and
  reword the stale comment at :160 — the live rail has NO `--forceExit`.
- [ ] Verify with the keyless rail (NEVER bare jest — `~/.config/amicus/.env` holds a real
  key on this machine):
  `node scripts/run-integration-keyless.js mcp-protocol --detectOpenHandles` → expect ZERO
  open 'Timeout' handles (was six), suites green/skipped as before.

### Task 8: B2 — self-diagnosing hint on the bare-id model_not_found (V16)

**Files:** Modify `src/utils/gateway-router.js :: catalogGate` (:76-91); Test in
`tests/` beside the existing gateway-router suite (find it: `grep -rln catalogGate tests/`).
- [ ] TDD: failing test first — a bare id (`deepseek/deepseek-x`) invalid on `direct` whose
  `openrouter/<id>` twin classifies **valid** against the same catalogInfo produces a
  routeError whose `hint` names the doctor repair (assert it mentions `doctor --fix`);
  control: a bare id whose OR twin is ALSO invalid keeps the default hint.
- [ ] Implement in catalogGate's invalid branch, mirroring the `e.hint = localHint(...)`
  precedent at gateway-router.js:61-62: when `gateway === 'direct'` and
  `classifyModel('openrouter/' + id-ish twin…)` returns 'valid', set the hint from
  `remediation-hints.js :: repairFabricatedAlias` (require pattern: see how localHint is
  imported). Keep the routeError reason and shape unchanged — hint only.
- [ ] Focused suites green.

### Task 9: A4 — single catalog snapshot across the two setup IPC handlers (V17)

**Files:** Modify `electron/ipc-setup.js` (:38-78 save-key, :86-107 set-provider-default);
Test: new case in `tests/electron/` (house style: require the module, drive the handlers).
- [ ] TDD: failing test first — register the handlers with a stubbed catalog source whose
  SECOND fetch returns a different catalog than the first; drive save-key (builds the offer
  from catalog C1) then set-provider-default; assert the apply consumed **C1**, not C2
  (e.g. by stubbing `applyProviderDefault` or asserting on the catalog object identity that
  reaches it).
- [ ] Implement: cache, in the main process, the catalog array used to build
  `result.providerDefault` (keyed by provider, at the :63-64 build site) and have
  `set-provider-default` (:90) use that snapshot instead of re-fetching. ~10 lines, no
  renderer/preload change. `directFormIfProven` and tests/model-canonicalization.test.js's
  A4 pin (:121-151) stay byte-untouched — verify with `git diff` scope and by running that
  suite.
- [ ] Focused suites green: `npx jest tests/electron/ tests/model-canonicalization.test.js`.

### Task 10: BACKLOG past-tense ticks + wave gates

**Files:** Modify `BACKLOG.md` (the entries for Tasks 1, 2, 3; PR1F-3's entry; the
MAX_CATALOG_AGE_MS open item from the 4.8.1 cycle if filed; the mcp-headless flake decision).
- [ ] Tick each fixed entry in PAST tense in this same wave: the Stage-4 gloss entry
  (~:6347-6355 pre-W0 numbering — locate by phrase), the fmtProbeLine entry (~:6313-6323),
  the setup-ui defaultAliasesJson entries (BOTH: ~:5302-5319 and the pointer ~:6357-6362),
  PR1F-3 (~:1480 area — record ruling V18 and what shipped). Add one line recording the
  flake decision (live-LLM flake + real client-side timer leak, fixed here) wherever the
  4.8.1 cycle notes live, or as a new dated entry.
- [ ] Full gates: `npm test 2>&1 | tail -10` (all green), `npm run lint`,
  `node scripts/check-file-sizes.js --all`, `node scripts/check-citations.js --all`,
  `npm run generate-docs:check`.
- [ ] Three-axis sweep over the whole wave diff.
