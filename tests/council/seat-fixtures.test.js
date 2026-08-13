// tests/council/seat-fixtures.test.js
'use strict';
// v4.8 PR2a Task 1 Step 5: this suite is the task's real gate — proof that a
// leg shaped like run-stages.test.js's stamped fixtures actually BINDS under
// bindSeats, for both a unique-alias bench and a twin bench. Counting legs or
// asserting only the bind result is not enough: seats.js:133's `mine` filter
// admits a leg with NO waveId field at all (it matches "any" wave), and its
// taskId-prefix match alone can bind it — so a fixture that got taskId right
// but forgot the waveId field would still pass a bind-only check. Each bench
// below asserts `leg.waveId === waveId` explicitly, BEFORE calling bindSeats,
// so a missing waveId is caught here rather than silently passing.
//
// Fix-wave (whole-branch review, v48-pr2a-seat-prereqs): counting legs, the
// bind result, and even the SET of bound aliases are still not enough — a
// slot SWAP (two legs' taskId slots exchanged, both still valid slots) leaves
// every one of those checks green while binding gemini's leg to the gpt
// seat. That is precisely the silent wrong-seat failure this whole
// workstream exists to kill. Every bind case below now also asserts
// leg-to-seat CORRESPONDENCE — which specific leg landed on which specific
// seat, not just how many landed and which aliases are represented. Twin
// benches need a different technique (their legs share one alias, so alias
// equality proves nothing), documented at each site below. This file also
// mirrors run-retry.test.js's distinct builder shape (item 2, second
// describe block) and adds a two-seat twin retry roster where position is
// the only possible discriminator (item 4, last describe in the first
// block).
//
// The leg shape is copied verbatim from run-stages.test.js's mkLeg
// (// mirrors run-stages.test.js:30-35) rather than required — local builders
// in a sibling .test.js file are not exported, and importing test internals
// across suites is exactly the coupling this file exists to avoid.
const { buildSeats, bindSeats } = require('../../src/council/seats');

let legSeq = 0;
// mirrors run-stages.test.js:30-35 (mkLeg, post-Task-1 shape: explicit
// waveId/slot -> taskId `${waveId}-${slot}` plus a waveId field; the
// undefined-waveId fallback is unused here — every fixture in this file
// stamps both explicitly, which is the entire point of the gate.
const mkLeg = (model, summary, status, waveId, slot) => ({
  taskId: waveId != null ? `${waveId}-${slot}` : `${model}-${++legSeq}`,
  model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: 0.01, source: 'reported' } },
  ...(waveId != null ? { waveId } : {}),
});

