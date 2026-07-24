'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendEvent, createEventTail, EVENTS_FILE, EVENTS_SCHEMA_VERSION } = require('../../src/observe/events');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'events-')); }

describe('appendEvent envelope', () => {
  test('stamps schemaVersion/type/ts and preserves payload', () => {
    const dir = tmp();
    appendEvent(dir, { event: 'leg-started', id: 'w1', legId: 'w1-1', model: 'gpt', modelInput: 'gpt' });
    const lines = fs.readFileSync(path.join(dir, EVENTS_FILE), 'utf-8').trim().split('\n');
    const doc = JSON.parse(lines[0]);
    expect(doc).toMatchObject({ schemaVersion: EVENTS_SCHEMA_VERSION, type: 'event', event: 'leg-started', id: 'w1', legId: 'w1-1', model: 'gpt' });
    expect(typeof doc.ts).toBe('string');
  });

  test('never throws on an unwritable dir', () => {
    expect(() => appendEvent(path.join(os.tmpdir(), 'no', 'such', 'dir-nope'), { event: 'x', id: 'y' })).not.toThrow();
  });
});

describe('createEventTail poll protocol', () => {
  test('reads only newline-terminated lines; holds a torn tail until completed', () => {
    const dir = tmp();
    const file = path.join(dir, EVENTS_FILE);
    const tail = createEventTail(file);
    expect(tail.poll()).toEqual([]);                 // file absent -> missed tick

    appendEvent(dir, { event: 'wave-started', id: 'w1', models: ['gpt'], legIds: ['w1-1'] });
    const first = tail.poll();
    expect(first).toHaveLength(1);
    expect(first[0].event).toBe('wave-started');

    // simulate a torn write: bytes with no trailing newline
    fs.appendFileSync(file, '{"schemaVersion":1,"type":"event","event":"leg-star');
    expect(tail.poll()).toEqual([]);                 // held (no newline yet)

    fs.appendFileSync(file, 'ted","id":"w1","legId":"w1-1"}\n');
    const done = tail.poll();
    expect(done).toHaveLength(1);
    expect(done[0].event).toBe('leg-started');
  });

  test('skips a corrupt line and continues', () => {
    const dir = tmp();
    const file = path.join(dir, EVENTS_FILE);
    fs.writeFileSync(file, 'not json\n' + JSON.stringify({ schemaVersion: 1, type: 'event', event: 'run-terminal', id: 'c1', status: 'complete' }) + '\n');
    const tail = createEventTail(file);
    const out = tail.poll();
    expect(out).toHaveLength(1);
    expect(out[0].event).toBe('run-terminal');
  });

  test('no growth since last poll returns []', () => {
    const dir = tmp();
    appendEvent(dir, { event: 'wave-terminal', id: 'w1', status: 'complete', exitCode: 0 });
    const tail = createEventTail(path.join(dir, EVENTS_FILE));
    expect(tail.poll()).toHaveLength(1);
    expect(tail.poll()).toEqual([]);
  });
});
