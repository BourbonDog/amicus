# #238 PR 3 — Electron "Needs review" Section, `aliases --ui`, the Wizard's Live-Pick Announcement (Phase 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 3 of the #238 design on the Electron setup surface: the Model Routing step gains a "Needs review" section ABOVE the alias list (D9) that renders the review engine's proposals with accept / choose… / dismiss controls; every alias row shows following-vs-pinned and carries the right remove control (`unpin` on a curated pin, `×` on a custom alias — both remove the key, R1); `amicus aliases --ui` opens the setup window landing on that step (D4); and the Electron wizard stops silently re-pinning the default alias — it writes the chosen default's live pick only when the user actually chose it AND it differs from the shipped pin, announced on screen with both ids (Q9 / §6.5, deferred from Phase 1).

**Architecture:** One engine, two renderers (spec §2): the page fetches ONE document over a new IPC channel (`sidecar:get-alias-review`, `electron/ipc-aliases.js`) built from the same `collectAliasView` the CLI list and picker use — collected with `write: false`, because the wizard writes config from Finish only. Two new page-script modules render it and keep the rows truthful: `setup-ui-alias-state.js` (what a row means; what Finish writes) and `setup-ui-alias-review.js` (the section). Every action on the page is STAGED into the wizard's existing `aliasEdits` (string = set, `null` = remove the key) plus a `stagedDismissals` list; Finish hands both to the existing sink `sidecar:save-config` (gaining a 4th argument), which `saveConfig`-normalizes (D6). `--ui` is an env token (`AMICUS_SETUP_PANE=aliases`) from `setup-window.js` to `main.js` to `buildSetupHTML({ initialPane })`, which lands the wizard script on step 3.

