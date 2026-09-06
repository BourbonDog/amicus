# Council Reference — Pipeline, Schemas, and a Worked Example

> Quick summary is in the [README "The Council" section](../README.md#the-council). This document
> is the field-by-field reference for the `amicus council` subcommands: what each one reads, what
> it writes, and how the pipeline chains together. It is self-contained — every command and JSON
> example below is real and was run against the CLI while writing this doc.

This page exists because `amicus council tally|stats|report|validate|verdict|save|list|show` are
**deterministic local math and file I/O** — none of them call a model. The one exception is
[`amicus council run`](#amicus-council-run) (v4.0), the **headless engine**: it drives the whole
pipeline below — Stage-1 reviews → anonymized cross-review → tally → chair verdict — in one
command, and it does call models. In the interactive path, the models run in the
`second-opinion` skill's Stage 1/2/3 waves (`amicus fanout` / `amicus start`); these subcommands
consume and produce the JSON that glues those stages together. If you're driving a live council
run, follow **[skills/second-opinion/SKILL.md](../skills/second-opinion/SKILL.md)** — it's the
orchestration recipe. This page is the reference for the artifacts that recipe produces.

---

## Table of contents

- [The pipeline, end to end](#the-pipeline-end-to-end)
- [`amicus council run`](#amicus-council-run)
  - [Task mode (`--intent task`)](#task-mode---intent-task)
  - [Debate mode](#debate-mode)
- [Council Workspace (GUI)](#council-workspace-gui)
  - [Auto-open on `amicus_council_run` (v4.5)](#auto-open-on-amicus_council_run-v45)
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
        │  each leg saved as review-<seat>.md (prose + trailing ```json findings block)
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
   seat roles travel as free-form `runStats[].role` labels in the tally/verdict artifact
   (`"critic"`, `"lens:<slug>"`, or any other skill-authored label) — **but since v4.7 the
   council-ledger join reads only an allowlist** (`seat`, `critic`, `lens:*`, `chair`, `claude`,
   `council`, `redteam` — see the `runStats[]` row inventory under
   [`amicus council tally`](#amicus-council-tally)), so a custom/free-form label outside that set
   still renders in the tally/report artifact but no longer contributes its
   role/wasChair/conformance to `amicus council stats` reliability numbers. Debate mode runs the
   Stage-2 tally with `--no-ledger` (provisional) and re-tallies after the rebuttal round (that
   second, post-rebuttal tally is the ledger-recorded one), and lens runs always pass
   `--no-ledger` so non-comparable reviews never feed `stats`.

---

## `amicus council run`

```
amicus council run --prompt-file <briefing.md>
    (--council <preset> | --models a,b,c)   # >=2 seats, XOR (fanout semantics)
    [--chair <model>]                       # default deepseek; must NOT be a bench seat
    [--critic <model>]                      # must BE a bench seat; adversarial brief
    [--lenses s1,s2,...]                    # count == seat count; forces no-ledger;
                                            #   mutually exclusive with --critic in v4.0
    [--out-dir <dir>]                       # default ./council-<runId>/
    [--json] [--max-cost <usd>] [--timeout <min>]
    [--gateway auto|direct|openrouter] [--no-validate-model]
    [--template <name|path>] [--artifact <file>] [--var k=v]  # v4.5, see docs/usage.md#briefing-templates
    [--pack <name|path>]                                       # v4.5, see docs/usage.md#policy-packs
    [--intent review|task]                                     # v4.9, see Task mode below
```

**The headless engine (v4.0).** Everything the `second-opinion` skill orchestrates by hand in
Stages 1–3+5 — seat briefings (anti-sycophancy clause included), the Stage-1 review wave,
anonymization and run-global finding-id rewriting, the identical judge bundle, the Stage-2
cross-review wave with bounded repair re-prompts, the tally, chair synthesis with the verdict
scale, and the deterministic report — runs as **one command with no Claude runtime**. Stage 4
stays human: the engine is report-only and never fabricates accept/deny decisions
(`amicus council verdict --decisions` remains the post-hoc path).

Key semantics:

- `--prompt-file` is **required** — councils always have real briefings (no inline `--prompt`).
- Seat/chair/critic/lens validation happens **pre-flight** and fails through the error envelope
  (exit 1) before any spend. The chair must not be a bench seat.
- **`--pack <name|path>` (v4.5)** loads a saved bench/chair/critic/lenses/options/template as this
  run's defaults — any flag you also typed always overrides the pack's value for that field, and
  the pack is recorded on `run.json` (`pack: {name, version, hash, source}`) either way. When a
  pre-flight error names a value the pack supplied (e.g. "chair is a bench seat"), the message adds
  `(set by pack '<name>')` so a pack-caused failure is never mistaken for a typo in your own flags.
  Full reference: [docs/usage.md § Policy packs](./usage.md#policy-packs).
- `--timeout` is the **per-leg** timeout (existing fanout semantics); there is no run-level
  watchdog in v4.0 — bound the aggregate with your CI job timeout.
- `--max-cost` is a **whole-run** ceiling checked before each paid stage launch (Stage-1 wave,
  repair solos, Stage-2 wave, chair). Hitting it mid-run stops launching and finalizes what
  exists; in-flight legs are never aborted for cost.
- **It bounds KNOWN spend, and it never blocks a run.** A leg whose cost could not be
  determined contributes nothing to the figure the ceiling is checked against, is never guessed
  at, and never halts anything — the standing ruling is fail *loud*, not fail *closed*. The
  measured consequence of the older, quieter version: `council-wsgate02` really spent
  **$0.9859 against a $0.75 ceiling (131%)** while amicus believed $0.3720 — and exited `0`.
  So when a ceiling is set **and** the run's total is inexact (`usage.costExact: false` — any
  `unknownLegs` or `subtreeUnknownLegs`), the run **exits `2`**, through the same degrade
  channel as a bench the ceiling shrank — the stages, verdict and usage block are untouched;
  `exitCode` becomes `2` and `status` becomes `partial`, as for every other degradation, because
  `0`/`complete` reads as "clean, and inside your ceiling" and a run publishing a floor has not
  earned that. With **no** ceiling there is nothing to be inexact against and an unpriced leg
  leaves the exit code (and status) alone.
- Each launch is measured against the **remaining** allowance (ceiling − known spend −
  allowances already claimed by a wave that is launching right now). Stage 1 launches its seat
  wave and its critic/lens waves concurrently, so the claim is atomic — two waves can never
  both spend the same remaining dollars. **If the ceiling refuses one of them, the run
  continues with a partial bench**: launched waves are never rolled back and the run is never
  aborted for cost. The refusal is printed as a `Notice:` naming the wave and its models,
  recorded on `run.json` as `budgetRefusals[]`, and degrades the exit code to `2`. If it takes
  the bench below two reviews, the usual `COUNCIL_QUORUM` failure (exit 1) applies.
- A run starts **one** OpenCode server and threads it through every wave (two concurrent
  starts race on OpenCode's SQLite). Whether that worked is always on the record, in the
  affirmative as well as the negative — exactly one of these two keys is present:
  - `sharedServer` `{acquired: true, at, goPid, models}` — the run got its shared server and
    every wave rode it. `goPid` is the server's pid; no wave writes a `goPid` into its own
    `metadata.json` while riding an injected server, so this is direct evidence rather than
    an inference drawn from a `goPid` appearing where it should not.
  - `sharedServerUnavailable` `{error, at}` — the server could not start and the run **still
    proceeded** on one server per wave, the configuration that races. Also printed as a
    `Notice:`. It does not change the exit code; treat its presence as "expect degraded
    results".
- **A `--council <preset>` member that resolution drops is recorded on `run.json`, not just
  printed.** A preset member whose alias no longer resolves, or whose resolved id has fallen out
  of the cached model catalog, is silently excluded from `bench` (the same graceful-degradation
  `resolveCouncilMembers` applies everywhere) — human mode also prints a `Notice: dropped
  unavailable council member(s): ...`, but `--json` mode (every scripted/MCP caller) printed
  nothing at all. `run.json` now carries an additive `droppedMembers: [{member, reason}]` array —
  present only when at least one member was actually dropped. The `--json` envelope carries it
  via the same run.json serialization; the `amicus_council_run` MCP response body includes it
  via an explicit conditional spread (`...(droppedMembers.length ? { droppedMembers } : {})`),
  hand-built separate from run.json. `amicus council show <name>` reports the identical resolved/dropped split (and the
  same per-member reason) as a preview, before you spend anything.
- Chair failure recovery: one retry of the same chair → promote the highest peers-only
  street-cred model (from `amicus council stats`) that is not a bench seat → give up and write
  the verdict with `overallVerdict: null`. Each attempt in that walk is additionally recorded on
  `run.json` as `chairAttempts[]` (`{waveId, model, outcome, reason}`), checkpointed after every
  attempt so a mid-walk kill preserves what already happened.
- SIGINT/SIGTERM abort the active wave/solo, finalize `run.json` as `aborted`, exit 130/143.
  `amicus abort <councilRunId>` (and the MCP tools via the sessions-dir pointer file
  `council-<runId>.json`) work on council runs; `status`/`list` resolve them the same way.
  There is no CLI `wait` — the MCP `amicus_wait` tool is the blocking primitive and resolves
  council runs the same way.

**Exit codes and degradation:**

| Condition | Behavior | Exit |
|---|---|---|
| All stages complete, chair verdict parsed | full run | 0 |
| Fewer than 2 completed Stage-1 reviews | stop; error doc `COUNCIL_QUORUM` | 1 |
| At least 2 reviews but fewer than 2 completed judges | proceed; tally `judged:false` | 2 |
| Chair fails (1 retry + 1 fallback promotion) | `verdict.json` written, `overallVerdict:null` | 2 |
| Chair output missing `VERDICT:` line after 1 repair | chair prose kept, `overallVerdict:null` | 2 |
| Cost ceiling hit after the tally exists | verdict written (no chair), `overallVerdict:null` | 2 |
| Cost ceiling hit before the tally | stop; error doc `COST_EXCEEDED` | 1 |
| Cost ceiling refused a wave at pre-flight | partial bench; `Notice:` + `run.json` `budgetRefusals[]` | 2 |
| `--max-cost` set and `usage.costExact:false` | stages/verdict/usage untouched; `run.json` `status` becomes `partial` — the total is a floor, so it is not reported as clean | 2 |
| Aborted | `run.json` status `aborted` | 130/143 |

**The run directory** (durable state; skill-compatible layout):

```
council-<runId>/
  briefing-stage1.md          # composed seat briefing (user briefing + templates)
  review-<seat>.md x N        # Stage-1 outputs (one per bench seat)
  bundle-stage2.md            # anonymized judge bundle (identical for all judges)
  judge-<seat>.md x N         # Stage-2 raw outputs (one per judging seat)
  chair-packet.md             # de-anonymized chair packet (+ verdict-scale addendum)
  chair-output.md             # chair raw output
  tally-input.json            # the assembled five-keys object (auditability)
  tally.json                  # engine tally record (council family v2)
  verdict.json                # undecided verdict (tiers + overallVerdict)
  report.html                 # deterministic renderer output
  run.json                    # manifest: schemaVersion 2, type council-run, stages, usage
  _scratch/                   # cwd for judge legs (isolation)
```

**`<seat>` in those filenames is the seat id, not the model alias.** A seat id *is* its alias
whenever that alias occupies exactly one bench position — which is every bench with no repeated
`--models` entry, so these filenames are unchanged there. When the same alias occupies more than
one seat, the seats are `<alias>#1`, `<alias>#2`, … and the files they write are
`review-<alias>-1.md`, `review-<alias>-2.md`, and so on. The same rule names the `judge-`,
`rebuttal-` and `revote-` files below. The Council Workspace reads these names directly: its
allowlist is built from `run.seats`, so each seat's own file opens under that seat.

One case is deliberately left unattributed. When a leg cannot be bound to a seat, the engine still
writes its output — under the **alias**, because that is all it knows (`review-<alias>.md`). That
file stays readable, but it is attributed to **no seat**: `run.json` records that *an* orphan
happened, not *which* seat produced it, and guessing would be exactly the silent mis-attribution
seat identity exists to prevent. If such a name collides with another seat's own artifact — possible
when one alias sanitizes onto another seat's filename — neither is attributed and the run-integrity
banner names both claimants.

Two more files appear when the run was started through **`amicus_council_run`** rather than the
CLI, both written by the MCP handler before it spawns the engine:

```
  briefing.md                 # the briefing the tool copied in (the child briefs off this copy)
  spawn.pid                   # the spawned child's pid
```

`spawn.pid` exists so a child that dies *before* the engine checkpoints its own pid into
`run.json` is still detectable: `amicus status` crash detection and `amicus abort`'s process
fallback both read `run.json`'s pid first and fall back to this file. It is deliberately a
separate single-write file rather than a field patched into `run.json` — the spawning process and
the engine child both write `run.json`, and its checkpoint is a read-merge-write with no
cross-process lock.

`verdict.json` here is the **undecided** verdict — same schema as [`amicus council
verdict`](#amicus-council-verdict)'s output (council family v2) plus **`overallVerdict`**
(`"Ship it" | "Fix these first" | "Fundamental rethink" | null`), parsed from the chair's final
`VERDICT:` line — or, on a task run (`--intent task`, v4.9), `"Converged" | "Split" |
"Insufficient" | null` parsed from its final `ANSWER:` line instead (both scales, and why they
are disjoint, are in the `overallVerdict` key note under [`amicus council
verdict`](#amicus-council-verdict)). Example excerpt:

```json
{
  "schemaVersion": 2,
  "runId": "pr-142-council",
  "chair": "deepseek",
  "overallVerdict": "Fix these first",
  "tierCounts": { "Confirmed": 2, "Contested": 1, "Singleton": 1, "Disputed": 0 }
}
```

One-shot CI-shaped example (this is exactly what the Council Review GitHub Action runs):

```bash
$ amicus council run --models gemini,glm --chair deepseek \
    --prompt-file briefing.md --out-dir council-run \
    --json --max-cost 2.00 --timeout 10 --no-validate-model
```

Consumers gate on **tiers + the chair verdict line** (`overallVerdict`), per the engine's
report-only Stage-4 policy. Headless runs pin `meta.claudeInCouncil: false`,
`meta.runType: "headless"`, and the chair is excluded from the street-cred universe.

### Task mode (`--intent task`)

By default a council **reviews** the material it is given. `--intent task` (over MCP: the `intent`
parameter on `amicus_council_run`, spelled `'task'`) points the same pipeline at **open-ended work**
instead: the bench *produces* what the briefing asks for, and the chair synthesizes an **answer**
rather than a verdict about a review that never happened.

`review` is the default, and it is never stored: `--intent review` is accepted and normalized away
at every door, so nothing writes `intent: "review"` onto `run.json`, `tally.json` or `verdict.json`.
Only `"task"` is ever recorded — the same emit-when-set idiom as `--tag`. Any other value is a
pre-flight `BAD_ARGS` failure before any spend.

**What changes, stage by stage:**

| Stage | Review intent (default) | Task intent |
|---|---|---|
| Stage 1 | *"You are one reviewer… Review the material"* — each seat critiques the briefing | *"you are not reviewing the briefing, you are executing it"* — each seat produces the deliverable, then declares the load-bearing claims it rests on |
| Stage 2 rank | Order the reviews by how **accurate** each critique was | Order the responses from the one that **best does the work the briefing asked for** to the one that does it least well |
| Stage 2 adjudicate | For every finding id, `agree`/`dispute`/`neutral` on the **critique** | For every claim id, `agree`/`dispute`/`neutral` on whether **the claim holds** |
| Chair | `VERDICT: Ship it \| Fix these first \| Fundamental rethink` | `ANSWER: Converged \| Split \| Insufficient` |
| Reliability ledger | One row per (run × model) appended | **Nothing appended** |

**The two scales are disjoint on purpose.** They share no value and no keyword, which is what lets
each parser stay blind to the other's line: a task run can never report `"Ship it"`, and a review run
can never report `"Converged"`. The run's intent is what selects the parser — including on a Stage-5
`amicus council verdict` rebuild long after the run is over, where a carried `overallVerdict` from
the *wrong* scale is refused and the chair's prose is re-parsed instead. Full field semantics are in
the `overallVerdict` and `intent` key notes under
[`amicus council verdict`](#amicus-council-verdict).

**What does *not* change.** The Stage-1 output contract is identical — the same trailing fenced JSON
skeleton, the same `blocker | major | minor | nit` severity enum, the same required-non-empty
`location`, validated by the same validator and repaired by the same bounded repair loop. Only the
frame and the field *glosses* fork. In task mode `location` is the grounding discipline: it names
what the claim rests on — a source, a computation, or the literal word `assumption`. An empty
`findings[]` under a real `overall` is a valid task response, exactly as it is a valid review, and
the bench is told so rather than left to invent claims to fill the array.

Two things a task bundle carries that a review bundle never does: the Stage-2 judge packet ends with
a `--- THE BRIEFING (what every response was asked to do) ---` section — judges cannot rank *how well
the work was done* without the ask — and that section is fenced as reference material, because it is
the first time briefing text reaches a judge in band.

**Task runs write no reliability rows, and say so.** Two gates enforce it (the engine's own append
and `amicus council tally`'s), and `council tally` refuses a `meta.intent` that is neither spelling
rather than letting a near-miss slide into the ledger. Where the skip is **load-bearing** it is
**announced, and the announcement does not degrade the run** — a `Note:` record on the
`ledger-skipped` channel with `kind: "info"`, which the degrade sink cannot use to flip a run's
`degraded` state. ⚠️ It is emitted at one site, not on every task run: the chair-fallback promotion
arm, reached only after the chair's own attempts have all failed and the run still has budget,
because that arm is the one step that draws on ledger history a task run never fed. A task run whose
chair answers has no `ledger-skipped` note, and needs none. `info` records are announcements, not losses: the report gives
them their own **Notes:** list and keeps them out of `## What was lost`. Relatedly,
[`amicus council stats`](#amicus-council-stats) on an empty ledger now names where rows come from
instead of implying that no council ever ran.

**A review cut at its output reservation is announced, not lost** (#218 PR 3). When a Stage-1 leg's
assistant message carries `finish: 'length'` and still delivered answer text, the run prints a
`Note:` on the `output-truncated` channel (`kind: "info"`, so it never degrades the run or moves the
exit code) naming the seat and the engine's reasoning/output token counts for the leg, with `Try:
raise outputBudget…`. A length stop with **no** answer text is a dead leg whose reason starts
`OUTPUT_LENGTH:` — see [Troubleshooting](./troubleshooting.md#headless-leg-fails-with-output_length).

**Read the tiers correctly.** A task run's report carries the line *"Tiers report peer concurrence,
never verification."* directly under the tier counts, and the chair's own packet carries the same
caveat beside the adjudications it is weighing. Peer agreement on a generative bench is correlation
between models trained on overlapping priors — a tier says *how many peers concurred*, never *that
the claim was checked*.

**Review runs are byte-identical.** Not "unchanged as far as we know": the review path composes
through the same dispatcher, and the shared packet — section headers, `Review by <model>` labels,
empty-section wordings — is used verbatim in both intents. One vocabulary, two instructions.

**Limitations, as of v4.9:**

- **One intent per run.** There is no mixed bench; the whole run is a task run or a review run.
- **Intent is not pack-settable.** A [policy pack](./usage.md#policy-packs) cannot carry it — pass
  the flag (or the MCP parameter) explicitly.
- **`--claude-review` is refused with `--intent task`.** Entering a file as review N+1 is review
  machinery and has no task-mode meaning.
- **Task runs build no reliability history**, so they never contribute to — and never benefit from —
  `amicus council stats`, including the ledger-driven chair-fallback promotion.

### Debate mode

`--debate` adds a **Stage-2.5 rebuttal round** between cross-review and the final tally
(COUNCIL-DESIGN.md §12.3): **provisional tally → defense → re-vote → final tally**, exactly
one round.

1. **Provisional tally.** Immediately after Stage-2 cross-review, the engine tallies with
   `--no-ledger` and writes `tally-provisional.json`. If nothing landed Contested or Disputed,
   there is nothing to debate — the engine skips straight to the final tally
   (`debate.outcome: "nothing-to-debate"`).
2. **Defense.** Every Contested/Disputed finding goes back to the **seat** that raised it as one
   concurrent solo run — `rebuttal-<seat>.md` per raising seat — asking for exactly one of
   `DEFEND` / `AMEND` / `WITHDRAW` per finding. A dead or unparseable defense leg means the
   original claim stands undefended.
3. **Re-vote.** Defended/amended findings go back to the **seats** that disputed them, as ONE
   shared fanout wave — `revote-bundle.md` (the shared prompt, written to the run dir like
   Stage 2's `bundle-stage2.md`) + `revote-<seat>.md` per re-voting seat. A missing/unparseable
   re-vote line leaves that seat's original verdict standing.
4. **Final tally.** The engine reassembles the tally input with the defense/re-vote outcomes
   folded in and re-tallies — this final, post-rebuttal tally is the one that appends to the
   reliability ledger (a lens run is the only thing that suppresses the append — `council run` has no `--no-ledger` escape hatch; that flag is parsed only by `council tally`). Withdrawn findings stay
   in `findings[]` and are auto-recorded `denied` at Stage 4 — never presented for a user
   decision.

**Exactly one round** — there is no second defense/re-vote cycle; whatever remains unsettled
after the re-vote keeps its final tier.

**Where it shows up:**
- `run.json`'s `debate` object summarizes the round: `{enabled, outcome, contested, disputed,
  defended, amended, withdrawn, noResponse, revoteJudges, revoteApplied, verdictChanges}`.
  `outcome` is `"nothing-to-debate"`, `"ran"`, or `"skipped-cost-ceiling"` (the whole-run cost
  ceiling was hit before a warranted re-vote).
- Every debated finding in `tally.json`/`verdict.json` carries a `findings[].debate` object —
  `{action: "defended"|"amended"|"withdrawn"|"no-response", previousTier}` — decorating the
  finding with what happened in the round and the tier it held before the re-vote.
- Extra run-dir artifacts, written only when a defense/re-vote actually ran:
  `tally-provisional.json`, `revote-bundle.md`, `debate.json` (the round's structured record),
  `rebuttal-<seat>.md` × (raising seats), `revote-<seat>.md` × (disputing seats).
- **Both waves are sized in seats, so a bench that repeats an alias costs more here.** Two seats
  sharing an alias that both raise a contested finding get two defense solos, and two that both
  dispute get two re-vote legs — up to two extra billed legs per duplicated pair per round, plus a
  bounded repair solo for either of them if its output does not parse. `revoteJudges` above counts
  the re-vote legs; nothing in `run.json`'s `debate` object counts the defense solos, though every
  one of them appends its own wave id to `stages[]` under `debate-defense`.
- `--claude-review <file>` enters Claude's own review (from a file, no leg launched) as a judged
  entry; per the reserved-seat rule, it is never asked to defend in the debate round — its
  Contested/Disputed findings simply stand, the same "originals stand" outcome as a dead defense
  leg.

---

## Council Workspace (GUI)

Watch a council think — not just tail a log:

```bash
amicus watch <councilRunId> --ui     # open one run
amicus watch --ui                    # open the run list for this project
```

This is a third Electron mode (`AMICUS_MODE=council-workspace`), opened by `amicus watch --ui`
itself — not a separate command or a separate launch surface (that's v4.5). One window per
launch:

- **Run list** (bare `--ui`, no id) — every council run in the current project, newest first,
  discovered from the sessions-dir pointer files (`council-<runId>.json`); each row shows status,
  the chair's `overallVerdict` chip once one exists, and cost.
- **Run detail** (`--ui <runId>`) — header + status/verdict chips, a stage rail, a live **Seats**
  table (model, role, status, stage, messages, tokens, cost, last activity, and a trailing flag
  cell — `⏳ stalled` while live, or on a finished run `↻ retried once` marking a reviewing seat
  whose once-only Stage-1 retry didn't save it), the Stage-1 reviews, the **verbatim** anonymized
  Stage-2 packet (`bundle-stage2.md`, shown as-is —
  never re-rendered), judge prose, the **adjudication matrix** (finding × judge, tier-colored
  rows, `a/d/n` basis counts, a `thin` badge when `a+d<=1`, an override badge when a Stage-4
  decision changed a finding's tier, capped at 500 rows with a "showing N of M" note past that),
  dissent drill-in (click a ✗ cell to open that judge's prose with the finding id highlighted —
  the Stage-2 contract carries no structured reason field, so rationale lives in prose; on a
  `--debate` run, a re-voted cell instead opens `revote-<model>.md` and also surfaces the
  structured `reason` `debate.json` records for that re-vote), chair verdict + street-cred +
  Stage-4 decisions, and a cost-by-seat table with a `--max-cost` ceiling gauge. The Seats table
  also lists any seat the run announced dead as a muted, no-cost row, live — as soon as the run
  checkpoints the loss, no terminal wait required (a seat whose errored legs still occupy the
  active stage's roster paints once that stage completes).

**Historical runs** render entirely from the run directory — open any old `council-<runId>` at any
time; nothing here requires the run to still be live.

**Live updates.** While a run is in progress, the window polls the same v4.3 data layer `amicus
watch` reads from a terminal — every 1.5s while the window is visible and focused, every 5s
otherwise, stopping once the run reaches a terminal status. A stall (no leg activity for a while)
surfaces as a banner with an Abort shortcut next to it; if a live-data read itself fails, a
separate "live data unavailable" banner appears while the last-known panels stay on screen — the
poll keeps retrying rather than blanking anything.

**Blind mode** (toggle, top right): labels (`Review A`, `Review B`…) instead of model names —
**ON by default while a run is live, OFF once it reaches a terminal status**, flippable either way
at any time. This is a **reading aid against anchoring bias, not a security control** — the label
map is `run.json`'s own `labelMap` field, sitting in plaintext in the run directory like every
other artifact; nothing stops you opening it in a text editor.

**Masks the roster, not just the seat table** (amended 2026-07-25 — see §6 resolved-Q2 amendment
in the design spec). Blind mode covers *every* place a model id co-occurs with review authorship:
the header's bench/critic/chair chips, the currently-open run's own row in the run-list rail
(its chair chip), seat rows, cost rows, and revote titles — the same `display(pair, blind)`
formatter backs all of them, so there is one place to get this right instead of five. Best-effort
only for other rows in the run list: each row's chair can only be masked when a label happens to
be known for it (in practice, only the currently-open run's own row), so an unopened run's row
still shows its raw chair id — consistent with "reading aid," not a hard guarantee.

**Two verbs, nothing else:**

- **Abort** — confirm-gated, hidden once the run is terminal. It calls the same council-aware
  abort path `amicus abort` uses. This is the one place the workspace changes anything on disk,
  and it does so by delegating to the engine's own abort handling — not a direct write from the
  workspace code itself.
- **Fold** — writes the nonced `[SIDECAR_FOLD:…]` block plus the chair's verdict to the launching
  terminal's stdout (no model call — it reformats what's already on disk). Folding again after a
  successful fold just reports "already folded"; it doesn't write a second time.

Apart from Abort, the workspace is **read-only against the run directory**. `--ui` is
interactive-only — there is no `--json` for it, and passing both fails fast rather than silently
falling back to the terminal renderer. Closing the window never auto-folds — everything is
already on disk, so nothing is lost; reopen with `amicus watch <runId> --ui` and fold whenever
you're ready.

**Degraded states are rendered honestly, never hidden:** a run whose `run.json` can't be parsed at
all shows an "unreadable" banner with the error and the run directory path; a run written by a
different amicus schema version shows a schema-mismatch banner instead of guessing at a rendering;
a tally with fewer than 2 completed judges shows an explicit "tally is peers-reduced" note **above**
the adjudication matrix — the matrix still renders over the surviving judges, and the note is what
stops it being read as more authoritative than the underlying data supports; and a
chair-less verdict (retry + fallback promotion both failed, or the cost ceiling was hit before the
chair ran) shows "no chair verdict" plus the engine's own reason, never a blank panel.

**Posture, briefly** — this page renders another model's prose, so it's the most locked-down page
in the app: full `sandbox`/`contextIsolation`, a minimal preload exposing exactly one `invoke()`
gated by a 7-channel allowlist, a CSP with **no network directive at all** (`default-src 'none'`),
and every model-derived string reaches the DOM through `textContent`/`createTextNode` only —
never `innerHTML`, enforced by a static source scan in the test suite.

### Auto-open on `amicus_council_run` (v4.5)

The window above no longer needs a separate `amicus watch <runId> --ui` call every time. When the
**MCP tool** `amicus_council_run` is invoked from **Claude Code (local)**, Amicus launches this same
Council Workspace window automatically, detached, right after the run starts — the flagship v4.4
surface is no longer opt-in on the client best able to show it. The plain CLI `amicus council run`
is unaffected: `detectClient` (`src/utils/client-detect.js`) only resolves from the MCP `initialize`
handshake, so a terminal invocation has no client to detect and never auto-opens; use
`amicus watch <runId> --ui` there as before.

**Decision order** (`shouldAutoOpenWorkspace`, `src/sidecar/workspace-auto-open.js`) — read top to
bottom, first match wins:

1. The tool's `ui: false` param — **beats everything**, including every guard below.
2. The hard guards, which beat even an explicit `ui: true`: Electron is not installed (this path
   **never** installs it — that would be a surprise ~100 MB download on someone's first MCP council
   run) → does not open; on Linux, no `DISPLAY` in the environment → does not open.
3. The tool's `ui: true` param — overrides both the config key and the client check below (but
   never a hard guard above).
4. `workspace.autoOpen === false` in `config.json` (see
   [Configuration § Config file format](./configuration.md#config-file-format)) → does not open.
5. The caller isn't Claude Code (local) (i.e. `client !== 'code-local'` — Claude Desktop/Cowork and
   Claude Code web are deliberately excluded from the default) → does not open.
6. Otherwise → opens.

**Response fields.** `amicus_council_run`'s result always carries `workspaceOpened: boolean`, and,
**only when it did not open**, `workspaceOpenReason` — one of `param-suppressed`, `electron-absent`
(the electron package was never installed for this copy), an `electron-broken:` detail (the package
is present but its binary never arrived — interrupted download or AV quarantine; the reason names
the electron dir and points at `amicus doctor --fix`), `no-display`, `config-disabled`,
`client-not-code-local`, or a `spawn-failed:`/`auto-open-failed:`
detail if the decision said to open but the launch itself failed. The launch is fire-and-forget: it
never blocks the tool's response, and a launch failure never fails the council run itself — the run
proceeds exactly as it would with no Workspace at all, and `amicus watch <runId> --ui` still works
as the manual fallback.

**The `ui` param and the `workspace.autoOpen` config key are independent knobs, not aliases of each
other** — `ui` is a **per-call** override (either direction), while `workspace.autoOpen` sets the
**standing default** every call without an explicit `ui` falls back to. Turning the config default
off does not stop you from asking for the window on one particular run with `ui: true`, and leaving
the default on does not stop you from suppressing it on one noisy run with `ui: false`.

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
- `findings` is present and is an array — `EMPTY_FINDINGS` if it is missing or is some other
  type. **An array that is present and empty is valid**, provided `overall` is a non-empty
  string; `EMPTY_FINDINGS` if the array is empty *and* `overall` is missing, blank, or not a
  string. See "A clean review is a valid review" below.
- Every finding has a **sequential integer `id`** starting at 1 (`NON_SEQUENTIAL_ID` /
  `DUPLICATE_ID` otherwise), a `severity` in `{blocker, major, minor, nit}` (`BAD_SEVERITY`
  otherwise), and non-empty string `claim`, `location`, `rationale` (`MISSING_FIELD` otherwise).

**A clean review is a valid review.** A reviewer that read the material, found nothing wrong,
and said so passes validation with `"findings": []` — it is not sent to a repair re-prompt and
its seat is recorded `conformance: clean`, exactly like any other well-formed review. Three
things make that safe:

- A **broken** emit is a different outcome with its own code: no fenced block at all is
  `NO_FENCED_BLOCK`, and a block that does not parse is `NOT_PARSEABLE`. Both return before the
  empty-set rule is ever reached, so "my output broke" is never mistaken for "I found nothing".
- **`overall` is what carries the claim.** An empty findings array with a blank, missing, or
  non-string `overall` is a hollow shell, not a judgement, and stays `EMPTY_FINDINGS`. The
  Stage-1 briefing states the same rule to the model: `overall` is always required, `findings`
  may be `[]`, and a finding is never to be invented to fill it.
- A **missing** `findings` key is not a declaration of zero and stays an error. Only an array
  that is present and empty counts as "I found nothing" — the same line `countAttemptedFindings`
  draws when it checks a repair against the count the original declared.

This closes a contradiction that used to be shipped in every run: the anti-sycophancy clause in
each Stage-1 briefing says "An empty severity category is a valid result", while the validator
rejected exactly that answer — so the only way for a reviewer to satisfy the schema was to
produce a finding. Downstream, an all-clean bench degrades cleanly rather than silently: Stage 2
still runs (the peer **ranking** — and therefore street-cred — is unaffected by an empty findings
pool, only the adjudication half is vacuous), the judge bundle and chair packet state the empty
findings index explicitly instead of rendering a heading over nothing, `tierCounts` comes out
all-zeros, per-model `confirmRate`/`factErrorRate` are `null` (no denominator to divide by), and
a `--debate` run records `debate.outcome: "nothing-to-debate"` on `run.json`.

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
summary, or the full record with `--json`), and — unless `--no-ledger` — appends one row per distinct
(`model`, `resolvedModel`) pair to the reliability ledger (v4.8 — see **Ledger append** below;
that is one row per model on an ordinary bench). Thin CLI wrapper over `tally()`
(`src/council/tally.js`).

### Tally-input schema

Claude assembles this file at the end of Stage 2 (the full assembly recipe is in
[SKILL.md](../skills/second-opinion/SKILL.md#the-engine-run--stages-13-plus-the-stage-5-artifacts),
under "Stage-2 → tally assembly recipe"). It needs **all five top-level keys** — `tally()` throws
`Cannot read properties of undefined (reading 'map')` if `meta` or `findings` is missing:

| Field | Type | Meaning |
|---|---|---|
| `meta.runId` | string | Run identifier (conventionally the run-folder stem). |
| `meta.models` | string[] | Every reviewed model id, including `"claude"` when "Claude in the council" is on — this is the street-cred universe: `streetCred[]` has exactly one row per `meta.models` entry, always (`streetCred.length === meta.models.length`, holds on any input — **v4.8 follow-up**, closing a case where a `meta.seats` table that disagreed with `meta.models` in count used to drop or invent a row), in `meta.models` order — the k-th occurrence of a repeated alias takes the k-th row, so a non-adjacent repeat (e.g. `["a","b","a"]`) is never grouped by alias. |
| `meta.chair` | string | The confirmed chair model id. |
| `meta.claudeInCouncil` | boolean | The Stage-0 toggle. |
| `meta.runType`, `meta.date` | string (optional) | Free-form labels carried through to `verdict.json`. |
| `meta.seats` | array (optional) | **v4.8** — the run's seat table, one `{id, alias, role, lens, position}` entry per **bench** seat in bench order. The engine emits it **only when the bench repeats an alias**: that is the one case where the `alias#N` ids on `findings[].raiserSeat`, `adjudications[].seat` and `runStats[].seat` resolve to nothing else in the document, since `meta.models` is the *alias* list. Bench-only — `claude` is never a seat, so never assume `meta.models.length === meta.seats.length`, and never join the two positionally. ⚠️ **Absence never means "the bench had no repeated alias."** Hand-assembled and MCP-assembled tally input reaches `tally()` with no seat machinery behind it at all; absence means only "no seat table available". |
| `findings[]` | array | One entry per finding across all reviews: `{id, raiser, severity}` (`claim` may ride along but isn't required by the tally engine). `id` is the run-global label (e.g. `A1`, `B2`) assigned during Stage-2 assembly, not the reviewer's local integer id. `raiserSeat?` (**v4.8**) — the raising **seat's** id (`deepseek#1`), emit-only-when-it-differs-from-the-alias, so a bench with no repeated alias never carries it. `raiser` stays the alias in every case. |
| `adjudications[]` | array | One entry per (judge × finding): `{findingId, judge, verdict}`, `verdict ∈ {agree, dispute, neutral}`. `seat?` (**v4.8**) — the judging **seat's** id, on the same emit-when-different terms as `findings[].raiserSeat`; `judge` stays the alias. Include every judge's verdict on every finding, **including the raiser's own adjudication of its own finding** — the engine excludes it automatically when scoring (don't pre-filter it). ⚠️ **v4.8: that exclusion is seat-conditional.** When a vote *and* its finding both carry a seat id, the engine compares **seats** (`v.seat !== f.raiserSeat`), so on a bench that repeats an alias a twin's genuine vote on its twin's finding is now counted instead of discarded. When either side carries no seat id — a legacy document, a hand-assembled one, or a real run whose leg failed to bind to its seat — it falls back to comparing **aliases**, which is the pre-v4.8 behaviour and still drops that twin's vote. Never fill in a seat id you did not observe just to unlock the seat compare. ⚠️ **`""` is not a model id.** The schema accepts an empty string for `raiser` and for `judge`, but the engine cannot identify a vote it has no name for: when a finding's `raiser` is empty or missing, every vote whose `judge` is also empty or missing is excluded from `basis` and counted in `findings[].unattributedPeerDrops`. A **seat id on both sides overrides this** — it is a stronger identity than either name, so a seated vote is scored (or excluded as the raiser's own) regardless of what `raiser` and `judge` say. Send the real alias, or expect the vote not to be scored. |
| `rankings[]` | array | One entry per judge: `{judge, order}`. `order` is that judge's `FINAL RANKING:` block translated to model ids, e.g. `["gpt", "deepseek"]` (ties may use a nested array, e.g. `[["gpt","deepseek"], "mistral"]`). `seat?` (**v4.8**) — the judge's own seat id, on the same emit-when-different terms as `adjudications[].seat`; `judge` stays the alias. `orderSeats?` (**v4.8**) — the seat-valued parallel of `order`, slot for slot (a tied slot is a nested array there too): each slot is a seat id where the ranked model's seat is known, `null` where it is not, and the whole key is emitted only when at least one slot is non-null. **Two consumers read it.** Street cred keys on `orderSeats` when present and falls back to the alias otherwise — the mechanism that lets a twin bench's two street-cred rows diverge instead of collapsing into one. **v4.8** — the **chair packet** is the second: its peer-rankings block zips `orderSeats` onto `order` slot for slot, so the chair reads seat ids where the run knows them and the ranked alias where it does not. A tied slot is zipped element by element, and a `null` slot renders the alias rather than the word `null`. |
| `runStats[]` | array | One row per paid launch (v4.7 spec §5 D1/D2 — no longer capped at one row per model; see the role roster below): `{model, role, wasChair, conformance, status, durationMs, usage, waveId?, resolvedModel?, seat?}`. `seat?` (**v4.8**) is the row's seat **id**, emit-only-when-it-differs-from-that-seat's-own-alias — so only a bench that repeats an alias carries it. Only the two producers that *have* a seat pass one: the primary reviewing-seat rows and the dead-seat rows. A `judge`, `chair-attempt`, `repair` or `superseded` row never carries it (all four are excluded from the ledger join, so a seat stamp there could never win it), and neither do the off-bench chair rows or the synthetic `claude` row, which have no seat at all. Two seats of one alias that **both** died usually get **two** rows: each carries its own `seat` id where the run bound that seat's leg, and **no** `seat` where it could not — an unidentified dead seat is counted but never named. They still collapse into a **single** row in two cases, both of them seats the run genuinely cannot tell apart: both legs missing a task id, and a run with no seat table behind it — the deliberate floor, since inventing an identity there would be a guess. A retry wave that came back with **fewer legs than it launched** was a third such case and is **no longer**: v4.8 T-A4 made the retry reconcile count a key's SLOTS rather than test its presence, so both twins get a row (measured end to end through `runStage1`: 1 primary dead-seat row before, 2 after, with the superseded rows unchanged at 2 — one of the two rows carries `usage: null`, and **which one is arbitrary**: neither row names a seat, so the alias's billed total is split across its anonymous rows by row ORDER, never by identity). ⚠️ **Corrected in v4.8** — this cell previously claimed the two *always* collapse into one row carrying no `seat`. That was already wrong for **bound** twins the day it was written (the two-row behaviour landed 2026-08-13, this sentence 2026-08-14), and v4.8 closed the unbound half for every retry outcome, the partial return included (that last one in T-A4). May be `[]`. Any leg with no run document gets `durationMs: null, usage: null` — never invent a value. `waveId` is emit-only-when-set. `resolvedModel?` (v4.7) — the executable id that actually served the row's leg, emit-only-when-set; leg-less rows (the give-up chair row, dead seats with no leg, the claude row) never carry it. `model` stays the council alias. ⚠️ **One row shape carries `usage` with NO `waveId`, `resolvedModel` or `durationMs` (v4.8)**: an unidentified dead seat on an alias the bench repeats, where the run holds a billed retry leg it cannot attribute to either twin. The cost is real and is counted in the run total, but every per-seat execution fact is withheld rather than guessed — so do **not** assume `usage` implies `waveId`, and do not treat a null `durationMs` as "this seat cost nothing". |

**`runStats[].role` roster (v4.7 row-per-launch).** Every leg the run budget counts gets exactly
one row, so a seat that needed a repair or lost a leg to a retry can now show up more than once.

*Primary rows* — exactly one per requested reviewing seat, unchanged in shape from pre-v4.7:
`seat`, `critic`, `lens:<slug>`, `judge`, `chair` (`wasChair: true`), synthetic `claude`, and the
legacy default `council` (pre-#83 rows, or hand-assembled tally input that never set a role). A
dead seat/critic/lens with no recovery, and a chair walk that gives up entirely, get an honest
primary **error** row too — the #83 judge treatment extended to every seat (`usage: null` on the
give-up chair; the dead leg's own usage on a dead seat/critic/lens).

*Non-primary rows* — `wasChair` always `false`: `chair-attempt` (a failed ch1–ch3 chair launch),
`repair` (a Stage-1 `-p`, Stage-2 `-q`, chair-ch4, or debate-born `-d<N>r`/`-rv-…r` solo — a
failed defense or re-vote repair), and `superseded` (a first leg a later attempt replaced — an
SL-2 retry or a debate repair) — all three new in v4.7's row-per-launch change — plus `rebuttal`
and `revote` (a `--debate` round's defense/re-vote legs; v4.1, pre-dating row-per-launch). All
five still cost money and land in `runStats`, so they raise the run's totals everywhere those are
summed. In `council report`'s cost table only `judge`/`chair-attempt`/`repair`/`superseded` get a
suffixed label (`rebuttal`/`revote` render unsuffixed); `council tally` has no per-row cost table
at all, only an aggregate. And only `chair-attempt`/`repair`/`superseded` are filtered out of the
Workspace seats panel — `rebuttal`/`revote` rows still render there.

`runStats[].waveId` names the exact wave/leg a row was built from, present **iff the row can
name a billed leg as its OWN** — e.g. the synthetic `claude` row, a give-up chair's error row, and a
leg-less dead-seat/critic/lens primary error row (the two SL-2 retry note-classes that never
produced a real leg for the seat at all) carry none. ⚠️ **Corrected in v4.8** — this read *"iff a
real billed leg backs the row"*, which stopped being true when unidentified dead twins gained the
row shape described in the `runStats[]` cell above: a real billed leg backs those rows (their
`usage` is on the record and in the run total) and they still carry no `waveId`, because the leg
belongs to a seat the row cannot claim to be. **So `waveId` is not a safe filter for "rows carrying
billed usage" — read `usage` for that.** It's the join key the leg–row bijection
invariant suite (`tests/council/run-cost-bijection.test.js`) uses to prove every budget-counted
leg lands on exactly one row. `resolvedModel` follows the same emit-only-when-set discipline and
the same never-invent rule — it is never derived from the alias.

**Ledger-join consequence.** `council stats`'s reliability aggregation (`ledger.js`) only reads
rows whose role is in the allowlist above (`seat`, `critic`, `lens:*`, `chair`, `claude`,
`council`, `redteam`) — everything else, including all three new non-primary roles and any
custom/free-form label a skill or caller invents, is fail-closed excluded and never contributes
role/wasChair/conformance to reliability stats, even though it still renders in the tally/report
artifact. Since v4.7 the ledger row copies the joined row's `resolvedModel` and `council stats`
groups by `resolvedModel || model` — see the stats section below.

### Tally-record schema (what `tally()` returns / prints)

```json
{
  "schemaVersion": 2,
  "type": "council-tally",
  "meta": { "...": "echoed from input" },
  "judged": true,
  "streetCred": [ { "model": "gpt", "withSelf": 1, "peersOnly": 1, "perJudgeRank": { "...": "..." }, "seat": "gpt#1" } ],
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
| `schemaVersion` | Tally-record schema version (currently `2`, council family v2 — see `type` below). This is a *separate* version line from the `--json` **error-envelope** schema version used by `BAD_ARGS` failures (also currently `2`) — the two happen to share a value right now but evolve independently; don't conflate them when scripting against output. |
| `type` | Document-type discriminator; always `"council-tally"` (council family v2 envelope). |
| `judged` | `true` only when `rankings.length >= 2`. `false` (1 or 0 rankings) means street-cred numbers exist but rest on thin cross-review. |
| `streetCred[].withSelf` | Mean rank position across **all** judges' rankings (lower = better). **v4.8: `streetCred[]` is now one row per SEAT, not one row per alias** — a bench that repeats an alias used to emit two byte-identical rows under that shared alias; each seat now gets its own row, with its own numbers. A unique-alias bench is unaffected: one alias is one seat there, so the row set and every number stay byte-identical to before. |
| `streetCred[].peersOnly` | Mean rank position excluding this row's own ranking of itself (lower = better). **v4.8: the exclusion is seat-conditional.** When this row and a judge both carry a seat id, the engine compares **seats** — so on a bench that repeats an alias, a twin's OTHER seat is a real peer and its ranking of this seat counts, even though it shares this row's alias. Only when either side lacks a seat id (a unique-alias bench, or a document with no seat channel) does it fall back to comparing **aliases**, which is the pre-v4.8 behaviour and the only case a document without seats can produce. This is the number used everywhere else (ledger, `stats`, bench recommendations). |
| `streetCred[].seat` | **v4.8**, optional. This row's own seat id, on the same emit-when-**different**-from-the-alias terms as the tally-input schema's `rankings[].seat` above. Absent unless the bench repeated an alias. |
| `findings[].tier` | One of `Confirmed \| Contested \| Singleton \| Disputed` — see the cascade below. |
| `findings[].basis` | `{a, d, n}` = peer agree/dispute/neutral counts (the raiser's own vote is excluded when a raiser is known). **v4.8: the exclusion is seat-conditional.** When the vote *and* the finding both carry a seat id the engine excludes by **seat**, so a twin's real vote on its twin's finding now counts; otherwise it falls back to excluding by **alias**, exactly as before. Consequence on a bench that repeats an alias: findings move tier in **both** directions — a lone twin corroboration promotes `Singleton → Confirmed` and `thin → solid`, and a twin *dispute* can demote `Confirmed → Contested` or `Contested → Disputed`. ⚠️ **v4.8: the seat comparison decides first, and it no longer needs a known raiser.** When the vote *and* the finding both carry a seat id, that pair settles it however `raiser` reads: same seat means the raiser's own vote (excluded), different seats mean a real peer (counted). Only when the seats cannot decide does the raiser's name matter. ⚠️ **And when the raiser is *not* known, every vote whose `judge` is equally unidentifiable is excluded too.** An empty-string or missing `raiser` is not an identity, so a vote with an empty-string or missing `judge` cannot be told apart from the raiser's own and does not count as peer signal; every **named** judge still counts. Together these close the case where a finding's own raiser voted its finding up — a document with `raiser: ""` and a `judge: ""` vote used to score that vote into `basis`, and so did one whose vote carried the raiser's own seat id. Votes excluded because nobody could attribute them are announced in `unattributedPeerDrops` below; votes the seats attributed are not, because nothing about them is ambiguous. The tier can fall as a result — a finding whose only votes are unidentifiable is `Singleton`, not `Confirmed` or `Disputed`. |
| `findings[].confidence` | `"thin"` when `a + d <= 1` (only one peer engaged), else `"solid"`. Thin-confidence findings are the ones Claude may override before Stage 4. |
| `findings[].tierOverride` | `null` unless Claude recorded an override; shape `{from, to, reason}`. |
| `findings[].raiserSeat` | **v4.8**, optional — echoed verbatim from the input finding (see the tally-input schema above). Absent unless the bench repeats an alias. |
| `findings[].sameModelCorroboration` | **v4.8**, optional, `true` only — a warning stamp: after the seat-aware exclusion above, at least one *agreeing* peer of this finding shares the raiser's **alias**, i.e. the corroboration came from another seat of the same model and is not independent. Emitted only when true (never `false`), so a document without it is byte-identical to a pre-v4.8 one. ⚠️ **Alias-only, and it errs in both directions:** it *misses* `--models gpt-5,openai/gpt-5` (genuinely one model under two aliases — votes carry no `resolvedModel` to compare) and it *fires falsely* on a **split alias**, one alias whose two seats happened to resolve to different executables. The reliability ledger uses a different notion of identity for the same run — it treats `(alias, resolvedModel)` as the key — so the two documents can disagree about what "the same model" means. Treat the stamp as "worth a second look", never as proof. |
| `findings[].unattributedPeerDrops` | **v4.8**, optional, integer `> 0` only — a count of the votes excluded from `basis` that the engine could not attribute to anyone. **Two shapes produce it.** (1) *Raiser named:* the alias fallback excluded a vote while exactly one side of the pair (the finding's `raiserSeat` or the vote's `seat`) carried a seat id and the other did not — a seat-less vote sharing the raiser's alias cannot be told apart from the raiser's own, so excluding it is the safe call **and** may be discarding a real twin's signal. (2) *Raiser not named:* the finding's `raiser` is empty or missing and so is the vote's `judge`, so the vote may be the unnamed raiser's own. ⚠️ **Neither shape includes a vote the seat ids settled.** When the vote and the finding both carry a seat id the engine knows whose vote it is, so excluding it *attributes* it rather than losing it and nothing is announced — this count is for genuine ambiguity only. Emitted only when `> 0`, so a document with no unattributable drop is byte-identical to a pre-v4.8 one. ⚠️ **On shape (1) this field announces the drop; it does not change it.** That vote was already excluded from `basis` before v4.8 and still is — deliberately, by owner ruling R2. ⚠️ **And shape (1) records a POSSIBLE loss, not an established one.** A seat-less vote sharing the raiser's alias is *either* a real twin's signal being discarded *or* the raiser's own vote being correctly excluded — the shape is defined by the engine not being able to tell, so it cannot also be read as knowing. Not being able to tell is precisely why the drop is **announced** rather than silently taken. SI-22.1 / SI-22.2 track that possibility, which this release does not close; they do not record a loss anyone has established. ⚠️ **On shape (2) the exclusion *is* the change**, and `basis` moves: those votes used to be counted, which let an unnamed raiser corroborate its own finding. It is not yet rendered anywhere. As of v4.8 T2.3 the only **artifacts** it reaches are the tally documents — `tally.json`, and `tally-provisional.json` on a debate run, which is the same `tally()` record written as an audit artifact before any debate leg launches. `verdict.js`'s findings literal is closed and does not copy it, so it never reaches `verdict.json`; `debate.json`'s findings rows are built from a separate closed literal, so it never reaches those either; and no renderer (`council report`, the Workspace matrix, the defense brief) displays it. ⚠️ It **is** present in memory, on the `byRaiser` rows `debate.js`'s `debateTargets` hands to the defense brief — the brief simply never prints it. |
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

**Ledger append.** Unless `--no-ledger`, `tally` writes one row per distinct
(`model`, `resolvedModel`) pair on the bench to `council-ledger.jsonl` (append-only, JSON Lines).
That is one row per `meta.models` entry on an ordinary bench, where every alias is unique and
contributed exactly one joinable `runStats` row — but **not** when one alias was served by one
executable across more than one seat (v4.8): `--models a,a` whose two seats resolved to the same
executable writes **one** row, not two, and a chair that is also a bench seat writes one row when
its chair leg and seat leg resolved to the **same** executable and **two** when they resolved to
different ones. An alias whose seats resolved *differently* writes one row per executable, so no leg
is erased. Two *distinct* aliases that share one resolution still write one row **each** — the
collapse is per alias; it is `council stats` that aggregates them into one executable-keyed group.
Use `--no-ledger` for a re-tally that shouldn't
double-count (e.g. re-running after fixing a malformed input): a re-tally appends a second full set
of rows, which **doubles the conformance histogram** in `council stats` (a tally — nothing divides
it). It does **not** move the lifetime averages: a duplicated set of rows has the same mean as the
original. Since v4.8 it no longer doubles `runs`/`low-N` either — those count distinct `meta.runId`
values, and a re-tally of the same input carries the same one — so a harness that writes a
**constant** `runId` across genuinely different runs will pin that group at `runs: 1` forever.
⚠️ That holds only when `meta.runId` is a **non-empty string**. `council-tally.schema.json` declares
it as a bare `string`, so `"runId": ""` is valid input, and an empty string is not an identity —
each such row counts individually, so re-tallying *that* file still inflates `runs` and `low-N`.
Measured on a one-model bench, three tallies of the same input: `runs` 1 → 2 → 3, with `low-N`
clearing on the third. A numeric `runId` behaves identically; a real string stays pinned at 1.
Two standing uses from the skill's
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
`adjudications`, `raiserSeat`, `sameModelCorroboration`, `streetCred`, `runStats`, `tierCounts`)
passes through from the tally record unchanged, and `meta.seats` is carried across as the
top-level `seats`.

⚠️ **`buildVerdict` is a closed projection, not a copy.** Both of its literals name every key they
emit — the top level renames `meta.models` to `council`, and each finding is rebuilt from a fixed
field list — so a key added to the tally record does **not** reach `verdict.json` until it is
named here. That is why the v4.8 keys below each needed their own line.

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
  "streetCred": [ { "model": "gpt", "withSelf": 1, "peersOnly": 1, "seat": "gpt#1" } ],
  "runStats": [ "..." ],
  "tierCounts": { "Confirmed": 1, "Contested": 1, "Singleton": 1, "Disputed": 0 }
}
```

**Key notes:**
- `schemaVersion` — verdict-document schema version (currently `2`).
- `type` — document-type discriminator; always `"council-verdict"` (council family v2 envelope).
- `overallVerdict` — the chair's terminal-line outcome, on **one of two disjoint scales, chosen by the run's intent**. A review run (no `intent` key) carries a verdict-scale value — `"Ship it"`, `"Fix these first"`, `"Fundamental rethink"` — parsed from the chair's `VERDICT:` line. A **task run** (`intent: "task"`, v4.9) carries an answer-scale value — `"Converged"`, `"Split"`, `"Insufficient"` — parsed from the chair's `ANSWER:` line. The two scales share no value and no keyword, which is what lets each parser be blind to the other's line; a task run therefore never reports `"Ship it"`, and a review run never reports `"Converged"`. `null` on either scale when no chair terminal line was produced (populated by the headless engine during Stage 3; `null` for a plain `council verdict` merge without engine integration).
- `intent` — **v4.9**, optional, `"task"` only. Present exactly when the run was launched with `--intent task`; absent means review — the engine never writes `"review"` (emit-when-task, the same idiom as `tag`). It is the key every renderer forks on: the report's concurrence qualifier and header word, the fold's and the Workspace chip's `ANSWER:`/`VERDICT:` label, and the chair's own packet/parser upstream of this document.
- `seats` — **v4.8**, optional. The tally record's `meta.seats` (same `{id, alias, role, lens, position}` shape), promoted to the top level next to `seatLoss`. Present only when the tally record carried one, i.e. only when the bench repeated an alias. It is what makes the `alias#N` ids on `findings[].raiserSeat`, `adjudications[].seat` and `runStats[].seat` resolvable from the verdict **alone** — before v4.8 the verdict named seats it could not resolve. `council report` reads it to give each seat its own adjudication-matrix column; when it is absent, or is not an array of objects each carrying a string `id`, the **adjudication matrix** falls back to alias space whole and renders exactly as it did before v4.8. ⚠️ **That fallback is the matrix's alone — it is not a whole-document guarantee.** The street-cred table beside it labels each row from `streetCred[].seat` whenever the row carries one, a predicate independent of this key, so a verdict with seated `streetCred[]` rows and no usable `seats` renders seat ids in the street-cred table and aliases in the matrix (measured on an absent `seats`, a non-array `seats`, and an array-of-strings `seats`). In-process both fields come from the same twin bench and travel together; the split is reachable on a hand-assembled or externally-supplied record, which `buildVerdict`'s own docblock names. A verdict written before v4.8 carries no `streetCred[].seat` at all and is unaffected.
- `findings[].raiserSeat` — **v4.8**, optional. The raising seat's id, carried through from the tally record; absent unless the bench repeated an alias. `findings[].raiser` stays the alias.
- `findings[].sameModelCorroboration` — **v4.8**, optional, `true` only. Carried through from the tally record; see the tally-record notes above for the stamp's meaning **and for the two directions in which it is wrong** (it misses one model behind two aliases, and it fires falsely on one alias behind two executables).
- All other keys (`runId`, `council`, `findings`, `streetCred`, `runStats`, `tierCounts`) are passed through unchanged from the tally record.

**Write path:** always atomic — a `<out>.tmp-<pid>` file is written first, then renamed over the
target (`writeVerdictAtomic`), matching the repo's `wave.json` convention. Default output path is
`./verdict.json`; override with `-o`/`--out`.

**Re-rendering after Stage 4 (`--render`).** `council verdict`'s `--render` flag refreshes
`report.html` next to the freshly-decided verdict in the same call — without it, `report.html`
stays the engine's undecided pre-Stage-4 render, and a user opening it would see decisions that
were never actually made. It calls the same renderer `amicus council report` uses
(`buildReport(..., {format: 'html'})`) and writes the HTML into the output path's directory; a
render failure after a successful verdict write reports the error but leaves `verdict.json` on
disk (re-run `amicus council report <verdict.json> --html` manually to recover — the verdict
itself is not lost). The MCP equivalent is `amicus_verdict`'s `render: true` + `outDir:
<run-folder>`. Because that tool is pure/stateless and writes nothing unless both are given, this
is a **second** call after the first: call once with `record`/`decisions` and no `render` to get
the decided verdict back as JSON and write it to `<run-folder>/verdict.json` yourself, then call
again with `render: true` and `outDir: <run-folder>` — this refreshes `<outDir>/report.html` on
disk and also returns the verdict's Markdown rendering (for `report.md`); it still does not write
`verdict.json` itself.

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
wrapper over `buildReport()` (`src/council/report.js`, which builds the neutral model and
dispatches to `report-md.js` / `report-html.js` — the two renderers that own the string formats).

**What it renders**, in this order: a header (run type, id, date, chair, council members), a
tier-count summary table — headed **Verdict summary** on a review run and **Answer summary** on a
task run, since a task run produces an answer, not a verdict, and on a task run followed by the
one-line concurrence qualifier (*tiers report peer concurrence, never verification*) — a
**What was lost** section
when the run degraded (plus a **Notes** list for informational records, e.g. a task run's
ledger-skipped announcement), the **adjudication matrix** (finding × judge, `✓`/`✗`/`–` with
`*` marking the raiser's own vote), the **peers-only street-cred table**, **findings grouped by
tier** (Disputed first), and a **cost table** (per-model status/duration/cost + wave total,
sourced from `runStats[].usage`).

⚠️ **v4.8 — on a bench that repeats an alias, the matrix is keyed by SEAT.** When `verdict.json`
carries a `seats` table the columns are titled `deepseek#1` / `deepseek#2` rather than two
identical `deepseek` headers, the Raiser cell names the raising **seat**, and the `*` marks that
seat's column only — so exactly one of two same-alias columns carries it. This is a bug fix as
much as a rename: the old alias key was **last-wins**, so the second seat's vote overwrote the
first's and a finding whose `basis` was `a0/d1` could render as two agreements, both starred. Now
the rendered row and the finding's `basis` agree. **Benches with no repeated alias are
byte-identical to v4.7** — every seat id there *is* its alias, so nothing in the document differs
and nothing in the render does either. A verdict with no `seats` table renders its **matrix** in
alias space exactly as it always has — including anything written before v4.8, which carries no
seat fields at all. ⚠️ **The street-cred table below the matrix is not covered by that sentence.** Its row labels
come from `streetCred[].seat`, never from `seats`, so a hand-assembled verdict carrying seated
street-cred rows without a usable `seats` table shows `deepseek#1`/`deepseek#2` there while the
matrix stays in alias space. See the `seats` key note in the verdict-document schema above.

⚠️ **v4.8 — the `UNATTRIBUTED` column.** A vote the matrix cannot attribute to a column is no
longer dropped from the render. The vote→column join **refuses** a key that identifies nothing — an
empty string, a missing or non-string `judge`, or a seat id or alias that names no column on the
bench — and folds every such vote into one extra column, headed `UNATTRIBUTED` and placed last
among the judge columns. This closes the gap this section used to disclose: a judge whose Stage-2
leg never bound to its seat emits no `adjudications[].seat`, so in seat space its vote keys to a
bare alias no column reads. Before v4.8 that vote counted in `basis` and rendered nowhere; now it
counts in `basis` **and** renders.

- **`basis` does not move.** This is a rendering change only — such a vote was always counted and
  still is. It is the same property the seat re-key above exists for: what the row shows and what
  `basis` says now agree.
- **The column appears only when a vote actually folds.** A document in which every vote is
  attributable renders exactly as it did before — no extra column, and never an empty one.
- ⚠️ **Read the header as “no column on this bench”, not “nobody knows who voted”.** The rule the
  renderer applies is about the **column**, not the voter: a vote lands here when its key names no
  column on *this document's* bench. Usually that also means the voter is unidentifiable — but not
  always. A vote whose `judge` names a model the report deliberately keeps off the bench folds here
  too, with its `judge` field intact in the document. The column says *this vote had nowhere to go*.
- **Every folded vote on one finding shares one cell, last-wins.** One column is the deliberate
  design — it records a fact about the document, not one per voter — so two folded votes on the same
  finding collapse to the later one's verdict. What tells them apart is a seat id, and supplying one
  is a producer-side fix, not a rendering one.
- **The Council Workspace matrix applies the same refusal**, over the `tally.json` roster described
  in the paragraph below. The two are deliberately separate implementations rather than a shared
  module, and they are held in agreement by an exhaustive cross-product test rather than by
  construction. ⚠️ **One known exception, disclosed rather than fixed:** on a
  `--claude-review` run the report filters the reserved `claude` seat off its bench while the
  Workspace keeps it, so a hand-authored `judge: "claude"` vote folds to `UNATTRIBUTED` in the
  report and lands in the `claude` column in the Workspace. No engine run emits such a vote. The
  two rosters are built from different sources, and reconciling them is deliberately out of scope
  here.
- ⚠️ **One residual, disclosed rather than fixed:** if a bench seat is *literally* named
  `UNATTRIBUTED`, no extra column is added and folded votes land in that seat's own column. Nothing
  reserves the name, so this is reachable only by naming a seat that way on purpose.
- This is **not** the same thing as `findings[].unattributedPeerDrops` in the tally-record schema
  above. That field counts votes the *peer filter* excluded from `basis` on the raiser side, and
  ruling R2 deliberately leaves those excluded; this column renders a vote that
  **is** in `basis` but had no column to land in. Different mechanism, different document, opposite
  effect on `basis`.

In the Council Workspace the same matrix is built from `tally.json` (via `tally.meta.seats`) and
behaves identically, with one deliberate difference: it keeps rendering the blank `claude` column
that the report filters out. **Blind mode never renders a seat id** — a seat id contains its
alias, so both twins collapse to `Review A` there, exactly as before v4.8. Its legend is worded
`* raiser` where the report's reads `` `*` raiser's own vote ``; the two say the same thing, and
both now refer to the raiser's seat. The report's legend gains a **second** line the Workspace
matrix does not carry — `` `†` `` marks a finding corroborated only by another seat running the
same model — so from v4.8.0 the two legends are no longer interchangeable. That line, and the `†`
itself, appear only on a run that actually raised such a finding, which is a twin bench only.

⚠️ **v4.8 filed a SECOND report/Workspace divergence, in the street-cred table — CLOSED in v4.9.**
The sentence above is scoped to the **matrix**, and stays true. All three street-cred renderers now
label each row `seat || model`: `report-md.js` and `report-html.js` (v4.8), and the Workspace's own
(`electron/workspace-ui/workspace-matrix.js :: renderVerdict`, v4.9). A twin bench reads
`gemini#1` / `gemini#2` in every one of them, instead of the Workspace reading `gemini` twice with
different numbers under one identical name; on any bench with no repeated alias all three are
unchanged, because every seat id there *is* its alias. ⚠️ **Blind mode is the deliberate exception
and is unchanged**: the Workspace still shows the anonymised label, falls back to the model alias
when no label resolves, and renders a seat id in neither case — a seat id contains its alias, so
printing one would defeat blind mode (the same rule the matrix follows two paragraphs above).
`BACKLOG.md` filed this behind the gate *"`opts.labelOf` must accept a seat id"*, which the fix did
not need: `labelOf` stays alias-keyed, because the value blind mode has to show was never the seat.

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

Since v4.0 (council schema v2), `--json` wraps the rows in the family envelope —
`{ "schemaVersion": 2, "type": "council-stats", "models": [ … ] }` — the per-model row
shape below is unchanged. (Pre-4.0 emitted the bare array.)

**Output**: one row per RESOLVED model (v4.7 — rows that carry `resolvedModel` group by the
executable id that served; rows without one group by alias and are marked `legacy`). Each row
also lists `aliases[]` — every alias observed for the group, most recent first; the chair
fallback promotion launches `aliases[0]`.

| Field | Meaning |
|---|---|
| `runs` | Number of ledger rows for this model (one per council run it participated in). |
| `lowN` | `true` when `runs < 3` — treat the numbers as noisy. |
| `avgStreetCredPeersOnly` | Mean of `streetCredPeersOnly` across all runs (`null` if the model was never judged). |
| `lifetimeConfirmRate` | Mean, across runs, of `(findings this model raised that landed Confirmed) / (findings this model raised)`. `null` when `judged` was false for every run or the model raised nothing. |
| `lifetimeFactErrorRate` | Same shape, but for the `Disputed` tier — a proxy for how often the bench caught this model asserting something wrong. |
| `conformance` | Tally of `{clean, repaired, unstructured}` counts — how often this model's Stage-1 findings JSON needed a repair re-prompt. |
| `aliases` | Every alias (row-level `model` value) observed for this group, most recently observed first (v4.7). `aliases[0]` is the launch-preferred name. |
| `legacy` | `true` when every row in the group lacks `resolvedModel` — alias-keyed history from before resolved-id segmentation, or leg-less rows whose resolution is unknowable (v4.7). Omitted (not `false`) when the group has any resolved rows. |

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
Verdict (schema v2, pricing-page-council) → verdict.json
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

This bench's two aliases are distinct, so its matrix and legend are byte-for-byte what every
pre-v4.8 run produced. On a bench that **repeats** an alias the columns split by seat
(`deepseek#1` / `deepseek#2`) and the legend's `*` marks the raiser's **seat** — see "What it
renders" above.

**6. Stats** — after this run's `tally` call appended to the ledger:

```bash
$ amicus council stats
model            runs  avg-cred  confirm  fact-err  notes
deepseek            1  2.00     1.00    0.00   low-N   legacy
gpt                 1  1.00     0.00    0.00   low-N   legacy
```

(`low-N` because each model has only 1 recorded run — `runs < 3`. `legacy` because this
hand-assembled `tally-input.json` never sets `runStats[].resolvedModel` — v4.7 groups by
alias and marks the group `legacy` whenever none of its rows carry a resolved id; see
[`amicus council stats`](#amicus-council-stats) above.)

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
