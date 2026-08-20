# v4.7.1 "the diagnostics stop lying" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the nine ruled v4.7.1 items so that amicus's diagnostics report what the mechanism
actually knows — no canned guesses, no presence-boolean standing in for a version, no tag silently
dropped on the floor.

**Architecture:** One PR, eleven tasks, on branch `fix/v4.7.1-diagnostics` in the sibling worktree
`C:\Users\sendt\code\amicus-wt-v471` (off `origin/main` @ `5bd2615`). Task 1 is a pure
no-behaviour-change extraction that buys the size-gate headroom later tasks need. Task 11 lands
last because it converts docs staleness into a red unit suite, and every earlier task moves docs.

**Tech Stack:** Node 22.12+, CommonJS, Jest 29, no TypeScript.

---

## Scope authority and provenance

`BACKLOG.md` §"v4.7.1 — the diagnostics stop lying" (lines 1788-1833) plus the seven-rulings table
(1776-1786) is the spec. **This plan does not restate it — it corrects it.** A 12-agent recon on
2026-08-09 (7 tracers + 5 blind adversarial refuters) returned `partially-refuted` on all seven
tracers and `refuted: true` on all five premises. §Errata below is the authoritative diff; where
this plan and BACKLOG disagree, **this plan is right and BACKLOG is wrong.**

Four owner rulings were taken 2026-08-09 after recon, and they change the shape of three items:

| # | Ruling |
|---|---|
| **R-A** | Item 1 gets the **full fix**, reported as **WARN, never ERROR**. That includes repairing `defaultNpmRootG()` and making `findDonor` version-aware. |
| **R-B** | `opencode-ai` pinned **exactly** to `1.18.15`, and `@opencode-ai/sdk` pinned to `1.18.15` **in lockstep**. |
| **R-C** | Tag inheritance ships for continue, resume **and** `--retry-failed`, written up under **Changed**, with the three affected docs rewritten in the same PR. |
| **R-D** | `amicus continue --tag <x>` is **rejected with a clear error** rather than silently ignored. |

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`src/sidecar/fanout.js` is EXACTLY 300/300 and is NOT grandfathered.** The gate blocks at
  `> 300`. Adding one line — **including a comment** — fails the pre-commit hook and CI. No task in
  this plan edits it. If you believe you need to, you have taken a wrong turn: re-read the task.
- **`src/cli-handlers-doctor.js` is 292/300 — eight lines of headroom.** Tasks 3 and 4 must keep
  their changes inside `src/utils/`.
- **Never run `npm test -- <path>`.** It stamps `.test-passed` against HEAD and makes the pre-push
  hook SKIP the full suite. Run a single suite with bare `npx jest <path>`.
- **Never run `npm run test:all` or `npm run test:integration`, and never `npx jest` on any
  `*.integration.test.js`.** This box has a live `OPENROUTER_API_KEY`; those rails bypass keyless
  scrubbing and spend real money. Sanctioned rails: `npx jest <unit path>` and full `npm test`.
- **Count lines with the gate's own arithmetic.** PowerShell `Measure-Object -Line` undercounts.
  Use: `node -e "const s=require('fs').readFileSync('PATH','utf8');const n=s.split('\n').length;console.log(s.endsWith('\n')?n-1:n)"`
- **Two deliberately opposite null conventions.** `metadata.json` is **absent-not-null** (D13,
  `src/sidecar/start-metadata.js:50`). A spend **ledger row is null-not-absent**
  (`src/utils/spend-ledger.js:94`, documented at `:58-61`). Mixing them is invisible until it isn't.
- **New test files are not size-gated.** `scripts/check-file-sizes.js` `CONFIG.include` is
  `['src/**/*.js', 'electron/**/*.js']` only. `scripts/` and `tests/` are outside it.
- **Do not touch `agent` anywhere.** See Erratum E-3b.
- **Prove every new test fails first.** `git stash push -- src/` then re-run, per house rule.
- **⚠️ Test snippets in this plan name helpers ILLUSTRATIVELY.** `read()`, `fakeFs()`,
  `engineSeams()`, `newSessionMetadataPath()`, `newWaveMetadataPath()`, `ledgerDir`, `projectDir`,
  `ROOT`, `tmp` and the harness option objects are placeholders for whatever the target suite
  actually defines. **Open the suite and use its real names and shapes** — check whether a helper is
  a factory (`fakeFs()`) or a bare const (`fakeFs`), and reuse the existing repo-root constant
  rather than introducing a second. A helper invented by a plan and transcribed faithfully by an
  implementer is failure mode (c), and it is the single most common way plans in this repo have
  been wrong. The *assertions* in these snippets are the specification; the scaffolding is not.
- **Verified-real identifiers you may rely on** (recon-confirmed, cite these rather than guessing):
  `readSpendRows(dir)` and `groupRows(rows, dim)` (`src/spend-query.js:131` — the grouper is
  `groupRows`, **not** `groupSpend`); `seedSession(projectDir, taskId, overrides)`
  (`tests/continue-resume-spend.test.js:34-43`); `baseOpts()` (`tests/sidecar/fanout.test.js:261`,
  already `quiet: true`); `githubSlug` (`tests/docs-council-toc-anchors.test.js:33`);
  `getCommandNames()` (`src/cli.js:751`); the `deps.spendDir` seam
  (`src/sidecar/fanout-leg-fallback.js:29-30, :51`); the `ctx.dir` seam (`src/utils/spend-ledger.js:65`).

---

## Errata — where BACKLOG.md is wrong

Recorded here so no task re-derives them and no reviewer re-files them.

**E-0 (affects items 1, 3, 4): three items name modules that do not exist.** Every *line* number is
correct once the directory is fixed.

| BACKLOG says | Truth |
|---|---|
| `src/sidecar/engine-install-scan.js` | `src/utils/engine-install-scan.js` (142 lines) |
| `src/sidecar/doctor-engine-check.js` | `src/utils/doctor-engine-check.js` (115 lines) |
| `run-retry.js` / `run-launch.js` (bare) | `src/council/run-retry.js` (283) / `src/council/run-launch.js` (215) |
| `headless.js:485` | `src/headless.js:483-485` — a three-line concatenation |

Note the item-3 bullet also names `fanout.js`, which really **is** `src/sidecar/fanout.js`. One
bullet, two directories, no prefixes.

**E-1a: "fail loudly on skew across copies" is dead code as worded.**
`src/utils/doctor-engine-check.js:40` is `installs.filter((i) => i.kind === 'npx')` — running and
global are discarded before any branch reads them. This machine has exactly one npx copy, so
npx-vs-npx skew has a population of 1 and can never fire. **#133's actual skew was npx-vs-global**,
cross-kind, which that filter structurally cannot see.

**E-1b: on Windows the scan cannot see the global install at all.** `defaultNpmRootG()`
(`src/utils/engine-install-scan.js:31-41`) runs `execFileSync('npm', ['root','-g'])` with no
`shell`. Verified live on this box: `npm` → `ENOENT`, `npm.cmd` → `EINVAL` (Node 24's
CVE-2024-27980 hardening blocks `.cmd` without a shell). A real global amicus 4.7.0 with
opencode-ai 1.18.15 sits at `%AppData%\npm\node_modules\amicus` and is invisible. This is a
**pre-existing unreported bug**, and item 1 is a no-op until it is fixed.

**E-1c: a naive "all installs agree" rule fires red on every dev checkout.** Measured now: dev
worktree `opencode-ai` **1.2.20**, global **1.18.15**, npx **1.18.15**. `listAmicusInstalls` emits
`running` first (`:81`), so the dev tree poisons any all-installs comparison — in CI too.

**E-1d: `engine-repair.js:30` `findDonor` is an undeclared consumer.** It picks the self-heal donor
by `engineOk`, first match wins, running first. Today `amicus doctor --fix` would copy the dev
tree's 1.2.20 engine into a broken npx copy — healing *into* the skew. Ruling R-A fixes it.

**E-1f (found at Task 3's review — THIS PLAN'S OWN Task 4 Step 4 was wrong).** The plan told the
implementer to prefer a donor with `kind !== 'running'`. That proxy is wrong on the exact topology
this release targets. `listAmicusInstalls` pushes `running` first and `global` second
(`src/utils/engine-install-scan.js:90,97`), then `dedupByRealpath` (`:57-68`) keeps the **first**
entry. So when the running process **is** the global install — an ordinary end user running
`amicus doctor --fix` — the `global` record is dropped and the global copy is labeled
`kind: 'running'`. An existing test already pins that dedup behaviour.

