'use strict';

const path = require('path');
const {
  buildHookEnv, runOnComplete, fireWaveOnComplete, fireCouncilOnComplete,
} = require('../../src/observe/on-complete');

describe('buildHookEnv (spec 5.3 — ids/paths ONLY, never model text)', () => {
  test('exposes exactly the documented vars', () => {
    const env = buildHookEnv({
      taskId: 'w1', type: 'wave', status: 'complete', exitCode: 0,
      resultFile: '/r/wave.json', eventsFile: '/r/events.jsonl', cost: '~$0.12', project: '/p',
    });
    expect(env.AMICUS_TASK_ID).toBe('w1');
    expect(env.AMICUS_TYPE).toBe('wave');
    expect(env.AMICUS_STATUS).toBe('complete');
    expect(env.AMICUS_EXIT_CODE).toBe('0');
    expect(env.AMICUS_RESULT_FILE).toBe('/r/wave.json');
    expect(env.AMICUS_EVENTS_FILE).toBe('/r/events.jsonl');
    expect(env.AMICUS_COST).toBe('~$0.12');
    expect(env.AMICUS_PROJECT).toBe('/p');
    // no preview/summary/model-text vars
    expect(Object.keys(env).some(k => /PREVIEW|SUMMARY|LATEST/.test(k))).toBe(false);
  });

  test('empty cost -> empty string, never undefined', () => {
    expect(buildHookEnv({ taskId: 'w1', type: 'wave', status: 'error', exitCode: 1 }).AMICUS_COST).toBe('');
  });

  // Security guard (exhaustive): the payload surface is EXACTLY these 8 keys —
  // nothing else, and specifically nothing that could carry model-generated
  // text (a preview, a summary, the latest message, free-form content).
  test('SECURITY: the key set is exactly the 8 documented vars — no model-text var can leak', () => {
    const env = buildHookEnv({
      taskId: 'w1', type: 'wave', status: 'complete', exitCode: 0,
      resultFile: '/r/wave.json', eventsFile: '/r/events.jsonl', cost: '~$0.12', project: '/p',
    });
    const keys = Object.keys(env).sort();
    expect(keys).toEqual([
      'AMICUS_COST', 'AMICUS_EVENTS_FILE', 'AMICUS_EXIT_CODE', 'AMICUS_PROJECT',
      'AMICUS_RESULT_FILE', 'AMICUS_STATUS', 'AMICUS_TASK_ID', 'AMICUS_TYPE',
    ]);
    expect(keys.some(k => /PREVIEW|SUMMARY|LATEST|MESSAGE|CONTENT/i.test(k))).toBe(false);
  });
});

describe('runOnComplete', () => {
  test('spawns via shell, pipes to stderr, resolves even on non-zero exit', async () => {
    const calls = [];
    const fakeSpawn = (cmd, opts) => {
      calls.push({ cmd, opts });
      const listeners = {};
      const child = {
        stdout: { on: () => {} }, stderr: { on: () => {} },
        on: (ev, cb) => { listeners[ev] = cb; },
        kill: () => {},
      };
      setImmediate(() => listeners.close && listeners.close(3)); // non-zero exit
      return child;
    };
    const warns = [];
    await runOnComplete('do-thing', { taskId: 'w1', type: 'wave', status: 'complete', exitCode: 0, project: '/p' },
      { spawn: fakeSpawn, logger: { warn: (m) => warns.push(m), debug: () => {} } });
    expect(calls[0].cmd).toBe('do-thing');
    expect(calls[0].opts.shell).toBe(true);
    expect(calls[0].opts.cwd).toBe('/p');
    expect(warns.length).toBe(1); // non-zero exit warned, never thrown
  });

  test('a timeout kills the child and warns, never rejects', async () => {
    const fakeSpawn = () => { const l = {}; return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (e, c) => { l[e] = c; }, kill: () => { l.close && l.close(null); } }; };
    const warns = [];
    await runOnComplete('sleep 999', { taskId: 'w1', type: 'wave', status: 'complete', exitCode: 0, project: '/p' },
      { spawn: fakeSpawn, timeoutMs: 5, logger: { warn: (m) => warns.push(m), debug: () => {} } });
    expect(warns.join(' ')).toMatch(/tim(ed)? ?out/i);
  });

  // Exit-isolation guard: a hook command that can't even spawn (bad shell,
  // ENOENT, permissions) must never fail the run — runOnComplete must RESOLVE,
  // not reject, even when the injected spawn throws synchronously.
  test('EXIT-ISOLATION: resolves (never rejects) when spawn throws synchronously', async () => {
    const fakeSpawn = () => { throw new Error('spawn EACCES'); };
    const warns = [];
    await expect(runOnComplete('bad-cmd', { taskId: 'w1', type: 'wave', status: 'complete', exitCode: 0, project: '/p' },
      { spawn: fakeSpawn, logger: { warn: (m) => warns.push(m), debug: () => {} } })).resolves.toBeUndefined();
    expect(warns.length).toBe(1);
  });

  // Exit-isolation guard: an async child 'error' event (e.g. ENOENT surfaced
  // after spawn returns) must also resolve, never reject/throw.
  test('EXIT-ISOLATION: resolves when the child emits an error event', async () => {
    const fakeSpawn = () => {
      const l = {};
      const child = { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (e, c) => { l[e] = c; }, kill: () => {} };
      setImmediate(() => l.error && l.error(new Error('ENOENT')));
      return child;
    };
    const warns = [];
    await expect(runOnComplete('missing-cmd', { taskId: 'w1', type: 'wave', status: 'complete', exitCode: 0, project: '/p' },
      { spawn: fakeSpawn, logger: { warn: (m) => warns.push(m), debug: () => {} } })).resolves.toBeUndefined();
    expect(warns.length).toBe(1);
  });
});

