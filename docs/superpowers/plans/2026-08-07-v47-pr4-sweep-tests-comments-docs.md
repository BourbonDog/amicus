# v4.7 PR4 — Sweep theme (a): tests + comments + docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disposition all ~30 theme-(a) nits (test-only, comment-only, doc) from spec §8 /
Appendix A — every item fixed or explicitly dispositioned at its BACKLOG line, per ruling R1/D17.

**Architecture:** Pure sweep — no features. 8 implementation tasks grouped by file cluster so each
carries its own suite run, then a docs/BACKLOG disposition task, then gates. The only src/-side
edits are: two module-export additions (T15-m5), one fire-and-forget promise exposure in
electron/ (T18-m1), comment additions (T13-m3, T11-c*, T22-m2), and *possibly* a notice-string
fix in `pack-resolve.js` (T11-c, decision procedure below). Everything else is test files and docs.

**Tech Stack:** Node 22 CommonJS, jest. Repo: `C:\Users\sendt\code\amicus-wt-v47-pr4`
(worktree, branch `chore/v4.7-pr4-sweep-tests-comments-docs`, base `d07fd94`).

**Grounding:** Recon workflow 2026-08-07 at `d07fd94` (14 agents; every item below re-verified
OPEN with current line numbers — Appendix-A line numbers were stale and are NOT used here).
Baseline: 501 suites / 6755 passed / 7 skipped / 0 fail.

## Global Constraints

- **src/ zero-edit rule:** the ONLY files outside `tests/` and `docs/` that may change are:
  `src/pack/pack-resolve.js` (T11-c, conditional), `src/cli-handlers-fanout.js` (T13-m3 comment
  only), `src/mcp-council-run.js` + `src/mcp-server.js` (T15-m5 export lines only),
  `electron/workspace-ui/workspace-app.js` (T18-m1), `src/template/render.js` +
  `src/template/store.js` (T22-m2 comment wording only), `package.json` (R463-5 lint scope),
  `README.md`, `BACKLOG.md`, `CHANGELOG.md`. Any other src/electron file: ZERO edits.
- **Tight-file gate (300 physical lines, `split('\n')` arithmetic — `Measure-Object -Line`
  undercounts):** `pack-resolve.js` is at **297**. A T11-c code fix adding >3 lines requires a
  relief extraction FIRST (same-task, move-only commit, byte-verified). `fanout.js` and
  `electron-install.js` sit at exactly 300 — they are NOT in this PR's paths; do not touch them.
- **No behavior changes** except (conditionally) the T11-c notice string — if taken, it gets a
  CHANGELOG line. Test edits must never weaken an existing assertion.
- **Mutation-proof every new/strengthened test:** temporarily break the code under test (or
  revert the pinned property), observe RED, restore, observe GREEN. Record the mutation in the
  task report. For comment-only edits this does not apply.
- **Comment/doc truthfulness:** every rewritten comment states only verified facts (the PR3
  Task-8 lesson: docs claimed features that never shipped). If you cannot verify a rationale,
  write what you verified, not what sounds plausible.
- **Ops:** `npx jest <path>` for single suites (NEVER `npm test -- <path>` — the posttest stamp
  corrupts pre-push state); no bare `npm install`; path-specific `git add`; worktree
  `node_modules` is a junction — never delete it recursively.
- **BACKLOG discipline (D17):** dispositions happen in Task 9, at each item's own line, as a
  `[x]` tick plus a ` — done v4.7 PR4` (or ` — superseded by …`) suffix. Never delete item text.

---

### Task 1: pack test-suite sweep (T13-m2, T13-m4, T14-m2, T14-m3, T14-m5, T11-b)

**Files:**
- Modify: `tests/pack/cli-fanout-start-pack.test.js` (T13-m2 :89-93/:113-122, T13-m4 new test)
- Modify: `tests/pack/cli-pack-cmd.test.js` (T14-m2 banner :149, T14-m3 :150-174, T14-m5 new test)
- Modify: `tests/pack/pack-resolve.test.js` (T11-b two new tests)

All test-only. No src edits.

- [ ] **Step 1 (T13-m2): make the kind-mismatch assertion discriminating.**
In `cli-fanout-start-pack.test.js`, rename the fixture (`:90`) `'wrong-kind-for-fanout'` →
`'wrong-kind'` (and the `--pack` ref at `:116`), then replace the weak assertion at `:121`:

```js
    expect(doc.error.code).toBe(ERROR_CODES.PACK_KIND_MISMATCH);
    expect(doc.error.message).toBe(
      "Error: pack 'wrong-kind' is kind 'council' — fanout accepts kind 'fanout'; make two packs if you want both shapes",
    );
```

(Exact message from `src/pack/pack-resolve.js:81` with `COMMAND_NAME_BY_KIND.fanout = 'fanout'`.
The old `toContain('fanout')` passed on the fixture NAME alone.)

- [ ] **Step 2: run it RED-proof.** `npx jest tests/pack/cli-fanout-start-pack.test.js` → green.
Mutation: in `pack-resolve.js:81` temporarily change `accepts kind` → `wants kind` → the test
must FAIL; restore → green.

- [ ] **Step 3 (T13-m4): pin the notice branch through handleFanout.** Notices always go to
stderr (`pack-cli.js:34`). Add to `cli-fanout-start-pack.test.js` (after the kind-mismatch
describe):

```js
describe('explicit --models over the pack bench (T13-m4)', () => {
  test('the override notice reaches stderr through handleFanout, and the typed value wins', async () => {
    store().writePack(FANOUT_PACK());
    const code = await handleFanout(parseArgs([
      'fanout', '--pack', 'fanout-review', '--models', 'vendorx/model-z',
      '--prompt-file', briefingFile, '--json',
    ]));
    expect(code).toBe(0);
    expect(err.mock.calls.map((c) => c[0]).join(''))
      .toContain("Notice: --models overrides the bench from pack 'fanout-review'");
    expect(runFanout.mock.calls[0][0].models).toBe('vendorx/model-z');
  });
});
```

