# MODEL-NOTES — Operating Lessons for Amicus Models

This file is the `second-opinion` skill's evolving memory of **how to actually drive each model
well**. Read it before Stage 0 (council selection and launch); update it, with the user's
approval, at the end of each run (Stage 6). Keep it tight — merge and prune rather than append.

_Last updated: 2026-07-14 (v2.2.0 fold-back: v3.1 optional council elements verified live;
claim-class dedup adjudication limit; minimax and qwen-coder debut notes; see changelog)._

## Global operating rules (all models)
- **Fast path:** `council run` applies `--agent Plan` / `--no-context` / `--summary-length
  verbose` and the no-tools preambles automatically; the flag rules below govern the manual path
  and sidecar solos.
- **Council runs are headless by design** (autonomous batch work): `fanout` is headless by
  definition; solo runs use `--no-ui`. Interactive GUI sessions are for the `sidecar` chat skill,
  not councils.
- **`--agent Plan`** for review/analysis — read-only, so a model can't accidentally edit the source.
- **`--no-context`** always — council briefings are self-contained; don't drag the host
  conversation in.
- **`--summary-length verbose`** — the analysis IS the deliverable; don't let it get summarized away.
- **Briefings via `--prompt-file`** (temp `_tmp-*.md` files in the run folder — `output/<stem>-council/`,
  defined in SKILL.md Stage 0) — no size cap, no shell-quoting hazards. Never inline a briefing as
  a CLI argument.
- **Run in the background (`run_in_background: true`); you're notified on completion. Don't poll.**
- **Read results from the JSON documents** (`--json`): a wave's `legs[].summary` / a run's
  `summary` is the model's output; `status`/`error`/`counts` are ground truth for failures. Never
  scrape stderr logs to judge success.
- **Transient provider errors** (502s, connection drops): re-run the affected leg (solo
  `amicus start --json`, same briefing file) or the wave — see per-model notes for
  model-specific signals. Never present a half-finished run as an answer.
- **Credentials:** keys live in `~/.config/amicus/.env`. The legacy `~/.config/sidecar/.env`
  fallback was removed in v2.0.0 (see `docs/SHIMS.md`). Configure with `amicus setup`.
- **PowerShell `--models` quoting (Windows):** always quote comma-separated model lists —
  `--models "gemini,gpt,deepseek"`. Unquoted, PowerShell splits on commas and amicus receives one
  mangled alias → instant arg-parse failure. (Now baked into every SKILL.md example.)
- **Inject the current date into briefings for time-sensitive artifacts** (resumes, dated plans).
  Headless models don't reliably know "today": one run produced a false "future-dated" blocker two
  judges then confirmed. (Now a Stage-0 rule in SKILL.md.)
- **Very long artifacts (80k+ words) break the agent-reads-the-file transport for some models.**
  gpt/deepseek/grok have handled 82k-word agentic reads; gemini(-flash) and kimi stalled (narrate-
  stall / 25-min timeout / poller "Incomplete"). Pre-select proven long-read models or inline the
  text for large-context models.
- **Debate mode rarely fires on correctness questions — design for it or expect a no-op.**
  `--debate` only engages findings the tally marked Contested or Disputed, and judges agree far
  more than expected: **2 disputes in 123 adjudications across four councils** (gemini/gpt/qwen).
  Three of those four runs produced zero debatable findings, so the round never ran. Bug hunts
  converge — a race condition either exists or it does not. If you want a rebuttal round, brief a
  genuine judgement call (architecture, tradeoffs, "is this over-engineered"), not a defect hunt.
- **Read spend from `run.json`, never from a provider credit balance.** `usage.cost.amount` is the
  run total; per-leg costs are in `runStats[].usage.cost`. Only OpenRouter-routed legs move the
  OpenRouter balance — gemini/gpt/anthropic bill directly against their own keys, so inferring cost
  from that balance under-reports it badly (observed: ~6x low). A 3-model bench + chair + debate is
  roughly **$0.60-0.80 per run**, not cents; budget `--max-cost` accordingly or the chair gets
  skipped mid-run (exit 2, degraded) when the debate legs push the total past the ceiling.
- **Expect agreement inflation in Stage-2 adjudication.** The judge contract defines `agree` by
  worked example ("an 'I missed this — it's valid' counts as agree") but gives no example for
  `dispute` and no positive definition of `neutral`, while requiring a verdict on EVERY finding —
  including ones outside a judge's focus. A council reviewing this contract flagged the asymmetry
  unanimously. Weigh a lone `Confirmed` tier accordingly, and prefer `Contested` evidence over
  vote counts when a finding matters.
- **Stage-6 approvals:** write the proposed MODEL-NOTES diff to a run-folder file and put that path
  in the approval prompt — chat-text diffs can be hidden behind the approval dialog.

## Stage-2 cross-review briefing tips

- **Send the same anonymized bundle to every judge** — stable labels Review A/B/C…, no model
  names — so rankings are directly comparable (one fanout wave distributes it).
