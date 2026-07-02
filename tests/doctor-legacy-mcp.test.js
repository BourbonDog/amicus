// tests/doctor-legacy-mcp.test.js
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
