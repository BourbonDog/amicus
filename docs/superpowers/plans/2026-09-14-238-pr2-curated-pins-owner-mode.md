# #238 PR 2 — Curated Pins Data File + Owner Mode, Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 of the #238 design: the shipped pins, the retired list and the (empty) notable list move out of `src/utils/curated-models.js` into a data file `src/utils/curated-pins.json` with a byte-identical builder proof; `amicus aliases --review --owner` runs the same picker over the shipped pins and writes that file (gated: source checkout + clean tree + TTY); `amicus models --check` names a newer same-tier sibling of a cardless pin; `amicus aliases` flags a pin that names a retired alias and wires `retired`/`notable` from the file into the engine.

**Architecture:** One new read/validate/write module (`src/utils/curated-pins.js`) owns the data file; `curated-models.js` keeps only the MATCH RULES and reads the pins from it (every builder's output is pinned byte-for-byte against a fixture frozen at `b803a2a`). One new CLI mode module (`src/sidecar/aliases-owner.js`) reuses `aliases-review.js :: runReview` unchanged by injecting a different view (every ROUTE of every pin, one engine pass per gateway namespace) and a different sink (`setPinRoute` → atomic write → `verifiedOn` stamped). `models.js :: buildFallbackDriftReport` gains the Q7 sibling lines through the comparator the picker and the CI pin gate already share.

**Tech Stack:** Node 22 CommonJS, Jest (unit suite: `npm test`, single file: `npx jest tests/<file>`), readline picker (existing), `child_process.execFileSync('git', …)` for the owner gate, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-14-238-alias-follow-pin-design.md` — D3, D4 (owner row + the `models.js:247` hint row), D7 (`retired`), D8 + Appendix A, §2 (owner sink), §5, §6 groups 8, 9, 10, §7 Phase 2, §8 Q6/Q7, §9 (rulings recorded there stay authoritative). Phase 1 shipped as v4.10.0 (PR #249); this plan was written against `main` @ `cd6b8cfb` on 2026-09-14 and every code fact below was re-measured there.

## Global Constraints

- **300-line gate:** every file under `src/**/*.js` and `electron/**/*.js` stays ≤ 300 lines (`scripts/check-file-sizes.js`, blocks the commit; JSON is not gated). Measured on `cd6b8cfb`: `curated-models.js` **300** (must END ≤ 270 — D8 says it "recovers well under 300"; a mechanical prototype of T1's edits measured **247** lines before the header/cardless prose rewrites, which add ≈ 15), `aliases-review.js` 298 (T4 moves `isFresh` out before adding 4 lines), `aliases.js` 279 (T4 moves `handleUnpin` out before adding ~20), `models.js` 281 (T5 adds ≤ 17), `aliases-review-gate.js` 65, `aliases-review-render.js` 116, `cli.js` is on the exclude list. `src/utils/result-schema.js` is at exactly 300 — do not touch it.
- **New module shape:** `@module` docblock FIRST, then `'use strict'`, ≤ 5 exports, JSDoc on every export. `curated-models.js` keeps its existing 7 exports (grandfathered; add none).
- **The data file is loaded with `require`, never `fs.readFileSync`, for the SHIPPED path.** MEASURED 2026-09-14 on `cd6b8cfb`: 22 unit suites mock `fs` wholesale (`grep -rl "jest.mock('fs'" tests`); a `readFileSync` at `curated-models.js` load time reddened `tests/headless-output-length.test.js` (one test), a `require()` of the same bytes passed all 22 (`npx jest` over the 22 files: 20 + 2 suites green). `config.js:16-17` computes `DEFAULT_ALIASES`/`CURATED_ROUTES` at require time, so the loader IS on config's load path. An explicit `filePath` argument (tests, temp copies) reads through fs.
- **No test ever writes `src/utils/curated-pins.json`.** Owner-mode tests inject `loadCuratedPins`/`saveCuratedPins` bound to a temp copy and inject `git`, `isTTY`, `ask`, `today`. In CI the real gate PASSES (clean checkout, package root = repo root), so a test that reached the real sink would rewrite the shipped file — never dispatch one.
- **Canonical JSON format:** the file on disk is exactly `JSON.stringify(doc, null, 2) + '\n'` (LF — `.gitattributes` forces `eol=lf` repo-wide). `saveCuratedPins` writes that format; a test asserts the shipped bytes equal it, so an owner session that changes nothing leaves no diff.
- **Byte-identity proof (spec §6.8) uses TWO frozen fixtures:** the INPUT (`tests/fixtures/curated-pins-b803a2a.json`, a copy of the initial data file) and the OUTPUT (`tests/fixtures/curated-models-b803a2a-outputs.json`, generated from the builders at HEAD BEFORE any edit — `git diff b803a2a..cd6b8cfb -- src/utils/curated-models.js` is empty, measured). The test mocks the loader with the input and asserts the output; it therefore stays green when the SHIPPED pins later change (the D3 baseline session), which a test against the live file would not.
- **Released CHANGELOG entries are history.** The 4.10.0 clause "shared with the CI alias-pin drift gate" was true at 4.10.0 and is NOT edited; the new `[Unreleased]` entry says `models --check` now also consumes the comparator. LIVE docblocks that become false ARE corrected (`model-id-siblings.js:9-12`, `curated-models.js` Appendix A row 12).
- **Citations:** `scripts/check-citations.js` runs in the pre-commit hook over staged files and everything citing them. Prefer `file.js :: symbol` anchors. Pre-existing rot in `tests/workspace/watch-ui.test.js:64` (`cli.js:606`) and `tests/docs-command-coverage.test.js:27` (`cli.js:753`) is in range and not this PR's to fix.
- **Docs sync:** the pre-commit hook regenerates and auto-stages `docs/architecture-map.md`; let it, never hand-edit the AUTO sections. `CLAUDE.md` is not edited by this PR (the inventory it points to is the regenerated map — same as PR #249, which added six `src/` files without a CLAUDE.md edit; the hook only warns).
- **Test rails:** unit tests via `npx jest tests/<file>` during a task and `npm test` at integration. NEVER run jest with `--testMatch` and never run `npm run test:integration:live` (spends money). `npm run test:integration` (keyless) is allowed at integration time only. `posttest` writes `.test-passed` keyed to HEAD; the pre-push hook re-runs the suite if it mismatches.
- **Hermeticity:** every unit test that touches config runs under `tests/setup/hermetic-config-dir.js` (automatic via `jest.config.js`); no real network (mock `../src/utils/model-catalog`); no real git (inject `git`).
- **Prototype safety:** every alias/pin map built from JSON is iterated with `Object.keys`/`Object.entries` (own keys) and read with `hasOwnProperty`; new maps are `{ __proto__: null }`. The validator refuses `__proto__`/`constructor`/`prototype` as a pin, retired or notable name. The `BUILDERPROTO` seeds in `toGatewayRoutes`/`toDefaultAliases` are untouched.
- **stdout discipline:** `--json` output is byte-clean on stdout; every notice, error and prompt goes to stderr or is part of the interactive TTY dialogue.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Worktrees:** each parallel task runs in its own linked worktree beside the repo (`C:\Users\sendt\code\amicus-238-t<N>`) on branch `feat/238-pr2-task-<N>` cut from the integration branch, with `node_modules` junctioned from the main clone (`cmd /c mklink /J node_modules C:\Users\sendt\code\amicus\node_modules`). Never place a worktree inside the repo (jest ignores any path containing `worktrees`). **Cleanup lesson from PR #249:** `git worktree remove` leaves the junction-only directory behind; remove the junction FIRST with PowerShell `(Get-Item <dir>\node_modules -Force).Delete()` after checking `LinkType -eq 'Junction'`, then `rmdir` the empty dir — never recursive-delete through the junction (it would delete the main clone's `node_modules`).

---

## Rulings made in this plan (recorded so the spec stays the authority)

Each is a decision the spec did not settle; each names its cost if wrong. They belong in the PR body's "design decisions" section.

- **R-P2-1 — Owner mode reviews ROUTES, one engine pass per gateway namespace.** The spec says "same picker, curated-pins.json sink" and the engine works on alias→id rows; a pin has one route per namespace (`openrouter/google/gemini-3.6-flash` AND `google/gemini-3.6-flash`). `model-id-siblings.js :: parsePin` keys the vendor as everything before the last `/`, so each route only ever has siblings in its own namespace, and `alias-proposals.js :: proposeForRow` gates on `providerOf(r.id)`. Reviewing each route in its own pass (`openrouter` first, then each direct namespace in file order) makes the §5 gate apply per route, lets the sink know WHICH route it is replacing without parsing alias names, and needs no derivation rule for divergent vendors (Anthropic's dash ids cannot be derived from OpenRouter's dot ids). A namespace with no authoritative catalog row (no key) or in `providerFailures` is announced and skipped, never reported "up to date". *Cost if wrong:* a pin's two routes are reviewed on different screens; `routeDisagreements` (R-P2-10) catches a pair the owner left inconsistent.
- **R-P2-2 — Owner mode has no `never ask again`.** A dismissal is user state (`config.aliasReview.dismissed`) keyed `alias@proposedId`; the shipped set carries none in D8's schema, and writing owner dismissals into the owner's user config would hide the same key in user mode. The owner view nulls `dismissKey` and `menuFor` omits the item for a proposal without one. A declined sibling is proposed again next session. *Cost:* a few re-asks a year (spec §9 already defers per-alias mute).
- **R-P2-3 — Owner mode walks PROPOSALS only.** A retarget with no mechanical finding, and retiring an alias (moving it under `retired`), are hand edits of `curated-pins.json` — D8 made it a data file so that is easy, and `git diff` reviews it. No `--all` walk, no "retire" menu item in this round.
- **R-P2-4 — The clean-tree check ignores untracked files** (`git status --porcelain --untracked-files=no`). The owner's clone carries an untracked `site-src/`; untracked files never reach `git diff`, which is the review surface D8 names. Staged and unstaged modifications both refuse.
- **R-P2-5 — The sink refuses an id from another namespace.** `setPinRoute(doc, alias, provider, id, today)` requires `id` to start with `${provider}/` where `provider` is the PASS's namespace; every menu candidate satisfies it by construction (siblings and replacements share the route's vendor path), so only a typed "choose another" id can trip it, and it lands as the picker's existing `could not write: …` line with the menu returning.
- **R-P2-6 — The shipped file is loaded with `require`** (measured; see Global Constraints). Consequence: cached for the process — fine, the one writer keeps working from its in-memory document and never re-reads.
- **R-P2-7 — The §6.8 proof is input-fixture + output-fixture**, both frozen at `b803a2a`, so the live pins may change after the move without touching the test.
- **R-P2-8 — `notable` is wired into the user surface now**, not in Phase 4. The engine and the file both carry it; `collectAliasView` passes `retired` and `notable` from the file. Phase 4's "notable list" becomes owner-curated DATA plus the notice. A test proves a notable entry surfaces end-to-end; the shipped list is `[]`, so nothing changes for users until the owner adds one.
- **R-P2-9 — Rulings are prompted AFTER the walk, one per touched pin;** the write of the pin itself happens synchronously inside the sink BEFORE the picker prints ✓ (so the ✓ is never a lie), and `acceptCandidate` is synchronous, so a prompt cannot live inside it without editing the 298-line picker. Enter keeps the current ruling; text replaces it (a retarget can make an old ruling stale, but silently losing the `gatewayOnly` rationale would be worse — the owner decides).
- **R-P2-10 — A routes-disagree summary** closes the walk: every NON-divergent pin whose authored direct route ≠ `stripGatewayPrefix(openrouter route)` is named (today: none — gemini and deepseek agree; anthropic pins are divergent by design and skipped), so the owner reconciles by hand before committing.
- **R-P2-11 — A user pin naming a retired alias is flagged on the list and counted in the picker's "Nothing to review" line.** The engine suppresses retired names before judging them (spec §6.1), so without the flag a dead `devstral` pin would render as a plain custom pin with no warning — worse than the `⚠ gone from catalog` any other stale pin gets — and "all following or up to date" would be false. The ruling prints on a continuation line: it is house text (the shipped file, authored by the owner), so it does not ride the sanitizer; the provenance is stated in the code comment (failure mode #51).
- **R-P2-12 — `verifiedOn` is the UTC date** (`new Date().toISOString().slice(0, 10)`), matching the spec's UTC dating; injectable as `today` for tests.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/curated-pins.json` | new (T1) | the shipped pin set: `version`, `pins` (routes + verifiedOn + ruling? + gatewayOnly?), `retired`, `notable` (Appendix A, row by row) |
| `src/utils/curated-pins.js` | new (T1, T2) | `loadCuratedPins`, `validateCuratedPins` (T1); `saveCuratedPins`, `setPinRoute`, `setPinRuling` (T2) |
| `src/utils/curated-models.js` | modify (T1) | keeps FAMILIES (minus `fallback`), DIVERGENT_VENDORS and every builder; reads pins through `loadCuratedPins`; ends ≤ 270 lines |
| `tests/fixtures/curated-pins-b803a2a.json`, `tests/fixtures/curated-models-b803a2a-outputs.json` | new (T1) | the §6.8 input and output fixtures |
| `tests/utils/curated-pins.test.js` | new (T1, T2) | validator refusals (one per rule), clone isolation, canonical format, write ops |
| `tests/curated-models-move.test.js` | new (T1) | the byte-identity proof, the missing-family-pin throw, Appendix A field presence |
| `src/sidecar/aliases-owner.js` | new (T3) | `runOwnerReview`, `ownerGate`, `routesByProvider`, `routeDisagreements` |
| `src/sidecar/aliases-review-render.js` | modify (T3) | `menuFor` omits `never ask again` when `p.dismissKey` is falsy |
| `src/cli.js` | modify (T3) | `owner` in `BOOLEAN_FLAGS`; `--owner` in the `aliases` help block |
| `src/sidecar/aliases.js` | modify (T4, T3) | `loadDeps` gains `loadCuratedPins`; `collectAliasView` passes `retired`/`notable` and returns `retired`; `renderAliasList` flags retired rows; `buildAliasesDoc` adds `retired`; `handleUnpin` moves out (T4); `--owner` dispatch + argument error (T3) |
| `src/sidecar/aliases-unpin.js` | new (T4) | `handleUnpin`, moved verbatim from `aliases.js` |
| `src/sidecar/aliases-review.js` | modify (T4) | "Nothing to review" names retired pins and pluralizes; `isFresh` moves out |
| `src/sidecar/aliases-review-gate.js` | modify (T4) | gains `isFresh` (5th export) |
| `src/sidecar/models.js` | modify (T5) | `buildFallbackDriftReport`: Q7 newer-sibling lines for cardless pins; family hint → `amicus aliases --review --owner` |
| `src/utils/model-id-siblings.js` | modify (T5) | docblock lines 9–12 corrected (`models --check` now consumes it) |
| `tests/sidecar/aliases-owner.test.js` | new (T3) | gate, passes, sink, rulings, abort, disagreements, `--owner` argument error |
| `tests/sidecar/aliases-command.test.js`, `tests/sidecar/aliases-review.test.js` | modify (T4, T3) | retired flag, `--json` retired, notable end-to-end, Nothing-to-review wording, menu without dismiss |
| `tests/models-drift.test.js` | modify (T5) | sibling line, gate, failures, exit code unchanged |
| `docs/usage.md`, `README.md`, `CHANGELOG.md` | modify (T6) | user docs |

## Parallel execution map

```
Wave 1 (1):                                   T1  (data file + loader + move + fixtures)
Wave 2 (3 parallel worktrees, disjoint files): T2 (write ops)   T4 (user surface)   T5 (models --check Q7)
Wave 3 (1):                                   T3  (owner mode; needs T2's write ops and T4's aliases.js)
Wave 4 (1):                                   T6  (docs; needs T3/T5 for the exact flag and line text)
Wave 5 (1, integration worktree):             T7  merge + full gates + whole-branch review + PR body
```

Merge rule: after each wave, `git merge --no-ff feat/238-pr2-task-<N>` into the integration branch in `C:\Users\sendt\code\amicus-238`. A conflict in `docs/architecture-map.md` is resolved by taking either side and running `node scripts/generate-docs.js`, then `git add docs/architecture-map.md`. Any other conflict is a plan defect — stop and report it.

---

### Task 1: The data file, its loader, and the byte-identical move

**Files:**
- Create: `src/utils/curated-pins.json`, `src/utils/curated-pins.js`, `tests/fixtures/curated-pins-b803a2a.json`, `tests/fixtures/curated-models-b803a2a-outputs.json`, `tests/utils/curated-pins.test.js`, `tests/curated-models-move.test.js`
- Modify: `src/utils/curated-models.js` (whole file — the post-move source is given in full below)
- Unchanged and must stay green: `tests/curated-models.test.js`, `tests/curated-models-gateway-routes.test.js`, `tests/config-null-alias.test.js`, `tests/models-drift.test.js`, `tests/quick-picks.test.js`, and every other consumer (`grep -rn "require('.*curated-models')" src/` lists 15 consumer files; none reads `FAMILIES`/`CARDLESS` directly — they are not exported).

**Interfaces:**
- Consumes: `src/utils/atomic-write.js :: writeFileAtomic(filePath, data)` (T2 only — not this task), `src/utils/provider-registry.js :: isDirectProvider` (unchanged).
- Produces: `loadCuratedPins(filePath?: string) → { version: 1, pins: Object<string, {routes: Object<string,string>, verifiedOn: string, ruling?: string, gatewayOnly?: true}>, retired: Object<string, {on: string, ruling: string}>, notable: Array<{id: string, suggestedAlias: string, note?: string}> }` — a validated deep copy on every call; no argument = the shipped file via `require`; throws `Error` whose message starts `curated-pins.json: ` on any defect. `validateCuratedPins(doc) → void` (throws the same). `curated-models.js` exports unchanged: `getFamilies, toDefaultAliases, stripGatewayPrefix, listCuratedRoutes, toGatewayRoutes, directFormProvenance, DIVERGENT_VENDORS`; `getFamilies()` entries keep the shape `{alias, label, blurb, vendorPath, idPattern, directProviders, fallback}`; every builder throws `curated-pins.json: no pin for family '<alias>'` when the file lacks a family's pin. T3/T4/T5 import `loadCuratedPins`.

- [ ] **Step 1: Freeze the OUTPUT fixture from the builders at HEAD — before touching anything**

Run from the worktree root (HEAD = the integration branch tip, whose `curated-models.js` is byte-identical to `b803a2a`; confirm with `git diff b803a2a HEAD --stat -- src/utils/curated-models.js` printing nothing):

```bash
mkdir -p tests/fixtures
node -e "
const cm = require('./src/utils/curated-models');
const out = {
  routes: cm.toGatewayRoutes(),
  defaults: cm.toDefaultAliases(),
  provenance: cm.directFormProvenance(),
  curatedRoutes: cm.listCuratedRoutes(),
  families: cm.getFamilies().map(f => ({ ...f, idPattern: String(f.idPattern) })),
};
require('fs').writeFileSync('tests/fixtures/curated-models-b803a2a-outputs.json', JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(out.routes).length, 'aliases;', out.curatedRoutes.length, 'routes');
"
```

Expected: `21 aliases; 28 routes`. Open the file and confirm `routes` starts with `gemini` and ends with `inkling`, and `families` has 5 entries each with a `fallback` object. Commit this file alone first:

```bash
git add tests/fixtures/curated-models-b803a2a-outputs.json
git commit -m "test(curated-models): freeze the builders' outputs at b803a2a for the #238 D8 move proof

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the data file in canonical format**

Generate it with node so the bytes are exactly `JSON.stringify(doc, null, 2) + '\n'` (hand-writing the JSON risks a non-canonical layout that the format test in Step 6 would refuse). The literal below is Appendix A, row by row: every route and `gatewayOnly` copied from `curated-models.js @ b803a2a` lines 35–36, 41, 52, 60–61, 66–67 and 86–128; `verifiedOn` from rows 3, 5, 6, 7, 8, 9, 10, 14; rulings from rows 4, 5, 7, 9, 10, 14; `retired.devstral` from row 13.

```bash
node -e "
const doc = {
  version: 1,
  pins: {
    'gemini': { routes: { openrouter: 'openrouter/google/gemini-3.6-flash', google: 'google/gemini-3.6-flash' }, verifiedOn: '2026-08-04' },
    'gemini-pro': { routes: { openrouter: 'openrouter/google/gemini-3.1-pro-preview' }, verifiedOn: '2026-08-04' },
    'gpt': { routes: { openrouter: 'openrouter/openai/gpt-5.6-terra' }, verifiedOn: '2026-08-04',
      ruling: 'tracks the terra (mid) tier — owner ruling; see the idPattern comment in curated-models.js' },
    'opus': { routes: { openrouter: 'openrouter/anthropic/claude-opus-5', anthropic: 'anthropic/claude-opus-5' }, verifiedOn: '2026-08-04',
      ruling: 'anthropic route authored (divergent vendor), never derived; direct id verified against Anthropic docs' },
    'deepseek': { routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro', deepseek: 'deepseek/deepseek-v4-pro' }, verifiedOn: '2026-08-04' },
    'gpt-pro': { routes: { openrouter: 'openrouter/openai/gpt-5.6-sol-pro' }, verifiedOn: '2026-08-05', gatewayOnly: true,
      ruling: 'tracks the SOL (premium) tier\\'s pro sibling, priced at its base tier (\$5/\$30 per Mtok); retargeted off gpt-5.5-pro 2026-08-04 (\$30/\$180 — still served, but expected to sunset with the 5.5 line); the gpt family tracks terra. gatewayOnly (owner ruling 2026-08-05, v4.6.3 spec): OpenAI\\'s direct namespace does not serve gpt-5.6-sol-pro — never audit the derived direct form as stale, never suggest a direct pairing.' },
    'codex': { routes: { openrouter: 'openrouter/openai/gpt-5.3-codex' }, verifiedOn: '2026-06-09' },
    'claude': { routes: { openrouter: 'openrouter/anthropic/claude-sonnet-5', anthropic: 'anthropic/claude-sonnet-5' }, verifiedOn: '2026-08-04' },
    'sonnet': { routes: { openrouter: 'openrouter/anthropic/claude-sonnet-5', anthropic: 'anthropic/claude-sonnet-5' }, verifiedOn: '2026-08-04' },
    'haiku': { routes: { openrouter: 'openrouter/anthropic/claude-haiku-4.5', anthropic: 'anthropic/claude-haiku-4-5-20251001' }, verifiedOn: '2026-08-04' },
    'fable': { routes: { openrouter: 'openrouter/anthropic/claude-fable-5', anthropic: 'anthropic/claude-fable-5' }, verifiedOn: '2026-08-05',
      ruling: 'direct route authored 2026-08-05 (v4.6.3 spec §3, owner ruling R2): Anthropic /v1/models lists claude-fable-5 and the direct route served in live smoke wave 47278069 — the entry was OpenRouter-only at authoring' },
    'qwen': { routes: { openrouter: 'openrouter/qwen/qwen3.8-max-0902' }, verifiedOn: '2026-09-05',
      ruling: 'dated id: OpenRouter and models.dev dropped the un-dated qwen3.8-max for qwen3.8-max-0902 on 2026-09-05 (the #218 PR 2 probe caught it: F4 went silent)' },
    'qwen-coder': { routes: { openrouter: 'openrouter/qwen/qwen3-coder-next' }, verifiedOn: '2026-08-04' },
    'qwen-flash': { routes: { openrouter: 'openrouter/qwen/qwen3.6-flash' }, verifiedOn: '2026-08-04' },
    'mistral': { routes: { openrouter: 'openrouter/mistralai/mistral-medium-3-5' }, verifiedOn: '2026-08-04' },
    'glm': { routes: { openrouter: 'openrouter/z-ai/glm-5.3' }, verifiedOn: '2026-08-04' },
    'minimax': { routes: { openrouter: 'openrouter/minimax/minimax-m2.7' }, verifiedOn: '2026-08-04' },
    'grok': { routes: { openrouter: 'openrouter/x-ai/grok-4.3' }, verifiedOn: '2026-08-04' },
    'kimi': { routes: { openrouter: 'openrouter/moonshotai/kimi-k3' }, verifiedOn: '2026-08-26' },
    'seed': { routes: { openrouter: 'openrouter/bytedance-seed/seed-2.0-lite' }, verifiedOn: '2026-08-04' },
    'inkling': { routes: { openrouter: 'openrouter/thinkingmachines/inkling' }, verifiedOn: '2026-08-14',
      ruling: 'council-review bench default and the fallback floor for forks (workflow_call callers with no alias map resolve their bench here); the full model, not inkling-small — the bench seat wants the flagship\\'s judgment; :batch deliberately not pinned (wrong for an interactive council leg)' },
  },
  retired: {
    'devstral': { on: '2026-08-04', ruling: 'OpenRouter delisted the whole devstral family and the alias had no other route. No retarget — no served model is a devstral successor (no pinned guess is better than a wrong one); mistral remains the vendor\\'s alias.' },
  },
  notable: [],
};
require('fs').writeFileSync('src/utils/curated-pins.json', JSON.stringify(doc, null, 2) + '\n');
console.log(Object.keys(doc.pins).length, 'pins');
"
cp src/utils/curated-pins.json tests/fixtures/curated-pins-b803a2a.json
```

Expected: `21 pins`. (The `\\'` and `\$` escapes are for the shell-quoted `node -e` string; if the shell mangles them, write the same literal to a scratch `.js` file and run `node scratch.js` instead — the RESULT that matters is the JSON file, whose text must contain `tier's`, `OpenAI's`, `flagship's`, `vendor's` with plain apostrophes and `$5/$30`.) Open the JSON and read every pin against `curated-models.js` lines 30–129 once, route by route — this is the hand migration D8/Q6 mandates; the output-fixture test in Step 6 proves the executable half, but `verifiedOn`/`ruling` text has no oracle but your eyes.

- [ ] **Step 3: Write the failing tests for the loader**

Create `tests/utils/curated-pins.test.js`:

```js
// tests/utils/curated-pins.test.js
'use strict';
/**
 * #238 D8 — the shipped pin set's loader and validator. The validator's rules
 * are enumerated one refusal per test (fail-closed: every defect the file can
 * carry has a named message), and `loadCuratedPins` is proven to hand out a
 * COPY (mutant CLONE: return the cached object instead — the isolation test
 * goes red). The shipped file itself must validate and be in canonical
 * format, so an owner-mode write of an unchanged document leaves no diff.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = '../../src/utils/curated-pins';
const SHIPPED_PATH = path.resolve(__dirname, '../../src/utils/curated-pins.json');

function good() {
  return {
    version: 1,
    pins: {
      gemini: { routes: { openrouter: 'openrouter/google/gemini-3.6-flash', google: 'google/gemini-3.6-flash' }, verifiedOn: '2026-08-04' },
      glm: { routes: { openrouter: 'openrouter/z-ai/glm-5.3' }, verifiedOn: '2026-08-04', ruling: 'why' },
      'gpt-pro': { routes: { openrouter: 'openrouter/openai/gpt-5.6-sol-pro' }, verifiedOn: '2026-08-05', gatewayOnly: true },
    },
    retired: { devstral: { on: '2026-08-04', ruling: 'delisted' } },
    notable: [{ id: 'openrouter/newco/atlas-1', suggestedAlias: 'atlas', note: 'new entrant' }],
  };
}

describe('validateCuratedPins — one refusal per rule', () => {
  const { validateCuratedPins } = require(MOD);
  const refuses = (mutate, message) => {
    const doc = good();
    mutate(doc);
    expect(() => validateCuratedPins(doc)).toThrow(message);
  };
  test('the good document validates', () => { expect(() => validateCuratedPins(good())).not.toThrow(); });
  test('not an object', () => { expect(() => validateCuratedPins(null)).toThrow('curated-pins.json: document is not an object'); });
  test('unknown top-level field', () => refuses(d => { d.extra = 1; }, "unknown top-level field 'extra'"));
  test('wrong version', () => refuses(d => { d.version = 2; }, 'unsupported version 2 (expected 1)'));
  test('empty pins', () => refuses(d => { d.pins = {}; }, 'pins must be a non-empty object'));
  test('pin is not an object', () => refuses(d => { d.pins.glm = 'x'; }, "pin 'glm' is not an object"));
  test('pin with an unknown field (a typo is caught, not ignored)', () => refuses(d => { d.pins.glm.gatewayonly = true; }, "pin 'glm' has an unknown field 'gatewayonly'"));
  test('pin without routes', () => refuses(d => { d.pins.glm.routes = {}; }, "pin 'glm' has no routes"));
  test('pin without an openrouter route', () => refuses(d => { d.pins.glm.routes = { google: 'google/x' }; }, "pin 'glm' has no openrouter route"));
  test('route id must live in its key\'s namespace', () => refuses(d => { d.pins.gemini.routes.google = 'openrouter/google/gemini-3.6-flash'; }, "pin 'gemini' route 'google' must be a 'google/…' id"));
  test('route id must have a model segment', () => refuses(d => { d.pins.glm.routes.openrouter = 'openrouter/'; }, "pin 'glm' route 'openrouter' must be a 'openrouter/…' id"));
  test('verifiedOn is required', () => refuses(d => { delete d.pins.glm.verifiedOn; }, "pin 'glm' needs verifiedOn as YYYY-MM-DD"));
  test('verifiedOn must be an ISO date', () => refuses(d => { d.pins.glm.verifiedOn = 'yesterday'; }, "pin 'glm' needs verifiedOn as YYYY-MM-DD"));
  test('ruling, when present, is a non-empty string', () => refuses(d => { d.pins.glm.ruling = ''; }, "pin 'glm' ruling must be a non-empty string"));
  test('gatewayOnly may only be true', () => refuses(d => { d.pins.glm.gatewayOnly = false; }, "pin 'glm' gatewayOnly may only be true"));
  // `d.pins.__proto__ = …` would SET the prototype, not add an own key; JSON.parse is how a file smuggles the name in as an own property
  test('a prototype-polluting pin name is refused', () => refuses(d => { d.pins = JSON.parse('{"__proto__":{"routes":{"openrouter":"openrouter/a/b"},"verifiedOn":"2026-01-01"}}'); }, "'__proto__' is not a valid name"));
  test('a padded pin name is refused', () => refuses(d => { d.pins[' glm'] = d.pins.glm; }, "' glm' is not a valid name"));
  test('retired must be an object', () => refuses(d => { d.retired = []; }, 'retired must be an object'));
  test('an alias cannot be both pinned and retired', () => refuses(d => { d.retired.glm = { on: '2026-01-01', ruling: 'x' }; }, "'glm' is both pinned and retired"));
  test('retired entry has exactly on + ruling', () => refuses(d => { d.retired.devstral.note = 'x'; }, "retired 'devstral' must have exactly on + ruling"));
  test('retired.on is an ISO date', () => refuses(d => { d.retired.devstral.on = '2026-8-4'; }, "retired 'devstral' needs on as YYYY-MM-DD"));
  test('retired needs a ruling', () => refuses(d => { d.retired.devstral.ruling = ''; }, "retired 'devstral' needs a ruling"));
  test('notable must be an array', () => refuses(d => { d.notable = {}; }, 'notable must be an array'));
  test('notable entry needs a provider/model id', () => refuses(d => { d.notable[0].id = 'atlas'; }, 'notable[0] needs a provider/model id'));
  test('notable suggestedAlias must not be a pin or retired', () => refuses(d => { d.notable[0].suggestedAlias = 'glm'; }, "notable[0] suggestedAlias 'glm' is already a pin or retired"));
  test('notable note must be a string', () => refuses(d => { d.notable[0].note = 3; }, 'notable[0] note must be a string'));
  test('notable entry with an unknown field', () => refuses(d => { d.notable[0].why = 'x'; }, "notable[0] has an unknown field 'why'"));
});

describe('loadCuratedPins', () => {
  const { loadCuratedPins, validateCuratedPins } = require(MOD);
  test('the shipped file validates and carries the 21 curated aliases + retired.devstral + an empty notable list', () => {
    const doc = loadCuratedPins();
    expect(Object.keys(doc.pins)).toHaveLength(21);
    expect(Object.keys(doc.pins).slice(0, 5)).toEqual(['gemini', 'gemini-pro', 'gpt', 'opus', 'deepseek']);
    expect(doc.retired.devstral.on).toBe('2026-08-04');
    expect(doc.notable).toEqual([]);
    expect(() => validateCuratedPins(doc)).not.toThrow();
  });
  test('the shipped file is in canonical format (JSON.stringify(doc, null, 2) + LF) so an unchanged owner write leaves no diff', () => {
    const raw = fs.readFileSync(SHIPPED_PATH, 'utf8');
    expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2) + '\n');
  });
  test('every call returns a fresh deep copy — mutating one never reaches the next (mutant CLONE)', () => {
    const a = loadCuratedPins();
    a.pins.glm.routes.openrouter = 'openrouter/z-ai/glm-9.9';
    a.retired.zzz = { on: '2026-01-01', ruling: 'x' };
    const b = loadCuratedPins();
    expect(b.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.3');
    expect(b.retired.zzz).toBeUndefined();
  });
  test('an explicit path reads THAT file, fresh, and validates it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-pins-'));
    const p = path.join(dir, 'pins.json');
    fs.writeFileSync(p, JSON.stringify(good()));
    expect(Object.keys(loadCuratedPins(p).pins)).toEqual(['gemini', 'glm', 'gpt-pro']);
    fs.writeFileSync(p, JSON.stringify({ ...good(), version: 3 }));
    expect(() => loadCuratedPins(p)).toThrow('unsupported version 3');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 4: Run the loader tests to verify they fail**

Run: `npx jest tests/utils/curated-pins.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/curated-pins'`.

- [ ] **Step 5: Write `src/utils/curated-pins.js` (read half)**

```js
/**
 * @module utils/curated-pins
 * The shipped pin set (#238 D8) — `src/utils/curated-pins.json`: one entry per
 * curated alias (`pins`: per-gateway `routes`, the `verifiedOn` date, an
 * optional owner `ruling`, `gatewayOnly` where the openrouter-only route is a
 * deliberate choice), the aliases deliberately dropped (`retired`, with the
 * date and the ruling — neither the sibling scan nor the notable list can
 * resurrect one, and `amicus aliases` tells a user who still pins one what
 * happened), and the owner-curated `notable` list (D7's editorial half).
 * curated-models.js keeps the MATCH RULES and reads the pins from here;
 * `amicus aliases --review --owner` (sidecar/aliases-owner.js) writes here,
 * and `git diff` is the review surface — a pin reaches users only after a
 * human accepted it and committed.
 *
 * The shipped file is loaded with `require`, not `fs.readFileSync`, on
 * purpose: it is reached at LOAD time through config.js (DEFAULT_ALIASES is
 * computed at require), and 22 unit suites mock `fs` wholesale. MEASURED
 * 2026-09-14 on main @ cd6b8cfb: a `readFileSync` at curated-models load
 * reddened tests/headless-output-length.test.js (the mocked read threw inside
 * `require('./utils/config')`, headless.js swallowed it, the output budget
 * became undefined and a leg's error text changed); a `require` of the same
 * bytes passed every one of the 22. `require` rides the module loader's own
 * file access, immune to those mocks. It is also cached for the process —
 * fine, because the one writer (owner mode) keeps working from its own
 * in-memory document and never re-reads. An explicit `filePath` (tests, temp
 * copies) reads fresh through fs instead.
 *
 * Every read validates (`validateCuratedPins`, fail-closed: the first defect
 * is named) and returns a deep copy, so a caller mutating what it got back
 * can never leak into the next builder call.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CURATED_PINS_PATH = path.join(__dirname, 'curated-pins.json');
const SHIPPED = require('./curated-pins.json');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PIN_KEYS = new Set(['routes', 'verifiedOn', 'ruling', 'gatewayOnly']);
const TOP_KEYS = new Set(['version', 'pins', 'retired', 'notable']);
const NOTABLE_KEYS = new Set(['id', 'suggestedAlias', 'note']);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (msg) => { throw new Error(`curated-pins.json: ${msg}`); };

/** @param {*} name an alias or route key @param {string} where names the site for the message */
function checkName(name, where) {
  if (typeof name !== 'string' || name.length === 0 || name.trim() !== name
      || name === '__proto__' || name === 'constructor' || name === 'prototype') {
    fail(`${where}: '${name}' is not a valid name`);
  }
}

/** @param {string} id @param {string} provider @returns {boolean} true when `id` is `<provider>/<something>` */
function inNamespace(id, provider) {
  return typeof id === 'string' && id.startsWith(`${provider}/`) && id.length > provider.length + 1;
}

function validatePin(alias, pin) {
  checkName(alias, 'pins');
  if (!isPlainObject(pin)) { fail(`pin '${alias}' is not an object`); }
  for (const k of Object.keys(pin)) { if (!PIN_KEYS.has(k)) { fail(`pin '${alias}' has an unknown field '${k}'`); } }
  if (!isPlainObject(pin.routes) || Object.keys(pin.routes).length === 0) { fail(`pin '${alias}' has no routes`); }
  if (!own(pin.routes, 'openrouter')) { fail(`pin '${alias}' has no openrouter route`); }
  for (const [provider, id] of Object.entries(pin.routes)) {
    checkName(provider, `pin '${alias}' routes`);
    if (!inNamespace(id, provider)) { fail(`pin '${alias}' route '${provider}' must be a '${provider}/…' id (got ${JSON.stringify(id)})`); }
  }
  if (typeof pin.verifiedOn !== 'string' || !DATE_RE.test(pin.verifiedOn)) { fail(`pin '${alias}' needs verifiedOn as YYYY-MM-DD`); }
  if (own(pin, 'ruling') && (typeof pin.ruling !== 'string' || pin.ruling.length === 0)) { fail(`pin '${alias}' ruling must be a non-empty string`); }
  if (own(pin, 'gatewayOnly') && pin.gatewayOnly !== true) { fail(`pin '${alias}' gatewayOnly may only be true (omit it otherwise)`); }
}

function validateRetired(alias, r, pins) {
  checkName(alias, 'retired');
  if (own(pins, alias)) { fail(`'${alias}' is both pinned and retired`); }
  if (!isPlainObject(r) || Object.keys(r).some(k => k !== 'on' && k !== 'ruling')) { fail(`retired '${alias}' must have exactly on + ruling`); }
  if (typeof r.on !== 'string' || !DATE_RE.test(r.on)) { fail(`retired '${alias}' needs on as YYYY-MM-DD`); }
  if (typeof r.ruling !== 'string' || r.ruling.length === 0) { fail(`retired '${alias}' needs a ruling`); }
}

function validateNotable(n, i, doc) {
  if (!isPlainObject(n) || typeof n.id !== 'string' || !n.id.includes('/')) { fail(`notable[${i}] needs a provider/model id`); }
  checkName(n.suggestedAlias, `notable[${i}] suggestedAlias`);
  if (own(doc.pins, n.suggestedAlias) || own(doc.retired, n.suggestedAlias)) { fail(`notable[${i}] suggestedAlias '${n.suggestedAlias}' is already a pin or retired`); }
  if (own(n, 'note') && typeof n.note !== 'string') { fail(`notable[${i}] note must be a string`); }
  for (const k of Object.keys(n)) { if (!NOTABLE_KEYS.has(k)) { fail(`notable[${i}] has an unknown field '${k}'`); } }
}

/**
 * @param {*} doc a parsed document
 * @throws {Error} `curated-pins.json: <the first defect found>`
 */
function validateCuratedPins(doc) {
  if (!isPlainObject(doc)) { fail('document is not an object'); }
  for (const k of Object.keys(doc)) { if (!TOP_KEYS.has(k)) { fail(`unknown top-level field '${k}'`); } }
  if (doc.version !== 1) { fail(`unsupported version ${JSON.stringify(doc.version)} (expected 1)`); }
  if (!isPlainObject(doc.pins) || Object.keys(doc.pins).length === 0) { fail('pins must be a non-empty object'); }
  for (const [alias, pin] of Object.entries(doc.pins)) { validatePin(alias, pin); }
  if (!isPlainObject(doc.retired)) { fail('retired must be an object'); }
  for (const [alias, r] of Object.entries(doc.retired)) { validateRetired(alias, r, doc.pins); }
  if (!Array.isArray(doc.notable)) { fail('notable must be an array'); }
  doc.notable.forEach((n, i) => validateNotable(n, i, doc));
}

/**
 * @param {string} [filePath] read THIS file fresh through fs; omitted = the
 *   shipped file through `require` (see the module docblock for why)
 * @returns {{version: 1, pins: object, retired: object, notable: Array}} a
 *   validated deep copy
 * @throws {Error} on a missing/unparsable file or any validation defect
 */
function loadCuratedPins(filePath) {
  const raw = filePath === undefined ? SHIPPED : JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateCuratedPins(raw);
  return JSON.parse(JSON.stringify(raw));
}

module.exports = { loadCuratedPins, validateCuratedPins, CURATED_PINS_PATH };
```

(`CURATED_PINS_PATH` is exported for T2's `saveCuratedPins` default and the owner module's messages; the export count ends at 6 after T2 unless T2 folds the path into the save default — see T2, which removes it from the export list and keeps the module at 5.)

- [ ] **Step 6: Run the loader tests; expect green except the canonical-format test if Step 2 was hand-edited**

Run: `npx jest tests/utils/curated-pins.test.js`
Expected: PASS (all). If `canonical format` fails, regenerate the JSON with Step 2's node command — never reformat by hand.

- [ ] **Step 7: Write the failing move-proof test**

Create `tests/curated-models-move.test.js`:

```js
// tests/curated-models-move.test.js
'use strict';
/**
 * #238 D8 / spec §6.8 — the pins moved from curated-models.js into
 * curated-pins.json; the builders must be BYTE-IDENTICAL over the data the
 * source used to hold. Two fixtures frozen at b803a2a (curated-models.js is
 * unchanged between b803a2a and cd6b8cfb, measured): the INPUT
 * (tests/fixtures/curated-pins-b803a2a.json, the initial data file) is fed to
 * the builders through the loader seam, and their outputs must equal the
 * OUTPUT snapshot taken from the pre-move source. Frozen fixtures, not the
 * live file, so the shipped pins may move (the D3 baseline session) without
 * touching this proof.
 *
 * Named mutants (each measured red against this file):
 *   LOOPORDER — in toGatewayRoutes/listCuratedRoutes/directFormProvenance walk
 *               the cardless entries BEFORE the families: key order changes,
 *               the stringified snapshot differs.
 *   FAMILYPIN — pinFor returns `{ routes: {} }` instead of throwing when a
 *               family has no pin: the throw test goes red.
 */
const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, 'fixtures/curated-pins-b803a2a.json');
const OUTPUT = path.resolve(__dirname, 'fixtures/curated-models-b803a2a-outputs.json');

function loadWith(docFactory) {
  jest.resetModules();
  const real = jest.requireActual('../src/utils/curated-pins');
  jest.doMock('../src/utils/curated-pins', () => ({ ...real, loadCuratedPins: () => docFactory() }));
  return require('../src/utils/curated-models');
}

// FIRST, before any doMock in this file (jest.doMock survives resetModules):
// the live shipped file produces the same outputs as the fixture TODAY. This
// documents "no pin has moved yet" and is meant to be DELETED in the D3
// baseline commit, the first commit that legitimately moves a shipped pin.
describe('the live shipped file today', () => {
  test('produces the b803a2a gateway routes (delete this test in the D3 baseline commit)', () => {
    jest.dontMock('../src/utils/curated-pins');
    jest.resetModules();
    const cm = require('../src/utils/curated-models');
    expect(JSON.stringify(cm.toGatewayRoutes())).toBe(JSON.stringify(JSON.parse(fs.readFileSync(OUTPUT, 'utf8')).routes));
  });
});

describe('curated-models over the b803a2a data file', () => {
  const input = () => JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  test('every builder is byte-identical to the pre-move source (spec §6.8)', () => {
    const cm = loadWith(input);
    const out = {
      routes: cm.toGatewayRoutes(),
      defaults: cm.toDefaultAliases(),
      provenance: cm.directFormProvenance(),
      curatedRoutes: cm.listCuratedRoutes(),
      families: cm.getFamilies().map(f => ({ ...f, idPattern: String(f.idPattern) })),
    };
    expect(JSON.stringify(out, null, 2) + '\n').toBe(fs.readFileSync(OUTPUT, 'utf8'));
  });
  test('the b803a2a fixtures still describe 21 aliases and 28 routes (guards a silently edited fixture)', () => {
    const snap = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    expect(Object.keys(snap.routes)).toHaveLength(21);
    expect(snap.curatedRoutes).toHaveLength(28);
    expect(Object.keys(input().pins)).toHaveLength(21);
  });
  test('Appendix A field presence: every pin has verifiedOn; the six rulings and retired.devstral are present', () => {
    const doc = input();
    for (const [alias, pin] of Object.entries(doc.pins)) { expect([alias, pin.verifiedOn]).toEqual([alias, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]); }
    for (const alias of ['gpt', 'opus', 'gpt-pro', 'fable', 'qwen', 'inkling']) { expect(typeof doc.pins[alias].ruling).toBe('string'); }
    expect(doc.pins['gpt-pro'].gatewayOnly).toBe(true);
    expect(doc.pins.codex.verifiedOn).toBe('2026-06-09');
    expect(doc.pins.kimi.verifiedOn).toBe('2026-08-26');
    expect(doc.pins.qwen.verifiedOn).toBe('2026-09-05');
    expect(doc.retired.devstral).toEqual({ on: '2026-08-04', ruling: expect.stringContaining('devstral') });
  });
  test('a family without a pin is a named defect, never a route-less family (mutant FAMILYPIN)', () => {
    const cm = loadWith(() => { const d = input(); delete d.pins.gemini; return d; });
    for (const fn of ['getFamilies', 'toGatewayRoutes', 'toDefaultAliases', 'listCuratedRoutes', 'directFormProvenance']) {
      expect(() => cm[fn]()).toThrow("curated-pins.json: no pin for family 'gemini'");
    }
  });
  test('a family pin may carry gatewayOnly and provenance honours it (the owner can rule it later without a code change)', () => {
    const cm = loadWith(() => { const d = input(); d.pins.gpt.gatewayOnly = true; return d; });
    expect(cm.directFormProvenance().gpt.gatewayOnly).toBe(true);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx jest tests/curated-models-move.test.js`
Expected split (the loader from Step 5 exists, so the mock installs; `curated-models.js` is still the OLD module, which never calls it): `the live shipped file today`, `every builder is byte-identical…` (a preservation pin — green by construction, see Global Constraints), `the b803a2a fixtures still describe…` and `Appendix A field presence` PASS; `a family without a pin…` (nothing throws yet) and `a family pin may carry gatewayOnly…` (the old module ignores the data file) FAIL. The mutants in Step 11 prove the green ones.

- [ ] **Step 9: Rewrite `src/utils/curated-models.js`**

(Pre-measured 2026-09-14: a mechanical application of exactly these edits to the `cd6b8cfb` source, run against the Step 2 data file, produced a snapshot byte-identical to the current module's — 10,042 bytes, `routes`/`defaults`/`provenance`/`curatedRoutes`/`families` — and the Step 5 loader accepted the file and refused all 25 malformed shapes the Step 3 tests name. The plan's code is not a hypothesis; a divergence at this step is a transcription error.)

Replace the whole file with the following. Every function body below `getFamilies` other than the four that read pins is byte-for-byte the current one; the header, the FAMILIES docblock and the CARDLESS block change as Appendix A rows 1, 2, 3, 5, 6, 11, 12, 13, 17 say.

```js
/** Family definitions (match rules) over the shipped pins in ./curated-pins.json (v3). */
/*
 * Families are MATCH RULES over the live catalog, not pinned truths:
 * src/utils/quick-picks.js resolves each family to the current catalog
 * flagship at setup time. The pinned routes live in ./curated-pins.json
 * (#238 D8 — `pins[alias].routes`, one executable id per gateway namespace,
 * with the `verifiedOn` date and an optional owner `ruling` beside each);
 * they are used only when the catalog cannot resolve a route (offline /
 * unkeyed provider) and to derive the static DEFAULT_ALIASES (runtime alias
 * resolution must never wait on the network). `amicus models --check` audits
 * every pinned route against the live catalog, warns when a family fallback
 * falls behind the live resolution, and names a newer same-tier sibling of a
 * cardless pin (informational, #238 Q7); `amicus aliases --review --owner`
 * (sidecar/aliases-owner.js) is the flow that MOVES a pin — a pin reaches
 * users only after a human accepted it there and committed the JSON.
 */

'use strict';

const { isDirectProvider } = require('./provider-registry');
const { loadCuratedPins } = require('./curated-pins');

/**
 * Wizard quick-pick families. `idPattern` matches the model segment after
 * `<vendorPath>/` (openrouter ns) or `<provider>/` (direct ns).
 * `directProviders` lists direct namespaces the quick-picks resolver may
 * resolve live from the catalog. Beyond `openrouter`, a per-provider route
 * in the family's pin (curated-pins.json) is OPTIONAL: when absent and the
 * catalog cannot resolve that namespace, the direct route is omitted (no
 * pinned guess is better than a wrong one).
 * `gpt`'s pattern intentionally matches a plain numeric flagship id
 * (gpt-5.5, gpt-6) OR that id's `-terra` tier variant (gpt-5.6-terra), and
 * excludes every other suffixed variant (-pro/-mini/-codex/-sol/-luna) —
 * see the tier-semantics comment on the entry below.
 */
const FAMILIES = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/,
    directProviders: ['google'] },
  { alias: 'gemini-pro', label: 'Gemini Pro-class', blurb: 'advanced reasoning',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-pro(-preview|-exp|-latest)?$/,
    directProviders: ['google'] },
  // 5.6 split the flagship into tiers: sol (premium, $5/$30), terra (mid,
  // $1/$6), luna (economy, $0.10/$0.60), each with a -pro sibling, plus the
  // unrelated gpt-5.3-codex family. Owner ruling: `gpt` tracks the TERRA
  // (mid) tier — sol/luna/pro variants and codex are excluded deliberately.
  // Bare numeric ids (gpt-5.5-style) stay matched as a within-family
  // fallback if the terra naming ever disappears from the catalog.
  { alias: 'gpt', label: 'GPT flagship', blurb: 'strong coding',
    vendorPath: 'openai',
    idPattern: /^gpt-[\d.]+(-terra)?$/,
    directProviders: ['openai'] },
  { alias: 'opus', label: 'Claude Opus-class', blurb: 'deep analysis',
    vendorPath: 'anthropic',
    idPattern: /^claude-opus-[\d.-]+$/,
    directProviders: ['anthropic'] },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    vendorPath: 'deepseek',
    idPattern: /^deepseek-v[\d.]+(-pro)?$/,
    directProviders: ['deepseek'] },
];
const FAMILY_ALIASES = new Set(FAMILIES.map(f => f.alias));

/**
 * @param {string} alias a family alias
 * @param {object} pins `loadCuratedPins().pins`
 * @returns {{routes: Object<string,string>, gatewayOnly?: true}} that family's pin
 * @throws {Error} when the data file has no pin for the family — a shipped-file
 *   defect that must be named, never a silently route-less family
 */
function pinFor(alias, pins) {
  if (!Object.prototype.hasOwnProperty.call(pins, alias)) {
    throw new Error(`curated-pins.json: no pin for family '${alias}'`);
  }
  return pins[alias];
}

/**
 * Alias-only entries (no wizard quick pick): every pin in curated-pins.json
 * whose alias is not a family alias, in file order. Every entry authors an
 * openrouter route; entries whose vendor's direct API genuinely serves the
 * model also author a direct route (claude/sonnet/haiku/fable). These pins
 * are the FALLBACK FLOOR — a fork with no CI alias map resolves its bench
 * here; the owner's machine and .github/amicus-ci-aliases.json run newer ids.
 * Cardless entries have no `idPattern`, so `models --check` asks whether the
 * OLD id still EXISTS and (#238 Q7) whether a newer same-tier sibling is
 * listed; scripts/check-ci-alias-pins.js asks the sibling question of the CI
 * alias map.
 * @param {object} pins `loadCuratedPins().pins`
 * @returns {Array<{alias: string, routes: Object<string,string>, gatewayOnly?: true}>}
 */
function cardlessEntries(pins) {
  return Object.keys(pins).filter(a => !FAMILY_ALIASES.has(a))
    .map(a => ({ alias: a, routes: pins[a].routes, gatewayOnly: pins[a].gatewayOnly }));
}

/**
 * @returns {Array} shallow-spread copies of the family definitions with
 * `fallback` attached from the data file (`pins[alias].routes`); `idPattern`
 * is intentionally a shared RegExp reference — safe because none use the g/y
 * flags (no lastIndex state) and callers treat it read-only.
 */
function getFamilies() {
  const { pins } = loadCuratedPins();
  return FAMILIES.map(f => ({
    ...f,
    directProviders: [...f.directProviders],
    fallback: { ...pinFor(f.alias, pins).routes },
  }));
}
```

Then, verbatim from the current file: the `stripGatewayPrefix` docblock + function (current lines 144–167). Then:

```js
/**
 * @returns {Array<{alias,provider,model}>} every pinned route, flattened (for the alias audit).
 */
function listCuratedRoutes() {
  const { pins } = loadCuratedPins();
  const out = [];
  for (const f of FAMILIES) {
    for (const [provider, model] of Object.entries(pinFor(f.alias, pins).routes)) {
      out.push({ alias: f.alias, provider, model });
    }
  }
  for (const e of cardlessEntries(pins)) {
    for (const [provider, model] of Object.entries(e.routes)) {
      out.push({ alias: e.alias, provider, model });
    }
  }
  return out;
}
```

Then, verbatim: the `DIVERGENT_VENDORS` docblock + constant (current 187–196), `vendorOf` (198–205), `directFormFor` (207–218), `gatewayRoutesFor` (220–230). Then:

```js
/**
 * Per-alias provenance of the `direct` form in toGatewayRoutes(), for the
 * auditors (alias-audit.js / gateway-route-audit.js): an AUTHORED direct
 * form absent from its namespace is stale; a DERIVED one is a computed
 * convenience whose absence is a routing fact, not staleness, while the
 * authoring openrouter route is live. `gatewayOnly` mirrors a pin's
 * explicit routing-choice annotation (owner-ruled, in curated-pins.json):
 * suppress derived-form findings unconditionally and never suggest a direct
 * pairing.
 * @returns {Object<string, {directForm: 'authored'|'derived'|'none', gatewayOnly: boolean}>}
 */
function directFormProvenance() {
  const { pins } = loadCuratedPins();
  const out = {};
  const entryProv = (vendorPath, obj, gatewayOnly) => {
    const direct = directFormFor(vendorPath, obj);
    const directForm = !direct ? 'none' : (obj[vendorPath] ? 'authored' : 'derived');
    return { directForm, gatewayOnly: gatewayOnly === true };
  };
  for (const f of FAMILIES) { const pin = pinFor(f.alias, pins); out[f.alias] = entryProv(f.vendorPath, pin.routes, pin.gatewayOnly); }
  for (const e of cardlessEntries(pins)) { out[e.alias] = entryProv(vendorOf(e.routes.openrouter), e.routes, e.gatewayOnly); }
  return out;
}

/**
 * @returns {Object<string,{direct?: string, openrouter: string}>} alias →
 * per-gateway executable ids. Unlike `toDefaultAliases` (a single pinned
 * string per alias, used for display/`config.default`), this carries BOTH
 * gateway-native forms so the router (Task 3) can route direct-first
 * without corrupting divergent-vendor ids (e.g. Anthropic's dash format).
 */
function toGatewayRoutes() {
  // `__proto__: null` — v4.8 SI-22.4 round 3 (G-1). Read by BARE INDEXING
  // downstream, so a plain `{}` let an alias named 'toString'/'constructor'/
  // 'valueOf'/'hasOwnProperty' resolve off Object.prototype to a truthy
  // Function — including on the auto-repair path (`alias-resolver.js ::
  // autoRepairAlias`), which `getEffectiveAliases`'s own fix could never reach.
  // Full measurement + why THREE seeds were needed:
  // tests/council/preset-trim-mutants.js :: BUILDERPROTO (the named mutant).
  const { pins } = loadCuratedPins();
  const out = { __proto__: null };
  for (const f of FAMILIES) { out[f.alias] = gatewayRoutesFor(f.vendorPath, pinFor(f.alias, pins).routes); }
  for (const e of cardlessEntries(pins)) { out[e.alias] = gatewayRoutesFor(vendorOf(e.routes.openrouter), e.routes); }
  return out;
}
```

Then, verbatim: the `toDefaultAliases` docblock + function (current 275–295) and the `module.exports` block (297–300), unchanged.

- [ ] **Step 10: Run the move proof and every existing consumer**

Run: `npx jest tests/curated-models-move.test.js tests/utils/curated-pins.test.js tests/curated-models.test.js tests/curated-models-gateway-routes.test.js tests/config-null-alias.test.js tests/config.test.js tests/models-drift.test.js tests/quick-picks.test.js tests/alias-drift.test.js tests/alias-shadow.test.js tests/model-tiers.test.js tests/route-launch.test.js tests/council-presets.test.js`
Expected: PASS, every suite. Then `wc -l src/utils/curated-models.js` → ≤ 270 (report the number; the mechanical prototype measured 247 before the prose rewrites), and `node scripts/check-file-sizes.js --all` clean.

- [ ] **Step 11: Measure the named mutants, then restore**

Commit first (Step 12 message) so `git checkout -- src/utils/curated-models.js` restores a committed tree between mutants — a `git checkout --` before the commit would destroy the work. Then, one at a time:

1. `LOOPORDER`: in `toGatewayRoutes` swap the two `for` lines (cardless loop first). Run `npx jest tests/curated-models-move.test.js` → expect `every builder is byte-identical…` RED. Restore.
2. `FAMILYPIN`: make `pinFor` `return pins[alias] || { routes: {} };` with no throw. Run → expect `a family without a pin…` RED (and possibly others). Restore.
3. `CLONE`: in `loadCuratedPins` return `raw` instead of the parsed copy. Run `npx jest tests/utils/curated-pins.test.js` → expect `every call returns a fresh deep copy` RED. Restore.

Record each RED set (suite + test names) in the report and in the test-file header comments, replacing the "each measured red" claim with the measured list. Confirm `git status --porcelain` is clean after the last restore.

- [ ] **Step 12: Commit**

```bash
git add src/utils/curated-pins.json src/utils/curated-pins.js src/utils/curated-models.js tests/fixtures/curated-pins-b803a2a.json tests/utils/curated-pins.test.js tests/curated-models-move.test.js
git commit -m "feat(curated-pins): move the shipped pins, retired list and notable list into src/utils/curated-pins.json (#238 D8)

curated-models.js keeps the match rules and reads the pins through the new
loader; every builder is byte-identical over the b803a2a data (frozen input
and output fixtures). The file is loaded with require, not readFileSync:
22 suites mock fs wholesale and a load-time readFileSync reddened
headless-output-length (measured). Validator refuses every malformed shape
with a named message; verifiedOn is required on every pin.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(The pre-commit hook regenerates `docs/architecture-map.md` and stages it; `check-citations` will scan every live citation of `curated-models.js` — all are symbol anchors or `@b803a2a` historical forms, none is a bare line number, measured.)

---

### Task 2: The write half of `curated-pins.js`

**Files:**
- Modify: `src/utils/curated-pins.js` (add three functions, extend the docblock, fix the export list to exactly five)
- Test: `tests/utils/curated-pins.test.js` (extend)

**Interfaces:**
- Consumes: `src/utils/atomic-write.js :: writeFileAtomic(filePath: string, data: string) → void` (temp + rename; throws on failure).
- Produces: `saveCuratedPins(doc, filePath = <shipped path>) → void` — validates, writes `JSON.stringify(doc, null, 2) + '\n'` atomically; `setPinRoute(doc, alias, provider, id, today) → doc'` — pure, returns a deep copy with `pins[alias].routes[provider] = id` and `pins[alias].verifiedOn = today`, throws `curated-pins.json: …` when `alias` is not a pin, `provider` is not already one of its routes, `id` is not `${provider}/<model>`, or `today` is not `YYYY-MM-DD`; `setPinRuling(doc, alias, ruling) → doc'` — pure, sets `pins[alias].ruling = ruling.trim()`, throws on an unknown alias or a blank ruling. Final export list: `{ loadCuratedPins, validateCuratedPins, saveCuratedPins, setPinRoute, setPinRuling }` (5). T3 consumes all three.

- [ ] **Step 1: Write the failing tests** — append to `tests/utils/curated-pins.test.js`:

```js
describe('write half — saveCuratedPins / setPinRoute / setPinRuling (owner mode, #238 D8)', () => {
  const { loadCuratedPins, saveCuratedPins, setPinRoute, setPinRuling } = require(MOD);
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-pins-w-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('saveCuratedPins writes the canonical format to the given path and the loader reads it back equal', () => {
    const p = path.join(dir, 'pins.json');
    saveCuratedPins(good(), p);
    expect(fs.readFileSync(p, 'utf8')).toBe(JSON.stringify(good(), null, 2) + '\n');
    expect(loadCuratedPins(p)).toEqual(good());
  });
  test('saveCuratedPins validates BEFORE writing — an invalid document leaves the file untouched', () => {
    const p = path.join(dir, 'pins.json');
    saveCuratedPins(good(), p);
    const bad = good(); delete bad.pins.glm.verifiedOn;
    expect(() => saveCuratedPins(bad, p)).toThrow("pin 'glm' needs verifiedOn");
    expect(loadCuratedPins(p)).toEqual(good());
    expect(fs.readdirSync(dir)).toEqual(['pins.json']); // no temp file left behind
  });
  test('setPinRoute replaces exactly that route, stamps verifiedOn, and returns a COPY (mutant STAMP: skip the stamp)', () => {
    const before = good();
    const after = setPinRoute(before, 'gemini', 'openrouter', 'openrouter/google/gemini-3.7-flash', '2026-09-20');
    expect(after.pins.gemini.routes).toEqual({ openrouter: 'openrouter/google/gemini-3.7-flash', google: 'google/gemini-3.6-flash' });
    expect(after.pins.gemini.verifiedOn).toBe('2026-09-20');
    expect(before.pins.gemini.routes.openrouter).toBe('openrouter/google/gemini-3.6-flash');
    expect(before.pins.gemini.verifiedOn).toBe('2026-08-04');
    expect(Object.keys(after.pins.gemini)).toEqual(['routes', 'verifiedOn']); // key order preserved
  });
  test('setPinRoute refuses an unknown alias, a namespace the pin has no route in, an id outside the namespace, and a bad date (mutant PROVMATCH: drop the namespace check)', () => {
    expect(() => setPinRoute(good(), 'atlas', 'openrouter', 'openrouter/a/b', '2026-09-20')).toThrow("'atlas' is not a shipped pin");
    expect(() => setPinRoute(good(), 'glm', 'google', 'google/x', '2026-09-20')).toThrow("'glm' has no google route to replace (routes: openrouter)");
    expect(() => setPinRoute(good(), 'gemini', 'openrouter', 'google/gemini-3.7-flash', '2026-09-20')).toThrow("'google/gemini-3.7-flash' is not in the openrouter/ namespace");
    expect(() => setPinRoute(good(), 'gemini', 'openrouter', 'openrouter/', '2026-09-20')).toThrow("'openrouter/' is not in the openrouter/ namespace");
    expect(() => setPinRoute(good(), 'glm', 'openrouter', 'openrouter/z-ai/glm-5.4', 'today')).toThrow("verifiedOn must be YYYY-MM-DD (got 'today')");
  });
  test('setPinRuling sets a trimmed ruling on a copy; blank or unknown alias refused', () => {
    const before = good();
    const after = setPinRuling(before, 'gemini', '  flash tier, verified live  ');
    expect(after.pins.gemini.ruling).toBe('flash tier, verified live');
    expect(before.pins.gemini.ruling).toBeUndefined();
    expect(() => setPinRuling(good(), 'gemini', '   ')).toThrow("ruling for 'gemini' must be a non-empty string");
    expect(() => setPinRuling(good(), 'nope', 'x')).toThrow("'nope' is not a shipped pin");
  });
  test('a setPinRoute → saveCuratedPins → loadCuratedPins round trip through curated-models yields the new gateway routes', () => {
    const p = path.join(dir, 'pins.json');
    saveCuratedPins(setPinRoute(loadCuratedPins(), 'glm', 'openrouter', 'openrouter/z-ai/glm-5.4', '2026-09-20'), p);
    jest.resetModules();
    const real = jest.requireActual('../../src/utils/curated-pins');
    jest.doMock('../../src/utils/curated-pins', () => ({ ...real, loadCuratedPins: () => real.loadCuratedPins(p) }));
    const cm = require('../../src/utils/curated-models');
    expect(cm.toGatewayRoutes().glm).toEqual({ openrouter: 'openrouter/z-ai/glm-5.4' });
    expect(cm.toDefaultAliases().gemini).toBe('google/gemini-3.6-flash'); // untouched pins unchanged
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/utils/curated-pins.test.js`
Expected: FAIL — `saveCuratedPins is not a function` (and the others).

- [ ] **Step 3: Implement**

In `src/utils/curated-pins.js`: add after the `path` require: `const { writeFileAtomic } = require('./atomic-write');`. Append this paragraph to the module docblock (before the closing ` */`):

```
 *
 * The two edits owner mode makes are PURE functions over a document
 * (`setPinRoute`, `setPinRuling` — each returns a deep copy); `saveCuratedPins`
 * validates again and writes atomically (utils/atomic-write.js) in the ONE
 * canonical format, `JSON.stringify(doc, null, 2)` + LF, so an owner session
 * that changes nothing leaves no diff. A write never happens on an invalid
 * document, so the shipped file can never be left unloadable.
```

Add before `module.exports`:

```js
/**
 * @param {object} doc a document `validateCuratedPins` accepts
 * @param {string} [filePath] defaults to the shipped file
 * @throws {Error} a validation defect (nothing written) or the write error
 */
function saveCuratedPins(doc, filePath = CURATED_PINS_PATH) {
  validateCuratedPins(doc);
  writeFileAtomic(filePath, JSON.stringify(doc, null, 2) + '\n');
}

/**
 * Replace ONE route of ONE pin and stamp it verified today (#238 D8 owner
 * sink). Pure: the input is untouched and a deep copy is returned.
 * @param {object} doc
 * @param {string} alias a pin name
 * @param {string} provider the route key being replaced — must already exist on the pin
 * @param {string} id the new executable id, `<provider>/<model>`
 * @param {string} today `YYYY-MM-DD`
 * @returns {object} the new document
 */
function setPinRoute(doc, alias, provider, id, today) {
  if (!isPlainObject(doc) || !isPlainObject(doc.pins) || !own(doc.pins, alias)) { fail(`'${alias}' is not a shipped pin`); }
  const routes = isPlainObject(doc.pins[alias].routes) ? doc.pins[alias].routes : {};
  if (!own(routes, provider)) { fail(`'${alias}' has no ${provider} route to replace (routes: ${Object.keys(routes).join(', ')})`); }
  if (!inNamespace(id, provider)) { fail(`'${id}' is not in the ${provider}/ namespace`); }
  if (typeof today !== 'string' || !DATE_RE.test(today)) { fail(`verifiedOn must be YYYY-MM-DD (got '${today}')`); }
  const next = JSON.parse(JSON.stringify(doc));
  next.pins[alias].routes[provider] = id;
  next.pins[alias].verifiedOn = today;
  return next;
}

/**
 * @param {object} doc
 * @param {string} alias a pin name
 * @param {string} ruling free text; trimmed, must be non-empty
 * @returns {object} a deep copy with `pins[alias].ruling` replaced
 */
function setPinRuling(doc, alias, ruling) {
  if (!isPlainObject(doc) || !isPlainObject(doc.pins) || !own(doc.pins, alias)) { fail(`'${alias}' is not a shipped pin`); }
  const text = typeof ruling === 'string' ? ruling.trim() : '';
  if (!text) { fail(`ruling for '${alias}' must be a non-empty string`); }
  const next = JSON.parse(JSON.stringify(doc));
  next.pins[alias].ruling = text;
  return next;
}

module.exports = { loadCuratedPins, validateCuratedPins, saveCuratedPins, setPinRoute, setPinRuling };
```

Remove `CURATED_PINS_PATH` from the export list (it stays a module constant). Nothing imported it in T1 (grep to confirm before removing).

- [ ] **Step 4: Run the tests** — `npx jest tests/utils/curated-pins.test.js tests/curated-models-move.test.js` → PASS. `wc -l src/utils/curated-pins.js` → report (budget ≤ 200).

- [ ] **Step 5: Measure mutants after committing (Step 6 first, then):** `STAMP` (delete the `next.pins[alias].verifiedOn = today;` line) → `setPinRoute replaces exactly that route…` RED; `PROVMATCH` (replace `if (!inNamespace(id, provider))` with `if (typeof id !== 'string')`) → the `refuses … an id outside the namespace` test RED. Restore; record the RED sets in the describe's header comment.

- [ ] **Step 6: Commit**

```bash
git add src/utils/curated-pins.js tests/utils/curated-pins.test.js
git commit -m "feat(curated-pins): saveCuratedPins, setPinRoute, setPinRuling — the owner-mode write half (#238 D8)

Pure edits over a document plus one validating, atomic, canonical-format
write; a route is only ever replaced in its own namespace and stamps
verifiedOn.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Owner mode — `amicus aliases --review --owner`

**Files:**
- Create: `src/sidecar/aliases-owner.js`, `tests/sidecar/aliases-owner.test.js`
- Modify: `src/sidecar/aliases-review-render.js :: menuFor` (dismiss item only when `p.dismissKey`), `src/sidecar/aliases.js :: handleAliases` (dispatch + argument error; this task runs AFTER T4 merged, so `aliases.js` already has T4's shape), `src/cli.js` (`BOOLEAN_FLAGS` + the `aliases` help block)
- Test also: `tests/sidecar/aliases-review.test.js` (one added test: a proposal without `dismissKey` renders no `never ask again`), `tests/cli.test.js` (one added parseArgs pin)

**Interfaces:**
- Consumes: `aliases-review.js :: runReview(args, deps) → Promise<number>` (unchanged; `deps` merge onto its defaults; it creates no prompt when `deps.ask` is given; returns 1 on `REVIEW_ABORTED` or an unavailable catalog); `aliases-review-prompt.js :: createPrompt() → {ask, close}`; `aliases-review-render.js :: refreshingCatalogLine(cache, now) → string`; `alias-proposals.js :: buildAliasProposals({userAliases, defaults, catalogInfo, retired, notable, dismissed})`; `curated-pins.js :: loadCuratedPins, saveCuratedPins, setPinRoute, setPinRuling` (T2); `curated-models.js :: DIVERGENT_VENDORS, stripGatewayPrefix`; `text-sanitize.js :: collapseExcerpt`; `aliases.js :: loadDeps()` (T4's version, which includes `loadCuratedPins`, `getCatalogInfo`, `readCache`, `buildAliasProposals`).
- Produces: `runOwnerReview(args, deps?) → Promise<number>`; `ownerGate(d) → string|null`; `routesByProvider(pins) → Object<string, Object<string,string>>` (null-prototype maps, provider order = first appearance in file order, openrouter first); `routeDisagreements(pins) → string[]`. Exactly 4 exports.

- [ ] **Step 1: Write the failing tests**

Create `tests/sidecar/aliases-owner.test.js`:

```js
// tests/sidecar/aliases-owner.test.js
'use strict';
/**
 * #238 Phase 2 — `amicus aliases --review --owner` (D3/D4/D8). Everything
 * external is injected: git (the gate), the TTY, the prompt, today's date,
 * the catalog, and the data file (a temp copy — NO test may write the shipped
 * src/utils/curated-pins.json; in CI the real gate would pass). The picker
 * (aliases-review.js :: runReview) and the engine run for real.
 *
 * Named mutants (measured red against this file):
 *   GATEPREFIX — ownerGate ignores a non-empty `--show-prefix`.
 *   DIRTYTREE  — ownerGate ignores a non-empty `status --porcelain`.
 *   PROVREFUSE — the sink calls setPinRoute with providerOf(id) instead of the pass's namespace.
 *   NODISMISS  — menuFor pushes `never ask again` unconditionally.
 *   SAVEFIRST  — the sink assigns `doc = next` before saveCuratedPins (a failed write would be kept in memory).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHIPPED = path.resolve(__dirname, '../../src/utils/curated-pins.json');
const pinsModule = () => require('../../src/utils/curated-pins');

/** Every shipped route id, so a pass finds its routes LIVE unless a test omits them — a route absent from a namespace the catalog covers reads as STALE and would flood the pass with proposals. */
const shippedRouteIds = () => Object.values(pinsModule().loadCuratedPins().pins).flatMap(p => Object.values(p.routes));
function catalogWith({ extra = [], omit = () => false, failures = [], fetchedAt = Date.now() } = {}) {
  const base = shippedRouteIds().filter(id => !omit(id)).map(id => ({ id }));
  return { models: [...base, ...extra.map(e => (typeof e === 'string' ? { id: e } : e))], fetchedAt, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: failures };
}
const EMPTY_CATALOG = { models: [], fetchedAt: null, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [] };

function harness({ answers = [], catalog, git = () => '', isTTY = true, today = '2026-09-20', doc } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliases-owner-'));
  const file = path.join(dir, 'curated-pins.json');
  fs.writeFileSync(file, doc ? JSON.stringify(doc, null, 2) + '\n' : fs.readFileSync(SHIPPED));
  const log = [];
  const queue = [...answers];
  const { loadCuratedPins, saveCuratedPins } = pinsModule();
  const deps = {
    isTTY,
    git,
    today: () => today,
    now: () => Date.now(),
    write: (s) => log.push(String(s)),
    stderr: (s) => log.push('ERR:' + String(s)),
    ask: async () => { if (queue.length === 0) { throw new Error('no more scripted answers'); } return queue.shift(); },
    getCatalogInfo: async () => catalog,
    readCache: () => catalog,
    loadCuratedPins: () => loadCuratedPins(file),
    saveCuratedPins: (d) => { log.push('SAVE'); saveCuratedPins(d, file); },
  };
  return { deps, file, dir, out: () => log.filter(l => !l.startsWith('ERR:')).join(''), err: () => log.filter(l => l.startsWith('ERR:')).join(''), log, read: () => JSON.parse(fs.readFileSync(file, 'utf8')), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const aborted = () => { const e = new Error('aliases --review interrupted'); e.code = 'REVIEW_ABORTED'; return e; };

describe('ownerGate', () => {
  const { ownerGate } = require('../../src/sidecar/aliases-owner');
  test('refuses without a TTY before touching git', () => {
    const git = jest.fn();
    expect(ownerGate({ isTTY: false, git })).toMatch(/interactive: run it in a terminal/);
    expect(git).not.toHaveBeenCalled();
  });
  test('refuses when git fails (not a checkout)', () => {
    expect(ownerGate({ isTTY: true, git: () => { throw new Error('fatal: not a git repository'); } })).toMatch(/not inside a git work tree/);
  });
  test('refuses an installed copy — a non-empty --show-prefix (mutant GATEPREFIX)', () => {
    const git = (args) => (args[1] === '--show-prefix' ? 'node_modules/amicus/' : '');
    expect(ownerGate({ isTTY: true, git })).toMatch(/not an installed copy .*node_modules\/amicus\//);
  });
  test('refuses a dirty tree — a non-empty porcelain status (mutant DIRTYTREE)', () => {
    const git = (args) => (args[0] === 'status' ? ' M src/x.js\n?? scratch' : '');
    expect(ownerGate({ isTTY: true, git })).toMatch(/clean working tree .*2 changed file/);
  });
  test('passes on a clean source checkout and asked git with --untracked-files=no', () => {
    const calls = [];
    const git = (args) => { calls.push(args); return ''; };
    expect(ownerGate({ isTTY: true, git })).toBeNull();
    expect(calls).toEqual([['rev-parse', '--show-prefix'], ['status', '--porcelain', '--untracked-files=no']]);
  });
});

describe('routesByProvider / routeDisagreements', () => {
  const { routesByProvider, routeDisagreements } = require('../../src/sidecar/aliases-owner');
  test('groups every route by its namespace, openrouter first, file order within', () => {
    const { pins } = pinsModule().loadCuratedPins();
    const g = routesByProvider(pins);
    expect(Object.keys(g)).toEqual(['openrouter', 'google', 'anthropic', 'deepseek']);
    expect(Object.keys(g.openrouter)).toHaveLength(21);
    expect(g.google).toEqual({ gemini: 'google/gemini-3.6-flash' });
    expect(Object.keys(g.anthropic)).toEqual(['opus', 'claude', 'sonnet', 'haiku', 'fable']);
    expect(Object.getPrototypeOf(g)).toBeNull();
    expect(Object.getPrototypeOf(g.openrouter)).toBeNull();
  });
  test('the shipped pins have no route disagreements; a non-divergent mismatch is named; a divergent vendor never is', () => {
    const { pins } = pinsModule().loadCuratedPins();
    expect(routeDisagreements(pins)).toEqual([]);
    const bent = JSON.parse(JSON.stringify(pins));
    bent.gemini.routes.openrouter = 'openrouter/google/gemini-3.7-flash';
    bent.haiku.routes.openrouter = 'openrouter/anthropic/claude-haiku-4.6';
    const lines = routeDisagreements(bent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('gemini: google route google/gemini-3.6-flash ≠ google/gemini-3.7-flash');
  });
});

describe('runOwnerReview', () => {
  const { runOwnerReview } = require('../../src/sidecar/aliases-owner');
  let h;
  afterEach(() => { if (h) { h.cleanup(); h = null; } });

  test('gate refusal: one stderr line, exit 1, nothing loaded or written', async () => {
    h = harness({ isTTY: false, catalog: EMPTY_CATALOG });
    h.deps.loadCuratedPins = jest.fn();
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.err()).toMatch(/^ERR:Error: aliases --review --owner is interactive/);
    expect(h.deps.loadCuratedPins).not.toHaveBeenCalled();
    expect(h.out()).toBe('');
  });

  test('no catalog: refuses with the models --refresh hint, exit 1, no write', async () => {
    h = harness({ catalog: EMPTY_CATALOG });
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('no catalog — cannot review');
    expect(h.log).not.toContain('SAVE');
  });

  test('one pass per namespace: a namespace with no authoritative row is announced and skipped; a failed one too', async () => {
    // every shipped route live, plus a newer glm sibling; the deepseek namespace only as a FLOOR row; anthropic rejected
    const catalog = catalogWith({
      extra: ['openrouter/z-ai/glm-5.4', { id: 'deepseek/deepseek-v4-pro', authoritative: false }],
      omit: id => id.startsWith('deepseek/'),
      failures: [{ provider: 'anthropic', reason: 'http-status', status: 401 }] });
    h = harness({ catalog, answers: ['3'] }); // glm: [1] accept 5.4 [2] choose another [3] skip
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    const out = h.out();
    expect(out).toContain('owner mode — reviewing the shipped pins in src/utils/curated-pins.json (21 pins, 28 routes)');
    expect(out).toContain('openrouter routes (21):');
    expect(out).toContain('[1/1] glm');
    expect(out).toContain('google routes (1):');
    expect(out).toContain('Nothing to review — 1 alias, all following or up to date.'); // T4's wording; the google route is live
    expect(out).toContain('anthropic routes (5): provider fetch failed this run — not reviewed');
    expect(out).toContain('deepseek routes (1): no authoritative rows in the catalog (no key?) — not reviewed');
    expect(out).not.toContain('never ask again'); // mutant NODISMISS
    expect(out).toContain('no pin changed — src/utils/curated-pins.json is untouched');
    expect(h.log).not.toContain('SAVE');
  });

  test('accept: the route is replaced in ITS namespace, verifiedOn stamped with the injected UTC date, the write lands BEFORE the ✓, canonical format, ruling prompt keeps on enter', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog, answers: ['1', ''] }); // accept glm-5.4 (the only proposal across all four passes); ruling: enter keeps
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    const doc = h.read();
    expect(doc.pins.glm.routes).toEqual({ openrouter: 'openrouter/z-ai/glm-5.4' });
    expect(doc.pins.glm.verifiedOn).toBe('2026-09-20');
    expect(doc.pins.glm.ruling).toBeUndefined();
    expect(doc.pins.gemini).toEqual(pinsModule().loadCuratedPins().pins.gemini); // untouched
    expect(fs.readFileSync(h.file, 'utf8')).toBe(JSON.stringify(doc, null, 2) + '\n');
    const saveAt = h.log.indexOf('SAVE');
    const tickAt = h.log.findIndex(l => l.includes('✓ glm → openrouter/z-ai/glm-5.4'));
    expect(saveAt).toBeGreaterThan(-1);
    expect(saveAt).toBeLessThan(tickAt);
    expect(h.out()).toContain('rulings — a sentence on WHY');
    expect(h.out()).toContain('current: (none)');
    expect(h.out()).toContain('1 pin changed — review with: git diff src/utils/curated-pins.json');
  });

  test('ruling typed after the walk is trimmed and written; the current ruling is shown first', async () => {
    const catalog = catalogWith({ extra: ['openrouter/openai/gpt-5.7-terra'] }); // gpt's sibling; not gpt-pro's (suffix -sol-pro) — measured
    h = harness({ catalog, answers: ['1', '  terra tier confirmed live 2026-09-20  '] });
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('current: tracks the terra (mid) tier');
    expect(h.read().pins.gpt.ruling).toBe('terra tier confirmed live 2026-09-20');
    expect(h.read().pins.gpt.routes.openrouter).toBe('openrouter/openai/gpt-5.7-terra');
    expect(h.log.filter(l => l === 'SAVE')).toHaveLength(2);
  });

  test('choose another with an id from another namespace is refused by the sink and the menu returns (mutant PROVREFUSE)', async () => {
    const catalog = catalogWith({ extra: ['google/gemini-3.7-flash', 'openrouter/z-ai/glm-5.4'] });
    // openrouter pass: glm proposal → [2] choose another → type a google id (a real, gated catalog row, so only the sink can refuse it) → refused → [3] skip; google pass: gemini has a newer sibling → [3] skip
    h = harness({ catalog, answers: ['2', 'google/gemini-3.7-flash', '3', '3'] });
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain("could not write: curated-pins.json: 'google/gemini-3.7-flash' is not in the openrouter/ namespace");
    expect(h.read()).toEqual(pinsModule().loadCuratedPins());
    expect(h.log).not.toContain('SAVE');
  });

  test('a failed write keeps the in-memory document unchanged, so a later accept does not carry it (mutant SAVEFIRST)', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'openrouter/x-ai/grok-4.4'] });
    h = harness({ catalog, answers: ['1', '3', '1', ''] }); // glm (file order: before grok) accept → write FAILS → menu again → skip; grok accept (write ok); ruling enter
    const realSave = h.deps.saveCuratedPins;
    let first = true;
    h.deps.saveCuratedPins = (d) => { if (first) { first = false; throw new Error('EACCES: disk says no'); } realSave(d); };
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('could not write: EACCES: disk says no');
    const doc = h.read();
    expect(doc.pins.grok.routes.openrouter).toBe('openrouter/x-ai/grok-4.4');
    expect(doc.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.3'); // the failed accept never reached disk through the later save
  });

  test('Ctrl-C mid-walk: tally, exit 1, no ruling prompts, summary still prints', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4', 'openrouter/x-ai/grok-4.4'] });
    h = harness({ catalog });
    h.deps.ask = (() => { const q = ['1']; return async () => { if (q.length) { return q.shift(); } throw aborted(); }; })(); // glm accepted, then Ctrl-C on grok's menu
    expect(await runOwnerReview({}, h.deps)).toBe(1);
    expect(h.out()).toContain('review interrupted — 1 accepted, 0 skipped, 0 dismissed so far');
    expect(h.out()).not.toContain('rulings — a sentence on WHY');
    expect(h.out()).toContain('1 pin changed — review with: git diff');
    expect(h.read().pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.4');
  });

  test('the routes-disagree summary names a non-divergent pair the session left inconsistent', async () => {
    const catalog = catalogWith({ extra: ['openrouter/google/gemini-3.7-flash'] }); // no google/gemini-3.7-flash row, so the google pass has nothing newer
    h = harness({ catalog, answers: ['1', ''] }); // openrouter pass: gemini → accept 3.7; google pass: nothing; ruling enter
    expect(await runOwnerReview({}, h.deps)).toBe(0);
    expect(h.out()).toContain('⚠ gemini: google route google/gemini-3.6-flash ≠ google/gemini-3.7-flash derived from its openrouter route — reconcile by hand in src/utils/curated-pins.json');
  });

  test('never offers follow, never unpins: a shipped pin equal to nothing — the engine sees custom rows only', async () => {
    const catalog = catalogWith({ extra: ['openrouter/z-ai/glm-5.4'] });
    h = harness({ catalog, answers: ['3'] });
    await runOwnerReview({}, h.deps);
    expect(h.out()).not.toContain('follow the shipped pin');
    expect(h.out()).not.toMatch(/^\s+shipped\s/m);
  });
});