**Tech Stack:** Node 22 CommonJS, Electron (main + preload allowlist + inline page script; no bundler, no jsdom — page logic is tested by extracting function source with the repo's `new Function` harness against a small fake DOM), Jest (`npm test`; single file `npx jest tests/<file>`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-14-238-alias-follow-pin-design.md` — D1 (unpin/delete = remove the key; label by curated-ness), D4 (`--ui`), D6 + Q9 (the wizard writes only what the user actively chose; the announcement), D9, §2 (sinks never in the engine), §4 "Electron — D9", §5 (display gate on candidates, write gate on accept), §6.5 and §6.11 (the Electron rows of the test plan), §7 Phase 3, §8 Q4 (accept writes the id; the encoding decides the state; `[⌄ choose]` on a curated proposal includes *follow*), §9 (the Electron live-pick announcement is Phase 3 work). Phases 1–2 shipped (PR #249 → v4.10.0; PR #250 + #252 + the D3 baseline `c8ff0150`, unreleased); this plan was written against `main` @ `c8ff0150` on 2026-09-15 and every code fact below was measured there.

## Global Constraints

- **300-line gate:** every file under `src/**/*.js` and `electron/**/*.js` stays ≤ 300 lines (`scripts/check-file-sizes.js`, blocks the commit). Measured on `c8ff0150`: `electron/ipc-setup.js` **290** (T1 adds ≤ 6 — no new paragraphs in its docblock), `electron/setup-ui-alias-script.js` **284** (T2 rewrites the remove handler and drops the add-flow's inner delete listener: must END ≤ 296), `electron/setup-ui-aliases.js` 89, `electron/setup-ui-model.js` 238, `electron/preload-setup.js` 41, `src/sidecar/aliases.js` **274** (T1 +2, T5 +12 → ≤ 290), `src/sidecar/setup-window.js` 91, `src/sidecar/aliases-review-gate.js` 76, `src/utils/alias-proposals.js` 151. **Excluded from the gate but not from the spec:** `electron/setup-ui.js` **808** ("grandfathered — do not grow", spec §3) — it must measure ≤ 808 at the whole-branch review; T2/T3/T5 add ≈ 14 lines between them and T4 pays for them by rewriting the two comment blocks (`collectAliasWrites`'s 35-line preamble, `buildReview`'s 25-line N1/N-b preamble) that describe the very rule T4 changes — compress, keep the rationale, never delete a still-true fact. `electron/main.js` (644) and `electron/setup-ui-styles.js` (473) are excluded and may take the small edits named here.
- **New module shape:** `@module` docblock FIRST, then `'use strict'`, ≤ 5 exports, JSDoc on every export. Page-script modules return ONE template string of browser JS (no `require`, no ES modules — the wizard page is a `data:` URL with an inline `<script>`; `var`, `function`, ES2018 at most, matching `setup-ui-alias-script.js`). All fragments are concatenated into ONE `<script>`, so function declarations hoist across modules and page-level `var`s (`aliasEdits`, `defaultAliases`, `$`, `window.availableModels`, `buildModelSelect`, `placeRowInNewRoutesGroup`, `refreshAliasCounts`, `applyCatalog`) are shared — a fragment may CALL a function another fragment declares, but must never redeclare one.
- **Issue tokens in `electron/**` comments:** write `issue 238` (Phase 1's spelling), not `#238`. MEASURED 2026-09-15: nothing enforces it (`#45`/`#49`/`#12` exist in `electron/main.js`, `ipc-setup.js`, `setup-ui.js`; no check in `.eslintrc.js`, `scripts/`, `tests/`) — it is a convention, so follow it and do not build a gate for it.
- **Rendering discipline (page):** data reaches the DOM through `createElement` + `textContent` + `setAttribute` only — never `innerHTML` with an alias, id, note or error message in it. Server-side builders escape every interpolation through the file's `esc`/`escapeAttr`. Selectors are never built by interpolating a name: find a row by attribute compare (`aliasRowFor`). The page carries NO routing policy (issue 214 guard in `tests/setup-ui.test.js`: no `directProviders`, no `toBareIfDirect`, no `slice('openrouter/'.length)`); `tests/setup-ui-aliases.test.js` also asserts `buildAliasScript()` contains no `openrouter/` literal — keep both true for the new fragments too.
- **IPC channels are literals:** `tests/electron/preload-allowlist.test.js` extracts every `invoke('…')` from the built page and requires each in `preload-setup.js`'s allowlist, and requires every `.invoke(` to be a literal. The new channel is `'sidecar:get-alias-review'`; `sidecar:save-config` and `sidecar:refresh-catalog` already exist.
- **No test welds to the LIVE shipped pins (failure mode #53).** Page harnesses inject `defaultAliases` as a synthetic map (`{ gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.3' }`); server builders take an injectable `defaults` option; the only permitted live read is `getDefaultAliases()` used at test time to DERIVE an expectation (`const shipped = getDefaultAliases().gemini`), never a hardcoded shipped id. The engine's proposal shape is the frozen contract in `src/utils/alias-proposals.js`'s docblock — tests build proposals by hand.
- **The wizard writes only from Finish.** Nothing in this PR writes config from an IPC read handler, a page init, or a click: `sidecar:get-alias-review` collects the view with `write: false`; accept/choose/follow/unpin/×/dismiss are STAGED; `sidecar:save-config` (4th argument `dismissals`) is the one sink. The single exception is the CLI entry `amicus aliases --ui`, which — like every `amicus aliases` form — normalizes the config on entry (D6) BEFORE the window opens.
- **Prototype safety:** every page table keyed by alias names is null-prototype (`Object.create(null)`, as `aliasEdits`/`defaultAliases` already are); curated-ness is `Object.prototype.hasOwnProperty.call(defaultAliases, alias)`; the IPC handler and `recordDismissals` iterate own keys / arrays only. The engine already gives `__proto__` no row (alias-state.js).
- **Hermeticity:** unit tests that touch config run under `tests/setup/hermetic-config-dir.js` (automatic via `jest.config.js`, per-worker scratch dir); no real network (mock `../src/utils/model-catalog` or inject `collectAliasView`); no real Electron (`jest.mock('electron', …, { virtual: true })` with an `ipcMain.handle` capture, the `tests/ipc-setup-save-config.test.js` pattern); no real window (`jest.doMock('../../src/sidecar/setup-window', …)`).
- **Test rails:** `npx jest tests/<file>` during a task, `npm test` at integration. NEVER run jest with `--testMatch`; never run `npm run test:integration:live` (spends money); `npm run test:integration` (keyless) only at integration time. `posttest` writes `.test-passed` keyed to HEAD; the pre-push hook re-runs the suite if it mismatches.
- **Citations:** `scripts/check-citations.js` runs in the pre-commit hook over staged files and everything citing them; prefer `file.js :: symbol` anchors; a `file.js:NNN` line citation must be in range at commit time.
- **Docs sync:** the pre-commit hook regenerates and auto-stages `docs/architecture-map.md`; let it. `CLAUDE.md` is not edited (no file added under `src/`, `bin/` or `scripts/`; the two new `electron/` modules and the test helper are outside the HARD RULE's scope; the hook only warns).
- **stdout discipline (CLI):** `amicus aliases --ui` prints its one success line on stdout, every error on stderr, and never combines with `--json`.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Worktrees:** each parallel task runs in its own linked worktree beside the repo (`C:\Users\sendt\code\amicus-238-t<N>`) on branch `feat/238-pr3-task-<N>` cut from the integration branch `feat/238-pr3-electron-review` (itself cut from `main` @ `c8ff0150`), with `node_modules` junctioned from the main clone (`cmd /c mklink /J node_modules C:\Users\sendt\code\amicus\node_modules`). Never place a worktree inside the repo (jest ignores any path containing `worktrees`). **Cleanup (PR #249/#250 lesson):** remove the junction FIRST with PowerShell `(Get-Item <dir>\node_modules -Force).Delete()` after checking `LinkType -eq 'Junction'`, then `rmdir` the empty dir — never recursive-delete through the junction.

---

## Rulings made in this plan (recorded so the spec stays the authority)

Each is a decision the spec did not settle; each names its cost if wrong. They belong in the PR body's "design decisions" section.

- **R-P3-1 — The wizard STAGES every review action; Finish writes them through the existing sink.** Accept / choose… / follow / `unpin` / `×` land in `aliasEdits` (string = set, `null` = remove the key — Q4's encoding: the shipped id folds to `null`); "never ask again" lands in a page-level `stagedDismissals` list handed to `sidecar:save-config` as a 4th argument, recorded after the alias writes through `alias-store.js :: recordDismissal`. The Review step (Step 4) lists all of it ("`glm → openrouter/z-ai/glm-5.4`", "`gemini → (now follows google/gemini-3.8-flash)`", "`1 proposal(s) dismissed`") — it is the wizard's only confirmation gate, so it must show everything Finish will write. The CLI picker writes per accept; the wizard's contract everywhere is "nothing until Finish", and mixing the two on one screen would be the confusing part. *Cost if wrong:* closing the window discards staged review work (the same as any other wizard edit).
- **R-P3-2 — Row state on the page: a curated alias FOLLOWS when its effective value equals the shipped id, PINNED otherwise; a custom alias is always pinned.** The CLI encodes state as key presence (`alias-state.js :: listAliasRows`); `saveConfig` removes every key equal to its shipped id (D6), so the two rules agree the moment a config is saved — and the wizard must label rows by what Finish will PRODUCE. Server builders derive it from the effective map + `getDefaultAliases()` (no new `main.js` seam); the page re-derives it after every edit with the same rule. `aliases --ui` normalizes on entry, so a CLI-launched window sees a normalized file. *Cost if wrong:* an un-normalized config whose seeded key equals the shipped id reads "following" one save early — which is exactly what it resolves to.
- **R-P3-3 — `aliases --ui` opens the SAME setup window, landing on the Routing step; the stepper stays.** "Open JUST the alias pane" (D4) is satisfied by landing there; a pane-only window (no progress bar, no Keys/Models steps) needs its own Finish flow and is deferred to BACKLOG if the owner wants it. Finish still walks through Review. *Cost if wrong:* a `--ui` user sees the 4-step chrome.
- **R-P3-4 — Controls per proposal are the CLI menu's items, not the D9 mock's three glyphs:** one button per candidate (`✓ accept <id>` newer sibling · `↩ follow the shipped pin (<id>)` · `✓ use <id>` replacement · `✓ add <alias> → <id>` notable), then `⌄ choose…`, then `× dismiss`. No `skip` — leaving a proposal alone is the skip. This makes *follow* visible on every curated proposal (Q4) instead of buried in a select, and lets the §5 write gate disable exactly the catalog-vouched buttons while *follow* stays enabled. Worst case is 4–5 buttons (a stale pin: follow + 3 replacements); typical is 1–2.
- **R-P3-5 — A proposal for an alias the user already edited THIS session is not rendered.** The engine reads DISK; the page's staged edit wins. Without this, ↻ would re-propose what the user just handled.
- **R-P3-6 — The Step-2 default's route is written only when the default was CHOSEN this session:** `defaultTouched` (a radio click, a route-pill click, a drill-down change) OR the checked radio differs from the `cfg.default` the init restored (a fresh config restores nothing, so its auto-checked card counts as chosen — its write-preview announces the pin). A restored, untouched default writes nothing (Q9: "the wizard writes only what the user actively chose"). Every write equal to the shipped id is folded to `null` BEFORE both the Review display and the IPC call (`foldShippedWrites`) — the same disk result `saveConfig` normalization produces, but the Review step stops claiming "1 alias(es) modified" for a write normalization would drop. *Cost if wrong:* a reopened wizard no longer refreshes an old pin on the default alias implicitly — the Needs-review section proposes *follow* for it explicitly instead.
- **R-P3-7 — Fixed defect (measured on `c8ff0150`):** `setup-ui-alias-script.js`'s remove handler ran `delete aliasEdits[alias]` for a NON-default alias, which stages nothing — so `×` on a SAVED custom alias struck the row through and the alias survived Finish (a silent no-op; product principle). Now a saved row stages `aliasEdits[alias] = null`; a row added this session (the client-side "New routes" group) is simply removed, staging nothing. Recorded as a `Fixed` CHANGELOG entry.
- **R-P3-8 — `choose…` offers the §5-gated ids only** (`gatedIds` from the IPC = `alias-proposals.js :: gatedCatalogIds`, the same set the CLI's "choose another" checks a typed id against), plus the proposal's own candidates, its current id and — for a curated alias — the shipped id (Q4 *follow*, allowed even when the catalog lacks it). When the catalog is not fresh, every candidate button except *follow* and the `choose…` control are disabled with the banner as their title; `dismiss` stays enabled.
- **R-P3-9 — No jsdom.** Page logic is written as small functions over data plus a thin DOM layer; tests extract function source with the repo's `new Function` harness (`tests/setup-ui-alias-script-dom.test.js` precedent) and use a ~130-line fake DOM (`tests/helpers/fake-dom.js`, new) that supports the exact API the fragments use. Adding jsdom is a dependency decision the owner has not made.
- **R-P3-10 — An unavailable catalog or a handler error renders the section with the banner alone** ("catalog unavailable — cannot check for updates (↻ to retry)" / "could not check for updates — <error>"); zero proposals WITH a catalog hides the section. The list itself is the truth; a silent "nothing to review" is the degrade the product principle forbids.
- **R-P3-11 — The IPC view is collected with the picker's default catalog age** (`collectAliasView({ write: false })`, no `maxAgeMs`): a stale cache refreshes inline exactly as the CLI picker does, so `fresh` is true whenever a refresh could succeed. Step 2's own `sidecar:get-catalog` already networks at init the same way; the "Settings window opens synchronously" property is about the window, not the page's later IPC.
- **R-P3-12 — `--ui` exit codes follow `setup --api-keys`:** Finish → `Aliases saved.` on stdout, exit 0; closed without Finish or a launch failure → the reason on stderr, exit 1. `--ui` with `--json`, `--review`, `--owner` or `--unpin` is an argument error (exit 1), the same shape as `--review --json`.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `electron/ipc-aliases.js` | new (T1) | `registerAliasHandlers` (`sidecar:get-alias-review`), `buildAliasReviewResponse` (the document: proposals, catalogAvailable, fetchedAt, fresh, gatedIds, error?), `recordDismissals` (Finish's "never ask again" sink) |
| `electron/ipc-setup.js` | modify (T1) | registers the alias handlers; `sidecar:save-config` gains the 4th argument `dismissals` |
| `electron/preload-setup.js` | modify (T1) | allowlists `sidecar:get-alias-review` |
| `src/sidecar/aliases.js` | modify (T1, T5) | `collectAliasView({ write: false })` skips the on-entry save (T1); `handleAliases` gains the `--ui` branch (T5) |
| `tests/electron/ipc-aliases.test.js` | new (T1) | the document shape, freshness, gating, error shape, dismissal recording |
| `tests/ipc-setup-save-config.test.js` | modify (T1) | the 4th argument reaches `recordDismissals` after `saveConfig` |
| `tests/sidecar/aliases-command.test.js` | modify (T1, T5) | `write: false` leaves disk alone (T1); `--ui` argument errors, launch, exit codes, on-entry normalization (T5) |
| `electron/setup-ui-alias-state.js` | new (T2; T4 appends) | page script: `isCuratedAlias`, `aliasStateFor`, `aliasRowFor`, `stagedValueFor`, `refreshAliasRowState`, `unpinAliasRow`, `stageAliasWrite` (T2); `restoredDefault`/`defaultTouched`/`stagedDismissals`, `defaultWasChosen`, `foldShippedWrites`, `describeDefaultWrite`, `finishPlan` (T4) |
| `electron/setup-ui-aliases.js` | modify (T2) | rows render `data-state` + an `.alias-state` label + the control by kind (`unpin` hidden on a following row; `×` on a custom row); `{ defaults, reviewHtml }` options |
| `electron/setup-ui-alias-script.js` | modify (T2) | the remove handler's three branches (R-P3-7); `refreshAliasRowState` after an inline edit |
| `electron/setup-ui-styles.js` | modify (T2, T3, T4) | `.alias-state*`, `.alias-delete[hidden]` (T2); `.alias-review*` (T3); `.write-preview-note` (T4) |
| `electron/setup-ui.js` | modify (T2, T3, T4, T5) | includes the two fragments (T2, T3); `restoredDefault` capture, `finishPlan()` in Finish + Review, the Q9 note in `updateWritePreviews`, comment compression (T4); `initialPane` → `INITIAL_STEP` (T5) |
| `tests/helpers/fake-dom.js` | new (T2) | the minimal DOM the page fragments are exercised against |
| `tests/electron/setup-ui-alias-state.test.js` | new (T2; T4 extends) | state rule, row refresh, unpin, stage; (T4) chosen-vs-restored, fold, announcement, finishPlan |
| `tests/setup-ui-aliases.test.js` | modify (T2) | state labels and controls by kind |
| `tests/setup-ui-alias-script-dom.test.js` | modify (T2) | the remove handler's three branches (mutant CUSTOMDELETE) |
| `electron/setup-ui-alias-review.js` | new (T3) | `buildAliasReviewHTML` (skeleton), `buildAliasReviewScript` (fetch, render, accept/choose/dismiss/add, ↻) |
| `tests/electron/setup-ui-alias-review.test.js` | new (T3) | banner, labels, free names, render, accept/follow/add/dismiss staging, stale gating, choose pruning |
| `electron/setup-ui-model.js` | modify (T4) | `.write-preview-note` span on each Step 2 card |
| `tests/setup-ui.test.js` | modify (T4, T5) | harness extension (`finishPlan` + deps), F11 rebinding, Q9 cases, Review wording (T4); `INITIAL_STEP` (T5) |
| `src/sidecar/setup-window.js` | modify (T5) | `launchSetupWindow({ pane })` → `AMICUS_SETUP_PANE` |
| `electron/main.js` | modify (T5) | `createSetupWindow` passes `initialPane` from the env |
| `src/cli.js` | modify (T5) | `--ui` in the `aliases` help block |
| `tests/sidecar/setup-window.test.js`, `tests/electron/main-settings-catalog-wiring.test.js` (or a new `tests/electron/main-setup-pane-wiring.test.js`) | modify/new (T5) | env token, wiring |
| `docs/usage.md`, `README.md`, `CHANGELOG.md`, `docs/electron-testing.md` | modify (T6) | user docs + the smoke recipe |

## Parallel execution map

```
Wave 1 (3 parallel worktrees):  T1 (IPC + engine write:false)   T2 (row state, unpin/×, fake DOM)   T5 (--ui)
   overlap: T1/T5 both edit src/sidecar/aliases.js (different functions); T2/T5 both edit electron/setup-ui.js (different regions) — resolve at merge.
Wave 2 (3 parallel worktrees):  T3 (Needs-review section; needs T1's document + T2's stage helpers)   T4 (Q9 finish plan; appends to T2's module)   T6 (docs — the strings are fixed in this plan)
   overlap: T3/T4 both edit electron/setup-ui.js and setup-ui-styles.js (different regions) — resolve at merge.
Wave 3 (controller):            T7 whole-branch review (most capable model) + the GUI smoke over CDP; then finishing-a-development-branch → PR with the `council-review` label.
```

Merge each wave into `feat/238-pr3-electron-review` with `--no-ff`; run `npm test` on the integration branch after every wave (the junction worktrees can run jest; the main clone must be on a committed tree). Subagent implementers sign "Claude Sonnet 5" — rewrite trailers with `git filter-branch -f --msg-filter 'sed …' BASE..HEAD` before the PR, then delete `refs/original/*`.

---
### Task 1: The review document over IPC (`electron/ipc-aliases.js`) + `collectAliasView({ write: false })`

**Files:**
- Create: `electron/ipc-aliases.js`
- Modify: `electron/ipc-setup.js` (docblock channel list; `sidecar:save-config` 4th argument; register the alias handlers at the tail)
- Modify: `electron/preload-setup.js` (allowlist)
- Modify: `src/sidecar/aliases.js :: normalizeOnEntry`, `:: collectAliasView` (a `write` option)
- Test: `tests/electron/ipc-aliases.test.js` (new), `tests/ipc-setup-save-config.test.js`, `tests/sidecar/aliases-command.test.js`

**Interfaces:**
- Consumes: `src/sidecar/aliases.js :: collectAliasView(opts, deps)` → `{ rows, proposals, catalogInfo, catalogAvailable, retired }`; `src/sidecar/aliases-review-gate.js :: isFresh(fetchedAt, now)`; `src/utils/alias-proposals.js :: gatedCatalogIds(catalogInfo)`; `src/utils/alias-store.js :: recordDismissal(dismissKey)` (throws on a key without `@`).
- Produces (T3 renders this; T4's Finish sends the 4th argument):
  - IPC `sidecar:get-alias-review` → `{ proposals: Array<proposal>, catalogAvailable: boolean, fetchedAt: number|null, fresh: boolean, gatedIds: string[], error?: string }` — never rejects.
  - IPC `sidecar:save-config(defaultModel, aliasWrites, councilPicks, dismissals)` — `dismissals` is an optional array of `alias@proposedId` strings, recorded AFTER `saveConfig`.
  - `collectAliasView({ write: false })` never calls `saveConfig`.

- [ ] **Step 1: Write the failing tests for the document builder**

Create `tests/electron/ipc-aliases.test.js`:

```js
'use strict';

/**
 * issue 238 D9 / Phase 3: the wizard's "Needs review" section reads ONE
 * document over IPC, built from the same collectAliasView the CLI list and
 * picker use. These tests pin the document's shape, its freshness flag (the
 * §5 write gate), the §5-gated id set the page's "choose…" may offer, the
 * never-rejects error shape, and Finish's dismissal sink.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { buildAliasReviewResponse, recordDismissals, registerAliasHandlers } = require('../../electron/ipc-aliases');
const { isFresh } = require('../../src/sidecar/aliases-review-gate');
const { gatedCatalogIds } = require('../../src/utils/alias-proposals');

const HOUR = 60 * 60 * 1000;
const FETCHED_AT = 1_000_000;

// A hand-built engine view (the proposal shape is alias-proposals.js's
// docblock contract) — never the live shipped pins (#53).
const VIEW = {
  rows: [],
  proposals: [{
    alias: 'glm', state: 'pinned', current: 'openrouter/z-ai/glm-5.3', shipped: 'openrouter/z-ai/glm-5.3', curated: true,
    reasons: ['newer-sibling'], candidates: [{ id: 'openrouter/z-ai/glm-5.4', why: 'newer-sibling', evidence: {} }],
    dismissKey: 'glm@openrouter/z-ai/glm-5.4',
  }],
  catalogInfo: {
    models: [
      { id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' },
      { id: 'anthropic/claude-floor', authoritative: false },   // floor row: never offered
      { id: 'google/gemini-x' },                                // rejected namespace: never offered
    ],
    fetchedAt: FETCHED_AT,
    providerFailures: [{ provider: 'google', error: 'HTTP 403' }],
  },
  catalogAvailable: true,
  retired: {},
};

function deps(over = {}) {
  return {
    collectAliasView: jest.fn(async () => VIEW),
    isFresh,
    gatedCatalogIds,
    now: () => FETCHED_AT + HOUR,
    ...over,
  };
}

describe('buildAliasReviewResponse (sidecar:get-alias-review)', () => {
  it('returns the engine view as one document: proposals, catalog facts, fresh, gatedIds', async () => {
    const d = deps();
    const doc = await buildAliasReviewResponse(d);
    expect(doc.proposals).toHaveLength(1);
    expect(doc.proposals[0].alias).toBe('glm');
    expect(doc.catalogAvailable).toBe(true);
    expect(doc.fetchedAt).toBe(FETCHED_AT);
    expect(doc.fresh).toBe(true);
    expect(doc.gatedIds).toEqual(['openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-5.4']); // §5 rules 1–2 applied
    expect(doc.error).toBeUndefined();
  });

  it('the wizard view never writes config: collectAliasView is asked for write:false (mutant WIZARDWRITE)', async () => {
    const d = deps();
    await buildAliasReviewResponse(d);
    expect(d.collectAliasView).toHaveBeenCalledTimes(1);
    expect(d.collectAliasView.mock.calls[0][0]).toEqual({ write: false });
  });

  it('a catalog older than 24 h is not fresh (the §5 write gate)', async () => {
    const doc = await buildAliasReviewResponse(deps({ now: () => FETCHED_AT + 25 * HOUR }));
    expect(doc.fresh).toBe(false);
    expect(doc.proposals).toHaveLength(1); // display gate: still shown (Q1)
  });

  it('a fetchedAt in the future (clock skew) is not fresh', async () => {
    const doc = await buildAliasReviewResponse(deps({ now: () => FETCHED_AT - 1 }));
    expect(doc.fresh).toBe(false);
  });

  it('no catalog at all: catalogAvailable false, fetchedAt null, no proposals, nothing gated', async () => {
    const doc = await buildAliasReviewResponse(deps({
      collectAliasView: jest.fn(async () => ({ rows: [], proposals: [], catalogInfo: { models: [], fetchedAt: null, providerFailures: [] }, catalogAvailable: false, retired: {} })),
    }));
    expect(doc).toEqual({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, gatedIds: [] });
  });

  it('a throwing collection resolves to the safe shape with the reason — the renderer never sees a rejection', async () => {
    const doc = await buildAliasReviewResponse(deps({ collectAliasView: jest.fn(async () => { throw new Error('disk on fire'); }) }));
    expect(doc.proposals).toEqual([]);
    expect(doc.catalogAvailable).toBe(false);
    expect(doc.fresh).toBe(false);
    expect(doc.gatedIds).toEqual([]);
    expect(doc.error).toBe('disk on fire');
  });

  it('tolerates a view with odd fields (non-array proposals, missing catalogInfo)', async () => {
    const doc = await buildAliasReviewResponse(deps({ collectAliasView: jest.fn(async () => ({ proposals: null, catalogAvailable: 'yes' })) }));
    expect(doc.proposals).toEqual([]);
    expect(doc.catalogAvailable).toBe(true);
    expect(doc.fetchedAt).toBeNull();
    expect(doc.gatedIds).toEqual([]);
  });
});

describe('registerAliasHandlers', () => {
  it('registers sidecar:get-alias-review on the given ipcMain and serves the document', async () => {
    const handlers = {};
    registerAliasHandlers({ handle: (channel, fn) => { handlers[channel] = fn; } }, deps());
    expect(Object.keys(handlers)).toEqual(['sidecar:get-alias-review']);
    const doc = await handlers['sidecar:get-alias-review']({});
    expect(doc.proposals[0].dismissKey).toBe('glm@openrouter/z-ai/glm-5.4');
  });
});

describe('recordDismissals (Finish\'s never-ask-again sink)', () => {
  // Runs against the hermetic scratch config dir (tests/setup/hermetic-config-dir.js).
  const { readDismissals } = require('../../src/utils/alias-store');

  it('nothing to record: undefined/null → 0, no write', () => {
    expect(recordDismissals(undefined)).toBe(0);
    expect(recordDismissals(null)).toBe(0);
    expect(Object.keys(readDismissals())).toEqual([]);
  });

  it('records each key through alias-store (permanent for the alias@id pair, Q5)', () => {
    expect(recordDismissals(['glm@openrouter/z-ai/glm-5.4', 'atlas@openrouter/x/atlas-1'])).toBe(2);
    const d = readDismissals();
    expect(typeof d['glm@openrouter/z-ai/glm-5.4']).toBe('string');
    expect(typeof d['atlas@openrouter/x/atlas-1']).toBe('string');
  });

  it('refuses a non-array and a malformed key (mutant DISMISSKEY: accept anything)', () => {
    expect(() => recordDismissals('glm@x')).toThrow(/array/);
    expect(() => recordDismissals(['no-at-sign'])).toThrow(/alias@proposedId/);
    expect(() => recordDismissals([42])).toThrow(/alias@proposedId/);
  });
});
```

- [ ] **Step 2: Run the new suite and watch it fail on the missing module**

Run: `npx jest tests/electron/ipc-aliases.test.js`
Expected: FAIL — `Cannot find module '../../electron/ipc-aliases'`.

- [ ] **Step 3: Create `electron/ipc-aliases.js`**

```js
/**
 * @module electron/ipc-aliases
 * IPC for the setup wizard's "Needs review" section (issue 238 D9, Phase 3).
 *
 * `sidecar:get-alias-review` serves ONE document the page renders: the
 * review engine's proposals through `src/sidecar/aliases.js :: collectAliasView`
 * (the same view the CLI list and picker use — spec §2, one engine, two
 * renderers), whether a catalog was available, when it was fetched, whether
 * that is FRESH for the §5 write gate (`aliases-review-gate.js :: isFresh`,
 * 24 h), and the §5-gated id set the page's "choose…" control may offer
 * (`alias-proposals.js :: gatedCatalogIds`, the same set the CLI checks a
 * typed id against). The view is collected with `write: false`: the wizard
 * writes config from Finish ONLY (`sidecar:save-config`), so the on-entry
 * normalization every `amicus aliases` form performs is skipped here — the
 * page's labels already show the post-normalization state
 * (setup-ui-alias-state.js). The default catalog age applies, so a stale
 * cache refreshes inline exactly as the picker's does.
 *
 * `recordDismissals` is Finish's sink for "never ask again": the page stages
 * dismissKeys and `sidecar:save-config` (ipc-setup.js) hands them here after
 * the alias writes landed; each key rides `alias-store.js :: recordDismissal`,
 * which validates it (`alias@proposedId`) and throws otherwise — the
 * renderer's catch re-enables Finish, same as a failed saveConfig.
 *
 * Never rejects: a failed collection resolves to the same shape with an
 * `error` message, so the page can say WHY it cannot check for updates
 * instead of rendering a silent "nothing to review".
 */

'use strict';

const { logger } = require('../src/utils/logger');

/** @returns {object} real collaborators; tests inject their own */
function defaultDeps() {
  return {
    collectAliasView: (opts) => {
      const aliases = require('../src/sidecar/aliases');
      return aliases.collectAliasView(opts, aliases.loadDeps());
    },
    isFresh: require('../src/sidecar/aliases-review-gate').isFresh,
    gatedCatalogIds: require('../src/utils/alias-proposals').gatedCatalogIds,
    now: () => Date.now(),
  };
}

/**
 * @param {object} [deps] see `defaultDeps`
 * @returns {Promise<{proposals: Array<object>, catalogAvailable: boolean, fetchedAt: number|null,
 *   fresh: boolean, gatedIds: string[], error?: string}>}
 */
async function buildAliasReviewResponse(deps = defaultDeps()) {
  try {
    const view = (await deps.collectAliasView({ write: false })) || {};
    const info = (view.catalogInfo && typeof view.catalogInfo === 'object') ? view.catalogInfo : {};
    const fetchedAt = typeof info.fetchedAt === 'number' ? info.fetchedAt : null;
    return {
      proposals: Array.isArray(view.proposals) ? view.proposals : [],
      catalogAvailable: !!view.catalogAvailable,
      fetchedAt,
      fresh: deps.isFresh(fetchedAt, deps.now()),
      gatedIds: deps.gatedCatalogIds(info),
    };
  } catch (err) {
    logger.error('get-alias-review handler error', { error: err && err.message });
    return { proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, gatedIds: [], error: String((err && err.message) || err) };
  }
}

/**
 * @param {unknown} keys the page's staged dismissKeys (`alias@proposedId`), or nothing
 * @returns {number} how many were recorded
 * @throws {Error} when `keys` is not an array, or a key is not a valid dismissKey (from `recordDismissal`)
 */
function recordDismissals(keys) {
  if (keys === undefined || keys === null) { return 0; }
  if (!Array.isArray(keys)) { throw new Error('dismissals must be an array of alias@proposedId keys'); }
  const { recordDismissal } = require('../src/utils/alias-store');
  let n = 0;
  for (const key of keys) { recordDismissal(key); n += 1; }
  return n;
}

/**
 * @param {{handle: Function}} ipcMain Electron's ipcMain, or a test double exposing `.handle`
 * @param {object} [deps] see `defaultDeps` (omitted in production)
 */
function registerAliasHandlers(ipcMain, deps) {
  ipcMain.handle('sidecar:get-alias-review', () => buildAliasReviewResponse(deps));
}

module.exports = { registerAliasHandlers, buildAliasReviewResponse, recordDismissals };
```

- [ ] **Step 4: Run the suite — the `recordDismissals` malformed-key case needs the real validator**

Run: `npx jest tests/electron/ipc-aliases.test.js`
Expected: PASS (all). `alias-store.js :: recordDismissal` already throws `Invalid dismissKey '…': expected alias@proposedId` for `'no-at-sign'` and `42`.

- [ ] **Step 5: Extend `tests/ipc-setup-save-config.test.js` for the 4th argument**

Add a mock line beside the existing mocks (top of file):

```js
jest.mock('../electron/ipc-aliases', () => ({
  registerAliasHandlers: jest.fn(),
  recordDismissals: jest.fn(() => 0),
}));
const { recordDismissals } = require('../electron/ipc-aliases');
```

Append a describe block:

```js
describe('sidecar:save-config (issue 238 D9: staged dismissals ride the 4th argument)', () => {
  test('dismissals are recorded AFTER the alias writes are saved', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.3' } });
    const order = [];
    saveConfig.mockImplementation(() => order.push('save'));
    recordDismissals.mockImplementation((keys) => { order.push('dismiss:' + keys.join(',')); return keys.length; });
    await save('gemini', { glm: 'openrouter/z-ai/glm-5.4' }, [], ['glm@openrouter/z-ai/glm-5.4']);
    expect(order).toEqual(['save', 'dismiss:glm@openrouter/z-ai/glm-5.4']);
  });

  test('no 4th argument: recordDismissals still runs with undefined (records nothing) — the old 3-argument call keeps working', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    await save('gemini', {}, []);
    expect(recordDismissals).toHaveBeenCalledWith(undefined);
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });

  test('a dismissal failure rejects the invoke (the renderer re-enables Finish) — after the aliases were saved', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    recordDismissals.mockImplementation(() => { throw new Error('bad key'); });
    await expect(save('gemini', {}, [], ['bad'])).rejects.toThrow('bad key');
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx jest tests/ipc-setup-save-config.test.js`
Expected: FAIL — the handler ignores the 4th argument (`recordDismissals` never called).

- [ ] **Step 6: Wire `electron/ipc-setup.js`**

(a) Docblock: extend the existing sentence `get-catalog, and refresh-catalog.` to `get-catalog, refresh-catalog, and (ipc-aliases.js) get-alias-review.` — one line changed, no new paragraph.

(b) Top requires — add after `registerLocalProviderHandlers`:

```js
const { registerAliasHandlers, recordDismissals } = require('./ipc-aliases');
```

(c) `sidecar:save-config` — change the comment line `// councilPicks (optional): when length >= 2, seeds the free council via seedFreeCouncil.` to:

```js
  // councilPicks (optional): when length >= 2, seeds the free council via seedFreeCouncil.
  // dismissals (optional, issue 238 D9): the page's staged "never ask again" keys, recorded after the writes.
```

change the signature to `async (_event, defaultModel, aliasWrites, councilPicks, dismissals) => {` and, after the `seedFreeCouncil` block and before `return { success: true };`, add:

```js
      recordDismissals(dismissals);
```

(d) Tail — after `registerLocalProviderHandlers(ipcMain);` add:

```js
  registerAliasHandlers(ipcMain); // issue 238 D9: the "Needs review" section's read channel (ipc-aliases.js)
```

`wc -l electron/ipc-setup.js` must print ≤ 296.

- [ ] **Step 7: Allowlist the channel in `electron/preload-setup.js`**

Insert `'sidecar:get-alias-review',` after `'sidecar:refresh-catalog',` in `allowedChannels`.

Run: `npx jest tests/ipc-setup-save-config.test.js tests/electron/preload-allowlist.test.js tests/electron/ipc-setup-catalog-snapshot.test.js tests/ipc-setup-fetch-free-models.test.js tests/ipc-setup-provider-default.test.js`
Expected: PASS. (The catalog-snapshot / free-models / provider-default suites register the real handlers through `registerSetupHandlers` and now also register the alias handler on their doubles — a double that throws on an unknown channel would show here; the F2e doubles record every channel, so nothing changes.)

- [ ] **Step 8: The engine option — failing test first**

In `tests/sidecar/aliases-command.test.js`, inside the first `describe('amicus aliases (#238 D4 — list and --json)')` block (it already builds a hermetic `AMICUS_CONFIG_DIR`, mocks `model-catalog` and exposes `cfg`/`handleAliases` in `beforeEach` — read its `beforeEach` to reuse the same helpers), add:

```js
  it('collectAliasView({ write: false }) normalizes in memory only — the seeded key stays on disk (mutant WIZARDWRITE: ignore the option)', async () => {
    const shipped = cfg.getDefaultAliases();
    const [alias] = Object.keys(shipped);
    // A seeded key equal to the shipped id, written WITHOUT saveConfig (whose normalizer would drop it).
    const file = path.join(process.env.AMICUS_CONFIG_DIR, 'config.json');
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ default: alias, aliases: { [alias]: shipped[alias] } }, null, 2));
    const aliases = require('../../src/sidecar/aliases');
    const view = await aliases.collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY, write: false }, aliases.loadDeps());
    expect(view.rows.find(r => r.alias === alias).state).toBe('following');   // the in-memory view IS normalized…
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).aliases[alias]).toBe(shipped[alias]);   // …and disk is untouched
    await aliases.collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY }, aliases.loadDeps());
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).aliases[alias]).toBeUndefined();        // the default path still normalizes on entry (D6)
  });
```

(`fs`/`path`/`cfg` come from the file's existing harness. The alias and id are derived from `getDefaultAliases()` at run time — no shipped id is hardcoded.)

Run: `npx jest tests/sidecar/aliases-command.test.js -t "write: false"`
Expected: FAIL — the key is gone from disk after the first call (the option is ignored today).

- [ ] **Step 9: Implement the option in `src/sidecar/aliases.js`**

Change `normalizeOnEntry`:

```js
/**
 * Normalize on entry (D6), best-effort: a read-only config dir never blocks a
 * listing — the in-memory normalized view is used and the failure announced.
 * Also fires on a non-string value (#249 r1 R8a): `normalizeAliases` only
 * drops a value equal to the shipped default, so a garbage value would
 * otherwise sit on disk forever -- `saveConfig`'s own stripper removes it,
 * with its own Notice.
 * `write === false` (issue 238 D9: the Electron wizard's IPC view,
 * electron/ipc-aliases.js) returns the same normalized view and skips the
 * save — the wizard writes config from Finish only.
 * @param {object} d collaborators from `loadDeps`
 * @param {boolean} [write=true] false = never touch disk
 * @returns {object} the user alias map after normalization
 */
function normalizeOnEntry(d, write = true) {
  const cfg = d.config.loadConfig();
  const defaults = d.config.getDefaultAliases();
  if (!cfg || !cfg.aliases || typeof cfg.aliases !== 'object') { return {}; }
  const probe = d.normalizeAliases(cfg.aliases, defaults);
  if (write && (probe.removed.length > 0 || hasStrippableAliasValue(cfg.aliases))) {
    try { d.config.saveConfig(cfg); }                              // saveConfig prints the Notices
    catch (err) { process.stderr.write(`Notice: could not normalize aliases (${collapseExcerpt(err.message)}) — keys left on disk; every alias still resolves to the same id\n`); }
  }
  return probe.aliases;
}
```

Change `collectAliasView`'s JSDoc and first line:

```js
/**
 * @param {{maxAgeMs?: number, write?: boolean}} [opts] `maxAgeMs: Number.POSITIVE_INFINITY` = cache only;
 *   `write: false` = normalize in memory only (the wizard's IPC view)
 * @returns {Promise<{rows: Array, proposals: Array, catalogInfo: object, catalogAvailable: boolean, retired: object}>}
 */
async function collectAliasView(opts = {}, d = loadDeps()) {
  const userAliases = normalizeOnEntry(d, opts.write !== false);
```

Run: `npx jest tests/sidecar/aliases-command.test.js tests/sidecar/aliases-review.test.js tests/sidecar/aliases-owner.test.js`
Expected: PASS.

- [ ] **Step 10: Gates + commit**

Run: `node scripts/check-file-sizes.js --all && node scripts/check-citations.js --all && npm run lint && npx jest tests/electron tests/ipc-setup-save-config.test.js tests/sidecar/aliases-command.test.js`
Expected: all green; `wc -l electron/ipc-setup.js src/sidecar/aliases.js` ≤ 296 / ≤ 278.

```bash
git add electron/ipc-aliases.js electron/ipc-setup.js electron/preload-setup.js src/sidecar/aliases.js tests/electron/ipc-aliases.test.js tests/ipc-setup-save-config.test.js tests/sidecar/aliases-command.test.js
git commit -m "feat(electron): sidecar:get-alias-review — the review engine's document for the wizard (issue 238 D9, T1)

One document over IPC (proposals, catalogAvailable, fetchedAt, fresh, gatedIds), built from the
same collectAliasView the CLI list and picker use, collected with write:false — the wizard
writes config from Finish only. sidecar:save-config takes a 4th argument, dismissals, recorded
after the alias writes through alias-store's recordDismissal. Never rejects: a failed
collection carries its reason so the page can say why.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: Row state (following / pinned), `unpin` vs `×`, and the fixed remove handler

**Files:**
- Create: `electron/setup-ui-alias-state.js`, `tests/helpers/fake-dom.js`, `tests/electron/setup-ui-alias-state.test.js`
- Modify: `electron/setup-ui-aliases.js` (rows), `electron/setup-ui-alias-script.js` (remove handler; refresh after edits), `electron/setup-ui.js` (include the fragment), `electron/setup-ui-styles.js` (state + hidden control CSS)
- Test: `tests/setup-ui-aliases.test.js`, `tests/setup-ui-alias-script-dom.test.js`

**Interfaces:**
- Consumes: page globals `aliasEdits` (null-prototype; string = set, `null` = remove the key), `defaultAliases` (null-prototype shipped map), `$`, `refreshAliasCounts`, `placeRowInNewRoutesGroup`.
- Produces (T3 and T4 call these; all are page-script function declarations, hoisted):
  - `isCuratedAlias(alias) → boolean`
  - `aliasStateFor(alias, value) → { curated: boolean, state: 'following'|'pinned' }`
  - `aliasRowFor(alias) → Element|null` (attribute compare, no selector interpolation)
  - `stagedValueFor(row) → string`, `refreshAliasRowState(row) → state`, `unpinAliasRow(row)`
  - `stageAliasWrite(alias, id) → state` (folds the shipped id to `null`; updates the list row; opens its group)
  - Row markup: `<div class="alias-row" data-alias="…" data-state="following|pinned">` … `<span class="alias-state alias-state-<state>"><state></span><button class="alias-delete" data-alias="…" data-kind="unpin|delete" [hidden]>unpin|×</button>`; a curated row ALWAYS carries the `unpin` button (hidden while following, so an inline edit that pins can reveal it); a custom row carries `×`.
  - `buildAliasEditorHTML(aliases, { defaults = getDefaultAliases(), reviewHtml = '' } = {})` — `reviewHtml` is inserted between the "How it works" box and `.alias-editor` (T3 fills it).

- [ ] **Step 1: The fake DOM helper (test infrastructure, no production code)**

Create `tests/helpers/fake-dom.js`:

```js
'use strict';

/**
 * A minimal DOM for exercising the wizard's INLINE page scripts under jest's
 * `node` environment (there is no jsdom in this repo — R-P3-9). Supports
 * exactly what electron/setup-ui-alias-*.js use: createElement, append /
 * insertBefore / remove / replaceWith, closest / querySelector(All) over
 * simple selectors (`tag`, `#id`, `.cls`, `[attr]`, `[attr="v"]`, `:not(.cls)`,
 * compound and descendant combinations), classList, get/set/hasAttribute,
 * addEventListener + a bubbling `dispatch`, `hidden`, `open`, `disabled`,
 * `value`, `textContent` (leaf text only — never composed from children).
 */

function parseCompound(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [], not: [] };
  const re = /^([a-z]+)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(\.([\w-]+)\)/g;
  let m;
  while ((m = re.exec(sel)) !== null) {
    if (m[1]) { out.tag = m[1].toUpperCase(); }
    else if (m[2]) { out.id = m[2]; }
    else if (m[3]) { out.classes.push(m[3]); }
    else if (m[4]) { out.attrs.push([m[4], m[5]]); }
    else if (m[6]) { out.not.push(m[6]); }
  }
  return out;
}

function matchesCompound(el, c) {
  if (!el || !el.tagName) { return false; }
  if (c.tag && el.tagName !== c.tag) { return false; }
  if (c.id && el.getAttribute('id') !== c.id) { return false; }
  if (c.classes.some(k => !el.classList.contains(k))) { return false; }
  if (c.not.some(k => el.classList.contains(k))) { return false; }
  return c.attrs.every(([name, value]) => (value === undefined ? el.hasAttribute(name) : el.getAttribute(name) === value));
}

/** Descendant combinator only (`a b c`), matched right-to-left like a browser. */
function matches(el, selector) {
  const parts = selector.trim().split(/\s+/).map(parseCompound);
  if (!matchesCompound(el, parts[parts.length - 1])) { return false; }
  let node = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (node && !matchesCompound(node, parts[i])) { node = node.parentNode; }
    if (!node) { return false; }
    node = node.parentNode;
  }
  return true;
}

function walk(node, visit) {
  for (const child of node.children) { visit(child); walk(child, visit); }
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.label = '';
    this.title = '';
    this.type = '';
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.selected = false;
    const classes = new Set();
    this.classList = {
      add: (...ks) => ks.forEach(k => classes.add(k)),
      remove: (...ks) => ks.forEach(k => classes.delete(k)),
      contains: (k) => classes.has(k),
      toggle: (k, force) => { const on = force === undefined ? !classes.has(k) : !!force; if (on) { classes.add(k); } else { classes.delete(k); } return on; },
    };
    Object.defineProperty(this, 'className', {
      get: () => [...classes].join(' '),
      set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(k => classes.add(k)); },
    });
  }
  get firstChild() { return this.children[0] || null; }
  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = String(v); }
  get options() { return this.querySelectorAll('option'); }
  appendChild(child) { if (child.parentNode) { child.remove(); } child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, ref) {
    if (child.parentNode) { child.remove(); }
    child.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i === -1) { this.children.push(child); } else { this.children.splice(i, 0, child); }
    return child;
  }
  remove() { if (!this.parentNode) { return; } const i = this.parentNode.children.indexOf(this); if (i !== -1) { this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  replaceWith(other) { const p = this.parentNode; if (!p) { return; } p.insertBefore(other, this); this.remove(); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') { /* kept in attributes */ } }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  closest(selector) { let n = this; while (n && n.tagName) { if (matches(n, selector)) { return n; } n = n.parentNode; } return null; }
  querySelectorAll(selector) { const out = []; walk(this, n => { if (matches(n, selector)) { out.push(n); } }); return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  /** Bubble `type` from this element to the document; the event carries `target` and `closest`-capable `target`. */
  dispatch(type, init = {}) {
    const event = { type, target: this, ...init };
    let n = this;
    while (n) { (n.listeners[type] || []).slice().forEach(fn => fn(event)); n = n.parentNode || (n === this.ownerDocument.body ? this.ownerDocument : null); }
    return event;
  }
  click() { return this.dispatch('click'); }
  focus() {}
  blur() {}
}

/** @returns {{document: object, body: FakeElement}} */
function createFakeDocument() {
  const document = {
    listeners: Object.create(null),
    createElement: (tag) => new FakeElement(tag, document),
    getElementById: (id) => document.body.querySelector(`#${id}`),
    querySelector: (sel) => document.body.querySelector(sel),
    querySelectorAll: (sel) => document.body.querySelectorAll(sel),
    addEventListener: (type, fn) => { (document.listeners[type] = document.listeners[type] || []).push(fn); },
  };
  document.body = new FakeElement('body', document);
  document.body.parentNode = null;
  document.tagName = undefined;              // `closest` stops at the document
  document.parentNode = null;
  return { document, body: document.body };
}

module.exports = { createFakeDocument, FakeElement };
```

Note on `dispatch`: a listener registered on `document` (`document.addEventListener`) runs last because `body.parentNode` is `null` and the loop hops from `body` to `document` explicitly. Both `getElementById` and `querySelector` search under `body`, so tests must append the page skeleton to `body`.

- [ ] **Step 2: Write the failing tests for the state fragment**

Create `tests/electron/setup-ui-alias-state.test.js`:

```js
'use strict';

/**
 * issue 238 D1/D9 (Phase 3): what an alias row MEANS on the wizard page and
 * what its controls stage. The fragment is a page script (no require), so
 * its functions are pulled out of the emitted source and run under
 * `new Function` against tests/helpers/fake-dom.js. `defaultAliases` is a
 * SYNTHETIC map (#53: never the live shipped pins).
 */

const { buildAliasStateScript } = require('../../electron/setup-ui-alias-state');
const { createFakeDocument } = require('../helpers/fake-dom');

const DEFAULTS = { gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.3' };

/** Extracts every named function declaration of the fragment and binds the page globals. */
function loadStateScript({ aliasEdits = Object.create(null), defaultAliases = DEFAULTS, document } = {}) {
  const src = buildAliasStateScript();
  const names = [...src.matchAll(/^ {2}function (\w+)\(/gm)].map(m => m[1]);
  expect(names).toEqual(expect.arrayContaining(['isCuratedAlias', 'aliasStateFor', 'aliasRowFor', 'stagedValueFor', 'refreshAliasRowState', 'unpinAliasRow', 'stageAliasWrite']));
  // eslint-disable-next-line no-new-func
  const factory = new Function('aliasEdits', 'defaultAliases', 'document', 'window', `${src}\nreturn { ${names.join(', ')} };`);
  const defaults = Object.assign(Object.create(null), defaultAliases);
  return { fns: factory(aliasEdits, defaults, document, {}), aliasEdits };
}

/** A server-shaped row: name, arrow, model, state label, control by kind. */
function makeRow(document, { alias, model, curated, state }) {
  const row = document.createElement('div');
  row.className = 'alias-row';
  row.setAttribute('data-alias', alias);
  row.setAttribute('data-state', state);
  const name = document.createElement('span'); name.className = 'alias-name'; name.textContent = alias;
  const arrow = document.createElement('span'); arrow.className = 'alias-arrow'; arrow.textContent = '→';
  const modelEl = document.createElement('span'); modelEl.className = 'alias-model'; modelEl.textContent = model;
  const label = document.createElement('span'); label.className = `alias-state alias-state-${state}`; label.textContent = state;
  const btn = document.createElement('button'); btn.className = 'alias-delete'; btn.setAttribute('data-alias', alias);
  btn.setAttribute('data-kind', curated ? 'unpin' : 'delete'); btn.textContent = curated ? 'unpin' : '×';
  btn.hidden = curated && state === 'following';
  [name, arrow, modelEl, label, btn].forEach(el => row.appendChild(el));
  return row;
}

function pageWith(rows) {
  const { document, body } = createFakeDocument();
  const group = document.createElement('details'); group.className = 'alias-group';
  body.appendChild(group);
  rows.forEach(r => group.appendChild(makeRow(document, r)));
  return { document, group };
}

describe('aliasStateFor — the state rule (R-P3-2)', () => {
  const { fns } = loadStateScript();
  it('a curated alias holding the shipped id follows; any other value pins', () => {
    expect(fns.aliasStateFor('gemini', 'google/gemini-x')).toEqual({ curated: true, state: 'following' });
    expect(fns.aliasStateFor('gemini', 'google/gemini-y')).toEqual({ curated: true, state: 'pinned' });
    expect(fns.aliasStateFor('gemini', 'openrouter/google/gemini-x')).toEqual({ curated: true, state: 'pinned' }); // exact equality, same as saveConfig's normalizer
  });
  it('a custom alias is always pinned; prototype names are custom', () => {
    expect(fns.aliasStateFor('mine', 'openrouter/x/y')).toEqual({ curated: false, state: 'pinned' });
    expect(fns.aliasStateFor('toString', 'openrouter/x/y')).toEqual({ curated: false, state: 'pinned' });
    expect(fns.isCuratedAlias('constructor')).toBe(false);
  });
});

describe('refreshAliasRowState / stagedValueFor', () => {
  it('reads the staged write over the on-screen text and re-labels the row (mutant STALELABEL: never re-label)', () => {
    const { document } = pageWith([{ alias: 'gemini', model: 'google/gemini-x', curated: true, state: 'following' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    const row = fns.aliasRowFor('gemini');
    expect(row).not.toBeNull();
    expect(row.querySelector('.alias-delete').hidden).toBe(true);               // following: nothing to unpin
    aliasEdits.gemini = 'google/gemini-y';                                       // an inline edit pinned it
    expect(fns.refreshAliasRowState(row)).toBe('pinned');
    expect(row.getAttribute('data-state')).toBe('pinned');
    expect(row.querySelector('.alias-state').textContent).toBe('pinned');
    expect(row.querySelector('.alias-state').className).toBe('alias-state alias-state-pinned');
    expect(row.querySelector('.alias-delete').hidden).toBe(false);              // …so [unpin] appears
    aliasEdits.gemini = null;                                                    // staged removal → follows again
    expect(fns.refreshAliasRowState(row)).toBe('following');
    expect(row.querySelector('.alias-delete').hidden).toBe(true);
  });
  it('aliasRowFor finds by attribute compare, so a quote in a name cannot break it', () => {
    const { document } = pageWith([{ alias: 'a"b', model: 'openrouter/x/y', curated: false, state: 'pinned' }]);
    const { fns } = loadStateScript({ document });
    expect(fns.aliasRowFor('a"b').getAttribute('data-alias')).toBe('a"b');
    expect(fns.aliasRowFor('nope')).toBeNull();
  });
});

describe('unpinAliasRow — [unpin] on a curated pin', () => {
  it('stages null, shows the shipped id, labels the row following, hides the control (mutant STRIKEUNPIN: strike it through instead)', () => {
    const { document } = pageWith([{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', curated: true, state: 'pinned' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    const row = fns.aliasRowFor('glm');
    fns.unpinAliasRow(row);
    expect(aliasEdits.glm).toBeNull();
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.3');
    expect(row.getAttribute('data-state')).toBe('following');
    expect(row.classList.contains('alias-deleted')).toBe(false);               // the alias still exists
    expect(row.querySelector('.alias-delete').hidden).toBe(true);
  });
});

describe('stageAliasWrite — Q4: the shipped id means follow', () => {
  it('a different id pins: aliasEdits holds it, the row shows it, its group opens', () => {
    const { document, group } = pageWith([{ alias: 'glm', model: 'openrouter/z-ai/glm-5.3', curated: true, state: 'following' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    expect(fns.stageAliasWrite('glm', 'openrouter/z-ai/glm-5.4')).toBe('pinned');
    expect(aliasEdits.glm).toBe('openrouter/z-ai/glm-5.4');
    const row = fns.aliasRowFor('glm');
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.4');
    expect(row.getAttribute('data-state')).toBe('pinned');
    expect(row.querySelector('.alias-delete').hidden).toBe(false);
    expect(group.open).toBe(true);
  });
  it('the shipped id folds to null (follow) — never a redundant pin (mutant PINSHIPPED)', () => {
    const { document } = pageWith([{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', curated: true, state: 'pinned' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    expect(fns.stageAliasWrite('glm', 'openrouter/z-ai/glm-5.3')).toBe('following');
    expect(aliasEdits.glm).toBeNull();
    expect(fns.aliasRowFor('glm').getAttribute('data-state')).toBe('following');
  });
  it('a custom alias always pins, and a struck-out row comes back', () => {
    const { document } = pageWith([{ alias: 'mine', model: 'openrouter/x/old', curated: false, state: 'pinned' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    const row = fns.aliasRowFor('mine');
    row.classList.add('alias-deleted');
    expect(fns.stageAliasWrite('mine', 'openrouter/x/new')).toBe('pinned');
    expect(aliasEdits.mine).toBe('openrouter/x/new');
    expect(row.classList.contains('alias-deleted')).toBe(false);
  });
  it('an alias with no row on the page still stages (a notable added this session)', () => {
    const { document } = pageWith([]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    expect(fns.stageAliasWrite('atlas', 'openrouter/x/atlas-1')).toBe('pinned');
    expect(aliasEdits.atlas).toBe('openrouter/x/atlas-1');
  });
});
```

Run: `npx jest tests/electron/setup-ui-alias-state.test.js`
Expected: FAIL — `Cannot find module '../../electron/setup-ui-alias-state'`.

- [ ] **Step 3: Create `electron/setup-ui-alias-state.js`**

```js
/**
 * @module electron/setup-ui-alias-state
 * Inline page script: what an alias row MEANS (issue 238 D1/D9) and — Task 4
 * appends this half — what Finish writes for the Step 2 default (issue 238
 * Q9). Runs in the wizard page (no require()), in the same <script> as
 * setup-ui.js's wizard script, so it reads the page's `aliasEdits`,
 * `defaultAliases` and `$`, and its function declarations are hoisted for
 * the fragments that call them (setup-ui-alias-script.js's remove handler,
 * setup-ui-alias-review.js, buildReview / Finish in setup-ui.js).
 *
 * THE STATE RULE (one rule, both surfaces): a curated alias FOLLOWS when its
 * effective value equals the shipped id and is PINNED otherwise; a custom
 * alias is always pinned. The CLI encodes the same state as key PRESENCE
 * (src/utils/alias-state.js :: listAliasRows); the two agree the moment a
 * config is saved, because `saveConfig` removes every key equal to its
 * shipped id (D6's no-op proof) — and the page's labels must show what
 * Finish will PRODUCE, not what an un-normalized file happens to hold.
 *
 * Every write here is STAGED into `aliasEdits` (string = set, null = remove
 * the key — Q4's encoding: the shipped id folds to null); nothing reaches
 * disk until Finish (electron/ipc-setup.js, sidecar:save-config). Rows are
 * found by attribute compare, never by interpolating a name into a selector.
 * Text reaches the DOM through textContent only.
 */

'use strict';

/**
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildAliasStateScript() {
  return `
  // issue 238 D1: curated = the name is in the shipped map (own key; a
  // literal toString/constructor name is a custom alias, as everywhere else).
  // Three lines on purpose: the test harnesses extract functions up to the
  // first two-space-indented closing brace.
  function isCuratedAlias(alias) {
    return Object.prototype.hasOwnProperty.call(defaultAliases, alias);
  }

  // { curated, state } for an alias that will hold \`value\` -- THE STATE RULE
  // (module docblock). Exact equality, the same test saveConfig's normalizer
  // applies; a gateway-form twin of the shipped id is a pin here as it is
  // on the CLI list ("same model as shipped, other gateway").
  function aliasStateFor(alias, value) {
    var curated = isCuratedAlias(alias);
    return { curated: curated, state: (curated && value === defaultAliases[alias]) ? 'following' : 'pinned' };
  }

  // The rendered row for \`alias\`, by attribute compare -- never a selector
  // built from the name (a quote in a name would break it).
  function aliasRowFor(alias) {
    var rows = document.querySelectorAll('.alias-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-alias') === alias) { return rows[i]; }
    }
    return null;
  }

  // The value the row WILL hold after Finish: the staged write when there is
  // one (null = the key goes, so a curated name resolves to the shipped id),
  // else what is on screen.
  function stagedValueFor(row) {
    var alias = row.getAttribute('data-alias') || '';
    if (Object.prototype.hasOwnProperty.call(aliasEdits, alias)) {
      return aliasEdits[alias] === null ? (defaultAliases[alias] || '') : aliasEdits[alias];
    }
    var span = row.querySelector('.alias-model');
    return span ? span.textContent : '';
  }

  // Re-label one row from its staged value: data-state, the state label, and
  // the remove control -- a following curated row has no key to remove, so
  // its [unpin] hides (it comes back the moment an edit pins the row).
  function refreshAliasRowState(row) {
    var alias = row.getAttribute('data-alias') || '';
    var s = aliasStateFor(alias, stagedValueFor(row));
    row.setAttribute('data-state', s.state);
    var label = row.querySelector('.alias-state');
    if (label) {
      label.textContent = s.state;
      label.className = 'alias-state alias-state-' + s.state;
    }
    var btn = row.querySelector('.alias-delete');
    if (btn) { btn.hidden = s.curated && s.state === 'following'; }
    return s.state;
  }

  // [unpin] on a curated pin: the key goes; the row shows the shipped id it
  // now follows -- NOT a strike-through, the alias still exists (D1).
  function unpinAliasRow(row) {
    var alias = row.getAttribute('data-alias') || '';
    aliasEdits[alias] = null;
    var span = row.querySelector('.alias-model');
    if (span) { span.textContent = defaultAliases[alias] || ''; }
    refreshAliasRowState(row);
  }

  // Stage "alias -> id" the way Q4 encodes it: the shipped id means FOLLOW
  // (remove the key), anything else pins. Updates the list row in place --
  // a struck-out row comes back -- and opens its group so the change is on
  // screen. An alias with no row yet (a notable added this session) just
  // stages. Returns the resulting state.
  function stageAliasWrite(alias, id) {
    var s = aliasStateFor(alias, id);
    aliasEdits[alias] = s.state === 'following' ? null : id;
    var row = aliasRowFor(alias);
    if (row) {
      var span = row.querySelector('.alias-model');
      if (span) { span.textContent = id; }
      row.classList.remove('alias-deleted');
      refreshAliasRowState(row);
      var group = row.closest('.alias-group');
      if (group) { group.open = true; }
    }
    return s.state;
  }`;
}

module.exports = { buildAliasStateScript };
```

Run: `npx jest tests/electron/setup-ui-alias-state.test.js`
Expected: PASS.

- [ ] **Step 4: Server-rendered rows — failing tests**

In `tests/setup-ui-aliases.test.js`, REPLACE the test `it('should contain delete buttons', …)` (inside `describe('buildAliasEditorHTML')`, which renders `getDefaultAliases()` — all following) with:

```js
    it('every curated row carries an [unpin] control, hidden while the row follows (issue 238 D1/R1)', () => {
      const rows = html.match(/<div class="alias-row"[^>]*>[\s\S]*?<\/div>/g);
      expect(rows.length).toBe(Object.keys(getDefaultAliases()).length);
      rows.forEach(row => {
        expect(row).toContain('data-state="following"');
        expect(row).toContain('<span class="alias-state alias-state-following">following</span>');
        expect(row).toMatch(/<button class="alias-delete" data-alias="[^"]+" data-kind="unpin" title="[^"]+" hidden>unpin<\/button>/);
      });
    });
```

and add a new describe block at the end of the file:

```js
// ---------------------------------------------------------------------------
// issue 238 D1/D9 (Phase 3): following / pinned per row, and the remove
// control by kind. `defaults` is injected -- never the live shipped pins (#53).
// ---------------------------------------------------------------------------
describe('buildAliasEditorHTML - row state and the control by kind', () => {
  const defaults = { gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.3' };
  const aliases = { gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.2', mine: 'openrouter/x/y' };
  const html = buildAliasEditorHTML(aliases, { defaults });
  const rowOf = (alias) => html.match(new RegExp(`<div class="alias-row" data-alias="${alias}"[^>]*>[\\s\\S]*?</div>`))[0];

  it('a curated alias holding the shipped id renders following, with [unpin] hidden', () => {
    const row = rowOf('gemini');
    expect(row).toContain('data-state="following"');
    expect(row).toContain('alias-state-following">following<');
    expect(row).toMatch(/data-kind="unpin"[^>]* hidden>unpin</);
  });
  it('a curated alias holding another id renders pinned, with [unpin] visible (mutant ALLFOLLOW: label every row following)', () => {
    const row = rowOf('glm');
    expect(row).toContain('data-state="pinned"');
    expect(row).toContain('alias-state-pinned">pinned<');
    expect(row).toMatch(/data-kind="unpin"[^>]*>unpin</);
    expect(row).not.toMatch(/data-kind="unpin"[^>]* hidden>/);
  });
  it('a custom alias renders pinned with a × delete control, never [unpin]', () => {
    const row = rowOf('mine');
    expect(row).toContain('data-state="pinned"');
    expect(row).toMatch(/data-kind="delete"[^>]*>×</);
    expect(row).not.toContain('unpin');
  });
  it('escapes the alias name inside the control too', () => {
    const h = buildAliasEditorHTML({ 'a"b': 'openrouter/x/y' }, { defaults });
    expect(h).toContain('<button class="alias-delete" data-alias="a&quot;b" data-kind="delete"');
  });
  it('reviewHtml lands between the example box and the editor (T3 fills it)', () => {
    const h = buildAliasEditorHTML(aliases, { defaults, reviewHtml: '<section id="alias-review-probe"></section>' });
    const example = h.indexOf('class="routing-example"');
    const probe = h.indexOf('id="alias-review-probe"');
    const editor = h.indexOf('<div class="alias-editor">');
    expect(example).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(example);
    expect(editor).toBeGreaterThan(probe);
    expect(buildAliasEditorHTML(aliases, { defaults })).not.toContain('alias-review-probe'); // default: nothing inserted
  });
});
```

Run: `npx jest tests/setup-ui-aliases.test.js`
Expected: FAIL (no state span, no `data-kind`, options ignored).

- [ ] **Step 5: Implement the rows in `electron/setup-ui-aliases.js`**

Add the require after `groupAliases`:

```js
const { getDefaultAliases } = require('../src/utils/config');
```

Add above `buildAliasEditorHTML`:

```js
/**
 * The remove control by kind (issue 238 D1/R1): "unpin" and "delete" are ONE
 * operation -- remove the key -- whose meaning is decided by whether the
 * name is curated. A curated row ALWAYS carries [unpin], hidden while it
 * follows (nothing to remove) so an inline edit that pins it can reveal it
 * (setup-ui-alias-state.js :: refreshAliasRowState); a custom row carries ×.
 * @param {string} key alias name
 * @param {boolean} curated
 * @param {'following'|'pinned'} state
 * @returns {string}
 */
function rowControlHTML(key, curated, state) {
  if (curated) {
    return `<button class="alias-delete" data-alias="${esc(key)}" data-kind="unpin" title="Unpin: go back to following the shipped recommendation"${state === 'following' ? ' hidden' : ''}>unpin</button>`;
  }
  return `<button class="alias-delete" data-alias="${esc(key)}" data-kind="delete" title="Delete this alias">×</button>`;
}
```

Change the signature and JSDoc of `buildAliasEditorHTML`:

```js
 * @param {Object<string,string>} aliases - Map of alias name to model string (the EFFECTIVE map)
 * @param {object} [options]
 * @param {Object<string,string>} [options.defaults] - the shipped map; injectable for tests (default getDefaultAliases())
 * @param {string} [options.reviewHtml=''] - the "Needs review" section (setup-ui-alias-review.js), inserted above the editor
 * @returns {string} HTML fragment with search, groups, rows, and add button
 */
function buildAliasEditorHTML(aliases, { defaults = getDefaultAliases(), reviewHtml = '' } = {}) {
```

Replace the row template inside the `.map(key => { … })`:

```js
      .map(key => {
        const model = aliases[key];
        // issue 238 D1: following = the effective value IS the shipped id
        // (exactly what saveConfig's normalizer keeps off disk); anything
        // else is a pin. setup-ui-alias-state.js re-derives the same rule
        // on the page after every edit.
        const curated = Object.prototype.hasOwnProperty.call(defaults, key);
        const state = (curated && model === defaults[key]) ? 'following' : 'pinned';
        return `<div class="alias-row" data-alias="${esc(key)}" data-state="${state}">` +
          `<span class="alias-name">${esc(key)}</span>` +
          '<span class="alias-arrow">→</span>' +
          `<span class="alias-model">${esc(model)}</span>` +
          `<span class="alias-state alias-state-${state}">${state}</span>` +
          rowControlHTML(key, curated, state) +
          '</div>';
      }).join('\n        ');
```

Insert `${reviewHtml}` in the returned template between `${exampleBox}` and `<div class="alias-editor">`:

```js
      ${exampleBox}
      ${reviewHtml}
      <div class="alias-editor">
```

Run: `npx jest tests/setup-ui-aliases.test.js tests/setup-ui-effective-aliases.test.js tests/setup-ui.test.js`
Expected: PASS.

- [ ] **Step 6: The remove handler — failing DOM tests first**

Append to `tests/setup-ui-alias-script-dom.test.js`:

```js
// ---------------------------------------------------------------------------
// issue 238 D1/R1 (Phase 3): the remove handler's three shapes of row. Before
// this, the non-default branch ran `delete aliasEdits[alias]`, which stages
// NOTHING -- so × on a SAVED custom alias struck the row through and the
// alias survived Finish (a silent no-op). Mutant CUSTOMDELETE: put `delete`
// back.
// ---------------------------------------------------------------------------
const { createFakeDocument } = require('./helpers/fake-dom');
const { buildAliasStateScript } = require('../electron/setup-ui-alias-state');

function loadRemoveHandler({ aliasEdits, defaultAliases, document }) {
  const aliasSrc = buildAliasScript();
  const stateSrc = buildAliasStateScript();
  const handler = aliasSrc.match(/ {2}\/\/ Alias editor: remove[\s\S]*?\n {2}\}\);/);
  const counts = aliasSrc.match(/ {2}function refreshAliasCounts\(\) \{[\s\S]*?\n {2}\}/);
  expect(handler).toBeTruthy();
  expect(counts).toBeTruthy();
  // eslint-disable-next-line no-new-func
  new Function('aliasEdits', 'defaultAliases', 'document', 'window', '$',
    `${stateSrc}\n${counts[0]}\n${handler[0]}`)(aliasEdits, defaultAliases, document, {}, (id) => document.getElementById(id));
}

function rowWith(document, { alias, model, kind, inNewRoutes = false }) {
  const group = document.createElement('details'); group.className = 'alias-group';
  if (inNewRoutes) { group.setAttribute('data-new-routes', '1'); }
  const count = document.createElement('span'); count.className = 'alias-count'; group.appendChild(count);
  const row = document.createElement('div'); row.className = 'alias-row'; row.setAttribute('data-alias', alias); row.setAttribute('data-state', 'pinned');
  const m = document.createElement('span'); m.className = 'alias-model'; m.textContent = model;
  const s = document.createElement('span'); s.className = 'alias-state alias-state-pinned'; s.textContent = 'pinned';
  const b = document.createElement('button'); b.className = 'alias-delete'; b.setAttribute('data-alias', alias); b.setAttribute('data-kind', kind); b.textContent = kind === 'unpin' ? 'unpin' : '×';
  row.appendChild(m); row.appendChild(s); row.appendChild(b);
  group.appendChild(row);
  document.body.appendChild(group);
  return { row, btn: b, group };
}

describe('alias editor remove handler (issue 238 R1)', () => {
  const defaultAliases = Object.assign(Object.create(null), { glm: 'openrouter/z-ai/glm-5.3' });

  it('× on a SAVED custom row stages null (the key is removed at Finish) and strikes the row out', () => {
    const { document } = createFakeDocument();
    const aliasEdits = Object.create(null);
    const { row, btn } = rowWith(document, { alias: 'mine', model: 'openrouter/x/y', kind: 'delete' });
    loadRemoveHandler({ aliasEdits, defaultAliases, document });
    btn.click();
    expect(aliasEdits.mine).toBeNull();                       // CUSTOMDELETE dies here
    expect(Object.prototype.hasOwnProperty.call(aliasEdits, 'mine')).toBe(true);
    expect(row.classList.contains('alias-deleted')).toBe(true);
  });

  it('[unpin] on a curated pin stages null, shows the shipped id and labels the row following — no strike-through', () => {
    const { document } = createFakeDocument();
    const aliasEdits = Object.create(null);
    const { row, btn } = rowWith(document, { alias: 'glm', model: 'openrouter/z-ai/glm-5.2', kind: 'unpin' });
    loadRemoveHandler({ aliasEdits, defaultAliases, document });
    btn.click();
    expect(aliasEdits.glm).toBeNull();
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.3');
    expect(row.getAttribute('data-state')).toBe('following');
    expect(row.classList.contains('alias-deleted')).toBe(false);
    expect(btn.hidden).toBe(true);
  });

  it('× on a row added THIS session removes the row and stages nothing (it was never on disk)', () => {
    const { document } = createFakeDocument();
    const aliasEdits = Object.assign(Object.create(null), { fresh: 'openrouter/x/new' });
    const { row, btn, group } = rowWith(document, { alias: 'fresh', model: 'openrouter/x/new', kind: 'delete', inNewRoutes: true });
    loadRemoveHandler({ aliasEdits, defaultAliases, document });
    btn.click();
    expect(Object.prototype.hasOwnProperty.call(aliasEdits, 'fresh')).toBe(false);
    expect(row.parentNode).toBeNull();
    expect(group.parentNode).toBeNull();                      // refreshAliasCounts drops the empty new-routes group
  });
});
```

Run: `npx jest tests/setup-ui-alias-script-dom.test.js`
Expected: FAIL — the handler regex finds nothing (`// Alias editor: remove` does not exist yet) and the custom row stages nothing.

- [ ] **Step 7: Rewrite the remove handler in `electron/setup-ui-alias-script.js`**

Replace the whole `// Alias editor: delete` listener with:

```js
  // Alias editor: remove (issue 238 D1/R1). "unpin" and "delete" are ONE
  // operation -- remove the key -- whose meaning the button's data-kind
  // already decided from whether the name is curated. Three shapes of row:
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.alias-delete');
    if (!btn) { return; }
    var alias = btn.getAttribute('data-alias');
    var row = btn.closest('.alias-row');
    if (!row) { return; }
    // 1. a row added THIS session (the client-side "New routes" group) was
    //    never on disk: drop the staged write and the row, stage nothing.
    if (row.closest('[data-new-routes]')) {
      if (alias) { delete aliasEdits[alias]; }
      row.remove();
      refreshAliasCounts();
      return;
    }
    if (!alias) { return; }
    // 2. a curated pin: back to FOLLOWING -- the row shows the shipped id it
    //    will resolve to; the alias still exists, so no strike-through.
    if (btn.getAttribute('data-kind') === 'unpin') { unpinAliasRow(row); return; }
    // 3. a saved custom alias: strike it out and stage the delete. Until
    //    issue 238 Phase 3 this ran `delete aliasEdits[alias]`, which stages
    //    NOTHING -- the alias survived Finish (a silent no-op).
    row.classList.add('alias-deleted');
    aliasEdits[alias] = null;
    // A3: server-rendered rows carry a heading count baked in at render time.
    refreshAliasCounts();
  });
```

In the add-custom flow, DELETE the inner listener (branch 1 above handles it):

```js
      delBtn.addEventListener('click', function() {
        var a = row.getAttribute('data-alias');
        if (a) { delete aliasEdits[a]; }
        row.remove();
        refreshAliasCounts();
      });
```

In `commitModel`, after `if (newVal && newVal !== origValue) { aliasEdits[origAlias] = newVal; }` add:

```js
        refreshAliasRowState(row); // issue 238 D1: an edit can pin a following row (or un-pin it back)
```

In `commitName`, after the `if (newVal && newVal !== origAlias) { … }` block add:

```js
        refreshAliasRowState(row);
```

Update the module docblock's second line from `delete, and add custom alias handlers.` to `remove (unpin / delete), and add custom alias handlers.` Keep `tests/setup-ui-aliases.test.js`'s A3 assertions true: `row.classList.add('alias-deleted')` must sit within 400 characters before a `refreshAliasCounts()` call (it does, in branch 3).

Run: `npx jest tests/setup-ui-alias-script-dom.test.js tests/setup-ui-aliases.test.js`
Expected: PASS. `wc -l electron/setup-ui-alias-script.js` ≤ 296.

- [ ] **Step 8: Include the fragment and the CSS**

`electron/setup-ui.js` — add the require after `buildAliasScript`:

```js
const { buildAliasStateScript } = require('./setup-ui-alias-state');
```

In `buildWizardScript`, after `const aliasJs = buildAliasScript();` add `const aliasStateJs = buildAliasStateScript();` and emit it right after `${aliasJs}`:

```js
  ${aliasJs}

  ${aliasStateJs}
```

`electron/setup-ui-styles.js` — after the `.alias-row.alias-no-key .alias-model::after { … }` rule add:

```css
  /* issue 238 D1: following / pinned per row; the remove control by kind */
  .alias-state { font-size: 10px; color: var(--text-faint); letter-spacing: 0.3px; }
  .alias-state-pinned { color: var(--accent); }
  .alias-delete[hidden] { display: none; }
  .alias-delete[data-kind="unpin"] { font-size: 10px; color: var(--text-muted); }
```

Run: `npx jest tests/setup-ui.test.js tests/electron/preload-allowlist.test.js tests/setup-ui-aliases.test.js tests/setup-ui-alias-script-dom.test.js tests/electron/setup-ui-alias-state.test.js`
Expected: PASS (the preload test extracts every `invoke('…')` from the built page — the state fragment invokes nothing).

- [ ] **Step 9: Gates + commit**

Run: `node scripts/check-file-sizes.js --all && node scripts/check-citations.js --all && npm run lint && npx jest tests/setup-ui tests/electron`
Expected: green; `wc -l electron/setup-ui-alias-script.js electron/setup-ui-aliases.js electron/setup-ui-alias-state.js` ≤ 296 / ≤ 120 / ≤ 130.

```bash
git add electron/setup-ui-alias-state.js electron/setup-ui-aliases.js electron/setup-ui-alias-script.js electron/setup-ui.js electron/setup-ui-styles.js tests/helpers/fake-dom.js tests/electron/setup-ui-alias-state.test.js tests/setup-ui-aliases.test.js tests/setup-ui-alias-script-dom.test.js
git commit -m "feat(electron): alias rows show following/pinned; [unpin] vs × remove the key (issue 238 D1/R1, T2)

Every Model Routing row carries its state (the value IS the shipped id = following) and the
right remove control: [unpin] on a curated pin (hidden while following; an edit that pins
reveals it), × on a custom alias. Both stage a key removal for Finish. Fixed: × on a SAVED
custom alias staged nothing (delete aliasEdits[alias]) so the alias survived Finish. New page
fragment setup-ui-alias-state.js carries the state rule and the staging helpers; tests run the
page functions against a small fake DOM (no jsdom).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: The "Needs review" section (`electron/setup-ui-alias-review.js`)

**Files:**
- Create: `electron/setup-ui-alias-review.js`, `tests/electron/setup-ui-alias-review.test.js`
- Modify: `electron/setup-ui.js` (pass `reviewHtml`; include the fragment), `electron/setup-ui-styles.js` (section CSS)
- Depends on: T1 (`sidecar:get-alias-review` document), T2 (`stageAliasWrite`, `aliasRowFor`, `refreshAliasRowState`, `buildAliasEditorHTML`'s `reviewHtml` option, `tests/helpers/fake-dom.js`). T4 declares `stagedDismissals`; until T4 merges this fragment declares it itself under a guard (see the code) so either merge order works.

**Interfaces:**
- Consumes: page globals `aliasEdits`, `defaultAliases`, `$`, `window.sidecarSetup.invoke`, `buildModelSelect(currentValue, cls, filterKeyword)`, `placeRowInNewRoutesGroup(row)`, `applyCatalog(info)` (setup-ui.js), T2's helpers; the T1 document.
- Produces: `buildAliasReviewHTML() → string` (skeleton: `#alias-review[hidden]` › `.alias-review-head` (`.alias-review-title` "Needs review", `#alias-review-count`, `#alias-review-refresh` ↻), `#alias-review-banner[hidden]`, `#alias-review-list`); `buildAliasReviewScript() → string` with page functions `reviewBanner(view, now)`, `candidateText(p, c)`, `proposalWhy(p)`, `freeAliasName(base)`, `appendStagedRow(name, id)`, `removeProposalRow(alias)`, `acceptProposal(p, id)`, `dismissProposal(p)`, `chooseForProposal(p, chooseBtn)`, `renderProposalRow(p, view)`, `renderAliasReview(view)`, `loadAliasReview()`; page vars `aliasReviewView`, `aliasReviewRows`.
- Row markup (client-built): `.alias-review-row[data-alias]` › `.alias-review-line` (`.alias-name`, `.alias-arrow` + `.alias-model` when `p.current`, `.alias-review-why`) + `.alias-review-actions` (one `button.alias-review-accept[data-id][data-why]` per candidate, `button.alias-review-choose`, `button.alias-review-dismiss`).

- [ ] **Step 1: Failing tests**

Create `tests/electron/setup-ui-alias-review.test.js`:

```js
'use strict';

/**
 * issue 238 D9 (Phase 3): the wizard's "Needs review" section. Pure helpers
 * are tested on data; the DOM layer runs against tests/helpers/fake-dom.js
 * with a fake `window.sidecarSetup.invoke`. Proposals are hand-built to the
 * alias-proposals.js docblock shape; `defaultAliases` is synthetic (#53).
 */

const { buildAliasReviewHTML, buildAliasReviewScript } = require('../../electron/setup-ui-alias-review');
const { buildAliasStateScript } = require('../../electron/setup-ui-alias-state');
const { buildAliasScript } = require('../../electron/setup-ui-alias-script');
const { NEW_ROUTES_GROUP_LABEL } = require('../../electron/setup-ui-alias-groups');
const { createFakeDocument } = require('../helpers/fake-dom');

const HOUR = 60 * 60 * 1000;
const DEFAULTS = { gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.3' };

const SIBLING = { alias: 'glm', state: 'pinned', current: 'openrouter/z-ai/glm-5.2', shipped: 'openrouter/z-ai/glm-5.3', curated: true,
  reasons: ['newer-sibling', 'differs-from-shipped'],
  candidates: [{ id: 'openrouter/z-ai/glm-5.4', why: 'newer-sibling', evidence: {} }, { id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }],
  dismissKey: 'glm@openrouter/z-ai/glm-5.4' };
const STALE = { alias: 'mine', state: 'pinned', current: 'openrouter/x/gone-1', shipped: null, curated: false,
  reasons: ['stale'], candidates: [{ id: 'openrouter/x/gone-2', why: 'replacement', evidence: {} }], dismissKey: 'mine@openrouter/x/gone-2' };
const NOTABLE = { alias: 'atlas', state: 'unmapped', current: null, shipped: null, curated: false,
  reasons: ['notable-unmapped'], candidates: [{ id: 'openrouter/x/atlas-1', why: 'notable', evidence: { note: 'new frontier entrant' } }], dismissKey: 'atlas@openrouter/x/atlas-1' };

const NOW = 5_000_000;
const view = (over = {}) => ({ proposals: [SIBLING], catalogAvailable: true, fetchedAt: NOW - HOUR, fresh: true,
  gatedIds: ['openrouter/z-ai/glm-5.2', 'openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-5.4', 'openrouter/z-ai/glm-4.9'], ...over });

/** Build the page: skeleton + the alias/state/review fragments, with a fake IPC. */
function loadPage({ proposals = [SIBLING], doc = view({ proposals }), rows = [], invoke } = {}) {
  const { document, body } = createFakeDocument();
  // Skeleton from the real builder, parsed into fake elements by id/class.
  const section = document.createElement('section'); section.className = 'alias-review'; section.setAttribute('id', 'alias-review'); section.hidden = true;
  const head = document.createElement('div'); head.className = 'alias-review-head';
  const count = document.createElement('span'); count.setAttribute('id', 'alias-review-count');
  const refresh = document.createElement('button'); refresh.setAttribute('id', 'alias-review-refresh');
  head.appendChild(count); head.appendChild(refresh);
  const banner = document.createElement('div'); banner.setAttribute('id', 'alias-review-banner'); banner.hidden = true;
  const list = document.createElement('div'); list.setAttribute('id', 'alias-review-list');
  section.appendChild(head); section.appendChild(banner); section.appendChild(list);
  body.appendChild(section);
  const editor = document.createElement('div'); editor.className = 'alias-editor';
  const group = document.createElement('details'); group.className = 'alias-group';
  rows.forEach(r => {
    const row = document.createElement('div'); row.className = 'alias-row'; row.setAttribute('data-alias', r.alias); row.setAttribute('data-state', r.state);
    const m = document.createElement('span'); m.className = 'alias-model'; m.textContent = r.model;
    const s = document.createElement('span'); s.className = 'alias-state'; s.textContent = r.state;
    const b = document.createElement('button'); b.className = 'alias-delete'; b.setAttribute('data-kind', r.curated ? 'unpin' : 'delete');
    row.appendChild(m); row.appendChild(s); row.appendChild(b); group.appendChild(row);
  });
  editor.appendChild(group);
  const addBtn = document.createElement('button'); addBtn.setAttribute('id', 'alias-add-btn'); editor.appendChild(addBtn);
  body.appendChild(editor);

  const calls = [];
  const sidecarSetup = { invoke: invoke || ((channel) => { calls.push(channel); return Promise.resolve(channel === 'sidecar:get-alias-review' ? doc : { models: [], fetchedAt: null }); }) };
  const window = { sidecarSetup, availableModels: [{ family: 'OpenRouter', models: [
    { id: 'openrouter/z-ai/glm-5.2', name: 'GLM 5.2' }, { id: 'openrouter/z-ai/glm-5.4', name: 'GLM 5.4' }, { id: 'openrouter/z-ai/glm-4.9', name: 'GLM 4.9' }, { id: 'openrouter/z-ai/glm-6.0-preview', name: 'GLM 6 preview' },
  ] }] };
  const aliasEdits = Object.create(null);
  const defaultAliases = Object.assign(Object.create(null), DEFAULTS);
  const aliasSrc = buildAliasScript();
  const pieces = ['filterModels', 'buildModelSelect', 'placeRowInNewRoutesGroup', 'refreshAliasCounts']
    .map(name => aliasSrc.match(new RegExp(` {2}function ${name}\\([\\s\\S]*?\\n {2}\\}`))[0]).join('\n');
  const stateSrc = buildAliasStateScript();
  const reviewSrc = buildAliasReviewScript();
  // Every function the two fragments declare is returned, so a test can reach
  // the state helpers (aliasRowFor) as well as the section's own.
  const names = [...(stateSrc + '\n' + reviewSrc).matchAll(/^ {2}function (\w+)\(/gm)].map(m => m[1]);
  const fakeCSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  // eslint-disable-next-line no-new-func
  const factory = new Function('aliasEdits', 'defaultAliases', 'document', 'window', 'CSS', '$', 'applyCatalog', 'Date', 'NEW_ROUTES_GROUP_LABEL',
    `${pieces}\n${stateSrc}\n${reviewSrc}\nreturn { ${names.join(', ')}, stagedDismissals: function() { return stagedDismissals; } };`);
  const fakeDate = { now: () => NOW };
  const fns = factory(aliasEdits, defaultAliases, document, window, fakeCSS, (id) => document.getElementById(id), () => {}, fakeDate, NEW_ROUTES_GROUP_LABEL);
  return { fns, document, section, list, count, banner, refresh, aliasEdits, calls, group };
}

const flush = () => new Promise(r => setImmediate(r));

describe('buildAliasReviewHTML', () => {
  it('is a data-free skeleton: hidden section, title, count, refresh, hidden banner, empty list', () => {
    const html = buildAliasReviewHTML();
    expect(html).toContain('<section class="alias-review" id="alias-review" hidden>');
    expect(html).toContain('Needs review');
    expect(html).toContain('id="alias-review-count"');
    expect(html).toContain('id="alias-review-refresh"');
    expect(html).toContain('<div class="alias-review-banner" id="alias-review-banner" hidden></div>');
    expect(html).toContain('<div class="alias-review-list" id="alias-review-list"></div>');
  });
});

describe('reviewBanner — why the section cannot be acted on', () => {
  const { fns } = loadPage();
  it('fresh → null; stale → the age and the rule; future → clock skew; missing → no timestamp', () => {
    expect(fns.reviewBanner(view(), NOW)).toBeNull();
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW - 3 * 24 * HOUR }), NOW)).toBe('catalog is 3 days old and could not be refreshed — accepting is disabled until ↻ succeeds (following the shipped pin is always allowed)');
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW - 25 * HOUR }), NOW)).toMatch(/^catalog is 1 day old/);
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW - 2 * HOUR }), NOW)).toMatch(/^catalog is 2 hours old/);
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW + 1 }), NOW)).toMatch(/^catalog timestamp is in the future \(clock skew\?\)/);
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: null }), NOW)).toMatch(/^no catalog timestamp/);
  });
  it('unavailable and error come first (R-P3-10)', () => {
    expect(fns.reviewBanner(view({ catalogAvailable: false, fresh: false, fetchedAt: null }), NOW)).toBe('catalog unavailable — cannot check for updates (↻ to retry)');
    expect(fns.reviewBanner(view({ error: 'disk on fire', catalogAvailable: false, fresh: false }), NOW)).toBe('could not check for updates — disk on fire');
  });
});

describe('candidateText / proposalWhy — the CLI menu\'s words', () => {
  const { fns } = loadPage();
  it('labels by why', () => {
    expect(fns.candidateText(SIBLING, SIBLING.candidates[0])).toBe('accept openrouter/z-ai/glm-5.4');
    expect(fns.candidateText(SIBLING, SIBLING.candidates[1])).toBe('follow the shipped pin (openrouter/z-ai/glm-5.3)');
    expect(fns.candidateText(STALE, STALE.candidates[0])).toBe('use openrouter/x/gone-2');
    expect(fns.candidateText(NOTABLE, NOTABLE.candidates[0])).toBe('add atlas → openrouter/x/atlas-1');
  });
  it('explains the top candidate', () => {
    expect(fns.proposalWhy(SIBLING)).toBe('newer: openrouter/z-ai/glm-5.4 · newer sibling, same tier');
    expect(fns.proposalWhy({ ...SIBLING, candidates: [SIBLING.candidates[1]] })).toBe('differs from the shipped pin openrouter/z-ai/glm-5.3');
    expect(fns.proposalWhy(STALE)).toBe('gone from the catalog · replacement: openrouter/x/gone-2');
    expect(fns.proposalWhy(NOTABLE)).toBe('new frontier entrant');
    expect(fns.proposalWhy({ ...STALE, candidates: [] })).toBe('stale');
  });
});

describe('renderAliasReview', () => {
  it('renders one row per proposal with a button per candidate, choose… and dismiss; count and visibility follow', async () => {
    const { fns, section, list, count, banner } = loadPage({ proposals: [SIBLING, STALE, NOTABLE] });
    await fns.loadAliasReview(); await flush();
    expect(section.hidden).toBe(false);
    expect(banner.hidden).toBe(true);
    expect(count.textContent).toBe('(3)');
    const rows = list.querySelectorAll('.alias-review-row');
    expect(rows.map(r => r.getAttribute('data-alias'))).toEqual(['glm', 'mine', 'atlas']);
    const glm = rows[0];
    expect(glm.querySelector('.alias-name').textContent).toBe('glm');
    expect(glm.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.2');
    expect(glm.querySelector('.alias-review-why').textContent).toBe('newer: openrouter/z-ai/glm-5.4 · newer sibling, same tier');
    const buttons = glm.querySelectorAll('.alias-review-actions button');
    expect(buttons.map(b => b.textContent)).toEqual(['✓ accept openrouter/z-ai/glm-5.4', '↩ follow the shipped pin (openrouter/z-ai/glm-5.3)', '⌄ choose…', '× dismiss']);
    expect(buttons.every(b => !b.disabled)).toBe(true);
    expect(rows[2].querySelector('.alias-model')).toBeNull();               // unmapped: no current id
    expect(rows[2].querySelectorAll('.alias-review-accept')[0].textContent).toBe('✓ add atlas → openrouter/x/atlas-1');
  });

  it('zero proposals with a catalog → hidden; no catalog → banner alone, visible (mutant SILENTNOTHING)', async () => {
    const a = loadPage({ proposals: [] });
    await a.fns.loadAliasReview(); await flush();
    expect(a.section.hidden).toBe(true);
    const b = loadPage({ doc: view({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false }) });
    await b.fns.loadAliasReview(); await flush();
    expect(b.section.hidden).toBe(false);
    expect(b.banner.hidden).toBe(false);
    expect(b.banner.textContent).toBe('catalog unavailable — cannot check for updates (↻ to retry)');
    expect(b.count.textContent).toBe('(0)');
  });

  it('a rejected invoke renders as a banner, never a throw', async () => {
    const p = loadPage({ invoke: () => Promise.reject(new Error('ipc down')) });
    await p.fns.loadAliasReview(); await flush();
    expect(p.section.hidden).toBe(false);
    expect(p.banner.textContent).toBe('could not check for updates — ipc down');
  });

  it('a proposal for an alias already staged this session is not shown (R-P3-5)', async () => {
    const p = loadPage({ proposals: [SIBLING, STALE] });
    p.aliasEdits.glm = 'openrouter/z-ai/glm-6.0-preview';
    await p.fns.loadAliasReview(); await flush();
    expect(p.list.querySelectorAll('.alias-review-row').map(r => r.getAttribute('data-alias'))).toEqual(['mine']);
    expect(p.count.textContent).toBe('(1)');
  });

  it('stale catalog: every catalog-vouched button and choose… are disabled with the banner as title; follow and dismiss stay enabled (mutant STALEACCEPT)', async () => {
    const p = loadPage({ doc: view({ proposals: [SIBLING], fresh: false, fetchedAt: NOW - 3 * 24 * HOUR }) });
    await p.fns.loadAliasReview(); await flush();
    const [accept, follow, choose, dismiss] = p.list.querySelectorAll('.alias-review-actions button');
    expect(accept.disabled).toBe(true);
    expect(accept.title).toMatch(/^catalog is 3 days old/);
    expect(follow.disabled).toBe(false);
    expect(choose.disabled).toBe(true);
    expect(dismiss.disabled).toBe(false);
    expect(p.banner.hidden).toBe(false);
  });
});

describe('acting on a proposal (everything is STAGED — R-P3-1)', () => {
  it('accept stages the id, updates the list row, removes the proposal, hides the section at zero', async () => {
    const p = loadPage({ rows: [{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: true }] });
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelector('.alias-review-accept').click();
    expect(p.aliasEdits.glm).toBe('openrouter/z-ai/glm-5.4');
    expect(p.fns.aliasRowFor('glm').querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.4');
    expect(p.fns.aliasRowFor('glm').getAttribute('data-state')).toBe('pinned');
    expect(p.group.open).toBe(true);
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
    expect(p.count.textContent).toBe('(0)');
    expect(p.section.hidden).toBe(true);
  });

  it('follow stages null (Q4) and the list row reads following', async () => {
    const p = loadPage({ rows: [{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: true }] });
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelectorAll('.alias-review-accept')[1].click();
    expect(p.aliasEdits.glm).toBeNull();
    const row = p.fns.aliasRowFor('glm');
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.3');
    expect(row.getAttribute('data-state')).toBe('following');
    expect(row.querySelector('.alias-delete').hidden).toBe(true);
  });

  it('add (notable) stages a pinned custom alias under a free name and appends a row to the New routes group', async () => {
    const p = loadPage({ proposals: [NOTABLE], rows: [{ alias: 'atlas', model: 'openrouter/other/atlas', state: 'pinned', curated: false }] });
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelector('.alias-review-accept').click();
    expect(p.aliasEdits['atlas-2']).toBe('openrouter/x/atlas-1');     // 'atlas' is taken → the CLI's numeric suffix
    expect(p.aliasEdits.atlas).toBeUndefined();
    const added = p.fns.aliasRowFor('atlas-2');
    expect(added).not.toBeNull();
    expect(added.closest('[data-new-routes]')).not.toBeNull();
    expect(added.querySelector('.alias-state').textContent).toBe('pinned');
    expect(added.querySelector('.alias-delete').getAttribute('data-kind')).toBe('delete');
  });

  it('dismiss stages the dismissKey (written by Finish) and removes the proposal (mutant DISMISSNOW: write immediately)', async () => {
    const p = loadPage();
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelector('.alias-review-dismiss').click();
    expect(p.fns.stagedDismissals()).toEqual(['glm@openrouter/z-ai/glm-5.4']);
    expect(p.calls.filter(c => c !== 'sidecar:get-alias-review')).toEqual([]);   // no IPC write
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
  });

  it('choose… offers the candidates first, then only §5-gated catalog ids (plus current and shipped); picking stages, picking current cancels (mutant UNGATEDCHOOSE)', async () => {
    const p = loadPage({ rows: [{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: true }] });
    await p.fns.loadAliasReview(); await flush();
    const actions = p.list.querySelector('.alias-review-actions');
    const chooseBtn = actions.querySelector('.alias-review-choose');
    chooseBtn.click();
    const select = actions.querySelector('.alias-review-select');
    expect(select).not.toBeNull();
    const values = select.querySelectorAll('option').map(o => o.value);
    expect(values.slice(0, 2)).toEqual(['openrouter/z-ai/glm-5.4', 'openrouter/z-ai/glm-5.3']);   // Proposed group first
    expect(values).toContain('openrouter/z-ai/glm-4.9');                                          // gated, older: offered (the user's call)
    expect(values).not.toContain('openrouter/z-ai/glm-6.0-preview');                              // in the catalog, NOT gated: pruned
    expect(values).toContain('openrouter/z-ai/glm-5.2');                                          // current: kept
    select.value = 'openrouter/z-ai/glm-5.2';
    select.dispatch('change');
    expect(actions.querySelector('.alias-review-choose')).not.toBeNull();                          // cancelled: the button is back
    expect(Object.keys(p.aliasEdits)).toEqual([]);
    actions.querySelector('.alias-review-choose').click();
    const select2 = actions.querySelector('.alias-review-select');
    select2.value = 'openrouter/z-ai/glm-4.9';
    select2.dispatch('change');
    expect(p.aliasEdits.glm).toBe('openrouter/z-ai/glm-4.9');
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
  });

  it('↻ refreshes the catalog through sidecar:refresh-catalog and re-fetches the review', async () => {
    const p = loadPage();
    await flush();                                            // the fragment's own load-time fetch
    expect(p.calls).toEqual(['sidecar:get-alias-review']);
    p.refresh.click();
    await flush(); await flush(); await flush();
    expect(p.calls.slice(1)).toEqual(['sidecar:refresh-catalog', 'sidecar:get-alias-review']);
    expect(p.refresh.disabled).toBe(false);
  });
});

describe('page hygiene', () => {
  it('the fragment carries no routing policy and no innerHTML', () => {
    const src = buildAliasReviewScript();
    expect(src).not.toContain('innerHTML');
    expect(src).not.toContain("slice('openrouter/'.length)");
    expect(src).not.toContain('openrouter/');
    expect(src).toContain("invoke('sidecar:get-alias-review')");
  });
});
```

Run: `npx jest tests/electron/setup-ui-alias-review.test.js`
Expected: FAIL — module missing.

- [ ] **Step 2: Create `electron/setup-ui-alias-review.js`**

```js
/**
 * @module electron/setup-ui-alias-review
 * The wizard's "Needs review" section (issue 238 D9): the review engine's
 * proposals rendered ABOVE the Model Routing list, so a proposal is never
 * buried in a collapsed vendor group. `buildAliasReviewHTML` is the
 * server-rendered skeleton (no data in it); `buildAliasReviewScript` is the
 * page script that fetches ONE document over IPC (`sidecar:get-alias-review`,
 * electron/ipc-aliases.js — the same `collectAliasView` the CLI list and
 * picker use) and renders it with createElement/textContent only, never
 * innerHTML: alias names, ids, notes and error text are data.
 *
 * Controls per proposal are the CLI picker's menu items (src/sidecar/
 * aliases-review-render.js :: menuFor): one button per candidate — "accept
 * <id>" (newer sibling), "follow the shipped pin (<id>)", "use <id>"
 * (replacement), "add <alias> → <id>" (notable) — then "choose…" (a <select>
 * over the §5-gated catalog ids the IPC supplies, plus the candidates, the
 * current id and the shipped id) and "dismiss" (never ask again for that
 * alias@id pair). No "skip": a proposal left alone is skipped. Every action
 * is STAGED (`aliasEdits` / `stagedDismissals`, setup-ui-alias-state.js) and
 * written by Finish through sidecar:save-config, the wizard's one sink, so
 * closing the window writes nothing.
 *
 * The §5 WRITE gate rides the document's `fresh` flag: when the catalog is
 * older than 24 h and the inline refresh failed, every candidate but
 * "follow" and the "choose…" control are disabled and the banner says why —
 * "follow" removes a key and needs no catalog. An unavailable catalog or a
 * handler error renders the section with the banner alone — never a silent
 * "nothing to review". A proposal for an alias the user already edited this
 * session is not rendered: the engine reads DISK, the page's staged edit
 * wins.
 */

'use strict';

/**
 * @returns {string} the section's HTML skeleton, inserted by
 *   setup-ui-aliases.js between the "How it works" box and the editor
 */
function buildAliasReviewHTML() {
  return `<section class="alias-review" id="alias-review" hidden>
        <div class="alias-review-head">
          <span class="alias-review-title">Needs review</span>
          <span class="alias-review-count" id="alias-review-count"></span>
          <button type="button" class="alias-review-refresh" id="alias-review-refresh" title="Refresh the model catalog and check again">&#x21bb;</button>
        </div>
        <div class="alias-review-banner" id="alias-review-banner" hidden></div>
        <div class="alias-review-list" id="alias-review-list"></div>
      </section>`;
}

/**
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildAliasReviewScript() {
  return `
  var aliasReviewView = null;                     // the last sidecar:get-alias-review document
  var aliasReviewRows = Object.create(null);      // alias -> the proposal row on screen
  // setup-ui-alias-state.js declares stagedDismissals (Task 4); until it does,
  // declare it here -- a duplicate \`var\` in one script is harmless.
  var stagedDismissals = (typeof stagedDismissals === 'undefined') ? [] : stagedDismissals;

  // Why the section cannot be acted on, or null when it can. Mirrors the CLI's
  // staleCatalogBanner (aliases-review-gate.js): error and unavailability
  // first, then the write gate's age.
  function reviewBanner(view, now) {
    if (view.error) { return 'could not check for updates \\u2014 ' + view.error; }
    if (!view.catalogAvailable) { return 'catalog unavailable \\u2014 cannot check for updates (\\u21bb to retry)'; }
    if (view.fresh) { return null; }
    var tail = ' \\u2014 accepting is disabled until \\u21bb succeeds (following the shipped pin is always allowed)';
    if (typeof view.fetchedAt !== 'number') { return 'no catalog timestamp' + tail; }
    if (view.fetchedAt > now) { return 'catalog timestamp is in the future (clock skew?)' + tail; }
    var ms = now - view.fetchedAt;
    var days = Math.floor(ms / 86400000);
    var hours = Math.max(1, Math.floor(ms / 3600000));
    var age = days >= 1 ? days + ' day' + (days === 1 ? '' : 's') : hours + ' hour' + (hours === 1 ? '' : 's');
    return 'catalog is ' + age + ' old and could not be refreshed' + tail;
  }

  // The CLI menu's words for one candidate (aliases-review-render.js :: menuFor).
  function candidateText(p, c) {
    if (c.why === 'follow') { return 'follow the shipped pin (' + c.id + ')'; }
    if (c.why === 'notable') { return 'add ' + p.alias + ' \\u2192 ' + c.id; }
    if (c.why === 'replacement') { return 'use ' + c.id; }
    return 'accept ' + c.id;
  }

  // One line on the top candidate (the CLI's "proposed" line).
  function proposalWhy(p) {
    var top = p.candidates && p.candidates[0];
    if (!top) { return (p.reasons || []).join(', '); }
    if (top.why === 'newer-sibling') { return 'newer: ' + top.id + ' \\u00b7 newer sibling, same tier'; }
    if (top.why === 'follow') { return 'differs from the shipped pin ' + top.id; }
    if (top.why === 'replacement') { return 'gone from the catalog \\u00b7 replacement: ' + top.id; }
    return (top.evidence && top.evidence.note) || 'notable model';
  }

  // A free name for a notable's suggested alias: the CLI's numeric-suffix
  // rule (aliases-review.js :: freeSuffix) over the rows on screen plus the
  // names staged this session.
  function freeAliasName(base) {
    var taken = Object.create(null);
    document.querySelectorAll('.alias-row').forEach(function(r) { var a = r.getAttribute('data-alias'); if (a) { taken[a] = true; } });
    Object.keys(aliasEdits).forEach(function(a) { if (aliasEdits[a] !== null) { taken[a] = true; } });
    if (!taken[base]) { return base; }
    var n = 2;
    while (taken[base + '-' + n]) { n += 1; }
    return base + '-' + n;
  }

  // A committed list row for an alias added by "add" (notable) -- in the
  // client-side "New routes" group, like the add-custom flow's rows.
  function appendStagedRow(name, id) {
    var row = document.createElement('div');
    row.className = 'alias-row';
    row.setAttribute('data-alias', name);
    row.setAttribute('data-state', 'pinned');
    var ns = document.createElement('span'); ns.className = 'alias-name'; ns.textContent = name;
    var arrow = document.createElement('span'); arrow.className = 'alias-arrow'; arrow.textContent = '\\u2192';
    var ms = document.createElement('span'); ms.className = 'alias-model'; ms.textContent = id;
    var st = document.createElement('span'); st.className = 'alias-state alias-state-pinned'; st.textContent = 'pinned';
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'alias-delete'; del.textContent = '\\u00d7';
    del.setAttribute('data-alias', name); del.setAttribute('data-kind', 'delete'); del.title = 'Delete this alias';
    row.appendChild(ns); row.appendChild(arrow); row.appendChild(ms); row.appendChild(st); row.appendChild(del);
    placeRowInNewRoutesGroup(row);
  }

  function removeProposalRow(alias) {
    var row = aliasReviewRows[alias];
    if (row) { row.remove(); delete aliasReviewRows[alias]; }
    var left = Object.keys(aliasReviewRows).length;
    var count = $('alias-review-count');
    if (count) { count.textContent = '(' + left + ')'; }
    var section = $('alias-review');
    var banner = $('alias-review-banner');
    if (section && left === 0 && (!banner || banner.hidden)) { section.hidden = true; }
  }

  // Accept \`id\` for proposal \`p\`: an unmapped (notable) proposal ADDS a pinned
  // alias under a free name; anything else stages the write for the alias
  // (the shipped id folds to follow -- stageAliasWrite).
  function acceptProposal(p, id) {
    if (p.state === 'unmapped') {
      var name = freeAliasName(p.alias);
      aliasEdits[name] = id;
      appendStagedRow(name, id);
    } else {
      stageAliasWrite(p.alias, id);
    }
    removeProposalRow(p.alias);
  }

  function dismissProposal(p) {
    if (p.dismissKey) { stagedDismissals.push(p.dismissKey); }
    removeProposalRow(p.alias);
  }

  // "choose…": buildModelSelect (the Step 3 picker) filtered by the alias
  // keyword, pruned to the §5-gated ids (the same set the CLI checks a typed
  // id against), keeping the candidates, the current id and -- for a curated
  // alias -- the shipped id (Q4's follow, allowed even when the catalog lacks
  // it). The candidates lead in their own group. Picking the current id cancels.
  function chooseForProposal(p, chooseBtn) {
    var select = buildModelSelect(p.current || '', 'alias-review-select', p.alias);
    var keep = Object.create(null);
    (p.candidates || []).forEach(function(c) { keep[c.id] = true; });
    if (p.current) { keep[p.current] = true; }
    if (p.curated && p.shipped) { keep[p.shipped] = true; }
    var gated = Object.create(null);
    ((aliasReviewView && aliasReviewView.gatedIds) || []).forEach(function(id) { gated[id] = true; });
    select.querySelectorAll('option').forEach(function(opt) { if (!keep[opt.value] && !gated[opt.value]) { opt.remove(); } });
    select.querySelectorAll('optgroup').forEach(function(g) { if (g.querySelectorAll('option').length === 0) { g.remove(); } });
    var proposed = document.createElement('optgroup');
    proposed.label = 'Proposed';
    (p.candidates || []).forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.id; opt.textContent = candidateText(p, c);
      proposed.appendChild(opt);
    });
    if (proposed.children.length > 0) { select.insertBefore(proposed, select.firstChild); }
    select.value = p.current || '';
    chooseBtn.replaceWith(select);
    select.focus();
    select.addEventListener('change', function() {
      var id = select.value;
      if (!id || id === p.current) { select.replaceWith(chooseBtn); return; }
      acceptProposal(p, id);
    });
    select.addEventListener('blur', function() { if (select.parentNode) { select.replaceWith(chooseBtn); } });
  }

  function renderProposalRow(p, view) {
    var row = document.createElement('div');
    row.className = 'alias-review-row';
    row.setAttribute('data-alias', p.alias);
    var line = document.createElement('div');
    line.className = 'alias-review-line';
    var name = document.createElement('span'); name.className = 'alias-name'; name.textContent = p.alias;
    line.appendChild(name);
    if (p.current) {
      var arrow = document.createElement('span'); arrow.className = 'alias-arrow'; arrow.textContent = '\\u2192';
      var cur = document.createElement('span'); cur.className = 'alias-model'; cur.textContent = p.current;
      line.appendChild(arrow); line.appendChild(cur);
    }
    var why = document.createElement('span'); why.className = 'alias-review-why'; why.textContent = proposalWhy(p);
    line.appendChild(why);
    var actions = document.createElement('div');
    actions.className = 'alias-review-actions';
    var stale = !view.fresh;
    var staleTitle = stale ? (reviewBanner(view, Date.now()) || '') : '';
    (p.candidates || []).forEach(function(c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'alias-review-accept';
      b.setAttribute('data-id', c.id); b.setAttribute('data-why', c.why);
      b.textContent = (c.why === 'follow' ? '\\u21a9 ' : '\\u2713 ') + candidateText(p, c);
      if (stale && c.why !== 'follow') { b.disabled = true; b.title = staleTitle; }
      b.addEventListener('click', function() { acceptProposal(p, c.id); });
      actions.appendChild(b);
    });
    var choose = document.createElement('button');
    choose.type = 'button'; choose.className = 'alias-review-choose'; choose.textContent = '\\u2304 choose\\u2026';
    if (stale) { choose.disabled = true; choose.title = staleTitle; }
    choose.addEventListener('click', function() { chooseForProposal(p, choose); });
    actions.appendChild(choose);
    var dismiss = document.createElement('button');
    dismiss.type = 'button'; dismiss.className = 'alias-review-dismiss'; dismiss.textContent = '\\u00d7 dismiss';
    dismiss.title = 'Never ask again about ' + (p.dismissKey || p.alias);
    dismiss.addEventListener('click', function() { dismissProposal(p); });
    actions.appendChild(dismiss);
    row.appendChild(line); row.appendChild(actions);
    return row;
  }

  // Render one document. Hidden when there is nothing to show AND nothing to say.
  function renderAliasReview(view) {
    aliasReviewView = view;
    aliasReviewRows = Object.create(null);
    var section = $('alias-review'), list = $('alias-review-list'), count = $('alias-review-count'), banner = $('alias-review-banner');
    if (!section || !list) { return; }
    while (list.firstChild) { list.firstChild.remove(); }
    var text = reviewBanner(view, Date.now());
    if (banner) { banner.textContent = text || ''; banner.hidden = !text; }
    var shown = 0;
    (view.proposals || []).forEach(function(p) {
      if (!p || typeof p.alias !== 'string') { return; }
      if (Object.prototype.hasOwnProperty.call(aliasEdits, p.alias)) { return; }   // staged this session: the page wins
      var row = renderProposalRow(p, view);
      aliasReviewRows[p.alias] = row;
      list.appendChild(row);
      shown += 1;
    });
    if (count) { count.textContent = '(' + shown + ')'; }
    section.hidden = shown === 0 && !text;
  }

  function loadAliasReview() {
    return window.sidecarSetup.invoke('sidecar:get-alias-review')
      .then(renderAliasReview)
      .catch(function(err) {
        renderAliasReview({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, gatedIds: [], error: String((err && err.message) || err) });
      });
  }

  var aliasReviewRefresh = $('alias-review-refresh');
  if (aliasReviewRefresh) {
    aliasReviewRefresh.addEventListener('click', async function() {
      aliasReviewRefresh.disabled = true;
      try {
        var info = await window.sidecarSetup.invoke('sidecar:refresh-catalog');
        applyCatalog(info);                       // Step 2's meta line and Step 3's picker see the refresh too
      } catch (_e) { /* the re-fetch below reports whatever the cache now holds */ }
      await loadAliasReview();
      aliasReviewRefresh.disabled = false;
    });
  }
  loadAliasReview();`;
}

module.exports = { buildAliasReviewHTML, buildAliasReviewScript };
```

Notes for the implementer: (1) inside the template every `\u` escape is written `\\u` so the PAGE receives `\u2014` etc. (the file's own convention — see `'\\u2192'` in setup-ui-alias-script.js); the test's `expect(...).toBe('… — …')` compares the RUNTIME strings. (2) `select.value = p.current || ''` after inserting the Proposed group re-selects the current id so the first `change` is a real pick. (3) `stagedDismissals`'s guarded `var` is removed by T4 when it lands the declaration in setup-ui-alias-state.js — if T4 merged first, delete that line here instead of keeping two.

Run: `npx jest tests/electron/setup-ui-alias-review.test.js`
Expected: PASS.

- [ ] **Step 3: Wire the section into the page + CSS**

`electron/setup-ui.js`:
- require after `buildAliasStateScript`: `const { buildAliasReviewHTML, buildAliasReviewScript } = require('./setup-ui-alias-review');`
- in `buildSetupHTML`: `const aliasHtml = buildAliasEditorHTML(aliases, { reviewHtml: buildAliasReviewHTML() });` (issue 213's `aliases` pass-through unchanged)
- in `buildWizardScript`: `const aliasReviewJs = buildAliasReviewScript();` and emit `${aliasReviewJs}` after `${aliasStateJs}`.

`electron/setup-ui-styles.js` — after the T2 block add:

```css
  /* issue 238 D9: "Needs review" section above the alias list */
  .alias-review {
    margin-top: 16px; padding: 10px 12px; background: var(--surface);
    border: 1px solid var(--accent); border-radius: var(--r-6);
  }
  .alias-review[hidden] { display: none; }
  .alias-review-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .alias-review-title {
    color: var(--accent); font-size: 11px; font-weight: 600;
    letter-spacing: 0.8px; text-transform: uppercase;
  }
  .alias-review-count { color: var(--text-faint); font-size: 11px; }
  .alias-review-refresh {
    margin-left: auto; background: none; border: 1px solid var(--border); color: var(--text-muted);
    border-radius: var(--r-4); cursor: pointer; font-size: 12px; padding: 0 6px;
  }
  .alias-review-refresh:hover { border-color: var(--accent); color: var(--accent); }
  .alias-review-banner { color: var(--text-muted); font-size: 11px; margin-bottom: 6px; }
  .alias-review-banner[hidden] { display: none; }
  .alias-review-row { padding: 6px 0; border-top: 1px solid var(--border); }
  .alias-review-row:first-child { border-top: none; }
  .alias-review-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 12px; }
  .alias-review-line .alias-model { flex: initial; white-space: normal; cursor: default; }
  .alias-review-why { color: var(--text-muted); font-size: 11px; }
  .alias-review-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .alias-review-actions button {
    background: none; border: 1px solid var(--border); color: var(--text);
    border-radius: var(--r-4); cursor: pointer; font-size: 11px; padding: 2px 8px;
    font-family: var(--font-mono);
  }
  .alias-review-actions button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .alias-review-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .alias-review-select { font-size: 11px; max-width: 100%; }
```

Run: `npx jest tests/setup-ui.test.js tests/electron/preload-allowlist.test.js tests/setup-ui-aliases.test.js tests/setup-ui-effective-aliases.test.js`
Expected: PASS (the allowlist test now sees `invoke('sidecar:get-alias-review')` and `invoke('sidecar:refresh-catalog')` in the page — both allowlisted).

- [ ] **Step 4: Gates + commit**

Run: `node scripts/check-file-sizes.js --all && node scripts/check-citations.js --all && npm run lint && npx jest tests/electron tests/setup-ui`
Expected: green; `wc -l electron/setup-ui-alias-review.js` ≤ 300 (MEASURED 279 when this plan's block was materialized and its suite run on 2026-09-15 — the T1/T2/T3 code blocks and their three suites were executed once from the plan, 43 tests green, then deleted; if a later edit pushes it over, shorten comments, never drop a guard).

```bash
git add electron/setup-ui-alias-review.js electron/setup-ui.js electron/setup-ui-styles.js tests/electron/setup-ui-alias-review.test.js
git commit -m "feat(electron): 'Needs review' section above the Model Routing list (issue 238 D9, T3)

The review engine's proposals render in the wizard with the CLI menu's controls -- accept /
follow the shipped pin / use / add, choose… over the §5-gated ids, dismiss -- every action
staged for Finish. A stale catalog disables the catalog-vouched buttons and says why; an
unavailable catalog or a handler error shows the banner, never a silent nothing-to-review.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: The wizard writes only what the user chose, and says so (issue 238 Q9 / §6.5 on Electron)

**Files:**
- Modify: `electron/setup-ui-alias-state.js` (append the Finish half), `electron/setup-ui.js` (`restoredDefault` capture; `finishPlan()` in Finish + Review; the Q9 note in `updateWritePreviews`; comment compression), `electron/setup-ui-model.js` (`.write-preview-note`), `electron/setup-ui-styles.js`
- Test: `tests/electron/setup-ui-alias-state.test.js` (extend), `tests/setup-ui.test.js` (harness extension, F11 rebinding, Q9 cases), `tests/setup-ui-model.test.js` (note span)
- Depends on: T2 (the state module + fake DOM). Independent of T3 except the shared `stagedDismissals` declaration (see T3 step 2 note (3)).

**Interfaces:**
- Consumes: `collectAliasWrites(selectedAlias, isCustomDefault)` (UNCHANGED — its harness tests keep passing), `isCuratedAlias`, page globals `defaultAliases`, `window.customDefaultModel`, the `default-model` radios.
- Produces (page-script, hoisted): `defaultWasChosen() → boolean`, `foldShippedWrites(writes) → writes` (null-prototype), `describeDefaultWrite(alias, routeId) → string`, `finishPlan() → { defaultModel, writes, dismissals }`; page vars `restoredDefault` (set by setup-ui.js's init), `defaultTouched`, `stagedDismissals` (T3 pushes into it). `sidecar:save-config` is invoked with `(plan.defaultModel, plan.writes, councilPicks, plan.dismissals)`.
- Strings (fixed here; T6 documents them): note when equal → `follows the shipped recommendation`; when different → `live flagship differs from the shipped <shippedId> — pinned`; custom alias → `pinned`. Review: `<alias> → (now follows <shippedId>)` for a curated removal, `<alias> → (deleted)` for a custom one; `N alias(es) modified, K proposal(s) dismissed`.

- [ ] **Step 1: Failing tests for the Finish half of the state fragment**

Append to `tests/electron/setup-ui-alias-state.test.js` (extend `loadStateScript` first — add the four page vars as parameters and return them):

Replace the `loadStateScript` helper with:

```js
function loadStateScript({ aliasEdits = Object.create(null), defaultAliases = DEFAULTS, document, window = {}, restoredDefault = null, defaultTouched = false, collectAliasWrites = () => Object.create(null) } = {}) {
  const src = buildAliasStateScript();
  const names = [...src.matchAll(/^ {2}function (\w+)\(/gm)].map(m => m[1]);
  expect(names).toEqual(expect.arrayContaining(['isCuratedAlias', 'aliasStateFor', 'aliasRowFor', 'stagedValueFor', 'refreshAliasRowState', 'unpinAliasRow', 'stageAliasWrite',
    'defaultWasChosen', 'foldShippedWrites', 'describeDefaultWrite', 'finishPlan']));
  // The fragment declares restoredDefault/defaultTouched/stagedDismissals itself; the
  // harness seeds them AFTER the declarations run, through the returned setters.
  // eslint-disable-next-line no-new-func
  const factory = new Function('aliasEdits', 'defaultAliases', 'document', 'window', 'collectAliasWrites',
    `${src}\nreturn { ${names.join(', ')}, set: function(k, v) { if (k === 'restoredDefault') { restoredDefault = v; } if (k === 'defaultTouched') { defaultTouched = v; } if (k === 'stagedDismissals') { stagedDismissals = v; } }, stagedDismissals: function() { return stagedDismissals; } };`);
  const defaults = Object.assign(Object.create(null), defaultAliases);
  const doc = document || { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
  const fns = factory(aliasEdits, defaults, doc, window, collectAliasWrites);
  fns.set('restoredDefault', restoredDefault);
  fns.set('defaultTouched', defaultTouched);
  return { fns, aliasEdits };
}
```

(The existing T2 tests pass `document` from `pageWith`; `createFakeDocument`'s document has `addEventListener`, so the fragment's two listeners register without effect.)

Append the new describes:

```js
describe('defaultWasChosen — Q9: a restored default is not a choice (R-P3-6)', () => {
  const radio = (value) => ({ querySelector: (sel) => (sel === 'input[name="default-model"]:checked' ? { value } : null), querySelectorAll: () => [], addEventListener: () => {} });
  it('restored and untouched → false; a different radio → true; touched → true; fresh config (nothing restored) → true (mutant RESTOREDWRITE)', () => {
    expect(loadStateScript({ document: radio('gemini'), restoredDefault: 'gemini' }).fns.defaultWasChosen()).toBe(false);
    expect(loadStateScript({ document: radio('deepseek'), restoredDefault: 'gemini' }).fns.defaultWasChosen()).toBe(true);
    expect(loadStateScript({ document: radio('gemini'), restoredDefault: 'gemini', defaultTouched: true }).fns.defaultWasChosen()).toBe(true);
    expect(loadStateScript({ document: radio('gemini'), restoredDefault: null }).fns.defaultWasChosen()).toBe(true);
    expect(loadStateScript({ document: radio(undefined), restoredDefault: 'gemini' }).fns.defaultWasChosen()).toBe(true); // a radio with no value is still "not the restored one"
  });
  it('the page listeners flip defaultTouched on a radio change, a drill-down change and a route-pill click', () => {
    const { document } = createFakeDocument();
    const { fns } = loadStateScript({ document, restoredDefault: 'gemini' });
    const r = document.createElement('input'); r.name = 'default-model'; document.body.appendChild(r);
    expect(fns.defaultWasChosen()).toBe(false);
    r.dispatch('change');
    expect(fns.defaultWasChosen()).toBe(true);
    const { document: d2 } = createFakeDocument();
    const { fns: f2 } = loadStateScript({ document: d2, restoredDefault: 'gemini' });
    const pill = d2.createElement('span'); pill.className = 'route-pill'; d2.body.appendChild(pill);
    pill.click();
    expect(f2.defaultWasChosen()).toBe(true);
    const { document: d3 } = createFakeDocument();
    const { fns: f3 } = loadStateScript({ document: d3, restoredDefault: 'gemini' });
    const sel = d3.createElement('select'); sel.className = 'model-pick'; d3.body.appendChild(sel);
    sel.dispatch('change');
    expect(f3.defaultWasChosen()).toBe(true);
  });
});

describe('foldShippedWrites — Q4 applied to a write map (mutant FOLD: return writes unchanged)', () => {
  const { fns } = loadStateScript();
  it('a curated write equal to the shipped id becomes null; other writes pass through; the result is null-prototype', () => {
    const out = fns.foldShippedWrites({ gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.4', mine: 'openrouter/x/y', gone: null });
    expect(out.gemini).toBeNull();
    expect(out.glm).toBe('openrouter/z-ai/glm-5.4');
    expect(out.mine).toBe('openrouter/x/y');
    expect(out.gone).toBeNull();
    expect(Object.getPrototypeOf(out)).toBeNull();
  });
});

describe('describeDefaultWrite — the Step 2 announcement names both ids (§6.5)', () => {
  const { fns } = loadStateScript();
  it('equal → follows; different → live flagship + the shipped id + pinned; custom → pinned; empty → empty', () => {
    expect(fns.describeDefaultWrite('gemini', 'google/gemini-x')).toBe('follows the shipped recommendation');
    expect(fns.describeDefaultWrite('gemini', 'google/gemini-y')).toBe('live flagship differs from the shipped google/gemini-x — pinned');
    expect(fns.describeDefaultWrite('mine', 'openrouter/x/y')).toBe('pinned');
    expect(fns.describeDefaultWrite('gemini', '')).toBe('');
    expect(fns.describeDefaultWrite('gemini', null)).toBe('');
  });
});

describe('finishPlan — one computation for the Review step and the Finish button', () => {
  const radio = (value) => ({ querySelector: (sel) => (sel === 'input[name="default-model"]:checked' ? (value ? { value } : null) : null), querySelectorAll: () => [], addEventListener: () => {} });
  it('a restored, untouched default hands collectAliasWrites NO selected alias; a chosen one hands it the radio', () => {
    const collect = jest.fn(() => Object.create(null));
    loadStateScript({ document: radio('gemini'), restoredDefault: 'gemini', collectAliasWrites: collect }).fns.finishPlan();
    expect(collect).toHaveBeenCalledWith(null, false);
    loadStateScript({ document: radio('gemini'), restoredDefault: null, collectAliasWrites: collect }).fns.finishPlan();
    expect(collect).toHaveBeenLastCalledWith('gemini', false);
  });
  it('a custom (searched) default skips the selected-alias stage and is the defaultModel', () => {
    const collect = jest.fn(() => Object.create(null));
    const plan = loadStateScript({ document: radio(null), window: { customDefaultModel: 'openrouter/x/searched' }, collectAliasWrites: collect }).fns.finishPlan();
    expect(collect).toHaveBeenCalledWith(null, true);
    expect(plan.defaultModel).toBe('openrouter/x/searched');
  });
  it('folds the writes and copies the staged dismissals', () => {
    const collect = () => Object.assign(Object.create(null), { gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.4' });
    const { fns } = loadStateScript({ document: radio('gemini'), restoredDefault: null, collectAliasWrites: collect });
    fns.stagedDismissals().push('glm@openrouter/z-ai/glm-5.4');
    const plan = fns.finishPlan();
    expect(plan.defaultModel).toBe('gemini');
    expect(plan.writes.gemini).toBeNull();
    expect(plan.writes.glm).toBe('openrouter/z-ai/glm-5.4');
    expect(plan.dismissals).toEqual(['glm@openrouter/z-ai/glm-5.4']);
    plan.dismissals.push('x@y');
    expect(fns.stagedDismissals()).toHaveLength(1);   // a copy, not the live list
  });
});
```

Run: `npx jest tests/electron/setup-ui-alias-state.test.js`
Expected: FAIL — the four functions do not exist.

- [ ] **Step 2: Append the Finish half to `electron/setup-ui-alias-state.js`**

Update the docblock's first sentence: replace `and — Task 4 appends this half — what Finish writes for the Step 2 default (issue 238 Q9)` with `and what Finish writes for the Step 2 default (issue 238 Q9: only what the user actively CHOSE this session, folded through Q4's encoding, announced with both ids)`. Then, inside the template string, after `stageAliasWrite` (before the closing backtick), append:

```js

  // ---- issue 238 Q9: what Finish writes for the Step 2 default ----
  var restoredDefault = null;     // cfg.default as restored by init (setup-ui.js), null on a fresh config
  var defaultTouched = false;     // a radio / route-pill / drill-down interaction happened this session
  var stagedDismissals = [];      // "never ask again" keys the review section staged; Finish writes them

  document.addEventListener('change', function(e) {
    var t = e.target;
    if (t && (t.name === 'default-model' || (t.closest && t.closest('.model-pick')))) { defaultTouched = true; }
  });
  document.addEventListener('click', function(e) {
    if (e.target && e.target.closest && e.target.closest('.route-pill')) { defaultTouched = true; }
  });

  // The default was CHOSEN this session when the user touched Step 2's
  // controls, or the checked radio is not the one init restored -- a fresh
  // config restores nothing, so its auto-checked card counts, and its
  // write-preview announces the pin. A restored, untouched default is not a
  // choice: the wizard writes only what the user actively chose (Q9).
  function defaultWasChosen() {
    if (defaultTouched) { return true; }
    var r = document.querySelector('input[name="default-model"]:checked');
    return !!r && r.value !== restoredDefault;
  }

  // Q4's encoding over a whole write map: a write equal to the shipped id
  // becomes null (remove the key = follow). saveConfig would normalize it
  // away anyway; folding HERE keeps the Review step truthful -- "(now
  // follows …)" or nothing, never "1 alias(es) modified" for a write that
  // leaves disk unchanged.
  function foldShippedWrites(writes) {
    var out = Object.create(null);
    Object.keys(writes).forEach(function(alias) {
      var v = writes[alias];
      out[alias] = (typeof v === 'string' && isCuratedAlias(alias) && v === defaultAliases[alias]) ? null : v;
    });
    return out;
  }

  // The Step 2 announcement (Q9, spec §6.5): both ids when the live pick
  // differs from the shipped pin -- the readline wizard's sentence.
  function describeDefaultWrite(alias, routeId) {
    if (!routeId) { return ''; }
    if (!isCuratedAlias(alias)) { return 'pinned'; }
    if (routeId === defaultAliases[alias]) { return 'follows the shipped recommendation'; }
    return 'live flagship differs from the shipped ' + defaultAliases[alias] + ' \\u2014 pinned';
  }

  // Everything Finish sends, computed ONE way for the Review step and the
  // Finish button (F4: the review must never under-report the write).
  // collectAliasWrites is unchanged: it gets NO selected alias when the
  // default was merely restored, so its Step 2 stage does not run.
  function finishPlan() {
    var r = document.querySelector('input[name="default-model"]:checked');
    var isCustom = !!window.customDefaultModel;
    var selected = (!isCustom && r && defaultWasChosen()) ? r.value : null;
    return {
      defaultModel: window.customDefaultModel || (r ? r.value : null),
      writes: foldShippedWrites(collectAliasWrites(selected, isCustom)),
      dismissals: stagedDismissals.slice(),
    };
  }
```

If T3 merged first, delete its guarded `var stagedDismissals = (typeof stagedDismissals === 'undefined') ? [] : stagedDismissals;` line in `setup-ui-alias-review.js` now (one declaration, here).

Run: `npx jest tests/electron/setup-ui-alias-state.test.js`
Expected: PASS. `wc -l electron/setup-ui-alias-state.js` ≤ 200.

- [ ] **Step 3: Wire `electron/setup-ui.js` (failing tests first — see Step 4; the edits and the tests are one commit)**

(a) Init — inside the `sidecar:get-config` callback, make `restoredDefault = cfg.default;` the first statement of `if (cfg && cfg.default) {` with the comment `// issue 238 Q9: a RESTORED default is not a choice (setup-ui-alias-state.js :: defaultWasChosen)`.

(b) `buildReview` — replace everything from `// F4: mirror the EXACT call Finish makes` down to the closing `}` of the function with:

```js
    // F4 + N1 (council review, PR 196) + issue 238 Q9: the Review step must
    // show EXACTLY what Finish sends, so both call finishPlan() (setup-ui-
    // alias-state.js) -- collectAliasWrites gated on a CHOSEN default and
    // folded through Q4's encoding -- and this screen shows only entries that
    // differ from what is on disk (savedAliases), because a value-identical
    // re-write is the normal case on a plain reopen and must not read as
    // "N alias(es) modified" on the one screen with no confirmation after it.
    // N-b: a key absent from savedAliases reads as null, so a removal of a
    // never-saved key compares equal to "still absent".
    var plan = finishPlan();
    var aliasWritesPreview = plan.writes;
    // T3: keyed by user alias names -- null-prototype (see aliasEdits above)
    var changedWrites = Object.create(null);
    Object.keys(aliasWritesPreview).forEach(function(alias) {
      var oldVal = Object.prototype.hasOwnProperty.call(savedAliases, alias) ? savedAliases[alias] : null;
      if (aliasWritesPreview[alias] !== oldVal) {
        changedWrites[alias] = aliasWritesPreview[alias];
      }
    });
    var writes = Object.keys(changedWrites).map(function(alias) {
      var val = changedWrites[alias];
      // issue 238 D1: a removed key means "follows" for a curated name, "deleted" for a custom one.
      return alias + ' \\u2192 ' + (val === null ? (isCuratedAlias(alias) ? '(now follows ' + defaultAliases[alias] + ')' : '(deleted)') : val);
    });
    document.getElementById('review-routing').textContent =
      writes.length > 0 ? writes.join(', ') : 'No alias changes';
    var editCount = Object.keys(changedWrites).length;
    var reviewAliases = document.getElementById('review-aliases');
    if (reviewAliases) {
      reviewAliases.textContent = (editCount > 0 ? editCount + ' alias(es) modified' : 'No changes') +
        (plan.dismissals.length > 0 ? ', ' + plan.dismissals.length + ' proposal(s) dismissed' : '');
    }
  }
```

(c) Finish handler — replace its `try` body with:

```js
    try {
      var plan = finishPlan();   // issue 238 Q9: the same computation the Review step showed
      await window.sidecarSetup.invoke('sidecar:save-config', plan.defaultModel, plan.writes, (window.collectCouncilPicks && window.collectCouncilPicks()) || [], plan.dismissals);
      var kc = Object.values(configuredKeys).filter(function(v) { return v; }).length;
      await window.sidecarSetup.invoke('sidecar:setup-done', plan.defaultModel, kc);
    } catch (_e) { finishBtn.disabled = false; finishBtn.textContent = 'Finish'; }
```

(d) `updateWritePreviews` — after `if (idEl && routeId) { idEl.textContent = routeId; }` add:

```js
      // issue 238 Q9: name the shipped id when the live pick differs from it.
      var noteEl = el.querySelector('.write-preview-note');
      if (noteEl) { noteEl.textContent = describeDefaultWrite(alias, routeId); }
```

(e) Compress the `collectAliasWrites` preamble (the block starting `// issue 138 (fix round 1, Finding 1; precedence description corrected in` down to the line before `function collectAliasWrites(`) to this — same facts, current rule:

```js
  // issue 138 (fix round 1 F1; R6a; N2) + issue 238 Q9: assemble aliasWrites.
  // The aliasEdits overlay (Step 3, incl. the review section) comes first.
  // THEN, only for a checked quick-pick default that finishPlan() handed us
  // (isCustomDefault=false AND selectedAlias non-null -- null means the
  // default was merely restored, not chosen, and its Step 2 stage must not
  // run), the selected alias's resolved route -- the ONE place clobbering an
  // aliasEdits entry is permitted (user-locked decision #2). Then every
  // OTHER alias whose drill-down <select> fired change (or that F3's init
  // restore seeded from cfg.aliases -- the normal reopen case, a
  // value-identical write), written only when Step 3 left it untouched
  // (hasOwnProperty, not `in`: aliasEdits[alias] === null is a MEANINGFUL
  // delete). finishPlan folds the result through Q4's encoding; buildReview
  // hides value-identical entries.
```

`wc -l electron/setup-ui.js` must print ≤ 808.

- [ ] **Step 4: The `tests/setup-ui.test.js` sweep — three harnesses grow one dependency set; F11 rebinds; new Q9 cases**

(i) `extractBuildReview` — replace it with:

```js
    function extractBuildReview() {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const pickRouteForMatch = script.match(/function pickRouteFor\(mc\) \{[\s\S]*?\n {2}\}/);
      const collectMatch = script.match(/function collectAliasWrites\([^)]*\) \{[\s\S]*?\n {2}\}/);
      const buildReviewMatch = script.match(/function buildReview\(\) \{[\s\S]*?\n {2}\}/);
      // issue 238 Q9: buildReview now reads finishPlan() (setup-ui-alias-state.js).
      const stateFns = ['isCuratedAlias', 'defaultWasChosen', 'foldShippedWrites', 'finishPlan']
        .map(name => script.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n {2}\\}`)));
      expect(pickRouteForMatch).toBeTruthy();
      expect(collectMatch).toBeTruthy();
      expect(buildReviewMatch).toBeTruthy();
      stateFns.forEach(m => expect(m).toBeTruthy());
      // eslint-disable-next-line no-new-func
      const build = new Function(
        'routingChoices', 'configuredKeys', 'explicitRouteChoices',
        'modelChoiceIds', 'modelOpenrouterIds', 'aliasEdits', 'modelChoicesData',
        'savedAliases', 'document', 'window',
        'defaultAliases', 'restoredDefault', 'defaultTouched', 'stagedDismissals',
        `${pickRouteForMatch[0]}\n${collectMatch[0]}\n${stateFns.map(m => m[0]).join('\n')}\n${buildReviewMatch[0]}\nreturn buildReview;`
      );
      return (opts = {}) => build(
        opts.routingChoices || {}, opts.configuredKeys || {}, opts.explicitRouteChoices || {},
        opts.modelChoiceIds || {}, opts.modelOpenrouterIds || {},
        opts.aliasEdits || {}, opts.modelChoicesData || [],
        opts.savedAliases || {}, opts.document, opts.window,
        Object.assign(Object.create(null), opts.defaultAliases || {}),
        opts.restoredDefault === undefined ? null : opts.restoredDefault,
        !!opts.defaultTouched, opts.stagedDismissals || []
      );
    }
```

Every existing test in that describe keeps its semantics: `restoredDefault` defaults to `null` (nothing restored → the checked radio counts as chosen, as before) and `defaultAliases` to `{}` (nothing folds).

(ii) `extractUpdateWritePreviews` — replace it with:

```js
  function extractUpdateWritePreviews() {
    const script = localHtml.match(/<script>([\s\S]*)<\/script>/)[1];
    const pickRouteForMatch = script.match(/function pickRouteFor\(mc\) \{[\s\S]*?\n {2}\}/);
    const updateMatch = script.match(/function updateWritePreviews\(\) \{[\s\S]*?\n {2}\}/);
    // issue 238 Q9: the note text comes from describeDefaultWrite (setup-ui-alias-state.js).
    const noteFns = ['isCuratedAlias', 'describeDefaultWrite'].map(name => script.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n {2}\\}`)));
    expect(pickRouteForMatch).toBeTruthy();
    expect(updateMatch).toBeTruthy();
    noteFns.forEach(m => expect(m).toBeTruthy());
    // eslint-disable-next-line no-new-func
    const build = new Function(
      'routingChoices', 'configuredKeys', 'explicitRouteChoices',
      'modelChoiceIds', 'modelOpenrouterIds', 'modelChoicesData', 'document', 'window', 'defaultAliases',
      `${pickRouteForMatch[0]}\n${noteFns.map(m => m[0]).join('\n')}\n${updateMatch[0]}\nreturn updateWritePreviews;`
    );
    return (opts = {}) => build(
      opts.routingChoices || {}, opts.configuredKeys || {}, opts.explicitRouteChoices || {},
      opts.modelChoiceIds || {}, opts.modelOpenrouterIds || {},
      opts.modelChoicesData || [], opts.document, opts.window,
      Object.assign(Object.create(null), opts.defaultAliases || {})
    );
  }
```

(`isCuratedAlias` is a one-line function in the fragment: `function isCuratedAlias(alias) { return …; }` — the `[\s\S]*?\n {2}\}` regex still needs a two-space-indented closing brace on its own line, so write that function in the fragment on THREE lines (`function isCuratedAlias(alias) {` / `    return Object.prototype.hasOwnProperty.call(defaultAliases, alias);` / `  }`) — T2's implementer: use the three-line form from the start.)

(iii) F11 — replace the two `expect(call)` lines with:

```js
    expect(call).toMatch(/\bfinishPlan\(/);
    expect(call).toMatch(/sidecar:save-config['"],\s*plan\.defaultModel,\s*plan\.writes,[\s\S]*?plan\.dismissals\)/);
```

and add a sibling test in the same describe:

```js
  test('finishPlan is bound to collectAliasWrites — the stand-in-constant mutant still fails', () => {
    const html = buildSetupHTML();
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    const planSrc = script.match(/function finishPlan\(\) \{[\s\S]*?\n {2}\}/)[0];
    expect(planSrc).toMatch(/foldShippedWrites\(collectAliasWrites\(selected, isCustom\)\)/);
    expect(planSrc).toContain('defaultWasChosen()');
  });
```

(iv) New describe (a sibling of the F11 block, reusing `extractBuildReview`'s pattern — put it inside the describe that owns `extractBuildReview`):

```js
    describe('issue 238 Q9: the wizard writes only what the user chose, and says so', () => {
      const els = () => ({ 'review-keys': fakeEl(), 'review-model': fakeEl(), 'review-routing': fakeEl(), 'review-aliases': fakeEl() });
      const docWith = (e, radioValue) => ({ getElementById: (id) => e[id], querySelector: () => (radioValue ? { value: radioValue } : null) });

      it('a RESTORED, untouched default writes nothing for its alias (mutant RESTOREDWRITE)', () => {
        const e = els();
        extractBuildReview()({ modelChoicesData: twoCardData, savedAliases: {}, document: docWith(e, 'gemini'), window: { customDefaultModel: null }, restoredDefault: 'gemini' })();
        expect(e['review-routing'].textContent).toBe('No alias changes');
      });
      it('a CHOSEN default (touched) writes its live route — as before', () => {
        const e = els();
        extractBuildReview()({ modelChoicesData: twoCardData, savedAliases: {}, document: docWith(e, 'gemini'), window: { customDefaultModel: null }, restoredDefault: 'gemini', defaultTouched: true })();
        expect(e['review-routing'].textContent).toBe('gemini → google/gemini-x');
      });
      it('a live pick EQUAL to the shipped pin folds to follow and is not a change when the alias already follows (mutant FOLD)', () => {
        const e = els();
        extractBuildReview()({ modelChoicesData: twoCardData, savedAliases: {}, document: docWith(e, 'gemini'), window: { customDefaultModel: null }, defaultAliases: { gemini: 'google/gemini-x' } })();
        expect(e['review-routing'].textContent).toBe('No alias changes');
      });
      it('…and reads "(now follows …)" when it clears an old pin; a custom removal reads "(deleted)"; dismissals are counted', () => {
        const e = els();
        extractBuildReview()({
          modelChoicesData: twoCardData, savedAliases: { gemini: 'google/gemini-old', mine: 'openrouter/x/y' },
          aliasEdits: { mine: null }, document: docWith(e, 'gemini'), window: { customDefaultModel: null },
          defaultAliases: { gemini: 'google/gemini-x' }, stagedDismissals: ['glm@openrouter/z-ai/glm-5.4'],
        })();
        expect(e['review-routing'].textContent).toBe('mine → (deleted), gemini → (now follows google/gemini-x)');
        expect(e['review-aliases'].textContent).toBe('2 alias(es) modified, 1 proposal(s) dismissed');
      });
      it('a drill-down pick still pins (§6.5), chosen or not', () => {
        const e = els();
        extractBuildReview()({ modelChoicesData: twoCardData, modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' }, savedAliases: {}, document: docWith(e, 'gemini'), window: { customDefaultModel: null }, restoredDefault: 'gemini' })();
        expect(e['review-routing'].textContent).toBe('deepseek → deepseek/deepseek-r1');
      });
    });
```

(The order `mine → (deleted), gemini → …` follows `collectAliasWrites`: the aliasEdits overlay is copied first, then the selected alias — if the implementation yields the other order, assert with `toContain` on both fragments rather than reordering the code.)

(v) `updateWritePreviews` note — in the describe that owns `extractUpdateWritePreviews`, add:

```js
  test('issue 238 Q9: the selected card\'s note names the shipped id when the live pick differs, or says it follows', () => {
    const notes = {};
    const previewEl = (alias) => ({
      getAttribute: (n) => (n === 'data-alias' ? alias : null),
      classList: { toggle: () => {} },
      querySelector: (sel) => (sel === '.write-preview-note' ? (notes[alias] = notes[alias] || { textContent: '' }) : { textContent: '' }),
    });
    const fakeDocument = {
      querySelector: () => ({ value: 'gemini' }),
      querySelectorAll: (selector) => (selector === '.write-preview' ? [previewEl('gemini'), previewEl('deepseek')] : []),
    };
    const run = (defaultAliases) => extractUpdateWritePreviews()({ modelChoicesData: twoCardData, document: fakeDocument, window: { customDefaultModel: null }, defaultAliases })();
    run({ gemini: 'google/gemini-x' });
    expect(notes.gemini.textContent).toBe('follows the shipped recommendation');
    run({ gemini: 'google/gemini-old' });
    expect(notes.gemini.textContent).toBe('live flagship differs from the shipped google/gemini-old — pinned');
    expect(notes.deepseek).toBeUndefined();   // only the selected card gets a note
  });
```

Run: `npx jest tests/setup-ui.test.js`
Expected: PASS after Step 3's edits (before them, the harness assertions on the four state functions fail — that is the failing-first evidence for this step).

- [ ] **Step 5: The note span + CSS**

`electron/setup-ui-model.js` — change the write-preview line to:

```js
        <span class="write-preview" data-alias="${escapedAlias}">will set <code>${escapedAlias}</code> → <code class="write-preview-id">${escapedPreviewId}</code> <span class="write-preview-note"></span></span>
```

and add to `tests/setup-ui-model.test.js` beside the `'renders the resolved model id and a write-preview per row'` test:

```js
    test('issue 238 Q9: each write-preview carries an empty note span the page fills from describeDefaultWrite', () => {
      const html = buildModelStepHTML(choices);
      expect((html.match(/<span class="write-preview-note"><\/span>/g) || []).length).toBe(choices.length);
    });
```

(`choices` is whatever that describe already renders with — read it and reuse the same variable.)

`electron/setup-ui-styles.js` — after the T3 block:

```css
  .write-preview-note { color: var(--text-muted); font-size: 11px; margin-left: 4px; }
```

Run: `npx jest tests/setup-ui-model.test.js tests/setup-ui.test.js tests/electron/setup-ui-alias-state.test.js tests/electron/setup-ui-alias-review.test.js`
Expected: PASS.

- [ ] **Step 6: Gates + commit**

Run: `node scripts/check-file-sizes.js --all && node scripts/check-citations.js --all && npm run lint && npx jest tests/setup-ui tests/electron && wc -l electron/setup-ui.js`
Expected: green; `electron/setup-ui.js` ≤ 808.

```bash
git add electron/setup-ui-alias-state.js electron/setup-ui.js electron/setup-ui-model.js electron/setup-ui-styles.js tests/electron/setup-ui-alias-state.test.js tests/setup-ui.test.js tests/setup-ui-model.test.js
git commit -m "feat(electron): the wizard writes only a CHOSEN default's live pick, and announces it (issue 238 Q9, T4)

A restored, untouched default no longer re-pins its alias to the live flagship on Finish;
a chosen one is written only when the live pick differs from the shipped pin, folded through
Q4's encoding (the shipped id = follow), and the Step 2 card says which -- 'follows the
shipped recommendation' or 'live flagship differs from the shipped <id> -- pinned'. The
Review step and the Finish button read one finishPlan(), which also carries the review
section's staged dismissals to sidecar:save-config.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: `amicus aliases --ui` — open the setup window on the Routing step

**Files:**
- Modify: `src/sidecar/aliases.js :: handleAliases` (the `--ui` branch), `src/sidecar/setup-window.js :: launchSetupWindow` (`{ pane }` → `AMICUS_SETUP_PANE`), `electron/main.js :: createSetupWindow` (`initialPane`), `electron/setup-ui.js` (`initialPane` → `INITIAL_STEP` → `showStep`), `src/cli.js` (help)
- Test: `tests/sidecar/aliases-command.test.js`, `tests/sidecar/setup-window.test.js`, `tests/setup-ui.test.js`, `tests/electron/main-setup-pane-wiring.test.js` (new)

**Interfaces:**
- Consumes: `src/sidecar/aliases.js :: normalizeOnEntry(d)` (D6 on-entry normalization), `setup-window.js :: launchSetupWindow` → `{ success, error?, default?, keyCount? }`, `cli.js` `BOOLEAN_FLAGS` (already has `'ui'`).
- Produces: `launchSetupWindow({ pane: 'aliases' })` sets `AMICUS_SETUP_PANE=aliases` in the child env (any other value → `''`); `main.js` passes `initialPane: process.env.AMICUS_SETUP_PANE || ''` into `buildSetupHTML`; the page declares `var INITIAL_STEP = 3;` (else `1`) and, as the LAST statement of the wizard script, `if (INITIAL_STEP !== 1) { showStep(INITIAL_STEP); }`. CLI contract (R-P3-12): success → stdout `Aliases saved.`, exit 0; not completed / launch failure → stderr reason, exit 1; `--ui` + (`--json` | `--review` | `--owner` | `--unpin`) → stderr `Error: --ui opens the setup window at the Routing step; it cannot be combined with --json, --review, --owner or --unpin`, exit 1.

- [ ] **Step 1: Failing CLI tests**

Append to `tests/sidecar/aliases-command.test.js` (top level, after the existing describes; it builds its own hermetic dir like the others):

```js
describe('amicus aliases --ui (#238 D4, Phase 3)', () => {
  let launch, cfg, handleAliases;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(os.tmpdir(), `amicus-aliases-ui-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    launch = jest.fn(async () => ({ success: true }));
    jest.doMock('../../src/sidecar/setup-window', () => ({ launchSetupWindow: launch }));
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalogInfo: jest.fn(async () => ({ models: [], fetchedAt: null, providerFailures: [] })),
      readCache: jest.fn(() => null),
      DEFAULT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    }));
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfg = require('../../src/utils/config');
    ({ handleAliases } = require('../../src/sidecar/aliases'));
  });
  afterEach(() => {
    process.stderr.write.mockRestore();
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    jest.dontMock('../../src/sidecar/setup-window');
  });

  test('opens the setup window on the Routing step and reports the save', async () => {
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], ui: true }));
    expect(launch).toHaveBeenCalledWith({ pane: 'aliases' });
    expect(code).toBe(0);
    expect(out).toBe('Aliases saved.\n');
  });

  test('closed without Finish / launch failure: the reason on stderr, exit 1 (R-P3-12)', async () => {
    launch.mockResolvedValueOnce({ success: false, error: 'Setup window closed without completing' });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], ui: true }));
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(process.stderr.write).toHaveBeenCalledWith('Setup window closed without completing\n');
  });

  test.each([
    [{ ui: true, json: true }], [{ ui: true, review: true }], [{ ui: true, review: true, owner: true }], [{ ui: true, unpin: 'glm' }],
  ])('%o is an argument error: nothing launched, exit 1', async (flags) => {
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], ...flags }));
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(launch).not.toHaveBeenCalled();
    expect(process.stderr.write).toHaveBeenCalledWith('Error: --ui opens the setup window at the Routing step; it cannot be combined with --json, --review, --owner or --unpin\n');
  });

  test('normalizes the config on entry like every aliases form (D6) BEFORE the window opens (mutant UINORMALIZE)', async () => {
    const shipped = cfg.getDefaultAliases();
    const [alias] = Object.keys(shipped);
    const file = path.join(process.env.AMICUS_CONFIG_DIR, 'config.json');
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ default: alias, aliases: { [alias]: shipped[alias] } }, null, 2));
    launch.mockImplementationOnce(async () => {
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).aliases[alias]).toBeUndefined();   // already gone when the window opens
      return { success: true };
    });
    const { code } = await captureStdout(() => handleAliases({ _: ['aliases'], ui: true }));
    expect(code).toBe(0);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx jest tests/sidecar/aliases-command.test.js -t "aliases --ui"`
Expected: FAIL — `--ui` falls through to the list (exit 0, list output).

- [ ] **Step 2: Implement the branch in `src/sidecar/aliases.js :: handleAliases`**

Insert as the FIRST statements of `handleAliases` (before the `--owner requires --review` check):

```js
  if (args.ui) {
    // #238 D4: `--ui` opens the Electron setup window on the Routing step --
    // the same alias editor, with the "Needs review" section (electron/
    // setup-ui-alias-review.js). Interactive-only, so it combines with none
    // of the machine or terminal forms (R-P3-12).
    if (args.json || args.review || args.owner || args.unpin !== undefined) {
      process.stderr.write('Error: --ui opens the setup window at the Routing step; it cannot be combined with --json, --review, --owner or --unpin\n');
      return 1;
    }
    normalizeOnEntry(loadDeps());                     // D6: every `amicus aliases` form normalizes on entry
    const { launchSetupWindow } = require('./setup-window');
    const res = await launchSetupWindow({ pane: 'aliases' });
    if (!res || !res.success) {
      process.stderr.write(`${(res && res.error) || 'Setup window closed without completing'}\n`);
      return 1;
    }
    process.stdout.write('Aliases saved.\n');
    return 0;
  }
```

Add the form to the module docblock's list: `*   amicus aliases --ui       open the setup window on the Routing step (the same editor, plus the "Needs review" section)`.

Run: `npx jest tests/sidecar/aliases-command.test.js`
Expected: PASS. `wc -l src/sidecar/aliases.js` ≤ 292.

- [ ] **Step 3: The launcher's env token — failing test first**

In `tests/sidecar/setup-window.test.js`, add inside `describe('setup-window')`:

```js
  it('#238 D4: launchSetupWindow({ pane: "aliases" }) lands the window on the Routing step via AMICUS_SETUP_PANE', async () => {
    const promise = launchSetupWindow({ pane: 'aliases' });
    await flush();
    expect(spawn.mock.calls[0][2].env.AMICUS_SETUP_PANE).toBe('aliases');
    expect(spawn.mock.calls[0][2].env.AMICUS_MODE).toBe('setup');
    mockProcess.on.mock.calls.find(c => c[0] === 'close')[1](0);
    await promise;
  });

  it('no pane (the plain wizard) and an unknown pane both send an EMPTY token', async () => {
    launchSetupWindow();
    await flush();
    expect(spawn.mock.calls[0][2].env.AMICUS_SETUP_PANE).toBe('');
    launchSetupWindow({ pane: 'keys' });
    await flush();
    expect(spawn.mock.calls[1][2].env.AMICUS_SETUP_PANE).toBe('');
  });
```

Run: `npx jest tests/sidecar/setup-window.test.js`
Expected: FAIL (`AMICUS_SETUP_PANE` undefined).

- [ ] **Step 4: Implement in `src/sidecar/setup-window.js`**

```js
/**
 * Launch the Electron setup window for API key entry.
 * Lazily PROVISIONS electron on first GUI use (#55) via ensureElectron() — the
 * one place network provisioning is allowed; getElectronPath() stays a pure probe.
 * @param {{pane?: 'aliases'|''}} [opts] #238 D4: `pane: 'aliases'` lands the window on
 *   the Routing step (`amicus aliases --ui`); anything else opens the wizard at step 1.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function launchSetupWindow({ pane = '' } = {}) {
```

and in the env:

```js
    const env = {
      ...process.env,
      AMICUS_MODE: 'setup',
      AMICUS_SETUP_PANE: pane === 'aliases' ? 'aliases' : '',
    };
```

Run: `npx jest tests/sidecar/setup-window.test.js`
Expected: PASS.

- [ ] **Step 5: The page — failing test first**

In `tests/setup-ui.test.js`, add a top-level describe:

```js
describe('#238 D4: initialPane lands the wizard on a step', () => {
  it('defaults to step 1 and never calls showStep at load', () => {
    const script = buildSetupHTML().match(/<script>([\s\S]*)<\/script>/)[1];
    expect(script).toContain('var INITIAL_STEP = 1;');
    expect(script).toMatch(/if \(INITIAL_STEP !== 1\) \{ showStep\(INITIAL_STEP\); \}/);
  });
  it('initialPane: "aliases" → step 3, and the call sits AFTER every fragment (so the step hooks it runs are defined)', () => {
    const script = buildSetupHTML({ initialPane: 'aliases' }).match(/<script>([\s\S]*)<\/script>/)[1];
    expect(script).toContain('var INITIAL_STEP = 3;');
    const callIdx = script.indexOf('if (INITIAL_STEP !== 1) { showStep(INITIAL_STEP); }');
    expect(callIdx).toBeGreaterThan(script.indexOf('function buildModelSelect('));   // after the alias fragment
    expect(callIdx).toBeGreaterThan(script.indexOf('function renderAliasReview('));  // after the review fragment (T3)
    expect(callIdx).toBeGreaterThan(script.lastIndexOf('addEventListener('));        // after the last listener wiring
  });
  it('an unknown pane is step 1', () => {
    expect(buildSetupHTML({ initialPane: 'keys' })).toContain('var INITIAL_STEP = 1;');
  });
});
```

(If T3 has not merged yet, drop the `renderAliasReview` line and add it at integration.)

Run: `npx jest tests/setup-ui.test.js -t "initialPane"`
Expected: FAIL.

- [ ] **Step 6: Implement in `electron/setup-ui.js`**

- JSDoc of `buildSetupHTML`: add ` * @param {''|'aliases'} [options.initialPane=''] - issue 238 D4: 'aliases' lands the wizard on the Routing step (amicus aliases --ui)`.
- Destructure `initialPane = ''` in `buildSetupHTML`'s options.
- Pass a 6th argument: `${buildWizardScript(providersJson, modelChoicesJson, providerNamesJson, defaultAliasesJson, familyNamesJson, initialPane === 'aliases' ? 3 : 1)}`.
- `function buildWizardScript(providersJson, modelChoicesJson, providerNamesJson, defaultAliasesJson, familyNamesJson, initialStep = 1) {`.
- After `var currentStep = 1, configuredKeys = {}, keyHints = {};` add `var INITIAL_STEP = ${initialStep};`.
- In the keys-init callback, after `updateNextState();` add `if (currentStep === 3) { updateAliasRoutes(); }` (a `--ui` window is already on step 3 when the keys arrive).
- As the LAST statement of the script, after `${localJs}` and before `</script>`:

```js
  // issue 238 D4 (amicus aliases --ui): land on the Routing step. LAST on
  // purpose -- showStep(3) runs updateAliasRoutes and ensureCatalogLoaded,
  // which every fragment above must have defined. 1 for the plain wizard.
  if (INITIAL_STEP !== 1) { showStep(INITIAL_STEP); }
```

Run: `npx jest tests/setup-ui.test.js tests/electron/preload-allowlist.test.js`
Expected: PASS.

- [ ] **Step 7: `main.js` wiring — failing test first**

Create `tests/electron/main-setup-pane-wiring.test.js`:

```js
'use strict';
/**
 * #238 D4: createSetupWindow threads the launcher's AMICUS_SETUP_PANE token
 * into buildSetupHTML as initialPane. Source-level, like
 * tests/setup-ui-effective-aliases.test.js (main.js runs Electron at import).
 */
const fs = require('fs');
const path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf-8');

function fnBlock(name) {
  const start = MAIN.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = MAIN.indexOf('// ====', start);
  return MAIN.slice(start, end > start ? end : MAIN.length);
}
function balancedParens(text, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    if (text[i] === '(') { depth++; }
    else if (text[i] === ')') { depth--; if (depth === 0) { return text.slice(openParenIdx, i + 1); } }
  }
  throw new Error('unbalanced parens');
}

describe('createSetupWindow → initialPane', () => {
  it('passes initialPane from AMICUS_SETUP_PANE into buildSetupHTML', () => {
    const block = fnBlock('createSetupWindow');
    const idx = block.indexOf('buildSetupHTML(');
    const call = balancedParens(block, idx + 'buildSetupHTML'.length);
    expect(call).toMatch(/initialPane:\s*process\.env\.AMICUS_SETUP_PANE \|\| ''/);
  });
  it('the Settings child window (toolbar gear) never lands on a pane', () => {
    const block = fnBlock('createSettingsChildWindow');
    expect(block).not.toContain('initialPane');
  });
});
```

Then in `electron/main.js :: createSetupWindow` change the call to:

```js
  // issue 238 D4: `amicus aliases --ui` asks for the Routing step (setup-window.js sets the token).
  const html = buildSetupHTML({ client: CLIENT, quickPicks, shortlists, aliases, initialPane: process.env.AMICUS_SETUP_PANE || '' });
```

Run: `npx jest tests/electron/main-setup-pane-wiring.test.js tests/setup-ui-effective-aliases.test.js tests/electron/main-settings-catalog-wiring.test.js`
Expected: PASS.

- [ ] **Step 8: CLI help + docs gate**

In `src/cli.js`'s `aliases:` help block, add after the `--unpin` lines:

```
  --ui                         Open the setup window on the Routing step: the same alias
                               editor, plus a "Needs review" section for the proposals
```

Run: `npx jest tests/docs-command-coverage.test.js tests/cli*.test.js`
Expected: PASS.

- [ ] **Step 9: Gates + commit**

Run: `node scripts/check-file-sizes.js --all && node scripts/check-citations.js --all && npm run lint && npx jest tests/sidecar tests/electron tests/setup-ui.test.js`
Expected: green.

```bash
git add src/sidecar/aliases.js src/sidecar/setup-window.js electron/main.js electron/setup-ui.js src/cli.js tests/sidecar/aliases-command.test.js tests/sidecar/setup-window.test.js tests/setup-ui.test.js tests/electron/main-setup-pane-wiring.test.js
git commit -m "feat(cli): amicus aliases --ui opens the setup window on the Routing step (issue 238 D4, T5)

The window is the setup wizard landing on step 3 (the alias editor plus the Needs-review
section); the CLI normalizes the config on entry like every aliases form, prints
'Aliases saved.' on Finish and the reason on stderr with exit 1 otherwise. The launcher
carries the pane as AMICUS_SETUP_PANE; main.js threads it into buildSetupHTML({ initialPane }).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Docs — usage, README, CHANGELOG, the smoke recipe

**Files:**
- Modify: `docs/usage.md` (§ "Aliases: following vs pinned" + the setup section), `README.md` (the `amicus aliases` row), `CHANGELOG.md` (`[Unreleased]`), `docs/electron-testing.md`
- Test: `npm run validate-docs`, `npx jest tests/docs-command-coverage.test.js tests/docs*.test.js`

**Interfaces:** the strings T3/T4/T5 fixed: the section title `Needs review`; the controls `✓ accept <id>` / `↩ follow the shipped pin (<id>)` / `✓ use <id>` / `✓ add <alias> → <id>` / `⌄ choose…` / `× dismiss`; the banners; the row labels `following` / `pinned`, `unpin` / `×`; the Step 2 note; the Review wording; the CLI lines of `--ui`.

- [ ] **Step 1: `docs/usage.md`**

In the `amicus aliases` code block (the one starting `amicus aliases            # every alias…`), add after the `--unpin` line:

```
amicus aliases --ui       # the same editor in the setup window, landing on the Routing step (Electron)
```

After the paragraph that begins `**Owner mode (\`--review --owner\`).**`, add:

```markdown
**In the setup window (`--ui`, or `amicus setup` → Model Routing).** The Routing step lists every alias with its state — `following` (the value is the shipped pin) or `pinned` — and the right remove control: `unpin` on a curated pin (the row then shows the shipped id it follows), `×` on a custom alias. Above the list, a **Needs review** section shows the same proposals `amicus aliases --review` walks, each with the picker's choices as buttons — `✓ accept <id>` (newer same-tier sibling), `↩ follow the shipped pin (<id>)`, `✓ use <id>` (a replacement for an id gone from the catalog), `✓ add <alias> → <id>` (a notable model) — plus `⌄ choose…` (a picker over the catalog ids the review engine vouches for) and `× dismiss` (never ask again for that pairing). Nothing is written until **Finish**: every choice is staged, the Review step lists it (`glm → openrouter/z-ai/glm-5.4`, `gemini → (now follows google/gemini-3.8-flash)`, `1 proposal(s) dismissed`), and closing the window discards it. When the catalog is older than 24 hours and could not be refreshed, the catalog-vouched buttons are disabled and the section says why (`↻` retries); *follow* never needs the catalog. An unavailable catalog shows a banner rather than an empty section. `--ui` combines with none of `--json`, `--review`, `--owner`, `--unpin`; it prints `Aliases saved.` on Finish and exits 1 with the reason if the window closes without saving.
```

In the `amicus setup` area (the sentence in the `--review` paragraph that reads `\`amicus setup\` no longer seeds all 21 curated ids — it pins only the default alias you chose, and only when its live flagship differs from the shipped pin, and says so.`), append: ` The Electron wizard does the same: the Models step's write-preview says `follows the shipped recommendation` or `live flagship differs from the shipped <id> — pinned` for the card you pick, a default merely restored from your config on reopen is not re-written, and the Review step names every write before Finish.`

- [ ] **Step 2: `README.md`**

Change the `amicus aliases` Commands-table row to:

```markdown
| `amicus aliases` | Your model aliases — following / pinned; `--review` walks the update proposals, `--ui` does the same in the setup window, `--unpin <name>` removes a pin, `--json` for scripts; `--review --owner` (maintainers) reviews the shipped pins. |
```

- [ ] **Step 3: `CHANGELOG.md` `[Unreleased]`**

Under `### Added`, append:

```markdown
- **Setup window — "Needs review" section and per-row state (Electron):** the Model Routing
  step now shows every alias as `following` or `pinned` with the right remove control
  (`unpin` on a curated pin, `×` on a custom alias — both remove the key), and a **Needs
  review** section above the list renders the same proposals `amicus aliases --review`
  walks, with the picker's choices as buttons (accept a newer sibling, follow the shipped
  pin, use a replacement, add a notable model, choose… from the vouched catalog ids, dismiss).
  Everything is staged and written by Finish through the wizard's one sink; the Review step
  lists it. A stale catalog disables the catalog-vouched buttons and says why; an unavailable
  catalog shows a banner, never an empty section. (#238 D9, R1)
- **`amicus aliases --ui`** opens the setup window on the Routing step. (#238 D4)
- **Electron wizard live-pick announcement (Q9):** the Models step's write-preview says
  `follows the shipped recommendation` or `live flagship differs from the shipped <id> —
  pinned` for the picked card, and a default merely restored on reopen is no longer re-written
  to the live flagship on Finish — the wizard writes only what you actively chose, and a write
  equal to the shipped pin is a follow (no key), on screen and on disk. (#238 Q9, §6.5)
```

Add a `### Fixed` section (after `### Changed`, before the next `## [4.10.0]`):

```markdown
### Fixed

- **Setup window: deleting a saved custom alias did nothing.** The `×` on a custom alias that
  was already in `config.json` struck the row through but staged no write, so the alias
  survived Finish (a silent no-op). It now stages the removal; a route added in the same
  session is simply dropped. (#238 Phase 3, found while wiring R1)
```

- [ ] **Step 4: `docs/electron-testing.md`**

Append a short section:

```markdown
## Alias review pane (issue 238, Phase 3)

`AMICUS_DEBUG_PORT=9333 node bin/amicus.js aliases --ui` opens the setup window on the Routing
step with CDP enabled. To see a proposal without touching your real config, point
`AMICUS_CONFIG_DIR` at a scratch dir holding a copy of `model-catalog.json` (fresher than
24 h) and a `config.json` such as `{ "aliases": { "glm": "openrouter/z-ai/glm-5.3" } }` —
the section proposes the newer sibling the catalog lists. The page's rows are `.alias-row`
(`data-alias`, `data-state`), the section is `#alias-review` (`.alias-review-row` per
proposal, `.alias-review-accept/-choose/-dismiss` buttons), and nothing reaches disk until
Finish. The unit suite drives the same page functions against `tests/helpers/fake-dom.js`
(there is no jsdom in this repo), so a CDP session is for eyes, not for assertions.
```

- [ ] **Step 5: Gates + commit**

Run: `npm run validate-docs && npm run generate-docs:check && npx jest tests/docs-command-coverage.test.js`
Expected: green.

```bash
git add docs/usage.md README.md CHANGELOG.md docs/electron-testing.md
git commit -m "docs: the setup window's Needs-review section, aliases --ui, the wizard's live-pick announcement (issue 238 Phase 3, T6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7 (controller): whole-branch review, integration, the GUI smoke, the PR

- [ ] **Step 1: Integrate** — merge each wave into `feat/238-pr3-electron-review` with `--no-ff`; resolve the named overlaps (`src/sidecar/aliases.js` T1/T5, `electron/setup-ui.js` T2/T3/T4/T5, `electron/setup-ui-styles.js` T2/T3/T4, `setup-ui-alias-state.js` T2/T4 and the `stagedDismissals` single declaration with T3). After the last merge: `wc -l electron/setup-ui.js` ≤ 808; `node scripts/check-file-sizes.js --all`; `npm test` green; `npm run test:integration` (keyless) green.

- [ ] **Step 2: Whole-branch review** — dispatch the most capable model with the full diff `git diff c8ff0150..HEAD` as a file, the spec sections named in the header, and the rulings list; ONE fix dispatch + scoped re-review; adjudicate residuals in the ledger.

- [ ] **Step 3: GUI smoke (eyes, not assertions — `project_amicus-electron-gui-smoke` recipe)** — from the integration worktree: copy `%USERPROFILE%\.config\amicus\model-catalog.json` into a scratch dir `S` (its `fetchedAt` must be within 24 h — run `node bin/amicus.js models --refresh` first if not), write `S\config.json` = `{ "default": "gemini", "aliases": { "glm": "openrouter/z-ai/glm-5.3" } }` (or whatever the shipped `glm` pin's older sibling is — check `node bin/amicus.js aliases --json` under `AMICUS_CONFIG_DIR=S` shows one proposal first), then `AMICUS_CONFIG_DIR=S AMICUS_DEBUG_PORT=9333 node bin/amicus.js aliases --ui`. Over CDP (`http://127.0.0.1:9333/json`): the window is on step 3; `#alias-review` visible with `(1)`; the glm row reads `pinned` with `unpin` visible; click `✓ accept …` → the row shows the new id, the section hides; Next → the Review step lists `glm → …`; Finish → `S\config.json` holds the new id and the CLI printed `Aliases saved.`; re-run with the fresh config → `Nothing to review` shape (section hidden), the glm row `pinned`; `unpin` → Finish → the key is gone. Record what you SAW in the ledger with the screenshots' paths. Known traps: the `file://` cache and the run-switch race produced FALSE readings before — reload between checks.

- [ ] **Step 4: Finish** — `superpowers:finishing-a-development-branch`: rewrite subagent trailers (`git filter-branch -f --msg-filter 'sed "s/Claude Sonnet 5/Claude Opus 5/"' c8ff0150..HEAD`, delete `refs/original/*`), push, open the PR against `main` with the `council-review` label (the publish gate), body = goal + the R-P3 rulings + the §6.5/§6.11 coverage table + the smoke record; then the council round(s) and the merge at the owner's call. After the merge: worktrees cleaned junction-first; BACKLOG gets the deferred items (a pane-only `--ui` window; the CLI picker and the wizard could share one "choose" gate module if a third renderer ever appears).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| D9 — section above the list, auto-expanded, `[✓ accept] [⌄ choose] [× dismiss]` | T3 (R-P3-4 widens the button set to the CLI menu) |
| D9/R1 — see, edit, remove on both surfaces; `[unpin]` curated, `[×]` custom, both remove the key; state per row | T2 |
| Q4 — accept writes the id, the encoding decides the state; `[⌄ choose]` on a curated proposal includes *follow* | T2 (`stageAliasWrite`), T3 (`chooseForProposal` keeps the shipped id; a follow button per curated proposal) |
| §2 — sinks never in the engine; one engine, two renderers | T1 (`collectAliasView` reused; `write:false`), T3 (page renders the engine's document) |
| §5 — display gate on candidates (engine), write gate on accept (24 h), follow exempt | T1 (`fresh`, `gatedIds`), T3 (disabled buttons + banner; `choose…` pruned) |
| §6.11 — proposals render; accept writes through the same sink; `[unpin]`/`[×]` remove the key | T3 tests (render/accept/follow/add/dismiss), T2 tests (controls), T1 tests (the sink's 4th argument) |
| D4 — `amicus aliases --ui` | T5 |
| §6.5 / Q9 — a fresh Electron save writes `aliases: {}` + at most the chosen default; only when the live pick differs; the announcement names both ids; a drill-down pick still pins | T4 (`defaultWasChosen`, `foldShippedWrites`, `describeDefaultWrite`, the Review wording); `aliases: {}` seeding already shipped in Phase 1 (`ipc-setup.js`) |
| §9 residual — the Electron live-pick announcement is Phase 3 | T4 |
| Product principle — no silent degrade | R-P3-7 (fixed), R-P3-10 (banner), T3's error path |
| Docs (failure mode #49) | T6 + `docs-command-coverage` |

**Placeholder scan:** none — every new module, test and edit is spelled out; the two prose-only edits (the `ipc-setup.js` docblock sentence, the `setup-window.js` JSDoc) name their exact text.

**Type/name consistency:** `buildAliasReviewResponse` / `registerAliasHandlers` / `recordDismissals` (T1) ← `ipc-setup.js` (T1); `stageAliasWrite` / `aliasRowFor` / `refreshAliasRowState` / `isCuratedAlias` (T2) ← T3, T4; `stagedDismissals` (T4 declares; T3 pushes; T4's `finishPlan` copies); `buildAliasEditorHTML(aliases, { defaults, reviewHtml })` (T2) ← `setup-ui.js` (T3); `finishPlan()` (T4) ← Finish + `buildReview` (T4); `launchSetupWindow({ pane })` (T5) ← `handleAliases` (T5); `initialPane` (T5) ← `main.js` (T5); the IPC channel string `sidecar:get-alias-review` appears in T1 (handler, allowlist), T3 (page), and the preload test.
