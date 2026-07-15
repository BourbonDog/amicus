# Electron 43 Upgrade + WebContentsView Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Amicus's Electron 28.3.3 → 43.1.1, migrate the deprecated `BrowserView` to `WebContentsView`, and adapt the `@electron/get` self-heal to the ESM-only 5.x line — shipped as **3.0.0**.

**Architecture:** Three phases. **Phase 0** is a throwaway-branch research spike that resolves the empirical unknowns (@electron/get 5.x download/timeout/proxy/checksum behavior; the WebContentsView API shape + CDP target type on Electron 43) and records them in a committed findings note. **Phase 1** (preparation) lands the Node-floor policy, CI, fixtures, and provisioning contract tests with the *old* Electron still installed — every task is independently green on Node 22. **Phase 2** (migration) flips the pins, rewrites provisioning for `@electron/get` 5.x, and migrates `main.js` to `WebContentsView`, gated by CDP e2e + manual smoke.

**Tech Stack:** Node.js (CommonJS, floor raised to ≥22.12), Electron 43.1.1, `@electron/get` 5.x (ESM-only, native `fetch`), Jest, Chrome DevTools Protocol (via `tests/helpers/cdp-client.js`).

**Source spec:** [`docs/superpowers/specs/2026-07-14-electron-43-upgrade-design.md`](../specs/2026-07-14-electron-43-upgrade-design.md) — reviewed by DeepSeek, GLM, and GPT-5.6 Terra Pro; all findings verified before adoption.

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec):

- **Node floor:** `engines.node` → `>=22.12.0`. Run and verify everything on Node ≥22.12.
- **Electron pin:** `electron` optionalDependency → **`^43.1.1`** (NOT `^43.0.0` — semver would admit the pre-fix `43.0.0`). Exact `43.1.1` is acceptable.
- **`@electron/get`:** declared in **regular `dependencies`**, pinned `^5.0.0` (required at runtime by the self-heal; it is ESM-only).
- **Version:** ship as **3.0.0** (major). Lockstep `package.json`, `.claude-plugin/plugin.json`, `server.json` (`.version` + `.packages[0].version`) per `docs/publishing.md`.
- **Verified facts:** Electron 43 = Chromium 150 / Node 24 internally. Amicus runs Electron **unpackaged** (no asar/code-signing) — ASAR-integrity controls are inapplicable; download-path integrity (checksum/cache/proxy) is the real boundary.
- **Repo rules (CLAUDE.md):** CommonJS + dynamic `import()` for ESM-only deps; no file >300 lines / function >50 lines; structured logging via `src/utils/logger.js` (stderr, never stdout); any add/remove/rename under `src/`/`bin/`/`scripts/` requires a CLAUDE.md update in the same commit (`node scripts/generate-docs.js`).
- **Decomposition:** Phase 1 = preparation PR/commits; Phase 2 = migration PR/commits. Do **not** tag 3.0.0 until Phase 2's verification bar is green.

---

## Phase 0 — De-risking spike (throwaway branch; findings committed)

> Runs on a throwaway branch `spike/electron-43`. The *code* is throwaway; the **deliverable is `docs/superpowers/notes/electron-43-spike-findings.md`**, which Phases 1–2 consume. Sub-steps are ordered **B then A** — the WebContentsView spike needs a provisioned Electron 43 binary first.

### Task 0.1: Provisioning spike (@electron/get 5.x on Node 22) — the "B" step

**Files:**
- Create (throwaway): `spike/get5-check.mjs`
- Create (committed deliverable): `docs/superpowers/notes/electron-43-spike-findings.md`

**Interfaces:**
- Produces (recorded in the findings note, consumed by Tasks 1.4, 2.1): the exact 5.x `downloadArtifact` call signature; the timeout mechanism replacing `got`'s `{timeout:{socket,request}}`; whether/how 5.x honors `HTTPS_PROXY`/`NO_PROXY`; checksum + corrupted-cache behavior; the resolved cache root vs `electron-cache.js`.

- [ ] **Step 1: Confirm the runtime is Node ≥22.12**

Run: `node --version`
Expected: `v22.12.0` or higher. If lower, install/switch Node first — `@electron/get@5` will not import otherwise.

