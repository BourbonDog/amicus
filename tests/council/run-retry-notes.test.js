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

const { retryLegStillDeadNote } = require('../../src/council/run-retry-notes');

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
