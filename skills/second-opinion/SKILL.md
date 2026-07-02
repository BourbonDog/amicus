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

**Transport rule — CLI not on PATH:** every command below assumes the `amicus` CLI. If `amicus` is not on PATH (typical for **plugin-only installs**), run the identical commands as `npx -y amicus@latest <args>` (e.g. `npx -y amicus@latest fanout --models "m1,m2,m3" --prompt-file <path> --json`), or use the equivalent MCP tools (`amicus_fanout`, `amicus_start`, `amicus_status`, `amicus_read`, `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict`) — council briefings are always self-contained (`--no-context`), so MCP transport is equivalent.

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

**Pick the council.** Default: **3 models from different families (non-Claude)**. Recommend them ranked by fit, consulting both the reviewer-reliability data from `amicus council stats` (the authoritative quantitative source — runs, avg peers-only street-cred, confirm-rate, fact-error rate) and the qualitative quirks in `MODEL-NOTES.md`. State the estimated cost. The estimate is the budget gate's pre-flight figure (per-$/Mtok pricing from the cached catalog; direct-provider legs without catalog pricing are disclosed as "cost unknown"). State it as an estimate, not a guarantee. **Disclose the run shape up front** before asking for confirmation — e.g.:

**Free council (zero-cost).** If the user asks for a "free council" / "zero-cost council",
read `councils.free` from `~/.config/amicus/config.json` and run
`amicus fanout --council free --prompt-file <briefing>`. Free-tier handling:
- Cost ≈ $0 — skip the paid-run cost framing (the budget gate is a no-op at zero price).
- No reliability history: free models have no `amicus council stats` / `MODEL-NOTES` record,
  so don't rank on street-cred. Pick the most capable free model as chair and state lower confidence.
- Weak structured output: small free models are less reliable at the strict findings JSON; expect
  more `validateFindings` repair-loop hits.
- Throttled/truncated legs: a mid-stream 429 can yield a leg marked `complete` with a truncated,
  unparseable review. When a free-council leg is `complete` but `validateFindings` returns
  `NO_FENCED_BLOCK`/`NOT_PARSEABLE`, treat it as suspect/throttled — don't burn the repair loop on the
  same throttled model; disclose it and apply the ≥2-reviews-survive wave-degrade rule.
- Prerequisite: free models require enabling data-sharing in OpenRouter privacy settings
  (openrouter.ai/settings/privacy) or legs 404 at run time — catalog validation cannot catch this.
  State this up front.

> This run uses 3 council models across 2 fanout waves + 1 chair call (~7 model runs), ~10 min.

Then **wait for confirmation**. Never launch without it. The budget gate enforces the cost guardrail in code: by default it refuses any leg whose price exceeds the per-$/Mtok threshold (the o3/o3-pro guard). To run an intentionally expensive model the user explicitly asked for by name, pass `--no-cost-gate`; to raise only the total ceiling, pass `--max-cost <$>`.

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

1. A **prose review** — the reviewer's full narrative assessment of the artifact.