Consequence of the plan's rule: with `installs = [running(=global, healthy, 1.18.15), npxA (broken,
the repair destination), npxB (healthy, 1.17.3)]`, the old code donated the good global engine and
the plan's rule donates **npxB — the stale copy**, importing the very skew #133 is about. Neither
of the tests the plan specified distinguishes that case.

**Corrected rule:** `healthy.find((i) => i.kind === 'global') || healthy[0] || null`. On a dev
machine the dev tree and the global install are distinct real paths, so the `global` record
survives dedup and wins (ruling R-A's purpose — stop donating the dev engine — is met). On an
end-user machine there is no `global` record, so `healthy[0]` is the running-that-is-global and the
correct donor still wins. The single-install fallback is unchanged.

**Open for the final review:** R-A's wording was "make `findDonor` version-aware". The corrected
rule is *kind*-aware and achieves R-A's stated purpose without needing `engineVersion`. True
version-aware ranking would be strictly better and becomes possible once Task 4 lands
`engineVersion` — deliberately NOT expanded into Task 4 here, because the kind-aware rule already
closes the defect and the ranking policy deserves its own decision.

**E-1g (found at Task 4's review — THE SAME dedup defect as E-1f, repeated in Task 4).** The plan
gave `installs.find((i) => i.kind === 'global')` as the skew baseline. Because dedup collapses a
running-that-is-global into the `running` record, an end user running `amicus doctor` from their
global install has **no `global` record at all** — so `globalV` is undefined, `skewed` is empty, and
the check reports `ok`. **As planned, the release's headline check was structurally unable to fire
for the users who filed #133.** Corrected: `scanEngineInstalls` stamps `isGlobal: true` on the
surviving record when dedup collapsed the global into it, and the baseline becomes
`kind === 'global' || isGlobal`. The stamp lives in `scanEngineInstalls`, never in
`listAmicusInstalls`, so the `toEqual` fixtures at `tests/utils/engine-install-scan.test.js:50`
and `:82` stay green unchanged. Lesson: this dedup behaviour bit two separate items in one release
— treat "which record survives dedup" as a standing hazard for anything keying on `kind`.

**E-1h (found at Task 4's review — a defect in the CONTROLLER'S dispatch, not the plan or the
implementation).** Routing E-1f's residual into Task 4, the dispatch specified "rank healthy donors
by `engineVersion`, highest semver first, falling back to the kind rule." A reviewer probed the
result and found three inversions, one of which defeats ruling R-A outright: with running = dev
tree at `1.19.0` and global at `1.18.15`, highest-semver **donates the dev tree** — exactly what
R-A exists to prevent, and the normal direction mid-pin-bump. Corrected to **two tiers**: an
explicitly-global donor (including `isGlobal`) wins outright; version ranking applies only within
the remaining candidates. That still closes E-1f's residual without the inversions.

**E-1i (found at Task 4's review).** The remediation hint told users `npm cache clean --force`
would make the npx copy re-resolve. Verified against npm 11's own `lib/commands/cache.js`:
`cache clean` removes `flatOptions.cache` (`<cache>/_cacache`), while npx trees live at
`flatOptions.npxCache` (`<cache>/_npx`). The hinted command deletes registry metadata and leaves
the skewed copy byte-for-byte in place. Since this release deliberately ships **no `--fix` branch
for skew**, that hint is the only remedy a user gets. Corrected to `npm cache npx rm --force`.

**E-1e: the version source is the record's existing `roots` array.** Read
`<root>/opencode-ai/package.json`. Do **not** "read the package.json next to the binary":
`hasOpencodeBinary` (`src/utils/path-setup.js:113-122`) probes
`<root>/opencode-windows-<arch>[-baseline]/bin/opencode.exe` on win32 but `<root>/.bin/opencode` on
POSIX, and `.bin/` has no package.json. That rule works on Windows and silently returns nothing
everywhere else — failure mode (a). `opencode-ai`'s version is a faithful proxy for the `.exe`
because all 12 platform sub-packages are exact-pinned.

**E-2a: ruling 1's mechanism is refuted.** npx (libnpmexec 11.16.0) keys its cache on a sha512 of
the literal spec string — `amicus@latest` → `1ac24c217d670093`, the directory that exists on this
box — and decides staleness on **amicus's own resolved tarball only** (`npxArb.reify` sits inside
`if (add.length)`). Amicus's dependency ranges are never evaluated. Do **not** write an acceptance
criterion that says "npx re-resolves because the range no longer matches." The pin's real value is
**determinism**: `package-lock.json` does not ship (verified: `npm pack --dry-run` →
`package-lock.json in tarball: false`), so the range is the sole governor for every consumer, and
`^1.2.20` resolves to whatever was latest *on the day each copy was installed*.

**E-2b: "package.json only" is refuted.** The lock pins 1.2.20, which does not satisfy an exact
1.18.15, so the lock **must** regenerate. Six CI steps run `npm ci`, where a mismatch is a hard
`EUSAGE`. The regen moves dev/CI from opencode-ai 1.2.20 → 1.18.15.

**E-2c: nothing local heals.** Both the npx cache and the global install already hold 1.18.15. The
pin is **prophylactic**. Do not write an acceptance criterion that observes a stale copy updating.

**E-2d (found during Task 2 — this plan's own Step 4 command was wrong).**
`require('@opencode-ai/sdk/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`: the SDK's
`exports` map does not expose its manifest, at both the old and new versions. Read it with
`fs.readFileSync` instead. Unrelated to the pin; the plan's verification snippet was simply wrong.

**E-2e (operational, found during Task 2): `npm install` destroyed the worktree's `node_modules`
JUNCTION and replaced it with a real directory.** npm logged
`npm warn reify Removing non-directory … node_modules` and then installed a full tree.
**The main clone was NOT damaged** — verified after the fact: `C:\Users\sendt\code\amicus\node_modules`
still has 434 entries and `jest/package.json` resolves. But two standing procedures change for this
worktree:
- Teardown must **not** use the link-only junction procedure. `amicus-wt-v471/node_modules` is now a
  real, independent directory (432 entries) and deleting it recursively is safe and correct.
- The worktree no longer shares the main clone's modules, so its installed tree is the one under
  test. That is what made Task 2's suite run meaningful, but it also means a later
  `npm install --ignore-scripts` here affects only this worktree.

**E-3a: `launchSolo` needs no edit.** It is `launchWave({ ...opts, models: [opts.model] })` at
`src/council/run-launch.js:159` — a one-line delegation that inherits the key. "launchWave/launchSolo"
doubles the real edit surface.

**E-3b: `agent` is noise — do not touch it.** It is already at `src/council/run-launch.js:109`
(`agent: opts.agent || 'Plan'`), and `o.agent` does not exist anywhere in `src/council/`
(`grep -rn "o\.agent\|options\.agent" src/council/` → zero hits). Adding `agent: o.agent` pushes
`undefined` and re-defaults to `'Plan'` — a pure no-op with churn. The first attempt
(`src/council/run-stage1-launch.js:18-29`) omits it too. Both attempts already run as `Plan`.

**E-3c: `common` carries 13 keys, not 12** (`src/council/run-retry.js:169-174`).

**E-3d: the backlog's shape instruction is self-contradictory.** It says "spread-guarded, exactly
the shape `tag: opts.tag`", but `tag: opts.tag` (`:120`) is **not** spread-guarded — the spread
guard is `...(opts.retryOfWaveId ? {…} : {})` at `:103`, a different precedent. Resolution: use
`...(Number.isFinite(opts.noOutputBackstopMs) ? {…} : {})`. `Number.isFinite(0)` is `true`, so the
documented `0` disable hatch survives, **and** the transport call stays key-identical for the four
launchers that never set the field.

**E-3e (new, not in BACKLOG): unclamped, the doubling silently changes the failure class.**
`src/sidecar/fanout.js:254` derives `timeoutMs` from `options.timeout` (default 15 min) and the
retry forwards `timeout: o.timeout` unchanged. At `--timeout 3` (180s < 240s) the doubled backstop
can never fire and the retry reclassifies from `NO_OUTPUT_BACKSTOP` to an ordinary timeout —
a different diagnosis, silently. Task 5 clamps.

**E-3f (new): the escalation's scope is Stage-1 only.** Only bench/critic/lens units go through
`retryStage1Losses`. The Stage-2 judge wave, chair, chair repair and every debate leg launch at the
un-doubled 120s with no SL-2 retry. CHANGELOG must say "retries can now heal it", not "fixed".

**E-4a: there is ONE literal, not two firing sites to edit.** `src/headless.js:535` and `:815` both
call the same closure `noOutputBackstopReason()` defined at `:483-485`. A plan that says "update
both firing sites" sends the implementer hunting for a literal that does not exist.

**E-4b: two hard constraints on the new string.** It must still begin with exactly
`NO_OUTPUT_BACKSTOP:` at position 0 (`src/sidecar/models-probe.js:39` classifies on the anchored
regex `/^NO_OUTPUT_BACKSTOP:/`; break it and every silent alias in `amicus models --check --live`
flips from silent to error). And it must keep the substring `no output, reasoning, or tool calls`
(`tests/no-output-backstop-wiring.test.js:115` and `:265`). Keep both and the reword needs **zero**
test edits.

**E-4c: naming the env var unconditionally ships a NEW false statement.**
`src/sidecar/models-probe.js:79` passes a hardcoded `PROBE_WINDOW_MS = 30000` that the env var
cannot touch, and `docs/usage.md:406` already promises users that window is "not tunable".
`src/headless.js:476-477` prefers `options.noOutputBackstopMs` whenever finite. The reason builder
must branch on the **source** of the value.

**E-4d: do not say "the endpoint accepted the request".** At firing site 1 (`:506-518`) the
backstop won the race against `sendPromptAsync`, so the send never resolved and acceptance was
never observed. The only claim true at both sites is "no output, reasoning, or tool calls observed
before the deadline".

**E-4e: this is an artifact string, not console text.** It persists on six surfaces: run/leg doc
`error` (`src/utils/result-schema.js:67`), leg `.reason` (`src/sidecar/fanout-leg.js:194`),
`degrades[].why` and `degrades[].data.reason` verbatim, `report.md` (via `src/utils/degrade.js:66`)
and `report.html`. It does **not** reach `events.jsonl`, and no JSON schema quotes it.

**E-5a: no metadata read needs to be added.** `src/sidecar/continue.js:157-158` already
destructures `oldMetadata` from `loadPreviousSession`, in scope at the
`createContinueSessionMetadata` call. Resume's `reloaded` (`src/sidecar/resume.js:256`) **is** the
parent's own metadata.json and already carries the tag. The gate pressure at 297/300 is real but
its cause is this repo's comment style, not a read.

**E-5b: the one-line version silently half-fixes.** Adding `tag` only to `finalizeSpendForReopen`
fixes **resume** and leaves **continue** at null, because `createContinueSessionMetadata`
(`:90-117`) writes a fresh metadata.json that never receives the parent's. Continue needs **two**
changes.

**E-5c: ledger-only breaks the motivating example.** If the tag is passed to `appendSpend` but never
persisted, continue #2 reads continue #1's metadata, which has no tag — so only the first follow-up
is attributed and depth 2+ scatters back into `(unattributed)`. The backlog's own example is "tag a
session, continue it three times".

**E-5d: the extraction is pre-authorized.** `docs/superpowers/plans/2026-07-19-v4.3-observability-data-layer.md:631`
says: *"move `finalizeSpendForReopen` into a small sibling module (e.g. `src/sidecar/reopen-spend.js`)
rather than trimming the fix."*

**E-6a: `buildRetryPlan`'s return contract must widen.** `src/sidecar/fanout-retry.js:76` is
`return { eligible };` — `waveMeta` is a function-local that is **discarded**, and
`retryFailedWave` builds `fanoutOpts` without it. The `origMeta` re-read at `:176` runs *after*
`runFanoutImpl` at `:153` — too late. Failure mode (c).

**E-6b: `metaTag` is inert on the retry path.** `src/sidecar/fanout.js:165` reads `waveMeta.tag` off
the **new** wave dir's metadata, and `fanout-retry.js:138` mints a fresh `newWaveId` that nothing
pre-seeds. What makes `fanout.js` need no edit is `options.tag`, not `metaTag`.

**E-6c: the pre-seed implementation is a trap that passes review.** `stampLegAttribution` fires at
`src/sidecar/fanout.js:126`, **before** the wave dir exists at `:144-146`, and reads only
`options.tag`. A pre-seeded tag yields a correct-looking `wave.json` while **every leg spend row
stays `tag: null`** — the exact bug, now with a tagged wave.json vouching for it. **The acceptance
test must assert the spend row.**

**E-6d: five `buildWaveResult` sites, not three.** Three in `fanout.js` (`:93`, `:176`, `:287`)
already carry `tag: options.tag || metaTag`. The two the backlog misses:
`src/sidecar/fanout-retry.js:122-124` (the zero-eligible no-op doc passes neither tag nor pack) and
`src/utils/result-schema-rebuild.js:89-94`.

**E-6e: the pack door is closed — do not add a guard.** `tag` is absent from `pack-validate.js`
`KIND_OPTIONS` for all three kinds, from `pack-resolve.js`'s knob tables and `FORWARDABLE_ARG_KEYS`,
and from `pack-forward.js` (`maxCost`/`template` only). `grep -rn tag src/pack/` is empty.
Independently, `applyPackOrExit` (`src/cli-handlers-fanout.js:47`) is unreachable on the retry path
because dispatch returns at `:45`, and MCP `amicus_fanout` has no `retryFailed` param. A pack-side
guard would be dead code.

**E-7a: `scripts/validate-docs.js` is a LIVE file.** `.husky/pre-commit:31` runs
`node scripts/validate-docs.js` (no `--full`) on every commit. Only the three helpers are dead.
`runPreCommitCheck`, `checkStagedFilesDrift` and `runFullAnalysis` must survive untouched.

**E-7b: `CONFIG.docFile` is dead too** — the backlog names only `mappings`. The only surviving
`CONFIG.*` reference in the file is `CONFIG.trackedDirs` at `:104`; the staged check hardcodes
`'CLAUDE.md'` at `:101`. **Ruling for this plan: delete `docFile` as well.**

**E-8a: F-6 at "all of docs/" lands RED.** `docs/` is 128 `.md` files, not 15. Recursively there are
5 unresolvable anchors, two of which are *unfixable by editing*:
`docs/superpowers/plans/2026-08-08-v47-docs.md:58` and `:297` contain the literal `](#…)` used to
*describe this very regex*, so the extractor eats its own documentation. Scope is
**top-level `docs/*.md` (non-recursive) + README.md**, which is 0-bad across 71 in-page links, is
what the backlog item's own body says, and is what `package.json` `files: ["docs/*.md"]` ships.

**E-8b: ten of the fifteen docs have zero anchors, and Jest 29 treats `.each([])` as a hard
FAILURE.** The natural per-file transcription of the existing test fails on those ten before
checking anything. It must be **one flat table of `{file, anchor}` pairs**.

**E-8c: the existing gate is not only a loop.** `tests/docs-council-toc-anchors.test.js` carries two
council-specific assertions (the "Council presets" doubled-hyphen slug, and the TOC line targeting
that form) encoding a real prior bug that a fixup commit once inverted. A rewrite into a generic
loop deletes both. Keep them in their own `describe`.

**E-8d: F-2's scrape must not reach `docs/troubleshooting.md`** — it documents only 9 of the 21
commands, so extending the scrape one file too far turns F-2 red. Its two existing assertions stay
verbatim.

**E-8e: F-3 changes the developer loop.** Promoting `generate-docs --check` to jest converts every
uncommitted file add/rename/delete under `bin/ src/ electron/ scripts/ evals/`, and every renamed
export or edited JSDoc first line, into a red unit suite that the pre-push hook then blocks on.
**This PR contains an extraction (Task 1), which is exactly that operation.** Task 11 lands last.

**E-9a: Rider A costs zero paid legs**, and `tests/sidecar/fanout.test.js` has two near-identical
precedents (`:576-587`, `:594-620`). Trap: do **not** spy `process.stdout.write` to prove the stdout
half — jest swaps in its own `Console` that never funnels through it, so the spy passes vacuously.
Spy `console.log`. Assert both streams: the banner is stdout (`fanout.js:77/:80`), per-leg progress
and the heartbeat are stderr (`fanout-leg.js:58/:188`, `wave-progress.js:75`).

**E-9b: Rider B costs zero paid legs — strike "one cheap leg".**
`tests/continue-resume-spend.test.js:80-163` already drives the real `continueSidecar`/`resumeSidecar`
with `runHeadless` mocked and `AMICUS_CONFIG_DIR` on a tmpdir. The grouper is `groupRows`, not
`groupSpend` (`src/spend-query.js:131`).

**E-9c: Rider B is subsumed into Task 7's RED step, and that is an improvement.** The rider asked to
"observe a `continue` row landing under `(unattributed)` before item 5 fixes it". A TDD red run
*is* that observation, and unlike a manual run it pins the regression in CI. Task 7 Step 2 requires
capturing the RED output showing `(unattributed)`. Do not also perform a separate manual run.

---

## File Structure

**Created**
- `src/sidecar/reopen-spend.js` — the reopened-session spend finalizer, lifted verbatim out of
  `continue.js`. Sole export `finalizeSpendForReopen`. ~35 lines.
- `tests/sidecar/reopen-spend.test.js` — is not required; existing coverage moves with the import.
- `tests/docs-anchors.test.js` — the generalized in-page anchor gate (F-6).
- `tests/scripts/generate-docs-check.test.js` — the marker-freshness gate (F-3).

**Modified (with current size-gate headroom)**

| File | Now | Task | Note |
|---|---|---|---|
| `src/sidecar/continue.js` | 297/300 | 1, 7 | 297 → ~277 after the extraction |
| `src/sidecar/resume.js` | 286/300 | 1 | import path only, net 0 |
| `src/utils/engine-install-scan.js` | 142/300 | 3, 4 | |
| `src/utils/doctor-engine-check.js` | 115/300 | 4 | |
| `src/utils/engine-repair.js` | 125/300 | 3 | |
| `src/council/run-launch.js` | 215/300 | 5 | |
| `src/council/run-retry.js` | 283/300 | 5 | **17 lines. Budget the comment.** |
| `src/headless.js` | 1433 | 6 | grandfathered, ungated |
| `src/sidecar/fanout-retry.js` | 208/300 | 8 | |
| `src/cli-handlers-resume-continue.js` | 130/300 | 7 | the `--tag` rejection only |
| `scripts/validate-docs.js` | 188 | 9 | ungated |
| `package.json` / `package-lock.json` | — | 2 | |

**Docs modified:** `docs/configuration.md:463` (T2), `docs/usage.md:577` (T4),
`docs/troubleshooting.md:236-242` (T6), `docs/usage.md:488,492-497` +
`skills/sidecar/SKILL.md:382-383` (T7), `docs/testing.md:526` (T9), `CHANGELOG.md` (T11).

---

## Task 1: Extract `finalizeSpendForReopen` (pure move, no behaviour change)

**Files:**
- Create: `src/sidecar/reopen-spend.js`
- Modify: `src/sidecar/continue.js:119-137` (cut), `:295` (exports), `:271-279` (lazy require)
- Modify: `src/sidecar/resume.js:254`
- Test: `tests/continue-resume-spend.test.js:26` (require split only)

**Interfaces:**
- Produces: `require('./reopen-spend').finalizeSpendForReopen({taskId, model, mode, op, result, status, project, metadata}, ctx = {})` → `{usage: object|null}`. Signature byte-identical to today's.

Why this block: it is the only block in `continue.js` with zero module-scope dependencies — its two
requires (`../utils/pricing`, `../utils/spend-ledger`) are already lazy, inside the function body.
Cut and paste with no import rewiring in the new module. Pre-authorized by E-5d.

- [ ] **Step 1: Read the real source before cutting**

Read `src/sidecar/continue.js:119-137` in full (JSDoc block through closing brace). Confirm the two
requires are inside the function body. Confirm `module.exports` at `:295` lists it.

- [ ] **Step 2: Create the new module**

```javascript
/**
 * @module sidecar/reopen-spend
 * Spend finalization for a REOPENED session (continue/resume). Split out of
 * sidecar/continue.js to keep that file under the 300-line gate; resume.js was
 * already reaching across for it, so the shared home is the honest one.
 */

'use strict';

/**
 * Resolve a reopened session's usage, write it onto metadata, and append one
 * attributed ledger row. Mirrors start.js's finalize (the only sites that
 * dropped usage - BACKLOG.md:280). Best-effort ledger append; never throws.
 * @returns {{usage: object|null}}
 */
function finalizeSpendForReopen({ taskId, model, mode, op, result, status, project, metadata }, ctx = {}) {
  const { resolveUsage } = require('../utils/pricing');
  const usage = result && result.usage ? resolveUsage({ model, usageTotals: result.usage }) : null;
  if (usage) {
    metadata.usage = usage; // buildRunResult surfaces metadata.usage into the --json doc for free
    try {
      const { appendSpend } = require('../utils/spend-ledger');
      const gateway = metadata.gateway || (String(model).startsWith('openrouter/') ? 'openrouter' : 'direct');
      appendSpend({ taskId, model, mode, usage, op, status, project, gateway }, ctx);
    } catch { /* best-effort */ }
  }
  return { usage };
}

module.exports = { finalizeSpendForReopen };
```

The body must be **byte-identical** to what you cut. Do not "improve" it. Task 7 changes it.

- [ ] **Step 3: Delete the original and rewire the three import sites**

There are exactly three, no more (repo-wide grep for the four `continue.js` export names finds no
other test, no `src/` consumer, no `bin/` or `electron/` consumer):

1. `src/sidecar/continue.js` — delete `:119-137`, drop `finalizeSpendForReopen` from
   `module.exports` (`:295`), and add `const { finalizeSpendForReopen } = require('./reopen-spend');`
   inside the **existing** lazy-require block at `:271-279`.
2. `src/sidecar/resume.js:254` — change `require('./continue')` to `require('./reopen-spend')`.
3. `tests/continue-resume-spend.test.js:26` — split the require: `finalizeSpendForReopen` from
   `'../src/sidecar/reopen-spend'`, `continueSidecar` stays on `'../src/sidecar/continue'`.

**Do NOT keep a compatibility re-export from `continue.js`.** It costs back a line and leaves two
import paths for one function.

- [ ] **Step 4: Prove the move is byte-identical**

```bash
git diff -U0 -- src/sidecar/continue.js src/sidecar/reopen-spend.js
```

Every removed line must reappear verbatim. Then:

```bash
node -e "const s=require('fs').readFileSync('src/sidecar/continue.js','utf8');const n=s.split('\n').length;console.log('continue.js',s.endsWith('\n')?n-1:n)"
```

Expected: **≤ 280**, down from 297.

- [ ] **Step 5: Run the affected suites**

```bash
npx jest tests/continue-resume-spend.test.js tests/continue-model-routing.test.js
```

Expected: PASS, same counts as before the move.

- [ ] **Step 6: Regenerate CLAUDE.md and commit**

A new module changes CLAUDE.md's AUTO module index and directory tree. The pre-commit hook runs
`generate-docs` in **write** mode and stages it, but run it explicitly so the diff is reviewable:

```bash
node scripts/generate-docs.js && node scripts/generate-docs.js --check
```

Expected: `All markers are current.` exit 0. If the new module's Purpose cell renders empty, its
JSDoc header block is missing or malformed (`buildModuleIndex` reads the first JSDoc,
`scripts/generate-docs-helpers.js:225`).

```bash
git add src/sidecar/reopen-spend.js src/sidecar/continue.js src/sidecar/resume.js tests/continue-resume-spend.test.js CLAUDE.md
git commit -m "refactor: extract finalizeSpendForReopen to sidecar/reopen-spend.js"
```

---

## Task 2: Pin `opencode-ai` and `@opencode-ai/sdk` to 1.18.15 (ruling R-B)

**Files:**
- Modify: `package.json` (`dependencies`), `package-lock.json`
- Modify: `docs/configuration.md:463`
- Test: `tests/no-phantom-dependencies.test.js` (new assertion appended)

Do this early: the lock regen changes the engine every later test run uses, so any fallout should
surface now rather than at the release gate.

- [ ] **Step 1: Write the failing range-shape guard**

Append to `tests/no-phantom-dependencies.test.js`. No existing test asserts the range shape, so a
future `npm update` could silently re-widen it.

```javascript
describe('engine version pinning (#133)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

  // Exact pins, not ranges: package-lock.json does NOT ship in the tarball, so
  // for every consumer the range in package.json is the sole governor and a
  // caret resolves to "whatever was latest the day this copy was installed".
  // That is precisely how an npx-cache copy and a global install ended up on
  // different engines in #133. Exact makes the engine a pure function of the
  // amicus version. They release in lockstep, so both are pinned together.
  it.each(['opencode-ai', '@opencode-ai/sdk'])('%s is an exact version, not a range', (dep) => {
    expect(pkg.dependencies[dep]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the engine and its SDK are pinned to the same version', () => {
    expect(pkg.dependencies['@opencode-ai/sdk']).toBe(pkg.dependencies['opencode-ai']);
  });
});
```

Confirm `ROOT`, `fs` and `path` are already in scope in that file; if the repo-root constant has a
different name, use the existing one rather than introducing a second.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/no-phantom-dependencies.test.js
```

Expected: FAIL — `"^1.2.20"` does not match `/^\d+\.\d+\.\d+$/`.

- [ ] **Step 3: Pin both, and regenerate the lock**

In `package.json` `dependencies`: `"opencode-ai": "1.18.15"` and `"@opencode-ai/sdk": "1.18.15"`
(bare versions, no caret, no tilde).

```bash
npm install --ignore-scripts
```

**`--ignore-scripts` is mandatory** — a bare `npm install` mutates global Claude config (MCP
registration + skill install). If the engine binaries are needed afterwards, run
`node node_modules/electron/install.js` and the opencode postinstall deliberately.

Commit `package-lock.json`. Expect it to move `opencode-ai` 1.2.20 → 1.18.15 and
`@opencode-ai/sdk` 1.1.36 → 1.18.15.

- [ ] **Step 4: Verify the tree actually moved**

```bash
node -e "console.log('engine', require('opencode-ai/package.json').version, '| sdk', require('@opencode-ai/sdk/package.json').version)"
```

Expected: `engine 1.18.15 | sdk 1.18.15`.

- [ ] **Step 5: Run the full suite — this is the real risk of the task**

```bash
npm test
```

Five CI jobs run `npm ci` against the lock, so **this is the first time the suite has ever run on
the engine users actually get.** Previously-masked failures are possible. If anything goes red,
diagnose it as a genuine engine regression before assuming a bad pin.

Do **not** invent work for the version jump: 1.18.15 changes `bin` from `bin/opencode` to
`bin/opencode.exe` and adds `opencode-windows-arm64`, but `src/utils/path-setup.js:60-70,113-121`
builds those names dynamically and already probes `.exe`, and `src/utils/engine-repair.js:47` copies
by the `startsWith('opencode-')` prefix. No source edit is needed.

- [ ] **Step 6: Fix the stale doc**

`docs/configuration.md:463` currently reads:

> `opencode-ai` (>=1.0.0) is the bundled LLM conversation engine — it is installed automatically as
> a postinstall step and does not need a separate `npm install`.

Two errors: the range disagrees with package.json, and `grep -c opencode scripts/postinstall.js` is
**0** — amicus's postinstall does not touch it. Rewrite to name the exact pinned version and use
the phrasing `README.md:365` already gets right ("installs automatically as a normal dependency …
Its own postinstall lays down the per-platform binaries"). No drift test guards this line.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json docs/configuration.md tests/no-phantom-dependencies.test.js
git commit -m "fix: pin opencode-ai and @opencode-ai/sdk to 1.18.15 (#133)"
```

---

## Task 3: Repair `defaultNpmRootG()` and un-blind the self-heal donor (E-1b, E-1d)

**Files:**
- Modify: `src/utils/engine-install-scan.js:31-41`
- Modify: `src/utils/engine-repair.js:30`
- Test: `tests/utils/engine-install-scan.test.js`, `tests/utils/engine-repair.test.js`

**Interfaces:**
- Produces: `listAmicusInstalls()` now emits a `{kind:'global'}` record on Windows when a global
  amicus exists. Task 4 depends on this.

- [ ] **Step 1: Write the failing test for the Windows resolver**

`defaultNpmRootG` is module-private, so test it through the `deps.npmRootG` seam plus a direct
behavioural test of the exported scan. Add to `tests/utils/engine-install-scan.test.js`:

```javascript
it('resolves the global root on win32, where bare `npm` is not spawnable without a shell', () => {
  // Node 24 hardening (CVE-2024-27980) rejects .cmd without shell:true, so
  // execFileSync('npm', …) throws ENOENT and execFileSync('npm.cmd', …) throws
  // EINVAL. Before this fix defaultNpmRootG returned null on every Windows box
  // and the global install was invisible to the scan — and to findDonor.
  const calls = [];
  const execFileSync = (cmd, args, opts) => {
    calls.push({ cmd, args, shell: opts && opts.shell });
    if (!opts || opts.shell !== true) { const e = new Error('spawnSync ENOENT'); e.code = 'ENOENT'; throw e; }
    return 'C:\\Users\\t\\AppData\\Roaming\\npm\\node_modules\n';
  };
  expect(resolveNpmRootG({ execFileSync, platform: 'win32' }))
    .toBe('C:\\Users\\t\\AppData\\Roaming\\npm\\node_modules');
  expect(calls.some((c) => c.shell === true)).toBe(true);
});

it('returns null rather than throwing when npm cannot be resolved at all', () => {
  const execFileSync = () => { throw new Error('nope'); };
  expect(resolveNpmRootG({ execFileSync, platform: 'win32' })).toBe(null);
});
```

This requires exporting the resolver. Rename `defaultNpmRootG` → `resolveNpmRootG({execFileSync,
platform} = {})`, add it to `module.exports` (`src/utils/engine-install-scan.js:142`), and keep
`listAmicusInstalls`'s `deps.npmRootG` default pointing at it so every existing seam still works.

- [ ] **Step 2: Run and watch it fail**

```bash
npx jest tests/utils/engine-install-scan.test.js
```

Expected: FAIL — `resolveNpmRootG is not a function`.

- [ ] **Step 3: Implement**

Replace `src/utils/engine-install-scan.js:30-41`. Keep the "never throws, returns null" contract
verbatim — `listAmicusInstalls:84` wraps it in `safe()` but the contract is documented.

```javascript
/**
 * Best-effort `npm root -g`. Never throws; returns null on any failure.
 * ⚠️ Windows needs shell:true — npm is a .cmd shim, and Node 24's
 * CVE-2024-27980 hardening rejects .cmd via execFileSync without a shell
 * (bare `npm` → ENOENT, `npm.cmd` → EINVAL). Without this the global install
 * was invisible to the whole scan, which also blinded engine-repair's donor
 * search: `doctor --fix` reported "no healthy sibling install" while one sat
 * at %AppData%\npm\node_modules.
 */
function resolveNpmRootG({ execFileSync, platform } = {}) {
  const exec = execFileSync || require('child_process').execFileSync;
  const win = (platform || process.platform) === 'win32';
  try {
    const out = exec('npm', ['root', '-g'], {
      encoding: 'utf-8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], shell: win,
    });
    return String(out).trim() || null;
  } catch (_e) {
    return null;
  }
}
```

`shell: win` rather than `shell: true` everywhere: on POSIX a shell is unnecessary and would widen
the quoting surface for no benefit.

- [ ] **Step 4: Make `findDonor` version-aware (ruling R-A)**

`src/utils/engine-repair.js:30` is currently:

```javascript
return installs.find((i) => i.engineOk && norm(i.pkgDir) !== destReal) || null;
```

> ### ⛔ SUPERSEDED — DO NOT IMPLEMENT THE CODE BLOCK BELOW
>
> The rule in this step (`kind !== 'running'`) is **refuted by erratum E-1f**, and again by
> **E-1h** and **E-1g**. It is preserved verbatim only as the historical record of what the plan
> originally said. **What actually shipped** is the two-tier rule, landed across Tasks 3 and 4:
>
> ```javascript
> // tier 1: an explicitly-global donor wins outright (isGlobal covers the case
> // where dedupByRealpath collapsed the global record into `running`)
> // tier 2: rank the remainder by engineVersion, newest first
> ```
>
> Read E-1f, E-1g and E-1h before touching `findDonor`. `kind !== 'running'` donates a
> healthy-but-stale npx copy on an ordinary end-user machine, because `dedupByRealpath` keeps the
> `running` record first and a global install invoked as `amicus doctor` therefore has **no
> `global` record at all**.

<details><summary>Historical: the original, refuted Step 4 text</summary>

`listAmicusInstalls` emits `running` first, so on a developer machine this donates the dev tree's
engine — which after Task 2 is pinned but on any pre-Task-2 or mid-bump checkout is 1.2.20. Prefer
a non-running donor, falling back to the old behaviour so a single-install machine still self-heals:

```javascript
// REFUTED by E-1f — do not implement. See the banner above.
const healthy = installs.filter((i) => i.engineOk && norm(i.pkgDir) !== destReal);
return healthy.find((i) => i.kind !== 'running') || healthy[0] || null;
```

Add a test in `tests/utils/engine-repair.test.js` asserting that with a healthy `running` and a
healthy `global` both present, the **global** is chosen; and that with only `running` healthy, it is
still chosen.

</details>

- [ ] **Step 5: Run both suites**

```bash
npx jest tests/utils/engine-install-scan.test.js tests/utils/engine-repair.test.js
```

Expected: PASS. Baseline before this task was 28 passed / 2 suites for the scan + doctor pair; the
repair suite's existing cases must all stay green.

- [ ] **Step 6: Commit**

```bash
git add src/utils/engine-install-scan.js src/utils/engine-repair.js tests/utils/engine-install-scan.test.js tests/utils/engine-repair.test.js
git commit -m "fix: resolve npm root -g on Windows, and stop donating the running engine (#133)"
```

---

## Task 4: Version-aware `engine-mcp` check, reported as WARN (ruling R-A)

**Files:**
- Modify: `src/utils/engine-install-scan.js:127-140` (inside `scanEngineInstalls`)
- Modify: `src/utils/doctor-engine-check.js:38-68`
- Modify: `docs/usage.md:577`
- Test: `tests/utils/engine-install-scan.test.js`, `tests/utils/doctor-engine-check.test.js`

**Interfaces:**
- Consumes: Task 3's `global` records now being visible on Windows.
- Produces: install records gain `engineVersion: string|undefined`. Only inside
  `scanEngineInstalls`'s `.map()` — **never** in `listAmicusInstalls`.

- [ ] **Step 1: Write the failing tests**

Three behaviours. Note the fixture constraints: `tests/utils/engine-install-scan.test.js:50` and
`:82` assert exact `toEqual` on `listAmicusInstalls`' `{kind,pkgDir}` output — adding a field there
breaks both **and** leaks into `src/utils/doctor-electron-mcp-check.js:43`, which spreads `...i`
into its own parallel record. And the suite's `fakeFs` implements only
existsSync/readdirSync/realpathSync, so the version reader must be an **injected dep**, not
`fs.readFileSync`.

```javascript
// scan: the version rides on scanEngineInstalls' record, not listAmicusInstalls'
it('stamps engineVersion from the roots already on the record', () => {
  const { installs } = scanEngineInstalls({
    ...engineSeams(),
    fs: fakeFs(),
    readEngineVersion: ({ roots }) => (roots.includes('/npx/nm') ? '1.18.15' : '1.2.20'),
    readAmicusMcpConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
  });
  expect(installs.map((i) => i.engineVersion)).toEqual(['1.2.20', '1.18.15']);
});

it('leaves engineVersion undefined when it cannot be resolved, so toEqual fixtures survive', () => {
  const { installs } = scanEngineInstalls({
    ...engineSeams(), fs: fakeFs(), readEngineVersion: () => undefined,
    readAmicusMcpConfig: () => null,
  });
  expect(installs.every((i) => i.engineVersion === undefined)).toBe(true);
});
```

```javascript
// doctor: skew is a WARN, and never fires on the running copy or on unknowns
it('warns when the npx copy and the global install disagree on engine version', () => {
  const v = evaluateEngineInstalls({ scanEngineInstalls: () => ({
    mcpLaunch: 'npx',
    installs: [
      { kind: 'running', pkgDir: '/dev',    engineOk: true, roots: [], engineVersion: '1.2.20' },
      { kind: 'global',  pkgDir: '/global', engineOk: true, roots: [], engineVersion: '1.18.15' },
      { kind: 'npx',     pkgDir: '/npx',    engineOk: true, roots: [], engineVersion: '1.17.3' },
    ],
  }) });
  expect(v.status).toBe('warn');
  expect(v.message).toMatch(/1\.17\.3/);
  expect(v.message).toMatch(/1\.18\.15/);
  expect(v.message).not.toMatch(/1\.2\.20/); // the dev tree is excluded, E-1c
});

it('stays ok when only the running copy differs — every dev checkout looks like this', () => {
  const v = evaluateEngineInstalls({ scanEngineInstalls: () => ({
    mcpLaunch: 'npx',
    installs: [
      { kind: 'running', pkgDir: '/dev',    engineOk: true, roots: [], engineVersion: '1.2.20' },
      { kind: 'global',  pkgDir: '/global', engineOk: true, roots: [], engineVersion: '1.18.15' },
      { kind: 'npx',     pkgDir: '/npx',    engineOk: true, roots: [], engineVersion: '1.18.15' },
    ],
  }) });
  expect(v.status).toBe('ok');
});

it('stays ok when a version is unresolved rather than guessing skew', () => {
  const v = evaluateEngineInstalls({ scanEngineInstalls: () => ({
    mcpLaunch: 'npx',
    installs: [
      { kind: 'global', pkgDir: '/global', engineOk: true, roots: [], engineVersion: undefined },
      { kind: 'npx',    pkgDir: '/npx',    engineOk: true, roots: [], engineVersion: '1.18.15' },
    ],
  }) });
  expect(v.status).toBe('ok');
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest tests/utils/engine-install-scan.test.js tests/utils/doctor-engine-check.test.js
```

Expected: FAIL — `engineVersion` undefined everywhere, `status` `'ok'` on the skew case.

- [ ] **Step 3: Add the version to the scan record**

In `src/utils/engine-install-scan.js`, add a dep default alongside the existing two at `:128-129`
and a reader that walks `roots`. Read `<root>/opencode-ai/package.json` — see E-1e for why not the
binary-adjacent path.

```javascript
/**
 * Resolve the engine version from the roots already on the record. Reads
 * opencode-ai's own package.json, which is a faithful proxy for the executed
 * binary because opencode-ai exact-pins all 12 platform sub-packages.
 * ⚠️ Do NOT read next to the binary: hasOpencodeBinary probes
 * opencode-windows-<arch>/bin/opencode.exe on win32 but .bin/opencode on
 * POSIX, and .bin/ has no package.json — that rule works on Windows only.
 * @returns {string|undefined} undefined (never null) so toEqual fixtures survive
 */
function defaultReadEngineVersion({ roots }) {
  for (const root of roots || []) {
    try {
      const raw = require('fs').readFileSync(path.join(root, 'opencode-ai', 'package.json'), 'utf-8');
      const v = JSON.parse(raw).version;
      if (v) { return String(v); }
    } catch (_e) { /* try the next root */ }
  }
  return undefined;
}
```

Wire it into `scanEngineInstalls`'s existing `.map()` at `:133-137` — **inside that map, not in
`listAmicusInstalls`**:

```javascript
  const readEngineVersion = deps.readEngineVersion || defaultReadEngineVersion;

  const installs = listAmicusInstalls(deps).map((i) => {
    const roots = opencodeRoots({ pkgDir: i.pkgDir });
    return {
      ...i,
      engineOk: !!hasOpencodeBinary({ pkgDir: i.pkgDir }),
      roots,
      engineVersion: safe(() => readEngineVersion({ pkgDir: i.pkgDir, roots }), undefined),
    };
  });
```

Update the `@returns` jsdoc at `:125` to `{kind,pkgDir,engineOk,roots,engineVersion}` and export
`defaultReadEngineVersion` only if a test needs it directly.

- [ ] **Step 4: Report skew as a WARN in the doctor check**

> ### ⚠️ THIS STEP IS INCOMPLETE AS WRITTEN — see erratum E-1g
>
> The snippet below derives the baseline with `installs.find((i) => i.kind === 'global')`. On an
> ordinary end-user machine that returns **undefined**: `dedupByRealpath` keeps the `running`
> record first, so a global install invoked as `amicus doctor` has no `global` record at all,
> `globalV` is undefined, `skewed` is empty, and the check reports `ok`. **As written, the
> release's headline check could never fire for the users who filed #133.**
>
> **What shipped** adds an `isGlobal: true` stamp in `scanEngineInstalls` — never in
> `listAmicusInstalls`, whose `toEqual` fixtures are the contract — and makes the baseline
> `installs.find((i) => i.kind === 'global' || i.isGlobal)`. Everything else in this step
> (WARN-not-ERROR, excluding `kind === 'running'`, unresolved versions never signalling skew)
> stands as written.

`src/utils/doctor-engine-check.js`. The existing `:40` filter and the `broken` branch at `:49-68`
stay exactly as they are — a **missing** engine is still the primary failure and still errors when
unambiguous. Insert the skew comparison **after** the `broken.length === 0` guard at `:50`, so it
only runs when every npx copy is present:

```javascript
  const broken = npxCopies.filter((i) => !i.engineOk);
  if (broken.length === 0) {
    // Version skew (#133): a PRESENT engine can still be the wrong one. The
    // npx copies and the global install resolve independently and at different
    // times, and two versions writing one shared opencode.db is what produced
    // #133's SQLiteError. Compare npx against global ONLY — the running copy is
    // a source checkout whose engine legitimately differs, so including it
    // would fire red on every developer machine and in CI (E-1c). Unresolved
    // versions never signal skew; absence of evidence is not evidence.
    // WARN, never ERROR: doctor --fix has no skew branch, so an error would be
    // unfixable, and this file already downgrades to warn at :64 whenever the
    // copy npx will select is ambiguous.
    const globalV = (installs.find((i) => i.kind === 'global') || {}).engineVersion;
    const skewed = globalV
      ? npxCopies.filter((i) => i.engineVersion && i.engineVersion !== globalV)
      : [];
    if (skewed.length > 0) {
      const detail = skewed.map((i) => `${i.pkgDir} has ${i.engineVersion}`).join('; ');
      return {
        id, name, status: 'warn',
        message: `engine version skew — global install has ${globalV}; ${detail}`,
        hint: HINTS.engineVersionSkew,
      };
    }
    return {
      id, name, status: 'ok',
      message: `engine present in ${npxCopies.length} npx-cache ${plural(npxCopies.length, 'copy', 'copies')}`,
      hint: null,
    };
  }
```

Add `engineVersionSkew` to `src/utils/remediation-hints.js`. It must name a remedy that **actually
fixes skew** — the existing `reinstallEngineAv` text is about antivirus and does not refresh an npx
cache. Something in the shape of: reinstall the global copy (`npm i -g amicus@latest`) so both
resolve the same pinned engine, since amicus pins it exactly as of 4.7.1.

`evaluateEngineMcp`'s fix path at `:78-113` needs no change: `verdict.status === 'ok'` is the early
return, and a `warn` falls through to the `broken.length === 0 → return verdict` guard at `:84`.
Confirm that by reading it, and add a test asserting `--fix` on a skew-only verdict returns the warn
unchanged and calls `repairEngine` zero times.

- [ ] **Step 5: Run the suites**

```bash
npx jest tests/utils/engine-install-scan.test.js tests/utils/doctor-engine-check.test.js tests/cli-handlers-doctor.test.js
```

Expected: PASS. There are 23 `engineOk` literals across four test files; `makeBaseDeps`
(`tests/helpers/doctor-base-deps.js:86`) pins `installs: []`, so the 11 doctor-family suites that
use it are unaffected.

- [ ] **Step 6: Update the documented failure contract**

`docs/usage.md:577` documents engine-mcp's "Can fail as" cell verbatim as
`warn (error only if there's exactly one npx-cache copy and it's broken)`. Extend it to name the
skew warn. Keep the existing error clause — it is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/utils/engine-install-scan.js src/utils/doctor-engine-check.js src/utils/remediation-hints.js docs/usage.md tests/utils/engine-install-scan.test.js tests/utils/doctor-engine-check.test.js
git commit -m "fix: doctor reports engine version skew instead of grading on presence (#133)"
```

---

## Task 5: Escalate the backstop 2× on retry, clamped (#129)

**Files:**
- Modify: `src/council/run-launch.js:92-142` (the `fanoutFn({…})` allowlist) and its `@param`
  docblock at `:64-74`
- Modify: `src/council/run-retry.js:169-174` (the `common` object)
- Test: `tests/council/run-launch.test.js`, `tests/council/run-retry.test.js`

**Do not edit `src/sidecar/fanout.js`** — it already forwards `noOutputBackstopMs` at `:272`, and it
is at exactly 300/300 (Global Constraints). **Do not edit `launchSolo`** (E-3a). **Do not touch
`agent`** (E-3b).

- [ ] **Step 1: Write the failing tests**

```javascript
// run-launch.test.js
it('forwards a provided noOutputBackstopMs to the transport', async () => {
  const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'w', legs: [] }, exitCode: 0 });
  const { launchWave } = createLaunchers({ fanoutFn });
  await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'w', noOutputBackstopMs: 240000 });
  expect(fanoutFn.mock.calls[0][0].noOutputBackstopMs).toBe(240000);
});

