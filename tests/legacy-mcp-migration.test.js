// Fixture pattern: os.tmpdir config files + the module's own deps injection
// (codePath/desktopPath), mirroring tests/postinstall.test.js. The final
// describe pins the CONSUMED Phase-1 interface with the REAL helper.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Spy on writeFileAtomic while keeping its real temp+rename behavior, so the
// module-under-test's destructured reference (bound at its own require time)
// is the same jest.fn() this file asserts against.
jest.mock('../src/utils/atomic-write', () => {
  const actual = jest.requireActual('../src/utils/atomic-write');
  return { writeFileAtomic: jest.fn(actual.writeFileAtomic) };
});

const {
  inspectLegacySidecarEntry, removeLegacySidecarEntry,
  inspectAllLegacySidecarEntries, migrateLegacySidecar,
} = require('../src/utils/legacy-mcp-migration');
const { writeFileAtomic } = require('../src/utils/atomic-write');

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

  test('writes via the atomic temp+rename helper, not a plain writeFileSync (crash-safety, 4.1 review)', () => {
    writeConfig(codePath, { amicus: AMICUS_MCP, sidecar: AMICUS_MCP });
    writeFileAtomic.mockClear();
    const result = removeLegacySidecarEntry(codePath);
    expect(result).toBe('removed');
    expect(writeFileAtomic).toHaveBeenCalledTimes(1);
    expect(writeFileAtomic).toHaveBeenCalledWith(codePath, expect.any(String), { mode: 0o600 });
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
