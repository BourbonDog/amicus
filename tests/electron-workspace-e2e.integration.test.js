/**
 * Council Workspace E2E (CDP) — fixture-driven, ZERO model calls / zero spend.
 * Spawns the real Electron shell in council-workspace mode against a temp
 * project seeded with the checked-in synthetic run dirs, asserts DOM state
 * over CDP, mutates the live fixture's progress.json mid-test, and captures
 * the fold block from the spawned process stdout.
 *
 * Skips when the electron binary is unavailable, or (Linux CI) when no
 * display can be provisioned (electron-toolbar-e2e.integration.test.js
 * pattern — both guards are load-bearing, see the two notes below).
 * Port 9225: 9223 is the manual/docs port, 9224 belongs to the toolbar suite.
 *
 * ⚠️ DE-ROT (F06): `.integration.test.js` no longer excludes a file from CI —
 * `ci.yml`'s `integration` job (:81-112) runs `npm run test:integration` on
 * ubuntu-latest for every push/PR, and that wrapper's jest invocation
 * (scripts/run-integration-keyless.js:126) collects this file via its
 * testMatch override (any tests-dir file ending .integration.test.js). A
 * display-less Linux runner has no electron display, so this suite MUST
 * carry both of the guards that keep the existing toolbar suite green there:
 *   1. a skip guard — `describeE2E` below, gated on HAS_ELECTRON && HAS_DISPLAY
 *      (no HAS_API_KEY term needed here: this suite is fixture-driven, zero
 *      model calls, zero spend — unlike the toolbar suite it does not talk to
 *      a real OpenCode server); and
 *   2. an `ensureDisplay()` Xvfb helper (copied verbatim from
 *      tests/electron-toolbar-e2e.integration.test.js:46-64), called in
 *      beforeAll and threaded into every spawned Electron's env as DISPLAY.
 * Verify explicitly with `npm run test:integration` — the default `npx jest`
 * never collects `*.integration.test.js` so it cannot catch a dropped guard.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CdpClient } = require('./helpers/cdp-client');
const { copyRunFixture } = require('./helpers/copy-run-fixture');

// require('electron') from plain Node returns the absolute path to the real
// binary (dist/electron.exe on Windows) — same pattern as the toolbar suite
// (electron-toolbar-e2e.integration.test.js:17-21).
const ELECTRON_BIN = (() => { try { return require('electron'); } catch { return null; } })();
const ELECTRON_MAIN = path.join(__dirname, '..', 'electron', 'main.js');
const CDP_PORT = 9225;
const FX = path.join(__dirname, 'fixtures');
const NONCE = 'cafef00dcafef00d';

// ⚠️ DE-ROT (F06): ELECTRON_BIN alone is NOT enough on a display-less Linux
// runner — Electron cannot open a window there. Combined with ensureDisplay()
// below (which provisions Xvfb when this is false), this is what keeps the
// keyless `integration` CI job green instead of timing out on all 5 tests.
const HAS_DISPLAY = process.platform !== 'linux' || !!process.env.DISPLAY;
const describeE2E = (ELECTRON_BIN && HAS_DISPLAY) ? describe : describe.skip;

// ⚠️ DE-ROT (F06): copied verbatim from the toolbar suite's guard
// (tests/electron-toolbar-e2e.integration.test.js:46-64) — the second half of
// the required pair. Provisions a virtual display on a headless Linux CI
// runner so Electron can actually open a (headless-test) window instead of
// every CdpClient.workspace() call timing out.
function ensureDisplay() {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return { display: process.env.DISPLAY, cleanup: () => {} };
  }
  const display = ':99';
  let xvfbProcess;
  try {
    xvfbProcess = spawn('Xvfb', [display, '-screen', '0', '1280x720x24', '-nolisten', 'tcp'], {
      stdio: 'ignore', detached: true,
    });
    xvfbProcess.unref();
  } catch (err) {
    throw new Error(`Xvfb not found. Install with: apt-get install xvfb. Error: ${err.message}`);
  }
  return {
    display,
    cleanup: () => { try { xvfbProcess.kill(); } catch { /* already dead */ } }
  };
}

