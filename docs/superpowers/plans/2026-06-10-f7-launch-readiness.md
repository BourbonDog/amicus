# F7 — Launch Readiness Implementation Plan (Council v3 + Docs Refresh)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the LLM Council skill onto the F4 fanout/JSON engine primitives, close the three launch-blocking gaps (council ships+installs, wizard title, package identity), then refresh every user-facing doc surface against the finished product.

**Architecture:** Two sequenced phases per the spec (`docs/superpowers/specs/2026-06-10-f7-launch-readiness-design.md`). Phase 1 (Tasks 1–8) changes the product: council skill v3 (transport swap, v2 brain untouched), postinstall/both-skills, package.json, wizard title — gated by a real-LLM council smoke (Task 8). Phase 2 (Tasks 9–16) rewrites the docs against the Phase-1 product, council-as-hero. Task 17 is holistic review + merge. The two-phase single-plan packaging is a locked spec decision — do not split.

**Tech Stack:** Node 18+, Jest, plain markdown. No new dependencies.

**Execution context:** Work in an isolated git worktree (the F-milestone pattern):

```powershell
git -C C:\Users\sendt\dev\amicus worktree add C:\Users\sendt\dev\amicus-f7 -b f7-exec main
New-Item -ItemType Junction -Path C:\Users\sendt\dev\amicus-f7\node_modules -Target C:\Users\sendt\dev\amicus\node_modules
```

Hooks fire in worktrees since PR #9 (`core.hooksPath=.husky`, committed). Suite baseline: **1848 passed / 4 skipped / 0 failed**; `npm run lint` clean. All paths below are relative to the worktree root. Never run a bare `npm install` (repo postinstall mutates global Claude config). Cleanup at the end: `Remove-Item -Force C:\Users\sendt\dev\amicus-f7\node_modules` (NO `-Recurse` — it would delete the junction TARGET), then `git worktree remove`.

**Verified facts used throughout (do not re-derive):**
- Wave JSON (`schemaVersion: 1`): wave = `{type:'wave', waveId, status: running|complete|partial|error|aborted, counts:{total,complete,error,timeout,aborted}, legs:[...]}`; exit codes 0=complete, 2=partial, 1=error/aborted (+130/143 signals).
- Leg/run doc: `{type:'run', taskId, waveId, model, modelInput, agent, status, summary, error, createdAt, completedAt, durationMs, sessionDir, opencodeSessionId}` — per-leg timing IS available (`durationMs`).
- `fanout` is headless by definition (no `--no-ui` flag); solo `start` needs `--no-ui`. `--wave-id <id>` makes leg IDs `<id>-1..N`. Duplicate models allowed (distinct legs). Per-leg knobs shared: `--agent --thinking --timeout --summary-length --no-context --context-* --mcp* --no-validate-model --cwd`.
- CLI commands (from live `--help`): start, fanout, list, resume, continue, read, models, abort (incl. `--all`), setup (incl. `--api-keys`, `--add-alias`), update, mcp.
- MCP tools: amicus_start, amicus_status, amicus_read, amicus_list, amicus_resume, amicus_continue, amicus_abort, amicus_setup, amicus_guide, amicus_fanout (10 total; sidecar_* aliases dual-registered).
- SVG `sidecar` hits are XML comments only (never rendered) → **no PNG re-rendering anywhere**.
- `electron/setup-ui.js` line 27 is the only hardcoded "Sidecar Setup"; the visible header already uses dynamic `${brandName}`.

---

## Phase 1 — Council v3 + launch-blocking gaps

### Task 1: COUNCIL-DESIGN.md v3 (consolidate the council design doc)

**Files:**
- Create: `skills/second-opinion/COUNCIL-DESIGN.md`
- Delete: `skills/second-opinion/V2-COUNCIL-DESIGN.md`

- [ ] **Step 1: Create COUNCIL-DESIGN.md from V2 with the v3 delta**

Copy `V2-COUNCIL-DESIGN.md` to `COUNCIL-DESIGN.md`, then apply exactly these changes:

1. Replace the title + status lines:

```markdown
# Second Opinion v3 — "LLM Council" Design

_Status: implemented (v3). v2 (2026-06-03) added the council mechanics; v3 (2026-06-10) swapped the
transport onto the Amicus fanout/JSON engine primitives. v2 history lives in git
(`V2-COUNCIL-DESIGN.md`, deleted at v3)._
_Design for `SKILL.md` and `MODEL-NOTES.md` of the `second-opinion` skill._
```

2. In **§2 Core framing**, replace the last bullet ("This is an executed skill, not an app. …") with:

```markdown
- **This is an executed skill, not an app.** All council logic (anonymize → rank → aggregate →
  chair) is prose workflow Claude performs while driving the `amicus` CLI. v3 note: the *transport*
  is now engine-native — each review wave is ONE `amicus fanout --json` call returning structured
  run documents — but scoring, tallying, anonymization, and synthesis remain Claude's manual work.
  No backend, no parsing code beyond reading JSON fields.
```

3. In **§3 What changes vs v1** table, append a row:

```markdown
| Transport (v3) | N parallel `start` calls + prose-scraping | ⭐ one `fanout --json` wave per stage; briefings via `--prompt-file`; JSON status/summary parsing |
```

4. In **§4 Stage 1**, replace the first bullet with:

```markdown
- All council models review **your artifact** via ONE fanout wave (see SKILL.md Stage 1 for the
  canonical command). The wave JSON returns every leg's status + review in one parse. A red-team
  reviewer with a distinct brief runs as a parallel solo `amicus start --json` (fanout legs share
  one prompt by design).
```

5. In **§4 Stage 2**, replace "The **same bundle** goes to **every** council model" sentence with:

```markdown
- The **same bundle** goes to **every** council model — exactly fanout's shared-prompt model: one
  wave call distributes it, and each judge is asked to do two things on the bundle:
```

6. Replace **§8 Gating, cost, degradation & failure handling** in full with:

```markdown
## 8. Gating, cost, degradation & failure handling

- **Gating:** council is the default identity but scales down (§ Stage 0). Always disclose run
  shape/cost and confirm before launching.
- **Cost guardrail (unchanged):** never `o3`/`o3-pro` unless the user asks by name; warn on cost.
- **Degradation (judge-count thresholds, unchanged):** gating counts **non-Claude judges**.
  1 judge → single-pass (no Stage 2/chair); if the bench drops below 2 mid-run, degrade to
  single-pass and disclose. 2 judges → Stage 2 runs but note the thin ranking. ("Claude in the
  council" adds a *judged* review but **no** judge.)
- **Wave-degrade rules (v3):** leg failures are read from the wave document
  (`status: partial`, `counts`, per-leg `status`/`error`):
  - **Stage 1:** a leg ends `error`/`timeout`/`crashed`/`aborted` → proceed when ≥2 reviews
    survive; below 2, offer a re-run of the dead leg or a disclosed downgrade to single-pass.
  - **Stage 2:** a judge leg dies → tally rankings/adjudications over the surviving judges and
    disclose the reduced bench in `crossreview-matrix.md`. Tier definitions are unchanged (they
    already count "judges engaged").
  - **Stage 3:** chair failure keeps the v2 fallback chain (re-run → promote next-best non-Claude
    → Claude chairs with explicit disclosure).
- **Run stats (v3):** `report.md` includes a per-leg table (model, status, durationMs) read from
  the wave/run documents. The schema carries no cost data — never invent cost figures.
- **Transient failures:** provider 502s etc. → re-run the affected leg (solo `start --json`) or
  the wave; never present a half-finished run as an answer.
```

7. In **§11 Implementation surface**, replace the file list with:

```markdown
- `SKILL.md` — the Stage 0–6 council flow on the v3 transport.
- `MODEL-NOTES.md` — reviewer-reliability table, per-model quirks, cost guardrail, Stage-2
  briefing tips. Engine workarounds that F1/F2/F4 made obsolete were pruned at v3.
- No other files.
```

- [ ] **Step 2: Delete the V2 file**

```powershell
git rm skills/second-opinion/V2-COUNCIL-DESIGN.md
```

- [ ] **Step 3: Verify internal consistency**

Run: `Select-String -Path skills/second-opinion/COUNCIL-DESIGN.md -Pattern 'V2-COUNCIL|poller|single-read'`
Expected: only the intentional git-history note from Step 1.1 matches `V2-COUNCIL`; zero matches for `poller`/`single-read`.

- [ ] **Step 4: Commit**

