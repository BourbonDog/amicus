# MCP Update Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The MCP server checks for updates at startup and appends one flavor-aware notice block to the first successful tool result per process (plus an always-on `amicus_guide` line), so MCP-only users finally hear about new versions.

**Architecture:** New pure-helper module `src/utils/update-notice.js` (sibling of `version-info.js`, latch style of `mcp-notify.js`) carries all logic; `mcp-server.js` gains a fire-and-forget startup check and routes every wrapper result through the seam; `getGuideText()` gains one line. Spec: `docs/superpowers/specs/2026-08-03-mcp-update-notice-design.md`.

**Tech Stack:** Node CJS, jest (CJS VM — never let real `update-notifier` ESM import run in tests; `AMICUS_MOCK_UPDATE` env drives all test paths), existing seams `updater.js` / `mcp-discovery.readAmicusMcpConfig` / `engine-install-scan.classifyLaunch`.

## Global Constraints

- Branch: `feat/mcp-update-notice` (already exists, based on main @ `c08e575`, holds the spec commit `1ee92ea`).
- Advisory-only: every new export swallows its own failures (try/catch → no-op/fallback); a notice failure must never alter a tool result or throw into the wrapper.
- No `performUpdate` over MCP; no periodic re-check; CLI/GUI paths untouched (spec D3/D4).
- The latch flips ONLY on an actual append (spec §3) — isError/no-update/racing-init calls leave it armed.
- Voice: config-derived instructions are stated as fact; self-path fallback wording keeps the "likely" hedge (v4.6 hint ruling).
- `normalizeToken()` strips `@version` suffixes — `@latest` detection MUST inspect raw arg tokens, never normalized ones.
- House style: `'use strict';`, single quotes, semicolons, JSDoc on exports. `npm run lint` must stay clean.
- Do not touch `cli-handlers-council-run.js` (tight-ledger file at 299/300 lines).
- Windows dev box: run jest via `npx jest <file>`; full suite `npm test` takes minutes — only in Task 4.

---

### Task 1: `update-notice.js` module + unit tests

**Files:**
- Create: `src/utils/update-notice.js`
- Test: `tests/update-notice.test.js`

**Interfaces:**
- Consumes: `require('./version-info').PKG_PATH` (string abs path); `require('./updater').getUpdateInfo()` → `{current, latest, hasUpdate}|null`; `require('./mcp-discovery').readAmicusMcpConfig()` → `{command?, args?}|null`; `require('./engine-install-scan').classifyLaunch(config)` → `'npx'|'path'|'none'|'unknown'`.
- Produces (Tasks 2–3 rely on these exact names): `maybeAppendUpdateNotice(result, deps?)` → same result object; `guideUpdateLine(deps?)` → `string|null`; `buildUpdateNotice(info, instruction?)` → string; `upgradeInstruction(deps?)` → string; `classifySelfInstall(deps?)` → `'global'|'npx'|'other'`; `_resetLatchForTests()`.

- [ ] **Step 1: Write the failing test**

Create `tests/update-notice.test.js`:

