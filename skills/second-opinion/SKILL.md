---
name: second-opinion
description: >
  Run a structured, multi-model "council" review of material the user provides plus
  an analysis request and criteria, turning it into decisions. Models review the
  material independently, then anonymously rank and adjudicate each other's reviews
  in a peer cross-review stage, and a designated non-Claude "chair" model synthesizes
  the verdict — Claude orchestrates but does not synthesize. Trigger on "second
  opinion", "multi-model review", "council review", "have other models
  review/critique/evaluate this", "cross-check this against the research",
  "red-team/stress-test this doc", "what would other models conclude about this", or
  any request to review provided material with external model(s) and turn it into
  accept/deny decisions — even if the user never says "sidecar". This is NOT for
  quick or exploratory single-model chats — "ask Gemini…", "what does DeepSeek
  think", brainstorming with a model, or spawning/forking a conversation with
  another model — use the sidecar skill instead.
---

# Second Opinion (LLM Council)

Independent, multi-model review of material the user provides, turned into decisions. Any single model — including the one running this conversation — has consistent blind spots. Routing the same material through models from *different* families surfaces disagreements, missed issues, and overstated claims that one model alone won't catch.

Four principles govern this skill:

1. **Secondary tool.** By the time this skill runs, Claude has already given its opinion in the main conversation. The skill exists to bring in *independent outside* views — it does not replace or re-run Claude's upstream analysis.
2. **The council is the non-Claude bench by default.** Council members are models from families other than the orchestrator (Gemini, DeepSeek, GPT, etc.). Claude is not a first-opinion council member unless the optional "Claude in the council" toggle is on — and even then it is judged but does not vote or chair.
3. **Claude orchestrates; Claude does not synthesize the verdict.** Claude preps material, recommends the council, drives the run, presents accept/deny decisions, and applies them. A designated non-Claude chair model synthesizes the final verdict. Claude's role ends at presenting it.
4. **The subject of cross-review is the other reviews, not the artifact again.** In the peer cross-review stage, models critique and rank *each other's reviews* — not re-review the original artifact. This is the mechanism that surfaces reviewer blind spots and inflated confidence.

**The engine runs the mechanics (v4.1).** Stages 1–3 and the deterministic Stage-5 artifacts are
ONE `amicus council run` call: the engine composes every model-facing briefing, runs the review
wave, validates and repairs findings blocks, anonymizes into the judge bundle, runs the
cross-review wave, optionally runs the rebuttal round, tallies (appending the reliability
ledger once), chairs, and writes `verdict.json` + `report.html`. Claude owns the human stages —
**Stage 0** (intake and briefing), **Stage 4** (tiered decisions), **Stage 5** (apply and present),
**Stage 6** (lessons). The hand-orchestrated mechanics still exist, in
**`MANUAL-ORCHESTRATION.md`** next to this file, as the documented fallback.

Operating lessons from each run fold back into `MODEL-NOTES.md` (with approval), so the skill gets better at driving each model over time.

**Before launching any model, READ `MODEL-NOTES.md`** (next to this file). It holds the operating rules and per-model quirks that decide whether a run succeeds or silently fails. These were learned the hard way; skipping them wastes runs and produces empty results that look like answers.

**Transport rule — CLI not on PATH:** every command below assumes the `amicus` CLI. If `amicus` is not on PATH (typical for **plugin-only installs**), run the identical commands as `npx -y amicus@latest <args>` (e.g. `npx -y amicus@latest council run --prompt-file <path> --models "m1,m2,m3" --json`), or use the equivalent MCP tools (`amicus_council_run`, `amicus_wait`, `amicus_status`, `amicus_verdict`, `amicus_council_stats`, plus `amicus_fanout` / `amicus_start` / `amicus_read` for the manual fallback) — council briefings are always self-contained, so MCP transport is equivalent.

## When to use

- The user provides documents, artifacts, or links **and** an analysis request **and** criteria, and wants other models to weigh in independently.
- They want a fact-check, critique, research-backed evaluation, red-team, or "what would another model conclude about this?"
- They need actionable decisions (accept / defer / deny) on the material, not just a summary of findings.
- A thorough **single-model** pass is wanted — scales down gracefully; the boundary vs the `sidecar` skill is **intent** (reviewing provided material against criteria), not model count.

## When NOT to use

- The user just wants a **quick or exploratory** take from a model, to chat/brainstorm, or to "ask \<model\> X" — that is the **sidecar** skill, not this. The boundary is intent and criteria, not model count: a thorough single-model review still belongs here.
- The user wants *you* (Claude) to do the analysis directly with no external models, or the task is trivial.
- The request is to spawn or fork a conversation with another model — again, `sidecar`.

---

## The council flow

**Stage 0 (Claude + user)** → **ONE `amicus council run`** (Stages 1–3 plus the deterministic
Stage-5 artifacts, all inside the engine) → **Stage 4 (Claude + user)** → **Stage 5 (Claude)** →
**Stage 6 (Claude + user)**.