- [ ] **Step 4: RED-proof.** Mutation: comment out the notice loop in `pack-cli.js:34` → FAIL;
restore → green.

- [ ] **Step 5 (T14-m2 + T14-m3): banner + fallback assertions in cli-pack-cmd.test.js.**
Move the `// ---- --json doc shapes ----` banner from `:149` to directly above the
`describe('handlePack: --json doc shapes')` at `:176`. Then extend the nameless-pack test
(`:151-173`): change the manually-written fixture to ALSO drop `kind` and `version`:

```js
    fs.writeFileSync(path.join(packsDir, 'nameless.json'), JSON.stringify({
      schemaVersion: 1, type: 'pack', model: 'alpha',
    }));
```

and extend the assertions (render source `src/cli-handlers-pack.js:147-149`):

```js
    expect(output).toContain('(unnamed)');
    expect(output).toContain('[(unknown)]');  // kind fallback
    expect(output).toContain('v0.0.0');       // version fallback
    expect(output).toContain('[solo]');       // the good pack still renders its real kind
```

Keep the existing `'Packs:'` / `'good-pack'` assertions. If `handlePack list` refuses to render
a pack missing `kind` (warning path instead), that is a REAL finding — report it, do not force
the assertion.

- [ ] **Step 6 (T14-m5): table-driven flags→pack mapping test.** Add to `cli-pack-cmd.test.js`
(after the roundtrip describe). Mapping under test: `src/cli-handlers-pack.js:43-48,54`.

```js
describe('handlePack: save maps every usage-block option flag (T14-m5)', () => {
  test('timeout/max-cost/gateway/agent/thinking/summary-length -> pack.options; --template -> briefing.template', async () => {
    const code = await handlePack(pa([
      'save', 'flag-map', '--kind', 'fanout', '--bench', 'alpha,beta',
      '--timeout', '25', '--max-cost', '3.5', '--gateway', 'direct', '--agent', 'code',
      '--thinking', 'high', '--summary-length', 'verbose', '--template', 'review',
    ]));
    expect(code).toBe(0);
    const { pack } = store().readPack('flag-map');
    expect(pack.options).toEqual({
      timeout: 25, maxCost: 3.5, gateway: 'direct', agent: 'code',
      thinking: 'high', summaryLength: 'verbose',
    });
    expect(pack.briefing).toEqual({ template: 'review' });
  });
});
```

Notes: `pa()` is the file's own parseArgs wrapper (`:57` region) — reuse it. The numeric
expectations assume `parseArgs` coerces `--timeout`/`--max-cost`; if strings come out, that is a
REAL finding (pack schema expects numbers) — report, don't paper over. If
`validatePack {mode:'save'}` rejects the unresolvable template ref `'review'`, split the
`--template` row into its own test that first writes a real template file under
`$AMICUS_CONFIG_DIR/templates/review.md` (idiom: `tests/template/cli-wiring.test.js:42`).

- [ ] **Step 7 (T11-b): hash round-trip + path-source branch in pack-resolve.test.js.**
`canonicalHash` is exported (`pack-store.js:130`). Add after the string-bench describe:

```js
describe('packRecord provenance (T11-b)', () => {
  test('packRecord.hash round-trips canonicalHash and readPack', () => {
    store().writePack(COUNCIL_PACK());
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: 'sec-review', expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    const rp = store().readPack('sec-review');
    expect(res.packRecord.hash).toBe(rp.hash);
    expect(res.packRecord.hash).toBe(store().canonicalHash(rp.pack));
  });

  test("a .json path packRef resolves with packRecord.source 'path'", () => {
    const w = store().writePack(COUNCIL_PACK());
    const args = parseArgs(['council', 'run']);
    const res = resolve()({ packRef: w.path, expectedKind: 'council', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(res.packRecord).toEqual({
      name: 'sec-review', version: '1.0.0', hash: expect.stringMatching(/^[0-9a-f]{12}$/), source: 'path',
    });
  });
});
```

- [ ] **Step 8: run the three suites.**
`npx jest tests/pack/cli-fanout-start-pack.test.js tests/pack/cli-pack-cmd.test.js tests/pack/pack-resolve.test.js`
→ all green. Mutation for T11-b: temporarily make `readPack` return a doctored hash → FAIL; restore.

- [ ] **Step 9: Commit.**
`git add tests/pack/cli-fanout-start-pack.test.js tests/pack/cli-pack-cmd.test.js tests/pack/pack-resolve.test.js`
`git commit -m "test(pack): sweep T13-m2/T13-m4/T14-m2/T14-m3/T14-m5/T11-b — discriminating assertions, notice-branch e2e, provenance round-trip"`

---

### Task 2: T11-c — string-bench fanout coverage + the both-typed notice pick

**Files:**
- Modify: `tests/pack/pack-resolve.test.js` (string-bench fanout unit test)
- Modify: `tests/pack/cli-fanout-start-pack.test.js` (handleFanout consumption e2e)
- Modify: `src/pack/pack-resolve.js` (**297/300 — TIGHT**; comment or ≤3-line fix only, else extract first)

**Verified facts you must work from:** `resolveBenchKnob` (`pack-resolve.js:47-59`) picks
`const flag = modelsExplicit ? '--models' : '--council'` — both-typed names only `--models`.
BUT `handleFanout` calls `applyPackOrExit` at `cli-handlers-fanout.js:44` BEFORE its
exactly-one-of guard at `:75-77`, so on fanout the notice prints and is then immediately followed
by the hard `BAD_ARGS` exit. The council surface's ordering is UNVERIFIED.

