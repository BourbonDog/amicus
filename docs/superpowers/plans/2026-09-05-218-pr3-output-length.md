# #218 PR 3 — Name the Mode 2 Death (`finish: 'length'` on the leg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A council leg whose provider stopped at the `max_tokens` reservation before any answer text — the whole reservation spent on reasoning, the #218 "Mode 2" ledger rows (32,000 reasoning, 0–2 output, $0.63 billed for nothing) — ends as a NAMED death (`OUTPUT_LENGTH:` with the engine's own token counts and the budget in force) instead of `complete` with an empty summary or, worse, with its thinking promoted to the review; a review that was cut but still answered is announced, not lost; every leg carries the engine's `finish`; and `startServer` reads the budget once for both levers.

**Architecture:** The engine already records everything needed on the assistant message (`finish`, `tokens`, the parts) — measured, not read, by five new probe rows (L1–L5) plus assistant-message pins on A and H1. `sidecar/conversation-mirror.js` captures the last assistant message's `finish` and whether `output` was promoted from reasoning; `headless.js` exits the poll loop when a message finalized with `finish: 'length'` and no output, and post-loop turns that shape into `sessionError` through a new pure module `src/utils/output-length.js`, so every existing death consumer (metadata `reason`, the dead-leg note, the retry notes, the spend ledger `status`, the exit code) names it with no new case. `finish` rides emit-when-set onto the leg patch, the run document, the ledger row and solo metadata. Stage 1 announces a cut-but-answered review as a `kind: 'info'` note on a new `output-truncated` channel. `startServer` reads `getOutputBudget()` once and hands it to `buildServerOptions` → `buildProviderModels` and to `withOutputTokenFlag`.

**Tech Stack:** Node ≥ 22.12 (CommonJS), jest 29, opencode-ai 1.18.15 pinned (no source map — engine behaviour is measured by `scripts/probe-max-tokens.js`, never read), `@opencode-ai/sdk` 1.18.15.

**Spec:** The four-PR sequence approved on 2026-09-04 (`docs/superpowers/plans/2026-09-04-218-pr1-probe-and-ceilings.md`, "PR sequence": *PR 3 = name the Mode 2 death (`finish: 'length'` on the leg)*), the two items PR 2 parked for PR 3 (ledger of `.superpowers/sdd/2026-09-05-218-pr2-output-budget/progress.md`: "pass the budget once through buildServerOptions"; "a K row for a descriptor ABOVE the engine's own ceiling with no variant"), plus the **Design** section below, which is this PR's spec: written from measurements taken on 2026-09-05 with the probe as extended in commit `1aa04537` (already on this branch), and every rule in it cites the row that measured it.

> **Superseded in part (2026-09-05, by the task reviews during execution):** Task 1 — the record's
> prose names A, H1 and L1–L4 as the rows that pin `want.assistant`, and the pasted block starts at
> the table header like the PR 2 record's (the run's `engine:`/`binary:` preamble is not filed).
> Task 2 — the test file has ten tests, not eleven. Task 5 — the `output-truncated` note's `effect`
> is capitalised ("The review is in the packet…"), matching the rendered-string assertion and the
> `stage1-retry` heal note. Task 6 — the DOUBLEREAD mutant is killed by the assertion that
> `buildProviderModels` receives the value `startServer` read, not by a read count:
> `buildProviderModels`'s fallback calls the module-lexical `getOutputBudget`, which a partial mock
> of the export cannot see; both comments say so. The measured facts in the Design section stand
> unchanged.

## Global Constraints

