# v4.6.3 PR2 — "the seats panel stops being fooled" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Workspace dead-seat logic becomes role-aware (a model dead as critic but alive as chair still gets its dead row), resilient to pre-v4.6 runs (`verdict.degrades` + `seatLoss.deadBenchSeats` fallbacks), and `openRun`'s `get-run` reply can no longer repaint a run the user navigated away from — spec §5 of `docs/superpowers/specs/2026-08-05-v463-post-train-sweep-design.md` (approved; D3/D4/D5/D10).

**Architecture:** Renderer-only — recon proved live seat rows already carry `role` (`legRole` → `seatOf`, `src/workspace/live-normalize.js:52`) and both `get-run` (run+verdict wholesale) and `get-live` (`degrades` threaded at `mcp-council-awareness.js:188`) already deliver every field needed. All edits live in `electron/workspace-ui/` (strict ES5-IIFE zone). Order: dedup helpers first (line-count relief + shared vocabulary), then the independent stale-guard, then the two dead-seat feature tasks, then docs/gates/smoke.

**Tech Stack:** ES5 IIFE renderer files (var-only, function expressions, NO arrows/let/const/template literals — grep-verified zone convention), jest with `makeFakeDom()` (tests/workspace/helpers/fake-workspace-page.js — NO jsdom; `innerHTML` is a throwing trap). `live-model.js` is DOM-free and dual-exports (`module.exports` + `window.AmicusLive`).

## Global Constraints

- 300-line gate, measured today: `workspace-verbs.js` **294 (6 lines headroom — net-zero-or-negative edits ONLY)**, `workspace-render.js` **287**, `workspace-app.js` 262, `live-model.js` 183, `workspace-seats.js` 117. `renderSeats` carries a "287/300 — must not grow" memorial (workspace-seats.js:59).
- `TERMINAL_STATUSES` is a deliberate hand-copy, byte-identity TEST-ENFORCED across three files (live-model.js:17 ↔ src/workspace/run-detail.js:32 ↔ live-doc.js; drift pins at tests/workspace/live-model.test.js:25, run-detail.test.js:280, live-normalize.test.js:106). The `isTerminal` helper wraps consumption; the ARRAY stays exported and byte-identical.
- Reviewing-role set (suppression allowlist): `'seat'`, `'critic'`, `'lens:<slug>'` — chair/judge/rebuttal/revote must NEVER suppress a dead row. A null/unknown role is NOT reviewing (announce-over-silence: the failure direction of counting null as reviewing is silent suppression, the class v4.6 exists to forbid).
- Critic identification for degrade-sourced candidates: `data.seat === run.critic` — the ALIAS space, mirroring `deriveSeatLoss` (src/council/verdict.js:72) exactly. Never compare against resolved model ids.
- Alias keying on the live side stays `s.modelInput || s.model` (the F36 lesson — live payload `model` is the RESOLVED id, degrade records name ALIASES).
- `renderSeatsPanel` has NO terminal gate (PR4b removed it — history header workspace-seats.js:25-39). Do not reintroduce one anywhere.
- The openRun guard bails on **runId movement only** — a same-runId re-open with changed status (the terminal-refresh path, workspace-verbs.js:95) MUST still pass, or the running→terminal blind-recompute (workspace-app.js:125-129) never fires.
- Dead-row DOM contract unchanged: rows keyed `dataset.key = 'dead:' + model`, class `seat-dead`, cost cell empty, `(masked)` override (workspace-seats.js:85) untouched in mechanism. Role fills the EXISTING cell index 1 — no new column (cell-index pins `children[2]`/`children[6]` in dead-seat tests must keep passing).
- Test-branch rule: `node bin/amicus.js`; NEVER bare `npm install` (junctioned node_modules); `git push` ≥5-min timeout.
- Dev loop: `npx jest tests/workspace` (23 suites / 339 tests green at branch). Full suite baseline at branch: 492 suites / 6486+ / 0.
- Worktree: `C:\Users\sendt\code\amicus-wt-v463-pr2`, branch `feat/v4.6.3-pr2-seats-correctness`.

