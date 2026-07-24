# CLI & MCP Usage Reference

## CLI Commands

The `am` alias is interchangeable with `amicus` everywhere.

```bash
# Core workflow
amicus start --model <model> --prompt "<task>"
amicus start --model <model> --prompt-file briefing.md --no-ui --json
amicus fanout --models "gemini,deepseek,gpt" --prompt "Review this" --json
amicus list [--status <filter>] [--all] [--json]
amicus resume <task_id> [--no-ui --json]
amicus continue <task_id> --prompt "Next step..." [--no-ui --json]
amicus read <task_id> [--conversation|--metadata|--json]
amicus status <task_id> [--json]          # One-shot status for a session or wave
amicus abort <task_id> [--json]
amicus abort --all [--json]

# Setup & maintenance
amicus setup                              # Full wizard: keys, default model, aliases
amicus setup --api-keys                   # Open just the API-key step
amicus setup --add-alias fast=google/gemini-3.1-flash-lite-preview  # bare canonical, direct-first
amicus models                             # List the live catalog
amicus models --search gemini             # Filter by substring
amicus models --refresh                   # Force-fetch from provider APIs
amicus models --check                     # Audit aliases against catalog
amicus mcp                                # Start MCP server (stdio transport)
amicus update                             # Update to latest version
amicus doctor [--json] [--fix]            # Diagnose setup; --fix self-heals (e.g. Electron)
amicus spend [--since 7d] [--json]        # Cross-run cost rollup from the spend ledger
amicus key <provider> <key>               # Validate + save one API key (also: --remove / bare list)
amicus provider add|list|test|remove      # Local / OpenAI-compatible servers ($0): Ollama, LM Studio, vLLM
amicus init [--claude] [--desktop]        # Register skills + MCP on demand (postinstall re-run)
amicus council tally <input.json> --json  # Deterministic tiers + street-cred (+ ledger append)
amicus council stats [--json]             # Reviewer reliability from the ledger
amicus council report <verdict.json> [--md|--html]   # Render the council run report
amicus council validate <file> [--json]   # Validate a Stage-1 findings block (exit 0/2/1)
amicus council verdict <tally.json> [--decisions <d.json>] [-o <out.json>] [--render]  # Build + write verdict.json
amicus council run --prompt-file <b.md> --models a,b,c --chair <m> [--json]  # Headless engine: reviews, cross-review, tally, chair verdict
amicus council save <name> --models a,b,c # Save a named council preset (>=2 resolvable members)
amicus council list [--json]              # List saved councils + built-ins (free/budget/frontier)
amicus council show <name> [--json]       # Resolve a council (saved or built-in) and show its members
```

---

## `amicus start` — Launch a Session

```bash
amicus start --model gemini --prompt "Fact-check the auth approach"
amicus start --model opus --prompt-file briefing.md --no-ui --json
amicus start --model deepseek --prompt "Generate tests" --no-ui --timeout 30
```

