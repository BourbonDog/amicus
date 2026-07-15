# Electron 43 Spike Findings (Phase 0)

Runtime: Node v24.18.0 (floor >=22.12). Worktree: amicus-electron43.
Installed for spike (--no-save): @electron/get 5.0.0, electron 43.1.1.

## @electron/get 5.x module + import behavior
- `"type": "module"` (ESM). `exports` map is locked down — `require('@electron/get/package.json')`
  throws `ERR_PACKAGE_PATH_NOT_EXPORTED` (read package.json via fs, not require).
- **KEY FINDING (overturns a spec/review assumption):** `require('@electron/get')` **SUCCEEDS on
  Node 24.18** and returns `downloadArtifact`. `require(esm)` is unflagged/default on Node >=22.12
  (our floor) and @electron/get 5.x has no blocking top-level await at its entry. => The "must
  convert require() -> await import()" step (deepseek "blocker", Area B.2) is NOT strictly required
  on the >=22.12 floor. Task 2.1 re-scoped: verify the existing `require` call works as-is on Node
  22.12+; keep it or switch to `await import()` for clarity — NOT a blocker.
- New 5.x exports: `downloadArtifact`, `download`, `FetchDownloader` (confirms native fetch),
  `ElectronDownloadCacheMode` (new cache-control enum).

## downloadArtifact / checksum / cache — RESOLVED
- `downloadArtifact({ version: '43.1.1', artifactName: 'electron' })` works; downloaded + checksum-
  validated (via bundled sumchecker) in ~2s over a direct connection.
- Zip path: `...\AppData\Local\electron\Cache\<sha256>\electron-v43.1.1-win32-x64.zip`.
  **Zip-name pattern matches** `electron-install.js:102` (`electron-v${version}-${platform}-${arch}.zip`).
- **Cache-root parity CONFIRMED:** 5.x's root (`%LOCALAPPDATA%\electron\Cache`) == what
  `electron-cache.js defaultCacheRoot()` computes. env-paths 3.x did NOT change the Windows root.
  => No electron-cache.js change needed (deepseek/GLM env-paths concern is a non-issue here).
- Timeout: the old got-style `downloadOptions.timeout:{socket,request}` is gone; 5.x uses native
  fetch (`FetchDownloader`). For the self-heal, dropping the custom timeout and relying on 5.x
  defaults is acceptable (download is fast); if a hard cap is wanted, wrap with AbortSignal.timeout.
- **Proxy: UNTESTED (no corporate proxy on this machine).** Direct download works. GPT #5 risk stands:
  native fetch does not honor HTTPS_PROXY without a dispatcher. Task 2.1 must either add an undici
  ProxyAgent/global-agent path or document proxy installs as unsupported + manual-install fallback.
- Corrupted-cache rejection: sumchecker validates on download; a tampered cache entry is re-validated
  on the next downloadArtifact (force or checksum mismatch triggers re-fetch). Confirmed behavior:
  checksum is enforced, not bypassed.
## WebContentsView + CDP (Task 0.2) — RESOLVED, migration API confirmed on Electron 43
- `new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}})`
  constructs OK.
- `mainWindow.contentView.addChildView(view)` works (the CORRECTED receiver — window root view).
- `view.setBounds({x,y,width,height})` and `view.webContents.*` (loadURL, executeJavaScript, event
  listeners) all work.
- **CDP target type: the child WebContentsView enumerates as `type=page`** (both the root data:
  toolbar and the child appear as `page` targets). => Task 2.6's `target.type==='page'` filter is
  correct; the existing url-prefix match still disambiguates root(data:) vs child. A pre-load child
  shows `type=page url=` (empty) — the type filter + url match together handle it.
- **`data:`-URL scripting WORKS on Chromium 150** (child loaded a `data:text/html;base64,...` page
  and `executeJavaScript` returned the expected value). Area E data:-URL-restriction risk does NOT
  materialize; the toolbar/setup data:-URL + executeJavaScript model survives the 120->150 jump.

## Net effect on the plan
- Task 2.1 SHRINKS: no ESM `await import` conversion strictly needed (require works on >=22.12);
  no electron-cache.js change (parity confirmed); timeout can be dropped (fast native fetch).
  Remaining real Task 2.1 work: declare @electron/get in deps, decide keep-require vs await-import
  (clarity), handle PROXY (the one unresolved risk — untested here).
- Task 2.3 migration API is confirmed working before we touch main.js.
- Open risk carried forward: PROXY support under native fetch (no proxy on this machine to test).
