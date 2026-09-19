// tests/utils/leg-riders.test.js
'use strict';

/**
 * #257 — the leg rider block, extracted VERBATIM out of
 * `src/utils/result-schema.js :: buildRunResult` (that file sat at the
 * 300-line gate and its last rider line already carried three fields).
 *
 * Two contracts live in this module and are pinned here:
 *   · KEY ORDER — ttftMs, finish, variant, variantUnverified, backstop,
 *     promoted: the order the wave document has always written, so a
 *     document built after the extraction is byte-identical to one built
 *     before it (the golden lives in tests/utils/result-schema.test.js).
 *   · EMIT-WHEN-SET / EMIT-WHEN-VALID — `metadata` is read back off disk, so
 *     a forged or skewed value reaches here. Absence is the honest reading;
 *     nothing is ever coerced to `null`, `0` or `false`.
 *
 * Named mutants this file guards:
 *   · RIDERPROMOTEDCOERCED — `...(m.promoted ? { promoted: true } : {})`:
 *     truthy is not `=== true`, so the string 'true' and the number 1 would
 *     each mint a promoted leg that never was.
 *   · FINISHCOERCED / VARIANTCOERCED / UNVERIFIEDCOERCED / BACKSTOPCOERCED —
 *     named in tests/utils/result-schema.test.js before the extraction (they
 *     still red there, through buildRunResult); the code they mutate now
 *     lives in this module, so they red here too.
 */
const { legRiders } = require('../../src/utils/leg-riders');
const { isBackstopRecord } = require('../../src/utils/no-output-backstop');

const BACKSTOP = { windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 };
const EVERY_RIDER = {
  ttftMs: 1234,
  finish: 'stop',
  variant: 'low',
  variantUnverified: true,
  backstop: BACKSTOP,
  promoted: true,
};

describe('legRiders (#257)', () => {
  it('writes every rider, in the documented key order', () => {
    const riders = legRiders({ ...EVERY_RIDER, model: 'm', status: 'complete' });
    expect(Object.keys(riders)).toEqual(
      ['ttftMs', 'finish', 'variant', 'variantUnverified', 'backstop', 'promoted']
    );
    expect(riders).toEqual(EVERY_RIDER);
  });

  it('writes nothing for a metadata carrying no riders (and tolerates none at all)', () => {
    expect(Object.keys(legRiders({}))).toEqual([]);
    expect(Object.keys(legRiders())).toEqual([]);
    expect(Object.keys(legRiders(null))).toEqual([]);
    expect(Object.keys(legRiders({ model: 'm', status: 'complete', usage: null }))).toEqual([]);
  });

  it('ttftMs is emit-when-VALID: 0 survives, a forged or skewed reading is dropped, never clamped', () => {
    expect(legRiders({ ttftMs: 0 })).toEqual({ ttftMs: 0 });
    for (const bogus of [-5, 1.5, NaN, Infinity, '1234', null, true]) {
      expect('ttftMs' in legRiders({ ttftMs: bogus })).toBe(false);
    }
  });

  it('finish is emit-when-set — a non-string is dropped (named mutant FINISHCOERCED)', () => {
    expect(legRiders({ finish: 'length' })).toEqual({ finish: 'length' });
    expect('finish' in legRiders({ finish: 7 })).toBe(false);
    expect('finish' in legRiders({ finish: null })).toBe(false);
  });

  it('variant / variantUnverified are emit-when-sent (named mutants VARIANTCOERCED / UNVERIFIEDCOERCED)', () => {
    expect(legRiders({ variant: 'medium' })).toEqual({ variant: 'medium' });
    expect('variant' in legRiders({ variant: 7 })).toBe(false);
    expect(legRiders({ variantUnverified: true })).toEqual({ variantUnverified: true });
    for (const bogus of ['yes', 1, false, null]) {
      expect('variantUnverified' in legRiders({ variantUnverified: bogus })).toBe(false);
    }
  });

  it('backstop is emit-when-VALID, in parity with isBackstopRecord (named mutant BACKSTOPCOERCED)', () => {
    expect(legRiders({ backstop: BACKSTOP })).toEqual({ backstop: BACKSTOP });
    const malformed = [
      { windowMs: 'x' },                                        // wrong type + missing required
      { ...BACKSTOP, extra: 1 },                                // a key the record has no room for
      { windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true }, // extended with no ceiling
      'busy', 7, null, [],
    ];
    for (const record of malformed) {
      expect(isBackstopRecord(record)).toBe(false);             // the predicate refuses it…
      expect('backstop' in legRiders({ backstop: record })).toBe(false); // …and so does the rider
    }
  });

  it('promoted is emit-when-TRUE: only the literal true (named mutant RIDERPROMOTEDCOERCED)', () => {
    expect(legRiders({ promoted: true })).toEqual({ promoted: true });
    // A truthy gate would mint a promoted leg out of a string, a 1, or a
    // JSON-round-tripped flag — and `promoted: false` must never be written
    // at all, so every document without a promoted leg stays byte-identical.
    for (const bogus of ['true', 1, 'yes', {}, false, 0, null, undefined]) {
      expect('promoted' in legRiders({ promoted: bogus })).toBe(false);
    }
  });
});
