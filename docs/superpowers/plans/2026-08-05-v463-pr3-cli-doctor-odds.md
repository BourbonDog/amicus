# v4.6.3 PR3 — "CLI + doctor odds-and-ends" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three proven small defects land with tests — valueless `-o`/`--out` errors instead of writing a file named `true` (ruling R1), `council save` announces when it shadows a built-in bench (D7), and `doctor --fix` sweeps per-session `metadata.json` tmp orphans (D8) — spec §6 of `docs/superpowers/specs/2026-08-05-v463-post-train-sweep-design.md`.

**Architecture:** Three independent surgical changes, one task each + a docs/gates closer. The sweep is a new util mirroring `session-index-tmp-sweep.js` byte-for-byte in structure; the doctor handler gains ONLY ~4 wiring lines (it sits at 286/300 — nothing else may land there). All error/notice/heal surfaces reuse existing house machinery (`failJson`/`BAD_ARGS`, the save doc + `renderSave`, the `fixed:true` → `doctor-fix` heal collector).

**Tech Stack:** Node.js CommonJS, jest. No new dependencies, ONE new src module (`utils/session-metadata-tmp-sweep.js`) → run `node scripts/generate-docs.js` after creating it (marker regen — the PR1 no-new-module shortcut does NOT apply here).

## Global Constraints

