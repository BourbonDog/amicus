---
title: F4 — Council-Native Fan-Out & Structured JSON Output — Design Spec
date: 2026-06-09
status: finalized (2026-06-09 brainstorm — approved by owner)
owner: BourbonDog
references:
  - docs/superpowers/specs/2026-06-07-amicus-product-design.md (§6 F4)
  - skills/second-opinion/MODEL-NOTES.md (operating pain points F4 dissolves)
  - docs/superpowers/specs/2026-06-08-f1-headless-reliability-design.md (poller reliability F4 builds on)
supersedes: none
---

# F4 — Council-Native Fan-Out & Structured JSON Output

## 1. Summary

F4 is the fourth engine milestone. It gives the engine the two council-native
features the product spec promises:

- **`amicus fanout`** — one command/tool launches N models on the same prompt
  concurrently and returns all results in one call.
- **`--json`** — a stable, versioned, machine-parseable result schema on
  `fanout`, `start`, and `read`, so the council skill parses JSON instead of
  scraping prose.

It also adds **`--prompt-file`** (on `start` + `fanout`), dissolving three
documented operating pain points from `skills/second-opinion/MODEL-NOTES.md`:
the ~32 KB Windows cap on `--prompt` as a CLI arg, the fragile
`--prompt "$(cat briefing)"` dance, and the cwd-persistence trap in compound
launch commands.

The council skill rewrite to *consume* F4 is explicitly a follow-on (product
spec "Out of scope"), not part of this milestone.

## 2. Scope & decisions locked

Confirmed with the owner during brainstorming (2026-06-09):

| Decision | Choice |
| --- | --- |
| JSON surface | **`fanout` + `start` + `read`** (`list` already has `--json`); one shared schema module |
| Surfaces | **CLI command + MCP `amicus_fanout` tool** (MCP side thin: detached-child spawn, immediate ID return) |
| `--prompt-file` | **Yes, on `start` + `fanout`** (mutually exclusive with `--prompt`) |
| Fan-out architecture | **A — in-process, one shared OpenCode server**, N concurrent `runHeadless` legs via the existing external-server mode (`options.client`/`options.server`). Rejected: B (spawn N `start` children — N Go servers, Windows spawn surface, stdout parsing) and C (hybrid fallback — two code paths for a failure mode a re-run handles) |

## 3. Current state (code findings)

Ground-truth from the repo at `main` (HEAD `fc5b98e`), gathered during brainstorming:

- **External-server mode already exists.** `runHeadless` detects
  `options.client && options.server` (`src/headless.js:125`) and skips server
  start/teardown and signal install — the same path the MCP shared-server
  feature exercises (`src/mcp-server.js` shared path with spawn fallback).
- **Watchdog hazard.** When no `options.watchdog` is injected, `runHeadless`
  creates one whose `onTimeout` calls `server.close()` **and
  `process.exit(0)`** (`src/headless.js:188-195`). In a shared-server wave,
  a single leg's default watchdog would kill every sibling. Fan-out MUST
  inject per-leg watchdogs.
- **Abort is file-poll based.** The headless loop watches the session's
  `metadata.json` for `status:'aborted'` (`src/headless.js:327-346`), which
  `amicus abort` writes. This composes with fan-out for free — marking each
  leg aborted stops each in-process poller.
- **Context build is model-independent.** `buildContext` + `buildPrompts`
  (`src/sidecar/start.js:163-168`) take no model input → build once per wave,
  reuse for all legs.
- **stdout offenders for JSON mode.** The heartbeat already writes to stderr
  and the update notice already writes to stderr (`bin/amicus.js:52`), but
  `finalizeSession`'s conflict warning `console.log`s to stdout
  (`src/sidecar/session-utils.js:79-83`), and `outputSummary` is a plain
  `console.log` (`:97-99`).
- **`--json` precedent.** `list --json` emits `JSON.stringify(sessions)`
  (`src/sidecar/read.js:86-88`); `json` is already a boolean flag in the
  parser (`src/cli.js:100-115`).
- **MCP spawn pattern.** `spawnSidecarProcess` is fire-and-forget
  (`src/mcp-server.js:55-71`): detached `node bin/amicus.js …`, returns task
  IDs immediately; status/read poll afterward.