- Engine pin: `opencode-ai` **1.18.15** / `@opencode-ai/sdk` **1.18.15** (`package-lock.json`). `node_modules` must match (`npm ci` if `node_modules/opencode-ai/package.json` disagrees).
- The probe runs ONLY through its own OUTER/INNER sandbox: `node scripts/probe-max-tokens.js [...]`. Never pass `--inner` by hand, never set a real key, never run it with a real HOME.
- 300-line gate on every `.js` under `src/` and `electron/` (`scripts/check-file-sizes.js`; `src/headless.js`, `src/opencode-client.js`, `src/utils/config.js`, `src/mcp-server.js` are on its exemption list). Measured on 2026-09-05 before any task: `src/sidecar/conversation-mirror.js` **276** (Task 3 adds at most 14 lines), `src/sidecar/fanout-leg.js` **264**, `src/sidecar/fanout-leg-fallback.js` **242**, `src/sidecar/session-utils.js` **296** (Task 4 adds at most 2 lines), `src/sidecar/session-finalize.js` **67**, `src/sidecar/start.js` **264**, `src/sidecar/continue.js` **282**, `src/sidecar/resume.js` **286** (Task 4 changes one argument, adds no line), `src/utils/spend-ledger.js` **131**, `src/utils/result-schema.js` **297** (Task 4 adds at most 2 lines), `src/utils/degrade.js` **89**, `src/council/run-stages.js` **282** (Task 5 adds at most 8 lines), `src/council/run-retry-notes.js` **183**. Count with `wc -l` before and after.
- New `src` modules put the `@module` docblock FIRST, then `'use strict'` (so `generate-docs` fills the architecture-map row), and keep exports at five or fewer so every one is listed.
- Citations in code comments use the symbol-anchor form `path/file.js :: symbol` (checked by `scripts/check-citations.js`); doc-tree files (`docs/`, `BACKLOG.md`) are not scanned.
- `BACKLOG.md` is LF (`.gitattributes eol=lf`). Records are past-tense and filed in the same commit as the change they describe. A probe table filed in a record is pasted byte-identical from the run that produced it.
- Message templates state what was OBSERVED, never what was intended: a reason string names the engine's `finish` and its token counts and the config value in force; it never says why the model did it.
- Never stage `output/`, `site-src/`, or `.superpowers/`. Never `--no-verify`. Never `git checkout --` on uncommitted work. Never force-push.
- Never edit a released CHANGELOG section (`## [4.9.3]` and below); all changes go under `## [Unreleased]`.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The PR is created with `--label council-review` and its council run verified.
- Tests: RED before GREEN; every guard gets a named mutant in a comment naming the test it kills. No real network, no real config dir (jest's `tests/setup/hermetic-config-dir.js` sandboxes `AMICUS_CONFIG_DIR`).

---

## Design (measured 2026-09-05, engine 1.18.15)

### What the probe found

The capture server now answers with a per-case body (`serve`: content, OpenRouter-style `reasoning`, an Anthropic `thinking` block, usage) and speaks the Anthropic messages SSE, so the direct rows record the assistant message instead of an APIError against an OpenAI-shaped stream. `want.assistant` pins `finish`, the two token counts and the text/reasoning part list. Rows A and H1 gained that pin; five rows were added. Run of the whole matrix: `checks: 36 matched, 0 mismatched (none), 1 recorded`, 37 engines started and closed, no direct row records an error any more. Every cell below is a wire or message observation:

| id | case | serve | max_tokens | finish | tokens in/out/reasoning | parts |
|---|---|---|---|---|---|---|
| A | kimi `{}` | default (`ok`, 1 completion token) | 32000 | **length** | 5/1/0 | text |
| H1 | direct anthropic haiku `{}` | default | 32000 | **length** | 5/1/0 | text |
| L1 | kimi `{}` | no content, HIDDEN reasoning; usage completion 32000 / reasoning 32000 | 32000 | **length** | 5/**0**/**32000** | **(none)** |
| L2 | kimi `{}` | no content, VISIBLE reasoning (OpenRouter `reasoning` delta); same usage | 32000 | **length** | 5/0/32000 | **reasoning** |
| L3 | kimi `{}` | reasoning AND content; usage completion 40 / reasoning 32 | 32000 | **length** | 5/**8**/32 | reasoning,text |
| L4 | direct anthropic haiku `{}` + variant `high` | thinking block, no text, stop_reason `max_tokens`; usage output 24000 | 48000 (+ thinking 16000) | **length** | 5/**24000**/**0** | **reasoning** |
| L5 | direct anthropic haiku `limit.output 70000` + env 100000, no variant | default | **64000** | length | 5/1/0 | text |

The dumps: kimi read `limit.output 1048576` on this run (the bundled catalogue — the startup-refresh race the PR 2 record describes; live models.dev says 943718), qwen `131072`, haiku `64000`, the custom model `0/0`.

### The rules those rows establish

1. **The engine records `finish: 'length'` whenever the provider stopped for length, on both provider families** (A, H1, L1–L5). It is the portable signal.
2. **Token counts are not portable.** On OpenAI-compatible routes the engine subtracts reasoning from completion (L3: `output` 8 = 40 − 32; L1/L2: 0 output, 32000 reasoning). On the direct Anthropic route there is no split: `output` carries everything and `reasoning` is 0 (L4: 24000/0). So "output 0" is not a death test; the counts are reported, never decided on.
3. **Hidden reasoning leaves no content part at all** (L1). **Visible reasoning with no answer leaves a `reasoning` part and no `text` part** (L2, L4) — exactly the shape `sidecar/conversation-mirror.js :: mirrorMessages` promotes to `output` once the message finalizes. Today, therefore, a length-stopped leg with visible reasoning returns its THINKING as the review (`complete`, adjudicated), and one with hidden reasoning produces no output at all — and since every completion exit in `headless.js :: runHeadless` (fold marker, SDK idle, stable-poll heuristic) requires `mirror.output.length > 0`, such a leg waits out the no-output backstop and dies under `NO_OUTPUT_BACKSTOP:`'s name, which says "silence past the deadline" about a message the engine had already finalized with a reason.
4. **The engine records no error for a length stop** (no `MessageOutputLengthError` on any row; the SDK type exists). An engine that did would put its name on `msg.info.error`, which the mirror already turns into `sessionError` — that name must win over this PR's.
5. **A descriptor above the engine's own ceiling is clamped to that ceiling with no variant in play** (L5: 70000 + flag 100000 → 64000). K10 showed it with a thinking sum; this shows it is the ceiling, not the sum, that the clamp is about. An Amicus-catalog ceiling above the engine's cannot push a leg past what the engine knows. Nothing to build; documented.
6. **Unchanged:** every wire row A–K13 matched its PR 2 `want`.

### Rulings (decisions this plan makes; each reversible in one line)

- **R1 — the death is keyed on `finish === 'length'` AND "no answer text arrived": `output` empty, or `output` promoted from reasoning parts.** Never on a token count (rule 2). Cost if wrong: one predicate in `utils/output-length.js :: isOutputLengthDeath`.
- **R2 — the death is an ERROR leg with a named reason, through the channel every other death already uses** (`sessionError` → `result.error` → leg `reason` / metadata `reason` → the dead-leg note's `why` → the retry notes → the ledger `status` → the exit code), like `NO_OUTPUT_BACKSTOP:` before it. No consumer needs a new case. This CHANGES released behaviour: on 4.9.3 such a leg was `complete` with an empty summary (dead by `materializeReviews`, announced as "ended 'complete' with no usable output") or, with visible reasoning, `complete` with its thinking as the review; a solo `amicus start --no-ui` exited 0 with "No Output" and now exits 1 with the reason. Documented under CHANGELOG "Changed". Cost if wrong: one `if` in `headless.js`.
- **R3 — the poll loop exits as soon as the last assistant message is finalized with `finish: 'length'` and no output** (rule 3): nothing more will arrive, and waiting out the backstop names the wrong thing. Gated on `'length'` only — a message finished with `'tool-calls'` is followed by another message, and a `'stop'` with no text is a different, unnamed death outside this PR. A leg whose hidden reasoning runs LONGER than the backstop window still dies under the backstop first (the message has not finalized yet); documented.
- **R4 — a cut-but-answered review stays a review.** The leg carries `finish: 'length'`, `materializeReviews` keeps it, and Stage 1 announces it once per seat as `kind: 'info'` on a new `output-truncated` channel — `info` never flips `degraded` and never moves the exit code. Stage-2 judge, chair and debate legs get the DEATH name through `headless.js` (it is per leg) but no truncation note; filed.
- **R5 — the once-only Stage-1 retry still fires for an `OUTPUT_LENGTH` death.** Behaviour unchanged: the retry pass keys on `leg.status !== 'complete'` / no usable summary, both of which hold. Whether to skip or shrink that retry (same reservation → likely the same death → the spend doubled) is filed as a decision item, not decided here.
- **R6 — `finish` rides emit-when-set** (like `ttftMs`): the leg patch, the run document, the spend-ledger row (`SPEND_LEDGER_SCHEMA_VERSION` stays 1 — omitted-unless-present is the linkage-field convention), and solo metadata through `finalizeSession`'s `opts.finish`. `run.schema.json` gains the optional property.
- **R7 — `startServer` reads the budget once** and hands the same value to `buildServerOptions` (→ `buildProviderModels(routes, budget)`) and to `withOutputTokenFlag`. `buildProviderModels` keeps reading config itself when the argument is `undefined` (every other caller).
- **R8 — the probe instrument is already on the branch** (commit `1aa04537`). Task 1 reviews it against this section, runs the full matrix itself, and files the record from ITS run.

### File structure

| File | Responsibility |
|---|---|
| `scripts/probe-max-tokens.js` | (on the branch) per-case `serve`, Anthropic SSE responder, `WA`, `assistantMatches`, rows L1–L5, two new table columns |
| `BACKLOG.md` | + "#218 PR 3" record under `## v4.9.4 records` (full 37-row table, dumps, checks line); + three `- [ ]` items |
| `src/utils/output-length.js` (new) | `OUTPUT_LENGTH_PREFIX`, `isOutputLengthDeath`, `formatOutputLengthReason` — pure |
| `src/sidecar/conversation-mirror.js` | `lastAssistantFinish` + `promotedReasoning` on the mirror state |
| `src/headless.js` | the in-loop `'length'` exit; post-loop naming; `finish` on both returns; `readOutputBudgetSafe` |
| `src/sidecar/fanout-leg.js`, `src/utils/result-schema.js`, `schemas/run.schema.json`, `src/utils/spend-ledger.js`, `src/sidecar/fanout-leg-fallback.js`, `src/sidecar/session-utils.js`, `src/sidecar/session-finalize.js`, `src/sidecar/start.js`, `src/sidecar/continue.js`, `src/sidecar/resume.js` | `finish` emit-when-set on the leg patch, run doc, ledger row, solo metadata |
| `src/utils/degrade.js`, `src/council/run-retry-notes.js`, `src/council/run-stages.js`, `docs/council.md` | the `output-truncated` info note |
| `src/utils/config.js :: buildProviderModels`, `src/opencode-client.js :: buildServerOptions` / `startServer` | one config read for both levers |
| `docs/configuration.md`, `docs/troubleshooting.md`, `CHANGELOG.md` | user-facing sweep |
| tests | `tests/utils/output-length.test.js`, `tests/headless-output-length.test.js` (new); `tests/conversation-mirror.test.js`, `tests/sidecar/fanout.test.js`, `tests/utils/result-schema.test.js`, `tests/spend-ledger-fields.test.js`, `tests/sidecar/runleg-fallback.test.js`, `tests/sidecar/session-utils.test.js`, `tests/shared-server-finalize.test.js`, `tests/council/degrade-contract.test.js`, `tests/council/run-stages.test.js`, `tests/opencode-client-output-flag.test.js`, `tests/build-provider-models-output-limit.test.js` (updated) |

---

### Task 1: Verify the probe instrument and file the PR 3 record

**Files:**
- Read: `scripts/probe-max-tokens.js` (the diff of commit `1aa04537`: `git show 1aa04537 -- scripts/probe-max-tokens.js`)
- Modify: `BACKLOG.md` (new record after the PR 2 record's closing line `checks: 31 matched, 0 mismatched (none), 1 recorded`, i.e. before the `- [x] **Curated \`qwen\` alias…` item)
- Output (untracked, gitignored): `output/218-probe-pr3.json`, `output/218-probe-pr3.txt`

**Interfaces:**
- Consumes: the probe as committed (rows L1–L5, `WA`, `assistantMatches`, the two new columns).
- Produces: the measured rows later tasks cite by id (A, H1, L1–L5) and the record their comments point at.

- [ ] **Step 1: Confirm the engine copy matches the pin**

Run: `node -e "console.log(require('opencode-ai/package.json').version, require('./node_modules/@opencode-ai/sdk/package.json').version)"` from the repo root.
Expected: `1.18.15 1.18.15`. If not, run `npm ci` and re-check.

- [ ] **Step 2: Read the instrument against the Design section**

Run: `git show 1aa04537 --stat` and `git show 1aa04537 -- scripts/probe-max-tokens.js`. Check, and write into your report, that: (a) `sseLength` and `sseAnthropicMaxTokens` default to the P1/P2 reply (`ok`, one completion token) so rows A–K13 are unchanged; (b) `startCapture` routes `POST …/messages` to the Anthropic responder and `POST …/chat/completions` to the OpenAI one, both reading `serveFor()`; (c) `send()` records `finish`, `tokens` and the text/reasoning `parts` of the LAST assistant message; (d) `checkRow` calls `assistantMatches`, which passes by construction when a row pins no `want.assistant`; (e) rows L1–L5 exist with the `serve` bodies and `want`s the Design table shows; (f) `npx eslint scripts/probe-max-tokens.js` prints nothing. Any disagreement is a finding for your report, not something to fix silently.

- [ ] **Step 3: Run the whole matrix, once, through the sandbox**

Run (repo root, plain shell, NO `--inner`, NO `--only`):
```bash
node scripts/probe-max-tokens.js --out output/218-probe-pr3.json > output/218-probe-pr3.txt 2>&1; echo "exit=$?"
```
Expected: `exit=0`; `output/218-probe-pr3.txt` ends with `checks: 36 matched, 0 mismatched (none), 1 recorded` and `engines: 37 started, 37 closed`; the `sandbox:` line lists eleven absent names; no row's `assistant error` column reads `APIError`. If `checks:` reports a mismatch, STOP: report the mismatched ids and their rows — a moved cell is a failed run, not a table to file.

- [ ] **Step 4: Splice the record into BACKLOG.md**

Write this script to `output/splice-pr3-record.js` (untracked) and run it with `node output/splice-pr3-record.js`. It inserts the record after the PR 2 record's `checks:` line, keeps LF, and pastes the run's table, dump and checks line byte-identical:

```js
'use strict';
const fs = require('fs');
const run = fs.readFileSync('output/218-probe-pr3.txt', 'utf8').replace(/\r\n/g, '\n').split('\n');
const start = run.findIndex((l) => l.startsWith('engine: opencode-ai '));
const end = run.findIndex((l) => l.startsWith('checks: '));
if (start < 0 || end < 0) { throw new Error('run output lacks the engine/checks lines'); }
const kimi = run.find((l) => l.startsWith('- openrouter/moonshotai/kimi-k3:'));
const kimiOut = kimi && /"output":(\d+)/.exec(kimi.slice(kimi.indexOf('"limit"')));
if (!kimiOut) { throw new Error('kimi dump line missing'); }
const block = run.slice(start, end + 1).join('\n');
const prose = [
  '- [x] **#218 PR 3 — what the assistant message carries when the provider stops for length,',
  '  and a descriptor above the engine\'s own ceiling, measured (2026-09-05).** Five cases (L1–L5)',
  '  were added to `scripts/probe-max-tokens.js`, the capture server learned to answer with a',
  '  per-case body (content, OpenRouter-style `reasoning`, an Anthropic `thinking` block, usage) and',
  '  to speak the Anthropic messages SSE (stop_reason `max_tokens`), the table gained the assistant',
  '  message\'s token counts and text/reasoning parts, and `want` gained an `assistant` half that A',
  '  and H1 now pin. The whole 37-case matrix was run under the same sandbox (engine 1.18.15 / sdk',
  '  1.18.15 / server 1.18.15; 37 started, 37 closed): 36 matched, F3 recorded, nothing moved on',
  '  the wire rows A–K13. Every direct `anthropic` row now records `finish: \'length\'` where the P1',
  '  and PR 2 tables show `error: APIError` — the capture server previously answered those rows with',
  '  an OpenAI-shaped stream the Anthropic provider could not parse, so the assistant columns of',
  '  H1–H4, K1–K5 and K9–K11 differ from the earlier records for that reason alone; their wire',
  '  columns are identical. What the L rows measured: the engine records `finish: \'length\'` on',
  '  both provider families (A, H1, L1–L5); on OpenAI-compatible routes it subtracts reasoning from',
  '  completion (L3: output 8 = 40 − 32; L1/L2: 0 output / 32000 reasoning), on the direct',
  '  Anthropic route it reports no split (L4: 24000 output / 0 reasoning); hidden reasoning leaves',
  '  no content part (L1), visible reasoning with no answer leaves a `reasoning` part and no `text`',
  '  part (L2, L4); no row carries a `MessageOutputLengthError`; and a descriptor above the',
  '  engine\'s own ceiling is clamped to that ceiling with no variant in play (L5: 70000 + flag',
  `  100000 → 64000). The kimi dump line reports \`limit.output ${kimiOut[1]}\` on this run (the`,
  '  startup-refresh race the PR 2 record describes; live models.dev says 943718); no row depends',
  '  on it. Filed exactly as the run printed it:',
  '',
];
const record = `\n${prose.join('\n')}\n${block}\n`;
const p = 'BACKLOG.md';
const s = fs.readFileSync(p, 'utf8');
if (s.includes('\r')) { throw new Error('BACKLOG.md is not LF'); }
const anchor = '\nchecks: 31 matched, 0 mismatched (none), 1 recorded\n';
const i = s.indexOf(anchor);
if (i < 0 || s.indexOf(anchor, i + 1) >= 0) { throw new Error('anchor missing or ambiguous'); }
const j = i + anchor.length;
fs.writeFileSync(p, s.slice(0, j) + record + s.slice(j));
console.log('spliced', block.split('\n').length, 'run lines after the PR 2 record');
```

Expected: `spliced N run lines after the PR 2 record`. Then check the paste is byte-identical: `node -e "const fs=require('fs');const run=fs.readFileSync('output/218-probe-pr3.txt','utf8').replace(/\r\n/g,'\n');const b=fs.readFileSync('BACKLOG.md','utf8');const s=run.slice(run.indexOf('engine: opencode-ai '));const t=s.slice(0,s.indexOf('\n',s.indexOf('checks: '))+1);console.log(b.includes(t)?'byte-identical':'DIFFERS')"` → `byte-identical`. Read the spliced record once in `BACKLOG.md` and confirm the kimi figure in the prose matches the dump line below it.

- [ ] **Step 5: Gates**

Run: `node scripts/check-file-sizes.js --all && node scripts/validate-docs.js --full && node scripts/generate-docs.js --check && git diff --stat`.
Expected: clean; the diff lists exactly `BACKLOG.md`.

- [ ] **Step 6: Commit**

```bash
git add BACKLOG.md
git commit -m "test(probe): file the #218 PR 3 record — 37 rows, the direct rows record finish, L1–L5 measured (#218 PR 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The pure naming module

**Files:**
- Create: `src/utils/output-length.js`
- Test: `tests/utils/output-length.test.js`

**Interfaces:**
- Consumes: `src/utils/engine-output-flag.js :: outputTokenFlagValue`, `ENGINE_DEFAULT_OUTPUT_TOKENS` (exported since PR 2).
- Produces: `OUTPUT_LENGTH_PREFIX` (`'OUTPUT_LENGTH:'`), `isOutputLengthDeath({ finish, output, promotedReasoning }) → boolean`, `formatOutputLengthReason({ tokens, budget, promotedReasoning }) → string`. Task 3 calls both.

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/output-length.test.js`:

```js
'use strict';

const { OUTPUT_LENGTH_PREFIX, isOutputLengthDeath, formatOutputLengthReason } = require('../../src/utils/output-length');

describe('isOutputLengthDeath (#218 PR 3)', () => {
  test("finish 'length' with no output at all is the death (L1 shape)", () => {
    expect(isOutputLengthDeath({ finish: 'length', output: '', promotedReasoning: false })).toBe(true);
  });
  test("finish 'length' with output PROMOTED from reasoning is the death (L2/L4 shape)", () => {
    // Named mutant "PROMOTEIGNORED": drop the promotedReasoning clause — this reads false.
    expect(isOutputLengthDeath({ finish: 'length', output: 'thinking…', promotedReasoning: true })).toBe(true);
  });
  test("finish 'length' with real answer text is NOT the death — a cut review", () => {
    expect(isOutputLengthDeath({ finish: 'length', output: 'Partial review', promotedReasoning: false })).toBe(false);
  });
  test('no output with any other finish is not this death', () => {
    // Named mutant "NOTLENGTH": drop the finish check — 'stop' with no output reads true.
    expect(isOutputLengthDeath({ finish: 'stop', output: '', promotedReasoning: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: null, output: '', promotedReasoning: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: undefined, output: '' })).toBe(false);
  });
});

describe('formatOutputLengthReason (#218 PR 3)', () => {
  const tokens = { input: 5, output: 0, reasoning: 32000 };

  test('the ledger shape, budget unset: prefix, finish, counts, the engine default, the remedy', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, promotedReasoning: false })).toBe(
      "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — "
      + "32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — "
      + 'raise outputBudget in config.json (docs/configuration.md, Output budget)');
  });
  test('promoted reasoning says so', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, promotedReasoning: true }))
      .toContain('and only reasoning was streamed, no answer text — 32000 reasoning / 0 output tokens');
  });
  test('a configured budget is named as plain digits', () => {
    // Named mutant "BUDGETUNSET": always print the unset clause — 8000 never appears.
    expect(formatOutputLengthReason({ tokens, budget: 8000 })).toContain('; outputBudget is 8000 — raise');
    expect(formatOutputLengthReason({ tokens, budget: 1e21 })).toContain('; outputBudget is 1000000000000000000000 — raise');
  });
  test('an unreadable config is reported as such, never as "unset"', () => {
    expect(formatOutputLengthReason({ tokens, budget: undefined })).toContain('; outputBudget could not be read — raise');
  });
  test('missing token counts read as 0, never NaN', () => {
    expect(formatOutputLengthReason({ tokens: null, budget: null })).toContain(' — 0 reasoning / 0 output tokens;');
    expect(formatOutputLengthReason({ tokens: { output: 24000 }, budget: null })).toContain(' — 0 reasoning / 24000 output tokens;');
  });
  test('the prefix is the classifiable constant', () => {
    expect(OUTPUT_LENGTH_PREFIX).toBe('OUTPUT_LENGTH:');
    expect(formatOutputLengthReason({ tokens, budget: null }).startsWith(OUTPUT_LENGTH_PREFIX + ' ')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/output-length.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/output-length'`.

- [ ] **Step 3: Write the module**

Create `src/utils/output-length.js`:

```js
/**
 * @module utils/output-length
 * #218 PR 3: name the "Mode 2" death.
 *
 * THE PROBLEM. A council leg whose provider stopped for length before any
 * answer text -- the whole max_tokens reservation went to reasoning (the #218
 * ledger rows: 32000 reasoning, 0-2 output, $0.63 billed for nothing) -- came
 * back `complete` with an empty summary and was announced as "the leg ended
 * 'complete' with no usable output"; with VISIBLE reasoning it came back
 * `complete` with its thinking promoted to the review and was adjudicated as one.
 *
 * WHAT THE ENGINE RECORDS (scripts/probe-max-tokens.js rows A/H1/L1-L4, engine
 * 1.18.15): `finish: 'length'` on the assistant message on both provider
 * families; a reasoning/output token split on OpenAI-compatible routes
 * (L3: output = completion - reasoning) but NOT on the direct Anthropic route
 * (L4: everything is `output`, reasoning 0); and, with visible reasoning, a
 * `reasoning` part and no `text` part (L2/L4) -- exactly the shape
 * sidecar/conversation-mirror.js :: mirrorMessages promotes to `output`. No
 * row carries an engine error for the stop.
 *
 * So the death is keyed on `finish` plus "no answer text arrived", never on a
 * token count; the counts are reported, not decided on. Pure: no I/O, no clock.
 * headless.js :: runHeadless calls both functions once, post-loop.
 */
'use strict';

const { outputTokenFlagValue, ENGINE_DEFAULT_OUTPUT_TOKENS } = require('./engine-output-flag');

/** The prefix a consumer can classify on, like `NO_OUTPUT_BACKSTOP:`. */
const OUTPUT_LENGTH_PREFIX = 'OUTPUT_LENGTH:';

/**
 * Is this leg the Mode 2 death? The provider stopped for length AND no answer
 * text arrived: nothing at all (L1), or only reasoning, which the mirror
 * promoted to `output` (L2/L4). Named mutants (tests/utils/output-length.test.js):
 * "NOTLENGTH" drops the finish check, "PROMOTEIGNORED" drops the promotion clause.
 * @param {{finish?: string|null, output?: string, promotedReasoning?: boolean}} leg
 * @returns {boolean}
 */
function isOutputLengthDeath({ finish, output, promotedReasoning }) {
  return finish === 'length' && (!output || promotedReasoning === true);
}

/**
 * The reason string. Every clause is an observation: `finish` and the two
 * counts are the engine's own record of the message; the budget clause is what
 * config holds (`null` = unset, `undefined` = could not be read). The remedy
 * names the one lever that exists today; PR 4 adds the effort lever. Named
 * mutant "BUDGETUNSET": always print the unset clause.
 * @param {{tokens?: {reasoning?: number, output?: number}|null,
 *   budget?: number|null, promotedReasoning?: boolean}} args
 * @returns {string}
 */
function formatOutputLengthReason({ tokens, budget, promotedReasoning }) {
  const t = tokens || {};
  const count = (n) => (Number.isFinite(n) ? n : 0);
  const streamed = promotedReasoning
    ? 'only reasoning was streamed, no answer text'
    : 'no answer text arrived';
  const knob = budget === undefined
    ? 'outputBudget could not be read'
    : budget === null
      ? `outputBudget is unset — the engine's ${ENGINE_DEFAULT_OUTPUT_TOKENS} default reservation governs`
      : `outputBudget is ${outputTokenFlagValue(budget)}`;
  return `${OUTPUT_LENGTH_PREFIX} the provider stopped at the max_tokens reservation (finish 'length') and ${streamed} — `
    + `${count(t.reasoning)} reasoning / ${count(t.output)} output tokens; ${knob} — `
    + 'raise outputBudget in config.json (docs/configuration.md, Output budget)';
}

module.exports = { OUTPUT_LENGTH_PREFIX, isOutputLengthDeath, formatOutputLengthReason };
```

- [ ] **Step 4: Run the tests, prove the mutants**

Run: `npx jest tests/utils/output-length.test.js` → PASS (11 tests). Then apply each named mutant once (NOTLENGTH, PROMOTEIGNORED, BUDGETUNSET), run the file, quote the failing test name in your report, restore, run green.

- [ ] **Step 5: Gates and commit**

Run: `npx eslint src/utils/output-length.js tests/utils/output-length.test.js && node scripts/check-citations.js --all && node scripts/check-file-sizes.js --all && node scripts/generate-docs.js --check` → the last one FAILS until `node scripts/generate-docs.js` regenerates `docs/architecture-map.md` for the new module; run it, re-check, then:

```bash
git add src/utils/output-length.js tests/utils/output-length.test.js docs/architecture-map.md
git commit -m "feat(headless): name the Mode 2 death — utils/output-length.js decides on finish 'length' plus no answer text and formats the OUTPUT_LENGTH reason from the engine's own counts (#218 PR 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The mirror captures `finish`; headless exits on it and names the death

**Files:**
- Modify: `src/sidecar/conversation-mirror.js` (`createMirrorState`, `captureMsgUsage`, the promotion block near the end of `mirrorMessages`)
- Modify: `src/headless.js` (a module-level helper; one new exit in the poll loop directly after the `if (sessionError && !mirror.output && assistantFinished)` block; post-loop naming directly after `const usage = sumPerMessageUsage(mirror.usageByMsg);`; the `failedWithNoUsableOutput` predicate; both return literals)
- Test: `tests/conversation-mirror.test.js` (three tests), `tests/headless-output-length.test.js` (new)

**Interfaces:**
- Consumes: Task 2's `isOutputLengthDeath`, `formatOutputLengthReason`; `src/utils/config.js :: getOutputBudget`.
- Produces: `mirror.lastAssistantFinish` (string|null), `mirror.promotedReasoning` (boolean); `runHeadless` result gains `finish` (emit-when-set, string) on BOTH return shapes; an `OUTPUT_LENGTH:`-prefixed `error` on the death. Task 4 reads `result.finish`.

- [ ] **Step 1: Write the failing mirror tests**

In `tests/conversation-mirror.test.js`, after the test `'captures usage and surfaces completion signals'`, add:

```js
  test("records the LAST assistant message's finish on both mirror passes (#218 PR 3)", () => {
    const st = createMirrorState();
    expect(st.lastAssistantFinish).toBeNull();
    const done = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'length', tokens: { input: 5, output: 0, reasoning: 32000 } }, parts: [] };
    const streaming = { info: { role: 'assistant', id: 'm2', time: {} }, parts: [] };
    mirrorMessages([done], st, { now: NOW });
    expect(st.lastAssistantFinish).toBe('length');
    // A later message still streaming (no finish yet) is the last one — it wins, as null.
    mirrorMessages([done, streaming], st, { now: NOW });
    expect(st.lastAssistantFinish).toBeNull();
    // Named mutant "NOFINISH": stop recording finish in captureMsgUsage — stays null here.
    mirrorUsageOnly([done, { ...streaming, info: { ...streaming.info, finish: 'stop', tokens: { input: 1, output: 1 } } }], st);
    expect(st.lastAssistantFinish).toBe('stop');
  });

  test('promoting reasoning to output is flagged on the state (#218 PR 3)', () => {
    const st = createMirrorState();
    expect(st.promotedReasoning).toBe(false);
    const msg = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'length' }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] };
    mirrorMessages([msg], st, { now: NOW });
    expect(st.output).toBe('thinking…');
    // Named mutant "NOPROMOTEFLAG": drop the flag write in the promotion block.
    expect(st.promotedReasoning).toBe(true);
  });

  test('a real text part never sets promotedReasoning', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'length' }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }, { id: 'm1:t', type: 'text', text: 'Partial review' }] };
    mirrorMessages([msg], st, { now: NOW });
    expect(st.output).toBe('Partial review');
    expect(st.promotedReasoning).toBe(false);
  });
```
Check the file's top-level `require` destructures `mirrorUsageOnly` from `../src/sidecar/conversation-mirror`; add it if it does not.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/conversation-mirror.test.js -t "218 PR 3|promotedReasoning"`
Expected: FAIL — `lastAssistantFinish` is `undefined`, `promotedReasoning` is `undefined`.

- [ ] **Step 3: The mirror changes**

In `createMirrorState()` add, after the `usageByMsg` line:
```js
    // #218 PR 3: the LAST assistant message's `finish` (the engine stamps it at
    // finalization, beside tokens/cost) and whether `output` was promoted from
    // reasoning parts -- together the death test in utils/output-length.js.
    lastAssistantFinish: null,
    promotedReasoning: false,
```
In `captureMsgUsage(msg, state)` add as the FIRST statement:
```js
  // #218 PR 3: `finish` is stamped at the same finalization as tokens/cost, so
  // both mirror passes record it here; the last assistant message in the
  // snapshot wins, and one still streaming (no finish yet) resets it to null.
  // Named mutant "NOFINISH" (tests/conversation-mirror.test.js).
  state.lastAssistantFinish = msg.info.finish ?? null;
```
In the promotion block (`if (assistantFinished && !state.output && state.reasoningOutput) {`) add, before `state.output = state.reasoningOutput;`:
```js
    state.promotedReasoning = true; // #218 PR 3: named mutant "NOPROMOTEFLAG"
```
Update the `captureMsgUsage` docblock's first line to `Capture one assistant message's usage snapshot AND its finish into the state.`

- [ ] **Step 4: Run the mirror tests**

Run: `npx jest tests/conversation-mirror.test.js` → PASS. `wc -l src/sidecar/conversation-mirror.js` → at most 290.

- [ ] **Step 5: Write the failing headless tests**

Create `tests/headless-output-length.test.js`. Copy the mock block (the eight `mock*` fns, the `jest.mock('../src/opencode-client', …)`, `jest.mock('fs', …)`, `jest.mock('../src/utils/logger', …)`) VERBATIM from the top of `tests/headless-idle-completion.test.js` (lines 16–52 there), then:

```js
const { runHeadless } = require('../src/headless');

const CACHE = { read: 0, write: 0 };
/** One assistant message finalized by the engine, the way probe rows L1–L4 recorded it. */
const finished = ({ parts = [], tokens = { input: 5, output: 0, reasoning: 32000, cache: CACHE }, finish = 'length', error } = {}) => [{
  info: { role: 'assistant', id: 'm1', time: { created: 1, completed: 2 }, finish, tokens, cost: 0.63, ...(error ? { error } : {}) },
  parts,
}];
const OPTS = { nonce: 'testnonce1234567', pollIntervalMs: 5, stableFinishedPolls: 1, stableIdlePolls: 2, usageSettlePolls: 0, noOutputBackstopMs: 1500 };
const run = (opts = {}) => runHeadless('openrouter/moonshotai/kimi-k3', 'sys', 'user', 'task1234', '/proj', 60000, 'build', { ...OPTS, ...opts });

describe('#218 PR 3 — a leg whose provider stopped for length', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockStartServer.mockResolvedValue({ client: {}, server: { url: 'http://127.0.0.1:1', close: mockServerClose } });
  });

  it("hidden reasoning, no answer text (L1): exits the loop on the finalized message and dies as OUTPUT_LENGTH — not the backstop", async () => {
    mockGetMessages.mockResolvedValue(finished());
    const t0 = Date.now();
    const r = await run();
    // Named mutant "NOEXIT": drop the in-loop `'length'` exit — the leg waits out the 1500 ms
    // backstop and its error starts NO_OUTPUT_BACKSTOP instead.
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.completed).toBe(false);
    expect(r.finish).toBe('length');
    expect(r.summary).toBe('');
    expect(r.error).toBe("OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — "
      + "32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — "
      + 'raise outputBudget in config.json (docs/configuration.md, Output budget)');
  });

  it('visible reasoning promoted to output (L2/L4): still the death, and it says only reasoning was streamed', async () => {
    mockGetMessages.mockResolvedValue(finished({ parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] }));
    const r = await run();
    // Named mutant "DEATHNOTFORCED": drop `|| outputLengthDeath` from failedWithNoUsableOutput —
    // completed reads true and error is absent because mirror.output is non-empty.
    expect(r.completed).toBe(false);
    expect(r.error).toContain('and only reasoning was streamed, no answer text — 32000 reasoning / 0 output tokens;');
    expect(r.finish).toBe('length');
  });

  it("a cut review WITH answer text (L3): completes, keeps the text, carries finish 'length', no error", async () => {
    mockGetMessages.mockResolvedValue(finished({ parts: [{ id: 'm1:t', type: 'text', text: 'Partial review' }], tokens: { input: 5, output: 8, reasoning: 32, cache: CACHE } }));
    const r = await run();
    expect(r.completed).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.summary).toBe('Partial review');
    expect(r.finish).toBe('length');
  });

  it("finish 'stop' rides out as finish, and a leg with no finish carries no key", async () => {
    mockGetMessages.mockResolvedValue(finished({ parts: [{ id: 'm1:t', type: 'text', text: 'OK' }], finish: 'stop', tokens: { input: 5, output: 1, reasoning: 0, cache: CACHE } }));
    const r1 = await run();
    expect(r1.completed).toBe(true);
    expect(r1.finish).toBe('stop');
    mockGetMessages.mockResolvedValue([{ info: { role: 'assistant', id: 'm1', time: { completed: 1 } }, parts: [{ id: 'm1:t', type: 'text', text: 'OK' }] }]);
    const r2 = await run();
    expect(r2.completed).toBe(true);
    expect('finish' in r2).toBe(false);
  });

  it("an error the engine put on the message wins over this PR's name", async () => {
    mockGetMessages.mockResolvedValue(finished({ error: { name: 'MessageOutputLengthError', data: {} } }));
    const r = await run();
    // Named mutant "ENGINEERRORLOST": drop the `!sessionError` guard — the error is overwritten.
    expect(r.completed).toBe(false);
    expect(r.error).toBe('MessageOutputLengthError');
    expect(r.finish).toBe('length');
  });

  it('the configured budget is named in the reason (seam: options._readOutputBudget)', async () => {
    mockGetMessages.mockResolvedValue(finished());
    const r = await run({ _readOutputBudget: () => 8000 });
    expect(r.error).toContain('; outputBudget is 8000 — raise');
    const r2 = await run({ _readOutputBudget: () => { throw new Error('config unreadable'); } });
    expect(r2.error).toContain('; outputBudget could not be read — raise');
  });

  it('finish and tokens that land only on the usage-settle re-poll still name the death', async () => {
    // The loop exits on a finalized message that has not yet been stamped (time.completed set,
    // no finish, no tokens) via the stable-finished heuristic on promoted reasoning; the settle
    // re-poll then sees the stamped message. Both passes must record finish (mirror test NOFINISH).
    const unstamped = [{ info: { role: 'assistant', id: 'm1', time: { completed: 1 } }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] }];
    const stamped = finished({ parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] });
    mockGetMessages.mockResolvedValueOnce(unstamped).mockResolvedValueOnce(unstamped).mockResolvedValue(stamped);
    const r = await run({ usageSettlePolls: 2, usageSettleIntervalMs: 1 });
    expect(r.completed).toBe(false);
    expect(r.error).toMatch(/^OUTPUT_LENGTH: .*only reasoning was streamed.*32000 reasoning \/ 0 output tokens;/);
  });
});
```
If `usageSettleIntervalMs` is not an option `runHeadless` reads (check `src/headless.js` for `options.usageSettleIntervalMs`; it reads `usageSettlePolls` at the line `const usageSettlePolls = options.usageSettlePolls === undefined`), drop it from the last test and rely on the default 400 ms interval — the test still passes, one second slower.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx jest tests/headless-output-length.test.js`
Expected: FAIL on every test but the `'stop'` half of test 4 — the first test takes ≥ 1500 ms and its error starts `NO_OUTPUT_BACKSTOP`.

