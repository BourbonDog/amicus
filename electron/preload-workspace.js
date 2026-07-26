/**
 * Council Workspace Preload — minimal typed IPC bridge (v4.4 §4.2/§4.5).
 *
 * The workspace page loads via loadFile (a real file:// origin), so
 * contextBridge works under FULL sandbox — no data:-URL workaround needed
 * (docs/electron-testing.md Known Limitations; the setup wizard only works
 * because it runs sandbox:false, a posture this page must not inherit: it
 * renders untrusted model prose, the H9 surface).
 *
 * Exposes exactly one function. No openExternal bridge, no listeners.
 * Unknown channel → throw (preload-setup.js pattern).
 *
 * ⚠️ DE-ROT (F30): this header used to name the banned electron module (the
 * one preload-setup.js:9 imports for openExternal). Step 1 asserts
 * expect(SRC).not.toContain(...) against the RAW file source — comments
 * included — so that word here made Task 7 fail its own test. Never let the
 * literal token appear anywhere in this file. Step 4's "PASS (3 tests)" is
 * correct only with the reworded line above.
 */
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = [
  'workspace:list-runs',
  'workspace:get-run',
  'workspace:get-live',
  'workspace:read-artifact',
  'workspace:abort-run',
  'workspace:fold',
  'workspace:open-report',
];

contextBridge.exposeInMainWorld('amicusWorkspace', {
  /** Invoke an allowlisted workspace IPC channel. */
  invoke: (channel, ...args) => {
    if (!ALLOWED_CHANNELS.includes(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
