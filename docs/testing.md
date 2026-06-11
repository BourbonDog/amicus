# Testing Guide

Comprehensive guide to Amicus's test infrastructure, covering unit tests, integration tests, E2E tests, and the agentic eval system.

## Test Architecture

Amicus uses a three-tier testing strategy plus an eval system:

```
Tier 1: Unit Tests (mocked)          ~1200 tests, <2 min
  └─ Business logic, parsing, validation, session management

Tier 2: Integration Tests (source)    ~30 tests, <5 sec
  └─ Source-level verification, module wiring, config checks

Tier 3: E2E Tests (real LLM)         ~15 tests, ~3 min each
  └─ CLI headless, MCP headless, Electron CDP
  └─ Requires OPENROUTER_API_KEY, skipped when missing

Eval System: Agentic Evals           ~3 scenarios, ~5 min each
  └─ Full Claude Code + Amicus interaction grading
  └─ Programmatic checks + LLM-as-judge scoring
```

### Quick Reference

```bash
npm test                                    # Unit tests only (*.integration.test.js excluded by jest.config.js)
npm test tests/context.test.js              # Single file (preferred during dev)
npm test -- --coverage                      # Coverage report
npm test -- -t "should extract"             # Run tests matching pattern

npm run test:integration                    # Integration tests only (real processes, not LLM)
npm run test:all                            # Unit + integration (pre-push gate)
npm run test:e2e:mcp                        # MCP E2E with real repomix (requires OPENROUTER_API_KEY)
npm run lint                                # ESLint on src/

# Run individual E2E test files (require OPENROUTER_API_KEY)
npm test tests/cli-headless-e2e.integration.test.js
npm test tests/mcp-headless-e2e.integration.test.js
npm test tests/electron-toolbar-e2e.integration.test.js

# Evals
node evals/run_eval.js --eval-id 1
node evals/run_eval.js --all --dry-run
```

---

## Tier 1: Unit Tests

Unit tests mock all external dependencies (OpenCode SDK, filesystem, network) and run fast. They form the bulk of the test suite.

### What to Unit Test

| Area | Example Files | Focus |
|------|--------------|-------|
| CLI parsing | `cli.test.js` | Command validation, flag handling, error messages |
| Context filtering | `context.test.js` | Turn extraction, token estimation, JSONL parsing |
| Session management | `session-manager.test.js` | CRUD operations, metadata persistence |
| Prompt construction | `prompt-builder.test.js` | Template assembly, mode-specific prompts |
| Conflict detection | `conflict.test.js` | mtime comparison, warning formatting |
| Drift calculation | `drift.test.js` | Staleness scoring, turn counting |
| Headless mode | `headless.test.js` | Polling logic, fold marker detection, timeout |
| MCP tools | `mcp-tools.test.js`, `mcp-server.test.js` | Zod schemas, tool handlers |
| Session operations | `sidecar/*.test.js` | Start, resume, continue, read, context-builder |
| Config/utils | Various `utils/*.test.js` | Agent mapping, config loading, validation |

### What NOT to Unit Test

Do not write unit tests for:
- DOM manipulation in `renderer.js`
- UI picker components (`model-picker.js`, `mode-picker.js`)
- Electron window configuration (`main.js`)
- CSS class assignments and styling

DOM mock tests are ineffective. They test mock behavior, not real rendering. Use CDP E2E tests for UI verification instead.

### Mocking Patterns

The codebase uses Jest's `jest.mock()` for external dependencies:

```javascript
// Mock the OpenCode SDK (used in headless.test.js, e2e.test.js)
jest.mock('../src/opencode-client', () => ({
  startServer: jest.fn(),
  createSession: jest.fn(),
  sendPromptAsync: jest.fn(),
  getMessages: jest.fn(),
  checkHealth: jest.fn(),
}));
```

**Key rule:** The OpenCode SDK uses ESM dynamic imports (`await import()`) which fail under Jest without `--experimental-vm-modules`. Always mock the SDK in unit tests. For E2E tests that need a real server, use `tests/helpers/start-server.js` (runs in a separate Node.js process).

---

## Tier 2: Integration Tests

Integration tests verify source-level invariants without mocking. They read actual source files to assert code structure, ensuring critical patterns aren't accidentally removed.