- [ ] **Step 7: The headless changes**

(a) Module scope, directly after `formatNoOutputBackstopReason`'s closing brace, add:
```js
/**
 * #218 PR 3: the configured budget for the OUTPUT_LENGTH reason string, or
 * `undefined` when config cannot be read -- the string then says so rather
 * than claiming "unset". `read` is a test seam (options._readOutputBudget).
 * @param {() => (number|null)} [read]
 * @returns {number|null|undefined}
 */
function readOutputBudgetSafe(read) {
  try { return (read || require('./utils/config').getOutputBudget)(); } catch { return undefined; }
}
```

(b) In the poll loop, directly AFTER the block
```js
        if (sessionError && !mirror.output && assistantFinished) {
          …
          break;
        }
```
add:
```js
        // #218 PR 3: the engine finalized the message with finish 'length' and
        // no answer text -- the Mode 2 death (probe row L1: hidden reasoning,
        // no content part). Nothing more will arrive; every exit below requires
        // output, so without this one the leg waits out the no-output backstop
        // and dies under ITS name, which says "silence past the deadline" about
        // a message the engine had already finished with a reason. Gated on
        // 'length' only: a 'tool-calls' finish is followed by another message.
        // Named mutant "NOEXIT" (tests/headless-output-length.test.js).
        if (assistantFinished && mirror.lastAssistantFinish === 'length' && !mirror.output) {
          logger.error('Assistant message finished for length with no output, exiting', { taskId, pollCount });
          break;
        }
```