it('forwards an explicit 0 unchanged — 0 is the documented disable hatch', async () => {
  // A truthiness spread-guard would drop this. no-output-backstop.js:13-15
  // exists precisely so an explicit 0 is honoured; createNoOutputBackstop
  // arms only on ms > 0, so 0 means "never arm".
  const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'w', legs: [] }, exitCode: 0 });
  const { launchWave } = createLaunchers({ fanoutFn });
  await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'w', noOutputBackstopMs: 0 });
  expect(fanoutFn.mock.calls[0][0].noOutputBackstopMs).toBe(0);
});

it('omits the key entirely when the caller does not set it', async () => {
  const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'w', legs: [] }, exitCode: 0 });
  const { launchWave } = createLaunchers({ fanoutFn });
  await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'w' });
  expect('noOutputBackstopMs' in fanoutFn.mock.calls[0][0]).toBe(false);
});
```

That third assertion is only safe because of the `Number.isFinite` spread-guard shape (E-3d). It is
modelled on the existing `retryOfWaveId` pin at `run-launch.test.js:174`.

```javascript
// run-retry.test.js
it('retries with double the resolved backstop window', async () => {
  // Council never sets the field, so there is nothing on `o` to double —
  // the retry resolves it itself. Must be COMPUTED: hardcoding 240000 would
  // make AMICUS_NO_OUTPUT_BACKSTOP_MS stop applying to retries, so an operator
  // who set 300000 would get a SHORTER retry window than the first attempt.
  const launched = await runRetryCapturingLaunchOpts({ timeout: 15 });
  expect(launched.noOutputBackstopMs).toBe(240000);
});

