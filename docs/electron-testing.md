# Electron UI Testing (Chrome DevTools Protocol)

The Electron Amicus window runs with remote debugging enabled via the Chrome DevTools Protocol. This allows programmatic inspection and testing of the UI state.

## Prerequisites

### Debug Port Configuration

The default debug port is 9222, but **Chrome browser also uses port 9222**. If Chrome is running, Electron will silently fail to bind. Use `AMICUS_DEBUG_PORT` to set a different port:

```bash
# Use port 9223 to avoid conflicts with Chrome
AMICUS_DEBUG_PORT=9223 amicus start --model gemini --prompt "test"
```

Verify it's accessible:

```bash
# Use the same port you configured (default: 9222, recommended: 9223)
curl -s http://127.0.0.1:9223/json | python3 -m json.tool
```

### Known Limitations

- **`contextBridge` does not work with `data:` URLs** — The toolbar is loaded via a `data:` URL in the main window. Electron's `contextBridge.exposeInMainWorld()` silently fails for `data:` origins, so `window.sidecar` is `undefined` in the toolbar. Any toolbar↔main-process communication must use `executeJavaScript()` polling instead of IPC.
- **Debug targets by URL scheme** — sidecar mode creates two pages (OpenCode content at `http://localhost:<port>`, toolbar at `data:text/html`); the Council Workspace mode (`AMICUS_MODE=council-workspace`, v4.4) creates ONE page at a `file://` URL (`electron/workspace-ui/index.html`, loaded via `loadFile`). Filter by URL prefix: `CdpClient.toolbar()` → `data:`, `CdpClient.content()` → `http://localhost`, `CdpClient.workspace()` → `file://`. The workspace e2e suite runs on port 9225 (9223 is the manual/docs port used throughout this page; 9224 belongs to the toolbar suite). Unlike the `data:`-URL toolbar, the workspace page has a **working** `contextBridge` (`window.amicusWorkspace`) because `loadFile` is a real `file://` origin — see [docs/council.md's Council Workspace section](./council.md#council-workspace-gui) for what that bridge exposes.

## Testing UI State with Node.js

Use the WebSocket API to execute JavaScript in the Electron renderer and inspect UI state:

```javascript
// test-electron-ui.js
const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/<PAGE_ID>');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (function() {
          const messages = document.querySelectorAll('.message');
          const toolCalls = document.querySelectorAll('.tool-call');
          return {
            sessionId: window.sessionId,
            messagesCount: messages.length,
            toolCallsCount: toolCalls.length,
            messages: Array.from(messages).map(m => ({
              class: m.className,
              text: m.textContent.slice(0, 200)
            }))
          };
        })()
      `,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const response = JSON.parse(data);
  if (response.id === 1) {
    console.log(JSON.stringify(response.result?.result?.value, null, 2));
    ws.close();
  }
});
```

## Common UI Test Queries

**Get page ID first:**
```bash
curl -s http://127.0.0.1:9223/json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])"
```

**Check UI state (inline):**
```bash
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/<PAGE_ID>');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `({
        hasConfig: !!window.sidecarConfig,
        model: window.sidecarConfig?.model,
        messagesCount: document.querySelectorAll('.message').length,
        toolCallsCount: document.querySelectorAll('.tool-call').length,
        errorMessages: Array.from(document.querySelectorAll('.error-message')).map(e => e.textContent)
      })`,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const r = JSON.parse(data);
  if (r.id === 1) { console.log(JSON.stringify(r.result?.result?.value, null, 2)); ws.close(); }
});

setTimeout(() => { ws.close(); process.exit(0); }, 5000);
EOF
```

**Get tool call details:**
```bash
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/<PAGE_ID>');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        Array.from(document.querySelectorAll('.tool-call')).map(t => ({
          class: t.className,
          html: t.innerHTML.slice(0, 500)
        }))
      `,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const r = JSON.parse(data);
  if (r.id === 1) { console.log(JSON.stringify(r.result?.result?.value, null, 2)); ws.close(); }
});