(c) Directly after `const usage = sumPerMessageUsage(mirror.usageByMsg);` (post-loop, after the settle) add:
```js
    // #218 PR 3: name the Mode 2 death. The engine records `finish: 'length'`
    // when the provider stopped at the max_tokens reservation (probe rows
    // A/H1/L1-L4); with no answer text that is a dead leg, and it used to leave
    // here as `completed` with an empty summary -- or with its THINKING promoted
    // to the summary (L2/L4's shape). Named through the channel every other
    // death uses (sessionError -> leg.error -> metadata.reason -> the dead-leg
    // note), so no consumer needs a new case. An error the engine itself put on
    // the message wins: its own name is the better observation. Named mutants
    // (tests/headless-output-length.test.js): "ENGINEERRORLOST" drops the
    // `!sessionError` guard; "DEATHNOTFORCED" drops `|| outputLengthDeath` from
    // failedWithNoUsableOutput below.
    const { isOutputLengthDeath, formatOutputLengthReason } = require('./utils/output-length');
    const finish = mirror.lastAssistantFinish;
    const outputLengthDeath = isOutputLengthDeath({ finish, output: mirror.output, promotedReasoning: mirror.promotedReasoning });
    if (outputLengthDeath && !sessionError) {
      sessionError = formatOutputLengthReason({
        tokens: usage.tokens, budget: readOutputBudgetSafe(options._readOutputBudget), promotedReasoning: mirror.promotedReasoning,
      });
      logger.error('Leg stopped for length with no answer text', { taskId, error: sessionError });
    }
```