it('honours AMICUS_NO_OUTPUT_BACKSTOP_MS when doubling', async () => {
  process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS = '300000';
  const launched = await runRetryCapturingLaunchOpts({ timeout: 15 });
  expect(launched.noOutputBackstopMs).toBe(600000);
});

it('preserves the disable hatch: 2 * 0 === 0', async () => {
  process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS = '0';
  const launched = await runRetryCapturingLaunchOpts({ timeout: 15 });
  expect(launched.noOutputBackstopMs).toBe(0);
});

it('clamps the doubled window to the leg timeout', async () => {
  // At --timeout 3 (180_000ms) an unclamped 240_000 can never fire, so the
  // retry would silently reclassify from NO_OUTPUT_BACKSTOP to an ordinary
  // timeout — a different diagnosis, arrived at silently.
  const launched = await runRetryCapturingLaunchOpts({ timeout: 3 });
  expect(launched.noOutputBackstopMs).toBe(180000);
});
```

Build `runRetryCapturingLaunchOpts` from the suite's existing harness rather than inventing one —
`tests/council/run-retry.test.js:446-480` already drives the real NO_OUTPUT_BACKSTOP retry scenario
with `toMatchObject`. Restore `process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS` in an `afterEach`.

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest tests/council/run-launch.test.js tests/council/run-retry.test.js
```

