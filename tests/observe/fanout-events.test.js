'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  emitWaveStarted, emitWaveTerminal, emitLegStarted, emitLegTerminal,
  createEventTail, EVENTS_FILE,
} = require('../../src/observe/events');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-ev-')); }

describe('fanout wave events (spec 4.2)', () => {
  test('emitWaveStarted writes a wave-started line with models + legIds', () => {
    const dir = tmp();
    emitWaveStarted(dir, 'w1', ['gpt', 'qwen'], ['w1-1', 'w1-2']);
    const [ev] = createEventTail(path.join(dir, EVENTS_FILE)).poll();
    expect(ev).toMatchObject({ event: 'wave-started', id: 'w1', models: ['gpt', 'qwen'], legIds: ['w1-1', 'w1-2'] });
  });

  test('emitWaveTerminal writes counts/usage/exitCode', () => {
    const dir = tmp();
    emitWaveTerminal(dir, 'w1', { status: 'partial', counts: { complete: 1, error: 1 }, usage: { cost: { amount: 0.2 } }, exitCode: 2 });
    const [ev] = createEventTail(path.join(dir, EVENTS_FILE)).poll();
    expect(ev).toMatchObject({ event: 'wave-terminal', id: 'w1', status: 'partial', exitCode: 2 });
    expect(ev.counts.error).toBe(1);
  });
});

describe('fanout leg events (spec 4.2) — moved alongside wave events (Task 7)', () => {
  test('emitLegStarted writes a leg-started line with legId/model/modelInput', () => {
    const dir = tmp();
    emitLegStarted(dir, 'w1', 'w1-1', 'gpt-4', 'gpt');
    const [ev] = createEventTail(path.join(dir, EVENTS_FILE)).poll();
    expect(ev).toMatchObject({ event: 'leg-started', id: 'w1', legId: 'w1-1', model: 'gpt-4', modelInput: 'gpt' });
  });

  test('emitLegTerminal writes status/durationMs/usage', () => {
    const dir = tmp();
    emitLegTerminal(dir, 'w1', 'w1-1', { model: 'gpt-4', status: 'complete', durationMs: 1234, usage: { cost: { amount: 0.01 } } });
    const [ev] = createEventTail(path.join(dir, EVENTS_FILE)).poll();
    expect(ev).toMatchObject({ event: 'leg-terminal', id: 'w1', legId: 'w1-1', model: 'gpt-4', status: 'complete', durationMs: 1234 });
    expect(ev.usage.cost.amount).toBe(0.01);
  });

  test('wave-started/leg-started/leg-terminal/wave-terminal preserve emission order on one stream', () => {
    const dir = tmp();
    emitWaveStarted(dir, 'w1', ['gpt'], ['w1-1']);
    emitLegStarted(dir, 'w1', 'w1-1', 'gpt-4', 'gpt');
    emitLegTerminal(dir, 'w1', 'w1-1', { model: 'gpt-4', status: 'complete', durationMs: 10, usage: null });
    emitWaveTerminal(dir, 'w1', { status: 'complete', counts: { complete: 1 }, usage: null, exitCode: 0 });
    const events = createEventTail(path.join(dir, EVENTS_FILE)).poll();
    expect(events.map(e => e.event)).toEqual(['wave-started', 'leg-started', 'leg-terminal', 'wave-terminal']);
  });
});
