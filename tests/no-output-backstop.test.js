'use strict';

const {
  resolveNoOutputBackstopMs, createNoOutputBackstop, extendWindowMs, decideBackstopExtension,
  isBackstopRecord, formatBackstopExtensionClause, BACKSTOP_WHY,
} = require('../src/utils/no-output-backstop');
const { probeUnknown } = require('../src/utils/session-status');

describe('resolveNoOutputBackstopMs', () => {
  test('default 300000 when unset', () => {
    expect(resolveNoOutputBackstopMs({})).toBe(300000);
  });
  test('explicit value wins', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '30000' })).toBe(30000);
  });
  test('explicit 0 is honored (the documented disable)', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '0' })).toBe(0);
  });
  test('blank and non-finite fall back to the default', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '' })).toBe(300000);
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: 'Infinity' })).toBe(300000);
  });
});

describe('createNoOutputBackstop', () => {
  const T0 = 1_000_000;

  test('fires at the deadline when nothing ever progressed', () => {
    const b = createNoOutputBackstop({ ms: 120000, startedAt: T0 });
    expect(b.tick(false, T0 + 119999)).toBe('armed');
    expect(b.tick(false, T0 + 120000)).toBe('fired');
  });

  test('first progress disarms permanently — later silence never fires', () => {
    const b = createNoOutputBackstop({ ms: 120000, startedAt: T0 });
    expect(b.tick(true, T0 + 5000)).toBe('disarmed');
    expect(b.tick(false, T0 + 500000)).toBe('disarmed');
    expect(b.state()).toBe('disarmed');
  });

  test('fired is terminal — later ticks stay fired and progress cannot resurrect it', () => {
    const b = createNoOutputBackstop({ ms: 1000, startedAt: T0 });
    expect(b.tick(false, T0 + 1000)).toBe('fired');
    expect(b.tick(true, T0 + 2000)).toBe('fired');
  });

  test('ms <= 0 never arms', () => {
    const off = createNoOutputBackstop({ ms: 0, startedAt: T0 });
    expect(off.tick(false, T0 + 10_000_000)).toBe('disarmed');
    const neg = createNoOutputBackstop({ ms: -5, startedAt: T0 });
    expect(neg.tick(false, T0 + 10_000_000)).toBe('disarmed');
  });
});

describe('#251 item 1 — extend(): a fired backstop re-arms exactly once, at a later deadline', () => {
  test('E1 fired → extend to a later deadline re-arms; it fires again only at the new deadline', () => {
    const b = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    expect(b.tick(false, 1100)).toBe('fired');
    expect(b.extend(1200)).toBe(true);
    expect(b.state()).toBe('armed');
    expect(b.deadline()).toBe(1200);
    expect(b.extended()).toBe(true);
    expect(b.tick(false, 1150)).toBe('armed');
    expect(b.tick(false, 1200)).toBe('fired');
  });
  test('E2 once means once — a second extend after the second firing is refused', () => {
    const b = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    b.tick(false, 1100); b.extend(1200); b.tick(false, 1200);
    expect(b.extend(1400)).toBe(false);
    expect(b.state()).toBe('fired');
    expect(b.deadline()).toBe(1200);
  });
  test('E3 extend is refused while armed, while disarmed, and for a deadline that is not later', () => {
    const armed = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    expect(armed.extend(1500)).toBe(false);
    expect(armed.state()).toBe('armed');
    const disarmed = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    disarmed.tick(true, 1050);
    expect(disarmed.extend(1500)).toBe(false);
    expect(disarmed.state()).toBe('disarmed');
    const fired = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    fired.tick(false, 1100);
    expect(fired.extend(1100)).toBe(false); // equal, not later
    expect(fired.extend(1099)).toBe(false);
    expect(fired.state()).toBe('fired');
    expect(fired.extended()).toBe(false);
    expect(fired.extend(NaN)).toBe(false);
    expect(fired.extend(undefined)).toBe(false);
    expect(fired.deadline()).toBe(1100);
    expect(fired.state()).toBe('fired');
  });
  test('E4 progress after an extension still disarms it permanently', () => {
    const b = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    b.tick(false, 1100); b.extend(1200);
    expect(b.tick(true, 1150)).toBe('disarmed');
    expect(b.tick(false, 5000)).toBe('disarmed');
  });
  test('E5 a never-armed backstop (ms <= 0) cannot be extended', () => {
    const b = createNoOutputBackstop({ ms: 0, startedAt: 1000 });
    expect(b.tick(false, 99999)).toBe('disarmed');
    expect(b.extend(200000)).toBe(false);
  });
});

