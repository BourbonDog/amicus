# Degrade Announcement Invariant — Design

**Date:** 2026-08-01
**Status:** Design approved, not yet planned
**Scope:** Council runtime + `doctor`. Install/first-run is a separate spec (see Decomposition).

---

## 1. Why

The north star for amicus: **installing and running it should be simple, easy and
error-free; when an error does occur, amicus either self-heals or self-diagnoses, and does
so transparently, keeping the user informed.**

Point two is a disjunction with a constraint. Self-healing without telling the user is not
acceptable — transparency is required in *both* branches. The consequence for this repo is
sharp: **a correct-but-silent degrade fails the bar exactly as hard as a crash does.**

amicus's failure modes are disproportionately silent. The engine frequently handles a
failure correctly at the run level — degrade, exit 2, retry — while the artifact the user
actually reads says nothing was wrong.

### Evidence this design was written from

A 4-seat council was run 11 times against a free-model bench on v4.5.4 (`main` @ `af3e8f1`).

- **10 of 11 runs were clean** — four seats seated, four materialized, exit 0.
- The single loss was `gemma-4-31b-it:free` never returning a first token and hitting its
  timeout. A dead model, not a dead engine.
- **The engine is not losing legs.** The defect is that when a seat *is* lost, nothing tells
  the user which one.

That losing run produced this `run.json` stage entry, in full:

```json
{
  "name": "stage1", "status": "partial",
  "waveId": "c4304cff-s1", "waveIds": ["c4304cff-s1"],
  "taskIds": ["c4304cff-s1-1", "c4304cff-s1-3", "c4304cff-s1-4"]
}
```

The only trace of the casualty is that `c4304cff-s1-2` is **absent** from `taskIds` — an
absence, not a statement. Everything on stderr for the whole run was a raw logger line
dumping poll state, and a **cost** notice about unreported usage. Neither said a seat died.

Filed from this evidence:

- **#84** — `seatLoss` can never report a lost bench seat; `verdict.json` reports the council
  as intact.
- **#85** — a dead Stage-1 leg is announced on no surface at all.

### The convention already exists

The invariant is not new. It is already stated, in prose, in two comment blocks —
`run-budget.js:140` and `run-stages.js:112-117` — in each case as the same three-part rule:

> announced on stderr · kept on `run.json` · degrades the exit code

`deadWaves`, `budgetRefusals` and `sharedServerUnavailable` follow all three. Four other
channels follow only the third. This design promotes an inconsistently-followed convention
to something enforced by construction, and adds the fourth channel the north star implies:
**the artifact the user actually reads.**

---

## 2. Decomposition

The full north star spans three subsystems. This spec is the first two, merged.

| Spec | Scope | Status |
|---|---|---|
| **This spec** | The announcement contract + council runtime + truthful `doctor` | designed |
| Spec 2 | Install transparency & bounded self-heal — `AMICUS_SKIP_POSTINSTALL` skipping Electron provisioning, the ~165 MB engine cold-download on first MCP call | queued |
| Follow-on | Council Workspace renders `degrades[]` (data lands in `run.json` here; the GUI render is additive) | queued |

---

## 3. Decisions taken

Recorded so they are not re-argued. Each was an explicit owner call during design.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Single choke point**, not a test or lint rule | Enforced by construction. Flipping the exit code without announcing becomes inexpressible, rather than merely discouraged. |
| D2 | Record states **what + why + effect** (mandatory); **remedy optional** | Mandating a remedy is precisely how `doctor` came to emit a confident wrong cause. A field that must always be filled gets filled with filler, and readers learn to ignore it. |
| D3 | **`seatLoss` derived** from `degrades[]`, not computed independently | Two fields reporting lost seats can disagree. Deriving keeps the shipped v4.5.2 shape working while removing the possibility of contradiction. Closes #84 without a breaking change. |
| D4 | **`kind: 'heal'` in scope** | A silent successful self-heal fails the north star as hard as a silent degrade. The alternative is a second parallel announcement mechanism. |
| D5 | **Approach A** — shared record + shared renderers, two collectors | Shares exactly what drifts (shape and wording), keeps separate what legitimately differs (when and where degrades are collected). |
| D6 | Workspace GUI render is a **follow-on**, not in this spec | `workspace-panels.js` is at 295/300 and is a distinct surface. `degrades[]` lands in `run.json`, which the Workspace already reads, so the render is purely additive later. Keeps this spec shippable. |
| D7 | `doctor` **reports truthfully; `--fix` stays opt-in** and limited to safe, reversible repairs, each announcing what it did | Healing only where it is safe, always saying so. |