- [ ] **Step 2: Create the throwaway branch and install the 5.x line**

```bash
git switch -c spike/electron-43
npm install --no-save @electron/get@^5.0.0 electron@43.1.1 --ignore-scripts
```

Expected: install succeeds; `node -e "console.log(require('./node_modules/@electron/get/package.json').type)"` prints `module`.

- [ ] **Step 3: Verify the ESM import works from a CommonJS context (the real failure mode)**

Write `spike/get5-check.mjs`:

```js
// Reproduces the self-heal's needs: dynamic import of the ESM-only module,
// a real download, checksum behavior, cache root, and proxy env visibility.
import os from 'node:os';
import path from 'node:path';

const g = await import('@electron/get');
console.log('exports:', Object.keys(g));                       // expect downloadArtifact present
console.log('downloadArtifact typeof:', typeof g.downloadArtifact);

// Record the options surface 5.x accepts (read its dist types / source):
// electron-install.js:162 currently passes downloadOptions.timeout:{socket,request} (got-style).
// Determine the 5.x-native equivalent and write it into the findings note.
```

Run: `node spike/get5-check.mjs`
Expected: prints `exports:` including `downloadArtifact`, `typeof` = `function`. (A CJS `require('@electron/get')` here would throw `ERR_REQUIRE_ESM` — that is the whole reason for the `await import` conversion in Task 2.1.)

- [ ] **Step 4: Run a real download and record checksum + cache behavior**

Extend `spike/get5-check.mjs` to call `downloadArtifact({ version: '43.1.1', artifactName: 'electron', platform: process.platform, arch: process.arch })`, then:
- record the returned zip path and its cache directory shape;
- compare that directory against what `src/sidecar/electron-cache.js:17-28` computes (`env-paths('electron')`-style) — note any mismatch;
- corrupt one byte of the cached zip, re-run, and record whether 5.x re-validates/rejects (checksum via bundled `sumchecker`) or silently trusts it;
- re-run with `force: true` and confirm it does **not** bypass checksum.

Run: `node spike/get5-check.mjs`
Expected: a real Electron 43.1.1 zip downloads and checksum-validates; the corrupted-cache run is rejected; `force:true` still validates. **Record all outcomes in the findings note.**

- [ ] **Step 5: Record proxy behavior**

In the findings note, document whether 5.x (native `fetch`, no `got`) honors `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`/proxy-auth. If it does not natively, record the chosen mechanism for Task 2.1 (undici `ProxyAgent`/`global-agent`, or "document unsupported + manual-install fallback"). Test by setting `HTTPS_PROXY` to an unreachable host and confirming the download attempt routes (or does not route) through it.

- [ ] **Step 6: Write the findings note and commit it**

Create `docs/superpowers/notes/electron-43-spike-findings.md` with sections: *downloadArtifact signature*, *timeout mechanism*, *proxy support + chosen approach*, *checksum/corrupted-cache/force behavior*, *cache-root parity*, *binary-launch result*. Every entry is a recorded fact, not a guess.

```bash
git add docs/superpowers/notes/electron-43-spike-findings.md
git commit -m "docs(spike): record @electron/get 5.x provisioning findings for Electron 43"
```

### Task 0.2: WebContentsView spike (Electron 43) — the "A" step, on the provisioned binary

**Files:**
- Create (throwaway): `spike/wcv-check.js`
- Modify (committed): `docs/superpowers/notes/electron-43-spike-findings.md`

**Interfaces:**
- Consumes: a working Electron 43.1.1 binary from Task 0.1.
- Produces (recorded, consumed by Tasks 2.3, 2.6): confirmation that `new WebContentsView({webPreferences})` + `mainWindow.contentView.addChildView(view)` + `view.setBounds(...)` render; the CDP `target.type` a child WebContentsView enumerates as; whether `data:` URL script + `executeJavaScript` still work on Chromium 150; whether `will-navigate`/`render-process-gone`/`dom-ready` fire on the child `webContents`.

- [ ] **Step 1: Write a minimal WebContentsView harness**

Write `spike/wcv-check.js`:

```js
const { app, BrowserWindow, WebContentsView } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 600, show: true });
  await win.loadURL('data:text/html,<body style="margin:0"><h1 id="tb">toolbar</h1></body>');

  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.contentView.addChildView(view);                 // the corrected receiver: window ROOT view
  const { width, height } = win.getContentSize();
  view.setBounds({ x: 0, y: 40, width, height: height - 40 });   // mirror main.js:360-361 math
  await view.webContents.loadURL('data:text/html,<body style="background:#fff"><input id="in"></body>');

  view.webContents.on('will-navigate', (e, url) => console.log('WILL-NAVIGATE child:', url));
  view.webContents.on('render-process-gone', (_e, d) => console.log('GONE child:', d.reason));
  view.webContents.on('dom-ready', () => console.log('DOM-READY child fired'));

  // toolbar-style poll into the ROOT page (main.js pattern):
  const tb = await win.webContents.executeJavaScript(`document.getElementById('tb')?.textContent`);
  console.log('toolbar executeJavaScript still works:', tb);
});
```

- [ ] **Step 2: Launch it under CDP and record what enumerates**

Run (adjust the electron path to the provisioned binary; `AMICUS_DEBUG_PORT` convention is 9223):

```bash
"<provisioned-electron-43-exe>" --remote-debugging-port=9223 spike/wcv-check.js
```

Then, from another shell: `curl -s http://127.0.0.1:9223/json` and record, for each target, its `type` and `url`. **Specifically record the `type` of the child WebContentsView target** (the current e2e matches by URL only; Task 2.6 adds a `type === 'page'` filter and must know whether the child is `page`/`iframe`/`other`).

Expected observations to record: `dom-ready` printed; `executeJavaScript` returned `toolbar`; both the `data:` toolbar page and the child `data:` view appear as CDP targets; the child renders visibly over the toolbar with the bottom 40px strip showing.

- [ ] **Step 3: Record compositing/focus/`data:`-URL findings**

In the harness window: click the child `<input>`, type, and confirm keystrokes land (focus transfers to the child). Confirm clicks on the child do not fall through to the toolbar. Confirm the child `data:` page ran its inline markup and accepted `executeJavaScript` (Chromium 150 has not blocked it). Append all of this to the findings note.

- [ ] **Step 4: Commit the findings update and delete the spike branch's throwaway code**

```bash
git add docs/superpowers/notes/electron-43-spike-findings.md
git commit -m "docs(spike): record WebContentsView + CDP target findings on Electron 43"
```

Cherry-pick / port the findings note onto the working branch; the `spike/*` scratch files and the `spike/electron-43` branch are discarded. **If any spike step revealed a hard incompatibility (e.g. `data:` URL script blocked, no proxy path, checksum unverifiable), STOP and revise the spec before Phase 1.**

---

## Phase 1 — Preparation (old Electron still installed; green on Node 22)

### Task 1.1: Node-version guard + `engines` floor

**Files:**
- Create: `src/utils/node-version-guard.js`
- Test: `tests/node-version-guard.test.js`
- Modify: `bin/amicus.js` (call the guard early), `package.json` (`engines.node`), `CLAUDE.md` (regen)

**Interfaces:**
- Produces: `checkNodeVersion(current, min)` → `{ ok: boolean, message: string|null }`; `MIN_NODE = '22.12.0'`.

- [ ] **Step 1: Write the failing test**

```js
// tests/node-version-guard.test.js
const { checkNodeVersion, MIN_NODE } = require('../src/utils/node-version-guard');

test('MIN_NODE is 22.12.0', () => {
  expect(MIN_NODE).toBe('22.12.0');
});
test('passes on the floor and above', () => {
  expect(checkNodeVersion('22.12.0', MIN_NODE).ok).toBe(true);
  expect(checkNodeVersion('24.5.0', MIN_NODE).ok).toBe(true);
});
test('fails below the floor with an actionable message', () => {
  const r = checkNodeVersion('20.11.0', MIN_NODE);
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/Node .*22\.12/);
  expect(r.message).toMatch(/20\.11\.0/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/node-version-guard.test.js`
Expected: FAIL — `Cannot find module '../src/utils/node-version-guard'`.

- [ ] **Step 3: Implement the guard**