describe('#251 item 1 — extendWindowMs is the retry window formula, and the SAME function', () => {
  test('F1 doubled, clamped strictly below the leg cap (the #219 table)', () => {
    expect(extendWindowMs(480000, 960000)).toBe(912000); // CI first attempt
    expect(extendWindowMs(912000, 960000)).toBe(912000); // CI retry: no room
    expect(extendWindowMs(300000, 900000)).toBe(600000); // local default
    expect(extendWindowMs(30000, 120000)).toBe(60000);   // the live model probe
    expect(extendWindowMs(0, 960000)).toBe(0);           // disabled stays disabled
  });
  test('F2 run-retry-window.js re-exports the identical function object (not a copy)', () => {
    const { retryBackstopMs } = require('../src/council/run-retry-window');
    expect(retryBackstopMs).toBe(extendWindowMs);
  });
});

describe('#251 item 1 — decideBackstopExtension: the spec §3 table, row by row', () => {
  const base = { windowMs: 480000, firedAtMs: 480722, legTimeoutMs: 960000, clockStartedAt: 1000000 };
  test('D1 busy with room → extend to clock + extended window; record extended:true', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'busy' } });
    expect(d.extendTo).toBe(1000000 + 912000);
    expect(d.record).toEqual({ windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 });
    expect(isBackstopRecord(d.record)).toBe(true);
  });
  test('D2 retry with no `next`, or a `next` inside the extended window → extend', () => {
    const noNext = decideBackstopExtension({ ...base, status: { type: 'retry', attempt: 2, message: '429' } });
    expect(noNext.extendTo).toBe(1912000);
    expect(noNext.record.status).toBe('retry');
    const inside = decideBackstopExtension({ ...base, status: { type: 'retry', attempt: 2, message: '429', next: 1912000 } });
    expect(inside.extendTo).toBe(1912000);
  });
  test('D3 retry whose `next` lies past the extended window → kill now, why retry-beyond-window, ISO recorded', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'retry', attempt: 3, message: '503', next: 1912001 } });
    expect(d.extendTo).toBeNull();
    expect(d.record).toEqual({
      windowMs: 480000, firedAtMs: 480722, status: 'retry', extended: false,
      why: 'retry-beyond-window', retryNextIso: new Date(1912001).toISOString(),
    });
    expect(isBackstopRecord(d.record)).toBe(true);
  });
  test('D4 busy but the window is already at the clamp → kill now, why at-cap (the CI retry leg)', () => {
    const d = decideBackstopExtension({ ...base, windowMs: 912000, firedAtMs: 913904, status: { type: 'busy' } });
    expect(d.extendTo).toBeNull();
    expect(d.record).toEqual({ windowMs: 912000, firedAtMs: 913904, status: 'busy', extended: false, why: 'at-cap' });
  });
  test('D5 idle → kill now, no why, no extension', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'idle' } });
    expect(d).toEqual({ extendTo: null, record: { windowMs: 480000, firedAtMs: 480722, status: 'idle', extended: false } });
  });
  test('D6 every probe outcome → kill now, status recorded as unknown (never extend on unknown)', () => {
    for (const probe of [probeUnknown('skipped', 'no window'), probeUnknown('failed', 'boom'), probeUnknown('no-status', 'the engine returned {}')]) {
      const d = decideBackstopExtension({ ...base, status: probe });
      expect(d.extendTo).toBeNull();
      expect(d.record).toEqual({ windowMs: 480000, firedAtMs: 480722, status: 'unknown', extended: false });
    }
  });
  test('D7 an engine `unknown` that is NOT a probe outcome is an unknown arm: kill now, identifier recorded, never extended', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'unknown', probe: 'failed', detail: 'forged' } });
    expect(d.extendTo).toBeNull();
    expect(d.record.status).toBe('unknown');
    expect(d.record.extended).toBe(false);
  });
  test('D8 an unrecognised or unrenderable status never extends; the sanitised identifier is what is recorded', () => {
    expect(decideBackstopExtension({ ...base, status: { type: 'working' } }).extendTo).toBeNull();
    expect(decideBackstopExtension({ ...base, status: { type: 'working' } }).record.status).toBe('working');
    expect(decideBackstopExtension({ ...base, status: null }).record.status).toBe('unknown');
    expect(decideBackstopExtension({ ...base, status: { type: '' } }).record.status).toBe('unknown');
    expect(decideBackstopExtension({ ...base, status: { type: 'busy\n\n  '.padEnd(80, 'x') } }).extendTo).toBeNull(); // raw type !== 'busy'
  });
  test('D9 classification is on the RAW type: a type that only SANITISES to busy does not extend', () => {
    // collapseExcerpt would collapse whitespace; the decision must compare the raw identifier.
    const d = decideBackstopExtension({ ...base, status: { type: ' busy ' } });
    expect(d.extendTo).toBeNull();
  });
  test('D10 a fractional windowMs/firedAtMs (envNumber accepts non-integers) still yields a record isBackstopRecord accepts', () => {
    // floor(2 * 480000.5) = 961001; min(961001, floor(960000 * 0.95) = 912000) = 912000 -- the
    // clamp already lands on an integer, so extendTo = clockStartedAt + 912000 = 1912000.
    const d = decideBackstopExtension({ ...base, windowMs: 480000.5, firedAtMs: 480722.9, status: { type: 'busy' } });
    expect(d.extendTo).toBe(1912000);
    expect(isBackstopRecord(d.record)).toBe(true);
    expect(d.record.windowMs).toBe(480000);
    expect(d.record.firedAtMs).toBe(480722);
    // the at-cap arm with fractional inputs: floor(windowMs) still yields a valid record.
    const atCap = decideBackstopExtension({
      ...base, windowMs: 912000.5, firedAtMs: 913904.7, status: { type: 'busy' },
    });
    expect(atCap.extendTo).toBeNull();
    expect(isBackstopRecord(atCap.record)).toBe(true);
    expect(atCap.record).toEqual({ windowMs: 912000, firedAtMs: 913904, status: 'busy', extended: false, why: 'at-cap' });
  });
});

