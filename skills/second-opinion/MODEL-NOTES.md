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
- **Credentials:** keys live in `~/.config/amicus/.env` (legacy `~/.config/sidecar/.env` still
  read). Configure with `amicus setup`.

## Stage-2 cross-review briefing tips

- **Send the same anonymized bundle to every judge** — stable labels Review A/B/C…, no model
  names — so rankings are directly comparable (one fanout wave distributes it).
- **Require a `FINAL RANKING:` block** at the end of the response (e.g. `1. Review C / 2. Review
  A …`), plus a per-finding `agree | dispute | neutral` verdict with a one-line reason for each
  finding referenced by run-global label id (e.g. `A2` = Review A's 2nd finding).
- After de-anonymizing, assemble the tally input (see SKILL.md Stage 2 assembly recipe) and run
  `amicus council tally <input.json> --json` — do not hand-tally tiers or street-cred numbers.

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
