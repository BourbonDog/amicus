# Second Opinion v3 — "LLM Council" Design

_Status: implemented (v3). v2 (2026-06-03) added the council mechanics; v3 (2026-06-10) swapped the
transport onto the Amicus fanout/JSON engine primitives. v2 history lives in git
(`V2-COUNCIL-DESIGN.md`, deleted at v3)._
_Design for `SKILL.md` and `MODEL-NOTES.md` of the `second-opinion` skill._

## 1. Intent

Upgrade `second-opinion` by porting the best mechanics of the **LLM Council** web-app
pattern — peer cross-review, anonymized
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
- **This is an executed skill, not an app.** All council logic (anonymize → rank → aggregate →
  chair) is prose workflow Claude performs while driving the `amicus` CLI. v3 note: the *transport*
  is now engine-native — each review wave is ONE `amicus fanout --json` call returning structured
  run documents — but scoring, tallying, anonymization, and synthesis remain Claude's manual work.
  No backend, no parsing code beyond reading JSON fields. Deterministic arithmetic/formatting/schema helpers under `amicus council` (findings validation, tier tally, street-cred, ledger) are sanctioned; judgment, synthesis, anonymization, and de-anonymization remain Claude's inline work.

## 3. What changes vs. v1

| Area | v1 | v3 (this design) |
|---|---|---|
| Independent reviews | ✅ Phase 2 parallel sidecars | ✅ Stage 1 — now emits a **structured findings list** |
| Cross-review | ❌ none | ⭐ **Stage 2** — anonymized peer ranking **+** per-finding adjudication |
| Synthesis | Claude synthesizes | ⭐ **Council-model chair** synthesizes; Claude only presents |
| Decision tiers | Claude's consensus/divergence read | ⭐ **Peer-validated** tiers (Disputed / Confirmed / Contested / Singleton) |
| Scoring | none | ⭐ Reviewer **street-cred** + per-finding **peer-confidence** |
| Artifacts | reviewed copy + report | + per-model raw reviews, cross-review matrix, chair verdict (run folder) |
| MODEL-NOTES | per-model quirks | + **reviewer-reliability** rolling table feeding recommendations |
| Transport (v3) | N parallel `start` calls + prose-scraping | ⭐ one `fanout --json` wave per stage; briefings via `--prompt-file`; JSON status/summary parsing |

Preserved unchanged: intake/criteria intake, the MODEL-NOTES operating rules, reviewed-copy vs
standalone-report logic, cost guardrail, and the Stage 6 approval-gated MODEL-NOTES update.

## 4. The council flow

Run as ordered phases; track as todos. **Three sequential waves of model calls** (Stage 1 →
2 → 3 each depend on the prior); within each wave, models run in parallel.