setTimeout(() => { ws.close(); process.exit(0); }, 5000);
EOF
```

## Expected UI Elements

When testing the Amicus UI, verify these elements:

| Selector | Description | Expected Content |
|----------|-------------|------------------|
| `.message.system` | Task briefing | "Task: {briefing}" |
| `.message.assistant` | Model response | Response text |
| `.message.user` | User input | User's message |
| `.tool-call` | Tool execution | Tool name, input, output |
| `.tool-call.completed` | Completed tool | Has ✓ status |
| `.tool-call.running` | Running tool | Has ... status |
| `.tool-status-panel` | Tool summary | "Tools: X/Y completed" |
| `.reasoning` | Model reasoning | Collapsible thinking |
| `.error-message` | Error display | Error text |

## Debugging Tips

1. **Get WebSocket URL**: `curl -s http://127.0.0.1:9223/json | jq '.[0].webSocketDebuggerUrl'`
2. **Enable console capture**: Send `{"method": "Console.enable"}` first
3. **Screenshot**: Use `Page.captureScreenshot` method
4. **Timeout**: Always add a timeout to prevent hanging scripts

## Quick WebSocket Testing Patterns

The WebSocket approach via Chrome DevTools Protocol is the most efficient way to test the Amicus UI programmatically. Here are streamlined patterns for common testing scenarios:

**1. Get Page ID and Check UI State (one-liner):**
```bash
PAGE_ID=$(curl -s http://127.0.0.1:9223/json | node -e "const d=require('fs').readFileSync(0,'utf8');const p=JSON.parse(d);console.log(p[0]?.id || 'NO_ID')")
echo "Page ID: $PAGE_ID"
```

**2. Inspect UI State:**
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/$PAGE_ID');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`
        (function() {
          const messages = document.querySelectorAll('.message');
          return {
            sseSubscribed: typeof sseSubscribed !== 'undefined' ? sseSubscribed : false,
            messagesCount: messages.length,
            messages: Array.from(messages).map(m => ({
              class: m.className,
              text: (m.textContent || '').slice(0, 200)
            }))
          };
        })()
      \`,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) {
    console.log(JSON.stringify(msg.result?.result?.value, null, 2));
    ws.close();
    process.exit(0);
  }
});

setTimeout(() => { ws.close(); process.exit(0); }, 3000);
"
```

**3. Send a Message via UI:**
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/$PAGE_ID');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`
        (function() {
          const input = document.getElementById('message-input');
          input.value = 'What is 2+2? Just give me the number.';
          input.dispatchEvent(new Event('input'));
          document.getElementById('send-btn').click();
          return 'Message sent';
        })()
      \`,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) {
    console.log(msg.result?.result?.value);
    ws.close();
    process.exit(0);
  }
});

setTimeout(() => { ws.close(); process.exit(0); }, 3000);
"
```

**4. Check for Errors:**
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/$PAGE_ID');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`({
        lastError: document.querySelector('.error-message')?.textContent,
        sessionId: typeof sessionId !== 'undefined' ? sessionId : 'undefined',
        isWaiting: typeof isWaitingForResponse !== 'undefined' ? isWaitingForResponse : 'undefined'
      })\`,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) {
    console.log(JSON.stringify(msg.result?.result?.value, null, 2));
    ws.close();
    process.exit(0);
  }
});

setTimeout(() => { ws.close(); process.exit(0); }, 3000);
"
```

**Why WebSocket Testing is Efficient:**
- **No file creation**: Tests run inline without creating temporary files
- **Direct DOM access**: Query and manipulate any UI element
- **Real-time state**: Access JavaScript variables like `sessionId`, `sseSubscribed`, `isWaitingForResponse`
- **Click simulation**: Trigger button clicks and input events programmatically
- **Fast iteration**: Quickly test changes without restarting the app

**Important Notes:**
- Run commands from the amicus directory to access the `ws` module
- Page ID changes on each Electron launch - always fetch dynamically
- Add timeouts to prevent hanging on WebSocket errors
- Use `data.toString()` when parsing WebSocket messages in newer Node.js versions

## Integration with CI

For automated testing, launch Amicus with a known task and verify UI state:

```bash
# Launch Amicus in background
node bin/amicus.js start --model "openrouter/google/gemini-2.5-pro" \
  --briefing "Echo hello" &
AMICUS_PID=$!

# Wait for window to open
sleep 5

# Get page ID and test UI
PAGE_ID=$(curl -s http://127.0.0.1:9223/json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Run UI verification script
node scripts/verify-ui-state.js "$PAGE_ID"

# Cleanup
kill $AMICUS_PID
```

## Visual UI Testing with Screenshots