- Sizes measured today: `cli-handlers-doctor.js` **286/300 — the sweep wiring (~4 lines) fits; NOTHING else lands in this file this PR** (receiving pattern if forced: the `doctor-mcp-checks.js` split precedent). `cli-handlers-council.js` 228, `presets-cli.js` 153, `remediation-hints.js` +~8 fine. `session-manager.js` is grandfathered-over — do NOT add sweep logic there.
- Exit codes unchanged everywhere except R1's new BAD_ARGS exit 1 (a deliberate, CHANGELOG-recorded behavior change).
- The sweep's four safety invariants port from the sibling WITH their tests: strict `> 60_000` age gate on injected `now()`; bare doctor NEVER unlinks; unlink surface is name-only within self-enumerated dirs; `fixed:true` only on a fully-clean sweep (`remaining === 0 && swept > 0`).
- Confident voice for the sweep hint (the 2026-08-03 sweepSessionIndexTmp ruling applies verbatim: an atomic-write tmp orphan has no other producer — `atomic-write.js`'s catch already `rmSync`s on error; only a hard kill orphans) — hint + ruling comment + an analogous pin in `tests/remediation-hints.test.js`.
- Hermeticity (the #96 contract): adding two realDeps seams means EVERY suite that drives `runDoctorChecks` with full-pinned deps gains inert `() => []` pins for them — grep `baseDeps|allGood` under tests/ and update every hit that reaches `runDoctorChecks` (known set: cli-handlers-doctor, doctor-fix, doctor-tmp-sweep, doctor-local-providers, doctor-base-url, doctor-legacy-mcp, alias-drift (doctor row describe), electron-quarantine, electron-self-heal-smoke, doctor-electron-stat-exe). This widens the duplicated-baseDeps debt PR4's `makeBaseDeps()` consolidates — expected, note it in the PR body.
- CHANGELOG edits go in `[Unreleased]` ONLY — **verify with `git diff main -- CHANGELOG.md` that released sections show zero diff** (the PR2 final-review lesson: anchoring on `###` headers without checking the owning `##` section rewrote shipped release notes).
- Test-branch rule `node bin/amicus.js`; NEVER bare npm install (junction); push timeout ≥5min; worktree `C:\Users\sendt\code\amicus-wt-v463-pr3`, branch `feat/v4.6.3-pr3-cli-doctor-odds`. Baseline at branch: 492 suites / 6512+ / 0.

**Measured reality (recon 2026-08-05, wf_53cb410d-971 — verbatim excerpts in the recon reports):**
- `-o` alias: `cli.js:104-115` — maps to `result.out`; boolean `true` when last token OR next starts with `-`. `--out` valueless: `cli.js:96-103`; `--out=` inline yields `''`. `'out'` IS in the known-flags set (scraped from usage `cli.js:573`) — no known-flags edit needed, and the usage line must keep the literal `--out` token.
- ONLY consumer: `cli-handlers-council.js:165` `const outPath = args.out || './verdict.json';` in `runVerdict`; bonus symptom the guard cures: valueless `-o` + `--render` → `path.dirname(true)` TypeError at `:190`.
- House error idiom to clone: `cli-handlers-council.js:146-149` (`failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message, hint })` — returns 1; `--json` envelope `{schemaVersion, type:'error', ok:false, error:{...}}`).
- Save handler is `runSave` (`presets-cli.js:25-55`, NOT "handleCouncilSave"); `overwritten = !!getCouncil(name)` at `:47`; **`getCouncil` (config.js:382-384) reads user config ONLY — no built-in fallback** (that's the separate `getCouncilWithSource`), so a FIRST save of `budget` prints NO notice today: the marker under-fires, and `shadowsBuiltin` is orthogonal to `overwritten`.
- Built-in names: `listBuiltinCouncilNames()` → exactly `['free','budget','frontier']` (`council-presets.js:82-84`), **already imported by presets-cli.js:12**. Do NOT use `resolveBuiltinCouncil` as the membership test ('free' wants a catalog).
- Wizard note: setup SEEDS `councils.free` into user config — a save of 'free' will truthfully notice; acceptable, it does shadow.
- Sweep template: `session-index-tmp-sweep.js` (81 lines) — list (prefix+`.tmp` filter, statSync mtimeMs), unlink (name-only), evaluate (pure, deps-injected). Tmp naming from source: `` `.${base}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp` `` (`atomic-write.js:29`) → metadata orphans are `.metadata.json.<pid>.<12hex>.tmp` in the SAME dir as their target.
- Session layout: `<project>/.claude/amicus_sessions/<taskId>/metadata.json`; subagents nest ONE level (`<session>/subagents/<id>/metadata.json`); waves/legs are ordinary sibling session dirs — NO special case. `progress.json`/`wave.json`/`run.json` orphans are out of D8 scope, excluded by the `.metadata.json.` prefix.
- **Enumeration decision (recorded here, the spec's plan-time item): cwd-scoped.** The sweep walks `<process.cwd()>/.claude/amicus_sessions/` (each taskId dir + its `subagents/*/`) — doctor is a per-project surface; enumerating other projects via the best-effort `sessions-index.json` risks touching unrelated directories on stale index data, the wrong failure direction.
- Doctor wiring pattern (3 seams): realDeps entries, one `checks.push(guard('session-metadata-tmp', 'Session metadata tmp files', () => ...))`, `d.fix` already flows in. The heal record is emitted by `doctor-degrade.js collectDoctorDegrades` from the structured `fixed:true`/`fixDetail` row flags — `'doctor-fix'` is an EXISTING channel; the new check needs ZERO degrade-side code. `renderHuman` prints heals via `formatDegrade` → `Recovered: ...`.
- Test models: `tests/doctor-tmp-sweep.test.js` (280 lines; hermetic baseDeps + NOW=1.8e12/fresh−5s/stale−120s fixtures + real-fs describe via mkdtemp) — mirror BOTH describes. `tests/council/cli-handlers-council.test.js` — `capture()` stdout harness + `AMICUS_CONFIG_DIR` tmp dir; verdict BAD_ARGS template at `:303`; the `-o` string-path test at `:280` passes `out` directly (the guard must accept strings and reject only non-string/empty); save describe at `:407-486` with the shadow test at `:478-485` (pins exit 0 + ok:true, asserts NO notice today — extend it).
- `--json` save doc `{ ok:true, name, models, overwritten }` — always-present booleans; add `shadowsBuiltin` the same way. Doctor `--json`: `buildDoctorDoc` includes `degrades[]` only when non-empty — auto-tracks.

---

### Task 1: valueless `-o`/`--out` → BAD_ARGS (ruling R1)

**Files:**
- Modify: `src/cli-handlers-council.js` (runVerdict, before `:165`)
- Test: `tests/council/cli-handlers-council.test.js` (verdict describe)

**Interfaces:** none new — a guard + error.

- [ ] **Step 1: Write the failing tests** (model on the BAD_ARGS shape test at `:303`; `capture()` harness):
```js
    test('verdict: a valueless -o/--out errors instead of writing a file named true (v4.6.3 R1)', async () => {
      // parseArgs records a trailing bare -o as boolean true (cli.js:104-115)
      const { code, out } = await capture(() => handleCouncil({ _: ['council', 'verdict', tallyPath], out: true, json: true }));
      expect(code).toBe(1);
      const doc = JSON.parse(out);
      expect(doc.error.code).toBe('BAD_ARGS');
      expect(doc.error.message).toMatch(/-o\/--out/);
      expect(fs.existsSync(path.join(dir, 'true'))).toBe(false);
      expect(fs.existsSync('true')).toBe(false);
    });

    test('verdict: an empty --out= value errors the same way, never silently defaulting', async () => {
      const { code, out } = await capture(() => handleCouncil({ _: ['council', 'verdict', tallyPath], out: '', json: true }));
      expect(code).toBe(1);
      expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
    });
```
(Adapt `tallyPath`/`dir` setup to the describe's existing fixtures; the existing `:241` default-path and `:280` string-path tests must keep passing untouched — they pin the guard's negative space.)

- [ ] **Step 2: Run to verify RED** — `npx jest tests/council/cli-handlers-council.test.js` — the two new tests fail (today: exit 0, a file named `true` appears).

- [ ] **Step 3: Implement** — in `runVerdict`, directly above the `:165` default line:
```js
  // R1 (v4.6.3): parseArgs records a valueless trailing -o/--out as boolean
  // true (and --out= as ''); coercing either into a path writes a file
  // literally named 'true' (and --render then TypeErrors in path.dirname).
  // Name the flag and refuse — the unknown-flag precedent.
  if (args.out !== undefined && (typeof args.out !== 'string' || args.out === '')) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: '-o/--out requires a value',
      hint: 'amicus council verdict <tally.json> [--decisions <decisions.json>] [-o|--out <out.json>]' });
  }
  const outPath = args.out || './verdict.json';
```

- [ ] **Step 4: Verify green** — `npx jest tests/council/cli-handlers-council.test.js tests/cli-council-verdict-render.test.js tests/cli-council-verdict-chair-carry.test.js tests/utils/known-flags.test.js tests/pack/args-explicit.test.js`.

- [ ] **Step 5: Commit** — `git commit -am "fix(council): valueless -o/--out errors instead of writing a file named 'true' (R1)"`

### Task 2: `council save` shadow notice (D7)

**Files:**
- Modify: `src/council/presets-cli.js` (runSave `:47-55` + renderSave `:57-61`)
- Test: `tests/council/cli-handlers-council.test.js` (save describe `:407-486`)

**Interfaces:** save doc gains always-present boolean `shadowsBuiltin` (mirrors `overwritten`'s style).

- [ ] **Step 1: Write the failing tests** (extend the shadow test at `:478-485` + siblings):
```js
    test('saving a built-in bench name reports shadowsBuiltin and prints the notice (v4.6.3 D7)', async () => {
      const { code, out } = await capture(() => handleCouncil({ _: ['council', 'save', 'budget'], models: 'deepseek,glm', json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.ok).toBe(true);
      expect(doc.shadowsBuiltin).toBe(true);
      expect(doc.overwritten).toBe(false); // first save: nothing in user config — the old marker under-fired here
    });

    test('re-saving a shadowing name is BOTH overwritten and shadowsBuiltin', async () => { /* save budget twice; expect both true */ });

    test('a non-built-in name reports shadowsBuiltin false and prints no shadow notice', async () => {
      const { code, out } = await capture(() => handleCouncil({ _: ['council', 'save', 'mine'], models: 'deepseek,glm' }));
      expect(code).toBe(0);
      expect(out).not.toMatch(/shadows the built-in/);
    });

    test('human-mode shadow save prints the notice line', async () => {
      const { out } = await capture(() => handleCouncil({ _: ['council', 'save', 'frontier'], models: 'deepseek,glm' }));
      expect(out).toMatch(/shadows the built-in bench of the same name/);
    });
```

- [ ] **Step 2: RED** — the four fail (`shadowsBuiltin` undefined; no notice text).

- [ ] **Step 3: Implement** — `runSave` (`listBuiltinCouncilNames` is already imported at `:12`):
```js
  const overwritten = !!getCouncil(name);
  const shadowsBuiltin = listBuiltinCouncilNames().includes(name);
```
Doc: `const doc = { ok: true, name, models: members, overwritten, shadowsBuiltin };`
`renderSave`:
```js
function renderSave(doc) {
  const notice = doc.overwritten ? ' (overwritten)' : '';
  const shadow = doc.shadowsBuiltin
    ? `  note: '${doc.name}' now shadows the built-in bench of the same name — 'amicus council list' shows both\n`
    : '';
  return `Saved council '${doc.name}'${notice}: ${doc.models.join(', ')}\n` + shadow +
    "  for full run configuration — chair, options, templates — see 'amicus pack'\n";
}
```
(Wording stays in the family of runList's "(shadowed by a saved council of the same name)". The wizard seeds `councils.free`, so saving 'free' notices too — truthful, it does shadow.)

- [ ] **Step 4: Green** — `npx jest tests/council/cli-handlers-council.test.js` (the `:429` overwritten pin and `:478` shadow-allowed pin must still pass — additive only).

- [ ] **Step 5: Commit** — `git commit -am "feat(council): save-time shadowsBuiltin notice — a silent shadow now announces (D7)"`

### Task 3: per-session metadata tmp sweep as a `doctor --fix` heal (D8)

**Files:**
- Create: `src/utils/session-metadata-tmp-sweep.js` (mirror the 81-line sibling)
- Modify: `src/cli-handlers-doctor.js` (~4 wiring lines ONLY), `src/utils/remediation-hints.js` (hint + ruling comment)
- Test: Create `tests/doctor-metadata-tmp-sweep.test.js` (mirror BOTH describes of the sibling suite); modify `tests/remediation-hints.test.js` (confident-voice pin); add inert `() => []` pins for the two new deps in every full-pinned doctor suite (Global Constraints list).

**Interfaces:**
- `listSessionMetadataTmpFiles(): Array<{name, mtimeMs}>` — `name` is the path RELATIVE to the sessions root (`<cwd>/.claude/amicus_sessions`), covering `<taskId>/` and `<taskId>/subagents/<id>/` levels; match = basename starts `.metadata.json.` and ends `.tmp`.
- `unlinkSessionMetadataTmp(name)` — joins the list-returned relative name onto the sessions root; never accepts absolute/caller paths.
- `evaluateSessionMetadataTmpSweep(d)` — pure, deps-injected, byte-parallel to the sibling's evaluate (same statuses/messages with "session-metadata"/"metadata" wording, same `fixed`/`fixDetail` contract).
- Doctor row id `'session-metadata-tmp'`, name `'Session metadata tmp files'`; hint key `HINTS.sweepSessionMetadataTmp`.

- [ ] **Step 1: Write the failing tests.** New suite mirroring `tests/doctor-tmp-sweep.test.js` describe-for-describe:
  - Decision block (injected fakes, `NOW`/fresh/stale fixtures): 0 files → ok; N no-fix → warn + `HINTS.sweepSessionMetadataTmp`; bare doctor NEVER unlinks; `--fix` sweeps stale → ok + `fixed:true` + exact `fixDetail: 'swept N orphaned session-metadata tmp file(s)'`; fresh survives (unlink not called); mixed sweeps only stale; throwing unlink → warn not error; partial sweep leaves `fixed` undefined.
  - Real-fs glue block: mkdtemp a fake PROJECT (`<tmp>/.claude/amicus_sessions/<id>/` + one `<id>/subagents/<sub>/`), `process.chdir` into it (restore in afterEach); orphans built with the exact `atomic-write` naming (`.metadata.json.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`) at BOTH nesting levels; pins: both found; the real `metadata.json` files, a `.progress.json.*.tmp` orphan (different base), and files outside the sessions root are all ignored; missing sessions root → `[]`; end-to-end sweep leaves targets intact.
  - `tests/remediation-hints.test.js`: the analogous pin — `sweepSessionMetadataTmp` matches `/left by an interrupted write/` and not `/unverified/i`.
- [ ] **Step 2: RED** — new suite fails (module missing); hint pin fails.
- [ ] **Step 3: Implement.** The new module mirrors the sibling structurally (constants, docblock explaining the producer + the cwd-scope decision and why the index was rejected as an enumeration source, strict `>` age gate, best-effort per-file try/catch). Wiring in `cli-handlers-doctor.js`: two realDeps entries + one `checks.push(guard(...))` beside the sibling's at `:202` — nothing else. `remediation-hints.js`: the hint with the confident wording (`'amicus doctor --fix  (sweeps orphaned .metadata.json.*.tmp files left by an interrupted write)'`) + a ruling-reference comment pointing at the sweepSessionIndexTmp ruling above it.
- [ ] **Step 4: Hermeticity sweep** — add the two inert pins to every suite in the Global Constraints list; run the full doctor family: `npx jest tests/doctor-metadata-tmp-sweep.test.js tests/doctor-tmp-sweep.test.js tests/cli-handlers-doctor.test.js tests/doctor-fix.test.js tests/doctor-local-providers.test.js tests/doctor-base-url.test.js tests/doctor-legacy-mcp.test.js tests/alias-drift.test.js tests/electron-quarantine.test.js tests/electron-self-heal-smoke.test.js tests/doctor-electron-stat-exe.test.js tests/remediation-hints.test.js` + `npm run check:sizes` (report cli-handlers-doctor.js's exact post-edit count — must be ≤300) + `node scripts/generate-docs.js` (new src module → marker regen) + `npm run generate-docs:check`.
- [ ] **Step 5: Commit** — `git commit -am "feat(doctor): session-metadata tmp-orphan sweep — doctor --fix heals the B09 orphan class (D8)"`

### Task 4: docs, CHANGELOG, full gates

**Files:** `CHANGELOG.md` (`[Unreleased]` ONLY), `docs/usage.md` (doctor section — one line for the new check), `docs/configuration.md` only if the plan's implementer finds the doctor row family documented there (report either way).

- [ ] **Step 1: CHANGELOG** — under `[Unreleased]` (verify placement per Global Constraints):
```markdown
### Added

- **`doctor` gains a `session-metadata-tmp` check; `--fix` sweeps the orphans.** A kill
  between an atomic write's tmp-file and rename leaves `.metadata.json.*.tmp` orphans in
  per-session directories (the B09 class — ~30 write sites). Plain `doctor` reports them;
  `--fix` removes orphans older than 60 s from the current project's sessions root and
  announces the heal in the one voice (`Recovered: …`).
- **`council save` announces when it shadows a built-in bench.** Saving a council named
  `free`/`budget`/`frontier` previously printed no notice at all (the overwrite marker only
  tracked user-config names); the save now reports `shadowsBuiltin` (`--json`) and prints
  the shadow notice.

### Fixed

- **A valueless `-o`/`--out` on `council verdict` now errors** (`BAD_ARGS`, flag named,
  exit 1) instead of writing a file literally named `true` — and, under `--render`,
  crashing in `path.dirname`. Behavior change, per the v4.6.3 R1 ruling.
```
- [ ] **Step 2: usage.md** — one line in the doctor detail section naming the new check + `--fix` behavior, matching the section's existing voice.
- [ ] **Step 3: Full gates** — `npm test` (exact counts), `npm run lint`, `npm run check:sizes`, `npm run validate-docs`. Then the CHANGELOG placement proof: `git diff main -- CHANGELOG.md` → single hunk under `[Unreleased]`, released sections zero-diff.
- [ ] **Step 4: Commit** — `git commit -am "docs: CHANGELOG + usage for the v4.6.3 PR3 trio"` — NO push, NO PR (controller owns those after the final review).

## Execution notes (read before Task 1)

- Tasks 1-3 are mutually independent; the plan orders them smallest-first. Task 3 is the meaty one — its hermeticity sweep is part of the task, not optional.
- The `--out -x` asymmetry (a dash-valued next token yields `true` for `-o` but is consumed as a value by `--out`) is KNOWN and out of R1's scope — do not "fix" the parser; the handler guard is the whole change. State it in the PR body.
- The two new realDeps seams widen the duplicated-baseDeps debt — PR4's `makeBaseDeps()` consolidation absorbs it; note in the PR body, do not consolidate here.
- Expected new-test delta: ~20 (2 + 4 + ~13 + hint pin), plus the inert-pin edits (assertion-free).