Track those five steps as todos. Everything before and after the engine call is
human-in-the-loop; the engine call itself is one background command you do not poll.

### Stage 0 — Intake & prep

Confirm the three inputs before doing anything else: **source material**, **the analysis** (the thing to be reviewed), and **the criteria** (what quality/correctness means for this material). Ask only for what is missing; don't re-ask for what is already provided.

**Establish the run folder first:** `output/<stem>-council/` (or `./second-opinion/<stem>-council/`
if no `output/` directory exists). Create it now — it is both your working directory and the
engine's `--out-dir`, so every briefing, leg, and artifact for this run lands in one place. Use
its absolute path in all path arguments.

**Prepare material for council models:**
- Large, linked, or heavily marked-up sources → extract clean text to a small, clearly-named file
  in the run folder (briefing hygiene: token cost and model focus). Reference its absolute path in
  the briefing, or inline it if small.
- Small, clean text → feed inline in the briefing.

**Author ONE briefing file: `<run-folder>/briefing.md`.** This is the only briefing Claude
writes, and it carries only the *review request*:

- the material — inline when small and clean, otherwise the **absolute path** of the extracted
  clean-text file (Stage-1 seats run agentically in the invoking cwd and can read referenced files);
- the analysis request;
- the criteria;
- any material-specific cautions ("the appendix is out of scope", "treat the numbers as given").

**Do not restate output contracts in `briefing.md`.** The anti-sycophancy clause, the findings-JSON
schema, the judge tasks, the no-tools preambles, the chair packet and the verdict-scale addendum
are all the engine's (`briefings.js` templates) — duplicated contracts drift and the engine's copy
wins anyway. Keep `briefing.md` (it is run provenance, not a temp file); the engine derives its
composed `briefing-stage1.md` from it.

**Temporal context.** State the artifact's temporal context when it matters (resumes, dated plans,
anything with start/end dates or "present" ranges) — but you no longer inject the current date by
hand: **the engine stamps** `Today's date is YYYY-MM-DD.` onto every model-facing briefing it
composes, which is what kills the false "future-dated" blocker class headless models used to raise.

**Pick the council.** Default: **3 models from different families (non-Claude)**. Recommend them ranked by fit, consulting both the reviewer-reliability data from `amicus council stats` (the authoritative quantitative source — runs, avg peers-only street-cred, confirm-rate, fact-error rate) and the qualitative quirks in `MODEL-NOTES.md`. State the estimated cost. The estimate is the budget gate's pre-flight figure (per-$/Mtok pricing from the cached catalog; direct-provider legs without catalog pricing are disclosed as "cost unknown"). State it as an estimate, not a guarantee.

**Pick the chair — it must NOT be a bench seat.** The engine refuses a chair that also reviews
(`chair '<m>' is a bench seat — the chair must not review`), so recommend a strong reasoner from
*outside* `--models`; the engine's own default is `deepseek`. Never put `claude` in `--models` or
`--chair` — it is a **reserved seat name** for the Claude-in-the-council review (§5.4), and on a
`--claude-review` run the engine rejects both outright. The engine needs at least **2 bench
seats**; a 1-model run is the scale-down path below, not an engine run.

**Free council (zero-cost).** If the user asks for a "free council" / "zero-cost council",
read `councils.free` from `~/.config/amicus/config.json` and launch with `--council free`
instead of `--models`. Free-tier handling:
- Cost ≈ \$0 — skip the paid-run cost framing (the budget gate is a no-op at zero price).
- No reliability history: free models have no `amicus council stats` / `MODEL-NOTES` record,
  so don't rank on street-cred. Pick the most capable free model as chair and state lower confidence.
- Weak structured output: small free models are less reliable at the strict findings JSON; the
  engine's bounded repair loop absorbs this and marks the seat's `conformance` accordingly.
- Throttled/truncated legs: a mid-stream 429 can yield a leg the engine records as degraded rather
  than clean — read `run.json` and disclose it rather than presenting the run as full-strength.
- Prerequisite: free models require enabling data-sharing in OpenRouter privacy settings
  (openrouter.ai/settings/privacy) or legs 404 at run time — catalog validation cannot catch this.
  State this up front.

**Engine preflight probe — run this before disclosing the run shape.** The fast path needs
`amicus council run`: CLI ≥ 4.1 for `--debate` / `--claude-review`, ≥ 4.0 for a plain run.

- **Shell contexts:** run `amicus --version`.
- **Cowork / no-Bash contexts:** confirm the `amicus_council_run` MCP tool is present.
- **Too old or missing →** run the identical command as `npx -y amicus@latest council run …`
  (npx always resolves the current engine — which is exactly why the version probe is mandatory
  rather than optional: a stale global install and a fresh npx cache can disagree).
