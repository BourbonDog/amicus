/**
 * Tests for src/utils/client-detect.js — MCP caller client-tag detection.
 *
 * detectClient(mcpServer) precedence:
 *   1. AMICUS_MCP_CLIENT env override (must be a VALID_CLIENTS member)
 *   2. clientInfo.name from the MCP initialize handshake, pattern-matched
 *   3. unknown/absent → 'cowork' (status-quo default), with a one-time warn
 */

'use strict';

describe('detectClient', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.AMICUS_MCP_CLIENT;
    delete process.env.AMICUS_MCP_CLIENT;
    jest.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) { delete process.env.AMICUS_MCP_CLIENT; }
    else { process.env.AMICUS_MCP_CLIENT = originalEnv; }
  });

  function fakeMcpServer(clientInfo) {
    return { server: { getClientVersion: () => clientInfo } };
  }

  test('env override wins over clientInfo', () => {
    process.env.AMICUS_MCP_CLIENT = 'code-local';
    const { detectClient } = require('../src/utils/client-detect');
    const mcpServer = fakeMcpServer({ name: 'claude-ai', version: '0.1.0' });
    expect(detectClient(mcpServer)).toBe('code-local');
  });

  test('env override to cowork wins over claude-code clientInfo', () => {
    process.env.AMICUS_MCP_CLIENT = 'cowork';
    const { detectClient } = require('../src/utils/client-detect');
    const mcpServer = fakeMcpServer({ name: 'claude-code', version: '1.0.0' });
    expect(detectClient(mcpServer)).toBe('cowork');
  });

  test('invalid env value is ignored (falls through to clientInfo) and warns once', () => {
    process.env.AMICUS_MCP_CLIENT = 'bogus-client';
    const { detectClient } = require('../src/utils/client-detect');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mcpServer = fakeMcpServer({ name: 'claude-code', version: '1.0.0' });
    expect(detectClient(mcpServer)).toBe('code-local');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.some(c => String(c[0]).includes('bogus-client'))).toBe(true);
    spy.mockRestore();
  });

  test('claude-code-ish clientInfo.name maps to code-local', () => {
    const { detectClient } = require('../src/utils/client-detect');
    const cases = ['claude-code', 'Claude Code', 'claude_code', 'ClaudeCode'];
    for (const name of cases) {
      const mcpServer = fakeMcpServer({ name, version: '1.0.0' });
      expect(detectClient(mcpServer)).toBe('code-local');
    }
  });

  test('claude-ai / desktop / cowork clientInfo.name maps to cowork', () => {
    const { detectClient } = require('../src/utils/client-detect');
    const cases = ['claude-ai', 'Claude Desktop', 'claude_desktop', 'cowork', 'Cowork'];
    for (const name of cases) {
      const mcpServer = fakeMcpServer({ name, version: '1.0.0' });
      expect(detectClient(mcpServer)).toBe('cowork');
    }
  });

  test('unknown clientInfo.name defaults to cowork with a one-time warn naming it', () => {
    const { detectClient } = require('../src/utils/client-detect');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mcpServer = fakeMcpServer({ name: 'SomeOtherClient', version: '2.0.0' });
    expect(detectClient(mcpServer)).toBe('cowork');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.some(c => String(c[0]).includes('SomeOtherClient'))).toBe(true);
    spy.mockRestore();
  });

  test('absent clientInfo (no server / no getClientVersion) defaults to cowork with a one-time warn', () => {
    const { detectClient } = require('../src/utils/client-detect');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(detectClient(null)).toBe('cowork');
    expect(detectClient({})).toBe('cowork');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('resolves once per server instance (memoized), not per call', () => {
    const { detectClient } = require('../src/utils/client-detect');
    let calls = 0;
    const mcpServer = {
      server: {
        getClientVersion: () => { calls++; return { name: 'claude-code', version: '1.0.0' }; },
      },
    };
    detectClient(mcpServer);
    detectClient(mcpServer);
    detectClient(mcpServer);
    expect(calls).toBe(1);
  });

  test('the one-time warn for an unrecognized name only fires once across repeated calls on the same server', () => {
    const { detectClient } = require('../src/utils/client-detect');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mcpServer = fakeMcpServer({ name: 'MysteryClient', version: '1.0.0' });
    detectClient(mcpServer);
    detectClient(mcpServer);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test('case-insensitive matching for clientInfo.name', () => {
    const { detectClient } = require('../src/utils/client-detect');
    expect(detectClient(fakeMcpServer({ name: 'CLAUDE-CODE' }))).toBe('code-local');
    expect(detectClient(fakeMcpServer({ name: 'CLAUDE-AI' }))).toBe('cowork');
  });
});