### macOS (native tools)

**Launch and position Electron window:**
```bash
# Start Amicus in background
node bin/amicus.js start --model "openrouter/google/gemini-3-flash-preview" --briefing "Test task" &
sleep 8

# Bring window to front and position it (window may open off-screen)
# Note: osascript / AppleScript is macOS-only
osascript << 'EOF'
tell application "System Events"
    tell process "Electron"
        set frontmost to true
        set position of window 1 to {100, 100}
    end tell
end tell
EOF
```

**Take screenshot (macOS — `screencapture` is macOS-only):**
```bash
screencapture -x /tmp/amicus-screenshot.png
```

### Windows (CDP-based, cross-platform)

`screencapture` and AppleScript are not available on Windows. Use CDP `Page.captureScreenshot` instead (works on all platforms):

```javascript
const { CdpClient } = require('./tests/helpers/cdp-client');
const cdp = await CdpClient.toolbar(9223);
await cdp.screenshot('C:\\tmp\\amicus-screenshot.png');
cdp.close();
```

To verify window visibility on Windows without a screenshot:
```powershell
Get-Process electron | Select-Object MainWindowTitle, MainWindowHandle
```

**Dynamic page ID retrieval (required - ID changes each session):**
```bash
PAGE_ID=$(curl -s http://127.0.0.1:9223/json | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d)[0].id)")
```

**Click UI elements and inspect state (run from amicus directory for `ws` module):**
```bash
cd /path/to/amicus
cat << EOF > test-ui.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/${PAGE_ID}');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`
        (function() {
          // Click model selector
          document.getElementById('model-selector-display')?.click();

          // Or force dropdown visible
          document.getElementById('model-selector-dropdown')?.classList.add('visible');

          // Return state
          return Array.from(document.querySelectorAll('.model-option'))
            .map(opt => ({
              name: opt.querySelector('.model-name-display')?.textContent,
              selected: opt.classList.contains('selected')
            }));
        })()
      \`,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id === 1) {
    console.log(JSON.stringify(msg.result?.result?.value, null, 2));
    ws.close();
    process.exit(0);
  }
});

setTimeout(() => { ws.close(); process.exit(0); }, 3000);
EOF
node test-ui.js
```

**Common gotchas:**
- Window may open off-screen (negative Y coordinate) - use AppleScript to reposition
- Page ID changes on each Electron launch - always fetch dynamically
- Run Node.js scripts from amicus directory to access `ws` module
- Add `setTimeout` to prevent hanging on WebSocket errors
- **Always use `AMICUS_DEBUG_PORT=9223`** when Chrome is running (Chrome claims 9222)

## Toolbar-Specific Testing

The toolbar is a `data:text/html` page — a separate debug target from the OpenCode content view.

**Find the toolbar page ID:**
```bash
TOOLBAR_ID=$(curl -s http://127.0.0.1:9223/json | node -e "
const d=require('fs').readFileSync(0,'utf8');
const pages=JSON.parse(d);
const toolbar = pages.find(p => p.url && p.url.startsWith('data:'));
console.log(toolbar ? toolbar.id : 'NOT_FOUND');
")
echo "Toolbar ID: $TOOLBAR_ID"
```

**Inspect toolbar state (update banner, buttons, timer):**
```bash
cd /path/to/amicus
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/$TOOLBAR_ID');
ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`({
        bannerVisible: document.getElementById('update-banner')?.style?.display === 'flex',
        bannerText: document.getElementById('update-text')?.textContent,
        timerText: document.getElementById('timer')?.textContent,
        foldBtnText: document.getElementById('fold-btn')?.textContent
      })\`,
      returnByValue: true
    }
  }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) { console.log(JSON.stringify(msg.result?.result?.value, null, 2)); ws.close(); process.exit(0); }
});
setTimeout(() => { ws.close(); process.exit(0); }, 3000);
"
```

**Note:** `window.sidecar` is `undefined` in the toolbar (see Known Limitations above). The toolbar communicates with the main process via `window.__amicusUpdateAction` polling, not IPC.

---

## The darwin `.app` bundle — what CI proves, and what it still does not

`.github/workflows/darwin-bundle.yml` drives `scripts/probe-darwin-extract.js` on
`macos-latest`. It is the only place amicus's real extract path meets a real `.app`
bundle, a real POSIX `fs.symlinkSync`, a real `fs.realpathSync` and a real dyld.