(d) Change the predicate to
```js
    const failedWithNoUsableOutput = !!(sessionError && (!mirror.output || pollFailureBail || toolStalled || outputLengthDeath));
```
and extend its comment: `// #218 PR 3: an OUTPUT_LENGTH death with PROMOTED reasoning has a non-empty mirror.output and must still fail.`

(e) In BOTH return literals add, directly after the `ttftMs` spread line:
```js
        // #218 PR 3: the engine's finish for the last assistant message, emit-when-set like ttftMs.
        ...(typeof finish === 'string' ? { finish } : {}),
```

- [ ] **Step 8: Run the headless tests, the mirror tests, prove the mutants**

Run: `npx jest tests/headless-output-length.test.js tests/conversation-mirror.test.js tests/headless.test.js tests/headless-idle-completion.test.js tests/headless-usage.test.js tests/headless-poll-failures.test.js tests/headless-tool-stall.test.js tests/no-output-backstop-wiring.test.js` → all PASS. Prove NOEXIT, DEATHNOTFORCED, ENGINEERRORLOST, NOFINISH, NOPROMOTEFLAG once each (apply, run the covering file, quote the failing test, restore, green).

- [ ] **Step 9: Gates and commit**

Run: `npx eslint src/headless.js src/sidecar/conversation-mirror.js tests/headless-output-length.test.js tests/conversation-mirror.test.js && node scripts/check-citations.js --all && node scripts/check-file-sizes.js --all && wc -l src/sidecar/conversation-mirror.js`.

```bash
git add src/headless.js src/sidecar/conversation-mirror.js tests/headless-output-length.test.js tests/conversation-mirror.test.js
git commit -m "feat(headless): a leg whose provider stopped for length with no answer text exits the loop and dies as OUTPUT_LENGTH; the mirror records the last message's finish and whether reasoning was promoted; results carry finish (#218 PR 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `finish` rides the leg patch, the run document, the ledger row and solo metadata

**Files:**
- Modify: `src/sidecar/fanout-leg.js` (the `legPatch` literal, after `ttftMs`), `src/utils/result-schema.js :: buildRunResult` (after the `ttftMs` spread; one docblock clause), `schemas/run.schema.json` (after `"tag"`), `src/utils/spend-ledger.js :: appendSpend` (param + docblock + one guarded line), `src/sidecar/fanout-leg-fallback.js :: recordAttemptSpend` (one row field), `src/sidecar/session-utils.js :: finalizeSession` (one guarded line + docblock), `src/sidecar/session-finalize.js :: finalizeHeadlessResult` (both branches), `src/sidecar/start.js`, `src/sidecar/continue.js`, `src/sidecar/resume.js` (the `finalizeSession(...)` call each — one added property in the opts object, no new line)
- Test: `tests/sidecar/fanout.test.js`, `tests/utils/result-schema.test.js`, `tests/spend-ledger-fields.test.js`, `tests/sidecar/runleg-fallback.test.js`, `tests/sidecar/session-utils.test.js`, `tests/shared-server-finalize.test.js`

**Interfaces:**
- Consumes: `result.finish` from Task 3.
- Produces: `finish` on leg metadata.json, on the run document (`buildRunResult`), on the ledger row (`appendSpend({ finish })`), on solo metadata (`finalizeSession(…, { finish })`). Task 5 reads `leg.finish` and `leg.usage.tokens` off the run document.

- [ ] **Step 1: Write the failing tests**

`tests/sidecar/fanout.test.js` — after the test `'a ttftMs of 0 survives both hops …'` add (same harness: `mockRunHeadless`, `legOk`, `runFanout`, `baseOpts`, `fsReal`, `pathReal`, `project`):
```js
  it("threads a leg's finish from runHeadless onto its on-disk leg patch and the wave doc (#218 PR 3)", async () => {
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({ ...legOk(taskId), finish: 'length' }))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId)); // older engine: no finish
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'fin12345' });
    const legMeta1 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'fin12345-1', 'metadata.json'), 'utf-8'));
    expect(legMeta1.finish).toBe('length');
    expect(wave.legs[0].finish).toBe('length');
    const legMeta2 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'fin12345-2', 'metadata.json'), 'utf-8'));
    expect('finish' in legMeta2).toBe(false);
    expect('finish' in wave.legs[1]).toBe(false);
  });
```

`tests/utils/result-schema.test.js` — inside `describe('buildRunResult')` add:
```js
    it('carries metadata.finish emit-when-set (#218 PR 3)', () => {
      const withFinish = buildRunResult({ taskId: 'f1', metadata: { ...baseMeta, finish: 'length' }, result: { completed: true }, summary: 'cut' });
      expect(withFinish.finish).toBe('length');
      const without = buildRunResult({ taskId: 'f2', metadata: baseMeta, result: { completed: true }, summary: 'ok' });
      expect('finish' in without).toBe(false);
      // Named mutant "FINISHCOERCED": `finish: metadata.finish || null` — the key appears as null.
      const bogus = buildRunResult({ taskId: 'f3', metadata: { ...baseMeta, finish: 7 }, result: { completed: true }, summary: 'ok' });
      expect('finish' in bogus).toBe(false);
    });
```

`tests/spend-ledger-fields.test.js` — add to the `'omits absent linkage fields entirely…'` test the line `expect('finish' in row).toBe(false);` and a new test:
```js
  test('carries finish when provided, as a linkage-style field (#218 PR 3)', () => {
    const dir = tmp();
    appendSpend({ taskId: 't5', waveId: 'w1', model: 'kimi', mode: 'leg', usage, op: 'leg', status: 'error', finish: 'length' }, { dir });
    const [row] = readSpendRows(dir);
    expect(row.finish).toBe('length');
    expect(row.status).toBe('error');
  });
