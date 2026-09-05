# Contributing to Amicus

Thanks for helping! Amicus is an upgraded MIT fork of
[Claude Sidecar](https://github.com/jrenaldi79/sidecar) (see `NOTICE`); the engine, council
skill, and docs are all maintained in this monorepo.

## Dev setup

```bash
git clone https://github.com/BourbonDog/amicus.git
cd amicus
npm install --ignore-scripts --omit=optional   # IMPORTANT — see warning below
npm run setup-hooks                            # wires git hooks (postinstall is skipped by --ignore-scripts)
```

> **Why `--ignore-scripts`:** a bare `npm install` runs `scripts/postinstall.js`, which mutates
> your GLOBAL Claude config — it registers the amicus MCP server in `~/.claude.json` and Claude
> Desktop, and copies the skills into `~/.claude/skills/`. That's what end users want; as a
> contributor you usually don't.

**Electron (optional, GUI work only):**

```bash
node node_modules/electron/install.js
```

## Gates (enforced by hooks)

Pre-commit: lint-staged (eslint on staged `src/**/*.js`) → secret scan → 300-line file-size cap
(`scripts/check-file-sizes.js`; grandfathered files listed there) → CLAUDE.md marker regen
(auto-staged) → docs-drift warning. Pre-push: the unit suite must be green (`.test-passed` cache).
Hooks fire in the clone **and** in linked worktrees (`core.hooksPath=.husky`).

Post-commit isn't a gate — it can't block anything: it rebuilds the graphify knowledge graph in
the background (code files only, no LLM). No-op if graphify isn't installed — prints one
harmless stderr line and returns; set `GRAPHIFY_SKIP_HOOK=1` to disable it outright. Doesn't
fire in linked worktrees, by design. graphify is an optional Python tool (`uv tool install
"graphifyy[mcp]"`), not an npm dependency, so `npm run graphify:index` — a full rebuild, ~24 min
and ~1.7M input tokens via your Claude subscription — is `command not found` without it.

## Tests

```bash
npm test                       # unit suite (the green gate)
npm run test:integration       # integration tier, keyless — free, ~10s plus the ~15s engine-flag canary, paid suites skip
npm run test:integration:live  # integration tier with real keys — SPENDS MONEY
npm run lint
```

E2E tests that talk to real models skip without `OPENROUTER_API_KEY`. `test:integration` guarantees
that by scrubbing credentials before jest starts, so it is safe to run anywhere; CI runs it keyless on
every push. The paid tier runs only via the manually dispatched `integration-live.yml` workflow. The agentic eval system
lives in `evals/` (see `evals/README.md`). Full testing guide: `docs/testing.md`.

## UI testing via Chrome DevTools Protocol

Electron UI features are verified against the real running app over CDP (no DOM mocks): launch
with `AMICUS_DEBUG_PORT=9223`, discover targets at `http://127.0.0.1:9223/json`, evaluate JS in
the renderer, screenshot via `Page.captureScreenshot`. Mock states: `AMICUS_MOCK_UPDATE=available`
etc. Full reference: `docs/electron-testing.md`.

## Pull requests

- Branch from `main`; keep PRs focused.
- Conventional-commit style subjects (`feat:`, `fix:`, `docs:` …).
- Every PR gets an automatic Claude code review (OAuth-based) — addressing its findings speeds
  up merge.
- If you use git worktrees, hooks work there too; build in a worktree to keep `main` checkouts
  clean.

## License

MIT. By contributing you agree your contributions are MIT-licensed. Original engine
© 2025 John Renaldi; modifications and the council © 2026 Christian Wagner (see `LICENSE` + `NOTICE`).
