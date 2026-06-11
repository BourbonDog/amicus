---
name: second-opinion
description: Run a structured, multi-model "council" review of material the user provides and turn it into decisions. Use when the user supplies one or more documents, artifacts, or links PLUS an analysis request and criteria, and wants other AI model(s) to independently evaluate, critique, fact-check, stress-test, or red-team that material and then help act on the findings. The council adds a peer cross-review stage — models review the material independently, then anonymously rank and adjudicate each other's reviews, and a designated non-Claude "chair" model synthesizes the verdict while Claude orchestrates but does not synthesize. Trigger on "second opinion", "multi-model review", "council review", "have other models review/critique/evaluate this", "cross-check this against the research", "red-team/stress-test this doc", "what would other models conclude about this", or any request to review provided material with external model(s) and turn it into accept/deny edits — even if the user never says "sidecar". Optionally includes Claude as a judged (non-voting, non-chairing) council member to see how the bench rates Claude's own take. Defaults to 3 models from different families; scales down to a single thorough pass. This is NOT for quick or exploratory single-model chats — for "ask Gemini…", "what does DeepSeek think", brainstorming with a model, or spawning/forking a conversation with another model, use the sidecar skill instead.
---

# Second Opinion (LLM Council)

Independent, multi-model review of material the user provides, turned into decisions. Any single model — including the one running this conversation — has consistent blind spots. Routing the same material through models from *different* families surfaces disagreements, missed issues, and overstated claims that one model alone won't catch.

Four principles govern this skill:

1. **Secondary tool.** By the time this skill runs, Claude has already given its opinion in the main conversation. The skill exists to bring in *independent outside* views — it does not replace or re-run Claude's upstream analysis.
2. **The council is the non-Claude bench by default.** Council members are models from families other than the orchestrator (Gemini, DeepSeek, GPT, etc.). Claude is not a first-opinion council member unless the optional "Claude in the council" toggle is on — and even then it is judged but does not vote or chair.
3. **Claude orchestrates; Claude does not synthesize the verdict.** Claude preps material, recommends the council, anonymizes reviews, drives the stages, scores, and presents accept/deny decisions. A designated non-Claude chair model synthesizes the final verdict. Claude's role ends at presenting it.
4. **The subject of cross-review is the other reviews, not the artifact again.** In the peer cross-review stage, models critique and rank *each other's reviews* — not re-review the original artifact. This is the mechanism that surfaces reviewer blind spots and inflated confidence.

Operating lessons from each run fold back into `MODEL-NOTES.md` (with approval), so the skill gets better at driving each model over time.

**Before launching any model, READ `MODEL-NOTES.md`** (next to this file). It holds the operating rules and per-model quirks that decide whether a run succeeds or silently fails. These were learned the hard way; skipping them wastes runs and produces empty results that look like answers.

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

The flow runs as a **Stage 0 intake/prep step** followed by **three sequential review waves** (Stage 1 → Stage 2 → Stage 3), each wave dependent on the prior. Within each wave, models run in parallel. Track the stages as todos and do not advance until the prior wave's outputs are in hand.

### Stage 0 — Intake & prep

Confirm the three inputs before doing anything else: **source material**, **the analysis** (the thing to be reviewed), and **the criteria** (what quality/correctness means for this material). Ask only for what is missing; don't re-ask for what is already provided.

**Establish the run folder first:** `output/<stem>-council/` (or `./second-opinion/<stem>-council/`
if no `output/` directory exists). Create it now — every temp file, briefing, review, and artifact
in this run is written here. Use its absolute path in all `--prompt-file` arguments.

**Prepare material for council models:**
- Large, linked, or heavily marked-up sources → extract clean text to a small, clearly-named temp
  file in the run folder (briefing hygiene: token cost and model focus). Reference its absolute
  path in the briefing, or inline it if small.
- Small, clean text → feed inline in the briefing.
- Write every briefing to a temp file (`_tmp-*.md` in the run folder) and pass it with
  `--prompt-file` — never inline a briefing as a CLI argument. All `_tmp-*` files are cleaned up
  after the run.

**Pick the council.** Default: **3 models from different families (non-Claude)**. Recommend them ranked by fit, consulting the reviewer-reliability table in `MODEL-NOTES.md`. State the estimated cost. **Disclose the run shape up front** before asking for confirmation — e.g.:

