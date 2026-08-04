# MODEL-NOTES — Operating Lessons for Amicus Models

This file is the `second-opinion` skill's evolving memory of **how to actually drive each model
well**. Read it before Stage 0 (council selection and launch); update it, with the user's
approval, at the end of each run (Stage 6). Keep it tight — merge and prune rather than append.

_Last updated: 2026-08-03 (per-section fold-back, both directions — the haiku "hard-404"
re-diagnosed as a `/v1`-less `ANTHROPIC_BASE_URL`, pre-degrade-era claims re-grounded in the
announcement contract (`degrades[]`/`seatLoss`/exit 2/one Stage-1 retry), three model sections and
the peer-consensus≠evidence rule upstreamed from the field ledger; see changelog)._

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
- **A stale MCP server kills councils with a distinctive signature — zero output on every leg.**
  If any amicus MCP tool result carries the "Amicus was upgraded on disk (running vX, on-disk vY).
  Restart your MCP client" notice, do NOT launch councils through the MCP tools — relaunch via the
  CLI (`amicus council run`, a fresh process) or restart the client first. A version-skewed server
  has timed out an entire Stage-1 wave with literally zero output bytes on every leg; that
  all-legs-zero-output shape is what distinguishes it from model/provider failures, which produce
  partial output or errors.
- **Read results from the JSON documents** (`--json`): a wave's `legs[].summary` / a run's
  `summary` is the model's output; `status`/`error`/`counts` are ground truth for failures. Never
  scrape stderr logs to judge success.
- **Transient provider errors** (502s, connection drops): re-run the affected leg (solo
  `amicus start --json`, same briefing file) or the wave — see per-model notes for
  model-specific signals. Never present a half-finished run as an answer.
- **Seat losses are announced, retried once, and exit-coded — read the surfaces, don't diff
  finding counts.** Every lost seat/leg is announced in one voice on stderr and recorded in
  `run.json.degrades[]`, `verdict.json.degrades[]`, the report's **"What was lost"** section, and
  `verdict.seatLoss`, and the run exits degraded (2). A Stage-1 wave or leg that dies is relaunched exactly once (serially, after the
  surviving launches settle; skipped when the run is already over `--max-cost`): a heal announces
  as a `Recovered:` line and the run stays exit 0; a seat still dead after its retry is recorded
  with both attempts named in the why. A dead route still doesn't stop a council — it shrinks it —
  but the shrinkage is no longer silent: confirm the bench you paid for from
  `seatLoss`/`degrades[]` after every run, because a shrunken bench weakens the tiers (fewer
  corroborators per finding).
- **Credentials:** keys live in `~/.config/amicus/.env`. The legacy `~/.config/sidecar/.env`
  fallback was removed in v2.0.0 (see `docs/SHIMS.md`). Configure with `amicus setup`. If
  `ANTHROPIC_BASE_URL` is set anywhere in the environment, it must carry its `/v1` suffix for
  direct-Anthropic legs — see the haiku section for the full diagnosis.
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
- **Long agentic reads can "narrate-then-never-deliver" even on capable models that DO finish
  reading — bake the anti-narration hardening into the FIRST attempt, not the retry.** Models have
  done a genuine full chunked read (confirmed by realistic input-token counts) and then ended the
  turn with only process narration ("Continuing…"), never producing the review + JSON: the read
  completed, but the turn budget ran out before the switch from reading mode to writing mode.
  Whenever the task requires many sequential file-read tool calls before writing, the briefing
  needs an explicit preamble: *"this is headless with no follow-up turn; you must produce the
  complete deliverable by the end of THIS response; if running low on room, stop reading early and
  write from what you have rather than deliver nothing."*
- **Multi-FILE agentic reads stub out like long single reads — even WITH the anti-narration
  preamble baked in.** Weaker readers have returned narration stubs of roughly 60–100 chars on a
  multi-file packet despite the standard preamble. Treat a many-file briefing as a long-read task:
  expect stubs, retry solo once with the identical briefing, then substitute the model — or
  pre-concatenate the packet into one file for weaker readers.
