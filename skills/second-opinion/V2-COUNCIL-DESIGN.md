# Second Opinion v2 — "LLM Council" Design

_Status: approved design, pre-implementation. Date: 2026-06-03._
_Designs a rewrite of `SKILL.md` (and additions to `MODEL-NOTES.md`) for the `second-opinion` skill._

## 1. Intent

Upgrade `second-opinion` by porting the best mechanics of the **LLM Council** web app
(`C:\Users\sendt\OneDrive\AIProjects\GitHub\llm-council`) — peer cross-review, anonymized
ranking, aggregate scoring, and a designated chairman — into the skill, while keeping its
existing strengths (model recommendation, sidecar orchestration, tiered accept/deny,
reviewed-copy output, and the MODEL-NOTES self-improvement loop).

This is the **"full port" (option C)**: cross-review + anonymization + aggregate scoring +
non-Claude chairman + per-model inspectable artifacts.

## 2. Core framing & principles

- **Second-opinion is a *secondary* review tool.** By the time it runs, **Claude has already
  given its opinion** in the main conversation. The skill exists to bring in *independent
  outside* views.
- **The council is the *non-Claude* bench by default.** Council members are models from
  families other than the orchestrator (Gemini, DeepSeek, GPT, etc.). Claude is **not** a
  first-opinion council member unless the optional "Claude in the council" toggle is on (§5.4)
  — and even then it is judged but does not vote or chair.
- **Claude's role shrinks to orchestrator:** prep material, recommend the council, anonymize,
  drive the stages, score, present accept/deny, write files. **Claude does not synthesize the
  verdict** — a council model chairs that (§5.3).
- **Subject of review.** The novel cross-review step has models critique **each other's
  reviews of your artifact** — *not* re-review the artifact. (LLM Council ranks the models'
  own answers; here the "answers" are the reviews.)
- **This is an executed skill, not an app.** All of LLM Council's `council.py` logic
  (anonymize → rank → aggregate → chair) becomes **prose workflow Claude performs by hand**
  while driving the `sidecar` CLI. No backend, no parsing code, no API server. Claude relabels
  reviews in the briefings it writes, tallies rankings in its head/notes, and reads structured
  model output directly.

## 3. What changes vs. v1

| Area | v1 (today) | v2 (this design) |
|---|---|---|
| Independent reviews | ✅ Phase 2 parallel sidecars | ✅ Stage 1 — now emits a **structured findings list** |
| Cross-review | ❌ none | ⭐ **Stage 2** — anonymized peer ranking **+** per-finding adjudication |
| Synthesis | Claude synthesizes | ⭐ **Council-model chair** synthesizes; Claude only presents |
| Decision tiers | Claude's consensus/divergence read | ⭐ **Peer-validated** tiers (Confirmed / Contested / Singleton) |
| Scoring | none | ⭐ Reviewer **street-cred** + per-finding **peer-confidence** |
| Artifacts | reviewed copy + report | + per-model raw reviews, cross-review matrix, chair verdict (run folder) |
| MODEL-NOTES | per-model quirks | + **reviewer-reliability** rolling table feeding recommendations |

Preserved unchanged: intake/criteria intake, sidecar operating rules, reviewed-copy vs
standalone-report logic, cost guardrail, and the Phase 6 approval-gated MODEL-NOTES update.

## 4. The council flow

Run as ordered phases; track as todos. **Three sequential waves of model calls** (Stage 1 →
2 → 3 each depend on the prior); within each wave, models run in parallel.