function seedTempProject() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-e2e-'));
  const sessions = path.join(proj, '.claude', 'amicus_sessions');
  fs.mkdirSync(sessions, { recursive: true });
  // ⚠️ All three fixtures are COPIED INTO the temp project, and that is load-bearing, not
  // convenience. A council run dir is always nested inside its project (enforced at creation
  // time), and every pointer-consuming read is fenced against that invariant
  // (src/utils/path-fence.js). Pointing a pointer at the checked-in `tests/fixtures/` dir — which
  // lives in the repo, not in the temp project — is precisely the tampered-pointer shape the fence
  // exists to refuse: `scanCouncilRuns` returns `run directory escapes project` error rows and
  // every panel in the suite stays empty. Seed production-shaped dirs; never fixture paths.
  //
  // ⚠️ DE-ROT (F16): must be copyRunFixture, not a plain cpSync — cpSync leaves stages[].project
  // as the literal "__RUNDIR__" sentinel, so the leg rollup resolves against a nonexistent dir and
  // the live seats panel stays empty for the whole e2e.
  const liveDir = copyRunFixture(path.join(FX, 'council-run-live'), path.join(proj, 'run-cccc3333'));
  const entries = {
    aaaa1111: copyRunFixture(path.join(FX, 'council-run-complete'), path.join(proj, 'run-aaaa1111')),
    bbbb2222: copyRunFixture(path.join(FX, 'council-run-degraded'), path.join(proj, 'run-bbbb2222')),
    cccc3333: liveDir,
  };
  for (const [runId, runDir] of Object.entries(entries)) {
    fs.writeFileSync(path.join(sessions, `council-${runId}.json`), JSON.stringify({ runId, runDir }));
  }
  return { proj, liveDir };
}

function launchWorkspace(proj, runId, display) {
  const env = {
    ...process.env,
    AMICUS_MODE: 'council-workspace',
    AMICUS_PROJECT: proj,
    AMICUS_RUN_ID: runId || '',
    AMICUS_FOLD_NONCE: NONCE,
    AMICUS_HEADLESS_TEST: '1',
  };
  // ⚠️ DE-ROT (F06): thread the provisioned display into the spawned child —
  // without this, a Linux CI runner's Xvfb display is provisioned but never
  // reaches Electron, and the child fails to open a window anyway.
  if (display) { env.DISPLAY = display; }
  const child = spawn(ELECTRON_BIN, [`--remote-debugging-port=${CDP_PORT}`, ELECTRON_MAIN], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', () => {});
  return { child, getStdout: () => stdout };
}

function kill(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) { resolve(); return; }
    child.on('close', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 4000);
  });
}

