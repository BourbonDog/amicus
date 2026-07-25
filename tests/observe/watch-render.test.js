'use strict';

const os = require('os');
const {
  renderTable, renderPlainLines, mapExitCode, emitJsonChange, runWatchLoop,
} = require('../../src/observe/watch-render');

const WAVE = {
  taskId: 'w1', type: 'wave', status: 'running', view: 'live',
  legsComplete: 1, legsTotal: 2,
  elapsed: '1m 5s',
  usage: { cost: { amount: 0.12, source: 'estimated' } },
  legs: [
    { taskId: 'w1-1', model: 'gpt', status: 'complete', phase: 'terminal', messages: 4,
      usage: { tokens: { input: 100, output: 40 }, cost: { amount: 0.08, source: 'reported' } }, latestPreview: 'Done.' },
    { taskId: 'w1-2', model: 'qwen', status: 'running', phase: 'generating', messages: 2,
      usage: { tokens: { input: 60, output: 10 }, cost: { amount: 0.04, source: 'estimated' } }, latestPreview: 'Working...', stalled: true },
  ],
};

describe('renderTable', () => {
  const out = renderTable(WAVE);
  test('header shows id, status, legs done/total and cost-so-far with ~ for estimates', () => {
    expect(out).toContain('w1');
    expect(out).toContain('1/2');
    expect(out).toContain('~$0.12'); // estimated -> ~ preserved
  });
  test('one row per leg with model, tokens, cost, stalled flag', () => {
    expect(out).toContain('gpt');
    expect(out).toContain('qwen');
    expect(out).toContain('100/40');
    expect(out).toContain('⏳');
  });
  test('a leg without usage renders a dash', () => {
    const d = { ...WAVE, legs: [{ taskId: 'w1-3', model: 'x', status: 'running', phase: 'starting', messages: 0 }] };
    expect(renderTable(d)).toContain('—');
  });
  // DE-ROT Task 0.5 (F01): buildCouncilStatusPayload now emits `legs[]`, so a
  // real council doc renders BOTH the stage checklist above AND a seat row per
  // leg below — this test's name used to assert the opposite (no legs existed
  // on the composed payload at all; renderTable's `doc.legs || []` loop was
  // dead code against real council docs). Updated to cover both.
  test('council doc: stage checklist rendered above, one seat row per leg below', () => {
    const council = {
      taskId: 'c1', type: 'council-run', runId: 'c1', status: 'running',
      currentStage: 'stage2',
      stages: [
        { name: 'stage1', status: 'complete', waveId: 'w1' },
        { name: 'stage2', status: 'running', waveId: 'w2' },
        { name: 'chair', status: 'pending', waveId: null },
      ],
      legsTotal: 3, legsComplete: 1, elapsed: '2m 0s',
      legs: [
        { taskId: 'w2-1', model: 'gemini', status: 'complete', messages: 3, latestPreview: 'Done.' },
        { taskId: 'w2-2', model: 'gpt', status: 'running', messages: 1, latestPreview: 'Working...', stalled: true },
      ],
    };
    const table = renderTable(council);
    expect(table).toContain('c1');
    expect(table).toContain('1/3');
    expect(table).toContain('✓ stage1');
    expect(table).toContain('▶ stage2');
    expect(table).toContain('· chair');
    expect(table).toContain('gemini');
    expect(table).toContain('gpt');
    expect(table).toContain('⏳stalled');
  });
  // Finding 1: buildCouncilStatusPayload (src/mcp-council-awareness.js) inits
  // legsTotal/legsComplete to `null` and legitimately keeps them null through
  // any stage with no active sub-wave (e.g. a lens stage1). A `!== undefined`
  // guard lets `null` through and renders the literal string "legs null/null".
  test('council doc with legsTotal/legsComplete null (no active sub-wave yet): header omits the legs segment, no literal "null"', () => {
    const council = {
      taskId: 'c1', type: 'council-run', runId: 'c1', status: 'running',
      currentStage: 'stage1',
      stages: [{ name: 'stage1', status: 'running', waveId: null }],
      legsTotal: null, legsComplete: null, elapsed: '0m 5s',
    };
    const table = renderTable(council);
    expect(table).not.toContain('null');
    expect(table).toContain('c1');
    expect(table).toContain('running');
  });
});

