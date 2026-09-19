// tests/council/run-retry-notes.test.js
'use strict';

/**
 * #256 item 2 — the still-dead note must name the RETRY's own cause.
 *
 * MEASURED (run 35143585179, 2026-09-16): glm and qwen died
 * `NO_OUTPUT_BACKSTOP` at 480 s, and their once-only retries were REFUSED by
 * OpenRouter two seconds later for want of credit. Two different deaths — and
 * `run.json`'s dead-leg prose rendered them as one:
 *
 *   the leg ended 'error': NO_OUTPUT_BACKSTOP … ; its once-only retry also ended 'error'
 *
 * A reader sees two backstop deaths. The retry's real reason was only ever in
 * `data.reason`, which the rendered note does not show.
 *
 * The rule: when the retry leg carries its own non-empty error AND it differs
 * from the first failure's reason, the `why` names it — in the same
 * `'<status>': <reason>` shape this module already uses for the first attempt.
 * When it is identical, empty or absent, the text is byte-identical to the
 * pre-#256 wording, because a sentence that repeats the same reason twice is
 * noise.
 */

// #257 added srcLegStillDeadNote and missingLegStillDeadNote — the other two
// still-dead builders that name the reasoning channel.
const { retryLegStillDeadNote, srcLegStillDeadNote, missingLegStillDeadNote }
  = require('../../src/council/run-retry-notes');

const COUNTS = { reviewed: 1, total: 3 };
const UNIT = { waveId: 'r1-s1r1' };
const note = (ff, retryLeg) => retryLegStillDeadNote('glm', ff, retryLeg, UNIT, COUNTS);

const BACKSTOP = 'NO_OUTPUT_BACKSTOP: model produced no output, reasoning, or tool calls in 480s';
const REFUSAL = 'This request would exceed your available credits given your current '
  + 'in-flight requests. Retry after in-flight requests settle, or add credits.';

