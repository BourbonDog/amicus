# Codex Host Parity — Scoping (TABLED)

> **STATUS: TABLED / NOT SCHEDULED.** This is not in the v4.7 rev plan and not on
> `docs/ROADMAP.md`. Nothing here is committed work. It exists so the scoping
> effort is not lost, and so that whoever picks it up starts from measured facts
> rather than a fresh survey.
>
> **This is deliberately NOT a task-decomposed implementation plan.** Per the
> plan-rot ruling (Christian, v4.6, 2026-08-01): implementation plans get written
> immediately before their development, never ahead of it. Every path, file, and
> line reference below WILL rot. See "Re-grounding checklist" at the bottom.

**Scoped:** 2026-08-07 · **Against:** amicus `4.6.3` on local `main` ·
**Codex observed:** `codex-cli 0.147.0-alpha.6.5` (Windows install on the dev machine)

---

## The question

If Amicus were made available to ChatGPT/Codex users, what would need to change to
reach parity with the Claude Code integration?

## Evidence basis

Findings below are split into what was **verified on disk** on this machine and
what was **read from OpenAI's docs**. The Codex build observed is an alpha; its
layout is expected to move.

Verified locally:

- `~/.codex/config.toml` — real `[mcp_servers.*]`, `[marketplaces.*]`,
  `[plugins."name@marketplace"]`, `[features]` tables
- `~/.agents/skills/*/SKILL.md` — installed skills using `name` + `description`
  frontmatter only
- `~/.cache/codex-runtimes/.../plugins/openai-primary-runtime/` — a real plugin
  tree: `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`,
  `skills/<name>/{SKILL.md,agents/openai.yaml,assets/}`
- `codex mcp add --help` — subcommand exists, signature captured below
- Absence of rollout `*.jsonl` transcripts under `~/.codex/` (see gap 3)

From docs: skill scope precedence, `[[skills.config]]`, `agents/openai.yaml`
schema, invocation syntax. Sources:
<https://learn.chatgpt.com/docs/build-skills.md>,
<https://learn.chatgpt.com/docs/config-file/config-reference>.

---

## What ports with no changes

The three load-bearing pieces are already host-agnostic:

| Piece | Why it ports |
|---|---|
| **The engine** | `bin/amicus.js`, `amicus council run` — a plain Node CLI. No host coupling. |
| **The MCP server** | `src/mcp-server.js` speaks standard stdio MCP; Codex is an MCP client. All 16 `amicus_*` tools work unchanged. |
| **The skill bodies** | Codex requires exactly `name` + `description` frontmatter — what `skills/second-opinion/SKILL.md` and `skills/sidecar/SKILL.md` already have. They are valid Codex skills sitting in the wrong directory. |

Codex also supports subagents (`[features] multi_agent = true` →
`spawn_agent`/`wait_agent`/`close_agent`), so orchestration patterns survive.

The consequence worth internalizing: **this is an adapter problem, not a port.**
Nothing in the council engine needs rewriting. What is Claude-shaped is the
*installation*, the *surfaces*, and one *default-selection rule* (gap 6).

---

## Gaps

### 1. Install-time registration — the largest mechanical gap

`scripts/postinstall.js` delegates to `src/utils/claude-register.js`, which knows
three targets and only three: `~/.claude/skills/`, `~/.claude.json`,
`claude_desktop_config.json`.

Codex needs:

- **Skills** → `~/.agents/skills/{sidecar,second-opinion}/` (user scope). Repo
  scope is `.agents/skills`; admin scope `/etc/codex/skills`. Note the
  destination is `~/.agents/`, NOT `~/.codex/skills/` — both directories exist on
  this machine and only the former held installed skills.
- **MCP** → `[mcp_servers.amicus]` in `~/.codex/config.toml`. **TOML, not JSON**,
  so `addMcpToConfigFile`'s JSON-merge does not apply.

Prefer the CLI path, mirroring the existing `claude mcp add-json` approach:

```
codex mcp add amicus --env AMICUS_SKIP_POSTINSTALL=1 -- npx -y amicus@latest mcp
```

(Signature verified: `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)`,
with `--env KEY=VALUE` for stdio servers.)

A file-edit fallback is materially riskier than the Claude JSON path: the observed
`config.toml` already carries `[marketplaces.*]`, `[plugins.*]`, `[features]`, and
nested `[mcp_servers.node_repl.env]` tables that a naive rewrite would clobber. A
round-tripping TOML editor is a new runtime dependency. **Recommended: CLI-only,
with a printed manual snippet on failure** — no silent partial write.