describeE2E('council workspace e2e (CDP)', () => {
  jest.setTimeout(120000);

  let proj;
  let liveDir;
  let displayInfo;

  beforeAll(() => {
    displayInfo = ensureDisplay();
    ({ proj, liveDir } = seedTempProject());
  });

  afterAll(() => {
    if (displayInfo) { displayInfo.cleanup(); }
  });

  test('run list renders all three fixtures with status chips', async () => {
    const { child } = launchWorkspace(proj, '', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#run-list li');
      const rows = await cdp.evaluate(`
        Array.from(document.querySelectorAll('#run-list li')).map(li => ({
          id: li.querySelector('.mono')?.textContent,
          chip: li.querySelector('.chip')?.textContent || null,
        }))`);
      expect(rows.map((r) => r.id)).toEqual(['cccc3333', 'aaaa1111', 'bbbb2222']);
      expect(rows[1].chip).toBe('complete');
      expect(rows[2].chip).toBe('partial');
    } finally { cdp.close(); await kill(child); }
  });

  test('complete run: tier-colored matrix, basis counts, verdict, street-cred, blind toggle', async () => {
    const { child } = launchWorkspace(proj, 'aaaa1111', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#matrix-body table');
      const matrix = await cdp.evaluate(`
        Array.from(document.querySelectorAll('#matrix-body tbody tr')).map(tr => ({
          cls: tr.className,
          id: tr.dataset.findingId,
          last: tr.lastElementChild.textContent,
        }))`);
      expect(matrix).toHaveLength(4);
      expect(matrix.find((r) => r.id === 'A1')).toMatchObject({ cls: 'tier-Confirmed', last: '2/0/0' });
      expect(matrix.find((r) => r.id === 'B1').cls).toBe('tier-Disputed');

      const verdict = await cdp.evaluate(`document.querySelector('#verdict-body .chip').textContent`);
      expect(verdict).toBe('VERDICT: Fix these first');
      const credRows = await cdp.evaluate(`document.querySelectorAll('#verdict-body table tbody tr').length`);
      expect(credRows).toBeGreaterThanOrEqual(3);

      // ⚠️ Surface #4 ("anything visual"): tier row colours actually paint under the real
      // tokens.css/workspace.css cascade — a unit test's fake DOM never runs layout/paint at
      // all, so `className === 'tier-Confirmed'` there proves the class was SET, never that it
      // resolves to a colour. tokens.css: --tier-confirmed: #d7ead0, --tier-disputed: #ecd4ec.
      const tierColors = await cdp.evaluate(`
        (function () {
          function bg(id) {
            var td = document.querySelector('tr[data-finding-id="' + id + '"] td');
            return getComputedStyle(td).backgroundColor;
          }
          return { a1: bg('A1'), b1: bg('B1') };
        })()`);
      expect(tierColors.a1).toBe('rgb(215, 234, 208)'); // --tier-confirmed
      expect(tierColors.b1).toBe('rgb(236, 212, 236)'); // --tier-disputed
      expect(tierColors.a1).not.toBe(tierColors.b1);

      // Cost gauge fill: real LAYOUT (getBoundingClientRect), not the inline style string a
      // fake DOM would also happily store without ever resolving a percentage against a real
      // parent box. aaaa1111: costAmount 0.4321 / maxCost 2 -> ~21.6%.
      const gaugeRatio = await cdp.evaluate(`
        (function () {
          var fill = document.getElementById('cost-gauge-fill');
          var gauge = fill.parentElement;
          var fw = fill.getBoundingClientRect().width;
          var gw = gauge.getBoundingClientRect().width;
          return gw > 0 ? fw / gw : -1;
        })()`);
      expect(gaugeRatio).toBeGreaterThan(0.1);
      expect(gaugeRatio).toBeLessThan(0.35);

      // Stage rail: all 5 v4.0 stages complete for aaaa1111 -> 5 '.stage.complete' marks.
      const stageMarks = await cdp.evaluate(`
        Array.from(document.querySelectorAll('#stage-rail .stage')).map((s) => ({
          cls: s.className, text: s.textContent,
        }))`);
      expect(stageMarks).toHaveLength(5);
      expect(stageMarks.every((s) => s.cls === 'stage complete')).toBe(true);
      expect(stageMarks.every((s) => s.text.startsWith('✓ '))).toBe(true);

      // blind toggle: terminal default OFF → model names visible; toggling swaps to labels
      const before = await cdp.evaluate(`document.querySelector('#matrix-body thead').textContent`);
      expect(before).toContain('gemini');
      await cdp.evaluate(`document.getElementById('blind-toggle').click()`);
      await new Promise((r) => setTimeout(r, 300));
      const after = await cdp.evaluate(`document.querySelector('#matrix-body thead').textContent`);
      expect(after).toContain('Review A');
      expect(after).not.toContain('gemini');

      // ⚠️ Surface #2 ("real <details> toggle semantics"): click a REAL dispute cell (not a
      // hand-invoked `panel._listeners.toggle[0]()`, which every unit test uses). This is
      // exactly how drillIntoJudge opens the judges panel in production — the click sets
      // `panel.open = true`, and only a real browser fires the resulting native `toggle`
      // event that proseLoader's listener depends on.
      await cdp.evaluate(`document.querySelector('tr[data-finding-id="B1"] td.vote-cell.dispute').click()`);
      await new Promise((r) => setTimeout(r, 300));
      const judgesState = await cdp.evaluate(`({
        open: document.getElementById('judges-panel').open,
        loaded: document.getElementById('judges-panel').dataset.loaded,
        hasMark: !!document.getElementById('judges-body').querySelector('mark'),
      })`);
      expect(judgesState.open).toBe(true);
      expect(judgesState.loaded).toBe('1');
      expect(judgesState.hasMark).toBe(true);
    } finally { cdp.close(); await kill(child); }
  });

  test('fold click emits the nonced marker + VERDICT on the spawned process stdout', async () => {
    const { child, getStdout } = launchWorkspace(proj, 'aaaa1111', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#fold-btn');
      await cdp.evaluate(`document.getElementById('fold-btn').click()`);
      await new Promise((r) => setTimeout(r, 1500));
      const out = getStdout();
      expect(out).toContain('[SIDECAR_FOLD:' + NONCE + ']');
      expect(out).toContain('VERDICT: Fix these first');
      expect(out).toContain('Client: council-workspace');
      expect(out).not.toContain('deadbeefdeadbeef'); // planted marker stripped
      const btn = await cdp.evaluate(`document.getElementById('fold-btn').textContent`);
      expect(btn).toBe('Folded ✓');
    } finally { cdp.close(); await kill(child); }
  });

  test('degraded run renders "no chair verdict" + the engine reason', async () => {
    const { child } = launchWorkspace(proj, 'bbbb2222', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#verdict-body .chip');
      const chip = await cdp.evaluate(`document.querySelector('#verdict-body .chip').textContent`);
      expect(chip).toBe('no chair verdict');
      const banner = await cdp.evaluate(`document.getElementById('banner').textContent`);
      // ⚠️ PRE-FLIGHT (P3): derived from the chair stage, not run.error (null on partial runs).
      expect(banner).toContain('Chair synthesis stage failed');
      const chairNote = await cdp.evaluate(`document.getElementById('verdict-body').textContent`);
      expect(chairNote).toContain('chair-output.md not written yet');
    } finally { cdp.close(); await kill(child); }
  });

  test('live run: progress.json mutation reflects in the seat row within 2 poll intervals', async () => {
    const { child } = launchWorkspace(proj, 'cccc3333', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#seats-body tr');
      // blind default ON for live runs: gemini shows as Review A
      const names = await cdp.evaluate(`Array.from(document.querySelectorAll('#seats-body tr td:first-child')).map(td => td.textContent)`);
      expect(names).toContain('Review A');

      const progressPath = path.join(liveDir, '.claude', 'amicus_sessions', 'dddd0001', 'progress.json');
      const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      progress.stage = 'complete';
      progress.messagesReceived = 9;  // ⚠️ DE-ROT (F23 knock-on): readProgress never reads `messages`
      fs.writeFileSync(progressPath, JSON.stringify(progress));

      // ⚠️ DE-ROT (F47): was `+ 4000; // 2 × 1.5s poll + slack` — wrong cadence. Task 12's
      // pollDelay returns 1500 ONLY for {visible:true, focused:true}; every other combo is 5000.
      // Task 15 derives those live (visibilityState/hasFocus) and Task 9 never calls win.show()
      // under AMICUS_HEADLESS_TEST — so this window is never visible/focused and polls at 5s.
      const deadline = Date.now() + 12000; // 2 × 5s poll (headless window is never visible/focused) + slack
      let seen = false;
      while (Date.now() < deadline && !seen) {
        const rows = await cdp.evaluate(`Array.from(document.querySelectorAll('#seats-body tr')).map(tr => tr.textContent)`);
        seen = rows.some((r) => r.includes('9'));
        if (!seen) { await new Promise((r) => setTimeout(r, 400)); }
      }
      expect(seen).toBe(true);
    } finally { cdp.close(); await kill(child); }
  });

  // ⚠️ Surface #1 ("the largest gap"): arrow-key run navigation and Escape-closes-the-abort-
  // dialog are registered listeners nothing dispatches a real `keydown` at — every existing
  // unit test calls the handler function directly. CdpClient.pressKey() drives a REAL CDP
  // Input.dispatchKeyEvent through the page's actual focus/bubbling pipeline.
  test('keyboard: ArrowUp/ArrowDown navigate the run list; Escape closes the abort-confirm dialog', async () => {
    const { child } = launchWorkspace(proj, 'aaaa1111', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#matrix-body table'); // aaaa1111 fully open (boot deep-link)
      await cdp.evaluate(`document.getElementById('run-list').focus()`);

      // run-list order (desc startedAt): cccc3333(0), aaaa1111(1), bbbb2222(2) — booted on aaaa1111
      await cdp.pressKey('ArrowDown');
      await new Promise((r) => setTimeout(r, 400));
      expect(await cdp.evaluate(`document.getElementById('run-title').textContent`)).toBe('bbbb2222');

      await cdp.pressKey('ArrowUp');
      await new Promise((r) => setTimeout(r, 400));
      expect(await cdp.evaluate(`document.getElementById('run-title').textContent`)).toBe('aaaa1111');

      await cdp.pressKey('ArrowUp');
      await new Promise((r) => setTimeout(r, 400));
      expect(await cdp.evaluate(`document.getElementById('run-title').textContent`)).toBe('cccc3333');

      // cccc3333 is running (non-terminal): the abort button is visible.
      await cdp.waitForSelector('#abort-btn:not([hidden])');
      await cdp.evaluate(`document.getElementById('abort-btn').click()`);
      await new Promise((r) => setTimeout(r, 150));
      expect(await cdp.evaluate(`document.getElementById('dialog-abort').hidden`)).toBe(false);

      await cdp.pressKey('Escape');
      await new Promise((r) => setTimeout(r, 150));
      expect(await cdp.evaluate(`document.getElementById('dialog-abort').hidden`)).toBe(true);
    } finally { cdp.close(); await kill(child); }
  });

  // ⚠️ Surface #5 (F09): reproduces the stale-artifact class of bug through the REAL run-switch
  // UI path (a click on a different run-list row + a real <details> toggle), not the fake-DOM
  // unit test's hand-invoked re-render. NOTE: `window.amicusWorkspace.invoke` cannot be
  // monkey-patched to record calls — contextBridge.exposeInMainWorld() deep-freezes the exposed
  // object graph in the main world by design (the whole point of the bridge is that page script
  // cannot tamper with it), so this asserts on RENDERED CONTENT instead: aaaa1111's
  // review-gemini.md contains "validateSession" (a `Repro`/inline-check section bbbb2222's
  // one-line fixture never has) — its presence after switching would mean the reviews panel
  // still shows (or re-fetched) the wrong run's prose.
  test('run-switch does not leave the previous run\'s prose on screen after opening the new run\'s panel (F09)', async () => {
    const { child } = launchWorkspace(proj, 'aaaa1111', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#matrix-body table'); // aaaa1111 fully open
      // real <details> toggle — loads review-*.md for aaaa1111
      await cdp.evaluate(`document.querySelector('#reviews-panel summary').click()`);
      await new Promise((r) => setTimeout(r, 400));
      expect(await cdp.evaluate(`document.getElementById('reviews-body').textContent`))
        .toContain('validateSession');

      // switch runs via a real click on the run-list row — the normal UI path
      await cdp.evaluate(`document.querySelector('li[data-run-id="bbbb2222"]').click()`);
      await new Promise((r) => setTimeout(r, 400));
      expect(await cdp.evaluate(`document.getElementById('run-title').textContent`)).toBe('bbbb2222');
      // wireLazyPanels() closes every prose panel and clears its loaded flag on every run-open
      // (the DOM content itself is untouched until the panel is next opened — a closed
      // <details>'s prior content staying in the tree is normal and not what F09 is about).
      expect(await cdp.evaluate(`document.getElementById('reviews-panel').open`)).toBe(false);

      // open the reviews panel again on bbbb2222 — must render bbbb2222's OWN prose, not
      // aaaa1111's (which the panel showed the last time it was open)
      await cdp.evaluate(`document.querySelector('#reviews-panel summary').click()`);
      await new Promise((r) => setTimeout(r, 400));
      const reviewsText = await cdp.evaluate(`document.getElementById('reviews-body').textContent`);
      expect(reviewsText).not.toContain('validateSession');
      expect(reviewsText).toContain('debug level'); // bbbb2222's own review-gpt.md content
    } finally { cdp.close(); await kill(child); }
  });

  // ⚠️ Surface #6 (plan-mandated, documented — not a bug to "fix"): renderDetail()'s early
  // return for an unreadable run never touches the seats/matrix/verdict panels, so the
  // PREVIOUS run's rows stay on screen under the new run's title and unreadable banner. This
  // pointer/dir is created here (not in the shared seedTempProject) so it never shows up as a
  // 4th row in the earlier "run list renders all three fixtures" test's exact-array assertion.
  test('opening an unreadable run leaves the previous run\'s panels on screen under the new title (documented behaviour)', async () => {
    const brokenDir = path.join(proj, 'run-eeee4444-empty');
    fs.mkdirSync(brokenDir, { recursive: true }); // no run.json inside -> "run.json missing"
    fs.writeFileSync(
      path.join(proj, '.claude', 'amicus_sessions', 'council-eeee4444.json'),
      JSON.stringify({ runId: 'eeee4444', runDir: brokenDir }),
    );
    const { child } = launchWorkspace(proj, 'aaaa1111', displayInfo.display);
    const cdp = await CdpClient.workspace(CDP_PORT);
    try {
      await cdp.waitForSelector('#matrix-body tbody tr');
      expect(await cdp.evaluate(`document.querySelectorAll('#matrix-body tbody tr').length`)).toBe(4);

      // AmicusApp is the app's own public namespace (window.AmicusApp, published at boot) —
      // the same object the ?runId= boot deep-link itself calls into; not a test-only hook.
      await cdp.evaluate(`window.AmicusApp.openRun('eeee4444')`);
      await new Promise((r) => setTimeout(r, 400));

      expect(await cdp.evaluate(`document.getElementById('run-title').textContent`)).toBe('eeee4444');
      const banner = await cdp.evaluate(`document.getElementById('banner').textContent`);
      expect(banner).toContain('Run unreadable');
      expect(banner).toContain('run.json missing');

      const after = await cdp.evaluate(`document.querySelectorAll('#matrix-body tbody tr').length`);
      expect(after).toBe(4); // aaaa1111's stale rows, untouched by the early return

      // ⚠️ Fix-wave item 1: opening a LIVE (non-terminal) run first makes Abort visible;
      // opening the unreadable run right after must reset it — an enabled Abort pointed at a
      // run with no derived detail behind it is a live, destructive control left dangling.
      await cdp.evaluate(`window.AmicusApp.openRun('cccc3333')`);
      await cdp.waitForSelector('#abort-btn:not([hidden])');

      await cdp.evaluate(`window.AmicusApp.openRun('eeee4444')`);
      await new Promise((r) => setTimeout(r, 400));
      expect(await cdp.evaluate(`document.getElementById('abort-btn').hidden`)).toBe(true);

      // ⚠️ Fix-wave item 1 (primary bug): the Blind checkbox stays live with no derived model
      // behind it on this exact unreadable-run state (the error branch unhides #run-view
      // before renderDetail's own derived-model guard) — toggling it used to throw a
      // TypeError (renderDetail_preserveBlind dereferencing d.derived.cost unconditionally
      // via renderSeatsPanel, and again on its own last line).
      await cdp.evaluate(`document.getElementById('blind-toggle').click()`); // must not throw
      await cdp.evaluate(`document.getElementById('blind-toggle').click()`); // toggle back — still must not throw
      expect(await cdp.evaluate(`document.getElementById('run-title').textContent`)).toBe('eeee4444');
    } finally { cdp.close(); await kill(child); }
  });
});
