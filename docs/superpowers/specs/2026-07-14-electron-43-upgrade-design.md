# Electron 28 → 43 Upgrade + WebContentsView Migration — Design

_Status: design (brainstormed 2026-07-14). Origin: issue #17 (the remaining high-severity
`npm audit` item). Reviewed by DeepSeek (draft), GLM (revision 2), and GPT-5.6 Terra Pro
(revision 3), headless Plan/Build passes; all findings verified against the live npm registry,
the Electron release notes, and the actual code before adoption._

## 1. Intent

Upgrade Amicus's Electron from **28.3.3 → 43.1.1** to clear the outstanding high-severity
`npm audit` finding (**ASAR Integrity Bypass**, GHSA-vmqv-hx8q-j7mg), and — in the same
milestone — **migrate the content layer off the deprecated `BrowserView` API to
`WebContentsView`**. Electron has no LTS (only the newest 3 majors are supported; 28 is long
past EOL), so the target is the newest stable and what `npm audit` itself recommends.

This is a **major release (3.0.0)**: the upgrade forces `engines.node` from `>=18` to
`>=22.12` (see §4), a breaking change for the install base regardless of the optional-dependency
framing.

## 1a. Security scope — what the upgrade actually fixes (verified)

The ASAR Integrity Bypass advisory applies to **packaged** Electron apps (an `app.asar` whose
integrity is validated via the `EnableEmbeddedAsarIntegrityValidation` fuse + code-signing).
**Amicus ships none of that:** verified there is no `asar`, `electron-builder`,
`electron-forge`, `@electron/packager`, `@electron/osx-sign`, `@electron/fuses`, code-signing,
or `build` field anywhere in the repo. Amicus downloads a **stock Electron binary** at runtime
and runs `electron/main.js` unpackaged from `node_modules`.

Therefore:
- The ASAR-integrity attack class is **structurally inapplicable** to Amicus's deployment model
  (there is no packaged asar to tamper with).
- The upgrade's concrete effect is **clearing the `npm audit` report and staying on a supported
  Electron line** — not closing a live exploit against users.
- **No fuse activation or code-signing work stream is required** (it would be a no-op here).
  Explicitly ruled in, so the plan doesn't over-invest chasing a packaged-app control that
  Amicus's architecture never exposes.