```js
'use strict';

/**
 * Unit tests for src/utils/update-notice.js (spec 2026-08-03) — the MCP
 * channel's update notice. No network, no real update-notifier: update info
 * comes from AMICUS_MOCK_UPDATE=available (updater.js mock mode) or an
 * injected getUpdateInfo seam; config/self-path classification comes from
 * injected seams throughout.
 */

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.AMICUS_MOCK_UPDATE;
  jest.resetModules();
});

afterAll(() => { process.env = { ...originalEnv }; });

const load = () => require('../src/utils/update-notice');

describe('classifySelfInstall()', () => {
  const fakeFs = (real) => ({ realpathSync: () => real });

  it('classifies an npx-cache copy', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: fakeFs('C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\amicus\\package.json'),
      pkgPath: 'irrelevant',
    })).toBe('npx');
  });

  it('classifies a global install (node_modules, no _npx)', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: fakeFs('/usr/local/lib/node_modules/amicus/package.json'),
      pkgPath: 'irrelevant',
    })).toBe('global');
  });

  it('classifies a dev clone as other', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: fakeFs('C:\\Users\\x\\code\\amicus\\package.json'),
      pkgPath: 'irrelevant',
    })).toBe('other');
  });

  it('returns other when realpath throws', () => {
    const { classifySelfInstall } = load();
    expect(classifySelfInstall({
      fs: { realpathSync: () => { throw new Error('boom'); } },
      pkgPath: 'irrelevant',
    })).toBe('other');
  });
});

describe('upgradeInstruction()', () => {
  it('npx config pinning amicus@latest -> restart-only line (verified voice)', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
    });
    expect(line).toBe('Restart your MCP client — it launches `amicus@latest` and will pick up the new version.');
  });

  it('npx config pinning bare amicus -> cached-copy hint (unverified voice)', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus', 'mcp'] }),
    });
    expect(line).toMatch(/^Your MCP config likely launches a cached\/pinned npx copy/);
    expect(line).toContain('npx -y amicus@latest mcp');
  });

  it('npx config pinning a semver -> same cached-copy hint', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus@4.3.0', 'mcp'] }),
    });
    expect(line).toMatch(/^Your MCP config likely launches a cached\/pinned npx copy/);
  });

  it('path config + global self -> npm i -g line', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'amicus', args: ['mcp'] }),
      selfFlavor: () => 'global',
    });
    expect(line).toBe('Run `npm install -g amicus`, then restart your MCP client.');
  });

  it('path config + other self (dev clone) -> generic line', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => ({ command: 'amicus', args: ['mcp'] }),
      selfFlavor: () => 'other',
    });
    expect(line).toBe('Upgrade your amicus install, then restart your MCP client.');
  });

  it('unreadable config falls back to self flavor: npx self -> cached-copy hint', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => { throw new Error('no config'); },
      selfFlavor: () => 'npx',
    });
    expect(line).toMatch(/^Your MCP config likely launches a cached\/pinned npx copy/);
  });

  it('null config falls back to self flavor: global self -> npm i -g line', () => {
    const { upgradeInstruction } = load();
    const line = upgradeInstruction({
      readConfig: () => null,
      selfFlavor: () => 'global',
    });
    expect(line).toBe('Run `npm install -g amicus`, then restart your MCP client.');
  });
});

describe('buildUpdateNotice()', () => {
  it('renders version pair, instruction, and changelog link', () => {
    const { buildUpdateNotice } = load();
    const text = buildUpdateNotice({ current: '4.3.0', latest: '4.6.0', hasUpdate: true }, 'INSTRUCTION.');
    expect(text).toBe('Update available: amicus v4.3.0 → v4.6.0. INSTRUCTION. '
      + 'Changelog: https://github.com/BourbonDog/amicus/blob/main/CHANGELOG.md');
  });
});

describe('maybeAppendUpdateNotice()', () => {
  const freshResult = () => ({ content: [{ type: 'text', text: 'payload' }] });
  const infoSeam = () => ({ current: '4.3.0', latest: '9.9.9', hasUpdate: true });

  it('appends one notice block and latches: second call is a no-op', () => {
    const { maybeAppendUpdateNotice } = load();
    const first = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(first.content).toHaveLength(2);
    expect(first.content[1].type).toBe('text');
    expect(first.content[1].text).toMatch(/^Update available: amicus v4\.3\.0 → v9\.9\.9\./);
    const second = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(second.content).toHaveLength(1);
  });

  it('skips isError results and leaves the latch armed', () => {
    const { maybeAppendUpdateNotice } = load();
    const err = { content: [{ type: 'text', text: 'Error: x' }], isError: true };
    expect(maybeAppendUpdateNotice(err, { getUpdateInfo: infoSeam }).content).toHaveLength(1);
    // latch still armed: a later success gets the notice
    const ok = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(ok.content).toHaveLength(2);
  });

  it('no update known -> no-op, latch stays armed', () => {
    const { maybeAppendUpdateNotice } = load();
    const r1 = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: () => null });
    expect(r1.content).toHaveLength(1);
    const r2 = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(r2.content).toHaveLength(2);
  });

  it('never throws: a throwing getUpdateInfo returns the original result', () => {
    const { maybeAppendUpdateNotice } = load();
    const r = freshResult();
    expect(maybeAppendUpdateNotice(r, { getUpdateInfo: () => { throw new Error('boom'); } })).toBe(r);
    expect(r.content).toHaveLength(1);
  });

  it('tolerates malformed results (null / missing content)', () => {
    const { maybeAppendUpdateNotice } = load();
    expect(maybeAppendUpdateNotice(null, { getUpdateInfo: infoSeam })).toBeNull();
    const bare = {};
    expect(maybeAppendUpdateNotice(bare, { getUpdateInfo: infoSeam })).toBe(bare);
  });

  it('_resetLatchForTests re-arms the latch', () => {
    const { maybeAppendUpdateNotice, _resetLatchForTests } = load();
    maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    _resetLatchForTests();
    const again = maybeAppendUpdateNotice(freshResult(), { getUpdateInfo: infoSeam });
    expect(again.content).toHaveLength(2);
  });
});

describe('guideUpdateLine()', () => {
  it('returns the guide line when an update is known', () => {
    const { guideUpdateLine } = load();
    const line = guideUpdateLine({
      getUpdateInfo: () => ({ current: '4.3.0', latest: '9.9.9', hasUpdate: true }),
      readConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
    });
    expect(line).toBe('**Update available: v9.9.9** — Restart your MCP client — it launches `amicus@latest` and will pick up the new version.');
  });

  it('returns null when no update is known', () => {
    const { guideUpdateLine } = load();
    expect(guideUpdateLine({ getUpdateInfo: () => null })).toBeNull();
  });

  it('returns null instead of throwing on a broken seam', () => {
    const { guideUpdateLine } = load();
    expect(guideUpdateLine({ getUpdateInfo: () => { throw new Error('boom'); } })).toBeNull();
  });

  it('works through the real updater under AMICUS_MOCK_UPDATE=available', () => {
    process.env.AMICUS_MOCK_UPDATE = 'available';
    const { guideUpdateLine } = load();
    const line = guideUpdateLine({ readConfig: () => null, selfFlavor: () => 'global' });
    expect(line).toContain('**Update available: v99.0.0**');
    expect(line).toContain('npm install -g amicus');
  });
});

// Run: npx jest tests/update-notice.test.js
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/update-notice.test.js`
Expected: FAIL — `Cannot find module '../src/utils/update-notice'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/update-notice.js`:

```js
/**
 * @module utils/update-notice — "a newer amicus exists" for the MCP channel
 *
 * The MCP server is the one entry point that skips bin/amicus.js's update
 * banner (deliberately — stdout is protocol). This module is the MCP-shaped
 * replacement (spec docs/superpowers/specs/2026-08-03-mcp-update-notice-design.md):
 * updater.js's cached check rendered as ONE appended text content block on the
 * first successful tool result of the process (latched, D1), plus an always-on
 * line in amicus_guide.
 *
 * Voice contract (v4.6 hint ruling): the version pair is verified fact; the
 * upgrade instruction is stated as fact only when derived from a readable MCP
 * registration config — fallbacks keep the "likely" hedge. Everything here is
 * advisory: every export swallows its own failures rather than throwing into
 * a tool result.
 */

'use strict';

const path = require('path');

/** Upgrade wordings (spec §4). Config-derived rows are verified-voiced;
 *  NPX_CACHED_LINE keeps the hedge — the config read is best-effort. */
const GLOBAL_LINE = 'Run `npm install -g amicus`, then restart your MCP client.';
const NPX_LATEST_LINE = 'Restart your MCP client — it launches `amicus@latest` and will pick up the new version.';
const NPX_CACHED_LINE = 'Your MCP config likely launches a cached/pinned npx copy; '
  + 'point it at `npx -y amicus@latest mcp` (or clear the npx cache), then restart your MCP client.';
const GENERIC_LINE = 'Upgrade your amicus install, then restart your MCP client.';

const CHANGELOG_URL = 'https://github.com/BourbonDog/amicus/blob/main/CHANGELOG.md';

/**
 * Flavor of THIS install — the copy serving the current process. Pure path
 * heuristic on the realpath of our own package.json (no `npm root -g` shellout
 * on the tool-result path): a `_npx` segment is the npx cache; any other
 * `node_modules` home is a global-style install; no `node_modules` at all is a
 * dev clone or similar.
 * @param {{fs?: object, pkgPath?: string}} [deps]
 * @returns {'global'|'npx'|'other'}
 */
function classifySelfInstall(deps = {}) {
  const fs = deps.fs || require('fs');
  const pkgPath = deps.pkgPath || require('./version-info').PKG_PATH;
  try {
    const real = fs.realpathSync(pkgPath);
    const parts = path.dirname(real).split(/[\\/]/);
    if (parts.includes('_npx')) { return 'npx'; }
    if (parts.includes('node_modules')) { return 'global'; }
    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * True when some RAW config arg is the amicus package token pinned `@latest`.
 * Raw on purpose: mcp-self-identity's normalizeToken strips `@version`
 * suffixes, which is exactly the information this check needs.
 * @param {{args?: unknown[]}|null|undefined} config
 */
function pinsAmicusLatest(config) {
  const args = Array.isArray(config && config.args) ? config.args : [];
  return args.some((a) => {
    const t = String(a).toLowerCase().replace(/\\/g, '/');
    const base = t.includes('/') ? t.slice(t.lastIndexOf('/') + 1) : t;
    return base === 'amicus@latest';
  });
}

/**
 * The one correct upgrade move for this install (spec §4), chosen
 * config-first (what a RESTART will launch), self-path fallback.
 * Never throws; worst case is the generic line.
 * @param {{readConfig?: Function, classifyLaunch?: Function, selfFlavor?: Function}} [deps]
 * @returns {string}
 */
function upgradeInstruction(deps = {}) {
  try {
    const readConfig = deps.readConfig
      || (() => require('./mcp-discovery').readAmicusMcpConfig());
    const classifyLaunchFn = deps.classifyLaunch
      || require('./engine-install-scan').classifyLaunch;
    const selfFlavor = deps.selfFlavor || (() => classifySelfInstall(deps));

    let config = null;
    try { config = readConfig(); } catch { config = null; }

    const launch = classifyLaunchFn(config);
    if (launch === 'npx') {
      return pinsAmicusLatest(config) ? NPX_LATEST_LINE : NPX_CACHED_LINE;
    }
    if (launch === 'path') {
      // A path registration launches (approximately) the running copy — let
      // its flavor pick between the npm-global move and the generic one.
      return selfFlavor() === 'global' ? GLOBAL_LINE : GENERIC_LINE;
    }
    // 'none' / 'unknown' — config unreadable or unrecognized: self-path fallback.
    const flavor = selfFlavor();
    if (flavor === 'global') { return GLOBAL_LINE; }
    if (flavor === 'npx') { return NPX_CACHED_LINE; }
    return GENERIC_LINE;
  } catch {
    return GENERIC_LINE;
  }
}

/**
 * The full notice text: verified version pair + instruction + changelog.
 * @param {{current: string, latest: string}} info
 * @param {string} [instruction] - resolved lazily when omitted
 */
function buildUpdateNotice(info, instruction) {
  return `Update available: amicus v${info.current} → v${info.latest}. `
    + `${instruction || upgradeInstruction()} Changelog: ${CHANGELOG_URL}`;
}

/** Once-per-process latch (spec D1). Flips ONLY on an actual append. */
let _noticeShown = false;

/** Test seam: re-arm the latch. */
function _resetLatchForTests() { _noticeShown = false; }

/**
 * The seam the MCP registration wrapper routes EVERY result through: append
 * the notice block to the first successful tool result of this process, then
 * stay quiet. No-op on isError results, unknown update state, malformed
 * results, or any internal failure — the original result always comes back.
 * @param {{content?: Array, isError?: boolean}|null} result
 * @param {{getUpdateInfo?: Function}} [deps]
 */
function maybeAppendUpdateNotice(result, deps = {}) {
  try {
    if (_noticeShown) { return result; }
    if (!result || result.isError || !Array.isArray(result.content)) { return result; }
    const getUpdateInfo = deps.getUpdateInfo || require('./updater').getUpdateInfo;
    const info = getUpdateInfo();
    if (!info || !info.hasUpdate) { return result; }
    result.content.push({ type: 'text', text: buildUpdateNotice(info) });
    _noticeShown = true;
    return result;
  } catch {
    return result;
  }
}

/**
 * The amicus_guide version-line suffix (NOT latched — the guide is the
 * on-demand surface), or null when there is nothing to say.
 * @param {{getUpdateInfo?: Function}} [deps] - plus upgradeInstruction seams
 * @returns {string|null}
 */
function guideUpdateLine(deps = {}) {
  try {
    const getUpdateInfo = deps.getUpdateInfo || require('./updater').getUpdateInfo;
    const info = getUpdateInfo();
    if (!info || !info.hasUpdate) { return null; }
    return `**Update available: v${info.latest}** — ${upgradeInstruction(deps)}`;
  } catch {
    return null;
  }
}

module.exports = {
  classifySelfInstall,
  upgradeInstruction,
  buildUpdateNotice,
  maybeAppendUpdateNotice,
  guideUpdateLine,
  _resetLatchForTests,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/update-notice.test.js`
