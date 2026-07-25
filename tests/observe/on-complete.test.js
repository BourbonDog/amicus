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

  // STDOUT-PURITY guard: --json consumers pipe amicus stdout through a JSON
  // parser. The hook's child process output must land on stderr ONLY —
  // process.stdout.write must never be invoked by the hook path.
  test('STDOUT-PURITY: child stdout and stderr both land on process.stderr, never process.stdout', async () => {
    const fakeSpawn = () => {
      const l = {};
      const child = {
        stdout: { on: (ev, cb) => { if (ev === 'data') { l.stdoutData = cb; } } },
        stderr: { on: (ev, cb) => { if (ev === 'data') { l.stderrData = cb; } } },
        on: (ev, cb) => { l[ev] = cb; },
        kill: () => {},
      };
      setImmediate(() => {
        l.stdoutData && l.stdoutData(Buffer.from('from stdout\n'));
        l.stderrData && l.stderrData(Buffer.from('from stderr\n'));
        l.close && l.close(0);
      });
      return child;
    };
    const stdoutWrites = [];
    const stderrWrites = [];
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdoutWrites.push(chunk); return true; });
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderrWrites.push(chunk); return true; });
    try {
      await runOnComplete('do-thing', { taskId: 'w1', type: 'wave', status: 'complete', exitCode: 0, project: '/p' },
        { spawn: fakeSpawn, logger: { warn: () => {}, debug: () => {} } });
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
    expect(stdoutWrites.length).toBe(0);
    expect(stderrWrites.map(String).join('')).toContain('from stdout');
    expect(stderrWrites.map(String).join('')).toContain('from stderr');
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

  // TOTALITY guard: the fire helpers do payload-assembly work (formatCost,
  // path.join) BEFORE calling runOnComplete's never-throw boundary. A bug in
  // that assembly step must not be able to fail the run either — the helper
  // itself must swallow it. A non-numeric cost.amount makes formatCost's
  // internal `.toFixed()` throw a TypeError; that's the forcing function here.
  test('TOTALITY: fireWaveOnComplete resolves (never rejects) and warns when payload assembly throws', async () => {
    const fakeSpawn = jest.fn(() => {
      throw new Error('spawn should never be reached — assembly must throw first');
    });
    const warns = [];
    const deps = { spawn: fakeSpawn, logger: { warn: (m, ctx) => warns.push({ m, ctx }), debug: () => {} } };

    await expect(fireWaveOnComplete('notify-me',
      { status: 'complete', usage: { cost: { amount: 'not-a-number', source: 'reported' } } },
      { waveId: 'w1', waveDir: '/r/w1', wavePath: '/r/w1/wave.json', exitCode: 0, project: '/p' }, deps))
      .resolves.toBeUndefined();

    expect(fakeSpawn).not.toHaveBeenCalled();
    expect(warns.length).toBe(1);
    expect(warns[0].m).toMatch(/on-complete hook assembly failed/);
    expect(warns[0].ctx.error).toMatch(/toFixed/);
  });

  test('TOTALITY: fireCouncilOnComplete resolves (never rejects) and warns when payload assembly throws', async () => {
    const fakeSpawn = jest.fn(() => {
      throw new Error('spawn should never be reached — assembly must throw first');
    });
    const warns = [];
    const deps = { spawn: fakeSpawn, logger: { warn: (m, ctx) => warns.push({ m, ctx }), debug: () => {} } };

    await expect(fireCouncilOnComplete('notify-me',
      { status: 'complete', usage: { cost: { amount: 'not-a-number', source: 'estimated' } } },
      { runId: 'r1', runDir: '/r/r1', exitCode: 0, project: '/p' }, deps))
      .resolves.toBeUndefined();

    expect(fakeSpawn).not.toHaveBeenCalled();
    expect(warns.length).toBe(1);
    expect(warns[0].m).toMatch(/on-complete hook assembly failed/);
    expect(warns[0].ctx.error).toMatch(/toFixed/);
  });

  // No-op path stays a clean early return: a falsy/non-string cmd must never
  // enter the try block (no spawn, no warn) — the guard is unconditional.
  test('TOTALITY: falsy cmd never enters the try (no warn even with a poisoned wave)', async () => {
    const warns = [];
    const deps = { spawn: () => { throw new Error('unreachable'); }, logger: { warn: (m) => warns.push(m), debug: () => {} } };
    await expect(fireWaveOnComplete(null,
      { status: 'complete', usage: { cost: { amount: 'not-a-number' } } },
      { waveId: 'w1', waveDir: '/r/w1', wavePath: '/r/w1/wave.json', exitCode: 0, project: '/p' }, deps))
      .resolves.toBeUndefined();
    expect(warns.length).toBe(0);
  });
});