describe('handleAliases dispatch', () => {
  test('--owner without --review is an argument error (exit 1) and never loads owner mode', async () => {
    jest.resetModules();
    const { handleAliases } = require('../../src/sidecar/aliases');
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await handleAliases({ _: ['aliases'], owner: true })).toBe(1);
    expect(err.mock.calls.map(c => c[0]).join('')).toContain('--owner requires --review');
    err.mockRestore();
  });
  test('--review --owner --json is still the --review argument error', async () => {
    jest.resetModules();
    const { handleAliases } = require('../../src/sidecar/aliases');
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await handleAliases({ _: ['aliases'], review: true, owner: true, json: true })).toBe(1);
    expect(err.mock.calls.map(c => c[0]).join('')).toContain('--review is interactive');
    err.mockRestore();
  });
});
```

Add to `tests/sidecar/aliases-review.test.js` (inside the existing describe that uses `makeDeps`; `glm` is the fixture defined there):

```js
  test('a proposal without a dismissKey offers no "never ask again" (owner mode, #238 Phase 2; mutant NODISMISS)', async () => {
    // `models` non-empty, or runReview refuses with "no catalog" before any menu renders
    const t = makeDeps({ proposals: [{ ...glm, dismissKey: null }], answers: ['4'], models: [{ id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }] }); // [1] accept [2] follow [3] choose another [4] skip
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).not.toContain('never ask again');
    expect(t.out()).toContain('[4] skip');
    expect(t.out()).not.toContain('[5]');
  });