### Stage 0 — Intake & prep
- Confirm **source material**, **the analysis**, **the criteria** (ask only for what's missing).
- Prepare material for council models per MODEL-NOTES (extract clean text from links / large /
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
- All council models review **your artifact** via ONE fanout wave (see SKILL.md Stage 1 for the
  canonical command). The wave JSON returns every leg's status + review in one parse. A red-team
  reviewer with a distinct brief runs as a separate concurrent `amicus start --json` call alongside the wave (fanout legs share
  one prompt by design).
- Required structured output: a **findings list**, each finding = `id · claim · severity
  (blocker/major/minor/nit) · location (section/quote) · rationale`, plus a short overall take.
- Save each raw review to the run folder (§6).
- If **"Claude in the council"** is on, Claude also produces a **fresh** review in the same
  findings format (a new structured pass on the artifact, regardless of any upstream feedback)
  and adds it to the bundle as one more review (§5.4).

### Stage 2 — Cross-review (the headline)
- Claude builds **one shared anonymized bundle**: all Stage 1 reviews relabeled **Review A/B/C…**,
  with a private label↔model map Claude keeps (§5.1).
- The **same bundle** goes to **every** council model — exactly fanout's shared-prompt model: one
  wave call distributes it, and each judge is asked to do two things on the bundle:
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
- **Consensus tier** = **Confirmed** findings (≥ 2 peer agreements, agrees dominate) → offer one **bulk accept/deny** (user may name exceptions).
- **Judgment tier** = **Disputed** (strong peer pushback), **Contested** (live dispute), or **Singleton** (only the raiser) → present **each individually**, showing the adjudication data and which model raised/disputed it.
- Record every decision (accepted / denied / modified / deferred).

### Stage 5 — Outputs
- **Editable source** → write `<stem>-reviewed.<ext>` next to the original (accepted changes
  only; validate structural integrity). **Fixed source** → standalone reviewed report.
- Always write the run folder artifacts (§6).

### Stage 6 — Capture lessons (compounding)
- Reflect on failures/mitigations and briefing wording, as today.
- **Ledger auto-appends** — `ledger.appendRun(record)` writes one row per (run × model) to `council-ledger.jsonl` automatically at finalize (shown in the run summary). No manual reliability-table update needed.
- **Qualitative MODEL-NOTES update (approval-gated):** draft per-model quirk/conformance notes; write the proposed diff to `_tmp-proposed-model-notes-update.md`; present its path in the approval prompt; do not write until approved.
  The approval prompt carries the diff file's path; chat text alone is not sufficient (an approval
  dialog can hide the chat transcript). Keep it tight.

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

### 5.2 Scoring (`amicus council tally` computes; Claude may override at the margins)

**Street cred** — computed two ways by `amicus council tally`:
- **withSelf** = each model's mean rank position across **all** judges' `FINAL RANKING:` blocks (lower = better).
- **peersOnly** = mean rank across judges **other than** that model (self-vote excluded).
The cross-review matrix shows both; the ledger and Stage-0 bench recommendations consume **peersOnly** only.

**Per-finding peer-confidence tier** — determined by a **peers-only** cascade: for a finding raised by model R, peers are all judges except R (the raiser's own adjudication is excluded — consistent with the peers-only street-cred rule). Let `a` = peer agrees, `d` = peer disputes. The cascade is exhaustive and mutually exclusive:

| Priority | Tier | Rule | Meaning |
|---|---|---|---|
| 1 | **Disputed** | `d ≥ 2` and `d > a` | Strong peer pushback — the finding itself is likely wrong |
| 2 | **Confirmed** | `a ≥ 2` and `a > d` | ≥ 2 independent corroborations, agrees dominate |
| 3 | **Contested** | `d ≥ 1` (whatever remains) | At least one live dispute — in question |
| 4 | **Singleton** | else (`d = 0` and `a < 2`) | At most one endorsement, no pushback — thin |

`confidence` is `thin` when total engaged peers `a + d ≤ 1` — cells `(0,0)`, `(1,0)`, and `(0,1)`. **Claude may override the tier at `thin` margins** (recorded as `tierOverride: {from, to, reason}` and surfaced in the matrix and `verdict.json`). These four tiers drive Stage 4. `amicus council tally` assigns them deterministically; judgment at the margins remains Claude's.

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
  Disputed/Confirmed/Contested/Singleton split of its findings, reported in the matrix and report.
- **Integrity:** when Claude presents results, it reports the bench's verdict on its own review
  at face value — no defending or re-litigating.

## 6. Outputs & naming
One tidy run folder: `output/<stem>-council/` (or `./second-opinion/<stem>-council/` if no
`output/` exists):
- `review-<model>.md` ×N — raw Stage 1 reviews (plus `review-claude.md` when "Claude in the
  council" is on)
- `crossreview-matrix.md` — adjudication grid + street-cred table (de-anonymized)
- `verdict.md` — the chair's synthesis (prose)
- `verdict.json` — schema-stamped machine-readable record: tally output + Stage-4 decisions, written via `buildVerdict(record, decisions)` at Stage 5
- `report.md` — synthesis + decision log + what was applied (+ the "How Claude's review fared"
  readout when "Claude in the council" is on)
- `<stem>-reviewed.<ext>` — written **next to the original**, as today (editable sources only)
- Temp extracts get a clearly-temporary name and are cleaned up at the end.

## 7. MODEL-NOTES reviewer-reliability

The append-only `council-ledger.jsonl` (consumed via `amicus council stats`) is the **authoritative source of quantitative reviewer-reliability data** — runs, avg peers-only street-cred, confirm-rate, fact-error rate, conformance distribution. `MODEL-NOTES.md` keeps only *qualitative* per-model quirks and structural-conformance notes (`clean` / `repaired` / `unstructured`); it may embed a snapshot generated from `amicus council stats --json` but is no longer hand-edited for numbers. Stage-6 reliability updates are written by the ledger auto-append; the MODEL-NOTES prose update remains approval-gated.

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
  - **Stage 3:** chair failure uses the same fallback chain (re-run → promote next-best non-Claude
    → Claude chairs with explicit disclosure).
- **Run stats (v3):** `report.md` includes a per-leg table (model, status, durationMs) read from
  the wave/run documents. `durationMs` and `usage` are copied verbatim from the per-leg run docs; any leg with no run doc gets `durationMs: null` (and `usage: null`) — never invent a value. The schema carries no cost data — never invent cost figures.
- **Transient failures:** provider 502s etc. → re-run the affected leg (solo `start --json`) or
  the wave; never present a half-finished run as an answer.

## 9. Non-goals (YAGNI)
- No web UI, API server, or persistent conversation store (LLM Council's app shell).
- No code/backend for scoring or parsing — Claude does it inline. Deterministic arithmetic/formatting/schema helpers under `amicus council` (findings validation, tier tally, street-cred, ledger) are sanctioned; judgment, synthesis, anonymization, and de-anonymization remain Claude's inline work.
- No automatic MODEL-NOTES writes — always approval-gated.
- Claude is **not** a council member by default; it joins only via the opt-in toggle (§5.4),
  and even then it is judged-but-non-voting/non-chairing.

## 10. Open questions
- None blocking. Possible later refinement: a numeric peer-confidence score instead of the
  four qualitative tiers, if tiers prove too coarse in practice.

## 11. Implementation surface
- `SKILL.md` — the Stage 0–6 council flow on the v3 transport (WS-3: findings contract, tally assembly recipe, `amicus council tally/stats`, `verdict.json`, ledger auto-append).
- `MODEL-NOTES.md` — qualitative per-model quirks, structural-conformance notes, cost guardrail, Stage-2 briefing tips. Quantitative reliability data now generated by `amicus council stats` (ledger). Engine workarounds that F1/F2/F4 made obsolete were pruned at v3.
- `src/council/` — the deterministic helpers (`findings.js`, `tally.js`, `verdict.js`, `ledger.js`). No other files.