- **Require a `FINAL RANKING:` block** at the end of the response (e.g. `1. Review C / 2. Review
  A …`), plus a per-finding `agree | dispute | neutral` verdict with a one-line reason for each
  finding referenced by run-global label id (e.g. `A2` = Review A's 2nd finding).
- After de-anonymizing, assemble the tally input (see SKILL.md Stage 2 assembly recipe) and run
  `amicus council tally <input.json> --json` — do not hand-tally tiers or street-cred numbers.
- Telling judges that **material severity inflation can justify a `dispute`** sharpens adjudications.
- **Plan-agent judges can wander to tools** (reading run-folder files = anonymization leak). The
  no-tools preamble is now mandatory in SKILL.md Stage 2/3 — keep it verbatim.
- The tally input needs **all five keys** (`meta` incl. `meta.models`, `findings`, `adjudications`,
  `rankings`, `runStats`) — see the SKILL.md Stage-2 recipe step 0.
- **Claim-class dedup glosses rationale errors.** When several reviews raise the same claim, judges
  adjudicate the class ("same as A3 — agree") and skip verifying each finding's own rationale text:
  a direction-inverted arithmetic detail inside an otherwise-correct finding drew unanimous agrees
  despite an explicit "dispute material factual errors in the rationale" instruction. If
  rationale-level precision matters, instruct judges to independently verify the numbers in each
  finding; otherwise expect class-level adjudication and let the chair reconcile details (a chair
  has caught and corrected such an error unprompted).
- **Optional council elements (v2.2.0) verified live:** critic seat (solo-alongside-fanout;
  `role: "critic"` passes through `council tally` untouched), debate mode's nothing-to-debate path
  (provisional `--no-ledger` tally → skip rebuttals → final ledger-recorded tally), and the chair
  verdict scale (parseable `VERDICT:` line + hard questions) all behaved per SEAT-BRIEFS. **Debate
  mode's defense/re-vote waves remain unexercised** — an all-Confirmed consensus run has no
  rebuttal surface; exercise them on a contentious artifact before trusting that path blind.

## Per-model notes

### Gemini  (`--model gemini`)
- **Strengths:** fast, very large context. Good for broad sweeps and long documents.
- **Quirk:** tends to narrate intentions and pad with preamble; instruct it to emit the
  structured output verbatim, without preamble. (Historical: its narrate-then-glob habit used to
  trip the old headless poller; the engine handles tool-call gaps now — F1.)
- Don't trust its self-reported version string ("I am gemini-X") as ground truth.
- **Red-team:** takes an adversarial brief well — high variance by design; use when consensus risk is high.
- **Blind self-votes are inconsistent** (self-#1 in some runs, self-last in others) → discount self-votes either way.
- Alias has resolved to **flash** tiers: fast, shallowest coverage, yet a recurring sharp fact/consistency checker (it alone refuted a bench-wide date error). Cheap cross-check value.
- **Unreliable on long agentic reads** (see global rule) — inline the text or swap models for book-length material.

### DeepSeek  (`--model deepseek` → via OpenRouter)
- **Strengths:** resilient; produces strong, well-structured, well-cited critical analysis. A good
  default reviewer and a proven chair.
- **Quirk:** occasional transient 502 mid-run → re-run the leg.
- Proven chair (5 clean chairings) — decisive, well-structured synthesis.
- As a Stage-1 reviewer of human-facing documents it **over-escalates severity** (typos/tenure → "blocker"); discount its blocker labels against peers. Prune its self-retractions when tallying.
- **"Agree-with-the-adversary" lean:** it has been the lone endorser of a red-team's harshest claims, turning them Contested — cross-check before treating its lone agreements as consensus.

### GPT  (`--model gpt` → via OpenRouter)
- **Strengths:** reachable via the OpenRouter key; resilient; very thorough structured critique
  (25 findings on a 1-page framework). Cleanly separates the review criteria.
- **Quirks:** verbose — peers dinged it for volume-over-judgment (good coverage, lower
  discrimination); **self-ranked its own review #1** in cross-review → discount self-votes.
- Ranked genuine #1 by all judges (incl. non-self) in one run — thoroughness is real, not a self-vote artifact. Handled an 82k-word agentic read cleanly.
- **Asserts context-dependent facts (dates, "is this future?") without verifying** — and self-confirms them in adjudication. Cross-check any time-dependent claim it raises.
- A good calibration anchor in cross-review: confirms observational findings, disputes interpretive overreach.

### Grok  (`--model grok` → via OpenRouter)
- Very fast legs; credible judge and chair (rejected its own weak findings as chair; honest blind self-rank).
- Strong red-team fit; handled an 82k-word agentic read. Weight its **observational** catches heavily and its **interpretive** verdicts cautiously (bench pattern: the former confirmed, the latter disputed).
- Stage-1 non-red-team reviews skew to scope-inflated "missing content" majors.

### Kimi  (`--model kimi` → via OpenRouter)
- The bench's sharpest adjudicator (caught strawmen and misreads other judges waved through).
- **Very slow legs (5-7 min)** — it gates wave wall-clock; budget timeouts around it.
- Stalls on long agentic reads (poller "Incomplete" with only a preamble). Reserve for short-artifact adjudication.

### Mistral  (`--model mistral` → via OpenRouter)
- Fast, broad coverage, catches real issues.
- **Hallucination risk is real:** has invented non-existent product models/specs, disputed independently by two judges. Cross-check every specific model number or product claim it introduces.

### Claude  (in-council, when toggle on)
- Consistently the most *calibrated* reviewer (no severity inflation; findings overwhelmingly Confirmed; bench-best street-cred in recent runs) but sometimes the least *original* — it can miss the boldest single catch. Treat as a reliability floor, not a discovery engine.

### minimax  (`--model minimax` → via OpenRouter)
- Fast (~2 min review legs), cheap, `clean` findings-JSON conformance on debut.
- Took the **critic seat** brief exceptionally well: unanimously ranked #1 by its bench, full
  coverage on a ground-truth test, zero padded findings under the anti-padding rule. A strong
  default critic-seat candidate.
- **Quirks:** occasional CJK character intrusions mid-English prose (cosmetic; the findings JSON
  is unaffected); can invert the direction of an arithmetic detail inside an otherwise-correct
  rationale — see the claim-class-dedup tip in Stage-2 briefing tips.

### qwen-coder  (`--model qwen-coder` → via OpenRouter; distinct from `qwen`)
- Very fast (16–22 s legs, review and judging alike), `clean` conformance, competent
  core-blocker coverage on prose/PRD artifacts.
- Ranked last on its debut bench — misses the offline, interruption-handling, and
  test-methodology gap classes stronger seats catch. Fine budget-bench filler; do not chair it.

### (others — add as used)
- Opus / o-series etc. are reachable via amicus **if their API keys are configured**. Add notes
  here the first time each is used.

## Reviewer-reliability

Quantitative reliability data (runs, avg peers-only street-cred, confirm-rate, fact-error rate, conformance distribution) is now generated from the append-only `council-ledger.jsonl` via:

```
amicus council stats [--json]
```

**Do not hand-edit reliability numbers here.** The ledger is the authoritative source; `amicus council stats` aggregates it and flags low-N models (`runs < 3`). Consult `amicus council stats` in Stage 0 for bench recommendations. In Stage 6 the ledger row is appended automatically — no manual update needed.

This section keeps only per-model **qualitative quirks** and **structural-conformance notes** (`clean` / `repaired` / `unstructured`), which cannot be captured by the ledger:

### Qualitative notes (hand-curated)

- **deepseek** — strong synthesis, resilient; occasional transient 502 → re-run the leg. Proven chair. Conforms cleanly.
- **gpt** — thorough but verbose; peers have dinged it for volume-over-judgment. Self-ranked its own review #1 in the 2026-06-04 run → the peers-only street-cred rule (now enforced by `tally`) mitigates this. Conforms cleanly. Accessible via OpenRouter.
- **gemini** — fast, very large context; tends toward absolute severity labels ("blocker" inflation vs peers). Conforms cleanly; watch for preamble narration — instruct it to emit the JSON block verbatim after the prose.

## Free-tier models (OpenRouter `:free`)
- Heavily rate-limited (shared daily pool); a 3-leg parallel wave + cross-review can 429 mid-run.
- Quality-variable; weaker at strict structured (findings JSON) output.
- Some `:free` models 404 unless the account enables data-sharing at openrouter.ai/settings/privacy.
- No reliability history — chair selection can't use `council stats`; pick the strongest free model and disclose lower confidence.

## Cost guardrail
- The budget gate enforces this in code: a per-$/Mtok threshold (ON by default)
  refuses o3/o3-pro-class models before a wave launches. This replaces the old
  "remember not to" rule — it can no longer be forgotten.
- To run `o3`/`o3-pro` (≈ $10–60+/request) the user must ask by name AND you
  pass `--no-cost-gate` (disables both guards) for that run. Still warn first.
- `--max-cost <$>` raises only the soft total ceiling; it does not unblock an
  over-threshold model.

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
- **2026-07-02** — Folded back field lessons from runs 4-7 (AV-receiver, pork-shoulder, resume, novel ×2 councils): PowerShell `--models` quoting; current-date injection; long-read model selection; judge no-tools preamble; severity-inflation-justifies-dispute; five-keys tally schema; new Grok/Kimi/Mistral/Claude-in-council sections. Quantitative history stays in the ledger (`amicus council stats`).
- **2026-07-14 (v2.2.0)** — Optional council elements shipped and verified on a planted-flaw
  ground-truth council (critic seat, debate mode nothing-to-debate path, chair verdict scale;
  expert lenses defined but not yet field-run). New lessons: claim-class dedup glosses
  rationale-level errors in Stage-2; minimax debut (strong critic seat, CJK-intrusion quirk);
  qwen-coder debut (fast budget filler). Debate mode's defense/re-vote waves still unexercised.