Expected: PASS (all ~20 tests)

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/update-notice.js tests/update-notice.test.js
git commit -m "feat: update-notice module — flavor-aware MCP update notice helpers"
```

---

### Task 2: MCP server wiring + registration-level test

**Files:**
- Modify: `src/mcp-server.js` (startup init inside `startMcpServer()`, wrapper routing at the registration closure — currently lines 1452-1490)
- Test: `tests/mcp-server-update-notice.test.js` (new; pattern cloned from `tests/mcp-server-legacy-aliases.test.js`)

**Interfaces:**
- Consumes: `maybeAppendUpdateNotice(result)` from Task 1; `initUpdateCheck()`/`getUpdateInfo()` from `src/utils/updater`.
- Produces: no new exports — behavior only (every registered tool's callback routes results through the seam).

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-server-update-notice.test.js`:

```js
'use strict';

/**
 * Registration-level coverage for the MCP update notice (spec 2026-08-03):
 * mock the MCP SDK to capture each registered tool callback (the pattern of
 * tests/mcp-server-legacy-aliases.test.js, extended to keep the callback),
 * then drive callbacks like a client would. AMICUS_MOCK_UPDATE=available
 * makes updater.getUpdateInfo() return a fake without touching the ESM-only
 * update-notifier (jest's CJS VM cannot import() it); AMICUS_PROJECT_DIR
 * pins project resolution to the env fast path so the bare mock server is
 * never asked for roots.
 */

const os = require('os');

// jest.mock factories may only reference out-of-scope vars named mock*.
const mockRegistered = [];
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn(() => ({
    registerTool: (name, meta, cb) => { mockRegistered.push({ name, cb }); },
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(() => ({})),
}));

const originalEnv = { ...process.env };
const sigBaseline = {};
let startMcpServer;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
  process.env.AMICUS_MOCK_UPDATE = 'available';
  process.env.AMICUS_PROJECT_DIR = os.tmpdir();
  mockRegistered.length = 0;
  ({ startMcpServer } = require('../src/mcp-server'));
  for (const sig of ['SIGTERM', 'SIGINT']) { sigBaseline[sig] = process.listeners(sig); }
});

afterEach(() => {
  process.env = { ...originalEnv };
  for (const sig of ['SIGTERM', 'SIGINT']) {
    for (const l of process.listeners(sig)) {
      if (!sigBaseline[sig].includes(l)) { process.removeListener(sig, l); }
    }
  }
});

const notices = (result) => (result.content || [])
  .filter((b) => b.type === 'text' && typeof b.text === 'string'
    && b.text.startsWith('Update available: amicus'));

describe('MCP update notice wiring (spec 2026-08-03)', () => {
  test('first successful tool result carries exactly one notice block, then latched', async () => {
    await startMcpServer();
    const guide = mockRegistered.find((t) => t.name === 'amicus_guide');
    expect(guide).toBeDefined();

    const first = await guide.cb({});
    expect(first.isError).toBeUndefined();
    expect(notices(first)).toHaveLength(1);
    expect(notices(first)[0].text).toContain('v99.0.0'); // updater mock FAKE_LATEST

    const second = await guide.cb({});
    expect(notices(second)).toHaveLength(0);
  });

  test('an error result does not consume the once — the next success still notices', async () => {
    await startMcpServer();
    const status = mockRegistered.find((t) => t.name === 'amicus_status');
    const guide = mockRegistered.find((t) => t.name === 'amicus_guide');

    // Bogus taskId in an empty project dir -> handler (or wrapper catch)
    // produces an isError result either way; the seam must skip it.
    const err = await status.cb({ taskId: 'no-such-task-xyz' });
    expect(err.isError).toBe(true);
    expect(notices(err)).toHaveLength(0);

    const ok = await guide.cb({});
    expect(notices(ok)).toHaveLength(1);
  });

  test('without mock update info, no notice appears anywhere', async () => {
    delete process.env.AMICUS_MOCK_UPDATE;
    jest.resetModules();
    // House rule (see tests/updater.test.js): never let the real ESM-only
    // update-notifier import() run in jest's CJS VM — mock the loader seam
    // to a notifier with no update.
    jest.doMock('../src/utils/update-notifier-loader', () => ({
      loadUpdateNotifier: () => Promise.resolve({ default: () => ({ update: undefined, notify: () => {} }) }),
    }));
    ({ startMcpServer } = require('../src/mcp-server'));
    await startMcpServer();
    const guide = mockRegistered.find((t) => t.name === 'amicus_guide');
    const result = await guide.cb({});
    expect(notices(result)).toHaveLength(0);
  });
});

// Run: npx jest tests/mcp-server-update-notice.test.js
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/mcp-server-update-notice.test.js`
Expected: FAIL — first and second test's `notices(...)` are empty (no wiring yet); third test passes vacuously.