Expected: FAIL. Baseline before this task is 2 suites / 42 tests green.

- [ ] **Step 3: Forward the field in `run-launch.js`**

Add one spread-guarded key to `launchWave`'s literal `fanoutFn({…})` allowlist, next to
`tag: opts.tag` at `:120`:

```javascript
    // Spread-guarded on Number.isFinite, NOT on truthiness: an explicit 0 is
    // this knob's documented disable hatch (no-output-backstop.js:13-15) and a
    // truthiness guard would silently drop it. Guarding at all — rather than a
    // plain `noOutputBackstopMs: opts.noOutputBackstopMs` — keeps the transport
    // call key-identical for run-stage1-launch / run-stage2 / run-chair /
    // run-debate, none of which set it.
    ...(Number.isFinite(opts.noOutputBackstopMs) ? { noOutputBackstopMs: opts.noOutputBackstopMs } : {}),
```

Extend the `@param` docblock at `:64-74`, which enumerates `opts` keys.

- [ ] **Step 4: Escalate and clamp in `run-retry.js`**

`run-retry.js` has **17 lines of headroom (283/300)** and this repo spends 6-12 comment lines per
change. Keep the comment terse; if you cannot fit it, stop and extract rather than trimming the
explanation to nothing.

Compute once above the unit loop (the loop is at `:147`), then add one key to `common` (`:169-174`):