### Stage 0 — Intake & prep
- Confirm **source material**, **the analysis**, **the criteria** (ask only for what's missing).
- Prepare material for sidecar models per MODEL-NOTES (extract clean text from links / large /
  marked-up sources to a small temp file; small text used as-is).
- Pick the council: **non-Claude models, default 3 from different families** (enough voices for
  a real cross-review + a tie-breaker). Recommend ranked-by-fit (consult MODEL-NOTES
  reviewer-reliability), state cost, **disclose run shape up front** — "~2N+1 calls across 3
  waves, ~X min" — and **wait for confirmation**. Honor the cost guardrail.
- **Scale-down is explicit:** 1 model = thorough single pass (skip Stage 2 & chair); 2 = cross-
  review works but ranking is thin; 3 = default deep council.
- **Optional — "Claude in the council" (default off):** offer to add Claude as a *judged*
  contributor so the bench's verdict on Claude's own take is visible. When on, Claude adds one
  Stage-1 review to the bundle but does **not** judge (Stage 2) or chair (Stage 3). See §5.4.

### Stage 1 — Independent reviews
- Each council model reviews **your artifact** in parallel (background sidecars, MODEL-NOTES
  launch rules).
- Required structured output: a **findings list**, each finding = `id · claim · severity
  (blocker/major/minor/nit) · location (section/quote) · rationale`, plus a short overall take.
- Save each raw review to the run folder (§6).
- If **"Claude in the council"** is on, Claude also produces a **fresh** review in the same
  findings format (a new structured pass on the artifact, regardless of any upstream feedback)
  and adds it to the bundle as one more review (§5.4).

### Stage 2 — Cross-review (the headline)
- Claude builds **one shared anonymized bundle**: all Stage 1 reviews relabeled **Review A/B/C…**,
  with a private label↔model map Claude keeps (§5.1).
- The **same bundle** goes to **every** council model, each asked to do two things on the bundle:
  1. **Rank** the reviews by accuracy + insight, ending with a parseable block:
     `FINAL RANKING:` then `1. Review C` / `2. Review A` … (LLM Council's format).
  2. **Adjudicate findings** — for each finding in the bundle: `agree | dispute | neutral` +
     one-line reason (an "I missed this, it's valid" counts as agree). Findings are referenced
     by **review label + finding id** (e.g. `A2` = Review A's 2nd finding) so Claude can map
     each verdict back to the originating model and claim when tallying.
- Each model **unknowingly ranks/adjudicates its own review too** — this is the anti-favoritism
  mechanism, not a bug (§5.1).
- Claude de-anonymizes for scoring/display only.

### Stage 3 — Council-chair synthesis
- A designated **non-Claude** chair (recommended + confirmed in Stage 0/launch) receives all
  reviews + rankings + adjudications and writes the **synthesized verdict**, weighted by
  street-cred and peer-confidence. Independent of Claude.
- Chair selection & fallback: §5.3.

### Stage 4 — Tiered decisions (peer-validated)
- **Consensus tier** = **Confirmed** findings (peers agree) → offer one **bulk accept/deny**
  (user may name exceptions).
- **Judgment tier** = **Contested** (peers dispute/split) or **Singleton** (only the raiser)
  findings → present **each individually**, showing the dissent and which model raised/disputed it.
- Record every decision (accepted / denied / modified).

### Stage 5 — Outputs
- **Editable source** → write `<stem>-reviewed.<ext>` next to the original (accepted changes
  only; validate structural integrity). **Fixed source** → standalone reviewed report.
- Always write the run folder artifacts (§6).

### Stage 6 — Capture lessons (compounding)
- Reflect on failures/mitigations and briefing wording, as today.
- **Additionally** update the per-model **reviewer-reliability** table (§7).
- **Show the proposed MODEL-NOTES diff and get approval before writing.** Keep it tight.

## 5. Key mechanics

### 5.1 Anonymization (shared bundle)
- After Stage 1, Claude assembles **one** bundle with stable labels Review A/B/C… and keeps a
  private map (e.g., `Review A → deepseek`, `Review B → gemini`, …).
- The identical bundle is sent to every judge. Because a model can't tell which review is its
  own, it ranks/adjudicates all of them honestly; symmetric self-bias washes out across judges.
- Claude only de-anonymizes when computing scores and writing the matrix/report for the user.
- When "Claude in the council" is on, Claude's own review is anonymized into the **same** bundle
  and judged blind by the council models. Claude never ranks/adjudicates (it holds the map) —
  the asymmetry detailed in §5.4.

### 5.2 Scoring (Claude tallies by hand — no code required)
- **Street cred** = each model's **average rank position** across all judges' `FINAL RANKING:`
  blocks (lower = better), exactly as LLM Council's aggregate. Surface as a small table.
- **Per-finding peer-confidence** = qualitative tier from the adjudications:
  - **Confirmed** — agrees clearly outweigh disputes (and ≥2 judges engaged).
  - **Contested** — meaningful split or explicit disputes.
  - **Singleton** — only the original raiser; others neutral/silent.
  These tiers drive Stage 4. Claude exercises judgment at the margins; no rigid formula.

### 5.3 Chair selection & fallback
- Default: Claude **recommends a non-Claude chair** from the council each run (often the
  strongest reasoner / best reviewer-reliability) and the user confirms at launch.
- The chair **may** also be a Stage-1 council member (it sees the anonymized bundle + scores).
- **Fallback order if the chair fails:** re-run → promote next-best council model →
  **Claude chairs only as last resort, with explicit disclosure** that the verdict is no longer
  fully independent.

### 5.4 Claude in the council (optional, default off)
Lets you see how the bench judges Claude's *own* take.
- **Asymmetric by necessity.** Claude is the orchestrator and holds the label↔model map, so it
  cannot judge blind. Therefore Claude **contributes a review to be judged but does not vote
  (Stage 2) or chair (Stage 3).** The verdict stays independent.
- **Which review: always fresh** — Claude does a new structured Stage-1 review on the artifact
  every time it's enabled (not a formalization of upstream feedback).
- **Readout — "How Claude's review fared":** Claude's street-cred rank among peers and the
  Confirmed/Contested/Singleton split of its findings, reported in the matrix and report.
- **Integrity:** when Claude presents results, it reports the bench's verdict on its own review
  at face value — no defending or re-litigating.

## 6. Outputs & naming
One tidy run folder: `output/<stem>-council/` (or `./second-opinion/<stem>-council/` if no
`output/` exists):
- `review-<model>.md` ×N — raw Stage 1 reviews (plus `review-claude.md` when "Claude in the
  council" is on)
- `crossreview-matrix.md` — adjudication grid + street-cred table (de-anonymized)
- `verdict.md` — the chair's synthesis
- `report.md` — synthesis + decision log + what was applied (+ the "How Claude's review fared"
  readout when "Claude in the council" is on)
- `<stem>-reviewed.<ext>` — written **next to the original**, as today (editable sources only)
- Temp extracts get a clearly-temporary name and are cleaned up at the end.

## 7. MODEL-NOTES reviewer-reliability
Add a compact rolling table consulted in Stage 0 and updated (with approval) in Stage 6:

| model | runs | avg street-cred | confirm-rate | notes |
|---|---|---|---|---|

- **avg street-cred** — running average rank when peer-ranked.
- **confirm-rate** — share of this model's findings that ended up **Confirmed** by peers.
- Used to justify recommendations ("DeepSeek findings peer-confirm ~80% → strong default
  reviewer"). Kept tight per the existing no-bloat rule; merge/prune rather than append.

## 8. Gating, cost, degradation & failure handling
- **Gating:** council is the default identity but scales down (§ Stage 0). Always disclose run
  shape/cost and confirm before launching.
- **Cost guardrail (unchanged):** never `o3`/`o3-pro` unless the user asks by name; warn on cost.
- **Degradation:** gating counts **non-Claude judges**. 1 judge → single-pass (no Stage 2/chair);
  if the bench drops below 2 mid-run, degrade to single-pass. 2 judges → Stage 2 runs but note
  the thin ranking. ("Claude in the council" adds a *judged* review but **no** judge, so it
  doesn't change these thresholds.)
- **Failures:** poller-trap / transient 502 → existing re-run mitigations (MODEL-NOTES). Never
  present a half-finished or empty run as an answer.

## 9. Non-goals (YAGNI)
- No web UI, API server, or persistent conversation store (LLM Council's app shell).
- No code/backend for scoring or parsing — Claude does it inline.
- No automatic MODEL-NOTES writes — always approval-gated.
- Claude is **not** a council member by default; it joins only via the opt-in toggle (§5.4),
  and even then it is judged-but-non-voting/non-chairing.

## 10. Open questions
- None blocking. Possible later refinement: a numeric peer-confidence score instead of the
  three qualitative tiers, if tiers prove too coarse in practice.

## 11. Implementation surface
- **Rewrite** `SKILL.md`: replace the 6-phase workflow with the Stage 0–6 council flow above;
  update the front-matter `description` to mention peer cross-review / council / chair while
  preserving existing trigger phrases.
- **Extend** `MODEL-NOTES.md`: add the reviewer-reliability table (§7) and any new Stage-2
  briefing tips; keep the headless-poller and per-model sections.
- No other files.