```

`tests/sidecar/runleg-fallback.test.js` — after the tagged-leg test add a test built on the SAME harness (a `fakeRunOnce` returning a doc, `deps.spendDir`, `readSpendRows`): the doc carries `finish: 'length'` and `status: 'error'` → the ONE spend row for that attempt has `finish: 'length'`; a doc without `finish` → its row has no `finish` key. Assert with `expect(rows[0].finish).toBe('length')` and `expect('finish' in rows[0]).toBe(false)` respectively.

`tests/sidecar/session-utils.test.js` — add two tests on `finalizeSession(sessionDir, summary, project, metadata, opts)` (a temp dir with an empty `metadata.json`, `metadata = { createdAt: new Date().toISOString(), filesWritten: [] }`): with `opts: { status: 'complete', finish: 'length' }` the written `metadata.json` has `finish: 'length'`; with `opts: { status: 'complete' }` it has no `finish` key.

`tests/shared-server-finalize.test.js` — add two tests on `finalizeHeadlessResult(sessionDir, result, project, metadata)`: `result: { completed: true, summary: 'cut', finish: 'length' }` → `metadata.json` has `finish: 'length'` and `status: 'complete'`; `result: { completed: false, error: 'OUTPUT_LENGTH: …', summary: '', finish: 'length' }` → `status: 'error'`, `reason` starts `OUTPUT_LENGTH:`, `finish: 'length'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/sidecar/fanout.test.js tests/utils/result-schema.test.js tests/spend-ledger-fields.test.js tests/sidecar/runleg-fallback.test.js tests/sidecar/session-utils.test.js tests/shared-server-finalize.test.js -t "218 PR 3|finish"`
Expected: the new tests FAIL on a missing `finish`.

- [ ] **Step 3: The edits**

`src/sidecar/fanout-leg.js`, in `legPatch` after the `ttftMs:` entry:
```js
    // #218 PR 3: the engine's `finish` for the leg's last assistant message
    // ('length' = stopped at the reservation), emit-when-set like ttftMs above.
    finish: (result && typeof result.finish === 'string') ? result.finish : undefined,
```

`src/utils/result-schema.js :: buildRunResult`, after the `ttftMs` spread:
```js
    ...(typeof metadata.finish === 'string' ? { finish: metadata.finish } : {}), // #218 PR 3: emit-when-set (named mutant FINISHCOERCED)
```
and append to the docblock's `tag` sentence: `` `finish` (#218 PR 3) likewise — the engine's finish reason for the leg's last assistant message. ``

`schemas/run.schema.json`, after the `"tag"` property:
```json
    "finish": {
      "type": "string",
      "description": "#218 PR 3, optional. The engine's finish reason for the leg's last assistant message ('stop', 'length', 'tool-calls', …), copied verbatim from the assistant message's `finish`. EMIT-WHEN-SET like `ttftMs`: absent means the engine recorded none (the message never finalized, or an older engine). 'length' means the provider stopped at the max_tokens reservation — with answer text that is a cut review (announced as a Note on the `output-truncated` channel); without, the leg is status 'error' with an `OUTPUT_LENGTH:` reason."
    },
```

`src/utils/spend-ledger.js :: appendSpend`: add `finish` to the destructured parameter list; add the docblock line `` * @param {string} [opts.finish] the leg's finish reason (omitted if absent) — #218 PR 3: 'length' on a row is the Mode 2 receipt ``; after the `retryOfWaveId` line add `if (typeof finish === 'string') { row.finish = finish; }`.

`src/sidecar/fanout-leg-fallback.js :: recordAttemptSpend`: in the `row` literal add `finish: doc.finish,` after `tag`.

`src/sidecar/session-utils.js :: finalizeSession`: change the one-line docblock to `/** Finalize session - detect conflicts, save summary, update metadata. opts.finish (#218 PR 3) stamps metadata.finish when set. */` and, directly before `metadata.status = opts.status || …`, add `if (typeof opts.finish === 'string') { metadata.finish = opts.finish; }`.

`src/sidecar/session-finalize.js :: finalizeHeadlessResult`: in the error branch, after `metadata.reason = …`, add `if (result && typeof result.finish === 'string') { metadata.finish = result.finish; }`; in the other branch pass `{ status: terminal.status, finish: result && result.finish }`.

`src/sidecar/start.js`, `src/sidecar/continue.js`, `src/sidecar/resume.js`: the `finalizeSession(…, { quietStdout: json, status: terminal.status })` call each gains `, finish: result && result.finish` inside the opts object (same line).

- [ ] **Step 4: Run the tests, prove the mutant, sizes**

Run the Step 2 command without `-t`, plus `npx jest tests/schemas.test.js tests/council/run-stats-entry.test.js tests/council/runstats-byte-order.test.js tests/sidecar/start.test.js tests/continue-resume-spend.test.js` → all PASS. Prove FINISHCOERCED once. Run `wc -l src/utils/result-schema.js src/sidecar/session-utils.js` → at most 299 and 298.

- [ ] **Step 5: Gates and commit**

Run: `npx eslint src/ tests/sidecar/fanout.test.js tests/utils/result-schema.test.js tests/spend-ledger-fields.test.js tests/sidecar/runleg-fallback.test.js tests/sidecar/session-utils.test.js tests/shared-server-finalize.test.js && node scripts/check-citations.js --all && node scripts/check-file-sizes.js --all && node scripts/validate-docs.js --full && node scripts/generate-docs.js --check`.

```bash
git add src/sidecar/fanout-leg.js src/utils/result-schema.js schemas/run.schema.json src/utils/spend-ledger.js src/sidecar/fanout-leg-fallback.js src/sidecar/session-utils.js src/sidecar/session-finalize.js src/sidecar/start.js src/sidecar/continue.js src/sidecar/resume.js tests/sidecar/fanout.test.js tests/utils/result-schema.test.js tests/spend-ledger-fields.test.js tests/sidecar/runleg-fallback.test.js tests/sidecar/session-utils.test.js tests/shared-server-finalize.test.js
git commit -m "feat: every leg carries the engine's finish — on the leg patch, the run document, the spend-ledger row and solo metadata, emit-when-set (#218 PR 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: A cut-but-answered review is announced, not lost

**Files:**
- Modify: `src/utils/degrade.js` (`DEGRADE_CHANNELS`), `src/council/run-retry-notes.js` (new builder + export), `src/council/run-stages.js` (the require on line 30; one loop after `const materialized = materializeReviews(…)`), `docs/council.md` (one paragraph after the `ledger-skipped` paragraph)
- Test: `tests/council/degrade-contract.test.js`, `tests/council/run-stages.test.js`

**Interfaces:**
- Consumes: `leg.finish`, `leg.usage.tokens` from Task 4's run document; `materializeReviews`'s `{ modelInput, leg }`.
- Produces: `truncatedReviewNote(seat, leg)`; the `output-truncated` channel.

- [ ] **Step 1: Write the failing tests**

`tests/council/degrade-contract.test.js`, after the `ledger-skipped` describe:
```js
describe("kind 'info' + channel 'output-truncated' (#218 PR 3)", () => {
  const { truncatedReviewNote } = require('../../src/council/run-retry-notes');
  test('DEGRADE_CHANNELS has output-truncated', () => {
    expect(DEGRADE_CHANNELS.has('output-truncated')).toBe(true);
  });
  test('truncatedReviewNote is an info record that formats with Note: and Try:', () => {
    const leg = { finish: 'length', usage: { tokens: { input: 900, output: 700, reasoning: 31000 } } };
    const r = makeDegrade(truncatedReviewNote('kimi', leg));
    expect(r.kind).toBe('info');
    expect(r.channel).toBe('output-truncated');
    expect(formatDegrade(r)).toBe("Note: seat kimi's review was cut at its output reservation — the provider stopped for length (finish 'length') after 31000 reasoning / 700 output tokens; the review ends where the reservation ended. The review is in the packet as far as it got and the chair reads it as such; nothing else changes. Try: raise outputBudget in config.json (docs/configuration.md, Output budget).\n");
    expect(r.data).toEqual({ seat: 'kimi', finish: 'length', reasoningTokens: 31000, outputTokens: 700 });
  });
  test('a leg with no usage still formats with zero counts', () => {
    expect(makeDegrade(truncatedReviewNote('glm', { finish: 'length' })).why).toContain('after 0 reasoning / 0 output tokens;');
  });
});
```

`tests/council/run-stages.test.js` — three tests on the existing Stage-1 harness (mirror the test `'retry also dies: exactly ONE dead-leg degrade, enriched why, degraded true'` for how `makeCtx`/launchers/`ctx._notes`/`res.degraded` are set up). The legs come from `mkLeg`; add `finish` and `usage.tokens` by spread:
```js
  test("a review cut at the reservation is announced once as info on output-truncated and is NOT a loss (#218 PR 3)", async () => {
    const cut = { ...mkLeg('b', review('b')), finish: 'length', usage: { tokens: { input: 900, output: 700, reasoning: 31000 }, cost: { amount: 0.5, source: 'reported' } } };
    // … launch a wave returning [usableLeg('a'), cut] through the harness, run runStage1 …
    const notes = ctx._notes.filter((n) => n.channel === 'output-truncated');
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('info');
    expect(notes[0].what).toBe("seat b's review was cut at its output reservation");
    expect(notes[0].why).toBe("the provider stopped for length (finish 'length') after 31000 reasoning / 700 output tokens; the review ends where the reservation ended");
    expect(ctx._notes.filter((n) => n.channel === 'dead-leg')).toHaveLength(0);
    expect(res.reviews.map((r) => r.modelInput).sort()).toEqual(['a', 'b']);
    expect(res.degraded).toBe(false);
  });

  test('an OUTPUT_LENGTH death is a dead leg whose note carries the reason verbatim, and gets NO truncation note', async () => {
    const dead = { ...deadLeg('b', 'error', "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — 32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — raise outputBudget in config.json (docs/configuration.md, Output budget)"), finish: 'length' };
    // … same harness as the existing enriched-why dead-leg test (the retry also dies) …
    // Named mutant "DEADNOTED": iterate `legs` instead of `materialized` in run-stages — a note appears here.
    expect(ctx._notes.filter((n) => n.channel === 'output-truncated')).toHaveLength(0);
    const n = ctx._notes.find((x) => x.channel === 'dead-leg');
    expect(n.why).toMatch(/^the leg ended 'error': OUTPUT_LENGTH: the provider stopped at the max_tokens reservation \(finish 'length'\) and no answer text arrived — 32000 reasoning \/ 0 output tokens; .* with no usable output/);
  });

  test('legs with no finish produce no output-truncated note', async () => {
    // … the happy-path harness with two usable legs …
    // Named mutant "NONOTE": drop the loop — the first test fails; this one pins the quiet path.
    expect(ctx._notes.filter((n) => n.channel === 'output-truncated')).toHaveLength(0);
  });
```
Fill the `…` lines from the harness the neighbouring tests use; the assertions above are the contract.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/council/degrade-contract.test.js tests/council/run-stages.test.js -t "218 PR 3|output-truncated|OUTPUT_LENGTH"`
Expected: FAIL — unknown channel / no such export / zero notes.

- [ ] **Step 3: The edits**

`src/utils/degrade.js`, after `'stage1-retry',`:
```js
  // #218 PR 3: a Stage-1 review the provider cut at the max_tokens reservation
  // (the leg's `finish` is 'length' and it still carried answer text). kind
  // 'info' only -- the review is in the packet, nothing was lost, the exit code
  // does not move; the chair just reads a review that ends where the
  // reservation ended. A cut with NO answer text is a dead leg (leg.error
  // starts `OUTPUT_LENGTH:`) and rides `dead-leg` like every other death.
  'output-truncated',