```javascript
const { resolveNoOutputBackstopMs } = require('../utils/no-output-backstop');
// SL-2 retries the SAME model under the SAME conditions, so a latency failure
// is structurally unhealable. Double the window, clamped to the leg timeout so
// the failure CLASS stays NO_OUTPUT_BACKSTOP rather than silently becoming an
// ordinary timeout at a low --timeout. 2*0 === 0 keeps the disable hatch.
const legTimeoutMs = (o.timeout || 15) * 60 * 1000;
const escalatedBackstopMs = Math.min(
  2 * (Number.isFinite(o.noOutputBackstopMs) ? o.noOutputBackstopMs : resolveNoOutputBackstopMs()),
  legTimeoutMs,
);
```

Then `noOutputBackstopMs: escalatedBackstopMs,` inside `common`.

Reading `o.noOutputBackstopMs` first costs nothing and closes the door before someone widens the
council pack allowlist. `(o.timeout || 15) * 60 * 1000` mirrors `src/sidecar/fanout.js:254` — read
that line and match it rather than trusting this snippet.

- [ ] **Step 5: Run the suites, then the neighbours**

```bash
npx jest tests/council/run-launch.test.js tests/council/run-retry.test.js tests/council/run-stages.test.js
```

Expected: PASS. No `toStrictEqual` exists anywhere in `tests/`, and the launch suites use
`toMatchObject`, so nothing should break mechanically.

- [ ] **Step 6: Check the gate and commit**

```bash
node -e "for(const f of ['src/council/run-retry.js','src/council/run-launch.js']){const s=require('fs').readFileSync(f,'utf8');const n=s.split('\n').length;console.log(f,s.endsWith('\n')?n-1:n)}"
git add src/council/run-launch.js src/council/run-retry.js tests/council/run-launch.test.js tests/council/run-retry.test.js
git commit -m "fix: escalate the no-output backstop 2x on retry, clamped to the leg timeout (#129)"
```

---

## Task 6: Reword the backstop message so it stops guessing (#129, #133)

**Files:**
- Modify: `src/headless.js:476-485`
- Modify: `docs/troubleshooting.md:236-242`
- Test: `tests/no-output-backstop-wiring.test.js`

One literal, one file (E-4a). Both hard constraints from E-4b are non-negotiable.

- [ ] **Step 1: Write the failing tests**

```javascript
it('states only what the deadline observed, with no cause claim', () => {
  const msg = reasonFor({ ms: 120000, fromEnv: true });
  expect(msg.startsWith('NO_OUTPUT_BACKSTOP:')).toBe(true);       // models-probe.js:39 anchors on this
  expect(msg).toMatch(/no output, reasoning, or tool calls/);      // wiring test :115/:265 assert this
  expect(msg).not.toMatch(/likely|dead endpoint|not serving|accepted/i);
});

it('names the env var only when the window actually came from it', () => {
  expect(reasonFor({ ms: 120000, fromEnv: true })).toMatch(/AMICUS_NO_OUTPUT_BACKSTOP_MS/);
});

it('does NOT name the env var on a caller-set window', () => {
  // models-probe.js:79 passes a hardcoded PROBE_WINDOW_MS = 30000 that the env
  // var cannot touch, and docs/usage.md:406 promises users that window is "not
  // tunable". Naming the knob there would replace a guess with a lie.
  const msg = reasonFor({ ms: 30000, fromEnv: false });
  expect(msg).not.toMatch(/AMICUS_NO_OUTPUT_BACKSTOP_MS/);
  expect(msg).toMatch(/30s/);
});
```

Exposing `reasonFor` may require lifting the closure to a module-scope pure helper and exporting it.
That is preferable to asserting through the whole `runHeadless` path — but if `src/headless.js`'s
existing export shape makes that awkward, assert through the wiring suite's existing seams instead
and say so in the commit message. Do not add a second literal.

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest tests/no-output-backstop-wiring.test.js
```

Expected: FAIL on the cause-claim and env-gating assertions. Baseline is 9 passed / 9 total.

- [ ] **Step 3: Implement**

`src/headless.js:476-477` already computes the source discriminator:

```javascript
Number.isFinite(options.noOutputBackstopMs) ? options.noOutputBackstopMs : resolveNoOutputBackstopMs(options._env)
```

Capture that predicate into a boolean at that site and reuse it — **do not recompute or invert it**.
Then replace the three-line concatenation at `:483-485`:

```javascript
  // Report ONLY what the mechanism observed. It knows a deadline passed with no
  // substantive activity; it does NOT know why, and at the pre-send firing site
  // (:506-518) it never even observed the request being accepted. The previous
  // text asserted "likely a listed-but-not-serving model or a dead endpoint" —
  // a canned guess with no evidence gate, which sent 30 minutes of #133's
  // debugging at model ids and API keys while the real cause (an opencode
  // version skew) sat in opencode.log the whole time.
  // The env var is named ONLY when the window came from it: models-probe.js:79
  // passes a hardcoded 30s the knob cannot touch, and usage.md:406 promises
  // users that window is not tunable.
  const noOutputBackstopReason = () => 'NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in '
    + `${Math.round(noOutputBackstopMs / 1000)}s — `
    + (backstopFromEnv
      ? 'the AMICUS_NO_OUTPUT_BACKSTOP_MS window (0 disables)'
      : 'a caller-set backstop window (AMICUS_NO_OUTPUT_BACKSTOP_MS does not apply)');
```

The seconds count must keep deriving from `noOutputBackstopMs` — after Task 5 a retry legitimately
reads `240s`. Do not hardcode 120.

- [ ] **Step 4: Run the suites**

```bash
npx jest tests/no-output-backstop-wiring.test.js tests/sidecar/models-probe.test.js tests/council/run-retry.test.js
```

Expected: PASS with **zero edits** to `run-retry.test.js` and `models-probe.test.js` — they define
their own literals as synthetic input and never import the production string. If either goes red,
the `NO_OUTPUT_BACKSTOP:` prefix or the retained phrase was broken.

- [ ] **Step 5: Update the one doc that quotes the message**

`docs/troubleshooting.md`: `:236` quotes the message shape; `:238` restates the removed guess as
fact ("usually a dead or misconfigured endpoint, or a catalog-listed model that's no longer actually
being served upstream") and must be softened to match a message that no longer diagnoses; `:242`
keeps the `AMICUS_NO_OUTPUT_BACKSTOP_MS` remedy, which is still correct for ordinary legs. Add the
#133 lesson — check `~/.local/share/opencode/log/opencode.log` for the session's real error.

Leave `docs/usage.md:406`, `docs/configuration.md:111` and `docs/ROADMAP.md` alone (they elide the
tail or describe the knob). **Do not edit `CHANGELOG.md@ed5c0c02:367-368`** — it is the frozen 4.6.2 entry.
> ⚠️ **Pinned `@ed5c0c02` 2026-08-20 (v4.8 T2.4 fix round 2), and the pin does NOT rescue the
> claim.** T2.4 rewrote that part of `CHANGELOG.md` — but **opened at `ed5c0c02` those lines were
> already NOT the frozen 4.6.2 entry**: they sat inside `## [Unreleased]`, carrying the v4.8
> seat-keyed-matrix bullet. The citation had rotted long before this release. The instruction
> it carries (*do not edit a frozen entry*) still stands on its own terms; only the line
> reference is dead.

Optional, non-blocking: refresh the three stale self-contained fixtures at
`tests/council/run-retry.test.js:443-444`, `tests/sidecar/models-probe.test.js:96-97` and
`tests/sidecar/models-command.test.js:463`. They pass either way.

- [ ] **Step 6: Commit**

```bash
git add src/headless.js docs/troubleshooting.md tests/no-output-backstop-wiring.test.js
git commit -m "fix: the backstop message reports what it observed, not what it guesses (#129, #133)"
```

---

## Task 7: `continue`/`resume` inherit the parent's tag; reject `continue --tag` (R-C, R-D)

**Files:**
- Modify: `src/sidecar/continue.js:90-117` (`createContinueSessionMetadata`), `:197-199` (call site)
- Modify: `src/sidecar/reopen-spend.js` (from Task 1)
- Modify: `src/cli-handlers-resume-continue.js`
- Modify: `docs/usage.md:488, 492-497`, `skills/sidecar/SKILL.md:382-383`
- Test: `tests/continue-resume-spend.test.js`

`src/sidecar/resume.js` needs **zero** changes — it reuses the parent's session dir, so `reloaded`
at `:256` already carries the tag (E-5a).

- [ ] **Step 1: Write the failing tests**

`seedSession(projectDir, taskId, overrides)` at `tests/continue-resume-spend.test.js:34-43` already
takes metadata overrides, so seeding a tag is a one-word change. The suite already mocks
`../src/headless` and points `AMICUS_CONFIG_DIR` at a tmpdir — **zero paid legs** (E-9b).

The `/* … */` below stands for the existing call's option object: copy it from the live
`continueSidecar(...)` / `resumeSidecar(...)` calls in the `describe` at `:80-163` rather than
composing one. Likewise, resolve the new session's metadata path the way that block already
resolves paths — do not invent a `newSessionMetadataPath()` helper if the suite reaches for
`SessionPaths` directly.

```javascript
it('a continued session inherits the parent tag onto its own metadata.json', async () => {
  seedSession(projectDir, 'parent', { tag: 'demo' });
  await continueSidecar('parent', { /* existing harness opts */ });
  const meta = JSON.parse(fs.readFileSync(newSessionMetadataPath(), 'utf-8'));
  expect(meta.tag).toBe('demo');
});

it('an untagged parent leaves the key ABSENT, not null (D13)', async () => {
  seedSession(projectDir, 'parent', {});
  await continueSidecar('parent', { /* … */ });
  const meta = JSON.parse(fs.readFileSync(newSessionMetadataPath(), 'utf-8'));
  expect(meta.tag).toBeUndefined();
  expect('tag' in meta).toBe(false);
});

it('the continue spend row carries the tag instead of landing in (unattributed)', async () => {
  seedSession(projectDir, 'parent', { tag: 'demo' });
  await continueSidecar('parent', { /* … */ });
  const rows = readSpendRows(ledgerDir);
  expect(rows[0].tag).toBe('demo');
  expect(groupRows(rows, 'tag').map((g) => g.key)).not.toContain('(unattributed)');
});

it('resume carries the tag with no change to resume.js', async () => {
  seedSession(projectDir, 'solo', { tag: 'demo' });
  await resumeSidecar('solo', { /* … */ });
  expect(readSpendRows(ledgerDir)[0].tag).toBe('demo');
});

it('a two-hop chain keeps the tag — this is what a ledger-only fix breaks', async () => {
  // Continue #2 reads continue #1's metadata. If the tag were only passed to
  // appendSpend and never persisted, depth 2 scatters back to (unattributed).
  seedSession(projectDir, 'parent', { tag: 'demo' });
  const first = await continueSidecar('parent', { /* … */ });
  const second = await continueSidecar(first.taskId, { /* … */ });
  expect(readSpendRows(ledgerDir).at(-1).tag).toBe('demo');
});
```