describe('#256 retryLegStillDeadNote names the retry\'s own cause', () => {
  describe('the leg arm (a first LEG that died)', () => {
    const ff = { class: 'leg', status: 'error', reason: BACKSTOP };

    test('a DIFFERENT retry reason is named after the retry\'s status', () => {
      const n = note(ff, { status: 'error', error: REFUSAL });
      expect(n.channel).toBe('dead-leg');
      expect(n.why).toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
        + `its once-only retry also ended 'error': ${REFUSAL}`);
    });

    test('an IDENTICAL retry reason leaves the text byte-identical to the pre-#256 wording', () => {
      const n = note(ff, { status: 'error', error: BACKSTOP });
      expect(n.why).toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
        + 'its once-only retry also ended \'error\'');
    });

    /**
     * Council #264 r1 / C2 + D2. The comparison trimmed the RETRY's error but
     * not the first failure's reason, so the same reason arriving with
     * different whitespace compared unequal and got appended — the note then
     * printed one reason twice, which is exactly the byte-identity guarantee
     * this arm promises. Both sides are trimmed now.
     */
    test('the same reason with DIFFERENT whitespace is still the same reason', () => {
      for (const padded of [`  ${BACKSTOP}`, `${BACKSTOP}  `, `\n${BACKSTOP}\t`]) {
        const n = note({ class: 'leg', status: 'error', reason: padded },
          { status: 'error', error: BACKSTOP });
        expect(n.why).toBe(`the leg ended 'error': ${padded} with no usable output; `
          + 'its once-only retry also ended \'error\'');
        expect(n.why).not.toContain(`'error': ${BACKSTOP}`.replace("'error': ", "also ended 'error': "));
      }
    });

    /**
     * Council #264 r2 / A4 + C1 + D2 (three seats, independently). The comment
     * promised "each side's own original bytes; only the comparison is
     * normalised" while the retry cause was RENDERED from the trimmed string.
     * The promise was the right design — it is the code that was wrong.
     */
    test('a DIFFERING retry reason renders its ORIGINAL bytes, padding and all', () => {
      const padded = `\n  ${REFUSAL}  `;
      const n = note({ class: 'leg', status: 'error', reason: BACKSTOP },
        { status: 'error', error: padded });
      expect(n.why).toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
        + `its once-only retry also ended 'error': ${padded}`);
      // The note's `why` and its machine-readable `data.reason` now carry the
      // same bytes — they used to disagree.
      expect(n.data.reason).toBe(padded);
      expect(n.why).toContain(n.data.reason);
    });

    test('a padded retry error matched against a padded first reason is still suppressed', () => {
      const n = note({ class: 'leg', status: 'error', reason: `  ${BACKSTOP}  ` },
        { status: 'error', error: `\t${BACKSTOP}\n` });
      expect(n.why.endsWith("its once-only retry also ended 'error'")).toBe(true);
    });

    test('an empty, whitespace-only, null or absent retry error leaves the text unchanged', () => {
      const expected = `the leg ended 'error': ${BACKSTOP} with no usable output; `
        + 'its once-only retry also ended \'timeout\'';
      for (const error of ['', '   ', null, undefined, 0, {}]) {
        expect(note(ff, { status: 'timeout', error }).why).toBe(expected);
      }
    });

    test('the retry reason still rides on data.reason, unchanged', () => {
      const n = note(ff, { status: 'error', error: REFUSAL });
      expect(n.data).toMatchObject({ seat: 'glm', status: 'error', reason: REFUSAL,
        firstFailure: ff, retryWaveId: 'r1-s1r1' });
    });
  });

  describe('the wave arm (the first WAVE produced no legs) — same class of defect, same cure', () => {
    const ff = { class: 'wave', waveId: 'r1-s1', reason: 'no legs produced' };

    test('a DIFFERENT retry reason is named', () => {
      const n = note(ff, { status: 'error', error: REFUSAL });
      expect(n.channel).toBe('dead-leg');
      expect(n.why).toBe('its first wave r1-s1 produced no legs (no legs produced); '
        + `its once-only retry leg ended 'error': ${REFUSAL} with no usable output`);
    });

    test('an identical or absent retry reason leaves the text unchanged', () => {
      expect(note(ff, { status: 'error', error: 'no legs produced' }).why)
        .toBe('its first wave r1-s1 produced no legs (no legs produced); '
          + "its once-only retry leg ended 'error' with no usable output");
      expect(note(ff, { status: 'error', error: null }).why)
        .toBe('its first wave r1-s1 produced no legs (no legs produced); '
          + "its once-only retry leg ended 'error' with no usable output");
    });
  });

  describe('the missing arm (the seat was never bound in the first wave)', () => {
    const ff = { class: 'missing', waveId: 'r1-s1', reason: 'no leg returned' };

    test('a DIFFERENT retry reason is named, and the channel stays seat-unbound', () => {
      const n = note(ff, { status: 'error', error: REFUSAL });
      expect(n.channel).toBe('seat-unbound');
      expect(n.why).toBe('no leg returned in wave r1-s1; its once-only retry leg ended '
        + `'error': ${REFUSAL} with no usable output`);
    });

    test('an absent retry reason leaves the text unchanged', () => {
      expect(note(ff, { status: 'error', error: undefined }).why)
        .toBe('no leg returned in wave r1-s1; its once-only retry leg ended '
          + "'error' with no usable output");
    });
  });

  test('a missing first failure still renders, and the retry cause still lands', () => {
    // `ff` is undefined only on paths that lost the first-failure record; the
    // pre-#256 text reported "ended 'unknown'" there and must keep doing so.
    const n = note(undefined, { status: 'error', error: REFUSAL });
    expect(n.why).toBe('the leg ended \'unknown\' with no usable output; '
      + `its once-only retry also ended 'error': ${REFUSAL}`);
  });
});

/**
 * #257 — every still-dead announcement names the reasoning channel.
 *
 * A leg whose engine answer had no text part has its REASONING promoted to
 * output (headless.js mints `promoted: true` off `mirror.promotedOutput`), so
 * it arrives here `complete` with text and no error at all. The pre-#257
 * sentence then read "the leg ended 'complete' with no usable output" and
 * stopped — true, and useless: nothing said the model had in fact answered, in
 * the wrong channel. One shared clause builder (`./promoted ::
 * reasoningOnlyClause`) supplies the missing half, in the SAME position in all
 * three builders: immediately after "with no usable output".
 *
 * ⚠️ BYTE-IDENTITY is the contract: the clause is the EMPTY STRING for any leg
 * that is not promoted, so every pin above this block — and every pin in
 * run-retry.test.js, run-stages.test.js and degrade-contract.test.js — is
 * untouched. The non-promoted halves below are that guarantee stated as tests.
 */
