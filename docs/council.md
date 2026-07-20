# Council Reference — Pipeline, Schemas, and a Worked Example

> Quick summary is in the [README "The Council" section](../README.md#the-council). This document
> is the field-by-field reference for the `amicus council` subcommands: what each one reads, what
> it writes, and how the pipeline chains together. It is self-contained — every command and JSON
> example below is real and was run against the CLI while writing this doc.

This page exists because `amicus council tally|stats|report|validate|verdict|save|list|show` are
**deterministic local math and file I/O** — none of them call a model. The models run in the
`second-opinion` skill's Stage 1/2/3 waves (`amicus fanout` / `amicus start`); these subcommands
consume and produce the JSON that glues those stages together. If you're driving a live council
run, follow **[skills/second-opinion/SKILL.md](../skills/second-opinion/SKILL.md)** — it's the
orchestration recipe. This page is the reference for the artifacts that recipe produces.

---

## Table of contents

- [The pipeline, end to end](#the-pipeline-end-to-end)
- [`amicus council validate`](#amicus-council-validate)
- [`amicus council tally`](#amicus-council-tally)
- [`amicus council verdict`](#amicus-council-verdict)
- [`amicus council report`](#amicus-council-report)
- [`amicus council stats`](#amicus-council-stats)
- [Council presets: `save` / `list` / `show`](#council-presets-save--list--show)
- [Worked example](#worked-example)
- [Where artifacts live](#where-artifacts-live)

---

## The pipeline, end to end

```
Stage 1 reviews (models, via `amicus fanout`)
        │  each leg saved as review-<model>.md (prose + trailing ```json findings block)
        ▼
amicus council validate <leg-file>          ← per-leg findings-block check (tri-state exit)
        │  ok:true → findings[] usable
        ▼
Stage 2 cross-review (models rank + adjudicate, via `amicus fanout`)
        │  Claude assembles the de-anonymized tally-input JSON (see SKILL.md's
        │  "Stage-2 → tally assembly recipe")
        ▼
amicus council tally <tally-input.json>     ← deterministic tiers + street-cred + ledger append
        │  writes/prints the tally RECORD (save it as tally.json)
        ▼
Stage 4 decisions (Claude presents tiers, user accepts/denies/modifies)
        │  Claude writes decisions.json — one {id, decision, ...} object per finding
        ▼
amicus council verdict <tally.json> --decisions <decisions.json> -o verdict.json
        │  merges the tally record + decisions into the schema-stamped verdict.json
        ▼
amicus council report <verdict.json> [--md|--html]
        │  renders the adjudication matrix, street-cred table, findings-by-tier, cost
        ▼
report.md (Claude-authored synthesis) + report.html (deterministic renderer output)

Independently, at any time:
amicus council stats                        ← ledger-derived reviewer reliability (all past runs)
amicus council save|list|show                ← named --models lists for `--council <name>`
```

Three things to hold onto:

1. **`tally` is the finalize step.** It both computes the deterministic record *and* appends one
   row per (run × model) to the append-only reliability ledger (`~/.config/amicus/council-ledger.jsonl`,
   or `$AMICUS_CONFIG_DIR/council-ledger.jsonl` when that env var is set) — unless you pass
   `--no-ledger`. `stats` reads that ledger back.
2. **`verdict` doesn't recompute anything.** It's a pure merge of the tally record (deterministic
   tiers/street-cred, already computed) with your Stage-4 decisions (accept/deny/modify, made by a
   human via Claude). See [provenance](#amicus-council-verdict) below.
3. **`report` never touches a model.** It reads `verdict.json` (+ optional `wave.json` for the cost
   total) and renders it — Markdown or a self-contained HTML page. All prose synthesis (the actual
   "what does this mean" writeup) is `report.md`, written by Claude in Stage 5 of the skill — a
   *different* artifact from what this renderer produces. See
   [Where artifacts live](#where-artifacts-live).
4. **Optional council elements (v2.2.0) are orchestration-level — nothing in these subcommands
   changed for them.** The skill's opt-in elements (critic seat, expert lenses, debate mode, chair
   verdict scale — see [SKILL.md](../skills/second-opinion/SKILL.md) and
   [SEAT-BRIEFS.md](../skills/second-opinion/SEAT-BRIEFS.md)) ride on existing engine surfaces:
   seat roles travel as free-form `runStats[].role` labels (`"critic"`, `"lens:<slug>"`), debate
   mode runs the Stage-2 tally with `--no-ledger` (provisional) and re-tallies after the rebuttal
   round (that second, post-rebuttal tally is the ledger-recorded one), and lens runs always pass
   `--no-ledger` so non-comparable reviews never feed `stats`.

---

## `amicus council validate`

```
amicus council validate <file> [--json]
```

Validates a Stage-1 reviewer's saved output (`review-<model>.md`: prose + a trailing ` ```json `
fenced block) against the findings-block contract, without calling a model. Thin CLI wrapper over
`validateFindings` (`src/council/findings.js`).

**What it checks**, in order:
- A ` ```json ` fenced block exists (last one in the file wins if there are several) —
  `NO_FENCED_BLOCK` if not.
- It parses as JSON — `NOT_PARSEABLE` if not.
- `findings` is a non-empty array — `EMPTY_FINDINGS` if not.
- Every finding has a **sequential integer `id`** starting at 1 (`NON_SEQUENTIAL_ID` /
  `DUPLICATE_ID` otherwise), a `severity` in `{blocker, major, minor, nit}` (`BAD_SEVERITY`
  otherwise), and non-empty string `claim`, `location`, `rationale` (`MISSING_FIELD` otherwise).

**Exit codes are a tri-state contract, not the usual 0/1:**

| Exit | Meaning |
|---|---|
| `0` | `ok:true` — the findings block is well-formed. |
| `2` | `ok:false` — parsed as a *result*, but validation failed. A distinct, scriptable outcome — not a crash. |
| `1` | `BAD_ARGS` envelope — the file path is missing or unreadable. |

**Output** (`--json`): `{ok, findings, errors}`. `errors[]` is `{code, detail}[]` using the codes
above. Verified against the real binary:

```bash
$ amicus council validate review-deepseek.md --json
```
```json
{
  "ok": true,
  "findings": [
    { "id": 1, "severity": "major",
      "claim": "The three-tier pricing table omits a monthly/annual toggle.",
      "location": "pricing-page.html, .pricing-table section",
      "rationale": "Users can't compare annual savings without it, and competitors all show one." }
  ],
  "errors": []
}
```

A malformed file (no fenced block) returns exit `2`:

```json
{ "ok": false, "findings": [], "errors": [ { "code": "NO_FENCED_BLOCK", "detail": "no ```json block found" } ] }
```

---

## `amicus council tally`

```
amicus council tally <input.json> [--json] [--no-ledger]
```

Reads a **tally-input** JSON file, computes the deterministic tally **record**, prints it (human
summary, or the full record with `--json`), and — unless `--no-ledger` — appends one row per
model to the reliability ledger. Thin CLI wrapper over `tally()` (`src/council/tally.js`).

### Tally-input schema

Claude assembles this file at the end of Stage 2 (the full assembly recipe is in
[SKILL.md](../skills/second-opinion/SKILL.md#stage-2--cross-review), under "Stage-2 → tally
assembly recipe"). It needs **all five top-level keys** — `tally()` throws
`Cannot read properties of undefined (reading 'map')` if `meta` or `findings` is missing:

| Field | Type | Meaning |
|---|---|---|
| `meta.runId` | string | Run identifier (conventionally the run-folder stem). |
| `meta.models` | string[] | Every reviewed model id, including `"claude"` when "Claude in the council" is on — this is the street-cred universe. |
| `meta.chair` | string | The confirmed chair model id. |
| `meta.claudeInCouncil` | boolean | The Stage-0 toggle. |
| `meta.runType`, `meta.date` | string (optional) | Free-form labels carried through to `verdict.json`. |
| `findings[]` | array | One entry per finding across all reviews: `{id, raiser, severity}` (`claim` may ride along but isn't required by the tally engine). `id` is the run-global label (e.g. `A1`, `B2`) assigned during Stage-2 assembly, not the reviewer's local integer id. |
| `adjudications[]` | array | One entry per (judge × finding): `{findingId, judge, verdict}`, `verdict ∈ {agree, dispute, neutral}`. Include every judge's verdict on every finding, **including the raiser's own adjudication of its own finding** — the engine excludes it automatically when scoring (don't pre-filter it). |
| `rankings[]` | array | One entry per judge: `{judge, order}`. `order` is that judge's `FINAL RANKING:` block translated to model ids, e.g. `["gpt", "deepseek"]` (ties may use a nested array, e.g. `[["gpt","deepseek"], "mistral"]`). |
| `runStats[]` | array | One entry per model call: `{model, role, wasChair, conformance, status, durationMs, usage}`. May be `[]`. Any leg with no run document gets `durationMs: null, usage: null` — never invent a value. |

### Tally-record schema (what `tally()` returns / prints)

```json
{
  "schemaVersion": 1,
  "meta": { "...": "echoed from input" },
  "judged": true,
  "streetCred": [ { "model": "gpt", "withSelf": 1, "peersOnly": 1, "perJudgeRank": { "...": "..." } } ],
  "findings": [
    { "id": "A1", "raiser": "deepseek", "severity": "major", "tier": "Confirmed",
      "basis": { "a": 1, "d": 0, "n": 0 }, "confidence": "thin",
      "tierOverride": null, "adjudications": [ { "judge": "deepseek", "verdict": "agree" } ] }
  ],
  "runStats": [ { "...": "validated, echoed from input" } ],
  "tierCounts": { "Confirmed": 1, "Contested": 1, "Singleton": 1, "Disputed": 0 }
}
```

| Field | Notes |
|---|---|
| `schemaVersion` | Tally-record schema version (currently `1`). Independent of the `--json` **error-envelope** schema version used by `BAD_ARGS` failures (currently `2`) — don't conflate the two when scripting against output. |
| `judged` | `true` only when `rankings.length >= 2`. `false` (1 or 0 rankings) means street-cred numbers exist but rest on thin cross-review. |
| `streetCred[].withSelf` | Mean rank position across **all** judges' rankings (lower = better). |
| `streetCred[].peersOnly` | Mean rank position **excluding** the model's own ranking of itself. This is the number used everywhere else (ledger, `stats`, bench recommendations). |
| `findings[].tier` | One of `Confirmed \| Contested \| Singleton \| Disputed` — see the cascade below. |
| `findings[].basis` | `{a, d, n}` = peer agree/dispute/neutral counts (raiser's own vote excluded when a raiser is known). |
| `findings[].confidence` | `"thin"` when `a + d <= 1` (only one peer engaged), else `"solid"`. Thin-confidence findings are the ones Claude may override before Stage 4. |
| `findings[].tierOverride` | `null` unless Claude recorded an override; shape `{from, to, reason}`. |
| `tierCounts` | Convenience totals across all findings — this is what `renderRecord`'s human-readable summary prints. |

**The peers-only tier cascade** (`assignTier(a, d)` — exhaustive over all `(a, d)`):

| Condition | Tier | Confidence |
|---|---|---|
| `d >= 2 && d > a` | Disputed | solid |
| `a >= 2 && a > d`, or `a === 1 && d === 0` | Confirmed | solid (≥2 agree) / thin (lone peer) |
| `d >= 1` (and not Disputed) | Contested | thin if `a+d<=1`, else solid |
| else (`a === 0 && d === 0`) | Singleton | thin |

A lone corroborating peer (`a=1, d=0`) ranks as **Confirmed (thin)** — it must not rank weaker than
a lone disputing peer (`a=0, d=1`, which is **Contested (thin)**). A 2-vs-2 split is **Contested**
(large-bench tie), not Disputed — `d > a` is required for Disputed, not just `d >= 2`.

**Ledger append.** Unless `--no-ledger`, `tally` writes one row per `meta.models` entry to
`council-ledger.jsonl` (append-only, JSON Lines). Use `--no-ledger` for a re-tally that shouldn't
double-count (e.g. re-running after fixing a malformed input). Two standing uses from the skill's
optional elements (v2.2.0): **debate mode** tallies provisionally with `--no-ledger` after Stage 2
and records only the final post-rebuttal tally, and **expert-lens runs** always pass `--no-ledger`
(lens reviews aren't comparable to standard reviews, so they must not feed `stats`). This is
best-effort: a ledger write failure prints a notice to stderr but does not fail the tally.

---

## `amicus council verdict`

```
amicus council verdict <tally.json> [--decisions <decisions.json>] [-o|--out <out.json>]
```

**Provenance — this is the answer to "where does verdict.json come from":** `verdict.json` is a
**pure merge** of two inputs, computed by `buildVerdict(record, decisions)`
(`src/council/verdict.js`) with **no recomputation of tiers or street-cred**:

1. `<tally.json>` — the tally **record** exactly as printed by `amicus council tally --json`
   (Claude saves it to disk after Stage 2; see the worked example below).
2. `--decisions <decisions.json>` — a **JSON array**, one object per finding, produced by Claude
   during Stage 4 (the accept/deny/modify pass): `{id, decision, applied?, duplicateOf?, tierOverride?}`.
   Optional — defaults to `[]`, which produces a verdict with every finding's `decision: null`.

For each finding, `buildVerdict` looks up the matching decision by `id` and folds in `decision`,
`applied` (default `false`), `duplicateOf` (default `null`), and `tierOverride` (decision's
override wins over the tally record's, if both are present — the effective `tier` becomes
`tierOverride.to` when an override exists). Everything else (`basis`, `confidence`,
`adjudications`, `streetCred`, `runStats`, `tierCounts`) passes through from the tally record
unchanged.

**Output schema** (`verdict.json`, schema v2 — independent of the tally record's own
`schemaVersion`):

```json
{
  "schemaVersion": 2,
  "type": "council-verdict",
  "overallVerdict": null,
  "runId": "...", "runType": "...", "date": "...", "chair": "...",
  "council": ["deepseek", "gpt"],
  "claudeInCouncil": false,
  "findings": [
    { "id": "A1", "raiser": "deepseek", "severity": "major", "tier": "Confirmed",
      "basis": { "a": 1, "d": 0, "n": 0 }, "confidence": "thin", "tierOverride": null,
      "duplicateOf": null, "adjudications": [ "..." ],
      "decision": "accepted", "applied": true }
  ],
  "streetCred": [ { "model": "gpt", "withSelf": 1, "peersOnly": 1 } ],
  "runStats": [ "..." ],
  "tierCounts": { "Confirmed": 1, "Contested": 1, "Singleton": 1, "Disputed": 0 }
}
```

**Key notes:**
- `schemaVersion` — verdict-document schema version (currently `2`).
- `type` — document-type discriminator; always `"council-verdict"` (council family v2 envelope).
- `overallVerdict` — the chair's verdict-scale outcome: one of `"Ship it"`, `"Fix these first"`, `"Fundamental rethink"`, or `null` when no chair verdict was produced (populated by the headless engine during Stage 3; `null` for a plain `council verdict` merge without engine integration).
- All other keys (`runId`, `council`, `findings`, `streetCred`, `runStats`, `tierCounts`) are passed through unchanged from the tally record.

**Write path:** always atomic — a `<out>.tmp-<pid>` file is written first, then renamed over the
target (`writeVerdictAtomic`), matching the repo's `wave.json` convention. Default output path is
`./verdict.json`; override with `-o`/`--out`.

**Windows PowerShell 5.1 caveat** (also called out in SKILL.md): redirecting `council tally`'s
`--json` output with a bare `>` writes UTF-16 under legacy PowerShell 5.1, which then makes
`council verdict` fail to parse `tally.json` with a confusing `BAD_ARGS` — pipe through
`| Out-File -Encoding utf8` on 5.1, or run under pwsh 7+/bash.

---

## `amicus council report`

```
amicus council report <verdict.json> [--wave <wave.json>] [--md|--html]
```

Pure renderer — reads `verdict.json` (+ optional `wave.json`, used only to source the wave's total
cost) and produces **one self-contained string**: Markdown (default) or a self-contained HTML page
(`--html`). No scoring, no anonymization, no synthesis — those already happened upstream. Thin CLI
wrapper over `buildReport()` (`src/council/report.js` / `report-html.js`).

**What it renders**, in this order: a header (run type, id, date, chair, council members), a
verdict-summary tier-count table, the **adjudication matrix** (finding × judge, `✓`/`✗`/`–` with
`*` marking the raiser's own vote), the **peers-only street-cred table**, **findings grouped by
tier** (Disputed first), and a **cost table** (per-model status/duration/cost + wave total,
sourced from `runStats[].usage`).

This is the same renderer the `second-opinion` skill calls in Stage 5 to produce `report.html`.
**`report.md` and this renderer's output are two different files** — `report.md` is Claude-authored
prose that includes a copy of this renderer's Markdown as one section, not this renderer's own
output; see [Where artifacts live](#where-artifacts-live) for the exact contract.

**`--html` output** is a self-contained page (one file, inlined styles) — the default artifact to
hand a user, per the skill.

---

## `amicus council stats`

```
amicus council stats [--json]
```

Reads the **append-only ledger** (`council-ledger.jsonl`, written by every non-`--no-ledger`
`council tally` call) and aggregates per-model reliability across **all past council runs on this
machine** — this is historical, cross-run data, not anything from a single tally/verdict. Thin CLI
wrapper over `deriveReliability()` (`src/council/ledger.js`).

**Output**, one row per model that has ever appeared in `meta.models`:

| Field | Meaning |
|---|---|
| `runs` | Number of ledger rows for this model (one per council run it participated in). |
| `lowN` | `true` when `runs < 3` — treat the numbers as noisy. |
| `avgStreetCredPeersOnly` | Mean of `streetCredPeersOnly` across all runs (`null` if the model was never judged). |
| `lifetimeConfirmRate` | Mean, across runs, of `(findings this model raised that landed Confirmed) / (findings this model raised)`. `null` when `judged` was false for every run or the model raised nothing. |
| `lifetimeFactErrorRate` | Same shape, but for the `Disputed` tier — a proxy for how often the bench caught this model asserting something wrong. |
| `conformance` | Tally of `{clean, repaired, unstructured}` counts — how often this model's Stage-1 findings JSON needed a repair re-prompt. |

This is the data source the `second-opinion` skill's Stage 0 model recommendations and the
`MODEL-NOTES.md` quantitative table both read — **never hand-edit reliability numbers there**;
they come from here.

---

## Council presets: `save` / `list` / `show`

```
amicus council save <name> --models a,b,c
amicus council list [--json]
amicus council show <name> [--json]
```

A named preset is just a saved `--models`-style list that `--council <name>` (on `fanout` and the
`amicus_fanout` MCP tool) can run in one shot, instead of spelling out `--models` every time.

- **`save`** validates ≥2 members (each must resolve via the same alias/catalog logic
  `resolveCouncilMembers` uses — a known alias, or a raw `provider/model` id containing `/`) and
  writes them to `~/.config/amicus/config.json` under `councils.<name>`. Overwrites silently
  report `overwritten: true` in `--json` mode — this is also how you shadow a built-in bench.
- **`list`** shows your saved councils **plus** the three built-in benches (`free`, `budget`,
  `frontier`), each marked `builtin: true`. If a saved council shares a name with a built-in,
  **both** entries are listed — the saved one (`builtin: false`) is the one `--council <name>`
  actually resolves to; the built-in entry gets `shadowed: true`.
- **`show <name>`** resolves a name exactly like `--council` does (user config first, built-in
  fallback) and reports the raw members plus a `resolved`/`dropped` split — diagnostic-only, so it
  still reports even for a council currently below the 2-member usable minimum (unlike an actual
  run, which refuses below 2).

**Built-in benches** (work with zero setup): `free` (zero-cost `:free`-suffixed OpenRouter models,
resolved dynamically from the live catalog), `budget` (cheap workhorses, one per vendor family),
`frontier` (premium flagships, one per vendor family).

---

## Worked example

Everything below was run against the real `amicus` binary while writing this page — no mocked
output. Two reviewers (`deepseek`, `gpt`) reviewed a pricing page; deepseek raised one finding,
gpt raised two.

**1. `tally-input.json`** — assembled by Claude at the end of Stage 2:

```json
{
  "meta": {
    "runId": "pricing-page-council",
    "runType": "design-review",
    "date": "2026-07-02T18:00:00Z",
    "models": ["deepseek", "gpt"],
    "chair": "deepseek",
    "claudeInCouncil": false
  },
  "findings": [
    { "id": "A1", "raiser": "deepseek", "severity": "major",
      "claim": "The three-tier pricing table omits a monthly/annual toggle." },
    { "id": "B1", "raiser": "gpt", "severity": "minor",
      "claim": "The 'Enterprise' tier has no visible CTA button." },
    { "id": "B2", "raiser": "gpt", "severity": "blocker",
      "claim": "Listed prices contradict the numbers in the FAQ section." }
  ],
  "adjudications": [
    { "findingId": "A1", "judge": "deepseek", "verdict": "agree" },
    { "findingId": "A1", "judge": "gpt",      "verdict": "agree" },
    { "findingId": "B1", "judge": "deepseek", "verdict": "neutral" },
    { "findingId": "B1", "judge": "gpt",      "verdict": "agree" },
    { "findingId": "B2", "judge": "deepseek", "verdict": "dispute" },
    { "findingId": "B2", "judge": "gpt",      "verdict": "agree" }
  ],
  "rankings": [
    { "judge": "deepseek", "order": ["gpt", "deepseek"] },
    { "judge": "gpt",      "order": ["gpt", "deepseek"] }
  ],
  "runStats": [
    { "model": "deepseek", "role": "council", "wasChair": true, "conformance": "clean",
      "status": "complete", "durationMs": 41230,
      "usage": { "cost": { "amount": 0.038, "source": "reported" } } },
    { "model": "gpt", "role": "council", "wasChair": false, "conformance": "clean",
      "status": "complete", "durationMs": 37810,
      "usage": { "cost": { "amount": 0.052, "source": "reported" } } }
  ]
}
```

**2. Tally** — note deepseek's `B2` dispute makes it Contested even though gpt agrees; `A1` gets
one uncontested peer agreement (Confirmed, thin); `B1` draws no agree/dispute at all (Singleton):

```bash
$ amicus council tally tally-input.json --json > tally.json
$ amicus council tally tally-input.json
Council tally (pricing-page-council)
  Confirmed 1  Contested 1  Singleton 1  Disputed 0
  Cost: $0.0900
```

**3. Stage 4 decisions** — Claude presents the three tiers, the user decides:

```json
[
  { "id": "A1", "decision": "accepted", "applied": true },
  { "id": "B1", "decision": "deferred" },
  { "id": "B2", "decision": "accepted", "applied": true }
]
```

**4. Verdict** — merges the tally record with the decisions above:

```bash
$ amicus council verdict tally.json --decisions decisions.json -o verdict.json
Verdict (schema v1, pricing-page-council) → verdict.json
  accepted 2  deferred 1
```

**5. Report** — deterministic rendering of `verdict.json` (`--md` shown; `--html` produces the
same content as a self-contained page):

```bash
$ amicus council report verdict.json --md
```
```
# Council Report — design-review (pricing-page-council)

_2026-07-02T18:00:00Z · chair: deepseek · council: deepseek, gpt_

## Verdict summary

| Tier | Count |
|---|---|
| Disputed | 0 |
| Contested | 1 |
| Confirmed | 1 |
| Singleton | 1 |

## Adjudication matrix

| Finding | Sev | Raiser | deepseek | gpt | Tier | Decision |
|---|---|---|---|---|---|---|
| A1 | major | deepseek | ✓* | ✓ | Confirmed | accepted |
| B1 | minor | gpt | – | ✓* | Singleton | deferred |
| B2 | blocker | gpt | ✗ | ✓* | Contested | accepted |

_Legend: ✓ agree · ✗ dispute · – neutral · `*` raiser's own vote_

## Street-cred (peers-only; lower = better)

| Model | peers-only | with-self |
|---|---|---|
| deepseek | 2.00 | 2.00 |
| gpt | 1.00 | 1.00 |

## Findings by tier

### Contested
- **B2** (blocker, raiser gpt) — a0/d1/n0 — accepted (applied)

### Confirmed
- **A1** (major, raiser deepseek) — a1/d0/n0 — accepted (applied)

### Singleton
- **B1** (minor, raiser gpt) — a0/d0/n1 — deferred

## Cost

| Model | Status | Duration | Cost |
|---|---|---|---|
| deepseek | complete | 41s | $0.0380 |
| gpt | complete | 38s | $0.0520 |
| **Wave total** | | | $0.0900 |
```

**6. Stats** — after this run's `tally` call appended to the ledger:

```bash
$ amicus council stats
model            runs  avg-cred  confirm  fact-err  notes
deepseek            1  2.00     1.00    0.00   low-N
gpt                 1  1.00     0.00    0.00   low-N
```

(`low-N` because each model has only 1 recorded run — `runs < 3`.)

**7. Presets**, for reference (independent of the run above):

```bash
$ amicus council save my-bench --models deepseek,gpt,gemini
Saved council 'my-bench': deepseek, gpt, gemini

$ amicus council list
Councils:
  my-bench         deepseek, gpt, gemini
  free             [built-in]
  budget           [built-in]
  frontier         [built-in]

$ amicus council show my-bench
Council 'my-bench'
  members: deepseek, gpt, gemini
  resolved: deepseek, gpt, gemini
```

---

## Where artifacts live

Every run writes to a run folder — `output/<stem>-council/` (or `./second-opinion/<stem>-council/`
if no `output/` directory exists), per the skill's Stage 0. This section cross-checks against
[SKILL.md's "Output & naming"](../skills/second-opinion/SKILL.md#output--naming) — treat that
section as authoritative if the two ever drift; file an issue if they do.

| File | Written by | Contains |
|---|---|---|
| `review-<model>.md` × N | Claude, from each Stage-1 leg's output | Prose review + trailing findings JSON block (this is what `council validate` checks). |
| `crossreview-matrix.md` | Claude, after Stage 2 | De-anonymized adjudication grid + street-cred table (hand-assembled from the tally record, not this renderer). |
| `tally.json` | `amicus council tally --json`, redirected to disk | The tally record — input to `council verdict`. |
| `verdict.md` | Claude, saved from the Stage-3 chair call | The chair's raw synthesized verdict (prose, unedited by Claude). |
| `verdict.json` | `amicus council verdict` | Schema-stamped merge of the tally record + Stage-4 decisions. See [provenance](#amicus-council-verdict). |
| `decisions.json` | Claude, during Stage 4 | The array passed to `council verdict --decisions`. |
| `report.md` | **Claude**, in Stage 5 | The chair's synthesis + the full Stage-4 decision log + a run-stats table (stage/model/status/duration/cost per call). **This is Claude-authored prose, not this page's renderer output.** |
| `report.html` | `amicus council report verdict.json --html` | The **deterministic** rendering shown in the [worked example](#worked-example) above — adjudication matrix, street-cred table, findings-by-tier, cost. No chair prose, no decision-log narrative. This is the default artifact handed to the user. |
| `<stem>-reviewed.<ext>` | Claude, in Stage 5 | The source artifact with accepted findings applied (editable-source runs only). |

**The one thing worth over-stating:** `report.md` and `report.html` are **not** the same content in
two formats. `report.html` is `amicus council report`'s pure render of `verdict.json` — deterministic,
no model involved. `report.md` is Claude's own synthesis document, written by hand in Stage 5,
which *includes* a copy of the same renderer's Markdown output as one section but also carries the
chair's prose verdict and the full decision log that the renderer never sees. If you only need the
deterministic data, run `amicus council report` yourself against any `verdict.json` — you don't
need Claude or a live council run to regenerate it.

---

## See also

- **[skills/second-opinion/SKILL.md](../skills/second-opinion/SKILL.md)** — the orchestration
  recipe that drives an actual council run (model selection, briefings, anonymization, the Stage-2
  tally assembly recipe, Stage 4 decision presentation).
- **[skills/second-opinion/COUNCIL-DESIGN.md](../skills/second-opinion/COUNCIL-DESIGN.md)** — the
  design spec behind the tier cascade and scoring model.
- **[docs/usage.md](./usage.md)** — full CLI/MCP flag reference for every command, including
  `council`.
- **[README "The Council"](../README.md#the-council)** — the narrative overview and cost framing.
