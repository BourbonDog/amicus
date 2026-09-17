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

const { formatSessionStatusSuffix, probeUnknown, isProbeOutcome, MAX_STATUS_MESSAGE_CHARS } =
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

/**
 * #251 item 3 — the probe's OWN outcome is part of the report.
 *
 * WHAT WAS MEASURED. Ten `NO_OUTPUT_BACKSTOP` kills on PR #254 (2026-09-16,
 * runs 35127823199 / 35135077808 / 35143585179) and five on PR #250 before
 * them: not one death report carried a `(session: …)` clause. The clause is
 * omitted for `null`, and `sessionStatusSafe` returned `null` for THREE
 * different reasons — nobody asked, the read threw, the read timed out — each
 * of which pointed at a different fix, and all three were indistinguishable in
 * the artifact. The only witness was a `logger.debug` line CI never emits.
 *
 * ⚠️ THE INVARIANT THAT SURVIVES. A probe that failed is NOT an observation
 * about the engine (#219). The rendered type is `unknown` and never `idle` or
 * `busy`: "we asked and got nothing back" must never be readable as "the engine
 * said it was done". The clause names WHICH of the three happened and why, and
 * says so in the artifact instead of in a debug log.
 */
describe('#251 item 3 — a probe that answered nothing SAYS SO', () => {
  test('S10 the three skip reasons are distinct in the report', () => {
    expect(formatSessionStatusSuffix(probeUnknown('skipped', 'no status reader')))
      .toBe(' (session: unknown — probe skipped: no status reader)');
    expect(formatSessionStatusSuffix(probeUnknown('skipped', 'no session id')))
      .toBe(' (session: unknown — probe skipped: no session id)');
    expect(formatSessionStatusSuffix(probeUnknown('skipped', 'no window')))
      .toBe(' (session: unknown — probe skipped: no window)');
  });

  test('S11 a FAILED probe names the failure and never reads as an engine observation', () => {
    const out = formatSessionStatusSuffix(
      probeUnknown('failed', 'getSessionStatus(death-report) timed out after 5000ms'));
    expect(out).toBe(
      ' (session: unknown — probe failed: getSessionStatus(death-report) timed out after 5000ms)');
    // #219's concern, pinned as a string property: the words the engine's own
    // arms use must not appear on a probe that never heard from the engine.
    expect(out).not.toMatch(/\bidle\b|\bbusy\b|\bretry\b/);
  });

  test('S12 an engine that answers with no status is its own third case', () => {
    expect(formatSessionStatusSuffix(probeUnknown('no-status', 'the engine returned no status')))
      .toBe(' (session: unknown — probe no-status: the engine returned no status)');
  });

  test('S13 the probe detail is UNTRUSTED text — collapsed and bounded like `message`', () => {
    const nasty = `line1\nline2\r\n\tTABBED   ${'x'.repeat(400)}`;
    const out = formatSessionStatusSuffix(probeUnknown('failed', nasty));
    expect(out).not.toMatch(/[\n\r\t]/);
    expect(out.length).toBeLessThanOrEqual(MAX_STATUS_MESSAGE_CHARS + 60);
  });

  test('S14 a detail that collapses to nothing still names the probe arm', () => {
    expect(formatSessionStatusSuffix(probeUnknown('failed', '   ')))
      .toBe(' (session: unknown — probe failed)');
    expect(formatSessionStatusSuffix(probeUnknown('failed', undefined)))
      .toBe(' (session: unknown — probe failed)');
  });

  test('S14b a probe ARM that collapses to nothing falls back to the plain identifier', () => {
    // ` — probe : detail` names no arm; a malformed clause is worse than the
    // bare identifier, which at least claims nothing it cannot support.
    //
    // ⚠️ BUILT WITH `probeUnknown` (#263 r1 round 2). It used to pass a plain
    // literal, which stopped being a probe outcome the moment the marker became
    // a Symbol — so it exercised the ENGINE arm and stayed green no matter what
    // the blank-arm guard did. A vacuous test is worse than none: it reports
    // coverage it does not have.
    const blankArm = probeUnknown('   ', 'x');
    expect(isProbeOutcome(blankArm)).toBe(true);          // it really is on the probe path
    expect(formatSessionStatusSuffix(blankArm)).toBe(' (session: unknown)');
    // Not the malformed shape the guard exists to prevent — stated positively so
    // deleting the guard reddens this line, which is the point of the test.
    expect(formatSessionStatusSuffix(blankArm)).not.toContain('probe');
  });

  test('S15 only a PROBE RESULT takes the new arm — an engine `unknown` renders as before', () => {
    // The marker is the module-private `Symbol('amicus.probeOutcome')` that only
    // `probeUnknown` sets — NOT the `probe` field, which is ordinary wire-shaped
    // data an engine can publish (#263 r1, B3/D1). If the SDK ever publishes a
    // real `{type:'unknown'}` arm it is an OBSERVATION and must keep rendering
    // as the plain identifier — the opposite meaning.
    expect(formatSessionStatusSuffix({ type: 'unknown' })).toBe(' (session: unknown)');
    expect(formatSessionStatusSuffix({ type: 'unknown', probe: 7 })).toBe(' (session: unknown)');
    // A `probe` field on any OTHER type is ignored: the type is the observation.
    expect(formatSessionStatusSuffix({ type: 'retry', attempt: 1, probe: 'failed' }))
      .toBe(' (session: retry attempt 1)');
  });

  test('S16 every pre-#251 fixture renders BYTE-IDENTICALLY — the new arm is additive', () => {
    // The frozen table, not a re-derivation: if a future edit to the unknown arm
    // moves any of these, this test names the one that moved.
    const frozen = [
      [null, ''], [undefined, ''], [{}, ''], [[], ''], ['busy', ''], [0, ''], ['', ''],
      [{ type: 1 }, ''], [{ type: {} }, ''], [{ type: null }, ''], [{ type: [] }, ''],
      [{ type: 'busy' }, ' (session: busy)'],
      [{ type: 'idle' }, ' (session: idle)'],
      [{ type: 'compacting' }, ' (session: compacting)'],
      [{ type: ' retry ', attempt: 2, message: 'no' }, ' (session: retry)'],
      [{ type: 'retry' }, ' (session: retry)'],
      [{ type: 'retry', attempt: 3 }, ' (session: retry attempt 3)'],
      [{ type: 'retry', message: 'upstream said no' }, ' (session: retry — upstream said no)'],
      [{ type: 'retry', attempt: 2, message: 'Provider returned error 429' },
        ' (session: retry attempt 2 — Provider returned error 429)'],
    ];
    for (const [input, expected] of frozen) {
      expect(`${JSON.stringify(input)} -> ${JSON.stringify(formatSessionStatusSuffix(input))}`)
        .toBe(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`);
    }
  });

  test('S17 probeUnknown builds the shape the report renders, and nothing else', () => {
    // The ENUMERABLE shape is exactly these three — what a log or an inspector
    // sees. The provenance marker is a Symbol (#263 r1 B3/D1), so it is not part
    // of that shape and is asserted through `isProbeOutcome` instead.
    const out = probeUnknown('failed', 'boom');
    expect(Object.keys(out)).toEqual(['type', 'probe', 'detail']);
    expect(JSON.parse(JSON.stringify(out)))
      .toEqual({ type: 'unknown', probe: 'failed', detail: 'boom' });
    expect(isProbeOutcome(out)).toBe(true);
    // A COPY is still a probe outcome — the Symbol rides an own-enumerable
    // spread, which is what any future `{...status}` in a caller would do.
    expect(isProbeOutcome({ ...out })).toBe(true);
  });
});


/**
 * Council #263 round 1, B3 + D1 [minor, Confirmed] — the discriminator must not
 * be forgeable from the wire.
 *
 * `probe` was an ordinary enumerable string on a flat object, and the object it
 * discriminates comes straight from an UNTRUSTED engine response. So an engine
 * publishing `{type:'unknown', probe:'failed', detail:'…'}` rendered as one of
 * amicus's own probe failures, and this module's "kept distinguishable by
 * construction" claim was false: nothing in the wire shape prevented the
 * collision. The marker is now a module-private Symbol that only `probeUnknown`
 * can set, so provenance is carried by something JSON cannot express.
 */
describe('#263 r1 B3/D1 — the probe marker is private, not a wire field', () => {
  test('P1 an ENGINE object wearing `probe` renders as a plain engine status', () => {
    expect(formatSessionStatusSuffix({ type: 'unknown', probe: 'failed', detail: 'forged' }))
      .toBe(' (session: unknown)');
    expect(formatSessionStatusSuffix({ type: 'unknown', probe: 'skipped', detail: 'no window' }))
      .toBe(' (session: unknown)');
  });

  test('P2 only a result built by probeUnknown takes the probe arm', () => {
    expect(formatSessionStatusSuffix(probeUnknown('failed', 'connection refused')))
      .toBe(' (session: unknown — probe failed: connection refused)');
  });

  test('P3 isProbeOutcome answers for the marker, not for the field', () => {
    expect(isProbeOutcome(probeUnknown('skipped', 'no window'))).toBe(true);
    expect(isProbeOutcome({ type: 'unknown', probe: 'skipped', detail: 'no window' })).toBe(false);
    for (const notOne of [null, undefined, 0, '', 'probe', [], {}, { type: 'busy' }]) {
      expect(`${JSON.stringify(notOne)} -> ${isProbeOutcome(notOne)}`)
        .toBe(`${JSON.stringify(notOne)} -> false`);
    }
  });

  test('P4 a probe result does not survive JSON — the marker is in-process only', () => {
    // Pinned so nobody persists one and expects the clause back. The probe
    // result never leaves the process today (it goes straight into the reason
    // string); if that ever changes, this test is the thing that fails.
    const round = JSON.parse(JSON.stringify(probeUnknown('failed', 'boom')));
    expect(isProbeOutcome(round)).toBe(false);
    expect(formatSessionStatusSuffix(round)).toBe(' (session: unknown)');
  });
});