describe('#257 the still-dead notes name the reasoning channel', () => {
  const PROMOTED = { reasoning: 40332, output: 1, finish: 'stop' };
  const CLAUSE = ' — it answered only in its reasoning channel '
    + "(40332 reasoning / 1 output tokens, finish 'stop'), which is not a review";
  // A real promoted leg document: `complete`, carrying its deliberation as text,
  // with NO error — the shape `promotedFacts` reads its numbers off.
  const promotedLeg = () => ({ modelInput: 'glm', status: 'complete',
    summary: 'Let me carefully analyze the diff before I answer.',
    promoted: true, finish: 'stop', usage: { tokens: { reasoning: 40332, output: 1 } } });
  const plainLeg = () => ({ modelInput: 'glm', status: 'error', error: 'boom' });

  describe('srcLegStillDeadNote (the retry WAVE produced no legs)', () => {
    test('a promoted first leg gets the clause right after "with no usable output"', () => {
      const n = srcLegStillDeadNote(promotedLeg(), UNIT, COUNTS);
      expect(n.channel).toBe('dead-leg');
      expect(n.why).toBe(`the leg ended 'complete' with no usable output${CLAUSE}; `
        + 'its once-only retry wave produced no legs');
    });

    test('a leg that is NOT promoted is byte-identical to the pre-#257 wording', () => {
      expect(srcLegStillDeadNote(plainLeg(), UNIT, COUNTS).why)
        .toBe("the leg ended 'error': boom with no usable output; "
          + 'its once-only retry wave produced no legs');
    });
  });

  describe('retryLegStillDeadNote (the retry leg came back unusable)', () => {
    const ffPromoted = { class: 'leg', status: 'complete', reason: null, promoted: PROMOTED };
    const ffPlain = { class: 'leg', status: 'error', reason: BACKSTOP };

    test('the FIRST leg was promoted: the clause rides the first half only', () => {
      const n = note(ffPromoted, { status: 'timeout', error: null });
      expect(n.why).toBe(`the leg ended 'complete' with no usable output${CLAUSE}; `
        + "its once-only retry also ended 'timeout'");
    });

    test('the RETRY leg was promoted: the clause rides the second half only', () => {
      const n = note(ffPlain, promotedLeg());
      expect(n.why).toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
        + `its once-only retry also ended 'complete'${CLAUSE}`);
    });

    test('BOTH legs were promoted: the clause appears twice, once per attempt', () => {
      const n = note(ffPromoted, promotedLeg());
      expect(n.why).toBe(`the leg ended 'complete' with no usable output${CLAUSE}; `
        + `its once-only retry also ended 'complete'${CLAUSE}`);
      expect(n.why.split(CLAUSE)).toHaveLength(3);
    });

    test('the WAVE arm: a promoted retry leg is named there too', () => {
      const n = note({ class: 'wave', waveId: 'r1-s1', reason: 'no legs produced' }, promotedLeg());
      expect(n.why).toBe('its first wave r1-s1 produced no legs (no legs produced); '
        + `its once-only retry leg ended 'complete' with no usable output${CLAUSE}`);
    });

    test('the MISSING arm: a promoted retry leg is named, and the channel stays seat-unbound', () => {
      const n = note({ class: 'missing', waveId: 'r1-s1', reason: 'no leg returned' }, promotedLeg());
      expect(n.channel).toBe('seat-unbound');
      expect(n.why).toBe('no leg returned in wave r1-s1; its once-only retry leg ended '
        + `'complete' with no usable output${CLAUSE}`);
    });

    test('neither leg promoted: byte-identical to the pre-#257 wording', () => {
      expect(note(ffPlain, { status: 'timeout', error: null }).why)
        .toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
          + "its once-only retry also ended 'timeout'");
    });
  });

  describe('missingLegStillDeadNote (the retry returned no leg for this seat)', () => {
    test('a promoted first failure gets the clause after "with no usable output"', () => {
      const ff = { class: 'leg', status: 'complete', reason: null, promoted: PROMOTED };
      const n = missingLegStillDeadNote('glm', ff, UNIT, COUNTS);
      expect(n.channel).toBe('dead-leg');
      expect(n.why).toBe(`the leg ended 'complete' with no usable output${CLAUSE}; `
        + 'its once-only retry produced no leg for this seat');
    });

    test('a first failure that is NOT promoted is byte-identical to the pre-#257 wording', () => {
      const ff = { class: 'leg', status: 'error', reason: BACKSTOP };
      expect(missingLegStillDeadNote('glm', ff, UNIT, COUNTS).why)
        .toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
          + 'its once-only retry produced no leg for this seat');
    });
  });
});