**Measured reality (recon 2026-08-05, wf_82720a7a-aed — verbatim excerpts in the recon reports; re-verify only if the branch base moves):**
- `deadSeats(degrades, seatLoss, liveSeats)` at live-model.js:139-175 — candidates `{model, statusText}` only; suppression map `live[s.modelInput || s.model]` (:173) role-blind; `seatLoss.deadBenchSeats` (string[] of aliases, src/council/verdict.js:41-47) unconsumed; consumes `data.seat`/`data.models[]`, `retried = !!(data.retryWaveId || data.firstFailure)`.
- NO degrade record carries a role field (all six emitters verified: run-stages.js:157,167 + run-retry-notes.js:22,35,49,68). Critic derivable ONLY via alias equality with `run.critic`.
- Pre-v4.6 (v4.5.2) runs: `verdict.seatLoss.deadBenchSeats` populated while `degrades[]` absent from BOTH docs. Checkpoint-swallow (run-degrade.js:35-37) can leave run.json degrade-less while verdict.json has them; `verdict.degrades` confirmed real (verdict.js:133-138, schema :209-228).
- `seatLoss` is null when no critic was requested — the fallback logic must not require it.
- deriveSeatLoss can duplicate a seat in deadBenchSeats (no dedup) — `deadSeats`' `seen` map already absorbs this.
- The 3 `TERMINAL_STATUSES.indexOf` sites: live-model.js:42 (`defaultBlind`, polarity `=== -1`), workspace-verbs.js:69 (`!== -1`), workspace-app.js:149 (`!== -1`).
- The 3 identical td-class ternaries: workspace-render.js:200, :208, workspace-seats.js:91 (cross-file — helper must export on `window.AmicusRender`).
- ⚠️ tests/workspace/workspace-render.test.js:441-473 pins the create/update className expressions BY REGEX ON FUNCTION SOURCE (RN-11 parity) — extracting the helper breaks it BY DESIGN; it must be rewritten to pin the new invariant (both sites call `seatCellClass`), not appeased.
- Stale-race test template: workspace-app-boundary.test.js:305-331 (held promise, two openRuns, resolve, 3× `await Promise.resolve()`); F42 epoch variant live-loop.test.js:279,:310.
- Existing dead-seat suppression fixtures pass role-less live seats (dead-seat-rows.test.js:121,:324,:350) — they FLIP under the reviewing-role allowlist and must gain truthful `role` fields (the real `seatOf` shape always carries `role`).
- `renderDeadSeatRows` builds cells via `seatCells({model, status: statusText, stalled: false}, ...)` — role cell (index 1) renders '—' today.
- appendDeadRows' minimal `AmicusApp` stubs (dead-seat-rows.test.js:248-254) will need the new fields threaded.
- Live-tick call sites: workspace-verbs.js:130-131 (`renderSeats` then `appendDeadRows(live)`); terminal path renderSeatsPanel (workspace-seats.js:44-53).
- GUI smoke asset: parked worktree `C:\Users\sendt\code\amicus-wt-v462-pr4` holds run `council-12c96b6b` (real degraded run, dead critic, $0 to reuse). CDP recipe: `AMICUS_DEBUG_PORT=9222` + puppeteer from devDeps; kill by EXACT ExecutablePath; do NOT modify that worktree.

---

### Task 1: dedup helpers — `isTerminal(status)` + `seatCellClass(i)` (+ the RN-11 pin rewrite)

**Files:**
- Modify: `electron/workspace-ui/live-model.js` (helper + defaultBlind + export), `electron/workspace-ui/workspace-verbs.js:69` (net-zero), `electron/workspace-ui/workspace-app.js:149`, `electron/workspace-ui/workspace-render.js` (helper + :200 + :208 + export), `electron/workspace-ui/workspace-seats.js:91`
- Test: `tests/workspace/live-model.test.js` (isTerminal unit), `tests/workspace/workspace-render.test.js` (seatCellClass unit + RN-11 pin REWRITE)

**Interfaces:**
- Produces: `window.AmicusLive.isTerminal(status): boolean` (also on module.exports); `window.AmicusRender.seatCellClass(i): string`. Later tasks and files consume these names verbatim.