- **`--agent Plan` can trigger a literal, hard "planning mode — cannot execute" refusal on some
  models** (terse, near-zero-token responses), not just the intended read-only tool restriction —
  and prompt wording alone has not fixed it; switching that model to `--agent Build` has, immediately.
  On the manual path, Stages 2-3 never touch the source file (the briefing is self-contained plus a
  no-tools preamble), so `--agent Build` is safe there; reserve `--agent Plan` for Stage-1 legs
  that read the source, and fall back to Build per-model on a hard refusal.
- **Debate mode rarely fires on correctness questions — design for it or expect a no-op.**
  `--debate` only engages findings the tally marked Contested or Disputed, and judges agree far
  more than expected: **2 disputes in 123 adjudications across four councils** (gemini/gpt/qwen).
  Three of those four runs produced zero debatable findings, so the round never ran. Bug hunts
  converge — a race condition either exists or it does not. If you want a rebuttal round, brief a
  genuine judgement call (architecture, tradeoffs, "is this over-engineered"), not a defect hunt.
- **Peer consensus is not evidence on published, checkable numbers — verify against a primary
  source before applying such a finding, especially from the Confirmed tier and findings that
  survived debate.** In one paid council, 2 of 23 findings were factually wrong about published
  specs and BOTH sat in the tiers that are supposed to signal reliability: one reached Confirmed
  on two peer agreements, the other hardened after a debate round in which a correct dispute was
  talked out of its objection. A rebuttal is a rhetorical performance — judges re-voting on a
  persuasive defense have no more access to the spec sheet than they did the first time. Any
  finding that asserts a published figure (spec, capacity, rating, dimension, date) gets a
  verification pass before you act on it.
- **Read spend from `run.json`, never from a provider credit balance.** `usage.cost.amount` is the
  run total; per-leg costs are in `runStats[].usage.cost`. Only OpenRouter-routed legs move the
  OpenRouter balance — gemini/gpt/anthropic bill directly against their own keys, so inferring cost
  from that balance under-reports it badly (observed: ~6x low). A 3-model bench + chair + debate is
  roughly **$0.60-0.80 per run**, not cents; budget `--max-cost` accordingly or the chair gets
  skipped mid-run (exit 2, degraded) when the debate legs push the total past the ceiling. As of
  v4.6, `runStats` also carries Stage-2 judge rows (judge-tagged), so totals read higher than
  pre-4.6 runs for the same bench; anything keying `runStats` by model should exclude
  `role: 'judge'`.
- **Expect agreement inflation in Stage-2 adjudication.** The judge contract defines `agree` by
  worked example ("an 'I missed this — it's valid' counts as agree") but gives no example for
  `dispute` and no positive definition of `neutral`, while requiring a verdict on EVERY finding —
  including ones outside a judge's focus. A council reviewing this contract flagged the asymmetry
  unanimously. Weigh a lone `Confirmed` tier accordingly, and prefer `Contested` evidence over
  vote counts when a finding matters.
- **`council run` prints nothing until the run is terminal.** The run id is generated internally and
  the only stdout write happens after the run resolves, so a backgrounded `council run` gives you no
  id to watch. **Pin it up front with `--run-id <id>`** and point `amicus watch <id>` at it directly.
- **Resolve every alias before you spend.** Two failure shapes, both cheap to pre-empt:
  - **An alias that does not exist aborts the run before any spend** — `resolveModel` throws
    `Unknown model alias '<x>'`. `deepseek-r1` is a recurring guess and is **not** shipped; the real
    alias is `deepseek`. Check the alias table (`amicus models`) rather than inferring a name from a
    model's marketing string.
  - **A local alias override can silently upgrade a "cheap" seat to a frontier model.** Aliases in
    `~/.config/amicus/config.json` take precedence over the shipped routes, so a bench you picked for
    price can resolve to a Pro/preview tier and trip a low `--max-cost` (exit 1) — or quietly cost
    5-10× what you budgeted. Confirm what each seat actually resolves to before a budget bench.
- **The chair cannot also hold a bench seat**, so a bench built from budget aliases cannot chair
  itself with one of them — pick the chair from *outside* the bench list.
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
  verdict scale (parseable `VERDICT:` line + hard questions) all behaved per SEAT-BRIEFS.