describe('seat-fixtures: engine-shaped legs bind under bindSeats (v4.8 PR2a Task 1 gate)', () => {
  describe('unique-alias bench', () => {
    const models = ['gemini', 'gpt', 'qwen'];
    const seats = buildSeats(models, null, null);
    const waveId = 'abc123-s1';
    // roster order === bench order (run-stage1-launch.js:47), so slot i+1
    // matches seats[i] directly for a unique-alias, critic-free bench.
    const legs = models.map((m, i) => mkLeg(m, `review by ${m}`, 'complete', waveId, i + 1));

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(waveId); }
    });

    test('bindSeats(waveId, roster, legs): full clean bind, no unbound, no orphans, correspondence holds', () => {
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, legs);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
      expect(bound.map(b => b.seat.alias).sort()).toEqual(['gemini', 'gpt', 'qwen']);
      // Correspondence (fix-wave item 1): a slot SWAP — e.g. gemini's and
      // gpt's taskId slots exchanged, both still valid slots in range —
      // leaves every assertion above unchanged: bound count, unbound,
      // orphans, and even the ALIAS SET are all identical before and after a
      // swap. This is the one assertion that actually looks at which leg
      // landed on which seat (proof it catches a swap: see the fix-wave
      // report's mutation evidence).
      expect(bound.every(b => b.seat.alias === (b.leg.modelInput || b.leg.model))).toBe(true);
    });

    test('a leg whose taskId names a different wave lands in orphanLegs', () => {
      // seats.js:133's `mine` filter drops a leg stamped with a DIFFERENT
      // waveId entirely — it belongs to that other wave's own bindSeats call,
      // never this one's orphanLegs. To land HERE, taskId must name a foreign
      // wave while the leg carries no waveId field at all — the disk-rebuilt,
      // taskId-only shape seats.js's own doc comment describes.
      const foreign = { ...mkLeg('gemini', 'from the retry wave', 'complete'), taskId: 'abc123-s1r1-1' };
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, [...legs, foreign]);
      expect(bound).toHaveLength(seats.length);      // the real roster still binds in full
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([foreign]);          // the foreign-wave leg is the only orphan
    });
  });

  describe('twin bench (deepseek, deepseek)', () => {
    const models = ['deepseek', 'deepseek'];
    const seats = buildSeats(models, null, null); // ids: deepseek#1, deepseek#2
    const waveId = 'abc123-s1';
    const legs = models.map((m, i) => mkLeg(m, `review by ${m} #${i + 1}`, 'complete', waveId, i + 1));

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(waveId); }
    });

    test('bindSeats(waveId, roster, legs): full clean bind, no unbound, no orphans', () => {
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, legs);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
    });

    test('the two twin legs bind to DISTINCT seat ids — slot correctness, not alias, separates them', () => {
      // seats.js:141-145's alias fallback fires only when the alias holds
      // EXACTLY ONE seat in the roster; a twin alias holds two, so that path
      // can never resolve either leg. Both legs here bind purely off their
      // taskId's roster-slot suffix — this is the twin case Task 1 exists for.
      const { bound } = bindSeats(waveId, seats, legs);
      const ids = bound.map(b => b.seat.id).sort();
      expect(ids).toEqual(['deepseek#1', 'deepseek#2']);
      expect(new Set(ids).size).toBe(2);

      // Correspondence (fix-wave item 1): distinct ids alone do not prove
      // each leg landed on ITS OWN seat — a swap between the two twins still
      // produces two distinct ids, just with the wrong two legs attached.
      // Alias equality is USELESS here: both legs share alias 'deepseek', so
      // `leg.modelInput === seat.alias` holds no matter which leg binds to
      // which seat and cannot catch a swap. The fixture's own summary
      // carries the leg's INTENDED slot (`#${i + 1}` in mkLeg above); seat.id
      // carries the matching `#N` suffix buildSeats mints for that same
      // slot. Comparing those two independently-derived numbers is what
      // actually proves each leg landed on its own seat, not merely "a
      // deepseek seat".
      for (const { seat, leg } of bound) {
        const legSlot = leg.summary.match(/#(\d+)$/)[1];
        const seatSlot = seat.id.match(/#(\d+)$/)[1];
        expect(legSlot).toBe(seatSlot);
      }
    });

    test('a leg whose taskId names a different wave lands in orphanLegs', () => {
      // Same reasoning as the unique-alias case above: no waveId field, so it
      // is not silently excluded by the `mine` filter before orphaning can see it.
      const foreign = { ...mkLeg('deepseek', 'from the retry wave', 'complete'), taskId: 'abc123-s1r1-1' };
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, [...legs, foreign]);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([foreign]);
    });
  });

  describe('retry wave (abc123-s1r1): a partial-roster retry binds against ITS OWN roster, not the bench', () => {
    // v4.8 PR2a Task 1 fix-wave (coordinator review): the class this task
    // exists for — mirrors run-stages.test.js's/run-retry.test.js's SL-2
    // retry-seam fixtures. Full bench is a TWIN ['deepseek','deepseek']; only
    // the SECOND twin (deepseek#2) lost its seat on the first wave and
    // retries. The retry wave's launch roster is that ONE seat alone — slot 1
    // — even though deepseek#2 was slot 2 in the full bench. Seat IDENTITY
    // still comes from the FULL bench (buildSeats needs both twins to know
    // '#2' is the right id); only the LAUNCH ROSTER passed to bindSeats
    // (seats.js:93-96) is the one-seat retry subset.
    const fullSeats = buildSeats(['deepseek', 'deepseek'], null, null); // ids: deepseek#1, deepseek#2
    const retryRoster = fullSeats.filter(s => s.id === 'deepseek#2');
    const retryWaveId = 'abc123-s1r1';
    const legs = [mkLeg('deepseek', 'review by deepseek#2 (on retry)', 'complete', retryWaveId, 1)];

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(retryWaveId); }
    });

    test('bindSeats(retryWaveId, retryRoster, legs): full clean bind, no unbound, no orphans', () => {
      const { bound, unbound, orphanLegs } = bindSeats(retryWaveId, retryRoster, legs);
      expect(bound).toHaveLength(retryRoster.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
      // slot 1 in the ONE-SEAT retry roster resolves to deepseek#2 — proof the
      // retry-roster's own position, not the full bench's position, is what binds.
      expect(bound[0].seat.id).toBe('deepseek#2');
      // Correspondence (fix-wave item 1): trivial at a one-seat roster (only
      // one possible pairing exists), kept here for consistency across every
      // bind case in this file — see the two-seat twin retry describe below
      // for the retry case where this check actually has teeth.
      expect(bound[0].seat.alias).toBe(bound[0].leg.modelInput || bound[0].leg.model);
    });
  });

  describe('retry wave (abc123-s1r2): a two-seat twin roster where BOTH twins retried — position is the only discriminator', () => {
    // Fix-wave item 4: the one-seat retry describe above cannot tell
    // position-binding apart from alias-binding — seats.js:141-145's alias
    // fallback fires whenever the alias holds EXACTLY ONE seat in the
    // roster, which a one-seat roster satisfies trivially even when the
    // taskId slot itself is wrong. Retrying BOTH twins forces every leg
    // through resolution order 1 alone: roster.filter(s => s.alias ===
    // 'deepseek') has length 2 here, so the fallback's `hits.length === 1`
    // guard can never fire for either leg — this is the only bench shape in
    // this file where a mis-stamped slot cannot be silently rescued by the
    // alias path.
    const fullSeats = buildSeats(['deepseek', 'deepseek'], null, null); // ids: deepseek#1, deepseek#2
    const retryRoster = fullSeats; // both twins lost their seat and retry together
    const retryWaveId = 'abc123-s1r2';
    const legs = retryRoster.map((s, i) => mkLeg('deepseek', `retry review #${i + 1}`, 'complete', retryWaveId, i + 1));

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(retryWaveId); }
    });

    test('bindSeats(retryWaveId, retryRoster, legs): full clean bind, no unbound, no orphans, position correspondence holds', () => {
      const { bound, unbound, orphanLegs } = bindSeats(retryWaveId, retryRoster, legs);
      expect(bound).toHaveLength(retryRoster.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
      const ids = bound.map(b => b.seat.id).sort();
      expect(ids).toEqual(['deepseek#1', 'deepseek#2']);
      // Correspondence (item 1's twin technique, applied to a retry roster):
      // the leg's own `#N` summary suffix names the slot it was BUILT for;
      // it must match the `#N` suffix of the seat bindSeats actually
      // resolved it to. A slot swap here is caught purely by POSITION, since
      // (per the comment above) the alias fallback cannot rescue either leg.
      for (const { seat, leg } of bound) {
        const legSlot = leg.summary.match(/#(\d+)$/)[1];
        const seatSlot = seat.id.match(/#(\d+)$/)[1];
        expect(legSlot).toBe(seatSlot);
      }
    });
  });
});

