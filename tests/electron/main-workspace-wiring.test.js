'use strict';

const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf-8');

describe('main.js council-workspace mode wiring', () => {
  test('mode branch dispatches to the workspace shell', () => {
    expect(MAIN).toContain("MODE === 'council-workspace'");
    expect(MAIN).toContain('createCouncilWorkspace');
  });

  test('workspace env consts are read beside the existing ones', () => {
    expect(MAIN).toContain('AMICUS_PROJECT');
    expect(MAIN).toContain('AMICUS_RUN_ID');
  });

  test('workspace handlers register pinned to the workspace window with the launch nonce', () => {
    expect(MAIN).toContain('registerWorkspaceHandlers');
    expect(MAIN).toContain('createWorkspaceWindow');
    // nonce threading: env value or a defensive fresh one (fold.js precedent)
    expect(MAIN).toContain('FOLD_NONCE || ');
  });

  test('setup and sidecar modes are untouched', () => {
    expect(MAIN).toContain("MODE === 'setup'");
    expect(MAIN).toContain('createAmicusWindow()');
  });
});