| Test File | What It Verifies |
|-----------|-----------------|
| `spawn-pipe-deadlock.integration.test.js` | `spawnSidecarProcess()` in `src/mcp-server.js` uses `ignore` (not `pipe`) for stdio, no `detached: true`, uses `child.unref()` |
| `electron-headless-mode.test.js` | `electron/main.js` gates `mainWindow.show()` behind `SIDECAR_HEADLESS_TEST` env var (compat shim — not yet renamed) |

These tests catch regressions in critical spawn/process configuration that would be hard to debug in production.

---

## Tier 3: E2E Tests

E2E tests spawn real processes, call real LLMs, and verify end-to-end behavior. They require `OPENROUTER_API_KEY` and are automatically skipped when the key is missing.

### Skip Behavior

All E2E tests use this pattern:

```javascript
const HAS_API_KEY = !!(
  process.env.OPENROUTER_API_KEY ||
  (() => {
    try {
      const envPath = path.join(os.homedir(), '.config', 'amicus', '.env');
      return fs.readFileSync(envPath, 'utf-8').includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);
const describeE2E = HAS_API_KEY ? describe : describe.skip;
```

The key can be in the environment or in `~/.config/amicus/.env`.

### CLI Headless E2E (`cli-headless-e2e.integration.test.js`)

Spawns the real `amicus` CLI binary with `start --no-ui` and verifies the full headless lifecycle.

**What it tests:**
1. `start --no-ui` runs to completion with real LLM
2. Session files created on disk (metadata.json, summary.md, initial_context.md)
3. `list` command shows the completed session
4. `read` command returns the summary
5. `read --metadata` returns valid JSON metadata

**Architecture:**
```
Test process
  └─ spawn(node, [amicus.js, start, --no-ui, ...])
       └─ OpenCode server (auto port)
            └─ Real LLM call (gemini-flash)
       └─ Session files written to tmpDir
  └─ spawn(node, [amicus.js, list, ...])  // verify list
  └─ spawn(node, [amicus.js, read, ...])  // verify read
```

### MCP Headless E2E (`mcp-headless-e2e.integration.test.js`)

Spawns a real MCP server over stdio, sends JSON-RPC tool calls, and verifies the full MCP lifecycle.

**What it tests:**
1. `amicus_start` with `noUi: true` launches a headless session
2. `amicus_status` polling until completion
3. `amicus_read` returns the summary
4. `amicus_list` shows the completed session
5. Session files exist on disk with correct metadata

**Architecture:**
```
Test process
  └─ spawn(node, [amicus.js, mcp])  // MCP server over stdio
       ├─ JSON-RPC: initialize
       ├─ JSON-RPC: tools/call (amicus_start)
       │    └─ OpenCode server (auto port)
       │         └─ Real LLM call
       ├─ JSON-RPC: tools/call (amicus_status)  // poll loop
       ├─ JSON-RPC: tools/call (amicus_read)
       └─ JSON-RPC: tools/call (amicus_list)
```

### Electron CDP E2E (`electron-toolbar-e2e.integration.test.js`)

Spawns a real Electron window (hidden) with a real OpenCode server, connects via Chrome DevTools Protocol, and asserts toolbar DOM state.

**What it tests:**
1. Brand name renders ("Amicus")
2. Task ID displayed in toolbar
3. Timer ticks (changes after 2 seconds)
4. Fold button exists with shortcut label
5. Settings gear button exists
6. Update banner hidden by default
7. Update banner visible when `AMICUS_MOCK_UPDATE=available` (or legacy `SIDECAR_MOCK_UPDATE=available`)
8. Screenshots captured as PNG files

**Architecture:**
```
Test process
  ├─ spawn(node, [start-server.js])     // Real OpenCode server (separate process)
  │    └─ Outputs { port, sessionId }
  ├─ spawn(electron, [main.js])          // Hidden Electron window
  │    ├─ BrowserView → http://localhost:<port>  (OpenCode UI)
  │    └─ Main window → data:text/html (toolbar)
  └─ CdpClient.toolbar(9224)            // CDP WebSocket connection
       ├─ Runtime.evaluate(...)           // DOM assertions
       └─ Page.captureScreenshot(...)     // Screenshot capture
```

---

## CDP Helper (`tests/helpers/cdp-client.js`)

Thin class (~190 lines) wrapping `ws` + `http` for Chrome DevTools Protocol communication. No external dependencies beyond `ws` (already a project dependency).