- [ ] **Step 1: verify the council surface.** Read `src/cli-handlers-council-run.js`: does it
reject `--models` + `--council` both typed, and does its pack apply run before or after that
guard? Record the answer in the task report.

- [ ] **Step 2 (unit): string bench on a FANOUT pack fills args.council.** In
`pack-resolve.test.js` add a fixture + test beside the existing string-bench describe:

```js
const FANOUT_PACK_STRING_BENCH = () => ({
  schemaVersion: 1, type: 'pack', name: 'fanout-preset', version: '1.0.0', kind: 'fanout',
  description: 'x', bench: 'budget', options: {}, briefing: {},
});
```

```js
  test('string bench on a FANOUT pack fills args.council when nothing is typed (T11-c)', () => {
    store().writePack(FANOUT_PACK_STRING_BENCH());
    const args = parseArgs(['fanout']);
    const res = resolve()({ packRef: 'fanout-preset', expectedKind: 'fanout', args, explicit: args.__explicit, useJson: false });
    expect(res.error).toBeUndefined();
    expect(args.council).toBe('budget');
    expect(args.models).toBeUndefined();
  });
```

If `validatePack {mode:'run'}` rejects a string bench on kind `fanout` (check
`pack-validate.js` first), then the WHOLE premise dies: record it, convert this test to pin the
validation error instead, and skip Step 3.

- [ ] **Step 3 (e2e): handleFanout consumes the pack-filled args.council.** In
`cli-fanout-start-pack.test.js`: the handler expands `args.council` via `resolveCouncilMembers`
against the model catalog (`cli-handlers-fanout.js:85-95`). Find the existing typed
`fanout --council` test harness (grep `resolveCouncilMembers` / `'--council'` under `tests/`)
and mirror its catalog/config seeding exactly. Seed a user council in this suite's
`config.json` (`councils: { mybench: ['alpha', 'beta'] }`), write a string-bench fanout pack
(`bench: 'mybench'`), call `handleFanout(parseArgs(['fanout', '--pack', …, '--prompt-file',
briefingFile, '--json']))`, and assert `runFanout.mock.calls[0][0].models` equals the expanded
members (`'vendorx/alpha-model,vendorx/beta-model'` or `'alpha,beta'` — whichever the existing
typed---council test proves is the real contract; copy its assertion shape).

- [ ] **Step 4 (the notice pick): decision procedure.**
  - If BOTH surfaces reject both-typed (Step 1 says council rejects too): the both-typed branch
    of the `:57` pick is dead-in-practice on council and doomed-but-printing on fanout. Fix =
    comment only, at `pack-resolve.js:57`:

```js
  // Both-typed names --models here, but both surfaces reject --models+--council
  // with BAD_ARGS immediately after pack apply (fanout: cli-handlers-fanout.js;
  // council run: <verified site>) — the pick only ever labels a single-flag notice.
```

    (≤3 lines: 297→300 exactly. If your comment needs a 4th line, shorten it — do NOT extract
    for a comment.) Additionally pin the fanout ordering fact with a test in
    `cli-fanout-start-pack.test.js`: both `--models` and a string-bench `--pack`+`--council`
    typed → `rejects.toThrow('exit 1')`, `doc.error.message` is the exact
    `'Error: pass exactly one of --models / --council, not both'` string, and `runFanout` never
    called.
  - If council does NOT reject both-typed: the notice actively misleads there. Change `:57` to
    name both: `const flag = [modelsExplicit && '--models', councilExplicit && '--council'].filter(Boolean).join('/');`
    — that is +0 lines net; update the two existing notice tests' expected strings only if the
    single-flag cases change (they must NOT — verify), add a both-typed council-surface test
    asserting the combined `--models/--council` notice, and add a CHANGELOG `[Unreleased]` line
    (notice wording change).

- [ ] **Step 5: suites + mutation.** `npx jest tests/pack/pack-resolve.test.js
tests/pack/cli-fanout-start-pack.test.js` green. Mutation for Step 2's test: flip `:53` to
`args.models = bench` → FAIL; restore. Confirm `pack-resolve.js` line count ≤300:
`node -e "console.log(require('fs').readFileSync('src/pack/pack-resolve.js','utf8').split('\n').length-1)"`.

- [ ] **Step 6: Commit.**
`git add tests/pack/pack-resolve.test.js tests/pack/cli-fanout-start-pack.test.js src/pack/pack-resolve.js`
(+ `CHANGELOG.md` if branch 2) — message
`"test(pack): T11-c — string-bench fanout coverage; document/fix the both-typed notice pick"`

---

### Task 3: preflight + guard-matrix cluster (T5-m1, T5-m5, T5-m2, stale --tag comments)

**Files:**
- Modify: `tests/bin/preflight-json-envelope.test.js` (T5-m1, T5-m5 fanout cells, stale comment :135-139)
- Modify: `tests/template/cli-wiring.test.js` (T5-m5 council cells)
- Modify: `tests/council/run-state.test.js` (T5-m2)
- Modify: `tests/pack/cli-fanout-start-pack.test.js` (stale comment :156-159 ONLY)

- [ ] **Step 1 (T5-m1):** in `preflight-json-envelope.test.js` `beforeEach` (`:24-27`):

```js
beforeEach(() => {
  startAmicus.mockClear();
  runFanout.mockClear();
  // T5-m1: bare jest.fn() resolves undefined, which captureStdout's .catch(e => e)
  // silently swallows on any success-path test — give both engines a real shape.
  startAmicus.mockResolvedValue({ exitCode: 0 });
  runFanout.mockResolvedValue({ exitCode: 0 });
});
```