- **npx unavailable too →** fall back to **`MANUAL-ORCHESTRATION.md`** and say so before launching.

**Present the optional council elements (all default OFF — explicit opt-in only).** After the
bench and chair are picked and before asking for launch confirmation, present this menu once
(adjust the run-shape numbers to the actual bench):

> Optional council elements — all OFF unless you name them. Reply with any you want (e.g. "1 and 3", "critic + debate mode", or "none"). Note the chair's **verdict scale is now standard** — the engine always makes the chair close with `VERDICT: Ship it | Fix these first | Fundamental rethink` plus its hard questions, so it is no longer something to opt into:
>
> 1. **Critic seat** (`--critic <model>`) — one reviewer, which must be one of the bench seats, swaps to an adversarial brief (adversarial pass, edge-case hunt, consistency check, executability test). Same review count. Trade-off: that reviewer can recognize its own review during cross-review (disclosed in the report).
> 2. **Expert lenses** (`--lenses s1,s2,s3`) — each reviewer gets a distinct expert perspective; you pick the panel domain (business, technical, customer, financial, custom), one lens per seat. Trade-offs: weakens cross-review anonymity (disclosed) and the run is **not** recorded to the reliability ledger.
> 3. **Debate mode** (`--debate`) — after cross-review, Contested and Disputed findings go back to their raisers to defend, amend, or withdraw, and the disputing judges re-vote before the final tally. Adds 1–2 short waves (up to ~2N extra calls, ~+5 min).
> 4. **Claude in the council** (`--claude-review`) — I add my own fresh review to the bundle so the bench can rank and adjudicate it; I'm judged but do not vote or chair, so the verdict stays independent. +1 review in the bundle, no extra council calls.

Rules for this menu:

- **Never enable an element the user did not explicitly name.** Silence, "no", or "none" = all off. Do not infer opt-in from the nature of the material ("this doc could use a critic…") — offer, don't decide.
- If elements were **pre-requested in the invoking command** (e.g. `/council … with a critic seat and debate mode`), confirm them back by name ("Critic seat and debate mode are ON per your request; the others are off") instead of re-asking.
- **The launch confirmation must enumerate the enabled elements by name** — an element not named in the confirmation is off. Restate its cost/shape impact there.
- **Critic seat and expert lenses are mutually exclusive** — the engine rejects both together, so pick one.
- Element *semantics* (what each brief actually asks for) live in **`SEAT-BRIEFS.md`** next to this file — read it when any of them is toggled on. The engine composes its own stricter-JSON variants of those templates; you do not paste them into `briefing.md`.

**When "Claude in the council" is ON**, author `<run-folder>/review-claude.md` before launching: a
**fresh** structured Stage-1 review of the artifact — prose plus a trailing fenced ` ```json ` block
`{"overall": "…", "findings": [{"id": 1, "severity": "blocker", "claim": "…", "location": "…",
"rationale": "…"}]}` — not a formalization of anything said upstream. The engine pre-flight-validates
this file and fails the run *before any spend* if it is malformed, so a bad file costs nothing but a
relaunch. See §5.4.

**Disclose the run shape up front**, naming any enabled elements and their cost impact — e.g.:

> This run uses 3 council models across 2 engine waves + 1 chair call (~7 model runs), ~10 min.

or, with elements enabled:

> This run uses 3 council models across 2 engine waves + 1 chair call, with **critic seat + debate mode ON** (~7 base runs + up to 6 rebuttal calls), ~15 min.

Then **wait for confirmation**. Never launch without it.

**Scale-down is explicit — state which mode applies:**
- **1 model** → thorough single pass; cross-review and chair synthesis do not apply and Claude synthesizes directly. This is the one path that never touches the engine: a single solo `amicus start --no-ui --json --prompt-file <run-folder>/briefing.md --agent Plan --no-context --summary-length verbose`.
- **2 models** → a valid engine run, but the ranking is thin (one ranker per review); note this limitation.
- **3 models (default)** → full deep council with meaningful cross-review and tie-breaking.

The scale-down levels count **non-Claude judges**; `--claude-review` adds a judged review but not a judge, so it does not change these levels.

---

### The engine run — Stages 1–3 plus the Stage-5 artifacts

ONE call. The engine executes the Stage-1 review wave, the per-leg findings validation and bounded
repair loop, anonymization and run-global finding-id rewriting, the identical judge bundle and
cross-review wave, the optional rebuttal round, the tally (which appends the reliability ledger
**once**), the chair synthesis with the verdict scale, and the deterministic
`verdict.json` + `report.html` — checkpointing `run.json` as it goes.

**Canonical launch (shell contexts):**

```
amicus council run --prompt-file <run-folder>/briefing.md \
  --models "<m1,m2,m3>" --chair <chair> --out-dir <run-folder> --json \
  [--critic <m>] [--lenses s1,s2,s3] [--debate] \
  [--claude-review <run-folder>/review-claude.md] \
  [--max-cost <$> | --no-cost-gate] [--timeout <min>] [--gateway auto|direct|openrouter]