```js
// src/utils/node-version-guard.js
'use strict';
const MIN_NODE = '22.12.0';

/** @param {string} current @param {string} min @returns {{ok:boolean,message:string|null}} */
function checkNodeVersion(current, min = MIN_NODE) {
  const c = current.replace(/^v/, '').split('.').map(Number);
  const m = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((c[i] || 0) > (m[i] || 0)) { return { ok: true, message: null }; }
    if ((c[i] || 0) < (m[i] || 0)) {
      return { ok: false, message: `Amicus 3.0 requires Node >=${min}; you are on ${current.replace(/^v/, '')}. Upgrade Node and retry.` };
    }
  }
  return { ok: true, message: null };
}
module.exports = { checkNodeVersion, MIN_NODE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/node-version-guard.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the guard into `bin/amicus.js`**

Near the top of `bin/amicus.js`, before any heavy imports, add:

```js
const { checkNodeVersion } = require('../src/utils/node-version-guard');
const _nv = checkNodeVersion(process.version);
if (!_nv.ok) { process.stderr.write(_nv.message + '\n'); process.exit(1); }
```

- [ ] **Step 6: Bump `engines.node` and regenerate docs**

Set `package.json` → `"engines": { "node": ">=22.12.0" }`. Then:

Run: `node scripts/generate-docs.js && npx jest tests/node-version-guard.test.js && npm run lint`
Expected: CLAUDE.md markers regenerate; test PASS; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/utils/node-version-guard.js tests/node-version-guard.test.js bin/amicus.js package.json CLAUDE.md
git commit -m "feat: add Node >=22.12 version guard and raise engines floor"
```

### Task 1.2: CI `node-version` matrices → 22/24

**Files:**
- Modify: every workflow under `.github/workflows/*.yml` that pins a Node version (`ci.yml`, `publish.yml`, and any others).

- [ ] **Step 1: Find every Node pin**

Run: `grep -rn "node-version" .github/workflows/`
Expected: a list of `node-version:` lines (setup-node steps, matrices).

- [ ] **Step 2: Replace with 22/24**

Change every `node-version:` value to `'22'` (single-version steps like the publish job) or a `[22, 24]` matrix (test legs). Remove any `18`/`20` matrix entries. The `npm publish` job must run on `22` (OIDC publishing needs npm ≥11.5, bundled with Node 22+).

- [ ] **Step 3: Verify no stale pins remain**

Run: `grep -rn "node-version" .github/workflows/ | grep -E "1[68]|20" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/
git commit -m "ci: raise node-version matrices to 22/24 for the Electron 43 upgrade"
```

### Task 1.3: Normalize hardcoded `28.x` version fixtures

**Files:**
- Modify: `tests/electron-install.test.js`, `tests/electron-self-heal-smoke.test.js`, `tests/electron-quarantine.test.js`, `tests/postinstall-provision-electron.test.js`, `docs/configuration.md:278`.

- [ ] **Step 1: Find every hardcoded version literal**

Run: `grep -rn "28\.0\.0\|28\.3\.3" tests/ docs/configuration.md`
Expected: the fixture lines, including `postinstall-provision-electron.test.js` asserting the exact string `for v28.0.0 (win32-x64)`.

- [ ] **Step 2: Replace `28.0.0`/`28.3.3` → `43.1.1`**