describe('#251 item 1 — isBackstopRecord and the clause', () => {
  test('P1 accepts exactly the documented shapes and rejects forged or partial ones', () => {
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: true, extendedToMs: 3 })).toBe(true);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'idle', extended: false })).toBe(true);
    for (const why of BACKSTOP_WHY) {
      const rec = { windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why };
      if (why === 'retry-beyond-window') { rec.retryNextIso = '2026-09-18T12:34:56.000Z'; }
      expect(isBackstopRecord(rec)).toBe(true);
    }
    expect(isBackstopRecord(null)).toBe(false);
    expect(isBackstopRecord([])).toBe(false);
    expect(isBackstopRecord({ windowMs: 1.5, firedAtMs: 2, status: 'busy', extended: false })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: -1, status: 'busy', extended: false })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: '', extended: false })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: 'yes' })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: true })).toBe(false); // extended needs extendedToMs > windowMs
    expect(isBackstopRecord({ windowMs: 5, firedAtMs: 2, status: 'busy', extended: true, extendedToMs: 5 })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: true, extendedToMs: 3, why: 'at-cap' })).toBe(false); // extended never carries why
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why: 'because' })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why: 'retry-beyond-window' })).toBe(false); // needs retryNextIso
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why: 'at-cap', retryNextIso: 'x' })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'idle', extended: false, extra: 1 })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy\nINJECTED', extended: false })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'x'.repeat(41), extended: false })).toBe(false);
  });
  test('C1 the four clause strings, byte-exact (spec §5.1)', () => {
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 }))
      .toBe(' — window extended once from 480s to 912s at 481s on session busy');
    expect(formatBackstopExtensionClause({ windowMs: 912000, firedAtMs: 913904, status: 'busy', extended: false, why: 'at-cap' }))
      .toBe(' — not extended: the window is already at the leg cap');
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'retry', extended: false, why: 'retry-beyond-window', retryNextIso: '2026-09-18T12:34:56.000Z' }))
      .toBe(' — not extended: the engine schedules its next attempt at 2026-09-18T12:34:56.000Z, past the extended window');
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: false, why: 'pre-send' })).toBe('');
  });
  test('C2 nothing to say renders nothing: idle, unknown, a non-record, undefined', () => {
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'idle', extended: false })).toBe('');
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'unknown', extended: false })).toBe('');
    expect(formatBackstopExtensionClause({ forged: true })).toBe('');
    expect(formatBackstopExtensionClause(undefined)).toBe('');
  });
});
