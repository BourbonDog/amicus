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
        // #257 R-X38: the SUPPRESSION is what this test is about and it is unchanged. The
        // first failure's reason now renders through the house sanitizer, so the padding
        // that used to ride into the sentence (and the `\n` that broke it in two) is gone.
        expect(n.why).toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
          + 'its once-only retry also ended \'error\'');
        expect(n.why).not.toContain(`'error': ${BACKSTOP}`.replace("'error': ", "also ended 'error': "));
      }
    });

    /**
     * Council #264 r2 / A4 + C1 + D2 (three seats, independently). The comment
     * promised "each side's own original bytes; only the comparison is
     * normalised" while the retry cause was RENDERED from the trimmed string —
     * the prose and `data.reason` then disagreed about the same error.
     *
     * #257 R-X38 SUPERSEDES the "padding and all" half: the rendered cause is the
     * retry leg's OWN error run through the house sanitizer (`collapseExcerpt` at
     * `run-retry-notes.js :: MAX_LEG_ERROR_CHARS`) — the same SANITIZER the Stage-2
     * judge-death prose runs its own leg error through, at a different cap (that one
     * still carries a bare literal 200; the divergence is filed, not fixed here). What
     * survives whole is the substance of r2 — the prose names the RETRY's error,
     * never the first failure's, and `data.reason` still carries the raw bytes.
     */
    test('a DIFFERING retry reason is rendered from its OWN error, bounded, while data.reason stays raw', () => {
      const padded = `\n  ${REFUSAL}  `;
      const n = note({ class: 'leg', status: 'error', reason: BACKSTOP },
        { status: 'error', error: padded });
      expect(n.why).toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
        + `its once-only retry also ended 'error': ${REFUSAL}`);
      // The machine surface is untouched by the bound: raw bytes, padding and all.
      expect(n.data.reason).toBe(padded);
      // Prose and data still name the SAME error — a bounded quotation of it.
      expect(n.data.reason).toContain(REFUSAL);
      // The #264 r1 guarantee, stated as a COUNT: the first failure's reason appears
      // exactly once. (The old negative — the two strings adjacent — could never fire:
      // they are always separated by " with no usable output; its once-only retry…".)
      expect(n.why.split(BACKSTOP).length - 1).toBe(1);
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

/**
 * #257 R-X38 — the still-dead PROSE bounds the provider's error; the machine fields do not.
 *
 * Every `why` in this module quotes a PROVIDER-controlled string into a sentence that
 * reaches stderr (`Notice:` lines), run.json and report.md (`utils/degrade.js ::
 * formatDegrade` renders each record as a Markdown list item). The Stage-2 judge-death
 * prose has carried `collapseExcerpt(leg.error, …)` since #219; these sites carried the
 * raw string, so one provider could put ANSI colour, a bidi override or 900 characters of
 * stack into a council announcement. Same function, one dialect — at the council's own
 * cap, `run-retry-notes.js :: MAX_LEG_ERROR_CHARS`, whose ruling the next block pins.
 *
 * `collapseExcerpt` is the IDENTITY on a short, single-line, clean string, so every pin
 * above this block whose fixture is an ordinary error string is byte-identical.
 *
 * The expected text is written out in full rather than computed with the sanitizer — a
 * test that builds its expectation from the function under test pins nothing.
 *
 * Named mutant "RETRYPROSERAW": drop `collapseExcerpt(...)` from `srcLegStillDeadNote`'s
 * `why`. Red set: the srcLeg test below. Its run-stages.js twin is "DEADLEGPROSERAW"
 * (tests/council/run-stages.test.js).
 */
describe('#257 R-X38 the still-dead prose bounds the provider error; data stays raw', () => {
  const { MAX_LEG_ERROR_CHARS } = require('../../src/council/run-retry-notes');
  // One `\n`, an ANSI sequence, and well past MAX_LEG_ERROR_CHARS.
  const ESC = String.fromCharCode(27);   // a real escape byte, without a raw control char in this source
  const HOSTILE = `${ESC}[31mPROVIDER_ERROR: upstream refused${ESC}[0m\nsecond line\n${'y'.repeat(900)}`;
  // What a reader must see: one line, no escapes, MAX_LEG_ERROR_CHARS ending in an ellipsis.
  const BOUND = `PROVIDER_ERROR: upstream refused second line ${'y'.repeat(754)}…`;

  test('the fixture is hostile and the expectation is bounded (non-vacuity)', () => {
    expect(HOSTILE).toContain('\n');
    expect(HOSTILE).toContain(`${ESC}[`);
    expect(HOSTILE.length).toBeGreaterThan(900);
    expect(BOUND).toHaveLength(MAX_LEG_ERROR_CHARS);
    expect(BOUND).not.toContain('\n');
    expect(BOUND).not.toContain(ESC);
  });

  test('srcLegStillDeadNote: the why is bounded, data.reason is the raw string', () => {
    const n = srcLegStillDeadNote({ modelInput: 'glm', status: 'error', error: HOSTILE },
      UNIT, COUNTS);
    expect(n.why).toBe(`the leg ended 'error': ${BOUND} with no usable output; `
      + 'its once-only retry wave produced no legs');
    expect(n.data.reason).toBe(HOSTILE);
  });

  test('retryLegStillDeadNote, the RETRY leg\'s error: bounded in the why, raw on data.reason', () => {
    const n = note({ class: 'leg', status: 'error', reason: BACKSTOP },
      { status: 'error', error: HOSTILE });
    expect(n.why).toBe(`the leg ended 'error': ${BACKSTOP} with no usable output; `
      + `its once-only retry also ended 'error': ${BOUND}`);
    expect(n.data.reason).toBe(HOSTILE);
  });

  test('retryLegStillDeadNote, the FIRST failure\'s reason: bounded in the why, raw on data.firstFailure', () => {
    // `ff.reason` on the LEG arm is minted from the first leg's own `leg.error`
    // (run-retry-group.js :: recordFailure), so it is provider text too.
    const ff = { class: 'leg', status: 'error', reason: HOSTILE };
    const n = note(ff, { status: 'timeout', error: null });
    expect(n.why).toBe(`the leg ended 'error': ${BOUND} with no usable output; `
      + "its once-only retry also ended 'timeout'");
    expect(n.data.firstFailure.reason).toBe(HOSTILE);
  });

  test('missingLegStillDeadNote, the FIRST failure\'s reason: bounded in the why, raw on data.firstFailure', () => {
    const ff = { class: 'leg', status: 'error', reason: HOSTILE };
    const n = missingLegStillDeadNote('glm', ff, UNIT, COUNTS);
    expect(n.why).toBe(`the leg ended 'error': ${BOUND} with no usable output; `
      + 'its once-only retry produced no leg for this seat');
    expect(n.data.firstFailure.reason).toBe(HOSTILE);
  });
});

/**
 * #257 R-X42 — EVERY arm bounds its reason, not only the leg arm.
 *
 * Council round 4 (run 35476684772), A1 (glm, Confirmed 3-0) and chair HQ3: the R-X38
 * sweep bounded the LEG arm of each builder and left the wave-class and missing-class
 * arms interpolating `ff.reason` raw, while this module's own header asserts that every
 * `why` is bounded. An inconsistent invariant is worse than none — a reader who trusts
 * the header stops checking.
 *
 * One exported helper, `boundReason`, is now the SINGLE spelling at every prose site
 * (`waveStillDeadNote`, `skippedWaveNote`, and the wave / missing / leg arms of both
 * still-dead builders). `data.*` keeps the RAW bytes — machine surface, not a sentence.
 *
 * Named mutants: "WAVEARMRAW" and "MISSINGARMRAW" (run-retry-notes.js, here);
 * "HEALARMRAW" (run-retry.js, pinned in tests/council/run-retry.test.js).
 */
describe('#257 R-X42 every retry-note arm bounds its reason; data stays raw', () => {
  const { waveStillDeadNote, skippedWaveNote, boundReason, MAX_LEG_ERROR_CHARS }
    = require('../../src/council/run-retry-notes');
  // Same hostile shape the R-X38 block uses: one ANSI sequence, two newlines, well past the cap.
  const ESC2 = String.fromCharCode(27);
  const RAW = `${ESC2}[31mPROVIDER_ERROR: upstream refused${ESC2}[0m\nsecond line\n${'y'.repeat(900)}`;
  const OK = `PROVIDER_ERROR: upstream refused second line ${'y'.repeat(754)}…`;

  test('the fixture is hostile, the expectation is bounded, and boundReason is the cap (non-vacuity)', () => {
    expect(RAW).toContain('\n');
    expect(RAW).toContain(`${ESC2}[`);
    expect(RAW.length).toBeGreaterThan(900);
    expect(OK).toHaveLength(MAX_LEG_ERROR_CHARS);
    expect(OK).not.toContain('\n');
    expect(OK).not.toContain(ESC2);
    expect(boundReason(RAW)).toBe(OK);
  });

  test('waveStillDeadNote: the why is bounded, data.reason is the raw string', () => {
    const w = { waveId: 'r1-s1', models: ['glm', 'qwen'], reason: RAW };
    const n = waveStillDeadNote(w, UNIT);
    expect(n.why).toBe(`${OK}; the once-only retry wave also produced no legs`);
    expect(n.data.reason).toBe(RAW);
  });

  test('MINOR-7c survives the bound: a falsy reason still reads "no reason recorded"', () => {
    // collapseExcerpt(null) and collapseExcerpt('') both yield '', so the `||` fallback holds.
    for (const reason of [null, undefined, '']) {
      expect(waveStillDeadNote({ waveId: 'r1-s1', models: ['glm'], reason }, UNIT).why)
        .toBe('no reason recorded; the once-only retry wave also produced no legs');
    }
  });

  test('skippedWaveNote: the why IS the reason, so it is bounded; data.reason is raw', () => {
    const n = skippedWaveNote({ waveId: 'r1-s1', models: ['glm'], reason: RAW });
    expect(n.why).toBe(OK);
    expect(n.data.reason).toBe(RAW);
  });

  // Round-1 ruling 2: bounding an absent reason yields '', and makeDegrade rejects a blank
  // `why` — so this arm takes the SAME MINOR-7c fallback the dead-wave arm has always had.
  // Never `why: ''`, and never the literal string "undefined" either.
  test('skippedWaveNote: a falsy reason reads "no reason recorded", never an empty why', () => {
    for (const reason of [null, undefined, '', '   ']) {
      expect(skippedWaveNote({ waveId: 'r1-s1', models: ['glm'], reason }).why)
        .toBe('no reason recorded');
    }
  });

  test('retryLegStillDeadNote, the WAVE arm: bounded in the why, raw on data.firstFailure', () => {
    const ff = { class: 'wave', waveId: 'r1-s1', reason: RAW };
    const n = note(ff, { status: 'timeout', error: null });
    expect(n.why).toBe(`its first wave r1-s1 produced no legs (${OK}); `
      + "its once-only retry leg ended 'timeout' with no usable output");
    expect(n.data.firstFailure.reason).toBe(RAW);
  });

  test('retryLegStillDeadNote, the MISSING arm: bounded in the why, raw on data.firstFailure', () => {
    const ff = { class: 'missing', waveId: 'r1-s1', reason: RAW };
    const n = note(ff, { status: 'timeout', error: null });
    expect(n.why).toBe(`${OK} in wave r1-s1; its once-only retry leg ended `
      + "'timeout' with no usable output");
    expect(n.data.firstFailure.reason).toBe(RAW);
  });

  test('missingLegStillDeadNote, the WAVE arm: bounded in the why, raw on data.firstFailure', () => {
    const ff = { class: 'wave', waveId: 'r1-s1', reason: RAW };
    const n = missingLegStillDeadNote('glm', ff, UNIT, COUNTS);
    expect(n.why).toBe(`its first wave r1-s1 produced no legs (${OK}); `
      + 'its once-only retry produced no leg for this seat');
    expect(n.data.firstFailure.reason).toBe(RAW);
  });

  test('missingLegStillDeadNote, the MISSING arm: bounded in the why, raw on data.firstFailure', () => {
    const ff = { class: 'missing', waveId: 'r1-s1', reason: RAW };
    const n = missingLegStillDeadNote('glm', ff, UNIT, COUNTS);
    expect(n.why).toBe(`${OK} in wave r1-s1; its once-only retry produced no leg for this seat`);
    expect(n.data.firstFailure.reason).toBe(RAW);
  });

  test('the header\'s invariant now holds: no why in any arm carries a newline or an escape', () => {
    const ff = { class: 'wave', waveId: 'r1-s1', reason: RAW };
    const whys = [
      waveStillDeadNote({ waveId: 'r1-s1', models: ['glm'], reason: RAW }, UNIT).why,
      skippedWaveNote({ waveId: 'r1-s1', models: ['glm'], reason: RAW }).why,
      note(ff, { status: 'timeout', error: null }).why,
      note({ ...ff, class: 'missing' }, { status: 'timeout', error: null }).why,
      missingLegStillDeadNote('glm', ff, UNIT, COUNTS).why,
      missingLegStillDeadNote('glm', { ...ff, class: 'missing' }, UNIT, COUNTS).why,
    ];
    for (const why of whys) {
      expect(why).not.toContain('\n');
      expect(why).not.toContain(ESC2);
      expect(why).not.toContain('y'.repeat(MAX_LEG_ERROR_CHARS));
    }
  });
});

/**
 * #257 R-X38 fix round 1 — THE CAP NEVER TRUNCATES A REASON AMICUS ITSELF MINTED.
 *
 * THE RULING (owner, round 3): the cap exists to bound PROVIDER noise. A reason amicus
 * mints is the product's own self-diagnosis and must arrive WHOLE — the round-3 review
 * caught the 200-char cap eating `formatOutputLengthReason`'s remedy ("raise outputBudget
 * in config.json (docs/configuration.md, Output budget)"), which is the sentence the
 * whole `OUTPUT_LENGTH:` death exists to deliver.
 *
 * This pin mints through the REAL formatters — never a copied literal, which is how a cap
 * and a format drift apart in the first place — and asserts the cap is the IDENTITY on
 * each: nothing truncated, and nothing altered either (a minted reason is already one
 * clean line, so any change at all would be the sanitizer rewriting our own words).
 *
 * `utils/no-output-backstop.js` exports the window/extension machinery but NOT the message
 * — the NO_OUTPUT_BACKSTOP reason is minted by `headless.js :: formatNoOutputBackstopReason`
 * (exported for exactly this kind of assertion), so that is what is called here.
 *
 * RE-MEASURED 2026-09-19, round 4, with the exact inputs below — every row re-run, longest
 * first: 620 and 620 (`formatOutputLengthReason`, budget unset + a 96-char PLAIN ambient
 * flag, and the same with a 500-char one: R-X43 caps the quote, so they are the SAME
 * length), 605 (a 96-char NON-plain flag), 518 (the backstop, caller-set + extended + every
 * clause — the same shape reads 505 with a `sessionStatus` of `idle`, which is the row
 * ABOVE it plus an extension, not this one), 517 (budget unset + a non-plain ambient flag),
 * 438 (the plain ambient flag), 398 (the backstop with engine log + skew + session, NOT
 * extended). The four round-3 rows are UNMOVED by R-X44's not-reported change because each
 * passes explicit TOKENS. The fix brief proposed a 400 cap; this corpus REFUTES it, and the
 * non-vacuity test below states that refutation as an assertion rather than as a comment.
 *
 * THE RULING TEXT CHANGED WITH R-X43. Until round 4 the operator's ambient
 * `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` was interpolated verbatim, so the longest minted
 * reason was operator-controlled and this corpus was a TRIPWIRE ON DRIFT, not a bound. The
 * flag is now quoted through `safeFragment` (≤ 96 chars), the budget through
 * `outputTokenFlagValue`, and the counts are numbers — so every variable part of that
 * sentence is bounded and the cap clears a COMPUTABLE bound, not a sample. 620 is the longest
 * PINNED row; the SUPREMUM over all legal inputs is 627, MEASURED with pathological finite
 * counts (a JS number's decimal form caps at 24 chars — `-1.7976931348623157e+308`), which is
 * 173 under the cap. A `1e308` budget row measures 576, well inside. The three 96/500-char rows
 * below are the realistic worst case; the non-vacuity test pins the supremum beside them, so the
 * docblock cannot claim a worst case that a legal input beats (council #270 r4 review, M3).
 *
 * Named mutant "MINTEDREASONTRUNCATED": set `MAX_LEG_ERROR_CHARS` to 200 (or to 400) —
 * the identity cases red.
 */
describe('#257 R-X38 the cap never truncates a reason amicus itself minted', () => {
  const { collapseExcerpt } = require('../../src/utils/text-sanitize');
  const { MAX_LEG_ERROR_CHARS } = require('../../src/council/run-retry-notes');
  const { formatOutputLengthReason } = require('../../src/utils/output-length');
  const { formatNoOutputBackstopReason } = require('../../src/headless');

  const TOKENS = { reasoning: 32000, output: 0 };
  const SKEW = { server: '1.17.3', installed: '1.18.15' };
  // The engine-log clause is ITSELF already bounded to 200 by the house sanitizer before it
  // reaches the reason (utils/engine-log.js), so this is the longest a real kill can carry.
  const LOG = collapseExcerpt('E'.repeat(400), 200);
  const EXTENSION = { extended: true, windowMs: 480000, extendedToMs: 912000,
    firedAtMs: 480000, status: 'busy' };

  const corpus = () => [
    ['OUTPUT_LENGTH: budget unreadable',
      formatOutputLengthReason({ tokens: TOKENS, budget: undefined, reasoningOnly: true, ambientFlag: null })],
    ['OUTPUT_LENGTH: a budget is set',
      formatOutputLengthReason({ tokens: TOKENS, budget: 64000, reasoningOnly: true, ambientFlag: null })],
    ['OUTPUT_LENGTH: unset, no ambient flag',
      formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: false, ambientFlag: null })],
    ['OUTPUT_LENGTH: unset, no ambient flag, reasoning-only',
      formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: null })],
    ['OUTPUT_LENGTH: unset + a PLAIN ambient flag',
      formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: '64000' })],
    ['OUTPUT_LENGTH: unset + a NON-PLAIN ambient flag 64000abc (517)',
      formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: '64000abc' })],
    // #257 R-X43: the operator flag is bounded at the formatter by `safeFragment`
    // (MAX_FRAGMENT_CHARS = 96), so these three are the WORST CASE, not a sample.
    ['OUTPUT_LENGTH: unset + a 96-char NON-PLAIN ambient flag (worst case, quoted once)',
      formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: 'a'.repeat(96) })],
    ['OUTPUT_LENGTH: unset + a 96-digit PLAIN ambient flag (worst case, quoted TWICE)',
      formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: '9'.repeat(96) })],
    ['OUTPUT_LENGTH: unset + a 500-char PLAIN ambient flag — the quote is still 96',
      formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: '9'.repeat(500) })],
    ['NO_OUTPUT_BACKSTOP: the plain env-window kill',
      formatNoOutputBackstopReason({ ms: 480000, fromEnv: true })],
    ['NO_OUTPUT_BACKSTOP: + engine log + skew + session status',
      formatNoOutputBackstopReason({ ms: 480000, fromEnv: true, engineLogExcerpt: LOG,
        engineSkew: SKEW, sessionStatus: { type: 'idle' } })],
    ['NO_OUTPUT_BACKSTOP: caller-set, extended, every clause (the longest BACKSTOP reason, 518)',
      formatNoOutputBackstopReason({ ms: 912000, fromEnv: false, engineLogExcerpt: LOG,
        engineSkew: SKEW, sessionStatus: { type: 'retry_after_error' }, extension: EXTENSION })],
  ];

  test.each(corpus())('%s passes the cap WHOLE', (_name, reason) => {
    expect(typeof reason).toBe('string');
    expect(collapseExcerpt(reason, MAX_LEG_ERROR_CHARS)).toBe(reason);
  });

  test('the corpus is NOT vacuous: it exceeds 400, and the cap still clears it', () => {
    const lengths = corpus().map(([, r]) => r.length);
    // If every minted reason were short, the identity assertions above would hold under any
    // cap and would pin nothing. They do not: three of them are longer than 400.
    expect(lengths.filter((n) => n > 400).length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(MAX_LEG_ERROR_CHARS);
  });

  /**
   * #257 R-X43 — the cap now clears a COMPUTABLE bound, not a sample.
   *
   * Before this fix the longest `OUTPUT_LENGTH` reason was operator-controlled: the
   * ambient `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` was interpolated verbatim (twice on
   * the plain arm), so no finite cap could be a proof and the corpus above was a tripwire
   * on drift. `formatOutputLengthReason` now runs the flag through `safeFragment`
   * (MAX_FRAGMENT_CHARS = 96) BEFORE quoting it, so every variable part of that sentence
   * is bounded and the longest reason it can mint is a number, measured here.
   *
   * The SUPREMUM is asserted too, not just the pinned rows (council #270 r4 review, M3): the
   * counts are the one remaining variable, and a JS number's decimal form is itself bounded,
   * so the pathological row below is the true maximum over all legal inputs.
   */
  test('R-X43: an operator flag of ANY length is quoted bounded — the cap is a theorem now', () => {
    const { MAX_FRAGMENT_CHARS } = require('../../src/utils/text-sanitize');
    const mint = (ambientFlag) => formatOutputLengthReason({ tokens: TOKENS, budget: null,
      reasoningOnly: true, ambientFlag });
    const huge = mint('9'.repeat(500));
    const exact = mint('9'.repeat(MAX_FRAGMENT_CHARS));
    // The quote is truncated to the fragment cap, ellipsis included — never 97 digits.
    expect(huge).toContain(`${'9'.repeat(MAX_FRAGMENT_CHARS - 1)}…`);
    expect(huge).not.toContain('9'.repeat(MAX_FRAGMENT_CHARS + 1));
    // A 500-char flag and a 96-char flag mint the SAME length: the quote is capped, so the
    // operator cannot push the reason past the cap however long the env var is.
    expect(huge).toHaveLength(exact.length);
    for (const s of [huge, exact, mint('a'.repeat(96))]) {
      expect(s.length).toBeLessThanOrEqual(MAX_LEG_ERROR_CHARS);
      expect(collapseExcerpt(s, MAX_LEG_ERROR_CHARS)).toBe(s);
    }
    // M3: the counts are the one variable the pinned rows do not stress. A JS number's decimal
    // form is bounded (`-1.7976931348623157e+308`, 24 chars), so this IS the supremum — and it
    // BEATS the pinned 620, which is why the docblocks name both numbers.
    const worst = formatOutputLengthReason({ tokens: { reasoning: 1e308, output: -1e308 },
      budget: null, reasoningOnly: true, ambientFlag: '9'.repeat(MAX_FRAGMENT_CHARS) });
    expect(worst.length).toBeGreaterThan(exact.length);
    expect(worst.length).toBeLessThanOrEqual(MAX_LEG_ERROR_CHARS);
    expect(collapseExcerpt(worst, MAX_LEG_ERROR_CHARS)).toBe(worst);
  });

  test('the REMEDY — the sentence the ruling exists for — survives the cap in the prose', () => {
    const REMEDY = 'raise outputBudget in config.json (docs/configuration.md, Output budget)';
    const reason = formatOutputLengthReason({ tokens: TOKENS, budget: null,
      reasoningOnly: true, ambientFlag: '64000abc' });
    expect(reason).toContain(REMEDY);                        // the formatter really ends in it
    // Not just the constant — the note a user actually reads.
    const n = srcLegStillDeadNote({ modelInput: 'glm', status: 'error', error: reason },
      UNIT, COUNTS);
    expect(n.why).toContain(REMEDY);
    expect(n.why).toBe(`the leg ended 'error': ${reason} with no usable output; `
      + 'its once-only retry wave produced no legs');
  });

  test('the real-world 2026-09-16 backstop reason rides whole through every builder', () => {
    // Run 35143585179's shape, rebuilt by the real minter rather than pasted.
    const reason = formatNoOutputBackstopReason({ ms: 480000, fromEnv: true,
      engineSkew: SKEW, sessionStatus: { type: 'idle' } });
    expect(srcLegStillDeadNote({ modelInput: 'glm', status: 'error', error: reason }, UNIT, COUNTS).why)
      .toContain(reason);
    expect(note({ class: 'leg', status: 'error', reason }, { status: 'timeout', error: null }).why)
      .toContain(reason);
    expect(note({ class: 'leg', status: 'error', reason: 'boom' }, { status: 'error', error: reason }).why)
      .toContain(reason);
    expect(missingLegStillDeadNote('glm', { class: 'leg', status: 'error', reason }, UNIT, COUNTS).why)
      .toContain(reason);
  });
});