Structural constraint: `src/utils/claude-register.js` is at **267 lines** against
the hard 300-line gate. Codex registration must land as a new sibling module
(`codex-register.js`), not as an extension of the existing one.

Also in scope: `amicus init` re-run path, `amicus doctor` detection/repair for the
Codex side, and a parallel registration test suite.

### 2. Codex's sandbox will break council runs out of the box

No Claude Code analog. Codex defaults to a restricted sandbox (workspace-write,
constrained network). Amicus needs outbound network to every provider and writes
to `~/.config/amicus`.

Left undocumented, the first `amicus council run` under Codex fails in a way that
reads like an API/key problem. Per the product principle
(install/run must be simple and error-free; on error self-heal OR self-diagnose,
always transparently — and a correct-but-silent degrade fails the bar as hard as a
crash), this wants **explicit detection and a named remedy**, not a generic error
surfaced from the provider layer.

### 3. `--session-id` conversation context — the one real functional gap

`skills/sidecar/SKILL.md` folds conversation context by reading
`~/.claude/projects/<encoded-path>/<session-id>.jsonl`.

**Verified:** this Codex build has no rollout `*.jsonl` transcripts. Conversation
state lives in SQLite (`~/.codex/state_5.sqlite`, `~/.codex/sqlite/codex-dev.db`,
`~/.codex/memories_1.sqlite`). The schema was **not** read and is not documented;
the `state_5` / `logs_2` / `memories_1` naming implies versioned schemas that will
move — and this is an alpha build.

Scope containment matters here: **the council is unaffected.** The second-opinion
skill's own transport rule already guarantees briefings are self-contained
(that is what makes the MCP transport equivalent). Only the `sidecar` chat skill's
*automatic* context capture breaks.

Recommended direction: **degrade explicitly and loudly** — announce that
conversation auto-context is unavailable on this host and point at
`--prompt-file` — rather than reverse-engineer an undocumented, versioned SQLite
schema. Revisit only if Codex publishes a stable transcript-read interface.

### 4. Slash-command surface

`commands/council.md` uses Claude's `$ARGUMENTS` and
`disable-model-invocation: true`. Codex's explicit invocation is `$<skill-name>`,
and invocation policy lives in `agents/openai.yaml` as
`policy.allow_implicit_invocation` (defaults `true`).

So `/council` becomes `$second-opinion`. Worth noting the polarity is inverted
from the Claude side: `commands/council.md` deliberately disables model
invocation, while the skills themselves should stay implicitly invocable.

### 5. Interface + plugin channel

Two related pieces of "looks native on the host" work:

**`agents/openai.yaml` per skill** — optional, cheap, and what gives a skill a
display name, icon, brand color, and default prompt. Amicus already has
`scripts/generate-icon.js` and the clay `#d97757` / gold `#e8b24a` tokens, so this
is mostly assembly. Observed schema (from the bundled `pdf` skill):

```yaml
interface:
  display_name: "PDF"
  short_description: "..."
  icon_small: "./assets/file-document.png"
  icon_large: "./assets/file-document.png"
  brand_color: "#DC2626"
  default_prompt: "Use $pdf to ..."
```

Docs additionally list `policy.allow_implicit_invocation` and a `dependencies`
block that can declare MCP servers — the latter is the interesting one, since it
could declare the amicus MCP server as a skill dependency.

**Plugin/marketplace manifests** — the Codex analog of
`.claude-plugin/{plugin.json,marketplace.json}` is
`.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`. Similar but NOT
identical:

- Codex `plugin.json`: `"skills": "./skills/"` (a string path, not an array of
  skill paths) plus a rich `interface: {}` block
  (`displayName`, `shortDescription`, `longDescription`, `capabilities`,
  `websiteURL`, `privacyPolicyURL`, `termsOfServiceURL`, …)
- Codex marketplace entries: `source: { source: "local", path: "./plugins/x" }`
  (an object) plus `policy: { installation, authentication }` and `category` —
  vs Claude's flat `"source": "./"`

Implies: a second manifest pair, additions to `package.json` `files[]`, and a
version-lock test mirroring the existing plugin.json↔package.json lock.

### 6. The bench-exclusion rule is hardcoded to "Claude" — the substantive change