```

Add to `tests/cli.test.js` beside the `models command` describe:

```js
  describe('aliases command', () => {
    test('--owner is a boolean flag alongside --review, positionals intact', () => {
      const args = parseArgs(['aliases', '--review', '--owner']);
      expect(args.owner).toBe(true);
      expect(args.review).toBe(true);
      expect(args._).toEqual(['aliases']);
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/sidecar/aliases-owner.test.js tests/sidecar/aliases-review.test.js tests/cli.test.js`
Expected: aliases-owner FAILS (`Cannot find module`); the review test FAILS (`never ask again` still rendered); the cli test FAILS (`args.owner` is `'--review'`-order dependent or undefined — parseArgs treats an unlisted `--owner` as taking a value when one follows).

- [ ] **Step 3: Write `src/sidecar/aliases-owner.js`**

```js
/**
 * @module sidecar/aliases-owner
 * `amicus aliases --review --owner` (#238 D3/D4/D8): the SAME picker as
 * `--review` (aliases-review.js :: runReview, unchanged), pointed at the
 * shipped pin set in src/utils/curated-pins.json instead of the user's
 * config. The owner's baseline reset (D3) is this command's first real job.
 *
 * Rows are ROUTES, not aliases (plan ruling R-P2-1): every pin's every route
 * is judged in its own gateway namespace — `openrouter/google/gemini-…`
 * against the openrouter rows, `google/gemini-…` against the google rows —
 * because model-id-siblings.js keys a sibling's vendor as everything before
 * the last `/` and alias-proposals.js gates on the id's provider, so the §5
 * gate (a rejected or unkeyed namespace) applies per route and a sibling is
 * only ever offered from the namespace the route lives in. One `runReview`
 * pass per namespace (openrouter first, then each direct namespace in file
 * order), each headed by its coverage: a namespace with no authoritative row
 * in the catalog (no key) or listed in `providerFailures` is announced and
 * NOT reviewed, never reported "up to date". Within a pass every row is a
 * custom pin to the engine (`defaults` is empty): no `follow` (the shipped set
 * has nothing to follow), no `never ask again` (a dismissal is user state and
 * the shipped set carries none — `dismissKey` is nulled and the menu omits the
 * item; a declined sibling is proposed again next session; R-P2-2), no
 * notable (that list is for users to map).
 *
 * Gate (D8): the package root must BE a git work-tree root — `git rev-parse
 * --show-prefix` prints nothing (scripts/setup-hooks.js's guard, whose comment
 * explains why comparing `--show-toplevel` path strings breaks on Windows) —
 * `git status --porcelain --untracked-files=no` prints nothing (an untracked
 * scratch dir never reaches `git diff`, the review surface, so it does not
 * block; R-P2-4), and stdin is a TTY. Refused = one stderr line, exit 1,
 * nothing read or written.
 *
 * Sink: an accepted id replaces the route under review — `setPinRoute` with
 * the PASS's namespace, so an id typed from another namespace is refused and
 * lands as the picker's own `could not write: …` line (R-P2-5) — and stamps
 * `verifiedOn` with today's UTC date (R-P2-12); the document is validated and
 * written atomically BEFORE the picker prints its ✓, so the ✓ is never a lie,
 * and only a SUCCESSFUL write replaces the in-memory document. After the last
 * pass each touched pin is prompted for an optional ruling (enter keeps the
 * current text; R-P2-9); then `routeDisagreements` names every non-divergent
 * pin whose direct route no longer equals the derived form of its openrouter
 * route, so the owner reconciles by hand before committing (R-P2-10). A
 * Ctrl-C/EOF skips the rulings (the prompt is closed); the summary still
 * prints. Nothing here spends: the one catalog refresh is the same keyed
 * model-list call the user picker makes (§5 write gate).
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { DIVERGENT_VENDORS, stripGatewayPrefix } = require('../utils/curated-models');
const { loadCuratedPins, saveCuratedPins, setPinRoute, setPinRuling } = require('../utils/curated-pins');
const { refreshingCatalogLine } = require('./aliases-review-render');
const { collapseExcerpt } = require('../utils/text-sanitize');

const PKG_ROOT = path.resolve(__dirname, '..', '..');
const DATA_FILE = 'src/utils/curated-pins.json';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const providerOf = (id) => (typeof id === 'string' ? id.split('/')[0] : '');

/** @returns {object} real collaborators; every one can be overridden through `deps` (tests inject git, the TTY, the prompt, today and the file) */
function defaultDeps() {
  const base = require('./aliases').loadDeps();
  return {
    ...base,
    isTTY: !!process.stdin.isTTY,
    write: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    // stderr ignored: the gate prints its own reason, git's "fatal: …" would double it
    git: (args) => execFileSync('git', args, { cwd: PKG_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    loadCuratedPins,
    saveCuratedPins,
    today: () => new Date().toISOString().slice(0, 10),
    now: () => Date.now(),
    runReview: (args, d) => require('./aliases-review').runReview(args, d),
    createPrompt: () => require('./aliases-review-prompt').createPrompt(),
  };
}

/**
 * @param {{isTTY: boolean, git: (args: string[]) => string}} d
 * @returns {string|null} the refusal reason, or null when owner mode may run
 */
function ownerGate(d) {
  if (!d.isTTY) { return 'aliases --review --owner is interactive: run it in a terminal'; }
  let prefix;
  try { prefix = d.git(['rev-parse', '--show-prefix']); }
  catch { return `owner mode needs the amicus source checkout (${PKG_ROOT} is not inside a git work tree)`; }
  // Mutant GATEPREFIX: drop this check and an npm-installed copy inside a
  // consumer's repo passes (setup-hooks.js documents that exact trap).
  if (prefix !== '') { return `owner mode needs the amicus source checkout, not an installed copy (${PKG_ROOT} sits ${prefix} below its repository root)`; }
  let status;
  try { status = d.git(['status', '--porcelain', '--untracked-files=no']); }
  catch (err) { return `owner mode could not read the working tree (${collapseExcerpt(err.message)})`; }
  // Mutant DIRTYTREE: drop this check and `git diff` stops being a clean review surface.
  if (status !== '') { return `owner mode needs a clean working tree — commit or stash first (git status shows ${status.split('\n').length} changed file(s))`; }
  return null;
}

/**
 * @param {object} pins `loadCuratedPins().pins`
 * @returns {Object<string, Object<string,string>>} provider → { alias → id }, both null-prototype; providers in
 *   first-seen order walking the pins in file order (every pin has an openrouter route, so openrouter is first)
 */
function routesByProvider(pins) {
  const out = { __proto__: null };
  for (const alias of Object.keys(pins)) {
    for (const [provider, id] of Object.entries(pins[alias].routes)) {
      if (!own(out, provider)) { out[provider] = { __proto__: null }; }
      out[provider][alias] = id;
    }
  }
  return out;
}

/**
 * @param {object} pins
 * @returns {string[]} one line per NON-divergent pin whose authored direct route differs from the derived form
 *   of its openrouter route (`stripGatewayPrefix`) — such a pair routes different models depending on which key
 *   a user holds. Divergent vendors (anthropic) author both forms by ruling and are never compared.
 */
function routeDisagreements(pins) {
  const lines = [];
  for (const alias of Object.keys(pins)) {
    const routes = pins[alias].routes;
    const derived = stripGatewayPrefix(routes.openrouter);
    for (const [provider, id] of Object.entries(routes)) {
      if (provider === 'openrouter' || DIVERGENT_VENDORS.has(provider)) { continue; }
      if (id !== derived) { lines.push(`  ⚠ ${alias}: ${provider} route ${id} ≠ ${derived} derived from its openrouter route — reconcile by hand in ${DATA_FILE}`); }
    }
  }
  return lines;
}

/** @returns {string|null} why this namespace cannot be reviewed against this catalog (§5 rules 1–2), or null */
function namespaceGap(provider, catalogInfo) {
  const failures = Array.isArray(catalogInfo.providerFailures) ? catalogInfo.providerFailures : [];
  if (failures.some(f => f && f.provider === provider)) { return 'provider fetch failed this run'; }
  const models = Array.isArray(catalogInfo.models) ? catalogInfo.models : [];
  const covered = models.some(m => m && typeof m.id === 'string' && m.authoritative !== false && providerOf(m.id) === provider);
  return covered ? null : 'no authoritative rows in the catalog (no key?)';
}

/** The picker's view for ONE namespace: every route in `map` is a custom pinned row; proposals carry no dismissKey. */
function ownerView(map, catalogInfo, doc, d) {
  const rows = Object.keys(map).map(alias => ({ alias, id: map[alias], state: 'pinned', curated: false, shipped: null }));
  const proposals = d.buildAliasProposals({ userAliases: map, defaults: { __proto__: null }, catalogInfo, retired: doc.retired, notable: [], dismissed: {} })
    .map(p => ({ ...p, dismissKey: null }));
  return { rows, proposals, catalogInfo, catalogAvailable: true };
}

/** After the walk: one optional ruling per touched pin; enter keeps the current text; each answer is written at once. */
async function askRulings(state, ask, d) {
  if (state.touched.size === 0) { return; }
  d.write('  rulings — a sentence on WHY, stored beside the pin (enter keeps the current text):\n');
  for (const alias of state.touched) {
    const pin = state.doc.pins[alias];
    d.write(`  ${alias} → ${Object.values(pin.routes).join(', ')}\n    current: ${pin.ruling || '(none)'}\n`);
    const ans = String((await ask('    ruling: ')) || '').trim();
    if (!ans) { continue; }
    try {
      const next = setPinRuling(state.doc, alias, ans);
      d.saveCuratedPins(next);
      state.doc = next;
    } catch (err) { d.write(`    could not write: ${collapseExcerpt(err.message)}\n`); }
  }
}

/** @returns {object} the deps one namespace pass hands to runReview: the owner view and the owner sink */
function passDeps(provider, map, catalogInfo, state, ask, d) {
  return {
    ...d, ask, isTTY: true,
    collectAliasView: async () => ownerView(map, catalogInfo, state.doc, d),
    renderAliasList: () => '',
    addAlias: (alias, id) => {
      // Mutant PROVREFUSE: pass providerOf(id) here and a typed id from another
      // namespace rewrites THAT route instead of being refused.
      const next = setPinRoute(state.doc, alias, provider, id, d.today());
      d.saveCuratedPins(next);        // Mutant SAVEFIRST: assign state.doc before this line
      state.doc = next;
      state.touched.add(alias);
    },
    removeAlias: () => { throw new Error('owner mode never unpins — the shipped set has nothing to follow'); },
    recordDismissal: () => { throw new Error('owner mode has no dismissals'); },
    effectiveAliasNames: () => new Set(Object.keys(state.doc.pins)),
  };
}

/**
 * @param {object} args parsed CLI args (the --json/--quiet and --owner-without---review argument errors are aliases.js's)
 * @param {object} [deps] overrides merged onto `defaultDeps()`
 * @returns {Promise<number>} 1 when refused by the gate, the catalog is unavailable, or the review was interrupted; else 0
 */
async function runOwnerReview(args, deps) {
  const d = { ...defaultDeps(), ...(deps || {}) };
  const refusal = ownerGate(d);
  if (refusal) { d.stderr(`Error: ${refusal}\n`); return 1; }
  const state = { doc: d.loadCuratedPins(), touched: new Set() };
  const groups = routesByProvider(state.doc.pins);
  const routeCount = Object.values(groups).reduce((n, g) => n + Object.keys(g).length, 0);
  d.write(`  owner mode — reviewing the shipped pins in ${DATA_FILE} (${Object.keys(state.doc.pins).length} pins, ${routeCount} routes)\n`);
  if (typeof d.readCache === 'function') {
    try { const line = refreshingCatalogLine(d.readCache(), d.now()); if (line) { d.write(line); } } catch { /* banner only */ }
  }
  const catalogInfo = await d.getCatalogInfo({}); // the §5 write gate's refresh, once, shared by every pass
  if (!Array.isArray(catalogInfo.models) || catalogInfo.models.length === 0) {
    d.write('  no catalog — cannot review; run amicus models --refresh\n');
    return 1;
  }
  const prompt = d.ask ? null : d.createPrompt();
  const ask = d.ask || prompt.ask;
  let interrupted = false;
  try {
    for (const provider of Object.keys(groups)) {
      const n = Object.keys(groups[provider]).length;
      const gap = namespaceGap(provider, catalogInfo);
      if (gap) { d.write(`  ${provider} routes (${n}): ${gap} — not reviewed\n`); continue; }
      d.write(`  ${provider} routes (${n}):\n`);
      if (await d.runReview(args, passDeps(provider, groups[provider], catalogInfo, state, ask, d)) !== 0) { interrupted = true; break; }
    }
    if (!interrupted) { await askRulings(state, ask, d); }
  } catch (err) {
    if (!err || err.code !== 'REVIEW_ABORTED') { throw err; }
    d.write('  rulings interrupted — edit them by hand\n');
    interrupted = true;
  } finally {
    if (prompt) { prompt.close(); }
  }
  for (const line of routeDisagreements(state.doc.pins)) { d.write(line + '\n'); }
  const k = state.touched.size;
  d.write(k === 0
    ? `  no pin changed — ${DATA_FILE} is untouched\n`
    : `  ${k} pin${k === 1 ? '' : 's'} changed — review with: git diff ${DATA_FILE}   (nothing ships until you commit)\n`);
  return interrupted ? 1 : 0;
}

module.exports = { runOwnerReview, ownerGate, routesByProvider, routeDisagreements };
```

Budget: ≤ 230 lines. If over, shorten the docblock — never drop a check.

- [ ] **Step 4: The render, dispatch and flag edits**

`src/sidecar/aliases-review-render.js :: menuFor` — replace the unconditional dismiss push:

```js
  items.push({ label: 'skip', action: 'skip' });
  // #238 Phase 2 (owner mode): a proposal with no dismissKey cannot be
  // dismissed -- the shipped pin set carries no dismissal state -- so the item
  // is not offered rather than offered and refused. Mutant NODISMISS: push it
  // unconditionally.
  if (p.dismissKey) { items.push({ label: 'never ask again', action: 'dismiss' }); }
  return items;
```

`src/sidecar/aliases.js :: handleAliases` — insert as the FIRST check and change the `--review` dispatch:

```js
  if (args.owner && !args.review) {
    process.stderr.write('Error: --owner requires --review (amicus aliases --review --owner)\n');
    return 1;
  }
  // … existing --review + --json/--quiet check, existing --unpin block …
  if (args.review) {
    return args.owner
      ? require('./aliases-owner').runOwnerReview(args)
      : require('./aliases-review').runReview(args);
  }
```

Add one line to the module docblock's command list: `amicus aliases --review --owner   maintainers: the same picker over the SHIPPED pins (aliases-owner.js)`.

`src/cli.js`: after the `'review', // aliases: …` entry in `BOOLEAN_FLAGS` add `'owner',                 // aliases --review: the shipped-pin sink (#238 D8, maintainers)`; in the `aliases` help block add after `--review`'s lines:

```
  --owner                      With --review: the same picker over the SHIPPED pins
                               (src/utils/curated-pins.json). Maintainers only — needs
                               the amicus source checkout, a clean tree and a terminal.
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/sidecar/aliases-owner.test.js tests/sidecar/aliases-review.test.js tests/sidecar/aliases-review-e2e.test.js tests/sidecar/aliases-command.test.js tests/cli.test.js tests/docs-command-coverage.test.js tests/utils/known-flags.test.js` (skip a file that does not exist, but `ls tests/utils/ | grep known` first)
Expected: PASS. Then `node scripts/check-file-sizes.js --all` clean; `wc -l src/sidecar/aliases-owner.js src/sidecar/aliases.js src/sidecar/aliases-review-render.js` reported.

- [ ] **Step 6: Commit, then measure the five mutants (restore after each; record RED sets in the test header)**

```bash
git add src/sidecar/aliases-owner.js src/sidecar/aliases-review-render.js src/sidecar/aliases.js src/cli.js tests/sidecar/aliases-owner.test.js tests/sidecar/aliases-review.test.js tests/cli.test.js
git commit -m "feat(aliases): --review --owner — the shipped pins through the same picker, one pass per namespace (#238 D3/D4/D8)

Gate = source checkout (git rev-parse --show-prefix empty, the setup-hooks
guard) + clean tree (--untracked-files=no) + TTY. Every route is reviewed in
its own namespace; accept writes that route atomically and stamps verifiedOn
before the ✓; rulings are prompted after the walk; a routes-disagree summary
closes it. No follow, no dismiss, no notable in owner mode.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Mutants: `GATEPREFIX`, `DIRTYTREE`, `PROVREFUSE`, `SAVEFIRST` (edit sites are marked in the source), `NODISMISS` (render). Each: apply, run `npx jest tests/sidecar/aliases-owner.test.js tests/sidecar/aliases-review.test.js`, confirm the named test is RED, `git checkout -- <file>`.

---

### Task 4: The user surface — retired pins, `notable` wiring, `--json`, honest "Nothing to review"

**Files:**
- Create: `src/sidecar/aliases-unpin.js` (`handleUnpin` moved verbatim from `aliases.js:197-253`)
- Modify: `src/sidecar/aliases.js` (`loadDeps`, `collectAliasView`, `renderAliasList` + new `retiredNote`, `buildAliasesDoc`, remove `handleUnpin`, require it from the new module), `src/sidecar/aliases-review.js` (the "Nothing to review" line; `isFresh` removed and imported), `src/sidecar/aliases-review-gate.js` (gains `isFresh`)
- Test: `tests/sidecar/aliases-command.test.js` (extend), `tests/sidecar/aliases-review.test.js` (extend)

**Interfaces:**
- Consumes: `curated-pins.js :: loadCuratedPins()` (T1) — `retired` and `notable`.
- Produces: `collectAliasView(opts, d) → Promise<{rows, proposals, catalogInfo, catalogAvailable, retired}>` (`retired` is the file's map, added); `buildAliasesDoc(view)` gains `retired: view.retired` (additive within `SCHEMA_VERSION`); `renderAliasList(view, groupAliases?)` unchanged signature; `aliases-review-gate.js :: isFresh(fetchedAt, now) → boolean` (moved, same body); `aliases-unpin.js :: handleUnpin(rawName) → number` (same body). `loadDeps()` gains `loadCuratedPins`. T3 builds on this `aliases.js`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sidecar/aliases-command.test.js`, inside the existing `describe` (it already has `cfg`, `handleAliases`, `captureStdout`, `CATALOG`, and a `beforeEach` with `jest.resetModules()`; add the curated-pins mock helper at the top of the file):

```js
/** Mock the shipped pin file with extra `retired`/`notable` entries; must run BEFORE `require('../../src/sidecar/aliases')` in a test. */
function mockPins({ retired = {}, notable = [] } = {}) {
  const real = jest.requireActual('../../src/utils/curated-pins');
  jest.doMock('../../src/utils/curated-pins', () => ({
    ...real,
    loadCuratedPins: () => { const d = real.loadCuratedPins(); return { ...d, retired: { ...d.retired, ...retired }, notable: [...d.notable, ...notable] }; },
  }));
}
```

plus, in the describe's existing `afterEach`, `jest.dontMock('../../src/utils/curated-pins');` — `jest.doMock` registrations survive the `beforeEach`'s `jest.resetModules()`, so without it the test that follows a `mockPins(...)` test would still see the mocked file (the "shipped file today" test below would then fail for the wrong reason). And these tests:

```js
  test('a pin naming a RETIRED alias is flagged with the date and the ruling on a continuation line, and gets no proposal (#238 D8; mutant RETIREDFLAG)', async () => {
    mockPins({ retired: { devstral: { on: '2026-08-04', ruling: 'OpenRouter delisted the whole devstral family.' } } });
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: { devstral: 'openrouter/mistralai/devstral-medium' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/devstral\s+→\s+openrouter\/mistralai\/devstral-medium\s+pinned\s+⚠ retired 2026-08-04\n\s+↳ OpenRouter delisted the whole devstral family\./);
    expect(out).toContain('nothing to review');
  });
  test('--json carries `retired` and a retired pin still appears as a plain pinned row', async () => {
    mockPins({ retired: { devstral: { on: '2026-08-04', ruling: 'delisted' } } });
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: { devstral: 'openrouter/mistralai/devstral-medium' } });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    const doc = JSON.parse(out);
    expect(doc.retired.devstral).toEqual({ on: '2026-08-04', ruling: 'delisted' });
    expect(doc.aliases.find(r => r.alias === 'devstral').state).toBe('pinned');
    expect(doc.proposals.find(p => p.alias === 'devstral')).toBeUndefined();
  });
  test('a notable entry in the shipped file surfaces as an unmapped proposal end-to-end (R-P2-8)', async () => {
    mockPins({ notable: [{ id: 'openrouter/z-ai/glm-5.4', suggestedAlias: 'glm-next', note: 'next glm' }] });
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: {} });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    const doc = JSON.parse(out);
    const p = doc.proposals.find(x => x.alias === 'glm-next');
    expect(p).toEqual(expect.objectContaining({ state: 'unmapped', reasons: ['notable-unmapped'] }));
    expect(p.candidates[0]).toEqual({ id: 'openrouter/z-ai/glm-5.4', why: 'notable', evidence: { note: 'next glm' } });
  });
  test('the shipped file today has no notable entry and only devstral retired, so nothing above changes the default listing', async () => {
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: {} });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    const doc = JSON.parse(out);
    expect(Object.keys(doc.retired)).toEqual(['devstral']);
    expect(doc.proposals).toEqual([]);
  });
  test('--unpin still works after the move to aliases-unpin.js (the whole existing --unpin block below is the regression net)', async () => {
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.2' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'glm' }));
    expect(code).toBe(0);
    expect(out).toContain('glm now follows the shipped recommendation');
  });
```

Append to `tests/sidecar/aliases-review.test.js`:

```js
  test('"Nothing to review" names pins that name a RETIRED alias instead of calling them up to date (R-P2-11), and pluralizes 1 alias', async () => {
    const rows = [{ alias: 'devstral', id: 'openrouter/mistralai/devstral-medium', state: 'pinned', curated: false, shipped: null }];
    const t = makeDeps({ proposals: [], rows, models: [{ id: 'openrouter/z-ai/glm-5.3' }] });
    t.deps.collectAliasView = async () => ({ rows, proposals: [], catalogInfo: { models: [{ id: 'x/y' }], fetchedAt: Date.now(), providerFailures: [] }, catalogAvailable: true, retired: { devstral: { on: '2026-08-04', ruling: 'gone' } } });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('Nothing to review — 1 alias; 1 pin names a retired alias (see amicus aliases), the rest follow or are up to date.');
  });
  test('"Nothing to review" without retired pins keeps the old sentence', async () => {
    const rows = [{ alias: 'gemini', id: 'google/gemini-3.6-flash', state: 'following', curated: true, shipped: 'google/gemini-3.6-flash' }, { alias: 'glm', id: 'openrouter/z-ai/glm-5.3', state: 'following', curated: true, shipped: 'openrouter/z-ai/glm-5.3' }];
    const t = makeDeps({ proposals: [], rows, models: [{ id: 'openrouter/z-ai/glm-5.3' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('Nothing to review — 2 aliases, all following or up to date.');
  });
```

- [ ] **Step 2: Run to verify they fail** — `npx jest tests/sidecar/aliases-command.test.js tests/sidecar/aliases-review.test.js` → the five new command tests and the two review tests FAIL (no flag, no `retired` in the doc, no notable proposal, old sentence).

- [ ] **Step 3: Move `handleUnpin`**

Create `src/sidecar/aliases-unpin.js` with this header, then the `handleUnpin` docblock + function copied VERBATIM from `aliases.js` (current lines 197–253), then `module.exports = { handleUnpin };`:

```js
/**
 * @module sidecar/aliases-unpin
 * `amicus aliases --unpin <name>` (#238 F6, R1) — moved verbatim out of
 * aliases.js in Phase 2 to keep that module under the 300-line gate once the
 * retired-pin flag and the `--owner` dispatch landed. Behaviour and messages
 * are unchanged; tests/sidecar/aliases-command.test.js's --unpin block is the
 * regression net. Requires `safeFragment`/`collapseExcerpt` from
 * utils/text-sanitize.js exactly as the original did.
 */

'use strict';

const { safeFragment, collapseExcerpt } = require('../utils/text-sanitize');
```

In `aliases.js`: delete lines 197–253, and in `handleAliases` replace `return handleUnpin(args.unpin);` with `return require('./aliases-unpin').handleUnpin(args.unpin);` (lazy, same comment). Remove `handleUnpin`'s two sentences from the module docblock's C4 paragraph or reword to "…and `aliases-unpin.js`'s messages…".

- [ ] **Step 4: Wire `retired`/`notable`, the flag, the doc field**

`loadDeps()` gains `loadCuratedPins: require('../utils/curated-pins').loadCuratedPins,`.

`collectAliasView`: after `const defaults = …`, add `const { retired, notable } = d.loadCuratedPins();`; change the engine call to `d.buildAliasProposals({ userAliases, defaults, catalogInfo, retired, notable, dismissed: d.readDismissals() })`; return `{ rows, proposals, catalogInfo, catalogAvailable: …, retired }`.

Add above `renderAliasList`:

```js
/**
 * #238 D8: a PINNED row whose name is in the shipped `retired` map gets no
 * proposal at all (alias-proposals.js suppresses retired names before judging
 * them), so without this note a dead pin would render as a plain custom pin
 * with no warning — worse than the `⚠ gone from catalog` any other stale pin
 * gets. The date rides the row; the ruling follows on a continuation line.
 * Provenance (#249 r2 C4 rule): `retired` is the shipped data file authored
 * by the owner — house bytes, not third-party, so it is printed as-is.
 * Mutant RETIREDFLAG: return '' unconditionally.
 * @returns {{flag: string, ruling: string|null}} the row suffix and the ruling line, or empties
 */
function retiredNote(r, retired) {
  if (!retired || !r || r.state !== 'pinned' || !Object.prototype.hasOwnProperty.call(retired, r.alias)) { return { flag: '', ruling: null }; }
  return { flag: `   ⚠ retired ${retired[r.alias].on}`, ruling: retired[r.alias].ruling };
}
```

In `renderAliasList`'s row loop:

```js
      const r = byAlias.get(key);
      const p = proposalByAlias.get(key);
      const dead = p ? { flag: '', ruling: null } : retiredNote(r, view.retired);
      const flag = p ? rowFlag(p.reasons) : (dead.flag || sameGatewayNote(r));
      lines.push(`    ${safeFragment(key).padEnd(width)}  → ${safeFragment(r.id).padEnd(44)} ${r.state}${flag}`);
      if (dead.ruling) { lines.push(`    ${''.padEnd(width)}    ↳ ${dead.ruling}`); }
```

`buildAliasesDoc`: add `retired: view.retired || {},` after `proposals`.

- [ ] **Step 5: The picker line and the `isFresh` move**

In `aliases-review-gate.js`: add `const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');` if not already imported (check — `staleCatalogBanner` may already import it), then the `isFresh` docblock + function moved verbatim from `aliases-review.js:65-73`, and add `isFresh` to its export list (5 exports). In `aliases-review.js`: delete lines 65–73, add `isFresh` to the destructured import from `./aliases-review-gate`, drop the now-unused `DEFAULT_MAX_AGE_MS` import if nothing else in the file uses it (grep), and replace the "Nothing to review" block:

```js
    if (proposals.length === 0) {
      // R-P2-11: a pin that names a RETIRED alias gets no proposal (the engine
      // suppresses retired names), so "all up to date" would be false for it.
      const rows = Array.isArray(view.rows) ? view.rows : [];
      const dead = rows.filter(r => r && r.state === 'pinned' && view.retired && Object.prototype.hasOwnProperty.call(view.retired, r.alias)).length;
      const tail = dead
        ? `; ${dead} pin${dead === 1 ? '' : 's'} name${dead === 1 ? 's' : ''} a retired alias (see amicus aliases), the rest follow or are up to date.`
        : ', all following or up to date.';
      d.write(`  Nothing to review — ${rows.length} alias${rows.length === 1 ? '' : 'es'}${tail}\n`);
      return 0;
    }
```

- [ ] **Step 6: Run everything that touches these modules**

Run: `npx jest tests/sidecar/ tests/utils/alias-state.test.js tests/utils/alias-proposals.test.js` (adjust to the real file names under `tests/utils/` — `ls tests/utils | grep alias`)
Expected: PASS. `wc -l src/sidecar/aliases.js src/sidecar/aliases-unpin.js src/sidecar/aliases-review.js src/sidecar/aliases-review-gate.js` → all ≤ 300 (report). `node scripts/check-file-sizes.js --all` clean.

- [ ] **Step 7: Commit, then the mutant** — `RETIREDFLAG` (make `retiredNote` return the empty pair unconditionally) → the retired-flag test RED; restore.

```bash
git add src/sidecar/aliases.js src/sidecar/aliases-unpin.js src/sidecar/aliases-review.js src/sidecar/aliases-review-gate.js tests/sidecar/aliases-command.test.js tests/sidecar/aliases-review.test.js
git commit -m "feat(aliases): flag pins that name a retired alias; wire retired/notable from curated-pins.json; --json gains retired (#238 D7/D8)

The picker's 'Nothing to review' names retired pins instead of calling them
up to date and pluralizes correctly. handleUnpin moves verbatim to
aliases-unpin.js and isFresh to aliases-review-gate.js to hold the 300-line
gate; behaviour unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `models --check` — the Q7 newer-sibling line and the owner-mode hint

**Files:**
- Modify: `src/sidecar/models.js :: buildFallbackDriftReport` (+ three requires), `src/utils/model-id-siblings.js` (docblock lines 9–12 only)
- Test: `tests/models-drift.test.js` (extend)

**Interfaces:**
- Consumes: `alias-proposals.js :: gatedCatalogIds(catalogInfo) → string[]` (§5 rules 1–2), `model-id-siblings.js :: newestSibling(pinned, ids) → string|null`, `curated-pins.js :: loadCuratedPins()`, `curated-models.js :: getFamilies()` (already imported).
- Produces: `buildFallbackDriftReport(catalogOrInfo) → string[]` — the family lines now end `— amicus aliases --review --owner` (D4 table, `models.js:247` row); new lines of the form `  newer sibling: <alias> → <pinned openrouter route> (catalog: <newer id>) — amicus aliases --review --owner` for every NON-family pin with a strictly newer same-tier sibling among the gated ids; still `[]` for an empty catalog or a rejected openrouter namespace; never affects `runCheck`'s exit code (the lines are text-only, computed after the `--json` return, as today).

- [ ] **Step 1: Write the failing tests** — append to `tests/models-drift.test.js`:

```js
describe('buildFallbackDriftReport — #238 Q7 newer-sibling lines for cardless pins', () => {
  const { buildFallbackDriftReport } = require('../src/sidecar/models');
  const { loadCuratedPins } = require('../src/utils/curated-pins');
  const current = () => Object.values(loadCuratedPins().pins).map(p => row(p.routes.openrouter));
  test('a strictly newer same-tier sibling of a cardless pin is named with the owner-mode hint; the exit-code-free family line points there too', () => {
    const lines = buildFallbackDriftReport({ models: [...current(), row('openrouter/z-ai/glm-5.4'), row('openrouter/google/gemini-9.9-flash')], providerFailures: [] });
    expect(lines).toContain('  newer sibling: glm → openrouter/z-ai/glm-5.3 (catalog: openrouter/z-ai/glm-5.4) — amicus aliases --review --owner');
    expect(lines.find(l => l.includes('pinned fallback drift: gemini'))).toMatch(/— amicus aliases --review --owner$/);
    expect(lines.some(l => l.includes('update curated-models.js'))).toBe(false);
  });
  test('silent for the current pins alone, and a family is never given a sibling line (its idPattern rule speaks for it)', () => {
    expect(buildFallbackDriftReport({ models: current(), providerFailures: [] })).toEqual([]);
    const lines = buildFallbackDriftReport({ models: [...current(), row('openrouter/openai/gpt-5.7-terra')], providerFailures: [] });
    expect(lines.filter(l => l.startsWith('  newer sibling:'))).toEqual([]);
    expect(lines.some(l => l.includes('pinned fallback drift: gpt'))).toBe(true);
  });
  test('a sibling on a non-authoritative row, or in a rejected namespace, is never named (§5 rules 1–2; mutant SIBLINGGATE)', () => {
    const floor = { id: 'openrouter/z-ai/glm-5.4', authoritative: false };
    expect(buildFallbackDriftReport({ models: [...current(), floor], providerFailures: [] }).filter(l => l.includes('glm'))).toEqual([]);
    expect(buildFallbackDriftReport({ models: [...current(), row('openrouter/z-ai/glm-5.4')], providerFailures: [{ provider: 'openrouter', reason: 'http-status', status: 403 }] })).toEqual([]);
  });
  test('a different tier or a glued size token is not a sibling (the comparator rules are inherited, not re-implemented)', () => {
    // gpt-5.7-luna-pro: suffix -luna-pro ≠ gpt-pro's -sol-pro; kimi-k30b: `30` glued to `b` is never a version — both measured null on 2026-09-14.
    // (gpt-5.7-sol-pro WOULD be gpt-pro's sibling — measured — so it is deliberately not used here.)
    const lines = buildFallbackDriftReport({ models: [...current(), row('openrouter/openai/gpt-5.7-luna-pro'), row('openrouter/moonshotai/kimi-k30b')], providerFailures: [] });
    expect(lines.filter(l => l.startsWith('  newer sibling:'))).toEqual([]);
  });
  test('a bare models array (older callers) still works', () => {
    expect(buildFallbackDriftReport([...current(), row('openrouter/x-ai/grok-4.4')])).toContain('  newer sibling: grok → openrouter/x-ai/grok-4.3 (catalog: openrouter/x-ai/grok-4.4) — amicus aliases --review --owner');
  });
});
```

Also, in the existing test file, the `runCheck`-level exit-code invariant: find the existing test that asserts drift lines never change the exit code (`grep -n "exit" tests/models-drift.test.js tests/models-check*.test.js`); if none exists at the `handleModels` level, add one to `tests/models-drift.test.js` that mocks `../src/utils/model-catalog :: getCatalogInfo` to return `{ models: [...current(), row('openrouter/z-ai/glm-5.4')], fetchedAt: Date.now(), providerFailures: [] }` plus the hermetic empty config, calls `handleModels({ _: ['models'], check: true })` with stdout captured, and asserts exit `0` while stdout contains the `newer sibling: glm` line — and again with `strict: true` → still `0`.

- [ ] **Step 2: Run to verify they fail** — `npx jest tests/models-drift.test.js` → the new tests FAIL (no sibling lines; the old hint text present).

- [ ] **Step 3: Implement**

In `src/sidecar/models.js` add the requires beside line 20:

```js
const { gatedCatalogIds } = require('../utils/alias-proposals');
const { newestSibling } = require('../utils/model-id-siblings');
const { loadCuratedPins } = require('../utils/curated-pins');
```

Replace `buildFallbackDriftReport`'s docblock last sentences and body:

```js
/**
 * Non-blocking drift report: pinned family fallbacks vs live resolution, and
 * (#238 Q7) a newer same-tier sibling of each CARDLESS pin. Accepts a
 * catalogInfo (`{models, providerFailures}`) or a bare models array (older
 * callers). Empty catalog → [] (cannot check). #238 §5: when the openrouter
 * namespace itself was REJECTED this run, the catalog is missing the rows that
 * make a pin look current, and a drift line computed from it would propose a
 * downgrade — so the report is empty for that catalog. The sibling lines use
 * the §5-gated ids (authoritative rows, no rejected namespace) — the same gate
 * that keeps the picker from offering a floor row; mutant SIBLINGGATE feeds it
 * every catalog id instead. Never affects the exit code; every line points at
 * owner mode, the flow that moves a shipped pin.
 * @param {{models: Array<{id:string}>, providerFailures?: Array<{provider:string}>}|Array<{id:string}>} catalogOrInfo
 * @returns {string[]} human-readable warning lines
 */
function buildFallbackDriftReport(catalogOrInfo) {
  const info = Array.isArray(catalogOrInfo) ? { models: catalogOrInfo } : (catalogOrInfo || { models: [] });
  const catalog = info.models || [];
  if (catalog.length === 0) { return []; }
  const failures = Array.isArray(info.providerFailures) ? info.providerFailures : [];
  if (failures.some(f => f && f.provider === 'openrouter')) { return []; }
  const lines = [];
  const families = getFamilies();
  for (const f of families) {
    const live = pickCurrent(catalog, 'openrouter/', f.vendorPath, f.idPattern);
    if (live && f.fallback.openrouter && live !== f.fallback.openrouter) {
      lines.push(`  pinned fallback drift: ${f.alias} → ${f.fallback.openrouter} (live: ${live}) — amicus aliases --review --owner`);
    }
  }
  const familyAliases = new Set(families.map(f => f.alias));
  const gated = gatedCatalogIds(info);
  const { pins } = loadCuratedPins();
  for (const alias of Object.keys(pins)) {
    if (familyAliases.has(alias)) { continue; } // a family's idPattern rule speaks for it above
    const pinned = pins[alias].routes.openrouter;
    const newer = newestSibling(pinned, gated);
    if (newer) { lines.push(`  newer sibling: ${alias} → ${pinned} (catalog: ${newer}) — amicus aliases --review --owner`); }
  }
  return lines;
}
```

`src/utils/model-id-siblings.js` docblock: replace lines 9–12 ("`amicus models --check` asks a DIFFERENT question … previously implied otherwise).") with:

```
 * question the CI drift gate asks the CI alias map, and `amicus models
 * --check` (sidecar/models.js :: buildFallbackDriftReport, #238 Q7) asks it of
 * the shipped CARDLESS pins, informationally. Its stale audit is a different
 * question, still answered by `alias-audit.js :: findStaleAliases`.
```

(keep the sentence before it intact: "…so the alias review engine (alias-proposals.js) asks the user's pinned ids the SAME sibling").

- [ ] **Step 4: Run** — `npx jest tests/models-drift.test.js tests/utils/model-id-siblings.test.js tests/scripts/check-ci-alias-pins.test.js` and any `tests/models*.test.js` → PASS. `wc -l src/sidecar/models.js` ≤ 300 (report; if the gate trips, join the two-line `lines.push(` of the family line into one and shorten the docblock — never drop the guard).

- [ ] **Step 5: Commit, then mutant `SIBLINGGATE`** (`const gated = catalog.map(m => m && m.id).filter(Boolean);`) → the §5 test RED; restore.

```bash
git add src/sidecar/models.js src/utils/model-id-siblings.js tests/models-drift.test.js
git commit -m "feat(models): --check names a newer same-tier sibling of each cardless shipped pin; drift hints point at owner mode (#238 Q7, D4)

Informational only (exit code and --strict unchanged), over the §5-gated
ids. The comparator's docblock now says models --check consumes it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/usage.md` (the `### Aliases: following vs pinned` block and the `## amicus models` section), `README.md:422` (the `amicus aliases` Commands row), `CHANGELOG.md` (a new `## [Unreleased]` section above `## [4.10.0]`)

**Interfaces:** none. Gates: `npm run generate-docs:check`, `npm run validate-docs`, `npx jest tests/docs-command-coverage.test.js`.

- [ ] **Step 1: usage.md — aliases block.** Add to the command listing at `docs/usage.md:407-410`:

```
amicus aliases --review --owner   # maintainers: the same picker over the SHIPPED pins — writes src/utils/curated-pins.json
```

and after the `--unpin` paragraph (line ~417) add:

```
**Retired aliases.** A pin that names an alias the package has retired (`devstral`, dropped 2026-08-04 when OpenRouter delisted the family) is flagged `⚠ retired <date>` with the ruling on the next line, and nothing is proposed for it — no served model is its successor. Pick a replacement yourself (`amicus setup --add-alias`) or `--unpin` it. `--json` carries the `retired` map.

**Owner mode (`--review --owner`).** For maintainers of Amicus itself: the same picker walks the SHIPPED pins — every route of every pin, one pass per gateway namespace (`openrouter`, then `google`, `anthropic`, `deepseek`), judged against the live catalog you hold keys for; a namespace you have no key for is announced and skipped. Accepting writes that route into `src/utils/curated-pins.json` (validated, atomic, canonical format) and stamps `verifiedOn` with today's UTC date; after the walk you are asked for an optional one-line ruling per changed pin. There is no *follow* (the shipped set has nothing to follow) and no *never ask again* (the shipped set carries no dismissals). It refuses unless you run it from the amicus source checkout (not an installed copy), with a clean working tree, in a terminal — because `git diff src/utils/curated-pins.json` is the review surface, and nothing ships until you commit. The pins, the retired list and the notable list live in that JSON file; the match rules (`idPattern`, divergent vendors) stay in `src/utils/curated-models.js`.
```

- [ ] **Step 2: usage.md — models section.** After the `**Drifted aliases.**` paragraph (line ~419) add:

```
**Shipped-pin drift (informational).** `--check` also prints a `Pinned fallback drift:` block about the pins the PACKAGE ships: a family (`gemini`, `gpt`, …) whose pinned OpenRouter fallback is behind the catalog's current flagship, and a cardless pin (`glm`, `qwen`, `grok`, …) with a strictly newer same-tier sibling listed — `newer sibling: glm → openrouter/z-ai/glm-5.3 (catalog: openrouter/z-ai/glm-5.4)`. Both point at `amicus aliases --review --owner`, the maintainer flow that moves a shipped pin; neither changes the exit code, with or without `--strict`. The weekly `model-drift.yml` run shows them in its log.
```

- [ ] **Step 3: README row.** Replace `README.md:422` with:

```
| `amicus aliases` | Your model aliases — following / pinned; `--review` walks the update proposals, `--unpin <name>` removes a pin, `--json` for scripts; `--review --owner` (maintainers) reviews the shipped pins. |
```

- [ ] **Step 4: CHANGELOG.** Insert above `## [4.10.0] - 2026-09-14`:

```
## [Unreleased]

### Added

- **`amicus aliases --review --owner`** (maintainers) — the same picker over the SHIPPED pins:
  every route of every pin, one pass per gateway namespace, judged against the live catalog;
  accept writes `src/utils/curated-pins.json` (validated, atomic) and stamps `verifiedOn`; an
  optional ruling per changed pin is prompted after the walk; a routes-disagree summary closes
  it. Gated on the amicus source checkout + a clean working tree + a terminal, so `git diff` is
  the review surface and nothing ships until it is committed. No follow, no dismiss in owner
  mode. (#238 D3/D4/D8)
- **`amicus aliases`** flags a pin that names a RETIRED alias (`⚠ retired <date>`, ruling on the
  next line) instead of rendering it as a plain custom pin; `--json` carries `retired`; the
  picker's "Nothing to review" line counts such pins instead of calling them up to date. (#238 D8)
- **`amicus models --check`** prints an informational `newer sibling:` line for each cardless
  shipped pin with a strictly newer same-tier sibling in the catalog (over the §5-gated ids), and
  its shipped-pin drift hints now point at `amicus aliases --review --owner`. Exit code and
  `--strict` unchanged. The sibling comparator (`model-id-siblings.js`) is now consumed by the
  picker, the CI pin gate AND `models --check`. (#238 Q7)

### Changed

- The shipped pins, the retired list and the (empty) notable list moved from
  `src/utils/curated-models.js` into the data file `src/utils/curated-pins.json` (`pins` with
  per-gateway `routes` + `verifiedOn` + optional `ruling`/`gatewayOnly`; `retired`; `notable`).
  No behaviour change: every builder is byte-identical over the same data (frozen fixtures), and
  `curated-models.js` keeps the match rules. The `retired`/`notable` inputs the review engine
  already accepted are now supplied from the file. (#238 D8, Appendix A)
```

- [ ] **Step 5: Gates** — `npm run generate-docs:check`, `npm run validate-docs`, `npx jest tests/docs-command-coverage.test.js tests/docs*.test.js` → clean.

- [ ] **Step 6: Commit**

```bash
git add docs/usage.md README.md CHANGELOG.md
git commit -m "docs(aliases): --review --owner, retired pins, the models --check sibling line (#238 Phase 2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Integration, whole-branch review, PR body

**Files:** none new. Runs in the integration worktree after every wave is merged.

- [ ] **Step 1:** `npm run lint` · `node scripts/check-file-sizes.js --all` · `node scripts/check-citations.js --all` · `npm run generate-docs:check` · `npm run validate-docs` — all clean.
- [ ] **Step 2:** `npm test` → zero failures (report suites/tests/skipped totals; do not pre-write them). Then `npm run test:integration` (keyless) → zero failures.
- [ ] **Step 3:** A live, $0 smoke on the owner's machine from the integration worktree (clean tree): `node bin/amicus.js aliases --review --owner` piped through `echo | …` is NOT a TTY → expect the gate's `interactive` refusal, exit 1. Then in a real terminal: run it, `3` (skip) through every screen, confirm `git status --porcelain src/utils/curated-pins.json` is empty afterwards (no pin changed → untouched). Also `node bin/amicus.js aliases` and `node bin/amicus.js models --check` (exit code as before; the `Pinned fallback drift:` block now points at owner mode). Record the outputs in the report.
- [ ] **Step 4:** Dispatch the whole-branch review (most capable model) with `scripts/review-package PLAN_FILE <integration-base> HEAD`; one fix dispatch, one scoped re-review; adjudicate residuals in the ledger.
- [ ] **Step 5:** Write the PR body to `SecondBrain/output/2026-09-14-amicus-238-pr2-pr-body.md` in PR #249's shape: what changes for a user, what changes for the owner, the R-P2 rulings, named mutants (LOOPORDER, FAMILYPIN, CLONE, STAMP, PROVMATCH, GATEPREFIX, DIRTYTREE, PROVREFUSE, SAVEFIRST, NODISMISS, RETIREDFLAG, SIBLINGGATE), review history, gates on the final head, and the release-ritual note below. Open the PR with the `council-review` label (the publish gate: no release without a council-reviewed PR).

**Release-ritual note (for the PR body and the next cut):** Phase 2 adds no user-visible change until a pin moves; the ritual gains (a) `amicus aliases --review --owner` refusing outside the checkout / on a dirty tree / without a TTY, and (b) `models --check` showing the `newer sibling:` lines. **The D3 baseline session runs AFTER this PR merges**, on the owner's machine with real keys, from `main` with a clean tree: `node bin/amicus.js aliases --review --owner`, review every proposal, read `git diff src/utils/curated-pins.json`, delete the "live shipped file produces the same outputs as the fixture TODAY" test in `tests/curated-models-move.test.js` (it documents "no pin has moved yet" and is meant to die in that commit), and commit as `pins: D3 baseline — <summary> (YYYY-MM-DD)`. Whatever is accepted there is the new curated pin set the next release ships.

---

## Self-review (run against the spec before dispatch)

- **Spec coverage.** §7 Phase 2: `curated-pins.json` move (T1), owner mode (T3), `models --check` sibling line (T5), D3 session (post-merge note, T7). D8 field rules: `routes`, `verifiedOn` required (validator + test), `ruling` optional, `gatewayOnly`, `retired` (T1). Appendix A rows 1–17: every destination named in T1 Step 2/9. D4 hint row `models.js:247` (T5). §6.8 (T1 move test), §6.9 (T3: refuses outside a repo / dirty tree / non-TTY; writes valid JSON; stamps `verifiedOn`; round-trip through `curated-models.js` in T2's last test), §6.10 (T5: hints, sibling line, exit code unchanged, `--strict` unaffected). D8 "prompts for an optional ruling" (T3). D7 `retired` reaching the engine from the file (T4). §2 "WRITE SINKS never in the engine" — the engine is untouched.
- **Placeholder scan.** No TBDs; every code step carries the code; the one open instruction ("find the existing exit-code test or add one", T5 Step 1) names the exact assertion to add.
- **Type consistency.** `loadCuratedPins()` returns `{version, pins, retired, notable}` everywhere it is consumed (T3 `state.doc.pins`, `doc.retired`; T4 `const { retired, notable }`; T5 `const { pins }`). `setPinRoute(doc, alias, provider, id, today)` — T2 definition, T3 call `setPinRoute(state.doc, alias, provider, id, d.today())` ✓. `ownerGate(d)` reads `d.isTTY`, `d.git(args: string[])` ✓ tests pass arrays. `runReview(args, deps)` unchanged; T3 passes `ask`, so `runReview` creates no prompt and `prompt.close()` is the owner module's ✓. `collectAliasView` returns `retired`; `renderAliasList` reads `view.retired`; the review tests' `makeDeps` view has no `retired` and both `retiredNote` and the picker line guard on that ✓. `menuFor(p)` reads `p.dismissKey` — the owner view sets it to `null` ✓; user-mode proposals always carry a string ✓.
- **Measured facts carried with their tree:** line counts (`cd6b8cfb`), the fs-mock probe (`cd6b8cfb`, 22 suites, 1 red under `readFileSync`), the citation scan, `curated-models.js` unchanged since `b803a2a`. Anything a task changes is "re-measure after step N" (`wc -l` reports), never a pre-written number.