- **Debate's defense/re-vote waves have now been exercised** (an ideation council, where severity
  means impact rather than correctness): they parse and tally cleanly, and the round behaves as a
  **rescope** mechanism rather than a defense — raisers overwhelmingly AMEND (downgrade an
  overstated severity, narrow a scope) rather than DEFEND, and amendments are re-confirmed on the
  re-vote. Expect high-amend / low-defend; the idea usually survives, the severity claim often does
  not. In ideation councils, **cross-lens convergence** (independent lenses proposing the same
  idea) is the strongest priority signal — compute it yourself when clustering; it is
  complementary to, not the same as, the tally's agree/dispute tiers.

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
- **Asserts quantitative "corrections" (timings, capacities) with unearned confidence** — one such
  "severely wrong" correction was disputed 3-0, including its own blind self-dispute. Cross-check
  its numeric claims before weighting; its honest blind self-disputes are a useful calibration tell.
- **Unreliable on long agentic reads** (see global rule) — inline the text or swap models for book-length material.

### DeepSeek  (`--model deepseek` → via OpenRouter)
- **Strengths:** resilient; produces strong, well-structured, well-cited critical analysis. A good
  default reviewer and a proven chair.
- **Quirk:** occasional transient 502 mid-run → re-run the leg.
- Proven chair (many clean chairings) — decisive, well-structured synthesis.
- As a Stage-1 reviewer of human-facing documents it **over-escalates severity** (typos/tenure → "blocker"); discount its blocker labels against peers. Prune its self-retractions when tallying.
- **"Agree-with-the-adversary" lean:** it has been the lone endorser of a red-team's harshest claims, turning them Contested — cross-check before treating its lone agreements as consensus.
- **Stub-on-fanout / clean-on-solo-retry:** its Stage-1 fanout leg has returned a sub-100-char
  narration stub despite the anti-narration preamble, then produced a full review on a plain solo
  retry with the identical briefing — retry solo before substituting the model.

### GPT  (`--model gpt` → via OpenRouter)
- **Strengths:** reachable via the OpenRouter key; resilient; very thorough structured critique
  (25 findings on a 1-page framework). Cleanly separates the review criteria.
- **Quirks:** verbose — peers dinged it for volume-over-judgment (good coverage, lower
  discrimination); **self-ranked its own review #1** in cross-review → discount self-votes.
- Ranked genuine #1 by all judges (incl. non-self) in one run — thoroughness is real, not a self-vote artifact. Handled an 82k-word agentic read cleanly — but a later similar-size read delivered only narration until retried with the anti-narration preamble; apply the preamble to gpt by default, not just to weaker models.
- **Asserts context-dependent facts (dates, "is this future?") without verifying** — and self-confirms them in adjudication. Cross-check any time-dependent claim it raises.
- A good calibration anchor in cross-review: confirms observational findings, disputes interpretive overreach. A repeatable role: the seat most likely to catch **confidence inflation** in an otherwise-correct argument (theoretical risk asserted as demonstrated mechanism, proxies used as pseudo-diagnostics).
- **When gpt disputes a specific numeric claim, weight that dispute heavily before a debate round erodes it** — it has been right and then talked out of the objection by a persuasive rebuttal (see the peer-consensus rule).

### Grok  (`--model grok` → via OpenRouter)
- Very fast legs; credible judge and chair (rejected its own weak findings as chair; honest blind self-rank).
- Strong red-team fit; handled an 82k-word agentic read. Weight its **observational** catches heavily and its **interpretive** verdicts cautiously (bench pattern: the former confirmed, the latter disputed).
- Stage-1 non-red-team reviews skew to scope-inflated "missing content" majors.
- Has **hard-refused under `--agent Plan`** ("Plan mode active… cannot execute"; near-zero tokens)
  where `--agent Build` worked immediately — prefer Build for grok legs (see the global Plan-refusal rule).
- **Fabrication risk on long-document tasks:** one fast, suspiciously low-fresh-token response
  contained an invented "major"-severity finding plus unsupported flavor details, verified false
  against the source. A later run under Build (genuine read, no fabrications on spot-check)
  partially rebuilt confidence — usable for red-team slots under Build **with the spot-check
  discipline**: verify its most specific/surprising claims against the source before letting them
  into a council.