> This run uses 3 council models across 2 fanout waves + 1 chair call (~7 model runs), ~10 min.

Then **wait for confirmation**. Never launch without it. Honor the cost guardrail in `MODEL-NOTES.md` (no `o3`/`o3-pro` without explicit ask-by-name).

**Scale-down is explicit — state which mode applies:**
- **1 model** → thorough single pass; Stage 2 (cross-review) and Stage 3 (chair synthesis) are skipped entirely; Claude synthesizes directly. Transport: a single solo `amicus start --no-ui --json` (no fanout).
- **2 models** → Stage 2 runs but the ranking is thin (one ranker per review); note this limitation.
- **3 models (default)** → full deep council with meaningful cross-review and tie-breaking.

The scale-down levels count **non-Claude judges**; enabling "Claude in the council" adds a judged review but not a judge, so it does not change these levels. If the bench drops below 2 surviving reviews during the run, apply the Stage-1 wave-degrade rule (offer re-run or a disclosed single-pass downgrade).

**Present the "Claude in the council" toggle (default: off).** At launch, offer:

> Claude-in-the-council (default off): I can add my own fresh review to the bundle so the bench can rank and adjudicate it. You'd see how my take compares to the other reviewers. This means Claude is judged but does not vote (Stage 2) or chair (Stage 3) — the verdict stays independent. Turn on?

When off, Claude does not contribute a review and does not appear in the bundle. When on, see Stage 1.

---

### Stage 1 — Independent reviews

Each council model reviews **the artifact** independently. Write one Stage-1 briefing file
(`_tmp-briefing-stage1.md` in the run folder) and launch the whole wave as ONE background call:

```
amicus fanout --models <m1,m2,m3> --prompt-file <run-folder>/_tmp-briefing-stage1.md --json \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

Run it in the background (`run_in_background: true`); you are notified on completion — do not
poll. `fanout` is headless by definition. The command exits when every leg is terminal and prints
ONE JSON wave document on stdout (`schemaVersion: 1`; the wave's id field is `waveId`, each leg's id is `taskId`): check `status` (`complete` | `partial` |
`error`), `counts`, and each leg in `legs[]` — a leg's `summary` field IS that model's review;
`model`/`modelInput` identify the reviewer (`model` is the resolved id, `modelInput` the alias you passed — use the alias for `review-<model>.md` filenames); `status`/`error` identify failures. Exit code 0 =
all legs complete, 2 = partial (apply the wave-degrade rules below), 1 = error/aborted. (To re-fetch a single leg later: `amicus read <taskId> --json`.)

**Red-team variant:** fanout legs share a single prompt by design. When one model gets a distinct
red-team brief, launch it as a separate concurrent solo run alongside the wave:

```
amicus start --model <redteam-model> --no-ui --json \
  --prompt-file <run-folder>/_tmp-briefing-redteam.md \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

Its stdout is a single run document; the `summary` field is the review.

**Cowork / no-Bash environments:** use the MCP tools instead — `amicus_fanout` (briefing via
file) returns `{waveId, taskIds[]}` immediately; poll `amicus_status`, then `amicus_read` each
leg. The council's briefings are always self-contained (`--no-context`), so MCP transport is
equivalent.

**Required structured output from every model.** Instruct each council model to produce:

1. A **findings list** — every finding contains:
   - `id` — sequential integer within this review (1, 2, 3…)
   - `claim` — the specific issue or observation
   - `severity` — one of: `blocker | major | minor | nit`
   - `location` — section heading or verbatim quote identifying where in the artifact
   - `rationale` — why this is a problem or worth noting

2. A **short overall take** — 2–4 sentences summarizing the reviewer's overall assessment.

Instruct models to emit the structured output verbatim, without preamble, so it reads cleanly.

When the wave returns, save each leg's `summary` to the run folder as `review-<model>.md`
(one file per reviewer) before moving on.

**"Claude in the council" (when toggled on):** Claude also produces a **fresh** Stage-1 review on the artifact in the identical findings format — a new structured pass on the artifact, not a formalization of anything said upstream. This review is added to the bundle as one more anonymous entry. Claude does not rank or adjudicate in Stage 2 (it holds the label map), and does not chair in Stage 3. Save it as `review-claude.md`.