```bash
git add -A skills/second-opinion/
git commit -m "docs(f7): consolidate council design doc to v3 (fanout transport + degrade rules)"
```

---

### Task 2: Council SKILL.md v3 — transport rewrite

**Files:**
- Modify: `skills/second-opinion/SKILL.md`

The Stage 0–6 brain (anonymization, scoring, tiers, chair, Claude-in-council, scale-down levels) is **unchanged**. Only transport text changes. Apply each edit exactly.

- [ ] **Step 1: Stage 0 — prep + run-shape edits**

In **Stage 0 — Intake & prep**, replace the "Prepare material for sidecar models" block (the three bullets) with:

```markdown
**Prepare material for council models:**
- Large, linked, or heavily marked-up sources → extract clean text to a small, clearly-named temp
  file in the run folder (briefing hygiene: token cost and model focus). Reference its absolute
  path in the briefing, or inline it if small.
- Small, clean text → feed inline in the briefing.
- Write every briefing to a temp file (`_tmp-*.md` in the run folder) and pass it with
  `--prompt-file` — never inline a briefing as a CLI argument. All `_tmp-*` files are cleaned up
  after the run.
```

In the run-shape disclosure example, replace the quoted line with:

```markdown
> This run uses 3 council models across 2 fanout waves + 1 chair call (~7 model runs), ~10 min.
```

- [ ] **Step 2: Stage 1 — replace the launch mechanics**

Replace everything in **Stage 1 — Independent reviews** from "Each council model reviews **the artifact** independently…" through "…do not poll. Launch the full wave in parallel before waiting on any single result." with:

```markdown
Each council model reviews **the artifact** independently. Write one Stage-1 briefing file
(`_tmp-briefing-stage1.md` in the run folder) and launch the whole wave as ONE background call:

```
amicus fanout --models <m1,m2,m3> --prompt-file <run-folder>/_tmp-briefing-stage1.md --json \
  --agent Plan --no-context --summary-length verbose --timeout <min>
```

Run it in the background (`run_in_background: true`); you are notified on completion — do not
poll. `fanout` is headless by definition. The command exits when every leg is terminal and prints
ONE JSON wave document on stdout (`schemaVersion: 1`): check `status` (`complete` | `partial` |
`error`), `counts`, and each leg in `legs[]` — a leg's `summary` field IS that model's review;
`model`/`modelInput` identify the reviewer; `status`/`error` identify failures. Exit code 0 =
all legs complete, 2 = partial (apply the wave-degrade rules below), 1 = error/aborted.

**Red-team variant:** fanout legs share a single prompt by design. When one model gets a distinct
red-team brief, launch it as a parallel solo run alongside the wave:

```
amicus start --model <redteam-model> --no-ui --json \
  --prompt-file <run-folder>/_tmp-briefing-redteam.md \
  --agent Plan --no-context --summary-length verbose --timeout <min>
```

Its stdout is a single run document; the `summary` field is the review.

**Cowork / no-Bash environments:** use the MCP tools instead — `amicus_fanout` (briefing via
file) returns `{waveId, taskIds[]}` immediately; poll `amicus_status`, then `amicus_read` each
leg. The council's briefings are always self-contained (`--no-context`), so MCP transport is
equivalent.
```

Then replace the sentence "Instruct models to emit the structured output verbatim, without preamble or narration, so it reads cleanly. Briefings should apply the single-read / no-glob / no-narration mitigation from `MODEL-NOTES.md`." with:

```markdown
Instruct models to emit the structured output verbatim, without preamble, so it reads cleanly.
```

And replace "Save each raw review to the run folder as `review-<model>.md` the moment it arrives. Do not wait for all models before saving." with:

```markdown
When the wave returns, save each leg's `summary` to the run folder as `review-<model>.md`
(one file per reviewer) before moving on.
```

- [ ] **Step 3: Stage 1 — add the wave-degrade rules**

Append to the end of Stage 1 (after the Claude-in-council paragraph):

```markdown
**Wave-degrade rules (Stage 1).** Read failures from the wave document — never silently ignore
them:
- All legs `complete` → proceed normally.
- A leg ends `error`/`timeout`/`crashed`/`aborted` but **≥ 2 reviews survive** → proceed with the
  survivors; name the dead leg and its `error` when presenting; the bench shrinks accordingly.
- **Fewer than 2 reviews survive** → offer the user a re-run of the dead leg(s) (solo
  `amicus start --json`, same briefing file) or a disclosed downgrade to single-pass mode
  (Stage 2 and Stage 3 skipped, per the scale-down rules).
```

- [ ] **Step 4: Stage 2 — replace the distribution mechanics**

Replace the paragraph "**Distribute the same bundle to every council model in parallel** (background sidecars per `MODEL-NOTES.md`). Each judge is asked to do two things on the bundle:" with:

```markdown
**Distribute the same bundle to every council model** — this is exactly fanout's shared-prompt
model. Write the bundle + judging instructions to `_tmp-bundle-stage2.md` and launch one wave:

```
amicus fanout --models <m1,m2,m3> --prompt-file <run-folder>/_tmp-bundle-stage2.md --json \
  --agent Plan --no-context --summary-length verbose --timeout <min>
```

(Background, same JSON handling as Stage 1.) Each judge's leg `summary` is its ranking +
adjudication response. **Stage-2 degrade:** a judge leg dies → tally over the surviving judges
(≥ 1) and disclose the reduced bench in `crossreview-matrix.md`; tier definitions are unchanged
(they already count "judges engaged"). Each judge is asked to do two things on the bundle:
```

- [ ] **Step 5: Stage 3 — replace the chair call**

Replace "**Chair briefing.** Send the chair one call (single background sidecar per `MODEL-NOTES.md`) containing:" with:

```markdown
**Chair briefing.** Write the chair packet to `_tmp-chair-packet.md` and send one solo run
(background):

```
amicus start --model <chair> --no-ui --json \
  --prompt-file <run-folder>/_tmp-chair-packet.md \
  --agent Plan --no-context --summary-length verbose --timeout <min>
```

The run document's `summary` is the verdict. The packet contains:
```

- [ ] **Step 6: Stage 5 — run stats in report.md**

In the run-folder artifact list of Stage 5, replace the `report.md` bullet with:

```markdown
- `report.md` — the chair's synthesis + the full Stage-4 decision log + a summary of what was
  applied (+ the "How Claude's review fared" readout when "Claude in the council" is on) + a
  **run-stats table**: one row per model call (stage, model, status, durationMs) read from the
  wave/run JSON documents. The schema carries no cost data — do not invent cost figures.
```

- [ ] **Step 7: Output & naming — temp files**

In **Output & naming**, replace the "Temp extracts" bullet with:

```markdown
- Temp working files (`_tmp-*.md`: extracts, stage briefings, bundle, chair packet) live in the
  run folder and are cleaned up at the end of the run.
```

- [ ] **Step 8: Scale-down transport note + Files section**

In Stage 0's scale-down list, append to the "**1 model** →" bullet: `Transport: a single solo
``amicus start --no-ui --json`` (no fanout).`

In the "## Files" section at the bottom, replace the `V2-COUNCIL-DESIGN.md` bullet with:

```markdown
- `COUNCIL-DESIGN.md` — the design spec this skill implements (v3). Consult it if a mechanics
  question arises that the skill prose does not resolve.
```

- [ ] **Step 9: Verify no stale transport references remain**

Run: `Select-String -Path skills/second-opinion/SKILL.md -Pattern 'no-glob|single-read|no-narration|V2-COUNCIL'`
Expected: zero matches.
Run: `Select-String -Path skills/second-opinion/SKILL.md -Pattern '--no-ui' -SimpleMatch`
Expected: matches only in the red-team solo command, the chair command, and the 1-model scale-down note (fanout needs no flag).

- [ ] **Step 10: Commit**

```bash
git add skills/second-opinion/SKILL.md
git commit -m "feat(f7): council skill v3 — fanout/JSON transport, prompt-file briefings, wave-degrade rules"
```

---

### Task 3: MODEL-NOTES.md v3 prune

**Files:**
- Modify: `skills/second-opinion/MODEL-NOTES.md` (full replacement)

- [ ] **Step 1: Replace the file content in full**

```markdown
# MODEL-NOTES — Operating Lessons for Amicus Models

This file is the `second-opinion` skill's evolving memory of **how to actually drive each model
well**. Read it before Stage 0 (council selection and launch); update it, with the user's
approval, at the end of each run (Stage 6). Keep it tight — merge and prune rather than append.