### The filing it closes, and the way it closes it

v4.9.6 added a symlink target-escape check (`src/sidecar/zip-entry-write.js ::
writeSymlink`) that `extract-zip` does not have. The v4.9.7 filing was that it could
**reject** a real darwin layout. That is **refuted by measurement on the real bytes**,
not by this job:

| artifact | bytes | records | symlinks | dir entries |
| --- | --- | --- | --- | --- |
| `electron-v43.1.1-darwin-arm64.zip` | 122,054,683 | 585 | 14 | 310 |
| `electron-v43.1.1-darwin-x64.zip` | 123,952,132 | 585 | 14 | 310 |
| `electron-v43.1.1-linux-x64.zip` | 124,861,804 | 74 | **0** | 0 |
| `electron-v43.1.1-linux-arm64.zip` | 124,456,257 | 74 | **0** | 0 |

All 14 darwin targets are relative (`A`, `Versions/Current/Resources`, …); none carries a
`..` component; none is absolute; **0 of the 585 entry names traverse a symlinked
component**. The check is purely lexical (`path.resolve` then `path.relative`), so on that
shape it cannot fire. The extraction root is itself realpath'd
(`src/sidecar/zip-from-buffer.js :: extractZipBuffer`), which is why macOS's
`/var` -> `/private/var` does not turn every link into an escape — the one mechanism that
could have made the filing correct.

**Linux is settled outright and gets no job**: both linux artifacts hold 74 entries and
zero symlinks, so `writeSymlink` is unreachable there. The filing's "darwin/linux" narrows
to "darwin".

### What each assertion pins, and the mutant it kills

| id | assertion | mutant it kills |
| --- | --- | --- |
| A1a | `resolveAnchor({selfElectronDir: null})` reads the `checksums.json` under test | dropping the `selfElectronDir` override, which silently re-anchors on the repo's own `node_modules` |
| A1b | `repairElectron({cacheOnly:true})` repairs **and** the gate says `verified` | any change that stops a byte-exact artifact verifying — extract and exec both stay green |
| A1c | with **no** anchor the same bytes extract but are marked `unverified` | dropping the `verdict !== 'verified'` mark, i.e. a silent degrade of the trust route |
| A2 | `resolveElectronBinary` names the real launcher and its exec bit survived | a wrong `platformExe` darwin arm, or a `path.txt` naming a different basename |
| A3a | all 14 archive symlinks are symlinks on disk with byte-identical targets | deleting the `if (symlink)` branch in `placeEntry` — links become regular files |
| A3b | the five structural framework links exist with their exact targets | writing the **resolved absolute** path instead of the archive's relative target (still runs on the runner; breaks when the tree moves) |
| A4 | parity vs the tree `@electron-internal/extract-zip` produced | a flat file mode, or a `continue` that silently drops entries — **report-only on its first cut** |
| A5 | `Electron --version` runs | the same mutant as A3a, observed through dyld: the launcher's Mach-O carries `LC_RPATH @executable_path/../Frameworks` and `LC_LOAD_DYLIB @rpath/Electron Framework.framework/Electron Framework`, so it loads the ~192 MB framework **through two of the fourteen links** |
| A6i | an escaping relative target is refused, nothing planted | dropping the `..`-prefix limbs of the three-limb test |
| A6ii | an **absolute POSIX** target is refused | dropping the `startsWith('..' + sep)` limb — on win32 `/etc/passwd` becomes `C:\etc\passwd` and a *different* limb catches it, so the Windows suite proves the wrong arithmetic |
| A6iii | SYMLINKCHAIN refused by a **real** `realpath`: 3 links made, no victim | reverting the target resolution to `path.dirname(dest)` — the lexical-dirname bug that extracts with no error at all |

A4 is deliberately **report-only, exit 0, full diff printed** on its first cut: nothing has
ever measured that the two extractors agree on directory modes under the runner's umask, so
making an unmeasured comparison a blocking gate buys a red for reasons unrelated to
symlinks. Promote it once one clean run exists. Everything else gates from day one.

A6iii is the assertion that matters most: in the jest suite the same archive is pinned by a
`realpathSync` **the test itself injects** (`tests/electron-custody.test.js`, describe
`symlinks — the darwin .app shape, which cannot be run here`). That is a rule read off the
surface its own writer wrote. On the runner the three `.` links exist on disk and the kernel
answers.

