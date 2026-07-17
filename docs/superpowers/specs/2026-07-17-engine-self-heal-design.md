# Engine self-heal at server start — design

**Date:** 2026-07-17
**Status:** Approved (brainstorming)
**Scope:** Report item #2 (verify the engine binary at MCP startup and self-heal
— copy from a healthy install if the `opencode-*` packages are missing, rather
than failing every call at runtime). This is the deferred sibling of the
2026-07-17 doctor-cross-install-engine-awareness work, which added detection
only.

## Problem

The MCP server is registered as `npx -y amicus@latest mcp`
(`scripts/postinstall.js`), so it runs from an npx-cache copy. When that copy is
genuinely missing the `opencode-*` platform packages — an optional-dependency
skip or an AV quarantine at install time — every `amicus_fanout` /
`amicus_start` fails instantly at the runtime guard in
`src/opencode-client.js` `startServer` (~line 637): `hasOpencodeBinary()` is
false, so it throws `engineMissing` before the SDK is even loaded.

As of v3.2.1 the failure is now *detectable*: `amicus doctor`'s `engine-mcp`
check (`doctor-engine-check.js` + `engine-install-scan.js`) probes every install
that could serve the MCP and names the broken npx copy, and the resolver probes
both nested and hoisted roots (#69). But nothing *recovers*: a truly-absent
engine still fails every call until the user manually reinstalls or copies the
packages across by hand — which is exactly the workaround the bug report used
(robocopy the `opencode-*` dirs from the healthy global install into the npx
copy, after which the next fanout picked up the binary with no MCP restart).

## Goal

When the engine is missing at server start, self-heal in place by copying the
`opencode-*` packages from a healthy sibling install, then proceed — instead of
throwing. Mirror the existing Electron self-heal cluster
(`electron-install.js` / `electron-lock.js` / `electron-ensure.js`) in shape and
seams. Additionally, let `amicus doctor --fix` repair broken npx copies
proactively, mirroring the Electron `--fix` path.

**Strategy: copy from a healthy sibling, never re-fetch.** `engine-install-scan`
already enumerates running/global/npx copies with `engineOk` per copy, so the
donor lookup is free. Copying needs no network, guarantees a platform match (the
donor is on the same machine), and sidesteps the "re-running the opencode
postinstall is the same flaky trap" the `startServer` comment already warns
about. Re-fetch (npm / postinstall) would reintroduce that trap and is out of
scope.

**Non-goals:** changing the MCP registration away from npx (separate report
item); a network re-fetch fallback; defeating an AV that re-quarantines the
*copied* `.exe` (see Known limitations).

## Components

The new modules live in `src/utils/` (co-located with `engine-install-scan.js`,
no GUI coupling), whereas the Electron equivalents sit in `src/sidecar/`.

### 1. `src/utils/engine-repair.js` (new, pure, fully seamed)

The repair primitive: make the engine present *on disk* in a target copy. No
PATH mutation — that keeps it targetable at any copy (the runtime path repairs
the running copy; `doctor --fix` repairs a foreign npx copy) and keeps its tests
free of `process.env.PATH` / `path.delimiter` fixtures.

**`repairEngine({ destPkgDir?, deps? }) → Promise<{repaired, reason?, contended?, donor?, copied?}>`**

1. `destPkgDir` defaults to the running copy (`path.join(__dirname, '..', '..')`).
   If `hasOpencodeBinary({ pkgDir: destPkgDir })` is already true → `{repaired:true}`.
2. Donor: `scanEngineInstalls()` → first install with `engineOk === true` whose
   real path ≠ `destPkgDir`'s real path. None found → `{repaired:false,
   reason:'no healthy sibling install to copy the engine from'}`.
3. Source root: the root in `opencodeRoots({ pkgDir: donorPkgDir })` that actually
   holds the engine, detected via `hasOpencodeBinary({ nodeModulesRoot: root })`
   (nested vs hoisted — the donor's layout is not assumed).
4. Acquire the cross-process file lock keyed by `destPkgDir` (see engine-lock). A
   live holder → `{repaired:false, contended:true, reason:'another engine repair
   is in progress'}`. A stale/orphaned lock is stolen.
5. `fs.mkdirSync(destRoot, {recursive:true})` where `destRoot =
   path.join(destPkgDir, 'node_modules')` (the nested root — always probed by
   `hasOpencodeBinary`, private to amicus so it cannot disturb a hoisted
   sibling's packages). Then `fs.cpSync(src, dst, {recursive:true, force:true})`
   for every `opencode-*` dir in the source root. Collect copied names.
6. Re-check `hasOpencodeBinary({ pkgDir: destPkgDir })`. Release the lock in
   `finally`. Return `{repaired:<recheck>, donor, copied}` (plus `reason` when
   false). Any `cpSync`/`mkdir` throw is caught → `{repaired:false, reason}`; it
   is never propagated.

Seams (`deps`): `fs` (existsSync/readdirSync/realpathSync/mkdirSync/cpSync),
`scanEngineInstalls`, `hasOpencodeBinary`, `opencodeRoots`, `acquireLock`,
`runningPkgDir`/`destPkgDir`. Factored helpers `findDonor`, `engineSourceRoot`,
`copyEnginePackages` keep every function under 50 lines.

Copy mechanism is `fs.cpSync` (stable since Node 16.7; the repo requires Node
≥18): cross-platform and colon-free, replacing the report's Windows-only
robocopy. Every `opencode-*` dir is copied (the wrapper `opencode-ai` plus the
platform binary packages), matching the report's manual fix and healing the rare
case where the wrapper is also absent. The donor is same-machine, so all its
`opencode-*` packages are platform-correct.

### 2. `src/utils/engine-lock.js` (new)

A direct mirror of `src/sidecar/electron-lock.js`, keyed by `pkgDir`, writing
`amicus-engine-repair-<hex>.lock` under `os.tmpdir()`. Same stale detection: an
old timestamp, a dead holder PID (ESRCH), or a corrupt/empty lockfile is treated
as orphaned and stolen; a live, recent holder throws EEXIST (honest contention).
Exports `acquireRepairLock`, `isStaleLock`, `lockPathFor`, `STALE_MS`.

A deliberately separate file rather than refactoring the shipped
`electron-lock.js` into a shared primitive — zero regression risk to the working
GUI heal, at the cost of ~95 near-duplicate lines. The concurrency it guards is
real: the report observed multiple live MCP processes, so two processes could
self-heal the same npx copy at once; the lock serializes the `cpSync` so no leg
ever reads a half-written `.exe`.

### 3. `src/utils/engine-ensure.js` (new)

A mirror of `src/sidecar/electron-ensure.js`: the single-flight wrapper the
runtime path calls.

**`ensureEngine({ deps?, repairOptions? }) → Promise<{ok, reason?, donor?}>`**

- Fast path: `hasOpencodeBinary()` true → `{ok:true}` (cheap stat; safe every
  call).
- Single-flight: a module-level promise memoizes an in-flight (or
  already-succeeded) repair so concurrent fanout-leg server starts in one process
  share ONE `repairEngine`. Only success is memoized; a failed attempt clears the
  guard so a later call retries.
- On repair success: refresh PATH via `ensureNodeModulesBinInPath()` (defensive —
  callers already add the candidate dirs) and re-check; return `{ok:true, donor}`.
  On failure: `{ok:false, reason:<repair reason>}`.

Exports `_resetEnsureEngine()` (test-only) to clear the guard between tests.
Seams: `deps.hasOpencodeBinary`, `deps.repairEngine`, `deps.ensurePath`,
`deps.logProgress`.

### 4. `src/opencode-client.js` `startServer` (edit, ~8 lines)

At the existing missing-binary guard, attempt the self-heal before throwing:

```js
if (!hasOpencodeBinary()) {
  const ensureEngine = options._ensureEngine
    || require('./utils/engine-ensure').ensureEngine;
  const healed = await ensureEngine().catch(() => ({ ok: false }));
  if (!healed.ok) {
    const HINTS = require('./utils/remediation-hints');
    const opencodeRoots = options._opencodeRoots
      || require('./utils/path-setup').opencodeRoots;
    const note = healed.reason ? ` (self-heal: ${healed.reason})` : '';
    throw new Error(`${HINTS.engineMissing} Searched: ${opencodeRoots().join(', ')}${note}`);
  }
}
```

The message contract is unchanged on the failure path (still opens with
`HINTS.engineMissing` then `Searched: <roots>`), so existing engine-missing
assertions hold; the ` (self-heal: …)` suffix is additive. `_ensureEngine` is a
new test seam alongside the existing `_hasOpencodeBinary` / `_opencodeRoots`. The
"NOTE: this does NOT auto-repair — re-running the opencode postinstall is the
same flaky trap" comment is updated to explain the copy-based heal (which is not
that trap).

Self-heal runs only when the engine is genuinely missing (the fast path skips it
otherwise), so the added latency — a one-time `cpSync` of a few tens of MB, ~1–5s
— is paid once; subsequent calls fast-path.

### 5. `amicus doctor --fix` (edit `doctor-engine-check.js` + `cli-handlers-doctor.js`)

`evaluateEngineInstalls(d)` stays sync and pure (reporting). A new async wrapper
`evaluateEngineMcp(d)` adds fix behaviour:

- Compute the normal verdict. If `!d.fix` or the verdict is already `ok`, return
  it unchanged.
- Otherwise, from a fresh scan take the broken npx copies
  (`kind === 'npx' && !engineOk`). If none are copy-fixable (e.g. the "no cached
  copy yet" warn), return the verdict unchanged.
- For each broken copy, `await d.repairEngine({ destPkgDir: copy.pkgDir })` (donor
  = the healthy running/global doctor copy), catching throws into
  `{repaired:false, reason}`.
- Re-evaluate from a fresh scan. If now `ok`, report `… (self-healed N npx-cache
  copies)`; else append `; self-heal incomplete: <pkgDir — reason; …>`.

`cli-handlers-doctor.js`: add `repairEngine: (o) => require('./utils/engine-repair').repairEngine(o)`
to `realDeps()`, and change the one `engine-mcp` check from `guard(...)` to
`await guardAsync('engine-mcp', …, () => engineCheck.evaluateEngineMcp(d))`. Both
files stay well under the 300-line gate (doctor-engine-check.js 72 → ~102;
cli-handlers-doctor.js gains ~2 lines).

## Data flow

Runtime: `amicus_fanout`/`amicus_start`/headless → `startServer` →
`hasOpencodeBinary()` false → `ensureEngine()` → `repairEngine()` →
`scanEngineInstalls()` picks a healthy donor → `cpSync` `opencode-*` donor→running
nested root under the engine-lock → re-check true → `startServer` proceeds and
`spawn('opencode')` resolves (the caller already PATH-added the nested `bin`).

Doctor: `amicus doctor --fix` → `evaluateEngineMcp(d)` → per broken npx copy
`repairEngine({destPkgDir})` (donor = doctor's own healthy copy) → re-scan →
`self-healed` / `incomplete` line.

## Error handling

- `repairEngine` never throws: no donor, a `cpSync` failure, or lock contention
  each map to a `{repaired:false, …}` document. The lock is always released in a
  `finally`.
- `ensureEngine` catches a thrown `repairEngine` into `{ok:false, reason}` and
  clears the single-flight guard so a later call can retry.
- `startServer` wraps `ensureEngine()` in `.catch(() => ({ok:false}))` and falls
  back to the unchanged throw, so a self-heal bug can never be worse than today's
  behaviour.
- `doctor`'s `guardAsync` remains the final backstop (a throw becomes an error
  line), but `evaluateEngineMcp` should not rely on it.

## Known limitations

If an antivirus re-quarantines the freshly *copied* `.exe` between the post-copy
re-check and `spawn`, we hit the same unwinnable race the Electron heal has; the
thrown error still carries the AV allow-list hint (`HINTS.engineMissing`). The
optional-dependency-skip case — the actual reported cause — is fully handled.

## Testing (TDD — RED first for every unit)

- **`tests/utils/engine-repair.test.js`** (fake fs + injected
  scan/probe/roots/lock): copies every `opencode-*` donor→dest nested root and
  the re-check flips true → `{repaired:true, donor, copied:[…]}`; source-root
  resolution picks the root that holds the engine (nested AND hoisted donor
  layouts); no healthy donor → `{repaired:false, reason}` (no throw);
  already-healthy dest short-circuits without copying; lock contended →
  `{repaired:false, contended:true}` and nothing copied; a `cpSync` throw →
  `{repaired:false}` with the lock released. No `process.env.PATH` assertions
  (repairEngine is pure copy).
- **`tests/utils/engine-lock.test.js`** (mirror electron-lock, injected
  now+pid+fs): acquire writes the lockfile; a second acquire with a live holder
  throws EEXIST; an old-timestamp / dead-pid / corrupt lock is stolen; release
  removes it. Lockfile path is built with `path.join` under `os.tmpdir()`
  (colon-free).
- **`tests/utils/engine-ensure.test.js`**: fast path (healthy → `repairEngine`
  not called); broken → repair → re-check ok → `{ok:true}`; single-flight (two
  concurrent calls share one repair, `repairEngine` called once); a failed repair
  is not memoized (guard cleared, retryable); a thrown `repairEngine` →
  `{ok:false, reason}`.
- **`tests/opencode-client-*.test.js`** (extend engine-missing coverage): inject
  `_ensureEngine` → `{ok:true}` and `startServer` proceeds past the guard (SDK
  mocked); `_ensureEngine` → `{ok:false, reason}` and it throws with
  `HINTS.engineMissing`, `Searched:`, and `(self-heal: <reason>)`.
- **Doctor tests** (extend): `--fix` with a broken npx copy calls `repairEngine`
  with that `destPkgDir` and reports `self-healed` after a re-scan shows it
  healthy; without `--fix` the verdict is unchanged (still error/warn); a
  non-copy-fixable warn (no cached copy yet) is untouched by `--fix`.
- Full suite green (`npm test`), `npm run lint` clean, CLAUDE.md auto sections
  current.

## Files

**New:** `src/utils/engine-repair.js`, `src/utils/engine-lock.js`,
`src/utils/engine-ensure.js`, and their three test files. **Edit:**
`src/opencode-client.js` (self-heal at the guard), `src/cli-handlers-doctor.js`
(`repairEngine` dep + async engine-mcp check), `src/utils/doctor-engine-check.js`
(async `evaluateEngineMcp` fix wrapper). **Doc sync:** CLAUDE.md Key Modules
(auto-regenerated). All new files under the 300-line gate; all functions under
50 lines.
