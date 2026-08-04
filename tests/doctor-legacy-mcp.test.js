// tests/doctor-legacy-mcp.test.js
// Full-pinned-deps pattern (tests/cli-handlers-doctor.test.js's allGood):
// inspectLegacyMcpEntries/migrateLegacyMcpEntries are injected per test so no
// test reads or writes a real ~/.claude.json, and `base` below pins every
// other doctor dep so nothing falls through to realDeps().
'use strict';
const doctor = require('../src/cli-handlers-doctor');
const HINTS = require('../src/utils/remediation-hints');

const findCheck = (checks, id) => checks.find((c) => c.id === id);
// Hermeticity guard (final-review Item 1 follow-up): runDoctorChecks always
// computes the FULL check list, not just 'mcp-legacy' -- this file used to pin
// only the four --fix self-heal seams (the `base` overrides below) and let
// every OTHER dep fall through to realDeps() and run for real: engine-install
// subprocess scans, the OpenRouter credit network probe, local-provider probes
// against the real user config, etc. baseDeps mirrors the same full-deps shape
// as tests/cli-handlers-doctor.test.js's `allGood` fixture (see that file's
// M14 comment for the original writeup of this exact hazard). The per-test
// inspectLegacyMcpEntries/migrateLegacyMcpEntries overrides still drive the
// real mcp-legacy wiring this file exists to test.
const baseDeps = {
  nodeVersion: 'v20.0.0',
  readApiKeys: () => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false }),
  readApiKeyValues: () => ({ openrouter: 'sk-or-good' }),
  checkOpenRouterCredit: () => Promise.resolve({ warning: null, isFreeTier: false, limitRemaining: 5, limit: 10, usage: 5 }),
  getCwd: () => 'C:\\Users\\me\\code\\amicus',
  readProjectMarkers: () => ({ hasGit: true, hasPackageJson: true, hasClaude: false }),
  getConfigDir: () => '/cfg',
  resolveModel: () => 'openrouter/google/gemini-3.5-flash',
  readCache: () => ({ fetchedAt: Date.now(), models: [{ id: 'openrouter/google/gemini-3.5-flash' }] }),
  collectAliasSources: () => [{ alias: 'gemini', model: 'openrouter/google/gemini-3.5-flash', source: 'defaults' }],
  findStaleAliases: () => [],
  hasOpencodeBinary: () => true,
  getElectronPath: () => '/path/to/electron',
  hasAmicusRegistration: () => true,
  discoverCoworkMcps: () => ({ amicus: {} }),
  inspectLegacyMcpEntries: () => [
    { target: 'Claude Code', status: 'absent' },
    { target: 'Claude Desktop', status: 'absent' },
  ],
  migrateLegacyMcpEntries: () => [],
  skillInstalled: () => true,
  listSessionIndexTmpFiles: () => [],
  scanEngineInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  repairEngine: async () => ({ repaired: false }),
  scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  getLocalProviders: () => ({}),
  probeLocalProvider: jest.fn(),
  env: {},
};
// These suites pass fix:true; before baseDeps existed, unlisted deps inherited
// realDeps() — which made the inherited electron/engine checks SELF-HEAL for
// real: on a box where node_modules/electron/dist is missing
// (scripts-suppressed install), the electron check's d.repairElectron({timeoutMs})
// extracts — or DOWNLOADS (~144MB) — the real binary from inside the unit
// suite, racing the repair lock across jest workers. Keep the probe green and
// both self-heal seams pinned inert; only the legacy-mcp check is under test
// here.
const base = {
  ...baseDeps,
  readApiKeyValues: () => ({}), // offline credit probe
  getElectronPath: () => '/fake/electron', // electron check: ok — repair unreachable
  repairElectron: async () => ({ repaired: true }), // never the real binary self-heal
  repairEngine: async () => ({ repaired: true }), // never the real npx-cache copy-heal
};

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
    expect(c.message).toContain('removed legacy entry from: Claude Code');
  });

  test("doctor --fix success message reads naturally for MULTIPLE targets (triage note)", async () => {
    const migrateLegacyMcpEntries = jest.fn(() => [
      { target: 'Claude Code', result: 'removed' },
      { target: 'Claude Desktop', result: 'removed' },
    ]);
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'removable', config: AMICUS_MCP },
        { target: 'Claude Desktop', status: 'removable', config: AMICUS_MCP },
      ],
      migrateLegacyMcpEntries,
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.status).toBe('ok');
    expect(c.message).toBe('removed legacy entry from: Claude Code, Claude Desktop');
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

  // v4.6 Plan 3 Task 3: repair-success rows carry a structured fixed/fixDetail
  // fact so the doctor-degrade collector never has to parse prose. Prose stays
  // byte-identical — this only ADDS fields.
  test('doctor --fix full removal marks the row fixed with a human-ready detail', async () => {
    const migrateLegacyMcpEntries = jest.fn(() => [
      { target: 'Claude Code', result: 'removed' },
      { target: 'Claude Desktop', result: 'removed' },
    ]);
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'removable', config: AMICUS_MCP },
        { target: 'Claude Desktop', status: 'removable', config: AMICUS_MCP },
      ],
      migrateLegacyMcpEntries,
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.fixed).toBe(true);
    expect(c.fixDetail).toBe("removed the duplicate legacy 'sidecar' entry from Claude Code, Claude Desktop");
    expect(c.message).toBe('removed legacy entry from: Claude Code, Claude Desktop'); // prose byte-identical
  });

  test('doctor --fix that removes nothing does NOT mark fixed', async () => {
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'removable', config: AMICUS_MCP },
      ],
      migrateLegacyMcpEntries: () => [
        { target: 'Claude Code', result: 'write-failed' },
      ],
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.fixed).toBeUndefined();
  });

  test('doctor --fix partial removal (some removed, some not) marks fixed, naming only the removed target', async () => {
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
    expect(c.fixed).toBe(true);
    expect(c.fixDetail).toBe("removed the duplicate legacy 'sidecar' entry from Claude Code");
    expect(c.status).toBe('warn'); // unchanged: partial removal is still a warn
    expect(c.message).toMatch(/removed 1\/2/); // prose byte-identical
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

  // Phase-4 final-review FIX 3: an 'unreadable' config must not be silently
  // folded into ok/'none' — that hides a config the user (or doctor --fix)
  // cannot actually inspect.
  test('unreadable config → WARN "config unreadable — skipped", never a false-ok "none"', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'unreadable' },
        { target: 'Claude Desktop', status: 'absent' },
      ],
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.status).toBe('warn');
    expect(c.message).toContain('Claude Code');
    expect(c.message).toContain('config unreadable — skipped');
  });

  test('unreadable config alongside a real removable dupe still surfaces the unreadable warning', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      inspectLegacyMcpEntries: () => [
        { target: 'Claude Code', status: 'removable', config: AMICUS_MCP },
        { target: 'Claude Desktop', status: 'unreadable' },
      ],
    });
    const c = findCheck(checks, 'mcp-legacy');
    expect(c.status).toBe('warn');
    expect(c.message).toContain('Claude Desktop');
    expect(c.message).toContain('config unreadable — skipped');
  });
});

// Run: npx jest tests/doctor-legacy-mcp.test.js tests/cli-handlers-doctor.test.js tests/doctor-fix.test.js
// Failing-first: 'mcp-legacy' check does not exist → findCheck returns undefined.
// REMEMBER the mandatory allGood edit in tests/cli-handlers-doctor.test.js (see
// Code) — without it the 'all healthy' test reads the machine's real config.