Run the suite — every existing test must stay green (none reaches the engine).

- [ ] **Step 2 (T5-m5, fanout cells):** append to the `--template` describe in the same file:

```js
  it('fanout --json --artifact without --template → BAD_ARGS envelope', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi', models: 'a,b', artifact: __filename }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(doc.error.message).toMatch(/--artifact\/--var require --template/);
    expect(runFanout).not.toHaveBeenCalled();
  });

  it('fanout --json --var without --template → BAD_ARGS envelope', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi', models: 'a,b', var: ['a=1'] }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
    expect(runFanout).not.toHaveBeenCalled();
  });
```

(Guard under test: `cli-handlers-fanout.js:69-71`.) RED-proof: comment the guard out → both FAIL.

- [ ] **Step 3 (T5-m5, council cells):** in `cli-wiring.test.js` append beside the `:66`
--artifact test:

```js
test('--var without --template is BAD_ARGS (council)', async () => {
  const briefing = path.join(tmp, 'b.md');
  fs.writeFileSync(briefing, 'body');
  const code = await handleCouncilRun(parseArgs([
    'council', 'run', '--models', 'a,b', '--prompt-file', briefing, '--var', 'a=1', '--json', '--cwd', tmp,
  ]));
  expect(code).toBe(1);
  expect(runCouncil).not.toHaveBeenCalled();
  const doc = JSON.parse(out.mock.calls.map((c) => c[0]).join(''));
  expect(doc.error.code).toBe('BAD_ARGS');
});

test('council run --template with a {{prompt}} slot renders --prompt-file into the briefing', async () => {
  fs.writeFileSync(path.join(tmp, 'templates', 'wrap.md'), 'W:{{prompt}}');
  const briefing = path.join(tmp, 'b.md');
  fs.writeFileSync(briefing, 'body');
  const code = await handleCouncilRun(parseArgs([
    'council', 'run', '--models', 'a,b,c', '--prompt-file', briefing, '--template', 'wrap', '--json', '--cwd', tmp,
  ]));
  expect(code).toBe(0);
  const opts = runCouncil.mock.calls[0][0];
  expect(opts.briefing).toBe('W:body');
  expect(opts.template).toEqual({ name: 'wrap', hash: expect.any(String) });
});
```

- [ ] **Step 4 (T5-m2):** in `run-state.test.js` replace the absent-case test (`:121-124`):

```js
  test('o.template null (the production shape run.js passes) -> "template" key is absent from run.json, not null', () => {
    rs.initCouncilRun({ ...baseOpts(), template: null });
    expect('template' in rs.readRun(runDirOf())).toBe(false);
  });
```

- [ ] **Step 5 (stale comments):** both were made false by the consolidated-wave guard move
(`cli-handlers-run.js:58-68` now validates `--tag` BEFORE `resolveLaunchModel`; its own comment
at `:62` says so).
  - `preflight-json-envelope.test.js:135-139` — replace the parenthetical (last 3 comment lines) with:

```js
// never invoked. (Both handlers validate --tag before any model resolution —
// handleStart's rejection case lives in tests/pack/cli-fanout-start-pack.test.js.)
```

  - `cli-fanout-start-pack.test.js:156-159` — replace the final sentence
    (`handleStart's check sits past resolveLaunchModel, so it needs this suite's mocked passthrough.`) with:

```js
// stripping would make --search/--group-by tag miss it. (handleStart validates
// --tag BEFORE resolveLaunchModel since the v4.7 PR3 consolidated wave — this
// suite's passthrough mock serves the pack-wiring seam, not the tag guard.)
```

- [ ] **Step 6: suites.** `npx jest tests/bin/preflight-json-envelope.test.js
tests/template/cli-wiring.test.js tests/council/run-state.test.js tests/pack/cli-fanout-start-pack.test.js` → green.

- [ ] **Step 7: Commit.** `git add` those four files; message
`"test: sweep T5-m1/T5-m5/T5-m2 — engine-mock shapes, guard-matrix cells, production template shape; fix two stale --tag comments"`

---

### Task 4: workspace + e2e test sweep (T19-m3, T19-m4, T20-m3, T21-m1, T21-m2)

**Files:**
- Modify: `tests/workspace/blind-flip.test.js` (T19-m3 :208-225, T19-m4 :181-183)
- Modify: `tests/workspace/workspace-render.test.js` (T20-m3, after :425)
- Modify: `tests/electron-workspace-e2e.integration.test.js` (T21-m1 :441/:445, T21-m2 :473)

- [ ] **Step 1 (T19-m4):** replace `sectionTitles()` (`blind-flip.test.js:181-183`):

```js
    function sectionTitles() {
      return global.document.getElementById('reviews-body').querySelectorAll('h3').map((h) => h.textContent);
    }
```

(House pattern: `workspace-app-boundary.test.js:492-493`; the fake DOM's `querySelectorAll`
returns a plain array.)

- [ ] **Step 2 (T19-m3):** rework the terminal-refresh test (`:208-225`) to drive the REAL
live-tick seam (`electron/workspace-ui/workspace-verbs.js:95`, `startLiveLoop`'s terminal branch
calling `A.openRun`) instead of calling `openRun` directly. Read `tests/workspace/live-loop.test.js`
first and copy its tick-driving harness exactly (timer/mock idiom included). The reworked test
keeps the same assertions (`state.blind` flips false after the terminal tick) but must now go
RED if `workspace-verbs.js`'s tick stops calling `A.openRun` on terminal. Mutation-proof exactly
that way: comment out the tick's `openRun` call → FAIL; restore → green. Leave the boundary-test
twin (`workspace-app-boundary.test.js:363-379`) untouched — it pins the gate recompute, not the
seam; note this in the task report.