**But executable integrity is not irrelevant — it moves to the download path** (GPT #4). Amicus
downloads and executes a stock Electron binary outside npm's normal extraction, caches it, and
can re-fetch it via `repairElectron`. The real integrity concern is therefore **download
provenance and cache integrity**, not the ASAR bypass: checksum enforcement, corrupted-cache
rejection, mirror trust, and `force:true` not bypassing validation. This is verified in the
spike (§7) — it is the honest replacement for the ASAR control, not an absence of one.

This section exists because "the upgrade clears the vuln" was an unverified mechanism claim in
the draft (GLM finding #1); the integrity-moves-to-download nuance is GPT finding #4.

## 2. Decisions already made (do not re-litigate without a hard blocker)

| Decision | Value | Why |
|---|---|---|
| Target Electron | **43.1.1** | Latest stable; what `npm audit` recommends; in the 41/42/43 support window |
| BrowserView | **Migrate to WebContentsView** now | Already doing full GUI verification; clears the deprecation in one cycle instead of two |
| Node floor | **Raise whole package to `>=22.12.0`** | `@electron/get@5` (required by electron 43) needs Node `>=22.12`; chosen over lazy-gating for honesty/simplicity (§4) |
| Version | **3.0.0 (major)** | Raising the Node floor drops Node 18/20 users — a breaking change |
| `data:`-URL toolbar IPC | **Leave as-is** (out of scope) | The `executeJavaScript`-polling workaround works; migrating it to real IPC widens the blast radius (§9) |

## 3. The reviews that shaped this design

Two single-model reviews (DeepSeek on the draft, GLM on this spec), findings **verified before
adoption**, not taken on faith.

**Confirmed by verification (`npm view @electron/get@5`):** `@electron/get@5.0.0` is
`"type": "module"` (**ESM-only**), `engines.node >= 22.12.0`, and has **dropped `got`**
(2.x used `got ^11.8.5`; 5.x uses native `fetch`). These drive Area B and the version bump.

**Confirmed by verification (repo grep):** Amicus is unpackaged (§1a). And `preload-setup.js`
requires + calls `shell` **directly** (`:9`, `:35`) — sandbox-incompatible; reshapes Area C.

**Refuted / corrected against the code:** DeepSeek's `will-navigate` "only-on-toolbar" finding
is backwards — it is already on `contentView.webContents` (`main.js:173`). DeepSeek's
sandbox-flip *mechanism* is wrong (sandbox has defaulted `true` since Electron 20). GLM's
"set `sandbox: true` on all four windows" is wrong for the setup window specifically, because its
preload uses `shell` (see Area C). The nuance the reviews missed: preloads are sandbox-proven
only because they use **sandbox-safe APIs** (`contextBridge`/`ipcRenderer`) — and
`preload-setup.js` is the exception that breaks that assumption.

## 4. The Node floor + version (headline change)

`@electron/get@5` requires Node `>=22.12.0`. Amicus declares `engines.node: ">=18.0.0"`. Because
the electron self-heal (`src/sidecar/electron-install.js`) imports `@electron/get`, the effective
floor rises to 22.12.

**Decision:** raise `engines.node` to `>=22.12.0` for the whole package and ship **3.0.0**.

**Acknowledged tradeoff (GLM #6):** headless-only users on Node 18/20 — who run the CLI/council
and **never import `@electron/get`** — are broken by this bump despite gaining nothing from it.
Accepted for a 3.0.0 major in exchange for a single honest engine declaration and no
version-gating code. **Migration path:** those users upgrade Node to ≥22.12. The lazy-gate
alternative (keep floor low, guard the GUI self-heal on Node ≥22 with a clear error) was
considered and rejected for simplicity; revisit only if headless-on-old-Node turns out to be a
common configuration.

Encode: `package.json` `engines.node` → `>=22.12.0`; **an explicit early Node-version guard**
(§6, GPT #9) since `engines` is advisory; release notes lead with the Node-18/20 drop;
**CI workflows** — update every `node-version` matrix and the `npm publish` job's Node to 22/24
(`.github/workflows/*`).

## 5. Work areas

### Area A — View migration + compositing (`electron/main.js` + verified-clean rest of `electron/`)

**A.1 API swaps** (mechanics confirmed against Electron's migration guide):
- `new BrowserView({webPreferences})` → `new WebContentsView({webPreferences})` (`main.js:163`)
- **Rename the child variable** from `contentView` to `opencodeView` (GPT #1): the current code
  names the child view `contentView`, which collides with Electron's `mainWindow.contentView`
  (the window's *root* view). The receiver of `addChildView` is the root, the argument is the
  child — the collision makes the call dangerously ambiguous. After renaming:
  `mainWindow.addBrowserView(contentView)` → `mainWindow.contentView.addChildView(opencodeView)`
  (`main.js:223,240`).
- Removal is `mainWindow.contentView.removeChildView(opencodeView)`. **There is no
  `setBrowserView` equivalent** — WebContentsView is add/remove, not swap-in-place; grep
  `main.js` for `setBrowserView`/`getBrowserView(s)`/`.hostWebContents` and handle each
  explicitly. The corrected receiver + rename is a **spike assertion**, not just a grep item.
- `contentView.setBounds(...)`, `contentView.webContents.*`, `will-navigate` (`main.js:173`,
  already on the content view), `setWindowOpenHandler` (`main.js:179`), `insertCSS` on
  `dom-ready` (`main.js:194`), `render-process-gone` (`main.js:349`) — expected to carry over;
  **each verified in the spike (§7) and by the e2e/manual gate, not assumed.**
- **Set `contextIsolation`/`nodeIntegration`/`sandbox` explicitly** in the new `WebContentsView`
  constructor rather than relying on defaults matching BrowserView's.

**A.2 Full-`electron/` grep (required gate, not an assumption):** grep the whole `electron/`
dir for `BrowserView`, `addBrowserView`, `removeBrowserView`, `getBrowserView(s)`,
`setBrowserView`, `.hostWebContents`. The inventory says `main.js` is the only site, but
re-check `close-guard.js`, `fold.js`, `ipc-guard.js` (window/webContents lifecycle) by grep.

**A.3 Compositing / focus / hit-testing (first-class — GLM #2, #5, #12).** BrowserView was an
always-on-top overlay; a child WebContentsView participates in the window's contentView tree
alongside the toolbar page. Verify, in the spike and the manual gate:
- **setBounds coordinate system** — confirm child-view bounds are window/parent-relative as the
  current math assumes (`main.js:360-361` uses `getContentSize()`).
- **Resize propagation** — the content view still fills correctly on window resize.
- **Z-order** — the child view renders *over* the toolbar page (not occluded); set
  `contentView.setBackgroundColor(...)` if a transparency/flash artifact appears.
- **Hit-testing** — clicks on the content view don't fall through to the toolbar page.
- **Focus/keyboard** — clicking the content view transfers focus so keyboard input reaches the
  OpenCode renderer; and the toolbar's `executeJavaScript` polling still runs regardless of which
  view holds focus.

### Area B — Provisioning adaptation (`@electron/get` 2.x → 5.x)

`src/sidecar/electron-install.js` calls `@electron/get` directly but the package is undeclared
(relies on the hoisted 2.0.3). Work items:
1. **Declare `@electron/get` in regular `dependencies` (not optional), pinned `^5.0.0`** (GPT #3).
   It is *required at runtime whenever the self-heal runs* — making it optional would turn a
   recoverable "electron missing" into an unrecoverable "downloader missing too," and it also
   fixes a latent fragility (today `@electron/get` is only present because it's hoisted from the
   optional `electron`'s own tree, so `--omit=optional` breaks the self-heal). The package is
   small pure-JS, so headless users pay ~nothing. (If a headless install footprint concern
   surfaces, the fallback is optional + a deterministic import-failure remediation message —
   test both.)
2. **ESM interop:** `require('@electron/get')` (`electron-install.js:217`) throws
   `ERR_REQUIRE_ESM` against ESM-only 5.x. Convert to a lazy
   `const { downloadArtifact } = await import('@electron/get')` inside the (already-async)
   download function. Precedent: OpenCode SDK + `update-notifier` are consumed via dynamic
   `import()` from this CommonJS codebase (CLAUDE.md "Critical Gotchas: ESM"). **Exercise the
   real code path with a non-mocked load** (§6, §7) — unit mocks hide `ERR_REQUIRE_ESM`.
3. **Timeout option:** the `got`-style `downloadOptions.timeout: { socket, request }`
   (`electron-install.js:162`) is dead against native-`fetch` 5.x. Replace with a 5.x-native
   timeout (AbortSignal) or drop it and use `@electron/get` defaults — decide by reading 5.x's
   options type during the spike.
4. **Cache-path parity:** `@electron/get@5` depends on `env-paths ^3.0.0`. `electron-cache.js`
   hardcodes the path shape 2.x's `env-paths('electron')` produced. Verify 5.x's actual
   download/cache root still matches (`electron-cache.js:17-28`); a mismatch causes silent cache
   misses / re-downloads, not a crash. (Verify on macOS too if a mac contributor is available —
   GLM #9.)
5. **Zip name + extraction handoff:** re-verify `electron-v${version}-${platform}-${arch}.zip`
   (`electron-install.js:102`); document whether Amicus trusts `downloadArtifact`'s own
   extraction or re-extracts via `unzip.js` (confirm the Node-24 `extract-zip@2.0.1` stall
   workaround at `unzip.js:5-11` is still reachable/needed, or prune it).
6. **Download integrity (GPT #4):** `@electron/get@5` bundles `sumchecker`. During the spike,
   verify — not just "download succeeds" — that: the ZIP is checksum-verified by 5.x's
   `downloadArtifact` (know the checksum source + failure behavior); a deliberately corrupted
   cache entry is *rejected*, not extracted/executed; `force:true` re-download does **not** bypass
   integrity; a configured mirror/custom artifact URL still validates the checksum; and the exe
   selected after extraction is the expected one, not merely an existing path.
7. **Proxy behavior (GPT #5):** dropping `got` for native `fetch` drops `got`'s `HTTPS_PROXY` /
   `HTTP_PROXY` / `NO_PROXY` / proxy-auth / custom-CA handling. This path is an Electron
   bootstrap/repair often run on **managed corporate Windows networks** — a direct-internet
   download succeeding does not prove proxied installs work. Inventory the proxy/mirror config
   the downloader accepts today; determine 5.x's behavior under Node ≥22; then either preserve
   proxy support via a 5.x-supported mechanism (an undici dispatcher / `global-agent`, incl.
   authenticated proxies + `NO_PROXY`) or explicitly document unsupported proxy environments with
   a manual Electron-install fallback. Add a proxy/dispatcher test — "successful direct download"
   is insufficient.
8. **v42 no-op confirmation:** the "downloads on first-run not postinstall" change (v42) should be
   inert (Amicus provisions lazily, installs electron `--ignore-scripts`). Confirm against
   `scripts/postinstall.js` `provisionElectron()` / `repairElectron({cacheOnly:true})`.

### Area C — Preload / sandbox audit (`electron/preload*.js`) — reshaped by verification

**Verified finding:** `preload-setup.js:9` destructures `shell` from `require('electron')` and
`:35` calls `shell.openExternal` **inside the preload**. `shell` is **not** in the sandboxed-
preload allowlist, so this window cannot be sandboxed as written. `preload.js` and
`preload-content.js` use only sandbox-safe surface (`contextBridge`/`ipcRenderer`, or nothing).

Work items:
- Determine the **actual current sandbox state** of each of the four windows (the inventory says
  "sandbox unset" but `preload-setup.js` using `shell` implies the setup/settings window is not
  effectively sandboxed today — resolve and document).
- **Do NOT blanket-set `sandbox: true`** (would break `shell.openExternal`). Instead, per window:
  set `sandbox` **explicitly** to document intent — `true` for the toolbar + content windows
  (sandbox-safe preloads), and for the setup/settings window either **(a)** keep `sandbox: false`
  explicitly, or **(b, preferred long-term)** move `shell.openExternal` to the main process
  behind an existing `ipcMain.handle` channel so the preload becomes sandbox-safe and the window
  can be sandboxed. Pick one during implementation; (a) is the minimal-risk choice for this
  milestone.
- This pins behavior across future Electron majors (GLM #7, corrected) and removes reliance on
  the sandbox default.

### Area D — Version pins, fixtures, CDP hardening, greps

- `package.json`: electron optionalDependency `^28.0.0` → **`^43.1.1`** (GPT #2 — **not**
  `^43.0.0`, which semver-permits the pre-fix `43.0.0`; the security floor is `43.1.1`, so the
  caret must start there, or pin exact `43.1.1`); add `@electron/get ^5.0.0` to **regular
  `dependencies`** (Area B.1); `engines.node >= 22.12.0`. Update `package-lock.json`,
  `docs/configuration.md:278`. Add CI validation that resolves + reports the installed Electron
  version so the manifest floor and the provisioned binary agree.
- Test fixtures hardcoding `28.0.0`/`28.3.3`: `tests/electron-install.test.js`,
  `electron-self-heal-smoke.test.js`, `electron-quarantine.test.js`,
  `postinstall-provision-electron.test.js` (the last asserts the exact string
  `"for v28.0.0 (win32-x64)"` → `"for v43.1.1 (win32-x64)"`).
- CDP e2e (`tests/helpers/cdp-client.js`): add `target.type === 'page'` to the `data:` and
  `http://localhost` target matchers (`:161,:181`) so new Chromium-132 background targets can't
  false-match; **confirm in the spike that a child WebContentsView actually enumerates as
  `type: 'page'`** (it might be `iframe`/`other` — GLM #10); keep the hand-built WS path (`:52`)
  and add debug logging of enumerated targets.
- **Cheap greps:** `shell.openItem` (removed v29), `app.allowRendererProcessReuse` (removed v22),
  and any `clipboard` exposure in preloads (deprecated v40, removed-from-renderer v43).

### Area E — Chromium behavioral delta (GLM #4 / GPT #6, corrected)

**Verified against the Electron 43 release notes:** Electron 28 = Chromium **120**; Electron 43 =
Chromium **150** (150.0.7871.46, Node 24.17 internally). The delta is **~30 Chromium majors**, not
the "120→130" the draft claimed (GPT #6 caught the understatement; the exact figure is verified
here, not guessed). The tests below are unchanged, but they must be justified against the real
delta — review the Electron 29–43 release notes for the web-platform/security/CSP/CDP/GPU changes
that touch Amicus's concrete dependencies. Two deltas are load-bearing (the rest — third-party
cookies, client hints — are irrelevant to a localhost/`data:` app):
- **`data:`-URL restrictions:** Chromium has progressively tightened what `data:` URLs may do
  (navigation, scripting, CSP). Amicus loads the toolbar + setup UI from `data:text/html` and
  drives them via `executeJavaScript`. Verify in the spike that a `data:` URL page still loads,
  runs its inline script, and accepts `executeJavaScript` on Electron 43.
- **CDP handshake:** confirm the hand-built devtools WS path (`cdp-client.js:52`) still connects
  against Electron 43's Chromium (protocol/endpoint drift). Covered by running the e2e on 43.

## 6. Verification bar ("done when")

In order:
1. Full unit suite green (updated fixtures).
2. CDP e2e (`electron-toolbar-e2e`) green — target enumeration resolves post-migration.
3. **Manual interactive smoke** on this Windows machine (CDP-scriptable): `amicus start` window
   renders, fold works, model switcher works, setup wizard incl. searchable picker works
   (the setup wizard is a separate BrowserWindow with its own preload — exercised here + covered
   by the Area C audit).
4. `npm audit` clean (0 high).
5. Run the above on **Node 22+** (the new floor).

New automated / acceptance coverage to add:
- A test that exercises the real (non-mocked) `await import('@electron/get')` self-heal path
  (GLM #6) — unit mocks hide `ERR_REQUIRE_ESM`.
- If feasible under the CDP harness, a WebContentsView create→addChildView→setBounds→render
  assertion so view-lifecycle regressions are caught in CI, not only manually.
- **Windows AV upgrade acceptance case (GPT #7):** from a cache with only the *old* electron
  binary (or none), provision `43.1.1`, launch it, and exercise the existing
  `electron-quarantine.js` path — a new electron version = new binary hash, which endpoint
  protection commonly treats differently. Verify the error output distinguishes failed download /
  corrupt archive / deleted exe / blocked execution, and keeps actionable remediation wording.
- **globalShortcut regression (GPT #8):** in the desktop smoke, assert `register()` return values,
  invoke the shortcut after focus moves to the child view and back to the toolbar, and assert
  cleanup/re-registration across window close/reopen (document expected non-availability on
  Linux/Wayland CI rather than asserting blindly).
- **Node-version guard (GPT #9):** `engines.node` is advisory under common npm configs. Add an
  early, explicit Node-version guard in the lifecycle/runtime entrypoint (or in postinstall) that
  fails with a clear "Amicus 3.0 requires Node ≥22.12" message, rather than surfacing as a
  confusing `ERR_REQUIRE_ESM` deep in provisioning.

## 7. Sequencing

**Spike sub-steps are ordered B-then-A, not parallel (GPT #3/Q3):** Area A cannot be spiked until
Area B has actually made an Electron 43 runtime available — otherwise a provisioning failure gets
misdiagnosed as a WebContentsView / `data:` / CDP / renderer failure.

1. **Research spike first (smallest safe step) — de-risks BOTH provisioning and the GUI migration:**
   1a. **(B, first)** on Node 22: install electron 43 + `@electron/get 5`, convert the `require`
       to `await import` in the actual self-heal path, and confirm: the lazy import loads in the
       CJS module; a real `downloadArtifact` **checksum-validates and** succeeds; return/zip-path
       shape unchanged; cache root matches `electron-cache.js`; a corrupted cache is rejected;
       proxy behavior is known (Area B.7); the extracted binary launches.
   1b. **(A, on that known-good binary)** stand up `new WebContentsView({webPreferences})`,
       `mainWindow.contentView.addChildView(opencodeView)`, `setBounds`, load a `data:` URL, and
       verify: rendering; the child view's **CDP target type**; `data:` URL script +
       `executeJavaScript`; and that `will-navigate`/`render-process-gone`/`dom-ready` fire on the
       child `webContents`.
   If the spike surfaces a hard incompatibility, revisit the target here rather than mid-migration.
2. Area A view migration + the grep, verified by CDP e2e + manual smoke.
3. Area C preload/sandbox audit (can parallel A).
4. Area D pins/fixtures/CDP hardening + Area E `data:`/CDP checks.
5. Full verification bar → release notes → 3.0.0 cut.

**Decomposition (GPT Q4):** split into two separately-verifiable phases/PRs — **(1) preparation**
(Node-support policy + guard, CI matrices, version-fixture normalization, provisioning contract
tests, downloader integrity/proxy validation) then **(2) the migration** (electron 43 +
`@electron/get` 5 + WebContentsView), released as 3.0.0. Do **not** publish the prep phase as a
release claiming Node ≥22.12 until the provisioning path is actually compatible. If shipped as one
PR, keep provisioning-first and view-migration-second as distinct commits.

## 8. Risks

- **WebContentsView compositing/resize/z-order/focus** differing subtly (flicker, wrong bounds,
  click fall-through, lost keyboard focus, the historical invisible-hang) — the widest-blast
  surface; de-risked by the spike (§7.1A), the existing `electron/load-failsafe.js`, and the
  CDP + manual visual gate.
- **`@electron/get@5` native-fetch behavior** (timeouts, progress, error shapes) — surfaced by
  the spike.
- **`env-paths 3.x` cache-path drift** — silent re-downloads if `electron-cache.js` disagrees.
- **ESM dynamic-import in the CJS self-heal** — must be exercised by a real (non-mocked) load.
- **`data:`-URL Chromium restrictions** (Area E, ~30 Chromium majors) — could break the
  toolbar/setup rendering.
- **Download integrity** — a bad mirror / corrupted cache / `force:true` bypassing checksum could
  extract-and-execute a tampered binary; the download path is the real integrity boundary now (§1a,
  Area B.6).
- **Proxy regression** — `got`→native-`fetch` can silently break Electron provisioning behind a
  corporate proxy (Area B.7).
- **CI/release** — the Node-22 bump must land in every workflow's `node-version` before the tag,
  or the publish job fails.

## 9. Out of scope (considered, declined)

- **Migrating the toolbar/setup/settings windows off the `data:`-URL + `executeJavaScript`
  polling model to real IPC** — works today; widens the blast radius. (Note: Area C may move
  *one* call — `shell.openExternal` — to main-process IPC, which is a targeted fix, not this
  broader migration.)
- **Incremental 28 → 30 → 43 staging** — rejected for a small, well-inventoried Electron surface;
  a direct jump with the spike + full verification bar is lower total cost than two cycles.
- **ASAR integrity fuse / code-signing** — inapplicable to Amicus's unpackaged model (§1a).

## 10. Open questions

None blocking. The spike (§7.1) resolves the residual empirical unknowns: native-fetch timeout
shape, **download checksum/corrupted-cache behavior**, **proxy support under native fetch**,
cache-path parity, the WebContentsView API shape + CDP target type, and `data:`-URL behavior on
Chromium 150.

## 11. Implementation surface

- `electron/main.js` (view migration + explicit webPreferences), plus grep-verified
  `close-guard.js`, `fold.js`, `ipc-guard.js`; `preload.js`, `preload-content.js`,
  `preload-setup.js` (sandbox audit; possible `shell.openExternal`→IPC move).
- `src/sidecar/electron-install.js` (ESM import, timeout, `@electron/get` 5.x), `electron-cache.js`
  (path parity), `unzip.js` (stale-workaround check), `scripts/postinstall.js` (v42 no-op).
- `package.json`, `package-lock.json`, `docs/configuration.md`, `.github/workflows/*` (Node matrix).
- `tests/electron-install.test.js`, `electron-self-heal-smoke.test.js`,
  `electron-quarantine.test.js`, `postinstall-provision-electron.test.js`,
  `tests/helpers/cdp-client.js`.