- [ ] **Step 3: Wire the server**

In `src/mcp-server.js`, inside `startMcpServer()`, immediately after the `new McpServer(...)` construction and before the `for (const tool of getTools())` loop, insert:

```js
  // MCP update notice (spec 2026-08-03): the MCP server replaces the CLI's
  // deliberately-skipped pre-command update check. Fire-and-forget — startup
  // is never delayed; when the async init resolves with an update known, one
  // stderr line lands in the client's MCP log. The per-result notice itself
  // is appended by maybeAppendUpdateNotice in the registration wrapper below.
  const { initUpdateCheck, getUpdateInfo } = require('./utils/updater');
  const { maybeAppendUpdateNotice } = require('./utils/update-notice');
  initUpdateCheck().then(() => {
    const updateInfo = getUpdateInfo();
    if (updateInfo && updateInfo.hasUpdate) {
      process.stderr.write(
        `[amicus] update available: v${updateInfo.current} -> v${updateInfo.latest}\n`);
    }
  }).catch(() => { /* advisory only */ });
```

Then route the wrapper (both branches — the seam's isError check is the gate). Replace:

```js
      async (input) => {
        try {
          const project = await resolveProjectDir(input.project, server);
          return await handlers[tool.name](input, project, server);
        }
        catch (err) {
          logger.error(`MCP tool error: ${name}`, { error: err.message });
          return textResult(`Error: ${err.message}`, true);
        }
      }
```

with:

```js
      async (input) => {
        try {
          const project = await resolveProjectDir(input.project, server);
          return maybeAppendUpdateNotice(await handlers[tool.name](input, project, server));
        }
        catch (err) {
          logger.error(`MCP tool error: ${name}`, { error: err.message });
          return maybeAppendUpdateNotice(textResult(`Error: ${err.message}`, true));
        }
      }
```

- [ ] **Step 4: Run the new test + neighbors to verify green**

Run: `npx jest tests/mcp-server-update-notice.test.js tests/mcp-server-legacy-aliases.test.js tests/updater.test.js`
Expected: PASS (legacy-aliases proves registration behavior is otherwise unchanged; updater proves no regression in mock modes)

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/mcp-server.js tests/mcp-server-update-notice.test.js
git commit -m "feat: MCP server surfaces update notice — startup check + once-per-process result block"
```

---

### Task 3: `amicus_guide` version line

**Files:**
- Modify: `src/mcp-tools.js` — `getGuideText()` (currently lines 569-584)
- Test: `tests/mcp-tools.test.js` (append a describe block)

**Interfaces:**
- Consumes: `guideUpdateLine()` from Task 1 (string|null; reads env-driven mock at call time — no resetModules needed in tests).
- Produces: `getGuideText()` output gains one blockquote line when an update is known.

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-tools.test.js` (top level, after the existing describes):

```js
describe('getGuideText update line (spec 2026-08-03)', () => {
  const originalMock = process.env.AMICUS_MOCK_UPDATE;

  afterEach(() => {
    if (originalMock === undefined) { delete process.env.AMICUS_MOCK_UPDATE; }
    else { process.env.AMICUS_MOCK_UPDATE = originalMock; }
  });

  test('shows the update-available line under mock mode', () => {
    process.env.AMICUS_MOCK_UPDATE = 'available';
    const text = getGuideText();
    expect(text).toContain('**Update available: v99.0.0**'); // updater mock FAKE_LATEST
  });

  test('no update known: no update line', () => {
    delete process.env.AMICUS_MOCK_UPDATE;
    const text = getGuideText();
    expect(text).not.toContain('Update available:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/mcp-tools.test.js`
Expected: FAIL — first new test: guide text lacks the update line. (Existing tests stay green.)

- [ ] **Step 3: Add the line**

In `src/mcp-tools.js` `getGuideText()`, replace:

```js
  // #33: surface the running version (and a call-time staleness warning) so a
  // post-upgrade agent session can tell it's running old code.
  const warn = versionWarning();
  const versionLine = `**Running amicus version:** ${RUNNING_VERSION}`
    + (warn ? `\n\n> ⚠️ ${warn}` : '');
```

with:

```js
  // #33: surface the running version (and a call-time staleness warning) so a
  // post-upgrade agent session can tell it's running old code. Spec 2026-08-03
  // adds the registry-side sibling: a newer release exists (not latched here —
  // the guide is the on-demand surface).
  const warn = versionWarning();
  const updateLine = require('./utils/update-notice').guideUpdateLine();
  const versionLine = `**Running amicus version:** ${RUNNING_VERSION}`
    + (updateLine ? `\n\n> ${updateLine}` : '')
    + (warn ? `\n\n> ⚠️ ${warn}` : '');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/mcp-tools.test.js tests/update-notice.test.js`
Expected: PASS

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/mcp-tools.js tests/mcp-tools.test.js
git commit -m "feat: amicus_guide shows update-available line when a newer release is known"
```

---

### Task 4: CHANGELOG + full suite

**Files:**
- Modify: `CHANGELOG.md` (top `## [Unreleased]` section)

- [ ] **Step 1: Add the CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add an `### Added` section ABOVE the existing `### Removed` (Keep-a-Changelog order — Added before Removed):

```markdown
### Added

- **The MCP channel finally hears about new versions** (spec 2026-08-03). The MCP server now
  runs the update check at startup and appends one flavor-aware notice block to the first
  successful tool result of each server process (once per session, latched); `amicus_guide`
  carries an always-on update line, and one `[amicus] update available` line lands in the
  client's MCP log on stderr. The instruction is chosen config-first (`npx -y amicus@latest`
  registrations are told a restart suffices; cached/pinned npx copies get the re-point-or-
  clear-cache hint in the unverified voice; global installs get `npm install -g amicus`, from
  where #33's stale-version warning takes over). Words only — no auto-update over MCP, no
  periodic re-check; `NO_UPDATE_NOTIFIER=1` still disables the check entirely.
```

- [ ] **Step 2: Run the full suite**

Run: `npm test` (allow several minutes)
Expected: all suites PASS (posttest marker script runs automatically)

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG — MCP update notice under Unreleased"
```
