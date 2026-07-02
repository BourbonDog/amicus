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
