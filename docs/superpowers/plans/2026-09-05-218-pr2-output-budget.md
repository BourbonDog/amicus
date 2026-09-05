# #218 PR 2 — Bidirectional `outputBudget` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `outputBudget` work in both directions — a budget above the engine's 32,000 default is honoured by starting every engine with `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` set to the budget — lift the direct-Anthropic hold-out on the strength of new wire measurements, add a `doctor` row that says what the value reaches, and sweep every "can only lower" sentence.

**Architecture:** One value (`config.outputBudget`) feeds two levers that the probe measured to agree: the per-model `limit` descriptor (already shipped, `config.js :: buildProviderModels`) for routes the amicus catalog knows, and the engine env flag, set by a new `src/utils/engine-output-flag.js` helper around the SDK's synchronous spawn inside `opencode-client.js :: startServer` and restored before anything is awaited. A new `src/utils/doctor-output-budget-check.js` row reports, in verifiable voice, what the configured value and any ambient flag reach. Thirteen new probe rows (K1–K13) pin every shape this ships.

**Tech Stack:** Node ≥ 22.12 (CommonJS), jest 29, opencode-ai 1.18.15 pinned (no source map — engine behaviour is measured by `scripts/probe-max-tokens.js`, never read), `@opencode-ai/sdk` 1.18.15.

**Spec:** The four-PR sequence approved on 2026-09-04 (recorded in `docs/superpowers/plans/2026-09-04-218-pr1-probe-and-ceilings.md`, "PR sequence": *PR 2 = bidirectional `outputBudget` via the env flag, doctor check, docs sweep*) plus the **Design** section below, which is this PR's spec: it was written from measurements taken on 2026-09-05 with the PR 1 probe, and every rule in it cites the row that measured it.