- [ ] **Step 1: Write the failing tests.** In `tests/workspace/live-model.test.js` (bare-require idiom, no DOM):
```js
describe('isTerminal (v4.6.3 PR2 dedup)', () => {
  test('true for every TERMINAL_STATUSES member, false otherwise', () => {
    TERMINAL_STATUSES.forEach(function (s) { expect(isTerminal(s)).toBe(true); });
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal(null)).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });
  test('defaultBlind is exactly !isTerminal', () => {
    TERMINAL_STATUSES.concat(['running', 'starting']).forEach(function (s) {
      expect(defaultBlind(s)).toBe(!isTerminal(s));
    });
  });
});
```
(Extend the file's existing top-of-file destructured require with `isTerminal`.)

In `tests/workspace/workspace-render.test.js`: (a) a direct unit test:
```js
describe('seatCellClass (v4.6.3 PR2 dedup)', () => {
  test('num for cells 4-6, stalled-flag for 8, empty otherwise', () => {
    const expected = ['', '', '', '', 'num', 'num', 'num', '', 'stalled-flag'];
    expected.forEach(function (want, i) { expect(R.seatCellClass(i)).toBe(want); });
  });
});
```
(b) REWRITE the RN-11 source-text parity pin (:441-473 region): the old regexes matched the literal ternary in both the create and update branches; the new invariant is that BOTH branches call the helper. Replace the regex pair with source assertions that `renderSeats`'s source contains `seatCellClass(i)` in both the `el('td'...)` construction and the `td.className =` update (two distinct matches), plus keep the runtime pins (`children[5].className === 'num'`, `children[8].className === 'stalled-flag'`) byte-unchanged.

- [ ] **Step 2: Run to verify RED.** `npx jest tests/workspace/live-model.test.js tests/workspace/workspace-render.test.js` — new tests fail (`isTerminal is not a function` / `seatCellClass is not a function`); everything else green.

- [ ] **Step 3: Implement.**

`live-model.js` — directly after `defaultBlind`'s current location, add the helper and rewrite `defaultBlind` (the ARRAY at :17 is untouched):
```js
  /** True when `status` is a terminal run status. The single consumption
   * point for TERMINAL_STATUSES membership (v4.6.3 PR2 dedup) — the array
   * itself stays exported and byte-identical to src/workspace/run-detail.js
   * (drift-pinned). */
  function isTerminal(status) {
    return TERMINAL_STATUSES.indexOf(status) !== -1;
  }

  function defaultBlind(status) {
    return !isTerminal(status);
  }
```
Export: add `isTerminal: isTerminal,` to the api object.

`workspace-verbs.js:69` — line-neutral replacement:
```js
    if (!d || !d.run || window.AmicusLive.isTerminal(d.run.status)) { return; }
```

`workspace-app.js:149`:
```js
    var isTerminal = window.AmicusLive.isTerminal(d.run.status);
```

`workspace-render.js` — helper near the top of the render-helpers area:
```js
  /** td className for seat-table cell index i — one source for the three
   * call sites (renderSeats create + update, renderDeadSeatRows). */
  function seatCellClass(i) {
    return i >= 4 && i <= 6 ? 'num' : (i === 8 ? 'stalled-flag' : '');
  }
```
Both renderSeats sites become `{ className: seatCellClass(i) }` / `td.className = seatCellClass(i);`. Export `seatCellClass` on `window.AmicusRender`.

`workspace-seats.js:91`:
```js
            { className: window.AmicusRender.seatCellClass(i) }, [c]);
```

- [ ] **Step 4: Verify green + sizes.** `npx jest tests/workspace` (23 suites) then `npm run check:sizes` — workspace-verbs.js must still be ≤294 lines, workspace-render.js ≤ ~292; report exact `wc -l` for both in the report.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "refactor(workspace-ui): isTerminal + seatCellClass dedup helpers (D10)"`

### Task 2: openRun stale-reply guard (D5)

**Files:**
- Modify: `electron/workspace-ui/workspace-app.js:66-93` (openRun)
- Test: `tests/workspace/workspace-app-boundary.test.js`

**Interfaces:** none new — behavior guard only.

- [ ] **Step 1: Write the failing test** — model it EXACTLY on the debate.json race at workspace-app-boundary.test.js:305-331, but hold the `workspace:get-run` channel itself:
```js
test('a stale get-run reply from a run navigated away from never repaints the run now open (v4.6.3 PR2, F09 class)', async () => {
  let resolveStaleDetail;
  const staleDetail = new Promise((resolve) => { resolveStaleDetail = resolve; });
  invokeMock.mockImplementation((channel, ...args) => {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') {
      if (args[0] === 'aaaa1111') { return staleDetail; }
      return Promise.resolve(buildFixtureDetail(args[0]));
    }
    return Promise.resolve({ text: 'prose' });
  });
  const first = global.window.AmicusApp.openRun('aaaa1111'); // left pending
  await global.window.AmicusApp.openRun('bbbb2222');
  expect(global.window.AmicusApp.state.detail.runId).toBe('bbbb2222');
  resolveStaleDetail(buildFixtureDetail('aaaa1111'));
  await first;
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(global.window.AmicusApp.state.runId).toBe('bbbb2222');
  expect(global.window.AmicusApp.state.detail.runId).toBe('bbbb2222'); // stale A never overwrote B
});
```
Also add the non-regression twin: a SAME-runId second open (the terminal-refresh path) still applies its reply — open 'aaaa1111', hold nothing, re-open 'aaaa1111' with a changed-status fixture, assert `state.detail.run.status` reflects the second reply.

- [ ] **Step 2: Run to verify RED** — the race test fails against current code (stale A's reply overwrites `state.detail` and repaints); the twin passes already.

- [ ] **Step 3: Implement** — first line of openRun's `.then` (workspace-app.js:69-70 region), the house F09 shape:
```js
    return invoke('workspace:get-run', runId).then(function (detail) {
      // F09 guard (v4.6.3 PR2): a reply for a run the user has since
      // navigated away from must never overwrite the run now open. Guard on
      // runId movement ONLY — a same-run re-open (the live loop's terminal
      // refresh) must still apply its fresher reply.
      if (state.runId !== runId) { return; }
      state.detail = detail;
```
(The debate sub-fetch keeps its own existing guards.)

- [ ] **Step 4: Verify green.** `npx jest tests/workspace/workspace-app-boundary.test.js tests/workspace/live-loop.test.js` (live-loop's terminal-refresh + timer-count pins must be untouched), then `npx jest tests/workspace`.

- [ ] **Step 5: Commit.** `git commit -am "fix(workspace-ui): openRun stale-reply guard — runId-movement bail (D5)"`

### Task 3: role-aware dead-seat suppression + the critic role cell (D3)

**Files:**
- Modify: `electron/workspace-ui/live-model.js` (deadSeats), `electron/workspace-ui/workspace-seats.js` (both call sites + renderDeadSeatRows role pass-through)
- Test: `tests/workspace/dead-seat-rows.test.js` (new cases + truthful-role fixture updates), `tests/workspace/workspace-app-boundary.test.js` (production-path role-cell case), `tests/workspace/live-model.test.js` (deadSeats unit cases if the file's structure fits better — implementer's call, say which)

**Interfaces:**
- `deadSeats(degrades, seatLoss, liveSeats, runMeta)` — NEW optional 4th param `runMeta: { critic: string|null }`. Returns `[{ model, statusText, role }]` where `role` is `'critic'` or `null`. Task 4 keeps this signature.
- Suppression semantics (spec D3 + Global Constraints): live map records only REVIEWING-role rows (`seat`/`critic`/`lens:*`; null role ≠ reviewing), keyed by alias (`modelInput || model`); a candidate with `role: 'critic'` is suppressed only by a live CRITIC-role row for that alias; a null-role candidate by ANY reviewing-role row.

- [ ] **Step 1: Write the failing tests.**

(a) THE RED scenario (spec §5 — the #102 rider verbatim), in dead-seat-rows.test.js's `paint()` layer:
```js
test('dead-as-critic + alive-as-chair renders the dead row (role-aware D6, v4.6.3 PR2)', () => {
  // model 'foxtrot' died as critic; the chair fallback walk landed on the
  // SAME model and it succeeded as chair — its chair cost row must not
  // suppress the dead-critic row.
  const degrades = [{ kind: 'degrade', channel: 'dead-leg', what: 'seat foxtrot did not review',
    why: "the leg ended 'error'", effect: '2 of 3 seats reviewed',
    data: { seat: 'foxtrot', status: 'error', reason: 'timed out' } }];
  const costRows = [
    { model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' },
    { model: 'bravo', role: 'seat', status: 'complete', costDisplay: '$0.01' },
    { model: 'foxtrot', role: 'chair', status: 'complete', costDisplay: '$0.02' },
  ];
  paint(costRows, degrades, null, false, null, { critic: 'foxtrot' });
  const deadRows = tbody.children.filter(function (r) { return r.classList.contains('seat-dead'); });
  expect(deadRows.length).toBe(1);
  expect(deadRows[0].children[0].textContent).toBe('foxtrot');
  expect(deadRows[0].children[1].textContent).toBe('critic'); // the role cell
});
```
(Adapt `paint()`'s signature to thread `runMeta`; the helper mirrors renderSeatsPanel.)

(b) The suppression-precision twin: same fixture but foxtrot's live row has `role: 'critic'` (the recovered-critic case) → ZERO dead rows (a live critic leg suppresses the dead-critic candidate).

(c) Null-role candidates: a bench dead-leg (`data.seat` ≠ critic) suppressed by a live `role: 'seat'` row for that alias; NOT suppressed by a `role: 'chair'`-only row.

(d) seatLoss-backstop role: the existing seatLoss-only production-path test's dead row now shows `critic` in cell 1 — extend `workspace-app-boundary.test.js`'s 'verdict.seatLoss (not degrades[]) names the dead critic' (~:960) with the `children[1]` assertion (fixture's run doc must carry `critic` — extend `deadSeatFixture` accordingly).

(e) Truthful-role fixture updates: the existing suppression fixtures that pass role-less live seats (dead-seat-rows.test.js:121 recovered-seat, :324 D6-in-seats, :350 alias-vs-resolved-id) gain `role: 'seat'` (or `'critic'` where the scenario is the critic) — matching the real `seatOf` shape which ALWAYS carries `role`. Each gets a one-line comment: "role added v4.6.3 PR2 — the live payload always carries it (live-normalize.js seatOf)".

- [ ] **Step 2: Run to verify RED** — (a), (c)'s chair-only half, and (d) fail against current code; (b) and the updated fixtures pass or fail ONLY for the expected reason (report which).

- [ ] **Step 3: Implement `deadSeats`** (live-model.js:139-175 replacement; ES5, DOM-free):
```js
  function deadSeats(degrades, seatLoss, liveSeats, runMeta) {
    var critic = runMeta && runMeta.critic ? runMeta.critic : null;
    var seen = {};
    var order = [];
    function add(model, retried, role) {
      if (!model || seen[model]) { return; }
      seen[model] = true;
      order.push({
        model: model,
        role: role || null,
        statusText: retried ? 'did not review — retried once' : 'did not review',
      });
    }
    (degrades || []).forEach(function (d) {
      if (!d || d.kind !== 'degrade') { return; }
      if (d.channel !== 'dead-leg' && d.channel !== 'dead-wave') { return; }
      var data = d.data || {};
      var retried = !!(data.retryWaveId || data.firstFailure);
      // Critic identification mirrors deriveSeatLoss (verdict.js): alias
      // equality with run.critic — degrade records carry no role field.
      if (d.channel === 'dead-leg') {
        add(data.seat, retried, critic && data.seat === critic ? 'critic' : null);
      } else {
        (data.models || []).forEach(function (m) {
          add(m, retried, critic && m === critic ? 'critic' : null);
        });
      }
    });
    if (seatLoss && seatLoss.criticRequested && !seatLoss.criticSeated) {
      add(seatLoss.criticRequested, false, 'critic');
    }
    // Role-aware D6 (v4.6.3 PR2): only REVIEWING-role live legs suppress —
    // a chair/judge/rebuttal/revote row must not hide a dead reviewer, and
    // a dead-critic candidate is cleared only by a live CRITIC leg. A null
    // role is NOT reviewing: counting it would suppress silently, the exact
    // class the announcement invariant forbids.
    function isReviewing(role) {
      return role === 'seat' || role === 'critic' ||
        (typeof role === 'string' && role.indexOf('lens:') === 0);
    }
    var reviewing = {};
    var byRole = {};
    (liveSeats || []).forEach(function (s) {
      if (!isReviewing(s.role)) { return; }
      var alias = s.modelInput || s.model; // F36: alias space, never resolved ids
      reviewing[alias] = true;
      byRole[alias + '|' + s.role] = true;
    });
    return order.filter(function (s) {
      if (s.role === 'critic') { return !byRole[s.model + '|critic']; }
      return !reviewing[s.model];
    });
  }
```

**Call sites** (workspace-seats.js): `renderSeatsPanel` passes `{ critic: (d.run && d.run.critic) || null }`; `appendDeadRows` passes `{ critic: (d && d.run && d.run.critic) || null }` (state.detail may be null mid-run — the stub tests rely on that). `renderDeadSeatRows` threads the role: the seatCells input becomes `{ model: seat.model, role: seat.role, status: seat.statusText, stalled: false }` — the role cell (index 1) fills via `dash(seat.role)`, '—' when null. Cell-index and `(masked)` mechanics untouched.

- [ ] **Step 4: Verify green.** `npx jest tests/workspace/dead-seat-rows.test.js tests/workspace/workspace-app-boundary.test.js tests/workspace/live-model.test.js tests/workspace/live-loop.test.js` then the full family `npx jest tests/workspace`.

- [ ] **Step 5: Commit.** `git commit -am "feat(workspace-ui): role-aware dead-seat suppression + critic role cell (D3)"`

### Task 4: old-run resilience — `verdict.degrades` fallback + `deadBenchSeats` candidates (D4)

**Files:**
- Modify: `electron/workspace-ui/live-model.js` (deadSeats: deadBenchSeats consumption), `electron/workspace-ui/workspace-seats.js` (degrades source-selection at both call sites)
- Test: `tests/workspace/dead-seat-rows.test.js` + `tests/workspace/workspace-app-boundary.test.js`

**Interfaces:**
- Consumes Task 3's `deadSeats(degrades, seatLoss, liveSeats, runMeta)` — signature unchanged; `seatLoss.deadBenchSeats` (string[] of aliases) now feeds candidates.
- Source-selection contract (spec D4 — fallback union, not a rewrite): degrades = `run.degrades` when non-empty, else `verdict.degrades` (run-degrade.js swallows checkpoint failures, so verdict.json can carry records run.json lost); on the live path, `live.degrades` when non-empty, else `state.detail.verdict.degrades` (usually absent mid-run — fine).

- [ ] **Step 1: Write the failing tests.**

(a) The v4.5.2-shaped run (production path, `workspace-app-boundary.test.js`): fixture with NO degrades anywhere, `verdict.seatLoss = { criticRequested: 'echo', criticSeated: false, reason: 'no legs', deadBenchSeats: ['alpha', 'bravo'] }`, cost rows for neither alpha nor bravo → THREE dead rows (critic 'echo' role `critic`; 'alpha'/'bravo' role '—'), plain 'did not review'.

(b) The checkpoint-loss shape (paint layer): `run.degrades` absent/empty, `verdict.degrades` carrying a dead-leg record → row renders from the verdict fallback.

(c) Precedence pin: BOTH `run.degrades` (one seat) and `verdict.degrades` (a different seat) present → only run.degrades' seat renders (non-empty run.degrades wins; no union of the two docs).

(d) deadBenchSeats dedup: `deadBenchSeats: ['alpha', 'alpha']` (the deriveSeatLoss no-dedup quirk) plus a dead-leg degrade also naming 'alpha' → exactly ONE row (the `seen` map absorbs both).

(e) Suppression still applies: `deadBenchSeats: ['alpha']` with a live `role:'seat'` row for 'alpha' → zero rows.

- [ ] **Step 2: Run to verify RED** — (a) currently renders only the critic row (deadBenchSeats unconsumed); (b) renders nothing; (c)/(d)/(e) state expected pre-fix behavior in the report.

- [ ] **Step 3: Implement.**

`deadSeats` — after the critic backstop block, before the live-map section:
```js
    if (seatLoss) {
      // Pre-degrades[] era (v4.5.2): the bench half of a seat loss lives
      // only here. Alias strings; deriveSeatLoss does not dedup — `seen`
      // absorbs repeats and degrade-sourced duplicates.
      (seatLoss.deadBenchSeats || []).forEach(function (m) { add(m, false, null); });
    }
```

`workspace-seats.js` — renderSeatsPanel:
```js
    var deg = (d.run.degrades && d.run.degrades.length) ? d.run.degrades
      : ((d.verdict && d.verdict.degrades) || []);
    var dead = window.AmicusLive.deadSeats(deg, seatLoss, seats, { critic: (d.run && d.run.critic) || null });
```
appendDeadRows:
```js
    var deg = (live.degrades && live.degrades.length) ? live.degrades
      : ((d && d.verdict && d.verdict.degrades) || []);
```

- [ ] **Step 4: Verify green** — same suite set as Task 3 + `npx jest tests/workspace`.

- [ ] **Step 5: Commit.** `git commit -am "feat(workspace-ui): verdict.degrades fallback + deadBenchSeats candidates (D4)"`

### Task 5: docs, gates, zero-cost GUI smoke

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` — union with PR1's entries, the #91/#92 lesson), `docs/council.md` (the dead-seat visibility paragraph — verify current text, correct if it contradicts role/old-run behavior)
- No push, no PR (controller owns those after the final review).

- [ ] **Step 1: CHANGELOG `[Unreleased]`** — under the existing `### Fixed` (append; do not disturb PR1's entries):
```markdown
- **The Workspace seats panel's dead-seat rows are now role-aware and old-run
  resilient.** A model that died as critic but succeeded as chair no longer has
  its dead row hidden by the chair's cost row (only a live reviewing leg —
  seat/critic/lens — suppresses, and a dead critic only by a live critic leg);
  the dead critic's row names its role. Pre-v4.6 runs render their losses too:
  `verdict.seatLoss.deadBenchSeats` feeds rows, and `verdict.json`'s
  `degrades[]` backstops a `run.json` that lost its checkpoint. A stale
  `get-run` reply from a run you navigated away from can no longer repaint the
  run now open.
```
Verify `docs/council.md`'s dead-seat text (added by #102/#103) still tells the truth; touch only if it contradicts.

- [ ] **Step 2: Full gates.** `npm test` (report exact counts; baseline 492/6486+), `npm run lint`, `npm run check:sizes`, `npm run validate-docs`.

- [ ] **Step 3: Zero-cost GUI smoke (best-effort — the #102 fixture-blindness lesson).** The parked worktree `C:\Users\sendt\code\amicus-wt-v462-pr4` holds real degraded run `council-12c96b6b` (dead critic, terminal). From THAT directory (do not modify it): launch `AMICUS_DEBUG_PORT=9222 node C:\Users\sendt\code\amicus-wt-v463-pr2\bin\amicus.js watch 12c96b6b --ui`, connect puppeteer (devDeps) to :9222, assert: exactly one `.seat-dead` row; its role cell (children[1]) reads `critic`; blind ON renders `(masked)`; screenshot to the session scratchpad. Kill Electron by EXACT ExecutablePath. If the run pointer or dir is missing, report SKIPPED with the reason — this smoke is evidence, not a gate; do NOT create a paid run to replace it.

- [ ] **Step 4: Commit.** `git commit -am "docs(changelog): v4.6.3 PR2 — role-aware, old-run-resilient dead-seat rows"`

## Execution notes (read before Task 1)

- Order is load-bearing: Task 1 first (helpers + line relief), Task 3 before Task 4 (signature). Task 2 is independent — slot anywhere.
- workspace-verbs.js edits must be net-zero (294/300); if any task's edit there turns net-positive, STOP and report — extraction is a controller decision.
- The RN-11 source-regex pin rewrite (Task 1) is deliberate test surgery, not appeasement — the new pin must still enforce create/update parity, just via the helper.
- Fixture truthfulness: every new degrade/seatLoss fixture mirrors the shapes in the recon (§ Measured reality) — verified against run-retry-notes.js/verdict.js emitters, never invented.
- Expected new-test delta: ~12-16 across Tasks 1-4; attribute exactly in the PR body.
