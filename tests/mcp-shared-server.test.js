'use strict';

const fs = require('fs');
const path = require('path');

describe('MCP shared server integration', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/mcp-server.js'), 'utf-8'
  );

  test('imports SharedServerManager', () => {
    expect(src).toContain('shared-server');
    expect(src).toContain('SharedServerManager');
  });

  test('checks SIDECAR_SHARED_SERVER feature flag', () => {
    expect(src).toContain('sharedServer.enabled');
  });

  test('has SIGTERM/SIGINT cleanup handlers', () => {
    expect(src).toContain('SIGTERM');
    expect(src).toContain('sharedServer.shutdown()');
  });
});

describe('MCP shared server uses runHeadless', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/mcp-server.js'), 'utf-8'
  );

  test('imports runHeadless', () => {
    expect(src).toContain('runHeadless');
    expect(src).toContain('buildContext');
    // #36: the shared-server .then must route through finalizeHeadlessResult
    // (resolveTerminalState) so failed runs never default to 'complete'.
    expect(src).toContain('finalizeHeadlessResult');
  });
});