2. A **trailing fenced ` ```json ` block** immediately after the prose, containing:
   ```json
   {
     "overall": "one-paragraph take",
     "findings": [
       { "id": 1, "severity": "blocker",
         "claim": "…", "location": "…", "rationale": "…" }
     ]
   }
   ```
   - `id` — sequential integer within this review (`1..n`); at Stage-2 assembly Claude rewrites each into a **run-global label id** (`A1`, `B1`, …) by prefixing the review's anonymized label.
   - `severity ∈ {blocker, major, minor, nit}`
   - `claim`, `location`, `rationale` — non-empty strings.

Instruct models to emit the structured JSON verbatim after the prose, without preamble, so it parses cleanly.

**After the wave returns, validate each leg's findings block** using `validateFindings` (Unit A — `src/council/findings.js`). If a leg's JSON fails validation:
1. Issue a **solo `start --json`** re-prompt to that one model: "re-emit only the findings JSON, fixing: \<errors\>." Keep the first-pass prose. (Solo `start` passes through the **same budget gate** as `fanout`. If launching the wave required `--max-cost <$>` or `--no-cost-gate`, pass the **same flag on every repair re-prompt and on the chair call** — otherwise the gate can refuse a repair or the chair mid-council.)
2. If still malformed, retry **once more** (cap = **2** re-prompts total).
3. If still malformed after 2 retries, mark the review `unstructured` and hand-parse its prose into the schema. The review proceeds — never dropped for a formatting miss.

Record per-model **conformance** (`clean` | `repaired` | `unstructured`) for inclusion in the tally input's `runStats` and the Stage-6 MODEL-NOTES note.

Save each leg's full output (prose + findings block) to the run folder as `review-<model>.md`
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

**Judge-briefing hardening (required).** Open `_tmp-bundle-stage2.md` with this preamble, verbatim, as its first line:

> Do NOT use any tools or read any files; everything is in this message; begin immediately with A1:

Plan-agent judges have wandered to tools mid-adjudication (reading files instead of judging and returning only narration), and a tool-capable judge can read the de-anonymized `review-<model>.md` files in the run folder — an anonymization leak. The preamble closes both. **Scratch-cwd (optional second layer):** launch the Stage-2 wave (and the Stage-3 chair call) with `--cwd <run-folder>/_scratch/` — create the empty directory first — so even a wandering agent finds nothing to read. Caveat: those legs' session records then live under `_scratch/.claude/amicus_sessions/`, so any later `amicus read <taskId>` for them needs the same `--cwd`.

**Task A — Rank.** Order the reviews from most to least accurate and insightful. End the response with a parseable block in exactly this format (no other text on those lines):

```
FINAL RANKING:
1. Review C
2. Review A
3. Review B
```

**Task B — Adjudicate findings.** For every finding in the bundle, state: `agree | dispute | neutral` plus one-line reason. Reference each finding as **review-label + finding-id** — for example, `A2` means Review A's 2nd finding, `B1` means Review B's 1st finding. An "I missed this — it's valid" counts as `agree`.

As each judge's ranking + adjudication response returns, collect it (the raw per-judge responses are working intermediates, not separate run-folder artifacts). Once all are in, **assemble the de-anonymized tally input** and then call `amicus council tally`:

**Stage-2 → tally assembly recipe (Claude's work before calling `tally`):**
0. **Build `meta` and `findings[]` first — `tally` requires both** (missing either fails with `BAD_ARGS: Cannot read properties of undefined (reading 'map')`):
   - `meta` = `{ "runId": "<run-folder stem>", "models": [<every reviewed model id, including "claude" when the toggle is on — this is the street-cred universe>], "chair": "<confirmed chair model id>", "claudeInCouncil": <Stage-0 toggle> }`. Optional extras: `runType`, `date`.
   - `findings[]` = one entry per finding across ALL reviews: `{ "id": "<run-global label id from step 1, e.g. A1>", "raiser": "<de-anonymized model that raised it>", "severity": "<from the review JSON>" }` (`claim` may be carried along but is not required).
1. **Rewrite finding ids to run-global label ids.** Each Stage-1 review's local integer ids (`1`, `2`, `3`…) become `A1`, `A2`, `A3`… (where `A` is that review's anonymized label). The label↔model map (`Review A → deepseek`, etc.) is the key.
2. **Build `adjudications`** — for every judge across all findings: `findingId` = run-global label id; `judge` = the model id (de-anonymized via the map); `verdict ∈ {agree, dispute, neutral}`. Include every judge's verdict on every finding. The raiser's own adjudication of its own finding is **included in the input** (the tally engine excludes it when computing peers-only tiers — do not pre-filter it).
3. **Translate each judge's `FINAL RANKING:` block** — convert the label order (`1. Review C / 2. Review A / 3. Review B`) into a model `order` array via the same map (e.g. `{C→mistral, A→deepseek, B→gpt}` ⇒ `order: ["mistral","deepseek","gpt"]`). This is each entry in `rankings[]`.
4. **Populate `runStats`** from the per-leg run documents emitted by `fanout --json` (and any solo red-team/chair `start --json` docs): copy `model`, `status`, `durationMs`, `usage` verbatim. Any leg with no run doc gets `durationMs: null` and `usage: null` — never invent a value. Attach `role` (`council` | `redteam` | `claude`), `wasChair`, and `conformance` (`clean` | `repaired` | `unstructured`) as council-domain labels.

**Five-keys checklist — verify `tally-input.json` has ALL of:** `meta` (with `meta.models`), `findings`, `adjudications`, `rankings`, `runStats` (`runStats` may be `[]`; the other four are required). Do not call `tally` until all five are present.

Then call:

```
amicus council tally <run-folder>/tally-input.json --json
```

The output `record` carries the deterministic tiers (Disputed / Confirmed / Contested / Singleton), `confidence` (`solid` | `thin`), both street-cred numbers (`withSelf` and `peersOnly`), the validated `runStats`, and `tierCounts`. **Claude may override a `thin`-confidence tier at the margins** before Stage 4 — record the override in `tierOverride: {from, to, reason}`; the matrix and `verdict.json` surface it. De-anonymize and write the tally results to `crossreview-matrix.md` — the adjudication grid plus the street-cred table. This data feeds Stage 3 (chair briefing) and is never re-anonymized or forwarded to any council model.

---

### Stage 3 — Council-chair synthesis

A designated **non-Claude** chair synthesizes the verdict across all reviews, rankings, and adjudications. The chair produces an independent verdict that Claude then presents — Claude does not paraphrase, edit, or re-synthesize it.

**Chair selection (confirmed in Stage 0).** Default: Claude recommends the strongest reasoner in the council (guided by `amicus council stats` (peers-only street-cred) and the qualitative quirks in `MODEL-NOTES.md`) and the user confirms before the run launches. The chair may be a council member who already participated in Stages 1 and 2 — it receives the de-anonymized full bundle, all ranking outputs, and all adjudications so it has the complete picture.

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

(The budget gate applies to this solo call too — if Stage 0 needed `--max-cost <$>` or `--no-cost-gate` to launch the wave, the chair call needs the same flag.)

The run document's `summary` is the verdict. The packet contains:
- All Stage-1 reviews (de-anonymized — model attribution restored)
- All cross-review ranking outputs (with model attribution)
- All adjudication outputs (with model attribution and `agree | dispute | neutral` verdicts per finding)

Open `_tmp-chair-packet.md` with the no-tools preamble, adjusted for the chair: *'Do NOT use any tools or read any files; everything is in this message; begin immediately with the verdict.'* The packet is complete by construction — the chair must never go looking for files.

Instruct the chair to write a **synthesized verdict** that:
- Weighs each reviewer's findings by their peer-validated standing (street-cred rank and adjudication pattern)
- Distinguishes findings the bench broadly endorsed from contested or singleton claims
- Arrives at an overall assessment of the artifact

Save the chair's output to the run folder as `verdict.md`.

---

### Stage 4 — Tiered decisions (peer-validated)

All findings from the bundle are sorted into tiers based on the **peer-confidence tier assigned by `amicus council tally`** (see *Key mechanics → §5.2 Scoring* in COUNCIL-DESIGN.md for the full cascade): **Disputed** (strong peer pushback — `d ≥ 2` and `d > a`), **Confirmed** (≥ 2 peer agreements, agrees dominate), **Contested** (at least one live dispute), **Singleton** (at most one endorsement, no pushback). `confidence: thin` cells `(0,0)/(1,0)/(0,1)` are override-eligible (Claude records any override in `tierOverride`). Present the tiers in this order: Confirmed first (bulk decision), then Disputed and Contested and Singleton individually in the judgment tier.

**Scale-down:** In a 1-model run, Stage 2 was skipped — there is no peer-confidence data, so present every finding individually for decision (no tiers). In a 2-model run, the Confirmed tier rests on thin cross-review (one ranker per review, per Stage 0) — say so when presenting it.

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

**Run-folder artifacts — always write these** regardless of source type. The full artifact set and naming conventions are defined in the *Output & naming* section of this skill; write every artifact specified there. The canonical run-folder files are:
- `review-<model>.md` × N (already saved in Stage 1)
- `crossreview-matrix.md` — the de-anonymized adjudication grid and street-cred table
- `verdict.md` (already saved in Stage 3)
- `verdict.json` — write via `buildVerdict(record, decisions)` (`src/council/verdict.js`): pass the tally `record` from Stage 2 and the Stage-4 decision map (accepted / denied / modified / deferred per finding, plus any `duplicateOf` links Claude identified). This is the schema-stamped machine-readable record of the full run. Write it with an atomic tmp+rename to the run folder.
- `report.md` — the chair's synthesis + the full Stage-4 decision log + a summary of what was
  applied (+ the "How Claude's review fared" readout when "Claude in the council" is on) + a
  **run-stats table**: one row per model call — **stage** (which stage you launched the call for)
  plus **model, status, durationMs, and cost** read from the wave/run JSON `usage`
  block. Cost is `usage.cost.amount` (USD); mark it with its `usage.cost.source`
  — exact for `reported`, `~` for `estimated`, `?` for `unknown` — and never
  invent a figure. Add a wave **total cost** row from the wave document's
  `usage.cost` (`source: reported|estimated|mixed|unknown`). Any leg with no run doc → `durationMs: null`, `usage: null`; never invent a value.
  - **Renderer:** once `verdict.json` is written, generate the human report with
    `amicus council report <run-folder>/verdict.json --md > <run-folder>/report.md`
    (use `--html` for a self-contained, shareable page). This emits the
    adjudication matrix (finding × judge), the peers-only street-cred table, the
    findings-by-tier groupings (Disputed-first), and the per-model + wave cost —
    deterministic data only. Prefer it over hand-assembling the matrix; reserve
    prose for the chair's synthesis and the decision log.

Tell the user exactly which files were written and where.

---

### Stage 6 — Capture lessons (compounding)

This stage updates `MODEL-NOTES.md` to make future runs better. **Nothing is written until the user approves a specific diff.**

**Reflect on this run.** Review the run for:
- Failures, near-misses, and mitigations that worked (poller traps, empty responses, timeout issues, briefing problems)
- Briefing wording that produced **richer or poorer** structured output than expected
- Chair or council model behavior worth noting

Draft new or updated entries for the per-model sections of `MODEL-NOTES.md` that capture what was learned.

**Ledger auto-append (automatic — no approval required).** Running `amicus council tally` (the Stage-2 finalize call) appends one row per (run × model) to the append-only `council-ledger.jsonl` under `getConfigDir()` — no separate step is needed. Pass `--no-ledger` to compute a tally record *without* recording it (e.g. a re-tally that shouldn't double-count). The run summary shows the appended row. This is a deterministic, content-free model-level record (no finding text, no claim strings, no artifact body content). The quantitative reviewer-reliability data in `MODEL-NOTES.md` is now sourced entirely from `amicus council stats` (which aggregates the ledger) — **do not hand-edit reliability numbers in MODEL-NOTES**.

**Compose the proposed MODEL-NOTES diff.** Combine the run-lessons updates and the reviewer-reliability table updates into a single proposed diff (old → new for every changed section). **Write the full diff to a file in the run folder** — `_tmp-proposed-model-notes-update.md` — so the user can open and review it before deciding. Presenting the diff as chat text alone is **not sufficient**: an approval dialog can hide the chat transcript, so the user may be asked to decide on a diff they never saw.

**Wait for explicit approval before writing anything.** Ask, with the diff file's path inside the approval prompt itself:

> Proposed MODEL-NOTES update written to `<run-folder>/_tmp-proposed-model-notes-update.md` — open it to review. Approve this MODEL-NOTES update? (yes / no / edit)

If the user approves, write the changes. If they say "edit", incorporate their corrections, rewrite the diff file, and re-present its path for approval before writing. Do not write any partial update — write only after the full diff is approved.

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

`amicus council tally` computes the two scoring signals from the assembled tally input. Claude's role is to assemble the input (Stage-2 assembly recipe in Stage 2 above) and to exercise judgment on `thin`-confidence overrides.

**Street-cred** — computed two ways:
- **withSelf** = each model's mean rank position across **all** judges' `FINAL RANKING:` blocks (lower is better).
- **peersOnly** = mean rank excluding the model's own ranking of itself.

Both are surfaced in `crossreview-matrix.md` and `report.md`. The ledger and Stage-0 bench recommendations use **peersOnly** only.

**Per-finding peer-confidence tier** — assigned by the peers-only cascade in `amicus council tally` (see COUNCIL-DESIGN.md §5.2 for the full table): **Disputed** → **Confirmed** → **Contested** → **Singleton**. The raiser's own adjudication is excluded from the cascade. `confidence: thin` when total engaged peers `a + d ≤ 1` — cells `(0,0)`, `(1,0)`, `(0,1)`. **Claude may override a `thin` tier at the margins** before presenting Stage 4 — the override is recorded in `tierOverride: {from, to, reason}` and surfaced in the matrix and `verdict.json`.

---

### §5.3 Chair selection & fallback

The default is for Claude to **recommend a non-Claude chair** from the council — typically the model with the strongest reasoning capability or the best peers-only street-cred from `amicus council stats` — and the user confirms this recommendation before the run launches (Stage 0). The chair **may** be a council member who already participated in Stages 1 and 2; it receives the full de-anonymized picture (all reviews with model attribution, all rankings, all adjudications) so it can synthesize from a complete view.

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
- Claude's street-cred rank among peers (its `peersOnly` average rank position in the judges' `FINAL RANKING:` blocks — `withSelf == peersOnly` for Claude since it never casts rankings).
- The Disputed / Confirmed / Contested / Singleton split of Claude's findings — how many of its claims the bench pushed back on, endorsed, disputed, or ignored.

**Integrity.** When Claude presents results — including the bench's assessment of its own review — it reports the verdict at face value. Claude does not defend, contextualize away, or re-litigate findings the bench disputed or ranked poorly. The point of the toggle is an honest external read on Claude's review; undermining that defeats the purpose.

---

## Model-recommendation heuristics

Use these together with `amicus council stats` (the ledger — authoritative quantitative reliability data: runs, avg peers-only street-cred, confirm-rate, fact-error rate) and the qualitative quirks in `MODEL-NOTES.md`:

- **Large or long material, broad coverage sweep** → favor a large-context model (e.g., Gemini) that won't truncate or degrade on the full source.
- **Reasoning-heavy critique, structured argument evaluation, citations** → favor a strong reasoner (e.g., DeepSeek, GPT, Opus) that will interrogate claims rather than accept them.
- **Code review** → favor a code-strong model (e.g., DeepSeek, GPT, Opus); general-purpose models often miss implementation-level issues.
- **Independence matters** → pick models from **different families**; two models from the same family produce correlated opinions and reduce the value of the cross-review.
- **Contrarian / red-team value** → when material is persuasive, consensus-prone, or high-stakes, assign one model an explicit red-team brief: argue against the others, hunt for what they will miss. This is especially valuable when the default council is likely to agree.
- **Consult `amicus council stats`** — a model's historical confirm-rate and avg peers-only street-cred (from the ledger) are the best predictors of council value for a given run type.

Always **rank recommendations by fit**, state the trade-off for each option, and surface the estimated cost (an estimate, not a guarantee; unpriced legs disclosed as "cost unknown"). Never present a single option without explanation.

---

## Output & naming

- Run folder: `output/<stem>-council/` (or `./second-opinion/<stem>-council/` if no `output/` exists), containing:
  - `review-<model>.md` ×N — raw Stage 1 reviews (plus `review-claude.md` when "Claude in the council" is on)
  - `crossreview-matrix.md` — adjudication grid + de-anonymized street-cred table
  - `verdict.md` — the chair's synthesis (prose)
  - `verdict.json` — schema-stamped machine-readable record: tally output + Stage-4 decisions, written via `buildVerdict(record, decisions)` at Stage 5
  - `report.md` — synthesis + decision log + what was applied (+ the "How Claude's review fared" readout when the toggle is on) + a
    **run-stats table**: one row per model call — **stage** (which stage you launched the call for) plus **model, status, durationMs, and cost** read from the wave/run JSON `usage`
    block. Cost is `usage.cost.amount` (USD); mark it with its `usage.cost.source`
    — exact for `reported`, `~` for `estimated`, `?` for `unknown` — and never
    invent a figure. Add a wave **total cost** row from the wave document's
    `usage.cost` (`source: reported|estimated|mixed|unknown`). Any leg with no run doc → `durationMs: null`, `usage: null`.
- Reviewed copy: `<stem>-reviewed.<ext>`, next to the source.
- Temp working files (`_tmp-*.md`: extracts, stage briefings, red-team brief, bundle, chair packet, proposed
  MODEL-NOTES diff) live in the run folder and are cleaned up at the end of the run — the proposed-diff file
  only after the Stage-6 approval decision is resolved.

---

## Files

- `MODEL-NOTES.md` — operating rules, per-model qualitative quirks, cost guardrail, and structural-conformance notes. **Read it before Stage 0 (council selection and launch); update qualitative notes (with approval) in Stage 6.** Quantitative reliability data (runs, avg street-cred, confirm-rate, fact-error rate) comes from `amicus council stats`, not this file.
- `COUNCIL-DESIGN.md` — the design spec this skill implements (v3 + WS-3). Consult it if a mechanics question arises that the skill prose does not resolve.