_Last updated: 2026-06-10 (v3 migration: engine workarounds pruned — see changelog)._

## Global operating rules (all models)
- **Council runs are headless by design** (autonomous batch work): `fanout` is headless by
  definition; solo runs use `--no-ui`. Interactive GUI sessions are for the `sidecar` chat skill,
  not councils.
- **`--agent Plan`** for review/analysis — read-only, so a model can't accidentally edit the source.
- **`--no-context`** always — council briefings are self-contained; don't drag the host
  conversation in.
- **`--summary-length verbose`** — the analysis IS the deliverable; don't let it get summarized away.
- **Briefings via `--prompt-file`** (temp `_tmp-*.md` files in the run folder) — no size cap, no
  shell-quoting hazards. Never inline a briefing as a CLI argument.
- **Run in the background (`run_in_background: true`); you're notified on completion. Don't poll.**
- **Read results from the JSON documents** (`--json`): a wave's `legs[].summary` / a run's
  `summary` is the model's output; `status`/`error`/`counts` are ground truth for failures. Never
  scrape stderr logs to judge success.
- **Credentials:** keys live in `~/.config/amicus/.env` (legacy `~/.config/sidecar/.env` still
  read). Configure with `amicus setup`.

## Stage-2 cross-review briefing tips

- **Send the same anonymized bundle to every judge** — stable labels Review A/B/C…, no model
  names — so rankings are directly comparable (one fanout wave distributes it).
- **Require a `FINAL RANKING:` block** at the end of the response (e.g. `1. Review C / 2. Review
  A …`), plus a per-finding `agree | dispute | neutral` verdict with a one-line reason for each
  finding referenced by label+id (e.g. `A2`).

## Per-model notes

### Gemini  (`--model gemini`)
- **Strengths:** fast, very large context. Good for broad sweeps and long documents.
- **Quirk:** tends to narrate intentions and pad with preamble; instruct it to emit the
  structured output verbatim, without preamble. (Historical: its narrate-then-glob habit used to
  trip the old headless poller; the engine handles tool-call gaps now — F1.)
- Don't trust its self-reported version string ("I am gemini-X") as ground truth.

### DeepSeek  (`--model deepseek` → via OpenRouter)
- **Strengths:** resilient; produces strong, well-structured, well-cited critical analysis. A good
  default reviewer and a proven chair.
- **Quirk:** occasional transient 502 mid-run → re-run the leg.

### GPT  (`--model gpt` → via OpenRouter)
- **Strengths:** reachable via the OpenRouter key; resilient; very thorough structured critique
  (25 findings on a 1-page framework). Cleanly separates the review criteria.
- **Quirks:** verbose — peers dinged it for volume-over-judgment (good coverage, lower
  discrimination); **self-ranked its own review #1** in cross-review → discount self-votes.

### (others — add as used)
- Opus / o-series etc. are reachable via amicus **if their API keys are configured**. Add notes
  here the first time each is used.

## Reviewer-reliability table

Consulted in Stage 0 (council selection) and updated with approval in Stage 6.

- **avg street-cred** — rolling average of this model's per-run street-cred (mean rank position
  across judges' `FINAL RANKING:` blocks; lower = better).
- **confirm-rate** — share of this model's findings that reached the **Confirmed** tier (agrees
  outweigh disputes, ≥ 2 judges engaged).

| model | runs | avg street-cred | confirm-rate | notes |
| --- | --- | --- | --- | --- |
| deepseek | 1 | 2.33 | 100% (12/12) | strong synthesis, resilient; chaired well |
| gpt | 1 | 2.67 | 92% (23/25) | thorough but verbose; self-ranked #1 → discount; OpenRouter |
| gemini | 1 | 3.67 | 89% (8/9) | fast, large-context; more absolute/adversarial ("blocker" inflation); ranked lowest |

_Scale note: the 2026-06-04 run used a 4-review pool (Claude in-council), so street-cred is on a
1–4 scale rather than 1–3 — treat these as run-1 baselines, not directly comparable to future
3-model runs. Merge/prune rather than append._

## Cost guardrail
- **Never** use `o3` / `o3-pro` unless the user explicitly asks for it by name — these cost
  roughly $10–60+ per request. Warn about cost before proceeding even when asked.

## General
- Model citations are usually real but **verify any load-bearing reference before publishing**;
  watch for loosely-attached attributions (e.g., a real paper cited for the wrong claim).
- Prefer models from **different families** for genuinely independent opinions.

## Lessons changelog
- **2026-06-03** — Seeded from the study-guide review (Gemini + DeepSeek). Found the (since-fixed)
  headless poller trap and Gemini's narrate-then-glob pattern; confirmed DeepSeek's resilience and
  its occasional transient 502.
- **2026-06-03** — v2 council upgrade: added cross-review (Stage-2 anonymized peer ranking +
  per-finding adjudication) and reviewer-reliability tracking.
- **2026-06-04** — Trusst messaging-framework council (Gemini + GPT + DeepSeek + Claude-in-council;
  DeepSeek chair). First GPT use → per-model note. First scored reviewer-reliability rows
  (deepseek 2.33/100%, gpt 2.67/92%, gemini 3.67/89%; 1–4 scale).
- **2026-06-10** — v3 migration: transport moved to `fanout --json` + `--prompt-file` (F4); pruned
  the obsolete engine workarounds they replaced — the headless-poller trap + single-read/no-glob/
  no-narration ritual + "Polling loop exited" false-alarm note (fixed by F1), the ~32 KB inline-arg
  cap (superseded by `--prompt-file`), the absolute-path/cwd trap (fixed by F2), and the
  GUI-hangs-on-this-machine rule (resolved 2026-06-10; headless stays the council default by
  design). Config path updated to `~/.config/amicus/.env`.
```

- [ ] **Step 2: Verify the prune**

Run: `Select-String -Path skills/second-opinion/MODEL-NOTES.md -Pattern 'poller trap|Polling loop|32 KB|32KB|cd in|absolute-path|GUI hangs|config/sidecar'`
Expected: matches ONLY inside the "Lessons changelog" 2026-06-10 entry (historical record) and the Gemini historical parenthetical. No operating-rule matches.

- [ ] **Step 3: Commit**

```bash
git add skills/second-opinion/MODEL-NOTES.md
git commit -m "docs(f7): MODEL-NOTES v3 — prune obsolete engine workarounds, keep model wisdom + reliability table"
```

---

### Task 4: Chat skill (`skill/SKILL.md`) accuracy pass

**Files:**
- Modify: `skill/SKILL.md`

The skill keeps its `sidecar` name and install path (locked F6 decision). Apply these edits:

- [ ] **Step 1: Front-matter critical rules**

Replace critical rule (3) in the YAML description — currently "Use --prompt for the start command (NOT --briefing). --briefing is only for subagent spawn." — with:

```
(3) For long or multi-line briefings, write them to a temp file and pass --prompt-file <path>
(mutually exclusive with --prompt; avoids shell-quoting hazards and argument-size caps).
```

Append a critical rule (6):

```
(6) When the SAME prompt should go to N models, use `amicus fanout --models a,b,c
--prompt-file <path> --json` (one headless wave, one JSON result) instead of N separate
start calls. Different prompts per model → separate parallel `amicus start --no-ui` calls.
```

- [ ] **Step 2: Delete the unimplemented subagent surface**

Remove entirely (they document a feature that does not exist — the 🚧 banner admits it):
- The "### Subagent Commands" section (banner + spawn/list/read subsections).
- The "### Subagents (Spawned Within Sessions)" subsection of Agent Modes (General/Explore spawn examples) AND the closing "**Important:** When using `amicus start`…subagent spawn…" line.
- "### Example 4: Spawn Subagents for Parallel Work" (renumber Example 5 → 4).
- In the `--agent` option bullet under Commands: drop the "**Subagents (for `amicus subagent spawn`):**" block; keep Chat/Plan/Build and the custom-agents note. Keep the Agent Headless Compatibility table rows for `explore`/`general` (they remain valid `--agent` values for `start`).

- [ ] **Step 3: Add fanout + models + abort to Commands**

After the "### Start a Sidecar" section, insert:

```markdown
### Fan Out One Prompt to N Models

```bash
amicus fanout --models gemini,gpt,deepseek --prompt-file ./briefing.md --json
```