### `npm ci` does NOT provision Electron — the job asks for it explicitly

`electron@43.1.1` ships **no install script at all**: its `package.json` has no `scripts`
field (it exposes `install.js` only as the `install-electron` bin), and `package-lock.json`
carries no `hasInstallScript` for it. So npm never fetches the ~122 MB binary, on any
platform or any install path. Measured on run `34246117877`: plain `npm ci` on ubuntu,
macos and windows alike finished in 15-38 s and left amicus's own postinstall reporting
`the Electron GUI binary is not provisioned yet` — an empty electron cache. The lockfile's
per-platform installable counts (588 / 588 / 587) match the observed `added N packages`
exactly **with `electron` included**, so the package is present and only the binary is
missing.

The job therefore runs `node node_modules/electron/install.js` in its own step, with one
retry. It deliberately does **not** use `AMICUS_PREFETCH_ELECTRON=1`, which
`scripts/postinstall.js` routes through amicus's own `repairElectron` — the A4 diff would
then compare amicus against amicus.

### What it does not prove

- **darwin x64.** `macos-latest` is arm64. The x64 artifact was measured at an identical
  shape (585 / 14 / 310), so the residual is small, but no x64 leg exists. Intel runner
  labels changed during 2025 — check GitHub's current list before adding one.
- **`mas`.** Unreachable in production; no caller passes `platform: 'mas'`.
- **A case-sensitive APFS volume.** Runners default to case-insensitive; 0 case-insensitive
  name collisions were measured across the 585 entries, but "low exposure" there is
  inference, not measurement.
- **Future electron layouts, between bumps.** The job proves the version pinned in
  `package-lock.json` at run time. A bump is caught by the `package-lock.json` path filter on
  `pull_request`/`push`, not by the cron.
- **The native-rescue hatch.** `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1`, `ditto` and Info-ZIP
  `unzip` symlink behaviour on darwin stay unmeasured — that is the B2 lane, not this one.
- **`codesign`.** The archive carries **zero** `_CodeSignature` entries, so
  `codesign --verify` on the extracted bundle would assert nothing. Only the embedded ad-hoc
  Mach-O signature exists, and A5 succeeding is the only evidence it survived byte-exact
  extraction. Do not add a codesign step and call it coverage.
- **Destination-failure classification on darwin** (ENOSPC, read-only `dist/`, EACCES) and
  **`promoteDist` on APFS** — the job calls the promote once, on a happy path.
- **A trailing-slash symlink entry.** An entry whose *name* ends with `/` while its mode bits
  say `IFLNK` is turned into a real directory before the symlink branch is reached, so the
  escape check never runs. The real artifact has zero such entries, so no darwin job will
  ever exercise it; it belongs in the platform-independent suite.

### Triggers, cost, and the required-check caveat

Paths-filtered `pull_request` **and** `push: [main]` (so a bump is proven at merge time),
plus a weekly cron and `workflow_dispatch`. The cron re-proves the pinned version against the
live release asset and the current runner image — the two inputs no path filter can see — and
is the weakest trigger on purpose: a schedule GitHub delays or drops is silent.

The job owns a ~122 MB download plus two ~600 MB extractions on a 3-vCPU / 8 GB runner;
budget 4-6 minutes. It is not free, and macOS *concurrency* rather than minutes is the
binding constraint on a public repo — `ci.yml` already burns two macOS legs per push.

Because both event triggers carry a `paths:` filter, the job reports **skipped** when nothing
matches, so **it cannot be a required status check as written**. Making it required means
dropping `paths:` and moving the guard inside the job (a `git diff --name-only` early exit) —
a pattern this repo does not currently use.

### Running it by hand on a Mac

```bash
npm ci --foreground-scripts
rm -rf node_modules/electron/dist node_modules/electron/path.txt
node node_modules/electron/install.js          # the artifact + the A4 reference tree
node scripts/probe-darwin-extract.js --preflight
node scripts/probe-darwin-extract.js
```

The `rm -rf` is not cosmetic: `install.js` short-circuits on a populated `dist/`, and on a dev
Mac that `dist/` may well be amicus's own self-heal output — which would make A4 compare
amicus against amicus. The workflow does the same removal for the same reason.
