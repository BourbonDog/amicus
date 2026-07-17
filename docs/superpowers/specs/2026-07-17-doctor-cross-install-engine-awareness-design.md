# Doctor cross-install engine awareness — design

**Date:** 2026-07-17
**Status:** Approved (brainstorming)
**Scope:** Report items #1 (doctor inspects the path the MCP actually uses) and #4
(print the searched path). Detection/reporting only — engine self-heal (report
item #2) is a separate, unselected scope item.

## Problem

`amicus doctor`'s `opencode-bin` check probes the opencode engine relative to the
**running process's own install** (`hasOpencodeBinary()` with no `pkgDir`, so it
resolves from the doctor process's `__dirname`).

But the MCP server is registered as `npx -y amicus@latest mcp`
(`scripts/postinstall.js:41`, `.claude-plugin/plugin.json`). So the MCP runs from
an **npx-cache** copy — a different install than the one `amicus doctor` typically
inspects (the global install on PATH).

Result — the report's "core reportable defect": run `amicus doctor` from the
global install and it reports `✓ OpenCode binary: found` (checking global) while
the npx-cache copy the MCP actually launches is missing the engine, so every
`amicus_fanout` / `amicus_start` fails instantly with `engineMissing`. Green while
broken.

Note: the specific failure in the report was actually the #69 hoisted-layout
resolver bug (engine present but hoisted, old resolver only probed the nested
root), already fixed. This work addresses the *diagnostic blindness* that let that
failure — and any genuine future engine skip/quarantine in the npx copy — stay
invisible to doctor.

## Goal

A new, dedicated doctor check that enumerates every amicus install which could
serve the MCP, verifies the opencode engine in each (reusing the #69 dual-root
probe), and reports per-copy — naming any broken path — so the green-while-broken
state is impossible. Plus: the runtime `engineMissing` error prints the roots it
searched.

Non-goals: self-heal / copying the engine (separate scope item); changing the MCP
registration away from npx (separate scope item); the report's secondary
file-read/fold issue.

## Components

### 1. `src/utils/engine-install-scan.js` (new, pure, fully seamed)

Discovers and probes amicus installs. No doctor coupling. All I/O behind seams so
it is unit-testable with a fake fs.

**`listAmicusInstalls(deps = {}) → Array<{kind, pkgDir}>`**, `kind ∈ {'running',
'global', 'npx'}`:

- **running**: `path.join(__dirname, '..', '..')` — the amicus package root of the
  current process.
- **global**: best-effort. Seam `deps.npmRootG` (default: run `npm root -g` via
  `execFileSync` with a ~4s timeout, wrapped in try/catch → `null`). If it resolves
  to a directory, the global install is `path.join(root, 'amicus')` when it exists.
  Never throws; `null`/absent means "global not determined" and is simply omitted.
- **npx**: enumerate `<npmCache>/_npx/*/node_modules/amicus` directories that exist.
  npm cache dir seam `deps.npmCacheDir` (default: `%LocalAppData%/npm-cache` on
  win32, else `~/.npm`). Each existing `amicus` dir is one npx install.
- Dedup by resolved real path of `pkgDir` (running frequently *is* global). Order:
  running, global, then npx (stable).

Seams: `deps.fs` (existsSync/readdirSync/realpathSync), `deps.platform`,
`deps.runningPkgDir`, `deps.npmCacheDir`, `deps.npmRootG`.

**`scanEngineInstalls(deps = {}) → { installs, mcpLaunch }`**:

- `installs`: for each install from `listAmicusInstalls`, add
  `{ kind, pkgDir, engineOk, roots }` where
  `engineOk = hasOpencodeBinary({ pkgDir, ...fsSeam })` and
  `roots = opencodeRoots({ pkgDir })` (searched paths, for reporting).
- `mcpLaunch ∈ {'npx','path','none','unknown'}`: classify the amicus MCP
  registration. Seam `deps.readAmicusMcpConfig` (default: first amicus-shaped entry
  found across the raw Claude Code sources and Cowork config, via
  `mcp-discovery` + `isAmicusMcpConfig`). Classification:
  - no amicus registration found → `'none'`
  - `config.command` normalizes (via `mcp-self-identity.normalizeToken`) to `npx`
    → `'npx'`
  - else, `isAmicusMcpConfig(config)` true (command resolves to an amicus binary)
    → `'path'`
  - otherwise → `'unknown'`

### 2. `src/utils/doctor-engine-check.js` (new; mirrors `doctor-mcp-checks.js`)

**`evaluateEngineInstalls(d) → {id:'engine-mcp', name, status, message, hint}`**,
`name = 'OpenCode engine (MCP launch path)'`. Reads `d.scanEngineInstalls()`.

- `mcpLaunch === 'none'` → **ok**, "no amicus MCP registered — not checked".
- `mcpLaunch === 'path'` → the fixed-path copy is the running/global install
  already covered by `opencode-bin`; npx caches are irrelevant → **ok**,
  "MCP launches from a fixed path — covered by the OpenCode binary check".
- `mcpLaunch === 'npx'` (or `'unknown'`, treated the same but worded "installs"):
  let `npxCopies = installs.filter(i => i.kind === 'npx')`.
  - `npxCopies.length === 0` → **warn**, "MCP launches via `npx`; no cached copy to
    inspect yet — run one fanout, then re-run doctor". hint: null.
  - all `engineOk` → **ok**, "engine present in N npx-cache copy(ies)".
  - some broken:
    - exactly one npx copy total and it is broken → **error** (unambiguous — the
      MCP will launch this copy and every call will fail). message names the
      `pkgDir`; message/hint include the searched `roots`; hint = `HINTS.reinstallEngineAv`.
    - ≥2 npx copies with ≥1 broken → **warn**, name each broken `pkgDir` + its
      searched roots (can't prove which hash npx will select). hint =
      `HINTS.reinstallEngineAv`.

Severity rationale: the running install's own breakage already ERRORs via the
existing `opencode-bin` check. This check is about *other* serving copies. ERROR is
reserved for the unambiguous single-npx-copy case (exactly the reported failure);
WARN elsewhere avoids false failures on stale caches while still naming the exact
broken path, so doctor is never green-while-broken.

### 3. `src/cli-handlers-doctor.js` (edit, ~6 lines)

- Add to `realDeps()`: `scanEngineInstalls: () => require('./utils/engine-install-scan').scanEngineInstalls()`.
- After the `opencode-bin` check, push:
  `checks.push(guard('engine-mcp', 'OpenCode engine (MCP launch path)', () => engineCheck.evaluateEngineInstalls(d)));`
  where `const engineCheck = require('./utils/doctor-engine-check')`.
- The existing `opencode-bin` check is unchanged (still the running install).
- Must stay under the 300-line file gate (currently 260).

### 4. `src/opencode-client.js` (edit, ~2 lines at the throw site)

At the `engineMissing` throw (~line 637), append the searched roots:

```js
const { opencodeRoots } = require('./utils/path-setup');
throw new Error(`${HINTS.engineMissing} Searched: ${opencodeRoots().join(', ')}`);
```

`HINTS.engineMissing` string is unchanged; the resolved `opencodeRoots()`
directories (nested + hoisted node_modules roots) are appended at the boundary so
the diagnostic shows the npx-vs-global divergence (report #4). Roots, not every
per-variant `.exe` candidate — concise and enough to see which tree was probed.

## Data flow

`amicus doctor` → `runDoctorChecks` → new `engine-mcp` guard →
`evaluateEngineInstalls(d)` → `d.scanEngineInstalls()` →
`listAmicusInstalls` (running + global + `_npx/*` enumeration) ⨯
`hasOpencodeBinary({pkgDir})` per copy + `mcpLaunch` from registration → per-copy
verdict → rendered line naming any broken path.

## Error handling

- Every seam is wrapped: an unreadable npx cache dir, an `npm root -g` that
  throws/times out, or an unreadable MCP config degrades to "that source
  contributed nothing", never a thrown check. `guard()` in the doctor is the final
  backstop (a throw becomes an error line), but the scan should not rely on it.
- `realpathSync` failures during dedup fall back to the raw `pkgDir` string.

## Testing (TDD — RED first for every unit)

- **`tests/utils/engine-install-scan.test.js`**: fake fs + fixture
  `<cache>/_npx/<hashA>/node_modules/amicus` (+ hoisted `opencode-windows-x64`),
  `<hashB>/…/amicus` broken (no engine). Assert: installs enumerated & deduped;
  `engineOk` per copy including the **present-but-hoisted** case (regression against
  the report's misdiagnosis); `mcpLaunch` classified for npx / fixed-path / none /
  unknown; `npmRootG` throwing → global omitted, no throw.
- **`tests/utils/doctor-engine-check.test.js`**: inject a `scanEngineInstalls`
  double. Assert each branch: none→ok, path→ok, npx-all-ok→ok, npx-none→warn,
  single-broken-npx→**error** naming the path, multi-with-broken→warn naming
  path(s); searched roots appear in broken messages.
- **`tests/opencode-client-*.test.js`** (extend existing engine-missing coverage):
  the thrown message includes `Searched:` and the resolved roots.
- Full suite green (`npm test`), `npm run lint` clean, docs markers current.

## Files

New: `src/utils/engine-install-scan.js`, `src/utils/doctor-engine-check.js`, two
test files. Edit: `src/cli-handlers-doctor.js`, `src/opencode-client.js`. Doc sync:
CLAUDE.md Key Modules (auto-regenerated). All new files under the 300-line gate.