**All options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--model <model>` | Alias, or a full id: bare `provider/model` (canonical, direct-first) or `openrouter/provider/model` (explicit force-OpenRouter). | config default |
| `--prompt <text>` | Task description. | *(required unless `--prompt-file`)* |
| `--prompt-file <path>` | Read the prompt from a UTF-8 file (XOR `--prompt`). | |
| `--agent <agent>` | OpenCode agent: `Chat`, `Build`, `Plan`. | `Chat` interactive / `Build` headless |
| `--no-ui` | Run headless (autonomous, no window). | off |
| `--json` | Emit the run result as stable JSON (requires `--no-ui`). | off |
| `--timeout <minutes>` | Headless timeout. | 15 |
| `--context-turns <N>` | Max conversation turns to include. | 50 |
| `--context-since <duration>` | Time filter (e.g. `2h`); overrides turns. | |
| `--context-max-tokens <N>` | Max context tokens. | 80000 |
| `--no-context` | Skip parent conversation history. | off |
| `--thinking <level>` | Reasoning effort: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. | model default |
| `--summary-length <length>` | Fold summary verbosity: `brief`, `normal`, `verbose`. | `normal` |
| `--mcp <spec>` | Add an MCP server (`name=url` or `name=command`). | |
| `--mcp-config <path>` | Path to an `opencode.json` with MCP config. | |
| `--no-mcp` | Don't inherit MCP servers from the parent. | off |
| `--exclude-mcp <name>` | Exclude a specific inherited MCP server (repeatable). | |
| `--session-id <id\|current>` | Session to pull context from. | `current` |
| `--cwd <path>` | Project directory. | cwd |
| `--client <type>` | Client context: `code-local`, `code-web`, `cowork`. | `code-local` |
| `--position <pos>` | Window position: `right`, `left`, `center`. | `right` |
| `--fold-shortcut <key>` | Customize the fold keyboard shortcut. | `Cmd/Ctrl+Shift+F` |
| `--opencode-port <port>` | Port override for the OpenCode server. | |
| `--session-dir <path>` | Explicit session-data directory. | |
| `--setup` | Force-open configuration before launching. Does **not** relax the `--prompt`/`--prompt-file` requirement — `start --setup` still fails fast with "Error: --prompt or --prompt-file is required" if neither is given. | |
| `--no-validate-model` | Skip model-catalog validation before launch. | validation on |
| `--gateway <mode>` | Routing override for this launch: `auto` (direct-first), `direct` (require a direct provider key), or `openrouter` (force OpenRouter). Overrides `routing.prefer` for one call. | `auto` |

> Agents: **Chat** auto-approves reads and asks before writes/bash (interactive default); **Build** has full tool access (headless default); **Plan** is read-only analysis. `--agent Chat` is interactive-only and incompatible with `--no-ui`.

**Catalog validation.** For an explicit `--model`, the model is checked against the live catalog before launch — a typo'd name fails fast with same-vendor suggestions. For a model inherited from a previous session (`continue`/`resume` without `--model`), validation is **advisory**: a warning is printed but the session starts anyway. Skip with `--no-validate-model`.

**The fold handoff.** In interactive mode, clicking **FOLD** (or headless completion) is a one-way summary handoff, not a live handback. Mechanically: the model is asked for a structured summary, which is written to the sidecar process's stdout as a `[SIDECAR_FOLD]`-tagged block; the runner that spawned the sidecar captures that stdout and persists it to the session's `summary.md` under the session directory. Your orchestrating agent retrieves it on request — `amicus read <taskId>` (CLI) or the `amicus_read` MCP tool — and the result comes back wrapped in an `<untrusted_sidecar_output>` fence (it's another model's prose entering your context, treated as data, not instructions).

---

## `amicus fanout` — Same Prompt, Many Models

Fanout runs one headless wave: every leg receives the **same** prompt concurrently (this is the shared-prompt model that the council's review stages are built on). When all legs settle, Amicus emits a single JSON wave document on stdout.

```bash
amicus fanout --models "gemini,deepseek,gpt" --prompt "Review this design" --json
amicus fanout --models "gemini,opus" --prompt-file briefing.md --json --wave-id my-wave-1
amicus fanout --council free --prompt "Review this design" --json
```

**Key options:**

| Option | Description |
|--------|-------------|
| `--models <a,b,c>` | Comma-separated aliases or full model IDs (bare `provider/model` routes direct-first; `openrouter/provider/model` forces OpenRouter). Required unless `--council` is given; mutually exclusive with `--council`. |
| `--council <name>` | Run a saved council, or one of the built-in benches `free` \| `budget` \| `frontier`, instead of `--models`; mutually exclusive with `--models`. A saved council of the same name as a built-in always takes precedence (see `amicus council list`/`show`). |
| `--prompt <text>` | Shared briefing (mutually exclusive with `--prompt-file`). |
| `--prompt-file <path>` | Read the shared briefing from a file. Preferred for long briefs and required on Windows when content exceeds ~32 KB. |
| `--wave-id <id>` | Set the wave ID explicitly; leg IDs become `<wave-id>-1` … `<wave-id>-N`. |
| `--session-id <id\|"current">` | Session ID to pull shared context from (default `current`). Same semantics as on `start`. |
| `--json` | Emit the wave document on stdout. |
| `--max-cost <$>` | Refuse the wave if the estimated total exceeds `$` (soft ceiling). |
| `--no-cost-gate` | Disable the budget gate (per-$/Mtok threshold + ceiling) for this run. |
| `--no-validate-model` | Skip catalog validation. |
| `--gateway <mode>` | Routing override applied to every leg: `auto` (direct-first), `direct`, or `openrouter`. |

**Shared per-leg knobs.** Every leg in the wave also accepts the same per-leg options as `start`:
`--agent`, `--thinking`, `--timeout`, `--summary-length`, `--no-context`, `--context-*`, `--mcp*`,
`--no-validate-model`, `--gateway`, `--cwd`.

**Exit codes:** `0` all legs complete · `2` partial wave (at least one leg failed) · `1` none complete / hard failure · `130` SIGINT · `143` SIGTERM.

**Wave document shape:**

```json
{
  "schemaVersion": 1,
  "waveId": "...",
  "status": "complete",
  "counts": { "total": 2, "complete": 2, "error": 0, "timeout": 0, "aborted": 0 },
  "legs": [
    {
      "taskId": "...", "model": "...", "modelInput": "...", "agent": "...",
      "status": "complete", "summary": "...", "error": null,
      "createdAt": "...", "completedAt": "...", "durationMs": 0
    }
  ]
}
```

`status` is `complete | partial | error | aborted`. Each leg's `summary` is that model's full response.
`legs[]` come in `--models` order (or preset-membership order for `--council`), not completion order.

**Fanout vs. N parallel starts.** Use `fanout` when every leg should receive the **same prompt** — this is what the council's independent review waves use. Use N separate `start` calls when each leg needs a **different prompt**.

---

## `amicus council run` — Headless Council Engine

Runs the **entire adjudicated council pipeline in one command with no Claude runtime** (v4.0):
Stage-1 independent reviews → anonymized peer cross-review (with bounded repair re-prompts) →
deterministic tally → non-Claude chair verdict → `verdict.json` + `report.html`, all written to a
durable run directory. Stage-4 accept/deny decisions stay human — the engine is report-only.

```bash
amicus council run --prompt-file briefing.md --models gemini,glm --chair deepseek \
  --out-dir council-run --json --max-cost 2.00 --timeout 10
