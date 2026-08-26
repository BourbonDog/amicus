'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getRunDetail, TERMINAL_STATUSES } = require('../../src/workspace/run-detail');

const FX = path.join(__dirname, '..', 'fixtures');

// TST-10a (same litter, sibling file): every scratch project made here is swept in afterAll
// rather than accumulating under os.tmpdir() across runs — artifact-guard.test.js's pattern.
const SCRATCH_DIRS = [];

afterAll(() => {
  for (const dir of SCRATCH_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-detail-'));
  SCRATCH_DIRS.push(project);
  fs.mkdirSync(path.join(project, '.claude', 'amicus_sessions'), { recursive: true });
  return project;
}

function registerPointer(project, runId, runDir) {
  fs.writeFileSync(
    path.join(project, '.claude', 'amicus_sessions', `council-${runId}.json`),
    JSON.stringify({ runId, runDir })
  );
}

/** A run dir nested under project (mirrors production: a real runDir is always
 *  inside project — src/mcp-council-run.js:109 rejects an outDir outside the
 *  project at creation time — and satisfies getRunDetail's outer containment fence,
 *  see the describe block at the end of this file). Tests build content into it
 *  however they need, then call registerPointer to point a runId at it. */
function runDirIn(project, runId) {
  const dir = path.join(project, 'runs', `council-${runId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Seed a temp project whose sessions dir points at COPIES of the given fixture dirs,
 *  nested under the project (see runDirIn). `entries` maps runId -> a fixture SOURCE
 *  dir to copy in whole. */
function seedProject(entries) {
  const project = makeProject();
  for (const [runId, source] of Object.entries(entries)) {
    const runDir = runDirIn(project, runId);
    fs.cpSync(source, runDir, { recursive: true });
    registerPointer(project, runId, runDir);
  }
  return project;
}

describe('getRunDetail', () => {
  test('complete fixture: docs parsed, derived models populated', () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.run.schemaVersion).toBe(2);
    expect(d.derived.schemaSupported).toBe(true);
    expect(d.derived.names).toEqual([
      { label: 'Review A', model: 'gemini' },
      { label: 'Review B', model: 'gpt' },
      { label: 'Review C', model: 'qwen' },
    ]);
    // ⚠️ DE-ROT (F27): was ['stage1','stage2','tally','chair','verdict']. The engine runs the chair
    // BEFORE the final tally — `run.js :: runChair` is awaited before `run.js :: finishRun`, whose
    // run-finish.js:56-58 does writeTallyFiles + updateStage; the chair's own stage entry is made by
    // `run-chair.js :: runChair`'s `updateStage(o.runDir, 'chair', …)` — and stages[] is
    // append-ordered, because `run-state.js :: updateStage` pushes an unseen name onto the TAIL
    // and only patches in place when the name is already there. Pinned by the shipped
    // tests/council/run-debate.test.js test named
    // "WITHOUT --debate run.json carries no `debate` key at all (durable contract)", whose
    // assertion is this exact array.
    // ⚠️ CITATION REPAIR 2026-08-21 (v4.8 Phase 5 T5.4 fix round 1) — four of the five anchors in
    // this block were re-opened and were WRONG: run.js:246 is the Stage-2 conformance merge (the
    // runChair call is :271), run-chair.js:92 was classifyChairAttempt (the v4.9 W4 split moved
    // its body to chair-fallback.js, still run-chair.js :: classifyChairAttempt via re-export;
    // the 'chair' stamps sit at run-chair.js:109/:112/:152 inside runChair),
    // run-state.js:95-102 is initCouncilRun's seed (the append is inside
    // updateStage), and run-debate.test.js:616 was a runStats-row assertion. That last one was
    // ALREADY stale at v4.8 Phase 5's BASE 9ef275e5 — verified by opening it there, so the +337
    // lines that phase added to that file did not cause it. Only
    // run-finish.js:56-58 was still correct. Re-anchored by SYMBOL and by test NAME so the next
    // growth cannot rot them. The mechanism this block describes was, and remains, correct.
    // REQUIRED COMPANION EDIT (Task 1): swap the `chair` entry ahead of `tally` in BOTH run.json
    // fixtures (complete + degraded) and shift the timestamps so chair completes before tally starts.
    expect(d.derived.stageRail.map((s) => s.name)).toEqual(['stage1', 'stage2', 'chair', 'tally', 'verdict']);
    // ⚠️ PRE-FLIGHT (P1): was 'Stage 1 · reviews' — see the STAGE_LABELS note in Step 4.
    expect(d.derived.stageRail[0].label).toBe('Stage 1 — independent review');
    expect(d.derived.matrix.rows).toHaveLength(4);
    // F07 pin: the 3-arg buildMatrixModel wiring must actually be live — tally.json's C1 is
    // 'Contested' (pre-override), verdict.json's C1 is 'Confirmed' (post-override). A regression
    // that dropped the third argument (or passed null) would leave this row 'Contested' instead,
    // and rows.toHaveLength(4) alone would not catch it.
    expect(d.derived.matrix.rows.find((r) => r.id === 'C1').tier).toBe('Confirmed');
    expect(d.derived.cost.rows).toHaveLength(4);
    expect(d.derived.cost.totalDisplay).toBe('$0.4321');
    expect(d.derived.cost.maxCost).toBe(2);
    expect(d.derived.cost.costAmount).toBeCloseTo(0.4321);
    expect(d.derived.verdictPanel.overallVerdict).toBe('Fix these first');
    expect(d.derived.verdictPanel.decisions).toEqual([{ id: 'A1', decision: 'accept', applied: true }]);
    expect(d.artifacts['chair-output.md']).toMatchObject({ present: true });
    expect(d.artifacts['report.html'].present).toBe(true);
  });

  test('degraded fixture: null overallVerdict + run.json error reason + absent chair artifact', () => {
    const project = seedProject({ bbbb2222: path.join(FX, 'council-run-degraded') });
    const d = getRunDetail(project, 'bbbb2222');
    expect(d.derived.verdictPanel.overallVerdict).toBeNull();
    // ⚠️ PRE-FLIGHT (P3): was the raw fixture string. `run.error` is null on every partial run
    // (verified: run.js:294 is the only exit-2 finalize and passes no error), so the reason is
    // derived from the chair stage's `status:'error'`. See degradedReason() in Step 4.
    expect(d.derived.verdictPanel.reason).toBe('Chair synthesis stage failed');
    expect(d.artifacts['chair-output.md'].present).toBe(false);
    expect(d.run.status).toBe('partial');
  });

  test('malformed tally.json yields {parseError, rawPath} and a null matrix; run still renders', () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    for (const f of ['run.json', 'verdict.json']) {
      fs.copyFileSync(path.join(FX, 'council-run-complete', f), path.join(runDir, f));
    }
    fs.writeFileSync(path.join(runDir, 'tally.json'), '{broken');
    registerPointer(project, 'aaaa1111', runDir);
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.tally.parseError).toBeTruthy();
    expect(d.tally.rawPath).toBe(path.join(runDir, 'tally.json'));
    expect(d.derived.matrix).toBeNull();
    expect(d.derived.verdictPanel.overallVerdict).toBe('Fix these first');
  });

  test('schemaVersion mismatch flips schemaSupported; absent verdict yields present:false panel', () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'run.json'), 'utf-8'));
    run.schemaVersion = 3;
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    registerPointer(project, 'aaaa1111', runDir);
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.derived.schemaSupported).toBe(false);
    expect(d.verdict).toBeNull();
    expect(d.derived.verdictPanel.present).toBe(false);
  });

  test('missing pointer / missing run.json produce top-level {error}', () => {
    const project = seedProject({});
    expect(getRunDetail(project, '99999999').error).toBeTruthy();
    const project2 = makeProject();
    const emptyDir = runDirIn(project2, 'aaaa1111');
    registerPointer(project2, 'aaaa1111', emptyDir);
    expect(getRunDetail(project2, 'aaaa1111').error).toBe('run.json missing');
  });

  test('malformed run.json itself yields derived:null (top-level parseError, not an {error} shape)', () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    fs.writeFileSync(path.join(runDir, 'run.json'), '{broken');
    registerPointer(project, 'aaaa1111', runDir);
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.run.parseError).toBeTruthy();
    expect(d.derived).toBeNull();
    expect(d.artifacts['report.html'].present).toBe(false);
  });

  /**
   * v4.9 W8 T-B — the verdict panel carries the run's INTENT.
   *
   * The electron renderer (`electron/workspace-ui/workspace-matrix.js ::
   * renderVerdict`) is a plain browser script and cannot `require()` src/, so the
   * only way it can label a task run's chip `ANSWER:` is for the panel payload to
   * carry the fork key. `verdict.json` itself is emit-when-'task' (the W5 ruling),
   * but this payload is an in-memory IPC model with no byte-identity contract and
   * a CLOSED literal whose other keys are always present with null defaults — so
   * `intent` is materialized both ways and defaults to 'review', matching the
   * literal's own style. The renderer still treats an ABSENT key as review, since
   * older payloads (and every hand-built fixture in the workspace suites) have none.
   *
   * Named mutant PANELINTENTSTUCK: collapse the ternary to a bare
   * `intent: 'review'`. RED SET: "a task run's verdict panel carries intent:'task'".
   * The two review pins are the absence controls and stay green by construction.
   */
  test("a task run's verdict panel carries intent:'task'", () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    const verdict = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'verdict.json'), 'utf-8'));
    verdict.intent = 'task';
    verdict.overallVerdict = 'Converged';
    fs.writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify(verdict));
    registerPointer(project, 'aaaa1111', runDir);
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.derived.verdictPanel.intent).toBe('task');
    expect(d.derived.verdictPanel.overallVerdict).toBe('Converged');
  });

  test("a review run's verdict panel carries intent:'review' — the fixture has no intent key at all", () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    const raw = JSON.parse(fs.readFileSync(path.join(project, 'runs', 'council-aaaa1111', 'verdict.json'), 'utf-8'));
    expect('intent' in raw).toBe(false);          // absence pin on the artifact itself
    expect(getRunDetail(project, 'aaaa1111').derived.verdictPanel.intent).toBe('review');
  });

  test("an absent verdict yields a present:false panel that still defaults intent to 'review'", () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    fs.copyFileSync(path.join(FX, 'council-run-complete', 'run.json'), path.join(runDir, 'run.json'));
    registerPointer(project, 'aaaa1111', runDir);
    const vp = getRunDetail(project, 'aaaa1111').derived.verdictPanel;
    expect(vp.present).toBe(false);
    expect(vp.intent).toBe('review');
  });

  /**
   * v4.9 fix round 2 (council B2) — `run.json` is the SECOND carrier of intent.
   *
   * The panel read `verdict.intent` alone, so on the narrow leg where a task run
   * exits before the verdict write — or writes a corrupt one — the panel
   * defaulted to review and the Workspace chip read "no chair verdict" on a run
   * that was never on that scale. `run.json` checkpoints `intent: 'task'` at
   * start (`run.js :: runCouncil`) and `run` is already this function's first
   * parameter, so the honest source is `verdict.intent || run.intent`.
   *
   * Named mutant PANELINTENTVERDICTONLY: drop the `run.intent` half of both
   * sources. RED SET: the two pins below. Every pin above is an absence control
   * on a review fixture and stays green.
   */
  test("a task run with NO verdict.json labels its present:false panel intent:'task'", () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'run.json'), 'utf-8'));
    run.intent = 'task';
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    registerPointer(project, 'aaaa1111', runDir);
    const vp = getRunDetail(project, 'aaaa1111').derived.verdictPanel;
    expect(vp.present).toBe(false);
    expect(vp.intent).toBe('task');
  });

  test("a task run with a CORRUPT verdict.json still labels the panel intent:'task'", () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'run.json'), 'utf-8'));
    run.intent = 'task';
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    fs.writeFileSync(path.join(runDir, 'verdict.json'), '{ truncated mid-write');
    registerPointer(project, 'aaaa1111', runDir);
    const vp = getRunDetail(project, 'aaaa1111').derived.verdictPanel;
    expect(vp.present).toBe(false);
    expect(vp.intent).toBe('task');
  });

  test('degradedReason exit-1 path: run.error.code/message drives the reason string', () => {
    // The other half of F04: `run.error` is only ever non-null on the exit-1 path, where the
    // engine writes a structured {code, message}. No fixture carries this shape, so it is
    // exercised here directly through getRunDetail (degradedReason itself is not exported —
    // widening the public surface just to test it isn't worth another pin).
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-degraded', 'run.json'), 'utf-8'));
    run.error = { code: 'COST_EXCEEDED', message: 'ceiling hit' };
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    registerPointer(project, 'aaaa1111', runDir);
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.derived.verdictPanel.reason).toBe('COST_EXCEEDED: ceiling hit');
  });

  /**
   * TST-8 — degradedReason()'s THIRD branch (a `skipped` stage) had no coverage. It was
   * deferred as YAGNI and is no longer: the v4.4 cost work added two fresh ways to skip a
   * stage that did not exist when it was deferred — `overBudget()` (src/council/run-chair.js:97-110
   * stamps the chair stage `skipped`; src/council/run.js:229 does the same for
   * debate-revote) and the pre-flight BUDGET_EXCEEDED refusal that stamps `budgetRefusals[]`.
   * A run that reaches the verdict panel with a cost-ceiling skip is now a normal outcome, and
   * this branch is the only thing that explains it to the user.
   *
   * The stage list order also encodes the precedence: `error` is looked for BEFORE `skipped`,
   * and `run.error.code` before either. Both orderings are pinned below, because "the chair
   * errored" and "the chair was skipped to stay under the ceiling" are different stories and
   * showing the wrong one is exactly the class of lie the panel exists to remove.
   */
  const withStages = (stages, extra) => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-degraded', 'run.json'), 'utf-8'));
    run.stages = stages;
    Object.assign(run, extra || {});
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    registerPointer(project, 'aaaa1111', runDir);
    return getRunDetail(project, 'aaaa1111');
  };

  test('degradedReason skipped path: a cost-ceiling-skipped chair names the stage and the cause', () => {
    // run-chair.js:97-110 — `if (overBudget()) { updateStage(…, {status:'skipped'}) }`, with no
    // startedAt and no run.error anywhere. Before this branch the panel had nothing to say.
    const d = withStages([
      { name: 'stage1', status: 'complete' },
      { name: 'stage2', status: 'complete' },
      { name: 'chair', status: 'skipped', completedAt: '2026-07-17T15:05:32.000Z' },
      { name: 'tally', status: 'complete' },
    ]);
    expect(d.derived.verdictPanel.reason).toBe('Chair synthesis stage was skipped (cost ceiling)');
  });

  test('degradedReason skipped path: the label comes from STAGE_LABELS, not the raw stage name', () => {
    // run.js:229 skips `debate-revote` the same way. A raw name would read
    // "debate-revote stage was skipped", which is wire vocabulary, not user copy.
    const d = withStages([
      { name: 'stage1', status: 'complete' },
      { name: 'debate-revote', status: 'skipped', completedAt: '2026-07-17T15:05:32.000Z' },
    ]);
    expect(d.derived.verdictPanel.reason).toBe('Debate — re-vote stage was skipped (cost ceiling)');
  });

  test('degradedReason skipped path: an unknown stage name passes through raw (graceful-when-present)', () => {
    const d = withStages([{ name: 'some-future-stage', status: 'skipped' }]);
    expect(d.derived.verdictPanel.reason).toBe('some-future-stage stage was skipped (cost ceiling)');
  });

  test('degradedReason precedence: an errored stage outranks a skipped one', () => {
    // Both are present on a ceiling-truncated run (the chair errors, the re-vote is then
    // skipped). The failure is the story; the skip is its consequence.
    const d = withStages([
      { name: 'chair', status: 'error' },
      { name: 'debate-revote', status: 'skipped' },
    ]);
    expect(d.derived.verdictPanel.reason).toBe('Chair synthesis stage failed');
  });

  test('degradedReason precedence: a structured run.error outranks a skipped stage', () => {
    const d = withStages(
      [{ name: 'chair', status: 'skipped' }],
      { error: { code: 'BUDGET_EXCEEDED', message: 'budget gate refused the run' } },
    );
    expect(d.derived.verdictPanel.reason).toBe('BUDGET_EXCEEDED: budget gate refused the run');
  });

  test('degradedReason returns null when nothing is degraded — no invented explanation', () => {
    const d = withStages([
      { name: 'stage1', status: 'complete' },
      { name: 'chair', status: 'complete' },
    ]);
    expect(d.derived.verdictPanel.reason).toBeNull();
  });

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): sanitizeName collisions
  // between distinct bench entries are a run-integrity defect (artifact-guard.js's
  // artifactAllowlist now surfaces them via a `.collisions` array instead of silently
  // deduping) — getRunDetail exposes that as `derived.artifactCollisions` so the renderer can
  // warn the user instead of silently misattributing prose in the judges panel.
  test('artifactCollisions surfaces distinct bench entries that sanitize to the same artifact name', () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'run.json'), 'utf-8'));
    run.bench = ['vendor/a', 'vendor?a'];
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    registerPointer(project, 'aaaa1111', runDir);
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.derived.artifactCollisions).toEqual([{ sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a'] }]);
    // ⚠️ Task 18 fix-wave (review finding 2): the threading of artifact-guard.js's
    // artifactsByModel map through getRunDetail's `derived` (run-detail.js's one-line addition)
    // had no direct test anywhere — only the low-level map (artifact-guard.test.js) and the
    // fake-DOM renderer (workspace-app-boundary.test.js, hand-built fixtures) were covered, with
    // nothing pinning the wiring in the middle. toMatchObject (not toEqual) so this only pins the
    // shape this fixture's collision produces, not every key artifactAllowlist happens to add.
    expect(d.derived.artifactsByModel).toMatchObject({
      'vendor/a': { review: 'review-vendor-a.md', judge: 'judge-vendor-a.md' },
      'vendor?a': { review: 'review-vendor-a~2.md', judge: 'judge-vendor-a~2.md' },
    });
  });

  // ── v4.8 PR5a fix-wave, council finding B1 ────────────────────────────────────────
  // The renderer cannot require() src/, so run-detail.js answers "which name space is
  // this payload in?" ON ITS BEHALF. The finding was that the two halves had drifted:
  // the answer must be THE predicate the allowlist itself gates on, never a re-spelling.
  // Only a pin on getRunDetail can say that — tests/workspace/seat-panels.test.js builds
  // its fixture by calling isSeatTable directly, so it cannot see this file lie.
  // (MEASURED: a `!!(run.seats && run.seats.length)` mutant here SURVIVED the renderer
  // suite. That survival is what this test exists to convert into a kill.)
  describe('derived.seatSpace is isSeatTable, not a second spelling of it', () => {
    const { isSeatTable } = require('../../src/workspace/artifact-guard'); // eslint-disable-line global-require

    // Each entry is a seats[] a hand-edited run.json can really hold, and each fails
    // isSeatTable for a DIFFERENT reason — which is exactly what the weaker predicates
    // (`.length`, a truthiness test) cannot tell apart.
    const SEAT_TABLES = {
      'seat space (well formed)': [{ id: 'gemini#1', alias: 'gemini' }, { id: 'gemini#2', alias: 'gemini' }],
      'absent': undefined,
      'empty': [],
      'duplicate ids': [{ id: 'x#1', alias: 'gemini' }, { id: 'x#1', alias: 'gpt' }],
      'an empty id': [{ id: '', alias: 'gemini' }],
      'a null id': [{ id: null, alias: 'gemini' }],
      'a numeric id': [{ id: 1, alias: 'gemini' }],
    };

    for (const [label, seats] of Object.entries(SEAT_TABLES)) {
      test(`${label}: agrees with the predicate AND with the map it ships beside`, () => {
        const project = makeProject();
        const runDir = runDirIn(project, 'aaaa1111');
        const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'run.json'), 'utf-8'));
        run.bench = ['gemini', 'gemini'];
        if (seats === undefined) { delete run.seats; } else { run.seats = seats; }
        fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
        registerPointer(project, 'aaaa1111', runDir);
        const d = getRunDetail(project, 'aaaa1111');
        expect(d.derived.seatSpace).toBe(isSeatTable(seats));
        // ⚠️ seatTableRejected is NOT `!seatSpace` (council-3 C2's banner depends on the
        // difference): a run with NO seats[] — or an empty one — is a LEGACY run, not a
        // broken one, and bannering it would tell every pre-PR3 run it is malformed.
        // Rejected means "seats[] is there and unusable". MEASURED: a `!isSeatTable(seats)`
        // mutant here survived the whole run-detail suite until this assertion existed.
        const present = Array.isArray(seats) && seats.length > 0;
        expect(d.derived.seatTableRejected).toBe(present && !isSeatTable(seats));
        // The property that actually matters downstream, stated so it cannot pass
        // vacuously: the flag has to describe the space artifactsByModel is KEYED in.
        // Seat space keys by seat id (which contains '#'), alias space by bench alias.
        const keys = Object.keys(d.derived.artifactsByModel);
        expect(keys.every((k) => k.includes('#'))).toBe(d.derived.seatSpace);
      });
    }
  });

  test('artifactCollisions is empty when bench models sanitize to distinct names', () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.derived.artifactCollisions).toEqual([]);
  });

  test('TERMINAL_STATUSES mirrors the shipped composed-doc terminal set', () => {
    // ⚠️ DE-ROT (F26): widened from 5 names to the 7 in src/observe/live-doc.js:18
    // (added 'crashed' and 'idle-timeout'), same order, so the Task 14 drift pin passes.
    // ⚠️ v4.4.1 A1: widened again to 8 — 'timed-out' alongside 'timeout'. The two spellings come
    // from two different producers and both are live; see the note at src/observe/live-doc.js:18.
    expect(TERMINAL_STATUSES).toEqual(
      ['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'timed-out', 'idle-timeout']
    );
  });

  // Final-review fix wave (finding 1): getRunDetail returns `run` and `verdict` wholesale (the
  // `return { runId, runDir, run, tally, verdict, artifacts, derived }` line above) — the
  // renderer feature (electron/workspace-ui/workspace-seats.js:11-15) reads
  // `state.detail.run.degrades` / `state.detail.verdict.seatLoss` straight off that payload, with
  // no `derived` field carrying either separately. Nothing pinned that either field actually
  // survives the round trip — a future payload-trim refactor (stripping "unrecognized" keys off
  // run/verdict before they cross the IPC boundary) would silently kill the dead-seat-rows feature
  // while every test in this suite, and every direct-call case in dead-seat-rows.test.js, stayed
  // green.
  test('degrades[] and verdict.seatLoss survive getRunDetail pass-through intact (the IPC contract workspace-seats.js relies on)', () => {
    const project = makeProject();
    const runDir = runDirIn(project, 'aaaa1111');

    // Realistic dead-leg record shape — field names copied from
    // src/council/run-retry-notes.js's retryLegStillDeadNote (the still-dead-after-retry case:
    // `data.retryWaveId` + `data.firstFailure` both present).
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat foxtrot did not review',
      why: "the leg ended 'error' with no usable output; its once-only retry also ended 'error'",
      effect: '3 of 4 seats reviewed',
      data: {
        seat: 'foxtrot', status: 'error', reason: 'timed out', retryWaveId: 'aaaa1111-s1r1',
        firstFailure: { seat: 'foxtrot', class: 'wave', waveId: 'aaaa1111-s1', reason: 'no legs produced' },
      },
    }];
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'run.json'), 'utf-8'));
    run.degrades = degrades;
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));

    // Realistic seatLoss shape — field names copied from src/council/verdict.js's
    // summarizeSeatLoss return shape (also exercised by tests/council/verdict-seat-loss.test.js).
    const seatLoss = { criticRequested: 'foxtrot', criticSeated: false, reason: 'timed out', deadBenchSeats: [] };
    const verdict = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'verdict.json'), 'utf-8'));
    verdict.seatLoss = seatLoss;
    fs.writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify(verdict));

    registerPointer(project, 'aaaa1111', runDir);
    const d = getRunDetail(project, 'aaaa1111');

    expect(d.run.degrades).toEqual(degrades);
    expect(d.verdict.seatLoss).toEqual(seatLoss);
  });
});

// Third council-review pass: getRunDetail resolved a pointer and read run.json / tally.json /
// verdict.json + the artifact manifest straight from ptr.runDir with no check that runDir
// itself resolves inside project. The pointer file's {runId, runDir} JSON is validated only
// for truthiness (src/council/run-state.js:133-139) — a tampered/stale pointer can point
// runDir anywhere on disk. Mirrors src/workspace/artifact-guard.js's readRunArtifact outer
// fence and electron/ipc-workspace.js's workspace:open-report fence — same
// isRealpathContained helper (now shared via src/utils/path-fence.js), same check.
describe('getRunDetail — outer fence (runDir must resolve inside project)', () => {
  test('a tampered/stale pointer whose runDir resolves outside the project is refused, not read', () => {
    // A real, existing, fully-readable run directory — just not nested under `project`.
    const outsideRunDir = path.join(FX, 'council-run-complete');
    const project = makeProject();
    registerPointer(project, 'aaaa1111', outsideRunDir);

    const d = getRunDetail(project, 'aaaa1111');

    // Distinguishable from getRunDetail's other error shapes ('run.json missing',
    // the readPointer-sourced pointer-missing message, etc.) — this is the outer
    // fence firing, before run.json is ever read.
    expect(d.error).toBe('run directory escapes project');
    expect(d.run).toBeUndefined();
    expect(d.derived).toBeUndefined();
  });
});