Runs the same prompt on every listed model in parallel (one shared engine server, headless),
then prints ONE JSON wave document: `status` (`complete`|`partial`|`error`), `counts`, and
`legs[]` where each leg's `summary` is that model's answer. Exit codes: 0 complete, 2 partial,
1 error/aborted. Aliases and full `provider/model` IDs both work; duplicates are allowed
(distinct legs). `--wave-id <id>` pins leg IDs to `<id>-1..N`. Shared per-leg knobs: `--agent`,
`--thinking`, `--timeout`, `--summary-length`, `--no-context`, `--context-*`, `--mcp*`,
`--no-validate-model`, `--cwd`.

### Inspect the Model Catalog

```bash
amicus models                    # list the live catalog (context + pricing columns)
amicus models --search grok      # substring search over id + name
amicus models --refresh          # force-refresh from OpenRouter (TTL cache otherwise)
amicus models --check            # audit configured aliases against the catalog
```

The catalog is cached at `~/.config/amicus/model-catalog.json` and refreshes automatically;
`start`/`fanout` validate models against it before launching (skip with `--no-validate-model`).

### Abort a Running Session

```bash
amicus abort <task_id>     # stop one session
amicus abort --all         # stop every running session in this project
```
```

- [ ] **Step 4: Start options accuracy**

In the "### Start a Sidecar" options list add:

```markdown
- `--prompt-file <path>`: Read the prompt/briefing from a UTF-8 file (mutually exclusive with
  `--prompt`). Use for long or multi-line briefings.
- `--json`: With `--no-ui`, emit the run result as one stable JSON document on stdout
  (`schemaVersion: 1`; the `summary` field is the model's output).
- `--no-validate-model`: Skip the model-catalog pre-flight check (validation is on by default).
```

- [ ] **Step 5: Replace the curl model-verification section**

Replace the "### Verifying Model Names" section body (the curl + jq block and its prose) with:

```markdown
Model names change frequently. Verify against the live catalog:

```bash
amicus models --search gemini
```

Aliases are seeded by `amicus setup` and audited by `amicus models --check`, which suggests
replacements for stale aliases.
```

- [ ] **Step 6: Path + setup corrections**

- Replace both `~/.config/sidecar/.env` occurrences (Troubleshooting "Missing Authentication header" section) with `~/.config/amicus/.env` and amend the resolution order line to: `process.env` > `~/.config/amicus/.env` (legacy `~/.config/sidecar/.env` still read) > `~/.local/share/opencode/auth.json`.
- In "## Setup: Configuring API Access", insert before Option A: `**Recommended:** run `amicus setup` — a guided wizard that stores keys in `~/.config/amicus/.env`, picks your default model from the live catalog, and seeds aliases. The options below are manual alternatives.`

- [ ] **Step 7: Verify**

Run: `Select-String -Path skill/SKILL.md -Pattern 'subagent spawn|--briefing|config/sidecar|curl https://openrouter'`
Expected: zero matches.
Run: `Select-String -Path skill/SKILL.md -Pattern 'fanout|prompt-file|amicus models'`
Expected: matches in the new sections.

- [ ] **Step 8: Commit**

```bash
git add skill/SKILL.md
git commit -m "docs(f7): chat skill accuracy pass — fanout/models/prompt-file/abort, cut unimplemented subagent docs"
```

---

### Task 5: postinstall installs both skills (TDD)

**Files:**
- Modify: `scripts/postinstall.js`
- Create: `tests/scripts/postinstall.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/scripts/postinstall.test.js`:

```javascript
/** Tests for the skill-install half of scripts/postinstall.js (MCP registration not exercised). */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installSkill, installCouncilSkill, COUNCIL_FILES } = require('../../scripts/postinstall');