- [ ] **Step 3 (T20-m3):** add to `workspace-render.test.js` after the `[B, C, A]` test (`:425`):

```js
    test('RN-11 + removal in one render: [A, B, C] -> [C, A] reorders survivors and drops the leaver', () => {
      const tbody = document.createElement('tbody');
      const seatA = { id: 'a', model: 'model-a', role: 'seat', status: 'running', stalled: false, costDisplay: '$0.01' };
      const seatB = { id: 'b', model: 'model-b', role: 'seat', status: 'running', stalled: false, costDisplay: '$0.02' };
      const seatC = { id: 'c', model: 'model-c', role: 'seat', status: 'running', stalled: false, costDisplay: '$0.03' };
      AmicusRender.renderSeats(tbody, [seatA, seatB, seatC], false, () => null);
      expect(tbody.children.length).toBe(3);
      const rowARef = tbody.children[0];
      const rowCRef = tbody.children[2];
      AmicusRender.renderSeats(tbody, [seatC, seatA], false, () => null);
      expect(tbody.children.length).toBe(2);
      expect(tbody.children.map((r) => r.dataset.key)).toEqual(['c', 'a']);
      expect(tbody.children[0]).toBe(rowCRef); // moved, not rebuilt
      expect(tbody.children[1]).toBe(rowARef);
    });
```

(Code under test: the reorder pass at `workspace-render.js:220-225` running BEFORE the
leaver-removal pass at `:226-228` — this is the combination no test exercises.)

- [ ] **Step 4 (T21-m1):** fix the two wrong-direction comment claims in
`electron-workspace-e2e.integration.test.js` — at `:441` change `the F09 test just above already
documents` → `the F09 test below (same describe) already documents`, and at `:445` change
`the test above this one already calls .openRun` → `the F09/unreadable-run tests below also call
.openRun`. Verify the F09 test is at ~:488 and unreadable-run at ~:523 before wording.

- [ ] **Step 5 (T21-m2):** the 600ms wait at `:473` vs the file's nine 400ms sites. Try
`npx jest tests/electron-workspace-e2e.integration.test.js` — if it RUNS on this machine
(electron present), normalize 600 → 400 and run the suite twice to check stability. If the suite
self-skips or cannot run here, do NOT change the value; instead add the honest comment:

```js
      await new Promise((r) => setTimeout(r, 600)); // 600 vs the file's 400ms convention: inherited from the original fix wave, untightened — this suite doesn't run in the keyless gate to verify a shorter wait
```

Never invent a timing rationale.

- [ ] **Step 6: suites.** `npx jest tests/workspace/blind-flip.test.js tests/workspace/workspace-render.test.js`
green (+ the e2e suite if runnable). Commit:
`git add tests/workspace/blind-flip.test.js tests/workspace/workspace-render.test.js tests/electron-workspace-e2e.integration.test.js`
— `"test(workspace): sweep T19-m3/m4, T20-m3, T21-m1/m2 — real live-tick seam, house selector, combined reorder+removal pin"`

---

### Task 5: T18-m1 — expose the debate.json fetch promise

**Files:**
- Modify: `electron/workspace-ui/workspace-app.js` (:86-94 + state init)
- Modify: `tests/workspace/workspace-app-boundary.test.js` (:222-223, :245-246, :858-859)

**Interfaces — Produces:** `window.AmicusApp.state.debateFetch` — `null` when no fetch was
issued for the open run; otherwise the promise of the fire-and-forget `debate.json` fetch
(already-settled is fine). Tests may `await state.debateFetch` (awaiting `null` resolves
immediately). This is a test seam, not UI behavior: nothing renders from it.

- [ ] **Step 1:** in `workspace-app.js`, add `debateFetch: null` to the `state` object literal
(find `var state = {`), and rework `:86-94` (keep ES5 style — `function () {}`, `var`):

```js
      state.debateFetch = null;
      if (detail && detail.run && detail.run.debate) {
        state.debateFetch = invoke('workspace:read-artifact', runId, 'debate.json').then(function (res) {
          if (state.runId !== runId) { return; }
          try { state.debate = JSON.parse(res.text); } catch (err) { state.debate = null; }
        }).catch(function () {
          if (state.runId !== runId) { return; }
          state.debate = null;
        });
      }
```

(The reset line runs on EVERY openRun resolution so a run without debate never leaves a stale
promise behind. The F09 stale-response guard is untouched.)

- [ ] **Step 2:** in `workspace-app-boundary.test.js`, at each of the three paired-hop sites
(`:222-223`, `:245-246`, `:858-859`) replace the two `await Promise.resolve();` lines AND their
"let the fire-and-forget debate.json fetch land" comment with:

```js
    await global.window.AmicusApp.state.debateFetch; // the debate.json fetch, exposed (T18-m1)
```

Inspect each site first: if a hop pair is sequencing anything OTHER than the debate fetch
(read the surrounding assertions), keep that site's hops and say so in the report — do not
force the substitution.