// v4.8 PR2a Task 1 fix-wave (item 2): run-retry.test.js mirrors
// run-stages.test.js's leg shape only at the taskId/waveId fields — its OWN
// builders (mirrors run-retry.test.js:94-101, usableLeg/deadLeg) emit a
// DIFFERENT object shape entirely: {modelInput, status, summary|error,
// taskId, waveId} — no `model` field, no `usage`, no `durationMs`. bindSeats
// binds it today (seats.js:142 reads `leg.modelInput || leg.model`, and
// position-binding via taskId never inspects `model` at all), but nothing in
// this file pinned that shape before this block — exactly the suite the
// previous fix-wave caught being forgotten from this gate.
const mkRetryShapedLeg = (model, summary, waveId, slot) => ({
  modelInput: model, status: 'complete', summary,
  taskId: `${waveId}-${slot}`, waveId,
});

describe('seat-fixtures: run-retry.test.js-shaped legs (no model field, no usage) also bind (v4.8 PR2a Task 1 gate, item 2)', () => {
  describe('unique-alias bench', () => {
    const models = ['gemini', 'gpt', 'qwen'];
    const seats = buildSeats(models, null, null);
    const waveId = 'r1-s1r1';
    const legs = models.map((m, i) => mkRetryShapedLeg(m, `review by ${m}`, waveId, i + 1));

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(waveId); }
    });

    test('bindSeats(waveId, roster, legs): full clean bind, no unbound, no orphans, alias correspondence holds', () => {
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, legs);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
      expect(bound.map(b => b.seat.alias).sort()).toEqual(['gemini', 'gpt', 'qwen']);
      // Correspondence (item 1's assertion): the alias falls back to
      // `modelInput` since this shape carries no `model` field at all.
      expect(bound.every(b => b.seat.alias === (b.leg.modelInput || b.leg.model))).toBe(true);
    });
  });

  describe('twin bench (deepseek, deepseek)', () => {
    const models = ['deepseek', 'deepseek'];
    const seats = buildSeats(models, null, null); // ids: deepseek#1, deepseek#2
    const waveId = 'r1-s1r1';
    const legs = models.map((m, i) => mkRetryShapedLeg(m, `review by ${m} #${i + 1}`, waveId, i + 1));

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(waveId); }
    });

    test('bindSeats(waveId, roster, legs): full clean bind, distinct seats, position correspondence holds', () => {
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, legs);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
      const ids = bound.map(b => b.seat.id).sort();
      expect(ids).toEqual(['deepseek#1', 'deepseek#2']);
      // Twin correspondence (item 1): alias equality is useless here — both
      // twin legs share alias 'deepseek'. Compare the leg's own `#N` summary
      // suffix (its intended slot) against the `#N` suffix bindSeats
      // actually resolved it to.
      for (const { seat, leg } of bound) {
        const legSlot = leg.summary.match(/#(\d+)$/)[1];
        const seatSlot = seat.id.match(/#(\d+)$/)[1];
        expect(legSlot).toBe(seatSlot);
      }
    });
  });
});