The grouper is `groupRows`, not `groupSpend` (`src/spend-query.js:131`).

- [ ] **Step 2: Run and CAPTURE the red output — this is Rider B (E-9c)**

```bash
npx jest tests/continue-resume-spend.test.js
```

Expected: FAIL. **Paste the failing output showing the row grouped under `(unattributed)` into the
commit message or the PR body.** That observation is the deliverable the backlog asked for, and this
is the honest way to get it — it pins the regression in CI, which a manual run never would.
Baseline before this task: 15 passed / 15.

- [ ] **Step 3: Carry the tag onto the continuation's metadata**

Three in-place edits in `src/sidecar/continue.js`, one new line total:

1. `:91` — add `tag` to the destructure:
   `const { model, briefing, headless, agent, gateway, resolutionVersion, tag } = options;`
2. Inside the `const metadata = {…}` literal at `:96-106`, add the D13 idiom. Copy
   `src/sidecar/start-metadata.js:50` verbatim rather than trusting this snippet:
   `...(tag ? { tag } : {}),`
   **Do not** write `metadata.tag = tag` after the literal, and **do not** pass `null` — the key
   must be absent when there is no tag.
3. `:198` — add `tag: oldMetadata.tag,` to the existing options object passed to
   `createContinueSessionMetadata`. `oldMetadata` is already in scope from `:157-158`.

- [ ] **Step 4: Forward the tag to the ledger row**

In `src/sidecar/reopen-spend.js`, add `tag` to the `appendSpend` call. The ledger uses the
**opposite** convention — null-not-absent (`src/utils/spend-ledger.js:94`, documented at `:58-61`).
Copy `src/sidecar/start.js:237`'s `tag: m.tag || null` and its rationale:

```javascript
      appendSpend({ taskId, model, mode, usage, op, status, project, gateway, tag: metadata.tag || null }, ctx);
```

This single edit fixes **both** continue and resume.

- [ ] **Step 5: Reject `continue --tag` (ruling R-D)**

`amicus continue --tag foo` parses today, passes `unknownFlags()` (`known-flags.js:67` scrapes the
union of all usage blocks, so `--tag` is globally accepted), and is read by nobody — the
correct-but-silent degrade the Amicus product principle bars. Add a rejection in
`src/cli-handlers-resume-continue.js` (130/300, room), mirroring the shape and exit code of the
existing `--tag` + `--retry-failed` rejection at `src/cli-handlers-fanout.js:27-29`. Read that first
and match it.

Message must say what to do instead — the tag is inherited from the parent session, so there is
nothing to set. Apply to both `continue` and `resume`. Add a test asserting the exit code and the
message.

- [ ] **Step 6: Run the suites**

```bash
npx jest tests/continue-resume-spend.test.js tests/continue-model-routing.test.js tests/cli-handlers-resume-continue.test.js
```

Expected: PASS, including the green `(unattributed)` assertion.

- [ ] **Step 7: Rewrite the three docs that now state a falsehood**

This is required, not optional — R-C. All three currently document the behaviour being changed:

- `docs/usage.md:492-497` — the paragraph headed **"Known limitation: a tag is not inherited"**
  names all three cases and is now false. Rewrite it to describe inheritance, and note that
  `--tag` is rejected on continue/resume/`--retry-failed` because the tag comes from the parent.
- `docs/usage.md:488` — the "set at launch time" clause needs the same adjustment.
- `skills/sidecar/SKILL.md:382-383` — same claim, same fix.

- [ ] **Step 8: Check the gate and commit**

```bash
node -e "const s=require('fs').readFileSync('src/sidecar/continue.js','utf8');const n=s.split('\n').length;console.log('continue.js',s.endsWith('\n')?n-1:n)"
git add src/sidecar/continue.js src/sidecar/reopen-spend.js src/cli-handlers-resume-continue.js docs/usage.md skills/sidecar/SKILL.md tests/
git commit -m "feat: continue and resume inherit the parent session's tag; reject --tag on both"
```

---

## Task 8: `--retry-failed` inherits the wave's tag

**Files:**
- Modify: `src/sidecar/fanout-retry.js:76` (return contract), `:122-124` (no-op doc), `:151`
  (`fanoutOpts`)
- Test: `tests/sidecar/retry-failed.test.js`

**Do not edit `src/sidecar/fanout.js`** (300/300). **Do not pre-seed the new wave dir's
metadata.json** — E-6c explains why that implementation passes review and still ships the bug.
**Do not weaken the `--tag` + `--retry-failed` rejection** at `src/cli-handlers-fanout.js:27-29`;
it must survive verbatim, message included, and `tests/bin/preflight-json-envelope.test.js:170-178`
must stay green unchanged. The inherit is sourced from disk, never from `args.tag`.

- [ ] **Step 1: Write the failing tests**

```javascript
it('buildRetryPlan surfaces the original wave tag', () => {
  const plan = buildRetryPlan(origWaveId, project, {});
  expect(plan.tag).toBe('demo');
});

it('retryFailedWave forwards the inherited tag as options.tag', async () => {
  await retryFailedWave(origWaveId, project, {});
  expect(runFanoutMock.mock.calls[0][0].tag).toBe('demo');
});

it('THE SPEND ROW carries the tag — not just the wave doc', async () => {
  // stampLegAttribution (fanout-wave-io.js:84) fires at fanout.js:126, BEFORE
  // the wave dir exists at :144-146, and reads only options.tag. A pre-seeded
  // metadata implementation produces a correct wave.json while every leg spend
  // row stays tag:null. Asserting the wave doc alone would pass against the bug.
  await retryFailedWave(origWaveId, project, {});
  expect(readSpendRows(ledgerDir).every((r) => r.tag === 'demo')).toBe(true);
});

it("the retry wave's own metadata carries the tag, so retry-of-a-retry inherits", async () => {
  await retryFailedWave(origWaveId, project, {});
  expect(JSON.parse(fs.readFileSync(newWaveMetadataPath(), 'utf-8')).tag).toBe('demo');
});

it('an untagged original produces no tag anywhere', async () => {
  await retryFailedWave(untaggedWaveId, project, {});
  expect(JSON.parse(fs.readFileSync(newWaveMetadataPath(), 'utf-8')).tag).toBeUndefined();
});

it('the zero-eligible no-op doc still carries the tag', async () => {
  const doc = await retryFailedWave(waveWithNothingToRetry, project, {});
  expect(doc.tag).toBe('demo');
});
```

Drive `recordAttemptSpend` via its `deps.spendDir` test seam
(`src/sidecar/fanout-leg-fallback.js:29-30, :51`) so no real ledger is touched.

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest tests/sidecar/retry-failed.test.js
```

Expected: FAIL — `plan.tag` undefined.

- [ ] **Step 3: Widen `buildRetryPlan`'s return contract**

`src/sidecar/fanout-retry.js:76` is `return { eligible };` and discards `waveMeta`, which has been
in scope since `:51`. Widen it:

```javascript
  // waveMeta has been read since :51 but was discarded; retryFailedWave needs
  // the tag BEFORE it builds fanoutOpts, and its own origMeta re-read at :176
  // runs after runFanoutImpl at :153 — too late to influence the launch.
  return { eligible, tag: waveMeta.tag };
```

Safe to widen: `tests/sidecar/retry-failed.test.js` only asserts `plan.eligible` / `plan.error`
(`:32-33, :49, :58, :218-221`); there is no whole-object `toEqual` on the plan. Note the two early
`return { eligible: [], error: … }` guards at `:52-54` legitimately carry no tag.

- [ ] **Step 4: Thread it into `fanoutOpts` and the no-op doc**

At `:151`, add to `fanoutOpts` using the absent-not-null idiom that matches `fanout.js:152`:

```javascript
      ...(plan.tag ? { tag: plan.tag } : {}),
```

That single value feeds three consumers inside `fanout.js` with no edit there: the metadata write at
`:152`, `stampLegAttribution` at `:126`, and the three `buildWaveResult` sites.

At `:122-124`, the zero-eligible no-op doc passes neither tag nor pack, so a `--json` caller
retrying a tagged wave with nothing to retry gets a doc missing the tag every other path supplies.
Add `tag: plan.tag` there — one additive line in a file already being edited (E-6d).

`src/utils/result-schema-rebuild.js:89-94` needs no change: it sources `meta.tag` off the wave's own
metadata.json, which now carries it.

- [ ] **Step 5: Run the suites**

```bash
npx jest tests/sidecar/retry-failed.test.js tests/bin/preflight-json-envelope.test.js tests/sidecar/fanout.test.js
```

Expected: PASS, with `preflight-json-envelope.test.js` green **without edits** — that is the proof
the rejection survived.

- [ ] **Step 6: Commit**

```bash
git add src/sidecar/fanout-retry.js tests/sidecar/retry-failed.test.js
git commit -m "feat: --retry-failed inherits the original wave's tag"
```

---

## Task 9: F-4 — delete the dead helpers in `scripts/validate-docs.js`

**Files:**
- Modify: `scripts/validate-docs.js:18-25` (CONFIG), `:35`, `:68`, `:84`, `:183-188` (exports)
- Modify: `tests/scripts/validate-docs.test.js:8-13` and three `describe` blocks
- Modify: `docs/testing.md:526`

**The file stays live** (E-7a): `.husky/pre-commit:31` runs it on every commit in pre-commit mode.
`runPreCommitCheck`, `checkStagedFilesDrift` and `runFullAnalysis` must survive untouched.

- [ ] **Step 1: Confirm unreachability yourself before deleting**

```bash
grep -rn "validate-docs" --include=*.js --include=*.json --include=*.yml --include=pre-commit . | grep -v node_modules
grep -rn "extractSection\|findFilesInSection\|checkDrift" . --include=*.js | grep -v node_modules
```

Expected: `validate-docs` appears in `.husky/pre-commit` and `package.json` scripts; the three
helper names appear only in `scripts/validate-docs.js` and `tests/scripts/validate-docs.test.js`.

- [ ] **Step 2: Delete**

Remove `extractSection`, `findFilesInSection`, `checkDrift`, their entries in `module.exports`
(`:183-188`), and `CONFIG.mappings`. **Also delete `CONFIG.docFile`** (ruling in E-7b) — the staged
check hardcodes `'CLAUDE.md'` at `:101`, so `trackedDirs` is the only surviving key. Leave `:101` as
it is; wiring it to a config key it no longer needs would be churn.

- [ ] **Step 3: Update the test file**

Remove the three `describe` blocks and the three names from the destructure at `:8-13`. The suite
goes from 12 passing tests to 4.

- [ ] **Step 4: Run**

```bash
npx jest tests/scripts/validate-docs.test.js
node scripts/validate-docs.js
```

Expected: 4 passed; the bare script run exits 0 (pre-commit mode still works).

- [ ] **Step 5: Fix the docs row and commit**

`docs/testing.md:526` still advertises "Section extraction, drift comparison, staged file check" for
this script. Only the staged check remains.

```bash
git add scripts/validate-docs.js tests/scripts/validate-docs.test.js docs/testing.md
git commit -m "chore: delete validate-docs' three unreachable helpers (F-4)"
```

---

## Task 10: F-2 and F-6 doc gates, plus Rider A

**Files:**
- Modify: `tests/docs-command-coverage.test.js`
- Create: `tests/docs-anchors.test.js`
- Modify: `tests/sidecar/fanout.test.js`

- [ ] **Step 1: F-2 — derive the command list instead of hardcoding it**

Replace the two `it.each` literal arrays (`:13` and `:27-30`) with a scrape:

```javascript
const COMMANDS = [...read('bin/amicus.js').matchAll(/^\s*case '([^']+)':/gm)].map((m) => m[1]);
```

Add one free cross-check — `src/cli.js:751` already exports `getCommandNames()` as the repo's stated
anti-rot idiom, and nothing currently pins it against the switch:

```javascript
it('the switch labels and getCommandNames() agree', () => {
  expect(new Set(COMMANDS)).toEqual(new Set(getCommandNames()));
});
```

Apply the scrape to **README.md and docs/usage.md** — both carry all 21. **Do not** extend it to
`docs/troubleshooting.md` (E-8d); leave its two existing assertions verbatim.

**Keep the loose matcher** `expect(table).toContain('amicus ' + cmd)`. Do not tighten it to a full
table row: the README table is 22 rows for 21 commands (both `amicus council` and `amicus council
run` have rows) and `README.md:414/:415` carry placeholders (`| \`amicus status <id>\` |`), so a
`| \`amicus <cmd>\` |` matcher lands red on `status` and `watch`.