- [ ] **Step 3: RED-proof the seam.** `npx jest tests/workspace/workspace-app-boundary.test.js`
green. Mutation: remove the `state.debateFetch =` assignment (keep the bare `invoke(...)`) →
the drill-in tests must FAIL (they now await `null` and read `state.debate` before the fetch
lands); restore → green. Also `npx jest tests/workspace/` (whole dir) + `npm run lint` (the file
is under electron/'s lint gate).

- [ ] **Step 4: Commit.**
`git add electron/workspace-ui/workspace-app.js tests/workspace/workspace-app-boundary.test.js`
— `"test(workspace): T18-m1 — expose the debate.json fetch promise; retire microtask-hop sequencing"`

---

### Task 6: T15-m5 — export the three MCP paramMaps; tests import production truth

**Files:**
- Modify: `src/mcp-council-run.js` (:279-284 exports)
- Modify: `src/mcp-server.js` (:1521-1523 exports)
- Modify: `tests/pack/mcp-pack-params.test.js` (:60-80 — delete the hand-copied maps)

**Known divergence this heals:** `TEST_COUNCIL_PARAM_MAP` (`:77`) omits `template`, which
production `COUNCIL_PACK_PARAM_MAP` carries (`mcp-council-run.js:43`).

- [ ] **Step 1:** `src/mcp-council-run.js` exports (`:279-284`) — add the map:

```js
module.exports = {
  handleCouncilRunTool,
  COUNCIL_PACK_PARAM_MAP,
  buildCouncilStatusPayload: awareness.buildCouncilStatusPayload,
  listCouncilRuns: awareness.listCouncilRuns,
  abortCouncilRun: awareness.abortCouncilRun,
};
```

- [ ] **Step 2:** `src/mcp-server.js` exports (`:1521-1523`) — add both maps:

```js
module.exports = {
  handlers, startMcpServer, getProjectDir, resolveProjectDir, getClientRoot,
  FANOUT_PACK_PARAM_MAP, SOLO_PACK_PARAM_MAP,
};
```

(`mcp-server.js` is grandfathered in the size gate; these are 1-line-net additions. Requiring it
from a test is already done by `tests/mcp-server*.test.js` — no side effects at require time.)

- [ ] **Step 3:** in `tests/pack/mcp-pack-params.test.js`, delete the three `TEST_*` map consts
(`:66-80`) and the now-false "Neither module exports its map" paragraph of the comment
(`:60-65`), replacing with:

```js
// Production maps imported directly (T15-m5): the previous hand-copied mirrors
// diverged once (the council copy silently dropped `template`) — importing the
// real tables makes that class of drift impossible.
const { COUNCIL_PACK_PARAM_MAP } = require('../../src/mcp-council-run');
const { FANOUT_PACK_PARAM_MAP, SOLO_PACK_PARAM_MAP } = require('../../src/mcp-server');
```

Then rename every `TEST_FANOUT_PARAM_MAP`/`TEST_SOLO_PARAM_MAP`/`TEST_COUNCIL_PARAM_MAP` use to
the imported names.

- [ ] **Step 4:** `npx jest tests/pack/mcp-pack-params.test.js`. If a test now fails because the
council map carries `template`, that test was pinning the DIVERGED copy — fix its expectation to
production truth and record which one. Then `npx jest tests/mcp-server.test.js
tests/pack/ tests/council/` for require-graph fallout, and `npm run lint`.

- [ ] **Step 5: mutation.** Temporarily remove `template: 'template'` from the production
council map → at least one test must FAIL (the divergence is now detectable); restore → green.

- [ ] **Step 6: Commit.**
`git add src/mcp-council-run.js src/mcp-server.js tests/pack/mcp-pack-params.test.js`
— `"test(mcp): T15-m5 — export the three pack paramMaps; tests consume production tables"`

---

### Task 7: fixture-comment truthfulness sweep (R463-1, R463-2, rider-107 trio, audit wording, T2-m1)

**Files (all test-only):**
- Modify: `tests/sidecar/models-command.test.js` (~:419 fixture comment)
- Modify: `tests/model-fetcher-anthropic.test.js` (:53 pin comment, delete :75 test)
- Modify: `tests/provider-default-picker.test.js` (:132-133), `tests/gateway-router.test.js`
  (:103-105), `tests/gateway-route-catalog.test.js` (:43)
- Modify: `tests/utils/gateway-route-audit.test.js` (:93-96)
- Modify: `tests/council/findings.test.js` (:515)

**Verified ground:** fable's direct route was authored 2026-08-05 (`curated-models.js:96-100`
authors BOTH routes), so every "fable is OpenRouter-only / has no direct twin" comment is
historical, and the real catalog can no longer produce `divergent-missing` for fable.

- [ ] **Step 1 (R463-1):** above the `{ alias: 'fable', kind: 'divergent-missing', … }` fixture
row in `models-command.test.js` (~:420) add:

```js
        // HISTORICAL fixture: fable's direct route was authored 2026-08-05, so the
        // live catalog can no longer produce divergent-missing for it. Kept as a
        // pure rendering-path fixture — the renderer must handle the kind regardless.
```

- [ ] **Step 2 (R463-2):** in `model-fetcher-anthropic.test.js`, DELETE the `:75` containment
test (`'fable IS on the floor'` / `toContain('anthropic/claude-fable-5')`) — it is strictly
implied by the `:53` exact-list pin — and append to the pin's comment:

```js
// (Subsumes the old fable floor-containment check, deleted in the v4.7 PR4 sweep:
// an exact toEqual IS containment. The 2026-08-05 route-inversion history lives in git.)
```

- [ ] **Step 3 (trio):** reword each "mirrors the real fable" claim to a synthetic-fixture claim.
Read each comment in place and apply the same shape; e.g. `provider-default-picker.test.js:132-133`:

```js
      // Fixture models an OpenRouter-only entry with NO direct twin at all. (fable
      // WAS the live example until 2026-08-05, when its direct route was authored —
      // the shape stays worth pinning even with no current curated example.)
```

Adjust the other two files' wording to their local context (`gateway-router.test.js:103-105`
test name may keep `(fable)` only if the comment marks it historical; `gateway-route-catalog.test.js:43`
same treatment).

