# MODEL-NOTES — Operating Lessons for Sidecar Models

This file is the `second-opinion` skill's evolving memory of **how to actually drive each model well**. Read it before Stage 0 (council selection and launch); update it, with the user's approval, at the end of each run (Stage 6). Keep it tight — merge and prune rather than append endlessly.

_Last updated: 2026-06-04 (messaging-framework council: GPT first use; absolute-path launch rule; poller false-alarm refinement)._

## Global operating rules (all models)
- **Always `--no-ui` (headless).** The interactive Electron GUI hangs at startup on this machine ("Starting up… | 0 messages" indefinitely). Headless returns results and surfaces real errors.
- **`--agent Plan`** for review/analysis — read-only, so a model can't accidentally edit the source.
- **`--no-context`** when the briefing is self-contained (it should be). Avoids dragging the current conversation in and confusing the model.
- **`--summary-length verbose`** — the analysis IS the deliverable; don't let it get summarized away.
- **Run in the background (`run_in_background: true`) and launch models in parallel.** You're notified on completion; read the output file then. Don't poll.
- **Credentials:** Google + OpenRouter keys live in `~/.config/sidecar/.env` (no env vars needed). Other providers need their own keys configured there.
- **Always use ABSOLUTE paths in launch commands (Windows/git-bash).** A `cd` in an earlier Bash call *persists* the working dir for later calls; a later relative `--prompt "$(cat briefing)"` then resolves to nothing (→ empty prompt) and the `> log` redirect fails (no parent dir), so the sidecar silently never runs — but the trailing `echo "...exit $?"` still reports exit 0, so it *looks* like it ran. Never rely on cwd; never `cd` in a compound launch command. Assign `B=/c/abs/path` and reference `"$B/file"` for both the cat and the redirect.

## The headless poller trap (read this — it's the #1 cause of failed runs)
Headless sidecar polls the run and **exits early if streamed output looks "stable" for ~8 s**. During a quiet tool-call gap it wrongly concludes "done," kills the process (exit code 0 but `completed:false`), and you get a half-written or empty result that looks like an answer. Mitigations, in order of preference:
1. **Shrink the input.** Pre-extract text from big/marked-up docs to a small file so the model reads it in ONE fast call. (A paginated ~80 KB HTML read stalls and trips the poller.)
2. **Forbid extra tool calls.** Put the exact file path in the briefing and instruct: *"Make exactly one read of this file. Do NOT glob, search, or verify the path. The moment the read returns, output your COMPLETE result in one message — no narration, no 'I will now…'."* The narrate-then-pause pattern is what trips the poller.
3. **Inline the content** (no file read at all) — but the prompt is a CLI argument, **capped ~32 KB on Windows** ("Argument list too long" above that). Use only for smaller material.
- **Transient provider errors** (e.g., 502 "Network connection lost") are not your fault → just re-run. A faster/smaller run reduces exposure.
- **The `{"level":"error","msg":"Polling loop exited",...,"completed":false}` log line is usually a FALSE alarm**, NOT truncation, when `hasAssistantMsg:true` and the full structured output is present below it. Verify by content/length before re-running — in the messaging-framework run all 4 calls logged this line and all completed fully.

## Stage-2 cross-review briefing tip

- **Send the same anonymized bundle to every judge** — stable labels Review A/B/C…, no model names — so rankings are directly comparable.
- **Require a `FINAL RANKING:` block** at the end of the response (e.g. `1. Review C / 2. Review A …`), plus a per-finding `agree | dispute | neutral` verdict with a one-line reason for each finding referenced by label+id (e.g. `A2`).
- The **single-read / no-glob / no-narration** anti-poller rule (see headless poller trap above) still applies to the bundle read — put the exact file path in the briefing and instruct the model to make exactly one read and output its complete result immediately.

## Per-model notes