### Kimi  (`--model kimi` → via OpenRouter)
- The bench's sharpest adjudicator (caught strawmen and misreads other judges waved through).
- Repeatedly the **top-ranked reviewer on consumer-practical, safety-heavy artifacts** (food
  safety, mechanical advice) — top-ranked in two such runs (unanimous in one), with the most
  granular findings on the bench and genuine structural catches.
- Its specificity is also its risk: it reaches for **exhaustive quantitative claims ("every",
  "all", "none") that are directionally right and literally wrong** — and it has successfully
  DEFENDED one in a debate round against a correct dispute. Verify its universal quantifiers
  against a primary source (see the peer-consensus rule).
- **Very slow legs (4-8× its peers)** — it gates wave wall-clock; budget timeouts around it.
- Stalls on long agentic reads (poller "Incomplete" with only a preamble). Reserve for short-artifact work.

### Mistral  (`--model mistral` → via OpenRouter)
- Fast, broad coverage, catches real issues.
- **Hallucination risk is real:** has invented non-existent product models/specs, disputed independently by two judges. Cross-check every specific model number or product claim it introduces.

### Claude  (in-council, when toggle on)
- Consistently the most *calibrated* reviewer (no severity inflation; findings overwhelmingly Confirmed; bench-best street-cred in recent runs) but sometimes the least *original* — it can miss the boldest single catch. Treat as a reliability floor, not a discovery engine — though on some benches its findings have anchored the entire Confirmed tier.
- Its own checkable, arithmetic-style claims deserve the same **mechanical verification** as everyone else's: one calendar-consistency claim in a Claude first-pass review was a genuine reasoning error, caught only by computing the dates programmatically before submission (see General).

### haiku  (`--model haiku`) — **the "hard-404" was the environment, not the model**
- **The model was never the problem.** The direct-Anthropic route returned an instant `Not Found`
  (~2 s, zero tokens) on every invocation of a paid corpus — 3 of 3 legs across two runs, as chair
  and as bench seat — and the standing diagnosis was a rotten alias. It is not: the cause is an
  **`ANTHROPIC_BASE_URL` set in host form, without its `/v1` suffix**. Anthropic SDKs (including
  Claude Code itself) treat the var as a HOST and append `/v1` themselves; OpenCode's provider
  layer treats it as the full prefix — so a value that is correct for the host app kills every
  direct-Anthropic leg amicus launches. Proven by control pair: an identical `fanout --models
  opus` call fails "Not Found" on the host form and completes with `/v1` appended.
- **Symptom signature:** instant "Not Found", zero tokens, direct-Anthropic routes only —
  OpenRouter-routed legs in the same run are unaffected. It hits every direct-Anthropic alias
  equally (haiku, opus, sonnet, claude; `fable` is OpenRouter-only and unaffected), so a "dead"
  cheap seat and a "dead" frontier chair with this signature share one cause.
- **The check:** inspect `ANTHROPIC_BASE_URL` in the environment amicus actually runs in — the var
  can live only in a parent process's env (e.g. the host app), absent from every shell profile and
  settings file on disk. If it lacks `/v1`, that is the kill. A doctor check for this is filed on
  the backlog; until it ships, check by hand before blaming a model or an alias.
- Seat-loss mechanics for a dead route are the same as any other loss — announced in one voice,
  exit 2 if still dead. A dead Stage-1 seat gets the one retry; a dead CHAIR walks the chair's own
  chain instead — same-chair retry, then promotion of the best non-bench model from the ledger —
  with the actual chair checkpointed into `run.json` (see the seat-loss bullet in Global
  operating rules).

### GLM  (`--model glm` → `glm-5.1` via OpenRouter; the recent observations below are from the explicit `openrouter/z-ai/glm-5.2` id)
- The v4.4.0-era "structured-output reliability not established" warning is **withdrawn as
  wrong-cause**: its `unstructured`-conformance results and repair refusals traced to two
  since-fixed engine defects (the unanchored fence extractor that truncated any JSON quoting a
  code fence, and repair prompts that omitted the artifact under repair — both fixed in v4.4.1),
  not to the model. Conformance has been `clean` in subsequent paid runs.
