# Electron 28 → 43 Upgrade + WebContentsView Migration — Design

_Status: design (brainstormed 2026-07-14). Origin: issue #17 (the remaining high-severity
`npm audit` item). Reviewed by DeepSeek (headless Plan pass) with findings verified against the
live npm registry before adoption._

## 1. Intent

Upgrade Amicus's Electron from **28.3.3 → 43.1.1** to clear the outstanding high-severity
`npm audit` finding (**ASAR Integrity Bypass**, GHSA-vmqv-hx8q-j7mg), and — in the same
milestone — **migrate the content layer off the deprecated `BrowserView` API to
`WebContentsView`**. Electron has no LTS (only the newest 3 majors are supported; 28 is long
past EOL), so the target is the newest stable and what `npm audit` itself recommends.

This is a **major release (3.0.0)**: the upgrade forces `engines.node` from `>=18` to
`>=22.12` (see §4), which is a breaking change for Amicus's install base regardless of the
optional-dependency framing.

## 2. Decisions already made (do not re-litigate without a hard blocker)

| Decision | Value | Why |
|---|---|---|
| Target Electron | **43.1.1** | Latest stable; what `npm audit` recommends; in the 41/42/43 support window |
| BrowserView | **Migrate to WebContentsView** now | Already doing full GUI verification; clears the deprecation in one cycle instead of two |
| Node floor | **Raise whole package to `>=22.12.0`** | `@electron/get@5` (required by electron 43) needs Node `>=22.12`; chosen over lazy-gating for honesty/simplicity |
| Version | **3.0.0 (major)** | Raising the Node floor drops Node 18/20 users — a breaking change |
| `data:`-URL toolbar IPC | **Leave as-is** (out of scope) | The `executeJavaScript`-polling workaround works; migrating it to real IPC widens the blast radius (see §9) |

## 3. The review that shaped this design

DeepSeek reviewed the draft design headless (Plan agent) after two transport failures (a
narration stub, then a tool-call stall — both known DeepSeek quirks; the third run, fully
self-contained with a no-tools preamble, succeeded). Its findings were **verified before
adoption**, not taken on faith:

**Confirmed by verification (`npm view @electron/get@5`):** `@electron/get@5.0.0` is
`"type": "module"` (**ESM-only**), `engines.node >= 22.12.0`, and has **dropped `got`**
(2.x used `got ^11.8.5`; 5.x uses native `fetch`). These drive Area B and the version bump.

**Adopted (cheap + correct):** full-`electron/`-grep for BrowserView APIs (not just `main.js`);
`type === 'page'` filter on the CDP target matchers; preload sandbox-safety audit; content-view
`setBackgroundColor`/CSS-occlusion check; OS-deprecation release note; `shell.openItem` +
preload-clipboard greps.

**Refuted / downgraded (verified against the code inventory):** the `will-navigate`
"only-on-toolbar" finding is backwards — it is already on `contentView.webContents`
(`main.js:173`); the sandbox-flip *mechanism* is wrong (sandbox has defaulted `true` since
Electron 20, so preloads that work on 28 are already sandbox-proven — the audit is still worth
doing, the "blocker" framing is not); the extraction "race" is a documentation item, not a
blocker.

## 4. The Node floor + version (headline change)

`@electron/get@5` requires Node `>=22.12.0`. Amicus declares `engines.node: ">=18.0.0"`
(`package.json`). Because the electron self-heal (`src/sidecar/electron-install.js`) imports
`@electron/get`, the effective floor rises to 22.12.

**Decision:** raise `engines.node` to `>=22.12.0` for the whole package and ship **3.0.0**.
Consequences to encode:
- `package.json` `engines.node` → `>=22.12.0`.
- Release notes call out the Node-18/20 drop explicitly as the headline breaking change.
- CI matrix (if any Node <22 leg exists) updated to 22/24.

## 5. Work areas

### Area A — View migration (`electron/main.js` + verified-clean rest of `electron/`)

