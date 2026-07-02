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
