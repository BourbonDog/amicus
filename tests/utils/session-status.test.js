// tests/utils/session-status.test.js
'use strict';

/**
 * #202 — the session-status clause on a NO_OUTPUT_BACKSTOP death.
 *
 * WHY this exists. `src/headless.js` asks the engine for session status only at
 * `if (mirror.output.length > 0)` — a gate that a zero-output leg never
 * satisfies, so the ONE leg that needs diagnosing is the one that never asks.
 * The pinned SDK's `SessionStatus` is
 * `{type:'idle'} | {type:'retry', attempt, message, next} | {type:'busy'}`, and
 * the `retry` arm carries the upstream error verbatim. That is the difference
 * between "unknown death" and a named cause.
 *
 * The three types are diagnostic in DIFFERENT directions, which is why none is
 * suppressed as uninteresting:
 *   · busy  — the engine is still waiting on the provider ⇒ provider-side.
 *   · idle  — the engine believes it is DONE while having produced nothing ⇒
 *             engine-side, the shape #133 turned out to be.
 *   · retry — the engine is re-attempting, and says why ⇒ the named cause.
 *
 * ⚠️ `message` is UNTRUSTED upstream text that ends up in a run artifact and, on
 * CI, in a sticky PR comment. It is collapsed and length-bounded here rather
 * than trusted to the workflow's sed neutralization downstream.
 */

const { formatSessionStatusSuffix, MAX_STATUS_MESSAGE_CHARS } =
  require('../../src/utils/session-status');

describe('formatSessionStatusSuffix', () => {
  test('S1 absent status appends NOTHING — the reason string stays byte-identical', () => {
    for (const empty of [null, undefined, false, 0, '', {}, [], 'busy']) {
      expect(`${JSON.stringify(empty)} -> ${JSON.stringify(formatSessionStatusSuffix(empty))}`)
        .toBe(`${JSON.stringify(empty)} -> ""`);
    }
  });

  test('S2 busy — the engine is still waiting on the provider', () => {
    expect(formatSessionStatusSuffix({ type: 'busy' })).toBe(' (session: busy)');
  });

  test('S3 idle — done, with nothing produced, is the engine-side signature', () => {
    expect(formatSessionStatusSuffix({ type: 'idle' })).toBe(' (session: idle)');
  });

  test('S4 retry carries the attempt AND the upstream message — the whole point', () => {
    expect(formatSessionStatusSuffix({
      type: 'retry', attempt: 2, message: 'Provider returned error 429',
    })).toBe(' (session: retry attempt 2 — Provider returned error 429)');
  });

  test('S5 retry degrades gracefully when either half is missing', () => {
    expect(formatSessionStatusSuffix({ type: 'retry', attempt: 3 }))
      .toBe(' (session: retry attempt 3)');
    expect(formatSessionStatusSuffix({ type: 'retry', message: 'upstream said no' }))
      .toBe(' (session: retry — upstream said no)');
    expect(formatSessionStatusSuffix({ type: 'retry' })).toBe(' (session: retry)');
  });

  test('S6 an UNTRUSTED message is collapsed to one line and length-bounded', () => {
    const nasty = `line1\nline2\r\n\tTABBED   ${'x'.repeat(400)}`;
    const out = formatSessionStatusSuffix({ type: 'retry', message: nasty });
    expect(out).not.toMatch(/[\n\r\t]/);
    expect(out.length).toBeLessThanOrEqual(MAX_STATUS_MESSAGE_CHARS + 40);
  });

  test('S9 only the EXACT SDK identifier gets the retry treatment (#219 r2, deepseek)', () => {
    // The branch used to test the SANITIZED type, so anything collapsing to
    // 'retry' was routed through the retry arm. Classification now reads the raw
    // value and sanitization is display-only — a future SDK identifier cannot be
    // misclassified by the sanitizer's normalisation.
    expect(formatSessionStatusSuffix({ type: ' retry ', attempt: 2, message: 'no' }))
      .toBe(' (session: retry)');
    expect(formatSessionStatusSuffix({ type: 'retry', attempt: 2, message: 'yes' }))
      .toBe(' (session: retry attempt 2 — yes)');
  });

  test('S7 an unrecognised type is still reported rather than swallowed', () => {
    // A future SDK type must not read as "no status was observed" — that is the
    // exact silence this clause exists to remove.
    expect(formatSessionStatusSuffix({ type: 'compacting' })).toBe(' (session: compacting)');
  });

  test('S8 a non-string type is dropped, never rendered as [object Object]', () => {
    for (const bad of [{ type: 1 }, { type: {} }, { type: null }, { type: [] }]) {
      expect(`${JSON.stringify(bad)} -> ${JSON.stringify(formatSessionStatusSuffix(bad))}`)
        .toBe(`${JSON.stringify(bad)} -> ""`);
    }
  });
});