- **Task-ID shapes — confirmed compatible.** MCP `safeTaskId` allows
  `[a-zA-Z0-9_-]{1,64}` (`src/mcp-tools.js:14-17`) and `TASK_ID_PATTERN`
  (`src/utils/validators.js:31`, used by session enumeration at
  `src/sidecar/read.js:46`) is the identical pattern — derived leg IDs
  (`<waveId>-<n>`) pass both as-is.
- **Per-model pain F4 dissolves** (`skills/second-opinion/MODEL-NOTES.md`):
  ~32 KB Windows CLI-arg cap on `--prompt` (line 20), absolute-path/cwd traps
  in `$(cat …)` launches (line 14), N background-process juggling, prose
  scraping. F1's activity-aware poller already fixed the premature-exit trap
  the skill works around; those skill-side workarounds are removed in the
  follow-on skill rewrite, not here.

## 4. Design

### 4.1 CLI surface

```
amicus fanout --models gemini,gpt,deepseek --prompt "…"        [shared knobs] [--json]
amicus fanout --models a,b,c --prompt-file C:\path\briefing.md [shared knobs] [--json]
amicus start  … --prompt-file C:\path\briefing.md …
amicus start  … --no-ui --json
amicus read   <taskId|waveId> --json
```

- **`--models <list>`** — required; comma-separated aliases and/or full
  provider IDs. Duplicates allowed (distinct legs; useful for
  self-consistency runs). Leg count cap: default **10**, env-overridable
  `AMICUS_FANOUT_MAX_LEGS`; exceeding it is a fail-fast error.
- **`--prompt` XOR `--prompt-file`** — exactly one required (both or neither
  is an error). `--prompt-file` reads UTF-8 (tolerate BOM). Applies to
  `start` too.
- **Shared per-wave knobs** (apply identically to every leg): `--agent`,
  `--thinking`, `--timeout` (a **per-leg** budget — wall-clock ≈ slowest
  leg), `--summary-length`, `--no-context`/`--context-*`, `--mcp`,
  `--mcp-config`, `--no-mcp`, `--exclude-mcp`, `--no-validate-model`,
  `--cwd`, `--session-id`. Per-leg overrides are a non-goal.
- **Headless-only.** `fanout` implies `--no-ui`; `--agent chat` is rejected
  exactly as headless `start` rejects it. `start --json` requires `--no-ui`
  (error otherwise).
- **`--wave-id <id>`** — optional explicit wave ID (MCP pre-generates it).
  Default: same 8-hex generator as task IDs. Leg task IDs derive as
  `<waveId>-1` … `<waveId>-N` (in `--models` order).

### 4.2 MCP surface

New tool **`amicus_fanout`**
`{models[], prompt, agent?, thinking?, timeout?, summaryLength?, includeContext?, project?}`:

1. Generate `waveId` + leg IDs; create the wave session dir.
2. **Write the prompt to the wave dir as `briefing.md`** and pass
   `--prompt-file` — the spawned command line must NOT carry the prompt, or
   it re-hits the ~32 KB Windows cap F4 is killing.
3. Fire-and-forget spawn `amicus fanout --wave-id X --prompt-file … --json`
   via the existing `spawnSidecarProcess` pattern.
4. Return `{waveId, taskIds[]}` immediately (+ the standard polling
   reminder).

Existing tools compose: `amicus_status(waveId)` aggregates live leg statuses
("running — 2/3 legs complete"); `amicus_read(waveId)` returns the wave JSON;
per-leg status/read/resume/continue work unchanged because legs are ordinary
sessions.

### 4.3 Execution flow (one `fanout` process)

1. **Fail-fast validation, before anything launches:** resolve every alias;
   catalog-validate every model (F3 machinery, `--no-validate-model` opt-out);
   check API keys per provider; read the prompt file; enforce the leg cap.
   One bad model ⇒ no wave started.
2. **Wave record:** `.claude/amicus_sessions/<waveId>/` with
   `metadata.json {type:'wave', status:'running', legs:[…], models:[…]}` +
   the briefing saved as `briefing.md` (same filename the MCP handler uses).
3. **Build context once** (`buildContext`/`buildPrompts` are
   model-independent); reuse the same system/user prompts for all legs.