### API

```javascript
const { CdpClient } = require('./helpers/cdp-client');

// Factory methods (with retry/polling)
const cdp = await CdpClient.toolbar(port, timeoutMs);   // data: URL target
const cdp = await CdpClient.content(port, timeoutMs);   // http://localhost target

// Core methods
const targets = await cdp.getTargets();                  // GET /json
const target = await cdp.findTarget(t => t.url.startsWith('data:'));
await cdp.connect(targetId);                             // WebSocket
const value = await cdp.evaluate('document.title');      // Runtime.evaluate
await cdp.waitForSelector('.brand', 10000);              // Poll until element exists
await cdp.screenshot('/tmp/toolbar.png');                // Page.captureScreenshot
cdp.close();                                             // Cleanup
```

### Electron Debug Targets

Electron creates two CDP targets per window:

| Target | URL Pattern | Contains |
|--------|-------------|----------|
| **Content** | `http://localhost:<port>` | OpenCode web UI (BrowserView) |
| **Toolbar** | `data:text/html,...` | Amicus toolbar (brand, timer, fold button) |

Use `CdpClient.toolbar()` or `CdpClient.content()` to connect to the right one.

### Server Helper (`tests/helpers/start-server.js`)

Starts a real OpenCode server in a separate Node.js process, working around Jest's inability to handle ESM dynamic imports. Outputs `{ port, sessionId }` as JSON on stdout, then stays alive until killed.

```javascript
const child = spawn(process.execPath, ['tests/helpers/start-server.js']);
// Parse JSON from stdout to get { port, sessionId }
// Kill child when done to stop the server
```

---

## Environment Variables for Testing

### Required for E2E Tests

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | API key for real LLM calls. Without it, E2E tests are skipped. Can also be in `~/.config/amicus/.env` |

### Test Infrastructure Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SIDECAR_HEADLESS_TEST` | unset | Set to `1` to suppress `mainWindow.show()` in Electron. Window is created but never made visible. CDP screenshots still work (captures off-screen renderer). (Name is a compat shim; the AMICUS_ rename is pending.) |
| `AMICUS_DEBUG_PORT` | `9222` | CDP remote debugging port (legacy `SIDECAR_DEBUG_PORT` still honored, deprecated). `AMICUS_DEBUG_PORT` wins when both are set. Use `9223`+ to avoid conflicts with Chrome browser. E2E tests use `9224`. |
| `AMICUS_MOCK_UPDATE` | unset | Mock update banner state: `available`, `updating`, `success`, `error`. Legacy `SIDECAR_MOCK_UPDATE` also accepted. Used in Electron toolbar E2E tests. |

---

## Cross-Platform: macOS / Linux / Windows

### macOS

No extra dependencies needed. Electron runs natively. The window is created with `show: false` when `SIDECAR_HEADLESS_TEST=1`, so no visible window pops up. CDP screenshots capture the off-screen renderer via `Page.captureScreenshot`.

The visual testing docs reference `screencapture -x` and AppleScript window positioning — those are macOS-specific tools. See the Windows section for the cross-platform equivalent.

### Linux (VPS / CI)

Electron requires an X server to create a renderer, even with `show: false`. The E2E tests auto-detect headless Linux and manage Xvfb:

```javascript
function ensureDisplay() {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return { display: process.env.DISPLAY, cleanup: () => {} };
  }
  // Auto-launch Xvfb on :99
  const xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '1280x720x24']);
  return { display: ':99', cleanup: () => xvfbProcess.kill() };
}
```

**Prerequisites for Linux CI:**
```bash
apt-get install -y xvfb libgtk-3-0 libnotify4 libnss3 libxss1 libasound2
```

### Windows 11

The unit suite runs fully green on Windows (verified F2). A few platform-specific details:

**Path encoding (`src/session.js`, `src/environment.js`):** `encodeProjectPath` / `encodePath` replace `/`, `\`, `:`, and `_` with dashes. On Windows, `C:\Users\x` encodes to `C--Users-x` — the drive-colon and both backslashes each become a dash. This matches Claude Code's directory naming behavior.

**OpenCode binary on PATH (`src/utils/path-setup.js`):** Node's `spawn()` without `shell: true` cannot run `.cmd` shims. `ensureNodeModulesBinInPath()` adds `opencode-windows-x64/bin` and `opencode-windows-x64-baseline/bin` to `PATH` before spawning, so `opencode.exe` resolves directly. The baseline variant supports pre-AVX2 CPUs; normal-before-baseline order in `PATH` is intentional.

**Screenshots:** `screencapture` is macOS-only. On Windows, screenshots in E2E tests still work because they go through CDP `Page.captureScreenshot` (rendered off-screen). For manual visual inspection use:
```powershell
# Check window visibility
Get-Process electron | Select-Object MainWindowTitle, MainWindowHandle
# CDP screenshot (cross-platform — use the CdpClient helper)
const cdp = await CdpClient.toolbar(9223);
await cdp.screenshot('C:\\tmp\\amicus-test.png');
```

**X server:** Not required. Electron on Windows creates a renderer natively without a display server. The `ensureDisplay()` / Xvfb logic in E2E tests is Linux-only and is skipped on `win32`.

---

## Screenshots

CDP E2E tests capture screenshots to `tests/screenshots/` (gitignored). Screenshots are PNG files generated via `Page.captureScreenshot`:

| Screenshot | Generated By | Shows |
|------------|-------------|-------|
| `toolbar-default.png` | Toolbar E2E default tests | Default toolbar state |
| `toolbar-update-banner.png` | Toolbar E2E update banner tests | Toolbar with update banner visible |

Screenshots are not committed to git. They're generated fresh on each test run for visual verification. Future work: pixel-diff comparison against committed baselines.

---

## Agentic Eval System

The eval system tests whether an LLM (Claude) can correctly use Amicus as a tool. Each eval spawns a real Claude Code process in an isolated sandbox.

See [evals/README.md](../evals/README.md) for full documentation.

### Quick Start

```bash
node evals/run_eval.js --eval-id 1              # Single eval
node evals/run_eval.js --all                     # All evals
node evals/run_eval.js --eval-id 1 --mode mcp   # MCP mode only
node evals/run_eval.js --eval-id 1 --mode cli   # CLI mode only
```

### Scoring

Two-stage: programmatic checks (gate) then LLM-as-judge (quality). All programmatic checks must pass before the LLM judge runs.

---

## Writing New Tests

### Choosing the Right Tier

| Scenario | Tier | Example |
|----------|------|---------|
| New parsing logic | Unit | Mock inputs, assert outputs |
| New CLI flag | Unit | Test `parseArgs()` with the new flag |
| New MCP tool | Unit | Test Zod schema + handler with mocked SDK |
| Critical spawn config | Integration | Read source, assert pattern present |
| New headless workflow | E2E | Real LLM, verify session files |
| New toolbar UI element | E2E (CDP) | Real Electron, assert DOM via CDP |
| LLM decision quality | Eval | Claude + Amicus in sandbox |

### Naming Conventions

```
tests/
  foo.test.js                          # Unit test for src/foo.js
  foo.integration.test.js              # Integration test (source-level)
  foo-e2e.integration.test.js          # E2E test (real processes/LLM)
  sidecar/foo.test.js                  # Unit test for src/sidecar/foo.js
  helpers/                             # Test utilities (not test files)
```

### CDP E2E Test Pattern

When adding a new Electron E2E test:

1. Reuse the `startRealServer()` + `spawnElectron()` + `CdpClient` pattern from `electron-toolbar-e2e.integration.test.js`
2. Use `AMICUS_HEADLESS_TEST=1` to suppress the window
3. Use a unique `AMICUS_DEBUG_PORT` (currently `9224` for toolbar tests)
4. Always clean up in `afterAll`: kill Electron, kill server, kill Xvfb
5. Save screenshots to `tests/screenshots/` with descriptive names

```javascript
describeE2E('My New E2E Test', () => {
  let serverInfo, electronProcess, cdp;

  beforeAll(async () => {
    serverInfo = await startRealServer();
    electronProcess = spawnElectron({
      opencodePort: serverInfo.port,
      sessionId: serverInfo.sessionId,
      taskId: 'my-test',
    });
    cdp = await CdpClient.toolbar(CDP_PORT, 20000);
  }, 30000);

  afterAll(async () => {
    cdp?.close();
    electronProcess?.kill('SIGTERM');
    serverInfo?.cleanup();
  });

  it('verifies some DOM state', async () => {
    await cdp.waitForSelector('.my-element');
    const text = await cdp.evaluate(`document.querySelector('.my-element')?.textContent`);
    expect(text).toContain('expected');
  });
});
```

### Test File Location

All test files go in `tests/`. Test helpers go in `tests/helpers/`. The Jest config matches `**/tests/**/*.test.js`.

---

## Jest Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.integration\\.test\\.js$',  // E2E/integration tests excluded from default gate
    '\\.worktrees/'
  ],
  collectCoverageFrom: ['src/**/*.js', 'bin/**/*.js', 'electron/**/*.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true
};
```