```

`src/council/run-retry-notes.js`, before `module.exports`:
```js
/**
 * #218 PR 3: a review that reached the packet but was cut at the reservation.
 * `kind: 'info'` -- announced, never a loss (utils/degrade.js on the channel).
 * The counts are the engine's own token record for the leg; the remedy names
 * the one lever that exists today.
 * @param {string} seat the alias every note renders (leg.modelInput || leg.model)
 * @param {object} leg the leg run document (finish === 'length')
 */
function truncatedReviewNote(seat, leg) {
  const t = (leg.usage && leg.usage.tokens) || {};
  return { kind: 'info', channel: 'output-truncated',
    what: `seat ${seat}'s review was cut at its output reservation`,
    why: `the provider stopped for length (finish 'length') after ${t.reasoning || 0} reasoning / ${t.output || 0} output tokens; the review ends where the reservation ended`,
    effect: 'the review is in the packet as far as it got and the chair reads it as such; nothing else changes',
    remedy: 'raise outputBudget in config.json (docs/configuration.md, Output budget)',
    data: { seat, finish: 'length', reasoningTokens: t.reasoning || 0, outputTokens: t.output || 0 } };
}
```
and add `truncatedReviewNote` to `module.exports`.

`src/council/run-stages.js`: line 30 becomes `const { skippedWaveNote, truncatedReviewNote } = require('./run-retry-notes');`; directly after `const materialized = materializeReviews(o.runDir, [...legs, ...retry.recoveredLegs], allSeatOf);` add:
```js
  // #218 PR 3: a review the provider cut at the reservation still counts -- it
  // is announced, not lost. Only MATERIALIZED legs qualify (a length-stopped
  // leg with no answer text is a dead leg and never reaches this list); named
  // mutants "DEADNOTED" (iterate `legs` instead) and "NONOTE" (drop the loop).
  for (const m of materialized) {
    if (m.leg && m.leg.finish === 'length') { ctx.degrade.note(truncatedReviewNote(m.modelInput, m.leg)); }
  }