- Cheap and fast; **ranked best-by-peers on an ideation-bench debut** — a focused,
  fewest-findings reviewer whose findings land. Promising budget-to-mid bench member.
- **First recorded confident fact error:** it asserted an engine spec that the primary source (the
  owner's manual) contradicts outright — and the finding reached Confirmed on two peer agreements,
  denied only by a post-council verification pass. Treat glm's confident factual assertions as
  unverified until checked (the peer-consensus rule exists because of findings like this one).
- Honest under pressure both ways: it refused to fabricate on repair attempts, and it has
  withdrawn a contested finding cleanly in debate. An honest refusal still costs the seat — watch
  `conformance` per seat, not just the finding count.

### Qwen  (`--model qwen` → qwen3.7-max via OpenRouter; distinct from `qwen-coder`)
- Very large context (1M tokens per catalog). As a red-team substitute it has produced a thorough,
  well-organized adversarial review with accurate, specific line citations and genuinely unique
  catches that verified true against the source — weight its specific, cited claims heavily.
- Same observational-vs-interpretive split as grok: its cited observational findings get
  confirmed; its "blocker"-severity interpretive claims get disputed as genre-normative. Weight
  its severity labels on broad interpretive claims cautiously.
- **Do not assign qwen Stage-1 multi-file reads.** Its proven mode is single-file reads and
  short-artifact work: a book-length single-file read succeeded on retry with the anti-narration
  preamble, but multi-file packets have produced narration stubs twice in one run — with the
  preamble present, under both Plan and Build. It narrates rather than refuses under Plan.

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

### GPT-5.6-Terra  (`openrouter/openai/gpt-5.6-terra`)
- Debut (one paid ideation run): `clean` conformance, thorough — the most findings on its bench.
  Handled an inlined ~13K-token digest cleanly under `--agent Build`.
- The priciest leg on its bench (~5× the cheap seats) and it self-ranked #1 (discount self-votes,
  as always) while peers ranked it lower — thoroughness did not convert to peer standing. Low-N;
  re-confirm before leaning on it.

### Gemini 3.1 Pro  (`openrouter/google/gemini-3.1-pro-preview` — the PRO tier; the bare `gemini` alias resolves to flash)
- Debut (one paid ideation run): `clean` conformance, mid-bench peer standing.
  No narration or stall — but the material was INLINED, not an agentic read (where gemini-flash
  historically stalls); don't extend the result to agentic reads untested.
- Use the shipped `gemini-pro` alias when you want a real Pro reviewer — it live-resolves to the
  current Pro tier, falling back to `openrouter/google/gemini-3.1-pro-preview`; the bare `gemini`
  alias gives you flash.

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
- **gemini** — fast, very large context; the bare alias resolves to flash tiers (shallow coverage, cheap fact-checks); asserts numeric "corrections" with unearned confidence — cross-check them. Conforms cleanly; watch for preamble narration — instruct it to emit the JSON block verbatim after the prose.

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
- **Checkable, arithmetic-style claims (calendar/date consistency, counts, named specific facts)
  deserve a mechanical verification pass before publishing — including claims from Claude's own
  review, not just other models'.** One calendar-consistency claim in a Claude first-pass review
  was wrong; running the actual dates through a real calendar caught it before it reached the
  council or the author. This class of claim is cheap to verify mechanically and expensive to get
  wrong in a document going to a human — don't re-reason it a second time; compute it.
- Prefer models from **different families** for genuinely independent opinions.

## Lessons changelog
- **2026-06-03** — Seeded from the study-guide review (Gemini + DeepSeek). Found the (since-fixed)
  headless poller trap and Gemini's narrate-then-glob pattern; confirmed DeepSeek's resilience and
  its occasional transient 502.
- **2026-06-03** — v2 council upgrade: added cross-review (Stage-2 anonymized peer ranking +
  per-finding adjudication) and reviewer-reliability tracking.