```

**Key options:**

| Option | Description |
|--------|-------------|
| `--prompt-file <path>` | The council briefing. **Required** — there is no inline `--prompt` for councils. |
| `--models <a,b,c>` \| `--council <name>` | The bench (≥2 seats); mutually exclusive, same semantics as `fanout`. |
| `--chair <model>` | Verdict synthesizer. Default `deepseek`; must **not** be a bench seat (pre-flight error). |
| `--critic <model>` | Optional adversarial seat; must **be** a bench seat. Mutually exclusive with `--lenses`. |
| `--lenses <s1,s2,...>` | Expert lenses, one per seat (count must equal seat count); forces `--no-ledger` semantics. |
| `--out-dir <dir>` | Run directory. Default `./council-<runId>/`. |
| `--json` | Emit the council-run document on stdout (error envelope + documented exit codes on failure). |
| `--max-cost <$>` | **Whole-run** ceiling, checked before each paid stage launch. |
| `--timeout <min>` | **Per-leg** timeout (fanout semantics); bound the aggregate with your CI job timeout. |
| `--gateway <mode>` / `--no-validate-model` | Same routing/validation semantics as `start`/`fanout`. |
| `--debate` | Adds a Stage-2.5 rebuttal round (provisional tally → defense → re-vote → final tally) between cross-review and the final tally. |
| `--claude-review <file>` | Enters Claude's own review from a file as judged review N+1 — no leg is ever launched for it; `claude` is a reserved seat name and may not also appear in `--models`, `--chair`, or `--critic` (pre-flight error). |
| `--no-cost-gate` | Disable the per-leg price gate for the whole run (repairs + chair). |

**Exit codes:** `0` full run · `2` degraded but reportable (fewer than 2 judges, chair failure —
`overallVerdict: null` — or cost ceiling hit after the tally) · `1` quorum/pre-tally failure
(error doc) · `130`/`143` signals. `amicus status|abort <councilRunId>` work on council runs
via the sessions-dir pointer file. There is no CLI `wait` — to block until a council run
finishes, use the MCP `amicus_wait` tool instead.

Field-by-field run-directory contents, the degradation table, and `verdict.json`'s
`overallVerdict` are documented in **[docs/council.md](./council.md#amicus-council-run)**. This is
the command the repo's Council Review GitHub Action (v2) runs on labeled PRs.

---

## `amicus council save|list|show` — Council Presets

A council preset is a named list of `--models`-style members (aliases or full `provider/model` IDs) that `--council <name>` (on `fanout` and the `amicus_fanout` MCP tool) can run in one shot.

```bash
amicus council save my-bench --models opus,gpt,deepseek   # Save (or overwrite) a preset
amicus council list [--json]                               # Saved presets + built-ins
amicus council show my-bench [--json]                       # Members + resolution (resolved/dropped)
amicus council show budget [--json]                         # Works on built-ins too
```

**Built-in benches.** Three names resolve even with no saved config — `resolveCouncilMembers` (the same function `--council` uses everywhere) checks user-saved councils first, and falls back to these only when the name isn't saved:

| Name | Members | Resolution |
|------|---------|------------|
| `free` | Zero-cost `:free`-suffixed OpenRouter models, one per vendor | Dynamic — resolved from the live catalog at use time (same logic as the setup wizard's free-council picker), with a small offline pinned fallback when the catalog is empty |
| `budget` | 3 cheap workhorse aliases across 3 distinct vendor families | Static — fixed aliases from the default alias table |
| `frontier` | 3 premium flagship aliases across 3 distinct vendor families | Static — fixed aliases from the default alias table |

**Precedence: user config always shadows a built-in of the same name.** If you `amicus setup` the wizard's free-OpenRouter-council flow, it seeds `councils.free` in your config — that saved list then wins over the built-in `free` bench (this is the pre-existing behavior, unchanged). The same shadowing applies if you `amicus council save budget --models ...`. `amicus council list` marks a built-in `shadowed: true` when a saved council of the same name exists.

---

## `amicus models` — The Model Catalog

Amicus does **not** ship a frozen table of model names. Aliases and validation resolve against a **live catalog** fetched from provider APIs and cached at `~/.config/amicus/model-catalog.json` (24-hour TTL; the fetch works without an API key).

```bash
amicus models                 # List the catalog
amicus models --search gemini # Filter by substring over id and name
amicus models --refresh       # Force-refresh from provider APIs
amicus models --check         # Audit your aliases against the catalog
```

`amicus models --check` exits with the **number of stale aliases** (capped at 100) and prints same-vendor replacement suggestions for each, so it drops cleanly into CI.

**Validation on launch.** `start` and `fanout` validate the model against the catalog before launching. For an explicit `--model` on `continue`/`resume` this is **blocking** (a typo'd model fails fast with suggestions); for a model *inherited* from a prior session it's **advisory**. Skip it any time with `--no-validate-model`, or fix the catalog with `amicus models --refresh`.

**Aliases are a curated seed, not a fixed list.** `amicus setup` seeds a curated set of short aliases (e.g. `gemini`, `gpt`, `opus`, `deepseek`), and you add or override them with `amicus setup --add-alias name=provider/model`. To see exactly what resolves on *your* machine, run `amicus models` — that is the source of truth.

**Full-id passthrough.** You can always bypass aliases and name a model directly. Bare `provider/model` is the canonical, policy-routed form; `openrouter/provider/model` is an explicit override. See [Routing](../README.md#routing) for the full explanation — summary:

| Format | Example | Routing | Credentials |
|--------|---------|---------|-------------|
| `provider/model` (bare, canonical) | `google/gemini-2.5-flash`, `openai/gpt-5`, `anthropic/claude-opus-4` (the `opus` alias resolves here by default) | Direct-first (`auto`) | That vendor's direct key if configured, else `OPENROUTER_API_KEY` |
| `openrouter/provider/model` | `openrouter/google/gemini-2.5-flash` | Always OpenRouter | `OPENROUTER_API_KEY` |

---

## Other Commands

```bash
amicus list                          # Current project
amicus list --status running         # Filter: running, complete, error, timed-out,
                                      #         aborted, crashed, idle-timeout
