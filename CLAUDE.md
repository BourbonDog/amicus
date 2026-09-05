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
npm test                           # Unit tests (excludes *.integration.test.js) -- the pre-push gate
npm run test:integration           # Integration tier, KEYLESS: credentials scrubbed, paid suites skip (free, ~10s plus the ~15s engine-flag canary)
npm run test:integration:live      # Integration tier with real keys -- SPENDS MONEY (release ritual only)
npm run test:all                   # Unit + integration with real keys -- SPENDS MONEY (not a gate anywhere)
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

## Finding Things in This Repo

Two retrieval tools cover this repo, and they answer different kinds of question.
Prefer them over a grep sweep.

**graphify (MCP, index in `graphify-out/`) -- code STRUCTURE: how things connect.**
Query it *before* grepping for:
- which test suites drive a given source file (blast radius / mutant scope)
- what a function or module reaches, and what reaches it
- the cross-file impact of a change

Do NOT assert a blast radius from where code sits in the tree -- query the graph and
measure it. The post-commit hook refreshes the index; `npm run graphify:index` rebuilds
it from scratch. graphify's MCP tools load on demand, so ask for them explicitly at the
start of a structural task.

**mempalace (MCP, wing `amicus`) -- PROSE and history: why things are the way they are.**
Query it for:
- why a decision was made (BACKLOG.md, CHANGELOG.md, docs/, `.superpowers/sdd/` briefs and reports)
- prior art on a bug, a CI failure class, or a release ritual, before re-deriving it

**Always scope the search to wing `amicus`.** An unscoped search is dominated by a
~250k-drawer room of raw session transcripts and will not surface this repo's docs:
`mempalace search "<question>" --wing amicus`, or pass the wing through the MCP tool.
Re-mine after a release so BACKLOG.md and CHANGELOG.md stay current
(`mempalace mine . --wing amicus`; it is mtime-aware, so re-running is cheap).

Search at the START of work in a linked worktree. Worktree sessions do not inherit this
project's memory directory, so facts already paid for (for example: jest cannot run
inside worktrees) must be retrieved rather than rediscovered.

The generated inventory -- full directory tree and module table -- lives in
[docs/architecture-map.md](docs/architecture-map.md). It is a snapshot of what exists;
the graph answers how it connects.

---

## Code Quality Rules

File size limits (300 lines/file, 50 lines/function) and complexity red flags are defined in the global CLAUDE.md.

### Documentation Sync (HARD RULE)

Any commit that adds, removes, or renames a file in `src/`, `bin/`, or `scripts/` MUST include a CLAUDE.md update in the same commit. The pre-commit hook will warn if CLAUDE.md is not staged alongside tracked file changes.

---

## Git Hooks

Version-controlled in `.husky/` and executed directly by git via `core.hooksPath=.husky`, configured by `scripts/setup-hooks.js` (runs automatically on `npm install` via `prepare`; after a clone with `--ignore-scripts`, run `node scripts/setup-hooks.js` once). Because the committed `.husky/` directory exists in every checkout, hooks also fire in **linked git worktrees** — the husky shim setup this replaces pointed at the generated, gitignored `.husky/_`, which is never checked out in a worktree, so hooks silently never fired there.

**pre-commit (<2s):** lint-staged -> check-secrets (block) -> check-file-sizes (block) -> generate-docs (auto-stage) -> validate-docs (warn)

**pre-push:** `npm test` — the unit suite only (skipped if SHA-cached via `.test-passed`) -> `npm audit` (warn-only). Deliberately NOT `test:all`: that would let the integration tier reach your real credentials and bill you on every push. The integration tier is watched by CI instead — see below.

**Integration tier (`tests/**/*.integration.test.js`):** excluded from `npm test` by `jest.config.js`, so it needs its own rail. Free/keyless run on every push+PR via the `integration` job in `.github/workflows/ci.yml`; paid run on demand via `.github/workflows/integration-live.yml` (`workflow_dispatch`, carries `secrets.OPENROUTER_API_KEY`). `npm run test:integration` goes through `scripts/run-integration-keyless.js`, which strips every provider credential and sandboxes `$HOME`/`%USERPROFILE%` before spawning jest, so the money-spending suites self-skip and the script cannot bill even if a key is present.

**SHA caching:** `posttest` writes HEAD SHA to `.test-passed`. Pre-push skips tests if SHA matches. Invalidated by any new commit. File is gitignored.

**post-commit:** rebuilds the graphify knowledge graph in the background (code files only, no LLM; detached, so it never blocks or fails a commit). No-op if graphify isn't installed — prints one stderr line saying it could not locate a Python with graphify, which is expected and harmless. `GRAPHIFY_SKIP_HOOK=1` disables it. Does not fire in linked worktrees, by design. graphify is an optional Python tool (`uv tool install "graphifyy[mcp]"`), not an npm dependency — `npm run graphify:index` rebuilds the graph from scratch (~24 min, ~1.7M input tokens via your Claude subscription) and is `command not found` without it.

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
The pre-commit hook runs this automatically.

The `tree` and `modules` markers live in [docs/architecture-map.md](docs/architecture-map.md),
not in this file -- `MARKER_TARGETS` in `scripts/generate-docs.js` is the routing table.
See [docs/doc-system.md](docs/doc-system.md) for details.

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
| `AMICUS_IDLE_TIMEOUT` | (mode-dependent) | Blanket override for idle timeout in minutes (all modes). 0 = disabled (Infinity). |
| `AMICUS_IDLE_TIMEOUT_HEADLESS` | 15 | Headless mode idle timeout in minutes |
| `AMICUS_IDLE_TIMEOUT_INTERACTIVE` | 60 | Interactive mode idle timeout in minutes |
| `AMICUS_IDLE_TIMEOUT_SERVER` | 30 | Shared server "no sessions" timeout in minutes |
| `AMICUS_MAX_SESSIONS` | 20 | Max concurrent sessions on shared server |
| `AMICUS_REQUEST_TIMEOUT` | 5 | Stuck-stream timeout in minutes |
| `AMICUS_SHARED_SERVER` | 1 | Set to 0 to disable shared server (fall back to per-process) |

### Gotchas

- `AMICUS_IDLE_TIMEOUT=0` means `Infinity` (timer never set), not zero-ms timeout
- Session lock files live at `<session_dir>/session.lock`. Delete manually if stuck with "session already active" error
- `AMICUS_SHARED_SERVER=0` disables shared server and falls back to per-process spawning

---

## Agent Documentation

GEMINI.md and AGENTS.md are symlinks to CLAUDE.md -- no sync needed.

---

## Docs Map

- [docs/usage.md](docs/usage.md) - CLI, MCP tools, agent types, evals
- [docs/architecture.md](docs/architecture.md) - Data flow, fold mechanism, Electron BrowserView
- [docs/architecture-map.md](docs/architecture-map.md) - Generated directory tree and module table
- [docs/testing.md](docs/testing.md) - Testing strategy, tiers, CDP, UI testing
- [docs/doc-system.md](docs/doc-system.md) - Auto-generation markers, cross-links
- [docs/CITATIONS.md](docs/CITATIONS.md) - Citing one file from another; the citation gate
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
- [skills/second-opinion/SEAT-BRIEFS.md](skills/second-opinion/SEAT-BRIEFS.md) — optional council element briefs (critic seat, lenses, debate mode, verdict scale)
- [skills/second-opinion/COUNCIL-DESIGN.md](skills/second-opinion/COUNCIL-DESIGN.md) — council design spec