Swaps (mechanics confirmed against Electron's migration guide):
- `new BrowserView({webPreferences})` → `new WebContentsView({webPreferences})` (`main.js:163`)
- `mainWindow.addBrowserView(contentView)` → `mainWindow.contentView.addChildView(contentView)` (`main.js:223,240`)
- Any `removeBrowserView`/`getBrowserView`/`setBrowserView` → `contentView.removeChildView` / child-view equivalents
- `contentView.setBounds(...)`, `contentView.webContents.*`, `will-navigate` (`main.js:173`, already on the content view), `setWindowOpenHandler` (`main.js:179`), `insertCSS` on `dom-ready` (`main.js:194`), `render-process-gone` (`main.js:349`) — carry over unchanged.

Additions from the review:
- **Grep all of `electron/` for `BrowserView`, `addBrowserView`, `removeBrowserView`,
  `getBrowserView(s)`, `setBrowserView`, `.hostWebContents`** and migrate every hit. The code
  inventory says `main.js` is the only site, but this grep is a required gate, not an
  assumption — `close-guard.js`, `fold.js`, `ipc-guard.js` are the specific files to re-check
  since they touch window/webContents lifecycle.
- **Compositing check:** with `addChildView`, the content view is part of the window's
  contentView tree rather than an always-on-top overlay. Verify the toolbar page's injected CSS
  sets no opaque `background`/`z-index` on `body`/`html` that could occlude the child view; set
  `contentView.setBackgroundColor(...)` explicitly if needed. This is verified by the manual +
  CDP visual gate.

### Area B — Provisioning adaptation (`@electron/get` 2.x → 5.x)

`src/sidecar/electron-install.js` calls `@electron/get` directly but the package is undeclared
(relies on the hoisted 2.0.3). Work items:
1. **Declare `@electron/get` as a direct `optionalDependency` pinned `^5.0.0`** so its version
   is controlled and matches what electron 43 expects.
2. **ESM interop:** `require('@electron/get')` (`electron-install.js:217`) throws
   `ERR_REQUIRE_ESM` against the ESM-only 5.x. Convert to a lazy
   `const { downloadArtifact } = await import('@electron/get')` inside the (already-async)
   download function. Precedent: the OpenCode SDK and `update-notifier` are already consumed via
   dynamic `import()` from this CommonJS codebase (see CLAUDE.md "Critical Gotchas: ESM").
3. **Timeout option:** the `got`-style `downloadOptions.timeout: { socket, request }`
   (`electron-install.js:162`) is dead against 5.x (native `fetch`). Replace with a 5.x-native
   timeout (AbortSignal-based) or drop the custom timeout and rely on `@electron/get` defaults —
   decide during implementation by reading 5.x's options type.
4. **Cache-path parity:** `@electron/get@5` depends on `env-paths ^3.0.0`. `electron-cache.js`
   hardcodes the path shape `env-paths('electron')` produced under the 2.x line. Verify 5.x's
   actual download/cache root still matches `electron-cache.js:17-28`; a mismatch causes silent
   cache misses / re-downloads, not a crash.
5. **Zip name + extraction handoff:** re-verify the hardcoded
   `electron-v${version}-${platform}-${arch}.zip` pattern (`electron-install.js:102`) against
   5.x; document whether Amicus trusts `downloadArtifact`'s own extraction or re-extracts via
   `unzip.js` (the `robustExtract` Node-24 `extract-zip@2.0.1` stall workaround at
   `unzip.js:5-11` — confirm it's still reachable/needed, or prune it).
6. **v42 no-op confirmation:** the electron-npm-package "downloads on first-run not postinstall"
   change (v42) should be inert for Amicus, which provisions lazily via `ensureElectron()` and
   installs electron `--ignore-scripts`. Confirm against `scripts/postinstall.js`
   `provisionElectron()` / `repairElectron({cacheOnly:true})`.

### Area C — Preload / sandbox audit (`electron/preload*.js`)

Read `preload.js`, `preload-content.js`, `preload-setup.js`. Confirm each uses only
sandbox-safe surface (`contextBridge`, `ipcRenderer`, `require('electron')` subset). Special
attention to `preload-setup.js`'s `shell.openExternal` — `shell` is not in the sandboxed-preload
allowlist, so if it works on 28 it implies these windows aren't effectively sandboxed; settle
and document the actual sandbox state, and set `sandbox` explicitly (true or false) on all four
`webPreferences` blocks rather than leaving it to the default.

### Area D — Version pins, fixtures, CDP hardening

- `package.json`: electron optionalDependency `^28.0.0` → `^43.0.0` (pin 43.1.1 acceptable);
  add `@electron/get ^5.0.0`; `engines.node >= 22.12.0`. Update `package-lock.json`,
  `docs/configuration.md:278`.
- Test fixtures hardcoding `28.0.0`/`28.3.3`: `tests/electron-install.test.js`,
  `electron-self-heal-smoke.test.js`, `electron-quarantine.test.js`,
  `postinstall-provision-electron.test.js` (the last asserts the exact string
  `"for v28.0.0 (win32-x64)"` → `"for v43.1.1 (win32-x64)"`).
- CDP e2e (`tests/helpers/cdp-client.js`): add `target.type === 'page'` to the `data:` and
  `http://localhost` target matchers (`:161,:181`) so new Chromium-132 background targets
  (service workers, etc.) can't false-match; keep the hand-built WS path (`:52`) but add
  debug logging of enumerated targets.
- **Cheap greps:** `shell.openItem` (removed v29) and any `clipboard` exposure in preloads.

## 6. Verification bar ("done when")

In order:
1. Full unit suite green (with the updated fixtures).
2. CDP e2e (`electron-toolbar-e2e`) green — watch that `data:`/`localhost` target enumeration
   still resolves post-migration.
3. **Manual interactive smoke** on this Windows machine (CDP-scriptable): `amicus start` window
   renders, fold works, model switcher works, setup wizard incl. searchable picker works.
4. `npm audit` clean (0 high).
5. Run the above on **Node 22+** explicitly (the new floor).

## 7. Sequencing

1. **Research spike first (smallest safe step):** a throwaway branch that installs electron 43 +
   `@electron/get 5`, converts the one `require` to `await import`, and confirms (a) the lazy
   import loads in the CJS self-heal, (b) a real `downloadArtifact` succeeds on this machine, and
   (c) the cache root matches. This de-risks Area B before any GUI work. If the spike surfaces a
   hard incompatibility, revisit the target here rather than mid-migration.
2. Area A view migration + the `electron/` grep, verified by CDP e2e + manual smoke.
3. Area C preload/sandbox audit (can parallel A).
4. Area D pins/fixtures/CDP hardening.
5. Full verification bar → release notes → 3.0.0 cut.

## 8. Risks

- **WebContentsView compositing/resize/z-order** differing subtly (flicker, wrong bounds,
  reintroducing the historical invisible-hang) — mitigated by the existing
  `electron/load-failsafe.js` and the CDP + manual visual gate.
- **`@electron/get@5` native-fetch behavior** (timeouts, progress, error shapes) differing from
  `got` — surfaced by the spike.
- **`env-paths 3.x` cache-path drift** — silent re-downloads if `electron-cache.js` disagrees
  with 5.x's root.
- **ESM dynamic-import in the CJS self-heal** — must be exercised by a real (not mocked)
  load in the spike/tests.

## 9. Out of scope (considered, declined)

- **Migrating the toolbar/setup/settings windows off the `data:`-URL + `executeJavaScript`
  polling model to real IPC.** WebContentsView could enable it, but the polling model works and
  touching it widens the blast radius. Track separately if desired.
- **Incremental 28 → 30 → 43 staging.** Considered (DeepSeek Q5); rejected for an app with a
  small, well-inventoried Electron surface — a direct jump with the spike + full verification bar
  is lower total cost than two migration/verification cycles.

## 10. Open questions

None blocking. The spike (§7.1) resolves the two residual empirical unknowns (native-fetch
timeout shape, cache-path parity) before they can affect the migration.

## 11. Implementation surface

- `electron/main.js` (view migration), plus grep-verified `electron/close-guard.js`,
  `fold.js`, `ipc-guard.js`, `preload*.js`.
- `src/sidecar/electron-install.js` (ESM import, timeout, `@electron/get` 5.x), `electron-cache.js`
  (path parity), `unzip.js` (stale-workaround check), `scripts/postinstall.js` (v42 no-op).
- `package.json`, `package-lock.json`, `docs/configuration.md`.
- `tests/electron-install.test.js`, `electron-self-heal-smoke.test.js`,
  `electron-quarantine.test.js`, `postinstall-provision-electron.test.js`,
  `tests/helpers/cdp-client.js`.
