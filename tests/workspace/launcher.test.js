'use strict';

const { EventEmitter } = require('events');

const { launchWorkspaceWindow } = require('../../src/sidecar/workspace-window');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  return child;
}

// launchWorkspaceWindow legitimately awaits ensureElectron() before it calls
// spawnFn(...) and attaches listeners on the returned child — that ordering is
// the whole point of test 3 below (a failed/erroring ensureElectron() must
// short-circuit before any process is spawned). That means listener attachment
// happens at least one tick after launchWorkspaceWindow() is called. In real
// usage this is invisible: OS pipe I/O can't deliver a 'data'/'close' event
// before Node has even finished spawning the child. But a pre-built fake child
// whose events are emitted synchronously in the test body would fire before
// the listeners exist and be silently dropped (or, for 'error', crash the
// process — EventEmitter has no listener to catch it). setImmediate() flushes
// the microtask queue so the emit lands after listeners are attached, matching
// how the real, inherently-async child process would behave.
function flush() {
  return new Promise((resolve) => { setImmediate(resolve); });
}

describe('launchWorkspaceWindow', () => {
  test('spawns electron main.js with the workspace env contract and relays stdout live', async () => {
    const child = fakeChild();
    const spawn = jest.fn(() => child);
    const writes = [];
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });

    const promise = launchWorkspaceWindow({ project: 'C:\\proj', runId: 'aaaa1111' }, {
      ensureElectron: async () => ({ ok: true, path: 'C:\\electron.exe' }),
      spawn,
      nonce: 'cafef00dcafef00d',
    });
    await flush();
    child.stdout.emit('data', 'FOLD LINE 1\n');
    child.emit('close', 0);
    const res = await promise;
    stdoutWrite.mockRestore();

    expect(res.code).toBe(0);
    expect(writes).toContain('FOLD LINE 1\n');
    const [bin, args, opts] = spawn.mock.calls[0];
    expect(bin).toBe('C:\\electron.exe');
    expect(args[args.length - 1]).toMatch(/electron[\\/]+main\.js$/);
    expect(opts.env).toMatchObject({
      AMICUS_MODE: 'council-workspace',
      AMICUS_PROJECT: 'C:\\proj',
      AMICUS_RUN_ID: 'aaaa1111',
      AMICUS_FOLD_NONCE: 'cafef00dcafef00d',
    });
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  test('relays each stdout chunk to the parent immediately on data — before the child exits, not buffered until close', async () => {
    const child = fakeChild();
    const spawn = jest.fn(() => child);
    const writes = [];
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });

    const promise = launchWorkspaceWindow({ project: '/p', runId: 'r1' }, {
      ensureElectron: async () => ({ ok: true, path: 'electron' }),
      spawn,
    });
    await flush();

    // Two chunks, checked as they land — the child is still running (no
    // 'close' emitted yet). A buffered relay (setup-window.js's pattern:
    // accumulate into a string, only act on 'close') would show nothing here;
    // a live relay writes each chunk to our stdout the moment it arrives.
    child.stdout.emit('data', 'first chunk\n');
    expect(writes).toEqual(['first chunk\n']);
    child.stdout.emit('data', 'second chunk\n');
    expect(writes).toEqual(['first chunk\n', 'second chunk\n']);

    // Only now does the child exit; the relay already happened beforehand.
    child.emit('close', 0);
    await promise;
    stdoutWrite.mockRestore();
  });

  test('empty runId launches the run-list landing; debug port adds the CDP arg', async () => {
    const child = fakeChild();
    const spawn = jest.fn(() => child);
    process.env.AMICUS_DEBUG_PORT = '9225';
    const promise = launchWorkspaceWindow({ project: '/p', runId: '' }, {
      ensureElectron: async () => ({ ok: true, path: 'electron' }), spawn,
    });
    await flush();
    child.emit('close', 0);
    await promise;
    delete process.env.AMICUS_DEBUG_PORT;
    const [, args, opts] = spawn.mock.calls[0];
    expect(args[0]).toBe('--remote-debugging-port=9225');
    expect(opts.env.AMICUS_RUN_ID).toBe('');
    expect(opts.env.AMICUS_FOLD_NONCE).toMatch(/^[0-9a-f]{16}$/);
  });

  test('ensureElectron failure and spawn error resolve {code:1, error}', async () => {
    const res = await launchWorkspaceWindow({ project: '/p' }, { ensureElectron: async () => ({ ok: false, reason: 'no electron' }) });
    expect(res).toEqual({ code: 1, error: 'no electron' });

    const child = fakeChild();
    const promise = launchWorkspaceWindow({ project: '/p' }, {
      ensureElectron: async () => ({ ok: true, path: 'x' }),
      spawn: () => child,
    });
    await flush();
    child.emit('error', new Error('ENOENT'));
    const res2 = await promise;
    expect(res2.code).toBe(1);
    expect(res2.error).toMatch(/ENOENT/);
  });
});