### Rejected, with reasons

- **Two implementations sharing only a JSON schema.** This is the drift shape this repo has
  already been bitten by twice, both recorded in `BACKLOG.md`: `T15-m5` (a hand-copied
  paramMap that "has already diverged once") and the `resolveBench/resolveBenchInput
  parallel evolution` note.
- **One universal collector with a pluggable sink.** Forces `doctor`'s lifecycle — a
  sequence of checks, most of which pass — into a run-shaped abstraction built around events
  during execution.
- **A partial-wave gap in `run-stages.js:99`.** Investigated and **refuted**: `runFanout`
  builds `legDocs` with `legs.map(...)` over every requested model (`fanout.js:258`),
  `runLeg` never rejects, and an unroutable model still gets a doc via
  `buildRoutingFailureLeg`. A wave produces either all its legs or none. Do not re-file.

---

## 4. Architecture

### `src/utils/degrade.js` — new, shared

```js
makeDegrade({ kind, channel, what, why, effect, remedy? })
  // → frozen record. THROWS if what/why/effect are missing or blank,
  //   or if channel is not in DEGRADE_CHANNELS. kind defaults to 'degrade'.

formatDegrade(record)   // → the single stderr line. One voice for every channel.

DEGRADE_CHANNELS        // frozen set of known channel ids
```

Validation inside `makeDegrade` is what makes the contract real: a degrade that does not
say what was lost, why, and what it cost cannot be constructed.

### `src/council/run-degrade.js` — new, council collector

```js
createDegradeSink({ runDir, degraded }) → { note(input), all() }
```

`note()` does four things in one call and is the **only** way to do any of them:

1. validate through `makeDegrade`
2. write `formatDegrade(...)` to stderr
3. append to `run.json`'s new `degrades[]` via `runState.checkpoint`
4. set `degraded.value = true` — **only when `kind === 'degrade'`**

**`degraded` becomes private to the sink.** Today exactly eight sites write
`degraded.value = true` directly (enumerated in §5), and the ones that do *only* that are
exactly the silent channels.

### Doctor collector

The same `makeDegrade` / `formatDegrade`, collected into a plain array, rendered by doctor.
No run context, no `run.json`, no coupling to the run exit code.

### Verdict surface

`writeVerdictFiles` gains `degrades`; `verdict.json` gains `degrades[]`. Additive to
`schemaVersion: 2` — the same precedent v4.5.2 set with `seatLoss`.

---

## 5. Channel inventory

| Channel | stderr | `run.json` | verdict | Work |
|---|---|---|---|---|
| `dead-wave` | ✅ | ✅ stage entry | ⚠️ critic-only | migrate to sink |
| `budget-refusal` | ✅ | ✅ `budgetRefusals[]` | ❌ | migrate to sink |
| `shared-server-unavailable` | ✅ | ✅ `recordServerFate` | ❌ | migrate to sink |
| `dropped-members` | ✅ CLI-level | ✅ `droppedMembers[]` | ❌ | migrate to sink |
| `chair-skipped-cost-ceiling` | ❌ | ⚠️ stage `skipped` only | ❌ | **new announcement** |
| `dead-leg` | ❌ | ❌ | ❌ | **new — #85** |
| `thin-cross-review` | ❌ | ❌ | ❌ | **new — fully silent** |
| `chair-failed` | ❌ | ❌ | ❌ | **new — fully silent** |
| `debate-degraded` | ❌ | ⚠️ `debate` summary | ❌ | **new announcement** |
| `inexact-under-ceiling` | ✅ `noticeUnknownSpend` | ✅ usage block | ❌ | migrate to sink |

