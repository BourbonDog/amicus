'use strict';
const { bindStage1Waves, orphanLegNote, missingSeatDeadWave } = require('../../src/council/stage1-bind');
const { buildSeats } = require('../../src/council/seats');

const leg = (alias, waveId, slot, extra = {}) => ({ modelInput: alias, status: 'complete',
  summary: 'r', waveId, taskId: `${waveId}-${slot}`, ...extra });

describe('bindStage1Waves', () => {
  test('twins bind to distinct seats and seatOf keys on the leg OBJECT', () => {
    const roster = buildSeats(['deepseek', 'deepseek'], null, null);
    const legs = [leg('deepseek', 'w-s1', 1), leg('deepseek', 'w-s1', 2)];
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs }]);
    expect(r.seatOf.get(legs[0]).id).toBe('deepseek#1');
    expect(r.seatOf.get(legs[1]).id).toBe('deepseek#2');
    expect(r.missingSeats).toEqual([]);
    expect(r.orphanLegs).toEqual([]);
  });

  test('two waves are bound INDEPENDENTLY — a leg of wave B is not an orphan of wave A', () => {
    const seats = buildSeats(['a', 'crit'], 'crit', null);
    const wa = { waveId: 'w-s1', roster: [seats[0]], legs: [leg('a', 'w-s1', 1)] };
    const wc = { waveId: 'w-c1', roster: [seats[1]], legs: [leg('crit', 'w-c1', 1)] };
    const r = bindStage1Waves([wa, wc]);
    expect(r.orphanLegs).toEqual([]);
    expect(r.missingSeats).toEqual([]);
    expect(r.seatOf.size).toBe(2);
  });

  test('a partial return yields a missing seat, carrying the counts for its prose', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const legs = [leg('a', 'w-s1', 1)];
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs }]);
    expect(r.missingSeats).toEqual([{ waveId: 'w-s1', seat: roster[1], returned: 1, expected: 2 }]);
  });

  test('a wave that returned NOTHING yields no missing seats — dead-wave already owns it', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs: [] }]);
    expect(r.missingSeats).toEqual([]);
    expect(r.orphanLegs).toEqual([]);
  });

  test('a wave with an ORPHAN leg yields no missing seats — its review already landed', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const stray = leg('zzz', 'w-s1', 9, { taskId: 'stray-1' });
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs: [leg('a', 'w-s1', 1), stray] }]);
    expect(r.orphanLegs).toEqual([{ waveId: 'w-s1', leg: stray }]);
    expect(r.missingSeats).toEqual([]);   // b is NOT retried: a paid leg is unaccounted for
  });

  test('an orphan leg note names the channel and the leg', () => {
    const stray = leg('zzz', 'w-s1', 9, { taskId: 'stray-1' });
    const note = orphanLegNote('w-s1', stray);
    expect(note.channel).toBe('seat-unbound');
    expect(note.what).toContain('stray-1');
    expect(note.data).toEqual({ waveId: 'w-s1', legId: 'stray-1', seat: 'zzz' });
  });

  test('missingSeatDeadWave is a single-seat dead-wave record flagged partial', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const w = missingSeatDeadWave({ waveId: 'w-s1', seat: roster[1], returned: 1, expected: 2 });
    expect(w).toEqual({ waveId: 'w-s1', models: ['b'], seats: [roster[1]],
      reason: 'the wave returned 1 of 2 legs and none of them was this seat’s', partial: true });
  });
});