- **2026-06-04** — B2B messaging-framework council (Gemini + GPT + DeepSeek + Claude-in-council;
  DeepSeek chair). First GPT use → per-model note. First scored reviewer-reliability rows
  (deepseek 2.33/100%, gpt 2.67/92%, gemini 3.67/89%; 1–4 scale).
- **2026-06-10** — v3 migration: transport moved to `fanout --json` + `--prompt-file` (F4); pruned
  the obsolete engine workarounds they replaced — the headless-poller trap + single-read/no-glob/
  no-narration ritual + "Polling loop exited" false-alarm note (fixed by F1), the ~32 KB inline-arg
  cap (superseded by `--prompt-file`), the absolute-path/cwd trap (fixed by F2), and the
  GUI-hangs-on-this-machine rule (resolved 2026-06-10; headless stays the council default by
  design). Config path updated to `~/.config/amicus/.env`.
- **2026-07-02** — Folded back field lessons from runs 4-7 (AV-receiver, pork-shoulder, resume, novel ×2 councils): PowerShell `--models` quoting; current-date injection; long-read model selection; judge no-tools preamble; severity-inflation-justifies-dispute; five-keys tally schema; new Grok/Kimi/Mistral/Claude-in-council sections. Quantitative history stays in the ledger (`amicus council stats`).
- **2026-07-26 (v4.4.0)** — Fold-back from six paid councils (workspace/renderer review ×4, a
  frontier cost-pipeline council, and an ideation council). Operating lessons: alias-resolution
  hygiene before spending (a non-existent alias aborts the run; a local `config.json` override can
  silently upgrade a "cheap" seat to a Pro tier and trip `--max-cost`); the chair may not also hold
  a bench seat; `council run` prints nothing until terminal, so pin `--run-id` when backgrounding.
  Debate's defense/re-vote waves exercised for the first time — they work, and behave as a rescope
  (amend-heavy) rather than a defense. New per-model notes: **haiku** hard-404ed 3/3 legs across two
  runs and both councils silently degraded around it *(both halves since superseded: the 404 was a
  `/v1`-less `ANTHROPIC_BASE_URL`, not the alias — see the haiku section — and the silent-degrade
  era ended with the v4.5.2→v4.6 announcement contract)*; **glm** returned `unstructured` conformance
  with 0 findings twice after a clean debut, and honestly refused to fabricate on repair — which
  still costs the seat *(since re-diagnosed: both results were v4.4.0 engine defects, fixed in
  v4.4.1 — see the GLM section)*.
- **2026-07-14 (v2.2.0)** — Optional council elements shipped and verified on a planted-flaw
  ground-truth council (critic seat, debate mode nothing-to-debate path, chair verdict scale;
  expert lenses defined but not yet field-run). New lessons: claim-class dedup glosses
  rationale-level errors in Stage-2; minimax debut (strong critic seat, CJK-intrusion quirk);
  qwen-coder debut (fast budget filler). Debate mode's defense/re-vote waves still unexercised.
- **2026-08-03 (fold-back, both directions — owner's ruling)** — Per-section reconciliation with
  the machine-local field ledger after six release-cycle deferrals. Corrections: the haiku
  "hard-404" re-diagnosed (a `/v1`-less `ANTHROPIC_BASE_URL` in host form — the model was never
  the problem; control pair: identical `fanout --models opus` fails host-form, completes with
  `/v1`); glm's `unstructured` era re-attributed to the since-fixed v4.4.1 fence-extractor and
  repair-prompt defects; every pre-degrade-era "silent shrink" claim re-grounded in the current
  contract (one-voice announcement on stderr + `degrades[]` + `seatLoss`, exit 2, one Stage-1
  retry with `Recovered:` heals). Upstreamed from the field: the peer-consensus≠evidence rule
  (2 of 23 findings factually wrong inside high-trust tiers, caught only by primary-source
  verification), the anti-narration-preamble and multi-file-stub rules, the Plan-hard-refusal
  fallback, the stale-MCP-server signature, three model sections (qwen, gpt-5.6-terra,
  gemini-3.1-pro), and gemini/deepseek/gpt/grok/kimi/Claude enrichments. Standing practice: each
  release cherry-picks generalizable lessons per-section (docs/publishing.md release checklist),
  never a bulk copy.