/**
 * #257 R-X14 — the reasoning-channel facts ride `data` too, not just the prose.
 *
 * `verdict-seat-loss.js :: deriveSeatLoss` reads ONLY `record.data` (never the
 * prose fields) and renders `seatLoss.reason` into verdict.json. On the srcLeg
 * arm that surface was blind: a promoted leg has no `error`, so `data.reason` is
 * null and `data.status` is 'complete', and that arm carries no `firstFailure`
 * for a consumer to read the fact off. A promoted CRITIC therefore reached
 * verdict.json as the bare, true and uninformative "ended 'complete' with no
 * usable output". These pin the machine surface at the producer.
 *
 * Emit-when-promoted: a record for a leg that is not promoted carries NO
 * `promoted` key at all — never `null`, never `false` — so every existing
 * exact-shape assertion on these `data` objects is untouched.
 *
 * Named mutant DATAPROMOTEDDROPPED: delete `...(pf ? { promoted: pf } : {})`
 * from `srcLegStillDeadNote`'s `data`. Red set: the first test below.
 */
describe('#257 R-X14 the still-dead notes carry the facts on data.promoted', () => {
  const PROMOTED = { reasoning: 40332, output: 1, finish: 'stop' };
  const promotedLeg = () => ({ modelInput: 'glm', status: 'complete',
    summary: 'Let me carefully analyze the diff before I answer.',
    promoted: true, finish: 'stop', usage: { tokens: { reasoning: 40332, output: 1 } } });
  const plainLeg = () => ({ modelInput: 'glm', status: 'error', error: 'boom' });

  test('srcLegStillDeadNote: a promoted leg puts its facts on data.promoted', () => {
    const n = srcLegStillDeadNote(promotedLeg(), UNIT, COUNTS);
    expect(n.data.promoted).toEqual(PROMOTED);
    // The surface deriveSeatLoss actually reads, and why it was blind without it.
    expect(n.data.reason).toBeNull();
    expect(n.data.status).toBe('complete');
  });

  test('srcLegStillDeadNote: a leg that is NOT promoted carries no promoted key at all', () => {
    const n = srcLegStillDeadNote(plainLeg(), UNIT, COUNTS);
    expect('promoted' in n.data).toBe(false);
    expect(n.data).toEqual({ seat: 'glm', seatId: null, status: 'error', reason: 'boom',
      retryWaveId: 'r1-s1r1' });
  });

  test('retryLegStillDeadNote: data.promoted is the RETRY leg\'s facts (the first leg\'s ride on data.firstFailure.promoted)', () => {
    const ff = { class: 'leg', status: 'complete', reason: null, promoted: PROMOTED };
    const n = note(ff, promotedLeg());
    expect(n.data.promoted).toEqual(PROMOTED);              // the retry leg's
    expect(n.data.firstFailure.promoted).toEqual(PROMOTED); // the first leg's
  });

  test('retryLegStillDeadNote: a non-promoted retry leg carries no promoted key', () => {
    const n = note({ class: 'leg', status: 'error', reason: BACKSTOP }, { status: 'timeout', error: null });
    expect('promoted' in n.data).toBe(false);
  });

  test('missingLegStillDeadNote: data.promoted restates the FIRST failure\'s facts (there is no retry leg)', () => {
    const ff = { class: 'leg', status: 'complete', reason: null, promoted: PROMOTED };
    const n = missingLegStillDeadNote('glm', ff, UNIT, COUNTS);
    expect(n.data.promoted).toEqual(PROMOTED);
    expect(n.data.status).toBeNull();
  });

  test('missingLegStillDeadNote: a non-promoted first failure carries no promoted key', () => {
    const ff = { class: 'leg', status: 'error', reason: BACKSTOP };
    expect('promoted' in missingLegStillDeadNote('glm', ff, UNIT, COUNTS).data).toBe(false);
  });
});
