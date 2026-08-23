// tests/council/chair-packet-seats.test.js — v4.8 SI-25 (rulings R25-1..R25-5).
//
// The chair packet was assembled entirely in ALIAS space, so on a twin bench it
// was internally unreconcilable: the chair got "Deterministic tier counts:
// {Confirmed: 1}" beside two identical `A1 — deepseek:` lines. Measured at BASE,
// NOTHING pinned the twin-bench rendering of any of the packet's three sites —
// that gap is why the defect shipped. These are those pins.
//
// Natural home re-derived (the brief proposed briefings-stage2.test.js): the item
// spans TWO layers — the rendering in `briefings-chair.js :: buildChairPacket` and
// the seat forward in `run-assemble.js :: buildChairPacketFile` — and the
// byte-identity invariant is only provable across both. A single-item file follows
// the precedent of r8-surfaced.test.js / run-raiserseat-call.test.js.
//
// The five named mutants these tests are the red set for — ALIASBACK, SEATONLY,
// NULLLEAK, FLATTIE, HDRSEATFWD — are recorded with their measured numbers in
// tests/council/chair-packet-seat-mutants.js :: ALIASBACK.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildChairPacket } = require('../../src/council/briefings-chair');
const asm = require('../../src/council/run-assemble');
const { buildSeats } = require('../../src/council/seats');

const TIERS = { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 };
const RANK_HEAD = '--- PEER RANKINGS (judge: order, best first) ---\n\n';

/** The rendered rankings block, so a shape assertion can be an EQUALITY. */
function rankingBlock(packet) {
  return packet.split(RANK_HEAD)[1].split('\n\n')[0];
}