> **Superseded in part (2026-09-05, by the task reviews during execution):** Task 1 — models.dev and OpenRouter renamed `qwen/qwen3.8-max` to `qwen/qwen3.8-max-0902` between the PR 1 run and this one, so the probe's `QWEN` constant is the dated id and the filed record explains the two dump lines that differ from PR 1's (qwen's rename; kimi's line, which flips between the bundled 1048576 and live 943718 with the engine's startup refresh, on which no row depends); the shipped curated `qwen` alias is filed as an open BACKLOG item. Task 2 — named mutants NULLGUARD and ALWAYSDELETE were added for the helper's other two guards. Task 5 — the doctor row's messages changed on review: an ambient flag counts as honoured only in plain-decimal-integer form (any other form is reported as unmeasured, status warn); "raises the engine default to N" became "sets the engine's per-leg reservation to N"; "clamped to a catalog ceiling" became "have a known catalog ceiling"; a malformed budget beside an ambient flag now names which value governs; the no-cache branch warns only above the engine default; the starvation hint leads when both warns fire; alias rows without a string model are ignored. `src/sidecar/models-ceiling-line.js` was 69 lines, not 298 (that figure was `models.js` before PR 1's extraction). Also: the doctor deps fixture's contract test moved from 30 to 31 keys; `docs/usage.md`'s doctor paragraph says "never raises" where it said "can only lower"; and the whole-branch review corrected ruling R1's cost basis — `outputBudget` shipped in 4.9.3, so R1 DOES change released behaviour (a budget below 32,000 now reaches rows the catalog cannot clamp), recorded under CHANGELOG "Changed" and in `docs/configuration.md`; the doctor row's ambient messages now state min(N, the engine's ceiling) rather than "N per leg" (K5). Council #231 round 1: a budget at or above 1e21 now sets the flag as plain digits (BigInt) instead of setting none, and the doctor row prints budgets the same way; the doctor lead says "(floored from X)" for a fractional budget; K9's expect string reworded and the matrix re-run — which showed kimi's `/config/providers` ceiling flipping between the bundled 1048576 and live 943718 across runs (a startup-refresh race, not a catalogue change), now described as such in the record. Council #231 round 2: the SDK spawn-timing fact is now pinned by a test that drives the real SDK against a fake engine on PATH (D1); a valid ambient flag gets the same route analysis as a budget (D2); the ambient gate rejects leading zeros (D5); the curated `qwen` alias moved to the dated id in this PR after all (D4). The measured facts in the Design section stand unchanged.

## Global Constraints

- Engine pin: `opencode-ai` **1.18.15** / `@opencode-ai/sdk` **1.18.15** (`package-lock.json`). `node_modules` must match (`npm ci` if `node_modules/opencode-ai/package.json` disagrees).
- The probe runs ONLY through its own OUTER/INNER sandbox: `node scripts/probe-max-tokens.js [...]`. Never pass `--inner` by hand, never set a real key, never run it with a real HOME.
- 300-line gate on every `.js` under `src/` and `electron/` (`scripts/check-file-sizes.js`; `src/utils/config.js` and `src/opencode-client.js` are grandfathered). `src/cli-handlers-doctor.js` is at **289** lines: Task 5 may add at most **three** lines to it.
- New `src` modules put the `@module` docblock FIRST, then `'use strict'` (so `generate-docs` fills the architecture-map row), and keep exports at five or fewer so every one is listed.
- Citations in code comments use the symbol-anchor form `path/file.js :: symbol` (checked by `scripts/check-citations.js`); doc-tree files (`docs/`, `BACKLOG.md`) are not scanned.
- `BACKLOG.md` is LF (`.gitattributes eol=lf`). Records are past-tense and filed in the same commit as the change they describe. A probe table filed in a record is pasted byte-identical from the run that produced it.
- Never stage `output/`, `site-src/`, or `.superpowers/`. Never `--no-verify`. Never `git checkout --` on uncommitted work. Never force-push.
- Never edit a released CHANGELOG section (`## [4.9.3]` and below); all changes go under `## [Unreleased]`.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The PR is created with `--label council-review` and its council run verified.
- Tests: RED before GREEN; every guard gets a named mutant in a comment naming the test it kills. No real network, no real config dir (jest's `tests/setup/hermetic-config-dir.js` sandboxes `AMICUS_CONFIG_DIR`).

---

## Design (measured 2026-09-05, engine 1.18.15)

### What the probe found

Thirteen new cases were run through the PR 1 probe's sandbox (`--only K1,…,K13`, partial run, 0 mismatched, 13 recorded). Every cell below is a wire observation:

| id | case | env | max_tokens | thinking |
|---|---|---|---|---|
| K1 | direct anthropic haiku `limit.output 8000` | — | **8000** | — |
| K2 | direct anthropic haiku `limit.output 8000` + variant `high` | — | **24000** | budget_tokens 16000 |
| K3 | direct anthropic haiku `{}` + env 64000 + variant `max` | 64000 | **64000** | budget_tokens 31999 |
| K4 | direct anthropic haiku `limit.output 64000` + env 64000 + variant `max` | 64000 | **64000** | budget_tokens 31999 |
| K5 | direct anthropic haiku `{}` + env 100000 | 100000 | **64000** | — |
| K6 | env 100000 + kimi `limit.output 100000` | 100000 | **100000** | — |
| K7 | env 64000 + kimi `options.max_tokens 4096` | 64000 | **4096** | — |
| K8 | kimi `limit.output 8000` + `options.max_tokens 4096` | — | **4096** | — |
| K9 | direct anthropic haiku `limit.output 40000` + variant `max` | — | **63999** | budget_tokens 31999 |
| K10 | direct anthropic haiku `limit.output 70000` + env 100000 + variant `max` | 100000 | **64000** | budget_tokens 31999 |
| K11 | env 8000 + direct anthropic haiku `limit.output 8000` + variant `high` | 8000 | **24000** | budget_tokens 16000 |
| K12 | env 8000 + kimi `{}` | 8000 | **8000** | — |
| K13 | env 8000 + custom unknown model `{}` | 8000 | **8000** | — |

The engine's `/config/providers` dump for haiku is unchanged from PR 1: `limit {"context":200000,"output":64000}`, variants `high` 16000 / `max` 31999.

### The rules those rows establish

1. **The descriptor lowers the reservation on the direct Anthropic route exactly as on OpenRouter** (K1: 8000). The council #230 A1 hold-out (`config.js :: buildProviderModels` registers `{}` for every `anthropic/*` route) can be lifted.
2. **A thinking variant's budget is ADDED to the reservation, not carved out of it** (K2: 8000 + 16000 = 24000; K11 the same with the flag set). The variant's budget is NOT shrunk by a small descriptor — haiku's `high` stayed 16000 under an 8000 descriptor.
3. **The sum is clamped to the model's real ceiling, whatever the descriptor or flag said** (K3: 64000 + 31999 → 64000; K4 the same with the descriptor at 64000; K10: 70000 + 31999 with the flag at 100000 → 64000; K9: 32000 + 31999 = 63999 sits under 64000 and is left alone). No budget can push a thinking leg over the ceiling. Amicus sends no thinking variant today (PR 1 row F1: `--thinking`'s `body.reasoning` never reached the engine); PR 4 inherits these numbers.
4. **The flag raises the reservation to the budget, clamped by whichever ceiling is known.** With the descriptor: K6 (100000 on kimi, ceiling 1048576). On a bare `{}` row the engine knows: K5 (flag 100000 on haiku → 64000). On a bare row with a small flag: K12 (8000 on kimi). On a model neither catalog knows: J2/K13 (the budget as-is, exactly as the raw 32000 went out before).
5. **`options.max_tokens` wins over both other levers** (K7 over the flag, K8 over the descriptor). amicus never emits it (council #230 r5 B1, grep-verified) — recorded so the precedence is measured, not asserted.
6. **The flag also feeds compaction.** Read in the pinned binary, not wire-measured: `SessionCompaction.isOverflow` subtracts the same `maxOutputTokens(model, outputTokenMax)` from the model's context window to decide when to compact. A budget of 100,000 leaves a 131,072-context model 31,072 tokens of prompt. This is documented and the doctor row warns at half a window; it is not otherwise guarded.

### Rulings (decisions this plan makes; each reversible in one line)

- **R1 — the flag is set whenever a budget is set, not only above 32,000.** One rule, uniform semantics: `outputBudget` is the per-leg reservation for EVERY leg, clamped wherever a ceiling is known (rules 1 and 4). The alternative — flag only above 32,000 — would make a budget of 8,000 reach only catalog-known routes while a budget of 40,000 reaches every route, a boundary nobody would predict. Corrected on the whole-branch review: `outputBudget` shipped in 4.9.3, so this DOES change released behaviour for a budget below 32,000 on rows the catalog cannot clamp — documented as a CHANGELOG "Changed" entry and an upgrade note in `docs/configuration.md`. Cost if wrong: one condition in `withOutputTokenFlag`'s caller.
- **R2 — an ambient flag the user exported is honoured untouched when no budget is configured, and overridden for the spawn (then restored) when one is.** The doctor row names which happened.
- **R3 — the anthropic hold-out is lifted outright** (rules 1–3). No special-casing of thinking variants in the descriptor: the engine clamps the sum, and amicus sends no variant until PR 4.
- **R4 — the doctor row warns only on what it can name:** a malformed budget or ambient flag (the engine falls back to 32000 silently — D1/D2), a budget above the engine default with alias routes the catalog cannot clamp (an unknown model receives it as-is — J2/K13), and a reservation of at least half a route's context window (rule 6).
- **R5 — the PR 2 probe record carries the full 32-row table**, not just the K rows, because the `checks:` line counts all rows and the record's rule is "byte-identical to the run".

### File structure

| File | Responsibility |
|---|---|
| `scripts/probe-max-tokens.js` | + cases K1–K13 with measured `want`s; + one docblock paragraph |
| `BACKLOG.md` | + "#218 PR 2" record under `## v4.9.4 records` (full table, dump, checks line) |
| `src/utils/engine-output-flag.js` (new) | the flag name, the engine default, `outputTokenFlagValue`, `withOutputTokenFlag` |
| `src/opencode-client.js :: startServer` | wraps the synchronous SDK spawn with `withOutputTokenFlag(getOutputBudget(), …)` |
| `src/utils/config.js :: buildProviderModels` / `getOutputBudget` | hold-out removed; docblocks say both levers |
| `src/utils/model-output-limit.js`, `src/utils/model-ceilings-modelsdev.js`, `src/sidecar/models-ceiling-line.js` | docblock / line-text sweep of "cannot raise" and "held out" |
| `src/utils/doctor-output-budget-check.js` (new) + `src/cli-handlers-doctor.js` + `tests/helpers/doctor-base-deps.js` | the `output-budget` doctor row |
| `docs/configuration.md`, `docs/usage.md`, `CHANGELOG.md` | user-facing sweep |
| tests | `tests/utils/engine-output-flag.test.js`, `tests/opencode-client-output-flag.test.js`, `tests/doctor-output-budget.test.js` (new); `tests/build-provider-models-output-limit.test.js`, `tests/sidecar/models-command.test.js` (updated) |

---

### Task 1: Probe cases K1–K13 and the PR 2 record

**Files:**
- Modify: `scripts/probe-max-tokens.js` (docblock; `CASES` after the `J2` entry; one constant after `const CTX`)
- Modify: `BACKLOG.md` (new record after the P1 record, i.e. after the line `checks: 18 matched, 0 mismatched (none), 1 recorded` that closes it)
- Output (untracked, gitignored): `output/218-probe-pr2.json`

**Interfaces:**
- Consumes: the probe's existing `W(maxTokens, reasoning, thinking)` helper, `AN`/`OR`/`CUSTOM`, `HAIKU`/`KIMI`, `CTX`.
- Produces: the measured rows later tasks cite by id (K1–K13) and the record their comments point at.

- [ ] **Step 1: Confirm the engine copy matches the pin**

Run: `node -e "console.log(require('opencode-ai/package.json').version, require('./node_modules/@opencode-ai/sdk/package.json').version)"` from the repo root.
Expected: `1.18.15 1.18.15`. If not, run `npm ci` and re-check.

- [ ] **Step 2: Add the constant and the thirteen cases**

In `scripts/probe-max-tokens.js`, directly after `const CTX = 1048576;` add:

```js
const HCTX = 200000;                  // haiku's context per the engine's own dump (H1)
```

Directly after the `J2` entry in `CASES` (the line beginning `{ id: 'J2', title: 'custom unknown model + env 64000'`) add:

```js
  // PR 2 (K group, measured 2026-09-05): descriptor x thinking budget on the
  // direct Anthropic route, the flag above a known ceiling, lever precedence,
  // and the exact shapes amicus ships (env = budget AND limit.output =
  // min(budget, ceiling)). Every `want` is the measurement, as for the rows above.
  { id: 'K1', title: 'direct anthropic haiku limit.output 8000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } }, model: AN(HAIKU), expect: '8000 — the descriptor lowers the reservation on the Anthropic route too', want: W(8000) },
  { id: 'K2', title: "direct anthropic haiku limit.output 8000 + variant 'high'", anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } }, model: AN(HAIKU), extra: { variant: 'high' }, expect: '24000 = 8000 + 16000 — the thinking budget is ADDED to the descriptor value, not carved out of it', want: W(24000, null, 'any') },
  { id: 'K3', title: "direct anthropic haiku {} + env 64000 + variant 'max'", env: '64000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '64000 — 64000 + 31999 clamped to the ceiling', want: W(64000, null, 'any') },
  { id: 'K4', title: "direct anthropic haiku limit.output 64000 + env 64000 + variant 'max'", env: '64000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 64000 } } }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '64000 — the shipped budget-64000 shape, clamped the same way', want: W(64000, null, 'any') },
  { id: 'K5', title: 'direct anthropic haiku {} + env 100000 (above the 64000 ceiling)', env: '100000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '64000 — the flag is clamped to the ceiling the engine knows', want: W(64000) },
  { id: 'K6', title: 'env 100000 + limit.output 100000 (kimi)', env: '100000', or: { [KIMI]: { limit: { context: CTX, output: 100000 } } }, model: OR(KIMI), expect: '100000 — the shipped budget-100000 shape raises the reservation', want: W(100000) },
  { id: 'K7', title: 'env 64000 + options.max_tokens 4096 (kimi)', env: '64000', or: { [KIMI]: { options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '4096 — options.max_tokens wins over the flag (amicus never emits it)', want: W(4096) },
  { id: 'K8', title: 'limit.output 8000 + options.max_tokens 4096 (kimi)', or: { [KIMI]: { limit: { context: CTX, output: 8000 }, options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '4096 — options.max_tokens wins over the descriptor (amicus never emits it)', want: W(4096) },
  { id: 'K9', title: "direct anthropic haiku limit.output 40000 + variant 'max'", anthropic: { [HAIKU]: { limit: { context: HCTX, output: 40000 } } }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '63999 = min(40000, 32000) + 31999 — the default caps the descriptor at 32000; the sum sits under the ceiling and is left alone', want: W(63999, null, 'any') },
  { id: 'K10', title: "direct anthropic haiku limit.output 70000 + env 100000 + variant 'max'", env: '100000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 70000 } } }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '64000 — 70000 + 31999 clamped to the ceiling, not to the descriptor', want: W(64000, null, 'any') },
  { id: 'K11', title: "env 8000 + direct anthropic haiku limit.output 8000 + variant 'high'", env: '8000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } }, model: AN(HAIKU), extra: { variant: 'high' }, expect: '24000 = 8000 + 16000 — the shipped budget-8000 shape with a thinking variant', want: W(24000, null, 'any') },
  { id: 'K12', title: 'env 8000 + bare {} (kimi)', env: '8000', or: { [KIMI]: {} }, model: OR(KIMI), expect: '8000 — the flag lowers a row the amicus catalog cannot clamp', want: W(8000) },
  { id: 'K13', title: 'env 8000 + custom unknown model {}', env: '8000', custom: true, model: CUSTOM, expect: '8000 — a model neither catalog knows receives the budget as-is', want: W(8000) },
```

- [ ] **Step 3: Extend the docblock**

In the file's top docblock, after the paragraph that begins `THE RUN CHECKS ITSELF (council #230 C2).` and ends `as a full-matrix verdict.`, add:

```
 *
 * THE K GROUP (#218 PR 2) measures what PR 1 left open: a descriptor's
 * `limit.output` under a thinking variant on the direct Anthropic route
 * (K1/K2/K9), the sum against the model's ceiling (K3/K4/K10), the flag above
 * a ceiling (K5), lever precedence (K7/K8), and the exact shapes amicus ships
 * once the flag is set to the budget (K4/K6/K11/K12/K13). Those rows are the
 * canary for opencode-client.js :: startServer's flag wiring as well as for
 * the engine: if a bump stops the flag reaching the spawn, K6/K12/K13 read
 * 32000.
```

- [ ] **Step 4: Run the full matrix**

Run: `node scripts/probe-max-tokens.js --out output/218-probe-pr2.json 2>&1 | tee output/218-probe-pr2.txt`
Expected (verbatim, last lines): `checks: 31 matched, 0 mismatched (none), 1 recorded` and `engines: 32 started, 32 closed`. The `sandbox:` line lists the eleven absent names; the `engine:` line reads `opencode-ai 1.18.15 (sdk 1.18.15), server reports 1.18.15`. If any K row mismatches, STOP and report the row — the `want` is the 2026-09-05 measurement and a moved cell is a finding, not a typo to fix.

- [ ] **Step 5: Diff the first nineteen table rows against the PR 1 record**

Run (from the repo root, PowerShell or bash):

```bash
node -e "
const fs=require('fs');
const run=fs.readFileSync('output/218-probe-pr2.txt','utf8').split(/\r?\n/).filter(l=>/^\| (A|B|C\d|D\d|E\d|F\d|H\d|J\d) \|/.test(l));
const bl=fs.readFileSync('BACKLOG.md','utf8').split(/\r?\n/).filter(l=>/^\| (A|B|C\d|D\d|E\d|F\d|H\d|J\d) \|/.test(l));
let diff=0; for(let i=0;i<19;i++){ if(run[i]!==bl[i]){diff++; console.log('DIFF',i,'\n run:',run[i],'\n rec:',bl[i]);} }
console.log(run.length, bl.length, 'differing:', diff);"
```

Expected: `19 19 differing: 0`. (The PR 1 record's table rows are the first 19 rows of this run, byte-for-byte.)

- [ ] **Step 6: File the record**

In `BACKLOG.md`, directly after the line `checks: 18 matched, 0 mismatched (none), 1 recorded` that closes the P1 record (inside `## v4.9.4 records`), insert a blank line and then this bullet. The three blocks marked PASTE are copied byte-identical from `output/218-probe-pr2.txt` (the whole table including its header and separator rows, the `/config/providers per model:` block, and the `checks:` line). Keep LF line endings.

```markdown
- [x] **#218 PR 2 — descriptor × thinking budget, the flag above a ceiling, and the shipped
  budget shapes, measured (2026-09-05).** PR 1 held direct `anthropic/*` routes out of clamping
  (council #230 A1) because the engine ADDS a thinking variant's budget to `max_tokens` on that
  route and both of PR 1's points were measured against a bare descriptor; it also left the three
  `max_tokens` levers measured only in isolation. Thirteen cases (K1–K13) were added to
  `scripts/probe-max-tokens.js` and the whole 32-case matrix re-run under the same sandbox
  (`sandbox:` line: eleven absent names; engine 1.18.15 / sdk 1.18.15 / server 1.18.15; 32 started,
  32 closed). The first nineteen table rows and the `/config/providers` dump diff byte-identical
  against the P1 record above.

  **The descriptor lowers the reservation on the direct Anthropic route exactly as on OpenRouter**
  (K1: `limit.output 8000` → `max_tokens 8000`). **A thinking variant's budget is added on top of the
  descriptor value, not carved out of it, and the variant's budget is not shrunk by a small
  descriptor** (K2: 8000 + 16000 = 24000, `budget_tokens` still 16000; K11 the same with the flag
  at 8000). **The sum is clamped to the model's real ceiling regardless of what the descriptor or
  the flag said** (K3: bare `{}` + flag 64000 + `max` 31999 → 64000, not 95999; K4 the same with
  `limit.output 64000`; K10: `limit.output 70000` + flag 100000 + `max` → 64000, not 101999; K9:
  `limit.output 40000` + `max` → 63999 = min(40000, 32000) + 31999, under the ceiling and left
  alone). Haiku's dump line reports `limit.output 64000` and every clamped row landed on exactly
  that number. So no descriptor and no flag can push a thinking leg over the ceiling on this route,
  and the hold-out was lifted in `config.js :: buildProviderModels` in this PR. amicus sends no
  thinking variant today (F1 above); PR 4, which will, inherits these numbers.

  **The flag raises the reservation to the budget, clamped by whichever ceiling is known.** With a
  matching descriptor: K6 (flag 100000 + `limit.output 100000` on kimi → 100000). On a bare `{}`
  row the engine knows: K5 (flag 100000 on haiku → 64000, the engine's own ceiling). With a small
  flag on a bare row: K12 (flag 8000 on kimi → 8000). On a model neither catalog knows: K13 (flag
  8000 on the custom unknown model → 8000, as-is; J2 above is the same row at 64000). Those four
  rows are why PR 2 sets the flag TO THE BUDGET whenever a budget is configured, for every engine
  amicus starts (`opencode-client.js :: startServer`, around the synchronous spawn, restored before
  anything is awaited): a route the amicus catalog can clamp gets `min(budget, ceiling)` through the
  descriptor and the flag never exceeds it; a route it cannot clamp gets the budget through the flag,
  clamped by the engine's own catalog where it knows the model; a model neither knows gets the
  budget itself, exactly as it got the raw 32000 before.

  **`options.max_tokens` wins over both other levers** (K7: 4096 under a 64000 flag; K8: 4096 under
  `limit.output 8000`). amicus never emits it (council #230 r5 B1, grep-verified); the precedence is
  now measured rather than asserted.

  **One consequence of the flag is read, not measured:** the pinned binary's
  `SessionCompaction.isOverflow` subtracts the same `maxOutputTokens(model, outputTokenMax)` from
  the model's context window when deciding to compact, so a large budget shrinks the prompt budget
  (100,000 on a 131,072-context model leaves 31,072). `docs/configuration.md` says so with that
  provenance, and the new `doctor` `output-budget` row warns when a budget takes at least half of
  any alias route's window.

PASTE-TABLE

PASTE-DUMP

PASTE-CHECKS
```

Replace `PASTE-TABLE` with the table (header row, separator row, all 32 data rows), `PASTE-DUMP` with the `/config/providers per model:` heading and its four `- ` lines, and `PASTE-CHECKS` with the `checks:` line — each copied exactly from `output/218-probe-pr2.txt`. Do not re-wrap, re-align, or re-type any of it.

- [ ] **Step 7: Prove the pasted blocks are byte-identical**

Run:

```bash
node -e "
const fs=require('fs');
const norm=(s)=>s.split(/\r?\n/);
const run=norm(fs.readFileSync('output/218-probe-pr2.txt','utf8'));
const bl=norm(fs.readFileSync('BACKLOG.md','utf8'));
const want=run.filter(l=>l.startsWith('| ')||l.startsWith('|---')||l.startsWith('- openrouter/')||l.startsWith('- anthropic/')||l.startsWith('- probe/')||l.startsWith('checks: '));
const missing=want.filter(l=>!bl.includes(l));
console.log('lines from run:',want.length,'missing from BACKLOG:',missing.length); missing.forEach(l=>console.log('MISSING',l));"
```

Expected: `lines from run: 39 missing from BACKLOG: 0` (2 header/separator + 32 rows + 4 dump lines + 1 checks line).

Also run: `node -e "const s=require('fs').readFileSync('BACKLOG.md','utf8'); console.log(s.includes('\r') ? 'CRLF FOUND' : 'LF ok')"`
Expected: `LF ok`.

- [ ] **Step 8: Commit**

```bash
git add scripts/probe-max-tokens.js BACKLOG.md
git commit -m "probe: K1-K13 measure descriptor x thinking budget, the flag above a ceiling, and the shipped budget shapes (#218 PR 2)

Thirteen new cases, wants pinned to the 2026-09-05 measurement; full 32-case
matrix re-run (31 matched, 0 mismatched, 1 recorded); PR 2 record filed with the
run's table, dump and checks line byte-identical.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `src/utils/engine-output-flag.js`

**Files:**
- Create: `src/utils/engine-output-flag.js`
- Test: `tests/utils/engine-output-flag.test.js`

**Interfaces:**
- Consumes: `positiveCount(v) → number|null` from `src/utils/model-output-limit.js`.
- Produces: `OUTPUT_TOKEN_FLAG: 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX'`, `ENGINE_DEFAULT_OUTPUT_TOKENS: 32000`, `outputTokenFlagValue(budget) → string|null`, `withOutputTokenFlag(budget, fn, env = process.env) → ReturnType<fn>` (Tasks 3 and 5 depend on these exact names).

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/engine-output-flag.test.js`:

```js
'use strict';

/**
 * #218 PR 2 — the one engine env flag amicus sets, OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX.
 *
 * The contract under test is timing and restoration, not arithmetic: the pinned
 * SDK spreads process.env into the engine spawn SYNCHRONOUSLY inside
 * createOpencodeServer, before its first await, so the flag has to be present
 * at call time and must be gone (or back to its ambient value) the moment fn
 * returns — never leaking into the caller's env or any later child spawn.
 */

const {
  withOutputTokenFlag, outputTokenFlagValue, OUTPUT_TOKEN_FLAG, ENGINE_DEFAULT_OUTPUT_TOKENS,
} = require('../../src/utils/engine-output-flag');

describe('constants', () => {
  test('the flag name is the engine\'s, and the default is the measured 32000', () => {
    expect(OUTPUT_TOKEN_FLAG).toBe('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
    expect(ENGINE_DEFAULT_OUTPUT_TOKENS).toBe(32000);
  });
});

describe('outputTokenFlagValue', () => {
  test('a positive integer budget becomes its decimal string', () => {
    expect(outputTokenFlagValue(40000)).toBe('40000');
    expect(outputTokenFlagValue(8000)).toBe('8000');
  });

  test('sub-1, zero, negative, non-numeric and unset budgets produce no flag', () => {
    for (const bad of [0, -1, 0.5, 'lots', '40000', null, undefined, true, NaN, Infinity]) {
      expect(outputTokenFlagValue(bad)).toBeNull();
    }
  });

  test('a fractional budget above 1 floors, matching normalizeOutputBudget', () => {
    expect(outputTokenFlagValue(40000.9)).toBe('40000');
  });
});

describe('withOutputTokenFlag', () => {
  test('sets the flag for the duration of fn and removes it afterwards', () => {
    const env = {};
    let seen;
    const out = withOutputTokenFlag(40000, () => { seen = env[OUTPUT_TOKEN_FLAG]; return 'ret'; }, env);
    expect(seen).toBe('40000');
    expect(out).toBe('ret');
    expect(Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG)).toBe(false);
  });

  test('restores an AMBIENT value the user exported, rather than deleting it', () => {
    const env = { [OUTPUT_TOKEN_FLAG]: '64000' };
    let seen;
    withOutputTokenFlag(40000, () => { seen = env[OUTPUT_TOKEN_FLAG]; }, env);
    expect(seen).toBe('40000');
    expect(env[OUTPUT_TOKEN_FLAG]).toBe('64000');
  });

  test('with no usable budget the env is not touched — an ambient value is honoured as-is', () => {
    const env = { [OUTPUT_TOKEN_FLAG]: '64000' };
    let seen;
    withOutputTokenFlag(null, () => { seen = env[OUTPUT_TOKEN_FLAG]; }, env);
    expect(seen).toBe('64000');
    expect(env).toEqual({ [OUTPUT_TOKEN_FLAG]: '64000' });
    const empty = {};
    withOutputTokenFlag('nope', () => { seen = empty[OUTPUT_TOKEN_FLAG]; }, empty);
    expect(seen).toBeUndefined();
    expect(empty).toEqual({});
  });

  test('restores even when fn throws, and the throw propagates', () => {
    const env = {};
    expect(() => withOutputTokenFlag(40000, () => { throw new Error('spawn failed'); }, env))
      .toThrow('spawn failed');
    expect(Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG)).toBe(false);
  });

  test('a promise-returning fn is returned as-is, and the flag is already gone before it settles', async () => {
    const env = {};
    const p = withOutputTokenFlag(40000, async () => {
      const atCall = env[OUTPUT_TOKEN_FLAG];
      await new Promise((r) => setImmediate(r));
      return { atCall, afterFirstAwait: env[OUTPUT_TOKEN_FLAG] };
    }, env);
    expect(p).toBeInstanceOf(Promise);
    // Named mutant "RESTOREAFTERAWAIT": `return await fn()` inside the try
    // (restoring only once the promise settles) makes afterFirstAwait '40000'.
    expect(Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG)).toBe(false);
    await expect(p).resolves.toEqual({ atCall: '40000', afterFirstAwait: undefined });
  });

  test('defaults to the REAL process.env, and deletes rather than leaving "undefined"', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, OUTPUT_TOKEN_FLAG);
    const saved = process.env[OUTPUT_TOKEN_FLAG];
    delete process.env[OUTPUT_TOKEN_FLAG];
    try {
      let seen;
      withOutputTokenFlag(8000, () => { seen = process.env[OUTPUT_TOKEN_FLAG]; });
      expect(seen).toBe('8000');
      // Assigning `undefined` to a process.env key stores the STRING 'undefined';
      // the engine would then read a malformed flag and fall back silently (D1).
      expect(Object.prototype.hasOwnProperty.call(process.env, OUTPUT_TOKEN_FLAG)).toBe(false);
    } finally {
      if (had) { process.env[OUTPUT_TOKEN_FLAG] = saved; } else { delete process.env[OUTPUT_TOKEN_FLAG]; }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/utils/engine-output-flag.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/engine-output-flag'`.

- [ ] **Step 3: Write the module**

Create `src/utils/engine-output-flag.js`:

```js
/**
 * @module engine-output-flag
 * #218 PR 2 — the one engine env flag amicus sets: OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX.
 *
 * WHY A FLAG AT ALL. The per-model `limit` descriptor (model-output-limit.js) can
 * only LOWER a leg's max_tokens reservation: the pinned engine computes
 * `Math.min(limit.output, OUTPUT_TOKEN_MAX)` and OUTPUT_TOKEN_MAX defaults to
 * 32000. Raising it is this flag's job. The engine reads the flag from the env
 * it is SPAWNED with, as a positive integer; `0`, `-1` and `64000abc` all fall
 * back to 32000 with no error anywhere (probe rows D1/D2).
 *
 * THE ONE RULE: when `outputBudget` is configured, the flag is set TO THE BUDGET
 * for every engine amicus starts — around the synchronous spawn only, restored
 * before anything is awaited. Measured on the wire by scripts/probe-max-tokens.js
 * (BACKLOG "v4.9.4 records", the PR 2 record):
 *   - a route the amicus catalog can clamp gets min(budget, ceiling) through the
 *     descriptor, and the flag never exceeds it (C2, K6);
 *   - a bare `{}` route the ENGINE knows gets min(engine ceiling, budget)
 *     (C3, K5, K12) — the flag reaches rows the amicus catalog cannot name;
 *   - a route neither knows gets the budget as-is (J2, K13), exactly as it got
 *     the raw 32000 before;
 *   - an ambient value the user exported themselves is honoured untouched when no
 *     budget is configured, and overridden for the spawn (then restored) when one is.
 *
 * WHY AROUND THE SYNCHRONOUS CALL. The pinned @opencode-ai/sdk spreads
 * process.env into the child's env inside createOpencodeServer BEFORE its first
 * await (node_modules/@opencode-ai/sdk/dist/server.js), so the flag has to be in
 * process.env at call time and may be gone by the time the promise settles.
 * Restoring in `finally` keeps it out of every OTHER child amicus spawns
 * (Electron, the MCP child, on-complete hooks) and out of the caller's own env.
 * The unit pin is tests/opencode-client-output-flag.test.js; the wire canary is
 * the probe's K6/K12/K13 rows.
 */
'use strict';

const { positiveCount } = require('./model-output-limit');

const OUTPUT_TOKEN_FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';
/** The engine's own default when the flag is absent or malformed (probe rows A, D1, D2). */
const ENGINE_DEFAULT_OUTPUT_TOKENS = 32000;

/**
 * The flag value a budget produces, or null when no flag should be set.
 * Same acceptance rule as normalizeOutputBudget: a positive finite integer,
 * floored; everything else is "no flag".
 * @param {*} budget raw or normalized outputBudget
 * @returns {string|null}
 */
function outputTokenFlagValue(budget) {
  const n = positiveCount(budget);
  return n === null ? null : String(n);
}

/**
 * Run `fn` with the flag set to `budget` in `env`, restoring the previous state
 * (absent, or the ambient value) before returning — whether `fn` returned a
 * value, returned a promise, or threw. With no usable budget `fn` runs untouched.
 *
 * `delete`, not `= undefined`: assigning undefined to a process.env key stores
 * the string 'undefined', which the engine would read as a malformed flag.
 * @template T
 * @param {*} budget outputBudget (positive integer, else no-op)
 * @param {() => T} fn called synchronously, exactly once
 * @param {NodeJS.ProcessEnv} [env] defaults to process.env — the env the SDK spreads
 * @returns {T} whatever fn returned (a promise is returned, never awaited here)
 */
function withOutputTokenFlag(budget, fn, env = process.env) {
  const value = outputTokenFlagValue(budget);
  if (value === null) { return fn(); }
  const had = Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG);
  const saved = env[OUTPUT_TOKEN_FLAG];
  env[OUTPUT_TOKEN_FLAG] = value;
  try {
    return fn();
  } finally {
    if (had) { env[OUTPUT_TOKEN_FLAG] = saved; } else { delete env[OUTPUT_TOKEN_FLAG]; }
  }
}

module.exports = { withOutputTokenFlag, outputTokenFlagValue, OUTPUT_TOKEN_FLAG, ENGINE_DEFAULT_OUTPUT_TOKENS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/utils/engine-output-flag.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Kill the named mutant, then restore**

Edit `withOutputTokenFlag` so the `try` reads `return await fn();` (make the function `async`), run the suite, confirm the promise test FAILS, then restore the exact code from Step 3 and re-run to green.

- [ ] **Step 6: Lint and commit**

Run: `npx eslint src/utils/engine-output-flag.js tests/utils/engine-output-flag.test.js`
Expected: no output.

```bash
git add src/utils/engine-output-flag.js tests/utils/engine-output-flag.test.js
git commit -m "feat: engine-output-flag helper sets OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX around a synchronous spawn (#218 PR 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Wire the flag into `startServer`, pinned through the `_createOpencodeServer` seam

**Files:**
- Modify: `src/opencode-client.js :: startServer` (the block from `const createOpencodeServer = options._createOpencodeServer` through `const sdkServer = await createOpencodeServer(serverOptions);`)
- Test: `tests/opencode-client-output-flag.test.js`

**Interfaces:**
- Consumes: `withOutputTokenFlag` (Task 2); `getOutputBudget() → number|null` from `src/utils/config.js`.
- Produces: nothing new; `startServer(options)` keeps its signature.

- [ ] **Step 1: Write the failing test**

Create `tests/opencode-client-output-flag.test.js`:

```js
'use strict';

/**
 * #218 PR 2 — startServer hands OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX to the
 * engine spawn, and to nothing else.
 *
 * The pinned SDK spreads process.env into the child inside createOpencodeServer
 * BEFORE its first await, so the flag must be present when the SDK function is
 * CALLED and must already be gone (or back to its ambient value) by the time the
 * function's promise settles. The probe's K6/K12/K13 rows are the wire-side
 * canary for the engine; this file is the unit pin for amicus's side.
 *
 * Harness copied from tests/server-start-duration-log.test.js — the SDK is
 * mocked as a virtual module and startServer is driven through its
 * `_createOpencodeServer` seam. config is mocked PARTIALLY: only getOutputBudget
 * is replaced, so buildServerOptions still runs the real buildProviderModels
 * against jest's hermetic config dir.
 */

const mockCreateOpencodeClient = jest.fn(() => ({ session: {} }));
const seen = [];
let throwOnSpawn = false;
const mockCreateOpencodeServer = jest.fn(async () => {
  const flag = process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
  if (throwOnSpawn) { throw new Error('spawn refused'); }
  const entry = { atCall: flag };
  seen.push(entry);
  await new Promise((r) => setImmediate(r));
  entry.afterFirstAwait = process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
  return { url: 'http://127.0.0.1:4096', close: jest.fn() };
});

jest.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClient,
  createOpencodeServer: mockCreateOpencodeServer,
  __esModule: true,
  default: { createOpencodeClient: mockCreateOpencodeClient, createOpencodeServer: mockCreateOpencodeServer },
}), { virtual: true });

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/utils/config', () => {
  const actual = jest.requireActual('../src/utils/config');
  return { ...actual, getOutputBudget: jest.fn(() => null) };
});

const config = require('../src/utils/config');
const { startServer } = require('../src/opencode-client');
const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';

const OK = {
  _hasOpencodeBinary: () => true,
  _createOpencodeServer: mockCreateOpencodeServer,
  _createClient: mockCreateOpencodeClient,
};

describe('startServer sets the engine output flag around the synchronous spawn', () => {
  const had = Object.prototype.hasOwnProperty.call(process.env, FLAG);
  const ambient = process.env[FLAG];

  beforeEach(() => {
    jest.clearAllMocks();
    seen.length = 0;
    throwOnSpawn = false;
    delete process.env[FLAG];
    config.getOutputBudget.mockReturnValue(null);
  });
  afterAll(() => {
    if (had) { process.env[FLAG] = ambient; } else { delete process.env[FLAG]; }
  });

  it('a configured budget is in process.env when the SDK is called, and gone before its promise settles', async () => {
    config.getOutputBudget.mockReturnValue(40000);
    await startServer(OK);
    // Named mutant "FLAGAFTERAWAIT": set process.env before `await
    // createOpencodeServer(...)` and restore after it — afterFirstAwait reads '40000'.
    // Named mutant "NOFLAG": drop the withOutputTokenFlag wrapper — atCall is undefined.
    expect(seen).toEqual([{ atCall: '40000', afterFirstAwait: undefined }]);
    expect(Object.prototype.hasOwnProperty.call(process.env, FLAG)).toBe(false);
  });

  it('reads the budget from config, the same source buildProviderModels uses', async () => {
    config.getOutputBudget.mockReturnValue(8000);
    await startServer(OK);
    expect(config.getOutputBudget).toHaveBeenCalled();
    expect(seen[0].atCall).toBe('8000');
  });

  it('with no budget, the env is untouched — an ambient flag the user exported reaches the spawn as-is', async () => {
    process.env[FLAG] = '64000';
    await startServer(OK);
    expect(seen).toEqual([{ atCall: '64000', afterFirstAwait: '64000' }]);
    expect(process.env[FLAG]).toBe('64000');
  });

  it('with a budget, an ambient flag is overridden for the spawn and restored afterwards', async () => {
    process.env[FLAG] = '64000';
    config.getOutputBudget.mockReturnValue(40000);
    await startServer(OK);
    expect(seen).toEqual([{ atCall: '40000', afterFirstAwait: '64000' }]);
    expect(process.env[FLAG]).toBe('64000');
  });

  it('a spawn failure still restores the env before the rejection is seen, and the error propagates', async () => {
    config.getOutputBudget.mockReturnValue(40000);
    throwOnSpawn = true;
    await expect(startServer(OK)).rejects.toThrow('spawn refused');
    expect(Object.prototype.hasOwnProperty.call(process.env, FLAG)).toBe(false);
  });

  it('a malformed budget sets nothing (the engine would fall back to 32000 silently)', async () => {
    config.getOutputBudget.mockReturnValue(null); // normalizeOutputBudget already rejected it
    await startServer(OK);
    expect(seen[0].atCall).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/opencode-client-output-flag.test.js`
Expected: FAIL on the first, second, fourth tests (`atCall` is `undefined` / `'64000'` instead of the budget); the ambient-untouched and malformed tests pass already.

- [ ] **Step 3: Wire it**

In `src/opencode-client.js :: startServer`, replace this block:

```js
  const createOpencodeServer = options._createOpencodeServer
    || await getCreateOpencodeServer();
  const serverOptions = buildServerOptions(options);

  // Measure the healthy path. The v4.5.2 timeout had to be sized from the
  // asymmetry of the failure (a slow start costs latency, a failed one costs a
  // review seat) because nothing recorded how long a GOOD start takes — so the
  // margin against the ceiling was unmeasurable on exactly the slow boxes that
  // needed it. Now it is one debug line, not an inference.
  const startedAt = Date.now();
  const sdkServer = await createOpencodeServer(serverOptions);
```

with:

```js
  const createOpencodeServer = options._createOpencodeServer
    || await getCreateOpencodeServer();
  const serverOptions = buildServerOptions(options);

  // #218 PR 2: the engine reads OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX from the
  // env it is SPAWNED with, and the pinned SDK spreads process.env into that
  // spawn synchronously, before its first await. So the flag is set around the
  // synchronous call only and is restored before the promise is awaited — it
  // never reaches the caller's env or any other child amicus starts. The budget
  // comes from config here exactly as buildProviderModels reads it for the
  // per-model descriptor, so the two levers cannot disagree (measured agreeing:
  // probe rows C2, K6). Unit pin: tests/opencode-client-output-flag.test.js
  // through the `_createOpencodeServer` seam; wire canary: probe K6/K12/K13.
  const { withOutputTokenFlag } = require('./utils/engine-output-flag');
  const { getOutputBudget } = require('./utils/config');

  // Measure the healthy path. The v4.5.2 timeout had to be sized from the
  // asymmetry of the failure (a slow start costs latency, a failed one costs a
  // review seat) because nothing recorded how long a GOOD start takes — so the
  // margin against the ceiling was unmeasurable on exactly the slow boxes that
  // needed it. Now it is one debug line, not an inference.
  const startedAt = Date.now();
  const sdkServer = await withOutputTokenFlag(getOutputBudget(), () => createOpencodeServer(serverOptions));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/opencode-client-output-flag.test.js tests/server-start-duration-log.test.js tests/server-start-timeout.test.js tests/opencode-client.test.js`
Expected: PASS, all suites.

- [ ] **Step 5: Kill both named mutants, then restore**

FLAGAFTERAWAIT: replace the wrapped line with `process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = String(getOutputBudget()); const sdkServer = await createOpencodeServer(serverOptions); delete process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;` — the first test must FAIL on `afterFirstAwait`. NOFLAG: `const sdkServer = await createOpencodeServer(serverOptions);` — the first test must FAIL on `atCall`. Restore Step 3's code exactly; re-run to green.

- [ ] **Step 6: Lint, citations, commit**

Run: `npx eslint src/opencode-client.js tests/opencode-client-output-flag.test.js && node scripts/check-citations.js --all`
Expected: no lint output; citations clean.

```bash
git add src/opencode-client.js tests/opencode-client-output-flag.test.js
git commit -m "feat: startServer sets OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX to outputBudget around the synchronous engine spawn (#218 PR 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Lift the direct-Anthropic hold-out and sweep the src docblocks

**Files:**
- Modify: `src/utils/config.js :: buildProviderModels` (the `addRoute` guard) and `src/utils/config.js :: getOutputBudget` (docblock)
- Modify: `src/utils/model-output-limit.js` (module docblock only)
- Modify: `src/utils/model-ceilings-modelsdev.js` (module docblock only)
- Modify: `src/sidecar/models-ceiling-line.js :: fmtCeilingLine` (two string literals + one comment)
- Test: `tests/build-provider-models-output-limit.test.js`, `tests/sidecar/models-command.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildProviderModels` now emits `{ limit }` for `anthropic/*` routes like any other clamped route.

- [ ] **Step 1: Flip the tests first**

In `tests/build-provider-models-output-limit.test.js`, replace the block that begins `// Council #230 A1. A refreshed catalog now knows the direct anthropic` and ends with the closing of the test `'the openrouter/anthropic mirror of that same model still gets a limit'` with:

```js
  // Council #230 A1 held DIRECT anthropic out of clamping until descriptor x
  // thinking-budget was measured. PR 2 measured it (probe rows K1/K2/K3/K4/K9/
  // K10, BACKLOG "v4.9.4 records"): the descriptor lowers the reservation on
  // that route (K1: 8000), a thinking variant's budget is added on top (K2:
  // 8000 + 16000 = 24000) and the sum is clamped to the model's real ceiling
  // (K3/K4/K10: 64000 for haiku). No budget can push a thinking leg over the
  // ceiling, so the hold-out is lifted and direct anthropic clamps like any
  // other route. Named mutant "ANTHROPICHELDOUT": re-add
  //   if (fullModel.startsWith('anthropic/')) { providers[providerID].models[modelID] = {}; return; }
  // to addRoute and the FIRST test below fails.
  const HAIKU = [
    { id: 'anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 },
    { id: 'openrouter/anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 },
  ];

  test('a DIRECT anthropic route gets the same limit as any other clamped route (hold-out lifted)', () => {
    const config = load({ aliases: { haiku: 'anthropic/claude-haiku-4-5' }, outputBudget: 8000 }, HAIKU);
    expect(config.buildProviderModels([]).anthropic.models['claude-haiku-4-5'])
      .toEqual({ limit: { context: 200000, output: 8000 } });
  });

  test('the openrouter/anthropic mirror of that same model gets the same limit', () => {
    const config = load({ aliases: { haiku: 'anthropic/claude-haiku-4-5' }, outputBudget: 8000 }, HAIKU);
    const m = config.buildProviderModels([]).openrouter.models['anthropic/claude-haiku-4-5'];
    expect(m.limit).toEqual({ context: 200000, output: 8000 });
  });

  // PR 2: values above the engine's 32000 default are LIVE — the descriptor
  // carries min(budget, ceiling) and startServer raises the engine side with
  // the flag (probe K6: 100000 reached the wire). The descriptor's own
  // arithmetic is what this pins; the flag is pinned in
  // tests/opencode-client-output-flag.test.js.
  test('a budget above the engine default is emitted as min(budget, ceiling), not capped at 32000', () => {
    const config = load({ aliases, outputBudget: 100000 });
    const p = config.buildProviderModels([]);
    expect(p.openrouter.models['moonshotai/kimi-k3'].limit).toEqual({ context: 1048576, output: 100000 });
    expect(p.openrouter.models['tiny/small-model'].limit).toEqual({ context: 8192, output: 4096 });
  });
```

In `tests/sidecar/models-command.test.js`, change the five literals:
- the four `toContain` strings ending `; rows without a ceiling keep the engine default and outputBudget cannot clamp them` → end them instead with `; rows without a ceiling get an outputBudget through the engine flag alone, clamped only where the engine's own catalog knows the model`;
- the `models.dev lookup disabled` literal → `Ceilings: models.dev lookup disabled (modelsDevCeilings: false); openai/anthropic/deepseek direct rows carry no ceiling here and are clamped by the engine's own catalog instead (Google publishes its own ceiling and OpenRouter rows keep OpenRouter's)`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/build-provider-models-output-limit.test.js tests/sidecar/models-command.test.js`
Expected: FAIL — the direct-anthropic test gets `{}`; the five `Ceilings:` literals do not match.

- [ ] **Step 3: Lift the guard**

In `src/utils/config.js :: buildProviderModels`, inside `addRoute`, delete the whole block from the comment line `// #218 council #230 A1: DIRECT anthropic routes are HELD OUT of clamping.` through the closing `}` of `if (fullModel.startsWith('anthropic/')) { … return; }`, and put in its place:

```js
    // #218 PR 2: direct `anthropic/*` is no longer held out (council #230 A1
    // held it out until descriptor x thinking-budget was measured). Measured,
    // probe rows K1/K2/K3/K4/K9/K10: the descriptor lowers the reservation on
    // that route exactly as on OpenRouter (K1: 8000); a thinking variant's
    // budget is ADDED on top of it (K2: 8000 + 16000 = 24000); and the sum is
    // clamped to the model's real ceiling whatever the descriptor or flag said
    // (K3/K4/K10: 64000 for haiku). No descriptor can push a thinking leg over
    // the ceiling. amicus sends no variant today (F1); PR 4 inherits the numbers.
    // Named mutant "ANTHROPICHELDOUT" in tests/build-provider-models-output-limit.test.js.
```

Then replace the `getOutputBudget` docblock (from `/**` before `#218: the configured per-leg output budget` through ` */`) with:

```js
/**
 * #218: the configured per-leg output budget, or null when unset.
 *
 * OPT-IN BY DESIGN — unset means "register every model as `{}` and set no
 * engine flag", which is pre-#218 behaviour exactly. Set it and every leg
 * reserves min(budget, the model's real ceiling) wherever a ceiling is known.
 * This one value feeds BOTH levers so they can never disagree: the per-model
 * `limit` descriptor (buildProviderModels, for routes the amicus catalog knows)
 * and OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX (opencode-client.js :: startServer,
 * set to the budget for every engine amicus starts and clamped by the engine's
 * own catalog). Values above 32000 are LIVE since PR 2 (probe K6: 100000 on the
 * wire); a model neither catalog knows receives the budget as-is (J2/K13).
 *
 * ⚠️ The descriptor half needs a catalog refreshed since #218 added
 * `maxOutputTokens` (`amicus models --refresh`); the flag half needs nothing.
 * `amicus doctor`'s `output-budget` row says which routes get which.
 *
 * @returns {number|null} positive integer, or null when unset/malformed
 */
```

- [ ] **Step 4: Sweep `model-output-limit.js`'s docblock**

Replace consequence 1 (the numbered item beginning `1. Supplying the model's REAL ceiling is ARITHMETICALLY INERT.` through `It would not.`) with:

```
 *   1. Supplying the model's REAL ceiling through THIS DESCRIPTOR ALONE is
 *      ARITHMETICALLY INERT. kimi-k3's true ceiling is 943,718 and
 *      Math.min(943718, 32000) is still 32000. Through the descriptor only a
 *      value BELOW OUTPUT_TOKEN_MAX changes the outbound request. Raising
 *      OUTPUT_TOKEN_MAX itself is engine-output-flag.js's job (PR 2): with the
 *      flag set to the same budget the two levers agree on min(budget, ceiling)
 *      — measured, probe rows C2 and K6.
```

Replace the paragraph beginning `WHAT THIS DOES NOT FIX.` through `No claim is made that it does.` with:

```
 * WHAT THIS DOES NOT FIX. #218 conflates two modes that pull in OPPOSITE
 * directions on this one knob. Mode 1 (credit rejection) needs the reservation
 * LOWERED — this descriptor does that. Mode 2 (a leg spending its whole
 * allowance on reasoning and emitting 0-2 output tokens) needs it RAISED, which
 * this descriptor cannot do (the Math.min) and the engine flag can
 * (engine-output-flag.js) — but its real cause is reasoning effort, and the
 * `--thinking` amicus sends today never reaches the engine at all (probe F1:
 * the prompt API reads `variant`, not `reasoning`; PR 4). Lowering the budget
 * makes such a leg fail faster and cheaper; raising it gives the reasoning more
 * room. Neither makes it produce output, and no claim is made that either does.
```

Also change the POLICY paragraph's last sentence from `With no configured budget every model is still registered as `{}` — byte-identical to pre-#218 behaviour.` to `With no configured budget every model is still registered as `{}` and no engine flag is set — byte-identical to pre-#218 behaviour.`

- [ ] **Step 5: Sweep `model-ceilings-modelsdev.js` and `models-ceiling-line.js`**

In `src/utils/model-ceilings-modelsdev.js`'s docblock, replace the sentence `This gives AMICUS the same numbers so it can clamp an outputBudget on direct routes (direct `anthropic/*` is held out until the thinking-budget interaction is measured — `config.js :: buildProviderModels`) and name a reservation in a dead-leg note.` with `This gives AMICUS the same numbers so it can clamp an outputBudget on direct routes through the descriptor (a route it cannot clamp still gets the budget through the engine flag — engine-output-flag.js) and name a reservation in a dead-leg note.`

In `src/sidecar/models-ceiling-line.js :: fmtCeilingLine`:
- the failure return's suffix `; rows without a ceiling keep the engine default and outputBudget cannot clamp them` → `; rows without a ceiling get an outputBudget through the engine flag alone, clamped only where the engine's own catalog knows the model`;
- the `disabled` return → `'Ceilings: models.dev lookup disabled (modelsDevCeilings: false); openai/anthropic/deepseek direct rows carry no ceiling here and are clamped by the engine\'s own catalog instead (Google publishes its own ceiling and OpenRouter rows keep OpenRouter\'s)'`;
- the comment above it (`// Named, not "direct routes": …`) → `// Named, not "direct routes": Google publishes its own ceiling first-party and OpenRouter rows keep OpenRouter's. Since PR 2 the budget still reaches the unnamed rows through the engine flag, clamped by the engine's own catalog (probe K5/K12).`

Run: `node -e "console.log(require('fs').readFileSync('src/sidecar/models-ceiling-line.js','utf8').split('\n').length)"`
Expected: ≤ 300.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest tests/build-provider-models-output-limit.test.js tests/sidecar/models-command.test.js tests/model-catalog-ceilings.test.js tests/utils/model-ceilings-modelsdev.test.js`
Expected: PASS.

- [ ] **Step 7: Kill the named mutant, then restore**

Re-add the two-line guard to `addRoute`; the first HAIKU test must FAIL with `{}`. Restore; green.

- [ ] **Step 8: Grep the sweep is complete, lint, citations, commit**

Run: `grep -rn "held out\|hold-out\|until PR 2\|cannot raise\|only be lowered\|can only lower" src/ | grep -v "no longer held out\|held it out"`
Expected: no lines.

Run: `npx eslint src/ tests/helpers/ && node scripts/check-citations.js --all && node scripts/check-file-sizes.js --all`
Expected: clean.

```bash
git add src/utils/config.js src/utils/model-output-limit.js src/utils/model-ceilings-modelsdev.js src/sidecar/models-ceiling-line.js tests/build-provider-models-output-limit.test.js tests/sidecar/models-command.test.js
git commit -m "feat: direct anthropic routes clamp like any other — the K rows measured descriptor x thinking budget (#218 PR 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The `output-budget` doctor row

**Files:**
- Create: `src/utils/doctor-output-budget-check.js`
- Modify: `src/cli-handlers-doctor.js` (one `require`, one `realDeps` entry, one `checks.push` — exactly three lines; the file is at 289/300)
- Modify: `tests/helpers/doctor-base-deps.js` (one pinned dep)
- Modify: `docs/usage.md` (`### amicus doctor` table row + one paragraph)
- Test: `tests/doctor-output-budget.test.js`

**Interfaces:**
- Consumes: `normalizeOutputBudget`, `buildLimitLookup`, `computeModelLimit`, `positiveCount` (`src/utils/model-output-limit.js`); `OUTPUT_TOKEN_FLAG`, `ENGINE_DEFAULT_OUTPUT_TOKENS` (Task 2); deps `readOutputBudgetRaw() → *` (new), `readCache()`, `collectAliasSources() → [{alias, model, source}]`, `getConfigDir()`, `env`.
- Produces: `evaluateOutputBudget(d) → {id:'output-budget', name:'Output budget', status, message, hint}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/doctor-output-budget.test.js`:

```js
'use strict';

/**
 * #218 PR 2 — the 'output-budget' doctor row.
 *
 * Verifiable voice: every message states what the check READ (the stored
 * value, the ambient flag, the catalog) and what the probe measured about it
 * (BACKLOG "v4.9.4 records": D1/D2 silent fallback, K5/K12 engine-side clamp,
 * J2/K13 raw pass-through). The one thing it must never do is print a healthy
 * row for a value the engine will silently ignore.
 */

const { evaluateOutputBudget } = require('../src/utils/doctor-output-budget-check');

const CATALOG = {
  models: [
    { id: 'openrouter/moonshotai/kimi-k3', contextLength: 1048576, maxOutputTokens: 943718 },
    { id: 'openrouter/z-ai/glm-5.3', contextLength: 131072, maxOutputTokens: 131072 },
    { id: 'anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 },
    { id: 'openrouter/old/no-ceiling', contextLength: 131072, maxOutputTokens: null },
  ],
};
const ALIASES = [
  { alias: 'kimi', model: 'openrouter/moonshotai/kimi-k3', source: 'defaults' },
  { alias: 'glm', model: 'openrouter/z-ai/glm-5.3', source: 'defaults' },
  { alias: 'haiku', model: 'anthropic/claude-haiku-4-5', source: 'defaults' },
  { alias: 'old', model: 'openrouter/old/no-ceiling', source: 'user-config' },
  { alias: 'ghost', model: 'openrouter/nobody/unknown', source: 'user-config' },
  // the same model under two aliases counts ONCE
  { alias: 'kimi2', model: 'openrouter/moonshotai/kimi-k3', source: 'user-config' },
];

function deps(over = {}) {
  return {
    readOutputBudgetRaw: () => undefined,
    readCache: () => CATALOG,
    collectAliasSources: () => ALIASES,
    getConfigDir: () => '/cfg',
    env: {},
    ...over,
  };
}

describe('evaluateOutputBudget — nothing configured', () => {
  test('unset, no ambient flag -> ok, names the engine default', () => {
    const row = evaluateOutputBudget(deps());
    expect(row).toMatchObject({ id: 'output-budget', name: 'Output budget', status: 'ok', hint: null });
    expect(row.message).toBe('not set — the engine default (32000 per leg) applies');
  });

  test('unset, ambient flag valid -> ok, says the ambient value raises the default', () => {
    const row = evaluateOutputBudget(deps({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' } }));
    expect(row.status).toBe('ok');
    expect(row.message).toContain('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000');
    expect(row.message).toContain('raises the engine default to 64000 per leg');
  });

  test.each(['64000abc', '0', '-5', ''])(
    'unset, ambient flag %p malformed -> WARN: the engine falls back to 32000 silently (D1/D2)', (v) => {
      const row = evaluateOutputBudget(deps({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: v } }));
      // Named mutant "AMBIENTUNCHECKED": treat any ambient string as valid — status ok.
      expect(row.status).toBe('warn');
      expect(row.message).toContain('not a positive integer');
      expect(row.message).toContain('silently falls back to 32000');
      expect(row.hint).toContain('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
    });
});

describe('evaluateOutputBudget — a budget is configured', () => {
  test.each([0, -1, 'lots', '8000', true, 0.5])(
    'malformed %p -> WARN, value echoed, hint names the config file', (bad) => {
      const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => bad }));
      expect(row.status).toBe('warn');
      expect(row.message).toContain(JSON.stringify(bad));
      expect(row.message).toContain('not a positive integer');
      expect(row.hint).toContain('/cfg/config.json');
    });

  test('valid, no catalog cache -> WARN with the refresh hint; still says what the flag does', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000, readCache: () => null }));
    expect(row.status).toBe('warn');
    expect(row.message).toContain('8000 per leg');
    expect(row.message).toContain('no catalog cache');
    expect(row.message).toContain('an unknown model receives 8000 as-is');
    expect(row.hint).toBe('amicus models --refresh');
  });

  test('valid, at or below the engine default, some routes unclamped -> ok (the engine clamps what it knows)', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000 }));
    expect(row.status).toBe('ok');
    expect(row.message).toContain('8000 per leg');
    // 5 distinct models: kimi, glm, haiku clamp; old (no ceiling) + ghost (absent) do not.
    expect(row.message).toContain('3 of 5 alias routes clamped to a catalog ceiling');
    expect(row.message).toContain('2 without a catalog ceiling (openrouter/old/no-ceiling, openrouter/nobody/unknown)');
    expect(row.hint).toBeNull();
  });

  test('valid, ABOVE the engine default, some routes unclamped -> WARN: an unknown model gets it raw (J2/K13)', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 40000 }));
    // Named mutant "NODEFAULTGATE": drop the `budget > ENGINE_DEFAULT_OUTPUT_TOKENS`
    // condition — the previous test turns warn; keep both.
    expect(row.status).toBe('warn');
    expect(row.message).toContain('40000 per leg');
    expect(row.message).toContain('an unknown model receives 40000 as-is');
    expect(row.hint).toContain('amicus models --refresh');
  });

  test('every route clamped -> ok, no caveat', () => {
    const only = ALIASES.filter((a) => ['kimi', 'haiku'].includes(a.alias));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 40000, collectAliasSources: () => only }));
    expect(row.status).toBe('ok');
    expect(row.message).toBe('40000 per leg; 2 of 2 alias routes clamped to a catalog ceiling');
  });

  test('a reservation of at least half a route\'s context window -> WARN naming the route and the numbers', () => {
    const only = ALIASES.filter((a) => ['kimi', 'glm'].includes(a.alias));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 100000, collectAliasSources: () => only }));
    // glm: min(100000, 131072) = 100000 of 131072 (76%); kimi: 100000 of 1048576 (fine).
    expect(row.status).toBe('warn');
    expect(row.message).toContain('reserves at least half the context window of openrouter/z-ai/glm-5.3 (100000 of 131072)');
    expect(row.message).not.toContain('kimi-k3 (');
    expect(row.hint).toContain('lower outputBudget');
  });

  test('exactly half counts as at least half', () => {
    const only = [{ alias: 'half', model: 'openrouter/x/half', source: 'defaults' }];
    const cache = { models: [{ id: 'openrouter/x/half', contextLength: 20000, maxOutputTokens: 20000 }] };
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 10000, collectAliasSources: () => only, readCache: () => cache }));
    expect(row.status).toBe('warn');
    expect(row.message).toContain('(10000 of 20000)');
  });

  test('long lists are shortened to three names plus a count', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ alias: `g${i}`, model: `openrouter/ghost/m${i}`, source: 'user-config' }));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000, collectAliasSources: () => many }));
    expect(row.message).toContain('(openrouter/ghost/m0, openrouter/ghost/m1, openrouter/ghost/m2, +2 more)');
  });

  test('an ambient flag alongside a configured budget is reported as overridden for amicus-started engines', () => {
    const row = evaluateOutputBudget(deps({
      readOutputBudgetRaw: () => 8000,
      env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' },
    }));
    expect(row.message).toContain('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000 in this environment is overridden by outputBudget for engines amicus starts');
  });

  test('falls through to process.env only when no env is injected', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
    const saved = process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
    process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = '64000';
    try {
      const d = deps(); delete d.env;
      expect(evaluateOutputBudget(d).message).toContain('=64000');
    } finally {
      if (had) { process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = saved; } else { delete process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX; }
    }
  });
});

// Registration — hermetic, same rationale as tests/doctor-base-url.test.js:
// runDoctorChecks computes the FULL list, so every dep must be pinned.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');

describe('doctor registration', () => {
  test('runDoctorChecks carries the output-budget row, healthy on the base fixture, placed after aliases', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks(makeBaseDeps());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('output-budget');
    expect(ids.indexOf('output-budget')).toBe(ids.indexOf('aliases') + 1);
    expect(rows.find((r) => r.id === 'output-budget').status).toBe('ok');
  });

  test('a thrown dep becomes an error row, never a crash', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks(makeBaseDeps({ readOutputBudgetRaw: () => { throw new Error('boom'); } }));
    expect(rows.find((r) => r.id === 'output-budget')).toMatchObject({ status: 'error', message: 'boom' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/doctor-output-budget.test.js`
Expected: FAIL — `Cannot find module '../src/utils/doctor-output-budget-check'`.

- [ ] **Step 3: Write the check**

Create `src/utils/doctor-output-budget-check.js`:

```js
/**
 * @module doctor-output-budget-check
 * #218 PR 2: the 'output-budget' doctor row.
 *
 * VERIFIABLE voice (same rule as doctor-base-url-check.js): the row states only
 * what it read — the configured `outputBudget` as stored, the ambient
 * OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX this process sees, and which alias
 * routes the cached catalog can clamp. It never claims what a provider will do.
 *
 * What earns a WARN, and why (probe rows in brackets, BACKLOG "v4.9.4 records"):
 *   - a malformed budget or a malformed ambient flag: the engine falls back to
 *     32000 SILENTLY (D1/D2) — the one failure the product principle forbids;
 *   - a budget above the engine default with alias routes the catalog cannot
 *     clamp: the engine clamps routes its own catalog knows (K5), but a model
 *     neither catalog knows receives the budget as-is (J2/K13);
 *   - a reservation of at least half a route's context window: input plus
 *     max_tokens has to fit the window, and the engine subtracts the same
 *     reservation from the window before compaction (read in the binary), so
 *     such a budget starves the prompt.
 */
'use strict';

const { normalizeOutputBudget, buildLimitLookup, computeModelLimit, positiveCount } = require('./model-output-limit');
const { OUTPUT_TOKEN_FLAG, ENGINE_DEFAULT_OUTPUT_TOKENS } = require('./engine-output-flag');

const ID = 'output-budget';
const NAME = 'Output budget';
const row = (status, message, hint = null) => ({ id: ID, name: NAME, status, message, hint });

/** Up to three names, then "+N more". @param {string[]} names @returns {string} */
function shortList(names) {
  const head = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${head}, +${names.length - 3} more` : head;
}

/**
 * @param {{readOutputBudgetRaw:Function, readCache:Function, collectAliasSources:Function,
 *   getConfigDir:Function, env?:NodeJS.ProcessEnv}} d
 * @returns {{id:string,name:string,status:string,message:string,hint:?string}}
 */
function evaluateOutputBudget(d) {
  const env = d.env || process.env;
  const ambient = env[OUTPUT_TOKEN_FLAG];
  const raw = d.readOutputBudgetRaw();
  const dflt = `the engine default (${ENGINE_DEFAULT_OUTPUT_TOKENS} per leg) applies`;

  if (raw === undefined) {
    if (ambient === undefined) { return row('ok', `not set — ${dflt}`); }
    // The engine parses the flag as a positive integer and otherwise ignores it
    // without a word (D1 `64000abc`, D2 `0`): the value has to be checked here
    // or a user following the docs' "export the flag" advice gets a silent 32000.
    const n = positiveCount(Number(ambient));
    return n === null
      ? row('warn',
        `not set — ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment is not a positive integer; the engine silently falls back to ${ENGINE_DEFAULT_OUTPUT_TOKENS}`,
        `unset ${OUTPUT_TOKEN_FLAG}, or set it to a positive integer`)
      : row('ok', `not set — ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment raises the engine default to ${n} per leg`);
  }

  const budget = normalizeOutputBudget(raw);
  if (budget === null) {
    return row('warn', `${JSON.stringify(raw)} is not a positive integer — ignored; ${dflt}`,
      `set outputBudget to a positive integer in ${d.getConfigDir()}/config.json, or remove it`);
  }
  const overridden = ambient === undefined ? ''
    : `; ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment is overridden by outputBudget for engines amicus starts`;

  const cache = d.readCache();
  if (!cache || !Array.isArray(cache.models)) {
    return row('warn',
      `${budget} per leg — no catalog cache, so no route is clamped to a known ceiling (the engine clamps routes its own catalog knows; an unknown model receives ${budget} as-is)${overridden}`,
      'amicus models --refresh');
  }

  const limits = buildLimitLookup(cache.models);
  const routes = [...new Set(d.collectAliasSources().map((s) => s.model))];
  const unclamped = [];
  const starved = [];
  for (const id of routes) {
    const limit = computeModelLimit(limits.get(id), budget);
    if (!limit) { unclamped.push(id); continue; }
    if (limit.output * 2 >= limit.context) { starved.push(`${id} (${limit.output} of ${limit.context})`); }
  }

  let message = `${budget} per leg; ${routes.length - unclamped.length} of ${routes.length} alias routes clamped to a catalog ceiling`;
  let status = 'ok';
  let hint = null;
  if (unclamped.length > 0) {
    message += `; ${unclamped.length} without a catalog ceiling (${shortList(unclamped)}) — the engine clamps those its own catalog knows, an unknown model receives ${budget} as-is`;
    // At or below the default the flag can only lower what the engine sends
    // (K12); above it an unknown model is the one place the number goes out
    // unclamped (J2/K13), so that is the only case worth a warning.
    if (budget > ENGINE_DEFAULT_OUTPUT_TOKENS) {
      status = 'warn';
      hint = 'amicus models --refresh  (a budget above the engine default reaches an unknown model unclamped)';
    }
  }
  if (starved.length > 0) {
    message += `; reserves at least half the context window of ${shortList(starved)}`;
    status = 'warn';
    hint = hint || 'lower outputBudget — input plus the reservation must fit the context window';
  }
  return row(status, message + overridden, hint);
}

module.exports = { evaluateOutputBudget };
```

- [ ] **Step 4: Register it (three lines) and pin the fixture**

In `src/cli-handlers-doctor.js`:
- after the line `const baseUrlCheck = require('./utils/doctor-base-url-check');` add:
  `const outputBudgetCheck = require('./utils/doctor-output-budget-check'); // #218 PR 2 — the 'output-budget' row.`
- in `realDeps()`, directly after the `collectAliasSources:` line add:
  `readOutputBudgetRaw: () => (require('./utils/config').loadConfig() || {}).outputBudget, // #218 PR 2: as stored, so a malformed value is echoed`
- in `runDoctorChecks`, directly after the `checks.push(guard('aliases', 'Model aliases', …));` line add:
  `checks.push(guard('output-budget', 'Output budget', () => outputBudgetCheck.evaluateOutputBudget(d))); // #218 PR 2`

Run: `node -e "console.log(require('fs').readFileSync('src/cli-handlers-doctor.js','utf8').split('\n').length)"`
Expected: 292 (≤ 300).

In `tests/helpers/doctor-base-deps.js`, directly after the `findStaleAliases: () => [],` line add:

```js
    // #218 PR 2: the output-budget row reads the stored value as-is. Pinned
    // absent (not null — null would be "set to null", a malformed value) so the
    // base fixture stays healthy regardless of the host's real config.json.
    readOutputBudgetRaw: () => undefined,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/doctor-output-budget.test.js tests/cli-handlers-doctor.test.js tests/doctor-base-url.test.js tests/doctor-handler.test.js tests/setup-doctor-finale.test.js tests/result-schema-doctor.test.js`
Expected: PASS.

- [ ] **Step 6: Kill the named mutants, then restore**

AMBIENTUNCHECKED (replace `positiveCount(Number(ambient))` with `Number(ambient) || 1`) → the malformed-ambient tests FAIL. NODEFAULTGATE (drop the `budget > ENGINE_DEFAULT_OUTPUT_TOKENS` condition) → the "at or below the default" test FAILS. Restore; green.

- [ ] **Step 7: Document the row**

In `docs/usage.md`'s `### amicus doctor` table, directly after the `aliases` row add:

```
| `output-budget` **(#218)** | `outputBudget` is a positive integer and says which alias routes the catalog can clamp it to; whether an ambient `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` is honoured or overridden; flags a malformed value in either place (the engine falls back to 32,000 without a word on those) and a budget that takes at least half of a route's context window | warn |
```

After the paragraph that begins `**`local-providers`** probes every configured local provider` add:

```
**`output-budget`** reads the stored `outputBudget` and the `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` this process sees, and reports what the value reaches (see [Output budget](configuration.md#output-budget-outputbudget)): how many alias routes the cached catalog can clamp it to, which cannot be (the engine clamps those its own catalog knows; a model neither knows receives the budget as-is — a warning only when the budget is above the engine's 32,000 default, since below it the flag can only lower what goes out), and whether a budget takes at least half of a route's context window. The malformed cases are the ones worth the row: the engine ignores a non-integer flag or `outputBudget` *silently* and sends 32,000 — measured — so `doctor` is where that surfaces.
```

- [ ] **Step 8: Lint, sizes, citations, commit**

Run: `npx eslint src/ tests/helpers/ && node scripts/check-file-sizes.js --all && node scripts/check-citations.js --all`
Expected: clean.

```bash
git add src/utils/doctor-output-budget-check.js src/cli-handlers-doctor.js tests/helpers/doctor-base-deps.js tests/doctor-output-budget.test.js docs/usage.md
git commit -m "feat(doctor): output-budget row says what the value reaches and flags the engine's silent fallbacks (#218 PR 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs sweep — `docs/configuration.md` and `CHANGELOG.md`

**Files:**
- Modify: `docs/configuration.md` (the whole `## Output budget (`outputBudget`)` section, up to the `---` before `## Routing`)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`: amend the P3 bullet, add one bullet)

**Interfaces:** none (docs only).

- [ ] **Step 1: Replace the configuration section**

In `docs/configuration.md`, replace everything from the line `## Output budget (`outputBudget`)` down to (not including) the `---` line that precedes `## Routing` with:

````markdown
## Output budget (`outputBudget`)

Each council leg reserves a `max_tokens` allowance before the model runs. Amicus previously handed
OpenCode no per-model limit at all, so OpenCode's own fixed default — **32,000** — governed every
leg regardless of the model's real ceiling.

That reservation is not free. OpenRouter validates it against your remaining credit *before* serving,
so a leg that would have emitted 800 tokens gets refused outright for asking to reserve 32,000:

```
This request requires more credits, or fewer max_tokens.
You requested up to 32000 tokens, but can only afford 354
```

`outputBudget` sets the reservation, in either direction. Every leg reserves
`min(outputBudget, that model's real ceiling)` wherever a ceiling is known — by the Amicus catalog
(a per-model `limit` descriptor) or, failing that, by the engine's own catalog (every engine Amicus
starts gets `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` set to the budget). A model neither catalog
knows receives the budget itself, exactly as it received the raw 32,000 before.

| Setting | Values | Default | Effect |
|---------|--------|---------|--------|
| `outputBudget` (config.json, top-level) | positive integer | *unset* | Per-leg output reservation, clamped to each model's real ceiling wherever one is known. Unset means no limit is sent and no engine flag is set — OpenCode's 32,000 default applies, exactly as before. |
| `modelsDevCeilings` (config.json, top-level) | `true` / `false` | `true` | Fill direct-provider context/ceiling numbers from models.dev at refresh. Set `false` to never contact models.dev; the openai / anthropic / deepseek direct rows then carry no ceiling in the Amicus catalog and are clamped by the engine's own catalog instead (Google publishes its own ceiling and OpenRouter rows keep OpenRouter's). |

`modelsDevCeilings` is the opt-out for the one third-party lookup a refresh makes. Only a literal
`false` turns it off; the key being absent means it runs. Even with it on, the call is **skipped
automatically when no candidate row is missing a number** — a refresh with nothing to fill never
contacts models.dev at all. `amicus models --refresh` names whichever of those happened on its
`Ceilings:` line.

Set it by hand-editing `~/.config/amicus/config.json`:

```json
{ "outputBudget": 8000 }
```

`amicus doctor`'s `output-budget` row then says what the value reaches: how many of your alias
routes the catalog can clamp it to, whether an `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` you exported
yourself is being honoured or overridden, and a malformed value in either place — the engine falls
back to 32,000 *silently* on those (measured), so the doctor row is where it surfaces.

Four things worth knowing before you set it. Every number below was measured on the wire by
`scripts/probe-max-tokens.js` against the pinned engine; the row ids refer to the two probe tables
filed in `BACKLOG.md` under "v4.9.4 records" (#218 PR 1 and PR 2).

- **Above 32,000 it is the engine flag doing the work.** OpenCode computes
  `Math.min(limit.output, OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX)` with the flag defaulting to
  32,000, so Amicus sets that flag to your budget for every engine it starts — around the spawn
  only. It never lands in your shell, and a value you exported yourself is honoured untouched when
  `outputBudget` is unset and overridden (for Amicus-started engines only) when it is set. A budget
  of 100,000 on a model with a 943,718 ceiling reserves 100,000 (K6); on a model whose ceiling is
  64,000 it reserves 64,000 (K5). The flag is experimental on the engine's side, and a malformed
  value is ignored without a word (D1/D2): re-run the probe after every engine bump.
- **It clamps best with a catalog that knows each model's ceiling.** Run `amicus models --refresh`
  after setting it. OpenRouter rows carry OpenRouter's own ceiling and Google rows carry Google's;
  the direct `openai` / `anthropic` / `deepseek` rows — and any other row whose number the provider
  left empty or unusable — are filled from [models.dev](https://models.dev) at refresh. models.dev
  fills a field only where the provider gave no usable positive integer (a null, a zero, a negative
  or a malformed number), and never overwrites a usable provider value; the `openrouter/openrouter/*`
  meta-routers and local-provider rows are never filled at all. The refresh output says how many
  rows were filled or why none could be. A route the Amicus catalog cannot clamp still gets the
  budget through the engine flag, clamped by the engine's own catalog where it knows the model
  (K12: 8,000 on a bare kimi row); a model neither knows receives the budget as-is (K13).
- **Direct-Anthropic thinking legs add their thinking budget on top.** On the direct `anthropic/*`
  route the engine adds a thinking variant's budget to the reservation — 8,000 becomes 24,000 with
  the 16,000-token `high` variant (K2) — and clamps the sum to the model's real ceiling (K3/K4/K10:
  64,000 for haiku, whatever the descriptor or the flag said). Amicus sends no thinking variant
  today (`--thinking` never reached the engine — F1), so this is the number PR 4 inherits, not one
  you can hit yet. `openrouter/anthropic/*` rows route through OpenRouter's effort mapping and clamp
  normally.
- **The reservation comes out of the context window.** Input plus `max_tokens` has to fit the
  window, and the engine subtracts this same reservation from the window before it decides to
  compact (read in the pinned binary's `SessionCompaction.isOverflow`, not wire-measured). A budget
  of 100,000 leaves a 131,072-context model 31,072 tokens for the prompt. `amicus doctor` warns when
  a budget takes at least half of any alias route's window.

This addresses reservation *rejections* and *clips*. It does **not** stop a reasoning-heavy model
from spending its whole allowance on reasoning and emitting nothing — that is governed by reasoning
effort, which today's `--thinking` never delivers to the engine (PR 4 sends `variant` instead).
Lowering the budget makes such a leg fail faster and cheaper; raising it gives the reasoning more
room; neither makes it produce output.

````

- [ ] **Step 2: Amend the CHANGELOG**

In `CHANGELOG.md` under `## [Unreleased]` → `### Added`, in the **Direct-provider output ceilings (#218 P3)** bullet:
- replace `(`outputBudget` then cannot clamp the openai / deepseek direct rows — direct anthropic is held out regardless; Google publishes its own ceiling and OpenRouter rows keep OpenRouter's)` with `(the openai / anthropic / deepseek direct rows then carry no ceiling in the Amicus catalog and are clamped by the engine's own catalog instead; Google publishes its own ceiling and OpenRouter rows keep OpenRouter's)`;
- replace the tail from `Direct `anthropic/*` is the one route held back:` through `normally.` with `Direct `anthropic/*` was held out of clamping by the council review of PR #230 until the thinking-budget interaction was measured; PR 2 measured it and lifted the hold-out — see the next bullet.`

Then, directly after that bullet (before the `scripts/probe-max-tokens.js` bullet), add:

```markdown
- **`outputBudget` now works in both directions (#218 PR 2).** A budget above the engine's 32,000
  default is honoured: Amicus starts every engine with `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` set to
  the budget — around the spawn only, restored before anything is awaited, never written to the
  caller's shell; a value you exported yourself is honoured untouched when no budget is set — so
  every leg reserves `min(budget, ceiling)` wherever a ceiling is known, by the Amicus catalog through
  the per-model descriptor or else by the engine's own, and a model neither knows receives the budget
  as-is, exactly as it received the raw 32,000 before. Direct `anthropic/*` routes are no longer held
  out: the probe measured the descriptor lowering the reservation there (K1), a thinking variant's
  budget added on top (K2: 8,000 + 16,000 = 24,000) and the sum clamped to the model's real ceiling
  (K3/K4/K10), so no budget can push a thinking leg over it. Thirteen new probe rows (K1–K13) pin
  every shape this ships, and the full 32-case matrix is filed in the BACKLOG. New `doctor` row
  **`output-budget`** says what the value reaches — routes the catalog can clamp, routes it cannot,
  an ambient flag honoured or overridden — and flags the one silent failure the engine has here: a
  malformed budget or flag, on which it falls back to 32,000 without a word.
```

- [ ] **Step 3: Validate the doc tree**

Run: `node scripts/validate-docs.js --full && grep -rn "held out\|until PR 2\|can only lower\|Amicus does not set\|not set by Amicus" docs/configuration.md docs/usage.md CHANGELOG.md README.md | grep -v "^CHANGELOG.md:.*\[4.9.3\]" | grep -v "was held out"`
Expected: validate-docs clean; the grep prints nothing (the released 4.9.3 bullet may still say "can only LOWER" — leave it; it was true of 4.9.3).

- [ ] **Step 4: Commit**

```bash
git add docs/configuration.md CHANGELOG.md
git commit -m "docs: outputBudget is bidirectional — every reservation sentence carries the measured rule (#218 PR 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Gates, plan file, PR

**Files:**
- Modify (generated): `docs/architecture-map.md`, possibly `CLAUDE.md` (via `npm run generate-docs`)
- Add (force): `docs/superpowers/plans/2026-09-05-218-pr2-output-budget.md`

- [ ] **Step 1: Run every gate**

```bash
npm run lint && npm run check:sizes && npm run check:citations && npm run check:secrets && npm run validate-docs && npm run generate-docs
```

Expected: each clean. `generate-docs` rewrites `docs/architecture-map.md` with rows for `utils/engine-output-flag.js` (four exports listed) and `utils/doctor-output-budget-check.js` (`evaluateOutputBudget()`); `git diff --stat` shows only those generated files (and `CLAUDE.md` if its inventory moved). Stage them.

- [ ] **Step 2: Full suites**

Run: `npx jest 2>&1 | tail -6`
Expected: `Tests: … passed`, exit 0 (baseline on main: 599 suites, 9285 passed, 8 skipped — expect three more suites).

Run: `npm run test:integration 2>&1 | tail -4`
Expected: the keyless rail passes (self-skips are fine).

- [ ] **Step 3: Commit the generated docs, then force-add the plan**

```bash
git add docs/architecture-map.md CLAUDE.md
git commit -m "docs: architecture map rows for engine-output-flag and doctor-output-budget-check (#218 PR 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git add -f docs/superpowers/plans/2026-09-05-218-pr2-output-budget.md
git commit -m "docs(plan): #218 PR 2 implementation plan, with the K1-K13 measurements it was written from

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(If `git add docs/architecture-map.md CLAUDE.md` stages nothing because generate-docs changed nothing, skip that first commit.)

- [ ] **Step 4: Push and open the PR with the council label**

```bash
git push -u origin fix/218-pr2-output-budget
gh pr create -R BourbonDog/amicus --base main --label council-review \
  --title "outputBudget is bidirectional: engine flag from the same knob, direct-anthropic hold-out lifted on measurement, doctor output-budget row (#218 PR 2)" \
  --body-file .superpowers/sdd/2026-09-05-218-pr2-output-budget/pr-body.md
```

The body (written by the controller before this step) carries: the K-row table from the Design section, the five rules, the three rulings R1–R3, the file list, and `🤖 Generated with [Claude Code](https://claude.com/claude-code)` as its last line.

- [ ] **Step 5: Verify the label and the council run**

```bash
gh pr view --json number,labels,mergeable -R BourbonDog/amicus --jq '{number, labels: [.labels[].name], mergeable}'
gh run list -R BourbonDog/amicus --workflow=council-review.yml --branch fix/218-pr2-output-budget --limit 3
```

Expected: `council-review` present, `MERGEABLE`; one `council-review.yml` run `in_progress` (a second, cancelled run from the opened+labeled double-fire is routine). Report the PR URL and the run id.

---

## Self-review

**Spec coverage.** PR 2's three headline items: bidirectional `outputBudget` via the env flag → Tasks 2, 3 (mechanism + pin) and Task 4 (values above 32,000 flow through the descriptor unchanged); doctor check → Task 5; docs sweep of every "can only lower" / "held out" sentence → Tasks 4 (src docblocks and the `Ceilings:` lines), 5 (`usage.md`), 6 (`configuration.md`, CHANGELOG). The two measurements PR 1 deferred to PR 2 — descriptor × thinking budget and the three-lever interaction — are Task 1's K rows, and the hold-out lift they justify is Task 4. Deferred PR 1 residuals that were parked "for PR 2": the `_createOpencodeServer` env pin (Task 3); the `--thinking` caveat in `usage.md` stays with PR 4 (it is about `variant`, not the budget); the `retire` request-listener nit and the unstaged `.bak` file are not this PR's.

**Placeholder scan.** Every code step carries its code; the only "paste from the run" instructions (Task 1 Step 6) are followed by a machine check (Step 7) that the pasted bytes match the run.

**Type consistency.** `withOutputTokenFlag(budget, fn, env)` / `outputTokenFlagValue(budget)` / `OUTPUT_TOKEN_FLAG` / `ENGINE_DEFAULT_OUTPUT_TOKENS` are the names used in Tasks 2, 3 and 5. `readOutputBudgetRaw` is the dep name in Task 5's module, registration, fixture and tests. `evaluateOutputBudget(d)` returns the `{id, name, status, message, hint}` shape `guard()` and `renderHuman()` expect. `HCTX` is defined in Task 1 before the K cases use it.

**Line budget.** `src/cli-handlers-doctor.js` 289 → 292. `src/sidecar/models-ceiling-line.js` gains no lines (literal edits and one comment rewrite of equal line count — verify in Task 4 Step 5). New modules: ~75 and ~95 lines.
