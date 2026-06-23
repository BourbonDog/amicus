# WS-2 — Schema & Cost Spine Design

**Date:** 2026-06-23
**Status:** Approved

## Context

Third of five workstreams in the Amicus post-v1.1.0 enhancement program
(WS-0 polish ✅ → WS-1 reliability foundation ✅ → **WS-2 schema & cost spine** →
WS-3 council trust spine → WS-4 surfaces & adoption). WS-2 makes the run/wave
schema carry **token & cost data**, adds an **enforced spend gate**, and gives the
`--json` contract a **structured error envelope** — the three items that thread the
schema and the cost story together. It is sequenced after reliability (WS-1) because
the gate's refusal and the cost-bearing schema both trust the terminal state + exit
code that WS-1 made authoritative; it is sequenced before the council-trust spine
(WS-3) because WS-3's run-stats and bench recommendations want real cost data flowing
first.

Source: the 2026-06-23 multi-agent improvement audit
(`output/amicus-enhancement-review-2026-06-23.md` in the SecondBrain vault) —
enhancements **#2** (per-leg cost/token telemetry in the schema), **#10** (enforced
`--max-cost` budget gate), and **#6** (structured `--json` error envelope). All
file:line refs below were verified against `main` @ `3263c9f` during scoping; verify
again before implementing — line numbers shift.

## Goals

1. Capture **per-leg token usage and cost** from OpenCode and surface it in the
   run/wave schema (`schemaVersion` bump), with cost honestly labeled by its source
   (reported / estimated / unknown) so it is never a fabrication vector.
2. Enforce a **budget gate** before any fanout/council wave launches: a hard
   per-leg `$/Mtok` threshold (on by default — the structural o3 guard) plus an
   optional total-`$` ceiling. Refuse over-budget waves; override explicitly.
3. Give every `--json` pre-flight failure a **structured error envelope on stdout**
   (`buildErrorDoc`) with a stable error code — so the automation audience `--json`
   exists for can branch programmatically instead of scraping stderr.
4. **Wire real cost into the council** end-to-end: a cost column in the Stage-5
   run-stats table, a real Stage-0 cost estimate, and a code-enforced cost guardrail
   replacing the prose-only "never o3" rule.

## Non-Goals / Out of Scope