- [ ] **Step 4 (audit wording):** `gateway-route-audit.test.js:93-96` — the fixture passes an
EXPLICIT `gatewayOnly: false` annotation while the comment says "non-annotated alias". Reword
the final clause to:

```js
    // an explicit gatewayOnly:false — the same provenance value a non-annotated
    // entry defaults to — must NOT suppress the finding
```

- [ ] **Step 5 (T2-m1):** restore a rationale comment above `findings.test.js:515`'s bare
expect (`countAttemptedFindings stays null (unverifiable) and NEVER 0`):

```js
    // null = "could not verify" (no parsable findings block); 0 would assert a
    // VERIFIED count of zero. Never-fabricate: absence of evidence stays null —
    // downstream renderers show "—" for null but a hard 0 for zero.
```

Verify the downstream-renderer claim before keeping the last sentence (grep how
`countAttemptedFindings` renders); if it renders differently, state what you verified instead.

- [ ] **Step 6:** run all six suites by path, green. (Comment-only edits + one test deletion —
the deletion needs no mutation proof, but re-run `tests/model-fetcher-anthropic.test.js` and
confirm the exact-list pin still passes.) Commit:
`"test: sweep R463-1/R463-2 + #107 fixture-comment truthfulness trio + audit wording + T2-m1 rationale"`

---

### Task 8: council-save render, doctor dedup, lint scope, skill-docs pin (R463-3, R463-4, R463-5, R463-6)

**Files:**
- Modify: `tests/council/cli-handlers-council.test.js` (R463-3, after :644)
- Modify: `tests/doctor-tmp-sweep.test.js` (:36-42), `tests/doctor-metadata-tmp-sweep.test.js`
  (:31-…), `tests/doctor-legacy-mcp.test.js` (:31-…) (R463-4)
- Modify: `package.json` (:58 lint script + :104-111 lint-staged) (R463-5)
- Modify: `tests/skill-second-opinion-docs.test.js` (:22) (R463-6)

- [ ] **Step 1 (R463-3):** add to the save describe in `cli-handlers-council.test.js` after the
`:640-644` human-mode shadow test (render source verified at `src/council/presets-cli.js:58-64`):

```js
  test('human-mode re-save of a shadowing name prints BOTH the overwritten marker and the shadow notice', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'budget'], models: 'deepseek,glm' }));
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'budget'], models: 'haiku,opus' }));
    expect(code).toBe(0);
    expect(out).toContain("Saved council 'budget' (overwritten): haiku, opus");
    expect(out).toMatch(/shadows the built-in bench of the same name/);
  });
```

(Check the suite's alias fixtures cover `haiku`/`opus`/`deepseek`/`glm` the way the sibling
tests at `:604-631` use them — reuse exactly the model strings those tests use.)

- [ ] **Step 2 (R463-4):** in each of the three doctor suites, replace the byte-identical
second-layer block

```js
const baseDeps = makeBaseDeps();
const base = {
  ...baseDeps,
  readApiKeyValues: () => ({}), // offline credit probe
  getElectronPath: () => '/fake/electron', // electron check: ok — repair unreachable
  repairElectron: async () => ({ repaired: true }), // never the real binary self-heal
  repairEngine: async () => ({ repaired: true }), // never the real npx-cache copy-heal
};
```

with a single factory call (the helper spreads overrides last — `doctor-base-deps.js:106`):

```js
const base = makeBaseDeps({
  readApiKeyValues: () => ({}), // offline credit probe
  getElectronPath: () => '/fake/electron', // electron check: ok — repair unreachable
  repairElectron: async () => ({ repaired: true }), // never the real binary self-heal
  repairEngine: async () => ({ repaired: true }), // never the real npx-cache copy-heal
});
```

KEEP each file's institutional rationale comment block above it (e.g. `doctor-tmp-sweep.test.js:28-35`)
byte-unedited. First grep each file for other uses of `baseDeps` — delete the
`const baseDeps = makeBaseDeps();` line only where it becomes unused.

- [ ] **Step 3 (R463-5):** `package.json` — line 58 → `"lint": "eslint src/ electron/ tests/helpers/"`,
and add to `lint-staged`:

```json
    "tests/helpers/**/*.js": [
      "eslint --fix"
    ]
```

Run `npm run lint`. `doctor-base-deps.js` calls `jest.fn()` — if eslint flags `jest` as
undefined, extend the eslint config's existing tests override (find how `tests/**` gets its jest
env — there may be none today since tests were never linted) with a minimal
`overrides` entry scoped to `tests/helpers/**` (`env: { jest: true, node: true }`). Smallest
possible config change; report exactly what was added.

- [ ] **Step 4 (R463-6):** `tests/skill-second-opinion-docs.test.js:22` —
`expect(desc).toMatch(/multi-model/i)` → `expect(desc).toMatch(/multi-model review/)`. Run the
suite; the current SKILL.md description carries the phrase (recon-verified). The BACKLOG
annotation for the already-resolved null-guard half happens in Task 9, not here.

- [ ] **Step 5:** run the five suites + `npm run lint`, all green. Mutation for R463-3: flip
`presets-cli.js:59` to `''` → FAIL; restore. Commit (include package.json + any eslint config):
`"test: sweep R463-3/4/5/6 — combined save render pin, doctor base dedup via makeBaseDeps overrides, lint tests/helpers, tighten skill-docs pin"`

---

### Task 9: docs, src comments, CHANGELOG, BACKLOG dispositions (T22-m1, T22-m2, R6, T13-m3 + D17 ticks)

**Files:**
- Modify: `docs/usage.md` (:362 excerpt; :260 wording), `src/template/render.js` (:10-11),
  `src/template/store.js` (:21), `README.md` (:489), `src/cli-handlers-fanout.js` (:30-34
  comment), `CHANGELOG.md`, `BACKLOG.md`

