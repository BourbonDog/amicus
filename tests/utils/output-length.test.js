'use strict';

const { OUTPUT_LENGTH_PREFIX, isOutputLengthDeath, formatOutputLengthReason } = require('../../src/utils/output-length');

describe('isOutputLengthDeath (#218 PR 3)', () => {
  test("finish 'length' with no answer text on that message is the death (L1/L2/L4 shapes)", () => {
    expect(isOutputLengthDeath({ finish: 'length', hasText: false })).toBe(true);
  });
  test("finish 'length' with answer text on that message is NOT the death — a cut review (L3)", () => {
    // Named mutant "TEXTIGNORED": drop the hasText check — this reads true.
    expect(isOutputLengthDeath({ finish: 'length', hasText: true })).toBe(false);
  });
  test('no answer text with any other finish is not this death', () => {
    // Named mutant "NOTLENGTH": drop the finish check — 'stop' with no text reads true.
    expect(isOutputLengthDeath({ finish: 'stop', hasText: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: null, hasText: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: undefined, hasText: false })).toBe(false);
  });
  test('an unrecorded hasText is not text: a message with no parts is the death', () => {
    expect(isOutputLengthDeath({ finish: 'length' })).toBe(true);
  });
});

describe('formatOutputLengthReason (#218 PR 3)', () => {
  const tokens = { input: 5, output: 0, reasoning: 32000 };

  test('the ledger shape, budget unset: prefix, finish, counts, the engine default, the remedy', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, reasoningOnly: false })).toBe(
      "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — "
      + "32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — "
      + 'raise outputBudget in config.json (docs/configuration.md, Output budget)');
  });
  test('a reasoning-only message says so', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, reasoningOnly: true }))
      .toContain('and only reasoning was streamed, no answer text — 32000 reasoning / 0 output tokens');
  });
  test('a configured budget is named as plain digits', () => {
    // Named mutant "BUDGETUNSET": always print the unset clause — 8000 never appears.
    expect(formatOutputLengthReason({ tokens, budget: 8000 })).toContain('; outputBudget is 8000 — raise');
    expect(formatOutputLengthReason({ tokens, budget: 1e21 })).toContain('; outputBudget is 1000000000000000000000 — raise');
  });
  test('with no budget, an ambient plain-integer flag is named as what governs (council #232 r3 B1)', () => {
    // Named mutant "AMBIENTIGNORED": drop the two ambient branches — the default clause prints instead.
    expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag: '64000' })).toContain(
      '; outputBudget is unset — the ambient OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000 the engine was '
      + "started with governs (each leg reserves min(64000, the ceiling the engine's catalog knows for it)) — raise");
  });
  test('a malformed ambient flag is named as unmeasured, with the two measured fallbacks', () => {
    // Only a plain positive integer is measured to be honoured (probe D1/D2).
    expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag: '64000abc' })).toContain(
      'outputBudget is unset and the ambient OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000abc the engine was '
      + 'started with is not a plain positive integer — the only form measured to be honoured '
      + '(probe D1/D2: 64000abc and 0 fell back to 32000 silently); any other form is unmeasured');
    expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag: '0' })).toContain(
      'outputBudget is unset and the ambient OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=0 the engine was '
      + 'started with is not a plain positive integer — the only form measured to be honoured '
      + '(probe D1/D2: 64000abc and 0 fell back to 32000 silently); any other form is unmeasured');
  });
  test('an ambient flag beside a configured budget is not named — the budget overrode it', () => {
    const s = formatOutputLengthReason({ tokens, budget: 8000, ambientFlag: '64000' });
    expect(s).toContain('; outputBudget is 8000 — raise');
    expect(s).not.toContain('ambient');
  });
  test('an unreadable config is reported as such, never as "unset"', () => {
    expect(formatOutputLengthReason({ tokens, budget: undefined })).toContain('; outputBudget could not be read — raise');
  });
  // #257 R-X44's principle (council round 4, D2): the old `count()` floored a missing
  // token record to 0 and minted "0 reasoning / 0 output tokens" — a measurement the
  // engine never reported, printed in the sentence whose whole job is to report what the
  // engine recorded. An absent count is not a zero count. Named mutant "OUTPUTLENGTHZEROS".
  test('an absent or partial token record says so — it never fabricates zeros', () => {
    for (const tokens of [null, undefined, {}, { reasoning: NaN, output: 0 },
      { output: 24000 }, { reasoning: 32000 }, { reasoning: 1, output: Infinity }]) {
      const s = formatOutputLengthReason({ tokens, budget: null });
      expect(s).toContain(' — token usage not reported; outputBudget is unset');
      expect(s).not.toContain('reasoning /');
    }
  });
  test('REPORTED zeros stay zeros — "none" and "not reported" are different facts', () => {
    expect(formatOutputLengthReason({ tokens: { reasoning: 0, output: 0 }, budget: null }))
      .toContain(' — 0 reasoning / 0 output tokens;');
    expect(formatOutputLengthReason({ tokens: { reasoning: 0, output: 24000 }, budget: null }))
      .toContain(' — 0 reasoning / 24000 output tokens;');
  });
  test('the prefix is the classifiable constant', () => {
    expect(OUTPUT_LENGTH_PREFIX).toBe('OUTPUT_LENGTH:');
    expect(formatOutputLengthReason({ tokens, budget: null }).startsWith(OUTPUT_LENGTH_PREFIX + ' ')).toBe(true);
  });
});