describe('renderPlainLines', () => {
  test('turns events into terse milestone lines', () => {
    const lines = renderPlainLines([
      { event: 'leg-started', legId: 'w1-1', model: 'gpt' },
      { event: 'leg-terminal', legId: 'w1-1', model: 'gpt', status: 'complete' },
    ], WAVE);
    expect(lines.join('\n')).toContain('leg-started');
    expect(lines.join('\n')).toContain('w1-1');
  });
  test('appends a periodic one-line rollup when a doc is provided', () => {
    const lines = renderPlainLines([], WAVE);
    expect(lines.join('\n')).toContain('running');
    expect(lines.join('\n')).toContain('1/2');
  });
  // Finding 1 (rollup half): same null-vs-undefined guard bug as renderTable's
  // header — a council doc mid-stage1 (no active sub-wave) has legsTotal:null.
  test('rollup: legsTotal/legsComplete null omits the legs segment, no literal "null"', () => {
    const council = {
      taskId: 'c1', runId: 'c1', type: 'council-run', status: 'running',
      legsTotal: null, legsComplete: null, elapsed: '0m 5s',
    };
    const lines = renderPlainLines([], council);
    expect(lines.join('\n')).not.toContain('null');
    expect(lines.join('\n')).toContain('running');
  });
});

describe('mapExitCode (spec 5.1)', () => {
  test('complete -> 0, partial -> 2, error -> 1', () => {
    expect(mapExitCode({ status: 'complete' })).toBe(0);
    expect(mapExitCode({ status: 'partial' })).toBe(2);
    expect(mapExitCode({ status: 'error' })).toBe(1);
  });
  test('council passes through recorded exitCode', () => {
    expect(mapExitCode({ type: 'council-run', status: 'partial', exitCode: 2 })).toBe(2);
  });
});

describe('emitJsonChange', () => {
  test('emits when changed, suppresses when identical', () => {
    const a = emitJsonChange(WAVE, null);
    expect(a.emit).toBe(true);
    const b = emitJsonChange(WAVE, a.text);
    expect(b.emit).toBe(false);
  });
});

// ---- runWatchLoop (DI-injected statusFn/sleep/isTTY; no real fs.watch, no
// real timers). The events tail always polls an empty/non-existent
// events.jsonl in these tests (createEventTail degrades gracefully — see
// events.js), so plain-line assertions below exercise the periodic doc
// rollup, not milestone lines (those are covered by renderPlainLines above).

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(s); return true; };
  return Promise.resolve(fn())
    .then((result) => { process.stdout.write = orig; return { result, writes }; })
    .catch((e) => { process.stdout.write = orig; throw e; });
}