### Gemini  (`--model gemini` → Google Gemini 3.5)
- **Strengths:** fast, very large context. Good for broad sweeps and long documents.
- **Quirk:** *reliably* trips the poller trap — it narrates ("I will find the file… I will now read…") and often runs an extra `glob` before reading, creating quiet gaps. **Always** force the single-read / no-glob / no-narration instruction (mitigation 2 above). With that, it completes cleanly.
- Don't trust its self-reported version string ("I am gemini-X") as ground truth.

### DeepSeek  (`--model deepseek` → via OpenRouter)
- **Strengths:** resilient (reads once, then streams continuously — rarely trips the poller); produces strong, well-structured, well-cited critical analysis. A good default reviewer.
- **Quirk:** occasional transient 502 mid-run → re-run.

### GPT  (`--model gpt` → via OpenRouter)
- **Strengths:** reachable via the OpenRouter key; resilient; very thorough structured critique (25 findings on a 1-page framework). Cleanly separates the review criteria.
- **Quirks:** verbose — peers dinged it for volume-over-judgment (good coverage, lower discrimination); **self-ranked its own review #1** in cross-review → discount self-votes. Logged the poller "exited" false alarm but completed fully.

### (others — add as used)
- Opus / o-series etc. are reachable via sidecar **if their API keys are configured**. Add notes here the first time each is used.

## Reviewer-reliability table

Consulted in Stage 0 (council selection) and updated with approval in Stage 6.

- **avg street-cred** — rolling average of this model's per-run street-cred (mean rank position across judges' `FINAL RANKING:` blocks; lower = better).
- **confirm-rate** — share of this model's findings that reached the **Confirmed** tier (agrees outweigh disputes, ≥ 2 judges engaged).

| model | runs | avg street-cred | confirm-rate | notes |
| --- | --- | --- | --- | --- |
| deepseek | 1 | 2.33 | 100% (12/12) | strong synthesis, resilient; chaired well; reads 68 KB once and streams |
| gpt | 1 | 2.67 | 92% (23/25) | thorough but verbose; self-ranked #1 → discount; OpenRouter |
| gemini | 1 | 3.67 | 89% (8/9) | fast, large-context; more absolute/adversarial ("blocker" inflation); ranked lowest; force single-read/no-narration |

_Scale note: the 2026-06-04 run used a 4-review pool (Claude in-council), so street-cred is on a 1–4 scale rather than 1–3 — treat these as run-1 baselines, not directly comparable to future 3-model runs. Merge/prune rather than append._

## Cost guardrail
- **Never** use `o3` / `o3-pro` unless the user explicitly asks for it by name — these cost roughly $10–60+ per request. Warn about cost before proceeding even when asked.

## General
- Model citations are usually real but **verify any load-bearing reference before publishing**; watch for loosely-attached attributions (e.g., a real paper cited for the wrong claim).
- Prefer models from **different families** for genuinely independent opinions.

## Lessons changelog
- **2026-06-03** — Seeded from the study-guide review (Gemini 3.5 + DeepSeek). Found the headless poller trap and Gemini's narrate-then-glob pattern; established the pre-extract + single-read mitigations and the inline ~32 KB CLI-arg cap; confirmed DeepSeek's resilience and its occasional transient 502.
- **2026-06-03** — v2 council upgrade: added cross-review (Stage-2 anonymized peer ranking + per-finding adjudication) and reviewer-reliability tracking (rolling street-cred / confirm-rate table); seeded Gemini and DeepSeek rows with placeholder values.
- **2026-06-04** — Trusst messaging-framework council (Gemini + GPT + DeepSeek + Claude-in-council; DeepSeek chair). First GPT use (OpenRouter) → added per-model note. Hit the **absolute-path/cwd-persistence trap** (a persisted `cd` silently no-op'd the whole Stage-2 wave behind a false exit-0) → added the absolute-path global rule. Confirmed the poller "exited / completed:false" line is a **false alarm** when the full output is present. Inline worked at ~14 KB; 43 KB bundle and 68 KB chair packet correctly used single-read-from-file. First scored reviewer-reliability rows (deepseek 2.33/100%, gpt 2.67/92%, gemini 3.67/89%; 1–4 scale).