In the four test files, change the version literals to `43.1.1` (and the exact assertion to `for v43.1.1 (win32-x64)`). In `docs/configuration.md:278`, change the documented `electron` version to `^43.1.1`. Keep the *structure* of each fixture identical — only the version token changes (the zip-name pattern `electron-v43.1.1-...` still matches Task 0.1's recorded shape).

- [ ] **Step 3: Run the affected suites**

Run: `npx jest tests/electron-install.test.js tests/electron-self-heal-smoke.test.js tests/electron-quarantine.test.js tests/postinstall-provision-electron.test.js`
Expected: PASS (these are mock-based, so they pass with the old Electron still installed).

- [ ] **Step 4: Commit**

```bash
git add tests/electron-install.test.js tests/electron-self-heal-smoke.test.js tests/electron-quarantine.test.js tests/postinstall-provision-electron.test.js docs/configuration.md
git commit -m "test: normalize electron version fixtures 28.x -> 43.1.1"
```

### Task 1.4: Provisioning contract tests (non-mocked ESM import + integrity + proxy)

**Files:**
- Create: `tests/electron-get5-contract.integration.test.js`
- Consumes: the recorded facts in `docs/superpowers/notes/electron-43-spike-findings.md`.

**Interfaces:**
- These are the regression tests the real Task 2.1 implementation must satisfy. They assert *behavior the spike observed*, so they encode facts, not guesses.

- [ ] **Step 1: Write the contract test (skips until 5.x is installed)**

```js
// tests/electron-get5-contract.integration.test.js
// Guarded like the other real-network integration tests: only runs when
// @electron/get@5 is installed AND an explicit opt-in env is set (real download).
const hasGet5 = (() => {
  try { return require('@electron/get/package.json').version.startsWith('5'); }
  catch { return false; }
})();
const d = (hasGet5 && process.env.AMICUS_TEST_ELECTRON_DOWNLOAD) ? describe : describe.skip;

d('@electron/get 5.x provisioning contract', () => {
  jest.setTimeout(10 * 60 * 1000);

  test('dynamic import resolves downloadArtifact from CommonJS', async () => {
    const g = await import('@electron/get');
    expect(typeof g.downloadArtifact).toBe('function');
  });

  test('a corrupted cache entry is rejected, not trusted', async () => {
    // Per the spike: corrupt the cached zip, call downloadArtifact, expect a
    // checksum rejection rather than a returned tampered path.
    // (Fill the exact corruption + assertion from the spike-recorded behavior.)
  });
});
```

- [ ] **Step 2: Run it (expect skip until Phase 2 installs 5.x)**

Run: `npx jest tests/electron-get5-contract.integration.test.js --testMatch='**/tests/**/*.integration.test.js'`
Expected: the suite is **skipped** (5.x not installed yet). This is correct — the test exists now so Task 2.1 has a target; it activates in Phase 2.

- [ ] **Step 3: Commit**

```bash
git add tests/electron-get5-contract.integration.test.js
git commit -m "test: add @electron/get 5.x provisioning contract (skips until 5.x installed)"
```

---

## Phase 2 — Migration (flip pins; gated by CDP e2e + manual smoke)

### Task 2.1: Adapt the self-heal to `@electron/get` 5.x

**Files:**
- Modify: `src/sidecar/electron-install.js` (`:151-163`, `:217`), `package.json` (add `@electron/get` to `dependencies`), `src/sidecar/electron-cache.js` (only if the spike found a path mismatch), `CLAUDE.md` (regen).
- Consumes: `docs/superpowers/notes/electron-43-spike-findings.md` (timeout mechanism, proxy approach, checksum behavior, cache-root parity).
- Activates: `tests/electron-get5-contract.integration.test.js` (Task 1.4).

- [ ] **Step 1: Declare `@electron/get` in regular dependencies and install 5.x**

In `package.json`, add `"@electron/get": "^5.0.0"` under `dependencies` (NOT `optionalDependencies`).

Run: `npm install`
Expected: `@electron/get@5.x` resolves at the top level (`node -e "console.log(require('@electron/get/package.json').version)"` → `5.x`).

- [ ] **Step 2: Convert the `require` to a lazy dynamic import**

In `src/sidecar/electron-install.js`, replace `require('@electron/get')` (`:217`) with a lazy import inside the (already-async) download function:

```js
const { downloadArtifact } = await import('@electron/get');
```

Remove any top-of-file `require('@electron/get')`.

- [ ] **Step 3: Replace the got-style timeout and add the proxy approach**

Replace the dead `downloadOptions: { timeout: { socket, request } }` (`:162`) with the 5.x-native mechanism **recorded in the spike findings** (e.g. an `AbortSignal.timeout(ms)` or the documented 5.x option, or omission if 5.x's defaults are acceptable). Wire the proxy approach the spike selected (undici `ProxyAgent`/`global-agent` honoring `HTTPS_PROXY`/`NO_PROXY`, or the documented manual-install fallback). Do not invent an option shape — use the one the spike verified.

- [ ] **Step 4: Reconcile cache-path parity**

If the spike recorded a mismatch between 5.x's cache root and `src/sidecar/electron-cache.js:17-28`, update `electron-cache.js` to match 5.x's actual root. If the spike found parity, leave it and add a one-line comment citing the finding.

- [ ] **Step 5: Run the activated contract test (real download)**

Run: `AMICUS_TEST_ELECTRON_DOWNLOAD=1 npx jest tests/electron-get5-contract.integration.test.js --testMatch='**/tests/**/*.integration.test.js'`
Expected: PASS — dynamic import resolves `downloadArtifact`; corrupted-cache rejected.

- [ ] **Step 6: Regenerate docs and commit**

Run: `node scripts/generate-docs.js && npm run lint`

```bash
git add src/sidecar/electron-install.js src/sidecar/electron-cache.js package.json package-lock.json CLAUDE.md
git commit -m "feat: adapt electron self-heal to @electron/get 5.x (ESM import, native-fetch timeout, proxy)"
```

### Task 2.2: Pin Electron 43.1.1 and install it

**Files:**
- Modify: `package.json` (electron pin), `docs/configuration.md`.

- [ ] **Step 1: Set the pin to the security floor**

In `package.json`, change `optionalDependencies.electron` `^28.0.0` → `^43.1.1`.

- [ ] **Step 2: Install and verify the resolved version**

Run: `npm install --ignore-scripts && node -e "console.log(require('electron/package.json').version)"`
Expected: `43.1.1` (or a later `43.x`), never `43.0.0`.

- [ ] **Step 3: Provision the binary and confirm audit is clean**

Run: `node -e "require('./src/sidecar/electron-ensure').ensureElectron().then(()=>console.log('ok'))"` then `npm audit`
Expected: `ok`; `npm audit` reports 0 high (the ASAR finding is gone).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json docs/configuration.md
git commit -m "feat: pin electron ^43.1.1 (clears the ASAR Integrity Bypass audit finding)"
```

### Task 2.3: Migrate `main.js` BrowserView → WebContentsView

**Files:**
- Modify: `electron/main.js` (`:15`, `:163`, `:223`, `:240`, `:360-361`, teardown), plus any grep hits in `electron/close-guard.js`, `electron/fold.js`, `electron/ipc-guard.js`.
- Consumes: the WebContentsView + CDP findings from Task 0.2.

**Interfaces:**
- The content view variable is renamed `contentView` → `opencodeView` throughout `main.js` to disambiguate from Electron's `mainWindow.contentView` (the window root).

- [ ] **Step 1: Grep the whole `electron/` dir for BrowserView API usage**

Run: `grep -rn "BrowserView\|addBrowserView\|removeBrowserView\|getBrowserView\|setBrowserView\|hostWebContents" electron/`
Expected: enumerate every hit. The inventory predicts `main.js` only — **treat any hit in `close-guard.js`/`fold.js`/`ipc-guard.js` as a required migration site**, not an assumption.

- [ ] **Step 2: Swap the import and constructor**

In `electron/main.js`: change `BrowserView` in the `require('electron')` destructure (`:15`) to `WebContentsView`. Change `:163` from `const contentView = new BrowserView({ webPreferences })` to:

```js
const opencodeView = new WebContentsView({
  webPreferences: { ...existingWebPreferences, contextIsolation: true, nodeIntegration: false, sandbox: true }
});
```

(Set the three flags **explicitly** rather than relying on defaults.)

- [ ] **Step 3: Swap attach/detach/bounds to the root contentView**

- `mainWindow.addBrowserView(contentView)` (`:223`, `:240`) → `mainWindow.contentView.addChildView(opencodeView)`
- any `mainWindow.removeBrowserView(...)` → `mainWindow.contentView.removeChildView(opencodeView)`
- `contentView.setBounds(...)` / `contentView.webContents.*` / the `will-navigate` handler (`:173`) / `insertCSS` (`:194`) → all rename `contentView` to `opencodeView`; the `getContentSize()` bounds math (`:360-361`) is unchanged.

Migrate any hits found in Step 1's other files the same way.

- [ ] **Step 4: Launch and verify under CDP (this is the test for a GUI change)**

Run: `AMICUS_DEBUG_PORT=9223 node bin/amicus.js start --model deepseek --no-ui=false --prompt "say hi"` (or the project's standard interactive launch), then use `tests/helpers/cdp-client.js` to confirm the content view renders and the toolbar strip shows.
Expected: window renders with the OpenCode content over the toolbar; no blank/invisible window; `curl -s http://127.0.0.1:9223/json` lists both targets. If the window is invisible, `electron/load-failsafe.js` should surface an error page — investigate before proceeding.

- [ ] **Step 5: Regenerate docs and commit**

Run: `node scripts/generate-docs.js && npm run lint`

```bash
git add electron/main.js electron/close-guard.js electron/fold.js electron/ipc-guard.js CLAUDE.md
git commit -m "feat: migrate content view from BrowserView to WebContentsView"
```

### Task 2.4: Compositing / focus / hit-testing verification

**Files:**
- Modify: `electron/main.js` only if a defect is found (e.g. add `opencodeView.setBackgroundColor(...)`).

- [ ] **Step 1: Drive the interactive window and assert the five compositing checks**

With the window from Task 2.3 open, verify via CDP + visual check: (i) content view fills on window resize (`setBounds` coordinate system correct); (ii) z-order — content renders over the toolbar; (iii) no color flash/transparency leak (else set `opencodeView.setBackgroundColor` to the prior BrowserView value); (iv) clicks on content don't fall through to the toolbar; (v) clicking content transfers focus so keyboard input reaches the OpenCode renderer, and the toolbar's `executeJavaScript` polling still runs.
Expected: all five hold. Record any fix applied.

- [ ] **Step 2: Commit (only if a fix was applied)**

```bash
git add electron/main.js
git commit -m "fix: preserve content-view compositing under WebContentsView"
```

### Task 2.5: Preload / sandbox audit (Area C)

**Files:**
- Modify: `electron/main.js` (per-window `sandbox` flags), and either `electron/preload-setup.js` + an `ipcMain.handle` in `electron/ipc-setup.js` (option b) or just the setup window's `sandbox:false` (option a).

- [ ] **Step 1: Set `sandbox` explicitly per window**

In `electron/main.js`, set `sandbox: true` on the toolbar and content windows' `webPreferences` (their preloads use only `contextBridge`/`ipcRenderer`).

- [ ] **Step 2: Resolve the setup/settings window's `shell` usage**

`electron/preload-setup.js:9,35` uses `shell.openExternal` **directly in the preload** (sandbox-incompatible). Choose one:
- **(a, minimal)** set `sandbox: false` explicitly on the setup + settings windows and add a comment explaining why (`shell` in the preload).
- **(b, preferred)** move `shell.openExternal` to the main process behind an `ipcMain.handle('setup:open-external', (e,url)=>shell.openExternal(url))` (validating `https://` as today), drop `shell` from the preload, and set `sandbox: true`.

- [ ] **Step 3: Verify the setup wizard still opens external links**

Launch the setup wizard (`node bin/amicus.js setup`), trigger an external link, and confirm it opens.
Expected: link opens; wizard renders and functions.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload-setup.js electron/ipc-setup.js
git commit -m "fix: set explicit per-window sandbox; resolve preload-setup shell usage"
```

### Task 2.6: CDP harness hardening + AV + globalShortcut

**Files:**
- Modify: `tests/helpers/cdp-client.js` (`:161`, `:181`).
- Add coverage: the AV acceptance case + globalShortcut assertions run in the manual/CDP smoke (Task 2.8), documented here.

- [ ] **Step 1: Add the `type === 'page'` filter**

In `tests/helpers/cdp-client.js`, change the target matchers (`:161`, `:181`) to also require `target.type === 'page'` — using the **actual type the child WebContentsView enumerates as**, per Task 0.2's recording (if the spike found it is not `page`, use that value and note it).

- [ ] **Step 2: Run the e2e suite**

Run: `npx jest --testPathIgnorePatterns="\.worktrees/" --testMatch="**/tests/**/*.integration.test.js" electron-toolbar-e2e`
Expected: PASS — targets still resolve; no false-match on background targets.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/cdp-client.js
git commit -m "test: filter CDP targets by type to survive Chromium 150 background targets"
```

### Task 2.7: Area E — `data:`-URL + CDP behavioral checks

- [ ] **Step 1: Confirm the toolbar/setup `data:` pages still load and script on Chromium 150**

Using the running window, confirm the `data:text/html` toolbar loads, runs its inline JS, and accepts `executeJavaScript` (already observed in Task 0.2; re-confirm in the real app). Confirm `cdp-client.js`'s hand-built WS path (`:52`) connects against Electron 43's Chromium.
Expected: both hold (Task 0.2 recorded this; this step confirms it in-app). If `data:` scripting is restricted, escalate — it would affect the toolbar polling model.

### Task 2.8: Verification bar, release notes, 3.0.0 cut

**Files:**
- Modify: `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `server.json`, `README.md` + `docs/usage.md` (`status --json` version examples, per the `docs/publishing.md` checklist).

- [ ] **Step 1: Full suite + audit on Node 22+**

Run: `node --version && npm run test:all && npm audit`
Expected: Node ≥22.12; full suite green; `npm audit` 0 high.

- [ ] **Step 2: Manual interactive smoke**

Drive: `amicus start` window renders → fold works → model switcher works → `amicus setup` wizard incl. searchable picker works. Include the **AV acceptance case** (provision 43.1.1 from an empty cache, launch, exercise `electron-quarantine.js`) and the **globalShortcut** checks (registration return values; shortcut works after focus moves to the child view and back).
Expected: all pass; quarantine path gives actionable output; shortcuts register and fire.

- [ ] **Step 3: Write release notes and bump versions in lockstep**

Update `CHANGELOG.md` (Unreleased → 3.0.0) leading with the **Node ≥22.12 floor drop** and the Win 8/macOS 11 OS-support drop. Bump `package.json` → `3.0.0`, then `.claude-plugin/plugin.json`, `server.json` (`.version` + `.packages[0].version`), and the `status --json` example versions in `README.md` + `docs/usage.md` — all to `3.0.0` (the `docs/publishing.md` checklist, step 4).

- [ ] **Step 4: Commit the release**

```bash
git add CHANGELOG.md package.json package-lock.json .claude-plugin/plugin.json server.json README.md docs/usage.md
git commit -m "chore(release): v3.0.0 — Electron 43 + WebContentsView + Node 22 floor"
```

- [ ] **Step 5: Tag and push (only after Steps 1–2 are green)**

```bash
git tag v3.0.0 && git push origin main --follow-tags
```

Expected: `publish.yml` runs on Node 22, publishes 3.0.0, syncs the MCP registry, cuts the GitHub release.

---

## Self-Review

**Spec coverage** (each spec section → task):
- §1a security scope → Task 0.1 (checksum/integrity spike) + §1a is documented; download-integrity as the real boundary → Task 0.1 Step 4, Task 1.4.
- §4 Node floor + guard + CI → Tasks 1.1, 1.2.
- §5 Area A view migration + grep + compositing → Tasks 0.2, 2.3, 2.4.
- §5 Area B provisioning (ESM, timeout, cache parity, integrity, proxy, v42) → Tasks 0.1, 1.4, 2.1.
- §5 Area C preload/sandbox → Task 2.5.
- §5 Area D pins/fixtures/CDP/greps → Tasks 1.3, 2.2, 2.6.
- §5 Area E Chromium delta → Tasks 0.2, 2.7.
- §6 verification bar (+ AV, globalShortcut, Node guard, non-mocked import) → Tasks 1.1, 1.4, 2.6, 2.8.
- §7 sequencing (spike B-then-A; two-phase) → Phase 0 order; Phase 1 / Phase 2 split.
- §9 out of scope → not tasked (correct).

**Placeholder scan:** the spike-dependent specifics in Tasks 2.1/2.6 explicitly reference *recorded* Task 0.1/0.2 findings rather than inventing an API shape — this is deliberate (the spec defers those to the spike) and each cite names the exact finding to plug in. No `TBD`/`add error handling`/`similar to Task N` remain.

**Type consistency:** `checkNodeVersion`/`MIN_NODE` consistent (1.1). The content-view variable is `opencodeView` consistently in Task 2.3 (renamed from `contentView`). `AMICUS_TEST_ELECTRON_DOWNLOAD` guard consistent between 1.4 and 2.1. `downloadArtifact` referenced consistently (0.1, 1.4, 2.1).
