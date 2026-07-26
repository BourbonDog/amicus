'use strict';

describe('amicus watch --ui branch', () => {
  afterEach(() => { jest.resetModules(); jest.dontMock('../../src/sidecar/workspace-window'); });

  test('--ui routes to the launcher with cwd project + positional runId and returns its code', async () => {
    const launch = jest.fn(async () => ({ code: 0 }));
    jest.doMock('../../src/sidecar/workspace-window', () => ({ launchWorkspaceWindow: launch }));
    const { handleWatch } = require('../../src/cli-handlers-watch');
    const code = await handleWatch({ _: ['watch', 'aaaa1111'], ui: true, cwd: 'C:\\proj' });
    expect(code).toBe(0);
    expect(launch).toHaveBeenCalledWith({ project: 'C:\\proj', runId: 'aaaa1111' });
  });

  test('bare --ui opens the run list (empty runId)', async () => {
    const launch = jest.fn(async () => ({ code: 0 }));
    jest.doMock('../../src/sidecar/workspace-window', () => ({ launchWorkspaceWindow: launch }));
    const { handleWatch } = require('../../src/cli-handlers-watch');
    await handleWatch({ _: ['watch'], ui: true, cwd: '/p' });
    expect(launch).toHaveBeenCalledWith({ project: '/p', runId: '' });
  });

  test('--ui --json is refused as interactive-only (exit 1, stderr hint)', async () => {
    const { handleWatch } = require('../../src/cli-handlers-watch');
    // Plain reassignment, not jest.spyOn: in this environment jest.spyOn's
    // auto-tracked `.mock.calls` never records process.stdout/stderr.write
    // invocations (verified independently — the mockImplementation callback
    // itself still runs, but the spy's own call-tracking array stays empty),
    // so asserting via `.mock.calls` here would fail regardless of
    // cli-handlers-watch.js's behavior. tests/cli-handlers-watch-resolve.test.js
    // already captures stderr this same way for exactly this reason.
    const origWrite = process.stderr.write;
    const writes = [];
    process.stderr.write = (s) => { writes.push(s); return true; };
    const code = await handleWatch({ _: ['watch', 'aaaa1111'], ui: true, json: true });
    process.stderr.write = origWrite;
    expect(code).toBe(1);
    expect(writes.join('')).toMatch(/interactive-only/);
  });

  // DE-ROT F46: --project must win over --cwd. The shipped handleWatch resolves
  // `args.project || args.cwd || process.cwd()` for the non-`--ui` path (spec:
  // --project is the documented first-priority option for `watch`), so the new
  // `--ui` branch must resolve project the same way — not `args.cwd` only —
  // or `amicus watch <id> --ui --project <p>` would silently open the workspace
  // on the wrong directory.
  test('--project wins over --cwd when both are present', async () => {
    const launch = jest.fn(async () => ({ code: 0 }));
    jest.doMock('../../src/sidecar/workspace-window', () => ({ launchWorkspaceWindow: launch }));
    const { handleWatch } = require('../../src/cli-handlers-watch');
    await handleWatch({ _: ['watch', 'aaaa1111'], ui: true, project: 'D:\\other', cwd: 'C:\\proj' });
    expect(launch).toHaveBeenCalledWith({ project: 'D:\\other', runId: 'aaaa1111' });
  });

  test('cli.js parses --ui as a boolean flag and documents it', () => {
    const { parseArgs, getUsage } = require('../../src/cli');
    const args = parseArgs(['watch', 'aaaa1111', '--ui']);
    expect(args.ui).toBe(true);
    expect(args._[1]).toBe('aaaa1111');
    expect(getUsage('watch')).toContain('--ui');
  });

  // v4.3 already shipped both `--ui` pieces (src/cli.js:149 boolean-flag entry,
  // src/cli.js:606 usage line) as a deliberate v4.4 seam. This task must NOT
  // re-add either — a duplicate `booleanFlags` array entry fails silently (no
  // error, just dead weight), and a second usage line would read as a doc bug.
  // Pin the exact count directly against the source text so a regression
  // (re-adding either piece) is caught even though parseArgs()/getUsage()
  // would behave identically with a duplicate present.
  test('--ui is registered exactly once in cli.js: one booleanFlags entry, one usage line', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../src/cli.js'), 'utf-8');
    const booleanFlagEntries = src.match(/^\s*'ui',/gm) || [];
    const usageLines = src.match(/^\s*--ui\s/gm) || [];
    expect(booleanFlagEntries.length).toBe(1);
    expect(usageLines.length).toBe(1);
  });
});