Ten channels. Verified against source, not assumed: there are exactly **8** direct
`degraded.value = true` assignments in `src/` (`run-budget.js:149`, `run-chair.js:88,149`,
`run-finalize.js:67`, `run.js:142,178,245,250`), of which `run.js:142` is the Stage-1 rollup
rather than a channel of its own. `run.js:178` and `run-chair.js:149` are bare assignments
with only an inline comment, and `run-debate.js` contains **no stderr writes at all**.

**Three channels are fully silent** on every surface — `dead-leg`, `thin-cross-review`,
`chair-failed`. Two more (`chair-skipped-cost-ceiling`, `debate-degraded`) reach `run.json`
but never stderr or the verdict.

**Doctor channels:** the engine-copy mismatch (doctor validating the global install while
MCP runs an npx-cache copy), and any cause doctor cannot verify — which must be stated as
unverified rather than asserted.

**Explicitly out of scope.** Per-seat conformance signals — `repairRefused`,
`findingsUnverified`, `unstructured` — are *not* run degrades. They already ride the
`runStats` row on the verdict, so they already satisfy the invariant. Including them would
double-report.

---

## 6. Data flow

```
channel site  →  sink.note({ kind, channel, what, why, effect, remedy? })
                    ├─ 1. makeDegrade()   validate — throws on blank mandatory fields
                    ├─ 2. stderr          formatDegrade(), one voice
                    ├─ 3. run.json        checkpoint → degrades[] (append)
                    └─ 4. degraded.value  true — ONLY when kind === 'degrade'
       ↓ (at assembly)
writeVerdictFiles({ ..., degrades: sink.all() })
                    ├─ verdict.degrades[]   canonical
                    └─ verdict.seatLoss     derived; shape unchanged
       ↓
report.md / report.html   →  "What was lost", rendered from verdict.degrades
       ↓
resolveTerminalExit({ degraded, ... })   →  unchanged; still the sole exit-code source
```

**Doctor:** checks emit records into an array; doctor renders them; exit code derives from
whether any `kind: 'degrade'` is present.

### Ordering rules

1. **Verdict assembly is the cut-off.** Degrades noted after it reach stderr and `run.json`
   but cannot reach `verdict.json`. Any channel that can fire later — server release,
   finalize-path failures — is documented as run.json-only. Silently dropping them would be
   the exact failure this design exists to fix.
2. **One `checkpoint` write per `note()`.** `run-state.checkpoint` goes through
   `writeFileAtomic`, so each is safe, but this multiplies tmp+rename cycles on `run.json`
   and interacts with the open BACKLOG item on `writeFileAtomic` tmp orphans. Batch within a
   stage, or accept and record the interaction.
3. **A heal that later fails** must not leave a stale "healed" announcement as the only
   record. A retry that succeeds announces once; a retry that exhausts its attempts
   announces a degrade.

---

## 7. Error handling

The announcement machinery must never become a new way to lose information, or a new way to
kill a run.

- **Malformed record.** `makeDegrade` throws — a pure function, and throwing is what makes
  the contract enforceable in tests. `sink.note()` **catches** and converts the failure into
  a `channel: 'internal'` degrade naming the offending channel. Tests get a hard failure at
  the call site; production never trades a real signal for a stack trace. **`note()` never
  throws.**
- **`run.json` write failure.** Wrapped and swallowed, following the precedent already in
  `run-budget.js:156`. stderr and `degraded` still happen. A degrade that cannot be persisted
  is still a degrade that gets announced.