describe('SI-25 — the twin bench the packet could not reconcile', () => {
  // Real seats, not a hand-made literal: buildSeats is what mints `deepseek#1` /
  // `deepseek#2`, and the pin should break if that scheme ever changes.
  const seats = buildSeats(['deepseek', 'deepseek'], null, null);
  const packet = buildChairPacket({
    reviews: [
      { model: 'deepseek', text: 'First DS review.', seat: seats[0] },
      { model: 'deepseek', text: 'Second DS review.', seat: seats[1] },
    ],
    rankings: [
      { judge: 'deepseek', seat: 'deepseek#1', order: ['deepseek', 'deepseek'],
        orderSeats: ['deepseek#2', 'deepseek#1'] },
      { judge: 'deepseek', seat: 'deepseek#2', order: ['deepseek', 'deepseek'],
        orderSeats: ['deepseek#1', 'deepseek#2'] },
    ],
    adjudications: [
      { findingId: 'A1', judge: 'deepseek', seat: 'deepseek#1', verdict: 'agree' },
      { findingId: 'A1', judge: 'deepseek', seat: 'deepseek#2', verdict: 'dispute' },
    ],
    tierCounts: TIERS,
  });

  test('site (1) — the two review headers are distinguishable', () => {
    expect(packet).toContain('--- Review by deepseek#1 ---\nFirst DS review.');
    expect(packet).toContain('--- Review by deepseek#2 ---\nSecond DS review.');
    expect(packet).not.toContain('--- Review by deepseek ---');
  });

  test('site (2) — the two adjudication lines are distinguishable', () => {
    expect(packet).toContain('A1 — deepseek#1: agree');
    expect(packet).toContain('A1 — deepseek#2: dispute');
    expect(packet).not.toContain('A1 — deepseek: ');
  });

  test('site (3) — the two ranking lines are distinguishable in BOTH key and value', () => {
    expect(rankingBlock(packet)).toBe(
      'deepseek#1: ["deepseek#2","deepseek#1"]\n'
      + 'deepseek#2: ["deepseek#1","deepseek#2"]');
  });

  test('the packet a paid chair reads carries no bare alias for a twinned seat', () => {
    // The defect in one assertion: every `deepseek` mention must be disambiguated.
    expect(packet.match(/deepseek(?!#)/g)).toBeNull();
  });
});

describe('SI-25 R25-2 — byte-identical output on a unique-alias bench', () => {
  // Spec §4.2. Proven, not asserted: the SAME packet built with the seat channel
  // present (ids equal to their aliases, the emit-when-DIFFERENT shape a unique
  // bench actually produces) must equal the packet built with it absent.
  const seats = buildSeats(['gemini', 'gpt'], null, null);
  const withSeats = buildChairPacket({
    reviews: [
      { model: 'gemini', text: 'G review.', seat: seats[0] },
      { model: 'gpt', text: 'P review.', seat: seats[1] },
    ],
    // `orderSeats: [null, null]` is rankingToOrder's PARITY SHAPE on a unique
    // bench — buildTallyInput withholds it, but the renderer must survive it.
    rankings: [{ judge: 'gemini', order: ['gpt', 'gemini'], orderSeats: [null, null] }],
    adjudications: [{ findingId: 'A1', judge: 'gpt', verdict: 'agree' }],
    tierCounts: TIERS,
  });
  const withoutSeats = buildChairPacket({
    reviews: [{ model: 'gemini', text: 'G review.' }, { model: 'gpt', text: 'P review.' }],
    rankings: [{ judge: 'gemini', order: ['gpt', 'gemini'] }],
    adjudications: [{ findingId: 'A1', judge: 'gpt', verdict: 'agree' }],
    tierCounts: TIERS,
  });

  test('the two packets are byte-identical', () => {
    expect(withSeats).toBe(withoutSeats);
  });

  test('and that identity is the pre-SI-25 rendering, not a new one', () => {
    expect(withSeats).toContain('--- Review by gemini ---\nG review.');
    expect(rankingBlock(withSeats)).toBe('gemini: ["gpt","gemini"]');
    expect(withSeats).toContain('A1 — gpt: agree');
  });

  test("the Claude review has no seat at all and still renders 'Review by claude'", () => {
    // §0.3: run-assemble.js concatenates it as `{ model: 'claude', text }`. The
    // fallback is load-bearing here, not defensive.
    const packet = buildChairPacket({
      reviews: [{ model: 'gemini', text: 'G.', seat: seats[0] }, { model: 'claude', text: 'C.' }],
      rankings: [], adjudications: [], tierCounts: TIERS,
    });
    expect(packet).toContain('--- Review by claude ---\nC.');
  });
});

describe('SI-25 R25-3 — the rankings zip is per-slot, tie-aware and null-safe', () => {
  const render = (ranking) => rankingBlock(buildChairPacket({
    reviews: [{ model: 'gemini', text: 'G.' }], rankings: [ranking],
    adjudications: [], tierCounts: TIERS,
  }));

  test('a TIE slot zips element-wise, keeping the alias wherever the seat is null', () => {
    expect(render({ judge: 'gemini', seat: 'gemini#1',
      order: [['deepseek', 'gpt'], 'qwen'], orderSeats: [[null, 'gpt#2'], 'qwen'] }))
      .toBe('gemini#1: [["deepseek","gpt#2"],"qwen"]');
  });

  test('a null in a SCALAR slot falls back to the alias — no null reaches the JSON', () => {
    expect(render({ judge: 'gemini', order: ['deepseek', 'gpt'], orderSeats: [null, 'gpt#2'] }))
      .toBe('gemini: ["deepseek","gpt#2"]');
  });

  test('orderSeats absent entirely renders order unchanged', () => {
    expect(render({ judge: 'gemini', order: ['deepseek', 'gpt'] }))
      .toBe('gemini: ["deepseek","gpt"]');
  });

  test('an orderSeats SHORTER than order neither drops nor nulls the trailing slots', () => {
    expect(render({ judge: 'gemini', order: ['deepseek', 'gpt'], orderSeats: ['deepseek#1'] }))
      .toBe('gemini: ["deepseek#1","gpt"]');
  });

  test('a tie whose orderSeats slot is a bare null keeps the whole group', () => {
    expect(render({ judge: 'gemini', order: [['deepseek', 'gpt']], orderSeats: [null] }))
      .toBe('gemini: [["deepseek","gpt"]]');
  });

  // Raised by the PR #189 council (A1, thin) and independently by the whole-branch
  // reviewer, which is why a shape no producer here can emit still gets a pin: the
  // two arrays DISAGREEING on a slot's structure. Both directions, because they
  // failed differently — the array/scalar direction was already safe, the
  // scalar/array direction leaked `[null,null]` AND changed the slot's shape,
  // contradicting the docblock's unconditional no-null promise.
  // Named mutant SHAPESWAP, recorded in chair-packet-seat-mutants.js :: SHAPESWAP.
  test('a SCALAR order slot against an ARRAY orderSeats slot keeps the scalar — no null, no reshape', () => {
    expect(render({ judge: 'gemini', order: ['deepseek'], orderSeats: [[null, null]] }))
      .toBe('gemini: ["deepseek"]');
    expect(render({ judge: 'gemini', order: ['deepseek'], orderSeats: [['a', 'b']] }))
      .toBe('gemini: ["deepseek"]');
  });

  test('an ARRAY order slot against a SCALAR orderSeats slot keeps every alias', () => {
    expect(render({ judge: 'gemini', order: [['deepseek', 'gpt']], orderSeats: ['x'] }))
      .toBe('gemini: [["deepseek","gpt"]]');
  });
});

describe('SI-25 R25-5 — buildChairPacketFile forwards the seat emit-when-DIFFERENT', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-si25-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const build = (reviews) => asm.buildChairPacketFile({
    runDir: tmp, reviews, claudeReview: null, debateOutcomes: null, date: '2026-08-23',
    tallyInput: { rankings: [], adjudications: [] },
    record: { findings: [], tierCounts: TIERS },
  });

  test('a UNIQUE seat is withheld, so a resolved model id still renders verbatim', () => {
    // ⚠️ Measured, and it contradicts the naive reading of R25-2: reviews[].model
    // is `run-stages.js`'s `m.modelInput`, i.e. the leg's `modelInput || model` —
    // the RESOLVED id when a leg reports none. An UNCONDITIONAL forward would
    // rewrite this header to the bare alias `gemini` on a bench with no twin,
    // which is exactly the byte-identity break spec §4.2 forbids.
    const packet = build([
      { model: 'google/gemini-3.5-pro', text: 'G.', seat: buildSeats(['gemini'], null, null)[0] },
    ]);
    expect(packet).toContain('--- Review by google/gemini-3.5-pro ---\nG.');
    expect(packet).not.toContain('--- Review by gemini ---');
  });

  test('a TWIN seat DOES ride the projection into the header', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const packet = build([
      { model: 'deepseek', text: 'One.', seat: seats[0] },
      { model: 'deepseek', text: 'Two.', seat: seats[1] },
    ]);
    expect(packet).toContain('--- Review by deepseek#1 ---\nOne.');
    expect(packet).toContain('--- Review by deepseek#2 ---\nTwo.');
    // …and the artifact on disk says the same thing as the returned string.
    expect(fs.readFileSync(path.join(tmp, 'chair-packet.md'), 'utf-8')).toBe(packet);
  });

  test('a review with no seat at all is untouched by the projection', () => {
    expect(build([{ model: 'gemini', text: 'G.' }]))
      .toContain('--- Review by gemini ---\nG.');
  });
});