amicus list --all                    # All projects
amicus list --json                   # Machine-readable

amicus read <id>                     # Fold summary (default)
amicus read <id> --conversation      # Full conversation
amicus read <id> --metadata          # Session metadata
amicus read <id> --json              # Stable JSON run or wave document

amicus status <id>                   # One-shot status for a session or wave
amicus status --wave <id>            # Alternative spelling for a wave ID
amicus status <id> --json            # Machine-readable output

amicus resume <id>                   # Reopen session with full history
amicus resume <id> --no-ui --json    # Headless resume; stable run document on stdout
amicus continue <id> --prompt "..."  # New session; previous one as read-only context
amicus continue <id> --prompt "..." --no-ui --json   # Headless continue; run doc carries the NEW task id

amicus abort <id>                    # Stop one running session
amicus abort <id> --json             # Machine-readable abort result
amicus abort --all                   # Stop all running sessions in this project
amicus abort --all --json            # Machine-readable abort result (scope: "all")

amicus setup --api-keys              # Open just the API-key window
amicus setup --add-alias fast=google/gemini-2.5-flash   # Add/override one alias (bare canonical)
```

**`amicus status <id>` output.** Human-readable:

```
$ amicus status demo123
Task:     demo123
Status:   complete (terminal)
Elapsed:  5m 0s
Model:    google/gemini-2.5-flash
```

`--json`:

```
$ amicus status demo123 --json
{
  "taskId": "demo123",
  "status": "complete",
  "elapsed": "5m 0s",
  "version": "4.2.1",
  "model": "google/gemini-2.5-flash",
  "phase": "terminal"
}
```

A running session additionally reports `messages`, `lastActivity`/`latest`, and (if stalled) a `STALLED` line with recovery guidance in `--json`. A wave ID (`amicus status <waveId>` / `--wave <waveId>`) instead reports `legsComplete`/`legsTotal` and a per-leg breakdown.

---

## Keys, Health & Spend

Five commands for day-to-day account and cost hygiene: manage keys (cloud or local), check your setup, run local models at $0, and see what you've spent.

### `amicus key`

```bash
amicus key                        # List every configured provider (cloud + local)
amicus key openrouter <key>       # Validate + save a cloud vendor key
amicus key openrouter --remove    # Remove a saved cloud vendor key
amicus key my-ollama <token>      # Save/validate a bearer for a LOCAL provider
amicus key my-ollama --remove     # Remove a local provider's bearer
```

Bare `amicus key` lists both kinds of provider:

- **Cloud vendors** (`openrouter`, `google`, `openai`, `anthropic`, `deepseek`) — `✓` with a masked key hint, or `✗ not set`.
- **Local providers** (anything added with `amicus provider add`, below) — `no key required` when the entry has no `apiKeyEnv`, else `✓` with a masked hint or `✗ not set`.

`amicus key <provider> <key>` behaves differently depending on which kind `<provider>` is:

| Provider kind | What happens |
|---|---|
| Cloud vendor (one of the 5 above) | `<key>` is validated live against the vendor's API, then saved to `~/.config/amicus/.env` (`0600`). A failed validation aborts the save. |
| Local provider (an id in `config.providers`) | `<key>` is a **bearer token**, not a vendor API key. Amicus probes the endpoint *with* the bearer attached (2s timeout) and saves it to `.env` either way — the probe result only changes the confirmation message, it never blocks the save. If the entry had no `apiKeyEnv` yet, one is derived and stamped onto `config.providers.<id>` so the router picks it up. |

After a successful **cloud**-vendor save (not a local-provider bearer save), Amicus offers the cost-aware default picker — a short list of that vendor's models, recommended one flagged, that becomes `aliases.<provider>` and optionally `config.default`. Non-interactively (`--json`, `--quiet`, or no TTY) it silently takes the recommended pick and prints a one-line summary instead of prompting.

`--remove` deletes a saved key/bearer; every subcommand supports `--json`.

### `amicus doctor`

```bash
amicus doctor              # Human-readable checklist
amicus doctor --json       # Machine-readable (versioned doc)
amicus doctor --fix        # Self-heal what can be self-healed, then re-report
```

Runs every check below, in order, and prints a ✓/⚠/✗ line for each plus a targeted fix hint for anything not `ok`:

| Check | What it verifies | Can fail as |
|---|---|---|
| `node` | Node.js ≥ 18 | error |
| `config-dir` | The resolved config directory | *(always ok)* |
| `keys` | At least one cloud-vendor key configured | error |
| `default-model` | Your default model alias resolves | error |
| `catalog` | Model-catalog cache present and within the 24h TTL | warn |
| `aliases` | Your configured aliases still resolve against the catalog | warn |
| `opencode-bin` | The OpenCode engine binary is on `PATH` | error |
| `engine-mcp` | The engine copy `npx -y amicus@latest mcp` would actually launch (catches a broken npx-cache copy a healthy local install would hide) | warn (error only if there's exactly one npx-cache copy and it's broken) |
| `electron` | Electron (the interactive GUI) is installed | warn — headless still works |
| `skills` | Both skills exist under `~/.claude/skills/` | warn |
| `mcp` | Amicus is registered as an MCP server in Claude Code | warn |
| `mcp-legacy` | No duplicate legacy `sidecar` MCP entry survives alongside `amicus` | warn |
| `sessions-index-tmp` | No orphaned `sessions-index.json.*.tmp` files | warn |
| `openrouter-credit` | Remaining OpenRouter credit (skipped — reports `ok` — when no OpenRouter key is set) | warn |
| `local-providers` **(v4.2)** | Every provider in `config.providers` is reachable | warn |
| `project-root` | Your cwd looks like a real project, not an app/install dir | warn |

**`local-providers`** probes every configured local provider (2s timeout each) the same way `amicus provider test` does, and reports per-id reachability in one line, e.g. `ollama: 3 models @ http://127.0.0.1:11434/v1; my-vllm: unreachable @ http://127.0.0.1:8000/v1`. No providers configured at all is a plain `ok` ("none configured") — this check can never fail your doctor run outright, only warn: a napping `ollama serve` isn't treated as broken setup.