- [ ] **Step 1 (T22-m1):** `docs/usage.md:362` — the worked `run.json` pack excerpt shows 3 keys
while the prose at `:314` documents 4. Add the missing line so the excerpt reads:

```json
  "pack": { "name": "review-bench", "version": "1.0.0", "hash": "da084ba56162", "source": "dir" }
```

(match the surrounding excerpt's exact indentation/format; the worked example's pack is v1.0.0
per `:342`).

- [ ] **Step 2 (T22-m2):** one canonical feature name — **"composable waves (`--input-from`)"** —
and the correct rev number (composition was renumbered v4.7, and is NOT in this rev — it is the
next one; write "a future rev's composable waves" to dodge the number rotting again):
  - `render.js:10-11`: `… {{input}} is deliberately ABSENT — it ships with composable waves
    (--input-from), a future rev.`
  - `store.js:21`: same vocabulary (`composable waves (--input-from)`), no version number.
  - `docs/usage.md:260`: `arrive with composable waves (--input-from) in a future release.`
  Adjust each to fit its sentence; the invariant: same feature name in all three, zero version
  numbers.

- [ ] **Step 3 (R6):** `README.md:489` — `It exposes sixteen tools:` → `It exposes these tools:`
(owner ruling R6: count-neutral, no number; the tool table follows at `:491`).

- [ ] **Step 4 (T13-m3):** `src/cli-handlers-fanout.js` — extend the retry-dispatch comment
(`:30-34`) with one line recording the deliberate `--pack` ignore (site: the dispatch returns at
`:35-43` before `applyPackOrExit` at `:44`):

```js
  // --pack is likewise ignored on this path (deliberate, same precedent: retry
  // replays the wave's recorded per-leg config; flags that reshape a wave don't apply).
```

Match the existing comment block's wrapping style.

- [ ] **Step 5 (CHANGELOG):** add under `[Unreleased]` → `### Changed` (or `### Internal` if the
file uses one — follow the existing section vocabulary):

```
- Test/comment/docs sweep (v4.7 PR4, theme a): ~30 census nits dispositioned — no behavior
  changes. (Plus, if Task 2 took the code branch: the both-flags override notice now names
  both `--models` and `--council` when both were typed.)
```

Drop the parenthetical if Task 2 took the comment branch.

- [ ] **Step 6 (BACKLOG dispositions — D17):** tick each item at its own line (current line
numbers from recon; re-locate by ID token, numbers shift as you edit — work bottom-up to keep
them stable). For every item this PR fixed: `- [x] …existing text… — done v4.7 PR4`. Special
cases:
  - `:870` errorWave pack-inherit carry: `- [x] … — superseded: shipped in #123 (fix/v47-pr3-riders)`.
  - `:1176` (R463-6 rider): tick, and append `— pin tightened v4.7 PR4; the null-guard half was
    already resolved by 7cf3f18 (mustMatch), filed sight-unseen. Canonical entry: Phase 11 (:204).`
  - `:204` (Phase-11 twin): tick the same way, cross-referencing `:1176`.
  - Items dispositioned WITHOUT a code change this PR (only if any emerge): mark
    `— dispositioned v4.7 PR4: <reason>`.
  Do NOT tick theme-(b)/(c) items, the four v4.7-PR1-findings items (:1183-1241), or
  watch-notes — they belong to PR5/PR6 (D18 standing-notes conversion INCLUDED — out of scope
  here; the "Standing notes" section does not exist yet and is NOT created in this PR).
- [ ] **Step 7 (docs gates):** run `node scripts/generate-docs.js --check` (regen if it reports
drift and commit the regen), then `npx jest` on the docs suites (glob: `npx jest tests/docs
tests/skill-` plus whatever `git grep -l "usage.md" tests/` names — run the docs-quick-sync
suite by its real filename).
- [ ] **Step 8: Commit.**
`git add docs/usage.md src/template/render.js src/template/store.js README.md src/cli-handlers-fanout.js CHANGELOG.md BACKLOG.md`
— `"docs: sweep T22-m1/T22-m2/R6/T13-m3; BACKLOG dispositions for the theme-(a) census (D17)"`

---

### Task 10: gates, final review, PR (controller-run, no implementer)

- [ ] Full suite in the worktree: `npm test` (expect ≥501 suites green; new-test delta recorded).
- [ ] `npm run lint` + `npm run check:sizes` — verify `pack-resolve.js` ≤300.
- [ ] `git fetch origin` — if origin/main moved, merge and re-run the suite on the merged tree.
- [ ] **Plan committed?** — `git status` must show NO untracked plan file (the PR2/PR3 repeat
  lesson; this file must be in a commit before push).
- [ ] Final whole-branch fable review via review-package over `d07fd94..HEAD`, minors triaged
  from the ledger, consolidated fix wave if findings.
- [ ] Push (`GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth
  git-credential' push -u origin chore/v4.7-pr4-sweep-tests-comments-docs`, ≥5-min timeout —
  the pre-push hook reruns the full suite).
- [ ] Open the PR (`gh -R BourbonDog/amicus`): body lists the census items dispositioned, the
  T11-c/T21-m2 decision outcomes, and riders. Watch all 11 CI checks.

## Deferred / Non-goals (explicit)

- **D18 watch-notes → standing notes** (7 items + section creation): rides with PR5/PR6, not here.
- Theme (b) small-code items and theme (c) GUI/M-sized items: PR5/PR6.
- The four v4.7 PR1-findings BACKLOG items (:1183-1241): PR5 candidates.
- `--all` index residue pruning, council rows in CLI list, continue/resume tag inheritance:
  existing chips, untouched.