`npm test` runs only `*.test.js` files that do NOT match `*.integration.test.js`. E2E and integration tests must be run explicitly via `npm run test:integration`, `npm run test:all`, or by naming the file directly.

**Timeouts:** E2E tests set per-test timeouts of 180 seconds (3 minutes) for real LLM calls. Unit tests use Jest's default 5-second timeout.

---

## Test File Index

Complete mapping of test files to their targets and focus areas.

| Test File | Target Module | Focus |
|-----------|--------------|-------|
| `cli.test.js` | Argument parsing | Command validation, flag handling |
| `context.test.js` | Context filtering | Turn extraction, token estimation |
| `session.test.js` | Session resolution | Primary/fallback paths |
| `session-manager.test.js` | Persistence layer | CRUD operations, metadata |
| `conflict.test.js` | File conflicts | mtime comparison, warning format |
| `drift.test.js` | Drift calculation | Age, turn count, significance |
| `headless.test.js` | OpenCode HTTP API | Spawn, polling, timeout |
| `prompt-builder.test.js` | System prompts | Template construction |
| `index.test.js` | Main API | Re-export smoke tests, generateTaskId |
| `e2e.test.js` | End-to-end | Full workflow |
| `sidecar/start.test.js` | Session starting | Task ID generation, metadata creation, MCP config |
| `sidecar/resume.test.js` | Session resumption | Drift detection, metadata loading |
| `sidecar/continue.test.js` | Session continuation | Previous session loading, context building |
| `read-json.test.js` | Session reading | `read --json` run/wave documents, wave-aware list |
| `sidecar/context-builder.test.js` | Context building | Session resolution, message filtering |
| `sidecar/session-utils.test.js` | Shared utilities | Session paths, finalization, heartbeat |
| `sidecar/progress.test.js` | Progress reader | Message counts, latest activity, last activity |
| `sidecar/exit-handler.test.js` | Crash handler | Metadata update on crash, status transitions |
| `mcp-headless-lifecycle.test.js` | MCP headless lifecycle | Start, poll, progress, crash, abort, read |
| `mcp-discovery.test.js` | MCP discovery | Plugin chain, `~/.claude.json` mcpServers, merge priority, sidecar exclusion |
| `mcp-discovery-integration.test.js` | buildMcpConfig merge | Discovery + file + CLI merge, --no-mcp, --exclude-mcp |
| `mcp-repomix-e2e.integration.test.js` | MCP E2E (real LLM + repomix) | Real discovery -> headless sidecar -> repomix tool call |
| `auth-json.test.js` | Auth JSON reader | Import discovery, provider mapping, smart delete check |
| `opencode-client-cowork.test.js` | OpenCode client config | Client-aware prompt, systemPrompt, port handling, provider model sync |
| `config.test.js` | Config core | Config I/O, aliases, getEffectiveAliases, tryResolveModel, buildProviderModels |
| `config-fallback.test.js` | Config fallback | Direct API fallback with persisted keys |
| `config-hash.test.js` | Config hashing | Config hashing, alias table, change detection |
| `config-null-alias.test.js` | Config null alias | Null alias protection and auto-repair |
| `config-resolve.test.js` | Config resolution | Model resolution, default aliases, direct API fallback, detectFallback |
| `model-validator.test.js` | Model validator | Validation, filtering, interactive prompting, headless errors |
| `model-fetcher.test.js` | Model fetcher | Provider API fetching, normalization, grouping, error handling |
| `updater.test.js` | Update checker | Mock states, performUpdate spawn, CLI integration |
| `evals/tests/transcript_parser.test.js` | Stream-json parsing | Tool call extraction, token usage, error capture |
| `evals/tests/evaluator.test.js` | Eval criteria | Programmatic checks (7 types), LLM-as-judge prompt/response |
| `evals/tests/claude_runner.test.js` | Claude runner | MCP config, sandbox creation, CLI command building |
| `evals/tests/result_writer.test.js` | Result output | Summary formatting, file writing |
| `scripts/check-secrets.test.js` | Secret detection | Pattern matching, allowlist, multi-secret |
| `scripts/check-file-sizes.test.js` | File size limits | Line counting, batch checking |
| `scripts/validate-docs.test.js` | Doc drift detection | Section extraction, drift comparison, staged file check |
| `helpers/cdp-client.test.js` | CDP helper | Mock HTTP+WebSocket CDP server, factory methods |
| `electron-headless-mode.test.js` | Electron headless | Source-level verify `AMICUS_HEADLESS_TEST` guard |
| `cli-headless-e2e.integration.test.js` | CLI E2E (real LLM) | `start --no-ui`, `list`, `read`, `read --metadata` |
| `electron-toolbar-e2e.integration.test.js` | Electron CDP E2E (real LLM) | Brand, task ID, timer, fold button, settings, update banner, screenshots |

