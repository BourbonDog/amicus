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

  test('an unidentified wave slot and a BOUND leg on the same alias produce ONE note, not two', async () => {
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'] });
    const seats = ctx.o.seats;                       // deepseek#1, deepseek#2
    const leg = { modelInput: 'deepseek', status: 'error', error: 'boom' };
    const out = await retryStage1Losses(ctx, {
      // the wave names ONE seat of this alias and could not identify it;
      // the leg IS (very likely) that same seat, and this time it was bound.
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek'], seats: [null], reason: 'x' }],
      deadLegs: [leg],
      seatOf: new Map([[leg, seats[0]]]),
      counts: COUNTS,
    });
    // At HEAD: seatKey(null,'deepseek') = 'deepseek' but srcLegKey = 'deepseek#1',
    // so notedSeats misses and BOTH emit — one seat, two notes.
    expect(deadNotes(out)).toHaveLength(1);
  });

  test('a leg for a genuinely DIFFERENT seat still gets its own note', async () => {
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
});