/**
 * #257 R-X43 — the ambient operator flag is BOUNDED before it is quoted.
 *
 * Council round 4 (run 35476684772), A2 (glm, Confirmed 3-0) and the chair: the cap on a
 * leg error quoted into prose (run-retry-notes.js :: MAX_LEG_ERROR_CHARS = 800) is meant
 * to pass every amicus-minted reason WHOLE, because the tail of this one is the remedy
 * sentence. It could not: this formatter interpolated the operator-controlled
 * `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` verbatim — twice on the plain arm — so a long
 * env var pushed the reason past 800 and the cap truncated the remedy away. That was
 * filed at the PR in round 3 and is closed here.
 *
 * The split is load-bearing. `PLAIN_OUTPUT_TOKEN_FLAG` is tested on the RAW bytes,
 * because the ENGINE saw the raw bytes: ' 64000 ' really is not honoured, and trimming it
 * before the test would report a healthy flag that silently falls back to 32000. The
 * PROSE quotes a bounded copy. Named mutant "FLAGUNBOUNDED": interpolate `ambientRaw`.
 */
describe('#257 R-X43 the ambient operator flag is bounded before it is quoted', () => {
  const { MAX_FRAGMENT_CHARS, safeFragment } = require('../../src/utils/text-sanitize');
  const tokens = { output: 0, reasoning: 32000 };
  const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';

  test('a 300-char non-plain flag is quoted at the fragment cap, ellipsis included', () => {
    const s = formatOutputLengthReason({ tokens, budget: null, ambientFlag: 'a'.repeat(300) });
    expect(s).toContain(`the ambient ${FLAG}=${'a'.repeat(MAX_FRAGMENT_CHARS - 1)}… the engine was started with is not a plain positive integer`);
    expect(s).not.toContain('a'.repeat(MAX_FRAGMENT_CHARS + 1));
  });

  test('a 300-digit PLAIN flag is bounded on BOTH of the plain arm\'s two quotes', () => {
    const s = formatOutputLengthReason({ tokens, budget: null, ambientFlag: '9'.repeat(300) });
    const quoted = safeFragment('9'.repeat(300));
    expect(quoted).toHaveLength(MAX_FRAGMENT_CHARS);
    expect(s).toContain(`the ambient ${FLAG}=${quoted} the engine was started with governs`);
    expect(s).toContain(`each leg reserves min(${quoted}, the ceiling`);
    expect(s).not.toContain('9'.repeat(MAX_FRAGMENT_CHARS + 1));
  });

  test('a hostile flag cannot put a newline or an escape sequence into the prose', () => {
    const ESC = String.fromCharCode(27);
    const s = formatOutputLengthReason({ tokens, budget: null, ambientFlag: `${ESC}[31m64\nk${ESC}[0m` });
    expect(s).not.toContain('\n');
    expect(s).not.toContain(ESC);
    expect(s).toContain(`the ambient ${FLAG}=64 k the engine was started with is not a plain positive integer`);
  });

  test("the ARM is chosen on the RAW bytes: '64000 ' still reads as unmeasured, exactly as today", () => {
    // The engine saw the trailing space and fell back to 32000; the sanitizer trims it for
    // the quote only. If the test read the bounded copy this row would flip to "governs"
    // and the doctor row (doctor-output-budget-check.js, ' 64000 ') would disagree with it.
    const s = formatOutputLengthReason({ tokens, budget: null, ambientFlag: '64000 ' });
    expect(s).toContain(`outputBudget is unset and the ambient ${FLAG}=64000 the engine was `
      + 'started with is not a plain positive integer — the only form measured to be honoured '
      + '(probe D1/D2: 64000abc and 0 fell back to 32000 silently); any other form is unmeasured');
    expect(s).not.toContain('the engine was started with governs');
  });

  test('a short flag is quoted unchanged — bounding is not a rewrite of an ordinary value', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag: '64000' }))
      .toContain(`the ambient ${FLAG}=64000 the engine was started with governs (each leg reserves min(64000, `);
  });

  test('a non-string ambientFlag is still "no flag", never the string "undefined"', () => {
    for (const ambientFlag of [null, undefined, 64000, {}]) {
      expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag }))
        .toContain("outputBudget is unset — the engine's 32000 default reservation governs");
    }
  });
});
