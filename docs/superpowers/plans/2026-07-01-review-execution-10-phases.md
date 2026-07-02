# Amicus Review Execution — 10-Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute phases strictly in order; within a phase, follow the lane diagram.

**Goal:** Ship the 2026-07-01 product-review fixes and opportunities in four releases — v1.7.7 (correctness patch), v1.8.0 (abort overhaul + MCP de-bloat + `amicus_wait` + agent-visible progress), v1.8.1 (docs & skills sprint), then distribution (plugin slash commands, community marketplace, MCP Registry, Council Review GitHub Action).

**Architecture:** Amicus stays a thin engine over the OpenCode headless server. All engine changes reuse existing plumbing (metadata.json abort markers, the interactive mirror's 2s tick, `resolveTerminalState`, `remediation-hints`). New modules are small (<150 lines) and injectable; `src/mcp-server.js` remains the serialization hub that only one lane may touch at a time.

**Tech Stack:** Node 20+ (CI matrix to 22), jest, Electron 28 (optional dep), @modelcontextprotocol/sdk (stdio MCP), OpenCode SDK, GitHub Actions (OIDC npm trusted publishing), PowerShell/Windows-first.

**Source of truth:** the review report `SecondBrain/output/amicus-product-review-2026-07-01.md` (problem IDs A1–A10, B1–B11, opportunities 1–15). This plan covers the review's "suggested sequencing" ONLY; everything else is in the **Backlog for review** section at the end — do not implement backlog items without user approval.

## Global Constraints

- **Repo:** `C:\Users\sendt\code\amicus`, base = local main @ `509ab83` (v1.7.6, clean, in sync with origin). `gh` must always pass `-R BourbonDog/amicus` (bare gh has historically defaulted to the fork parent).
- **One git operator per clone.** Every implementation task runs in a dedicated git worktree (`git worktree add C:\Users\sendt\code\amicus-<lane> -b <branch> <base>`) with node_modules junctioned from the main clone (`New-Item -ItemType Junction -Path <worktree>\node_modules -Target C:\Users\sendt\code\amicus\node_modules`). Remove junctions with `Remove-Item -Force` **without** `-Recurse` (`-Recurse` deletes the target). Never `npm install` in a worktree; if you must install in the main clone use `npm install --ignore-scripts --omit=optional` (a bare install runs postinstall, which mutates the user's global Claude config).
- **Subagent protocol per task:** fresh implementer subagent (TDD — write the failing test, watch it fail, implement, watch it pass, commit) followed by a fresh adversarial reviewer subagent that must verify failing-first by reverting the source change and re-running the task's tests. Engine tasks get two-stage review (spec compliance, then code quality). The reviewer verdict gates the merge.
- **`src/mcp-server.js` is the serialization hub** (grandfathered at ~947 lines; the plan's #1 historical merge-failure mode). Phases 3 → 4 → 5 → 6 are strictly ordered because tasks 3.3, 4.2, 5.2, 6.2, 6.3 all edit it. Never two concurrent worktrees on this file.
- **Pre-commit gates (every commit):** lint-staged (eslint --fix on staged `src/**/*.js`; `no-console` is ERROR in src/ except an allowlist that includes `src/cli-handlers.js` — new src modules must use the logger), `scripts/check-secrets.js`, `scripts/check-file-sizes.js` (300-line cap; `mcp-server.js`, `headless.js`, `mcp-tools.js`, `cli.js`, `opencode-client.js` + grandfather list may grow; ALL new files must stay <300), `scripts/generate-docs.js` (auto-regenerates and auto-stages CLAUDE.md marker sections — let it, never hand-edit markers), `scripts/validate-docs.js`. In linked worktrees the hook auto-uses `lint-staged --no-stash`.
- **Tests:** `npm test` = jest; `*.integration.test.js` is excluded from the default gate (run via `npm run test:all` before releases). All new tests in this plan are plain `*.test.js` and run by default. During TDD prefer `npx jest <file>`. Use `os.tmpdir()` fixtures like `tests/mcp-headless-lifecycle.test.js`; clean up with `fs.rmSync(tmp, {recursive:true, force:true})` after handlers release fds.
- **Windows facts (baked into designs — do not "fix" them):** `process.kill(pid,'SIGTERM')` = TerminateProcess, no handlers run; libuv job objects kill non-detached children with their parent; `0o600`/`0o700` are no-ops on NTFS (keep for POSIX parity, never assert in tests); `process.kill(pid, 0)` liveness probes work.
- **Releases are outward-facing:** phases 2, 7, 8-T9, and every distribution publish REQUIRE explicit user approval before any push/tag/publish. Pre-push runs the full suite (use the `.test-passed` cache by running `npm test` right before pushing). Push via the gh credential helper (`git -c credential.helper= -c "credential.helper=!gh auth git-credential" push ...`) to avoid the GCM popup hang.
- **Full-suite gate at every lane merge:** merged main must show 0 failed, lint clean, `check:sizes` clean, `check:tarball` clean before the next phase begins.

## Phase Map

| Phase | Delivers | Release | mcp-server.js? |
|---|---|---|---|
| 1 | v1.7.7 correctness cluster (A7 hint, A3 spawn guard, A5 H7 liveness, A2 continue/resume) | — | no |
| 2 | Ship v1.7.7 | **v1.7.7** | — |
| 3 | Abort overhaul (A1): marker watch everywhere, graceful MCP/wave abort | — | yes (3.3) |
| 4 | MCP de-bloat (A4): 52 tools → 13, postinstall migration, doctor --fix | — | yes (4.2) |
| 5 | `amicus_wait` blocking MCP tool (opp-3) | — | yes (5.2) |
| 6 | Agent-visible progress (opp-1): CLI `status`, enriched MCP status/list, interactive progress | — | yes (6.2, 6.3) |
| 7 | Ship v1.8.0 + this-machine hygiene | **v1.8.0** | — |
| 8 | Docs & skills sprint (A8, A9, A10, B8–B11, opp-8) + release | **v1.8.1** | no |
| 9 | Plugin slash commands + community marketplace + MCP Registry (opp-4, opp-5) | tag-driven | no |
| 10 | Council Review GitHub Action v1 (opp-6, fanout-only) | — | no |

---
## Phase 1 — v1.7.7 correctness cluster

**Scope:** four independent fixes from the review's patch cluster: A7 (human-mode errors drop the hint), A3 (recursive-spawn guard filters `sidecar` but ships as `amicus`), A5 (H7 crash detection is dead code), A2 (continue/resume silent-failure-as-complete). All four are file-disjoint — **run as four parallel worktree lanes** (`amicus-p1a` … `amicus-p1d`), one implementer + one adversarial reviewer subagent per task, merge lanes to local main as each passes review (octopus not required; merge in any order — verified zero file overlap, and `src/mcp-server.js` is untouched: the MCP continue/resume handlers spawn the CLI detached and read status from metadata.json, so Task D's status change flows through with zero MCP-side edits).

**Lane/file map:** A = `src/utils/error-doc.js` (+its test). B = new `src/utils/mcp-self-identity.js`, `src/sidecar/start.js:120-126`, `src/utils/mcp-discovery.js:73-75, :80-82, :136-142` (all three delete-sites). C = `src/utils/shared-server.js` (+new test). D = `bin/amicus.js`, `src/sidecar/continue.js`, `src/sidecar/resume.js`.

**Interface produced for Phase 4:** `src/utils/mcp-self-identity.js` exports `isAmicusMcpConfig(config) => boolean` — pure, sync, no I/O, never throws. Phase 4 Task 4.1 consumes it verbatim.

**Behavioral change to flag in the changelog:** `amicus continue`/`resume` exit codes become 1/2/130+ on error/timeout/abort (were unconditionally 0).


### Task 1.1 — Task A — failJson prints the hint in human mode (parity with --json)

**Files:** Modify: C:/Users/sendt/code/amicus/src/utils/error-doc.js:46-53 (failJson body). Test: C:/Users/sendt/code/amicus/tests/utils/error-doc.test.js (append to the existing `describe('failJson')` block, lines 30-52). No other files.

**Verified anchors:** src/utils/error-doc.js:46-53 — confirmed: human branch writes only `message + '\n'` to stderr, dropping hint; --json branch carries hint inside the envelope via buildErrorDoc (line 48). Doctor arrow style confirmed at src/cli-handlers-doctor.js:218: `out += `    → ${c.hint}\n``  — glyph is '→' (U+2192). Caller audit (double-hint check) done: ALL failJson call sites are src/cli-handlers-run.js (lines 29,37,42,54,67,113,119,122,126,133,143,147,150,154,158,207,212) and src/cli-handlers-council.js (lines 12,18,24,63,69,76,83,97) — every hint is passed only INTO failJson; the only other stderr writes near them are 'Notice:' lines (council ledger append at council.js:32, dropped-council-members at run.js:136), not hints. NO caller double-prints — the change is safe globally.

**Design:** Signature unchanged: `failJson(useJson, { code, message, hint = null, command = null }) → 1`. In the non-JSON branch, after writing the message line, write a second stderr line `'  → ' + hint + '\n'` when hint is truthy (two-space indent per spec, doctor's '→' glyph). JSON branch byte-for-byte unchanged (the --json stdout contract is frozen — tests/bin/preflight-json-envelope.test.js parses it). Interface consumed downstream: none changes — return value still 1, stdout contract untouched.

**Code:**

```js
// src/utils/error-doc.js — replace lines 46-53 with:
function failJson(useJson, { code, message, hint = null, command = null }) {
  if (useJson) {
    process.stdout.write(JSON.stringify(buildErrorDoc({ code, message, hint, command }), null, 2) + '\n');
  } else {
    process.stderr.write(message + '\n');
    // Parity with --json (whose envelope carries error.hint): surface the
    // actionable hint to humans too, in doctor's arrow style.
    if (hint) { process.stderr.write(`  → ${hint}\n`); }
  }
  return 1;
}
```

**Tests:**

```js
// tests/utils/error-doc.test.js — append INSIDE the existing describe('failJson') block
// (it already has outSpy/errSpy beforeEach/afterEach at lines 31-36; reuse them):

  it('prints the hint on a second stderr arrow line in human mode', () => {
    failJson(false, {
      code: ERROR_CODES.BUDGET_EXCEEDED,
      message: 'Error: budget gate refused the run',
      hint: 'raise --max-cost or trim the model list',
    });
    expect(outSpy).not.toHaveBeenCalled();
    const stderrText = errSpy.mock.calls.map(c => c[0]).join('');
    expect(stderrText).toBe(
      'Error: budget gate refused the run\n  → raise --max-cost or trim the model list\n'
    );
  });

  it('omits the arrow line when there is no hint', () => {
    failJson(false, { code: ERROR_CODES.BAD_ARGS, message: 'bad flag' });
    const stderrText = errSpy.mock.calls.map(c => c[0]).join('');
    expect(stderrText).toBe('bad flag\n');
    expect(stderrText).not.toContain('→');
  });

  it('json mode is unchanged: hint stays in the envelope, stderr untouched', () => {
    failJson(true, { code: ERROR_CODES.BAD_ARGS, message: 'bad', hint: 'try --help' });
    expect(errSpy).not.toHaveBeenCalled();
    expect(JSON.parse(outSpy.mock.calls[0][0]).error.hint).toBe('try --help');
  });

// Run: npx jest tests/utils/error-doc.test.js
// Failing-first: test 1 fails on current code (stderr = 'Error: budget gate refused the run\n' only).
```

**Risks:** LOW. (1) Multi-line hints (e.g. formatBudgetError at cli-handlers-run.js:67 can return a multi-line breakdown) get the arrow on the first line only; subsequent lines print unindented — acceptable, matches doctor's single-line hint assumption; do NOT try to re-indent (scope creep). (2) '→' on legacy Windows codepages can mojibake, but doctor already ships the same glyph so this is pre-accepted repo-wide. (3) No file-size or grandfather issues (file grows to ~59 lines). (4) No coupling with B/C/D. Existing tests asserting exact stderr: only tests/utils/error-doc.test.js:47-51 (checks contains, not equals) — safe.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 1.2 — Task B — recursive-spawn guard excludes amicus by self-identity, not just the 'sidecar' name

**Files:** Create: C:/Users/sendt/code/amicus/src/utils/mcp-self-identity.js (~75 lines). Modify: C:/Users/sendt/code/amicus/src/sidecar/start.js:25 (add require) and :120-126 (replace sidecar-only delete); C:/Users/sendt/code/amicus/src/utils/mcp-discovery.js:14 (add require), :73-75, :80-82, :136-142 (three delete-sites). Tests: create C:/Users/sendt/code/amicus/tests/utils/mcp-self-identity.test.js and C:/Users/sendt/code/amicus/tests/sidecar/recursive-spawn-guard.test.js.

**Verified anchors:** start.js:120-126 confirmed — deletes ONLY mcpServers.sidecar. mcp-discovery.js:139-141 confirmed (`delete merged.sidecar`) PLUS two additional identical guards the review missed at mcp-discovery.js:74 and :81 (early returns when settings.json / enabledPlugins absent) — all three must be fixed or the claude.json-only discovery path keeps leaking 'amicus'. Shipped name confirmed: scripts/postinstall.js:40 MCP_CONFIG={command:'npx',args:['-y','amicus@latest','mcp']}, registered as 'amicus' (lines 119,143,169) with a DEPRECATED 'sidecar' shim also registered (lines 128,154,180); .claude-plugin/plugin.json:12-18 registers mcpServers.amicus with the same npx invocation. bin aliases confirmed in package.json bin: amicus, am, sidecar, claude-sidecar → ./bin/amicus.js. Exhaustive grep for other delete-sites: only the 5 listed. Test mock pattern verified from tests/sidecar/start.test.js:97-135 (jest.mock mcp-discovery + opencode-client, then require buildMcpConfig).

**Design:** New shared helper module src/utils/mcp-self-identity.js exporting: `SELF_MCP_NAMES` (frozen ['amicus','sidecar']); `isAmicusMcpConfig(config) → boolean` — true when config.command+args resolve to an amicus MCP invocation: tokenizes [command, ...args], skips '-'-prefixed flags, normalizes each token (lowercase, backslash→slash, basename, strip .exe/.cmd/.js, strip @version) and matches against the shipped bin names {amicus, am, sidecar, claude-sidecar}; a match counts only if a LATER token equals 'mcp' (so `npx -y amicus@latest mcp`, `amicus mcp`, `node C:\...\bin\amicus.js mcp` all match, while `npx -y some-other-mcp` and url-only/command-less entries never do); `stripSelfMcpEntries(mcpServers, log) → mcpServers` — deletes every key that is a reserved name OR whose config is self-identifying; mutates and returns the map (null/non-object passthrough). Wiring: start.js buildMcpConfig replaces the sidecar-only block with `if (mcpServers) { stripSelfMcpEntries(mcpServers, logger); }` (runs AFTER the 3 merge layers, BEFORE excludeMcp — position unchanged, so CLI --mcp additions are covered too); mcp-discovery.js replaces all three `delete merged.sidecar` sites with `stripSelfMcpEntries(merged, logger)` (defense-in-depth for any other discoverClaudeCodeMcps caller). discoverCoworkMcps stays raw — its output flows through buildMcpConfig's strip. Interface consumed by other tasks: none; helper is self-contained.

**Code:**

```js
// ── NEW FILE: src/utils/mcp-self-identity.js ──
'use strict';

/**
 * @module mcp-self-identity
 * Recursive-spawn guard. A child sidecar that inherits an MCP entry launching
 * amicus itself would spawn amicus inside amicus, forever. The shipped server
 * registers as 'amicus' (scripts/postinstall.js, .claude-plugin/plugin.json)
 * plus a deprecated 'sidecar' shim — and users can alias it under ANY name —
 * so we exclude both reserved names AND any entry whose command+args resolve
 * to an amicus MCP invocation.
 */

/** Server names amicus registers itself under. */
const SELF_MCP_NAMES = Object.freeze(['amicus', 'sidecar']);

/** Shipped bin aliases (package.json "bin") → ./bin/amicus.js */
const SELF_BIN_NAMES = new Set(['amicus', 'am', 'sidecar', 'claude-sidecar']);

/**
 * Normalize one command/arg token for identity matching: lower-case, forward
 * slashes, basename, strip a trailing .exe/.cmd/.js, strip an @version spec.
 * 'C:\\x\\bin\\amicus.js' → 'amicus'; 'amicus@latest' → 'amicus'; 'npx' → 'npx'.
 * @param {unknown} token
 * @returns {string}
 */
function normalizeToken(token) {
  const t = String(token).toLowerCase().replace(/\\/g, '/');
  const base = t.includes('/') ? t.slice(t.lastIndexOf('/') + 1) : t;
  return base.replace(/\.(exe|cmd|js)$/, '').replace(/@[^@]*$/, '');
}

/**
 * True when this MCP server config would launch amicus's own MCP server:
 * some non-flag token resolves to an amicus binary/package and a LATER token
 * is 'mcp'. URL-only (command-less) configs are never self.
 * @param {{command?:string, args?:unknown[]}|null|undefined} config
 * @returns {boolean}
 */
function isAmicusMcpConfig(config) {
  if (!config || typeof config !== 'object' || !config.command) { return false; }
  const tokens = [config.command, ...(Array.isArray(config.args) ? config.args : [])].map(String);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith('-')) { continue; } // flags (-y, --yes) are never the binary
    if (SELF_BIN_NAMES.has(normalizeToken(tokens[i]))) {
      return tokens.slice(i + 1).some((t) => String(t).toLowerCase() === 'mcp');
    }
  }
  return false;
}

/**
 * Delete every self entry (reserved name OR command identity) from an
 * mcpServers map. Mutates and returns the same object.
 * @param {object|null|undefined} mcpServers
 * @param {{debug?:Function}} [log]
 * @returns {object|null|undefined}
 */
function stripSelfMcpEntries(mcpServers, log) {
  if (!mcpServers || typeof mcpServers !== 'object') { return mcpServers; }
  for (const name of Object.keys(mcpServers)) {
    if (SELF_MCP_NAMES.includes(name) || isAmicusMcpConfig(mcpServers[name])) {
      delete mcpServers[name];
      if (log && log.debug) { log.debug('Auto-excluded amicus MCP entry (recursive spawn prevention)', { name }); }
    }
  }
  return mcpServers;
}

module.exports = { SELF_MCP_NAMES, isAmicusMcpConfig, stripSelfMcpEntries, normalizeToken };

// ── src/sidecar/start.js: add after line 25 (`const { discoverParentMcps } = ...`) ──
const { stripSelfMcpEntries } = require('../utils/mcp-self-identity');

// ── src/sidecar/start.js: REPLACE lines 120-126 with ──
  // Always exclude amicus itself — under ANY registered name or aliased
  // invocation — to prevent recursive spawning. When launched from Cowork or
  // Claude Code the discovered list includes 'amicus'/'sidecar' (and possibly
  // a user alias), which would cause an infinite spawn loop.
  if (mcpServers) { stripSelfMcpEntries(mcpServers, logger); }

// ── src/utils/mcp-discovery.js: add after line 14 (`const { logger } = ...`) ──
const { stripSelfMcpEntries } = require('./mcp-self-identity');

// ── mcp-discovery.js: REPLACE lines 73-75 with ──
      const merged = stripSelfMcpEntries({ ...claudeJsonServers }, logger);
      return Object.keys(merged).length > 0 ? merged : null;
// ── REPLACE lines 80-82 with (identical) ──
      const merged = stripSelfMcpEntries({ ...claudeJsonServers }, logger);
      return Object.keys(merged).length > 0 ? merged : null;
// ── REPLACE lines 136-142 with ──
  // Merge: plugin servers first, then claude.json overwrites (higher priority).
  // Recursive-spawn guard: drop every entry that resolves to amicus itself.
  const merged = stripSelfMcpEntries({ ...pluginServers, ...claudeJsonServers }, logger);

  return Object.keys(merged).length > 0 ? merged : null;
```

**Tests:**

```js
// ── NEW: tests/sidecar/recursive-spawn-guard.test.js (the mandated regression) ──
'use strict';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

describe('buildMcpConfig recursive-spawn guard (self-identity)', () => {
  beforeEach(() => { jest.resetModules(); });

  it('a discovered config with {amicus, sidecar, aliased-amicus-via-npx} yields none of them', () => {
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({
        amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'], env: { AMICUS_SKIP_POSTINSTALL: '1' } },
        sidecar: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] },
        'my-council': { command: 'npx', args: ['-y', 'amicus', 'mcp'] },
        'local-dev': { command: 'node', args: ['C:\\Users\\x\\code\\amicus\\bin\\amicus.js', 'mcp'] },
        'keep-me': { command: 'npx', args: ['-y', 'some-other-mcp'] },
      }))
    }));
    jest.mock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => null),
      parseMcpSpec: jest.fn(() => null)
    }));
    const { buildMcpConfig } = require('../../src/sidecar/start');
    const result = buildMcpConfig({});
    expect(result).toEqual({ 'keep-me': { command: 'npx', args: ['-y', 'some-other-mcp'] } });
  });

  it('returns null when every discovered server is amicus itself', () => {
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({
        amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] },
        aliased: { command: 'amicus', args: ['mcp'] },
      }))
    }));
    jest.mock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => null), parseMcpSpec: jest.fn(() => null)
    }));
    const { buildMcpConfig } = require('../../src/sidecar/start');
    expect(buildMcpConfig({})).toBeNull();
  });
});

// ── NEW: tests/utils/mcp-self-identity.test.js (helper unit tests, key cases) ──
'use strict';
const { isAmicusMcpConfig, stripSelfMcpEntries } = require('../../src/utils/mcp-self-identity');

describe('isAmicusMcpConfig', () => {
  it.each([
    ['shipped npx form', { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }],
    ['bare bin', { command: 'amicus', args: ['mcp'] }],
    ['windows shim path', { command: 'C:\\nvm\\amicus.CMD', args: ['mcp'] }],
    ['node + bin path', { command: 'node', args: ['/home/x/amicus/bin/amicus.js', 'mcp'] }],
    ['sidecar alias', { command: 'sidecar', args: ['mcp'] }],
  ])('%s → true', (_n, cfg) => expect(isAmicusMcpConfig(cfg)).toBe(true));

  it.each([
    ['other npx package', { command: 'npx', args: ['-y', 'some-other-mcp'] }],
    ['amicus token but no mcp subcommand', { command: 'amicus', args: ['doctor'] }],
    ['substring is not identity', { command: 'npx', args: ['sidecar-tools', 'mcp'] }],
    ['url-only entry', { url: 'http://localhost:1234/sse' }],
    ['null', null],
  ])('%s → false', (_n, cfg) => expect(isAmicusMcpConfig(cfg)).toBe(false));
});

describe('stripSelfMcpEntries', () => {
  it('removes reserved names even with foreign commands, keeps others', () => {
    const map = { sidecar: { command: 'uvx', args: ['x'] }, ok: { command: 'uvx', args: ['x'] } };
    expect(Object.keys(stripSelfMcpEntries(map))).toEqual(['ok']);
  });
  it('passes null through', () => expect(stripSelfMcpEntries(null)).toBeNull());
});

// Optional discovery-level test (append to tests/mcp-discovery.test.js pattern): write a
// tmp ~/.claude.json with an 'amicus' entry, call discoverClaudeCodeMcps(claudeDir, jsonPath),
// assert result has no 'amicus' key (fails first: current code only deletes 'sidecar').
// Run: npx jest tests/sidecar/recursive-spawn-guard.test.js tests/utils/mcp-self-identity.test.js
// Failing-first: regression test 1 currently returns amicus + my-council + local-dev in the result.
```

**Risks:** MEDIUM. (1) Behavior change is user-visible: anyone who DELIBERATELY gave a child sidecar an amicus MCP entry (nesting on purpose) loses it — there is no opt-out; document in CHANGELOG under Fixed. (2) False-positive surface: an unrelated tool whose binary normalizes to 'am' AND takes a literal 'mcp' arg later would be stripped — judged acceptable ('am' is a shipped amicus bin name); the flags-skip + must-be-followed-by-'mcp' rule keeps `npx -y foo-mcp` style entries safe. (3) start.js grows to ~271 lines and mcp-discovery.js to ~197 — both under the 300 gate, neither grandfathered; keep the replacement comments as written or trim. (4) Existing tests that could break: tests/sidecar/start.test.js mocks discoverParentMcps with harmless names (keep-me/remove-me/shared-server) — unaffected; tests/mcp-discovery.test.js has cases asserting sidecar exclusion — they still pass (superset behavior). (5) Coupling: start.js is also read (not modified) by Task D — merge order irrelevant. eslint: helper uses only core syntax; run `npx eslint src/utils/mcp-self-identity.js` before staging.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 1.3 — Task C — H7: shared-server crash detection via goPid liveness poll (restart machinery was dead code)

**Files:** Modify: C:/Users/sendt/code/amicus/src/utils/shared-server.js — constructor (:26-48), _wireCrashListener (:182-201), _onServerCrash (:208-216), shutdown (:157-171), constants (:11-13). Test: create C:/Users/sendt/code/amicus/tests/shared-server-crash-poll.test.js (existing tests/shared-server.test.js untouched and must stay green).

**Verified anchors:** shared-server.js:182-201 confirmed — _wireCrashListener attaches only to `server.on` or `server.process.on`; buildServerHandle at src/opencode-client.js:552-574 confirmed returns exactly `{ url, goPid, close }` (no emitter, no .process), so on real handles the listener never attaches and _onServerCrash/_handleRestart (:208-244) are unreachable. isProcessAlive confirmed exported from src/sidecar/session-utils.js:258-266 (module.exports at :292) — `process.kill(pid, 0)` probe, works on Windows (signal 0 is an existence check, not TerminateProcess). buildServerHandle IS exported (opencode-client.js:765) and dependency-injected (deps.findListenerPid/kill/logger) so tests construct real handles without the SDK. Existing mock pattern verified in tests/shared-server.test.js: fake timers file-wide (:3-4), `mgr._doStartServer = jest.fn().mockResolvedValue({server, client})`, emitter mocks are `{url, close, process: new EventEmitter()}`. env pattern verified: getCompatEnv (src/utils/env-compat.js:19-36) resolves AMICUS_<suffix> then legacy SIDECAR_<suffix>; already imported by shared-server.js:9.

**Design:** Keep the emitter path (existing tests + hypothetical event-surfacing handles) and ADD a goPid liveness poll as the real detection path. Constructor gains: `this._crashPoll = null` and a test seam `this._isProcessAlive = options.isProcessAlive || ((pid) => require('../sidecar/session-utils').isProcessAlive(pid))` (lazy require avoids pulling the sidecar dep chain at construction). New private methods: `_startCrashPoll(server)` — clears any prior poll; reads interval from `Number(getCompatEnv('CRASH_POLL_MS')) || CRASH_POLL_INTERVAL` (new const 5000, env-tunable via AMICUS_CRASH_POLL_MS / legacy SIDECAR_CRASH_POLL_MS); setInterval tick: stale-handle guard (`this.server !== server` → stop), else `!this._isProcessAlive(server.goPid)` → stop poll + `this._onServerCrash(null)`; interval is `.unref()`d so the MCP process can exit naturally. `_stopCrashPoll()` — clearInterval + null. _wireCrashListener: wire emitter if present (unchanged semantics incl. _amicusCrashWired guard), then `if (server && server.goPid) this._startCrashPoll(server)` else if no emitter either, logger.debug that crash detection is unavailable (goPid can be null on the findListenerPid startup race — degraded, documented). _onServerCrash: first line `this._stopCrashPoll()` (prevents double-fire when both paths exist). shutdown(): add `this._stopCrashPoll()`. Restart flow unchanged: crash → 2s backoff → _handleRestart → ensureServer → _wireCrashListener re-arms a fresh poll on the new handle. Interfaces consumed by others: none — SharedServerManager options gain an optional `isProcessAlive` (additive).

**Code:**

```js
// src/utils/shared-server.js — near line 13, add:
const CRASH_POLL_INTERVAL = 5000; // ms; env-tunable via AMICUS_CRASH_POLL_MS

// constructor — after line 47 (this._restartTimestamps = []), add:
    /** @type {NodeJS.Timeout|null} goPid liveness poll (H7) */
    this._crashPoll = null;
    /** Pid-liveness probe (test seam). Lazy default keeps construction light. */
    this._isProcessAlive = options.isProcessAlive
      || ((pid) => require('../sidecar/session-utils').isProcessAlive(pid));

// REPLACE _wireCrashListener (lines 173-201 incl. docblock) with:
  /**
   * Wire crash detection onto a freshly started server handle. The REAL handle
   * from buildServerHandle is { url, goPid, close } — it surfaces NO lifecycle
   * events, so the emitter path alone was dead code (H7). Detection now polls
   * the Go engine pid; emitter wiring is kept for handles that do expose events.
   * @param {object} server - Server handle returned by _doStartServer
   */
  _wireCrashListener(server) {
    const emitter = (server && typeof server.on === 'function')
      ? server
      : (server && server.process && typeof server.process.on === 'function')
        ? server.process
        : null;
    if (emitter && !emitter._amicusCrashWired) {
      emitter._amicusCrashWired = true;
      const onExit = (code) => {
        if (this.server !== server) { return; } // stale handle already replaced/closed
        this._onServerCrash(code);
      };
      emitter.on('exit', onExit);
      emitter.on('close', onExit);
    }
    if (server && server.goPid) {
      this._startCrashPoll(server);
    } else if (!emitter) {
      this.logger.debug?.('Server handle has no goPid and no emitter — crash detection unavailable');
    }
  }

  /** Poll the Go engine pid; pid death IS the crash signal (H7). */
  _startCrashPoll(server) {
    this._stopCrashPoll();
    const interval = Number(getCompatEnv('CRASH_POLL_MS')) || CRASH_POLL_INTERVAL;
    this._crashPoll = setInterval(() => {
      if (this.server !== server) { this._stopCrashPoll(); return; }
      if (!this._isProcessAlive(server.goPid)) {
        this._stopCrashPoll();
        this._onServerCrash(null);
      }
    }, interval);
    if (this._crashPoll.unref) { this._crashPoll.unref(); }
  }

  _stopCrashPoll() {
    if (this._crashPoll) { clearInterval(this._crashPoll); this._crashPoll = null; }
  }

// _onServerCrash (line 208) — add as FIRST statement of the body:
    this._stopCrashPoll();

// shutdown() (line 157) — add after the watchdog cleanup (line 165):
    this._stopCrashPoll();
```

**Tests:**

```js
// ── NEW: tests/shared-server-crash-poll.test.js ──
'use strict';

/**
 * H7: crash detection must work against the REAL handle shape from
 * buildServerHandle — { url, goPid, close } — which exposes NO emitter.
 * No mocked emitter anywhere in this file.
 */

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.useRealTimers(); delete process.env.AMICUS_CRASH_POLL_MS; });

const { buildServerHandle } = require('../src/opencode-client');
const { SharedServerManager } = require('../src/utils/shared-server');

const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeRealHandle(pid) {
  return buildServerHandle(
    { url: 'http://127.0.0.1:43111', close: jest.fn(), pid },
    { kill: jest.fn(), logger: quiet, findListenerPid: jest.fn(() => null) }
  );
}

describe('SharedServerManager goPid crash poll (H7)', () => {
  test('real buildServerHandle shape: goPid death triggers crash + restart', async () => {
    let alive = true;
    const mgr = new SharedServerManager({ logger: quiet, isProcessAlive: () => alive });
    const handle = makeRealHandle(424242);
    // Sanity: the real handle has NO emitter surface — old wiring was dead code.
    expect(typeof handle.on).toBe('undefined');
    expect(handle.process).toBeUndefined();
    mgr._doStartServer = jest.fn().mockResolvedValue({ server: handle, client: {} });
    const crashSpy = jest.spyOn(mgr, '_onServerCrash');
    await mgr.ensureServer();
    // Alive engine: poll ticks must NOT fire a crash.
    await jest.advanceTimersByTimeAsync(5000);
    expect(crashSpy).not.toHaveBeenCalled();
    // Engine dies: next tick detects it, tears down handles.
    alive = false;
    await jest.advanceTimersByTimeAsync(5000);
    expect(crashSpy).toHaveBeenCalledTimes(1);
    expect(mgr.server).toBeNull();
    // Backoff (2000ms) elapses → restart machinery re-runs _doStartServer.
    alive = true;
    await jest.advanceTimersByTimeAsync(2000);
    expect(mgr._doStartServer).toHaveBeenCalledTimes(2);
  });

  test('poll interval honors AMICUS_CRASH_POLL_MS', async () => {
    process.env.AMICUS_CRASH_POLL_MS = '100';
    let alive = true;
    const mgr = new SharedServerManager({ logger: quiet, isProcessAlive: () => alive });
    mgr._doStartServer = jest.fn().mockResolvedValue({ server: makeRealHandle(555), client: {} });
    const crashSpy = jest.spyOn(mgr, '_onServerCrash');
    await mgr.ensureServer();
    alive = false;
    await jest.advanceTimersByTimeAsync(100);
    expect(crashSpy).toHaveBeenCalledTimes(1);
  });

  test('shutdown stops the poll — no crash fires after close', async () => {
    let alive = true;
    const mgr = new SharedServerManager({ logger: quiet, isProcessAlive: () => alive });
    mgr._doStartServer = jest.fn().mockResolvedValue({ server: makeRealHandle(556), client: {} });
    const crashSpy = jest.spyOn(mgr, '_onServerCrash');
    await mgr.ensureServer();
    mgr.shutdown();
    alive = false;
    await jest.advanceTimersByTimeAsync(20000);
    expect(crashSpy).not.toHaveBeenCalled();
  });
});

// Run: npx jest tests/shared-server-crash-poll.test.js
// Failing-first: on current code no poll exists → after alive=false + 5000ms,
// crashSpy was never called (test 1 fails at toHaveBeenCalledTimes(1)).
// ALSO run: npx jest tests/shared-server.test.js  (must stay green — emitter
// mocks {url, close, process} have no goPid, so no poll starts for them).
```

**Risks:** MEDIUM. (1) FILE SIZE: shared-server.js lands ~292/300 lines — the tightest file in the phase; if the implementer adds comments beyond the sketch it trips scripts/check-file-sizes.js (NOT grandfathered). Trim docblocks first, do not add to the grandfather list. (2) Windows: isProcessAlive uses process.kill(pid, 0) — an existence probe, NOT TerminateProcess; safe. But PID REUSE is possible between polls (Windows reuses pids aggressively) — a reused pid masks a crash until idle-watchdog cleanup; acceptable for a 5s poll, note in code review. (3) Double-fire protection: if a future handle has BOTH emitter and goPid, _onServerCrash's leading _stopCrashPoll + the `this.server !== server` guards prevent double restarts — keep both. (4) The default _isProcessAlive lazy-requires src/sidecar/session-utils, which requires opencode-client — fine at runtime (MCP server already loads it) but tests should always inject the seam to stay hermetic. (5) unref'd interval: required so one-shot CLI paths that touch SharedServerManager never hang (F3 #15 exit-watchdog territory). (6) In-flight coupling: none in Phase 1; historical hub src/mcp-server.js consumes SharedServerManager but its API is unchanged (options addition is backward-compatible). (7) getCompatEnv emits a one-time deprecation warn if someone sets legacy SIDECAR_CRASH_POLL_MS — expected.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 1.4 — Task D — continue/resume route through resolveTerminalState and propagate exit codes

**Files:** Modify: C:/Users/sendt/code/amicus/src/sidecar/continue.js:111-211 (continueSidecar: hoist result, terminal-state finalize, return exitCode); C:/Users/sendt/code/amicus/src/sidecar/resume.js:113-213 (resumeSidecar: same, block sits INSIDE the try before finally); C:/Users/sendt/code/amicus/bin/amicus.js:97-102 (capture exit codes), :174-197 (handleResume returns), :199-256 (handleContinue returns). Tests: create C:/Users/sendt/code/amicus/tests/continue-terminal-status.test.js and C:/Users/sendt/code/amicus/tests/resume-terminal-status.test.js.

**Verified anchors:** bin/amicus.js:97-102 confirmed — `case 'resume': await handleResume(args); break;` / `case 'continue': await handleContinue(args); break;` discard returns, vs the start case at :88-89 (`exitCode = await handleStart(args)`) and the capture at :149 (`if (exitCode) { process.exitCode = exitCode; }`). continue.js:181-210 confirmed — logs result.timedOut/result.error then hardcodes `finalizeSession(sessionDir, summary, project, meta, { status: 'complete' })` at :210, carve-out comment at :208-209. resume.js:202-208 confirmed — same hardcode at :208, carve-out comment at :205-207; NOTE the finalize sits INSIDE the try (finally at :209-212 releases the lock), unlike continue where it is after the finally. Template verified: start.js:227-239 (resolveTerminalState → error branch writes meta.status/reason/completedAt with mode 0o600, else finalizeSession with explicit terminal.status) and :259 (`return terminal.exitCode`). session-finalize.js read in full: resolveTerminalState(result, signal) at :13-24 (error→1, aborted→130/143/2, timed-out→2, complete→0, default error→1); finalizeHeadlessResult at :39-64 considered and REJECTED for this task — it persists `result.summary||''`, which would drop continue/resume's '## Sidecar Results: No Output' fallback text from summary.md; mirroring start.js preserves current summary-content behavior exactly. The #36 guard verified at session-utils.js:99-100 (explicit opts.status always wins → carve-out preserved by passing terminal.status). runInteractive result shape verified (interactive.js:87-98): clean close → {summary: stdout||'Session ended without summary.', completed: code===0}; error paths → {completed:false, error}. MCP handlers verified (mcp-server.js:671-723): detached spawn, exit code unread — CLI-only change. Test templates verified: tests/start-terminal-status.test.js (mock headless + os.homedir redirect) and warnIfNotInCatalog (model-validator.js:195-205, lazy-required — jest.mock intercepts).

**Design:** continueSidecar(options) and resumeSidecar(options) change return type from `Promise<void>` to `Promise<number>` (the process exit code). Both hoist `let result;` next to `let summary;` and drop the per-branch `const result`. After the run, both mirror start.js:227-239 exactly: `const { resolveTerminalState } = require('./session-finalize'); const terminal = resolveTerminalState(result);` — error → persist status:'error' + reason + completedAt to metadata.json (mode 0o600, no summary.md write, matching start.js), else `finalizeSession(dir, summary, project, meta, { status: terminal.status })`. The interactive empty-summary carve-out is preserved structurally: an explicit status is ALWAYS passed, so the #36 guard (session-utils.js:100) never re-classifies; a clean interactive run (completed:true) finalizes 'complete' even with summary ''. In resume.js the block replaces lines 202-208 INSIDE the try and ends `return terminal.exitCode;` (finally still releases the lock before returning). bin/amicus.js: `exitCode = await handleResume(args)` / `exitCode = await handleContinue(args)`; handleResume/handleContinue end with `return await resumeSidecar({...})` / `return await continueSidecar({...})`. Interfaces produced: exit codes 0/1/2 (+130/143 reserved for signal aborts, not wired here) now flow to process.exitCode via bin:149, identical to start/fanout.

**Code:**

```js
// ── src/sidecar/continue.js ──
// 1) Line 173: after `let summary;` add:
  let result;
// 2) Lines 177 and 188: change `const result = await runHeadless(`/`const result = await runInteractive(` to `result = await ...` (bodies unchanged).
// 3) REPLACE lines 201-210 (outputSummary → finalizeSession) with:
  // Output summary
  outputSummary(summary);

  // Load current metadata for finalization
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Map the run result to the canonical terminal status + exit code — mirrors
  // start.js; resolveTerminalState is the single source of truth. Passing the
  // status explicitly also preserves the interactive empty-summary carve-out:
  // a clean interactive run finalizes 'complete' without tripping the #36
  // empty-summary guard.
  const { resolveTerminalState } = require('./session-finalize');
  const terminal = resolveTerminalState(result);
  if (terminal.status === 'error') {
    meta.status = 'error';
    meta.reason = (result && result.error) ? String(result.error) : 'Incomplete';
    meta.completedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    logger.error('Continuation completed with error', { taskId: newTaskId, error: meta.reason });
  } else {
    finalizeSession(sessionDir, summary, project, meta, { status: terminal.status });
  }
  return terminal.exitCode;
}
// 4) Update continueSidecar's docblock: `@returns {Promise<number>} process exit code`.

// ── src/sidecar/resume.js ──
// 1) Line 165: after `let summary;` add `let result;`
// 2) Lines 176 and 187: `const result = await ...` → `result = await ...`.
// 3) REPLACE lines 202-208 (outputSummary + finalizeSession, INSIDE the try) with:
    // Output summary
    outputSummary(summary);

    // Map the run result to the canonical terminal status + exit code —
    // mirrors start.js. Explicit status preserves the interactive
    // empty-summary carve-out (the #36 guard never re-classifies it).
    const { resolveTerminalState } = require('./session-finalize');
    const terminal = resolveTerminalState(result);
    const metaPath = SessionPaths.metadataFile(sessionDir);
    if (terminal.status === 'error') {
      updatedMetadata.status = 'error';
      updatedMetadata.reason = (result && result.error) ? String(result.error) : 'Incomplete';
      updatedMetadata.completedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(updatedMetadata, null, 2), { mode: 0o600 });
      logger.error('Resume completed with error', { taskId, error: updatedMetadata.reason });
    } else {
      finalizeSession(sessionDir, summary, project, updatedMetadata, { status: terminal.status });
    }
    return terminal.exitCode; // finally below still releases the lock first
// (finally block at :209-212 unchanged; add `@returns {Promise<number>}` to docblock)

// ── bin/amicus.js — REPLACE lines 97-102 with ──
      case 'resume':
        exitCode = await handleResume(args);
        break;
      case 'continue':
        exitCode = await handleContinue(args);
        break;
// handleResume (line 191): `await resumeSidecar({...})` → `return await resumeSidecar({...});`
// handleContinue (line 245): `await continueSidecar({...})` → `return await continueSidecar({...});`
// (process.exitCode capture already exists at bin/amicus.js:149 — no change.)
```

**Tests:**

```js
// ── NEW: tests/continue-terminal-status.test.js (modeled on tests/start-terminal-status.test.js) ──
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));
jest.mock('../src/headless', () => ({ runHeadless: jest.fn() }));
jest.mock('../src/sidecar/interactive', () => ({
  runInteractive: jest.fn(), checkElectronAvailable: jest.fn(() => true)
}));
jest.mock('../src/utils/mcp-discovery', () => ({ discoverParentMcps: jest.fn(() => null) }));
jest.mock('../src/opencode-client', () => ({
  loadMcpConfig: jest.fn(() => null), parseMcpSpec: jest.fn(() => null)
}));

const { runHeadless } = require('../src/headless');
const { runInteractive } = require('../src/sidecar/interactive');
const { continueSidecar } = require('../src/index');

describe('continue.js terminal state + exit code', () => {
  let projectDir;

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cont-'));
    const oldDir = path.join(projectDir, '.claude', 'amicus_sessions', 'old00001');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'metadata.json'), JSON.stringify({
      taskId: 'old00001', model: 'google/gemini-2.5-flash', agent: 'build',
      briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete'
    }));
  });
  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  async function runWith(headlessResult, opts = {}) {
    runHeadless.mockResolvedValue(headlessResult);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    let code;
    try {
      code = await continueSidecar({
        taskId: 'old00001', newTaskId: 'new00001', briefing: 'follow-up',
        model: 'google/gemini-2.5-flash', project: projectDir,
        headless: true, timeout: 5, ...opts,
      });
    } finally { consoleSpy.mockRestore(); }
    const meta = JSON.parse(fs.readFileSync(path.join(
      projectDir, '.claude', 'amicus_sessions', 'new00001', 'metadata.json'), 'utf-8'));
    return { code, meta };
  }

  it('error result → status "error" + reason, exit 1 (was: complete/undefined)', async () => {
    const { code, meta } = await runWith({ completed: false, error: 'boom', summary: '', taskId: 'new00001' });
    expect(code).toBe(1);
    expect(meta.status).toBe('error');
    expect(meta.reason).toBe('boom');
  });

  it('timed-out result → status "timed-out", exit 2', async () => {
    const { code, meta } = await runWith({ completed: false, timedOut: true, summary: 'partial', taskId: 'new00001' });
    expect(code).toBe(2);
    expect(meta.status).toBe('timed-out');
  });

  it('completed result → status "complete", exit 0', async () => {
    const { code, meta } = await runWith({ completed: true, summary: 'done', taskId: 'new00001' });
    expect(code).toBe(0);
    expect(meta.status).toBe('complete');
  });

  it('interactive empty-summary run stays "complete" (carve-out preserved)', async () => {
    runInteractive.mockResolvedValue({ summary: '', completed: true, timedOut: false, taskId: 'new00001' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    let code;
    try {
      code = await continueSidecar({
        taskId: 'old00001', newTaskId: 'new00001', briefing: 'follow-up',
        model: 'google/gemini-2.5-flash', project: projectDir, headless: false,
      });
    } finally { consoleSpy.mockRestore(); }
    const meta = JSON.parse(fs.readFileSync(path.join(
      projectDir, '.claude', 'amicus_sessions', 'new00001', 'metadata.json'), 'utf-8'));
    expect(code).toBe(0);
    expect(meta.status).toBe('complete'); // NOT re-classified by the #36 guard
  });
});

// ── NEW: tests/resume-terminal-status.test.js — same skeleton, differences: ──
// extra mock: jest.mock('../src/utils/model-validator', () => ({ warnIfNotInCatalog: jest.fn() }));
// seed dir 'res00001' (resume reuses the SAME taskId/dir); call resumeSidecar({ taskId:'res00001',
// project: projectDir, headless: true, timeout: 5 }); read metadata from the SAME dir; assert the
// identical error→1/'error'+reason, timed-out→2, complete→0 triples, plus the interactive
// carve-out case via the runInteractive mock ({summary:'', completed:true}) → 0/'complete'.
// Also add a bin-wiring source assertion (pattern of tests/resume-lock.test.js):
//   expect(fs.readFileSync(path.join(__dirname, '../bin/amicus.js'),'utf-8'))
//     .toMatch(/exitCode = await handleResume\(args\)/)
//     — and the continue equivalent.
// Run: npx jest tests/continue-terminal-status.test.js tests/resume-terminal-status.test.js
// Failing-first on current code: error case returns undefined (not 1) and meta.status === 'complete'.
```

**Risks:** MEDIUM-HIGH (behavior change). (1) BREAKING for scripts: `amicus continue`/`amicus resume` now exit 1/2 on failed/timed-out runs (previously always 0). CHANGELOG must call this out; the sidecar skill and MCP handlers are safe (verified: mcp-server.js:674-683 and :704-722 spawn detached and never read the exit code — they poll metadata via amicus_status, which now reports 'error' truthfully instead of a false 'complete'; that is the point of the fix, but any downstream tooling matching status:'complete' after a failed continuation will now see 'error'). (2) Error branch intentionally does NOT write summary.md (mirrors start.js CLI path) — a headless-errored continuation loses the '## Sidecar Results: No Output' fallback file; amicus_read surfaces metadata.reason via its no-file branch. If review prefers the MCP-style 0-byte summary, swap the error branch for finalizeHeadlessResult — but then summary-content semantics change (documented in verifiedAnchors). (3) Interactive Electron non-zero exit now finalizes 'error' exit 1 (was 'complete' exit 0) — consistent with start.js, but a user hard-killing the GUI window may now see exit 1; acceptable and matches start. (4) 0o600 in the error-branch writeFileSync is a no-op on NTFS — fine, it's parity with start.js:234. (5) File sizes: continue.js ~232, resume.js ~236, both under the gate; bin/amicus.js is outside the src/** gate and outside `npm run lint`'s src/ scope, but lint-staged only touches src/**, so bin edits skip eslint --fix — keep style manual. (6) Coupling: resume.js's `return` sits inside try — the finally at :209-212 still runs (lock released) before the value is returned; do not move the return after the finally without hoisting terminal. (7) tests/resume-lock.test.js asserts source strings ('session-lock', 'checkSessionLiveness', 'acquireLock' in resume.js; acquire/release in continue.js) — the edits keep all of those, verified.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

---
## Phase 2 — Release v1.7.7

Release phase — no worktrees, runs on merged local main. **STOP for user approval before step 5 (push/tag/publish are outward-facing).**

### Task 2.1: Cut and publish v1.7.7

**Files:**
- Modify: `CHANGELOG.md` (head), `package.json` + `package-lock.json` (version), `.claude-plugin/plugin.json` (version lockstep)

- [ ] **Step 1: Preflight on merged main** — `npm test` (expect 0 failed), `npm run lint`, `npm run check:sizes`, `npm run check:secrets`, `npm run check:tarball`, and the full gate `npm run test:all` (includes integration tests; ~2–3 min).
- [ ] **Step 2: CHANGELOG** — write the release section `## [1.7.7] - 2026-MM-DD` (Unreleased is empty — this step dictates the bullets; Keep-a-Changelog house style per the 1.7.6 head: a 1–2 line provenance preamble — "fixes from the 2026-07-01 product review" — then bold-lead bullets under **Fixed** for A7/A3/A5/A2 and a **Changed** note for the continue/resume exit codes). Leave an empty `## [Unreleased]` heading behind.
- [ ] **Step 3: Version bump** — `npm version 1.7.7 --no-git-tag-version`; hand-edit `.claude-plugin/plugin.json` version to `1.7.7` (lockstep is ENFORCED by `tests/plugin-manifest.test.js` "version is kept in sync with package.json" — CI fails without it).
- [ ] **Step 4: Release commit** — exactly `chore(release): v1.7.7`, touching exactly the 4 files above. Run `npm test` after committing to warm the tree-keyed `.test-passed` cache (pre-push gate).
- [ ] **Step 5: USER APPROVAL, then push** — push main via the gh credential helper, then `git tag v1.7.7 && git push origin v1.7.7`.
- [ ] **Step 6: Watch publish.yml** — `gh run list -R BourbonDog/amicus --workflow publish.yml` / `gh run watch -R BourbonDog/amicus <id>`. Pipeline: checkout(fetch-depth 0) → node 22 + npm@latest (OIDC needs npm≥11.5) → `npm ci` → `npm test` → `npm publish --access public --provenance` (trusted publishing, no token) → `gh release create --generate-notes --latest` (+Claude-rewritten notes if ANTHROPIC_API_KEY secret present).
- [ ] **Step 7: Verify** — `npm view amicus version` → 1.7.7; GitHub Release exists; CI matrix green on the tag commit. If the npm-test gate fails on CI: land a fix commit, move the tag (`git tag -f v1.7.7 <fix>`), `git push --force origin v1.7.7` (v1.6.1/v1.7.6 precedent — publish runs AFTER npm test, so no bad artifact can ship). Note: package.json at the tag must equal the tag version or npm publish 409s.

## Phase 3 — Abort overhaul (A1)

**Scope:** one mechanism — the metadata abort-marker — becomes authoritative for every abort path. Today only the headless loop honors it; interactive sessions ignore it entirely, MCP abort hard-kills without marking wave legs (stranding them 'running' forever), and CLI abort of an interactive session is a metadata-only no-op with a misleading success message.

**Lane order:** Task 3.1 (new `abort-coordinator` utility) **first** — 3.3 and 3.4 import it. Then 3.2 ∥ 3.3 ∥ 3.4 in parallel lanes (verified file-disjoint). **Task 3.3 edits `src/mcp-server.js` — no other phase's worktree may touch that file until Phase 3 merges.**

**Gates specific to this phase:** the two NEW files (3.1, 3.2) must use the logger, never console (`no-console` is ERROR outside the allowlist); `interactive.js` (269 lines) and `cli-handlers.js` (253) are NOT grandfathered — designs keep them ≤~280/~272, watch the 300 cap.

**Known residual (backlogged, do not fix here):** `fanout.js:174-180` `writeWaveMetadata` merges `status:'running'` over an abort marker that lands in the sub-second window before the spawned orchestrator initializes.


### Task 3.1 — Task 3.1 — abort-coordinator: marker-first grace-kill utility (new module)

**Files:** Create: C:/Users/sendt/code/amicus/src/utils/abort-coordinator.js (~85 lines)
Create: C:/Users/sendt/code/amicus/tests/abort-coordinator.test.js
No modifications to existing files.

**Verified anchors:** src/utils/session-abort.js:24-43 — markTerminal/markAborted confirmed (atomic temp+rename write, never throws, sets reason + abortedAt). src/utils/activity-poller.js:43-45 — killIfAlive confirmed (SIGTERM child if !killed). src/headless.js:51 — POLL_INTERVAL_MS = 2000 (env-overridable), confirming the ~2s marker-honor latency that sizes the grace window. src/sidecar/session-utils.js:258-266 — isProcessAlive exists but lives in src/sidecar/ (utils must not import from sidecar; a local copy with injectable kill is deliberate). bin/amicus.js:128 + :150-152 — `await handleAbort(args)` completes BEFORE armExitWatchdog is armed, so an awaited grace wait inside handleAbort is safe; lifecycle.js:15 confirms 'abort' is a one-shot command.

**Design:** New module src/utils/abort-coordinator.js encapsulating the phase's one abort mechanism: write the metadata marker first (callers do that via markAborted), give the target process a grace window to honor it, SIGTERM only survivors.

Exports:
- abortGraceMs(): number — reads AMICUS_ABORT_GRACE_MS env (tests set it to ~40-60ms), default 5000ms (headless loop + interactive watch both poll the marker every ~2s, so 5s ≈ 2.5 poll cycles).
- isAlive(pid, kill?): boolean — kill(pid, 0) probe; kill injectable for tests.
- killPidBestEffort(pid, kill?): boolean — SIGTERM, swallow ESRCH, logger.warn otherwise.
- async waitThenKill(pids, {graceMs?, pollMs=250, deps?{kill,sleep}}): Promise<{killed:number[], exited:number[]}> — polls liveness until all pids exit or deadline, then SIGTERMs survivors. CRITICAL: the default sleep timer is REF'D (no .unref()) — the CLI (Task 3.4) awaits this and an unref'd timer would let node exit mid-wait when the event loop drains; the MCP server (Task 3.3) fire-and-forgets the promise instead, and its stdio transport keeps the loop alive anyway.

Interfaces consumed by Task 3.3 (mcp-server.js) and Task 3.4 (cli-handlers.js). Task 3.2 does NOT use this module (killIfAlive suffices there).

**Code:**

```js
// C:/Users/sendt/code/amicus/src/utils/abort-coordinator.js
'use strict';

/**
 * Marker-first abort coordination (Phase 3 abort overhaul).
 *
 * Contract: the caller writes the metadata marker (status='aborted') FIRST,
 * gives the running process a grace window to honor it (the headless loop and
 * the interactive abort watch both poll metadata every ~2s and tear down
 * gracefully — mirror flush, usage persist, server-side abortSession), and
 * only SIGTERMs a process that is STILL alive after the grace window.
 *
 * Windows: process.kill() is TerminateProcess — no handlers run — but libuv
 * job objects kill non-detached children with the parent, so the fallback
 * kill still reaps the tree. The grace window is what keeps the common path
 * graceful.
 */

const { logger } = require('./logger');

/** Grace window before the fallback SIGTERM. Env-overridable (tests). */
function abortGraceMs() {
  const n = Number(process.env.AMICUS_ABORT_GRACE_MS);
  return (Number.isFinite(n) && n > 0) ? n : 5000;
}

/** @returns {boolean} true when a process with this pid exists. */
function isAlive(pid, kill = process.kill.bind(process)) {
  if (!pid) { return false; }
  try { kill(pid, 0); return true; } catch { return false; }
}

/** SIGTERM a pid, swallowing ESRCH. @returns {boolean} signal was sent */
function killPidBestEffort(pid, kill = process.kill.bind(process)) {
  if (!pid) { return false; }
  try { kill(pid, 'SIGTERM'); return true; } catch (err) {
    if (err.code !== 'ESRCH') {
      logger.warn('Failed to kill process', { pid, error: err.message });
    }
    return false;
  }
}

/**
 * Wait up to graceMs for the pids to exit on their own (marker-honoring
 * teardown), then SIGTERM any survivor. Early-exits as soon as every target
 * is gone, so a process that honors the marker in ~2s never sees a signal.
 *
 * NOTE: the poll timer is deliberately REF'D. The CLI awaits this call and
 * must stay alive through the grace window; callers that must not block
 * (MCP handler) fire-and-forget the returned promise instead.
 *
 * @param {number|null|Array<number|null>} pids
 * @param {{graceMs?:number, pollMs?:number, deps?:{kill?:Function, sleep?:Function}}} [opts]
 * @returns {Promise<{killed:number[], exited:number[]}>}
 */
async function waitThenKill(pids, opts = {}) {
  const graceMs = opts.graceMs !== undefined ? opts.graceMs : abortGraceMs();
  const pollMs = opts.pollMs || 250;
  const deps = opts.deps || {};
  const kill = deps.kill || process.kill.bind(process);
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const targets = (Array.isArray(pids) ? pids : [pids]).filter(Boolean);
  const deadline = Date.now() + graceMs;
  let remaining = targets.filter((pid) => isAlive(pid, kill));
  while (remaining.length > 0 && Date.now() < deadline) {
    await sleep(pollMs);
    remaining = remaining.filter((pid) => isAlive(pid, kill));
  }
  for (const pid of remaining) { killPidBestEffort(pid, kill); }
  return {
    killed: remaining,
    exited: targets.filter((pid) => !remaining.includes(pid)),
  };
}

module.exports = { abortGraceMs, isAlive, killPidBestEffort, waitThenKill };
```

**Tests:**

```js
File: C:/Users/sendt/code/amicus/tests/abort-coordinator.test.js
Run: cd C:/Users/sendt/code/amicus && npx jest tests/abort-coordinator.test.js
Write test FIRST → fails with 'Cannot find module ../src/utils/abort-coordinator' → implement → passes.

// tests/abort-coordinator.test.js
'use strict';

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { abortGraceMs, isAlive, killPidBestEffort, waitThenKill } = require('../src/utils/abort-coordinator');

const esrch = () => { const e = new Error('kill ESRCH'); e.code = 'ESRCH'; throw e; };

describe('abort-coordinator', () => {
  afterEach(() => { delete process.env.AMICUS_ABORT_GRACE_MS; });

  test('abortGraceMs defaults to 5000 and honors the env override', () => {
    expect(abortGraceMs()).toBe(5000);
    process.env.AMICUS_ABORT_GRACE_MS = '40';
    expect(abortGraceMs()).toBe(40);
    process.env.AMICUS_ABORT_GRACE_MS = 'garbage';
    expect(abortGraceMs()).toBe(5000);
  });

  test('isAlive: kill(pid,0) success => true; ESRCH => false; falsy pid => false', () => {
    expect(isAlive(123, jest.fn())).toBe(true);
    expect(isAlive(123, esrch)).toBe(false);
    expect(isAlive(null)).toBe(false);
  });

  test('killPidBestEffort SIGTERMs and swallows ESRCH', () => {
    const kill = jest.fn();
    expect(killPidBestEffort(42, kill)).toBe(true);
    expect(kill).toHaveBeenCalledWith(42, 'SIGTERM');
    expect(killPidBestEffort(42, esrch)).toBe(false); // must not throw
    expect(killPidBestEffort(null)).toBe(false);
  });

  test('waitThenKill never signals a process that exits during the grace window', async () => {
    let alive = true;
    const kill = jest.fn((pid, sig) => {
      if (!alive) { esrch(); }
      if (sig !== 0) { throw new Error('must not SIGTERM a marker-honoring process'); }
    });
    const sleep = jest.fn(async () => { alive = false; }); // process dies during first poll
    const res = await waitThenKill(42, { graceMs: 60000, pollMs: 1, deps: { kill, sleep } });
    expect(res.killed).toEqual([]);
    expect(res.exited).toEqual([42]);
  });

  test('waitThenKill SIGTERMs every survivor once the window closes (graceMs 0 = immediate)', async () => {
    const signals = [];
    const kill = jest.fn((pid, sig) => { if (sig !== 0) { signals.push(pid); } });
    const res = await waitThenKill([10, null, 20], { graceMs: 0, deps: { kill } });
    expect(res.killed).toEqual([10, 20]);
    expect(signals).toEqual([10, 20]);
  });

  test('waitThenKill with only falsy pids is a no-op', async () => {
    const kill = jest.fn();
    const res = await waitThenKill([null, undefined], { graceMs: 0, deps: { kill } });
    expect(res).toEqual({ killed: [], exited: [] });
    expect(kill).not.toHaveBeenCalled();
  });
});
```

**Risks:** Deliberate small duplication of session-utils.js isProcessAlive — utils/ must not import from sidecar/ (layering); reviewer should not 'deduplicate' it backwards. Timer is ref'd BY DESIGN — do not add .unref() 'for consistency' with activity-poller/interactive-mirror; that silently breaks the CLI path (Task 3.4) because node exits when only unref'd timers remain, skipping the fallback kill entirely. New src file: logger only (no-console is an eslint error here), 85 lines (size gate fine). No other in-flight phase touches src/utils/. 0o600 note: this module writes no files. Consumed by Tasks 3.3 + 3.4 — landing API changes later is expensive; the {killed, exited} return shape is part of the contract (3.4 prints from it).


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 3.2 — Task 3.2 — Interactive abort-marker watch + aborted-not-complete finalization

**Files:** Create: C:/Users/sendt/code/amicus/src/sidecar/interactive-abort.js (~80 lines)
Modify: C:/Users/sendt/code/amicus/src/sidecar/interactive.js — require block at :10 and :14 area, insert watch after the mirror block at :202-207, extend the close handler at :245-259 (file goes 269 → ~280 lines, under the 300 gate)
No edit: src/sidecar/resume.js and src/sidecar/continue.js — post-Task-1.4 they route through resolveTerminalState (see the NO EDIT note in Design)
Create: C:/Users/sendt/code/amicus/tests/sidecar/interactive-abort.test.js

**Verified anchors:** All confirmed today: src/sidecar/interactive.js has ZERO 'aborted' references; teardown plumbing at :245-259 (watchdog.cancel, activityPoller.stop, mirror.stop→usage, server.close); killIfAlive used at :191 (watchdog timeout) and :236 (parent-death hook); electronProcess declared `let ... = null` at :186 and assigned synchronously inside the Promise executor at :227 — no await between watch creation and spawn, so the 2s first tick can never fire before assignment. handleElectronProcess at :75-100: BOTH the 'error' (:85-91) and 'close' (:93-99) paths call the same resolve, so the async wrapper (where the watch is stopped) runs in both. interactive-mirror.js:27-55 polls at 2000ms with the same setTimeout/unref/stopped pattern (mimicked). opencode-client.js:370-372 abortSession(client, sessionId, directory) confirmed. session-finalize.js:13-24 resolveTerminalState: result.aborted → 'aborted' (start.js:229 routes through it — so the start path needs ONLY result.aborted set). CORRECTION/ADDITION to the review: at HEAD, resume.js:208 and continue.js:210 finalize with hardcoded { status: 'complete' } — but those exact lines are REPLACED by Phase 1 Task 1.4 (resolveTerminalState routing) before this task runs, so this task makes NO edits to either file (see Design).

**Design:** Hook choice: a THIRD dedicated poller, not an extension of the mirror tick or the activity poller. Rationale: the mirror's tick is a data-plane loop whose failures are swallowed and whose stop() semantics (final flush race) must stay untouched; the activity poller runs at 30s (too slow for abort latency). A dedicated 2s watcher matches the headless loop's marker latency and keeps the mechanism testable in isolation.

src/sidecar/interactive-abort.js exports:
- startAbortWatch({sessionDir, abortOpenCodeSession, killElectron, intervalMs=2000}) → {stop(), wasAborted()}. Each tick: read sessionDir/metadata.json; if status==='aborted': (1) await abortOpenCodeSession() best-effort — stops token spend server-side immediately, (2) killElectron() — SIGTERM via killIfAlive, (3) stop polling. Teardown then completes through the EXISTING close handler (mirror.stop → usage persisted, server.close) — the watcher triggers teardown, never owns it. Read/parse errors keep polling (best-effort). Timers unref'd (GUI process has Electron + server handles keeping it alive).
- markResultAborted(result, wasAborted) — sets result.aborted=true, completed=false. This is the piece that makes finalization honest: a SIGTERM'd Electron exits non-zero → resolveTerminalState would say 'error'; an Electron that exits 0 after the marker → 'complete'. With aborted set, start.js:227-239 finalizes 'aborted'.

Wiring in interactive.js: watch created right after the mirror (closures over ocClient/sessionId/sessionDirectory/electronProcess); in the resolve wrapper add abortWatch.stop() + markResultAborted(result, abortWatch.wasAborted()) BEFORE mirror.stop().

resume.js / continue.js: NO EDIT — post-Task-1.4 these route through resolveTerminalState, which already maps result.aborted → status 'aborted' + exit 130/143 (signal) or 2 (marker abort). This task only wires the interactive path (markResultAborted in interactive.js) so the result object actually carries aborted:true; the tests below assert the end-to-end behavior through the 1.4 path.

**Code:**

```js
// ── NEW FILE: src/sidecar/interactive-abort.js ──
'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const DEFAULT_INTERVAL_MS = 2000;

/**
 * Watch a session's metadata.json for an external abort marker
 * (status === 'aborted', written by `amicus abort` or MCP amicus_abort) and
 * tear the interactive session down when it appears:
 *   1. best-effort server-side abortSession (stops token spend immediately),
 *   2. SIGTERM the Electron process (killIfAlive).
 * Teardown then completes through the EXISTING Electron close handler
 * (mirror.stop → usage persist, server.close) — this watcher triggers
 * teardown but never owns it. Best-effort: read/parse errors keep polling.
 *
 * @param {object} opts
 * @param {string} opts.sessionDir
 * @param {() => Promise<void>} opts.abortOpenCodeSession
 * @param {() => void} opts.killElectron
 * @param {number} [opts.intervalMs=2000]
 * @returns {{ stop: () => void, wasAborted: () => boolean }}
 */
function startAbortWatch({ sessionDir, abortOpenCodeSession, killElectron, intervalMs = DEFAULT_INTERVAL_MS }) {
  const metaPath = path.join(sessionDir, 'metadata.json');
  let timer = null;
  let stopped = false;
  let aborted = false;

  const schedule = () => {
    if (stopped) { return; }
    timer = setTimeout(tick, intervalMs);
    if (timer.unref) { timer.unref(); }
  };

  async function tick() {
    if (stopped) { return; }
    try {
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.status === 'aborted') {
          aborted = true;
          stopped = true;
          logger.info('External abort marker detected — tearing down interactive session', { sessionDir });
          try { await abortOpenCodeSession(); } catch (err) {
            logger.warn('abortSession failed during interactive abort', { error: err.message });
          }
          try { killElectron(); } catch (err) {
            logger.warn('Electron kill failed during interactive abort', { error: err.message });
          }
          return; // teardown continues via the Electron close handler
        }
      }
    } catch (err) {
      logger.debug('Abort watch poll failed (best-effort)', { error: err.message });
    }
    schedule();
  }

  schedule();
  return {
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
    wasAborted() { return aborted; },
  };
}

/**
 * Fold the abort-watch outcome into the runInteractive result so
 * resolveTerminalState() maps a marker-triggered GUI teardown to 'aborted' —
 * never 'error' (SIGTERM'd Electron exits non-zero) and never 'complete'
 * (Electron exiting 0 after the marker landed).
 */
function markResultAborted(result, wasAborted) {
  if (wasAborted) {
    result.aborted = true;
    result.completed = false;
  }
  return result;
}

module.exports = { startAbortWatch, markResultAborted, DEFAULT_INTERVAL_MS };

// ── EDITS: src/sidecar/interactive.js ──
// (a) line 10 — add abortSession to the existing require:
const { createSession, sendPromptAsync, getMessages, abortSession } = require('../opencode-client');
// (b) after line 14 (startInteractiveMirror require) add:
const { startAbortWatch, markResultAborted } = require('./interactive-abort');
// (c) insert AFTER the mirror block (after line 207):
  // Phase 3: external aborts (CLI `amicus abort` / MCP amicus_abort) write a
  // metadata marker; nothing in the GUI path watched it before. On marker:
  // server-side abort + SIGTERM Electron; the close handler finishes teardown.
  const abortWatch = startAbortWatch({
    sessionDir,
    abortOpenCodeSession: () => abortSession(ocClient, sessionId, sessionDirectory),
    killElectron: () => killIfAlive(electronProcess),
  });
// (d) close handler (lines 245-259) — add the two marked lines:
    handleElectronProcess(electronProcess, taskId, async (result) => {
      process.removeListener('exit', killChildOnParentDeath);
      process.removeListener('SIGINT', killChildOnParentDeath);
      process.removeListener('SIGTERM', killChildOnParentDeath);
      watchdog.cancel();
      activityPoller.stop();
      abortWatch.stop();                                    // NEW
      markResultAborted(result, abortWatch.wasAborted());   // NEW
      try {
        const { usage } = await mirror.stop();
        if (usage) { result.usage = usage; }
      } catch (err) { logger.debug('mirror stop failed', { error: err.message }); }
      server.close();
      logger.debug('OpenCode server closed after Electron exit');
      result.opencodeSessionId = sessionId;
      resolve(result);
    });

// ── src/sidecar/resume.js / src/sidecar/continue.js: NO EDIT ──
// Post-Task-1.4 both files route their finalize through resolveTerminalState
// (src/sidecar/session-finalize.js), which already maps result.aborted →
// status 'aborted'. The interactive.js wiring above is what makes the result
// object actually carry aborted:true; nothing else is needed here.
```

**Tests:**

```js
File: C:/Users/sendt/code/amicus/tests/sidecar/interactive-abort.test.js
Run: cd C:/Users/sendt/code/amicus && npx jest tests/sidecar/interactive-abort.test.js
Fails first with 'Cannot find module ../../src/sidecar/interactive-abort'. Patterns copied from tests/interactive-watchdog.test.js (fake timers + advanceTimersByTimeAsync, mock electronProcess object) and tests/interactive-mirror.test.js (mkdtemp session dir).

// tests/sidecar/interactive-abort.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { startAbortWatch, markResultAborted } = require('../../src/sidecar/interactive-abort');

const writeMeta = (dir, meta) =>
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2));

describe('startAbortWatch', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortwatch-'));
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('marker triggers abortSession THEN Electron kill, exactly once, then stops polling', async () => {
    const calls = [];
    const abortOpenCodeSession = jest.fn(async () => { calls.push('abortSession'); });
    const electronProcess = { killed: false, kill: jest.fn(() => calls.push('kill')) };
    const watch = startAbortWatch({
      sessionDir: dir,
      abortOpenCodeSession,
      killElectron: () => { if (!electronProcess.killed) { electronProcess.kill('SIGTERM'); } },
      intervalMs: 1000,
    });

    writeMeta(dir, { taskId: 't1', status: 'running' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(abortOpenCodeSession).not.toHaveBeenCalled(); // running: no teardown
    expect(watch.wasAborted()).toBe(false);

    writeMeta(dir, { taskId: 't1', status: 'aborted' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['abortSession', 'kill']); // order matters: server abort first
    expect(watch.wasAborted()).toBe(true);

    await jest.advanceTimersByTimeAsync(5000); // fired once — no re-fire
    expect(abortOpenCodeSession).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  test('abortSession rejection still kills Electron (best-effort chain)', async () => {
    const killElectron = jest.fn();
    const watch = startAbortWatch({
      sessionDir: dir,
      abortOpenCodeSession: jest.fn().mockRejectedValue(new Error('server gone')),
      killElectron,
      intervalMs: 1000,
    });
    writeMeta(dir, { status: 'aborted' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(killElectron).toHaveBeenCalledTimes(1);
    expect(watch.wasAborted()).toBe(true);
    watch.stop();
  });

  test('missing then corrupt metadata keeps polling without throwing', async () => {
    const killElectron = jest.fn();
    const watch = startAbortWatch({ sessionDir: dir, abortOpenCodeSession: jest.fn(), killElectron, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000); // no metadata.json yet
    fs.writeFileSync(path.join(dir, 'metadata.json'), '{not json');
    await jest.advanceTimersByTimeAsync(1000); // corrupt: swallowed
    expect(killElectron).not.toHaveBeenCalled();
    writeMeta(dir, { status: 'aborted' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(killElectron).toHaveBeenCalledTimes(1); // recovered
    watch.stop();
  });

  test('stop() halts polling — a later marker is ignored', async () => {
    const killElectron = jest.fn();
    const watch = startAbortWatch({ sessionDir: dir, abortOpenCodeSession: jest.fn(), killElectron, intervalMs: 1000 });
    watch.stop();
    writeMeta(dir, { status: 'aborted' });
    await jest.advanceTimersByTimeAsync(5000);
    expect(killElectron).not.toHaveBeenCalled();
    expect(watch.wasAborted()).toBe(false);
  });
});

describe('markResultAborted → terminal status', () => {
  test('flips aborted+completed only when the watch fired', () => {
    expect(markResultAborted({ completed: true }, true)).toEqual({ completed: false, aborted: true });
    const untouched = { completed: true };
    markResultAborted(untouched, false);
    expect(untouched.aborted).toBeUndefined();
    expect(untouched.completed).toBe(true);
  });

  test('an aborted GUI result resolves to status "aborted", never error/complete', () => {
    const { resolveTerminalState } = require('../../src/sidecar/session-finalize');
    // SIGTERM'd Electron exits non-zero → completed:false; marker must win:
    expect(resolveTerminalState(markResultAborted({ summary: '', completed: false, exitCode: 1 }, true)).status).toBe('aborted');
    // Electron exiting 0 after the marker must ALSO not finalize complete:
    expect(resolveTerminalState(markResultAborted({ summary: 'x', completed: true, exitCode: 0 }, true)).status).toBe('aborted');
  });
});
```

**Risks:** SIZE GATE: interactive.js is NOT grandfathered — 269 → ~280 lines after wiring; if any other in-flight phase also grows this file the gate blocks the commit (coordinate; the watcher itself already lives in a new file for exactly this reason). COUPLING: none on resume.js/continue.js — this task no longer edits them (see the NO EDIT note in Design); the end-to-end aborted-status behavior flows through Task 1.4's resolveTerminalState routing, which the tests below pin. Behavior notes for review: (1) mirror.stop() still writes progress.json stage 'complete' on an aborted teardown — cosmetic only (metadata.json is the source of truth for status), documented as out of scope; (2) the aborted GUI result's summary is Electron stdout (usually empty) — start.js:238 then persists an empty summary.md with status 'aborted', which amicus_read handles via the FAILED_TERMINAL_STATUSES reason branch (mcp-server.js:39/619); (3) electronProcess-null race is impossible in practice (no await between watch creation and the synchronous spawn; first tick is 2s out) — do NOT move the watch inside the Promise executor, closures are enough; (4) killIfAlive on Windows = TerminateProcess of Electron — its job object reaps renderer children (empirically verified in this repo). eslint: new file uses logger only. Windows CI/pre-commit: no console, curly braces everywhere.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 3.3 — Task 3.3 — MCP amicus_abort ordering fix: legs-marked-first wave abort + marker-first grace-kill

**Files:** Modify: C:/Users/sendt/code/amicus/src/mcp-server.js:725-753 (the whole amicus_abort handler; file is grandfathered on the size gate, 947 → ~975 lines)
Modify: C:/Users/sendt/code/amicus/tests/mcp-headless-lifecycle.test.js — rewrite the 'abort running session with live PID' test (~:245-271) for the marker-first contract (concrete replacement in **Tests** below); rest of the file untouched
Create: C:/Users/sendt/code/amicus/tests/mcp-abort-ordering.test.js
Depends on Task 3.1 (src/utils/abort-coordinator.js).

**Verified anchors:** All confirmed today: amicus_abort at mcp-server.js:725-753 — SIGTERMs metadata.pid FIRST (:736-742) then writes status 'aborted' (:743-747, plain non-atomic write, no wave handling at all). Crash-cascade gate at :475 requires `metadata.status === 'running' && metadata.pid` — so the current status write falsifies it and MCP-aborted waves strand legs 'running' forever. Shared-server sessions write pid:null (:317-325) with goPid = the SHARED server's pid (:322) — killing it would kill every session (comment at :319 confirms). Wave metadata: the MCP fanout handler writes no pid (:799-802); the spawned orchestrator merges pid: process.pid (fanout.js:179) and goPid (fanout.js:207). Legs poll their own markers (each leg = runHeadless with the marker check at headless.js:372-392), so a live orchestrator settles gracefully once legs are marked — it also has POSIX signal handlers (fanout.js:215-227) but Windows TerminateProcess skips them, which is why marking must precede killing. readMetadata at :163-168 (throws on malformed JSON — wrap leg reads). safeSessionDir resolves legacy sidecar_sessions dirs (session-path.js:32-34). Test harness pattern: tests/mcp-headless-lifecycle.test.js:61-73 (require('../src/mcp-server').handlers + temp dirs + jest.resetModules) and :253-263 (process.kill spy). TERMINAL_STATUSES includes 'aborted' (result-schema.js:15).

**Design:** Replace the handler body. New ordering contract:

WAVE (metadata.type === 'wave'):
1. Mark every still-running leg aborted via markAborted (atomic write + reason) — BEFORE any status write to the wave and BEFORE any kill. This makes leg state correct regardless of what happens to the orchestrator (TerminateProcess on Windows runs no handlers).
2. Mark the wave aborted.
3. Fire-and-forget waitThenKill([metadata.pid, metadata.goPid]) — grace window lets a LIVE orchestrator observe its legs' markers (~2s poll), write wave.json, and exit cleanly; only a wedged/killed-handler process gets SIGTERM, and goPid is the wave-OWNED server (never shared), so killing it is safe.
4. Response gains legsAborted count.

SINGLE SESSION:
1. markAborted marker FIRST (replaces the raw fs.writeFileSync — atomic, sets reason, preserves other fields).
2. Fire-and-forget waitThenKill(metadata.pid) — headless loop honors the marker in ~2s (graceful: mirror flush, abortSession server-side, finalize); after Task 3.2, interactive sessions do too (watch → abortSession + Electron teardown → usage persisted). Only a survivor gets SIGTERM after the grace window.
3. NEVER touch goPid on this path: shared-server sessions have pid:null + shared goPid (marker-only by construction); owned-server sessions close their own server during graceful teardown, and if hard-killed, the libuv job object reaps the Go child anyway.

The handler must NOT await waitThenKill (MCP tool responses must return immediately); .catch(()=>{}) guards the floating promise. Grace via abortGraceMs() (AMICUS_ABORT_GRACE_MS env → tests use ~60ms).

EXISTING-TEST IMPACT: tests/mcp-headless-lifecycle.test.js 'abort running session with live PID' (~:245-271) asserts killSpy received SIGTERM synchronously after amicus_abort — dead under marker-first ordering. Worse: it calls killSpy.mockRestore() in its finally, and under the new design a grace-kill timer can still be pending at that point; once the spy is gone the timer fires the REAL process.kill(process.pid, 'SIGTERM') and kills the jest worker. Rewrite it (concrete block in **Tests**): set AMICUS_ABORT_GRACE_MS=0 + fake timers, assert no-kill-yet when the tool returns, advance timers past the grace window, assert the kill, then clear ALL pending timers (jest.clearAllTimers()) BEFORE useRealTimers()/mockRestore() so no ref'd timer survives the test.

**Code:**

```js
// src/mcp-server.js — replace lines 725-753 with:
  async amicus_abort(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) {
      return textResult(`Session ${input.taskId} not found in project ${cwd}. ` +
        'If you ran it in a different project, pass the original "project".', true);
    }
    if (metadata.status !== 'running') {
      return textResult(`Session ${input.taskId} is not running (status: ${metadata.status}).`);
    }

    const sessionDir = safeSessionDir(cwd, input.taskId);
    const { markAborted } = require('./utils/session-abort');
    const { waitThenKill } = require('./utils/abort-coordinator');

    if (metadata.type === 'wave') {
      // Order is load-bearing: mark every running leg aborted BEFORE any kill
      // or wave-status write. A TerminateProcess'd orchestrator (Windows
      // process.kill) runs no signal handlers, and writing the wave status
      // first falsifies the crash-cascade gate in amicus_status — both used
      // to strand legs 'running' forever. Legs poll their own marker (~2s),
      // so a live orchestrator settles gracefully during the grace window.
      let legsAborted = 0;
      for (const legId of metadata.legs || []) {
        try {
          const legMeta = readMetadata(legId, cwd);
          if (legMeta && legMeta.status === 'running' &&
              markAborted(safeSessionDir(cwd, legId), 'wave abort (MCP)')) {
            legsAborted++;
          }
        } catch { /* skip unreadable leg */ }
      }
      markAborted(sessionDir, 'manual abort (MCP)');
      // Fallback only: SIGTERM the orchestrator + its OWNED OpenCode server
      // if they outlive the grace window. Fire-and-forget — the tool result
      // must not block on the grace period.
      waitThenKill([metadata.pid, metadata.goPid]).catch(() => { /* best-effort */ });
      return textResult(JSON.stringify({
        taskId: input.taskId, status: 'aborted', legsAborted,
        message: `Wave abort requested. ${legsAborted} running leg(s) marked aborted; ` +
          'the fan-out process will terminate shortly.',
      }));
    }

    // Single session: marker FIRST — the headless loop and the interactive
    // abort watch honor it within ~2s and tear down gracefully (mirror flush,
    // usage persist, server-side abortSession). SIGTERM only a process that
    // outlives the grace window. NEVER touch goPid here: on the shared-server
    // path it is the server every session shares (pid is null there, so that
    // path is marker-only by construction).
    markAborted(sessionDir, 'manual abort (MCP)');
    waitThenKill(metadata.pid).catch(() => { /* best-effort */ });

    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'aborted',
      message: 'Session abort requested. The Amicus process will terminate shortly.',
    }));
  },
```

**Tests:**

```js
File: C:/Users/sendt/code/amicus/tests/mcp-abort-ordering.test.js
Run: cd C:/Users/sendt/code/amicus && npx jest tests/mcp-abort-ordering.test.js
Fails first on current main: kill happens BEFORE the marker (ordering asserts), legsAborted undefined, legs stay 'running'. Harness mimics tests/mcp-headless-lifecycle.test.js (handlers called directly, temp dirs, kill spy, resetModules) and tests/abort-wave.test.js (session fixtures). Uses canonical .claude/amicus_sessions dirs and real (short) timers via AMICUS_ABORT_GRACE_MS.

// tests/mcp-abort-ordering.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function writeSession(projectDir, taskId, meta) {
  const dir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'),
    JSON.stringify({ taskId, status: 'running', createdAt: new Date().toISOString(), ...meta }, null, 2));
  return dir;
}
const readMeta = (projectDir, taskId) => JSON.parse(fs.readFileSync(
  path.join(projectDir, '.claude', 'amicus_sessions', taskId, 'metadata.json'), 'utf-8'));
const parseResult = (r) => JSON.parse(r.content[0].text);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe('amicus_abort ordering (Phase 3)', () => {
  let tmpDir; let handlers; let killSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-abort-'));
    process.env.AMICUS_ABORT_GRACE_MS = '60';
    handlers = require('../src/mcp-server').handlers;
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {}); // every pid reads "alive"
  });
  afterEach(() => {
    killSpy.mockRestore();
    delete process.env.AMICUS_ABORT_GRACE_MS;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('wave abort marks wave + all running legs BEFORE any kill; pid+goPid SIGTERMed only after grace', async () => {
    writeSession(tmpDir, 'cafe0001', { type: 'wave', legs: ['cafe0001-1', 'cafe0001-2'], pid: 4242, goPid: 4343 });
    writeSession(tmpDir, 'cafe0001-1', { parentWave: 'cafe0001' });                     // running
    writeSession(tmpDir, 'cafe0001-2', { parentWave: 'cafe0001', status: 'complete' }); // finished

    const data = parseResult(await handlers.amicus_abort({ taskId: 'cafe0001' }, tmpDir));
    expect(data.status).toBe('aborted');
    expect(data.legsAborted).toBe(1);

    // markers landed synchronously — and NO SIGTERM has been sent yet
    expect(readMeta(tmpDir, 'cafe0001').status).toBe('aborted');
    expect(readMeta(tmpDir, 'cafe0001-1').status).toBe('aborted');
    expect(readMeta(tmpDir, 'cafe0001-2').status).toBe('complete'); // never clobbered
    expect(killSpy).not.toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(4343, 'SIGTERM');

    await sleep(500); // grace (60ms) + one 250ms poll cycle + slack
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM'); // orchestrator fallback-killed
    expect(killSpy).toHaveBeenCalledWith(4343, 'SIGTERM'); // owned Go server fallback-killed
  });

  test('regression: MCP wave abort no longer strands legs — status shows no running leg', async () => {
    writeSession(tmpDir, 'cafe0002', { type: 'wave', legs: ['cafe0002-1'], pid: 4242 });
    writeSession(tmpDir, 'cafe0002-1', { parentWave: 'cafe0002' });
    await handlers.amicus_abort({ taskId: 'cafe0002' }, tmpDir);
    const status = parseResult(await handlers.amicus_status({ taskId: 'cafe0002' }, tmpDir));
    expect(status.status).toBe('aborted');
    expect(status.legs.every(l => l.status !== 'running')).toBe(true);
    expect(status.legs[0].status).toBe('aborted');
  });

  test('single session: marker immediate, wedged pid killed only after grace', async () => {
    writeSession(tmpDir, 'beef0003', { pid: 5555 });
    await handlers.amicus_abort({ taskId: 'beef0003' }, tmpDir);
    expect(readMeta(tmpDir, 'beef0003').status).toBe('aborted');
    expect(readMeta(tmpDir, 'beef0003').abortedAt).toBeDefined();
    expect(killSpy).not.toHaveBeenCalledWith(5555, 'SIGTERM'); // marker-first
    await sleep(500);
    expect(killSpy).toHaveBeenCalledWith(5555, 'SIGTERM'); // fallback for a wedged process
  });

  test('single session that honors the marker within the grace window is never signalled', async () => {
    writeSession(tmpDir, 'beef0004', { pid: 6666 });
    killSpy.mockImplementation((pid, sig) => {
      if (pid === 6666 && sig === 0) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
    }); // liveness probe says "already exited"
    await handlers.amicus_abort({ taskId: 'beef0004' }, tmpDir);
    await sleep(500);
    expect(killSpy).not.toHaveBeenCalledWith(6666, 'SIGTERM');
  });

  test('shared-server session (pid null) is marker-only; the shared goPid is NEVER killed', async () => {
    writeSession(tmpDir, 'beef0005', { pid: null, goPid: 7777, opencodeSessionId: 'ses_x' });
    await handlers.amicus_abort({ taskId: 'beef0005' }, tmpDir);
    expect(readMeta(tmpDir, 'beef0005').status).toBe('aborted');
    await sleep(500);
    expect(killSpy).not.toHaveBeenCalledWith(7777, 'SIGTERM');
  });
});
```

**Rewrite of the existing test** — tests/mcp-headless-lifecycle.test.js: replace the 'abort running session with live PID' test (~:245-271) with the block below; every other test in the file is untouched. The old version asserted a synchronous SIGTERM (kill-then-mark) and its `finally { killSpy.mockRestore(); }` would let a still-pending grace-kill timer fire the REAL process.kill and take down the jest worker.

```js
    test('abort running session with live PID (marker-first: kill only after the grace window)', async () => {
      const taskId = 'abort-live-001';
      // Use process.pid as a known-alive PID
      createSession(tmpDir, taskId, { status: 'running', pid: process.pid });

      // Mock process.kill BEFORE aborting and keep the mock installed until
      // every grace-kill timer has been drained — a real SIGTERM here would
      // kill the jest worker.
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
      jest.useFakeTimers();
      process.env.AMICUS_ABORT_GRACE_MS = '0';

      try {
        const result = await handlers.amicus_abort({ taskId }, tmpDir);
        const data = parseResult(result);
        expect(data.status).toBe('aborted');
        expect(data.taskId).toBe(taskId);

        // Marker-first contract (Phase 3): the tool returns with the marker
        // durable but NO SIGTERM sent yet.
        expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGTERM');

        // Drain the grace window (0ms) + the coordinator's poll cycle.
        await jest.advanceTimersByTimeAsync(1000);
        expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');

        // Verify status persisted
        const status = await handlers.amicus_status({ taskId }, tmpDir);
        expect(parseResult(status).status).toBe('aborted');
      } finally {
        // No ref'd timer may survive this test: discard every pending
        // grace-kill timer BEFORE unmocking, or the real process.kill fires
        // after mockRestore and SIGTERMs the worker.
        jest.clearAllTimers();
        jest.useRealTimers();
        killSpy.mockRestore();
        delete process.env.AMICUS_ABORT_GRACE_MS;
      }
    });
```

**Risks:** SERIALIZATION HUB: src/mcp-server.js — serialize this task against ANY other in-flight phase that edits the file (status/read/shared-server work); the edit is confined to one handler but conflicts here are the plan's chronic pain point. Behavior deltas to call out in review: (1) marker write is now atomic (markTerminal temp+rename) and adds a `reason` field — old code was a plain writeFileSync; downstream readers already handle reason (FAILED_TERMINAL_STATUSES branch in amicus_read). (2) The floating waitThenKill promise dies if the MCP server process exits within the grace window (SIGTERM handler at :931-938 calls process.exit(0)) — best-effort by design; the marker is already durable. (3) The wave response shape gains legsAborted — additive, no consumer parses the old message string. (4) Early-abort race: a wave aborted before the spawned orchestrator writes pid/goPid (sub-second window) gets marker-only treatment AND fanout.js:174-180 can merge status:'running' back over the marker — pre-existing, out of scope, noted for a follow-up. (5) Grandfathered file: size gate passes; eslint still runs on the staged file — the new block uses no console, curly-all, single quotes. Windows: SIGTERM = TerminateProcess; the orchestrator's own job object reaps its Go server even if the explicit goPid kill loses the race (double-kill is ESRCH-swallowed).


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 3.4 — Task 3.4 — CLI abort: grace-period fallback kill via metadata.pid + honest output

**Files:** Modify: C:/Users/sendt/code/amicus/src/cli-handlers.js — single-session tail of handleAbort (lines 148-149; file 253 → ~272 lines, under the 300 gate; wave branch :129-146 and --all branch :72-93 intentionally untouched)
Create: C:/Users/sendt/code/amicus/tests/abort-cli-kill.test.js
Depends on Task 3.1 (src/utils/abort-coordinator.js).

**Verified anchors:** All confirmed today: handleAbort at cli-handlers.js:71-150; the single-session path (:110-149) reads meta (:119-125), calls markAborted(sessionDir, 'manual abort') (:148) and prints 'Session <id> marked as aborted.' (:149) — no kill, so an interactive session (pre-Task-3.2 build, or a wedged one) keeps running and burning tokens while the CLI claims success. --all at :72-93 and the wave branch at :128-146 already mark legs first (leave both alone). meta.pid provenance: MCP spawn path writes the child amicus pid (mcp-server.js:423-431); CLI-launched sessions may have no pid — guarded. bin/amicus.js:128 awaits handleAbort and only arms the 1.5s force-exit watchdog AFTER it returns (bin/amicus.js:150-152, lifecycle.js:15 'abort' is one-shot) — so an awaited in-handler grace wait is safe, and this is exactly why Task 3.1's poll timer must stay ref'd. eslint: cli-handlers.js is on the no-console allowlist (.eslintrc.js overrides) — console output here is legal and is the existing style (console.log at :89-92,144,149).

**Design:** After the existing marker write, add an awaited fallback kill with honest, stepwise output:
1. Keep `markAborted(sessionDir, 'manual abort')` + the existing 'marked as aborted' line (the marker is the mechanism; headless honors it in ~2s, interactive honors it once Task 3.2 lands).
2. If meta.pid exists: print 'Waiting up to Ns for the session process (pid P) to exit gracefully...', then `await waitThenKill(meta.pid)` (grace = abortGraceMs(), early-exits the moment the pid dies, so the typical wait is ~2-3s not 5). Print the true outcome: 'Process exited cleanly.' vs 'Process <pid> did not exit in time — sent SIGTERM (a hard kill on Windows).'
3. If no pid (CLI-launched or shared-server record): keep output as today — the marker alone is the honest story.
No signature changes; handleAbort stays async and awaited by bin/amicus.js. Tasks 3.3/3.4 both consume waitThenKill but touch different files (parallel-safe).

**Code:**

```js
// src/cli-handlers.js — replace lines 148-149:
//   markAborted(sessionDir, 'manual abort');
//   console.log(`Session ${taskId} marked as aborted.`);
// with:
  markAborted(sessionDir, 'manual abort');
  console.log(`Session ${taskId} marked as aborted.`);

  // Phase 3: fallback direct-kill for a session that does not honor the
  // marker. Headless loops poll the marker every ~2s and the interactive
  // abort watch does too, so the normal outcome is a graceful exit during
  // the grace window; only a wedged/legacy process gets SIGTERM. The wait is
  // awaited on purpose — bin/amicus.js arms its force-exit watchdog only
  // after this handler returns.
  if (meta.pid) {
    const { waitThenKill, abortGraceMs } = require('./utils/abort-coordinator');
    const graceSec = Math.ceil(abortGraceMs() / 1000);
    console.log(`Waiting up to ${graceSec}s for the session process (pid ${meta.pid}) to exit gracefully...`);
    const { killed } = await waitThenKill(meta.pid);
    console.log(killed.length > 0
      ? `Process ${meta.pid} did not exit in time — sent SIGTERM (a hard kill on Windows).`
      : 'Process exited cleanly.');
  }
// (nothing else in the file changes; wave and --all branches keep their
//  marker-only contract — wave legs poll their own markers and settle)
```

**Tests:**

```js
File: C:/Users/sendt/code/amicus/tests/abort-cli-kill.test.js
Run: cd C:/Users/sendt/code/amicus && npx jest tests/abort-cli-kill.test.js
Fails first on current main: no kill is ever attempted and no waiting/outcome lines are printed. Harness copied from tests/abort-wave.test.js (logger mock, temp project, console.log spy, handleAbort called directly) + the process.kill spy pattern from tests/mcp-headless-lifecycle.test.js.

// tests/abort-cli-kill.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { handleAbort } = require('../src/cli-handlers');

describe('abort <taskId> fallback kill (Phase 3)', () => {
  let project; let logSpy; let killSpy;

  const writeSession = (taskId, meta) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    return dir;
  };
  const readStatus = (taskId) => JSON.parse(fs.readFileSync(
    path.join(project, '.claude', 'amicus_sessions', taskId, 'metadata.json'), 'utf-8')).status;
  const output = () => logSpy.mock.calls.map(c => c.join(' ')).join('\n');

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortkill-'));
    process.env.AMICUS_ABORT_GRACE_MS = '40';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    killSpy = jest.spyOn(process, 'kill');
  });
  afterEach(() => {
    logSpy.mockRestore();
    killSpy.mockRestore();
    delete process.env.AMICUS_ABORT_GRACE_MS;
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('wedged interactive session: marker first, then SIGTERM after the grace window, honest message', async () => {
    killSpy.mockImplementation(() => {}); // pid always "alive"
    writeSession('beef0010', { status: 'running', pid: 54321, headless: false });

    await handleAbort({ _: ['abort', 'beef0010'], cwd: project });

    expect(readStatus('beef0010')).toBe('aborted');            // marker landed
    expect(killSpy).toHaveBeenCalledWith(54321, 'SIGTERM');    // fallback fired (handler awaited it)
    expect(output()).toContain('marked as aborted');
    expect(output()).toContain('did not exit in time');        // honest outcome
  });

  it('process that honors the marker is never signalled and gets the clean-exit message', async () => {
    killSpy.mockImplementation((pid, sig) => {
      if (pid === 54322 && sig === 0) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
    }); // liveness probe: already exited
    writeSession('beef0011', { status: 'running', pid: 54322 });

    await handleAbort({ _: ['abort', 'beef0011'], cwd: project });

    expect(readStatus('beef0011')).toBe('aborted');
    expect(killSpy).not.toHaveBeenCalledWith(54322, 'SIGTERM');
    expect(output()).toContain('Process exited cleanly');
  });

  it('pid-less session (shared-server record) stays marker-only — no kill, no wait chatter', async () => {
    killSpy.mockImplementation(() => { throw new Error('kill must not be called'); });
    writeSession('beef0012', { status: 'running', pid: null });

    await handleAbort({ _: ['abort', 'beef0012'], cwd: project });

    expect(readStatus('beef0012')).toBe('aborted');
    expect(killSpy).not.toHaveBeenCalled();
    expect(output()).toContain('marked as aborted');
    expect(output()).not.toContain('Waiting up to');
  });

  it('no-regression: wave abort keeps marker-only behavior for legs (existing contract)', async () => {
    writeSession('beef0013', { type: 'wave', status: 'running', legs: ['beef0013-1'] });
    writeSession('beef0013-1', { status: 'running', parentWave: 'beef0013' });
    await handleAbort({ _: ['abort', 'beef0013'], cwd: project });
    expect(readStatus('beef0013')).toBe('aborted');
    expect(readStatus('beef0013-1')).toBe('aborted');
  });
});
```

**Risks:** SIZE GATE: cli-handlers.js is NOT grandfathered — 253 → ~272 lines; if another phase also grows it, the abort-coordinator require pattern keeps the delta minimal (do not inline any coordinator logic here). UX: the CLI now blocks up to abortGraceMs (default 5s, typically ~2-3s because waitThenKill early-exits when the pid dies) — the 'Waiting up to Ns...' line makes that honest; do not shorten the grace below ~2× the 2s marker-poll interval or graceful teardown loses the race and every abort becomes a hard kill. Windows: the fallback SIGTERM is TerminateProcess of the spawned amicus process — its job object kills the non-detached Electron/Go children (verified empirically in this repo), and the metadata is already 'aborted' before the kill so no state is lost; the summary/usage of a hard-killed session are simply absent (amicus_read's failed-terminal branch reports the reason). Interplay: with Task 3.2 deployed, the graceful path (marker → watch → Electron teardown → finalizeSession status 'aborted') normally wins the race and this fallback is a no-op — the second test pins exactly that. Wave/--all branches deliberately untouched (legs poll their own markers; killing the CLI fanout orchestrator would forfeit its graceful wave.json write). bin/amicus.js needs NO change: handleAbort is awaited and the 1.5s exit watchdog arms only afterwards. eslint: console is allowlisted for this file.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

---
## Phase 4 — MCP de-bloat (A4): 52 tools → 13

**Scope:** stop registering the legacy `sidecar` MCP server (postinstall does it on all three paths today), migrate existing duplicate registrations away safely, make the 13 `sidecar_*` tool aliases opt-in (`AMICUS_LEGACY_ALIASES=1`), and teach `doctor`/`doctor --fix` to detect and clean duplicates. Math for the release notes: 13 real tools × 2 alias names × 2 server registrations = 52 client-visible tools today → 13 after this phase (14 once Phase 5 adds `amicus_wait`).

**Lane order:** ONE serial lane (`amicus-p4`): 4.1 → 4.2 → 4.3. (4.1 and 4.2 edit adjacent rows of `docs/SHIMS.md`; 4.3 consumes 4.1's module; 4.2 touches `src/mcp-server.js` — the hub — so nothing else may touch it concurrently.) 4.1 is hard-blocked on Phase 1 Task B's `src/utils/mcp-self-identity.js` (`isAmicusMcpConfig(config) => boolean`, pure/sync/never-throws). NOTE: src/mcp-server.js line anchors in this phase are pre-Phase-3 (HEAD@509ab83) numbers — the file grows as phases 3/4/5 land; locate edit sites by the quoted code, not line numbers.

**Deprecation posture:** this completes the deprecation announced in `docs/SHIMS.md` (aliases opt-in now; full removal stays slated for the next major per issue #19). BREAKING-adjacent: saved permission allowlists or agent scripts referencing `mcp__amicus__sidecar_*` stop resolving unless opted in — call it out in the v1.8.0 changelog.

**Known pre-existing bug (backlogged, do NOT fix here):** `src/utils/mcp-discovery.js` `discoverCoworkMcps` uses `~/.config/Claude` on win32 instead of `%APPDATA%\Claude` — 4.1's `claudeDesktopConfigPath` deliberately mirrors postinstall's correct APPDATA logic instead.


### Task 4.1 — Task 4.1 — postinstall: stop registering the legacy 'sidecar' MCP server + safe removal migration

**Files:** CREATE: src/utils/legacy-mcp-migration.js
CREATE: tests/legacy-mcp-migration.test.js
CREATE: tests/postinstall-legacy-mcp.test.js
MODIFY: scripts/postinstall.js — delete :125-134 (CLI 'sidecar' add-json shim block incl. its DEPRECATED comment), delete :152-154 (file-fallback `addMcpToConfigFile(claudeConfigPath, 'sidecar', MCP_CONFIG)` + comment), delete :178-180 (Desktop sidecar add + comment); add `migrateLegacyMcp()` after `registerClaudeDesktop()` (~:182); wire into `main()` at :285-304; extend module.exports at :339 with `registerClaudeCode, registerClaudeDesktop, migrateLegacyMcp`
MODIFY: docs/SHIMS.md:19 — MCP registration row: mark 'duplicate sidecar server entry' as REMOVED in v1.8.0 (postinstall now auto-removes identical-in-effect entries)
TEST RUN: npx jest tests/legacy-mcp-migration.test.js tests/postinstall-legacy-mcp.test.js

**Verified anchors:** postinstall.js sidecar registrations confirmed at :127-134 (CLI path; the DEPRECATED comment starts at :125), :152-154 (file fallback; brief said :152-155 — :155 is the function's closing brace), :178-180 (Desktop; brief said :178-181 — :181 is the closing brace). MCP_CONFIG = {command:'npx', args:['-y','amicus@latest','mcp']} at :40. addMcpToConfigFile at :51-71 (writes JSON.stringify(...,null,2), mode 0o600). registerClaudeCode/registerClaudeDesktop are NOT currently exported (:339) — must export for tests. scripts/postinstall.js is NOT under the 300-line size gate (scripts/check-file-sizes.js:19 CONFIG.include = ['src/**/*.js'] only) — confirmed, brief asked to check. src/utils/mcp-self-identity.js does NOT exist yet (Phase 1 Task B creates it) — this task is BLOCKED on Phase 1B landing.

**Design:** Approach: (a) delete the three 'sidecar' registration sites; (b) new shared module src/utils/legacy-mcp-migration.js does inspect/remove of a legacy 'sidecar' entry in the two files that all three registration paths wrote to (`claude mcp add-json --scope user` and the file fallback both land in ~/.claude.json → mcpServers; Desktop lands in claude_desktop_config.json — so file-level removal covers all three paths; a `claude mcp remove` subprocess was considered and rejected as a redundant writer of the same file that adds a 10s exec to every install); (c) postinstall main() calls a new console-logging wrapper migrateLegacyMcp() as a one-shot migration on install/upgrade.

Safety rule: an entry is removed ONLY when identical-in-effect to the amicus entry, decided by the Phase-1 helper. CONSUMED INTERFACE (Phase 1 Task B must provide, and this task pins with 2 integration tests): `src/utils/mcp-self-identity.js` exports `isAmicusMcpConfig(config: {command?: string, args?: string[], env?: object}) => boolean` — pure, synchronous, no I/O, returns true iff command+args resolve to an amicus MCP invocation (npx [-y] amicus[@tag] mcp; amicus|am|sidecar|claude-sidecar bin + 'mcp'; node <...bin/amicus.js> mcp), returns false (never throws) on malformed input. If Phase 1 exported a different name, adapt the ONE require site in legacy-mcp-migration.js plus the two integration tests.

Public signatures (new module; all sync, never throw, no console — src/ has eslint no-console:error):
- claudeCodeConfigPath() => string  // ~/.claude.json
- claudeDesktopConfigPath() => string  // darwin: ~/Library/Application Support/Claude/..., win32: %APPDATA%\Claude\..., else ~/.config/claude/... — MIRRORS postinstall registerClaudeDesktop (do NOT copy mcp-discovery.js:152-155, whose win32 path is wrong)
- inspectLegacySidecarEntry(configPath, deps={}) => {status:'absent'|'removable'|'customized'|'unreadable', config?}
- removeLegacySidecarEntry(configPath, deps={}) => 'absent'|'removed'|'customized'|'unreadable'|'write-failed'
- inspectAllLegacySidecarEntries(deps={}) => [{target,configPath,status,config?}] (Claude Code + Claude Desktop)
- migrateLegacySidecar(deps={}) => [{target,configPath,result}]
deps: {isAmicusMcpConfig?, codePath?, desktopPath?} — repo's dependency-injection idiom (mirrors cli-handlers-doctor realDeps override pattern).

INTERFACE PRODUCED for Task 4.3: `inspectAllLegacySidecarEntries()` and `migrateLegacySidecar()` exactly as above.

postinstall migrateLegacyMcp(): logs 'removed'/'customized'/'write-failed' outcomes, silent on 'absent'/'unreadable', try/catch so it can never throw out of postinstall (preserves the #29 always-exit-0 guard); injectable via deps.migrateLegacyMcp in main().

**Code:**

```js
// ===== src/utils/legacy-mcp-migration.js (complete, ~95 lines) =====
// src/utils/legacy-mcp-migration.js
'use strict';

/**
 * Legacy 'sidecar' MCP registration cleanup (Phase 4 tool de-bloat).
 *
 * Through v1.7.x scripts/postinstall.js registered the SAME stdio MCP server
 * under two names — 'amicus' and legacy 'sidecar' — in Claude Code
 * (~/.claude.json) and Claude Desktop/Cowork (claude_desktop_config.json).
 * Combined with the in-server sidecar_* tool aliases this quadrupled the
 * client-visible tool surface (13 real tools -> 52).
 *
 * This module removes a legacy 'sidecar' server entry, but ONLY when it is
 * identical-in-effect to the amicus registration: its command must resolve to
 * an amicus MCP invocation per isAmicusMcpConfig() (./mcp-self-identity,
 * Phase 1). A 'sidecar' entry pointing anywhere else is user customization
 * and is NEVER touched.
 *
 * Consumers: scripts/postinstall.js (one-shot migration on install/upgrade)
 * and src/cli-handlers-doctor.js (duplicate check + `doctor --fix`).
 * All functions are synchronous, never throw, and report via return values.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** ~/.claude.json — where BOTH Claude Code registration paths (CLI + file fallback) land. */
function claudeCodeConfigPath() {
  return path.join(os.homedir(), '.claude.json');
}

/** claude_desktop_config.json — platform-aware; mirrors postinstall registerClaudeDesktop. */
function claudeDesktopConfigPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
}

function defaultTargets(deps = {}) {
  return [
    { target: 'Claude Code', configPath: deps.codePath || claudeCodeConfigPath() },
    { target: 'Claude Desktop', configPath: deps.desktopPath || claudeDesktopConfigPath() },
  ];
}

/**
 * Inspect one config file for a legacy 'sidecar' MCP entry.
 * @returns {{status:'absent'|'removable'|'customized'|'unreadable', config?:object}}
 */
function inspectLegacySidecarEntry(configPath, deps = {}) {
  const isAmicus = deps.isAmicusMcpConfig
    || require('./mcp-self-identity').isAmicusMcpConfig;
  let parsed;
  try {
    if (!fs.existsSync(configPath)) { return { status: 'absent' }; }
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { status: 'unreadable' };
  }
  const entry = parsed && parsed.mcpServers ? parsed.mcpServers.sidecar : undefined;
  if (!entry) { return { status: 'absent' }; }
  return isAmicus(entry)
    ? { status: 'removable', config: entry }
    : { status: 'customized', config: entry };
}

/**
 * Remove the legacy 'sidecar' entry from one config file — ONLY when it is an
 * amicus self-invocation. Preserves every other key in the file.
 * @returns {'absent'|'removed'|'customized'|'unreadable'|'write-failed'}
 */
function removeLegacySidecarEntry(configPath, deps = {}) {
  const inspected = inspectLegacySidecarEntry(configPath, deps);
  if (inspected.status !== 'removable') { return inspected.status; }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    delete parsed.mcpServers.sidecar;
    // 0o600 is a no-op on NTFS; kept for parity with addMcpToConfigFile.
    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    return 'removed';
  } catch {
    return 'write-failed';
  }
}

/** Inspect every known registry (doctor check). */
function inspectAllLegacySidecarEntries(deps = {}) {
  return defaultTargets(deps).map((t) => ({ ...t, ...inspectLegacySidecarEntry(t.configPath, deps) }));
}

/** Remove identical-in-effect legacy entries everywhere. Idempotent. */
function migrateLegacySidecar(deps = {}) {
  return defaultTargets(deps).map((t) => ({ ...t, result: removeLegacySidecarEntry(t.configPath, deps) }));
}

module.exports = {
  claudeCodeConfigPath, claudeDesktopConfigPath,
  inspectLegacySidecarEntry, removeLegacySidecarEntry,
  inspectAllLegacySidecarEntries, migrateLegacySidecar,
};

// ===== scripts/postinstall.js edits =====
// (1) DELETE :125-134 — the whole block:
//     // DEPRECATED(amicus-shim): also register 'sidecar' ... try { execFileSync('claude', ['mcp','add-json','sidecar', ...]) } catch {}
//     (keep the `return;` that follows it)
// (2) DELETE :152-154 — the DEPRECATED comment + addMcpToConfigFile(claudeConfigPath, 'sidecar', MCP_CONFIG);
// (3) DELETE :178-180 — the DEPRECATED comment + addMcpToConfigFile(configPath, 'sidecar', MCP_CONFIG);
// (4) ADD after registerClaudeDesktop():

/**
 * One-shot migration: drop the duplicate legacy 'sidecar' MCP entry that
 * pre-1.8 postinstalls registered alongside 'amicus' (same server twice —
 * doubled the client-visible tool list). Only removes an entry whose command
 * is an amicus MCP invocation; a customized 'sidecar' entry is left alone.
 * Covers both files the three legacy registration paths wrote to:
 * ~/.claude.json (CLI + file fallback) and claude_desktop_config.json.
 * Never throws (postinstall must always exit 0).
 */
function migrateLegacyMcp(deps = {}) {
  try {
    const impl = deps.migrateLegacySidecar
      || require('../src/utils/legacy-mcp-migration').migrateLegacySidecar;
    for (const r of impl()) {
      if (r.result === 'removed') {
        console.log(`[amicus] Removed duplicate legacy 'sidecar' MCP entry from ${r.target} (same server — kept as 'amicus').`);
      } else if (r.result === 'customized') {
        console.log(`[amicus] Kept custom 'sidecar' MCP entry in ${r.target} (does not point at amicus).`);
      } else if (r.result === 'write-failed') {
        console.warn(`[amicus] Warning: could not remove the legacy 'sidecar' MCP entry from ${r.target} — run: amicus doctor --fix`);
      }
    }
  } catch (err) {
    console.warn(`[amicus] Warning: legacy MCP cleanup skipped: ${err && err.message}`);
  }
}

// (5) in main(): add dep + call (after _registerClaudeDesktop()):
//   const _migrateLegacyMcp = deps.migrateLegacyMcp || migrateLegacyMcp;
//   ...
//   _registerClaudeDesktop();
//   _migrateLegacyMcp(deps);
// (6) module.exports (:339) becomes:
// module.exports = { main, runCli, addMcpToConfigFile, installSkill, installCouncilSkill,
//   setupHooks, provisionElectron, registerClaudeCode, registerClaudeDesktop, migrateLegacyMcp, COUNCIL_FILES };
```

**Tests:**

```js
// ===== tests/legacy-mcp-migration.test.js (complete) =====
// Fixture pattern: os.tmpdir config files + the module's own deps injection
// (codePath/desktopPath), mirroring tests/postinstall.test.js. The final
// describe pins the CONSUMED Phase-1 interface with the REAL helper.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inspectLegacySidecarEntry, removeLegacySidecarEntry,
  inspectAllLegacySidecarEntries, migrateLegacySidecar,
} = require('../src/utils/legacy-mcp-migration');

const AMICUS_MCP = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] };  // postinstall.js:40 MCP_CONFIG
const CUSTOM_MCP = { command: 'npx', args: ['-y', 'some-other-mcp'] };

describe('legacy-mcp-migration', () => {
  let tmpDir; let codePath; let desktopPath;
  const writeConfig = (p, mcpServers) =>
    fs.writeFileSync(p, JSON.stringify({ mcpServers, otherKey: 'preserved' }, null, 2));
  const readConfig = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-mcp-'));
    codePath = path.join(tmpDir, '.claude.json');
    desktopPath = path.join(tmpDir, 'claude_desktop_config.json');
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('removes an identical-in-effect sidecar entry from BOTH ~/.claude.json and claude_desktop_config.json', () => {
    writeConfig(codePath, { amicus: AMICUS_MCP, sidecar: AMICUS_MCP });
    writeConfig(desktopPath, { amicus: AMICUS_MCP, sidecar: AMICUS_MCP });
    const results = migrateLegacySidecar({ codePath, desktopPath });
    expect(results).toEqual([
      expect.objectContaining({ target: 'Claude Code', result: 'removed' }),
      expect.objectContaining({ target: 'Claude Desktop', result: 'removed' }),
    ]);
    for (const p of [codePath, desktopPath]) {
      const cfg = readConfig(p);
      expect(cfg.mcpServers.sidecar).toBeUndefined();
      expect(cfg.mcpServers.amicus).toEqual(AMICUS_MCP); // the 'amicus' entry stays
      expect(cfg.otherKey).toBe('preserved');            // rest of the file untouched
    }
  });

  test('preserves a customized sidecar entry (not an amicus invocation)', () => {
    writeConfig(codePath, { amicus: AMICUS_MCP, sidecar: CUSTOM_MCP });
    const [code] = migrateLegacySidecar({ codePath, desktopPath });
    expect(code.result).toBe('customized');
    expect(readConfig(codePath).mcpServers.sidecar).toEqual(CUSTOM_MCP);
  });

  test('is idempotent — a second run reports absent and does not rewrite the files', () => {
    writeConfig(codePath, { amicus: AMICUS_MCP, sidecar: AMICUS_MCP });
    writeConfig(desktopPath, { amicus: AMICUS_MCP });
    migrateLegacySidecar({ codePath, desktopPath });
    const afterFirstRun = fs.readFileSync(codePath, 'utf-8');
    const second = migrateLegacySidecar({ codePath, desktopPath });
    expect(second.map((r) => r.result)).toEqual(['absent', 'absent']);
    expect(fs.readFileSync(codePath, 'utf-8')).toBe(afterFirstRun);
  });

  test('never throws on missing or corrupt config files', () => {
    // missing files
    expect(migrateLegacySidecar({ codePath, desktopPath }).map((r) => r.result))
      .toEqual(['absent', 'absent']);
    // corrupt JSON
    fs.writeFileSync(codePath, '{not json');
    expect(inspectLegacySidecarEntry(codePath)).toEqual({ status: 'unreadable' });
    expect(removeLegacySidecarEntry(codePath)).toBe('unreadable');
  });

  test('inspectAllLegacySidecarEntries reports per-target status for doctor', () => {
    writeConfig(codePath, { sidecar: AMICUS_MCP });
    writeConfig(desktopPath, { sidecar: CUSTOM_MCP });
    const entries = inspectAllLegacySidecarEntries({ codePath, desktopPath });
    expect(entries).toEqual([
      expect.objectContaining({ target: 'Claude Code', status: 'removable' }),
      expect.objectContaining({ target: 'Claude Desktop', status: 'customized' }),
    ]);
  });
});

// CONSUMED-INTERFACE TRIPWIRE (Phase 1 Task 1.2 contract): these two tests use
// the REAL src/utils/mcp-self-identity helper — no mock. If Phase 1 renamed or
// reshaped isAmicusMcpConfig, they fail HERE at the consumer, not deep inside a
// migration run on a user's machine.
describe('isAmicusMcpConfig contract (pinned Phase-1 interface)', () => {
  const { isAmicusMcpConfig } = require('../src/utils/mcp-self-identity');

  test('pure + sync: recognizes exactly the shipped postinstall entry, rejects others', () => {
    expect(typeof isAmicusMcpConfig).toBe('function');
    expect(isAmicusMcpConfig(AMICUS_MCP)).toBe(true);            // sync boolean, no Promise
    expect(isAmicusMcpConfig(CUSTOM_MCP)).toBe(false);
    expect(isAmicusMcpConfig({ command: 'amicus', args: ['doctor'] })).toBe(false); // no 'mcp' subcommand
  });

  test('never throws on garbage input — returns false', () => {
    const garbage = [null, undefined, 42, 'amicus mcp', [], {},
      { command: null }, { command: {}, args: 'mcp' }, { url: 'http://localhost:1234/sse' }];
    for (const g of garbage) {
      expect(() => { expect(isAmicusMcpConfig(g)).toBe(false); }).not.toThrow();
    }
  });
});

// ===== tests/postinstall-legacy-mcp.test.js (complete) =====
// Covers all three legacy registration paths: CLI add-json, ~/.claude.json file
// fallback, and Claude Desktop. child_process is mocked so the test can NEVER
// shell out to a real `claude` CLI (which would mutate the dev box's config);
// os.homedir + APPDATA are redirected to a tmp fixture because postinstall's
// registration fns resolve their paths at call time.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));
const { execFileSync } = require('child_process');

const { registerClaudeCode, registerClaudeDesktop } = require('../scripts/postinstall');

describe('postinstall no longer registers a legacy sidecar MCP server', () => {
  let tmpHome; let homedirSpy; let savedAppData;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-legacy-'));
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    savedAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmpHome, 'AppData', 'Roaming'); // win32 Desktop path
    // Default: no `claude` CLI available → registerClaudeCode uses the file fallback.
    execFileSync.mockReset();
    execFileSync.mockImplementation(() => { throw new Error('claude CLI unavailable in tests'); });
  });
  afterEach(() => {
    homedirSpy.mockRestore();
    if (savedAppData === undefined) { delete process.env.APPDATA; } else { process.env.APPDATA = savedAppData; }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const desktopConfigPath = () => {
    const dir = process.platform === 'darwin'
      ? path.join(tmpHome, 'Library', 'Application Support', 'Claude')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA, 'Claude')
        : path.join(tmpHome, '.config', 'claude');
    return path.join(dir, 'claude_desktop_config.json');
  };

  test('CLI path: add-json is invoked for amicus ONLY — never for sidecar', () => {
    execFileSync.mockImplementation(() => Buffer.from('')); // CLI "succeeds"
    registerClaudeCode();
    const registeredNames = execFileSync.mock.calls
      .filter(([cmd, args]) => cmd === 'claude' && args[1] === 'add-json')
      .map(([, args]) => args[2]);
    expect(registeredNames).toEqual(['amicus']); // exactly one registration, no shim
  });

  test('file-fallback path: ~/.claude.json gains amicus and NO sidecar entry', () => {
    registerClaudeCode(); // execFileSync throws → file fallback
    const config = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf-8'));
    expect(config.mcpServers.amicus).toEqual({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] });
    expect(config.mcpServers.sidecar).toBeUndefined();
  });

  test('Desktop path: claude_desktop_config.json gains amicus and NO sidecar entry', () => {
    registerClaudeDesktop();
    const config = JSON.parse(fs.readFileSync(desktopConfigPath(), 'utf-8'));
    expect(config.mcpServers.amicus).toBeDefined();
    expect(config.mcpServers.sidecar).toBeUndefined();
  });

  test('upgrade path: registration + migration leaves a pre-1.8 dupe machine with amicus only', () => {
    const { migrateLegacyMcp } = require('../scripts/postinstall');
    // Simulate a machine upgraded from v1.7.x (dupe in both configs).
    const codePath = path.join(tmpHome, '.claude.json');
    const dupe = { mcpServers: {
      amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] },
      sidecar: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] },
    } };
    fs.writeFileSync(codePath, JSON.stringify(dupe, null, 2));
    fs.mkdirSync(path.dirname(desktopConfigPath()), { recursive: true });
    fs.writeFileSync(desktopConfigPath(), JSON.stringify(dupe, null, 2));

    registerClaudeCode();
    registerClaudeDesktop();
    migrateLegacyMcp(); // paths resolve through the redirected homedir/APPDATA

    for (const p of [codePath, desktopConfigPath()]) {
      const config = JSON.parse(fs.readFileSync(p, 'utf-8'));
      expect(config.mcpServers.amicus).toBeDefined();
      expect(config.mcpServers.sidecar).toBeUndefined();
    }
  });
});

// Run: npx jest tests/legacy-mcp-migration.test.js tests/postinstall-legacy-mcp.test.js
// Failing-first: legacy-mcp-migration tests fail with 'Cannot find module'; the
// postinstall tests fail on current code because all three paths still register
// 'sidecar' (CLI test sees two add-json calls; file tests find a sidecar entry).
```

**Risks:** BLOCKING DEPENDENCY: requires src/utils/mcp-self-identity.js from Phase 1 Task B — serialize 4.1 after 1B; the two 'real helper' tests pin the consumed contract (if 1B exported a different name, adapt the single require + those 2 tests). SHARED FILES: scripts/postinstall.js is also a likely target of any Phase-1 registration/self-identity work — check the plan's other clusters before parallelizing; docs/SHIMS.md row 19 here vs row 17 in Task 4.2 (adjacent-line merge conflict — run 4.1 and 4.2 in one lane or rebase). PLATFORM: claudeDesktopConfigPath must use %APPDATA% on win32 (postinstall does; src/utils/mcp-discovery.js:152-155 discoverCoworkMcps does NOT — pre-existing bug, do not copy it); 0o600/0o700 are no-ops on NTFS (accepted existing pattern). ~/.claude.json is Claude Code's big state file — removal re-serializes it with JSON.stringify(...,null,2), same as the existing addMcpToConfigFile writer, so no new formatting risk. Plugin-channel installs set AMICUS_SKIP_POSTINSTALL=1 and skip the migration — Task 4.3's doctor --fix covers those users. GATES: new src/ module must pass eslint (no-console:error in src/ — module uses return values only; console OK in scripts/ and tests/) and the 300-line gate (module is ~95 lines; postinstall.js is exempt — CONFIG.include is src/**/*.js only); pre-commit also runs check-secrets + generate-docs (may auto-stage CLAUDE.md) + validate-docs. Existing tests tests/postinstall.test.js use 'sidecar' as a NAME arg to the generic addMcpToConfigFile — still pass, leave them.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 4.2 — Task 4.2 — sidecar_* tool aliases become opt-in behind AMICUS_LEGACY_ALIASES=1

**Files:** MODIFY: src/mcp-server.js — :888-900 (LEGACY_TOOL_ALIASES comment update + new legacyAliasesEnabled() helper after the map), :913/:928-929 (gate the alias register call inside startMcpServer), :944-947 (export legacyAliasesEnabled)
MODIFY: README.md:374 ('exposes ten tools' -> thirteen; add 3 missing table rows after :387), README.md:397 (alias blockquote -> opt-in wording)
MODIFY: docs/SHIMS.md:17 — MCP tool names row: 'sidecar_* tool aliases — opt-in via AMICUS_LEGACY_ALIASES=1 since v1.8.0'
MODIFY: tests/mcp-protocol.integration.test.js — the legacy-surface assertions (:141-153) break with aliases opt-in-off; spawn that suite's server with AMICUS_LEGACY_ALIASES=1 and add a default-env sibling test (see Design)
CREATE: tests/mcp-server-legacy-aliases.test.js
TEST RUN: npx jest tests/mcp-server-legacy-aliases.test.js

**Verified anchors:** LEGACY_TOOL_ALIASES confirmed at src/mcp-server.js:890-900 (13 entries; DEPRECATED comment :888-889); unconditional alias registration confirmed at :928-929 inside startMcpServer (:903-942); module.exports at :944-947 already exports LEGACY_TOOL_ALIASES. getTools() (src/mcp-tools.js) returns exactly 13 tools. getGuideText (src/mcp-tools.js:369-475) does NOT mention sidecar_* aliases — grep-verified, so per the brief's 'update if it mentions them' NO guide change is needed. README.md:374 says 'ten tools' with a 10-row table (:378-387) — amicus_council_tally/amicus_council_stats/amicus_verdict are missing; :397 documents the always-on aliases. mcp-server.js is grandfathered in scripts/check-file-sizes.js:27 (947 lines — net diff here is +~8 lines, fine). DECISION REQUIRED BY BRIEF, RESOLVED: a stdio MCP server CANNOT learn its client-side registration key — the MCP initialize handshake carries clientInfo (the client's name), never the config key the server was registered under, and both entries are launched with the identical `npx -y amicus@latest mcp` command line, so argv/env can't distinguish them either. Therefore NO auto-on when registered as 'sidecar'; the gate is env-only. Users who need the old names set "env": {"AMICUS_LEGACY_ALIASES": "1"} on their MCP entry. (Considered getCompatEnv('LEGACY_ALIASES') from src/utils/env-compat.js; rejected — that shim is for pre-rebrand vars and this flag is brand-new, so a SIDECAR_ fallback would be meaningless.)

**Design:** Read the flag once per startMcpServer() call (not at module load) so tests and long-lived processes see the env deterministically.

Signatures:
- legacyAliasesEnabled(env = process.env) => boolean  // exported for direct unit testing
- startMcpServer() unchanged signature; internally: const withLegacyAliases = legacyAliasesEnabled(); ... register(tool.name); if (withLegacyAliases && LEGACY_TOOL_ALIASES[tool.name]) { register(LEGACY_TOOL_ALIASES[tool.name]); }

Default tool surface becomes exactly the 13 amicus_* tools; with AMICUS_LEGACY_ALIASES=1 it is 26 (13 + 13 sidecar_* twins), matching pre-1.8 behavior. No handler changes — aliases still route to the same handlers[tool.name].

EXISTING-TEST IMPACT (tests/mcp-protocol.integration.test.js): the test 'lists all 9 amicus tools plus legacy sidecar aliases via tools/list' (:141-153) asserts every LEGACY_TOOLS name is present AND total count = EXPECTED + LEGACY — with aliases opt-in-off both assertions fail, and since integration suites only run under `npm run test:all` the break would otherwise first surface at Phase 7's preflight with no pointer back to this task. Fix it HERE: give createMcpClient an env parameter (`function createMcpClient(extraEnv = {})` → spawn env `{ ...process.env, ...extraEnv }`), spawn the existing legacy-surface describe's server with `{ AMICUS_LEGACY_ALIASES: '1' }` so it keeps validating the opt-in legacy surface end-to-end, and add a sibling default-env test (own client, no extra env) asserting tools/list returns ONLY amicus_* names: `expect(toolNames.every(n => n.startsWith('amicus_'))).toBe(true)` and `expect(toolNames.some(n => n.startsWith('sidecar_'))).toBe(false)`.

**Code:**

```js
// ===== src/mcp-server.js — replace :888-900 with =====
// DEPRECATED(amicus-shim): legacy sidecar_* twins of each amicus_* tool.
// OPT-IN since v1.8.0 — registering both names doubled the advertised tool
// surface (13 -> 26 per server). Set AMICUS_LEGACY_ALIASES=1 in the MCP
// entry's "env" to restore them. A stdio MCP server cannot learn the
// client-side registration key it was launched under (initialize carries
// clientInfo, not the config key), so an env flag is the only reliable
// switch. Remove entirely in the next major.
const LEGACY_TOOL_ALIASES = {
  amicus_start: 'sidecar_start', amicus_status: 'sidecar_status',
  amicus_read: 'sidecar_read', amicus_list: 'sidecar_list',
  amicus_resume: 'sidecar_resume', amicus_continue: 'sidecar_continue',
  amicus_setup: 'sidecar_setup', amicus_abort: 'sidecar_abort',
  amicus_fanout: 'sidecar_fanout',
  amicus_guide: 'sidecar_guide',
  amicus_council_tally: 'sidecar_council_tally',
  amicus_council_stats: 'sidecar_council_stats',
  amicus_verdict: 'sidecar_verdict',
};

/** sidecar_* tool aliases are opt-in as of v1.8.0. */
function legacyAliasesEnabled(env = process.env) {
  return env.AMICUS_LEGACY_ALIASES === '1';
}

// ===== inside startMcpServer(), after `const server = new McpServer(...)` (:911) add =====
  const withLegacyAliases = legacyAliasesEnabled();
// ===== and replace :928-929 =====
    register(tool.name);
    if (withLegacyAliases && LEGACY_TOOL_ALIASES[tool.name]) { register(LEGACY_TOOL_ALIASES[tool.name]); }

// ===== module.exports (:944-947) =====
module.exports = {
  handlers, startMcpServer, getProjectDir, resolveProjectDir, getClientRoot,
  LEGACY_TOOL_ALIASES, legacyAliasesEnabled,
};

// ===== README.md:374 =====
// 'It exposes ten tools:' -> 'It exposes thirteen tools:'
// after the amicus_fanout row (:387) add:
// | `amicus_council_tally` | Aggregate a council wave's reviews into a scored tally. |
// | `amicus_council_stats` | Reviewer-reliability stats from past council runs. |
// | `amicus_verdict` | Build the final council verdict from a tally + decisions. |
// ===== README.md:397 replace blockquote with =====
// > Legacy `sidecar_*` tool names are no longer registered by default (v1.8.0). To restore them, add `"env": {"AMICUS_LEGACY_ALIASES": "1"}` to the server entry. They will be removed entirely in the next major.
```

**Tests:**

```js
// ===== tests/mcp-server-legacy-aliases.test.js (complete) =====
// In-process registration test: mock the MCP SDK so registerTool calls are
// captured — no stdio transport, no handshake. Counts are DERIVED from
// getTools().length (never literal 13/26) so Phase 5's 14th tool (amicus_wait)
// does not break this suite.
'use strict';

// jest.mock factories may only reference out-of-scope vars named mock*.
const mockRegistered = [];
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn(() => ({
    registerTool: (name) => { mockRegistered.push(name); },
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(() => ({})),
}));

const { getTools } = require('../src/mcp-tools');
const { startMcpServer, legacyAliasesEnabled, LEGACY_TOOL_ALIASES } = require('../src/mcp-server');

const CANONICAL_COUNT = getTools().length; // single source of truth for counts

const sigBaseline = {};
beforeEach(() => {
  mockRegistered.length = 0;
  delete process.env.AMICUS_LEGACY_ALIASES;
  // startMcpServer installs SIGTERM/SIGINT listeners per call — snapshot so
  // afterEach can remove only the ones each test added (MaxListeners hygiene).
  for (const sig of ['SIGTERM', 'SIGINT']) { sigBaseline[sig] = process.listeners(sig); }
});
afterEach(() => {
  delete process.env.AMICUS_LEGACY_ALIASES;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    for (const l of process.listeners(sig)) {
      if (!sigBaseline[sig].includes(l)) { process.removeListener(sig, l); }
    }
  }
});

describe('legacyAliasesEnabled', () => {
  test('off by default; on only for the exact value "1"', () => {
    expect(legacyAliasesEnabled({})).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: '' })).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: 'true' })).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: '0' })).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: '1' })).toBe(true);
  });
});

describe('startMcpServer tool registration (Phase 4 de-bloat)', () => {
  test('default env: only amicus_* names — no sidecar_* twins', async () => {
    await startMcpServer();
    expect(mockRegistered.some((n) => n.startsWith('sidecar_'))).toBe(false);
    expect(mockRegistered.every((n) => n.startsWith('amicus_'))).toBe(true);
    expect(mockRegistered.length).toBe(CANONICAL_COUNT);
  });

  test('AMICUS_LEGACY_ALIASES=1: every canonical tool gains its sidecar_* twin (count doubles)', async () => {
    process.env.AMICUS_LEGACY_ALIASES = '1';
    await startMcpServer();
    expect(mockRegistered.length).toBe(CANONICAL_COUNT * 2);
    for (const tool of getTools()) {
      expect(mockRegistered).toContain(tool.name);
      expect(mockRegistered).toContain(LEGACY_TOOL_ALIASES[tool.name]);
    }
  });

  test('flag is read per startMcpServer call, not at module load', async () => {
    await startMcpServer();
    const defaultCount = mockRegistered.length;
    mockRegistered.length = 0;
    process.env.AMICUS_LEGACY_ALIASES = '1';
    await startMcpServer(); // same module instance, new env → aliases appear
    expect(mockRegistered.length).toBe(defaultCount * 2);
  });
});

// Run: npx jest tests/mcp-server-legacy-aliases.test.js
// Failing-first: on current code the default-env test fails (sidecar_* twins
// registered unconditionally) and legacyAliasesEnabled does not exist.
// ALSO EDIT tests/mcp-protocol.integration.test.js per Design: env-parameterize
// createMcpClient, spawn the legacy-surface describe with AMICUS_LEGACY_ALIASES=1,
// and add the default-env only-amicus_* sibling test.
```

**Risks:** SERIALIZATION: src/mcp-server.js is the historical serialization hub — if any other in-flight phase touches it (Phase 3 Task 3.3's amicus_abort rewrite does), put this task in the same lane. INTEGRATION-SUITE TRAP: tests/mcp-protocol.integration.test.js only runs under `npm run test:all` — if its legacy-surface assertions are not updated in THIS task (see Design), the failure surfaces for the first time at Phase 7's test:all preflight with no pointer back to this change. The diff here is small and confined to :888-930 + exports. mcp-server.js is grandfathered in the size gate so +8 lines is fine, but do not use this task to grow it further. BEHAVIOR BREAK (document in CHANGELOG as completing a deprecation): agent scripts and saved Claude Code permission allowlists referencing mcp__amicus__sidecar_* stop resolving unless the user opts in — the opt-in must be documented in README (done here) and the v1.8.0 notes. amicus_guide text verified alias-free — no change (brief conditional satisfied). Module-load side effect: requiring src/mcp-server constructs SharedServerManager — already done by every existing mcp-server test, safe. Test hygiene: startMcpServer installs SIGTERM/SIGINT listeners per call — the harness removes the ones it added (avoids MaxListeners warnings across the 4 calls). GATES: eslint on staged src/ (curly:all — the gated register line keeps braces), CLAUDE.md regen may auto-stage during commit.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 4.3 — Task 4.3 — doctor: duplicate 'sidecar' registration check + `doctor --fix` cleanup

**Files:** MODIFY: src/utils/remediation-hints.js — add `removeLegacySidecar` hint inside the frozen object (insert before the closing `});` at :67)
MODIFY: src/cli-handlers-doctor.js — realDeps() (:12-50): add inspectLegacyMcpEntries + migrateLegacyMcpEntries; insert new 'mcp-legacy' check immediately after the existing 'mcp' check (after :182, before the openrouter-credit check at :184)
MODIFY: tests/cli-handlers-doctor.test.js:6-23 — extend the allGood deps object with the two new fns (all-absent stub)
CREATE: tests/doctor-legacy-mcp.test.js
TEST RUN: npx jest tests/doctor-legacy-mcp.test.js tests/cli-handlers-doctor.test.js tests/doctor-fix.test.js

**Verified anchors:** Doctor MCP check confirmed at src/cli-handlers-doctor.js:171-182 — checks only `code.amicus` / `cowork.amicus`; it can NEVER see a sidecar dupe because discoverClaudeCodeMcps (src/utils/mcp-discovery.js:74,81,140) unconditionally `delete merged.sidecar` before returning (recursion guard) — hence the new check must read the raw config files via the Task-4.1 module, not mcp-discovery. remediation-hints.js pattern read (:15-67): frozen object, JSDoc per hint, consumed via HINTS.<name>; doctor --fix plumbing confirmed (fix dep at :41, handleDoctor forwards at :238; guard() sync wrapper at :53-56). cli-handlers-doctor.js is 250 lines and IS under the 300-line gate (NOT grandfathered) — the +~28-line addition lands ~278, still under, but detection logic must stay in the Task-4.1 module to keep it that way. tests/cli-handlers-doctor.test.js allGood (:6-23) fills missing deps from realDeps() — without stubbing the new deps, the 'all healthy' test would read the OWNER'S real ~/.claude.json (which has the live sidecar dupe, verified today) and go red: the allGood edit is mandatory, not optional.

**Design:** New check id 'mcp-legacy', name 'Legacy sidecar MCP entry', inserted right after the 'mcp' check so the two MCP lines render adjacently. Semantics:
- no sidecar entry anywhere -> ok ('none')
- sidecar entry that is NOT an amicus invocation -> ok, message notes it was left alone (user customization is not a problem to fix)
- identical-in-effect duplicate -> warn naming the config(s), hint = HINTS.removeLegacySidecar
- with d.fix -> call the migration; all dupes removed -> ok 'removed duplicate from <targets>'; partial/failed -> warn (no false success, mirroring the electron --fix contract at :141-160)
- bare doctor NEVER calls the migration (side-effect-free, mirroring doctor-fix.test.js:35-42)

Consumed interface (produced by Task 4.1, src/utils/legacy-mcp-migration.js):
- inspectAllLegacySidecarEntries() => [{target:'Claude Code'|'Claude Desktop', configPath, status:'absent'|'removable'|'customized'|'unreadable', config?}]
- migrateLegacySidecar() => [{target, configPath, result:'absent'|'removed'|'customized'|'unreadable'|'write-failed'}]
Injected via realDeps as inspectLegacyMcpEntries / migrateLegacyMcpEntries (lazy require, matching every other realDeps entry).

New hint (frozen, copy-paste contract): removeLegacySidecar — points at `amicus doctor --fix` and explains it removes the duplicate 'sidecar' entry while the 'amicus' entry stays.

**Code:**

```js
// ===== src/utils/remediation-hints.js — add before the closing `});` (:67) =====
  /**
   * Duplicate legacy 'sidecar' MCP registration (Phase 4 de-bloat): pre-1.8
   * postinstalls registered the same server twice. `doctor --fix` removes the
   * twin only when it points at amicus; a customized entry is never touched.
   */
  removeLegacySidecar:
    "amicus doctor --fix  (removes the duplicate legacy 'sidecar' MCP entry — same server registered twice; the 'amicus' entry stays)",

// ===== src/cli-handlers-doctor.js — realDeps() additions (after :43 discoverCoworkMcps) =====
    inspectLegacyMcpEntries: () => require('./utils/legacy-mcp-migration').inspectAllLegacySidecarEntries(),
    migrateLegacyMcpEntries: () => require('./utils/legacy-mcp-migration').migrateLegacySidecar(),

// ===== src/cli-handlers-doctor.js — insert after the 'mcp' check block (:182) =====
  // Duplicate legacy 'sidecar' MCP registration (same server twice — doubles
  // the client-visible tool list). Detection reads the raw config files via
  // legacy-mcp-migration: mcp-discovery can't see it (it strips 'sidecar' as
  // its own recursion guard). --fix removes only identical-in-effect twins.
  checks.push(guard('mcp-legacy', 'Legacy sidecar MCP entry', () => {
    const id = 'mcp-legacy'; const name = 'Legacy sidecar MCP entry';
    const entries = d.inspectLegacyMcpEntries() || [];
    const dupes = entries.filter(e => e.status === 'removable');
    const custom = entries.filter(e => e.status === 'customized');
    if (dupes.length === 0) {
      const message = custom.length
        ? `custom 'sidecar' entry in ${custom.map(e => e.target).join(', ')} — left alone`
        : 'none';
      return { id, name, status: 'ok', message, hint: null };
    }
    if (d.fix) {
      const removed = (d.migrateLegacyMcpEntries() || []).filter(r => r.result === 'removed');
      return removed.length >= dupes.length
        ? { id, name, status: 'ok', message: `removed duplicate from ${removed.map(r => r.target).join(', ')}`, hint: null }
        : { id, name, status: 'warn', message: `removed ${removed.length}/${dupes.length} duplicate(s) — could not update every config`, hint: HINTS.removeLegacySidecar };
    }
    return { id, name, status: 'warn', message: `duplicate 'sidecar' entry in ${dupes.map(e => e.target).join(', ')} — doubles the MCP tool list`, hint: HINTS.removeLegacySidecar };
  }));

// ===== tests/cli-handlers-doctor.test.js — extend allGood (:6-23) with =====
  inspectLegacyMcpEntries: () => [
    { target: 'Claude Code', status: 'absent' },
    { target: 'Claude Desktop', status: 'absent' },
  ],
  migrateLegacyMcpEntries: () => [],
```

**Tests:**

```js
// ===== tests/doctor-legacy-mcp.test.js (complete) =====
// Partial-deps pattern from tests/doctor-fix.test.js: unlisted deps inherit
// realDeps; inspectLegacyMcpEntries/migrateLegacyMcpEntries are injected so no
// test reads or writes a real ~/.claude.json. base.readApiKeyValues keeps the
// OpenRouter credit probe offline.
'use strict';
const doctor = require('../src/cli-handlers-doctor');
const HINTS = require('../src/utils/remediation-hints');

const findCheck = (checks, id) => checks.find((c) => c.id === id);
const base = { readApiKeyValues: () => ({}) }; // offline credit probe

const AMICUS_MCP = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] };

describe("doctor 'mcp-legacy' duplicate sidecar check (Task 4.3)", () => {
  test('no sidecar entry anywhere → ok "none"', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'absent' },
        { target: 'Claude Desktop', status: 'absent' },
      ],
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.status).toBe('ok');
    expect(c.message).toBe('none');
  });

  test('identical-in-effect duplicate → WARN naming the config, with the removeLegacySidecar hint', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'removable', config: AMICUS_MCP },
        { target: 'Claude Desktop', status: 'absent' },
      ],
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.status).toBe('warn');
    expect(c.message).toContain('Claude Code');
    expect(c.hint).toBe(HINTS.removeLegacySidecar);
  });

  test('bare doctor NEVER calls the migration (side-effect-free, doctor-fix.test.js contract)', async () => {
    const migrateLegacyMcpEntries = jest.fn();
    await doctor.runDoctorChecks({ ...base,
      inspectLegacyMcpEntries: () => [{ target: 'Claude Code', status: 'removable', config: AMICUS_MCP }],
      migrateLegacyMcpEntries,
    });
    expect(migrateLegacyMcpEntries).not.toHaveBeenCalled();
  });

  test('doctor --fix removes the dupe via the 4.1 migration fn → ok', async () => {
    const migrateLegacyMcpEntries = jest.fn(() => [
      { target: 'Claude Code', result: 'removed' },
      { target: 'Claude Desktop', result: 'absent' },
    ]);
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'removable', config: AMICUS_MCP },
        { target: 'Claude Desktop', status: 'absent' },
      ],
      migrateLegacyMcpEntries,
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(migrateLegacyMcpEntries).toHaveBeenCalledTimes(1);
    expect(c.status).toBe('ok');
    expect(c.message).toContain('removed duplicate from Claude Code');
  });

  test('doctor --fix partial failure → WARN, no false success (electron --fix contract)', async () => {
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'removable', config: AMICUS_MCP },
        { target: 'Claude Desktop', status: 'removable', config: AMICUS_MCP },
      ],
      migrateLegacyMcpEntries: () => [
        { target: 'Claude Code', result: 'removed' },
        { target: 'Claude Desktop', result: 'write-failed' },
      ],
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/removed 1\/2/);
    expect(c.hint).toBe(HINTS.removeLegacySidecar);
  });

  test('customized sidecar entry is untouched → ok with a left-alone note (never the dupe hint), even with --fix', async () => {
    const migrateLegacyMcpEntries = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'customized', config: { command: 'uvx', args: ['my-own-server'] } },
        { target: 'Claude Desktop', status: 'absent' },
      ],
      migrateLegacyMcpEntries,
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.status).toBe('ok');
    expect(c.message).toContain('left alone');
    expect(c.hint).toBeNull();
    expect(migrateLegacyMcpEntries).not.toHaveBeenCalled(); // customization is not a problem to fix
  });

  test('a throwing inspect dep degrades via guard() — never throws out of doctor', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      inspectLegacyMcpEntries: () => { throw new Error('boom'); },
    });
    expect(findCheck(checks, 'mcp-legacy').status).toBe('error');
  });
});

// Run: npx jest tests/doctor-legacy-mcp.test.js tests/cli-handlers-doctor.test.js tests/doctor-fix.test.js
// Failing-first: 'mcp-legacy' check does not exist → findCheck returns undefined.
// REMEMBER the mandatory allGood edit in tests/cli-handlers-doctor.test.js (see
// Code) — without it the 'all healthy' test reads the machine's real config.
```

**Risks:** DEPENDS ON Task 4.1 (consumes inspectAllLegacySidecarEntries/migrateLegacySidecar) — strictly after 4.1 in the same lane. SIZE GATE: src/cli-handlers-doctor.js is NOT grandfathered (250 -> ~278 lines) — if review adds anything else to this file it breaches 300; keep all detection/removal logic in the Task-4.1 module. MANDATORY TEST EDIT: without the allGood additions in tests/cli-handlers-doctor.test.js, realDeps() reads the machine's real ~/.claude.json — on the owner's box (live dupe verified today) the existing 'all healthy -> every check ok' test goes red; this is a real-machine-state leak the injected stubs prevent. Partial-deps doctor tests inherit realDeps for unlisted deps (established doctor-fix.test.js pattern) — the `base.readApiKeyValues` stub keeps the OpenRouter credit probe offline. renderHuman and buildDoctorDoc (src/utils/result-schema.js:269-278) are generic over check ids — no schema change; warn keeps exit code 0 (only 'error' exits 1), which is correct for a cleanup nudge. eslint quotes rule is ['single', {avoidEscape:true}] — the double-quoted hint string (contains apostrophes) is legal. Windows: doctor --fix rewrites ~/.claude.json while Claude Code may hold it open — writeFileSync replaces content in place (no rename), same exposure as the existing postinstall writer; acceptable. Pre-existing, out-of-scope: discoverCoworkMcps' win32 path bug (mcp-discovery.js:152-155) makes the EXISTING 'mcp' check's Cowork bonus signal wrong on Windows — do not fix here, flag for the plan author.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

---
## Phase 5 — `amicus_wait` blocking MCP tool (opp-3)

**Scope:** one MCP call that blocks until a session/wave reaches a terminal state or a timeout, replacing the sleep-25/status polling ritual. Grounded defaults from the bundled @modelcontextprotocol/sdk: client `DEFAULT_REQUEST_TIMEOUT_MSEC` = 60000 (protocol.js:12) and Claude Code may or may not raise it via `MCP_TOOL_TIMEOUT` — so `amicus_wait` defaults to **50s** and hard-caps at **110s**, env-overridable, and returns `{timedOut:true}` (never an MCP error) so agents simply re-call.

**Lane order:** P5-1 (new wait engine module — no mcp-server edits) → P5-2 (register the tool in `src/mcp-server.js`/`src/mcp-tools.js` — hub edit, serialize). Note: `tests/mcp-tool-aliases.test.js` enforces every canonical tool has a `sidecar_*` alias (add `sidecar_wait` — after Phase 4 the alias registers only under `AMICUS_LEGACY_ALIASES=1`; the alias TABLE still needs the entry) and `tests/mcp-tools.test.js` pins the tool count (bump 13 → 14). NOTE: src/mcp-server.js line anchors in this phase are pre-Phase-3 (HEAD@509ab83) numbers — the file grows as phases 3/4/5 land; locate edit sites by the quoted code, not line numbers.

**Design fact:** there is NO existing taskId→promise map in the server (`SharedServerManager._sessionWatchdogs` is keyed by OpenCode sessionId) — P5-1 creates the in-process run registry; sessions not held in-process (spawn-path CLI children, other-process sessions) fall back to polling metadata.json every 2s inside the tool. `TERMINAL_STATUSES` in `utils/result-schema.js:15` omits 'timed-out', so the wait loop treats any status other than running/unknown as terminal rather than allowlisting.


### Task 5.1 — P5-1: mcp-wait engine — in-process run registry + runWait loop (new module, no mcp-server edits)

**Files:** Create: src/mcp-wait.js
Create: tests/mcp-wait.test.js
Modify: (none)
Test: npx jest tests/mcp-wait.test.js

**Verified anchors:** Re-verified today at 509ab83: mcp-server.js:293-408 shared-server path holds the runHeadless promise only as an anonymous fire-and-forget .then/.catch chain (:363-392) — no taskId→promise map exists anywhere (grepped). SharedServerManager tracks sessions by OpenCode sessionId, not taskId (src/utils/shared-server.js:37,110-142). amicus_status payload shape verified at mcp-server.js:503-518 (wave: taskId/type/status/legsComplete/legsTotal/legs/elapsed/version) and :532-560 (single: taskId/status/elapsed/version/+progress fields/next_poll). TERMINAL_STATUSES verified at src/utils/result-schema.js:15 = ['complete','error','timeout','aborted','crashed','idle-timeout'] — note it OMITS 'timed-out' (the canonical single-session value written by src/sidecar/session-finalize.js:21), which is why isTerminalSnapshot uses status!=='running' rather than an allowlist. MCP SDK client default timeout verified: node_modules/@modelcontextprotocol/sdk/dist/cjs/shared/protocol.js:12 DEFAULT_REQUEST_TIMEOUT_MSEC = 60000.

**Design:** New self-contained module consumed by P5-2. Interface produced:
- registerInProcessRun(taskId: string): void — creates a never-rejecting deferred in a module Map.
- settleInProcessRun(taskId: string): void — resolves + deletes; no-op for unknown/double calls.
- hasInProcessRun(taskId): boolean (test hook).
- runWait(input: {taskId?, waveId?, timeoutMs?, project?}, project: string, deps: {statusFn, sleep?, now?, pollIntervalMs?}): Promise<McpResult> — statusFn(input, project) is the amicus_status handler injected by mcp-server (avoids a circular require). Loop: statusFn → parse content[0].text → terminal? return payload+{timedOut:false, waitedMs} → deadline passed? return payload+{timedOut:true, waitedMs, hint} → else await race(inProcessWaiter?.promise, sleep(min(pollInterval, remaining))) and repeat. The waiter only ACCELERATES the wake; the sleep arm keeps the loop live for evicted/never-settled runs, so the idle-eviction edge case (metadata flips 'idle-timeout' without a settle) is covered by the next poll. Waves need no registry (fanout is spawn-path only): terminal = status!=='running'/'unknown' OR legsComplete>=legsTotal>0 (the 'all legs terminal while aggregator still writing wave.json' state the review asked for). next_poll (the sleep-25 protocol) is stripped from the returned body — amicus_wait replaces it. Constants: DEFAULT_WAIT_MS=50000 (AMICUS_WAIT_DEFAULT_MS), MAX_WAIT_MS=110000 (AMICUS_WAIT_MAX_MS), MIN 1000, WAIT_POLL_INTERVAL_MS=2000 (AMICUS_WAIT_POLL_INTERVAL_MS). sleep uses an unref'd timer so a pending wait never holds the MCP process open.

**Code:**

```js
// src/mcp-wait.js  (~115 lines, under the 300-line gate)
'use strict';

/**
 * @module mcp-wait
 * Engine for the amicus_wait MCP tool: block (inside one tool call) until a
 * session/wave reaches a terminal state or the wait window closes.
 *
 * Two wake sources, one loop:
 *  - disk polling of amicus_status (spawn-path CLI children, other-process
 *    sessions, waves), and
 *  - an in-process run registry: shared-server runs owned by THIS MCP process
 *    settle their waiter the moment finalizeHeadlessResult lands, waking the
 *    loop immediately instead of at the next poll tick.
 *
 * Client-timeout budget: the MCP TS SDK's default request timeout is 60s
 * (DEFAULT_REQUEST_TIMEOUT_MSEC in @modelcontextprotocol/sdk shared/protocol).
 * Claude Code can raise it via MCP_TOOL_TIMEOUT but we cannot assume it did,
 * so the DEFAULT wait returns {timedOut:true} at 50s — before a 60s client
 * kill — and the hard cap is 110s for clients with ~2min budgets.
 */

const { versionWarning } = require('./utils/version-info');

const DEFAULT_WAIT_MS = Number(process.env.AMICUS_WAIT_DEFAULT_MS) || 50000;
const MAX_WAIT_MS = Number(process.env.AMICUS_WAIT_MAX_MS) || 110000;
const MIN_WAIT_MS = 1000;
const WAIT_POLL_INTERVAL_MS = Number(process.env.AMICUS_WAIT_POLL_INTERVAL_MS) || 2000;

/** taskId -> {promise, resolve} for runs owned by this process. */
const _inProcessRuns = new Map();

/** Register a deferred for a run this process owns (shared-server path). */
function registerInProcessRun(taskId) {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  _inProcessRuns.set(taskId, { promise, resolve });
}

/** Settle (and forget) a run's waiter. Safe for unknown ids / double calls. */
function settleInProcessRun(taskId) {
  const w = _inProcessRuns.get(taskId);
  if (w) { _inProcessRuns.delete(taskId); w.resolve(); }
}

/** @returns {boolean} test hook */
function hasInProcessRun(taskId) { return _inProcessRuns.has(taskId); }

/** Clamp a requested timeout into [MIN, MAX]; default when absent/invalid. */
function clampTimeout(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) { return Math.min(DEFAULT_WAIT_MS, MAX_WAIT_MS); }
  return Math.max(MIN_WAIT_MS, Math.min(n, MAX_WAIT_MS));
}

/** unref'd sleep so a pending wait never holds the MCP process open. */
function defaultSleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) { t.unref(); }
  });
}

/** Parse the JSON payload out of an amicus_status result, or null. */
function parseStatusPayload(statusResult) {
  try { return JSON.parse(statusResult.content[0].text); } catch { return null; }
}

/**
 * Terminal check over a parsed amicus_status payload. Any status other than
 * running/unknown is terminal (TERMINAL_STATUSES omits 'timed-out', so an
 * allowlist would miss the canonical single-session timeout status). Waves:
 * terminal status wins; while the wave record still says 'running',
 * all-legs-terminal also counts (aggregator may still be writing wave.json,
 * but every leg has ended — the caller can read the legs).
 */
function isTerminalSnapshot(s) {
  const statusTerminal = !!s.status && s.status !== 'running' && s.status !== 'unknown';
  if (s.type === 'wave') {
    return statusTerminal
      || (Number.isFinite(s.legsTotal) && s.legsTotal > 0 && s.legsComplete >= s.legsTotal);
  }
  return statusTerminal;
}

/** Build the amicus_wait MCP result: status payload + {timedOut, waitedMs}. */
function buildWaitResult(snapshot, timedOut, waitedMs) {
  const body = { ...snapshot, timedOut, waitedMs };
  delete body.next_poll; // amicus_wait replaces the sleep-25 polling protocol
  if (timedOut) {
    body.hint = 'Run still in progress when the wait window closed. Call amicus_wait again to continue waiting.';
  }
  const content = [{ type: 'text', text: JSON.stringify(body) }];
  const warn = versionWarning();
  if (warn) { content.push({ type: 'text', text: warn }); }
  return { content };
}

/**
 * Wait for a session/wave to reach a terminal state, or time out.
 * @param {{taskId?:string, waveId?:string, timeoutMs?:number, project?:string}} input
 * @param {string} project resolved project dir
 * @param {{statusFn:Function, sleep?:Function, now?:Function, pollIntervalMs?:number}} deps
 *   statusFn(input, project) must be the amicus_status handler (or compatible).
 * @returns {Promise<object>} MCP tool result
 */
async function runWait(input, project, deps) {
  const { statusFn } = deps;
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || Date.now;
  const pollIntervalMs = deps.pollIntervalMs || WAIT_POLL_INTERVAL_MS;

  const taskId = input.taskId || input.waveId;
  if (!taskId) {
    return { isError: true, content: [{ type: 'text', text: "amicus_wait requires 'taskId' (or 'waveId')." }] };
  }

  const timeoutMs = clampTimeout(input.timeoutMs);
  const started = now();
  const deadline = started + timeoutMs;

  for (;;) {
    const statusResult = await statusFn({ taskId, project: input.project }, project);
    if (statusResult.isError) { return statusResult; } // e.g. session not found
    const snapshot = parseStatusPayload(statusResult);
    if (!snapshot) {
      return { isError: true, content: [{ type: 'text', text: `amicus_wait: unparseable status for ${taskId}.` }] };
    }
    if (isTerminalSnapshot(snapshot)) { return buildWaitResult(snapshot, false, now() - started); }
    const remaining = deadline - now();
    if (remaining <= 0) { return buildWaitResult(snapshot, true, now() - started); }
    const delay = Math.min(pollIntervalMs, remaining);
    const waiter = _inProcessRuns.get(taskId);
    // The waiter only ACCELERATES the wake — the sleep arm keeps the loop live
    // for evicted/never-settled runs (disk polling stays authoritative).
    await (waiter ? Promise.race([waiter.promise, sleep(delay)]) : sleep(delay));
  }
}

module.exports = {
  runWait, registerInProcessRun, settleInProcessRun, hasInProcessRun,
  clampTimeout, isTerminalSnapshot, parseStatusPayload, buildWaitResult,
  DEFAULT_WAIT_MS, MAX_WAIT_MS, WAIT_POLL_INTERVAL_MS,
};
```

**Tests:**

```js
// tests/mcp-wait.test.js — write FIRST; fails with MODULE_NOT_FOUND until src/mcp-wait.js exists.
// Run: npx jest tests/mcp-wait.test.js
'use strict';

const {
  runWait, registerInProcessRun, settleInProcessRun, hasInProcessRun,
  clampTimeout, isTerminalSnapshot, DEFAULT_WAIT_MS, MAX_WAIT_MS,
} = require('../src/mcp-wait');

/** Wrap a payload the way amicus_status does. */
const statusResult = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });

describe('clampTimeout', () => {
  test('defaults when absent, floors at 1s, caps at MAX_WAIT_MS', () => {
    expect(clampTimeout(undefined)).toBe(DEFAULT_WAIT_MS);
    expect(clampTimeout(1)).toBe(1000);
    expect(clampTimeout(99999999)).toBe(MAX_WAIT_MS);
    expect(clampTimeout(5000)).toBe(5000);
  });
});

describe('isTerminalSnapshot', () => {
  test('single: running/unknown not terminal; complete/error/timed-out are', () => {
    expect(isTerminalSnapshot({ status: 'running' })).toBe(false);
    expect(isTerminalSnapshot({ status: 'unknown' })).toBe(false);
    expect(isTerminalSnapshot({ status: 'complete' })).toBe(true);
    expect(isTerminalSnapshot({ status: 'timed-out' })).toBe(true); // NOT in TERMINAL_STATUSES — the allowlist trap
    expect(isTerminalSnapshot({ status: 'crashed' })).toBe(true);
  });
  test('wave: all legs terminal counts even while status says running', () => {
    expect(isTerminalSnapshot({ type: 'wave', status: 'running', legsComplete: 1, legsTotal: 3 })).toBe(false);
    expect(isTerminalSnapshot({ type: 'wave', status: 'running', legsComplete: 3, legsTotal: 3 })).toBe(true);
    expect(isTerminalSnapshot({ type: 'wave', status: 'partial', legsComplete: 2, legsTotal: 3 })).toBe(true);
  });
});

describe('runWait', () => {
  const fastSleep = () => Promise.resolve();

  test('returns immediately with timedOut:false when already terminal', async () => {
    const statusFn = jest.fn().mockResolvedValue(statusResult({ taskId: 't1', status: 'complete', elapsed: '1m 0s' }));
    const res = await runWait({ taskId: 't1' }, '/proj', { statusFn, sleep: fastSleep });
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(statusFn).toHaveBeenCalledTimes(1);
  });

  test('poll fallback: resolves when a later poll turns terminal', async () => {
    const seq = [
      statusResult({ taskId: 't1', status: 'running' }),
      statusResult({ taskId: 't1', status: 'running' }),
      statusResult({ taskId: 't1', status: 'complete' }),
    ];
    const statusFn = jest.fn(() => Promise.resolve(seq.shift()));
    const res = await runWait({ taskId: 't1', timeoutMs: 60000 }, '/proj', { statusFn, sleep: fastSleep });
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(statusFn).toHaveBeenCalledTimes(3);
  });

  test('returns {timedOut:true}+hint and strips next_poll at the deadline', async () => {
    const statusFn = jest.fn().mockResolvedValue(statusResult({
      taskId: 't1', status: 'running', next_poll: { hint: 'sleep 25' },
    }));
    let t = 0;
    const now = jest.fn(() => { t += 3000; return t; }); // each now() advances 3s → deadline crossed on 2nd loop
    const res = await runWait({ taskId: 't1', timeoutMs: 5000 }, '/proj', { statusFn, sleep: fastSleep, now });
    const body = JSON.parse(res.content[0].text);
    expect(body.timedOut).toBe(true);
    expect(body.status).toBe('running');
    expect(body.next_poll).toBeUndefined();
    expect(body.hint).toMatch(/amicus_wait again/);
  });

  test('wave: all-legs-terminal ends the wait while wave still says running', async () => {
    const statusFn = jest.fn().mockResolvedValue(statusResult({
      taskId: 'w1', type: 'wave', status: 'running', legsComplete: 2, legsTotal: 2, legs: [],
    }));
    const res = await runWait({ waveId: 'w1' }, '/proj', { statusFn, sleep: fastSleep });
    const body = JSON.parse(res.content[0].text);
    expect(body.timedOut).toBe(false);
    expect(statusFn).toHaveBeenCalledTimes(1);
  });

  test('in-process settle wakes the loop when the sleep arm never fires', async () => {
    registerInProcessRun('t-inproc');
    expect(hasInProcessRun('t-inproc')).toBe(true);
    const neverSleep = () => new Promise(() => {}); // ONLY the waiter can wake the loop
    let payload = { taskId: 't-inproc', status: 'running' };
    const statusFn = jest.fn(() => Promise.resolve(statusResult(payload)));
    const p = runWait({ taskId: 't-inproc', timeoutMs: 60000 }, '/proj', { statusFn, sleep: neverSleep });
    await new Promise((r) => setImmediate(r)); // let the first poll reach the race
    payload = { taskId: 't-inproc', status: 'complete' };
    settleInProcessRun('t-inproc'); // finalize landed → waiter resolves
    const body = JSON.parse((await p).content[0].text);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(hasInProcessRun('t-inproc')).toBe(false);
  });

  test('propagates a not-found status error unchanged', async () => {
    const err = { isError: true, content: [{ type: 'text', text: 'Session nope not found' }] };
    const statusFn = jest.fn().mockResolvedValue(err);
    const res = await runWait({ taskId: 'nope' }, '/proj', { statusFn, sleep: fastSleep });
    expect(res.isError).toBe(true);
  });

  test('errors when neither taskId nor waveId is provided', async () => {
    const res = await runWait({}, '/proj', { statusFn: jest.fn(), sleep: fastSleep });
    expect(res.isError).toBe(true);
  });
});
// Expected: all fail (module missing) → all pass after implementation.
```

**Risks:** No shared files with other tasks (pure new module) — safe first task of the cluster. The never-rejecting deferred is load-bearing: if settle ever rejects, Promise.race would throw inside runWait; keep resolve-only. Registry is process-local by design (MCP server process); a second MCP server process for the same project just uses the poll fallback. New src file → pre-commit generate-docs.js will regenerate CLAUDE.md AUTO markers and auto-stage it (expected, don't fight it). Keep file <300 lines (it's ~145): no grandfather entry needed.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 5.2 — P5-2: register amicus_wait — Zod schema, handler, in-process registry hookup, legacy alias, guide text

**Files:** Modify: src/mcp-tools.js:132 (insert tool def after the amicus_status entry), src/mcp-tools.js:395-403 (guide: headless workflow lines)
Modify: src/mcp-server.js:18 (import), :361-363 (register before runHeadless), :379 (.then settle), :391 (.catch settle), :403-406 (fallback-catch settle), :567 (new handler after amicus_status), :890-900 (LEGACY_TOOL_ALIASES)
Modify: tests/mcp-tools.test.js:41-43 (tool count 13→14; add amicus_wait to required-names)
Create: tests/mcp-wait-handler.test.js
Test: npx jest tests/mcp-wait-handler.test.js tests/mcp-tools.test.js tests/mcp-tool-aliases.test.js tests/mcp-server-legacy-aliases.test.js

**Verified anchors:** Re-verified today: mcp-server.js:363-369 is the exact runHeadless(...) fire-and-forget call; :369-392 the .then/.catch chain (finalizeHeadlessResult at :375, error-metadata write at :383-390); :400-407 the shared→spawn fallback catch (removeSession at :404); :888-900 LEGACY_TOOL_ALIASES map; :913-930 the register loop that auto-registers aliases. mcp-tools.js:116-132 amicus_status tool entry (insertion point). tests/mcp-tool-aliases.test.js:17-23 enforces every canonical tool has a sidecar_* alias (this suite FAILS if the alias is forgotten — built-in failing-first). tests/mcp-tools.test.js:41-43 pins 'has exactly 13 tools'.

**Design:** Handler delegates to P5-1's runWait, injecting handlers.amicus_status as statusFn (object-literal self-reference resolved at call time — the pattern is safe in CJS). Registry hookup on the shared-server path only (the ONLY path where this process holds the run promise): registerInProcessRun(taskId) immediately before the runHeadless call; settleInProcessRun(taskId) in the .then (AFTER finalizeHeadlessResult writes terminal metadata, so a woken waiter re-reads a terminal status), in the .catch (after the error-metadata write), and in the outer fallback catch (clears a dangling waiter if the shared path dies between register and .then wiring — settle of an unknown id is a no-op). Interfaces consumed: runWait/registerInProcessRun/settleInProcessRun from P5-1. Interface produced: MCP tool amicus_wait {taskId?, waveId?, timeoutMs?(1000-110000), project?} → amicus_status JSON + {timedOut, waitedMs, hint?}; legacy alias sidecar_wait. Annotations mirror amicus_status exactly ({readOnlyHint:false,...}) because wait inherits status's crash-detection writes. Guide text gains one alternative line in the Headless workflow and one in Fan-Out. Schema note: the Zod .max(110000) pins the public 110s contract; the AMICUS_WAIT_MAX_MS env override affects only the internal clamp, schema stays fixed.

**Code:**

```js
// --- src/mcp-tools.js: insert AFTER the amicus_status object (after line 132) ---
  {
    name: 'amicus_wait',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Wait (block inside one tool call) until an Amicus session or fan-out wave ' +
      'reaches a terminal state, or until timeoutMs elapses. Returns the same JSON ' +
      'shape as amicus_status plus {timedOut}. PREFER this over sleep+amicus_status ' +
      'polling for headless runs: one call replaces many polls. If it returns ' +
      'timedOut: true the run is still going — simply call amicus_wait again. ' +
      'Works for any session or wave, including ones started by other processes.',
    inputSchema: {
      taskId: safeTaskId.optional().describe('The session task ID (or wave ID) to wait on.'),
      waveId: safeTaskId.optional().describe('Alias for taskId when waiting on a fan-out wave.'),
      timeoutMs: z.number().int().min(1000).max(110000).optional().describe(
        'Max wait in milliseconds. Default 50000; capped at 110000 so the call ' +
        'returns before typical MCP client kill windows. On expiry the tool ' +
        'returns {timedOut: true} instead of erroring.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },

// --- src/mcp-tools.js getGuideText(): in '### Headless Mode (noUi: true)' replace step list tail ---
// after existing step 4 add:
//   (Alternative to steps 2-4: call amicus_wait with the task ID — one call blocks
//   up to ~50s and returns status; call it again while it returns timedOut: true.)
// and in '### Fan-Out' after step 2 add: 'or call amicus_wait with the waveId'.

// --- src/mcp-server.js line ~18 (top imports) ---
const { runWait, registerInProcessRun, settleInProcessRun } = require('./mcp-wait');

// --- src/mcp-server.js: shared path, line ~361 (immediately BEFORE the runHeadless call) ---
        // amicus_wait fast path: this process owns the run promise; settle wakes
        // any pending wait the moment finalize lands (poll fallback covers the rest).
        registerInProcessRun(taskId);

        // Fire-and-forget: runHeadless with shared server's client
        runHeadless(resolvedModel, systemPrompt, userMessage, taskId, cwd, /* ...unchanged... */
        ).then((result) => {
          /* ...existing finalizeHeadlessResult block unchanged... */
          sharedServer.removeSession(sessionId);
          settleInProcessRun(taskId);          // <-- ADD (after finalize wrote terminal metadata)
        }).catch((err) => {
          /* ...existing error-metadata block unchanged... */
          settleInProcessRun(taskId);          // <-- ADD (last line of the catch)
        });

// --- src/mcp-server.js: outer catch of the shared path (line ~400-407) ---
      } catch (err) {
        logger.warn('Shared server path failed, falling back to spawn', { error: err.message });
        if (sessionId) { sharedServer.removeSession(sessionId); }
        settleInProcessRun(taskId);            // <-- ADD: clear a dangling waiter (no-op if never registered)
        // Fall through to spawn path below
      }

// --- src/mcp-server.js: new handler, insert AFTER amicus_status's closing '},' (line ~567) ---
  async amicus_wait(input, project) {
    // statusFn injection avoids a circular require and inherits amicus_status's
    // crash detection + wave leg rollup on every poll tick.
    return runWait(input, project, {
      statusFn: (i, p) => handlers.amicus_status(i, p),
    });
  },

// --- src/mcp-server.js LEGACY_TOOL_ALIASES (line ~890) ---
  amicus_start: 'sidecar_start', amicus_status: 'sidecar_status',
  amicus_wait: 'sidecar_wait',   // <-- ADD
  /* ...rest unchanged... */
// ALSO: bump the alias-map comment Task 4.2 rewrote — its "doubled the
// advertised tool surface (13 -> 26 per server)" numbers become "14 -> 28".

// --- tests/mcp-tools.test.js: update count + required names ---
  test('has exactly 14 tools', () => { expect(TOOLS).toHaveLength(14); });
  // and in 'has all required tools': expect(names).toContain('amicus_wait');
```

**Tests:**

```js
// tests/mcp-wait-handler.test.js — disk-backed handler tests (mcp-headless-lifecycle pattern).
// Write FIRST: fails because handlers.amicus_wait is undefined.
// Run: npx jest tests/mcp-wait-handler.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
    taskId, status: 'running', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return sessDir;
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('amicus_wait handler', () => {
  let tmpDir; let handlers;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_WAIT_POLL_INTERVAL_MS = '25'; // fast polls (read at module load)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wait-'));
    handlers = require('../src/mcp-server').handlers;
  });
  afterEach(() => {
    delete process.env.AMICUS_WAIT_POLL_INTERVAL_MS;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('terminal session returns immediately: status shape + timedOut:false', async () => {
    createSession(tmpDir, 'w-done', { status: 'complete', completedAt: new Date().toISOString() });
    const body = parse(await handlers.amicus_wait({ taskId: 'w-done' }, tmpDir));
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(body).toHaveProperty('elapsed');
    expect(body).toHaveProperty('version');
  });

  test('running session times out: timedOut:true, no sleep-25 protocol', async () => {
    createSession(tmpDir, 'w-run', { status: 'running', pid: process.pid, headless: true });
    const res = await handlers.amicus_wait({ taskId: 'w-run', timeoutMs: 1000 }, tmpDir);
    const body = parse(res);
    expect(body.status).toBe('running');
    expect(body.timedOut).toBe(true);
    expect(body.next_poll).toBeUndefined();
    expect(res.content.map(c => c.text).join('\n')).not.toContain('sleep 25');
  }, 10000);

  test('poll fallback: resolves when metadata flips terminal on disk', async () => {
    const sessDir = createSession(tmpDir, 'w-flip', { status: 'running', pid: process.pid, headless: true });
    const metaPath = path.join(sessDir, 'metadata.json');
    setTimeout(() => {
      const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      m.status = 'complete'; m.completedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(m, null, 2));
    }, 150);
    const body = parse(await handlers.amicus_wait({ taskId: 'w-flip', timeoutMs: 10000 }, tmpDir));
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
  }, 15000);

  test('wave: returns once ALL legs are terminal (wave record still running)', async () => {
    createSession(tmpDir, 'wave-1', { type: 'wave', status: 'running', legs: ['wave-1-1', 'wave-1-2'], pid: process.pid });
    createSession(tmpDir, 'wave-1-1', { status: 'complete' });
    createSession(tmpDir, 'wave-1-2', { status: 'running', pid: process.pid });
    const p = handlers.amicus_wait({ taskId: 'wave-1', timeoutMs: 10000 }, tmpDir);
    setTimeout(() => {
      const legMeta = path.join(tmpDir, '.claude', 'amicus_sessions', 'wave-1-2', 'metadata.json');
      const m = JSON.parse(fs.readFileSync(legMeta, 'utf-8'));
      m.status = 'error'; m.reason = 'boom';
      fs.writeFileSync(legMeta, JSON.stringify(m, null, 2));
    }, 150);
    const body = parse(await p);
    expect(body.type).toBe('wave');
    expect(body.legsComplete).toBe(2);
    expect(body.timedOut).toBe(false);
  }, 15000);

  test('in-process settle wakes a pending wait (fresh registry per resetModules)', async () => {
    const { registerInProcessRun, settleInProcessRun } = require('../src/mcp-wait');
    const sessDir = createSession(tmpDir, 'w-proc', { status: 'running', pid: null, headless: true });
    registerInProcessRun('w-proc');
    const p = handlers.amicus_wait({ taskId: 'w-proc', timeoutMs: 30000 }, tmpDir);
    await new Promise(r => setTimeout(r, 60));
    const metaPath = path.join(sessDir, 'metadata.json');
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    m.status = 'complete'; m.completedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(m, null, 2));
    settleInProcessRun('w-proc');
    const body = parse(await p);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
  }, 10000);

  test('unknown taskId returns the not-found error', async () => {
    const res = await handlers.amicus_wait({ taskId: 'nope-1' }, tmpDir);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found');
  });
});
// Also update tests/mcp-tools.test.js (13→14 + required name) — it fails first, passes after.
// tests/mcp-tool-aliases.test.js passes only once sidecar_wait is in LEGACY_TOOL_ALIASES.
```

**Risks:** HOT FILE: mcp-server.js is also edited by phases 3, 4, P6-2, P6-3 — serialize strictly (see notes). mcp-server.js and mcp-tools.js are grandfathered in scripts/check-file-sizes.js (excluded entirely) so growth is allowed, but keep additions minimal. Tool-count interactions: tests/mcp-server-legacy-aliases.test.js (Phase 4) derives its counts from getTools().length and must stay green after the 14th tool lands — it is in this task's Test run list. Do NOT settle the waiter before finalizeHeadlessResult writes metadata in the .then, or a woken waiter re-reads 'running' and falls back to polling (correct but slow) — the ordering in the code above is load-bearing. tests use real timers with second-scale timeouts; on a loaded CI box the 150ms flips are safe because the wait windows are 10s. Windows: process.pid probe in fixtures is alive by construction; pid:null skips the crash probe (verified mcp-server.js:521). eslint on staged files: no unused imports (settleInProcessRun IS used in three places).


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

---
## Phase 6 — Agent-visible progress (opp-1)

**Scope:** kill the "Starting up... | 0 messages" blindness. Root cause (verified): the interactive path already mirrors conversation+progress via `interactive-mirror.js` → `conversation-mirror.js`, but never writes the lifecycle stages headless writes (`headless.js:147,202,215,253,328`) and reasoning deltas fire only ONE progress tick — the heartbeat (`createHeartbeat`, `src/sidecar/session-utils.js:120-142`) reads stale data. The OpenCode SDK exposes thinking deltas (`part.type === 'reasoning'`, already parsed at `conversation-mirror.js:119-134`).

**Delivers:** (a) shared progress-fields module (sanitized `latestPreview`, `lastActivityAt`, coarse `deriveStage`); (b) briefing/mode/agent written into MCP-created metadata at creation (gap at `mcp-server.js:317-325`); (c) enriched `amicus_status` (single + wave legs) and `amicus_list`; (d) new one-shot CLI `amicus status <id>` (human + `--json`, wave-aware); (e) interactive lifecycle progress + reasoning-delta "Thinking…" ticks.

**Lane order:** P6-1 → P6-2 → P6-3 → P6-4 sequential (P6-2/P6-3 edit `src/mcp-server.js` — hub; P6-1's module is imported by P6-3/P6-4). **P6-5 (interactive.js + conversation-mirror.js only) is an independent lane — run it in parallel with any of P5-1…P6-4.** NOTE: src/mcp-server.js line anchors in this phase are pre-Phase-3 (HEAD@509ab83) numbers — the file grows as phases 3/4/5 land; locate edit sites by the quoted code, not line numbers.


### Task 6.1 — P6-1: progress-fields — latestPreview (sanitized), lastActivityAt (ISO), deriveStage coarse lifecycle

**Files:** Create: src/sidecar/progress-fields.js
Modify: src/sidecar/progress.js:127-223 (readProgress: add lastActivityAt + latestPreview; consolidate the duplicate progress.json re-read at :198-216)
Create: tests/sidecar/progress-fields.test.js
Modify: tests/sidecar/progress.test.js (append one describe block)
Test: npx jest tests/sidecar/progress-fields.test.js tests/sidecar/progress.test.js

**Verified anchors:** Re-verified today: src/sidecar/progress.js readProgress at :127-223 returns {messages, lastActivity, latest, lastActivityMs, stage?}; the file re-reads progress.json a second time at :204-216 solely to compute lastActivityMs (min-age = newest timestamp) — consolidation below is semantics-preserving. STAGE_LABELS at :13-20 (initializing/server_ready/session_created/prompt_sent/receiving/complete). writeProgress at :110-119 spreads `extra` AFTER stageLabel so extra.stageLabel overrides. progress.js is 234 lines (room for +10 under the 300 gate). Existing tests (tests/sidecar/progress.test.js:33-55) use toMatchObject — additive fields are safe.

**Design:** New module src/sidecar/progress-fields.js (consumed by P6-3 MCP status/list, P6-4 CLI status, and readProgress itself):
- sanitizePreview(text, max=120): collapse all whitespace to single spaces, strip ` < > so the preview can never open a code fence or tag inside a one-line JSON status (this is the 'fenced/sanitized' requirement — full untrusted text is only reachable via amicus_read, which applies the <untrusted_sidecar_output> fence at mcp-server.js:186-195), cap at 120 chars + '…'.
- latestAssistantPreview(entries): newest conversation.jsonl entry with role==='assistant' and non-empty string content (skips tool_use/tool_result lines), sanitized; null if none.
- deriveStage(metadataStatus, progressStage) → 'starting'|'generating'|'folding'|'terminal': terminal metadata status → 'terminal'; progress 'receiving' → 'generating'; progress 'complete' while metadata still says running → 'folding' (the interactive mirror writes stage 'complete' on stop() while finalizeSession is still writing summary/conflicts — verified interactive-mirror.js:70); else 'starting' (covers initializing/server_ready/session_created/prompt_sent/undefined).
readProgress additions: lastActivityAt = ISO of the newest of conv mtime / progress.updatedAt (exact same sources as lastActivityMs, so the two never disagree); latestPreview = latestAssistantPreview(entries). Consolidate the duplicate progress.json re-read into a single newestMtime computation.

**Code:**

```js
// src/sidecar/progress-fields.js  (~70 lines)
'use strict';

/**
 * @module progress-fields
 * Derived, agent-facing progress fields shared by the MCP status/list
 * handlers, the `amicus status` CLI, and readProgress(): a sanitized preview
 * of the newest assistant text, and a coarse lifecycle stage.
 */

/** Coarse stages surfaced to agents. */
const COARSE_STAGES = ['starting', 'generating', 'folding', 'terminal'];

/**
 * Collapse whitespace and defang fence/tag characters so the preview can be
 * embedded in a one-line JSON status without opening a code fence or tag
 * (prompt-injection hygiene: the FULL text is only available via amicus_read,
 * which wraps it in the untrusted-output fence).
 * @param {string} text @param {number} [max=120] @returns {string}
 */
function sanitizePreview(text, max = 120) {
  const collapsed = String(text).replace(/[`<>]/g, '').replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed;
}

/**
 * The newest assistant TEXT content from parsed conversation.jsonl entries,
 * sanitized to ~120 chars. Tool-use/result lines are skipped. Null when no
 * assistant text exists yet.
 * @param {object[]} entries @returns {string|null}
 */
function latestAssistantPreview(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.role === 'assistant' && typeof e.content === 'string' && e.content.trim()) {
      return sanitizePreview(e.content);
    }
  }
  return null;
}

/**
 * Map (metadata.status, progress.stage) to the coarse agent-facing stage.
 *  - terminal metadata status -> 'terminal'
 *  - progress 'receiving' -> 'generating'
 *  - progress 'complete' while metadata still says running -> 'folding'
 *    (mirror stopped; summary/conflict finalize in flight)
 *  - anything else -> 'starting'
 * @param {string|undefined} metadataStatus @param {string|undefined} progressStage
 * @returns {string}
 */
function deriveStage(metadataStatus, progressStage) {
  if (metadataStatus && metadataStatus !== 'running' && metadataStatus !== 'unknown') {
    return 'terminal';
  }
  if (progressStage === 'receiving') { return 'generating'; }
  if (progressStage === 'complete') { return 'folding'; }
  return 'starting';
}

module.exports = { sanitizePreview, latestAssistantPreview, deriveStage, COARSE_STAGES };

// --- src/sidecar/progress.js: REPLACE lines 198-222 (the lastActivityMs block + result build) ---
  // Newest activity timestamp across BOTH sources (conv mtime, progress.updatedAt):
  // feeds lastActivityMs (stall detection) AND lastActivityAt (absolute ISO for
  // agents) from one value so they can never disagree.
  let newestActivity = convStat ? convStat.mtime : null;
  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      if (progress.updatedAt) {
        const t = new Date(progress.updatedAt);
        if (!newestActivity || t > newestActivity) { newestActivity = t; }
      }
    } catch {
      // Ignore — already handled above
    }
  }
  const lastActivityMs = newestActivity ? Date.now() - newestActivity.getTime() : null;

  const result = {
    messages, lastActivity, latest, lastActivityMs,
    lastActivityAt: newestActivity ? newestActivity.toISOString() : null,
    latestPreview: latestAssistantPreview(entries),
  };
  if (stage !== undefined) {
    result.stage = stage;
  }
  return result;

// --- src/sidecar/progress.js: add near the top (after existing requires) ---
const { latestAssistantPreview } = require('./progress-fields');
// and re-export for convenience at the bottom module.exports: no change needed
// (progress-fields is required directly by consumers).
```

**Tests:**

```js
// tests/sidecar/progress-fields.test.js — write FIRST (MODULE_NOT_FOUND → red).
// Run: npx jest tests/sidecar/progress-fields.test.js
'use strict';
const { sanitizePreview, latestAssistantPreview, deriveStage } = require('../../src/sidecar/progress-fields');

describe('sanitizePreview', () => {
  test('collapses newlines, strips fence/tag chars, caps at 120 + ellipsis', () => {
    const raw = '```js\nconst x = 1;\n```\n<system-reminder>hi</system-reminder> ' + 'y'.repeat(200);
    const out = sanitizePreview(raw);
    expect(out).not.toMatch(/[`<>\n]/);
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith('…')).toBe(true);
  });
  test('short clean text passes through', () => {
    expect(sanitizePreview('all good')).toBe('all good');
  });
});

describe('latestAssistantPreview', () => {
  test('returns the NEWEST assistant text, skipping tool lines', () => {
    const entries = [
      { role: 'assistant', content: 'first answer' },
      { role: 'assistant', type: 'tool_use', toolCall: { id: 't1', name: 'Bash' } },
      { role: 'tool', type: 'tool_result', content: 'ok' },
      { role: 'assistant', content: 'final answer' },
    ];
    expect(latestAssistantPreview(entries)).toBe('final answer');
  });
  test('null when no assistant text yet', () => {
    expect(latestAssistantPreview([{ role: 'user', content: 'hi' }])).toBeNull();
    expect(latestAssistantPreview([])).toBeNull();
  });
});

describe('deriveStage', () => {
  test.each([
    ['complete', undefined, 'terminal'],
    ['error', 'receiving', 'terminal'],
    ['timed-out', undefined, 'terminal'],
    ['running', 'receiving', 'generating'],
    ['running', 'complete', 'folding'],
    ['running', 'prompt_sent', 'starting'],
    ['running', undefined, 'starting'],
    [undefined, undefined, 'starting'],
  ])('(%s, %s) -> %s', (status, stage, expected) => {
    expect(deriveStage(status, stage)).toBe(expected);
  });
});

// --- append to tests/sidecar/progress.test.js inside describe('readProgress') ---
    it('exposes lastActivityAt (ISO) and latestPreview', () => {
      fs.writeFileSync(path.join(tmpDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'assistant', content: 'Answer: `x`\nmore' }) + '\n');
      const r = readProgress(tmpDir);
      expect(r.latestPreview).toBe('Answer: x more');
      expect(new Date(r.lastActivityAt).getTime()).toBeGreaterThan(Date.now() - 60000);
      expect(r.lastActivityMs).toBeLessThan(60000);
    });
    it('lastActivityAt is null when nothing has been written', () => {
      expect(readProgress(tmpDir).lastActivityAt).toBeNull();
    });
```

**Risks:** readProgress is consumed by mcp-server.js (:11,466,541), wave-progress.js (:14), session-utils.js createHeartbeat (:129) — additive fields flow into the amicus_status response automatically via Object.assign (that is INTENTIONAL and consumed by P6-3; if P6-3 wants to gate fields it does so there). The lines-198-222 replacement must preserve exact stall-detection semantics (newest timestamp == min age) — the existing progress.test.js stall cases (:514 area) guard this; run the whole file. Existing 'returns defaults' tests use toMatchObject so extra keys pass. Run AFTER phases 3/4 merge only if they touched progress.js (they should not); no mcp-server.js edits here so it can land any time before P6-3/P6-4. New src file → CLAUDE.md marker auto-regen on commit.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 6.2 — P6-2: write briefing/mode/agent into MCP-created metadata at creation (shared-server + spawn fallback)

**Files:** Modify: src/mcp-server.js:317-325 (shared-server metadata write), src/mcp-server.js:426-431 (spawn-fallback initial metadata)
Create: tests/mcp-start-metadata.test.js
Test: npx jest tests/mcp-start-metadata.test.js tests/mcp-server.test.js tests/mcp-shared-server.test.js

**Verified anchors:** Re-verified today: the shared-server metadata write at mcp-server.js:317-325 persists ONLY {taskId,status,pid:null,opencodeSessionId,opencodePort,goPid,createdAt,headless,model} — briefing/mode/agent absent, confirmed (this is the 'shared-server metadata gaps' the review flagged: amicus_list shows an empty briefing and readProgress consumers can't tell headless from interactive). The spawn fallback at :426-431 writes {taskId,status,pid,createdAt,headless} — briefing/mode also absent there, but the CLI child later overwrites via createSessionMetadata (src/sidecar/start.js:33-70, which preserves existing pid via spread) — EXCEPT when the child crashes pre-metadata, so seeding it here also fixes early-crash records. The `agent` local is computed at :277-278 (noUi+chat → 'build'). input.prompt is validated non-empty by validateStartInputs (:251-257) before either write.

**Design:** Parity with createSessionMetadata's fields at creation time: shared path gains mode:'headless', agent: agent || 'build', briefing: input.prompt (FULL prompt — same as CLI path; amicus_list already truncates to 80 chars at :651). Spawn fallback gains mode: input.noUi?'headless':'interactive' and briefing: input.prompt (child's later overwrite writes identical values — idempotent). No schema change for consumers; P6-3 reads metadata.mode. Tests: behavior test through the REAL spawn-fallback path (jest.doMock('child_process') + SIDECAR_SHARED_SERVER='0', the established mcp-server.test.js:131-173 pattern) + a source-contract test for the shared-path write (established mcp-shared-server.test.js style, since exercising the real shared path needs a live OpenCode server).

**Code:**

```js
// --- src/mcp-server.js:317-325 REPLACE the shared-server metadata write ---
        fs.writeFileSync(metaPath, JSON.stringify({
          taskId, status: 'running',
          pid: null, // Shared server path: don't store MCP server PID (abort would kill all sessions)
          opencodeSessionId: sessionId,
          opencodePort: serverPort,
          goPid: server.goPid || null,
          createdAt: new Date().toISOString(),
          headless: true, model: resolvedModel,
          // F6: agent-visible provenance at creation. The CLI path writes these
          // via createSessionMetadata; the shared-server path has no CLI child,
          // so without them status/list/read show a briefing-less, mode-less run.
          mode: 'headless',
          agent: agent || 'build',
          briefing: input.prompt,
        }, null, 2), { mode: 0o600 });

// --- src/mcp-server.js:426-431 REPLACE the spawn-fallback initial metadata ---
      const metaPath = path.join(sessionDir, 'metadata.json');
      if (!fs.existsSync(metaPath)) {
        fs.writeFileSync(metaPath, JSON.stringify({
          taskId, status: 'running', pid: child.pid, createdAt: new Date().toISOString(),
          headless: !!input.noUi,
          // Seed briefing/mode so list/status are informative even before the
          // CLI child's createSessionMetadata overwrite (or if it crashes first).
          mode: input.noUi ? 'headless' : 'interactive',
          briefing: input.prompt,
        }, null, 2), { mode: 0o600 });
      }
```

**Tests:**

```js
// tests/mcp-start-metadata.test.js — write FIRST (both suites red against current source).
// Run: npx jest tests/mcp-start-metadata.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('amicus_start spawn-path initial metadata (F6)', () => {
  test('writes briefing + mode at creation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-create-'));
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
        }));
        const prev = process.env.SIDECAR_SHARED_SERVER;
        process.env.SIDECAR_SHARED_SERVER = '0'; // force the spawn fallback
        try {
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_start(
            { prompt: 'audit the auth module', noUi: true, model: 'google/gemini-test' }, tmpDir);
          const { taskId } = JSON.parse(result.content[0].text);
          const metaPath = path.join(tmpDir, '.claude', 'amicus_sessions', taskId, 'metadata.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          expect(meta.briefing).toBe('audit the auth module');
          expect(meta.mode).toBe('headless');
          expect(meta.headless).toBe(true);
        } finally {
          if (prev === undefined) { delete process.env.SIDECAR_SHARED_SERVER; }
          else { process.env.SIDECAR_SHARED_SERVER = prev; }
        }
      });
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });
});

describe('shared-server path metadata keys (source contract)', () => {
  // The shared path needs a live OpenCode server to exercise; pin the write's
  // contents at the source level instead (established repo style, see
  // tests/mcp-shared-server.test.js).
  const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
  test('shared-server metadata write includes briefing/mode/agent', () => {
    const start = src.indexOf('opencodeSessionId: sessionId');
    const end = src.indexOf('buildContext(cwd');
    expect(start).toBeGreaterThan(-1);
    const sharedWrite = src.slice(start, end);
    expect(sharedWrite).toContain('briefing: input.prompt');
    expect(sharedWrite).toContain("mode: 'headless'");
    expect(sharedWrite).toContain("agent: agent || 'build'");
  });
});
```

**Risks:** HOT FILE mcp-server.js — land AFTER P5-2, BEFORE P6-3 (see notes ordering). The full prompt is duplicated into metadata.json exactly as the CLI path already does (createSessionMetadata stores the full briefing) — not a new exposure, but note briefing.md + metadata.json now both hold it on the shared path; 0o600 is a no-op on NTFS (pre-existing posture). Secret-scan gate (scripts/check-secrets.js) runs on staged files — the test's literal prompt is benign. Do not add `briefing` to the metadata write inside amicus_continue (out of scope; its child writes it). tests/mcp-server.test.js existing spawn-arg suites must stay green — the fallback write only ADDS keys.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 6.3 — P6-3: enrich amicus_status (single + wave legs) and amicus_list with mode/phase/messageCount/lastActivityAt/latestPreview

**Files:** Modify: src/mcp-server.js:14-18 (import deriveStage), :459-469 (wave leg rollup), :532-560 (single-session response), :640-668 (amicus_list entries)
Create: tests/mcp-status-enrichment.test.js
Test: npx jest tests/mcp-status-enrichment.test.js tests/mcp-headless-lifecycle.test.js

**Verified anchors:** Re-verified today: single-session running branch merges readProgress via Object.assign at mcp-server.js:540-542 (so P6-1's lastActivityAt/latestPreview already flow in — this task adds mode/phase/messageCount and the terminal-path fields). Wave leg rollup at :459-469 (legs get messages/latestActivity/stalled from readProgress). amicus_list entry shape at :648-656 (id/model/status/agent/briefing-80/createdAt; briefing will be non-empty for shared-server runs only after P6-2). CRITICAL back-compat anchor: tests/mcp-headless-lifecycle.test.js:384-396 asserts response.stage === 'initializing'/'prompt_sent' (the RAW progress stage) — therefore the coarse stage MUST use a NEW key `phase`, never overwrite `stage`.

**Design:** Naming: raw fine-grained `stage` (initializing/…/receiving/complete) is a pinned public field; the new coarse lifecycle ('starting|generating|folding|terminal') ships as `phase` on: single-session status (always), wave legs, and list entries. Single-session status additionally gains mode (metadata.mode, falling back to headless-flag inference for pre-P6-2 records) and messageCount (alias of progress.messages; kept alongside for a stable agent-facing name). Terminal responses get phase:'terminal' (no progress read needed). Wave legs gain stage (raw), phase, latestPreview, lastActivityAt from the leg's readProgress (already called there). amicus_list gains mode on every entry and, for RUNNING sessions only (cost control: readProgress parses conversation.jsonl fully), phase/messageCount/lastActivityAt/latestPreview inside a try/catch. Consumes deriveStage + enriched readProgress from P6-1. amicus_wait (P5-2) passes all new fields through automatically since it re-serializes the status payload.

**Code:**

```js
// --- src/mcp-server.js top (near line 11 with the other sidecar requires) ---
const { deriveStage } = require('./sidecar/progress-fields');

// --- wave leg rollup: REPLACE the try block at :462-467 ---
        try {
          const p = readProgress(getSessionDir(cwd, legId));
          leg.messages = p.messages;
          leg.latestActivity = p.latest;
          leg.stalled = leg.status === 'running' && isStalled(p.lastActivityMs);
          leg.stage = p.stage;                                  // raw lifecycle stage
          leg.phase = deriveStage(leg.status, p.stage);         // coarse: starting|generating|folding|terminal
          leg.latestPreview = p.latestPreview;
          leg.lastActivityAt = p.lastActivityAt;
        } catch { /* no progress yet — leave base fields only */ }

// --- single-session response: after `if (metadata.model) { response.model = metadata.model; }` (line ~538) ---
    // F6: agent-visible mode (headless|interactive). metadata.mode is written at
    // creation (CLI createSessionMetadata; MCP paths since F6); fall back to the
    // headless boolean for records created before that.
    if (metadata.mode) { response.mode = metadata.mode; }
    else if (metadata.headless !== undefined) { response.mode = metadata.headless ? 'headless' : 'interactive'; }

    if (metadata.status === 'running') {
      const progress = readProgress(sessionDir);
      Object.assign(response, progress); // messages/latest/lastActivity/lastActivityMs/lastActivityAt/latestPreview/stage
      response.messageCount = progress.messages;                       // stable agent-facing alias
      response.phase = deriveStage(metadata.status, progress.stage);   // coarse lifecycle
      /* ...existing stall-detection + next_poll blocks unchanged... */
    } else {
      response.phase = deriveStage(metadata.status, undefined);        // 'terminal'
    }
    // NOTE: the existing `if (metadata.status === 'running') {` block at :540
    // becomes the if-arm above; only the two marked lines + the else-arm are new.

// --- amicus_list: REPLACE the byId.set block at :648-656 ---
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          const entry = {
            id: d, model: meta.model, status: meta.status, agent: meta.agent,
            briefing: (String(meta.briefing || '')).slice(0, 80),
            createdAt: meta.createdAt,
            mode: meta.mode
              || (meta.headless === undefined ? undefined : (meta.headless ? 'headless' : 'interactive')),
          };
          // Live-progress enrichment for RUNNING sessions only — readProgress
          // parses conversation.jsonl, so terminal rows stay cheap.
          if (meta.status === 'running') {
            try {
              const p = readProgress(path.join(root, d));
              entry.phase = deriveStage(meta.status, p.stage);
              entry.messageCount = p.messages;
              entry.lastActivityAt = p.lastActivityAt;
              entry.latestPreview = p.latestPreview;
            } catch { /* progress optional */ }
          }
          byId.set(d, entry);
        } catch {
          // Skip unreadable metadata
        }
```

**Tests:**

```js
// tests/mcp-status-enrichment.test.js — write FIRST (all red: phase/mode/messageCount absent today).
// Run: npx jest tests/mcp-status-enrichment.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
    taskId, status: 'running', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return sessDir;
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('amicus_status enrichment (F6)', () => {
  let tmpDir; let handlers;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-enrich-'));
    handlers = require('../src/mcp-server').handlers;
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); jest.resetModules(); });

  test('running session exposes mode/phase/messageCount/lastActivityAt/latestPreview', async () => {
    const { writeProgress } = require('../src/sidecar/progress');
    const sessDir = createSession(tmpDir, 'enrich-1', {
      status: 'running', pid: process.pid, mode: 'headless', briefing: 'do the thing',
    });
    fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'Scanning `auth.js` now\nline2' }) + '\n');
    writeProgress(sessDir, 'receiving', { messagesReceived: 1 });

    const body = parse(await handlers.amicus_status({ taskId: 'enrich-1' }, tmpDir));
    expect(body.mode).toBe('headless');
    expect(body.phase).toBe('generating');
    expect(body.messageCount).toBe(1);
    expect(body.latestPreview).toBe('Scanning auth.js now line2');
    expect(new Date(body.lastActivityAt).getTime()).toBeGreaterThan(0);
    expect(body.stage).toBe('receiving'); // RAW stage unchanged — back-compat pin
  });

  test('terminal session reports phase terminal; mode inferred from headless flag', async () => {
    createSession(tmpDir, 'enrich-2', { status: 'complete', headless: true });
    const body = parse(await handlers.amicus_status({ taskId: 'enrich-2' }, tmpDir));
    expect(body.phase).toBe('terminal');
    expect(body.mode).toBe('headless');
  });

  test('wave legs carry phase + latestPreview + lastActivityAt', async () => {
    createSession(tmpDir, 'wv-1', { type: 'wave', status: 'running', legs: ['wv-1-1'], pid: process.pid });
    const legDir = createSession(tmpDir, 'wv-1-1', { status: 'running' });
    fs.writeFileSync(path.join(legDir, 'conversation.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'leg says hi' }) + '\n');
    const body = parse(await handlers.amicus_status({ taskId: 'wv-1' }, tmpDir));
    expect(body.legs[0].latestPreview).toBe('leg says hi');
    expect(body.legs[0].phase).toBe('starting'); // running + no progress.json stage
    expect(body.legs[0].lastActivityAt).toBeTruthy();
  });

  test('amicus_list: mode on every row; live fields on running rows only', async () => {
    const runDir = createSession(tmpDir, 'ls-run', { status: 'running', mode: 'headless', briefing: 'b' });
    fs.writeFileSync(path.join(runDir, 'conversation.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'working' }) + '\n');
    createSession(tmpDir, 'ls-done', { status: 'complete', mode: 'interactive', briefing: 'b2', createdAt: '2026-01-01T00:00:00Z' });
    const body = parse(await handlers.amicus_list({}, tmpDir));
    const run = body.find(s => s.id === 'ls-run');
    const done = body.find(s => s.id === 'ls-done');
    expect(run.mode).toBe('headless');
    expect(run.messageCount).toBe(1);
    expect(run.latestPreview).toBe('working');
    expect(run.phase).toBe('starting');
    expect(done.mode).toBe('interactive');
    expect(done.messageCount).toBeUndefined();
    expect(done.latestPreview).toBeUndefined();
  });
});
// Regression gate: npx jest tests/mcp-headless-lifecycle.test.js must stay green
// (it pins raw stage strings + messages counts).
```

**Risks:** HOT FILE mcp-server.js — land after P6-2. DEPENDS ON P6-1 (deriveStage + readProgress fields); will not compile without it. The #1 regression hazard is overwriting response.stage — tests/mcp-headless-lifecycle.test.js:384-435 pins the raw values; the design deliberately introduces `phase` instead (if the plan author prefers the name `stage` for the coarse value, that is a breaking rename requiring updates to those pinned tests AND the sleep-25/status docs — do NOT do it silently). amicus_list now does one readProgress per RUNNING session (reads conversation.jsonl fully) — acceptable for local session counts; terminal rows unaffected. Wave-branch legs already read progress, so no added I/O there. amicus_wait (P5-2) automatically re-serializes the enriched payload — no coordination needed beyond file-level merge order.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 6.4 — P6-4: new CLI command `amicus status <id>` (one-shot, human + --json, wave-aware)

**Files:** Create: src/cli-handlers-status.js
Modify: bin/amicus.js:94-96 (add 'status' case after 'list'), src/utils/lifecycle.js:15 (add 'status' to ONE_SHOT_COMMANDS), src/cli.js:330-336 (USAGE_HEADER command line) and :414 (insert USAGE_COMMAND_BLOCKS.status after the list block)
Create: tests/cli-handlers-status.test.js
Test: npx jest tests/cli-handlers-status.test.js tests/cli.test.js

**Verified anchors:** Re-verified today: bin/amicus.js command switch at :87-140 ('list' case at :94-96; handlers may return exit codes consumed at :149). requiring src/mcp-server.js does NOT start anything — the MCP SDK is lazily required inside startMcpServer() only (mcp-server.js:903-905), and the repo's own tests call handlers directly (tests/mcp-headless-lifecycle.test.js:67). ONE_SHOT_COMMANDS at src/utils/lifecycle.js:15 (arms the 1.5s force-exit watchdog via bin/amicus.js:150-152 — needed because getUpdateInfo/update-notifier can hold handles). cli.js USAGE_HEADER commands list at :326-351, USAGE_COMMAND_BLOCKS insertion-ordered map at :355-483; usage tests are contains-based (tests/cli.test.js:962-990) so an added block is safe. parseArgs default cwd = process.cwd() (cli.js:27).

**Design:** handleStatus(args) → Promise<number> (exit code; 0 = status retrieved even if the run failed — the QUERY succeeded; 1 = missing/invalid/unknown id). Reads the same sources as MCP status by invoking require('./mcp-server').handlers.amicus_status({taskId}, project) directly — zero duplicated status logic, inherits crash detection, wave rollup, and P6-3 enrichment for free. Accepts `amicus status <id>` positional or `--wave <id>` (both hit the same handler; waves are auto-detected from metadata.type, the flag is just an alternative spelling). --json prints the parsed payload pretty-printed with next_poll stripped (that field is MCP-agent polling guidance, not CLI output; the sleep-25 reminder lives in content[1] and is never printed since only content[0] is consumed). Human mode: key-value block for single runs; header + per-leg lines for waves (modeled on wave-progress.js formatting). Interfaces consumed: mcp-server handlers (post P6-3 fields render when present, degrade when absent — every field access is guarded). New file is ~95 lines, under the 300 gate.

**Code:**

```js
// src/cli-handlers-status.js
/**
 * `amicus status <task_id>` — one-shot human/JSON status for a session or wave.
 * Reads the SAME sources as the MCP amicus_status handler by calling it
 * directly (requiring mcp-server does NOT start the server; the MCP SDK is
 * only loaded inside startMcpServer()).
 */
'use strict';

const { validateTaskId } = require('./utils/validators');

/** Render a key-value block for a single-session status payload. */
function formatRunHuman(d) {
  const lines = [
    `Task:     ${d.taskId}`,
    `Status:   ${d.status}${d.phase ? ` (${d.phase})` : ''}`,
    `Elapsed:  ${d.elapsed}`,
  ];
  if (d.model) { lines.push(`Model:    ${d.model}`); }
  if (d.mode) { lines.push(`Mode:     ${d.mode}`); }
  if (d.messageCount !== undefined) { lines.push(`Messages: ${d.messageCount}`); }
  if (d.lastActivity) { lines.push(`Activity: ${d.lastActivity}`); }
  if (d.latestPreview) { lines.push(`Latest:   ${d.latestPreview}`); }
  else if (d.latest) { lines.push(`Latest:   ${d.latest}`); }
  if (d.stalled) { lines.push(`STALLED:  no activity for ${d.stalledForSeconds}s (see --json for recovery)`); }
  if (d.reason) { lines.push(`Reason:   ${d.reason}`); }
  return lines.join('\n');
}

/** Render a wave payload: header + one line per leg. */
function formatWaveHumanStatus(d) {
  const head = `Wave ${d.taskId}: ${d.status} — ${d.legsComplete}/${d.legsTotal} legs done (${d.elapsed})`;
  const legLines = (d.legs || []).map((l) => {
    const label = String(l.model || l.taskId || '').padEnd(28);
    const st = String(l.status || 'unknown').padEnd(10);
    const msgs = l.messages !== undefined ? `${l.messages} msg` : '';
    const latest = l.latestPreview || l.latestActivity || '';
    const flag = l.stalled ? ' ⏳stalled' : '';
    return `  ${label} ${st} ${msgs} | ${latest}${flag}`;
  });
  return [head, ...legLines].join('\n');
}

/**
 * Handle 'amicus status'. Exit code 0 = status retrieved (any run state);
 * 1 = missing/invalid/unknown id.
 * @param {object} args parsed CLI args
 * @returns {Promise<number>}
 */
async function handleStatus(args) {
  const taskId = args.wave || args._[1];
  if (!taskId || taskId === true) {
    console.error('Error: task_id is required for status');
    console.error('Usage: amicus status <task_id> [--json]   (or: amicus status --wave <wave_id>)');
    return 1;
  }
  const check = validateTaskId(String(taskId));
  if (!check.valid) { console.error(check.error); return 1; }

  const project = args.cwd || process.cwd();
  const { handlers } = require('./mcp-server');
  const result = await handlers.amicus_status({ taskId: String(taskId) }, project);
  const text = result.content[0].text;
  if (result.isError) { console.error(text); return 1; }

  let data;
  try { data = JSON.parse(text); } catch { console.log(text); return 0; }
  delete data.next_poll; // MCP-agent polling guidance, not CLI output

  if (args.json) { console.log(JSON.stringify(data, null, 2)); return 0; }
  console.log(data.type === 'wave' ? formatWaveHumanStatus(data) : formatRunHuman(data));
  return 0;
}

module.exports = { handleStatus, formatRunHuman, formatWaveHumanStatus };

// --- bin/amicus.js: insert after the 'list' case (line ~96) ---
      case 'status': {
        const { handleStatus } = require('../src/cli-handlers-status');
        exitCode = await handleStatus(args);
        break;
      }

// --- src/utils/lifecycle.js:15 — add 'status' to the set (PRESERVE the existing inline comment) ---
const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'status', 'read', 'abort', 'fanout', 'models', 'key', 'council', 'doctor' /* local-only: no OpenCode server, no stray handles */]);

// --- src/cli.js USAGE_HEADER: after the `list` line (line ~332) ---
  status      One-shot status for a session or wave (--json)

// --- src/cli.js USAGE_COMMAND_BLOCKS: insert after the `list:` block (line ~419) ---
  status: `
Options for 'status':
  <task_id>                    Required. Session or wave ID (positional)
  --wave <wave_id>             Alternative to the positional ID for waves
  --json                       Machine-readable output
  --cwd <path>                 Project directory (default: cwd)
`,
```

**Tests:**

```js
// tests/cli-handlers-status.test.js — write FIRST (MODULE_NOT_FOUND → red).
// Run: npx jest tests/cli-handlers-status.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { handleStatus } = require('../src/cli-handlers-status');

function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
    taskId, status: 'running', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return sessDir;
}

describe('amicus status CLI', () => {
  let tmpDir; let logSpy; let errSpy;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-status-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore(); errSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('--json prints the status payload without next_poll', async () => {
    createSession(tmpDir, 'cs-1', { status: 'complete', mode: 'headless' });
    const code = await handleStatus({ _: ['status', 'cs-1'], cwd: tmpDir, json: true });
    expect(code).toBe(0);
    const out = JSON.parse(logSpy.mock.calls.map(c => c[0]).join('\n'));
    expect(out.taskId).toBe('cs-1');
    expect(out.status).toBe('complete');
    expect(out.next_poll).toBeUndefined();
  });

  test('human output prints task + status + elapsed', async () => {
    createSession(tmpDir, 'cs-2', { status: 'running', pid: process.pid });
    const code = await handleStatus({ _: ['status', 'cs-2'], cwd: tmpDir });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('cs-2');
    expect(out).toContain('running');
    expect(out).toMatch(/Elapsed:/);
  });

  test('wave renders header + per-leg lines', async () => {
    createSession(tmpDir, 'cw-1', { type: 'wave', status: 'running', legs: ['cw-1-1'], pid: process.pid });
    createSession(tmpDir, 'cw-1-1', { status: 'complete', model: 'openrouter/x/y' });
    const code = await handleStatus({ _: ['status', 'cw-1'], cwd: tmpDir });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('1/1 legs');
    expect(out).toContain('openrouter/x/y');
  });

  test('--wave flag is an alternative spelling for the id', async () => {
    createSession(tmpDir, 'cw-2', { type: 'wave', status: 'complete', legs: [] });
    const code = await handleStatus({ _: ['status'], wave: 'cw-2', cwd: tmpDir, json: true });
    expect(code).toBe(0);
  });

  test('missing id and unknown id return exit 1', async () => {
    expect(await handleStatus({ _: ['status'], cwd: tmpDir })).toBe(1);
    expect(await handleStatus({ _: ['status', 'nope-9'], cwd: tmpDir })).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
// Also assert command discoverability (append to tests/cli.test.js usage suite):
//   test('status command appears in usage', () => {
//     const { getUsage } = require('../src/cli');
//     expect(getUsage()).toMatch(/^\s+status\s+One-shot status/m);
//     expect(getUsage('status')).toContain("Options for 'status':");
//   });
```

**Risks:** Renders best AFTER P6-3 (phase/mode/messageCount populated) but degrades gracefully without it — can be developed in parallel against P6-1's branch, merge after P6-3. cli.js is grandfathered for size; lifecycle.js grows by one word. handleStatus's amicus_status call performs crash-detection WRITES (pid probe → metadata update) — intended parity with MCP, but it means `amicus status` is not purely read-only; document in the usage line if the plan author objects. Cross-project lookups: MCP status errors with 'not found in project X' when --cwd is wrong — same contract as amicus_read; acceptable. tests/cli.test.js contains-based usage tests stay green; the byte-identical guarantee only pins getUsage(undefined)===getUsage() (still true). ONE_SHOT_COMMANDS membership is asserted by tests/doctor-handler.test.js:42-43 (`ONE_SHOT_COMMANDS.has('doctor')`) and tests/fanout-cli.test.js:5,18 (`ONE_SHOT_COMMANDS.has('fanout')`) — membership-only checks, so adding 'status' keeps them green; run both. The replacement ONE_SHOT_COMMANDS line must preserve the inline `/* local-only: no OpenCode server, no stray handles */` comment from src/utils/lifecycle.js:15.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 6.5 — P6-5: interactive lifecycle progress + reasoning-delta ('Thinking…') progress ticks

**Files:** Modify: src/sidecar/interactive.js:1-17 (imports), :103-124 (progressStage helper + initializing), :131-142 (server_ready), :144-176 (session_created/prompt_sent), :202 (remove duplicate sessionDir)
Modify: src/sidecar/conversation-mirror.js:40-50 (reasoningActivity flag), :119-134 (reasoning branch), :137-152 (post-loop Thinking tick)
Create: tests/sidecar/interactive-progress.test.js
Modify: tests/conversation-mirror.test.js (append one describe block)
Test: npx jest tests/sidecar/interactive-progress.test.js tests/conversation-mirror.test.js tests/interactive-mirror.test.js tests/headless.test.js

**Verified anchors:** Re-verified today — this grounds the whole phase-6c/6d claim set: (1) the interactive path ALREADY mirrors conversation+progress (interactive.js:202-207 startInteractiveMirror → conversation-mirror progressUpdates → writeProgress) BUT never writes the lifecycle stages; headless writes them at headless.js:147 ('initializing'), :202/:215 ('server_ready'), :253 ('session_created'), :328 ('prompt_sent'). (2) The exact heartbeat emit site is src/sidecar/session-utils.js:120-142 createHeartbeat — it reads readProgress(sessionDir).messages and .latest and prints `[amicus] ${ts} | ${messages} messages | ${latest}`; started for interactive runs at start.js:182 BEFORE runInteractive. With no progress.json and 0 assistant conv entries, readProgress yields latest='Starting up...' (progress.js:31-33) — the literal reported symptom. (3) Reasoning deltas ARE exposed by the OpenCode SDK poll shape: part.type==='reasoning' with monotonically growing part.text, parsed at conversation-mirror.js:119-134 (seenReasoningParts delta tracking); today they emit at most ONE progress tick (the receivingReported gate), so a long-thinking model shows no activity — and worse, progress.updatedAt goes stale so amicus_status's 120s stall detector (mcp-server.js:544-552) false-positives during legitimate thinking. (4) F1 #16 activity-aware completion (headless.js:452-506) is untouched by this change: it keys off mirror.output/toolCalls/messageCount, not progressUpdates. (5) interactive.js is 269 lines; +~15 stays under the 300 gate. conversation-mirror.js is 168 lines.

**Design:** (a) interactive.js: hoist sessionDir above server startup and write the four lifecycle stages via a best-effort progressStage(stage) closure (mkdirSync guard because runInteractive can be reached via resume paths where the dir timing differs; write failures must NEVER break the GUI). 'prompt_sent' only on the non-resume branch (resume sends no prompt). (b) conversation-mirror.js: track reasoningActivity across the parts loop (set on any growth delta, replacing the old first-only receivingReported push in the reasoning branch); after the loop, if reasoningActivity AND no other progress update was emitted this poll (text/tool updates win), push ONE {stage:'receiving', extra:{messagesReceived: max(assistantMsgCount,1), stageLabel:'Thinking…'}}. Effects: readProgress sees messages≥1 with latest='Thinking…' pre-text (heartbeat: '[amicus] 45s | 1 messages | Thinking…' instead of 'Starting up... | 0 messages'); progress.updatedAt refreshes every ~2s poll WITH growth only, so genuine stalls (no reasoning growth) still trip isStalled/the 120s MCP stall detector — the activity-gating is load-bearing. writeProgress's `...extra` spread lets extra.stageLabel override STAGE_LABELS (verified progress.js:110-119). Both headless (mr.progressUpdates.forEach at headless.js:407) and interactive (interactive-mirror.js:38) consume the new tick with zero changes. Interfaces produced: none new — richer progress.json only; P6-1/P6-3 read it.

**Code:**

```js
// --- src/sidecar/interactive.js: imports (top of file, after existing requires) ---
const fs = require('fs');
const { writeProgress } = require('./progress');

// --- src/sidecar/interactive.js: inside runInteractive, right after the ensureElectron ok-check (line ~115) ---
  const { agent, isResume, conversation, mcp, reasoning, opencodeSessionId, client } = options;

  // F6c: mirror the headless lifecycle stages so the CLI heartbeat
  // (session-utils.js createHeartbeat) and status/list never read
  // "Starting up... | 0 messages" for a live GUI run. Best-effort: a
  // progress-write failure must never break the GUI session.
  const sessionDir = getSessionDir(project, taskId);
  const progressStage = (stage) => {
    try {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      writeProgress(sessionDir, stage);
    } catch { /* best-effort */ }
  };
  progressStage('initializing');

  /* ...existing sessionDirectory + startOpenCodeServer block... */
  //   after ocClient/server are assigned successfully (line ~135):
  progressStage('server_ready');

  /* ...existing create-or-reconnect block... */
  //   in the resume arm, after `sessionId = opencodeSessionId;`:
  //     progressStage('session_created');
  //   in the new-session arm, after `sessionId = await createSession(...)`:
  //     progressStage('session_created');
  //   and after `await sendPromptAsync(ocClient, sessionId, promptOptions);`:
  //     progressStage('prompt_sent');

  // DELETE the now-duplicate `const sessionDir = getSessionDir(project, taskId);`
  // at the old line 202 (the mirror block below it uses the hoisted one).

// --- src/sidecar/conversation-mirror.js: in mirrorMessages, before the for-loop (line ~49) ---
  let reasoningActivity = false;

// --- conversation-mirror.js: REPLACE the reasoning branch body (lines 119-134) ---
      } else if (part.type === 'reasoning' && part.text) {
        // (comment block about Gemini reasoning-only promotion unchanged)
        const prevLen = state.seenReasoningParts.get(partId) || 0;
        if (part.text.length > prevLen) {
          state.reasoningOutput += part.text.slice(prevLen);
          state.seenReasoningParts.set(partId, part.text.length);
          reasoningActivity = true; // F6d: growth this poll = the model is thinking
        }
      }

// --- conversation-mirror.js: AFTER the parts loop, BEFORE the assistantFinished computation (line ~139) ---
  // F6d: thinking IS activity. Emit ONE progress tick per poll with reasoning
  // growth (only when no text/tool update already fired) so heartbeat/status
  // show "Thinking…" and the stall detector resets during long pre-text
  // reasoning — while a poll with NO growth still writes nothing, keeping
  // genuine-stall detection intact. OpenCode's getMessages() exposes these
  // deltas as growing part.type === 'reasoning' text.
  if (reasoningActivity && progressUpdates.length === 0) {
    const assistantCount = list.filter(m => m.info && m.info.role === 'assistant').length;
    progressUpdates.push({
      stage: 'receiving',
      extra: { messagesReceived: Math.max(assistantCount, 1), stageLabel: 'Thinking…' },
    });
    state.receivingReported = true;
  }
```

**Tests:**

```js
// (1) append to tests/conversation-mirror.test.js — write FIRST (red: today only the FIRST
//     reasoning delta emits a tick, and without stageLabel 'Thinking…').
describe('reasoning-delta progress (F6d)', () => {
  const reasoningMsg = (id, text) => ({
    info: { role: 'assistant', id, time: {} },
    parts: [{ id: `${id}:r`, type: 'reasoning', text }],
  });

  test('every reasoning-growth poll emits a Thinking tick; no growth emits nothing', () => {
    const st = createMirrorState();
    const r1 = mirrorMessages([reasoningMsg('m1', 'hmm')], st, { now: NOW });
    expect(r1.progressUpdates).toEqual([
      { stage: 'receiving', extra: { messagesReceived: 1, stageLabel: 'Thinking…' } },
    ]);
    const r2 = mirrorMessages([reasoningMsg('m1', 'hmm, deeper thought')], st, { now: NOW });
    expect(r2.progressUpdates).toHaveLength(1); // growth again → another tick
    const r3 = mirrorMessages([reasoningMsg('m1', 'hmm, deeper thought')], st, { now: NOW });
    expect(r3.progressUpdates).toHaveLength(0); // NO growth → no tick (stall detection intact)
  });

  test('text update wins over the Thinking tick in the same poll', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'm1:r', type: 'reasoning', text: 'thinking' },
      { id: 'm1:t', type: 'text', text: 'PONG' },
    ] };
    const r = mirrorMessages([msg], st, { now: NOW });
    expect(r.progressUpdates).toEqual([{ stage: 'receiving', extra: { messagesReceived: 1 } }]);
  });
});

// (2) tests/sidecar/interactive-progress.test.js — clone of the interactive-cwd-scope harness,
//     PLUS electron-ensure + progress mocks (hermetic: no real electron needed). Write FIRST (red).
// Run: npx jest tests/sidecar/interactive-progress.test.js
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../src/opencode-client', () => ({
  createSession: jest.fn().mockResolvedValue('ses_test'),
  sendPromptAsync: jest.fn().mockResolvedValue({}),
  getMessages: jest.fn().mockResolvedValue([]),
  getSessionStatus: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/sidecar/session-utils', () => ({
  startOpenCodeServer: jest.fn().mockResolvedValue({
    client: { fake: 'client' },
    server: { url: 'http://localhost:4096', close: jest.fn() },
  }),
}));
jest.mock('../../src/utils/agent-mapping', () => ({ mapAgentToOpenCode: () => ({ agent: 'chat' }) }));
jest.mock('../../src/utils/env-compat', () => ({ getCompatEnv: () => undefined }));
jest.mock('../../src/session-manager', () => ({ getSessionDir: () => '/sess/dir' }));
jest.mock('../../src/sidecar/interactive-mirror', () => ({
  startInteractiveMirror: () => ({ stop: jest.fn().mockResolvedValue({ usage: null }) }),
}));
jest.mock('../../src/utils/idle-watchdog', () => ({ IdleWatchdog: class { start() { return this; } touch() {} cancel() {} } }));
jest.mock('../../src/utils/activity-poller', () => ({ createActivityPoller: () => ({ stop: jest.fn() }), killIfAlive: jest.fn() }));
jest.mock('../../src/sidecar/electron-ensure', () => ({ ensureElectron: jest.fn().mockResolvedValue({ ok: true, path: '/fake/electron' }) }));
jest.mock('../../src/sidecar/progress', () => ({ writeProgress: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn() }));
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const handlers = {};
    const proc = { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (ev, cb) => { handlers[ev] = cb; } };
    setImmediate(() => { if (handlers.close) { handlers.close(0); } });
    return proc;
  }),
}));

const { writeProgress } = require('../../src/sidecar/progress');
const { runInteractive } = require('../../src/sidecar/interactive');

describe('interactive lifecycle progress (F6c)', () => {
  test('writes initializing → server_ready → session_created → prompt_sent to the session dir', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', 'C:/proj', {});
    const stages = writeProgress.mock.calls.map(c => c[1]);
    expect(stages).toEqual(expect.arrayContaining(['initializing', 'server_ready', 'session_created', 'prompt_sent']));
    expect(stages.indexOf('initializing')).toBeLessThan(stages.indexOf('server_ready'));
    expect(stages.indexOf('session_created')).toBeLessThan(stages.indexOf('prompt_sent'));
    expect(writeProgress.mock.calls[0][0]).toBe('/sess/dir');
  });

  test('resume path writes session_created but NOT prompt_sent', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-2', 'C:/proj', { isResume: true, opencodeSessionId: 'ses_old' });
    const stages = writeProgress.mock.calls.map(c => c[1]);
    expect(stages).toContain('session_created');
    expect(stages).not.toContain('prompt_sent');
  });
});
// Regression gates: tests/interactive-mirror.test.js, tests/headless.test.js,
// tests/sidecar/interactive-cwd-scope.test.js, existing conversation-mirror suites.
```

**Risks:** INDEPENDENT LANE: touches only interactive.js + conversation-mirror.js (+tests) — no mcp-server.js contention, can run parallel to P5/P6-1..4. Behavior deltas to watch: (1) headless now WRITES progress.json on every poll WITH reasoning growth (~2s cadence during thinking) — tiny file, and it deliberately FIXES the false 120s stall flag during long thinking; the `progressUpdates.length === 0` gate plus growth-gating preserves genuine-stall detection (assert with the no-growth test). (2) The reasoning branch's OLD first-tick {messagesReceived:1} (no stageLabel) becomes a stageLabel'd tick — grep tests for that exact literal before changing (verified today: no existing test pins the reasoning-branch progressUpdates; conversation-mirror.test.js:21 pins the TEXT branch, untouched). (3) fs mock in the new test uses requireActual-spread with mkdirSync overridden — do NOT mock fs wholesale (canonicalProjectPath and others need real fs). (4) interactive.js writes now happen even when Electron later fails to spawn — progress.json in a session dir whose metadata says error; harmless (readProgress is only consulted for running sessions). (5) Windows: '/sess/dir' mock path never touches disk because mkdirSync is mocked; the real path flows through getSessionDir which the CLI start path pre-creates (start.js:176-179). Pre-commit: both files stay under 300 lines (interactive.js ~284 after edit); eslint --fix on staged files may reflow — review the auto-fix diff.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

---
## Phase 7 — Release v1.8.0 + this-machine hygiene

Release phase on merged main. **STOP for user approval before pushing.**

### Task 7.1: Cut and publish v1.8.0

- [ ] **Step 1: Preflight** — full gate as Phase 2 Step 1 (`npm test`, lint, sizes, secrets, tarball, `test:all`).
- [ ] **Step 2: CHANGELOG `## [1.8.0]`** — **Added:** `amicus_wait` MCP tool (blocking wait, 50s default/110s cap); agent-visible progress (`amicus status <id>` CLI command, enriched `amicus_status`/`amicus_list` with mode/phase/messageCount/lastActivityAt/latestPreview (raw `stage` field unchanged; wave legs additionally surface raw `stage`), interactive lifecycle + thinking-delta progress); `amicus doctor` duplicate-registration check + `doctor --fix` cleanup. **Fixed:** `amicus abort` now actually stops interactive sessions (marker watch) and MCP/wave aborts mark legs before killing + kill the Go server; graceful marker-first abort with grace-period kill. **Changed (BREAKING-adjacent):** postinstall no longer registers the legacy `sidecar` MCP server and auto-removes an identical-in-effect duplicate (customized entries untouched; plugin-channel installs use `doctor --fix`); `sidecar_*` tool aliases now opt-in via `AMICUS_LEGACY_ALIASES=1` — default tool list is 14 `amicus_*` tools; saved allowlists referencing `sidecar_*` need the env opt-in.
- [ ] **Step 3–7:** same ritual as Phase 2 Steps 3–7 with version `1.8.0` (minor — new features).

### Task 7.2: This-machine hygiene + live verification

- [ ] **Step 1:** `npm i -g amicus@1.8.0` (if the EEXIST bin clash hits, uninstall the stale `claude-sidecar` global first).
- [ ] **Step 2:** `amicus doctor` → expect the `mcp-legacy` check green already: Step 1's `npm i -g` ran postinstall's migration (Task 4.1), which removes the identical-in-effect duplicate `sidecar` entry from `~/.claude.json` AND `%APPDATA%\Claude\claude_desktop_config.json` on upgrade. Only if a dupe survives (e.g. postinstall warned about a write failure): run `amicus doctor --fix`, then re-run `amicus doctor` → all green.
- [ ] **Step 3:** Verify in a fresh Claude Code session: exactly one amicus MCP server, 14 `mcp__amicus__amicus_*` tools, zero `sidecar_*` tools.
- [ ] **Step 4:** Live abort check: `amicus start` (interactive), then from another shell `amicus abort <id>` → window closes within ~2–4s, session finalizes `aborted` (not `complete`).
- [ ] **Step 5:** Live wait check: MCP `amicus_start` (headless) then `amicus_wait` → returns on completion; confirm no sleep-loop needed.

## Phase 8 — Docs & skills sprint → v1.8.1

**Scope:** every item that actively misdirects Claude or users today: A8 (plugin quick start), A9 (tally recipe), A10 (MODEL-NOTES fork), B8 (judge hardening), B9 (cost-gate drift), B10 (sidecar skill description/boundary), B11 (docs accuracy), opp-8 (council hardening). Zero engine risk — docs/skills files only.

**Lane order:** ONE serial lane, exact order T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 (six tasks touch the same two SKILL.md files; T2/T5 append to the Operating Rules section T1 creates; T6 edits text T1/T4 wrote). Line anchors cited in T2–T6 for `skills/sidecar/SKILL.md` are PRE-T1 numbers — after T1 lands, match on text, not line numbers. No gate validates README/docs/skills content (generate-docs:check covers only CLAUDE.md markers + plans index), which is why every task adds a jest docs test to lock its fix in.

**Packaging facts (verified):** `package.json` `files` includes `skills/` — npm ships both skills; the plugin serves them from the repo (`.claude-plugin/plugin.json` skills array), so PLUGIN users get these edits on repo push + `/plugin update` without an npm publish; npm users need T9 (v1.8.1). **Postinstall nuance:** SKILL.md/COUNCIL-DESIGN.md are copied mode 'overwrite' on update, but MODEL-NOTES.md is 'if-missing' (user data by design) — existing npm installs never auto-receive T7's shipped MODEL-NOTES; T7's release-checklist fold-back step is the compensating control.

**Follow-up flagged, not scoped here (backlogged):** the second-opinion skill's frontmatter description is 1441 chars — over the 1024-char truncation limit too (its trailing NOT-clause is likely invisible); T1 fixes only the sidecar description per the review scope.


### Task 8.1 — T1 (B10+B11): sidecar SKILL.md overhaul — frontmatter shrink, Operating Rules section, guide→models, --session→--session-id, --model contradiction

**Files:** Modify: C:/Users/sendt/code/amicus/skills/sidecar/SKILL.md — frontmatter :1-31; insert new section after :35; :206-211; :260; :285-287; :407; :457; :463; :852; :915. Test (create): C:/Users/sendt/code/amicus/tests/skill-sidecar-docs.test.js

**Verified anchors:** All re-verified today at 509ab83: :407 'run `amicus guide`' confirmed ( `guide` is NOT a CLI command — bin/amicus.js switch has no case, falls to 'Unknown command'; `amicus models` is the alias lister). Bare `--session` at :211, :286, :457, :463, :852, :915 all confirmed; src/cli.js:26 confirms only `--session-id` exists (default 'current'). Contradiction confirmed: :260 says '--model | Must be present' vs :412 'Omit --model entirely to use your configured default'; code truth = optional (src/utils/config.js resolveModel: undefined → config.default; error only when neither: "No model specified and no default configured. Run 'amicus setup' to set a default model."; cli.js usage already says 'Optional (uses config default)'). Frontmatter description measured at 2180 chars (limit 1024 — currently truncated in the live skill list).

**Design:** Three moves. (1) Replace the whole frontmatter with name + a <1024-char description that is triggers + one boundary NOT-sentence, dropping the 'second opinion' trigger (it collides with the second-opinion skill) and pointing at the body for rules. (2) Create a '## Operating Rules' section immediately after the H1 intro paragraph and move the 7 CRITICAL RULES there verbatim-modulo-formatting (rule 6's example gains quotes around --models since we're rewriting the line anyway; T6 quotes the remaining occurrences). Downstream interface: T2 appends rule 8 (npx fallback) and T5 appends a budget-gate sentence to rule 4 — keep the rules a numbered markdown list so appends are trivial. (3) Point fixes: :206-211 Required/Recommended block (—model moves to Recommended with the default-fallback truth; --session → --session-id), :260 validation-table row rewritten to match code, :286/:457/:463/:852/:915 s/--session/--session-id/, :407 s/amicus guide/amicus models/.

**Code:**

```js
=== EDIT 1: frontmatter (replace lines 1-31 entirely) ===
---
name: sidecar
description: >
  Spawn a conversation with another LLM (Gemini, GPT, ChatGPT, Codex, o3, DeepSeek,
  Qwen, Grok, Mistral, or Claude as a target) and fold the results back into your
  context. TRIGGER when: the user asks to talk to, chat with, call, use, or spawn
  another LLM or model; names any non-current model; wants parallel exploration or
  a quick take from a different model; or says "sidecar", "fork", or "fold". This
  is NOT the skill for structured multi-model review of provided material — requests
  like "second opinion", "council review", or red-team/stress-test against criteria
  belong to the second-opinion skill. Before running any amicus command, read the
  Operating Rules section at the top of this document: background launches,
  --prompt-file briefings, interactive vs headless defaults, fanout for same-prompt
  multi-model runs, the o3/o3-pro cost warning, and the npx fallback when amicus is
  not on PATH.
---
(measure in the test: folded description must be < 1024 chars; draft above is ~860)

=== EDIT 2: insert after line 35 ('Spawn parallel conversations…context.') — NOTE: rule 4's `\$10-60+` escape is deliberate and REQUIRED: this rule moves from frontmatter into the skill BODY, where a bare `$1` is a slash-command substitution hazard (Task 9a's placeholder test enforces the escape) ===
## Operating Rules

These rules are mandatory for every amicus invocation in this skill:

1. **ALWAYS launch amicus CLI commands with the Bash tool's `run_in_background: true`.** Never run `amicus start/resume/continue` in the foreground.
2. **The fold summary returns on stdout** when the user clicks Fold in the GUI or the headless agent finishes. Use TaskOutput to read it when the background task completes.
3. **For long or multi-line briefings, write them to a temp file and pass `--prompt-file <path>`** (mutually exclusive with `--prompt`; avoids shell-quoting hazards and argument-size caps).
4. **NEVER use o3 or o3-pro unless the user explicitly asks for it by name.** These models are extremely expensive (\$10-60+ per request). If the user asks for o3, warn them about the cost before proceeding. Default to gemini for most tasks.
5. **When the user asks to query MULTIPLE LLMs simultaneously** (e.g., "ask Gemini AND ChatGPT", "compare Gemini vs GPT"), ALWAYS use `--no-ui` (headless) for all of them unless the user explicitly requests interactive. Opening multiple Electron windows at once is disruptive. Launch them all in parallel with `run_in_background: true`.
6. **When the SAME prompt should go to N models, use `amicus fanout --models "a,b,c" --prompt-file <path> --json`** (one headless wave, one JSON result) instead of N separate start calls. Different prompts per model → separate parallel `amicus start --no-ui` calls.
7. **For a SINGLE-model sidecar, DEFAULT to interactive** — omit `--no-ui` so the Electron UI opens and the user can watch, converse, and click Fold. Use `--no-ui` for a single model only when the user asks for headless/autonomous, or for unattended bulk automation. Interactive launches still use `run_in_background: true`.

=== EDIT 3: lines 206-213 ===
BEFORE:
**Required:**
- `--model`: The model to use (see Models below)
- `--prompt`: Detailed task description you generate

**Recommended:**
- `--session`: Your Claude Code session ID for accurate context passing
AFTER:
**Required:**
- `--prompt` (or `--prompt-file`): Detailed task description you generate

**Recommended:**
- `--model`: The model to use (see Models below). Omit it to use your configured default (`amicus setup`); the CLI errors only when neither an explicit model nor a configured default exists.
- `--session-id`: Your Claude Code session ID for accurate context passing

=== EDIT 4: line 260 (validation table row) ===
BEFORE:
| `--model` | Must be present, format: `provider/model` | `Error: --model is required` or `Error: --model must be in format provider/model` |
AFTER:
| `--model` | Optional — falls back to the config default. An explicit value must resolve to a known alias or `provider/model` | `Error: Unknown model alias '<x>' …` or `No model specified and no default configured. Run 'amicus setup' to set a default model.` |

=== EDIT 5: line 286 ===  '# Fix: Use 'current' or omit --session' → '# Fix: Use 'current' or omit --session-id'
=== EDIT 6: line 407 ===  'Use short aliases (run `amicus guide` to see all available aliases and their current model IDs):' → 'Use short aliases (run `amicus models` to see the live catalog, and `amicus models --check` to audit your aliases):'
=== EDIT 7: line 457 ===  '**Omit `--session`** or use `--session-id current`:' → '**Omit `--session-id`** or pass `--session-id current`:'
=== EDIT 8: line 463 ===  '3. Omit `--session` to use the most recent session' → '3. Omit `--session-id` to use the most recent session'
=== EDIT 9: line 852 ===  'Pass `--session` explicitly:' → 'Pass `--session-id` explicitly:'
=== EDIT 10: line 915 ===  '2. Omit `--session` to use the most recent session' → '2. Omit `--session-id` to use the most recent session'
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/skill-sidecar-docs.test.js (pattern copied from tests/free-council-skill-docs.test.js — plain fs read, no mocks). Run: `npm test -- tests/skill-sidecar-docs.test.js`. MUST FAIL on current main (desc=2180 chars, 'amicus guide' present, bare --session present, 'Must be present' present), pass after.

'use strict';
const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'skills', 'sidecar', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

describe('sidecar SKILL.md overhaul (B10/B11)', () => {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/)[1];
  const desc = fm.match(/description: >\n([\s\S]*)$/)[1]
    .split('\n').map(l => l.trim()).join(' ').trim();
  const body = raw.slice(raw.indexOf('\n---', 4) + 4);

  it('frontmatter description fits the 1024-char skill-list limit', () => {
    expect(desc.length).toBeLessThan(1024);
  });
  it('description drops the second-opinion trigger and adds the NOT boundary', () => {
    expect(desc).not.toMatch(/second opinion from another model/i);
    expect(desc).toMatch(/NOT/);
    expect(desc).toMatch(/second-opinion skill/);
  });
  it('the 7 operating rules moved into a top-of-body section', () => {
    expect(body).toMatch(/^## Operating Rules/m);
    expect(body.indexOf('## Operating Rules')).toBeLessThan(body.indexOf('## Installation'));
    for (const marker of ['run_in_background: true', 'TaskOutput', '--prompt-file', 'o3-pro', '--no-ui', 'fanout', 'DEFAULT to interactive']) {
      const rules = body.slice(body.indexOf('## Operating Rules'), body.indexOf('## Installation'));
      expect(rules).toContain(marker);
    }
  });
  it('no phantom `amicus guide` command', () => {
    expect(raw).not.toContain('amicus guide');
  });
  it('no bare --session flag (only --session-id exists in the CLI)', () => {
    expect(raw).not.toMatch(/--session(?![-\w])/);
  });
  it('--model documented as optional-with-default, not required', () => {
    expect(raw).not.toContain('Error: --model is required');
    expect(raw).toMatch(/--model.*(Optional|falls back|configured default)/i);
  });
});
```

**Risks:** Highest-contention task: T2, T5, T6 all edit this file after it — MUST land first in the lane. The frontmatter rewrite changes skill triggering behavior for every user (npm overwrite + plugin update): the dropped 'second opinion from another model' trigger is intentional (routes to the second-opinion skill) but call it out in the CHANGELOG (T9). The bare `--session` regex in the test uses a negative lookahead — keep `--session-id` and `--session-dir` legal. tests/postinstall-skill-source.test.js asserts the file path only, unaffected. eslint does not run on tests/ via lint-staged; `npm run lint` is src/-only. No 300-line gate for .md. Windows: file has LF endings in repo — Edit tool matches must not introduce CRLF.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.2 — T2 (A8): plugin quick-start truth — README install/configure/skill-location fixes + npx fallback rule in BOTH skills

**Files:** Modify: C:/Users/sendt/code/amicus/README.md:60, :70, :95-99, :116; C:/Users/sendt/code/amicus/skills/sidecar/SKILL.md (append rule 8 to the Operating Rules section created by T1 — post-T1 anchor, match on the rule-7 text); C:/Users/sendt/code/amicus/skills/second-opinion/SKILL.md (insert after :19). Test (create): C:/Users/sendt/code/amicus/tests/plugin-quickstart-docs.test.js

**Verified anchors:** All hold at 509ab83. README:60 = '**Install** — pick whichever fits; all deliver the same CLI, MCP server, and both skills:' — 'same CLI' is false for the plugin path: .claude-plugin/plugin.json registers the MCP server via `npx -y amicus@latest mcp` and the two skills; no npm bin shims land on PATH. README:95-99 = the bare '```bash\namicus setup\n```' configure block. README:116 = '…confirm it landed in `~/.claude/skills/second-opinion/`' — wrong for plugin installs (skills load from the plugin dir, not ~/.claude/skills; only postinstall.js copies there). second-opinion SKILL.md:19 = 'Before launching any model, READ `MODEL-NOTES.md`…' paragraph — first CLI-adjacent instruction; the first actual Bash amicus call is the Stage-1 fanout at :100. sidecar SKILL.md's first Bash instruction was the frontmatter CRITICAL RULES (now T1's Operating Rules).

**Design:** README: correct the three false claims without restructuring the section. Skills: one new operating rule each, phrased as a transport rule so it applies to EVERY command in the file rather than being repeated per-example. Interface consumed: T1's '## Operating Rules' numbered list (append as rule 8). Interface produced: the literal string 'npx -y amicus@latest' in both skills, which T2's test and T9's CHANGELOG reference.

**Code:**

```js
=== README.md:60 ===
BEFORE: **Install** — pick whichever fits; all deliver the same CLI, MCP server, and both skills:
AFTER:  **Install** — pick whichever fits. Every path delivers the MCP server and both skills; the `amicus`/`am` CLI lands on your PATH with the **npm and install-script paths** (the plugin path runs the CLI on demand via `npx -y amicus@latest <command>`):

=== README.md:70 ===
BEFORE: Claude Code registers the MCP server and both skills for you — nothing to configure. (The standalone Electron window is npm-only, and the first council/sidecar call downloads the OpenCode engine.)
AFTER:  Claude Code registers the MCP server and both skills for you — nothing to configure. (The plugin does not put `amicus` on your PATH — CLI calls go through `npx -y amicus@latest <command>`; the standalone Electron window is npm-only; and the first council/sidecar call downloads the OpenCode engine.)

=== README.md:95-99 ===
BEFORE:
**Configure:**

```bash
amicus setup
```
AFTER:
**Configure:**

```bash
amicus setup
# plugin-only install (no CLI on PATH):
npx -y amicus@latest setup
```

=== README.md:116 ===
BEFORE: …orchestrates the rest. You make the accept/deny calls at the end. (The `second-opinion` skill installed in the previous step is what teaches Claude to recognize this — if nothing happens, confirm it landed in `~/.claude/skills/second-opinion/`.)
AFTER:  …orchestrates the rest. You make the accept/deny calls at the end. (The `second-opinion` skill is what teaches Claude to recognize this — if nothing happens, run `amicus doctor` (or `npx -y amicus@latest doctor`). npm/install-script installs place the skill at `~/.claude/skills/second-opinion/`; plugin installs keep it inside the plugin itself — check `/plugin` in Claude Code to confirm amicus is enabled.)

=== skills/sidecar/SKILL.md — append to Operating Rules (after T1's rule 7) ===
8. **If `amicus` is not on PATH** (typical for plugin-only installs), run every command in this skill as `npx -y amicus@latest <args>` (e.g. `npx -y amicus@latest start --model gemini --prompt "..."`), or use the MCP tools (`amicus_start`, `amicus_status`, `amicus_read`, …) instead. Do not conclude the tool is broken because `amicus` is not found.

=== skills/second-opinion/SKILL.md — insert new paragraph after line 19 ===
**Transport rule — CLI not on PATH:** every command below assumes the `amicus` CLI. If `amicus` is not on PATH (typical for **plugin-only installs**), run the identical commands as `npx -y amicus@latest <args>` (e.g. `npx -y amicus@latest fanout --models "m1,m2,m3" --prompt-file <path> --json`), or use the equivalent MCP tools (`amicus_fanout`, `amicus_start`, `amicus_status`, `amicus_read`, `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict`) — council briefings are always self-contained (`--no-context`), so MCP transport is equivalent.
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/plugin-quickstart-docs.test.js. Run: `npm test -- tests/plugin-quickstart-docs.test.js`. Fails on main ('same CLI' present; no npx rule in either skill), passes after.

'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('plugin quick-start accuracy (A8)', () => {
  const readme = read('README.md');
  it('README no longer claims every install path delivers the same CLI', () => {
    expect(readme).not.toContain('all deliver the same CLI');
    expect(readme).toMatch(/npx -y amicus@latest/);
  });
  it('configure step offers the npx path for plugin installs', () => {
    const qs = readme.match(/## Quick start[\s\S]*?(?=\n## )/)[0];
    expect(qs).toMatch(/npx -y amicus@latest setup/);
  });
  it('skill-location hint covers plugin installs', () => {
    expect(readme).not.toMatch(/confirm it landed in `~\/.claude\/skills\/second-opinion\/`/);
    expect(readme).toMatch(/plugin installs keep it inside the plugin/i);
  });
  it.each(['skills/sidecar/SKILL.md', 'skills/second-opinion/SKILL.md'])(
    '%s carries the npx-fallback operating rule', (p) => {
      const s = read(p);
      expect(s).toMatch(/npx -y amicus@latest/);
      expect(s).toMatch(/not on PATH/i);
    });
});
```

**Risks:** Depends on T1 (appends to the Operating Rules list; if run before T1 the sidecar anchor does not exist — fall back to inserting after the frontmatter, but the lane order avoids this). README edits sit inside the Quick start section that tests/readme-requirements-deps.test.js and tests/ws4-quickwins.test.js assert on — neither asserts the strings we change ('all deliver the same CLI', configure block, :116 parenthetical); re-run both to confirm (`npm test -- tests/readme-requirements-deps.test.js tests/ws4-quickwins.test.js`). The second-opinion insert shifts every line number below :19 by ~1 paragraph — T3/T4/T5/T6 anchors for that file must match on TEXT after this lands (their before-strings are unique, so Edit-tool exact-match still works).


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.3 — T3 (A9): second-opinion Stage-2 tally recipe — add step 0 (meta + findings[]) and the five-keys checklist

**Files:** Modify: C:/Users/sendt/code/amicus/skills/second-opinion/SKILL.md:207-218 (pre-T2 numbering; match on the recipe heading text). Test (create): C:/Users/sendt/code/amicus/tests/skill-tally-recipe-docs.test.js

**Verified anchors:** All hold at 509ab83. SKILL.md:207 = '**Stage-2 → tally assembly recipe (Claude's work before calling `tally`):**' with steps 1-4 covering only id-rewrite/adjudications/rankings/runStats — `meta` and `findings[]` are never mentioned; confirmed missing. src/council/tally.js:84 = `const { meta, findings, rankings, adjudications, runStats } = input;` ✓; :90 = `const outFindings = findings.map(f => {` (throws the observed `Cannot read properties of undefined (reading 'map')` when findings is absent) ✓; :111 = `streetCred: computeStreetCred(rankings || [], meta.models)` ✓. Zod schema src/mcp-tools.js:305-312 ✓: meta{runId required, runType?, date?, models[] min(1) required, chair?, claudeInCouncil?}, findings[]{id, raiser, severity required; claim optional}; runStats is OPTIONAL (tally defaults it to []). The failure was hit for real in council run 7 (documented in the local MODEL-NOTES 2026-06-30 changelog entry).

**Design:** Insert a step 0 ahead of the existing steps 1-4 (markdown ordered lists render 0. fine as prose; keep the literal '0.' so the existing 1-4 stay untouched — minimal diff) and append the five-keys checklist line after step 4, immediately before the 'Then call:' line. Field names and requiredness copied from the zod schema so the recipe and the schema can be diffed mechanically. Interface produced: the checklist line's exact wording is referenced by T7 (local MODEL-NOTES reconciliation marks its run-7 schema lesson as 'now baked into SKILL.md').

**Code:**

```js
=== skills/second-opinion/SKILL.md — insert after the recipe heading line ('**Stage-2 → tally assembly recipe (Claude's work before calling `tally`):**'), before existing step '1. **Rewrite finding ids…' ===
0. **Build `meta` and `findings[]` first — `tally` requires both** (missing either fails with `BAD_ARGS: Cannot read properties of undefined (reading 'map')`):
   - `meta` = `{ "runId": "<run-folder stem>", "models": [<every reviewed model id, including "claude" when the toggle is on — this is the street-cred universe>], "chair": "<confirmed chair model id>", "claudeInCouncil": <Stage-0 toggle> }`. Optional extras: `runType`, `date`.
   - `findings[]` = one entry per finding across ALL reviews: `{ "id": "<run-global label id from step 1, e.g. A1>", "raiser": "<de-anonymized model that raised it>", "severity": "<from the review JSON>" }` (`claim` may be carried along but is not required).

=== insert after existing step 4 ('…Attach `role` … as council-domain labels.'), before 'Then call:' ===
**Five-keys checklist — verify `tally-input.json` has ALL of:** `meta` (with `meta.models`), `findings`, `adjudications`, `rankings`, `runStats` (`runStats` may be `[]`; the other four are required). Do not call `tally` until all five are present.
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/skill-tally-recipe-docs.test.js. Run: `npm test -- tests/skill-tally-recipe-docs.test.js`. Fails on main (recipe section contains neither 'meta.models' nor 'claudeInCouncil' nor a findings-array step), passes after.

'use strict';
const fs = require('fs');
const path = require('path');
const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8');

describe('Stage-2 tally assembly recipe (A9)', () => {
  const recipe = skill.slice(
    skill.indexOf('Stage-2 → tally assembly recipe'),
    skill.indexOf('amicus council tally'));
  it('recipe builds meta with the schema-required fields', () => {
    expect(recipe).toContain('runId');
    expect(recipe).toContain('claudeInCouncil');
    expect(recipe).toMatch(/"?models"?/);
    expect(recipe).toContain('chair');
  });
  it('recipe builds findings[] with {id, raiser, severity}', () => {
    expect(recipe).toMatch(/findings\[\]/);
    expect(recipe).toMatch(/raiser/);
    expect(recipe).toMatch(/severity/);
  });
  it('carries the five-keys checklist and the known failure signature', () => {
    expect(recipe).toMatch(/meta.*findings.*adjudications.*rankings.*runStats/s);
    expect(recipe).toContain("reading 'map'");
  });
});

Sanity cross-check (not a new test): tests/council/tally.test.js already exercises tally() with meta+findings fixtures — read it to confirm field names match before finalizing wording.
```

**Risks:** Same-file contention with T2 (inserts at :19), T4, T5, T6 — text-anchored edits are safe in any relative order but the lane runs T3 third. Keep the recipe wording consistent with the MCP zod .describe() strings (mcp-tools.js:309, :312) — if a future engine phase (Phase 5/6 in other clusters touching src/mcp-tools.js, the historical serialization hub) renames a field, this doc must follow; the test's field-name assertions will catch drift only in the skill, not the schema, so consider it a tripwire not a contract. No gates affected (md-only).


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.4 — T4 (B8): judge/chair hardening — bake the no-tools preamble into Stage-2 and Stage-3 briefing instructions + scratch-cwd advice

**Files:** Modify: C:/Users/sendt/code/amicus/skills/second-opinion/SKILL.md — Stage 2 block :181-203 (insert after the '(Background, same JSON handling as Stage 1.)…' paragraph, before '**Task A — Rank.**') and Stage 3 chair-briefing block :234-252 (insert after 'The run document's `summary` is the verdict. The packet contains:' list intro — pre-T2/T3 numbering; match on text). Test (create): C:/Users/sendt/code/amicus/tests/skill-judge-hardening-docs.test.js

**Verified anchors:** Hold at 509ab83: :181-203 is the Stage-2 distribution + Task A/Task B text; the chair briefing is :234-252 (the brief's ':181-203' anchor covers the judge text; chair text verified separately). The incident basis is real and documented in the LOCAL MODEL-NOTES (C:/Users/sendt/.claude/skills/second-opinion/MODEL-NOTES.md:63-67): run-5 Gemini Stage-2 leg read files instead of adjudicating, returned narration only; plus the anonymization-leak risk — a Plan-agent judge CAN read the de-anonymized `review-<model>.md` files sitting in the run folder. `--agent Plan` is read-only for WRITES but tools/reads are available (sidecar SKILL.md agent table). `--cwd` validation requires the directory to exist (sidecar SKILL.md:262 + validators), and sessions are recorded under `<cwd>/.claude/amicus_sessions/` (docs/troubleshooting.md:47) — hence the scratch-cwd caveat below.

**Design:** Two insertions, one exact-wording requirement. The preamble string is fixed verbatim per the plan: 'Do NOT use any tools or read any files; everything is in this message; begin immediately with A1:' for judges; the chair variant keeps the first two clauses verbatim and swaps the tail ('…begin immediately with the verdict.') since a chair does not emit A1. Scratch-cwd is advisory (secondary defense) with the session-location caveat spelled out so an engineer/user isn't surprised when `amicus read` needs the same --cwd.

**Code:**

```js
=== INSERT 1: Stage 2 — after the paragraph ending '…Each judge is asked to do two things on the bundle:' would read oddly; place it after the '(Background, same JSON handling as Stage 1.) … tier definitions are unchanged (they already count "judges engaged").' paragraph and BEFORE 'Each judge is asked to do two things on the bundle:' ===

**Judge-briefing hardening (required).** Open `_tmp-bundle-stage2.md` with this preamble, verbatim, as its first line:

> Do NOT use any tools or read any files; everything is in this message; begin immediately with A1:

Plan-agent judges have wandered to tools mid-adjudication (reading files instead of judging and returning only narration), and a tool-capable judge can read the de-anonymized `review-<model>.md` files in the run folder — an anonymization leak. The preamble closes both. **Scratch-cwd (optional second layer):** launch the Stage-2 wave (and the Stage-3 chair call) with `--cwd <run-folder>/_scratch/` — create the empty directory first — so even a wandering agent finds nothing to read. Caveat: those legs' session records then live under `_scratch/.claude/amicus_sessions/`, so any later `amicus read <taskId>` for them needs the same `--cwd`.

=== INSERT 2: Stage 3 — after 'The run document's `summary` is the verdict. The packet contains:' bullet list (i.e., after the '- All adjudication outputs…' bullet) and before 'Instruct the chair to write a **synthesized verdict** that:' ===

Open `_tmp-chair-packet.md` with the no-tools preamble, adjusted for the chair: *'Do NOT use any tools or read any files; everything is in this message; begin immediately with the verdict.'* The packet is complete by construction — the chair must never go looking for files.
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/skill-judge-hardening-docs.test.js. Run: `npm test -- tests/skill-judge-hardening-docs.test.js`. Fails on main (preamble string absent from the repo SKILL.md), passes after.

'use strict';
const fs = require('fs');
const path = require('path');
const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8');
const PREAMBLE = 'Do NOT use any tools or read any files; everything is in this message; begin immediately with A1:';

describe('judge/chair no-tools hardening (B8)', () => {
  it('Stage 2 requires the exact judge preamble', () => {
    const stage2 = skill.slice(skill.indexOf('### Stage 2'), skill.indexOf('### Stage 3'));
    expect(stage2).toContain(PREAMBLE);
    expect(stage2).toMatch(/anonymization leak/i);
  });
  it('Stage 3 chair packet opens with the no-tools preamble', () => {
    const stage3 = skill.slice(skill.indexOf('### Stage 3'), skill.indexOf('### Stage 4'));
    expect(stage3).toMatch(/Do NOT use any tools or read any files; everything is in this message/);
  });
  it('scratch-cwd advice present with the session-location caveat', () => {
    expect(skill).toMatch(/_scratch/);
    expect(skill).toMatch(/--cwd/);
  });
});
```

**Risks:** Same-file lane contention (after T2/T3). The T5 task edits SKILL.md:148 and adds a chair-call budget note near the same Stage-3 command block — keep insertions physically separate (T4 inserts after the packet-contents list; T5 appends after the chair command fence) to avoid Edit-tool ambiguity. The scratch-cwd advice interacts with the v1.7.6 project-root sandbox for MCP `project`/`cwd` inputs (CHANGELOG 1.7.6 Security): a run-folder under `output/` inside the project or home dir passes the allow-list, so no conflict — but if a run folder is ever outside home, MCP-transport councils would have the cwd rejected; the CLI path is unaffected. Wording deliberately says 'optional second layer'.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.5 — T5 (B9): cost-gate drift — fix the false solo-start exemption, add --max-cost/--no-cost-gate pass-through for repair/chair calls, budget-gate note in sidecar o3 rule

**Files:** Modify: C:/Users/sendt/code/amicus/skills/second-opinion/SKILL.md:148 (the parenthetical inside Stage-1 repair step 1) + Stage-3 chair command block (~:242, after the ``` fence); C:/Users/sendt/code/amicus/skills/sidecar/SKILL.md Operating Rules rule 4 (post-T1 anchor). Test (create): C:/Users/sendt/code/amicus/tests/skill-cost-gate-docs.test.js

**Verified anchors:** All hold at 509ab83. SKILL.md:148 = '(Solo `start` is **not** subject to the WS-2 fanout cost gate, so a repair cannot be refused mid-council.)' — FALSE: src/cli-handlers-run.js:58-67 runs checkBudget() for solo start whenever `--no-cost-gate` is absent, exiting with BUDGET_EXCEEDED; fanout equivalent at src/sidecar/fanout.js:157-164. `--max-cost` parsed as float (src/cli.js:138), `no-cost-gate` boolean flag (src/cli.js:124); default threshold $60/Mtok blocks o3-pro (~$80) while allowing opus/o3/gemini-pro (src/sidecar/budget.js:17-22). Sidecar skill o3 rule = T1's Operating Rules rule 4 (was frontmatter CRITICAL RULE 4).

**Design:** Three text edits. (1) Replace the :148 parenthetical with the truth + the operational consequence (pass-through). (2) A one-line note after the Stage-3 chair command so the chair call — the most expensive single leg — never gets refused mid-run surprisingly. (3) Append the code-enforcement sentence to sidecar rule 4 so the skill stops implying the o3 guard is memory-only. Interface consumed: T1's Operating Rules list.

**Code:**

```js
=== skills/second-opinion/SKILL.md:148 ===
BEFORE: …"re-emit only the findings JSON, fixing: \<errors\>." Keep the first-pass prose. (Solo `start` is **not** subject to the WS-2 fanout cost gate, so a repair cannot be refused mid-council.)
AFTER:  …"re-emit only the findings JSON, fixing: \<errors\>." Keep the first-pass prose. (Solo `start` passes through the **same budget gate** as `fanout`. If launching the wave required `--max-cost <$>` or `--no-cost-gate`, pass the **same flag on every repair re-prompt and on the chair call** — otherwise the gate can refuse a repair or the chair mid-council.)

=== skills/second-opinion/SKILL.md — append one line after the Stage-3 chair command's closing ``` fence (the `amicus start --model <chair> …` block at ~:237-241) ===
(The budget gate applies to this solo call too — if Stage 0 needed `--max-cost <$>` or `--no-cost-gate` to launch the wave, the chair call needs the same flag.)

=== skills/sidecar/SKILL.md — Operating Rules rule 4, append after '…Default to gemini for most tasks.' ===
The CLI enforces this in code: a built-in budget gate refuses any model above a per-$/Mtok threshold (o3-pro class) before launch unless you pass `--no-cost-gate`; `--max-cost <$>` sets a soft estimated-total ceiling. When a run is refused with `BUDGET_EXCEEDED`, relay the gate's message — don't silently retry with the flag.
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/skill-cost-gate-docs.test.js. Run: `npm test -- tests/skill-cost-gate-docs.test.js`. Fails on main (exemption sentence present; sidecar skill has no budget-gate mention), passes after.

'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('cost-gate doc drift (B9)', () => {
  const council = read('skills/second-opinion/SKILL.md');
  const sidecar = read('skills/sidecar/SKILL.md');
  it('the false solo-start exemption is gone', () => {
    expect(council).not.toMatch(/not\*?\*? subject to the WS-2 fanout cost gate/);
  });
  it('repair + chair calls carry the pass-through instruction', () => {
    expect(council).toMatch(/same flag on every repair re-prompt and on the chair call/);
    const stage3 = council.slice(council.indexOf('### Stage 3'), council.indexOf('### Stage 4'));
    expect(stage3).toMatch(/--no-cost-gate|--max-cost/);
  });
  it('sidecar o3 rule documents the in-code budget gate', () => {
    expect(sidecar).toMatch(/budget gate/i);
    expect(sidecar).toMatch(/--no-cost-gate/);
  });
});
```

**Risks:** Depends on T1 (rule-4 anchor) and shares Stage-3 real estate with T4 — T4 inserts BEFORE the chair command block region ends (after the packet list), T5 appends AFTER the command fence; both before-strings are unique so exact-match editing is safe, but land T4 first per the lane order. Coupling watch: if the in-flight engine phases change the gate default ($60/Mtok, budget.js:22) or make repair calls gate-exempt for real, this text must be revisited — the doc now states behavior, not policy, which is the correct direction of dependency.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.6 — T6 (opp-8): council hardening — quote --models everywhere, current-date injection rule, report.html as the default final artifact + inline verdict summary

**Files:** Modify: C:/Users/sendt/code/amicus/skills/second-opinion/SKILL.md (:100 and :185 fanout commands; Stage-0 'Prepare material' bullets :48-56; Stage-5 renderer bullet :310-316 and :318; Output & naming list :424-434 — pre-T2..T5 numbering, match on text); C:/Users/sendt/code/amicus/skills/sidecar/SKILL.md:306 (+ the T1-moved rule 6 already quoted); C:/Users/sendt/code/amicus/README.md:306; C:/Users/sendt/code/amicus/docs/usage.md:11, :65-66. Test (create): C:/Users/sendt/code/amicus/tests/skill-council-hardening-docs.test.js

**Verified anchors:** Hold at 509ab83. Unquoted `--models <m1,m2,m3>` at second-opinion SKILL.md:100 and :185; unquoted `--models gemini,gpt,deepseek` at sidecar SKILL.md:306, README.md:306, docs/usage.md:11/:65/:66. PowerShell comma-split failure is a documented real incident (local MODEL-NOTES run-5 note, 2026-06-14 changelog). Date-injection incident: run 6 (GPT+DeepSeek 'future-dated' false blocker, local MODEL-NOTES:36-40). `amicus council report <verdict.json> --html` verified: src/cli-handlers-council.js:60-88 (`--html` → buildReport format html; default md); SKILL.md's current renderer bullet (:310-316) only pipes `--md > report.md`. 'Where SKILL.md describes final output' = Stage-5 run-folder artifact list + ':318 Tell the user exactly which files were written and where.' + the Output & naming section.

**Design:** (1) Quoting: mechanical s/--models <list>/--models "<list>"/ across both skills; also README + usage.md for consistency (Windows-first project; quotes are harmless in bash). (2) Date rule: one bullet in Stage-0 'Prepare material' (the place every briefing is composed). (3) Final artifact: extend the Stage-5 renderer bullet to emit BOTH report.md and report.html, name report.html the default artifact to hand the user, add report.html to Output & naming, and replace :318 with a hand-off instruction requiring an inline verdict summary in chat (aligns with the user's standing 'present docs inline' preference).

**Code:**

```js
=== second-opinion SKILL.md:100 ===
BEFORE: amicus fanout --models <m1,m2,m3> --prompt-file <run-folder>/_tmp-briefing-stage1.md --json \
AFTER:  amicus fanout --models "<m1,m2,m3>" --prompt-file <run-folder>/_tmp-briefing-stage1.md --json \
(add immediately below the fence:) Always quote the `--models` list — unquoted, PowerShell splits on commas and the CLI receives one mangled alias (instant arg-parse failure).

=== second-opinion SKILL.md:185 ===  same change: --models "<m1,m2,m3>"

=== second-opinion SKILL.md — Stage 0, append bullet to the 'Prepare material for council models:' list (after the `_tmp-*` cleanup bullet, :53-56) ===
- **Inject the current date into every briefing when the artifact is time-sensitive** (resumes, dated
  plans, anything with start/end dates or 'present' ranges). Headless council models do not reliably
  know "today" and have raised false "future-dated" blockers; state the date explicitly, e.g.
  "Today's date is YYYY-MM-DD."

=== second-opinion SKILL.md — Stage-5 renderer bullet (:310-316) ===
BEFORE:  - **Renderer:** once `verdict.json` is written, generate the human report with
    `amicus council report <run-folder>/verdict.json --md > <run-folder>/report.md`
    (use `--html` for a self-contained, shareable page). This emits the …
AFTER:   - **Renderer:** once `verdict.json` is written, generate BOTH renderings:
    `amicus council report <run-folder>/verdict.json --md > <run-folder>/report.md` and
    `amicus council report <run-folder>/verdict.json --html > <run-folder>/report.html`.
    **`report.html` is the default final artifact to hand the user** — a self-contained,
    shareable page. This emits the … (rest of the bullet unchanged)

=== second-opinion SKILL.md:318 ===
BEFORE: Tell the user exactly which files were written and where.
AFTER:  Tell the user exactly which files were written and where, leading with `report.html`, **and present the verdict inline in chat** — the chair's overall assessment (verbatim or lightly trimmed) plus the tier counts (Confirmed/Disputed/Contested/Singleton) and what was applied. Never hand over only file paths.

=== second-opinion SKILL.md — Output & naming list (:429 area): add after the report.md bullet ===
  - `report.html` — the same report rendered as a self-contained page (`amicus council report <verdict.json> --html`); the default artifact to share.

=== sidecar SKILL.md:306 ===  amicus fanout --models "gemini,gpt,deepseek" --prompt-file ./briefing.md --json
=== README.md:306 ===        amicus fanout --models "gemini,deepseek,gpt" --prompt "Review this design" --json
=== docs/usage.md:11 ===     amicus fanout --models "gemini,deepseek,gpt" --prompt "Review this" --json
=== docs/usage.md:65-66 ===  quote both example lines the same way
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/skill-council-hardening-docs.test.js. Run: `npm test -- tests/skill-council-hardening-docs.test.js`. Fails on main (unquoted --models in both skills; no date rule; no report.html), passes after.

'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('opp-8 council hardening', () => {
  it.each(['skills/second-opinion/SKILL.md', 'skills/sidecar/SKILL.md'])(
    '%s has no unquoted --models example', (p) => {
      // an unquoted list = --models followed by a bare token containing a comma
      expect(read(p)).not.toMatch(/--models\s+(?!["'])\S*,/);
    });
  it('Stage 0 mandates current-date injection for time-sensitive artifacts', () => {
    const s = read('skills/second-opinion/SKILL.md');
    const stage0 = s.slice(s.indexOf('### Stage 0'), s.indexOf('### Stage 1'));
    expect(stage0).toMatch(/current date/i);
    expect(stage0).toMatch(/future-dated/i);
  });
  it('report.html is the default final artifact and the verdict is presented inline', () => {
    const s = read('skills/second-opinion/SKILL.md');
    expect(s).toMatch(/report\.html/);
    expect(s).toMatch(/--html > <run-folder>\/report\.html|--html/);
    expect(s).toMatch(/present the verdict inline in chat/i);
    expect(s).toMatch(/Never hand over only file paths/i);
  });
});
```

**Risks:** Touches BOTH skill files plus README/usage.md — run sixth, after T1-T5, before T7/T8 (T8 also edits usage.md but in disjoint regions: T6 quotes example lines :11/:65-66; T8 adds command rows :19-28 and the MCP list :135 — no overlap). The unquoted-`--models` regex in the test intentionally also polices future examples. buildReport --html verified present since the council-report feature landed; if an in-flight phase renames the subcommand, tests/council/report.test.js would break first. The :318 rewrite encodes the user's standing 'present docs inline' preference into the shipped skill — flag in the T9 CHANGELOG as a behavior change.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.7 — T7 (A10): MODEL-NOTES reconciliation — port runs 4-7 lessons into the shipped file, define the shipped/local split, add the release-checklist fold-back, reconcile WS-3 into the local copy

**Files:** Modify: C:/Users/sendt/code/amicus/skills/second-opinion/MODEL-NOTES.md (major); C:/Users/sendt/code/amicus/skills/second-opinion/SKILL.md (Files section :444 + Stage-6 intro :324-326 — match on text); C:/Users/sendt/code/amicus/docs/publishing.md (append '## Release checklist'). Modify OUTSIDE the repo (machine-local, NOT committed): C:/Users/sendt/.claude/skills/second-opinion/MODEL-NOTES.md. Test (create): C:/Users/sendt/code/amicus/tests/model-notes-shipped-docs.test.js

**Verified anchors:** Diffed both files today. Shipped copy (repo): last updated 2026-06-10, has only Gemini/DeepSeek/GPT sections, WS-3 text (ledger-authoritative stats + in-code budget gate). Local copy (~/.claude/...): last updated 2026-06-30 with runs 4-7 but PRE-WS-3 text (hand-maintained reliability table lines 185-204; old memory-only 'Cost guardrail' lines 206-208). Install semantics verified: scripts/postinstall.js:28-33 — SKILL.md/COUNCIL-DESIGN.md mode 'overwrite', MODEL-NOTES.md mode 'if-missing' → the installed copy IS the durable machine-local ledger; shipped updates never clobber it (and never reach existing installs). Release docs: the repo has NO release checklist today; docs/publishing.md is the only release doc (verified) → that is the proposed location. LESSONS FOUND IN THE LOCAL COPY TO PORT (enumerated): (1) run-5 PowerShell `--models` comma-split → quote lists; (2) run-6 current-date injection (GPT+DeepSeek false 'future-dated' blocker; Gemini refuted); (3) run-7 long-artifact (80k+ words) agentic reads break gemini-flash (narrate-stall, then 25-min timeout) and kimi (poller 'Incomplete' at 85 s) while gpt/deepseek/grok handled it; (4) run-7 v1.6.0 tally schema needs meta.models + findings[] (BAD_ARGS 'reading map'); (5) Stage-2 tip: telling judges severity inflation justifies `dispute` sharpens adjudications (validated 2026-06-11); (6) Stage-2 tip: Plan-agent judges wander to tools → no-tools preamble + anonymization-leak risk; (7) Stage-6 UX: proposed diff must ship as a run-folder file with its path in the approval prompt; (8) per-model: Gemini — red-team aptitude, inconsistent blind self-votes (discount either way), alias→flash = shallow coverage but recurring sharp fact-checker, unreliable on long agentic reads; DeepSeek — clean chair 5×, severity-inflating Stage-1 reviewer (typos→'blocker'), 'agree-with-the-adversary' lean; GPT — genuine #1 in run 4 (non-self-vote), asserts context-dependent facts (dates) without verifying, handled 82k-word read cleanly; NEW sections: Grok (fast cheap red-teamer; observational findings bench-confirmed, interpretive overreach disputed; honest blind self-rank), Kimi (sharpest adjudicator; very slow 5-7-min legs gate wave wall-clock; stalls on long agentic reads), Mistral (fast, real catches, but fabricated product models/specs — 2 judges disputed; cross-check every product claim), Claude-in-council (most calibrated, 1.33-1.67 street-cred best in runs 6-7, least original in run 6, backbone of Confirmed tier in run 7).

**Design:** THE SPLIT: (a) shipped `skills/second-opinion/MODEL-NOTES.md` = versioned mechanics + durable per-model quirks — no run-by-run ledger numbers (stats live in `amicus council stats`), changelog kept but trimmed to lesson-bearing entries; (b) machine-local ledger = the installed copy at `~/.claude/skills/second-opinion/MODEL-NOTES.md` (already preserved across updates via if-missing). No new path is invented — SKILL.md Stage 6 keeps writing to 'MODEL-NOTES.md next to this file' and gains one sentence naming the split + fold-back. (c) Fold-back = a new '## Release checklist' in docs/publishing.md whose first item is: diff the machine-local MODEL-NOTES against the shipped one and port durable lessons (this exact task is the first execution of that step). (d) WS-3 reconciliation INTO the local copy: replace its stale hand-table framing and memory-only cost rule with the shipped WS-3 text; keep the historical table as an explicitly-archival block. Sequencing: run AFTER T3/T4/T6 so lesson #4/#6/#1/#2 can be recorded as 'now baked into SKILL.md' pointers instead of duplicated prose (keep-it-tight rule).

**Code:**

```js
=== A) skills/second-opinion/MODEL-NOTES.md (shipped) — additions/replacements; unchanged sections elided, marked ✂ ===
_Last updated: <today> (runs 4-7 folded back from the field ledger: PowerShell quoting, date injection, long-read failures, judge tool-wander; see changelog)._

## Global operating rules (all models)
✂ (existing 8 bullets unchanged) — APPEND:
- **PowerShell `--models` quoting (Windows):** always quote comma-separated model lists —
  `--models "gemini,gpt,deepseek"`. Unquoted, PowerShell splits on commas and amicus receives one
  mangled alias → instant arg-parse failure. (Now baked into every SKILL.md example.)
- **Inject the current date into briefings for time-sensitive artifacts** (resumes, dated plans).
  Headless models don't reliably know "today": one run produced a false "future-dated" blocker two
  judges then confirmed. (Now a Stage-0 rule in SKILL.md.)
- **Very long artifacts (80k+ words) break the agent-reads-the-file transport for some models.**
  gpt/deepseek/grok have handled 82k-word agentic reads; gemini(-flash) and kimi stalled (narrate-
  stall / 25-min timeout / poller "Incomplete"). Pre-select proven long-read models or inline the
  text for large-context models.
- **Stage-6 approvals:** write the proposed MODEL-NOTES diff to a run-folder file and put that path
  in the approval prompt — chat-text diffs can be hidden behind the approval dialog.

## Stage-2 cross-review briefing tips
✂ (existing 3 bullets unchanged) — APPEND:
- Telling judges that **material severity inflation can justify a `dispute`** sharpens adjudications.
- **Plan-agent judges can wander to tools** (reading run-folder files = anonymization leak). The
  no-tools preamble is now mandatory in SKILL.md Stage 2/3 — keep it verbatim.
- The tally input needs **all five keys** (`meta` incl. `meta.models`, `findings`, `adjudications`,
  `rankings`, `runStats`) — see the SKILL.md Stage-2 recipe step 0.

## Per-model notes
### Gemini ✂ (existing bullets) — APPEND:
- **Red-team:** takes an adversarial brief well — high variance by design; use when consensus risk is high.
- **Blind self-votes are inconsistent** (self-#1 in some runs, self-last in others) → discount self-votes either way.
- Alias has resolved to **flash** tiers: fast, shallowest coverage, yet a recurring sharp fact/consistency checker (it alone refuted a bench-wide date error). Cheap cross-check value.
- **Unreliable on long agentic reads** (see global rule) — inline the text or swap models for book-length material.
### DeepSeek ✂ — APPEND:
- Proven chair (5 clean chairings) — decisive, well-structured synthesis.
- As a Stage-1 reviewer of human-facing documents it **over-escalates severity** (typos/tenure → "blocker"); discount its blocker labels against peers. Prune its self-retractions when tallying.
- **"Agree-with-the-adversary" lean:** it has been the lone endorser of a red-team's harshest claims, turning them Contested — cross-check before treating its lone agreements as consensus.
### GPT ✂ — APPEND:
- Ranked genuine #1 by all judges (incl. non-self) in one run — thoroughness is real, not a self-vote artifact. Handled an 82k-word agentic read cleanly.
- **Asserts context-dependent facts (dates, "is this future?") without verifying** — and self-confirms them in adjudication. Cross-check any time-dependent claim it raises.
- A good calibration anchor in cross-review: confirms observational findings, disputes interpretive overreach.
### Grok  (`--model grok` → via OpenRouter)  [NEW SECTION]
- Very fast legs; credible judge and chair (rejected its own weak findings as chair; honest blind self-rank).
- Strong red-team fit; handled an 82k-word agentic read. Weight its **observational** catches heavily and its **interpretive** verdicts cautiously (bench pattern: the former confirmed, the latter disputed).
- Stage-1 non-red-team reviews skew to scope-inflated "missing content" majors.
### Kimi  (`--model kimi` → via OpenRouter)  [NEW SECTION]
- The bench's sharpest adjudicator (caught strawmen and misreads other judges waved through).
- **Very slow legs (5-7 min)** — it gates wave wall-clock; budget timeouts around it.
- Stalls on long agentic reads (poller "Incomplete" with only a preamble). Reserve for short-artifact adjudication.
### Mistral  (`--model mistral` → via OpenRouter)  [NEW SECTION]
- Fast, broad coverage, catches real issues.
- **Hallucination risk is real:** has invented non-existent product models/specs, disputed independently by two judges. Cross-check every specific model number or product claim it introduces.
### Claude  (in-council, when toggle on)  [NEW SECTION]
- Consistently the most *calibrated* reviewer (no severity inflation; findings overwhelmingly Confirmed; bench-best street-cred in recent runs) but sometimes the least *original* — it can miss the boldest single catch. Treat as a reliability floor, not a discovery engine.
✂ (Reviewer-reliability / Free-tier / Cost guardrail / General sections unchanged — they are already WS-3-correct in the shipped file)
## Lessons changelog
✂ (existing entries) — APPEND one consolidated entry:
- **<today>** — Folded back field lessons from runs 4-7 (AV-receiver, pork-shoulder, resume, novel ×2 councils): PowerShell `--models` quoting; current-date injection; long-read model selection; judge no-tools preamble; severity-inflation-justifies-dispute; five-keys tally schema; new Grok/Kimi/Mistral/Claude-in-council sections. Quantitative history stays in the ledger (`amicus council stats`).

=== B) skills/second-opinion/SKILL.md — Stage 6, after 'This stage updates `MODEL-NOTES.md` to make future runs better.' sentence (:324) APPEND ===
The `MODEL-NOTES.md` **next to this file** is your machine-local run ledger: npm updates never overwrite it (it is installed only if missing), so lessons accumulate per machine. Durable, machine-independent lessons get folded back into the version-controlled copy in the amicus repo at release time (see the release checklist in `docs/publishing.md`).
=== and Files section (:444) — extend the MODEL-NOTES bullet's last sentence ===
…comes from `amicus council stats`, not this file. This copy is machine-local (never overwritten on update); the shipped seed lives in the amicus repo and absorbs durable lessons at release time.

=== C) docs/publishing.md — append ===
## Release checklist

Run top-to-bottom before `npm version`:

1. **MODEL-NOTES fold-back:** diff the machine-local ledger (`~/.claude/skills/second-opinion/MODEL-NOTES.md`) against the shipped seed (`skills/second-opinion/MODEL-NOTES.md`); port durable, machine-independent lessons into the shipped file (merge/prune, keep it tight — no run-ledger numbers, those live in `amicus council stats`).
2. `npm test` green; `npm run lint` clean.
3. `npm run generate-docs:check` passes (CLAUDE.md markers + cross-links).
4. Bump `.claude-plugin/plugin.json` `version` to match `package.json` (no script syncs it).
5. Update `CHANGELOG.md` (move Unreleased → the new version).
6. `npm version <x.y.z> --no-git-tag-version` + plugin.json lockstep, single `chore(release): vX.Y.Z` commit, then push main + tag (publish.yml does the rest — see the canonical ritual in Phase 2 of the 2026-07-01 review-execution plan).

=== D) MACHINE-LOCAL (not committed): C:/Users/sendt/.claude/skills/second-opinion/MODEL-NOTES.md ===
- Replace the 'Reviewer-reliability table' intro (lines 185-193) with the shipped WS-3 'Reviewer-reliability' text (ledger-authoritative; 'Do not hand-edit reliability numbers here'); demote the existing table under a heading '### Archived hand-scored table (pre-WS-3, runs 2-7 — superseded by `amicus council stats`)'.
- Replace the 'Cost guardrail' section (lines 207-209 after the archived-table heading above is inserted) with the shipped WS-3 version (in-code budget gate; `--no-cost-gate` / `--max-cost` semantics).
- Update the run-7 five-keys bullet (lines 48-52) to end: '(Baked into SKILL.md Stage-2 recipe step 0 as of v1.8.1.)'
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/model-notes-shipped-docs.test.js. Run: `npm test -- tests/model-notes-shipped-docs.test.js`. Fails on main (no Grok/Kimi/Mistral sections, no PowerShell/date/long-read rules, no release checklist), passes after.

'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('shipped MODEL-NOTES carries runs 4-7 durable lessons (A10)', () => {
  const notes = read('skills/second-opinion/MODEL-NOTES.md');
  it.each(['### Grok', '### Kimi', '### Mistral', '### Claude'])('has section %s', h => {
    expect(notes).toContain(h);
  });
  it('carries the three new global rules', () => {
    expect(notes).toMatch(/PowerShell/);
    expect(notes).toMatch(/current date/i);
    expect(notes).toMatch(/80k\+|long agentic read/i);
  });
  it('stays WS-3: no hand-maintained reliability table, budget gate in code', () => {
    expect(notes).not.toMatch(/\| model \| runs \| avg street-cred/);
    expect(notes).toMatch(/amicus council stats/);
    expect(notes).toMatch(/--no-cost-gate/);
  });
  it('publishing.md gained the fold-back release checklist', () => {
    const pub = read('docs/publishing.md');
    expect(pub).toMatch(/## Release checklist/);
    expect(pub).toMatch(/MODEL-NOTES fold-back/);
    expect(pub).toMatch(/plugin\.json/);
  });
  it('SKILL.md names the machine-local/shipped split', () => {
    const s = read('skills/second-opinion/SKILL.md');
    expect(s).toMatch(/installed only if missing|never overwrite/i);
    expect(s).toMatch(/docs\/publishing\.md/);
  });
});

Also re-run the existing guard: `npm test -- tests/free-council-skill-docs.test.js` (it asserts the shipped MODEL-NOTES keeps a free-tier section — do not drop it during the rewrite).
```

**Risks:** Biggest wording task — the run-lesson port must stay QUALITATIVE (no street-cred numbers) or it recreates the WS-3 drift it fixes; the test's no-hand-table regex enforces this. The machine-local edit (D) is OUTSIDE the repo and outside the worktree — the implementing subagent needs explicit permission to write to C:/Users/sendt/.claude/skills/second-opinion/MODEL-NOTES.md, must NOT stage it, and per the skill's own Stage-6 contract should present the local-copy diff to the user for approval before writing (write the proposed diff to a file and put the path in the approval prompt). Remember shipped MODEL-NOTES changes never reach existing npm installs (if-missing) — the release-checklist step is the only propagation path for the dev machine; CHANGELOG (T9) should tell other existing users to delete/merge their local copy if they want the new seed. tests/free-council-skill-docs.test.js and tests/postinstall-skill-source.test.js must stay green.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.8 — T8 (B11): docs accuracy — README Commands + MCP tables, usage.md rows, troubleshooting doctor-first, 'active servers' fix, abort-claim verification

**Files:** Modify: C:/Users/sendt/code/amicus/README.md:254-267 (Commands table), :374-388 (MCP section — VERIFY Phase 4's update, then add the `amicus_wait` row + count word 'fourteen'), :263 (abort row — verify-then-word); C:/Users/sendt/code/amicus/docs/usage.md:19-28 (Setup & maintenance block), :136 (MCP tool list), :16-17 and :122-123 (abort lines); C:/Users/sendt/code/amicus/docs/troubleshooting.md (new lead section after :4; fix :155). Test (create): C:/Users/sendt/code/amicus/tests/docs-command-coverage.test.js

**Verified anchors:** All hold at 509ab83. README Commands table :254-267 lists start/fanout/list/resume/continue/read/models/abort/setup/update/mcp — doctor, key, council all missing despite being real commands (bin/amicus.js:111-126 cases 'council'/'doctor'/'key'; cli.js usage header documents all three). README:374 'It exposes ten tools:' + 10-row table — mcp-tools.js actually registers THIRTEEN (grep verified): the 3 missing are amicus_council_tally (:296), amicus_council_stats (:324), amicus_verdict (:335). docs/usage.md:135 lists the same 10. troubleshooting.md has no doctor mention at all; :155 'Check whether another process is already using the target port: `amicus list` shows active servers.' is wrong — `amicus list` lists SESSIONS (metadata), not servers/ports (src/index.js listSidecars). Doctor checks verified from src/cli-handlers-doctor.js: node, config-dir, keys, default-model, catalog, aliases, opencode-bin, electron (self-heals with --fix, #56), skills, mcp, openrouter-credit, project-root; flags --json and --fix. ABORT (verify at implementation time): today handleAbort (src/cli-handlers.js:68-149) only writes aborted status via markAborted — no process kill; Phase 3 (separate cluster, ships in v1.8.0 before this phase) is expected to add real termination.

**Design:** Additive rows + one new lead section; no restructuring. The doctor-first section goes at the top of troubleshooting.md so every symptom section below inherits it. Abort wording is gated on a mandatory verification step (grep). Interface consumed: none from other tasks (disjoint regions from T2's README edits and T6's usage.md example-quoting).

**Code:**

```js
=== README.md Commands table — insert three rows after the `amicus models` row (:262) ===
| `amicus doctor` | Diagnose your setup — keys, default model, catalog, aliases, OpenCode binary, Electron, skills, MCP registration, OpenRouter credit (`--json`; `--fix` self-heals what it can). |
| `amicus key` | Manage API keys non-interactively: `amicus key <provider> <key>` saves after live validation; `--remove`; bare `amicus key` lists providers. |
| `amicus council` | Council math: `tally <input.json>` (deterministic tiers + ledger append), `stats` (reviewer reliability), `report <verdict.json> [--md\|--html]`. |

=== README.md MCP section (:374-388) — VERIFY, then add the one missing row ===
Phase 4 Task 4.2 (ships in v1.8.0, BEFORE this task) already performs the 'exposes ten tools'→count-word edit and appends the three council rows — do NOT repeat that edit; its before-string will not exist when T8 runs. Instead:
1. VERIFY the MCP tools table matches src/mcp-tools.js (the jest test below derives the tool list from source — it is the tripwire).
2. ADD the `amicus_wait` row (no other task adds the doc row; Phase 5 shipped the tool) — insert after the `amicus_status` row to match registration order:
| `amicus_wait` | Block until a session or fan-out wave reaches a terminal state (or timeoutMs elapses) — returns the `amicus_status` shape plus `{timedOut}`; prefer over sleep+status polling. |
3. Update the count word to 'fourteen' (the true post-Phase-5 count: 13 + `amicus_wait`).

=== docs/usage.md — append to the 'Setup & maintenance' block (:20-28) ===
amicus doctor [--json] [--fix]            # Diagnose setup; --fix self-heals (e.g. Electron)
amicus key <provider> <key>               # Validate + save one API key (also: --remove / bare list)
amicus council tally <input.json> --json  # Deterministic tiers + street-cred (+ ledger append)
amicus council stats [--json]             # Reviewer reliability from the ledger
amicus council report <verdict.json> [--md|--html]   # Render the council run report

=== docs/usage.md:136 ===
BEFORE: MCP tools: `amicus_start`, `amicus_status`, `amicus_read`, `amicus_list`, `amicus_resume`, `amicus_continue`, `amicus_abort`, `amicus_setup`, `amicus_guide`, `amicus_fanout`
AFTER:  MCP tools: `amicus_start`, `amicus_status`, `amicus_wait`, `amicus_read`, `amicus_list`, `amicus_resume`, `amicus_continue`, `amicus_abort`, `amicus_setup`, `amicus_guide`, `amicus_fanout`, `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict`

=== docs/troubleshooting.md — insert after the intro block (:4), before the first '---' ===
## First: run `amicus doctor`

Before working through any symptom below, run `amicus doctor` (plugin-only installs: `npx -y amicus@latest doctor`). It checks, in order: Node version, config directory, API keys, default model, catalog freshness, alias staleness, the OpenCode binary, Electron, installed skills, MCP registration, OpenRouter credit, and the project root — and prints a targeted fix hint for every failing check. `amicus doctor --fix` self-heals what it can (e.g. re-installs a broken Electron in place); `--json` gives machine-readable output.

=== docs/troubleshooting.md:155 ===
BEFORE: - Check whether another process is already using the target port: `amicus list` shows active servers.
AFTER:  - Check whether another process is already using the target port: `netstat -ano | findstr <port>` (Windows) or `lsof -i :<port>` (macOS/Linux). (`amicus list --status running` shows running *sessions*, which may still hold a server — it does not list ports.)

=== ABORT VERIFICATION STEP (mandatory before wording) ===
Run: grep -n "kill\|terminate\|SIGTERM" src/cli-handlers.js src/utils/session-abort.js
- If a real process-termination path exists (Phase 3 landed in v1.8.0): keep README:263 'Abort a running session (or `--all`).' and usage.md 'Stop one/all running session(s)' as-is; no edit.
- If NOT (still markAborted-only): soften — README:263 → '| `amicus abort` | Mark a running session aborted (or `--all`); the session is finalized in place — the engine process is not force-killed. |' and usage.md:16-17/:122-123 comments → '# Mark one running session aborted' / '# Mark all running sessions in this project aborted'. Record which branch was taken in the commit message.
```

**Tests:**

```js
Create C:/Users/sendt/code/amicus/tests/docs-command-coverage.test.js. Run: `npm test -- tests/docs-command-coverage.test.js`. Fails on main (no doctor/key/council rows; 'ten tools'; 'shows active servers'), passes after. The tool-count test derives truth from src/mcp-tools.js so it survives future tool additions only if docs keep pace — intended tripwire.

'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('docs command & MCP-tool coverage (B11)', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');
  const trouble = read('docs/troubleshooting.md');
  const toolNames = [...read('src/mcp-tools.js').matchAll(/name: '(amicus_\w+)'/g)].map(m => m[1]);

  it.each(['amicus doctor', 'amicus key', 'amicus council'])('README Commands table documents %s', c => {
    const table = readme.match(/## Commands[\s\S]*?(?=\n### )/)[0];
    expect(table).toContain(c);
  });
  it('README MCP section lists every registered tool (no stale count)', () => {
    expect(readme).not.toMatch(/exposes ten tools/);
    for (const t of toolNames) { expect(readme).toContain(t); }
  });
  it('usage.md lists every registered MCP tool and the new commands', () => {
    for (const t of toolNames) { expect(usage).toContain(t); }
    expect(usage).toMatch(/amicus doctor/);
    expect(usage).toMatch(/amicus council report/);
  });
  it('troubleshooting leads with doctor and drops the false active-servers claim', () => {
    expect(trouble.indexOf('amicus doctor')).toBeGreaterThan(-1);
    expect(trouble.indexOf('amicus doctor')).toBeLessThan(trouble.indexOf('## Auth / 401'));
    expect(trouble).not.toContain('shows active servers');
  });
});
```

**Risks:** COLLISION REMOVED (plan fix 2026-07-01): this task previously duplicated Phase 4 Task 4.2's README:374 edit ('exposes ten tools'→count word + the three council rows) — that edit ships in v1.8.0 before T8 runs, so T8's before-string would not have existed; T8 now only VERIFIES the Phase-4 table, adds the `amicus_wait` row, and bumps the count word to 'fourteen'. The tool count derives from src/mcp-tools.js via the jest test (kept exactly as designed — it is the tripwire), which couples docs to the historical serialization hub that OTHER in-flight phases actively modify; if a later phase adds a 15th tool before this lands, the test forces the doc row too (feature, but expect it). The abort wording depends on Phase 3's actual landing — do the grep, don't trust the plan's assumption. README edits are disjoint from T2's (Quick start vs Commands/MCP sections) and from T6's (:306 example) — safe within the serial lane. tests/readme-requirements-deps.test.js / ws4-quickwins.test.js unaffected (different sections) but re-run the full `npm test` before commit. Note the legacy `sidecar_*` alias line in both docs already covers the 3 new tools generically — no extra alias rows needed.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 8.9 — T9: release v1.8.1 — docs-only patch (CHANGELOG, plugin.json sync, npm version, tag push)

**Files:** Modify: C:/Users/sendt/code/amicus/CHANGELOG.md (Unreleased → new section); C:/Users/sendt/code/amicus/.claude-plugin/plugin.json (version field, bumped in lockstep); C:/Users/sendt/code/amicus/package.json (via `npm version 1.8.1 --no-git-tag-version` — no auto-commit/auto-tag; do not hand-edit). No new test file (T1-T8 tests are the release's regression net); verification = full suite + tarball check.

**Verified anchors:** Verified today: package.json 'files' whitelist INCLUDES 'skills/' (line 42) — the npm tarball ships both SKILL.md files, MODEL-NOTES.md, and COUNCIL-DESIGN.md, so YES this phase requires an npm release to reach npm-installed users; plugin users get it from repo main via marketplace source './' without a publish. .claude-plugin/plugin.json:3 says "version": "1.7.6" and NO script syncs it (grepped scripts/, .github/workflows/, .husky/ — nothing touches plugin.json) → manual bump required; marketplace.json has no version field (verified). Release flow verified from docs/publishing.md: `npm version` → tag → publish.yml OIDC-publishes + GitHub Release (this task follows the canonical Phase 2 ritual instead: `--no-git-tag-version`, plugin.json lockstep, one release commit, user-approved push). postinstall semantics (see T7) mean existing npm installs get the new SKILL.md files on update but keep their local MODEL-NOTES.

**Design:** Pure release mechanics executed AFTER T1-T8 merge to main. Read package.json first: expected 1.8.0 (if earlier phases shipped) → patch to 1.8.1; if main still reads 1.7.6, patch to 1.7.7 and retitle the CHANGELOG heading accordingly — the brief's 'v1.8.1' is conditional on v1.8.0 existing. Follow the NEW release checklist from T7 (this release is its first execution — including the MODEL-NOTES fold-back step, already satisfied by T7 itself).

**Code:**

```js
=== CHANGELOG.md — insert under '## [Unreleased]' ===
## [1.8.1] - <date>

Docs & skills accuracy sprint — no engine changes. Every item fixed a claim that actively
misdirected Claude or users.

### Changed
- **`sidecar` skill rewritten for reliability:** the frontmatter description now fits Claude's
  1024-char limit (it was 2180 chars — the last two operating rules were invisible), the
  "second opinion" trigger moved fully to the `second-opinion` skill, and the 7 operating rules
  live in a new top-of-body Operating Rules section. Fixed: phantom `amicus guide` → `amicus models`,
  bare `--session` → `--session-id` (6 sites), and the "--model is required" claim (it falls back
  to your configured default).
- **`second-opinion` skill hardened from field lessons:** Stage-2 tally recipe now builds `meta` +
  `findings[]` (the five-keys checklist — fixes the v1.6.0 `BAD_ARGS` trap); judges and the chair get
  a mandatory no-tools preamble (closes a Plan-agent anonymization leak); `--models` lists quoted in
  every example (PowerShell comma-split); current-date injection for time-sensitive artifacts;
  `report.html` is the default final artifact with an inline verdict summary required in chat; the
  false "solo start is exempt from the cost gate" note replaced with `--max-cost`/`--no-cost-gate`
  pass-through guidance for repair and chair calls.
- **MODEL-NOTES seed updated** with durable lessons from council runs 4-7 (new Grok/Kimi/Mistral/
  Claude-in-council sections, long-read model selection, judge tool-wander). Note: existing installs
  keep their machine-local MODEL-NOTES (installed only-if-missing) — merge manually if you want the
  new seed.
- **Docs:** README/usage now document `doctor`, `key`, and `council`; the MCP tool tables list all
  14 tools incl. `amicus_wait` (were 10); troubleshooting leads with `amicus doctor --fix`; plugin quick start no longer
  claims the plugin installs the CLI (use `npx -y amicus@latest <cmd>`); both skills gained an
  npx-fallback operating rule; added a release checklist to docs/publishing.md.

=== .claude-plugin/plugin.json:3 ===  "version": "1.7.6" → "version": "1.8.1" (match the npm version actually produced)

=== commands (from repo root, on main, clean tree — the Phase 2 release ritual adapted to v1.8.1) ===
npm test                      # full unit suite incl. the 8 new docs tests
npm run lint
npm run check:sizes
npm run check:secrets
npm run generate-docs:check
npm run check:tarball         # tarball lifecycle guard
npm run test:all              # full tier incl. integration — release preflight
npm pack --dry-run 2>&1 | grep -c "skills/"   # expect >=4 entries (both skills' files)
npm version 1.8.1 --no-git-tag-version        # bump package.json (+ lockfile) only — NO auto-commit, NO auto-tag
# bump .claude-plugin/plugin.json to 1.8.1 in lockstep (tests/plugin-manifest.test.js enforces the sync)
# single release commit: `chore(release): v1.8.1` (CHANGELOG + package.json + package-lock + plugin.json)
npm test                      # warm the .test-passed cache for the pre-push hook
# STOP: USER APPROVAL — then push main via the gh credential helper, tag v1.8.1, push the tag
gh run list -R BourbonDog/amicus --workflow publish.yml   # watch publish.yml (then `gh run watch -R BourbonDog/amicus <id>`)
npm view amicus version       # expect 1.8.1; confirm the GitHub Release exists
# if CI fails: move the tag to the fix commit (established precedent)
```

**Tests:**

```js
No new unit test — the eight docs tests from T1-T8 are the regression net and MUST all pass on the release commit: `npm test` (full suite; note default `npm test` excludes *.integration.test.js — that is fine, nothing here is integration-tier). Concrete release verification (run, expect listed output):
1. `npm pack --dry-run` output contains `skills/sidecar/SKILL.md`, `skills/second-opinion/SKILL.md`, `skills/second-opinion/MODEL-NOTES.md`, `skills/second-opinion/COUNCIL-DESIGN.md`.
2. `node -e "const a=require('./package.json').version,b=require('./.claude-plugin/plugin.json').version;if(a!==b){console.error('version drift',a,b);process.exit(1)}"` exits 0 (run AFTER npm version).
3. Post-publish smoke (from any temp dir): `npx -y amicus@latest --version` prints v1.8.1, and `gh run watch` on the publish.yml run (remember the gh default-repo gotcha: use `-R BourbonDog/amicus`).
```

**Risks:** MUST be last; requires T1-T8 merged and any other in-flight phase that plans to be in v1.8.x already tagged — coordinate with the plan author on whether v1.8.0 has shipped (this task adapts the number if not). With `--no-git-tag-version` the version bump itself makes no commit; the single release commit fires the git pre-commit hooks (no src/ staged, so lint-staged/size gate are no-ops; the pre-push hook requires the `.test-passed` cache → the post-commit `npm test` in the Steps warms it before the approved push). plugin.json version drift is the easy miss — step 2's check guards it; consider spawning a follow-up to automate the sync in a future engine phase, not here (zero engine risk mandate). Publishing uses OIDC trusted publishing (no NPM_TOKEN); if the workflow fails, docs/publishing.md has the fallback. After publish, plugin users on marketplace main get the skills immediately; remind the user (Christian) that HIS machine-local second-opinion MODEL-NOTES was already reconciled by T7-D, so postinstall's if-missing rule changes nothing locally.


**Steps** (release ritual — replaces the generic TDD steps; this is a docs-only release, there is no failing-test step):

- [ ] **Step 1 (preflight):** `npm test` + `npm run lint` + `npm run check:sizes` + `npm run check:secrets` + `npm run check:tarball` + `npm run test:all` — all green on main with T1-T8 merged.
- [ ] **Step 2 (CHANGELOG):** write the `## [1.8.1]` section per the draft in **Code** (docs/skills-only: Fixed — plugin quick-start accuracy, council tally recipe, MODEL-NOTES reconciliation, judge no-tools hardening, cost-gate drift, sidecar skill description/flags, docs accuracy; note MODEL-NOTES is copied if-missing so existing installs keep their local ledger).
- [ ] **Step 3 (version):** `npm version 1.8.1 --no-git-tag-version` + bump `.claude-plugin/plugin.json` to 1.8.1 in lockstep (tests/plugin-manifest.test.js enforces the sync).
- [ ] **Step 4 (commit):** single commit `chore(release): v1.8.1`; then run `npm test` to warm the `.test-passed` cache for the pre-push hook.
- [ ] **Step 5:** **STOP: USER APPROVAL, then push** — push main via the gh credential helper, tag `v1.8.1`, push the tag.
- [ ] **Step 6 (watch):** `gh run list -R BourbonDog/amicus --workflow publish.yml` (then `gh run watch -R BourbonDog/amicus <id>`) until the publish run is green.
- [ ] **Step 7 (verify):** `npm view amicus version` → `1.8.1`; GitHub Release v1.8.1 exists. If CI fails, move the tag to the fix commit (established precedent).

---
## Phase 9 — Distribution: plugin surface + MCP Registry (opp-4, opp-5)

**Scope:** 9a slash commands (`/amicus:council`, `/amicus:sidecar` — plugins auto-discover `commands/`; do NOT add a `commands` key to plugin.json, it REPLACES the default dir), 9b community-marketplace listing (anthropics/claude-plugins-community; the actual listing is a **manual web-form submission** at platform.claude.com/plugins/submit + Anthropic review — the code deliverable is a preflight guard + runbook; carry the human action item), 9c MCP Registry publish (`mcpName` in package.json + `server.json` + `mcp-publisher login github-oidc` steps in publish.yml; namespace is CASE-SENSITIVE — must be `io.github.BourbonDog/amicus`; "amicus" is unclaimed as of 2026-07-01; registry is still in preview).

**Lane order:** 9a → 9b strictly (9b's submission pins/reviews the SHA that includes 9a's commands). 9c sequences after 9a on the shared `package.json` edit (or rebase). **Ordering dependency:** the first registry publish rides the next v* tag AFTER Phase 4 shipped (satisfied — v1.8.0 in Phase 7), so the listing snapshots the clean 14-tool surface. All outward-facing steps (marketplace submission, registry publish tag) need user approval.


### Task 9.1 — Task 9a — Plugin slash commands: /amicus:council command + /sidecar argument surface

**Files:** CREATE: commands/council.md (new dir at plugin root — NOT inside .claude-plugin/).
MODIFY: skills/sidecar/SKILL.md:2 (frontmatter, add argument-hint after `name: sidecar`) and body immediately after the H1 at line 33.
MODIFY: skills/second-opinion/SKILL.md:62 (escape the literal `$0` → `\$0`; it is in the skill BODY and would be substituted with the first argument on any argumented invocation).
MODIFY: package.json:38-47 (files array — add "commands/" so the plugin dir shipped in the npm tarball stays complete).
DO NOT MODIFY: .claude-plugin/plugin.json — commands/ auto-discovers; adding a `commands` key would REPLACE the default directory scan (verified against the July-2026 plugins reference).
TEST (new): tests/plugin-commands.test.js.

**Verified anchors:** All re-verified today against 509ab83: .claude-plugin/plugin.json is 19 lines, v1.7.6, has skills[] + mcpServers keys and NO commands key. skills/sidecar/SKILL.md frontmatter spans lines 1-31, H1 at line 33; the only $<digit> literal ('$10-60+') is at line 17 INSIDE frontmatter (safe — substitution applies to body only). skills/second-opinion/SKILL.md line 62 contains body-level 'Cost ≈ $0' (substitution hazard — confirmed). tests/plugin-manifest.test.js exists and asserts skills/mcp/version sync (mimic its fs.readFileSync pattern). Docs correction vs. the review: plugin slash commands are NAMESPACED — these ship as /amicus:council and /amicus:sidecar (typing /council autocompletes). Second correction: 'commands and skills merged' — a flat commands/*.md file and a skills/<name>/SKILL.md are the same mechanism, so commands/sidecar.md would COLLIDE with the existing skills/sidecar → the /sidecar deliverable is implemented as frontmatter+body args on the existing SKILL.md, not a second file. STALE-ANCHOR NOTE (post-Phase-8): the sidecar SKILL.md line anchors above were verified at 509ab83, but Phase 8 T1 ships FIRST and rewrites the frontmatter to ~16 lines, adds '## Operating Rules', and moves the `$10-60+` cost literal into the body (escaped there as `\$10-60+`) — post-Phase-8 numbering differs; locate by text: insert the Slash-invocation section after the H1 + intro paragraph and BEFORE the '## Operating Rules' section T1 added.

**Design:** Two user-facing slash commands, zero manifest changes.
(1) /amicus:council — new flat command file commands/council.md with `disable-model-invocation: true` (user-triggered only), `argument-hint`, and $ARGUMENTS as the material+criteria payload; its body instructs Claude to invoke the second-opinion skill end-to-end.
(2) /amicus:sidecar — the name is ALREADY claimed by skills/sidecar/SKILL.md (plugin skill dir name → command name). Creating commands/sidecar.md would register a duplicate /amicus:sidecar. Instead, add `argument-hint: "[model] [prompt...]"` to the existing skill frontmatter and a 'Slash invocation' section at the top of the body that binds $1 = model alias and $ARGUMENTS = full arg string (positional placeholders are $1-BASED — $1, $2, … plus $ARGUMENTS; a bare `$0` never substitutes). This also upgrades the npm-channel copy (postinstall copies skills/ to ~/.claude/skills — same file, both channels).
Interfaces produced: /amicus:council and argumented /amicus:sidecar — consumed by Task 9b's submission (the reviewed plugin should include them) and referenced in README/docs.
Verification commands (engineer): `npx jest tests/plugin-commands.test.js` (fail→pass), then `claude plugin validate . --strict` and `claude --plugin-dir C:\Users\sendt\code\amicus` → type `/` and confirm amicus:council appears once and amicus:sidecar appears exactly once (no duplicate).

**Code:**

```js
── commands/council.md (new file, full content) ──
---
description: Run a structured multi-model LLM council review of the given material — wraps the second-opinion skill (independent reviews → anonymous cross-review → non-Claude chair verdict → accept/deny decisions).
argument-hint: [material, path, or URL] [analysis request + criteria]
disable-model-invocation: true
---

Run a full council review by invoking the `second-opinion` skill shipped in this
plugin (listed as `amicus:second-opinion`). Do not synthesize a verdict yourself —
the skill's chair model does that; you orchestrate.

Treat everything the user typed after the command as the review request:

$ARGUMENTS

Interpret it as three inputs: the **material** (inline text, a file path, or a URL),
the **analysis request**, and the **criteria**. If any of the three is missing or
ambiguous, ask for it before launching any model (the skill's Stage 0 covers this —
don't re-ask for what is already present).

Then follow the second-opinion skill end to end: Stage 0 intake/prep and run-folder
setup, council selection with a cost estimate and explicit user confirmation, the
three review waves, `amicus council tally`, and the accept/deny decision pass.

── skills/sidecar/SKILL.md — frontmatter edit (insert after line 2 `name: sidecar`) ──
argument-hint: "[model] [prompt...]"

── skills/sidecar/SKILL.md — body insert (after the H1 + intro paragraph and BEFORE the '## Operating Rules' section Phase 8 T1 added — locate by text, not line number; was line 35 at 509ab83) ──
## Slash invocation (`/amicus:sidecar <model> <prompt…>`)

When invoked as a slash command with arguments:

- First argument (the model): $1
- Full argument string: $ARGUMENTS

Treat $1 as the target model alias and the remainder of $ARGUMENTS as the prompt.
If $1 is not a plausible model alias (gemini, gemini-pro, gpt, codex, deepseek,
qwen, grok, mistral, glm, …), treat the ENTIRE argument string as the prompt and
default to gemini. Then apply the critical rules below exactly as for any other
invocation (run_in_background: true, --prompt-file for long briefings, interactive
by default for a single model, never o3/o3-pro unprompted).

── skills/second-opinion/SKILL.md:62 one-character fix ──
- OLD: - Cost ≈ $0 — skip the paid-run cost framing (the budget gate is a no-op at zero price).
- NEW: - Cost ≈ \$0 — skip the paid-run cost framing (the budget gate is a no-op at zero price).

── package.json files array (line 38-47) — add one entry after "skills/", ──
    "skills/",
    "commands/",
    ".claude-plugin/",
```

**Tests:**

```js
── tests/plugin-commands.test.js (new, full content; run: npx jest tests/plugin-commands.test.js — all 5 fail before the change) ──
// tests/plugin-commands.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

describe('plugin slash commands (Phase 9a)', () => {
  test('commands/council.md exists, is user-invoked-only, and wraps second-opinion with $ARGUMENTS', () => {
    const md = read('commands/council.md');
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('argument-hint:');
    expect(md).toContain('disable-model-invocation: true');
    expect(md).toContain('$ARGUMENTS');
    expect(md).toContain('second-opinion');
  });

  test('plugin.json does NOT declare a commands key (auto-discovery; a custom path REPLACES the default commands/ dir)', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
    expect(manifest.commands).toBeUndefined();
  });

  test('no commands/sidecar.md — it would collide with the skills/sidecar command name', () => {
    expect(fs.existsSync(path.join(ROOT, 'commands', 'sidecar.md'))).toBe(false);
  });

  test('sidecar skill declares the slash-argument surface (argument-hint + $1/$ARGUMENTS binding)', () => {
    const md = read('skills/sidecar/SKILL.md');
    expect(md).toContain('argument-hint:');
    expect(md).toContain('$ARGUMENTS');
    expect(md).toContain('Slash invocation');
  });

  test('placeholder discipline: no stray $<digit> in the two skill bodies; command placeholders are exactly the intended set ($1, $ARGUMENTS)', () => {
    const stripFm = (md) => md.replace(/^---[\s\S]*?\n---\n/, ''); // strip frontmatter
    // second-opinion body: NO positional placeholders at all — every $<digit> literal must be \$-escaped (:62 fix).
    expect(stripFm(read('skills/second-opinion/SKILL.md'))).not.toMatch(/(^|[^\\$])\$\d/);
    // sidecar body: the ONLY unescaped $<digit> allowed is the deliberate $1 model placeholder in the
    // Slash-invocation section; literals must be \$-escaped (e.g. the Operating Rules' \$10-60+ from Phase 8 T1).
    const sidecarBody = stripFm(read('skills/sidecar/SKILL.md'));
    const hits = [...sidecarBody.matchAll(/(?:^|[^\\$])(\$\d+)/g)].map((m) => m[1]);
    expect([...new Set(hits)]).toEqual(['$1']);
    // commands/council.md takes no positional args: $ARGUMENTS only, no $<digit>.
    const council = read('commands/council.md');
    expect(council).toContain('$ARGUMENTS');
    expect(council).not.toMatch(/(^|[^\\$])\$\d/);
  });

  test('commands/ ships in the npm tarball alongside skills/ and .claude-plugin/', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.files).toContain('commands/');
  });
});
NOTE: the placeholder-discipline test intentionally also fails BEFORE the \$0 fix (second-opinion:62) — proves the hazard, then passes. It is scoped so the DELIBERATE placeholders pass: the sidecar body's $1 (the slash model arg) is whitelisted as the exactly-one allowed unescaped $<digit>, and commands/council.md is asserted to carry $ARGUMENTS only. It also depends on Phase 8 T1 having escaped the Operating Rules' `\$10-60+` cost literal — if T1 shipped it unescaped, this test correctly fails.
```

**Risks:** (1) COMMAND-NAME COLLISION is the core risk this design avoids: skills/sidecar/SKILL.md already owns /amicus:sidecar; never add commands/sidecar.md (test 3 pins this). (2) $-substitution: adding $1/$ARGUMENTS to SKILL.md makes Claude Code substitute on EVERY invocation (positionals are $1-based; $0 is not a placeholder) — audited both skill bodies for $<digit> literals: second-opinion:62 (`$0`, escaped here) and the `$10-60+` cost figure Phase 8 T1 moves into the sidecar body (T1 escapes it as `\$10-60+`); future skill edits must keep the escape discipline (test 5 is the regression gate). (3) The npm postinstall channel copies skills/ to ~/.claude/skills — standalone (non-plugin) users get the SKILL.md changes but NOT commands/council.md; acceptable for v1, note in CHANGELOG. (4) Pre-commit gates: eslint/size-gate only cover src/**/*.js (no .md impact); scripts/generate-docs.js + validate-docs.js run on commit and may auto-restage CLAUDE.md — commit from repo root and let it. (5) tests/postinstall-skill-source.test.js and free-council-skill-docs.test.js read SKILL.md content — run `npm test` (full suite) to catch content-coupled assertions; if free-council-skill-docs.test.js pins the exact line-62 text, update it in the same commit. (6) In-flight phases: none touch skills/ or commands/; only package.json overlaps with Task 9c (sequence 9a → 9c).


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

### Task 9.2 — Task 9b — Community marketplace listing (anthropics/claude-plugins-community): preflight guard + submission runbook

**Files:** CREATE: docs/DISTRIBUTION.md (submission runbook — repo already has a docs/ dir).
MODIFY: tests/plugin-manifest.test.js:42 (append one test to the existing describe block).
MODIFY (optional, recommended): README.md — add an 'Install as a Claude Code plugin' section referencing @claude-community once approved.
No other code changes. The listing itself is a MANUAL web-form submission — carry it as a human action item in the plan.

**Verified anchors:** Re-verified today: .claude-plugin/plugin.json already carries every metadata field the validator wants (name, version 1.7.6 synced to package.json by tests/plugin-manifest.test.js:18-20, description, author, homepage, repository, license, keywords). marketplace.json in-repo is the SELF-HOSTED marketplace (name bourbondog-amicus) — it is NOT what the community listing uses and needs no change. Web-verified submission process (code.claude.com/docs/en/plugins, 'Submit your plugin to the community marketplace', fetched 2026-07-01): two Anthropic marketplaces exist — claude-plugins-official (curated, no application process) and claude-community (third-party submissions after review). clau.de/plugin-directory-submission 302-redirects to that docs section. Submission forms: claude.ai/admin-settings/directory/submissions/plugins/new (requires Team/Enterprise org + directory management) or platform.claude.com/plugins/submit (Console — the route for individual authors; Christian has no Team org). Review pipeline runs `claude plugin validate` + automated safety screening; approved plugins are pinned to a commit SHA in anthropics/claude-plugins-community/.claude-plugin/marketplace.json, CI auto-bumps the pin on new pushes, catalog syncs nightly; PRs opened directly against that repo are closed automatically.

**Design:** Deliverable A (code): one jest test pinning the submission-metadata completeness of plugin.json so a future edit can't silently drop a field the review pipeline validates. Deliverable B (docs): docs/DISTRIBUTION.md runbook with the exact submission steps so the manual action is reproducible. Deliverable C (manual, post-merge): submit via the Console form and track approval.
Preflight commands the runbook mandates BEFORE submitting:
  1. `claude plugin validate . --strict`  (same check the pipeline runs; --strict turns unrecognized-field warnings into errors)
  2. `claude --plugin-dir .` smoke: /amicus:council, /amicus:sidecar, /amicus:second-opinion present; amicus MCP server loads (npx amicus mcp via .claude-plugin/plugin.json mcpServers).
  3. `npm test` green (plugin-manifest + plugin-commands suites).
Submission metadata to enter in the form: repository URL https://github.com/BourbonDog/amicus (public, MIT), plugin name `amicus`, description from plugin.json, contact sendtowags@outlook.com.
Post-approval verification: search 'amicus' in https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json (nightly sync delay is normal), then end-to-end: `claude plugin marketplace add anthropics/claude-plugins-community && claude plugin install amicus@claude-community`.
Interfaces consumed: Task 9a's commands (submit AFTER 9a merges so the reviewed SHA includes them).

**Code:**

```js
── tests/plugin-manifest.test.js — append inside the existing describe('Claude Code plugin manifest') block, after the tarball test at line 39-41 ──
  test('manifest carries the community-submission metadata (repository, license, homepage, keywords)', () => {
    const m = manifest();
    expect(m.repository).toBe('https://github.com/BourbonDog/amicus');
    expect(m.license).toBe('MIT');
    expect(m.homepage).toBe('https://bourbondog.github.io/amicus/');
    expect(Array.isArray(m.keywords) && m.keywords.length > 0).toBe(true);
    // The review pipeline runs `claude plugin validate`; docs/DISTRIBUTION.md is the runbook.
    const fs2 = require('fs');
    expect(fs2.existsSync(path.join(ROOT, 'docs', 'DISTRIBUTION.md'))).toBe(true);
  });

── docs/DISTRIBUTION.md (new file — sketch, ~60 lines; headers are load-bearing, prose elided where marked) ──
# Distribution channels

## 1. npm (existing)
Tag `v*` → .github/workflows/publish.yml → npm Trusted Publishing (OIDC). [elided: current behavior summary]

## 2. Claude Code community marketplace (claude-community)
Status: submitted <date> / approved <date> / listed <date>

### Preflight (every submission or major update)
```bash
claude plugin validate . --strict
claude --plugin-dir .   # smoke: /amicus:council, /amicus:sidecar, /amicus:second-opinion, MCP tools
npm test
```

### Submit
- Individual-author route: https://platform.claude.com/plugins/submit (Console form)
- Team/Enterprise route: https://claude.ai/admin-settings/directory/submissions/plugins/new
- Metadata: repo https://github.com/BourbonDog/amicus · plugin `amicus` · MIT · contact sendtowags@outlook.com
- Never open a PR against anthropics/claude-plugins-community (auto-closed; it is a read-only mirror).

### After approval
- Pinned to a commit SHA in anthropics/claude-plugins-community/.claude-plugin/marketplace.json; CI bumps the pin as we push; catalog syncs nightly (delay is normal).
- Verify: search "amicus" in that marketplace.json, then
  `claude plugin marketplace add anthropics/claude-plugins-community && claude plugin install amicus@claude-community`
- README install snippet: [elided]

## 3. MCP Registry
See server.json + the MCP Registry steps in publish.yml (Phase 9c). Publish only after the tool-surface de-bloat — 14 tools (13 + amicus_wait).
```

**Tests:**

```js
The appended plugin-manifest test above IS the failing-first test: it fails on `docs/DISTRIBUTION.md` existence (and would fail if repository/license/homepage ever drift) before the task lands, passes after. Run: `npx jest tests/plugin-manifest.test.js`. Full suite: `npm test` (default config excludes *.integration.test.js — no integration tests involved here).
```

**Risks:** (1) THE APPROVAL IS NOT OURS TO SCHEDULE: automated safety screening + Anthropic review with no published SLA; the plan must not put downstream work on this critical path. (2) Safety screening will see that the npm package runs a postinstall (scripts/postinstall.js) and that the repo ships install.sh/install.ps1 — the plugin channel itself sets AMICUS_SKIP_POSTINSTALL=1 in plugin.json's mcpServers env (already true, plugin.json:16), but be ready to answer reviewer questions; documenting the guard in DISTRIBUTION.md preempts this. (3) The pinned-SHA auto-bump means every push to main reaches marketplace users — after listing, treat main as release-quality or set an explicit `version` policy (plugin.json already pins version, so users only update when we bump it — that is the safer existing behavior; keep the version-sync test green). (4) File collision: tests/plugin-manifest.test.js is also read (not written) by Task 9a — 9b appends after 9a merges. (5) `claude plugin validate` needs the Claude Code CLI locally; it is NOT added to CI (runners lack auth) — the jest metadata test is the CI-side proxy.


**Steps** (the task is NOT complete until the human steps below are done — the code deliverables alone do not constitute the listing):

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.
- [ ] **STOP: user approval before any submission** (outward-facing; nothing leaves the repo without Christian's explicit go-ahead).
- [ ] **HUMAN STEP (user):** submit the plugin via the Console form at platform.claude.com/plugins/submit (runbook above, docs/DISTRIBUTION.md §2 — submit AFTER 9a merges so the reviewed SHA includes the commands); record the submission date/ID here: ____________

### Task 9.3 — Task 9c — MCP Registry publish: mcpName + server.json + OIDC publish steps in publish.yml

**Files:** MODIFY: package.json:2-4 (add "mcpName" after "version").
CREATE: server.json (repo root).
MODIFY: .github/workflows/publish.yml — insert three steps after the `npm publish` step (line 31), before 'Create GitHub Release' (line 33).
MODIFY: tests/scripts/package-manifest.test.js — append a new describe block.
Note: server.json at repo root is NOT in package.json files[] and need not ship in the tarball (the registry reads it from the repo/CI checkout; npm-side validation reads only mcpName from the PUBLISHED package.json).

**Verified anchors:** Re-verified today: publish.yml job `publish` already has permissions id-token: write (line 12) — required for OIDC — and runs npm publish at line 31 via npm Trusted Publishing. package.json has no mcpName. Registry facts verified live (2026-07-01): quickstart (modelcontextprotocol.io/registry/quickstart) — mcpName in package.json MUST equal server.json name; with GitHub auth the name MUST start with io.github.<username>/. CI flow (modelcontextprotocol.io/registry/github-actions) — install mcp-publisher binary, `mcp-publisher login github-oidc` (no secret needed), `mcp-publisher publish`, optional jq version-sync from tag. Schema 2025-12-11 (pulled from modelcontextprotocol/registry internal/validators/schemas/2025-12-11.json): ServerDetail requires name/description/version; name pattern ^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$ (uppercase legal); Package requires registryType/identifier/transport, supports version, runtimeHint, packageArguments (PositionalArgument {type:'positional', value|valueHint}), environmentVariables. CASE-SENSITIVITY verified in registry source: github_at.go:181 and github_oidc.go:291-293 grant `io.github.<Login>/*` with the EXACT-CASE login/repository_owner, and internal/auth/jwt.go isResourceMatch (lines 165-173) is a case-sensitive strings.HasPrefix → use io.github.BourbonDog/amicus (gh api user → login "BourbonDog"). Registry search for 'amicus' returns 0 servers — name free. `amicus mcp` subcommand confirmed at bin/amicus.js:130.

**Design:** The registry hosts metadata only; the artifact is the existing npm package `amicus`. Flow per release tag: npm publish (existing, OIDC) → mcp-publisher login github-oidc (grants io.github.BourbonDog/* because the workflow runs in BourbonDog/amicus) → jq-sync server.json version from the tag → mcp-publisher publish. npm-side ownership validation fetches the published package and checks mcpName — hence the strict step ordering after `npm publish`, plus a retry loop for npm propagation lag.
server.json models the same launch the Claude Code plugin uses: `npx amicus@<ver> mcp` → packages[0] = npm/amicus with packageArguments [{type:'positional', value:'mcp'}], stdio transport, OPENROUTER_API_KEY declared as optional secret env (keys may instead come from ~/.config/amicus/.env via `amicus setup`; env-loader gives process.env priority — verified src/utils/env-loader.js:22-33).
In-repo version-sync invariant: server.json.version === package.json.version === packages[0].version, enforced by the new jest block (the release script/human bumps all three; the CI jq step is belt-and-braces from the tag).
First-publish de-risk (runbook line in docs/DISTRIBUTION.md §3): before relying on CI, run once locally — download mcp-publisher (Windows tarball per quickstart), `mcp-publisher login github` (device flow as BourbonDog), `mcp-publisher publish` — to fail fast on namespace/validation errors. If publish returns 'You do not have permission…', the error message lists the granted pattern — align server.json name casing to it exactly.

**Code:**

```js
── package.json (insert after line 3 `"version": "1.7.6",`) ──
  "mcpName": "io.github.BourbonDog/amicus",

── server.json (new file, repo root, full content) ──
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.BourbonDog/amicus",
  "title": "Amicus",
  "description": "Multi-model LLM Council + parallel AI window for Claude Code. Run structured council reviews across Gemini, GPT, DeepSeek and more — or fork a conversation to any model and fold the results back.",
  "repository": {
    "url": "https://github.com/BourbonDog/amicus",
    "source": "github"
  },
  "websiteUrl": "https://bourbondog.github.io/amicus/",
  "version": "1.7.6",
  "packages": [
    {
      "registryType": "npm",
      "registryBaseUrl": "https://registry.npmjs.org",
      "identifier": "amicus",
      "version": "1.7.6",
      "runtimeHint": "npx",
      "transport": { "type": "stdio" },
      "packageArguments": [
        { "type": "positional", "value": "mcp", "valueHint": "mcp" }
      ],
      "environmentVariables": [
        {
          "name": "OPENROUTER_API_KEY",
          "description": "OpenRouter API key (recommended multi-model route). Optional when a provider key is configured via 'amicus setup' (~/.config/amicus/.env) or OpenCode auth.json.",
          "isRequired": false,
          "isSecret": true,
          "format": "string"
        },
        {
          "name": "AMICUS_SKIP_POSTINSTALL",
          "description": "Set to 1 when a plugin/client manages registration itself (skips npm postinstall side effects).",
          "isRequired": false,
          "isSecret": false,
          "format": "string",
          "default": "1"
        }
      ]
    }
  ]
}

── .github/workflows/publish.yml — insert after line 31 (`- run: npm publish --access public --provenance`) ──
      # ── MCP Registry (registry.modelcontextprotocol.io) ────────────────
      # Auth: GitHub OIDC (id-token: write above) → publish rights on
      # io.github.BourbonDog/*. npm-side ownership validation reads "mcpName"
      # from the PUBLISHED package.json, so these steps MUST follow npm publish.
      - name: Install mcp-publisher
        run: |
          curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher

      - name: Sync server.json version from tag
        env:
          TAG_NAME: ${{ github.ref_name }}
        run: |
          VERSION="${TAG_NAME#v}"
          jq --arg v "$VERSION" '.version = $v | .packages[0].version = $v' server.json > server.tmp
          mv server.tmp server.json

      - name: Publish to MCP Registry
        run: |
          ./mcp-publisher login github-oidc
          # npm propagation can lag the publish by a few seconds; retry.
          for i in 1 2 3 4 5; do
            ./mcp-publisher publish && exit 0
            echo "mcp-publisher publish attempt $i failed; retrying in 20s"
            sleep 20
          done
          echo '::error::MCP Registry publish failed after 5 attempts'
          exit 1
```

**Tests:**

```js
── tests/scripts/package-manifest.test.js — append (sibling of the existing describe; pkg is already required at top) ──
describe('MCP Registry metadata (Phase 9c)', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..', '..');
  const serverJson = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf-8'));

  test('package.json mcpName matches server.json name exactly (case-sensitive registry namespace)', () => {
    expect(pkg.mcpName).toBe('io.github.BourbonDog/amicus');
    expect(serverJson().name).toBe(pkg.mcpName);
  });

  test('server.json versions stay in lockstep with package.json', () => {
    const s = serverJson();
    expect(s.version).toBe(pkg.version);
    expect(s.packages[0].version).toBe(pkg.version);
  });

  test('server.json models the `npx amicus mcp` stdio launch', () => {
    const p = serverJson().packages[0];
    expect(p).toMatchObject({ registryType: 'npm', identifier: 'amicus', transport: { type: 'stdio' } });
    expect(p.packageArguments[0]).toMatchObject({ type: 'positional', value: 'mcp' });
  });

  test('publish.yml publishes to the MCP registry via OIDC, strictly after npm publish', () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf-8');
    expect(yml).toContain('mcp-publisher login github-oidc');
    expect(yml.indexOf('npm publish')).toBeGreaterThan(-1);
    expect(yml.indexOf('npm publish')).toBeLessThan(yml.indexOf('mcp-publisher publish'));
  });
});
Run: `npx jest tests/scripts/package-manifest.test.js` — all 4 new tests fail first (no mcpName, no server.json, no workflow steps), pass after. `npm test` for the suite (integration tests excluded by default config).
```

**Risks:** (1) RELEASE-ORDER DEPENDENCY: the first registry publish snapshots the tool surface — cut the first post-merge v* tag only AFTER Phase 4 de-bloat (14 tools (13 + amicus_wait); today the live server also registers 13 sidecar_* aliases that Phase 4 removes). (2) Registry is IN PREVIEW — breaking changes/data resets possible; the publish steps are additive and must not fail the npm release: they are placed AFTER `npm publish` so a registry failure still leaves npm + GitHub Release intact only if the workflow tolerates it — decision taken: keep the hard `exit 1` (visible failure) but AFTER the npm publish step; the 'Create GitHub Release' step then does NOT run on registry failure — if that trade-off is unwanted, add `continue-on-error: true` to the 'Publish to MCP Registry' step (call this out in the PR). (3) Version bump discipline: server.json now joins package.json + .claude-plugin/plugin.json in the must-bump-together set (two jest suites enforce). (4) mcpName in package.json is an unrecognized-but-harmless field for npm and for `claude plugin validate` (warnings only; do not run validate --strict against package.json — it applies to plugin.json). (5) File collisions: package.json also edited by 9a (files array) — sequence 9a→9c. publish.yml is not touched by any other in-flight phase (claude-review.yml and the new council-review.yml are separate files). (6) Windows gotchas: none at runtime (CI is ubuntu); the local first-publish dry-run on Windows uses the documented tar.gz + mcp-publisher.exe flow. (7) Pre-commit gates: no src/*.js touched → eslint/size-gate no-ops; check-secrets.js scans staged files — server.json contains no secrets.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.

---
## Phase 10 — Council Review GitHub Action v1 (opp-6)

**Scope:** a label-gated (`council-review`) PR workflow that runs N independent model reviews via `amicus fanout` headlessly and posts one synthesis sticky comment. **Honesty constraint (verified in source):** a code-only pipeline CANNOT produce a council verdict — `amicus council tally` requires adjudications[]/rankings[] that only exist after the skill-orchestrated Stage-2 cross-review (`src/cli-handlers-council.js:25`, `src/council/verdict.js:12`). v1 is therefore **fanout-only: N independent reviews + synthesis comment**; adjudicated verdicts are deferred to v2 (backlogged). Cost controls: the label gate, a cheap default bench, job timeout, and an OpenRouter dashboard spend limit on the CI key — `--max-cost` is advisory on fresh CI runners (no cached catalog → legs unpriced → the soft ceiling can't bind, `src/sidecar/budget.js:44-48`).

**Independent lane** — touches only `.github/workflows/` + a test; can run in parallel with Phase 9. Every reviewed PR on BourbonDog/amicus dogfoods the product publicly.


### Task 10.1 — Task 10 — Council Review GitHub Action v1 (fanout-only: N independent model reviews + synthesis comment; adjudication deferred to v2)

**Files:** CREATE: .github/workflows/council-review.yml.
CREATE: tests/scripts/council-review-workflow.test.js.
MANUAL (repo settings): add OPENROUTER_API_KEY actions secret (a dedicated low-limit key — set a monthly spend cap in the OpenRouter dashboard); create the 'council-review' label.
No src/ changes.

**Verified anchors:** All re-verified today. HONESTY CHECK RESOLVED: `amicus council tally` (src/cli-handlers-council.js:10-36) requires input JSON with meta.models, findings[], adjudications[], rankings[] (hint at line 25) and `amicus council report` (lines 60-88) requires a verdict.json produced by buildVerdict(tallyRecord, ClaudeStage4Decisions) (src/council/verdict.js:12-39). Adjudications/rankings exist ONLY after the second-opinion skill's Claude-orchestrated Stage-2 cross-review — a code-only CI pipeline cannot produce a defensible council verdict. Therefore v1 = fanout only. Fanout facts verified: `amicus fanout --models a,b,c --prompt-file f --json` (src/cli-handlers-run.js:107-196); exit codes 0=complete/2=partial/1=error (src/utils/result-schema.js:98-102); --json prints ONE wave document to stdout (fanout.js:122-130) with legs[].{modelInput,status,summary,error,usage} and wave.usage.cost; heartbeat goes to STDERR only (src/sidecar/wave-progress.js:75) so stdout is clean JSON; --no-context skips transcript harvesting (fanout.js:183-190); --no-validate-model skips the live-catalog check (fanout.js:76-83); --timeout is MINUTES (fanout.js:236); --summary-length ∈ brief|normal|verbose (src/cli.js:379); --max-cost soft ceiling — on a fresh runner with no cached catalog legs are unpriced and the ceiling cannot bind (src/sidecar/budget.js:44-63) → advisory only in CI. Bench aliases resolve OFFLINE via pinned DEFAULT_ALIASES (src/utils/curated-models.js): deepseek→openrouter/deepseek/deepseek-v4-pro (~$0.87/Mtok out), gemini→openrouter/google/gemini-3.5-flash (flash-class = cheap), glm→openrouter/z-ai/glm-5.1 (cheap) — all through OPENROUTER_API_KEY, which env-loader takes from process.env first (env-loader.js:22-33). Postinstall skip guard AMICUS_SKIP_POSTINSTALL=1 (scripts/postinstall.js:286). Sticky-comment convention: gh api + HTML marker, copied from claude-review.yml:91-100. Repo pins actions/checkout@v6 + actions/setup-node@v6 (ci.yml, publish.yml).

**Design:** Reusable workflow, dual-trigger (pull_request in this repo + workflow_call for other repos). SECURITY POSTURE: the workflow NEVER checks out or executes PR code — it only reads the diff text via `gh pr diff` — so a malicious PR cannot exfiltrate the key; combined with the label opt-in and the fork-secret runtime gate this is safe under plain `pull_request` (no pull_request_target needed).
Pipeline: (1) gate: label 'council-review' present AND secret available (fork PRs get no secrets → soft-skip with a notice); (2) install amicus@latest globally (postinstall skipped, optional Electron omitted); (3) build briefing.md = review role/instructions + PR title/body + `gh pr diff` capped at diff_cap_bytes (default 120,000 bytes ≈ 30k tokens; truncation note appended); (4) `amicus fanout --models <bench> --prompt-file briefing.md --no-context --no-validate-model --summary-length verbose --timeout 10 --max-cost <cap> --json > wave.json`, accept exit 0 or 2 (partial: some legs still land); (5) synthesis leg: extract legs[].summary via jq into reviews.md, run a second single-model fanout (deepseek) with a synthesis briefing (agreements ≥2 models vs singletons, overall verdict, ≤400 words); (6) compose the sticky comment (marker `<!-- council-review-sticky -->`, gh api PATCH-or-POST exactly like claude-review.yml's security job) with per-model sections (each capped to 12,000 chars), the synthesis on top, and a cost footer from wave.usage.cost; (7) job hardening: permissions {contents: read, pull-requests: write}, concurrency per-PR cancel-in-progress, timeout-minutes: 25.
COST BUDGET (honest): typical run = 3 review legs × (~30k in + ~4k out) + 1 synthesis leg ≈ $0.05–$0.15 at the pinned bench prices; worst case bounded by the 10-min leg timeout and job timeout, NOT by --max-cost (unpriced legs in CI). Hard backstop = OpenRouter key monthly limit; soft backstops = label opt-in (nothing runs by default), cancel-in-progress, cheap bench with o3/opus excluded by construction. v2 roadmap note (in-file comment): adjudication wave + `council tally`/`report --md` once a headless orchestrator (or claude -p) can run Stage 2-4.

**Code:**

```js
── .github/workflows/council-review.yml (new file, full content) ──
name: Council Review

# v1 is fanout-only: N independent model reviews + one synthesis comment.
# The adjudicated verdict subcommands need the skill-orchestrated Stage-2
# cross-review (adjudications/rankings), which a code-only pipeline cannot
# produce — adjudicated verdicts are deferred to v2.

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
  workflow_call:
    inputs:
      models:
        description: Comma-separated amicus model aliases (cheap bench default)
        type: string
        default: 'deepseek,gemini,glm'
      max_cost:
        description: Soft wave cost ceiling in USD (advisory on cold runners)
        type: string
        default: '1.00'
      diff_cap_bytes:
        description: Max bytes of PR diff fed to the council
        type: string
        default: '120000'
      require_label:
        description: Require the council-review label on the PR
        type: boolean
        default: true
    secrets:
      OPENROUTER_API_KEY:
        required: true

concurrency:
  group: council-review-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

jobs:
  council:
    # Opt-in via label. Fork PRs never receive secrets; the runtime gate below
    # soft-skips in that case rather than failing the check.
    # STRING-SAFE label waiver: on plain pull_request events `inputs.*` is empty,
    # and GitHub's loose equality coerces null→0 and false→0 — a bare
    # `require_label == false` comparison would be TRUE on every same-repo PR
    # and bypass the label gate. format() yields '' there ('' != 'false'), so
    # the label is ALWAYS required on pull_request; only workflow_call callers
    # can waive it by passing require_label: false.
    if: >
      github.event.pull_request != null &&
      (format('{0}', inputs.require_label) == 'false' ||
       contains(github.event.pull_request.labels.*.name, 'council-review'))
    runs-on: ubuntu-latest
    timeout-minutes: 25
    permissions:
      contents: read
      pull-requests: write
    env:
      PR_NUMBER: ${{ github.event.pull_request.number }}
      GH_REPO: ${{ github.repository }}
      MODELS: ${{ inputs.models || 'deepseek,gemini,glm' }}
      MAX_COST: ${{ inputs.max_cost || '1.00' }}
      DIFF_CAP: ${{ inputs.diff_cap_bytes || '120000' }}
    steps:
      - name: Gate on secret availability (soft-skip fork PRs)
        id: gate
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: |
          if [ -z "$OPENROUTER_API_KEY" ]; then
            echo "available=false" >> "$GITHUB_OUTPUT"
            echo "::notice::OPENROUTER_API_KEY unavailable (fork PR or unset secret) — council review skipped."
          else
            echo "available=true" >> "$GITHUB_OUTPUT"
          fi

      - uses: actions/setup-node@v6
        if: steps.gate.outputs.available == 'true'
        with:
          node-version: 22

      - name: Install amicus (no checkout — PR code is never executed)
        if: steps.gate.outputs.available == 'true'
        env:
          AMICUS_SKIP_POSTINSTALL: '1'
        run: npm install -g --omit=optional amicus@latest

      - name: Build review briefing from the PR diff
        if: steps.gate.outputs.available == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: |
          gh pr diff "$PR_NUMBER" --repo "$GH_REPO" > full.diff
          head -c "$DIFF_CAP" full.diff > capped.diff
          TRUNC=""
          if [ "$(wc -c < full.diff)" -gt "$DIFF_CAP" ]; then
            TRUNC="(diff truncated to ${DIFF_CAP} bytes — review what is shown; do not guess about elided hunks)"
          fi
          PR_BODY=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json body -q .body | head -c 4000)
          {
            echo "You are one of several independent reviewers on a code-review council."
            echo "Review the following pull request diff for correctness bugs, security"
            echo "issues, and risky design choices. Do NOT nitpick style or formatting."
            echo "Output format (markdown): one-line VERDICT (approve / request-changes /"
            echo "comment), then a numbered findings list — each with severity"
            echo "(critical/major/minor), file, and a concrete failure scenario. If you"
            echo "find nothing substantive, say so plainly. Your final message must be"
            echo "the complete review."
            echo
            echo "## PR: ${PR_TITLE}"
            echo "${PR_BODY}"
            echo
            echo "## Diff ${TRUNC}"
            echo '```diff'
            cat capped.diff
            echo '```'
          } > briefing.md

      - name: Run the review wave (amicus fanout, headless)
        if: steps.gate.outputs.available == 'true'
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: |
          set +e
          amicus fanout --models "$MODELS" --prompt-file briefing.md \
            --no-context --no-validate-model --summary-length verbose \
            --timeout 10 --max-cost "$MAX_COST" --json > wave.json
          EC=$?
          set -e
          # 0 = all legs complete, 2 = partial (still useful). Anything else fails.
          if [ "$EC" -ne 0 ] && [ "$EC" -ne 2 ]; then
            echo '::error::fanout failed'; cat wave.json; exit "$EC"
          fi

      - name: Synthesize the reviews (one cheap leg)
        if: steps.gate.outputs.available == 'true'
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: |
          jq -r '.legs[] | "## Review by \(.modelInput // .model) [\(.status)]\n\n\((.summary // "(no output)")[:12000])\n"' wave.json > reviews.md
          {
            echo "Below are $(jq '.legs | length' wave.json) independent AI code reviews of the same pull request."
            echo "Synthesize them in under 400 words: (1) findings raised by 2+ reviewers,"
            echo "(2) notable singletons worth a human look, (3) an overall verdict line."
            echo "Do not invent findings that no reviewer raised."
            echo
            cat reviews.md
          } > synth-briefing.md
          amicus fanout --models deepseek --prompt-file synth-briefing.md \
            --no-context --no-validate-model --summary-length verbose \
            --timeout 10 --json > synth.json || true

      - name: Post sticky PR comment
        if: steps.gate.outputs.available == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          MARKER="<!-- council-review-sticky -->"
          SYNTH=$(jq -r '(.legs[0].summary // "(synthesis unavailable)")[:12000]' synth.json 2>/dev/null || echo '(synthesis unavailable)')
          COST=$(jq -r '.usage.cost // "unknown"' wave.json)
          STATUS=$(jq -r '"\(.counts.complete)/\(.counts.total) legs complete (\(.status))"' wave.json)
          {
            echo "$MARKER"
            echo "## Council Review (v1 — independent reviews + synthesis)"
            echo
            echo "### Synthesis"
            echo "$SYNTH"
            echo
            echo "<details><summary>Individual model reviews</summary>"
            echo
            cat reviews.md
            echo "</details>"
            echo
            echo "---"
            echo "_${STATUS} · wave cost: \$${COST} · models: ${MODELS} · not an adjudicated council verdict (v2)_"
          } > comment.md
          EXISTING=$(gh api "repos/${GH_REPO}/issues/${PR_NUMBER}/comments" \
            --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" | head -1)
          if [ -n "$EXISTING" ]; then
            gh api "repos/${GH_REPO}/issues/comments/$EXISTING" -X PATCH -F body=@comment.md
          else
            gh api "repos/${GH_REPO}/issues/${PR_NUMBER}/comments" -F body=@comment.md
          fi
```

**Tests:**

```js
── tests/scripts/council-review-workflow.test.js (new, full content; follows the repo's read-the-source assertion convention, cf. tests/fanout-cli.test.js) ──
// tests/scripts/council-review-workflow.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'council-review.yml');

describe('council-review workflow (Phase 10 v1)', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');

  test('exists, is reusable (workflow_call) and label-gated on pull_request', () => {
    const y = yml();
    expect(y).toContain('workflow_call');
    expect(y).toContain("types: [opened, synchronize, reopened, labeled]");
    expect(y).toContain("'council-review'");
  });

  test('soft-skips when the OpenRouter secret is unavailable (fork PRs)', () => {
    const y = yml();
    expect(y).toContain('secrets.OPENROUTER_API_KEY');
    expect(y).toContain('available=false');
  });

  test('fanout is headless-safe: no context harvest, no catalog fetch, cost + time bounded, JSON output', () => {
    const y = yml();
    for (const flag of ['--no-context', '--no-validate-model', '--max-cost', '--timeout 10', '--json', '--prompt-file']) {
      expect(y).toContain(flag);
    }
    expect(y).toContain('timeout-minutes: 25');
    expect(y).toContain('cancel-in-progress: true');
  });

  test('cheap bench only — never o3/o3-pro/opus', () => {
    const y = yml();
    expect(y).toContain("deepseek,gemini,glm");
    expect(y).not.toMatch(/\bo3\b|o3-pro|opus/);
  });

  test('never executes PR code (no checkout) and posts a sticky comment per repo convention', () => {
    const y = yml();
    expect(y).not.toContain('actions/checkout');
    expect(y).toContain('<!-- council-review-sticky -->');
    expect(y).toContain('pull-requests: write');
  });

  test('is honest about v1 scope: fanout only — never invokes the adjudicated council subcommands', () => {
    const y = yml();
    // Assert absence of actual INVOCATIONS — a prose mention in a comment must not trip this,
    // and the header comment is worded to avoid the bare subcommand literals anyway.
    expect(y).not.toMatch(/amicus\s+council\s+(tally|report)/);
    expect(y.toLowerCase()).toContain('deferred to v2');
  });
});
Run: `npx jest tests/scripts/council-review-workflow.test.js` — all 6 fail first (file absent), pass after. Also run `npx --yes actionlint@latest` or the actionlint binary against the new YAML locally (not wired into CI; actionlint checks SYNTAX only — it CANNOT catch runtime-value bugs like a loose `== false` against the empty `inputs.*` of a plain pull_request event, which is why the gate uses the string-safe `format('{0}', inputs.require_label) == 'false'` comparison). End-to-end verify: open a draft PR in BourbonDog/amicus, add the council-review label, confirm the sticky comment and check the OpenRouter dashboard for actual spend (expect < $0.20).
```

**Risks:** (1) SPEND: --max-cost cannot bind on cold runners (no cached catalog → unpriced legs, src/sidecar/budget.js:44-48) — controls are the label gate (default-off), cheap pinned bench, 10-min leg timeout, 25-min job timeout, cancel-in-progress, and a MONTHLY LIMIT ON THE CI KEY in the OpenRouter dashboard (do this when adding the secret; it is the only hard cap). (2) Alias drift: the pinned fallbacks (curated-models.js, verified 2026-06-24) can go stale on OpenRouter; a dead route makes legs error (exit 2/1) — the workflow surfaces this in the comment footer; fix = bump amicus. (3) `inputs.*` under a plain pull_request event are empty — every value use has a `|| default` fallback, and the label waiver MUST stay the string-safe `format('{0}', inputs.require_label) == 'false'`: GitHub's loose equality coerces null→0 and false→0, so a bare `== false` evaluates TRUE on every same-repo PR and would run a paid council wave with no label. actionlint would NOT catch a regression here — it checks expression syntax, not runtime values; the jest test and a draft-PR end-to-end check are the guards. (4) Partial waves (exit 2) still post — the footer discloses N/M legs; a 0-leg wave exits 1 and fails the job visibly. (5) Prompt-injection: PR diffs are attacker-controlled text fed to the reviewers; reviewers only produce a comment (no tools, no code execution, no secrets in the briefing) — blast radius is a misleading comment, disclosed by the 'not an adjudicated verdict' footer. (6) GitHub comment ceiling 65,536 chars: per-review cap 12k × 3 + synthesis 12k can exceed it → the reviews live in a <details> block; if PATCH/POST returns 422, halve the caps (documented in-file; acceptable v1 rough edge). (7) Couplings: no file overlap with Tasks 9a-9c or Phases 1-8 (claude-review.yml untouched; codex-audit unaffected — the new workflow is a separate check). (8) Windows gotchas: none — ubuntu-only job; contributors on Windows only touch the YAML + test. (9) Pre-commit: no src/*.js staged → lint/size-gate no-op; generate-docs/validate-docs run but are not affected by workflow files.


**Steps:**

- [ ] **Step 1:** Create the worktree lane (if not already in one) and write the failing test(s) exactly as given in **Tests** above; run the stated `npx jest <file>` command and confirm it FAILS for the stated reason.
- [ ] **Step 2:** Implement the change per **Design** and **Code** above (respect the file-size and no-console gates in Global Constraints).
- [ ] **Step 3:** Re-run the task test file — PASS; also run every adjacent suite named in **Risks**.
- [ ] **Step 4:** Lane gate: `npm test` (0 failed) + `npm run lint` + `npm run check:sizes`.
- [ ] **Step 5:** Commit (conventional message; include the review ID from the task name). Hand to the adversarial reviewer subagent — reviewer must revert the source change and watch the new tests fail before approving.
- [ ] **HUMAN STEP (user):** add the OPENROUTER_API_KEY repo secret WITH a spend cap set on the OpenRouter dashboard (this is the only hard cost cap — `--max-cost` is advisory on fresh CI runners: no cached catalog → unpriced legs).
- [ ] **HUMAN STEP (user):** create the 'council-review' label on BourbonDog/amicus.
- [ ] **STOP: user approval before merging the workflow** (it spends real money on labeled PRs; do not merge without Christian's explicit go-ahead).

---
---

# Backlog for review (NOT in this plan)

Everything below was found by the 2026-07-01 review (or surfaced during plan grounding) but is **outside the approved sequencing**. Nothing here gets implemented without explicit user approval. Ordered by my recommendation strength.

## Pull-forward candidates (high value, review found them HIGH/impactful)

1. **A6 — GUI close-without-fold finalizes 'complete' + close-during-fold loses the summary** (`electron/main.js:287-295`, `interactive.js:93-99`, `fold.js:27-90`). The strongest candidate to schedule immediately after Phase 7; pairs naturally with Phase 3's aborted-not-complete finalization work.
2. **B1 — MCP spawn paths hardcode `--client cowork`**, so `includeContext:true` silently delivers no context under Claude Code (`mcp-server.js:275,674,705,814`; `context-builder.js:208-213`). High daily impact for the primary user; touches mcp-server.js (serialize after Phase 6).
3. **B2 — untrusted-output fence covers 1 of 4+ channels** (wave.json reads, conversation mode, CLI read, CLI fold stdout are raw; `mcp-server.js:584,599-602`, `read.js:171`, `start.js:217`). Subsumes the tracked H9 tally/verdict residual and pairs with the BL-7 full fold-nonce.

## Remaining review problems (medium)

4. **B3** — Go-server SIGKILL fallback (2s, unref'd) loses every exit race on POSIX → orphaned `opencode serve` (`opencode-client.js:561-571`, `headless.js:279-283`, `lifecycle.js:32-41`). Windows is accidentally safe.
5. **B4** — Fold shortcut is a system-wide `globalShortcut` (hijacks Ctrl+Shift+F, cross-window misfire, "Cmd" label on Windows) (`electron/main.js:99,234-236`).
6. **B5** — Fold timeout silently degrades to the placeholder with the transcript on disk; failure path strands a dead overlay (`electron/summary.js:66-112`, `fold.js:34-80,141-169`).
7. **B6** — Parser accepts typo'd flags silently; NaN numerics (`--timeout abc` ≈ zero timeout; `--no-uI` opens the window anyway) (`cli.js:47-103,141-144,250-257`). `Number.isFinite` pattern already exists at `cli-handlers-run.js:41`.
8. **B7** — `list --all` is dead code; table columns collide on real model IDs; council-leg previews all identical (`cli.js:417`, `read.js:81,96-104`).

## Opportunities not scheduled (review ranks 7, 9–15)

9. **`amicus council validate` and `amicus council verdict` CLI commands** (rank 7, small): thin wrappers over existing internal functions, so the council skill's CLI transport is deterministic; pairs with the A9 recipe fix. Review rank 7 — the only ranked opportunity ≤8 not scheduled; strong candidate to fold into a Phase 8 follow-up or the next engine minor.
10. **Spend tracking** (rank 9, medium): persist per-run cost to ledger/metadata + `amicus spend` rollup + optional OpenRouter credits check.
11. **`amicus_read` pagination/size caps** (rank 10, small): default ~50KB + tail/offset/limit; conversation-mode reads can flood agent context today.
12. **Onboarding/positioning overhaul** (rank 11, medium): demo GIF + real screenshots; fix the site's "Demo" nav link (goes to an install snippet) and the hero's incomplete copyable command; surface the reliability-ledger moat ("your council keeps score" — competitors' councils are stateless).
13. **Council presets** (rank 12, small): `council save/list/show` + built-in free/budget/frontier benches; phase 2 = per-seat roles (devil's advocate, security lens).
14. **Vault export** (rank 13, small): `amicus read <id> --format md|html`, `council report --frontmatter` for second-brain ingestion.
15. **GUI lifecycle polish** (rank 14, medium): window shown immediately with branded loading state (~6s blank today, gated on a version-brittle logo selector), per-session titles/cascade/dynamic debug port, fold-on-idle instead of watchdog discard.
16. **CLI contract polish** (rank 15, small): `--json` on continue/resume/abort, usage strings still teaching the `sidecar` binary, scoped unknown-command help + did-you-mean.

## Pre-existing GitHub issues (untouched by this plan)

17. **#17** Electron 28 → 42 upgrade (own milestone; re-run the self-heal + token-drift suites as its regression gate).
18. **#12** setup wizard alias editor consumes catalog IPC; **#13** stale-catalog memo; **#27** free-models picker UX (the B7 catalog/wizard cluster).
19. **#18** housekeeping (AMICUS_HEADLESS_TEST name, drop husky devDep) — must precede #19; **#19** full `sidecar*` shim removal (next major; Phase 4 completes the deprecation posture so #19 becomes mechanical).

## BACKLOG.md residuals (from the DeepSeek/GLM review rounds)

20. **BL-7 full per-run fold nonce** (needs the e2e-test mock updated); **BL-2** async-ify buildContext/MCP metadata writes; **BL-10** drop the unused `tiktoken` dep (lockfile regen); **L2** dead top-level `tool_use` branch (blocked on `tests/context.test.js:312`).

## New items surfaced during plan grounding (analysts, 2026-07-01)

21. **Fanout wave-metadata race:** `fanout.js:174-180` `writeWaveMetadata` merges `status:'running'` over an abort marker landing in the sub-second window before the orchestrator initializes (Phase 3 does not close it).
22. **`discoverCoworkMcps` win32 path bug:** uses `~/.config/Claude` instead of `%APPDATA%\Claude` (`mcp-discovery.js`) — the doctor's Cowork bonus signal is wrong on Windows.
23. **second-opinion skill description over the 1024-char truncation limit** (1441 chars; trailing NOT-clause invisible) — sibling of the B10 fix Phase 8 ships for the sidecar skill.
24. **Council Review Action v2:** adjudicated verdicts in CI (requires either a headless Stage-2 orchestration mode or claude-code-action driving the skill).
25. **Reminder-string reconciliation:** after `amicus_wait` ships, soften the HEADLESS_START/STATUS sleep-25 reminder strings (`mcp-server.js:219-220`) to prefer wait-over-poll.

## Explicitly rejected by the review (kill reasons on file)

Non-Claude host support (revisit on demand), Ollama/local models (no demand signal; fattens the thin engine), model auto-selection (stronger after spend data exists), desktop notifications, n8n node (stdio-only; cloud n8n can't spawn local processes), VS Code extension (second codebase for data MCP already exposes), response caching (near-zero hit rate on stateful conversations), full web dashboard (static export wins for a solo tool).
