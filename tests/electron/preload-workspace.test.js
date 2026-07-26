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

// Behavioral guard: the source-text tests above prove the right words are IN
// the file; they cannot prove the allowlist check actually runs. Inverting
// the guard's condition (`if (ALLOWED_CHANNELS.includes(channel)) { throw }`)
// or deleting the throw while leaving "IPC channel not allowed" in a comment
// both pass every test above untouched. This block mocks electron (virtual,
// so it registers even in local dev where electron is an omitted optional
// dep — preload.test.js pattern), requires the real preload module, and
// exercises the captured invoke function so a broken guard fails a test.
describe('preload-workspace bridge (behavioral)', () => {
  const PRELOAD_PATH = '../../electron/preload-workspace.js';
  let mockExposeInMainWorld;
  let mockInvoke;

  beforeEach(() => {
    jest.resetModules();
    mockExposeInMainWorld = jest.fn();
    mockInvoke = jest.fn(async () => 'ok');
    jest.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
      ipcRenderer: { invoke: mockInvoke },
    }), { virtual: true });
  });

  afterEach(() => {
    jest.dontMock('electron');
  });

  /** Requires the real preload module and returns the object it exposed. */
  function loadBridge() {
    require(PRELOAD_PATH);
    expect(mockExposeInMainWorld).toHaveBeenCalledTimes(1);
    const [name, api] = mockExposeInMainWorld.mock.calls[0];
    expect(name).toBe('amicusWorkspace');
    return api;
  }

  test('exposes exactly one own key: invoke', () => {
    const api = loadBridge();
    expect(Object.keys(api)).toEqual(['invoke']);
  });

  test('an allowlisted channel forwards to ipcRenderer.invoke with the channel and all args intact', () => {
    const api = loadBridge();
    api.invoke('workspace:get-run', 'run-123', { foo: 'bar' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('workspace:get-run', 'run-123', { foo: 'bar' });
  });

  test('an allowlisted channel does not throw', () => {
    const api = loadBridge();
    expect(() => api.invoke('workspace:list-runs')).not.toThrow();
  });

  test('workspace:live-update throws — the reserved seam must never be reachable from the renderer', () => {
    const api = loadBridge();
    expect(() => api.invoke('workspace:live-update')).toThrow(/IPC channel not allowed/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('an arbitrary unknown channel throws', () => {
    const api = loadBridge();
    expect(() => api.invoke('workspace:definitely-not-a-real-channel')).toThrow(/IPC channel not allowed/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
