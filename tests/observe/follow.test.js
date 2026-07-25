'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFollowPrinter } = require('../../src/observe/follow');
const { emitStageStarted, createEventTail, EVENTS_FILE } = require('../../src/observe/events');

function capture() { const out = []; return { write: (s) => { out.push(s); return true; }, out }; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'follow-')); }

describe('createFollowPrinter (spec 5.2)', () => {
  test('json mode writes NDJSON event lines to the given stream', () => {
    const s = capture();
    const p = createFollowPrinter({ json: true, stream: s });
    p.onEvent({ event: 'leg-terminal', id: 'w1', legId: 'w1-1', model: 'gpt', status: 'complete' });
    const doc = JSON.parse(s.out[0]);
    expect(doc.event).toBe('leg-terminal');
    expect(s.out[0].endsWith('\n')).toBe(true);
  });

  test('human mode writes a terse line', () => {
    const s = capture();
    const p = createFollowPrinter({ json: false, stream: s });
    p.onEvent({ event: 'wave-terminal', id: 'w1', status: 'partial', exitCode: 2 });
    expect(s.out[0]).toContain('wave-terminal');
    expect(s.out[0]).toContain('w1');
  });

  // Guard (spec §5.2): stdout must stay byte-identical when --follow is on —
  // the printer's default stream must be stderr, never stdout, so a caller
  // that forgets to pass `stream` explicitly can't silently corrupt the
  // --json final doc / human summary on stdout.
  test('defaults to process.stderr, never process.stdout', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const p = createFollowPrinter({ json: true });
      p.onEvent({ event: 'run-terminal', id: 'r1', status: 'complete', exitCode: 0 });
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });
});

// Guard: proves the Task 13 threading contract at the emit-helper level —
// appendEvent (disk) stays unconditional, and follow.onEvent (when present)
// receives the SAME raw event object passed to appendEvent, before the
// envelope (schemaVersion/type/ts) is added.
describe('emit helper dual-sink (events.js, Task 13 threading contract)', () => {
  test('emitStageStarted with a follow arg both appends to disk AND calls follow.onEvent with the raw event', () => {
    const dir = tmp();
    const follow = { onEvent: jest.fn() };
    emitStageStarted(dir, 'r1', 'stage1', 'r1-s1', follow);

    const [ev] = createEventTail(path.join(dir, EVENTS_FILE)).poll();
    expect(ev).toMatchObject({ event: 'stage-started', id: 'r1', stage: 'stage1', waveId: 'r1-s1' });

    expect(follow.onEvent).toHaveBeenCalledTimes(1);
    expect(follow.onEvent).toHaveBeenCalledWith({ event: 'stage-started', id: 'r1', stage: 'stage1', waveId: 'r1-s1' });
  });

  test('emitStageStarted without a follow arg still writes the events.jsonl line and never throws', () => {
    const dir = tmp();
    expect(() => emitStageStarted(dir, 'r1', 'stage1', 'r1-s1')).not.toThrow();
    const [ev] = createEventTail(path.join(dir, EVENTS_FILE)).poll();
    expect(ev).toMatchObject({ event: 'stage-started', id: 'r1', stage: 'stage1', waveId: 'r1-s1' });
  });
});
