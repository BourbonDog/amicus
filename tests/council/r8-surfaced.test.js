'use strict';

// v4.8 PR5a T6/T7 (R5-3, R5-10) — R8 reaches a human.
//
// tally.js has stamped `sameModelCorroboration` since PR4c and verdict.js carries it.
// Measured before this change: ZERO renderer consumers, and the chair packet never
// mentioned it either — while spec §4.6:188 asserts BOTH ("the chair packet is required
// to surface it, and the report renderers show it"). A Confirmed finding reached only via
// the raiser's own twin rendered as an ordinary Confirmed with a ✓, indistinguishable from
// independent corroboration. That is exactly the overstatement R8 was chosen over
// model-exact exclusion to prevent.
//
// ⚠️ ONE TEST PER RENDERER, deliberately. A shared test would let either renderer regress
// silently, and `toModel` sits upstream of both — its literal is CLOSED, so the field was
// invisible to them regardless of what they rendered.

const { buildReport } = require('../../src/council/report');
const { buildChairPacket } = require('../../src/council/briefings-chair');

function verdict(flagged) {
  return {
    runId: 'r', date: 'd', chair: 'gpt', council: ['gemini', 'gemini'],
    seats: [
      { id: 'gemini#1', alias: 'gemini', role: 'seat', lens: null, position: 1 },
      { id: 'gemini#2', alias: 'gemini', role: 'seat', lens: null, position: 2 },
    ],
    tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 },
    findings: [{
      id: 'B1', severity: 'major', raiser: 'gemini', raiserSeat: 'gemini#2',
      tier: 'Confirmed', basis: { a: 1, d: 0, n: 0 },
      adjudications: [
        { judge: 'gemini', verdict: 'agree', seat: 'gemini#1' },
        { judge: 'gemini', verdict: 'agree', seat: 'gemini#2' },
      ],
      ...(flagged ? { sameModelCorroboration: true } : {}),
    }],
    streetCred: [], runStats: [],
  };
}

describe('the R8 marker reaches both renderers', () => {
  test('markdown: the tier cell carries † and the legend explains it', () => {
    const md = buildReport({ verdict: verdict(true) });
    const row = md.split('\n').find(l => l.startsWith('| B1 '));
    // Killing mutant: drop the marker -> `Confirmed` and this assertion fails.
    expect(row).toContain('| Confirmed† |');
    expect(md).toContain('corroborated only by another seat running the SAME model');
  });

  test('html: the tier cell carries † and the legend explains it', () => {
    const html = buildReport({ verdict: verdict(true) }, { format: 'html' });
    expect(html).toMatch(/<td[^>]*>Confirmed<sup>†<\/sup><\/td>/);
    expect(html).toContain('corroborated only by another seat running the SAME model');
  });

  // The gate is what keeps byte-identity: written unconditionally the legend shifts every
  // subsequent line of a unique-alias report, breaking the existing pins and all four
  // snapshots. An unflagged verdict must be untouched in BOTH dialects.
  test('an unflagged verdict gets no marker and no legend line, in either dialect', () => {
    const md = buildReport({ verdict: verdict(false) });
    const html = buildReport({ verdict: verdict(false) }, { format: 'html' });
    expect(md).toContain('| Confirmed |');
    expect(md).not.toContain('†');
    expect(html).not.toContain('†');
    expect(md).not.toContain('corroborated only by');
    expect(html).not.toContain('corroborated only by');
  });

  // toModel names every key it copies off a finding and copies nothing else, so the flag
  // was invisible to both renderers no matter what they rendered. This pins the seam
  // itself, not just its downstream effect.
  test('the neutral model carries the flag through toModel', () => {
    const { toModel } = require('../../src/council/report');
    expect(toModel(verdict(true)).findings[0].sameModelCorroboration).toBe(true);
    expect('sameModelCorroboration' in toModel(verdict(false)).findings[0]).toBe(false);
  });
});

describe('the chair packet surfaces R8 (spec §4.6:188)', () => {
  const base = {
    reviews: [{ model: 'gemini', text: 'prose' }],
    rankings: [{ judge: 'gemini', order: ['gemini'] }],
    adjudications: [{ findingId: 'B1', judge: 'gemini', verdict: 'agree' }],
    tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 },
    date: '2026-08-14',
  };

  test('a flagged finding is named to the chair, with the caveat', () => {
    const packet = buildChairPacket({
      ...base, findings: [{ id: 'B1', sameModelCorroboration: true }],
    });
    expect(packet).toContain('SAME-MODEL CORROBORATION (R8)');
    expect(packet).toContain('B1');
    expect(packet).toContain('not independent support');
  });

  test('the caveat sits between the adjudications it qualifies and the verdict scale', () => {
    const packet = buildChairPacket({
      ...base, findings: [{ id: 'B1', sameModelCorroboration: true }],
    });
    const adj = packet.indexOf('--- PER-FINDING ADJUDICATIONS ---');
    const r8 = packet.indexOf('--- SAME-MODEL CORROBORATION (R8) ---');
    const scale = packet.indexOf('VERDICT');
    expect(adj).toBeGreaterThan(-1);
    expect(r8).toBeGreaterThan(adj);
    expect(scale).toBeGreaterThan(r8);
  });

  test('a packet with no flagged finding is byte-identical to one built without findings', () => {
    const withNone = buildChairPacket({ ...base, findings: [{ id: 'B1' }] });
    const without = buildChairPacket({ ...base });
    expect(withNone).toBe(without);
    expect(withNone).not.toContain('SAME-MODEL CORROBORATION');
  });
});