- **Interactive-GUI cost capture.** `runInteractive` persists no session data today;
  capturing its usage depends on the WS-4 GUI-mirror work (#7). WS-2 covers headless
  runs (`start --no-ui`) and fanout legs only.
- **Council tally/verdict restructure, reviewer-reliability ledger, validate-or-repair**
  (#1/#5/#9/#12) — those are WS-3 (council trust spine). WS-2 touches the council only
  to surface cost data and update the now-enforced cost guardrail prose.
- **No new pricing-fetch logic.** Reuse the existing model-catalog cache as-is
  (`src/utils/model-catalog.js` / `model-fetcher.js`). WS-2 adds a *lookup*, not a
  fetcher.
- **No rewrite** of the `runHeadless` poll loop or the OpenCode client beyond reading
  the usage fields already present on assistant messages.

## Design

Build order follows the dependency spine: **Unit A (#6 envelope) → Unit B (#2
telemetry) → Unit C (#10 gate) → Unit D (council wiring)**. Unit C's refusal is
emitted through Unit A's envelope and priced via Unit B's pricing lookup; Unit D
consumes Unit B's schema data and Unit C's enforced guardrail.

### Unit A — Structured `--json` error envelope (#6)

**Problem:** every pre-flight failure (bad flag, missing prompt, missing key, bad
model, bad task id) writes a bare `Error: …` to **stderr** and **zero bytes to
stdout** (`bin/amicus.js`, `src/cli.js` `validateStartArgs`, `src/utils/prompt-source.js`,
`src/utils/validators.js`, `src/utils/model-validator.js`, `src/sidecar/fanout.js`
`validateFanoutModels`). An agent doing `JSON.parse(stdout)` under `--json` gets an
empty string. There is no `buildErrorDoc` today.

**Design — one error-doc builder + a frozen code enum.**

New module `src/utils/error-doc.js`:

```js
buildErrorDoc({ code, message, hint, command }) → {
  schemaVersion,             // imported from result-schema.js (WS-2 bumps it to 2 in Unit B);
  type: 'error',             // never hardcoded here, so A and B stay in lockstep
  ok: false,
  error: { code, message, hint: hint || null, command: command || null }
}
```

`ERROR_CODES` (frozen now — adding codes later is additive; renaming is breaking):

| code | covers |
|------|--------|
| `BAD_ARGS` | bad/empty flag, `--json` without `--no-ui`, bad `--timeout`/`--wave-id`/`--agent` |
| `MISSING_PROMPT` | no `--prompt`/`--prompt-file`, mutually-exclusive, value missing, empty/unreadable file |
| `BAD_MODEL` | bad model format, model not found on provider, not in catalog |
| `MISSING_KEY` | provider API key absent |
| `BAD_SESSION` | task id missing or invalid format / not found |
| `BUDGET_EXCEEDED` | the Unit C gate (the cost breakdown rides in `hint`) |
| `INTERNAL` | unexpected pre-flight throw |

**Wiring.** A shared helper (e.g. `failJson(code, message, { hint, command })` in
`error-doc.js`, or a thin wrapper at the dispatch layer) writes
`JSON.stringify(buildErrorDoc(...), null, 2)` to **stdout** then returns the existing
non-zero exit code — **only when the command's `--json` flag is set**. Non-JSON
callers keep today's human-readable stderr text byte-for-byte. The ~15 scattered
pre-flight callsites are routed through this single helper at the points where the
`--json` flag state is in scope (`bin/amicus.js` handlers; the validators continue to
*return* `{ valid, error }` / `{ error }` and the handler decides envelope-vs-text).

**Scope.** Pre-flight only — failures that occur *before* a run/wave document exists.
Once a run/wave is underway, the existing schema `status: 'error'` + `error` field
already represent runtime failure; those paths are unchanged.

### Unit B — Per-leg token & cost telemetry (#2)

**Problem:** the OpenCode SDK exposes `cost` (USD, number) and
`tokens { input, output, reasoning, cache { read, write } }` on every assistant
message (confirmed in `@opencode-ai/sdk` `types.gen.d.ts`), but `runHeadless`
(`src/headless.js`) reads only message *text* and never touches them. The run/wave
schema (`src/utils/result-schema.js`, `SCHEMA_VERSION = 1`) carries no usage data. The
catalog caches per-token `pricing { prompt, completion }` (strings, keyed by full
route id) — **but only for OpenRouter rows; Google/OpenAI/DeepSeek/Anthropic direct
rows have `pricing: null`** — and no lookup-by-id function exists.

**Design — capture tokens always; resolve cost in layers; tag the source.**

1. **Capture (`src/headless.js`):** in the message-poll loop, read
   `msg.info.tokens` and `msg.info.cost` off assistant messages and aggregate over
   the run (sum tokens; sum reported cost). Add a `usage` field to the `runHeadless`
   return object alongside the existing `toolCalls`.

2. **New module `src/utils/pricing.js`:**
   - `lookupPricing(modelId) → { prompt, completion } | null` — read the cached
     catalog (full-route-id keyed); null when the row is missing or `pricing: null`.
   - `resolveLegCost({ reportedCost, tokens, pricing }) → { amount, currency:'USD', source }`
     — the layered rule (chosen): **`reported`** when OpenCode's `cost` is present and
     `> 0`; else **`estimated`** = `tokens × pricing` when pricing is available; else
     **`unknown`** (`amount: null`). Tokens are reliable for all providers; cost
     degrades gracefully and is always labeled.

3. **Schema bump `1 → 2` (`src/utils/result-schema.js`), additive** (old consumers
   ignore unknown fields):

   ```js
   // run doc — new field on buildRunResult()
   usage: {
     tokens: { input, output, reasoning, cacheRead, cacheWrite } | null,
     cost:   { amount: number|null, currency: 'USD',
               source: 'reported' | 'estimated' | 'unknown' }
   }
   // wave doc — new field on buildWaveResult(), summed across legs
   usage: {
     tokens: { input, output, reasoning, cacheRead, cacheWrite },
     cost:   { amount, currency: 'USD',
               source: 'reported' | 'estimated' | 'mixed' | 'unknown',
               reportedLegs, estimatedLegs, unpricedLegs }
   }
   ```

   Wave totals are summed where the wave is assembled (`src/sidecar/fanout.js`
   ~line 218, into `buildWaveResult`). `start --json` (`src/sidecar/start.js`),
   `fanout --json` (`fanout.js`), and `read --json` (`src/sidecar/read.js` via the
   session rebuilders) all surface it. Usage is persisted to the session metadata so
   the `*FromSession` rebuilders can reconstruct it.

*Approaches considered for cost:* (A) layered + source tag — **chosen**; (B) trust
OpenCode's `cost` only — rejected (blanks every direct-provider leg we could
estimate); (C) estimate-only from catalog — rejected (catalog pricing is null for all
direct providers anyway, and drifts from billed cost).

### Unit C — Enforced budget gate (#10)

**Problem:** a tool whose premise is "run several frontier models at once" has **zero
spend protection in code**. The only guard is prose in `MODEL-NOTES.md:81-83` ("never
use o3/o3-pro without ask"). One fanout can quietly cost real money.

**Design — two guards, refuse-by-default, explicit override.**

New module `src/sidecar/budget.js` — `checkBudget(legs, { maxCostPerMtok, maxCost })
→ { ok, offending[], breakdown }`, pure and unit-testable:

- **Hard per-leg `$/Mtok` threshold (on by default):** any leg whose catalog
  `$/Mtok` (input or output) exceeds `maxCostPerMtok` → not ok. This is the
  structural o3 guard — it needs no output-length guess. The **default value** is a
  **tuning task** (WS-0 style): set above normal council frontier models
  (Opus/Gemini/DeepSeek/GPT) and below o3/o3-pro, pinned by a regression test
  ("Opus allowed, o3 blocked") against current pricing. Not hard-coded in this spec.
- **Soft total ceiling (`--max-cost <$>`, opt-in):** sum a conservative per-leg cost
  estimate; if it exceeds the ceiling → not ok. Labeled "estimate, not guaranteed."
  **Unpriced** legs (direct-provider, `pricing: null`) cannot be estimated → reported
  in `breakdown` as `unpriced`, **never silently counted as $0**.

**Insertion point:** `src/sidecar/fanout.js` ~line 137 — after `validateFanoutModels`
resolves every leg to its full route id (pricing reachable via the catalog already
loaded by `validateAgainstCatalog`), and **before** `startOpenCodeServer`. To price
the legs, `validateFanoutModels` is extended to return each leg's pricing row
(`legs.push({ modelInput, model, pricing })`) — the catalog is already fetched there,
so this exposes data rather than adding a fetch. The same check guards the solo
`start` waves the council launches (red-team leg, chair call).

**UX (chosen):** refuse-by-default. Over budget → build a `BUDGET_EXCEEDED` error doc
(Unit A) whose `hint` carries the per-leg breakdown, write it to stdout under `--json`
(human text otherwise), and return a non-zero exit code (`1`, matching the existing
fanout pre-flight refusal convention). **No interactive prompt** — identical behavior
in headless, MCP (`amicus_fanout`), and council waves. Overrides:
- `--max-cost <$>` — sets/raises the **total ceiling** for that run. It does **not**
  raise the per-`$/Mtok` threshold, so it cannot by itself unblock an o3-class leg.
- `--no-cost-gate` — disables **both** guards for that run. This is the deliberate
  escape hatch for an intentional o3/o3-pro run (explicit opt-in, per the audit's
  intent that o3 never run by accident).
- Config defaults in `~/.config/amicus/config.json` (`maxCostPerMtok`, optional
  `maxCost`), read via `src/utils/config.js` `loadConfig`. The per-`$/Mtok` threshold
  has no per-run raise flag by design — set a persistent cap in config, or use
  `--no-cost-gate` for a one-off.

New flags (`--max-cost`, `--no-cost-gate`) registered in `src/cli.js` (`--max-cost`
numeric in `parseValue`; `--no-cost-gate` boolean in `isBooleanFlag`) and threaded
through `bin/amicus.js` `handleFanout`/`handleStart` into `runFanout`/`runStart`.

### Unit D — Council cost wiring

Now that the schema carries cost and the gate enforces the guardrail, wire both into
the council skill (`skills/second-opinion/`):

- **SKILL.md Stage-5 run-stats table** (lines ~258-260 and the `Output & naming`
  copy ~377-378): add a **cost column** read from each leg/run's `usage.cost`
  (`amount` + a marker for `source`: e.g. exact, `~` estimated, `?` unknown) and a
  **wave total** row. Replace the sentence *"The schema carries no cost data — do not
  invent cost figures"* with: read cost from `usage.cost`; label estimated/unknown
  honestly; total it; never invent.
- **SKILL.md Stage-0** (line ~57, and the model-recommendation heuristic ~367): the
  "state the estimated cost" disclosure now quotes the gate's pre-flight estimate
  (the same `checkBudget` breakdown), rather than hand-math.
- **Cost guardrail** — `MODEL-NOTES.md:81-83` and SKILL.md:61: reword from prose-only
  "never o3" to: the budget gate enforces this in code (per-`$/Mtok` threshold ON by
  default); override with `--max-cost` / `--no-cost-gate` only on explicit user ask.
  Keep the per-model cost context. The deeper council run-stats/trust restructure
  remains WS-3.

The global owner copy of the council skill (`~/.claude/skills/second-opinion/`) is
synced to these versions at milestone close, per prior workstream practice.

## Testing & Verification

- Per-module unit tests, following the per-fix convention:
  - `error-doc`: envelope shape for every `ERROR_CODES` entry; `--json` pre-flight
    failures emit parseable stdout + correct non-zero exit; non-JSON callers still
    print human text to stderr (no stdout).
  - `pricing`: `lookupPricing` hit/miss/`pricing:null`; `resolveLegCost` layered
    resolution across all three `source` values.
  - `budget`: threshold pass/refuse; ceiling pass/refuse; unpriced-leg surfacing;
    `--max-cost` / `--no-cost-gate` overrides; **the "Opus allowed, o3 blocked"
    threshold-tuning regression test**.
  - schema v2: `usage` round-trips through `buildRunResult`/`buildWaveResult` and the
    `*FromSession` rebuilders; wave totals sum correctly; old fields unchanged.
  - `headless`: usage captured from a mocked assistant message with `cost`/`tokens`.
  - Coupled existing tests asserting `SCHEMA_VERSION === 1` or the absence of usage
    are updated in the same task that changes the source (WS-0 pattern).
- Gate: full `npm test` green (baseline 125 suites / 1934 pass / 4 skip / 0 fail) +
  `npm run lint` clean; CI (real, from WS-1) green on Windows + Linux.
- Real-LLM smoke: a 2-model `fanout --json` showing real `usage` — an OpenRouter leg
  `reported`, a direct-provider leg `estimated` or `unknown`; and a `BUDGET_EXCEEDED`
  refusal on an o3-class leg with the breakdown in the error envelope.

## Risks

- **`$/Mtok` threshold tuning** — too low blocks legitimate Opus council runs; too
  high lets o3 through. Mitigated by the mandatory "Opus allowed, o3 blocked"
  regression test pinned to current pricing; the default is a deliberate tuning task,
  not guessed in this spec.
- **Direct-provider cost blind spot** — null catalog pricing means many direct legs
  resolve to `unknown`/`unpriced`. Mitigated by the `source` tag and the explicit
  `unpriced` breakdown bucket — the gap is surfaced, never hidden as $0.
- **Error-code enum churn** — a renamed code is a breaking change for `--json`
  consumers. Mitigated by freezing `ERROR_CODES` now; future additions are additive.
- **Schema-v2 coupling** — consumers/tests may encode v1 or the absence of `usage`.
  Mitigated by additive design (unknown fields ignored) and updating coupled tests
  with their source.
- **Cost as a fabrication vector** (the audit's explicit warning) — mitigated
  structurally: tokens are reliable, cost is always labeled `reported`/`estimated`/
  `unknown`, and the council prose is changed from "do not invent" to "read and label
  honestly."

## Execution Notes

- Worktree: `C:\Users\sendt\dev\amicus-ws2`, branch `ws2/schema-cost-spine`
  (off `main` @ `3263c9f`). `node_modules` junctioned from the main clone; hooks fire
  (PR #9). Local-only — no push/PR until the owner OKs the WS-2 milestone. `main` is
  currently 24 commits ahead of `origin` (WS-0 + WS-1, collect-locally).
- Task shape (~5): (A) `error-doc.js` + enum + `--json` pre-flight wiring + tests;
  (B) `pricing.js` + headless usage capture + schema v2 + wave totals + tests;
  (C) `budget.js` + `validateFanoutModels` pricing exposure + fanout/start gate +
  flags/config + tests; (D) council SKILL.md cost column + Stage-0 estimate +
  MODEL-NOTES guardrail rewrite; (E) real-LLM smoke + holistic review + owner sync.