```

Always quote the `--models` list — unquoted, PowerShell splits on commas and the CLI receives one
mangled alias (instant arg-parse failure). For a free council, swap `--models "<m1,m2,m3>"` for
`--council free`. Run it in the background (`run_in_background: true`); you are notified on
completion — do not poll.

**Budget gate — one flag for the whole run.** By default the gate refuses any leg whose price
exceeds the per-$/Mtok threshold (the o3/o3-pro guard). To run an intentionally expensive model the
user asked for by name, pass `--no-cost-gate`; to raise only the total ceiling, pass
`--max-cost <$>`. Either flag is forwarded to **every internal launch** the engine makes — the
Stage-1 wave, the repair re-prompts, the Stage-2 judge wave, the debate legs, and the chair call —
so a single invocation replaces the old per-call pass-through footgun entirely.

**Cowork / no-Bash environments:** use the MCP tools instead. `amicus_council_run`
`{briefingFile, models|council, chair, critic?, lenses?, debate?, claudeReviewFile?, outDir,
maxCost?|noCostGate?, timeoutMinutes?, gateway?}` returns `{runId, runDir}` immediately.
Preferred: call `amicus_wait` with the runId — one blocking call; re-call it while it returns
`timedOut: true`. Fallback: poll `amicus_status`, which shows stage progression. Then read the
run-folder artifacts with the host's file tools. Council JSON returned by the MCP tools arrives
wrapped in the `<untrusted_sidecar_output>` fence — parse the JSON from inside the fence; CLI
`--json` output remains unfenced. The council's briefings are always self-contained, so MCP
transport is equivalent.

**When the run returns, read `run.json` and the exit code — never present a degraded run as
clean.** The engine owns degradation; you own disclosure and the user's choice:

- **0 — full run.** Proceed to Stage 4.
- **2 — degraded but usable.** Read `run.json` `stages[]` (which leg or stage died, and its error),
  `tally.json` (the `judged` flag), and `verdict.json` (`overallVerdict` is null when the chair
  never produced one). Name every dead leg and its error when presenting. Apply the standing
  disclosures: a run left with 2 surviving reviews is effectively a 2-model council (thin ranking —
  say so from here on); a failed chair means the report carries no chair verdict, so offer a solo
  re-chair via `MANUAL-ORCHESTRATION.md` or proceed report-only; debate degradations are summarized
  in `run.json`'s `debate` block. Then proceed to Stage 4 with what exists.
- **1 — nothing usable.** Quorum, cost ceiling, or validation failed and the error doc says which.
  Present it and offer: re-run (possibly with a smaller bench), a raised `--max-cost`, or the
  manual/single-pass fallback.
- **130 / 143 — aborted** (Ctrl-C or terminated). Offer a resume-as-a-new-run; the partial run
  folder stays on disk for inspection.

**If the engine itself is the thing misbehaving** — or you need a fully custom per-seat brief
beyond `--critic`/`--lenses`, or deliberate mid-stage inspection — switch to
**`MANUAL-ORCHESTRATION.md`** and tell the user you are doing so.

---

### Stage 4 — Tiered decisions (peer-validated)

Read `<run-folder>/tally.json`. Every finding already carries the **peer-confidence tier** the
engine's tally computed (see *Key mechanics → §5.2 Scoring*, and COUNCIL-DESIGN.md for the full
cascade): **Disputed** (strong peer pushback — `d ≥ 2` and `d > a`), **Confirmed** (≥ 2 peer
agreements, agrees dominate), **Contested** (at least one live dispute), **Singleton** (at most one
endorsement, no pushback). `confidence: thin` cells `(0,0)/(1,0)/(0,1)` are override-eligible —
record any override in `tierOverride: {from, to, reason}` on that finding's decision entry. Present
the tiers in this order: Confirmed first (bulk decision), then Disputed and Contested and Singleton
individually in the judgment tier.

**Scale-down:** In a 1-model run there is no peer-confidence data, so present every finding individually for decision (no tiers). In a 2-model run the Confirmed tier rests on thin cross-review (one ranker per review, per Stage 0) — say so when presenting it.

**Debate mode:** the tiers come from the *final* (post-rebuttal) tally. A finding whose raiser
withdrew it in the rebuttal round (`findings[].debate.action === 'withdrawn'` in `tally.json`) is
**auto-recorded `denied` in `decisions.json` and never presented for a user decision** — just note
it as withdrawn when walking the tiers.

**Consensus tier — Confirmed findings** (≥ 2 peer agreements, agrees dominate)

- Present the full list in one block: id, claim, severity, and which models raised / endorsed it.
- Offer one **bulk accept/deny decision** over the whole tier:

  > Accept all Confirmed findings? (or name any you want to skip)

- The user may accept the block, deny the block, or enumerate exceptions. Handle exceptions individually before moving on.

**Judgment tier — Disputed, Contested, and Singleton findings**

This is one tier with three sub-types presented separately. Present each finding individually. Handle the sub-types distinctly:

- **Disputed** (`d ≥ 2` and `d > a` — strong peer pushback, the finding itself may be wrong): For each finding show the claim, severity, which model raised it, which peers dispute it and why. Ask for a decision before proceeding to the next: **accept / deny / modify**.
- **Contested** (`d ≥ 1` with a meaningful split): For each finding show the claim and severity, which model raised it, who agreed, who disputed, and the one-line reasons from the adjudications. Ask for a decision before proceeding to the next: **accept / deny / modify**.
- **Singleton** (only the original raiser; all other judges were neutral or silent — `d = 0` and `a < 2`): For each finding show the claim and severity and that no other judge engaged with it. Name the sole raiser. Ask for a decision before proceeding to the next: **accept / deny / modify**.

**Recording decisions.** Keep a running decision log throughout this stage — every finding's
outcome (accepted / denied / modified, with any modification noted) — and write it to
`<run-folder>/decisions.json` as a **JSON array**, one object per finding:
`{id, decision, applied?, duplicateOf?, tierOverride?}`. `id` is the run-global label id (e.g. `A1`);
`decision` is the Stage-4 outcome (accepted / denied / modified / deferred); `applied` (optional
bool) marks whether the accepted change was actually applied in Stage 5; `duplicateOf` (optional)
links to another finding's id; `tierOverride` (optional) carries any `{from, to, reason}` override.

Do not advance to Stage 5 until every finding has a recorded decision.

---

### Stage 5 — Outputs

**Editable source** (the artifact is a file you can write — `.md`, `.docx`, `.py`, any text format):
- Apply only the **accepted findings** from Stage 4.
- Write the result as `<stem>-reviewed.<ext>` **next to the original file** — same directory, same extension, `-reviewed` appended before the extension.
- Before writing, validate structural integrity: check that headings are balanced, code blocks close, front-matter is valid, etc. Fix any structural integrity issues **your edits introduce** — do not touch pre-existing issues in the original. Do not alter any content beyond the accepted findings.

**Fixed source** (the artifact is a link, PDF, or something you cannot directly edit):
- Do not attempt to produce a modified copy.
- Write a **standalone reviewed report** instead: the full decision log, the chair's verdict, and clear callouts of what should be changed and where — formatted so the user can apply the changes manually.

**Run-folder artifacts.** The engine already wrote the deterministic set (see *Output & naming*).
Two artifacts are yours:

- `verdict.json` — the engine wrote an **undecided** verdict; replace it with the decided one:

  ```
  amicus council verdict <run-folder>/tally.json --decisions <run-folder>/decisions.json -o <run-folder>/verdict.json --render
  ```

  a thin CLI wrapper over `buildVerdict(record, decisions)` + `writeVerdictAtomic`
  (`src/council/verdict.js`). `<run-folder>/tally.json` is the record the engine's tally wrote;
  `<run-folder>/decisions.json` is the Stage-4 array. It parses both, calls `buildVerdict`, and
  writes the schema-stamped machine-readable record via the same atomic tmp+rename convention the
  function always used. `--render` then refreshes `report.html` from the decided verdict — without
  it you would hand the user a stale, pre-decision page. In Cowork, `amicus_verdict` with
  `render: true` and `outDir` does the same and returns the Markdown rendering in the tool result.
- `report.md` — Claude-authored: the chair's synthesis (read verbatim from
  `<run-folder>/chair-output.md`, including its closing `VERDICT:` line at the top of the report) +
  the full Stage-4 decision log + a summary of what was applied (+ the "How Claude's review fared"
  readout when "Claude in the council" is on) + an **Optional elements** section whenever any
  element was ON: which elements ran; the "Withdrawn by raiser (debate mode)" list and re-vote
  verdict changes; and the standing disclosures — critic self-identification in cross-review
  (critic seat), weakened anonymity + non-comparable street-cred + no ledger entry (expert
  lenses) + a **run-stats table**: one row per model call — **stage**, **model, status,
  durationMs, and cost** read from `run.json` / `tally.json` `runStats`. Cost is
  `usage.cost.amount` (USD); mark it with its `usage.cost.source` — exact for `reported`, `~` for
  `estimated`, `?` for `unknown` — and never invent a figure. Add a **total cost** row from
  `run.json`'s `usage.cost`. Any entry with no run doc → `durationMs: null`, `usage: null`; never
  invent a value.
  - **Renderer:** the `--render` flag above already refreshed `<run-folder>/report.html` from the
    decided verdict — a **separate, deterministic** artifact, not report.md itself (explicit
    equivalent: `amicus council report <run-folder>/verdict.json --html > <run-folder>/report.html`).
    To assemble report.md, also run `amicus council report <run-folder>/verdict.json --md`
    (no redirect — read its stdout) and paste that Markdown into report.md as one section; reserve
    the rest of report.md's prose for the chair's synthesis and the decision log. Prefer the
    renderer's Markdown over hand-assembling the matrix by hand. **`report.html` is the default
    final artifact to hand the user** — a self-contained, shareable page carrying the adjudication
    matrix (finding × judge), the peers-only street-cred table, the findings-by-tier groupings
    (Disputed-first), the debate round when `--debate` was on, and the per-model + total cost.

The fast path retires the manual path's two hand-written artifacts: there is no
`crossreview-matrix.md` (the adjudication grid and street-cred table are rendered into
`report.html`/`report.md`) and no `verdict.md` (the chair's prose is `chair-output.md`, written by
the engine). Do not recreate them — `MANUAL-ORCHESTRATION.md` is where they still live.

Tell the user exactly which files were written and where, leading with `report.html`, **and present the verdict inline in chat** — the chair's overall assessment (verbatim or lightly trimmed) plus the tier counts (Confirmed/Disputed/Contested/Singleton) and what was applied. Never hand over only file paths.

---

### Stage 6 — Capture lessons (compounding)

This stage updates `MODEL-NOTES.md` to make future runs better. **Nothing is written until the user approves a specific diff.**

The `MODEL-NOTES.md` **next to this file** is your machine-local run ledger: npm updates never overwrite it (it is installed only if missing), so lessons accumulate per machine. Durable, machine-independent lessons get folded back into the version-controlled copy in the amicus repo at release time (see the release checklist in `docs/publishing.md`).

**Reflect on this run.** Review the run for:
- Failures, near-misses, and mitigations that worked (dead legs, empty responses, timeouts, briefing problems — all visible in `run.json`)
- Briefing wording that produced **richer or poorer** structured output than expected; per-model `conformance` (`clean` | `repaired` | `unstructured`) is in `run.json` / `tally.json` `runStats`
- Chair or council model behavior worth noting

Draft new or updated entries for the per-model sections of `MODEL-NOTES.md` that capture what was learned.

**Ledger — already appended; do not touch it.** The engine's finalize tally appended one row per
(run × model) to the append-only `council-ledger.jsonl` under `getConfigDir()` as part of the run
(expert-lens runs are deliberately excluded). **In the fast path, never run `council tally`
yourself.** The ledger is append-only, so a second tally over the same run double-appends and
permanently skews every model's lifetime reliability averages — a double-append cannot be undone.
Everything you would have wanted from it (tiers, both street-cred numbers, `runStats`,
`tierCounts`) is already in `<run-folder>/tally.json`. The quantitative reviewer-reliability data
in `MODEL-NOTES.md` is sourced entirely from `amicus council stats` (which aggregates the ledger) —
**do not hand-edit reliability numbers in MODEL-NOTES**.

**Compose the proposed MODEL-NOTES diff.** Combine the run-lessons updates and the reviewer-reliability table updates into a single proposed diff (old → new for every changed section). **Write the full diff to a file in the run folder** — `_tmp-proposed-model-notes-update.md` — so the user can open and review it before deciding. Presenting the diff as chat text alone is **not sufficient**: an approval dialog can hide the chat transcript, so the user may be asked to decide on a diff they never saw.

**Wait for explicit approval before writing anything.** Ask, with the diff file's path inside the approval prompt itself:

> Proposed MODEL-NOTES update written to `<run-folder>/_tmp-proposed-model-notes-update.md` — open it to review. Approve this MODEL-NOTES update? (yes / no / edit)

If the user approves, write the changes. If they say "edit", incorporate their corrections, rewrite the diff file, and re-present its path for approval before writing. Do not write any partial update — write only after the full diff is approved.

**Keep MODEL-NOTES tight.** Do not append new bullets when an existing entry covers the same ground — merge or reword instead. If a note has been superseded by a better mitigation, prune the old one. The goal is a compact, authoritative reference, not a changelog.

---

## Key mechanics

### §5.1 Anonymization

The engine assembles **one shared bundle** — every review relabeled with stable letter identifiers:
**Review A**, **Review B**, **Review C**, and so on — and keeps the label↔model map in orchestrator
memory and `run.json`, never in any judge-visible file. The judge legs run in a `_scratch/`
subdirectory of the run folder precisely so a wandering judge cannot read the de-anonymized
`review-<model>.md` files sitting next to it.

The **identical** bundle goes to every judge. Because no judge can tell which review is its own, each model unknowingly ranks and adjudicates its own review — this is the anti-favoritism mechanism, not a bug. Self-bias washes out symmetrically across judges rather than systematically inflating any one model.

De-anonymization happens only when scoring and when rendering `report.html` / `report.md`. The map is never forwarded to any council model.

**When "Claude in the council" is on:** the `review-claude.md` you authored enters the **same**
bundle as one more labeled entry. Claude never judges (no judge leg is launched for it) and never
chairs; see §5.4.

---

### §5.2 Scoring

The engine's tally stage computes the two scoring signals and writes them to
`<run-folder>/tally.json`. Claude's job is to read them and to exercise judgment on
`thin`-confidence overrides.

**Street-cred** — computed two ways:
- **withSelf** = each model's mean rank position across **all** judges' `FINAL RANKING:` blocks (lower is better).
- **peersOnly** = mean rank excluding the model's own ranking of itself.

Both are surfaced in `report.html` and `report.md`. The ledger and Stage-0 bench recommendations use **peersOnly** only.

**Per-finding peer-confidence tier** — assigned by the peers-only cascade (see COUNCIL-DESIGN.md §5.2 for the full table): **Disputed** → **Confirmed** → **Contested** → **Singleton**. The raiser's own adjudication is excluded from the cascade. `confidence: thin` when total engaged peers `a + d ≤ 1` — cells `(0,0)`, `(1,0)`, `(0,1)`. **Claude may override a `thin` tier at the margins** before presenting Stage 4 — the override is recorded in `tierOverride: {from, to, reason}` and surfaced in `verdict.json`.

---

### §5.3 Chair selection & fallback

Claude **recommends a non-Claude chair** — typically the strongest reasoner available or the best
peers-only street-cred from `amicus council stats` — and the user confirms it before launch
(Stage 0). In the fast path the chair **must not be a bench seat**: the engine rejects
`--chair <m>` when `<m>` is in `--models`, because a chair that also reviewed would be synthesizing
over its own work. It still receives the full de-anonymized picture (all reviews with attribution,
all rankings, all adjudications) in the chair packet.

**Fallback chain, run by the engine when the chair call fails:**

1. Retry the same chair once — transient provider failures are common.
2. Promote the best non-bench model from the reliability ledger (never the reserved `claude` seat).
3. Give up: the run finishes degraded (exit 2) with `overallVerdict: null` and no `chair-output.md`.

On (3), disclose it and offer either a solo re-chair via `MANUAL-ORCHESTRATION.md` or a report-only
outcome. **Claude chairing is a last resort that requires explicit disclosure** that the verdict is
no longer independent of the orchestrator — it is never automatic, and the engine will not do it.
Never silently degrade to Claude-chairs without informing the user.

---

### §5.4 Claude in the council (default off)

Enabling this element lets the bench judge Claude's own take, so you can see how it compares to the independent council.

**Asymmetric by design.** Claude is the orchestrator and holds the label↔model map, so it cannot judge blind. The rule is therefore **asymmetric**: Claude contributes a review to be judged by the council but does **not** vote or chair. Claude participates on the supply side only; the verdict remains independent of the orchestrator.

**Always fresh.** Claude performs a new structured review on the artifact — a fresh pass in the required findings format, not a formalization or summary of anything said earlier in the main conversation. Upstream feedback does not seed or constrain this review. The engine cannot verify freshness; this is a skill-side rule and it is on you.

**Mechanics.** Author `<run-folder>/review-claude.md` at Stage 0 and pass
`--claude-review <run-folder>/review-claude.md`. The engine validates it before any spend, enters
its findings as one more labeled review, sets `meta.claudeInCouncil: true`, adds `claude` to
`meta.models` (the street-cred universe), and records a `runStats` row with `durationMs: null` /
`usage: null` — nothing was launched, and the never-invent rule holds. On such a run `claude` is a
reserved seat name and the engine's pre-flight rejects it in `--models` or `--chair` (and therefore
in `--critic`, which must be a bench seat) with `council_claude_review_invalid`.

**"How Claude's review fared" readout.** Include in `report.md`:
- Claude's peers-only street-cred rank (`withSelf == peersOnly` for Claude, since it casts no rankings).
- The Disputed / Confirmed / Contested / Singleton split of Claude's findings — how many of its claims the bench pushed back on, endorsed, disputed, or ignored.

**Integrity.** When Claude presents results — including the bench's assessment of its own review — it reports the verdict at face value. Claude does not defend, contextualize away, or re-litigate findings the bench disputed or ranked poorly. The point of the element is an honest external read on Claude's review; undermining that defeats the purpose.

---

## Model-recommendation heuristics

Use these together with `amicus council stats` (the ledger — authoritative quantitative reliability data: runs, avg peers-only street-cred, confirm-rate, fact-error rate) and the qualitative quirks in `MODEL-NOTES.md`:

- **Large or long material, broad coverage sweep** → favor a large-context model (e.g., Gemini) that won't truncate or degrade on the full source.
- **Reasoning-heavy critique, structured argument evaluation, citations** → favor a strong reasoner (e.g., DeepSeek, GPT, Opus) that will interrogate claims rather than accept them.
- **Code review** → favor a code-strong model (e.g., DeepSeek, GPT, Opus); general-purpose models often miss implementation-level issues.
- **Independence matters** → pick models from **different families**; two models from the same family produce correlated opinions and reduce the value of the cross-review.
- **Contrarian / red-team value** → when material is persuasive, consensus-prone, or high-stakes, turn on the critic seat (`--critic <model>`): that seat argues against the others and hunts for what they will miss. This is especially valuable when the default council is likely to agree.
- **Consult `amicus council stats`** — a model's historical confirm-rate and avg peers-only street-cred (from the ledger) are the best predictors of council value for a given run type.

Always **rank recommendations by fit**, state the trade-off for each option, and surface the estimated cost (an estimate, not a guarantee; unpriced legs disclosed as "cost unknown"). Never present a single option without explanation.

**Model naming for council members.** Name bench members by alias (`gemini`, `gpt`, `deepseek`, `opus`, …) or by full `provider/model` id — both work with `--models`. A bare canonical id (e.g. `anthropic/claude-opus-4.8`) is policy-routed **direct-first**: Amicus uses the user's direct provider key when one is configured, falling back to OpenRouter automatically. `openrouter/provider/model` is an explicit force-OpenRouter override — reach for it only when the user deliberately wants a specific member to run through OpenRouter (e.g. to use a free-tier variant), or for gateway-only vendors with no direct integration. A per-run `--gateway auto|direct|openrouter` overrides routing for the whole run if the user asks for it; leave it unset (`auto`) by default.

---

## Output & naming

- Run folder: `output/<stem>-council/` (or `./second-opinion/<stem>-council/` if no `output/` exists), passed to the engine as `--out-dir`. After a fast-path run it holds:
  - `briefing.md` — the Stage-0 review request Claude authored (run provenance, not a temp file)
  - `review-claude.md` — Claude's own fresh review, only when "Claude in the council" is on
  - `run.json` — the engine's run manifest: stage log, wave ids, degradation, `runStats`, cost
  - `review-<model>.md` ×N and `judge-<model>.md` ×N — the raw engine legs
  - `briefing-stage1.md`, `bundle-stage2.md`, `chair-packet.md` — the model-facing briefings the engine composed
  - `tally-input.json` and `tally.json` — the assembled input and the tiered record (plus `tally-provisional.json` and `debate.json` when `--debate` was on)
  - `chair-output.md` — the chair's synthesis prose, verbatim from the chair model
  - `decisions.json` — the Stage-4 decision array Claude writes
  - `verdict.json` — schema-stamped machine-readable record: tally output + Stage-4 decisions, written via `amicus council verdict` at Stage 5 (replacing the engine's undecided version)
  - `report.md` — Claude-authored; full contract defined once in *Stage 5 → Run-folder artifacts* above (chair's synthesis + Stage-4 decision log + run-stats table).
  - `report.html` — a **separate, deterministic** artifact rendered from `verdict.json` (no chair prose, no decision-log narrative — see Stage 5's *Renderer* note); the default artifact to share.
- Reviewed copy: `<stem>-reviewed.<ext>`, next to the source.
- The only working file Claude writes in the fast path is the Stage-6 proposed MODEL-NOTES diff (`_tmp-proposed-model-notes-update.md`), cleaned up once the approval decision is resolved. The manual fallback's `_tmp-*.md` files are documented in `MANUAL-ORCHESTRATION.md`.

---

## Files

- `MANUAL-ORCHESTRATION.md` — the **fallback path**: the hand-driven Stage 1/2/2.5/3 mechanics and the Stage-5 artifacts the engine replaced. **Read it when the engine is unavailable, too old, or misbehaving; when a seat needs a fully custom brief beyond `--critic`/`--lenses`; or when you need to inspect or intervene mid-stage.**
- `MODEL-NOTES.md` — operating rules, per-model qualitative quirks, cost guardrail, and structural-conformance notes. **Read it before Stage 0 (council selection and launch); update qualitative notes (with approval) in Stage 6.** Quantitative reliability data (runs, avg street-cred, confirm-rate, fact-error rate) comes from `amicus council stats`, not this file. This copy is machine-local (never overwritten on update); the shipped seed lives in the amicus repo and absorbs durable lessons at release time.
- `SEAT-BRIEFS.md` — the semantics of the optional council elements (critic seat, expert lenses, rebuttal round, chair verdict scale) plus the standard anti-sycophancy clause. The engine composes its own stricter-JSON variants of these headlessly; this file stays authoritative for the manual path and for what each element *means*. **Read it whenever any element is toggled on at Stage 0.**
- `COUNCIL-DESIGN.md` — the design spec this skill implements (§12 covers the optional council elements). Consult it if a mechanics question arises that the skill prose does not resolve.
