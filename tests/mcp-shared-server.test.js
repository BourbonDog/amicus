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

  test('checks the shared-server enabled feature flag', () => {
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

describe('Phase 12a.1: shared-server path threads the DETECTED client, not a hardcode (B02)', () => {
  // The shared path needs a live OpenCode server to exercise end-to-end; pin the
  // call sites at the source level (established style, see mcp-start-metadata.test.js).
  const src = fs.readFileSync(
    path.join(__dirname, '../src/mcp-server.js'), 'utf-8'
  );

  test('buildContext on the shared-server path receives the detected client, not a bare cowork literal', () => {
    const start = src.indexOf('context = buildContext(cwd');
    const end = src.indexOf('buildPrompts(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const call = src.slice(start, end);
    // Must reference the resolved client variable, and must NOT hardcode 'cowork'.
    expect(call).toMatch(/client:\s*(detectedClient|client)\b/);
    expect(call).not.toMatch(/client:\s*'cowork'/);
  });

  test('none of the four spawn-arg builders hardcode --client cowork anymore', () => {
    expect(src).not.toMatch(/'--client',\s*'cowork'/);
  });

  test('detectClient is imported and resolved once per server instance in startMcpServer', () => {
    expect(src).toContain("require('./utils/client-detect')");
    expect(src).toContain('detectClient');
  });
});