**Wave-degrade rules (Stage 1).** Read failures from the wave document — never silently ignore
them:
- All legs `complete` → proceed normally.
- A leg ends `error`/`timeout`/`crashed`/`aborted` but **≥ 2 reviews survive** → proceed with the
  survivors; name the dead leg and its `error` when presenting; the bench shrinks accordingly. If this leaves exactly 2 surviving reviews, the run is now effectively a 2-model council — apply the thin-ranking disclosure (Stage 0 / Stage 4) from here on.
- **Fewer than 2 reviews survive** → offer the user a re-run of the dead leg(s) (solo
  `amicus start --json`, same briefing file) or a disclosed downgrade to single-pass mode
  (Stage 2 and Stage 3 skipped, per the scale-down rules).

---

### Stage 2 — Cross-review

This is the peer-validation step. Claude builds one shared anonymized bundle, distributes it to every council model for ranking and finding adjudication, then de-anonymizes for scoring.

**Build the shared anonymized bundle.** After all Stage-1 reviews are in hand, Claude:
1. Assigns stable labels: **Review A**, **Review B**, **Review C**, … (one per review, including Claude's if the toggle is on).
2. Keeps a **private label↔model map** (e.g., `Review A → deepseek`, `Review B → gemini`, `Review C → claude`) that is never sent to any sidecar model.
3. Assembles one bundle document containing all labeled reviews. The bundle is identical for every judge.

Each model **unknowingly ranks and adjudicates its own review** — this is the anti-favoritism mechanism, not a bug. Because no model knows which review is its own, self-bias washes out symmetrically across judges.

**Distribute the same bundle to every council model** — this is exactly fanout's shared-prompt
model. Write the bundle + judging instructions to `_tmp-bundle-stage2.md` and launch one wave:

```
amicus fanout --models <m1,m2,m3> --prompt-file <run-folder>/_tmp-bundle-stage2.md --json \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

(Background, same JSON handling as Stage 1.) Each judge's leg `summary` is its ranking +
adjudication response. **Stage-2 degrade:** a judge leg dies → tally over the surviving judges
(≥ 1) and disclose the reduced bench in `crossreview-matrix.md`; tier definitions are unchanged
(they already count "judges engaged"). Each judge is asked to do two things on the bundle:

**Task A — Rank.** Order the reviews from most to least accurate and insightful. End the response with a parseable block in exactly this format (no other text on those lines):

```
FINAL RANKING:
1. Review C
2. Review A
3. Review B
```

**Task B — Adjudicate findings.** For every finding in the bundle, state: `agree | dispute | neutral` plus one-line reason. Reference each finding as **review-label + finding-id** — for example, `A2` means Review A's 2nd finding, `B1` means Review B's 1st finding. An "I missed this — it's valid" counts as `agree`.

As each judge's ranking + adjudication response returns, collect it (the raw per-judge responses are working intermediates, not separate run-folder artifacts). Once all are in, de-anonymize and tally them into the single `crossreview-matrix.md` — the adjudication grid plus the street-cred table (see *Output & naming*). This de-anonymized data feeds Stage 3 (chair briefing), the scoring/street-cred table, and the cross-review matrix artifact — but is never re-anonymized or forwarded to any council model.

---

### Stage 3 — Council-chair synthesis

A designated **non-Claude** chair synthesizes the verdict across all reviews, rankings, and adjudications. The chair produces an independent verdict that Claude then presents — Claude does not paraphrase, edit, or re-synthesize it.

**Chair selection (confirmed in Stage 0).** Default: Claude recommends the strongest reasoner in the council (guided by the reviewer-reliability table in `MODEL-NOTES.md`) and the user confirms before the run launches. The chair may be a council member who already participated in Stages 1 and 2 — it receives the de-anonymized full bundle, all ranking outputs, and all adjudications so it has the complete picture.

**Fallback order if the chair fails:**
1. Re-run the chair call (transient failure — `MODEL-NOTES.md` mitigations apply).
2. Promote the next-best non-Claude council model as chair.
3. **Claude chairs only as last resort — with explicit disclosure** that the verdict is no longer fully independent of the orchestrator.

**Chair briefing.** Write the chair packet to `_tmp-chair-packet.md` and send one solo run
(background):

```
amicus start --model <chair> --no-ui --json \
  --prompt-file <run-folder>/_tmp-chair-packet.md \
  --agent Plan --no-context --summary-length verbose --timeout <minutes>
```

The run document's `summary` is the verdict. The packet contains:
- All Stage-1 reviews (de-anonymized — model attribution restored)
- All cross-review ranking outputs (with model attribution)
- All adjudication outputs (with model attribution and `agree | dispute | neutral` verdicts per finding)

Instruct the chair to write a **synthesized verdict** that:
- Weighs each reviewer's findings by their peer-validated standing (street-cred rank and adjudication pattern)
- Distinguishes findings the bench broadly endorsed from contested or singleton claims
- Arrives at an overall assessment of the artifact

Save the chair's output to the run folder as `verdict.md`.

---

### Stage 4 — Tiered decisions (peer-validated)

All findings from the bundle are sorted into two tiers based on the **peer-confidence tier derived from the Stage 2 adjudication data**. These tiers are **derived from the Stage 2 adjudications** — a judgment call, not a rigid formula (see *Key mechanics → §5.2 Scoring* for the full rule): a finding is **Confirmed** when agrees clearly outweigh disputes (≥ 2 judges engaged), **Contested** when there is a meaningful split or explicit disputes, and **Singleton** when only its original raiser stands behind it. Present the tiers in this order.

**Scale-down:** In a 1-model run, Stage 2 was skipped — there is no peer-confidence data, so present every finding individually for decision (no tiers). In a 2-model run, the Confirmed tier rests on thin cross-review (one ranker per review, per Stage 0) — say so when presenting it.

**Consensus tier — Confirmed findings** (peers agree clearly outweigh disputes, with ≥ 2 judges engaged)

- Present the full list in one block: id, claim, severity, and which models raised / endorsed it.
- Offer one **bulk accept/deny decision** over the whole tier:

  > Accept all Confirmed findings? (or name any you want to skip)

- The user may accept the block, deny the block, or enumerate exceptions. Handle exceptions individually before moving on.

**Judgment tier — Contested and Singleton findings**

This is one tier with two sub-types presented separately. Present each finding individually. Handle the two sub-types distinctly:

- **Contested** (meaningful split or explicit disputes): For each finding show the claim and severity, which model raised it, who agreed, who disputed, and the one-line reasons from the adjudications. Ask for a decision before proceeding to the next: **accept / deny / modify**.
- **Singleton** (only the original raiser; no other judge engaged — neutral or silent): For each finding show the claim and severity and that no other judge engaged with it. Name the sole raiser. Ask for a decision before proceeding to the next: **accept / deny / modify**.

**Recording decisions.** Keep a running decision log throughout this stage — every finding's outcome (accepted / denied / modified, with any modification noted). This log feeds Stage 5 (only accepted changes go into the reviewed copy) and Stage 6 (the run-folder report).

Do not advance to Stage 5 until every finding in both tiers has a recorded decision.

---

### Stage 5 — Outputs

**Editable source** (the artifact is a file you can write — `.md`, `.docx`, `.py`, any text format):
- Apply only the **accepted findings** from Stage 4.
- Write the result as `<stem>-reviewed.<ext>` **next to the original file** — same directory, same extension, `-reviewed` appended before the extension.
- Before writing, validate structural integrity: check that headings are balanced, code blocks close, front-matter is valid, etc. Fix any structural integrity issues **your edits introduce** — do not touch pre-existing issues in the original. Do not alter any content beyond the accepted findings.

**Fixed source** (the artifact is a link, PDF, or something you cannot directly edit):
- Do not attempt to produce a modified copy.
- Write a **standalone reviewed report** instead: the full decision log, the chair's verdict, and clear callouts of what should be changed and where — formatted so the user can apply the changes manually.

**Run-folder artifacts — always write these** regardless of source type. The full artifact set and naming conventions are defined in the *Output & naming* section of this skill; write every artifact specified there. The four canonical run-folder files are:
- `review-<model>.md` × N (already saved in Stage 1)
- `crossreview-matrix.md` — the de-anonymized adjudication grid and street-cred table
- `verdict.md` (already saved in Stage 3)
- `report.md` — the chair's synthesis + the full Stage-4 decision log + a summary of what was
  applied (+ the "How Claude's review fared" readout when "Claude in the council" is on) + a
  **run-stats table**: one row per model call — **stage** (which stage you launched the call for)
  plus **model, status, durationMs** read from the wave/run JSON documents. The schema carries no
  cost data — do not invent cost figures.

Tell the user exactly which files were written and where.

---

### Stage 6 — Capture lessons (compounding)

This stage updates `MODEL-NOTES.md` to make future runs better. **Nothing is written until the user approves a specific diff.**

**Reflect on this run.** Review the run for:
- Failures, near-misses, and mitigations that worked (poller traps, empty responses, timeout issues, briefing problems)
- Briefing wording that produced **richer or poorer** structured output than expected
- Chair or council model behavior worth noting

Draft new or updated entries for the per-model sections of `MODEL-NOTES.md` that capture what was learned.

**Update the reviewer-reliability table.** After every completed council run, update the rolling table in `MODEL-NOTES.md` (the "Reviewer reliability" table) for each council model that participated:
- **avg street-cred** — incorporate this run's rank position into each model's running average.
- **confirm-rate** — incorporate this run's share of each model's findings that ended up Confirmed.
- Merge into the existing row for that model; prune the notes column to stay tight.

**Compose the proposed MODEL-NOTES diff.** Combine the run-lessons updates and the reviewer-reliability table updates into a single proposed diff (old → new for every changed section). Show it to the user in full.

**Wait for explicit approval before writing anything.** Present the diff and ask:

> Approve this MODEL-NOTES update? (yes / no / edit)

If the user approves, write the changes. If they say "edit", incorporate their corrections and show the revised diff before writing. Do not write any partial update — write only after the full diff is approved.

**Keep MODEL-NOTES tight.** Do not append new bullets when an existing entry covers the same ground — merge or reword instead. If a note has been superseded by a better mitigation, prune the old one. The goal is a compact, authoritative reference, not a changelog.

---

## Key mechanics

### §5.1 Anonymization

Stage 2 distributes a single anonymized bundle; this section details the mechanics that make that safe and fair.

After all Stage-1 reviews are in hand, Claude assembles **one shared bundle** — every review relabeled with stable letter identifiers: **Review A**, **Review B**, **Review C**, and so on. Claude keeps a **private label↔model map** (e.g., `Review A → deepseek`, `Review B → gemini`, `Review C → claude`) that is never shared with any sidecar model.

The **identical** bundle goes to every judge. Because no judge can tell which review is its own, each model unknowingly ranks and adjudicates its own review — this is the anti-favoritism mechanism, not a bug. Self-bias washes out symmetrically across judges rather than systematically inflating any one model.

Claude **de-anonymizes only** at two points: when computing scores and when writing `crossreview-matrix.md` and `report.md`. The label↔model map is never re-forwarded to any council model after de-anonymization.

**When "Claude in the council" is on:** Claude's own Stage-1 review enters the **same** bundle alongside the other reviews. Claude holds the label map and therefore cannot judge blind; see §5.4 for how this asymmetry is handled. Claude **never ranks or adjudicates** in Stage 2.

---

### §5.2 Scoring

Claude tallies two scoring signals from the Stage-2 outputs. No code is required; Claude works through the structured output directly.

**Street-cred** = each model's **average rank position** across all judges' `FINAL RANKING:` blocks (lower is better). For example, if three judges rank DeepSeek 1st, 2nd, and 1st, its street-cred score is 1.33. Surface this as a compact table in the cross-review matrix and report. Street-cred drives the chair's weighting of reviewer findings in Stage 3 and feeds the reviewer-reliability table updated in Stage 6.

**Per-finding peer-confidence tier** = a qualitative label derived from the Stage-2 adjudications for each finding:

- **Confirmed** — agrees clearly outweigh disputes, with at least 2 judges having engaged with the finding.
- **Contested** — a meaningful split exists or explicit disputes were recorded.
- **Singleton** — only the original raiser stands behind it; all other judges were neutral or silent.

These three tiers drive the Stage-4 decision flow. Assigning a tier is a **judgment call, not a rigid formula** — Claude reads the adjudication signals and makes the call at the margins, especially when engagement is sparse or agreements and disputes are close in number. When in doubt, downgrade toward Contested or Singleton rather than overstate confidence.

---

### §5.3 Chair selection & fallback

The default is for Claude to **recommend a non-Claude chair** from the council — typically the model with the strongest reasoning capability or the best reviewer-reliability score in `MODEL-NOTES.md` — and the user confirms this recommendation before the run launches (Stage 0). The chair **may** be a council member who already participated in Stages 1 and 2; it receives the full de-anonymized picture (all reviews with model attribution, all rankings, all adjudications) so it can synthesize from a complete view.

**Fallback chain if the chair call fails:**

1. Re-run the chair call — transient provider failures are common; apply the mitigation from `MODEL-NOTES.md`.
2. Promote the next-best non-Claude council model to chair.
3. **Claude chairs only as last resort — with explicit disclosure** that the verdict is no longer fully independent of the orchestrator. State this clearly in the report.

Never silently degrade to Claude-chairs without informing the user.

---

### §5.4 Claude in the council (default off)

Enabling this toggle lets the bench judge Claude's own take, so you can see how it compares to the independent council.

**Asymmetric by design.** Claude is the orchestrator and holds the label↔model map, so it cannot judge blind. The rule is therefore **asymmetric**: Claude contributes a review to be judged by the council but does **not** vote (Stage 2) or chair (Stage 3). Claude participates on the supply side only; the verdict remains independent of the orchestrator.

**Always fresh.** When the toggle is on, Claude performs a new structured Stage-1 review on the artifact — a fresh pass in the required findings format, not a formalization or summary of anything said earlier in the main conversation. Upstream feedback does not seed or constrain this review.

**"How Claude's review fared" readout.** Included in both `crossreview-matrix.md` and `report.md` when the toggle is on:
- Claude's street-cred rank among peers (its average rank position in the judges' `FINAL RANKING:` blocks).
- The Confirmed / Contested / Singleton split of Claude's findings — how many of its claims the bench endorsed, contested, or ignored.

**Integrity.** When Claude presents results — including the bench's assessment of its own review — it reports the verdict at face value. Claude does not defend, contextualize away, or re-litigate findings the bench disputed or ranked poorly. The point of the toggle is an honest external read on Claude's review; undermining that defeats the purpose.

---

## Model-recommendation heuristics

Use these together with the reviewer-reliability table in `MODEL-NOTES.md`, which holds live performance data from prior runs:

- **Large or long material, broad coverage sweep** → favor a large-context model (e.g., Gemini) that won't truncate or degrade on the full source.
- **Reasoning-heavy critique, structured argument evaluation, citations** → favor a strong reasoner (e.g., DeepSeek, GPT, Opus) that will interrogate claims rather than accept them.
- **Code review** → favor a code-strong model (e.g., DeepSeek, GPT, Opus); general-purpose models often miss implementation-level issues.
- **Independence matters** → pick models from **different families**; two models from the same family produce correlated opinions and reduce the value of the cross-review.
- **Contrarian / red-team value** → when material is persuasive, consensus-prone, or high-stakes, assign one model an explicit red-team brief: argue against the others, hunt for what they will miss. This is especially valuable when the default council is likely to agree.
- **Consult the reviewer-reliability table** in `MODEL-NOTES.md` — a model's historical confirm-rate and avg street-cred are the best predictors of council value for a given run type.

Always **rank recommendations by fit**, state the trade-off for each option, and surface the estimated cost. Never present a single option without explanation.

---

## Output & naming

- Run folder: `output/<stem>-council/` (or `./second-opinion/<stem>-council/` if no `output/` exists), containing:
  - `review-<model>.md` ×N — raw Stage 1 reviews (plus `review-claude.md` when "Claude in the council" is on)
  - `crossreview-matrix.md` — adjudication grid + de-anonymized street-cred table
  - `verdict.md` — the chair's synthesis
  - `report.md` — synthesis + decision log + what was applied (+ the "How Claude's review fared" readout when the toggle is on) + a
    **run-stats table**: one row per model call — **stage** (which stage you launched the call for) plus **model, status, durationMs** read from the wave/run JSON documents. The schema carries no cost data — do not invent cost figures.
- Reviewed copy: `<stem>-reviewed.<ext>`, next to the source.
- Temp working files (`_tmp-*.md`: extracts, stage briefings, red-team brief, bundle, chair packet) live in the
  run folder and are cleaned up at the end of the run.

---

## Files

- `MODEL-NOTES.md` — operating rules, per-model quirks, cost guardrail, and the reviewer-reliability rolling table. **Read it before Stage 0 (council selection and launch); update it (with approval) in Stage 6.**
- `COUNCIL-DESIGN.md` — the design spec this skill implements (v3). Consult it if a mechanics
  question arises that the skill prose does not resolve.