4. **One OpenCode server** (port 0, merged MCP config — all legs share the
   server's MCP set; acceptable: council runs `--no-mcp --agent Plan`).
5. **Launch N legs via `Promise.allSettled`.** Each leg is a normal session
   (own dir, `metadata.json` with `parentWave: waveId`, `conversation.jsonl`,
   `summary.md`) running `runHeadless(model, …, {client, server, …})` in
   external-server mode, with an **injected per-leg watchdog** whose timeout
   aborts only that leg (via `markAborted` → the leg's own metadata poll) —
   never `server.close()`/`process.exit()`.
6. **Aggregate:** write `wave.json` (the wave document, §4.4) to the wave
   dir; emit stdout (JSON or human); close the server once; finalize wave
   metadata (`complete|partial|error|aborted`); exit with the mapped code
   (§4.5).

### 4.4 JSON schemas (module: `src/utils/result-schema.js`)

**Run object** — one schema for `start --json`, `read <taskId> --json`, and
every wave leg:

```json
{
  "schemaVersion": 1,
  "type": "run",
  "taskId": "a1b2c3d4",
  "waveId": null,
  "model": "openrouter/deepseek/deepseek-v4",
  "modelInput": "deepseek",
  "agent": "plan",
  "status": "complete",
  "summary": "…full fold summary text…",
  "error": null,
  "createdAt": "ISO-8601", "completedAt": "ISO-8601",
  "durationMs": 184211,
  "sessionDir": "C:\\…\\amicus_sessions\\a1b2c3d4",
  "opencodeSessionId": "ses_…"
}
```

`status` ∈ `complete | error | timeout | aborted`, mapped from existing
result flags (`error` ⇒ `error`, `timedOut` ⇒ `timeout`, `aborted` ⇒
`aborted`, else `complete`). `modelInput` preserves the caller's alias next
to the resolved ID.

**Wave object** — `fanout` stdout and `read <waveId> --json`:

```json
{
  "schemaVersion": 1,
  "type": "wave",
  "waveId": "deadbeef",
  "status": "partial",
  "counts": { "total": 3, "complete": 2, "error": 0, "timeout": 1, "aborted": 0 },
  "legs": [ /* run objects, in --models order */ ],
  "prompt": { "source": "file", "file": "C:\\…\\briefing.md", "chars": 41230 },
  "createdAt": "ISO-8601", "completedAt": "ISO-8601", "durationMs": 312456
}
```

Wave `status`: `complete` (all legs complete) | `partial` (≥1 complete, ≥1
not) | `error` (0 complete) | `aborted`. `prompt.source` ∈ `inline | file`.
The full prompt text is NOT duplicated in the wave doc (it lives in each
leg's session + the saved `briefing.md`).

**Stability contract:** `schemaVersion` bumps on any breaking change; fields
are only added, never renamed/removed, within a version.

**stdout purity:** with `--json`, stdout carries ONLY the JSON document.
Heartbeat and update notice already go to stderr; route `finalizeSession`'s
conflict warning to stderr when JSON mode is active. The consuming skill
must be able to `JSON.parse(stdout)` whole, always — even hard failures emit
a parseable `{type:'wave', status:'error', error:'…'}` (or `type:'run'` for
`start`) document.

**Non-JSON `fanout` output (human default):** per-model summary sections in
`--models` order, then a compact status footer (model / status / duration).

### 4.5 Error handling & abort

- **Partial results are the contract.** `Promise.allSettled`; one leg's
  error/timeout/abort never sinks siblings. Failed legs get session status
  `error` + reason (existing mechanism) and appear in `legs[]` with their
  status. Quorum decisions belong to the consumer.
- **Exit codes:** `0` = all legs complete; `2` = partial; `1` = nothing
  completed or the fanout itself failed (validation, server start). Document
  in `getUsage()`.
- **Poll-failure fast-exit (small `runHeadless` hardening).** Today a dead
  server leaves each leg polling futilely until full timeout
  (`src/headless.js:548-551` swallows poll errors). Add: bail the leg after
  K consecutive failed polls (default **15**, ≈30 s at the 2 s poll
  interval; env-overridable `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES`), so a
  mid-wave server crash fails in seconds, not 15 minutes. Benefits single-run mode too. Recovery remains
  "re-run the wave" (architecture decision A).
- **Abort:** `amicus abort <waveId>` marks the wave AND every running leg
  aborted (file-based; each in-process leg poller picks it up — zero new
  IPC). `abort --all` catches legs naturally (they are ordinary sessions).
  SIGINT/SIGTERM on the fanout process (extend F3's `installSignalAbort` to
  wave level) aborts all legs, closes the server, finalizes the wave
  `aborted`, exits 130/143.

### 4.6 list/read/status integration

- `read <waveId> --json` re-emits the stored `wave.json` (the wave finalizes
  atomically at process exit, so stored = truth). If `wave.json` is missing
  (fanout process killed hard), rebuild the wave doc live from the leg
  sessions' metadata + summaries. `read <legId> --json` rebuilds the run
  object from metadata + `summary.md`. Non-JSON `read` of a wave prints the
  human aggregate.
- `amicus list`: wave dirs surface naturally (they have `metadata.json`);
  wave rows render as `wave(N legs)` in the MODEL column; `list --json` rows
  gain `type`/`parentWave`/`waveId` fields where applicable.
- `amicus_status(waveId)`: aggregates live leg statuses while running.

## 5. Testing

Per the F2/F3 lessons: scope against the FULL suite (`tests/` + `evals/tests/`);
`*.integration.test.js` stays out of the default gate; new `src/**/*.js` files
respect the 300-line cap → new modules `src/sidecar/fanout.js` (orchestrator)
and `src/utils/result-schema.js` (formatter), each with mirror test files.

- **Arg parsing:** models list (aliases, full IDs, dups, cap), `--prompt` XOR
  `--prompt-file` (both/neither error), `start --json` without `--no-ui` →
  error, `--wave-id` passthrough.
- **Schema:** golden-object tests for run + wave docs; status-mapping table;
  `schemaVersion` always present; wave `counts` arithmetic.
- **Orchestrator (mocked `startServer`/`runHeadless`):** exactly one server
  start; N legs sharing client/server; context built once; injected per-leg
  watchdog never calls `process.exit`/`server.close`; allSettled aggregation;
  partial statuses; abort fan-out (wave abort marks all legs); leg-ID
  derivation; wave metadata lifecycle.
- **stdout purity:** capture stdout in `--json` mode and `JSON.parse` it
  whole; conflict warning asserted on stderr; hard-failure JSON docs parse.
- **`--prompt-file`:** missing file, UTF-8 BOM, >32 KB file (proves the
  point of the feature).
- **Poll-failure fast-exit:** unit on the consecutive-failure counter
  (resets on success; bails at K).
- **MCP `amicus_fanout`:** spawn args include `--wave-id` + `--prompt-file`
  (never inline prompt); immediate `{waveId, taskIds[]}` return shape;
  briefing written to wave dir.
- **Integration tier** (`npm run test:integration`, skip-when-no-key): one
  real 2-model fanout smoke.

## 6. Non-goals (v1)

- Council skill rewrite to consume F4 (tracked follow-on in the product spec).
- Per-leg prompt or knob overrides.
- Interactive (GUI) fan-out.
- Streaming/NDJSON partial output — one JSON document at the end.
- Hybrid server-crash fallback (approach C) — re-run the wave instead.
- Removing the council/chat skills' anti-poller workarounds (separate tracked
  follow-up).

## 7. Acceptance criteria

1. `amicus fanout --models a,b,c --prompt "…"` runs three models
   concurrently on one OpenCode server and prints all three results in one
   call; each leg is a normal session visible to `list`/`read`/`abort`.
2. `amicus fanout … --json`, `amicus start --no-ui … --json`, and
   `amicus read <id> --json` emit schema-stable documents (§4.4) with pure
   JSON stdout; `JSON.parse(stdout)` always succeeds, including on failures.
3. `--prompt-file` works on `start` + `fanout` with a >32 KB briefing on
   Windows.
4. `amicus_fanout` (MCP) returns `{waveId, taskIds[]}` immediately;
   `amicus_status(waveId)` and `amicus_read(waveId)` work.
5. One leg erroring/timing out yields `status:'partial'`, exit code 2, and
   complete sibling results.
6. `amicus abort <waveId>` stops all running legs; Ctrl-C on the fanout
   process does the same.
7. Full unit suite green (no regressions to the 1669/5/0 baseline); lint
   clean.