describe('fireWaveOnComplete / fireCouncilOnComplete (ordering/fire guard, via fake spawn)', () => {
  test('fireWaveOnComplete passes type wave, correct resultFile/eventsFile, and no-ops on falsy cmd', async () => {
    const calls = [];
    const fakeSpawn = (cmd, opts) => {
      calls.push({ cmd, opts });
      const l = {};
      const child = { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (e, c) => { l[e] = c; }, kill: () => {} };
      setImmediate(() => l.close && l.close(0));
      return child;
    };
    const warns = [];
    const deps = { spawn: fakeSpawn, logger: { warn: (m) => warns.push(m), debug: () => {} } };

    // falsy cmd: no-op, spawn never called
    await fireWaveOnComplete(null, { status: 'complete' },
      { waveId: 'w1', waveDir: '/r/w1', wavePath: '/r/w1/wave.json', exitCode: 0, project: '/p' }, deps);
    expect(calls.length).toBe(0);

    await fireWaveOnComplete('notify-me', { status: 'complete', usage: { cost: { amount: 0.12, source: 'reported' } } },
      { waveId: 'w1', waveDir: '/r/w1', wavePath: '/r/w1/wave.json', exitCode: 0, project: '/p' }, deps);
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe('notify-me');
    expect(calls[0].opts.env.AMICUS_TYPE).toBe('wave');
    expect(calls[0].opts.env.AMICUS_TASK_ID).toBe('w1');
    expect(calls[0].opts.env.AMICUS_RESULT_FILE).toBe('/r/w1/wave.json');
    expect(calls[0].opts.env.AMICUS_EVENTS_FILE).toBe(path.join('/r/w1', 'events.jsonl'));
    expect(calls[0].opts.env.AMICUS_COST).toBe('$0.1200');
  });

  test('fireCouncilOnComplete passes type council-run, correct resultFile/eventsFile, and no-ops on falsy cmd', async () => {
    const calls = [];
    const fakeSpawn = (cmd, opts) => {
      calls.push({ cmd, opts });
      const l = {};
      const child = { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (e, c) => { l[e] = c; }, kill: () => {} };
      setImmediate(() => l.close && l.close(0));
      return child;
    };
    const warns = [];
    const deps = { spawn: fakeSpawn, logger: { warn: (m) => warns.push(m), debug: () => {} } };

    await fireCouncilOnComplete(undefined, { status: 'complete' },
      { runId: 'r1', runDir: '/r/r1', exitCode: 0, project: '/p' }, deps);
    expect(calls.length).toBe(0);

    await fireCouncilOnComplete('notify-me', { status: 'complete', usage: { cost: { amount: 1.5, source: 'estimated' } } },
      { runId: 'r1', runDir: '/r/r1', exitCode: 2, project: '/p' }, deps);
    expect(calls.length).toBe(1);
    expect(calls[0].opts.env.AMICUS_TYPE).toBe('council-run');
    expect(calls[0].opts.env.AMICUS_TASK_ID).toBe('r1');
    expect(calls[0].opts.env.AMICUS_EXIT_CODE).toBe('2');
    expect(calls[0].opts.env.AMICUS_RESULT_FILE).toBe(path.join('/r/r1', 'run.json'));
    expect(calls[0].opts.env.AMICUS_EVENTS_FILE).toBe(path.join('/r/r1', 'events.jsonl'));
    expect(calls[0].opts.env.AMICUS_COST).toBe('~$1.50');
  });
});
