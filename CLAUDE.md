# CLAUDE.md
<!-- Last updated: 2026-03-10 -->

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Amicus** is a multi-model subagent tool that extends Claude Code with the ability to spawn parallel conversations with different LLMs (Gemini, GPT-4, o3, etc.) and fold the results back into the main context.

### Core Features

- **Fork & Fold Workflow**: Spawn specialized models for deep exploration, fold summaries back
- **Multi-Model Routing**: Use the right model for the job (Gemini's large context, o3's reasoning, GPT-4's coding)
- **Clean Context**: Isolate deep explorations to parallel sessions, keep main conversation focused
- **Async-Safe Operations**: File conflict detection and context drift warnings
- **Session Persistence**: Resume, continue, or read previous sessions

### Key Value Proposition

1. **Right model for the job** - Route tasks to specialized models
2. **Keep context clean** - Isolate deep explorations
3. **Work in parallel** - Background execution with Ctrl+B
4. **Safe async** - Conflict and drift detection

---

## Essential Commands

### Development
```bash
npm start                    # Run amicus CLI (interactive)
npm run lint                 # Run ESLint
```

### CLI
```bash
amicus start --model gemini --prompt "..."  # Start a headless session
amicus fanout --models g4o,gemini --prompt "..." --json  # Multi-model fanout wave
amicus models                              # List available models
amicus models --search gpt                # Filter catalog
amicus read <taskId>                      # Read session output
amicus list                               # List sessions
```

### Testing
```bash
npm test                           # Unit tests (excludes *.integration.test.js)
npm run test:integration           # Integration tests only (real LLM, costs tokens)
npm run test:all                   # Unit + integration (used by pre-push)
npm test tests/context.test.js     # Single file (preferred during dev)
npm test -- --coverage             # Coverage report
```

### Enforcement
```bash
node scripts/check-secrets.js        # Scan staged files for secrets
node scripts/check-file-sizes.js     # Check staged files against 300-line limit
node scripts/generate-docs.js        # Regenerate auto sections in CLAUDE.md
node scripts/generate-docs.js --check # Verify auto sections are current (CI mode)
node scripts/validate-docs.js        # Pre-commit: warn if CLAUDE.md may need update
node scripts/validate-docs.js --full # Full: compare CLAUDE.md against codebase
npm run validate-docs                # Alias for --full mode
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code                            │
│                            │                                 │
│                  amicus CLI / MCP Server                    │
│      ┌──────────────┬────────┴────────────────────┐         │
│      │              │                             │         │
│      ▼              ▼                             ▼         │
│  Interactive    Headless Mode      MCP (amicus mcp)        │
│  (Electron)    (OpenCode API)     (stdio transport)         │
│      │              │              Cowork / Desktop          │
│      └──────────────┴──────────────┘                        │
│                     │                                        │
│        Summary returned to Claude Code                       │
└─────────────────────────────────────────────────────────────┘
```

For detailed data flow, fold mechanism, and Electron BrowserView architecture, see [docs/architecture.md](docs/architecture.md).

---

## Directory Structure

<!-- AUTO:tree -->
bin/
├── amicus
└── amicus.js  # Amicus CLI Entry Point
src/
├── council/
│   ├── findings.js
│   ├── ledger.js
│   ├── report-html.js
│   ├── report.js
│   ├── tally.js
│   └── verdict.js
├── design/
│   ├── fonts/
│   │   ├── IBMPlexMono-400.ttf
│   │   ├── IBMPlexMono-500.ttf
│   │   ├── IBMPlexMono-600.ttf
│   │   ├── Outfit-300.ttf
│   │   ├── Outfit-400.ttf
│   │   ├── Outfit-500.ttf
│   │   ├── Outfit-600.ttf
│   │   ├── Outfit-700.ttf
│   │   └── Outfit-800.ttf
│   ├── tokens.css
│   └── tokens.js
├── prompts/
│   └── cowork-agent-prompt.js  # Cowork Agent Prompt
├── sidecar/
│   ├── budget.js
│   ├── context-builder.js  # Context Builder Module
│   ├── continue.js  # Sidecar Continue Operations - Handles continuing from previous sessions
│   ├── conversation-mirror.js
│   ├── crash-handler.js  # Crash Handler - Updates metadata to 'error' on uncaught exceptions
│   ├── fanout-leg.js
│   ├── fanout-output.js
│   ├── fanout.js
│   ├── interactive-mirror.js
│   ├── interactive.js  # Sidecar Interactive Mode - Electron GUI session management
│   ├── models.js  # `amicus models` (F5) — list/search the catalog, refresh it, audit aliases.
│   ├── progress.js  # Sidecar Progress Reader
│   ├── read.js  # Sidecar Read Operations Module
│   ├── resume.js  # Sidecar Resume Operations - Handles resuming previous sidecar sessions
│   ├── session-finalize.js
│   ├── session-utils.js  # Sidecar Session Utilities - Shared functionality for session management
│   ├── setup-window.js  # Setup Window Launcher
│   ├── setup.js  # Sidecar Setup Wizard
│   ├── start.js  # Sidecar Start Operations - Handles starting new sidecar sessions
│   └── wave-progress.js
├── utils/
│   ├── activity-poller.js
│   ├── agent-mapping.js  # Agent Mapping Module
│   ├── alias-audit.js  # Alias Audit (F5) — report + suggest, never auto-repair.
│   ├── alias-resolver.js  # Alias Resolver Utilities
│   ├── api-key-store.js  # API Key Store — reading, saving, and validating API keys.
│   ├── api-key-validation.js  # API Key Validation — test API keys against provider endpoints.
│   ├── auth-json.js  # Auth JSON Reader
│   ├── config.js  # Amicus Config Module
│   ├── curated-models.js  # Family definitions + pinned fallbacks for the wizard model picker (v2).
│   ├── env-compat.js  # Environment-variable compatibility shim (Amicus rebrand).
│   ├── env-loader.js  # Credential Loader
│   ├── error-doc.js
│   ├── free-models.js  # Free OpenRouter model detection (Unit A).
│   ├── idle-watchdog.js  # IdleWatchdog - BUSY/IDLE state machine with self-terminating timer.
│   ├── input-validators.js
│   ├── lifecycle.js
│   ├── logger.js  # Structured Logger Module
│   ├── mcp-discovery.js  # MCP Discovery - Discovers MCP servers from parent LLM configuration
│   ├── mcp-validators.js  # MCP Validators
│   ├── model-catalog.js  # OpenRouter model catalog cache (F3 #18 / F5 foundation).
│   ├── model-fetcher.js  # Model Fetcher
│   ├── model-validator.js  # Model Validator
│   ├── path-setup.js
│   ├── port-pid.js  # Cross-platform listener-PID lookup.
│   ├── pricing.js
│   ├── project-path.js  # Canonical project-path helper.
│   ├── project-root-sanity.js
│   ├── prompt-source.js
│   ├── quick-picks.js  # Quick-pick resolution (wizard Step 2) — resolves each curated family to
│   ├── remediation-hints.js
│   ├── result-schema.js
│   ├── server-setup.js  # Server Setup Utilities
│   ├── session-abort.js  # Session abort utilities: signal handler installation and terminal metadata writes.
│   ├── session-index.js  # Global session index (issue #40).
│   ├── session-lock.js
│   ├── session-path.js  # Session path resolution.
│   ├── shared-server.js
│   ├── start-helpers.js  # Start Command Helpers
│   ├── thinking-validators.js  # Thinking Level Validators
│   ├── update-notifier-loader.js  # update-notifier Loader
│   ├── updater.js  # Updater Module
│   ├── validators.js  # Input Validators
│   └── version-info.js  # After an `npm i -g amicus` upgrade, a long-lived MCP server process keeps
├── cli-handlers-council.js
├── cli-handlers-doctor.js
├── cli-handlers-run.js  # CLI Run Handlers (WS-2 extraction)
├── cli-handlers.js  # CLI Command Handlers
├── cli.js  # CLI Argument Parser
├── conflict.js  # File Conflict Detection Module
├── context-compression.js  # Context Compression Module
├── context.js  # Context Filtering Module
├── drift.js  # Context Drift Detection Module
├── environment.js  # Environment Detection Module
├── headless.js  # Headless Mode Runner
├── index.js  # Amicus - Main Module
├── jsonl-parser.js  # JSONL Parser
├── mcp-server.js  # @module mcp-server — Amicus MCP Server (stdio transport)
├── mcp-tools.js  # MCP Tool Definitions for Amicus
├── opencode-client.js  # OpenCode SDK Client Wrapper
├── prompt-builder.js  # System Prompt Builder
├── session-manager.js  # Session Manager Module
└── session.js  # Session Resolver
electron/
├── assets/
│   ├── icon.png
│   └── icon.svg
├── fold.js  # Fold Logic
├── ipc-setup.js  # IPC Setup Handlers
├── load-failsafe.js  # Load Failsafe
├── main.js  # Amicus Electron Shell - v3
├── preload-setup.js  # Sidecar Preload - Setup Mode
├── preload.js  # Sidecar Preload - v3 Minimal
├── session-route.js  # Web-UI session route builder (#45).
├── setup-ui-alias-script.js  # Setup UI - Alias Editor Script
├── setup-ui-aliases.js  # Setup UI - Alias Editor
├── setup-ui-council.js  # Setup UI — Free OpenRouter council picker (mounted on the Models step).
├── setup-ui-keys-script.js  # Setup UI - Step 1 Key Management Script
├── setup-ui-keys.js  # Setup UI - Step 1: API Keys
├── setup-ui-model.js  # Setup UI - Step 2: Default Model Selection
├── setup-ui-styles.js  # Setup UI - Shared CSS Styles (clay/gold token-driven)
├── setup-ui.js  # Setup UI - Wizard Orchestrator: API Keys → Models → Aliases → Review
├── summary.js  # Summary Generation via OpenCode API
├── toolbar.js  # Amicus Toolbar HTML Builder
└── window-position.js  # Window Position Calculator
scripts/
├── benchmark-api-direct.js  # Direct OpenRouter API Benchmark for Thinking Levels
├── benchmark-thinking.js  # Benchmark Thinking Levels
├── check-file-sizes.js  # File size enforcement for the pre-commit hook and the whole-tree CI gate (--all).
├── check-global-install.js  # CI assertion (Windows install-smoke job, #35): after a REAL global install
├── check-html.js
├── check-secrets.js  # Secret detection for the pre-commit hook and the whole-tree CI gate (--all).
├── check-tarball-lifecycle.js  # CI guard: assert every script referenced by an npm *lifecycle* hook actually
├── check-ui.js
├── debug-cdp.js
├── eval-with-monitoring.sh
├── generate-docs-helpers.js  # Helper functions for generate-docs.js.
├── generate-docs.js  # Auto-generate CLAUDE.md sections from source code.
├── generate-icon.js  # Generate app icon PNG from SVG source.
├── integration-test.sh
├── mark-test-passed.js  # Writes the current git HEAD SHA to .test-passed for the pre-push SHA cache
├── postinstall.js  # Post-install script for amicus
├── setup-hooks.js  # Configure git to run the version-controlled hooks in .husky/.
├── test-tools.sh
├── validate-docs.js  # CLAUDE.md drift detection script.
├── validate-thinking.js
└── validate-ui.js
evals/
├── tests/
│   ├── claude_runner.test.js
│   ├── evaluator.test.js
│   ├── result_writer.test.js
│   └── transcript_parser.test.js
├── claude_runner.js
├── eval_tasks.json
├── evaluator.js
├── README.md
├── result_writer.js
├── run_eval.js  # Sidecar Agentic Eval Runner
└── transcript_parser.js  # Parse Claude Code stream-json output into structured transcript.
<!-- /AUTO:tree -->

---

## Key Modules

<!-- AUTO:modules -->
| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `cli-handlers-council.js` |  | `handleCouncil()` |
| `cli-handlers-doctor.js` |  | `runDoctorChecks()`, `handleDoctor()`, `MAX_CATALOG_AGE_MS()` |
| `cli-handlers-run.js` | CLI Run Handlers (WS-2 extraction) | `handleStart()`, `handleFanout()`, `handleRead()` |
| `cli-handlers.js` | CLI Command Handlers | `handleSetup()`, `handleAbort()`, `handleUpdate()`, `handleMcp()`, `handleKey()` |
| `cli.js` | CLI Argument Parser | `parseArgs()`, `validateStartArgs()`, `getUsage()`, `DEFAULTS()` |
| `conflict.js` | File Conflict Detection Module | `detectConflicts()`, `formatConflictWarning()` |
| `context-compression.js` | Context Compression Module | `compressContext()`, `estimateTokenCount()`, `buildPreamble()`, `DEFAULT_TOKEN_LIMIT()` |
| `context.js` | Context Filtering Module | `filterContext()`, `parseDuration()`, `estimateTokens()`, `takeLastNTurns()` |
| `drift.js` | Context Drift Detection Module | `calculateDrift()`, `formatDriftWarning()`, `countTurnsSince()`, `isDriftSignificant()` |
| `environment.js` | Environment Detection Module | `inferClient()`, `getSessionRoot()`, `detectEnvironment()`, `VALID_CLIENTS()` |
| `headless.js` | Headless Mode Runner | `runHeadless()`, `waitForServer()`, `withTimeout()`, `extractSummary()`, `formatFoldOutput()` |
| `index.js` | Amicus - Main Module | `startAmicus()`, `startSidecar()`, `listAmicus()`, `listSidecars()`, `resumeAmicus()` |
| `jsonl-parser.js` | JSONL Parser | `parseJSONLLine()`, `readJSONL()`, `extractTimestamp()`, `formatMessage()`, `formatContext()` |
| `mcp-server.js` | @module mcp-server — Amicus MCP Server (stdio transport) | `handlers()`, `startMcpServer()`, `getProjectDir()`, `resolveProjectDir()`, `getClientRoot()` |
| `mcp-tools.js` | MCP Tool Definitions for Amicus | `getTools()`, `getGuideText()`, `safeTaskId()`, `safeModel()` |
| `opencode-client.js` | OpenCode SDK Client Wrapper | `INSUFFICIENT_CREDITS_REASON()`, `providerErrorReason()`, `parseModelString()`, `createClient()`, `createSession()` |
| `prompt-builder.js` | System Prompt Builder | `buildSystemPrompt()`, `buildPrompts()`, `buildEnvironmentSection()`, `getSummaryTemplate()`, `SUMMARY_TEMPLATE()` |
| `session-manager.js` | Session Manager Module | `createSession()`, `updateSession()`, `getSession()`, `saveConversation()`, `saveSummary()` |
| `session.js` | Session Resolver | `encodeProjectPath()`, `decodeProjectPath()`, `getSessionDirectory()`, `getSessionId()`, `resolveSession()` |
| `council/findings.js` |  | `validateFindings()`, `SEVERITIES()` |
| `council/ledger.js` |  | `buildLedgerRows()`, `appendRun()`, `deriveReliability()`, `LEDGER_FILE()`, `LEDGER_SCHEMA_VERSION()` |
| `council/report-html.js` |  | `renderHtml()` |
| `council/report.js` |  | `buildReport()`, `toModel()`, `TIER_ORDER()`, `SYMBOL()` |
| `council/tally.js` |  | `assignTier()`, `computeStreetCred()`, `tally()`, `COUNCIL_SCHEMA_VERSION()` |
| `council/verdict.js` |  | `buildVerdict()`, `writeVerdictAtomic()`, `VERDICT_SCHEMA_VERSION()` |
| `design/tokens.js` |  | `tokenCss()`, `TOKENS()` |
| `prompts/cowork-agent-prompt.js` | Cowork Agent Prompt | `buildCoworkAgentPrompt()` |
| `sidecar/budget.js` |  | `checkBudget()`, `formatBudgetError()`, `DEFAULT_MAX_COST_PER_MTOK()`, `ASSUMED_OUTPUT_TOKENS()` |
| `sidecar/context-builder.js` | Context Builder Module | `buildContext()`, `parseDuration()`, `resolveSessionFile()`, `applyContextFilters()`, `findCoworkSession()` |
| `sidecar/continue.js` | Sidecar Continue Operations - Handles continuing from previous sessions | `loadPreviousSession()`, `buildContinuationContext()`, `createContinueSessionMetadata()`, `continueSidecar()` |
| `sidecar/conversation-mirror.js` |  | `createMirrorState()`, `mirrorMessages()`, `logMessage()` |
| `sidecar/crash-handler.js` | Crash Handler - Updates metadata to 'error' on uncaught exceptions | `installCrashHandler()` |
| `sidecar/fanout-leg.js` |  | `legStatusFromResult()`, `writeLegPatch()`, `runLeg()` |
| `sidecar/fanout-output.js` |  | `formatWaveHuman()`, `fmtDuration()` |
| `sidecar/fanout.js` |  | `parseModelsList()`, `deriveLegIds()`, `validateFanoutModels()`, `DEFAULT_MAX_LEGS()`, `runFanout()` |
| `sidecar/interactive-mirror.js` |  | `startInteractiveMirror()` |
| `sidecar/interactive.js` | Sidecar Interactive Mode - Electron GUI session management | `getElectronPath()`, `checkElectronAvailable()`, `buildElectronEnv()`, `handleElectronProcess()`, `runInteractive()` |
| `sidecar/models.js` | `amicus models` (F5) — list/search the catalog, refresh it, audit aliases. | `handleModels()`, `buildFallbackDriftReport()` |
| `sidecar/progress.js` | Sidecar Progress Reader | `readProgress()`, `writeProgress()`, `extractLatest()`, `computeLastActivity()`, `STAGE_LABELS()` |
| `sidecar/read.js` | Sidecar Read Operations Module | `formatAge()`, `enumerateSessions()`, `listSidecars()`, `readSidecar()` |
| `sidecar/resume.js` | Sidecar Resume Operations - Handles resuming previous sidecar sessions | `loadSessionMetadata()`, `loadInitialContext()`, `checkFileDrift()`, `buildDriftWarning()`, `buildResumeUserMessage()` |
| `sidecar/session-finalize.js` |  | `resolveTerminalState()`, `finalizeHeadlessResult()` |
| `sidecar/session-utils.js` | Sidecar Session Utilities - Shared functionality for session management | `HEARTBEAT_INTERVAL()`, `SessionPaths()`, `saveInitialContext()`, `finalizeSession()`, `outputSummary()` |
| `sidecar/setup-window.js` | Setup Window Launcher | `launchSetupWindow()` |
| `sidecar/setup.js` | Sidecar Setup Wizard | `addAlias()`, `createDefaultConfig()`, `deriveFreeAlias()`, `detectApiKeys()`, `runFreeCouncilBranch()` |
| `sidecar/start.js` | Sidecar Start Operations - Handles starting new sidecar sessions | `generateTaskId()`, `createSessionMetadata()`, `buildMcpConfig()`, `checkElectronAvailable()`, `runInteractive()` |
| `sidecar/wave-progress.js` |  | `formatWaveProgress()`, `readLegState()`, `createWaveHeartbeat()`, `WAVE_HEARTBEAT_INTERVAL()` |
| `utils/activity-poller.js` |  | `createActivityPoller()`, `killIfAlive()` |
| `utils/agent-mapping.js` | Agent Mapping Module | `PRIMARY_AGENTS()`, `OPENCODE_AGENTS()`, `HEADLESS_SAFE_AGENTS()`, `mapAgentToOpenCode()`, `isValidAgent()` |
| `utils/alias-audit.js` | Alias Audit (F5) — report + suggest, never auto-repair. | `collectAliasSources()`, `findStaleAliases()`, `suggestReplacements()` |
| `utils/alias-resolver.js` | Alias Resolver Utilities | `applyDirectApiFallback()`, `autoRepairAlias()` |
| `utils/api-key-store.js` | API Key Store — reading, saving, and validating API keys. | `getEnvPath()`, `loadEnvEntries()`, `readApiKeys()`, `readApiKeyHints()`, `readApiKeyValues()` |
| `utils/api-key-validation.js` | API Key Validation — test API keys against provider endpoints. | `validateApiKey()`, `validateOpenRouterKey()`, `checkOpenRouterCredit()`, `OPENROUTER_NO_CREDIT_WARNING()`, `OPENROUTER_FREE_TIER_WARNING()` |
| `utils/auth-json.js` | Auth JSON Reader | `readAuthJsonKeys()`, `importFromAuthJson()`, `checkAuthJson()`, `removeFromAuthJson()`, `AUTH_JSON_PATH()` |
| `utils/config.js` | Amicus Config Module | `getConfigDir()`, `migrateLegacyConfigDir()`, `getConfigPath()`, `loadConfig()`, `saveConfig()` |
| `utils/curated-models.js` | Family definitions + pinned fallbacks for the wizard model picker (v2). | `getFamilies()`, `toDefaultAliases()`, `listCuratedRoutes()` |
| `utils/env-compat.js` | Environment-variable compatibility shim (Amicus rebrand). | `getCompatEnv()` |
| `utils/env-loader.js` | Credential Loader | `loadCredentials()` |
| `utils/error-doc.js` |  | `ERROR_CODES()`, `buildErrorDoc()`, `failJson()` |
| `utils/free-models.js` | Free OpenRouter model detection (Unit A). | `isFreeModel()`, `listFreeModels()`, `suggestFreeCouncil()`, `PINNED_FREE_MODELS()` |
| `utils/idle-watchdog.js` | IdleWatchdog - BUSY/IDLE state machine with self-terminating timer. | `IdleWatchdog()`, `resolveTimeout()` |
| `utils/input-validators.js` |  | `validateStartInputs()`, `findSimilar()` |
| `utils/lifecycle.js` |  | `isOneShotCommand()`, `armExitWatchdog()`, `ONE_SHOT_COMMANDS()` |
| `utils/logger.js` | Structured Logger Module | `logger()`, `LOG_LEVELS()` |
| `utils/mcp-discovery.js` | MCP Discovery - Discovers MCP servers from parent LLM configuration | `discoverParentMcps()`, `discoverClaudeCodeMcps()`, `discoverCoworkMcps()`, `normalizeMcpJson()` |
| `utils/mcp-validators.js` | MCP Validators | `validateMcpSpec()`, `validateMcpConfigFile()` |
| `utils/model-catalog.js` | OpenRouter model catalog cache (F3 #18 / F5 foundation). | `getCatalog()`, `refreshCatalog()`, `catalogPath()`, `getCatalogInfo()`, `readCache()` |
| `utils/model-fetcher.js` | Model Fetcher | `fetchModelsFromProvider()`, `fetchAllModels()`, `providersToFetch()`, `groupModelsByFamily()`, `ANTHROPIC_MODELS()` |
| `utils/model-validator.js` | Model Validator | `validateDirectModel()`, `filterRelevantModels()`, `normalizeModelId()`, `validateAgainstCatalog()`, `warnIfNotInCatalog()` |
| `utils/path-setup.js` |  | `ensureNodeModulesBinInPath()` |
| `utils/port-pid.js` | Cross-platform listener-PID lookup. | `findListenerPid()` |
| `utils/pricing.js` |  | `emptyUsageTotals()`, `sumPerMessageUsage()`, `lookupPricing()`, `resolveLegCost()`, `resolveUsage()` |
| `utils/project-path.js` | Canonical project-path helper. | `canonicalProjectPath()` |
| `utils/project-root-sanity.js` |  | `assessProjectRoot()`, `looksLikeInstallDir()`, `INSTALL_PATTERNS()` |
| `utils/prompt-source.js` |  | `resolvePromptSource()` |
| `utils/quick-picks.js` | Quick-pick resolution (wizard Step 2) — resolves each curated family to | `compareIdsDesc()`, `pickCurrent()`, `resolveQuickPicks()`, `toLiveSeedAliases()` |
| `utils/remediation-hints.js` |  |  |
| `utils/result-schema.js` |  | `SCHEMA_VERSION()`, `TERMINAL_STATUSES()`, `durationBetween()`, `statusFromResult()`, `buildRunResult()` |
| `utils/server-setup.js` | Server Setup Utilities | `DEFAULT_PORT()`, `isPortInUse()`, `getPortPid()`, `killPortProcess()`, `ensurePortAvailable()` |
| `utils/session-abort.js` | Session abort utilities: signal handler installation and terminal metadata writes. | `markTerminal()`, `markAborted()`, `installSignalAbort()`, `idleBackstopTeardown()` |
| `utils/session-index.js` | Global session index (issue #40). | `INDEX_FILENAME()`, `recordSession()`, `lookupSessionProject()` |
| `utils/session-lock.js` |  | `acquireLock()`, `releaseLock()`, `isLockStale()`, `isPidAlive()` |
| `utils/session-path.js` | Session path resolution. | `safeSessionDir()`, `safeSessionDirUnder()` |
| `utils/shared-server.js` |  | `SharedServerManager()` |
| `utils/start-helpers.js` | Start Command Helpers | `resolveModelFromArgs()`, `validateFallbackModel()` |
| `utils/thinking-validators.js` | Thinking Level Validators | `MODEL_THINKING_SUPPORT()`, `getSupportedThinkingLevels()`, `validateThinkingLevel()` |
| `utils/update-notifier-loader.js` | update-notifier Loader | `loadUpdateNotifier()` |
| `utils/updater.js` | Updater Module | `initUpdateCheck()`, `getUpdateInfo()`, `notifyUpdate()`, `performUpdate()` |
| `utils/validators.js` | Input Validators | `VALID_AGENT_MODES()`, `PROVIDER_KEY_MAP()`, `MODEL_THINKING_SUPPORT()`, `TASK_ID_PATTERN()`, `validateTaskId()` |
| `utils/version-info.js` | After an `npm i -g amicus` upgrade, a long-lived MCP server process keeps | `RUNNING_VERSION()`, `readOnDiskVersion()`, `versionWarning()`, `PKG_PATH()` |
<!-- /AUTO:modules -->

---

## Code Quality Rules

File size limits (300 lines/file, 50 lines/function) and complexity red flags are defined in the global CLAUDE.md.

### Documentation Sync (HARD RULE)

Any commit that adds, removes, or renames a file in `src/`, `bin/`, or `scripts/` MUST include a CLAUDE.md update in the same commit. The pre-commit hook will warn if CLAUDE.md is not staged alongside tracked file changes.

---

## Git Hooks

Version-controlled in `.husky/` and executed directly by git via `core.hooksPath=.husky`, configured by `scripts/setup-hooks.js` (runs automatically on `npm install` via `prepare`; after a clone with `--ignore-scripts`, run `node scripts/setup-hooks.js` once). Because the committed `.husky/` directory exists in every checkout, hooks also fire in **linked git worktrees** — the husky shim setup this replaces pointed at the generated, gitignored `.husky/_`, which is never checked out in a worktree, so hooks silently never fired there.

**pre-commit (<2s):** lint-staged -> check-secrets (block) -> check-file-sizes (block) -> generate-docs (auto-stage) -> validate-docs (warn)

**pre-push:** `npm run test:all` (skipped if SHA-cached via `.test-passed`) -> `npm audit` (warn-only)

**SHA caching:** `posttest` writes HEAD SHA to `.test-passed`. Pre-push skips tests if SHA matches. Invalidated by any new commit. File is gitignored.

---

## Structured Logging

Use `src/utils/logger.js` (levels: error/warn/info/debug). Logs go to stderr to avoid polluting stdout (used for session summary output). See global CLAUDE.md for general logging guidelines.

---

## JavaScript Standards

- **ES2022+** features (top-level await, private fields)
- **ESM modules** (`"type": "module"` in package.json)
- **ESLint strict mode** (no var, eqeqeq: always, curly: all, semi: always)
- **JSDoc comments** for all public APIs

### ESLint Configuration

```javascript
// .eslintrc.js
module.exports = {
  env: { node: true, es2022: true, jest: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'semi': ['error', 'always'],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

### JSDoc + TypeScript Declarations

See [docs/jsdoc-setup.md](docs/jsdoc-setup.md) for JSDoc patterns, `.d.ts` generation, and pre-publish workflow.

---

## Development Workflow Checklists

### Before Starting New Work

- [ ] Check file sizes: `find src -name "*.js" -exec wc -l {} + | sort -n`
- [ ] Review CLAUDE.md for current architecture
- [ ] Check test coverage: `npm test -- --coverage`

### During Development

- [ ] Write tests first (TDD)
- [ ] Monitor file growth (<300 lines)
- [ ] Use structured logging (not console.log)
- [ ] Single responsibility per function

### Before Committing

- [ ] Run `npm test` - all tests passing
- [ ] Run `npm run lint` - no lint errors
- [ ] **If UI changed**: Launch Electron with `AMICUS_DEBUG_PORT=9223`, inspect via CDP, take screenshot to verify
- [ ] Update CLAUDE.md if architecture changed

---

## Code Review Checklist

- [ ] Tests written first (TDD) and passing
- [ ] No file >300 lines
- [ ] No function >50 lines
- [ ] Structured logging (not console.log)
- [ ] JSDoc comments on public APIs
- [ ] Documentation updated if architecture changed

---

## Auto-Generated Sections

Sections between `<!-- AUTO:name -->` markers are maintained by `scripts/generate-docs.js`.
Do NOT edit these by hand. To update: `node scripts/generate-docs.js`.
The pre-commit hook runs this automatically. See [docs/doc-system.md](docs/doc-system.md) for details.

---

## Critical Gotchas

- **Model format**: Must be `{ providerID, modelID }` object, not string. String causes 400.
- **ESM**: SDK is ESM-only. Use dynamic `import()`, not `require()`.
- **Headless agent**: Default agent in `--no-ui` mode is `build` (not `chat`). `chat` stalls.
- **Jest + ESM**: Can't mock dynamic imports without `--experimental-vm-modules`. Use child process.
- **contextBridge**: Does not work with `data:` URLs. Toolbar uses `executeJavaScript()` polling.

---

## Process Lifecycle Management

Amicus processes self-terminate after inactivity via IdleWatchdog. MCP sessions use a shared multiplexed server instead of per-session processes.

### Environment Variables

| Env Var | Default | Description |
|---------|---------|-------------|
| `SIDECAR_IDLE_TIMEOUT` | (mode-dependent) | Blanket override for idle timeout in minutes (all modes). 0 = disabled (Infinity). |
| `SIDECAR_IDLE_TIMEOUT_HEADLESS` | 15 | Headless mode idle timeout in minutes |
| `SIDECAR_IDLE_TIMEOUT_INTERACTIVE` | 60 | Interactive mode idle timeout in minutes |
| `SIDECAR_IDLE_TIMEOUT_SERVER` | 30 | Shared server "no sessions" timeout in minutes |
| `SIDECAR_MAX_SESSIONS` | 20 | Max concurrent sessions on shared server |
| `SIDECAR_REQUEST_TIMEOUT` | 5 | Stuck-stream timeout in minutes |
| `SIDECAR_SHARED_SERVER` | 1 | Set to 0 to disable shared server (fall back to per-process) |

### Gotchas

- `SIDECAR_IDLE_TIMEOUT=0` means `Infinity` (timer never set), not zero-ms timeout
- Session lock files live at `<session_dir>/session.lock`. Delete manually if stuck with "session already active" error
- `SIDECAR_SHARED_SERVER=0` disables shared server and falls back to per-process spawning

---

## Agent Documentation

GEMINI.md and AGENTS.md are symlinks to CLAUDE.md -- no sync needed.

---

## Docs Map

- [docs/usage.md](docs/usage.md) - CLI, MCP tools, agent types, evals
- [docs/architecture.md](docs/architecture.md) - Data flow, fold mechanism, Electron BrowserView
- [docs/testing.md](docs/testing.md) - Testing strategy, tiers, CDP, UI testing
- [docs/doc-system.md](docs/doc-system.md) - Auto-generation markers, cross-links
- [docs/opencode-integration.md](docs/opencode-integration.md) - OpenCode SDK, agent mapping
- [docs/configuration.md](docs/configuration.md) - Env vars, dependencies, model names
- [docs/publishing.md](docs/publishing.md) - npm publishing
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/electron-testing.md](docs/electron-testing.md) - CDP patterns
- [docs/jsdoc-setup.md](docs/jsdoc-setup.md) - JSDoc, `.d.ts` generation
- [evals/README.md](evals/README.md) - Agentic eval system
- docs/superpowers/plans/ — design plans and specs
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor guide
- [CHANGELOG.md](CHANGELOG.md) — release history
- [skills/second-opinion/SKILL.md](skills/second-opinion/SKILL.md) — LLM Council skill
- [skills/second-opinion/MODEL-NOTES.md](skills/second-opinion/MODEL-NOTES.md) — per-model operating rules
- [skills/second-opinion/COUNCIL-DESIGN.md](skills/second-opinion/COUNCIL-DESIGN.md) — council design spec