```

`docs/council.md`, after the paragraph that ends `…because that arm is the one step that draws on ledger history a task run never fed.` (read on to the paragraph's real end), add:
```
**A review cut at its output reservation is announced, not lost** (#218 PR 3). When a Stage-1 leg's
assistant message carries `finish: 'length'` and still delivered answer text, the run prints a
`Note:` on the `output-truncated` channel (`kind: "info"`, so it never degrades the run or moves the
exit code) naming the seat and the engine's reasoning/output token counts for the leg, with `Try:
raise outputBudget…`. A length stop with **no** answer text is a dead leg whose reason starts
`OUTPUT_LENGTH:` — see [Troubleshooting](./troubleshooting.md#headless-leg-fails-with-output_length).
```

- [ ] **Step 4: Run the tests, prove the mutants, sizes**

Run: `npx jest tests/council/degrade-contract.test.js tests/council/run-stages.test.js tests/council/degrade-channels.test.js tests/council/degrade-sink.test.js tests/council/degrade-surface.test.js tests/council/verdict-degrades.test.js tests/schemas-degrades-lockstep.test.js` → PASS. Prove DEADNOTED and NONOTE once. `wc -l src/council/run-stages.js` → at most 290.

- [ ] **Step 5: Gates and commit**

Run: `npx eslint src/utils/degrade.js src/council/run-retry-notes.js src/council/run-stages.js tests/council/degrade-contract.test.js tests/council/run-stages.test.js && node scripts/check-citations.js --all && node scripts/check-file-sizes.js --all && node scripts/validate-docs.js --full && node scripts/generate-docs.js --check`.

```bash
git add src/utils/degrade.js src/council/run-retry-notes.js src/council/run-stages.js docs/council.md tests/council/degrade-contract.test.js tests/council/run-stages.test.js
git commit -m "feat(council): a Stage-1 review cut at its output reservation is announced as an info note on output-truncated, never lost (#218 PR 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: One config read feeds both levers

**Files:**
- Modify: `src/utils/config.js :: buildProviderModels` (signature + one line + docblock), `src/opencode-client.js :: buildServerOptions` (one line + docblock) and `:: startServer` (the read moves before `buildServerOptions`)
- Test: `tests/opencode-client-output-flag.test.js`, `tests/build-provider-models-output-limit.test.js`

**Interfaces:**
- Consumes: `getOutputBudget()`.
- Produces: `buildProviderModels(resolvedRoutes = [], outputBudget)` (undefined → reads config; null → unset); `buildServerOptions(options)` honours `options.outputBudget` the same way.

- [ ] **Step 1: Write the failing tests**

`tests/build-provider-models-output-limit.test.js`, after the `'budget configured → emits limit…'` test:
```js
  test('an explicit budget argument wins over config; undefined reads config; null means unset (#218 PR 3)', () => {
    const config = load({ aliases, outputBudget: 8000 });
    // Named mutant "PARAMIGNORED": read config regardless of the argument — 8000 here, not 4096.
    expect(config.buildProviderModels([], 4096).openrouter.models['moonshotai/kimi-k3'].limit).toEqual({ context: 1048576, output: 4096 });
    expect(config.buildProviderModels([], null).openrouter.models['moonshotai/kimi-k3']).toEqual({});
    expect(config.buildProviderModels([]).openrouter.models['moonshotai/kimi-k3'].limit).toEqual({ context: 1048576, output: 8000 });
  });
```

`tests/opencode-client-output-flag.test.js`, replace the test `'reads the budget from config, the same source buildProviderModels uses'` with:
```js
  it('reads config ONCE and hands the same budget to the descriptor and the flag (#218 PR 3)', async () => {
    const spy = jest.spyOn(config, 'buildProviderModels');
    config.getOutputBudget.mockReturnValue(40000);
    await startServer(OK);
    // Named mutant "DOUBLEREAD": drop `outputBudget` from the spread startServer hands
    // buildServerOptions — buildProviderModels reads config again and the count is 2.
    expect(config.getOutputBudget).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), 40000);
    expect(seen[0].atCall).toBe('40000');
    spy.mockRestore();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/build-provider-models-output-limit.test.js tests/opencode-client-output-flag.test.js -t "218 PR 3"` → FAIL (4096 ignored; called 2 times).

- [ ] **Step 3: The edits**

`src/utils/config.js :: buildProviderModels`: signature `function buildProviderModels(resolvedRoutes = [], outputBudget) {`; the budget line becomes `const budget = normalizeOutputBudget(outputBudget === undefined ? getOutputBudget() : outputBudget);`; add to the docblock, before `@returns`:
```js
 * @param {number|null} [outputBudget] the budget to clamp with. `undefined` (every
 *   caller but startServer) reads config here; `null` means unset. #218 PR 3:
 *   opencode-client.js :: startServer reads config ONCE and hands the same value
 *   to this descriptor and to the engine flag, so a config write between two
 *   reads can no longer split the levers. Named mutant "PARAMIGNORED".
```

`src/opencode-client.js :: buildServerOptions`: the provider line becomes `config.provider = buildProviderModels(resolvedForProvider, options.outputBudget);`; add `@param {number|null} [options.outputBudget] - #218 PR 3: the per-leg output budget startServer already read; omitted means buildProviderModels reads config itself` to its docblock.

`src/opencode-client.js :: startServer`: replace `const serverOptions = buildServerOptions(options);` with
```js
  // #218 PR 3: ONE config read feeds both levers. The descriptor
  // (buildProviderModels, inside buildServerOptions) and the engine flag
  // (withOutputTokenFlag below) used to call loadConfig() separately; a config
  // write between the two reads could hand the engine a descriptor from one
  // budget and a flag from another. Named mutant "DOUBLEREAD"
  // (tests/opencode-client-output-flag.test.js counts the reads).
  const { getOutputBudget } = require('./utils/config');
  const outputBudget = getOutputBudget();
  const serverOptions = buildServerOptions({ ...options, outputBudget });
```
delete the later line `const { getOutputBudget } = require('./utils/config');`, change `withOutputTokenFlag(getOutputBudget(), …)` to `withOutputTokenFlag(outputBudget, …)`, and reword the comment sentence `The budget comes from config here exactly as buildProviderModels reads it for the per-model descriptor, so the two levers cannot disagree` to `The budget is the ONE value read above and handed to buildProviderModels as well, so the two levers cannot disagree`.

- [ ] **Step 4: Run the tests, prove the mutants**

Run: `npx jest tests/build-provider-models-output-limit.test.js tests/opencode-client-output-flag.test.js tests/opencode-client-sdk-spawn-timing.test.js tests/build-provider-models-local.test.js tests/config.test.js tests/server-start-duration-log.test.js` → PASS. Prove PARAMIGNORED and DOUBLEREAD once.

- [ ] **Step 5: Gates and commit**

Run: `npx eslint src/utils/config.js src/opencode-client.js tests/build-provider-models-output-limit.test.js tests/opencode-client-output-flag.test.js && node scripts/check-citations.js --all && node scripts/generate-docs.js --check`.

```bash
git add src/utils/config.js src/opencode-client.js tests/build-provider-models-output-limit.test.js tests/opencode-client-output-flag.test.js
git commit -m "fix(engine): startServer reads outputBudget once and hands it to both the descriptor and the flag (#218 PR 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Docs, CHANGELOG, BACKLOG items

**Files:**
- Modify: `docs/configuration.md` (Output budget section: a fifth bullet after the "reservation comes out of the context window" bullet; the closing "It does **not** stop…" paragraph), `docs/troubleshooting.md` (new section before `## Multiple Active Sessions / Wrong Session Picked Up`), `CHANGELOG.md` (`[Unreleased]` Added ×2, Changed ×1, Fixed ×1), `BACKLOG.md` (three `- [ ]` items after the `PR 4 must fit a thinking variant UNDER the budget` item)

**Interfaces:** none — prose. Every number cites a probe row; every behaviour sentence states what the code from Tasks 2–6 does.

- [ ] **Step 1: `docs/configuration.md`**

After the bullet beginning `- **The reservation comes out of the context window.**` add:
```
- **When a leg hits it, the run says so.** The engine records `finish: 'length'` on the leg's
  assistant message whenever the provider stopped at the reservation (A, H1, L1–L4 — both provider
  families). A leg that stopped there with **no answer text** — the whole reservation went to
  reasoning, the #218 "Mode 2" rows (32,000 reasoning, 0 output, $0.63 billed) — now ends `error`
  with a reason starting `OUTPUT_LENGTH:` that carries the engine's reasoning/output counts for the
  leg and the budget in force; it used to end `complete` with an empty summary or, when the provider
  streamed the reasoning, with its *thinking* promoted to the review (L2/L4). A leg that stopped
  there **with** answer text keeps its review, and a council prints a `Note:` on the
  `output-truncated` channel — informational, the exit code does not move. The counts are reported,
  never decided on: on OpenAI-compatible routes the engine subtracts reasoning from completion
  (L3: 8 = 40 − 32); on the direct Anthropic route it reports no split (L4: 24,000 output / 0
  reasoning). Two limits: a leg whose hidden reasoning outlasts the no-output backstop window dies
  under `NO_OUTPUT_BACKSTOP` first (the message has not finalized yet), and the Note is Stage-1
  only — a judge, chair or debate leg cut at its reservation gets the death name but no Note.
  Separately, L5 settles the catalog question PR 2 parked: a descriptor above the engine's own
  ceiling is clamped to that ceiling with or without a thinking variant (70,000 + flag 100,000 →
  64,000 on haiku), so a catalog row whose ceiling exceeds the engine's is harmless.
```
Change the closing paragraph's last sentence `Lowering the budget makes such a leg fail faster and cheaper; raising it gives the reasoning more room; neither makes it produce output.` to `Lowering the budget makes such a leg fail faster and cheaper; raising it gives the reasoning more room; neither makes it produce output — but since #218 PR 3 the failure is at least *named*: the leg ends `error` with an `OUTPUT_LENGTH:` reason instead of `complete` with nothing (see [Troubleshooting](./troubleshooting.md#headless-leg-fails-with-output_length)).`

- [ ] **Step 2: `docs/troubleshooting.md`**

Before `## Multiple Active Sessions / Wrong Session Picked Up` insert:
```
## Headless Leg Fails with `OUTPUT_LENGTH`

**Symptom:** A headless leg (`amicus start --no-ui`, or one leg of a `fanout`/council run) ends `error` with a reason starting `OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — 32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — raise outputBudget …`. The middle clause may instead read `and only reasoning was streamed, no answer text` — the provider showed its reasoning and nothing else. On a council run the seat is a dead leg (`Notice: seat … did not review — the leg ended 'error': OUTPUT_LENGTH: …`) and is retried once like any other death.

**Cause:** The model spent its whole output reservation reasoning and never started the answer. Every clause is an observation, not a guess: `finish 'length'` is the engine's record of the provider's own stop reason; the two counts are the engine's token record for that message (on OpenAI-compatible routes reasoning and output are split; on the direct Anthropic route everything lands in `output` and reasoning reads 0 — the message still says `finish 'length'`); the budget clause is what `~/.config/amicus/config.json` holds. The reservation is 32,000 by default (see [Output budget](./configuration.md#output-budget-outputbudget)). The likeliest driver is reasoning effort — OpenRouter applies a model's default effort when none is sent, and `--thinking` does not reach the engine today (PR 4 fixes that) — so raising the budget gives the reasoning room, and the leg still bills for it.

**Confirm:** `finish: 'length'` is on the leg's `metadata.json` and on its row in `~/.config/amicus/spend-ledger.jsonl` (the `finish` field, present only when the engine recorded one), beside the token counts. A council run's `run.json` carries it on the leg document.

**Fix:** Raise `outputBudget` in `config.json` (the reservation is `min(outputBudget, the model's ceiling)`; see the four bullets in [Output budget](./configuration.md#output-budget-outputbudget)), or seat a model whose default effort fits the reservation. If the same seat dies the same way on its retry, the retry cost you the reservation twice — lower the effort once PR 4 lands, or drop the seat. A leg that took longer than `AMICUS_NO_OUTPUT_BACKSTOP_MS` to reason with nothing visible dies as `NO_OUTPUT_BACKSTOP` first, not as this — see that section above.

---

```

- [ ] **Step 3: `CHANGELOG.md` under `## [Unreleased]`**

Under `### Added`, after the `scripts/probe-max-tokens.js` bullet:
```
- **The "Mode 2" death is named (#218 PR 3).** A leg whose provider stopped at the `max_tokens`
  reservation before any answer text — the whole reservation spent on reasoning — now ends `error`
  with a reason starting `OUTPUT_LENGTH:` that carries the engine's own reasoning/output counts for
  the leg and the `outputBudget` in force, and the poll loop exits the moment the engine finalizes
  such a message instead of waiting out the no-output backstop. The engine records `finish` on every
  assistant message; it now rides every leg document (`metadata.json`, `run.json`, the wave doc), the
  spend-ledger row (`finish`, present only when recorded) and solo session metadata. A review that
  was cut at the reservation but still answered is kept and announced as a `Note:` on the new
  `output-truncated` channel (`kind: "info"` — never a loss, never an exit-code change). Five probe
  rows (L1–L5) measured the shapes: `finish: 'length'` on both provider families; reasoning
  subtracted from completion on OpenAI-compatible routes but no split on direct Anthropic; a
  `reasoning` part and no `text` part when the reasoning was visible; and a descriptor above the
  engine's own ceiling clamped to that ceiling with no thinking variant in play. The probe's capture
  server now answers with a per-case body and speaks the Anthropic messages SSE, so the direct rows
  record the assistant message instead of an APIError; the full 37-case matrix is filed in the
  BACKLOG.
```
Under `### Changed`, after the `outputBudget below 32,000` bullet:
```
- **A length-stopped leg with no answer text is an error, not a completion (#218 PR 3).** On 4.9.3
  such a leg ended `complete` with an empty summary (a council dropped it as "ended 'complete' with
  no usable output"; `amicus start --no-ui` exited 0 with "No Output") or, when the provider streamed
  its reasoning, `complete` with the *thinking* as the review — adjudicated as one. It now ends
  `error` with the `OUTPUT_LENGTH:` reason: a council still retries the seat once and degrades if
  the retry dies too; `start --no-ui` exits 1 with the reason. The ledger row for such a leg reads
  `status: "error"` where it read `complete`.
```
Under `### Fixed`, after the qwen bullet:
```
- **`startServer` read `config.json` twice for one budget.** The per-model descriptor and the engine
  flag each called `loadConfig()`; a config write between the two reads could hand the engine a
  descriptor from one budget and a flag from another (bounded — the engine takes the smaller — but
  split). One read now feeds both (#218 PR 3).
```

- [ ] **Step 4: `BACKLOG.md` open items**

After the `- [ ] **PR 4 must fit a thinking variant UNDER the budget on direct Anthropic …` item (ends `…and add the probe row that proves it.`) add:
```
- [ ] **Decide whether the once-only Stage-1 retry should fire on an `OUTPUT_LENGTH` death (#218
  PR 3, R5).** The retry relaunches the seat with the same reservation and the same default effort,
  so it likely dies the same way and bills the reservation twice ($0.63 → $1.26 on the #218 kimi
  row). Skipping it loses a seat a variance in reasoning length might have saved; shrinking the
  reservation per retry is impossible today (the flag is per engine spawn, the descriptor per
  server). Owner's call; PR 3 kept the retry unchanged.
- [ ] **The chair packet should flag a review cut at its reservation (#218 PR 3, R4).** The
  `output-truncated` Note reaches stderr, `run.json` and the Workspace, but the chair reads the cut
  review with no marker that it ended where the reservation ended. Carry `finish: 'length'` into the
  chair briefing's per-review header (briefings-chair.js) so the chair weighs it as partial.
- [ ] **Stage-2 judge, chair and debate legs cut at their reservation get the death name but no
  Note (#218 PR 3, R4).** headless.js names the death for every leg; the `output-truncated` Note is
  emitted only over Stage-1 `materialized` reviews. A judge whose ranking was cut mid-JSON fails
  parse today with no length clue on the record; extend the Note to `run-stage2.js` and the chair
  path once the Stage-1 shape has been seen in a real run.
```

- [ ] **Step 5: Gates**

Run: `node scripts/validate-docs.js --full && node scripts/generate-docs.js --check && node scripts/check-file-sizes.js --all && node -e "for (const f of ['docs/configuration.md','docs/troubleshooting.md','CHANGELOG.md','BACKLOG.md']) { const s=require('fs').readFileSync(f,'utf8'); if (s.includes('\r')) throw new Error(f+' has CR'); } console.log('LF ok')"` → clean, `LF ok`. Read each edited section once, checking every row id it cites against the Design table.

- [ ] **Step 6: Commit**

```bash
git add docs/configuration.md docs/troubleshooting.md CHANGELOG.md BACKLOG.md
git commit -m "docs: the OUTPUT_LENGTH death, the output-truncated Note, L1–L5, the single config read; three follow-ups filed (#218 PR 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** "Name the Mode 2 death (`finish: 'length'` on the leg)": Task 2 (the name and the test), Task 3 (capture, the exit, the naming), Task 4 (`finish` on every leg document and the ledger). "Pass the budget once through buildServerOptions": Task 6. "A probe row for a catalog ceiling above the engine's with no variant": L5, Task 1 (record) and Task 7 (documented; nothing to build by rule 5). The cut-but-answered sibling: Task 5 (R4). Not in scope by design: the effort lever (PR 4); skipping the retry (filed, R5); the chair-packet flag and Stage-2 Notes (filed).

**Placeholder scan.** Task 4's `runleg-fallback` test and Task 5's `run-stages` tests name the harness to reuse and give every assertion; the only `…` lines mark harness plumbing the implementer copies from the named neighbouring test.

**Type consistency.** `isOutputLengthDeath({ finish, output, promotedReasoning })` and `formatOutputLengthReason({ tokens, budget, promotedReasoning })` (Task 2) are called with exactly those keys in Task 3; `result.finish` (Task 3, string, emit-when-set) is what Task 4 reads on `result`, stores as `metadata.finish`, and Task 5 reads as `leg.finish`; `leg.usage.tokens.{reasoning,output}` is `resolveUsage`'s shape (`pricing.js`), which `truncatedReviewNote` reads; `buildProviderModels(routes, outputBudget)` (Task 6) matches `buildServerOptions`'s call and the tests' `(…, 4096)` / `(…, null)` forms.