---

## UI Testing Approach (Autonomous Verification Required)

**MANDATORY: Any UI feature change MUST be visually verified before considering it complete.** Do not rely solely on unit tests for UI work -- launch the Electron app, inspect via CDP, and take a screenshot.

For UI changes, follow this autonomous verification process:

1. **Launch the app** with appropriate mock env vars (e.g., `AMICUS_MOCK_UPDATE=available`)
2. **Use `AMICUS_DEBUG_PORT=9223`** to avoid port conflicts with Chrome
3. **Inspect via Chrome DevTools Protocol**: Connect to `http://127.0.0.1:9223/json`, find the target page, query DOM state via WebSocket
4. **Take a screenshot**: Use CDP `Page.captureScreenshot` (cross-platform) via the `CdpClient` helper. On macOS you can also use `screencapture -x /tmp/amicus-<feature>.png`. On Windows use the `CdpClient` approach (no `screencapture` binary available).
5. **Check both targets**: The Electron window has two pages -- the OpenCode content (`http://localhost:...`) and the toolbar (`data:text/html`). Test each as needed.

**Key gotcha:** `contextBridge` does not work with `data:` URLs. The toolbar (`data:text/html`) cannot use `window.sidecar` IPC. Use `executeJavaScript()` polling from the main process instead.

See [electron-testing.md](electron-testing.md) for full CDP patterns, toolbar-specific testing, and known limitations.

---

## Image / Diagram QA (Mandatory Visual Loop)

**When creating or modifying any image (SVG, PNG, diagram, screenshot), you MUST:**

1. Render / convert the image
2. Read it back visually (use `Read` tool on the PNG) and inspect the output
3. Check for: text clipping, alignment issues, correct labels, layout balance, readability
4. Fix any issues found
5. Re-render and re-inspect -- **loop until fully QA'd**

Never commit an image without completing visual verification. GitHub strips `<style>` and `<filter>` from SVGs, so always convert to PNG (use `sharp`) for any image referenced in README or docs.

---

## Update Banner Mock Testing

Use `AMICUS_MOCK_UPDATE` to test update UI states without real npm operations (legacy `SIDECAR_MOCK_UPDATE` also accepted):

```bash
AMICUS_MOCK_UPDATE=available amicus start --model gemini --prompt "test"  # Shows banner
AMICUS_MOCK_UPDATE=success amicus start --model gemini --prompt "test"    # Update succeeds
AMICUS_MOCK_UPDATE=error amicus start --model gemini --prompt "test"      # Update fails
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| E2E tests skipped | No `OPENROUTER_API_KEY` | Set the key in env or `~/.config/amicus/.env` |
| CDP connection refused | Wrong port or Chrome conflict | Use `AMICUS_DEBUG_PORT=9224` (not 9222/9223) |
| Electron E2E skipped | `electron` not installed | `npm install` (it's a devDependency) |
| Linux E2E crash | No X server | Install Xvfb: `apt-get install xvfb` |
| Jest ESM error | Dynamic import in test | Use `tests/helpers/start-server.js` child process |
| `waitForSelector` timeout | Element not rendered yet | Increase timeout or check selector name |
| Screenshot empty/small | Window not created | Verify `AMICUS_HEADLESS_TEST=1` is set |
| Stale CDP target ID | Electron restarted | Always use `CdpClient.toolbar()` factory (retries) |