describe('postinstall skill installation', () => {
  let homeDir;
  let homeSpy;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-postinstall-'));
    homeSpy = jest.spyOn(os, 'homedir').mockReturnValue(homeDir);
  });

  afterEach(() => {
    homeSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const councilDest = () => path.join(homeDir, '.claude', 'skills', 'second-opinion');

  test('installSkill copies the chat skill to ~/.claude/skills/sidecar/', () => {
    installSkill();
    const dest = path.join(homeDir, '.claude', 'skills', 'sidecar', 'SKILL.md');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8')).toContain('name: sidecar');
  });

  test('COUNCIL_FILES declares overwrite semantics per file', () => {
    expect(COUNCIL_FILES).toEqual([
      { file: 'SKILL.md', mode: 'overwrite' },
      { file: 'COUNCIL-DESIGN.md', mode: 'overwrite' },
      { file: 'MODEL-NOTES.md', mode: 'if-missing' },
    ]);
  });

  test('fresh install copies all three council files', () => {
    installCouncilSkill();
    for (const { file } of COUNCIL_FILES) {
      expect(fs.existsSync(path.join(councilDest(), file))).toBe(true);
    }
  });

  test('MODEL-NOTES.md is NEVER overwritten (user data)', () => {
    fs.mkdirSync(councilDest(), { recursive: true });
    fs.writeFileSync(path.join(councilDest(), 'MODEL-NOTES.md'), 'USER LEARNED DATA');
    installCouncilSkill();
    expect(fs.readFileSync(path.join(councilDest(), 'MODEL-NOTES.md'), 'utf-8')).toBe('USER LEARNED DATA');
  });

  test('SKILL.md and COUNCIL-DESIGN.md ARE overwritten on update', () => {
    fs.mkdirSync(councilDest(), { recursive: true });
    fs.writeFileSync(path.join(councilDest(), 'SKILL.md'), 'stale');
    fs.writeFileSync(path.join(councilDest(), 'COUNCIL-DESIGN.md'), 'stale');
    installCouncilSkill();
    expect(fs.readFileSync(path.join(councilDest(), 'SKILL.md'), 'utf-8')).not.toBe('stale');
    expect(fs.readFileSync(path.join(councilDest(), 'COUNCIL-DESIGN.md'), 'utf-8')).not.toBe('stale');
  });

  test('a missing source file warns but never throws (warn-don\'t-fail)', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => installCouncilSkill(path.join(homeDir, 'no-such-source'))).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Warning'));
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/scripts/postinstall.test.js`
Expected: FAIL — `installSkill is not a function` / `installCouncilSkill is not a function` (only `addMcpToConfigFile` is exported today).

- [ ] **Step 3: Implement**

In `scripts/postinstall.js`:

1. Replace the path constants block (lines 16–18) with:

```javascript
const SKILL_SOURCE = path.join(__dirname, '..', 'skill', 'SKILL.md');
const COUNCIL_SOURCE_DIR = path.join(__dirname, '..', 'skills', 'second-opinion');

/** Council files + per-file install semantics: SKILL/COUNCIL-DESIGN are product code
 * (overwrite on update); MODEL-NOTES is user data — its reviewer-reliability table evolves
 * per-run, so it is seeded once and never clobbered. */
const COUNCIL_FILES = [
  { file: 'SKILL.md', mode: 'overwrite' },
  { file: 'COUNCIL-DESIGN.md', mode: 'overwrite' },
  { file: 'MODEL-NOTES.md', mode: 'if-missing' },
];

function skillsRoot() {
  return path.join(os.homedir(), '.claude', 'skills');
}
```

2. Replace `installSkill()` with (note: dest now computed per-call so tests can mock `os.homedir`):

```javascript
/** Install the chat skill to ~/.claude/skills/sidecar/ */
function installSkill() {
  try {
    const destDir = path.join(skillsRoot(), 'sidecar');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(SKILL_SOURCE, path.join(destDir, 'SKILL.md'));
    console.log('[amicus] Chat skill installed to ~/.claude/skills/sidecar/');
  } catch (err) {
    console.error(`[amicus] Warning: Could not install chat skill: ${err.message}`);
  }
}

/** Install the LLM Council skill to ~/.claude/skills/second-opinion/ */
function installCouncilSkill(sourceDir = COUNCIL_SOURCE_DIR) {
  const destDir = path.join(skillsRoot(), 'second-opinion');
  for (const { file, mode } of COUNCIL_FILES) {
    try {
      const dest = path.join(destDir, file);
      if (mode === 'if-missing' && fs.existsSync(dest)) { continue; }
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(path.join(sourceDir, file), dest);
    } catch (err) {
      console.error(`[amicus] Warning: Could not install council file ${file}: ${err.message}`);
    }
  }
  console.log('[amicus] Council skill installed to ~/.claude/skills/second-opinion/');
}
```

3. In `main()`, add `installCouncilSkill();` immediately after `installSkill();`.

4. Replace the exports line with:

```javascript
module.exports = { addMcpToConfigFile, installSkill, installCouncilSkill, COUNCIL_FILES };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/scripts/postinstall.test.js`
Expected: 6 passed.

- [ ] **Step 5: Full suite + lint, then commit**

Run: `npm test` (expect baseline+6 pass, 4 skipped, 0 fail) and `npm run lint` (clean).

```bash
git add scripts/postinstall.js tests/scripts/postinstall.test.js
git commit -m "feat(f7): postinstall installs the council skill (MODEL-NOTES seeded if-missing, never clobbered)"
```

---

### Task 6: package.json identity + ship `skills/` (TDD)

**Files:**
- Modify: `package.json`
- Create: `tests/scripts/package-manifest.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/package-manifest.test.js`:

```javascript
/** Launch-identity regression guards: the npm tarball must carry the council, and the
 * package must point at the Amicus repo, not the upstream fork source. */
const pkg = require('../../package.json');

describe('package.json launch identity', () => {
  test('files includes skills/ so the council ships in the tarball', () => {
    expect(pkg.files).toContain('skills/');
  });
  test('repository/bugs/homepage point at BourbonDog/amicus', () => {
    expect(pkg.repository.url).toBe('https://github.com/BourbonDog/amicus.git');
    expect(pkg.bugs).toBe('https://github.com/BourbonDog/amicus/issues');
    expect(pkg.homepage).toBe('https://github.com/BourbonDog/amicus#readme');
  });
  test('keywords carry the council positioning', () => {
    for (const k of ['council', 'second-opinion', 'fanout']) {
      expect(pkg.keywords).toContain(k);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/scripts/package-manifest.test.js`
Expected: FAIL on all three tests.

- [ ] **Step 3: Edit package.json**

- `description`: `"Multi-model LLM Council + parallel AI window for Claude Code. Run structured council reviews across Gemini, GPT, DeepSeek and more — or fork a conversation to any model and fold the results back."`
- `keywords`: add `"council"`, `"second-opinion"`, `"fanout"` (keep the existing list incl. `"sidecar"`).
- `author`: `"BourbonDog"` (John Renaldi remains credited in LICENSE and NOTICE — do not touch those files).
- `repository.url`: `"https://github.com/BourbonDog/amicus.git"`.
- Add `"bugs": "https://github.com/BourbonDog/amicus/issues"` and `"homepage": "https://github.com/BourbonDog/amicus#readme"` after `repository`.
- `files`: add `"skills/"` after `"skill/"`.

- [ ] **Step 4: Run test + tarball check**

Run: `npx jest tests/scripts/package-manifest.test.js` → 3 passed.
Run: `npm pack --dry-run 2>&1 | Select-String 'skills/second-opinion'`
Expected: lists `skills/second-opinion/SKILL.md`, `skills/second-opinion/MODEL-NOTES.md`, `skills/second-opinion/COUNCIL-DESIGN.md`.

- [ ] **Step 5: Full suite, then commit**

Run: `npm test` → green.

```bash
git add package.json tests/scripts/package-manifest.test.js
git commit -m "feat(f7): package identity → BourbonDog/amicus; ship skills/ (council) in the tarball"
```

---

### Task 7: Wizard title fix (TDD)

**Files:**
- Modify: `electron/setup-ui.js:27`
- Create: `tests/electron/setup-ui-title.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/electron/setup-ui-title.test.js`:

```javascript
const { buildSetupHTML } = require('../../electron/setup-ui');

describe('setup wizard window title', () => {
  test('titles the window "Amicus Setup" with no Sidecar residue', () => {
    const html = buildSetupHTML();
    expect(html).toContain('<title>Amicus Setup</title>');
    expect(html).not.toContain('Sidecar Setup');
  });
});
```

(If `setup-ui.js` exports differently, check `module.exports` at its bottom and import accordingly — the function is `buildSetupHTML(options)`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/electron/setup-ui-title.test.js`
Expected: FAIL — title is `Sidecar Setup`.

- [ ] **Step 3: Fix line 27**

In `electron/setup-ui.js` line 27, change `<title>Sidecar Setup</title>` → `<title>Amicus Setup</title>`.

- [ ] **Step 4: Run test to verify it passes, then commit**

Run: `npx jest tests/electron/setup-ui-title.test.js` → 1 passed.

```bash
git add electron/setup-ui.js tests/electron/setup-ui-title.test.js
git commit -m "fix(f7): setup wizard window title Sidecar → Amicus"
```

---

### Task 8: Real-LLM council smoke (HARD GATE for Phase 2)

**Files:** none committed — this is a verification gate. Requires `OPENROUTER_API_KEY` configured (it is, on this machine, via `~/.config/amicus/.env`).

The executor acts as the council orchestrator **following the rewritten SKILL.md literally** (read it first — drift between this runbook and the skill is itself a finding).

- [ ] **Step 1: Create the sample artifact + run folder**

Create `output/f7-smoke-council/` in the worktree and write `_tmp-artifact.md` into it — a ~30-line fake ADR titled "ADR-7: Session Cache Eviction" with THREE seeded flaws the council should catch: (1) claims "LRU guarantees no cache miss ever" (factually wrong); (2) §Rollback says "no rollback needed" while §Risks says "rollback plan required" (contradiction); (3) never specifies what happens at exactly max-size (missing edge case). Write the full fake ADR; any plausible prose works as long as the three flaws are present and findable.

- [ ] **Step 2: Stage 1 wave (2 models)**

Write `output/f7-smoke-council/_tmp-briefing-stage1.md` per the SKILL.md Stage-1 findings format (id/claim/severity/location/rationale + overall take), with the artifact inlined. Launch in background:

```
amicus fanout --models gemini,deepseek --prompt-file output/f7-smoke-council/_tmp-briefing-stage1.md --json --agent Plan --no-context --summary-length verbose --timeout 10
```

Expected: exit 0; one JSON wave document on stdout; `status: "complete"`, `counts: {total:2, complete:2, error:0, timeout:0, aborted:0}`; both legs' `summary` non-empty and containing a findings list. Save them as `review-gemini.md` / `review-deepseek.md`. **Gate check:** at least one seeded flaw appears in each review.

- [ ] **Step 3: Stage 2 wave (anonymized bundle)**

Build the Review A/B bundle (keep the private label map), write `_tmp-bundle-stage2.md` with the `FINAL RANKING:` + adjudication instructions, run the same fanout command against it. Expected: exit 0; both summaries contain a parseable `FINAL RANKING:` block and per-finding `agree|dispute|neutral` verdicts. Tally into `crossreview-matrix.md` **including the 2-model thin-ranking disclosure line** (per SKILL.md scale-down).

- [ ] **Step 4: Stage 3 chair (solo run)**

Chair = deepseek (per reliability table). Write `_tmp-chair-packet.md` (de-anonymized reviews + rankings + adjudications), run:

```
amicus start --model deepseek --no-ui --json --prompt-file output/f7-smoke-council/_tmp-chair-packet.md --agent Plan --no-context --summary-length verbose --timeout 10
```

Expected: exit 0; run document `status: "complete"`; `summary` = a synthesized verdict. Save as `verdict.md`. Write `report.md` with the decision-log skeleton + the **run-stats table** (stage, model, status, durationMs from the JSON documents).

- [ ] **Step 5: Degrade-rule check (abort one leg)**

```
amicus fanout --models gemini,deepseek,gemini --wave-id f7smoke --prompt-file output/f7-smoke-council/_tmp-briefing-stage1.md --json --agent Plan --no-context --summary-length verbose --timeout 10
```

(Background.) ~10–15 s after launch run `amicus abort f7smoke-3`. Expected: wave exits with code 2; `status: "partial"`; `counts.aborted ≥ 1`, `counts.complete ≥ 2` — wait for the background task to finish, do not kill it. Confirm the orchestrator path: ≥2 reviews survive → proceed-with-survivors per the Stage-1 degrade rule, naming the dead leg.

- [ ] **Step 6: Gate verdict + cleanup**

PASS requires: Steps 2–4 all complete with the expected JSON shapes; all four artifacts written (`review-*.md ×2`, `crossreview-matrix.md`, `verdict.md`, `report.md` with run-stats); thin-ranking disclosure present; Step-5 degrade behavior observed. Record the evidence (key JSON fields, artifact listing) in the task report. Delete `output/f7-smoke-council/` (verify `git status --porcelain` is clean — `output/` artifacts must not enter the repo). **Phase 2 does not start until this gate passes.** If it fails: fix the SKILL.md (or engine) issue, re-run the gate.

---

## Phase 2 — Docs refresh (every claim verified against `--help`/code; council-as-hero)

### Task 9: README.md full rewrite

**Files:**
- Modify: `README.md` (full replacement)

- [ ] **Step 1: Capture ground truth**

Run `node bin/amicus.js --help` and `node bin/amicus.js models --help 2>&1` (and any subcommand help you cite). Every flag/command/env var named in the README MUST appear there or in code. The env-knob list to document (Configuration section): `OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `LOG_LEVEL`, `AMICUS_CONFIG_DIR`, `AMICUS_ENV_DIR`, `AMICUS_TIMEOUT`, `OPENCODE_COMMAND`, `AMICUS_STABLE_IDLE_POLLS`, `AMICUS_POLL_INTERVAL_MS`, `AMICUS_STABLE_FINISHED_POLLS`, `AMICUS_POLL_CALL_TIMEOUT_MS`, `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES`, `AMICUS_FANOUT_MAX_LEGS`, `AMICUS_GUI_LOAD_TIMEOUT_MS`, `AMICUS_DEBUG_PORT` — verify each exists via `Select-String -Path src/* -Pattern '<NAME>' -List` before documenting; drop any that don't resolve.

- [ ] **Step 2: Write the new README**

Structure (spec §4.1) — 13 sections:

1. **Hero**: `# Amicus` + tagline `**A multi-model LLM Council for Claude — with a parallel AI window underneath.**` + `docs/hero.png` + supported-clients note (Claude Code CLI + Cowork tested; web/Desktop experimental). Badges: npm version, MIT license, node ≥18, PRs-welcome → `./CONTRIBUTING.md`. **Removed:** the WIP-rebrand banner block, the YouTube embed, both `jrenaldi79/sidecar` GitHub badges.
2. **What is Amicus**: one `npm install -g amicus` delivers (a) the `second-opinion` LLM Council skill — structured multi-model review with anonymous peer cross-review and an independent chair verdict; (b) the `sidecar` chat skill — fork your conversation to any model, work in parallel, fold results back; (c) the `amicus` CLI (`am` alias) + MCP server; (d) a self-updating OpenRouter model catalog. Keep `docs/what-is-amicus.png`.
3. **Quick start**: install → `amicus setup` (4-step wizard table, keys stored `~/.config/amicus/.env`) → first council ("give Claude a document and say *council review this* — Claude orchestrates the rest") → first sidecar (`amicus start --model gemini --prompt "..."`). Subsection **Install from GitHub**: `npm install -g github:BourbonDog/amicus` (postinstall runs, same as npm). Contributor setup → CONTRIBUTING.md link.
4. **The Council**: the flow in five beats (independent reviews → anonymized cross-review → street-cred + per-finding tiers → non-Claude chair verdict → tiered accept/deny decisions with you); run artifacts (run folder: per-model reviews, cross-review matrix, verdict, report; `<stem>-reviewed.<ext>`); Claude-in-council toggle one-liner; cost-shape disclosure example line. Point to `skills/second-opinion/SKILL.md` + `COUNCIL-DESIGN.md`.
5. **The parallel window**: fork/work/fold; interactive (model switcher, FOLD button) + headless `--no-ui`; context sharing (`--context-turns/--context-since/--context-max-tokens`) + isolation (`--no-context`); MCP inheritance (`--no-mcp`, `--exclude-mcp`, `--mcp`); conflict/drift warnings; auto-update; keep `docs/architecture.png`.
6. **Commands**: all 11 with one-line each + a `start` options table matching live `--help` (add `--prompt-file`, `--json`, `--no-validate-model`, `--position`, `--fold-shortcut`, `--opencode-port`); a `fanout` subsection (shared-prompt semantics, wave JSON, exit codes 0/2/1, `--wave-id`); `abort --all`; `setup --api-keys` / `--add-alias`; `models` (see 7); `update`; `mcp`.
7. **Models**: live-catalog story — `amicus models` (list/search/refresh/check), TTL cache at `~/.config/amicus/model-catalog.json`, keyless fetch works, catalog validation on `start`/`fanout`/`continue`/`resume` (blocking for explicit `--model`, advisory for inherited; `--no-validate-model` opt-out), aliases as a curated seed (`amicus setup`, `--add-alias`), full-id passthrough table (openrouter/… vs direct google/ openai/ anthropic/ prefixes decide credentials). **The frozen 20-row alias table is deleted** — point at `amicus models` instead.
8. **MCP integration**: the 10-tool table (incl. `amicus_fanout`); async start→status→read pattern; manual registration one-liner (`claude mcp add-json amicus '{"command":"npx","args":["-y","amicus@latest","mcp"]}' --scope user`).
9. **Configuration**: env table from Step 1 (grouped: keys / behavior / headless-poller tuning / GUI+debug); note `amicus setup` is the recommended path; legacy `SIDECAR_*` env names still honored (deprecated, see `docs/SHIMS.md`).
10. **JSON output**: run + wave document field lists (from the verified-facts block of this plan), `schemaVersion: 1`, exit codes — "for scripting and agent consumption".
11. **Windows**: first-class callout — full unit suite green on Windows 11, no WSL needed, native-binary PATH handling, path-encoding fixes.
12. **Troubleshooting**: rebuilt table — keep (verified) rows: auth/401 (provider prefix vs credentials), session-not-found, no-conversation-history (path encoding), headless timeout (`--timeout`), multiple-active-sessions, summary-corrupted (LOG_LEVEL=debug). **Drop:** the GUI-hang row, `command not found: opencode` row if stale (verify opencode-ai is a bundled dep — it is), chat-stalls row (now a hard pre-flight error). **Add:** model fails catalog validation (run `amicus models --refresh` or `--no-validate-model`), fanout exit code 2 = partial wave (read per-leg `error`).
13. **Documentation index** (docs/ map + skills), **Contributing** (3 lines + link), **Built on OpenCode** (keep current text), **Attribution & License**: fork of [Claude Sidecar](https://github.com/jrenaldi79/sidecar) by John Renaldi (MIT); engine modifications + council © BourbonDog; see `NOTICE`. Keep the CDP-testing material OUT of the README (it moves to CONTRIBUTING.md, Task 14 — currently lives in README's Contributing section).

- [ ] **Step 3: Verify**

- `Select-String -Path README.md -Pattern 'sidecar' -CaseSensitive:$false` → only intentional hits: the `sidecar` chat-skill name, the attribution section, the SHIMS/legacy-env mention.
- `Select-String -Path README.md -Pattern 'jrenaldi79'` → attribution section only.
- Every command in §Commands exists in `node bin/amicus.js --help` output.
- All relative links resolve (CONTRIBUTING.md will exist after Task 14 — README merges in the same PR, acceptable; note it).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(f7): README rewrite — council-as-hero, full command surface, live-catalog story"
```

---

### Task 10: configuration.md + usage.md + .env.example

**Files:**
- Modify: `docs/configuration.md`, `docs/usage.md`, `.env.example`

- [ ] **Step 1: docs/configuration.md**

- Env sections: align to the README Task-9 env list (same names, fuller prose); add the poller-tuning knobs (`AMICUS_STABLE_IDLE_POLLS` ≈ idle polls before completion, `AMICUS_POLL_INTERVAL_MS`, `AMICUS_STABLE_FINISHED_POLLS`, `AMICUS_POLL_CALL_TIMEOUT_MS`, `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES` dead-server fast-exit, `AMICUS_FANOUT_MAX_LEGS` leg cap) and `AMICUS_GUI_LOAD_TIMEOUT_MS`.
- "Model Names Reference": replace any curl guidance with `amicus models --search <term>`; describe the catalog cache (`~/.config/amicus/model-catalog.json`, TTL, keyless fetch, floor-only-refresh guard) and validation behavior.
- "Model Aliases": aliases are a curated seed maintained by `amicus setup` / `--add-alias`, audited by `amicus models --check`; do not enumerate a frozen list.
- Fix any `~/.config/sidecar` → `~/.config/amicus` (legacy fallback noted once).

- [ ] **Step 2: docs/usage.md**

- Amicus-ify residual `sidecar` strings (keep skill-name + attribution mentions).
- Add a **Fanout** section: shared-prompt semantics, the canonical command, wave JSON + exit codes, `--wave-id`, when to use fanout vs N parallel starts (same prompt vs different prompts).
- Add `--prompt-file` and `--json` to the start usage; `abort --all`; `continue`/`resume` catalog validation note (explicit-model blocking, inherited advisory).

- [ ] **Step 3: .env.example**

- Replace both "(default: ~/.config/sidecar)" comments with "(default: ~/.config/amicus)".
- Replace stale model examples (`gemini-2.5-flash`, `claude-3.5-sonnet`) with alias guidance: `# Examples: openrouter/google/gemini-3.1-flash-lite-preview — or just use an alias; run 'amicus models' to browse`.
- Replace "(recommended for sidecar)" → "(recommended for amicus)".
- Append a "Headless tuning (advanced)" block listing the poller knobs + `AMICUS_FANOUT_MAX_LEGS` + `AMICUS_GUI_LOAD_TIMEOUT_MS`, all commented out with one-line explanations and defaults.

- [ ] **Step 4: Verify + commit**

`Select-String -Path docs/configuration.md,docs/usage.md,.env.example -Pattern 'config/sidecar|gemini-2.5|claude-3.5'` → zero matches.

```bash
git add docs/configuration.md docs/usage.md .env.example
git commit -m "docs(f7): configuration/usage/env refresh — catalog story, fanout, poller knobs"
```

---

### Task 11: architecture.md + opencode-integration.md + troubleshooting.md

**Files:**
- Modify: `docs/architecture.md`, `docs/opencode-integration.md`, `docs/troubleshooting.md`

- [ ] **Step 1: docs/architecture.md**

- Fix residual `sidecar` strings (3) incl. the `architecture.svg` comment on its line 36 (`Clients → Sidecar Core` → `Clients → Amicus Core`; comment-only, no PNG re-render).
- Add a **Fanout wave architecture** subsection after "Shared Server Architecture": one OpenCode server shared across N legs; legs are ordinary sessions with `parentWave`; atomic `wave.json`; per-leg watchdog kills only its leg; consecutive-poll-failure fast-exit; signal path finalizes the wave (exit 130/143).
- In "Fold Mechanism", state the protocol token is `[SIDECAR_FOLD]` (the engine's wire format — intentional legacy, tracked in SHIMS).

- [ ] **Step 2: docs/opencode-integration.md**

- Verify the "Agent Type Mapping" + SDK notes against `src/opencode-client.js` exports; fix residual `sidecar` naming in prose (keep code identifiers as they are in source).
- Add `session.status` idle signal note (F1: `SessionStatus = {type:'idle'|'busy'|'retry'}` is authoritative completion, gated on output existing).

- [ ] **Step 3: docs/troubleshooting.md**

- Mirror the README Task-9 troubleshooting decisions (drop GUI-hang + stale poller advice; add catalog-validation and partial-wave rows; fix the 2 residual `sidecar` strings).
- Keep this file the *deep* version (README table links here).

- [ ] **Step 4: Verify + commit**

`Select-String -Path docs/architecture.md,docs/opencode-integration.md,docs/troubleshooting.md -Pattern 'sidecar' -CaseSensitive:$false` → only the intentional `[SIDECAR_FOLD]` wire-format mention + source-identifier references.

```bash
git add docs/architecture.md docs/architecture.svg docs/opencode-integration.md docs/troubleshooting.md
git commit -m "docs(f7): architecture/integration/troubleshooting refresh — fanout waves, F1 idle signal"
```

---

### Task 12: testing.md + electron-testing.md + doc-system.md + publishing.md + SHIMS note

**Files:**
- Modify: `docs/testing.md`, `docs/electron-testing.md`, `docs/doc-system.md`, `docs/publishing.md`, `docs/SHIMS.md`

- [ ] **Step 1: docs/testing.md**

- Fix the 15 residual `sidecar` strings (keep test-file names + source identifiers verbatim).
- Replace/extend "Cross-Platform: macOS vs Linux" with a **Windows** subsection: the suite is fully green on Windows 11 (F2); path-sep and drive-colon encoding gotchas live in `src/session.js`/`src/environment.js`; `path-setup.js` adds the opencode native-bin dirs to PATH (spawn can't run .cmd shims); screenshots via CDP `Page.captureScreenshot` (no `screencapture` on Windows).
- Verify the Quick Reference commands against `package.json` scripts (`npm test`, `test:integration`, `test:all`, `test:e2e:mcp`) — fix drift.

- [ ] **Step 2: docs/electron-testing.md**

- Fix 4 residual `sidecar` strings; note `AMICUS_DEBUG_PORT` default 9222 / recommended 9223; mark macOS-only bits (`screencapture`, AppleScript positioning) as macOS-specific and point Windows readers at the CDP screenshot pattern + `Get-Process electron` visibility check.

- [ ] **Step 3: docs/doc-system.md**

- Fix the marker names to the real ones: `tree` and `modules` (currently documented as `directory-tree`/`module-index` — wrong vs CLAUDE.md's `<!-- AUTO:tree -->`/`<!-- AUTO:modules -->`).
- Fix or delete the "Plans Index" section to match what `scripts/generate-docs.js` actually does today (check its `main()` — if no plans-index generation exists, delete the section; if it targets `docs/superpowers/plans/`, document that).

- [ ] **Step 4: docs/publishing.md**

- Correct the trusted-publisher claim: the OIDC trusted-publisher config described belongs to the upstream `jrenaldi79/sidecar` repo. Add a **"Launch prerequisites for amicus"** list: create the npm package (first `npm publish` from an authorized account), configure trusted publishing for `BourbonDog/amicus` + `publish.yml` (or use the `NPM_TOKEN` secret), and note `publish.yml`'s raw `/v1/messages` curl needs `ANTHROPIC_API_KEY` at launch. Keep the version-bump workflow section.

- [ ] **Step 5: docs/SHIMS.md**

- If not already present, add one line under the title: `Removal is scheduled for a post-launch revision once users have migrated.` Nothing else changes.

- [ ] **Step 6: Verify + commit**

`Select-String -Path docs/testing.md,docs/electron-testing.md -Pattern 'sidecar' -CaseSensitive:$false` → only file-name/identifier references that exist verbatim in the codebase.

```bash
git add docs/testing.md docs/electron-testing.md docs/doc-system.md docs/publishing.md docs/SHIMS.md
git commit -m "docs(f7): testing/electron/doc-system/publishing refresh — Windows first-class, real marker names, launch prereqs"
```

---

### Task 13: site/ refresh

**Files:**
- Modify: `site/index.html`, `site/social-card-render.html`, `docs/hero.svg`, `docs/social-card.svg`

- [ ] **Step 1: site/index.html**

Read it first, then mirror the new README's positioning and facts: title/meta/OG tags → Amicus + council-as-hero tagline (match Task 9 §1); hero copy = council first, parallel window second; features grid = council, fork/fold window, fanout, live model catalog, Windows first-class, MCP tools; install snippet = `npm install -g amicus` + `amicus setup`; all 19 `sidecar` references resolved (attribution footer keeps the upstream credit + link); commands shown must exist in `--help`.

- [ ] **Step 2: site/social-card-render.html + SVG comments**

- Fix the 3 `sidecar` references in `social-card-render.html` (text/branding strings — verify what they are when editing; if any is a visible string, match the README tagline).
- Fix XML comments: `docs/hero.svg` lines 40+91, `docs/social-card.svg` line 100 (`Sidecar` → `Amicus` in comment text). **Comment-only → do NOT re-render any PNG.**

- [ ] **Step 3: Verify + commit**

`Select-String -Path site/index.html,site/social-card-render.html,docs/hero.svg,docs/social-card.svg -Pattern 'sidecar' -CaseSensitive:$false` → only the attribution footer credit.
Open a sanity render: `Start-Process site/index.html` (visual check: no broken layout, branding correct).

```bash
git add site/ docs/hero.svg docs/social-card.svg
git commit -m "docs(f7): site refresh — council-as-hero landing copy, residue sweep"
```

---

### Task 14: CONTRIBUTING.md (new)

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Write the file**

```markdown
# Contributing to Amicus

Thanks for helping! Amicus is an independent MIT fork of
[Claude Sidecar](https://github.com/jrenaldi79/sidecar) (see `NOTICE`); the engine, council
skill, and docs are all maintained in this monorepo.

## Dev setup

```bash
git clone https://github.com/BourbonDog/amicus.git
cd amicus
npm install --ignore-scripts --omit=optional   # IMPORTANT — see warning below
node scripts/setup-hooks.js                    # wires git hooks (prepare is skipped by --ignore-scripts)
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

## Tests

```bash
npm test                  # unit suite (the green gate)
npm run test:integration  # integration tier
npm run lint
```

E2E tests that talk to real models skip without `OPENROUTER_API_KEY`. The agentic eval system
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
© 2025 John Renaldi; modifications and the council © 2026 BourbonDog (see `LICENSE` + `NOTICE`).
```

- [ ] **Step 2: Verify + commit**

The README "PRs Welcome" badge target now exists. Run `npm run generate-docs:check` (CLAUDE.md cross-link validation must still pass).

```bash
git add CONTRIBUTING.md
git commit -m "docs(f7): add CONTRIBUTING.md — dev setup, gates, CDP testing, PR flow"
```

---

### Task 15: CHANGELOG.md (new)

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write the file**

```markdown
# Changelog

All notable changes to Amicus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [Unreleased]

Everything since the fork from upstream `claude-sidecar` v0.5.2 — the Amicus launch line.

### Added
- **LLM Council** (`skills/second-opinion/`): structured multi-model review — independent
  reviews, anonymized peer cross-review with street-cred scoring, non-Claude chair verdict,
  tiered accept/deny decisions. v3 runs natively on the fanout/JSON engine primitives.
- **`amicus fanout`**: run N models on one prompt in parallel over a single shared engine
  server; stable JSON wave output (`schemaVersion: 1`), exit codes 0/2/1.
- **`amicus models`**: live OpenRouter model catalog (TTL cache, keyless fetch) with search,
  refresh, and alias auditing (`--check` suggests replacements for stale aliases). Model
  validation on `start`/`fanout`/`continue`/`resume` (`--no-validate-model` to skip).
- **`--prompt-file`** (start/fanout): briefings from a file — no shell quoting, no Windows
  ~32 KB argument cap. **`--json`** structured output for `start` and `read`.
- **`amicus abort --all`**; searchable live model picker in the setup wizard; catalog seeding on
  first-run setup; GUI load failsafe (`AMICUS_GUI_LOAD_TIMEOUT_MS`).
- Council ships in the npm package and installs to `~/.claude/skills/second-opinion/`
  (MODEL-NOTES is seeded once and never overwritten — it's user data).

### Changed
- **Rebranded** `claude-sidecar` → `amicus` (bins `amicus`/`am`; MCP tools `amicus_*`; config
  `~/.config/amicus`; env `AMICUS_*`). Every legacy `sidecar*` form still works as a deprecated
  shim — see `docs/SHIMS.md`.
- Headless reliability: activity-aware completion (quiet tool-call gaps no longer end runs
  early), absolute `--timeout` enforcement, OpenCode idle-status as authoritative completion,
  dead-server fast-exit.
- Windows is first-class: the full unit suite is green on Windows 11; session-path encoding,
  path-separator, and native-binary PATH bugs fixed; process lifecycle (abort/teardown) works
  cross-platform.

### Fixed
- Orphaned sessions and zombie servers on abort (cross-platform PID capture + graceful
  teardown with force-exit net); broken `codex`/`grok` aliases (validation now catches stale
  aliases); update checks (ESM updater loading); session-dir gitignore leak.

### Attribution
Amicus is an independent MIT fork of [Claude Sidecar](https://github.com/jrenaldi79/sidecar)
by John Renaldi. See `LICENSE` and `NOTICE`.
```

(Version number + date move from `[Unreleased]` to a tagged section at launch — out of F7 scope.)

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(f7): add launch CHANGELOG — fork delta vs upstream v0.5.2"
```

---

### Task 16: CLAUDE.md pass + repo-wide gates

**Files:**
- Modify: `CLAUDE.md` (manual sections only; AUTO sections regen)

- [ ] **Step 1: CLAUDE.md**

Run `npm run generate-docs` (regenerates `AUTO:tree`/`AUTO:modules`). Then sanity-pass the manual sections (Project Overview, Essential Commands, Architecture, Critical Gotchas, Docs Map): fix stale claims (e.g. commands list must include `fanout`/`models`; Docs Map must list CONTRIBUTING.md + CHANGELOG.md + the council files; no unintentional `sidecar` strings).

- [ ] **Step 2: Repo-wide residue sweep (spec §4.7 acceptance)**

```powershell
Get-ChildItem -Recurse -Include *.md,*.html,*.svg -Path README.md,CONTRIBUTING.md,CHANGELOG.md,CLAUDE.md,docs,site,skill,skills | Where-Object { $_.FullName -notmatch 'superpowers|node_modules' } | Select-String -Pattern 'sidecar' -CaseSensitive:$false | Where-Object { $_.Path -notmatch 'SHIMS' }
```

Review every hit against the intentional list: chat-skill name + install path, attribution/NOTICE mentions, `[SIDECAR_FOLD]` wire-format references, legacy-shim documentation, source identifiers quoted verbatim. Fix anything else.

- [ ] **Step 3: Doc + suite gates**

Run, expecting all green/clean:
- `npm run generate-docs:check` (markers current + CLAUDE.md links resolve)
- `node scripts/validate-docs.js --full`
- `npm test` → baseline+new tests pass / 4 skipped / 0 failed
- `npm run lint` → clean

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(f7): CLAUDE.md manual-section pass + residue sweep + doc gates green"
```

(Include any sweep fixes from Step 2 in this commit too.)

---

### Task 17: Holistic review, merge, push, owner sync

- [ ] **Step 1: Holistic review** — per the F-milestone pattern, a fresh reviewer (Opus subagent) reads the spec + the full `f7-exec` diff and verdicts MERGE/FIX against the spec's §7 acceptance criteria (tarball contains skills/**; smoke gate passed with evidence; residue sweep clean; docs claims verified; CONTRIBUTING/CHANGELOG exist; wizard titled Amicus Setup; suite green at baseline+new / lint clean). Fix any blockers, re-verify, then proceed.

- [ ] **Step 2: Merge + push**

```powershell
git -C C:\Users\sendt\dev\amicus merge --ff-only f7-exec   # run from the MAIN clone, on main
git -C C:\Users\sendt\dev\amicus push; echo "push exit: $LASTEXITCODE"
```

(If origin/main moved: fetch → rebase `f7-exec` → re-run gates → merge. Check the push exit code directly — never pipe it.)

- [ ] **Step 3: Worktree cleanup**

```powershell
Remove-Item -Force C:\Users\sendt\dev\amicus-f7\node_modules   # junction — NO -Recurse
git -C C:\Users\sendt\dev\amicus worktree remove C:\Users\sendt\dev\amicus-f7
git -C C:\Users\sendt\dev\amicus branch -d f7-exec
```

- [ ] **Step 4: Owner global-copy sync (spec §3.6 one-time migration)**

```powershell
Copy-Item C:\Users\sendt\dev\amicus\skills\second-opinion\SKILL.md,C:\Users\sendt\dev\amicus\skills\second-opinion\MODEL-NOTES.md,C:\Users\sendt\dev\amicus\skills\second-opinion\COUNCIL-DESIGN.md -Destination $env:USERPROFILE\.claude\skills\second-opinion\ -Force
Copy-Item C:\Users\sendt\dev\amicus\skill\SKILL.md -Destination $env:USERPROFILE\.claude\skills\sidecar\ -Force
```

(Deliberate full overwrite incl. MODEL-NOTES: the v3 repo copy carries the owner's current reliability data — verify with `git diff --no-index` first; if the global MODEL-NOTES has newer run rows, merge them into the repo copy and re-commit BEFORE this sync.)

- [ ] **Step 5: Mark the spec implemented** — edit the spec front-matter `status:` to `implemented (2026-06-10)` in the main clone, commit `docs(f7): mark launch-readiness spec implemented`, push.

---

## Acceptance criteria (from spec §7 — final checklist)

- [ ] 1. `npm pack --dry-run` lists `skills/**`; postinstall installs both skills with overwrite/if-missing semantics (unit-tested).
- [ ] 2. Council v3 real-LLM smoke passed end-to-end (Task 8 evidence recorded).
- [ ] 3. Zero unintentional `sidecar` references (Task 16 sweep).
- [ ] 4. Every documented command/flag/env var verified; `generate-docs:check` + `validate-docs --full` green.
- [ ] 5. CONTRIBUTING.md + CHANGELOG.md exist; wizard titled "Amicus Setup"; package identity → BourbonDog/amicus.
- [ ] 6. Suite green (baseline 1848+new / 4 skipped / 0 failed); lint clean.