// v4.8 PR2b Task 0 Step 9: proof that run-stages.test.js's OWN fixture shape
// (mkLeg's post-Task-1 `${waveId}-${slot}` taskId, one leg per roster model,
// in order) binds one-to-one against a twin-bearing roster — the exact shape
// every runStage1 driver this task touched now produces.
test('run-stages fixture legs bind one-to-one with their wave roster', () => {
  const roster = buildSeats(['deepseek', 'deepseek', 'gpt'], null, null);
  const legs = roster.map((s, i) => ({ modelInput: s.alias, status: 'complete',
    summary: 'x', taskId: `abc123-s1-${i + 1}`, waveId: 'abc123-s1' }));
  for (const leg of legs) { expect(leg.waveId).toBe('abc123-s1'); }   // BEFORE binding
  const { bound, unbound, orphanLegs } = bindSeats('abc123-s1', roster, legs);
  expect(unbound).toEqual([]);
  expect(orphanLegs).toEqual([]);
  // leg <-> seat CORRESPONDENCE. `expect(b.leg.taskId).toBe(`${waveId}-${b.seat.position}`)`
  // is a TAUTOLOGY of bindSeats' own rule — seats.js:139-140 CHOOSES the seat FROM
  // the taskId's slot number, so a slot SWAP satisfies it (verified). Compare
  // independently derived facts instead.
  const bySeat = new Map(bound.map(b => [b.seat.id, b.leg]));
  expect(bySeat.get('deepseek#1')).toBe(legs[0]);
  expect(bySeat.get('deepseek#2')).toBe(legs[1]);
  expect(bySeat.get('gpt')).toBe(legs[2]);
  // ...and prove the assertion bites:
  const swapped = [{ ...legs[0], taskId: 'abc123-s1-2' }, { ...legs[1], taskId: 'abc123-s1-1' }, legs[2]];
  const s = bindSeats('abc123-s1', roster, swapped);
  expect(new Map(s.bound.map(b => [b.seat.id, b.leg])).get('deepseek#1')).toBe(swapped[1]);
});
