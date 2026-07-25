'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'preload-workspace.js'), 'utf-8');

const SPEC_CHANNELS = [
  'workspace:list-runs',
  'workspace:get-run',
  'workspace:get-live',
  'workspace:read-artifact',
  'workspace:abort-run',
  'workspace:fold',
  'workspace:open-report',
];

describe('preload-workspace bridge', () => {
  test('exposes exactly window.amicusWorkspace.invoke via contextBridge', () => {
    expect(SRC).toContain("contextBridge.exposeInMainWorld('amicusWorkspace'");
    expect(SRC).toContain('invoke:');
  });

  test('allowlists exactly the seven spec channels', () => {
    for (const ch of SPEC_CHANNELS) { expect(SRC).toContain(`'${ch}'`); }
    // reserved seam must NOT be reachable from the renderer in v1
    expect(SRC).not.toContain('workspace:live-update');
    // count the workspace: literals — exactly 7
    expect((SRC.match(/'workspace:[a-z-]+'/g) || []).length).toBe(7);
  });

  test('unknown channels throw; no shell, no send/on surface', () => {
    expect(SRC).toContain('IPC channel not allowed');
    expect(SRC).not.toContain('shell');
    expect(SRC).not.toContain('ipcRenderer.on');
    expect(SRC).not.toContain('ipcRenderer.send');
  });
});