- **Recursion.** `note()` must never call `note()`. A failure inside the announcement path
  goes straight to stderr — one level, no re-entry. Without this rule, disk-full becomes an
  unbounded loop of degrades about failing to record degrades.
- **EPIPE on stderr.** Swallowed, matching the existing handling in `electron/main.js`. A
  closed pipe must never mask a run.
- **A doctor check that throws** becomes a degrade record saying that check could not be run
  — not a crash, and explicitly not an inferred cause. "I could not check this" is honest;
  guessing is the thing being fixed.
- **The outer `INTERNAL` catch at `run.js:294`** stays as it is. It already surfaces through
  `run.error` and the exit code, and routing it through the sink would require the sink to
  work correctly in exactly the state where something has already gone unexpectedly wrong.

---

## 8. Testing

- **The invariant test.** A source scan asserting `degraded.value = true` appears in `src/`
  **only** inside `run-degrade.js`. This is what fails the moment someone adds a silent
  channel, and it is the piece the choke point cannot enforce alone (JS cannot prevent a
  direct assignment). Match *assignments*, not prose — several comments legitimately discuss
  `degraded` — and normalize line endings, since CRLF checkouts have already bitten two docs
  test suites (the open `.gitattributes` BACKLOG item).
- **Unit — contract.** `makeDegrade` rejects a missing or blank `what`/`why`/`effect`, one
  case per field; accepts an absent `remedy`; rejects an unknown channel; freezes the record;
  defaults `kind` to `'degrade'` and accepts `'heal'`.
- **Unit — voice.** A snapshot per `kind` of `formatDegrade`, so wording stays consistent as
  channels are added rather than drifting into ten dialects.
- **Per-channel coverage.** Table-driven over all ten channels: each produces a record whose
  mandatory fields are non-blank. A complement to the choke point, not a substitute — it
  catches malformed announcements, the choke point catches missing ones.
- **Surface integration.** One forced dead-leg run asserting the stderr line,
  `run.json.degrades[]`, `verdict.degrades[]` and the report section all name the same seat.
- **Backward compatibility.** The existing v4.5.2 `seatLoss` tests must pass **unchanged and
  unedited**. That is the proof the derivation preserved the shipped contract. If they need
  editing, the derivation is wrong.
- **Heal.** A retry that succeeds announces `kind: 'heal'` and exits **0** — the heal path
  must not accidentally degrade a healthy run.
- **Regression pins.** One test each for #84 and #85, failing against today's code.

**Process note for the plan:** measure the test-count delta against the branch's own
merge-base, not a figure carried from a previous release. Both prior "unexplained drift"
incidents (ENV-7) turned out to be stale baselines.

---

## 9. Prerequisite: size-gate extraction

The v4.6 hard gate says any task touching a file at the 300-line ceiling must extract from it
**first**. Two files this design touches are on the cliff and are **not** on the BACKLOG's
list — that list is stale:

| File | Now | BACKLOG says |
|---|---|---|
| `src/council/run.js` | **299/300** | not listed |
| `src/cli-handlers-doctor.js` | **295/300** | listed as *resolved* at 260/300 after the Phase 20.1 extraction |
| `src/council/run-budget.js` | 277/300 | not listed |

`run.js` has one line of headroom and is exactly where the sink is constructed. Extraction is
task zero of the implementation plan, not an afterthought — and `BACKLOG.md`'s tight-file
list should be corrected in the same pass.

---

## 10. Success criteria

1. No channel can flip the exit code without announcing — enforced by the source-scan test.
2. A lost seat is named on stderr, in `run.json`, and in `verdict.json`/`report.md`.
3. #84 and #85 are closed, each with a regression pin.
4. `doctor` checks the copy MCP actually runs, and never asserts a cause it has not verified.
5. Existing `seatLoss` tests pass unedited.
6. A successful self-heal is announced and exits 0.