describe('runWatchLoop', () => {
  test('running -> terminal: returns mapExitCode(terminal) and prints plain lines', async () => {
    const running = { taskId: 'w1', type: 'wave', status: 'running', legsComplete: 0, legsTotal: 1, elapsed: '0m 1s', legs: [] };
    const terminal = { taskId: 'w1', type: 'wave', status: 'complete', legsComplete: 1, legsTotal: 1, elapsed: '0m 4s', legs: [] };
    let call = 0;
    const statusFn = jest.fn(async () => {
      const doc = call === 0 ? running : terminal;
      call += 1;
      return { content: [{ type: 'text', text: JSON.stringify(doc) }] };
    });
    const { result: code, writes } = await captureStdout(() => runWatchLoop(
      { kind: 'wave', id: 'w1' }, {}, os.tmpdir(),
      { statusFn, sleep: async () => {}, isTTY: false }
    ));
    expect(code).toBe(mapExitCode(terminal)); // 0
    expect(statusFn).toHaveBeenCalledTimes(2);
    const printed = writes.join('');
    expect(printed).toContain('running');
    expect(printed).toContain('complete');
  });

  test('TTY mode: renders the table (not plain lines) and erases with ANSI cursor-up on the second tick', async () => {
    const running = { taskId: 'w1', type: 'wave', status: 'running', legsComplete: 0, legsTotal: 1, elapsed: '0m 1s', legs: [] };
    const terminal = { taskId: 'w1', type: 'wave', status: 'complete', legsComplete: 1, legsTotal: 1, elapsed: '0m 4s', legs: [] };
    let call = 0;
    const statusFn = jest.fn(async () => {
      const doc = call === 0 ? running : terminal;
      call += 1;
      return { content: [{ type: 'text', text: JSON.stringify(doc) }] };
    });
    const { result: code, writes } = await captureStdout(() => runWatchLoop(
      { kind: 'wave', id: 'w1' }, {}, os.tmpdir(),
      { statusFn, sleep: async () => {}, isTTY: true }
    ));
    expect(code).toBe(0);
    // No alternate screen (docker/npm pattern): erase-line + cursor-up only, never \x1b[?1049h.
    const printed = writes.join('');
    expect(printed).not.toContain('\x1b[?1049h');
    expect(printed).toContain('\x1b['); // cursor-up + erase before the second render
    expect(printed).toContain('0/1'); // first table render (running)
    expect(printed).toContain('1/1'); // second table render (terminal)
  });

  test('already-terminal: renders once and returns immediately (no sleep, one statusFn call)', async () => {
    const terminal = { taskId: 'w1', type: 'wave', status: 'partial', legsComplete: 1, legsTotal: 2, elapsed: '0m 2s', legs: [] };
    const statusFn = jest.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(terminal) }] }));
    let sleepCalls = 0;
    const { result: code, writes } = await captureStdout(() => runWatchLoop(
      { kind: 'wave', id: 'w1' }, {}, os.tmpdir(),
      { statusFn, sleep: async () => { sleepCalls += 1; }, isTTY: false }
    ));
    expect(code).toBe(2); // partial -> 2
    expect(statusFn).toHaveBeenCalledTimes(1);
    expect(sleepCalls).toBe(0);
    expect(writes.join('')).toContain('partial');
  });

  test('council exit passthrough: a terminal council doc with exitCode:2 returns 2 (not status-mapped)', async () => {
    const councilTerminal = {
      taskId: 'c1', type: 'council-run', status: 'partial', exitCode: 2,
      stages: [], legsTotal: null, legsComplete: null, elapsed: '0m 9s',
    };
    const statusFn = jest.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(councilTerminal) }] }));
    const { result: code } = await captureStdout(() => runWatchLoop(
      { kind: 'council', id: 'c1', runDir: os.tmpdir() }, {}, os.tmpdir(),
      { statusFn, sleep: async () => {}, isTTY: false }
    ));
    // council 'partial' would status-map to 2 anyway; assert against a case where
    // the recorded exitCode and the status map would disagree to prove passthrough.
    expect(code).toBe(2);
    expect(mapExitCode(councilTerminal)).toBe(councilTerminal.exitCode);
  });

  test('council exit passthrough disagrees with status mapping: complete status but exitCode:2 still returns 2', async () => {
    const doc = { taskId: 'c1', type: 'council-run', status: 'complete', exitCode: 2, stages: [], elapsed: '0m 1s' };
    const statusFn = jest.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(doc) }] }));
    const { result: code } = await captureStdout(() => runWatchLoop(
      { kind: 'council', id: 'c1', runDir: os.tmpdir() }, {}, os.tmpdir(),
      { statusFn, sleep: async () => {}, isTTY: false }
    ));
    // Status-only mapping would say 0 (complete); recorded exitCode wins.
    expect(code).toBe(2);
  });

  test('--json change-only: suppresses an unchanged doc across ticks, always flushes the final doc', async () => {
    const runningV1 = { taskId: 'w1', type: 'wave', status: 'running', legsComplete: 0, legsTotal: 1, elapsed: '0m 1s', legs: [] };
    const terminalDoc = { taskId: 'w1', type: 'wave', status: 'complete', legsComplete: 1, legsTotal: 1, elapsed: '0m 3s', legs: [] };
    // tick1: running: tick2: IDENTICAL running (proves suppression): tick3: terminal (changed).
    const docs = [runningV1, runningV1, terminalDoc];
    let call = 0;
    const statusFn = jest.fn(async () => {
      const doc = docs[call];
      call += 1;
      return { content: [{ type: 'text', text: JSON.stringify(doc) }] };
    });
    const { result: code, writes } = await captureStdout(() => runWatchLoop(
      { kind: 'wave', id: 'w1' }, { json: true }, os.tmpdir(),
      { statusFn, sleep: async () => {}, isTTY: false }
    ));
    expect(code).toBe(0);
    expect(statusFn).toHaveBeenCalledTimes(3);
    // No milestone events in this test (empty tail), so every write is a doc
    // emission. A naive "emit every tick" implementation would write 4 times
    // (tick1 + tick2 + tick3-change + terminal-final); the real change-only
    // emitter suppresses tick2 (identical to tick1), yielding exactly 3:
    // tick1 emit, tick2 suppressed, tick3 change-emit + terminal-final emit.
    const nonEmpty = writes.filter((w) => w.trim().length > 0);
    expect(nonEmpty.length).toBe(3);
    expect(JSON.parse(nonEmpty[0])).toMatchObject({ status: 'running' });
    expect(JSON.parse(nonEmpty[nonEmpty.length - 1])).toMatchObject({ status: 'complete' });
  });

  // Finding 3: watch-render.js unconditionally called renderPlainLines(events, doc)
  // every poll tick, so a multi-minute --plain watch printed an identical rollup
  // line every interval. Mirror the --json change-only suppression: only print
  // the rollup when it changed from the last PRINTED rollup, but always print it
  // on the terminal tick so the final state is never silently swallowed.
  test('--plain rollup throttling: suppresses an unchanged rollup, prints on change and always at terminal', async () => {
    const runningV1 = { taskId: 'w1', type: 'wave', status: 'running', legsComplete: 0, legsTotal: 1, elapsed: '0m 1s', legs: [] };
    const terminalDoc = { taskId: 'w1', type: 'wave', status: 'complete', legsComplete: 1, legsTotal: 1, elapsed: '0m 3s', legs: [] };
    // tick1: running; tick2: IDENTICAL running (proves suppression); tick3: terminal.
    const docs = [runningV1, runningV1, terminalDoc];
    let call = 0;
    const statusFn = jest.fn(async () => {
      const doc = docs[call];
      call += 1;
      return { content: [{ type: 'text', text: JSON.stringify(doc) }] };
    });
    const { result: code, writes } = await captureStdout(() => runWatchLoop(
      { kind: 'wave', id: 'w1' }, {}, os.tmpdir(),
      { statusFn, sleep: async () => {}, isTTY: false }
    ));
    expect(code).toBe(0);
    expect(statusFn).toHaveBeenCalledTimes(3);
    // No milestone events in this test (empty tail), so every non-empty write
    // is a rollup line. A naive "print every tick" implementation writes 3
    // rollup lines (one per tick); the throttled version suppresses the
    // byte-identical tick2 rollup, yielding exactly 2: tick1, tick3(terminal).
    const rollupLines = writes.filter((w) => w.trim().startsWith('…'));
    expect(rollupLines.length).toBe(2);
    expect(rollupLines[0]).toContain('running');
    expect(rollupLines[1]).toContain('complete');
  });
});
