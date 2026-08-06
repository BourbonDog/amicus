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
amicus watch <task_id> [--plain|--json] [--interval <sec>] [--ui]  # Live-render a run from any terminal, or open it in the Council Workspace window
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
amicus spend [--since 7d] [--wave <id>] [--group-by <dim>] [--rows] [--json]  # Cost rollup + attribution query
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
amicus template list [--json]              # List briefing templates (built-ins marked)
amicus template show <name|path> [--json]  # Print a template's raw text
amicus pack save <name> --kind council|fanout|solo [flags]  # Save a full run config (bench/options/template)
amicus pack save <name> --from-run <id>    # ...or build one from an existing run/wave/session
amicus pack list [--json]                  # List saved packs
amicus pack show <name|path> [--json]      # Print a pack + its validation report
amicus pack rm <name> [--json]             # Remove a saved pack
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
| `--pack <name\|path>` | Load a saved [policy pack](#policy-packs) — its `model`/options/template fill in for anything you didn't type explicitly. | |
| `--template <name\|path>` | Render a [briefing template](#briefing-templates) (`{{prompt}}`, `{{artifact}}`, `{{artifact_path}}`, `{{date}}`, `{{project}}`, `{{var.*}}`). | |
| `--artifact <file>` | File whose content fills `{{artifact}}`/`{{artifact_path}}` (256 KB cap). Requires `--template`. | |
| `--var <k=v>` | Set `{{var.<key>}}`; repeatable. Requires `--template`. | |

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
| `--pack <name\|path>` | Load a saved [policy pack](#policy-packs) — its bench/options/template fill in for anything you didn't type explicitly. |
| `--template <name\|path>` | Render a [briefing template](#briefing-templates) (`{{prompt}}`, `{{artifact}}`, `{{artifact_path}}`, `{{date}}`, `{{project}}`, `{{var.*}}`), shared by every leg. |
| `--artifact <file>` | File whose content fills `{{artifact}}`/`{{artifact_path}}` (256 KB cap). Requires `--template`. |
| `--var <k=v>` | Set `{{var.<key>}}`; repeatable. Requires `--template`. |

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
| `--max-cost <$>` | **Whole-run** ceiling on **known** spend, checked before each paid stage launch. A leg whose cost cannot be determined does not count against it and never halts the run; when the total is inexact and a ceiling is set, the run exits `2`. |
| `--timeout <min>` | **Per-leg** timeout (fanout semantics); bound the aggregate with your CI job timeout. |
| `--gateway <mode>` / `--no-validate-model` | Same routing/validation semantics as `start`/`fanout`. |
| `--debate` | Adds a Stage-2.5 rebuttal round (provisional tally → defense → re-vote → final tally) between cross-review and the final tally. |
| `--claude-review <file>` | Enters Claude's own review from a file as judged review N+1 — no leg is ever launched for it; `claude` is a reserved seat name and may not also appear in `--models`, `--chair`, or `--critic` (pre-flight error). |
| `--no-cost-gate` | Disable the per-leg price gate for the whole run (repairs + chair). |
| `--pack <name\|path>` | Load a saved [policy pack](#policy-packs) — its bench/chair/critic/lenses/options/template fill in for anything you didn't type explicitly. |
| `--template <name\|path>` | Render a [briefing template](#briefing-templates) (`{{prompt}}`, `{{artifact}}`, `{{artifact_path}}`, `{{date}}`, `{{project}}`, `{{var.*}}`). |
| `--artifact <file>` | File whose content fills `{{artifact}}`/`{{artifact_path}}` (256 KB cap). Requires `--template`. |
| `--var <k=v>` | Set `{{var.<key>}}`; repeatable. Requires `--template`. |

**Exit codes:** `0` full run · `2` degraded but reportable (fewer than 2 judges, chair failure —
`overallVerdict: null` — a cost ceiling hit after the tally, or a `--max-cost` ceiling set over a
total the run knows is only a floor) · `1` quorum/pre-tally failure
(error doc) · `130`/`143` signals. `amicus status|abort <councilRunId>` work on council runs
via the sessions-dir pointer file. There is no CLI `wait` — to block until a council run
finishes, use the MCP `amicus_wait` tool instead.

Field-by-field run-directory contents, the degradation table, and `verdict.json`'s
`overallVerdict` are documented in **[docs/council.md](./council.md#amicus-council-run)**. This is
the command the repo's Council Review GitHub Action (v2) runs on labeled PRs.

**Auto-open the Council Workspace (v4.5).** When this run is launched through the `amicus_council_run`
**MCP tool** from Claude Code (local), the same Council Workspace window that `amicus watch <runId>
--ui` opens by hand also opens automatically, detached, right after the run starts — no extra call
needed to watch it live. The plain CLI invocation above is unaffected either way: there is no MCP client to
detect on that path. Full decision order (the `ui` MCP param, the `workspace.autoOpen` config key,
and the four guards) is in **[docs/council.md's Council Workspace
section](./council.md#council-workspace-gui)**.

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

## Briefing templates

Render a `{{variable}}` briefing before it's sent — for `start`, `fanout`, and `council run` alike.

```bash
amicus template list [--json]              # Built-ins marked [built-in]; a same-named user file shadows one
amicus template show review                # Print a template's raw text
amicus start --model gemini --template review --artifact plan.md --var focus=performance --no-ui --json
```

**Known variables** (`src/template/render.js`): `{{prompt}}`, `{{artifact}}`, `{{artifact_path}}`, `{{date}}` (`YYYY-MM-DD`), `{{project}}`, `{{var.<key>}}` (from repeatable `--var key=value`). There is no `{{input}}` in v4.5 — that chaining variable, and the `critique`/`refine` built-ins that need it, arrive with v4.6's composable waves.

**Strict by design — a typo fails loudly instead of silently dropping text:**

| Situation | Result |
|---|---|
| Template uses `{{var.foo}}`, no `--var foo=...` given | Error (`TEMPLATE_RENDER`) |
| `--var foo=...` given, template never uses `{{var.foo}}` | Notice (not an error) — printed to stderr |
| Template uses `{{prompt}}`, no `--prompt`/`--prompt-file` given | Error |
| `--prompt`/`--prompt-file` given, template has no `{{prompt}}` slot | Error — the text would be silently dropped |
| Template uses `{{artifact}}`/`{{artifact_path}}`, no `--artifact` given | Error |
| `--artifact` given, template has no `{{artifact}}`/`{{artifact_path}}` slot | Error |
| An unrecognized `{{name}}` appears anywhere in the template | Error — lists the known variables |

**Where templates live.** Markdown files in `~/.config/amicus/templates/<name>.md` — the name is the filename minus `.md`. A user file **shadows** a built-in of the same name (`amicus template list` marks it `[shadows built-in]`); there is no `template save`/`rm` — your editor is the manager. v4.5 ships one built-in, `review` (asks for a severity-tagged, artifact-grounded review ending in a one-paragraph verdict).

**`--artifact <file>`** reads a file (256 KB cap) into `{{artifact}}` (its content) and `{{artifact_path}}` (its resolved path) — pass the plan/diff/design you want reviewed as a file instead of pasting it into `--prompt`.

**MCP.** None of the three run tools (`amicus_start`, `amicus_fanout`, `amicus_council_run`) have a `template` param of their own — a [policy pack](#policy-packs)'s `briefing.template` is the only way a template reaches an MCP-invoked run, rendered against that call's own briefing text at the same single application point a typed `--template` would use.

---

## Policy packs

Save a full run configuration — bench, chair/critic/lenses, options, briefing template — and invoke it by name instead of re-typing every flag.

```bash
amicus pack save <name> --kind council|fanout|solo [flags]   # build from flags
amicus pack save <name> --from-run <id>                       # build from an existing run/wave/session
amicus pack list [--json]
amicus pack show <name|path> [--json]
amicus pack rm <name> [--json]
```

Then invoke it with `--pack <name|path>` on `start` / `fanout` / `council run` — or the `pack` param on the `amicus_start` / `amicus_fanout` / `amicus_council_run` MCP tools.

**What a pack can hold, per `kind`:**

| Kind | Bench field | Kind-specific fields | Allowed `options.*` |
|---|---|---|---|
| `council` | `bench` (a saved council name, or an array of ≥2 members) | `chair`, `critic`, `lenses` | `timeout`, `maxCost`, `gateway`, `debate` |
| `fanout` | `bench` (a saved council name, or an array of ≥2 members) | — | `timeout`, `maxCost`, `gateway`, `agent`, `thinking`, `summaryLength`, `noContext`, `contextTurns`, `contextMaxTokens` |
| `solo` | `model` | — | `timeout`, `maxCost`, `gateway`, `agent`, `thinking`, `summaryLength`, `noUi`, `noContext`, `contextTurns`, `contextMaxTokens` |

`council` packs do **not** accept `agent`, `thinking`, or `summaryLength` — they were inert on every surface (no council code path, CLI or MCP, ever reads a pack-filled one; the engine hardcodes agent `Plan`/summaryLength `verbose`), so they were dropped before release rather than shipped as dead weight a pack author would reasonably expect to work. A `council` pack that still sets one fails `pack save` with `PACK_INVALID`, naming the key. They remain valid, and functional, on `fanout`/`solo` packs.

Every kind may also carry `description`, `version` (semver, default `1.0.0`), and `briefing.template` (a template **reference**, not rendered text — a pack never captures briefing prose).

**Precedence: flag > pack > config default > built-in default.** A pack only fills in values you didn't type explicitly on the command line — anything you do pass always wins, and the pack is recorded on the run either way (see below), so a hand-tuned invocation of a saved pack is never ambiguous about what actually ran.

**`--from-run <id>`** builds a pack from an existing council run, fanout wave, or solo session instead of flags — resolution order is council pointer → wave `metadata.json` → solo `metadata.json`. It captures the bench/model, chair/critic/lenses, and the run options that were actually used; **briefing text is never captured**, only a template *reference* when the source run recorded one.

**Where packs live.** One JSON file per pack, `~/.config/amicus/packs/<name>.json`. Re-saving an unchanged pack is a no-op; saving a changed pack under an unchanged version string auto-bumps its patch version instead of silently overwriting history. Every pack also carries a content hash (sha256 of its canonical, sorted-key JSON form, first 12 hex chars) computed fresh on every read — a hand-edited pack whose `version` field you forgot to bump still gets a distinct hash on any run that used it.

**Recorded on every run, whether or not any value was actually overridden:** `pack: {name, version, hash, source}` lands on the resulting solo session `metadata.json`, wave `metadata.json`/`wave.json`, or council `run.json` — `source` is `"dir"` for a saved pack invoked by name, `"path"` for one loaded by file path.

**Error codes**, all through the standard `--json` error envelope:

| Situation | Code |
|---|---|
| `pack show <missing>` | `PACK_NOT_FOUND` |
| `pack rm <missing>` | `PACK_NOT_FOUND` |
| `pack save` fails validation | `PACK_INVALID` (hard-fail; non-fatal warnings still print to stderr) |
| `--pack <name>` at run time is the wrong `kind` (e.g. a `solo` pack passed to `council run`) | `PACK_KIND_MISMATCH` |
| `pack save --from-run <unknown id>` | `BAD_SESSION` |

**Over MCP, pack resolution happens entirely in-process** — `amicus_start`/`amicus_fanout`/`amicus_council_run` never spawn a child with `--pack`; the pack's values are merged onto that call's own input before validation, exactly as they would be for a typed param. Two knobs get special handling for CLI parity: a pack's `options.maxCost` and `briefing.template` have no schema param of their own on `amicus_start`/`amicus_fanout` (neither tool exposes either directly), but they still apply — forwarded to the spawned CLI child's argv as `--max-cost`/`--template` (`amicus_fanout` always spawns; `amicus_start`'s spawn-fallback path does the same), or, on `amicus_start`'s in-process shared-server path, applied via the same budget-gate/template-render code the CLI itself uses, before any session is created. (`amicus_council_run` already has real MCP params for both, so this forwarding never triggers there.) Any *other* pack knob with nowhere to land in a given tool's own MCP schema is never silently dropped either — it comes back as an explicit `Notice: pack '<name>' sets <key>, which <tool> does not support over MCP — ignored.` content block, naming the pack's own camelCase option key (e.g. `contextTurns`, never the CLI's `context-turns`). Concretely, `amicus_fanout` has no MCP destination for `options.contextTurns`/`options.contextMaxTokens` (both notice); `amicus_start` has real `contextTurns`/`contextMaxTokens` params, so no notice there. `council` packs cannot carry `agent`/`thinking`/`summaryLength` at all (see above), so there is nothing left to orphan on that surface.

### Worked example — save, inspect, invoke

Run end to end against the real CLI (a scratch config dir, so paths below are shown in their normal
`~/.config/amicus` form rather than the test scratch path):

```bash
$ amicus pack save review-bench --kind council \
    --bench gemini,deepseek,gpt --chair opus \
    --timeout 20 --max-cost 2 --description "Standard 3-model review bench"
Saved pack 'review-bench' v1.0.0 → ~/.config/amicus/packs/review-bench.json
```

```bash
$ amicus pack show review-bench
Pack 'review-bench' v1.0.0 [council] (dir: ~/.config/amicus/packs/review-bench.json)
  hash: da084ba56162
  description: Standard 3-model review bench
  bench: gemini, deepseek, gpt
  chair: opus
  options: {"timeout":20,"maxCost":2}
  validation: ok
```

```bash
$ amicus council run --pack review-bench --prompt-file briefing.md --out-dir council-run --json
```

No `--models`/`--chair`/`--timeout`/`--max-cost` needed on that last line — they all came from the
pack. Confirmed against the run's own `run.json` for this exact invocation (irrelevant keys elided):

```json
{
  "bench": ["gemini", "deepseek", "gpt"],
  "chair": "opus",
  "pack": { "name": "review-bench", "hash": "da084ba56162", "source": "dir" },
  "options": { "timeout": 20, "maxCost": 2, "gateway": "auto", "outDir": "..." }
}
```

Adding an explicit flag overrides just that one value — `... --pack review-bench --chair gpt-pro`
keeps the pack's bench and cost/timeout options but chairs with `gpt-pro` instead of `opus`, and the
pack is still recorded on the run either way.

---

## `amicus models` — The Model Catalog

Amicus does **not** ship a frozen table of model names. Aliases and validation resolve against a **live catalog** fetched from provider APIs and cached at `~/.config/amicus/model-catalog.json` (24-hour TTL; the fetch works without an API key).

```bash
amicus models                 # List the catalog
amicus models --search gemini # Filter by substring over id and name
amicus models --refresh       # Force-refresh from provider APIs
amicus models --check         # Audit your aliases against the catalog
amicus models --check --live  # + probe every stored alias with a real leg (spends)
```

`amicus models --check` exits with the **number of stale aliases** (capped at 100) and prints same-vendor replacement suggestions for each, so it drops cleanly into CI.

**Gateway-only routes.** A curated alias whose direct form is *derived* from its OpenRouter route (rather than
authored) is not reported STALE when that direct form is missing from the vendor's
direct namespace while the OpenRouter route still serves — a gateway-only route with
no direct sibling is a routing choice, not staleness. Deliberately gateway-only
entries (e.g. `gpt-pro`) are annotated as such and are never offered a retarget.

**Drifted aliases.** `--check` (and the `doctor` aliases row) also flags **`DRIFTED:`** stored aliases — a stored alias whose target is still catalog-listed but no longer matches any route its family currently resolves to (the v4.6.1 `gemini` release-gate class, where `doctor` stayed green while the model behind it had moved on). Each drift line prints the exact `amicus setup --add-alias <alias>=<current>` refresh command. Drift is informational only — unlike stale aliases, it never changes the exit code.

**Live probe (`--check --live`).** Presence in the catalog is not proof of service — a stored alias can point at a model id the catalog still lists but the provider has quietly stopped serving (the v4.6.1 `gemini` incident). `--check` alone can't see that; `--live` can, by actually asking. Scope is **stored aliases only** (`amicus setup --add-alias`) — curated defaults follow the catalog by construction and have no "was it actually served" question for a live probe to answer. **This spends real money — one tiny leg per stored alias** — every probed alias gets one ordinary engine leg on a single quiet fan-out wave, with a real session dir and a real spend-ledger row, exactly as if you'd run it yourself.

Each stored alias resolves to one of three outcomes:

| Outcome | Example line | Meaning |
|---------|--------------|---------|
| `SERVED` | `SERVED: gemini -> openrouter/google/gemini-3.6-flash ($0.0004)` | The model answered; cost shown in parens. |
| `SILENT` (`accepted-but-silent`) | `SILENT: probetest -> anthropic/claude-opus-4-8 — NO_OUTPUT_BACKSTOP: … (accepted but not serving)` | The endpoint accepted the request but produced nothing for the probe's 30 s backstop window (shorter than the ordinary 120 s default, and not tunable) — the exact "listed but not actually serving" failure this check exists to catch. |
| `ERROR` | `ERROR:  gpt -> openai/gpt-5.6-terra — 402 Payment Required` | Routing, auth, or provider failure; the raw error is printed. |

**Exit code.** The probe's non-served count folds into the same exit code as the static audit — `max(existing exit, min(nonServedCount, 100))` — so a single `SILENT` or `ERROR` fails the check even when every alias is otherwise catalog-fresh. No stored aliases prints `Live probe: no stored aliases to probe` and never affects the exit code. `--json` adds `probe` (the per-alias array) and `probeCount` (its length) to the `alias-audit` document — both additive, `[]`/`0` when `--live` wasn't passed.

**Cap.** The probe is one fan-out leg per stored alias, so it's bound by the same fan-out leg cap as everything else — 10 by default, raise it with `AMICUS_FANOUT_MAX_LEGS`. More stored aliases than the cap fails fast with a one-line error and probes nothing, so a doomed wave never spends a token.

**When it doesn't run.** `--live` requires `--check` (a bare `--live` errors immediately). If the catalog itself is unavailable, or `--refresh` is also on the command line (which returns before `--check` ever runs), the probe is skipped — Amicus says so instead of silently dropping the flag: `--live skipped: <reason> — nothing was probed`. The `--json` signal differs by path: for catalog-unavailable, the `alias-audit` document carries an additive `probeSkipped` field (a reason slug, e.g. `"catalog-unavailable"`; `null` once the probe actually ran or wasn't requested); for the `--refresh` case, `--json`'s stdout document is a `model-catalog` doc instead, which never carries `probeSkipped` — the announcement goes to stderr there so stdout stays valid JSON.

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
  "version": "4.6.2",
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
| `node` | Node.js ≥ 22.12 | error |
| `config-dir` | The resolved config directory | *(always ok)* |
| `keys` | At least one cloud-vendor key configured | error |
| `default-model` | Your default model alias resolves | error |
| `catalog` | Model-catalog cache present and within the 24h TTL | warn |
| `aliases` | Your configured aliases still resolve against the catalog | warn |
| `anthropic-base-url` | `ANTHROPIC_BASE_URL` isn't host-form (host-form 404s every direct-Anthropic leg unless normalized) | warn |
| `opencode-bin` | The OpenCode engine binary is on `PATH` | error |
| `engine-mcp` | The engine copy `npx -y amicus@latest mcp` would actually launch (catches a broken npx-cache copy a healthy local install would hide) | warn (error only if there's exactly one npx-cache copy and it's broken) |
| `electron` | Electron (the interactive GUI) is installed | warn — headless still works |
| `skills` | Both skills exist under `~/.claude/skills/` | warn |
| `mcp` | Amicus is registered as an MCP server in Claude Code | warn |
| `mcp-legacy` | No duplicate legacy `sidecar` MCP entry survives alongside `amicus` | warn |
| `sessions-index-tmp` | No orphaned `sessions-index.json.*.tmp` files | warn |
| `session-metadata-tmp` | No orphaned per-session `.metadata.json.*.tmp` files (the B09 class) | warn |
| `openrouter-credit` | Remaining OpenRouter credit (skipped — reports `ok` — when no OpenRouter key is set) | warn |
| `local-providers` **(v4.2)** | Every provider in `config.providers` is reachable | warn |
| `project-root` | Your cwd looks like a real project, not an app/install dir | warn |

**`local-providers`** probes every configured local provider (2s timeout each) the same way `amicus provider test` does, and reports per-id reachability in one line, e.g. `ollama: 3 models @ http://127.0.0.1:11434/v1; my-vllm: unreachable @ http://127.0.0.1:8000/v1`. No providers configured at all is a plain `ok` ("none configured") — this check can never fail your doctor run outright, only warn: a napping `ollama serve` isn't treated as broken setup.

`--fix` self-heals five of the checks above in place: reprovisions Electron, copies the OpenCode engine into a broken npx-cache install, removes a duplicate legacy MCP entry, sweeps orphaned session-index tmp files, and sweeps orphaned per-session metadata tmp files (both tmp sweeps only ones older than 60s). It does **not** start a local server for you — `local-providers` stays a warning until you start the server yourself.

Exit code is `1` if anything is `error`, else `0` (same rule drives `--json`'s `ok` field).

### `amicus spend`

```bash
amicus spend                 # All-time rollup, human-readable
amicus spend --since 7d      # Restrict to the last 7 days
amicus spend --json          # Machine-readable (versioned doc)
```

Reads `~/.config/amicus/spend-ledger.jsonl` (one row per completed run/leg) and prints a most-expensive-model-first table: runs, input/output tokens, cost, and a **source mix** `r<N>/e<N>/u<N>` — how many of that model's runs were `reported` (billed cost from the provider), `estimated` (tokens × cached catalog pricing), or `unknown` (neither available). A trailing total line sums everything, plus your remaining OpenRouter credit when a key is configured.

**Cost markers** — the shared convention behind every dollar figure Amicus prints, not just `spend`'s table: a bare `$1.23` (no `~`) is a provider-reported cost; `~$1.23` is estimated from tokens × cached pricing; `?`/`—` mark a cost Amicus has no data for at all. A model whose rows are *all* unpriced shows `?` in the cost column rather than a measured-looking `$0.0000`, and whenever any row is unpriced the table adds an explicit `N unpriced row(s) — cost unknown and NOT in the total; real spend is at least this much.` line under the total. Unknown is never silently folded into the number: `amicus spend --json` carries `unpricedRows` on `total`, each `byModel` entry, each `group`, and `wasted`.

**A priced row can still understate.** A leg whose own cost resolved perfectly but which spawned a subagent whose child-session spend could not be determined writes a **priced** row — it lands in the `r` bucket and contributes to the total, so `unpricedRows` cannot see it. Those rows carry `subtreeUnknown: true` in the ledger and are counted as `unattributedSubtreeRows` everywhere `unpricedRows` lives, and the table adds a second, differently-worded line: `N row(s) spawned a subagent whose CHILD session spend could NOT be determined — real spend is HIGHER than this total.` The distinction matters — "we could not see this leg at all" and "we saw this leg but not what it spawned" are different facts, and a row can be counted in both. This is the same money `council run` reports as `costExact: false` / `subtreeUnknownLegs`; before v4.4.1 the two surfaces disagreed about it.

**`unknown` means "we observed nothing we can price", not "it was free".** A run whose captured **input/output** token totals are both zero resolves to `{amount: null, source: 'unknown'}` — never to `$0` — because pricing a zero-token total as `0 × catalog` would assert a bill we cannot support and would silently under-count the `--max-cost` ceiling. That holds even when the run *did* report cache or reasoning tokens: the estimate prices input and output and nothing else, so a leg observed only in those currencies is genuinely unpriceable, and calling it $0 would be the same fabrication one corner over. (Pricing them properly needs catalog fields that may not exist; when they do, the predicate and the estimate widen together.) Councils surface the same distinction: `run.json`'s `usage` block carries `unknownLegs` and `costExact`, the human summary appends `+ N leg(s) unknown — real spend is at least this much`, and the workspace's budget gauge switches to an indeterminate (hatched) band with a `≥` readout instead of claiming a percentage it cannot know.

**Subagent (child-session) spend is attributed to the leg that spawned it.** A leg that calls the `task` tool spawns a *child* OpenCode session that OpenCode bills separately and does **not** roll into the parent session's cost. Amicus walks those sessions when the leg finishes and adds their measured spend to the run total, reporting how much came from them as `cost.subtreeCost` / `cost.subtreeSessions`. The child's price comes from OpenCode's own billing, never from a catalog estimate — the SDK's session record carries no model id, so an estimate would be a guess. Where a subtree cannot be fully accounted for (the walk failed, a bound was hit, or a child reported work with no cost), the run carries `subtreeUnknownLegs` and `costExact: false` instead of a number: `costExact: true` means "this is the whole bill", not merely "every leg reported tokens".

**Local provider runs are a real, explicit `$0` tier.** `amicus provider`'s default pricing is `{prompt: 0, completion: 0}`, and a local seat still reports real token counts — so it resolves to an *estimated* (not unknown) cost, renders as `~$0.0000`, is counted in `e`, and sits right alongside your paid runs in the same rollup. The `unknown` label above keys on observed **input/output tokens**, never on the price, precisely so this `$0` tier stays `$0` — a real local leg reports thousands of input tokens even when it bills nothing. (A local run that returned no such tokens at all did nothing, and reports `unknown` like any other — that is the honest reading.)

**Query & attribution flags (v4.3).** `continue`/`resume`/council rows are now recorded in the ledger too, not just `start`/`fanout` legs, and every row carries attribution — `op`, `status`, `waveId`, `councilRunId`/`councilName`, `project`, `gateway`, plus fallback/retry linkage when applicable. Slice and filter with:

| Flag | Filters to |
|---|---|
| `--wave <id>` | rows from one fan-out wave |
| `--council <runId\|name>` | rows from one council run — matches either the run id or a saved council name |
| `--project <path\|.>` | rows recorded against one project (`.` expands to cwd) |
| `--model <id-or-prefix>` | rows whose model id starts with the given string |
| `--op <op>` | rows for one operation (`start`, `leg`, `continue`, `resume`, …) |
| `--failed` | rows with an explicit non-`complete` status (see the caveat below) |
| `--group-by <dim>` | bucket totals by `model` (default) \| `wave` \| `council` \| `project` \| `op` \| `day` |
| `--rows` | also emit the raw filtered rows (capped at 1000; `--json` sets `rowsTruncated: true` past the cap) |

All filters compose, e.g. `amicus spend --project . --group-by model --since 7d`.

**`--failed` and the `--json` `wasted` block both exclude rows with no recorded status at all.** A ledger row written before v4.3 (or any row that never reached a terminal-status write) isn't counted as "wasted money" — it's just unattributed, and counting it would fabricate a failure that was never actually recorded, so it's dropped rather than bucketed either way.

The read-only `amicus_spend` MCP tool (see [MCP Server](#mcp-server)) mirrors every one of these flags for MCP-only hosts.

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

## Observability (v4.3)

Every fan-out wave, council run, and session already writes durable JSON to disk
(`metadata.json`/`progress.json`/`wave.json`/council `run.json` — all additively
extended, never a breaking rename). v4.3 adds two more file-based surfaces on top
of that — no push, no IPC, no `fs.watch` anywhere, just polling, so behavior is
identical on Windows/macOS/Linux and over a network mount:

- an append-only **`events.jsonl`** milestone stream, one per wave dir / council-run
  dir (`wave-started`, `leg-started`, `leg-fallback`, `leg-terminal`,
  `wave-terminal`, and the council equivalents `run-started`/`stage-started`/
  `stage-terminal`/`run-terminal`);
- the composed **live doc** — the same `amicus_status` rollup, stamped
  `view:'live'` with per-leg read-time `usage`, while the run is still going.

### Watch a run live from any terminal

```bash
amicus watch <waveId|councilRunId|sessionId>     # in-place refresh table on a TTY
amicus watch <id> --plain                        # milestone log lines (pipes/CI)
amicus watch <id> --json                         # NDJSON events + composed doc on change
amicus watch <id> --interval 0.5                 # faster refresh (floor 0.5s; default 2s)
amicus watch <id> --project <path>                # id lives in a different project
```

`watch` reads only the data layer above — no attach, works from any process, on a
live or already-finished run — and resolves `<id>` with the same canonical
resolution the rest of the CLI uses (council pointer file first, else session
metadata: `type:'wave'` → wave, else solo). Exit code maps the run's terminal
state: `complete`→`0`, `partial`→`2`, else `1` — so `amicus watch <id> &&
next-step` works as a poor-man's wait. `--ui` opens the Council Workspace window
instead of the terminal renderer (`--json` is rejected) — see the next section.

### Watch a council in a window (v4.4)

```bash
amicus watch 1a2b3c4d --ui      # Council Workspace window for that run
amicus watch --ui               # run list for the current project
```

Interactive-only (no `--json`; the terminal renderer above keeps `--json`) —
passing both fails fast rather than silently falling back to the render loop.
The window's **Fold** button writes the chair verdict back to this terminal's
output exactly like an interactive sidecar fold; closing without folding exits
`0`. Field-by-field detail — the run list, the live Seats table, the
adjudication matrix, dissent drill-in, blind mode, and the two verbs (Abort /
Fold) — is documented in **[docs/council.md's Council Workspace
section](./council.md#council-workspace-gui)**.

### Stream a launching run (`--follow`)

```bash
amicus fanout --models a,b,c --prompt-file p.md --follow
amicus council run --models a,b,c --prompt-file p.md --follow
amicus fanout ... --json --follow 2>progress.ndjson   # machine-consumable events
```

Milestone events stream to **stderr** as they happen; stdout's existing
`--json`/human contracts are byte-identical to a non-`--follow` run. On `fanout`,
`--follow` streams every leg's own start/fallback/terminal events alongside the
wave's own. **On `council run`, `--follow` streams the run's own lifecycle
(`run-started`, each stage's `stage-started`/`stage-terminal`, `run-terminal`) but
not the per-leg events inside a stage's internal fan-out sub-wave** — Stage-1's
review wave and Stage-2's judge wave launch through the same fan-out transport
internally, but the council engine doesn't thread `--follow` down into those
calls, so you see stage boundaries during a council run, not individual leg
starts/finishes within a stage.

### Run a command / notify when a run finishes (`--on-complete`)

```bash
amicus fanout ... --on-complete "notify-send 'council done'"   # CLI: exec
```

The command is user-authored on this invocation's own command line — the same
trust level as typing it into your shell; Amicus never sources hook commands from
config, briefings, or model output. The payload rides via **environment only**,
and it's ids/paths — never model-generated text — exactly these 8 variables:

| Variable | Value |
|---|---|
| `AMICUS_TASK_ID` | the wave / council-run id |
| `AMICUS_TYPE` | `wave` or `council-run` |
| `AMICUS_STATUS` | the run's terminal status |
| `AMICUS_EXIT_CODE` | the run's exit code |
| `AMICUS_RESULT_FILE` | path to the durable `wave.json`/`run.json` |
| `AMICUS_EVENTS_FILE` | path to that run's `events.jsonl` |
| `AMICUS_COST` | formatted total cost |
| `AMICUS_PROJECT` | the project directory |

A hook that wants model text reads the result file itself. The hook can never
change the run's own exit code, docs, or events — a non-zero exit or a timeout
(60s default, `AMICUS_HOOK_TIMEOUT_MS`) is logged as a warning only, never
propagated. **Over MCP, only `onComplete: "mcp-notify"` is accepted** — a
best-effort advisory notification through the MCP connection; `exec` is not
exposed to MCP callers at all. `amicus_wait` remains the reliable way to block
until a run finishes over MCP.

### Never waste a run

```bash
amicus fanout --retry-failed <waveId>               # relaunch only the dead legs
amicus fanout --retry-failed <waveId> --models qwen  # only retry that model's leg(s)
amicus fanout ... --fallback                         # opt-in cheaper-model substitution
amicus fanout ... --no-fallback                      # force it off even if config enables it
```

`--retry-failed <waveId>` relaunches only that wave's terminal, non-complete legs
(`error`/`timeout`/`crashed`/`aborted`/`idle-timeout`) as a **new, linked wave**,
replaying each failed leg's own saved initial context for a byte-identical retry.
The original `wave.json` is never touched — linkage lives in `metadata.json`
(`retryOf` on the new wave, `retriedBy` on the original). It refuses while the
original wave is still running; `--models` filters which failed legs get retried.

`--fallback` substitutes the next-cheaper model in the chain, but **only when a
leg fails on a capacity signal — rate-limit or overload — never on timeout or auth
failure** (a slow model isn't a capacity problem, and `--retry-failed` already
covers it; auth/validation failures never substitute). Off by default;
`--fallback`/`--no-fallback` override the config's `fallbacks.enabled` for one
run. Substitution is per-leg, capped (2 attempts by default), and never silent: a
`leg-fallback` event lands in `events.jsonl`, the leg's doc gains an `attempts[]`
array, and the final doc gains a `fallback: {from, reason, attempts}` block.

### See where every dollar went

`amicus spend` grew a full query and attribution surface in v4.3 — `--wave`,
`--council`, `--project`, `--model`, `--op`, `--failed`, `--group-by <dim>`,
`--rows` — see [`amicus spend`](#amicus-spend) above for the full flag table and
the wasted-view caveat. The read-only `amicus_spend` MCP tool mirrors the same
flags for MCP-only hosts.

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