- [ ] **Step 2: F-6 — generalize the anchor gate**

Create `tests/docs-anchors.test.js`. Scope: **top-level `docs/*.md` (non-recursive) + README.md**,
in-page anchors only (E-8a). Structure it as **one flat table** of `{file, anchor}` pairs, because
ten of the fifteen docs have zero anchors and Jest 29 treats `.each([])` as a hard failure (E-8b):

```javascript
// Scope is deliberate: top-level docs/*.md + README.md, which is exactly what
// package.json `files: ["docs/*.md"]` ships. docs/superpowers/** is 113 frozen
// historical plan/spec files with 5 unresolvable anchors, two of which quote
// the `](#…)` pattern to DESCRIBE this very regex and cannot be fixed by editing.
const pairs = [];
for (const file of docFiles()) {
  const doc = read(file);
  for (const m of doc.matchAll(/\]\(#([^)]+)\)/g)) { pairs.push({ file, anchor: m[1] }); }
}

it('the corpus is the expected size', () => {
  expect(docFiles().length).toBe(16);
  expect(pairs.length).toBeGreaterThan(20);
});

it.each(pairs)('$file #$anchor resolves to a real heading', ({ file, anchor }) => {
  expect(slugsFor(file)).toContain(anchor);
});
```

Reuse the `githubSlug` helper from `tests/docs-council-toc-anchors.test.js:33` **verbatim** — it
deliberately does not collapse adjacent hyphens, and the "Council presets" case depends on that.
Build the file list with `fs.readdirSync` + `path.join` and compare on `path.basename` so the
windows-latest leg's `docs\council.md` separators do not matter. Add a comment noting the heading
regex also matches `#` comment lines inside fenced code blocks (9 pseudo-headings in council.md, 10
in electron-testing.md) — that makes the gate permissive, never falsely red.

**Keep `tests/docs-council-toc-anchors.test.js`'s two council-specific assertions** (the doubled
hyphen slug and the TOC line target) in their own `describe` — they encode a real prior bug a fixup
commit once inverted (E-8c). Do not fold them into the generic loop.

Fix the one live cross-file breakage while you are here: `docs/council.md:543` links to
`../skills/second-opinion/SKILL.md#stage-2--cross-review`, and that heading no longer exists. The
neighbouring `:997` `#output--naming` does resolve. Fix the link; **do not** add a cross-file gate
in this patch — file it as a rider for v4.8.0.

- [ ] **Step 3: Rider A — prove `--quiet` is silent on both streams**

Add to the `describe` in `tests/sidecar/fanout.test.js` that owns `baseOpts()` (`:261`, already
`quiet: true`). The harness already mocks route-launch, logger, pricing, `headless.runHeadless`,
`session-utils.startOpenCodeServer` and context-builder — zero paid legs.

```javascript
it.each([true, false])('quiet writes nothing to stdout or stderr (json:%s)', async (json) => {
  // Both halves, because they live on different streams: the launch banner and
  // wave doc are stdout (fanout.js:77/:80) while per-leg progress and the
  // heartbeat are stderr (fanout-leg.js:58/:188, wave-progress.js:75).
  // Spy console.log, NOT process.stdout.write — jest swaps in its own Console
  // that never funnels through process.stdout.write, so that spy passes vacuously.
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await runFanout({ ...baseOpts(), json });
  expect(logSpy).not.toHaveBeenCalled();
  expect(errSpy).not.toHaveBeenCalled();
});
```

Precedents to copy: `:576-587` and `:594-620` (console.log), `:566-574` (process.stderr.write).

- [ ] **Step 4: Prove each new gate can fail**

A gate that cannot go red is not a gate. For each of F-2, F-6 and Rider A, mutate the thing it
watches, confirm red, revert, confirm green. Assert the bytes actually changed — a mutation that
silently no-ops reads as a pass. Use node, not sed.

```bash
npx jest tests/docs-command-coverage.test.js tests/docs-anchors.test.js tests/docs-council-toc-anchors.test.js tests/sidecar/fanout.test.js
```

- [ ] **Step 5: Commit**

```bash
git add tests/docs-command-coverage.test.js tests/docs-anchors.test.js tests/sidecar/fanout.test.js docs/council.md
git commit -m "test: derive the command-coverage list, gate in-page anchors across docs/, pin --quiet silence"
```

---

## Task 11: F-3 marker-freshness gate, CHANGELOG, and final verification

**This task lands LAST.** Promoting `generate-docs --check` to a jest assertion turns every
uncommitted file add/rename/JSDoc edit under `bin/ src/ electron/ scripts/ evals/` into a red suite
that the pre-push hook blocks on — and Task 1 added a module and Task 9 changed exports (E-8e).

**Files:**
- Create: `tests/scripts/generate-docs-check.test.js`
- Modify: `scripts/generate-docs.js` (export `TREE_DIRS`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Regenerate CLAUDE.md so the tree is clean first**

```bash
node scripts/generate-docs.js && node scripts/generate-docs.js --check
```

Expected: `All markers are current.` exit 0. Commit any CLAUDE.md movement before adding the gate.

- [ ] **Step 2: Write the gate**

Call the exported helpers in-process. **Never call `main()` or `runCheckMode()`** — they
`process.exit` and would kill the jest worker.

```javascript
// Marker freshness (F-3). The pre-commit hook runs generate-docs in WRITE mode
// and self-heals, so --check runs nowhere automatically — a stale CLAUDE.md can
// only be caught here. If this goes red, run `node scripts/generate-docs.js`.
it('CLAUDE.md AUTO markers are current', () => {
  const tree = buildDirectoryTree(ROOT, TREE_DIRS);
  const modules = buildModuleIndex(ROOT);
  expect(checkMarkersAreCurrent(read('CLAUDE.md'), { tree, modules })).toEqual([]);
});

it('CLAUDE.md cross-links all resolve', () => {
  expect(validateCrossLinks(read('CLAUDE.md'), ROOT)).toEqual([]);
});
```

**`buildDirectoryTree` takes a second argument.** `TREE_DIRS` lives at
`scripts/generate-docs.js:26` and is **not exported** — omitting it throws "dirs is not iterable".
Add `TREE_DIRS` to that file's `module.exports` and import it, so the literal cannot rot. Do not
duplicate the array.

Give the assertion a failure message naming the fix command, so an implementer who hits it
mid-flight knows it is not their bug.

- [ ] **Step 3: Prove it fails, then passes**

Mutate a JSDoc first line under `src/`, run the suite, confirm red, revert, confirm green.

```bash
npx jest tests/scripts/generate-docs-check.test.js
```

⚠️ If this gate goes red on exactly one OS leg in CI, the cause is
`scripts/generate-docs-helpers.js:157-158, 217-220`, which sort with `localeCompare` — locale
dependent, and `--check` has never run on CI before. The fix is a plain code-unit sort plus one
CLAUDE.md regeneration. Do not chase it locally; note it and watch the matrix.

- [ ] **Step 4: Write the CHANGELOG**

Roll a `## [4.7.1]` section. The `[Unreleased]` block already holds the `#142` ENOENT flake fix —
carry it in. Sections and required honesty:

- **Changed** — tag inheritance for continue/resume/`--retry-failed` (R-C). This deletes a
  documented limitation that v4.7.0's own notes called "future work, not oversights", so it goes
  under **Changed**, not **Fixed**, and must say that `amicus list` now shows a TAG for
  continuations and that `--tag` is rejected on those commands.
- **Changed** — `opencode-ai` and `@opencode-ai/sdk` pinned to 1.18.15. Name the engine upgrade
  explicitly: dev and CI move from 1.2.20, so this is the first release whose suite ran on the
  engine users get. State the honest scope per E-2a — the pin makes the resolved engine a pure
  function of the amicus version; it does nothing for a user whose amicus version has not moved.
- **Fixed** — the backstop message; the backstop 2× retry escalation, worded as "retries can now
  heal it", **not** "the class is fixed" (E-3f); `doctor` reporting engine version skew; the
  Windows `npm root -g` blindness and its `doctor --fix` donor consequence.
- **Internal** — the `reopen-spend.js` extraction, the F-4 deletion, and the three new gates.

- [ ] **Step 5: Full verification**

```bash
npm test
npm run lint
npm run check:sizes
```

All three must be green. Then confirm no gated file crossed 300:

```bash
node -e "const{execSync}=require('child_process');const fs=require('fs');for(const f of execSync('git diff --name-only origin/main...HEAD',{encoding:'utf8'}).trim().split('\n')){if(!/^(src|electron)\/.*\.js$/.test(f)||!fs.existsSync(f))continue;const s=fs.readFileSync(f,'utf8');const n=s.split('\n').length;const c=s.endsWith('\n')?n-1:n;console.log((c>300?'!! ':'   ')+c+'  '+f)}"
```

- [ ] **Step 6: Commit**

```bash
git add tests/scripts/generate-docs-check.test.js scripts/generate-docs.js CHANGELOG.md CLAUDE.md
git commit -m "test: gate CLAUDE.md marker freshness in jest (F-3); changelog for 4.7.1"
```

---

## Verification before the PR

- [ ] `npm test` green, and the suite count compared against the branch's own merge-base.
      ⚠️ **CORRECTED 2026-08-09 during Task 2.** This plan originally cited `5bd2615` as
      *507 suites / 6883 passed / 8 skipped*. **That is v4.7.0's count (`caf4d7e`), not this
      branch's base.** PRs #141/#142 landed between them and added
      `tests/helpers/read-if-present.test.js` (3 cases, verified absent at `caf4d7e`) plus
      substantial additions to four existing suites. The real base at `5bd2615` is
      **508 suites / 6890 passed / 9 skipped**. Measured at Task 2's head (`4eb0cc6`):
      508 / 6893 / 9, i.e. base + Task 2's 3 new assertions, 0 failures.
      This is the "re-measure baselines at the branch's own merge-base" rule biting the plan
      that cites it — do not compare against a number carried forward from the last release.
- [ ] `npm run lint`, `npm run check:sizes` green.
- [ ] `node scripts/generate-docs.js --check` exits 0.
- [ ] **This plan file is committed on the branch.** Untracked-plan-at-push has now bitten twice
      (PR2's I1, then PR3). Check it explicitly.
- [ ] Every doc claim in the PR body diffed against the **shipped commits**, not against this plan's
      prose.
- [ ] `git diff origin/main...HEAD -- src/sidecar/fanout.js` is **empty**.
