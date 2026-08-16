'use strict';
// v4.8 PR5c Task 1 — the producer emits seat identity on every dead arm, and never
// collapses an UNIDENTIFIED seat onto its alias.
//
// Round-2 council finding B1 (blocker): mapping a null seat slot to the alias makes it
// indistinguishable from a second reference to that alias, and no consumer can recover the
// difference (deadSeats has no per-alias seat count). Finding D2: the same collapse splits
// the keyspace in run-retry.js's own notedSeats dedup, so one seat can emit TWO notes.
jest.mock('../../src/council/run-state', () => ({ appendStageWave: jest.fn() }));
const fs = require('fs');
const os = require('os');
const path = require('path');
const { waveStillDeadNote, srcLegStillDeadNote } = require('../../src/council/run-retry-notes');
const { retryStage1Losses } = require('../../src/council/run-retry');
const { buildSeats } = require('../../src/council/seats');

const COUNTS = { reviewed: 1, total: 3 };
const createdRunDirs = [];
afterAll(() => {
  for (const d of createdRunDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function fakeCtx(oOverrides = {}, opts = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr5c-'));
  createdRunDirs.push(runDir);
  const notes = [];
  const o = { runId: 'r1', runDir, models: ['a', 'b'], critic: null, lenses: null,
    briefing: 'B', date: 'D', timeout: 5, gateway: undefined, noValidateModel: false,
    noCostGate: false, councilName: null, fallback: null, catalog: null, ...oOverrides };
  o.seats = buildSeats(o.models, o.critic, o.lenses);
  o.criticSeat = (o.seats.find(s => s.alias === o.critic) || {}).id || null;
  return {
    o,
    launchers: {
      // A retry wave that produces NO legs — drives the "retry wave died wholesale" branch
      // at run-retry.js:176-191, which is where notedSeats lives.
      launchWave: opts.launchWave || jest.fn(async () => ({ legs: [] })),
      launchSolo: opts.launchSolo || jest.fn(async () => ({ legs: [] })),
    },
    degrade: { note: (r) => notes.push(r) },
    addWave: jest.fn(),
    overBudget: opts.overBudget || (() => false),
    _notes: notes,
  };
}

describe('T1a — the dead-wave arm carries seat ids, and null for unidentified slots', () => {
  const unit = { waveId: 'r1-s1r1' };

  test('identified slots emit their seat ids', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const note = waveStillDeadNote(
      { waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats, reason: 'x' }, unit);
    expect(note.channel).toBe('dead-wave');
    expect(note.data.seats).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('an UNIDENTIFIED slot emits null — never the alias (round-2 B1)', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const note = waveStillDeadNote(
      { waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats: [seats[0], null], reason: 'x' }, unit);
    // `null` says "this seat exists, unidentified". The alias would say "this is deepseek",
    // which is the statement that collapses two distinct dead seats into one row.
    expect(note.data.seats).toEqual(['deepseek#1', null]);
    expect(note.data.seats[1]).not.toBe('deepseek');
  });

  test('seats[] stays index-parallel with models[], including a missing roster', () => {
    const note = waveStillDeadNote({ waveId: 'r1-s1', models: ['a', 'b'], reason: 'x' }, unit);
    expect(note.data.seats).toEqual([null, null]);
    expect(note.data.seats).toHaveLength(note.data.models.length);
  });

  test('data.seat stays the ALIAS on the partial arm (verdict.js:72 compares it to o.critic)', () => {
    const note = waveStillDeadNote(
      { waveId: 'r1-s1', models: ['deepseek'], seats: [null], reason: 'x', partial: true }, unit);
    expect(note.channel).toBe('seat-unbound');
    expect(note.data.seat).toBe('deepseek');
  });
});

describe('T1b — srcLegStillDeadNote carries the seat key', () => {
  test('emits seatId when the leg was bound to a seat', () => {
    const note = srcLegStillDeadNote(
      { modelInput: 'deepseek', status: 'error', error: 'boom' },
      { waveId: 'r1-s1r1' }, COUNTS, 'deepseek#2');
    expect(note.data.seatId).toBe('deepseek#2');
    expect(note.data.seat).toBe('deepseek');   // alias, unchanged
  });

  test('emits seatId null when the leg was never bound', () => {
    const note = srcLegStillDeadNote(
      { modelInput: 'deepseek', status: 'error', error: 'boom' },
      { waveId: 'r1-s1r1' }, COUNTS, null);
    expect(note.data.seatId).toBeNull();
    expect(note.data.seat).toBe('deepseek');
  });
});

describe('T1c — notedSeats does not double-announce one seat across keyspaces (round-2 D2)', () => {
  // Still-dead notes are RETURNED in out.stillDeadNotes; only heal notes go through
  // ctx.degrade.note. Asserting on ctx._notes measures the wrong surface.
  const deadNotes = (out) => out.stillDeadNotes.filter(
    n => n.channel === 'dead-leg' || n.channel === 'dead-wave');

  test('a UNIQUE alias: the wave slot and the leg ARE the same seat -> ONE note', async () => {
    // K = 1, so seats.js gives the seat an id equal to its alias and srcLegKey lands on the
    // key the wave already noted. The plain notedSeats test catches it; no roster math needed.
    const ctx = fakeCtx({ models: ['alpha', 'beta'] });
    const leg = { modelInput: 'alpha', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['alpha'], seats: [null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map([[leg, ctx.o.seats[0]]]),
      counts: COUNTS,
    });
    expect(deadNotes(out)).toHaveLength(1);
  });

  test('a TWIN alias with room to spare: the leg is a DISTINCT seat and gets its own note', async () => {
    // K = 2, one unnamed wave slot, one bound leg. The unnamed slot can be the OTHER twin, so
    // nothing proves the leg is already covered. Announce it.
    // ⚠️ This assertion was 1 until the council's C1 (blocker): the earlier alias-wide budget
    // assumed the leg WAS the unnamed slot and suppressed it — trading a visible duplicate for
    // a SILENT LOSS, the direction this whole PR exists to reject. The roster count replaces
    // the assumption with a pigeonhole test: suppress only when U > K - (I+1).
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'] });
    const leg = { modelInput: 'deepseek', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek'], seats: [null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map([[leg, ctx.o.seats[0]]]),
      counts: COUNTS,
    });
    expect(deadNotes(out)).toHaveLength(2);
  });

  test('PIGEONHOLE: both twin slots unnamed leaves no room, so a bound leg is suppressed', async () => {
    // K = 2 and the wave already announced TWO unnamed seats of this alias — every seat is
    // accounted for, so the leg MUST be one of them. Suppress, on evidence rather than guess.
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'] });
    const leg = { modelInput: 'deepseek', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'],
        seats: [null, null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map([[leg, ctx.o.seats[0]]]),
      counts: COUNTS,
    });
    expect(deadNotes(out)).toHaveLength(1);
  });

  test('a wave that NAMES one twin and leaves one unnamed absorbs a leg for the other', async () => {
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'] });
    const seats = ctx.o.seats;
    const leg = { modelInput: 'deepseek', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      // the wave names TWO seats: one identified (#1), one not. The leg is bound to #2,
      // which the unidentified slot may or may not be — the budget consumes exactly one.
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'],
        seats: [seats[0], null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map([[leg, seats[1]]]),
      counts: COUNTS,
    });
    // The wave already announced both of this alias's seats (one by name, one not),
    // so the leg must not add a third.
    expect(deadNotes(out)).toHaveLength(1);
  });

  // Kills the mutant `seatId: alias` at the run-retry-group call site. The T1b tests above
  // pass seatId in by hand, so they pin the note BUILDER but not the WIRING from seatOf —
  // mutating the call site left all nine green until this test existed.
  test('the emitted note carries the seat id from seatOf, not the alias', async () => {
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'] });
    const leg = { modelInput: 'deepseek', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      deadWaves: [],                                   // no wave -> no budget in play
      deadLegs: [leg],
      seatOf: new Map([[leg, ctx.o.seats[1]]]),        // bound to deepseek#2
      counts: COUNTS,
    });
    const note = deadNotes(out).find(n => n.channel === 'dead-leg');
    expect(note.data.seatId).toBe('deepseek#2');
    expect(note.data.seat).toBe('deepseek');           // alias, unchanged
  });

  // Kills the mutant that lets the budget swallow EVERY leg on the alias. The control
  // below uses two DIFFERENT aliases, so it never exercises over-suppression.
  test('the budget claims exactly ONE leg per unnamed slot — the second twin still speaks', async () => {
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'] });
    const seats = ctx.o.seats;
    const legA = { modelInput: 'deepseek', status: 'error', error: 'a' };
    const legB = { modelInput: 'deepseek', status: 'error', error: 'b' };
    const out = await retryStage1Losses(ctx, {
      // ONE unnamed slot, TWO bound legs on that alias: the slot accounts for one of them,
      // the other is a genuinely distinct dead seat and must get its own note.
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek'], seats: [null], reason: 'x' }],
      deadLegs: [legA, legB],
      seatOf: new Map([[legA, seats[0]], [legB, seats[1]]]),
      counts: COUNTS,
    });
    expect(deadNotes(out)).toHaveLength(2);            // 1 wave note + 1 leg note
    expect(deadNotes(out).filter(n => n.channel === 'dead-leg')).toHaveLength(1);
  });

  test('CONTROL — a distinct alias is never absorbed by another alias budget', async () => {
    const ctx = fakeCtx({ models: ['alpha', 'beta'] });
    const leg = { modelInput: 'beta', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['alpha'], seats: [null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map([[leg, ctx.o.seats[1]]]),
      counts: COUNTS,
    });
    expect(deadNotes(out)).toHaveLength(2);
  });
  test('D1: an UNBOUND leg on a twin alias is not swallowed by the wave note', async () => {
    // srcLegKey falls back to the ALIAS for an unbound leg, so `noted.has(key)` matched the
    // wave's unnamed slot and skipped it before the pigeonhole ever ran — collapsing two
    // distinct dead seats into one note. K=2, U=1, I=0: admitting is 0+1+1 = 2 <= 2, so there
    // is room for both and nothing proves they are the same seat.
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'] });
    const leg = { modelInput: 'deepseek', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek'], seats: [null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map(),                       // never bound
      counts: COUNTS,
    });
    expect(deadNotes(out)).toHaveLength(2);
  });

  test('D1 control: a UNIQUE alias has no room, so the unbound leg IS the wave slot', async () => {
    // K=1: 0+1+1 = 2 > 1, so the wave's unnamed slot must be this very seat. Suppress.
    const ctx = fakeCtx({ models: ['alpha', 'beta'] });
    const leg = { modelInput: 'alpha', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['alpha'], seats: [null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map(),
      counts: COUNTS,
    });
    expect(deadNotes(out)).toHaveLength(1);
  });

});
