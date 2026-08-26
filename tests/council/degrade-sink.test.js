'use strict';

const os = require('os'); const fs = require('fs'); const path = require('path');
const { createDegradeSink } = require('../../src/council/run-degrade');

const mkRunDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'degrade-'));
const base = { channel: 'dead-leg', what: 'a', why: 'b', effect: 'c' };

test('note() writes stderr, appends run.json, and flips degraded', () => {
  const runDir = mkRunDir(); const out = []; const degraded = { value: false };
  const sink = createDegradeSink({ runDir, degraded, write: (s) => out.push(s) });
  sink.note(base);
  expect(out).toHaveLength(1);
  expect(out[0]).toContain('Notice: a — b. c.');
  expect(degraded.value).toBe(true);
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  expect(run.degrades).toHaveLength(1);
  expect(run.degrades[0].channel).toBe('dead-leg');
  expect(sink.all()).toHaveLength(1);
});

test('a heal announces but does NOT flip degraded', () => {
  const runDir = mkRunDir(); const out = []; const degraded = { value: false };
  const sink = createDegradeSink({ runDir, degraded, write: (s) => out.push(s) });
  sink.note({ ...base, kind: 'heal' });
  expect(out[0].startsWith('Recovered: ')).toBe(true);
  expect(degraded.value).toBe(false);
  expect(sink.all()).toHaveLength(1);
});

// v4.9 W5.1: kind 'info' is an announcement, never a loss — the sink records
// and announces it, but the degraded flag (and therefore the exit code) is
// untouched. The control test below proves the CHANNEL is not what spares the
// flag: a kind:'degrade' on the same channel still degrades.
test('an info note announces and records but does NOT flip degraded', () => {
  const runDir = mkRunDir(); const out = []; const degraded = { value: false };
  const sink = createDegradeSink({ runDir, degraded, write: (s) => out.push(s) });
  sink.note({ kind: 'info', channel: 'ledger-skipped', what: 'a', why: 'b', effect: 'c' });
  expect(out[0].startsWith('Note: ')).toBe(true);
  expect(degraded.value).toBe(false);
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  expect(run.degrades).toHaveLength(1);
  expect(run.degrades[0].kind).toBe('info');
  expect(sink.all()).toHaveLength(1);
});

test("control: a kind:'degrade' note on ledger-skipped still degrades", () => {
  const runDir = mkRunDir(); const out = []; const degraded = { value: false };
  const sink = createDegradeSink({ runDir, degraded, write: (s) => out.push(s) });
  sink.note({ channel: 'ledger-skipped', what: 'a', why: 'b', effect: 'c' });
  expect(out[0].startsWith('Notice: ')).toBe(true);
  expect(degraded.value).toBe(true);
});

test('a malformed record becomes an internal degrade instead of throwing', () => {
  const runDir = mkRunDir(); const out = []; const degraded = { value: false };
  const sink = createDegradeSink({ runDir, degraded, write: (s) => out.push(s) });
  expect(() => sink.note({ channel: 'dead-leg', what: '', why: 'b', effect: 'c' })).not.toThrow();
  expect(sink.all()[0].channel).toBe('internal');
  expect(out[0]).toContain('dead-leg');
  expect(degraded.value).toBe(true);
});

test('a run.json write failure still announces and still degrades', () => {
  const out = []; const degraded = { value: false };
  const sink = createDegradeSink({
    runDir: path.join(os.tmpdir(), 'does', 'not', 'exist'),
    degraded, write: (s) => out.push(s),
  });
  expect(() => sink.note(base)).not.toThrow();
  expect(out).toHaveLength(1);
  expect(degraded.value).toBe(true);
});

test('an EPIPE from the writer never escapes', () => {
  const runDir = mkRunDir(); const degraded = { value: false };
  const sink = createDegradeSink({ runDir, degraded, write: () => {
    const e = new Error('write EPIPE'); e.code = 'EPIPE'; throw e;
  } });
  expect(() => sink.note(base)).not.toThrow();
  expect(degraded.value).toBe(true);
});