This is the only gap that is not adapter work.

The second-opinion skill's principles #2 and #3 state that the council excludes
Claude and that a **non-Claude** chair synthesizes the verdict. The *reason* is
that Claude is the orchestrator — the independence property depends on the bench
and chair sitting outside the orchestrator's family.

`src/utils/curated-models.js` and `src/utils/council-presets.js` encode this
literally: Claude is special-cased, while `gpt` and `codex` are ordinary bench
members. Under Codex the orchestrator is GPT — so a default council would seat
the orchestrator's own family, and could chair with it, **quietly destroying the
property the product rests on.** A silent correctness loss, not a crash: exactly
the failure class the product principle names.

The fix is to generalize the rule: exclude **the orchestrator's family, whatever
it is**, and select a chair outside it. Touches `council-presets.js`,
`curated-models.js`, `model-validator.js` (which maps `codex` → `gpt`), and the
skill's principles prose.

This one deserves a council of its own before implementation.

### 7. Smaller items

- **Background-launch instruction is Claude-specific.** `skills/sidecar/SKILL.md`
  mandates the Bash tool's `run_in_background: true`. Codex's shell tool has no
  such parameter. Needs host-neutral phrasing, or to route through
  `amicus watch` / `--follow`.
- **Positioning copy and metadata.** README, site, `docs/*.md`, the plugin and
  marketplace descriptions ("for Claude Code"), and npm `keywords` (currently
  leads with `claude-code`). `CLAUDE.md`'s own project overview says "extends
  Claude Code."
- **`amicus doctor` reporting** currently speaks only Claude registration state.
- **Electron GUI** (`amicus watch --ui`) should be unaffected — separate process —
  but the "kill by EXACT ExecutablePath, never blanket-kill electron.exe" rule
  still applies and would want restating in any Codex-facing troubleshooting doc.
- **`AGENTS.md`** is Codex's instruction-file convention; the repo currently
  carries `CLAUDE.md` only. Relevant for contributors on Codex, not for consumers.

---

## Effort shape (indicative only — not an estimate)

| Tier | Contents |
|---|---|
| **Must-have** | gap 1 (`codex-register.js` + postinstall/init/doctor + tests), gap 2 (sandbox detection + docs), gap 3 (explicit degrade), gap 7 background-launch phrasing |
| **Parity polish** | gap 4 (`$second-opinion` surface), gap 5 (`agents/openai.yaml` + `.codex-plugin` + marketplace), gap 7 copy/keywords/doctor |
| **Substantive** | gap 6 (orchestrator-family-aware bench and chair) |

Tiers 1 and 2 are additive and low-risk to existing Claude behavior. Tier 3
changes default council composition for **all** hosts and must not be folded in
casually.

---

## The open product question

Amicus is currently positioned as a Claude Code companion, down to the npm
keywords and the marketplace copy. Codex support is not only a porting job — it
forces a decision:

> Is Amicus a **Claude Code companion**, or a **host-neutral council engine with
> per-host adapters**?

Gap 6 is where that decision actually gets made, because generalizing the
bench-exclusion rule means the product no longer assumes who is orchestrating.
Everything else can be deferred; that one cannot be done halfway.

Deciding this belongs to Christian, and should precede any tier-3 work.

---

## Re-grounding checklist (do this FIRST if this is ever picked up)

Every fact here has a decay rate. Before writing an implementation plan:

1. **Re-verify the Codex build.** Observed here was `0.147.0-alpha.6.5`. Skill
   paths (`~/.agents/skills`), plugin layout (`.codex-plugin/`), and the
   marketplace manifest shape are all alpha-era observations.
2. **Re-run `codex mcp add --help`** — confirm the signature and the `--env` flag
   still exist before building registration on them.
3. **Re-check for transcript files** under `~/.codex/`. If rollout JSONL returns,
   gap 3 changes character entirely.
4. **Re-read `src/utils/claude-register.js`'s line count** against the 300-line
   gate, and re-check whether the Claude registration surface has itself moved.
5. **Re-check `curated-models.js` aliases.** `codex` currently routes to
   `openrouter/openai/gpt-5.3-codex` (verified 2026-06-09) and `model-validator.js`
   maps `codex` → `gpt`. Model aliases drift fast in this repo.
6. **Check `BACKLOG.md`'s refuted-findings section** and Appendix A/B before
   re-filing anything from this document.