`--fix` self-heals four of the checks above in place: reprovisions Electron, copies the OpenCode engine into a broken npx-cache install, removes a duplicate legacy MCP entry, and sweeps orphaned session-index tmp files (only ones older than 60s). It does **not** start a local server for you — `local-providers` stays a warning until you start the server yourself.

Exit code is `1` if anything is `error`, else `0` (same rule drives `--json`'s `ok` field).

### `amicus spend`

```bash
amicus spend                 # All-time rollup, human-readable
amicus spend --since 7d      # Restrict to the last 7 days
amicus spend --json          # Machine-readable (versioned doc)
```

Reads `~/.config/amicus/spend-ledger.jsonl` (one row per completed run/leg) and prints a most-expensive-model-first table: runs, input/output tokens, cost, and a **source mix** `r<N>/e<N>/u<N>` — how many of that model's runs were `reported` (billed cost from the provider), `estimated` (tokens × cached catalog pricing), or `unknown` (neither available). A trailing total line sums everything, plus your remaining OpenRouter credit when a key is configured.

**Cost markers** — the shared convention behind every dollar figure Amicus prints, not just `spend`'s table: a bare `$1.23` (no `~`) is a provider-reported cost; `~$1.23` is estimated from tokens × cached pricing; `?`/`—` mark a cost Amicus has no data for at all. `amicus spend`'s own total/per-model figures never show `?`/`—` themselves — an unpriced run still counts as `$0` toward the rollup — but it's visible via the `u` (unknown) count in that row's source mix.

**Local provider runs are a real, explicit `$0` tier.** `amicus provider`'s default pricing is `{prompt: 0, completion: 0}`, so a local run always resolves to an *estimated* (not unknown) cost — it renders as `~$0.0000`, counted in `e`, sitting right alongside your paid runs in the same rollup.

### `amicus provider`

Configure a local, self-hosted, OpenAI-compatible server — LM Studio, Ollama, vLLM, or anything else that speaks the `/v1/models` + chat-completions shape — as a first-class model source. Local providers cost **$0** marginal: no cloud key, no per-token bill.

```bash
amicus provider add lmstudio --preset lmstudio               # LM Studio, default port
amicus provider add ollama --preset ollama                   # Ollama, default port
amicus provider add vllm --preset vllm                       # vLLM, default port
amicus provider add my-remote --url http://127.0.0.1:9000/v1 --bearer <token>
amicus provider list
amicus provider test lmstudio
amicus provider remove lmstudio
```

| Option | Description |
|---|---|
| `provider add <id> --preset ollama\|lmstudio\|vllm` | Add from a built-in preset. |
| `provider add <id> --url <baseURL>` | Add a custom endpoint instead of (or overriding) a preset. |
| `--bearer-env <VAR>` | Point at an env var that already holds the bearer (never written by this command). |
| `--bearer <token>` | Save `<token>` immediately, under a derived env-var name (e.g. `vllm-lab` → `VLLM_LAB_API_KEY`). Mutually exclusive with `--bearer-env`. |
| `--pricing-in <$/tok> --pricing-out <$/tok>` | Override the default `$0`/`$0` pricing (e.g. a metered self-host you actually pay for). |
| `provider list` | List configured providers: id, base URL, flavor, whether a bearer is set. |
| `provider test <id>` | Re-probe one provider; exit `0` if reachable, `1` if not. |
| `provider remove <id>` | Delete the config entry and its bearer (kept if another provider shares the same `--bearer-env`). |
| `--json` | Every subcommand supports it. |

**Presets** (always `127.0.0.1`, never `localhost` — some resolvers try `::1` first, which most local servers don't bind):

| Preset | Default base URL |
|---|---|
| `lmstudio` | `http://127.0.0.1:1234/v1` |
| `ollama` | `http://127.0.0.1:11434/v1` |
| `vllm` | `http://127.0.0.1:8000/v1` |

**`add` never fails just because the server is offline.** It validates and saves the config entry (and the bearer, if given) first, then does a best-effort 2s reachability probe: reachable prints the model count and offers the cost-aware default picker (see `amicus key` above); unreachable just warns and points you at `amicus provider test <id>` — the entry is saved either way, so starting the server later and re-testing is enough to pick it up. A provider id may not be `openrouter`, `google`, `openai`, `anthropic`, or `deepseek` (reserved for the built-in vendors), and must match `^[a-z][a-z0-9_-]{1,31}$`. If you also pass a plain `http://` `--url` to a non-loopback host with a bearer, `add` warns that the token would cross the network in cleartext.

`amicus setup`'s interactive wizard (readline and Electron) also offers to add a local server as one step of the normal setup flow — `amicus provider add` is the same feature from the command line.

**Running local models.** Two things cloud models don't require:

- **Load the model with enough context.** Amicus's agent prompt is ~26k tokens; a model loaded
  with too small a context window will reject it. LM Studio's default (~16k) is not enough — load
  with a larger context first, e.g. `lms load <model> --context-length 32768`, or set it in the
  GUI before use. Ollama: set the model's context via a Modelfile (`num_ctx`).
- **The first token is slow.** The model has to prefill that ~26k-token prompt before it can
  respond — 30–90s to first token on a cold local model is normal, not a hang. Amicus's
  per-request timeout for local providers is 5 minutes to give this room.

### `amicus init`

```bash
amicus init                    # Register both Claude Code and Claude Desktop
amicus init --claude           # Claude Code only
amicus init --desktop          # Claude Desktop only
amicus init --json             # Per-step status as JSON
```

Re-runs the **same registration core** `npm install`'s postinstall runs: install both skills (`sidecar`, `second-opinion`) into `~/.claude/skills/`, register the `amicus` MCP server in Claude Code and/or Claude Desktop, and clean up any leftover legacy `sidecar` MCP entry. Useful when:

- A **plugin-channel install** (or any `--ignore-scripts` npm install) never ran the postinstall in the first place.
- The postinstall failed partway through.
- You deleted `~/.claude` state and want it rebuilt without reinstalling.

It never touches API keys, your default model, or Electron/engine provisioning — that's `amicus setup` and `amicus doctor --fix`. Each step (`skills`, `claudeCode`, `claudeDesktop`, `legacyMigration`) reports its own status independently — a broken Claude Desktop registration doesn't stop the Claude Code one from completing — and the command ends with a compact doctor summary. Exit code is `1` if any step genuinely failed, `0` otherwise.

---

## MCP Server

```bash
# Auto-registered on npm install. Manual registration:
claude mcp add-json amicus '{"command":"npx","args":["-y","amicus@latest","mcp"]}' --scope user
```

MCP tools: `amicus_start`, `amicus_status`, `amicus_wait`, `amicus_read`, `amicus_list`, `amicus_resume`, `amicus_continue`, `amicus_abort`, `amicus_setup`, `amicus_guide`, `amicus_fanout`, `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict`, `amicus_council_run`, `amicus_spend`

The async pattern is **start → status → read**: `amicus_start` (or `amicus_fanout`) returns immediately, you poll `amicus_status`, then call `amicus_read` once the status is terminal.

`amicus_spend` is the read-only exception to that pattern: it's synchronous, takes the same filters as the [`amicus spend`](#amicus-spend) CLI command (`since`, `wave`, `council`, `filterProject`, `model`, `op`, `failed`, `groupBy`, `rows`), and returns the same versioned spend doc — unfenced, since spend docs are ids/numbers/paths only, never model-generated text. `since` takes the same `<N>d` format as the CLI's `--since` (e.g. `'7d'`). `filterProject` (not `project`) names the ledger row filter, since `project` is reserved on every MCP tool for the working-directory selector and the spend ledger is global, not per-project. Unlike the CLI, this tool never fetches the OpenRouter credit footer (`credit` is always `null`) — that's the one network-bound piece of `amicus spend`, deliberately excluded so a read-only MCP query never waits on the network.

Session statuses: `running`, `complete`, `aborted`, `crashed`, `error`, `timed-out`, `idle-timeout`

> Legacy `sidecar_*` tool names were removed entirely in v2.0.0 — the tool surface is `amicus_*` only, always. `AMICUS_LEGACY_ALIASES=1` (the v1.8.0 opt-in switch that used to restore the `sidecar_*` twins) is now a no-op: setting it on the MCP server entry changes nothing. See [docs/SHIMS.md](./SHIMS.md) for the removal record.

> The MCP server auto-detects whether it's running under Claude Code or Claude Desktop/Cowork (from the MCP `initialize` handshake) and passes the right `--client` value downstream — this drives context inclusion, MCP discovery, and session-dir resolution. If detection ever picks the wrong one, force it with `"env": {"AMICUS_MCP_CLIENT": "code-local"}` (or `code-web` / `cowork`) on the MCP server entry.

---

## OpenCode Agent Types

The `--agent` option controls which OpenCode agent drives the session:

| Agent | Description | Tool Access |
|-------|-------------|-------------|
| **Chat** | Interactive conversation | Reads freely, asks before writes/bash |
| **Build** | Full-access primary agent (headless default) | Read, write, bash, task |
| **Plan** | Read-only analysis | Read-only |

`--agent Chat` is interactive-only and incompatible with `--no-ui`. Custom agents defined in `~/.config/opencode/agents/` or `.opencode/agents/` are also supported.

---

## Context Sharing

When you `start` or `fanout`, Amicus automatically includes your recent Claude Code conversation history as context. Tune it:

- `--context-turns <N>` — max conversation turns to include (default 50).
- `--context-since <duration>` — time window (e.g. `2h`); overrides turns.
- `--context-max-tokens <N>` — cap the context size (default 80000).
- `--no-context` — skip parent history entirely (useful for `fanout` with a self-contained briefing).

---

## Process Self-Termination

Amicus processes automatically shut down after a period of inactivity. Default idle timeouts:

- **Headless mode**: 15 minutes
- **Interactive mode**: 60 minutes
- **Shared server**: 30 minutes

Set `AMICUS_IDLE_TIMEOUT=0` to disable self-termination entirely. For per-mode control use `AMICUS_IDLE_TIMEOUT_HEADLESS`, `AMICUS_IDLE_TIMEOUT_INTERACTIVE`, or `AMICUS_IDLE_TIMEOUT_SERVER` (all in minutes). See [docs/configuration.md](configuration.md#process-lifecycle) for the full table.

Legacy `SIDECAR_IDLE_TIMEOUT*` names were removed in v2.0.0 — use the `AMICUS_IDLE_TIMEOUT*` names above. See [docs/SHIMS.md](./SHIMS.md).

---

## JSON Output

With `--json`, Amicus emits stable, versioned documents on stdout.

**Run document** (single session):

```json
{
  "taskId": "...", "model": "...", "modelInput": "...", "agent": "...",
  "status": "complete", "summary": "...", "error": null,
  "createdAt": "...", "completedAt": "...", "durationMs": 0
}
```

`modelInput` is the alias you passed; `model` is the resolved id. `status` is one of `complete | error | timeout | aborted | crashed | idle-timeout`.

**Exit codes:** `0` success · `2` partial wave · `1` error / hard failure · `130` SIGINT · `143` SIGTERM.

---

## Agentic Evals

```bash
node evals/run_eval.js --eval-id 1          # Single eval
node evals/run_eval.js --all                # All evals
node evals/run_eval.js --all --dry-run      # Print commands only
node evals/run_eval.js --eval-id 1 --model opus  # Override model
```

See [evals/README.md](../evals/README.md) for the full eval system documentation.
