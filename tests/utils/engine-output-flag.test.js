'use strict';

/**
 * #218 PR 2 — the one engine env flag amicus sets, OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX.
 *
 * The contract under test is timing and restoration, not arithmetic: the pinned
 * SDK spreads process.env into the engine spawn SYNCHRONOUSLY inside
 * createOpencodeServer, before its first await, so the flag has to be present
 * at call time and must be gone (or back to its ambient value) the moment fn
 * returns — never leaking into the caller's env or any later child spawn.
 */

const {
  withOutputTokenFlag, outputTokenFlagValue, OUTPUT_TOKEN_FLAG, ENGINE_DEFAULT_OUTPUT_TOKENS,
  PLAIN_OUTPUT_TOKEN_FLAG,
} = require('../../src/utils/engine-output-flag');

describe('PLAIN_OUTPUT_TOKEN_FLAG — the one measured form', () => {
  test.each(['64000', '8000', '1'])('%s is the measured shape', (v) => {
    expect(PLAIN_OUTPUT_TOKEN_FLAG.test(v)).toBe(true);
  });
  test.each(['064000', '64000abc', '0', ' 64000', '64000 ', '1e5', '0x10', '64000.7', ''])(
    '%s is not the measured shape',
    (v) => {
      expect(PLAIN_OUTPUT_TOKEN_FLAG.test(v)).toBe(false);
    },
  );
});

describe('constants', () => {
  test('the flag name is the engine\'s, and the default is the measured 32000', () => {
    expect(OUTPUT_TOKEN_FLAG).toBe('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
    expect(ENGINE_DEFAULT_OUTPUT_TOKENS).toBe(32000);
  });
});

describe('outputTokenFlagValue', () => {
  test('a positive integer budget becomes its decimal string', () => {
    expect(outputTokenFlagValue(40000)).toBe('40000');
    expect(outputTokenFlagValue(8000)).toBe('8000');
  });

  test('sub-1, zero, negative, non-numeric and unset budgets produce no flag', () => {
    for (const bad of [0, -1, 0.5, 'lots', '40000', null, undefined, true, NaN, Infinity]) {
      expect(outputTokenFlagValue(bad)).toBeNull();
    }
  });

  test('a fractional budget above 1 floors, matching normalizeOutputBudget', () => {
    expect(outputTokenFlagValue(40000.9)).toBe('40000');
  });

  test('a budget at or above 1e21 still sets the flag, as plain digits (council #231 B1)', () => {
    expect(outputTokenFlagValue(1e21)).toBe('1000000000000000000000');
    expect(outputTokenFlagValue(1e21)).toMatch(/^\d+$/);
    expect(outputTokenFlagValue(999999999999999868928)).toBe('999999999999999900000'); // the largest double below 1e21: plain digits without BigInt
  });
});

describe('withOutputTokenFlag', () => {
  test('sets the flag for the duration of fn and removes it afterwards', () => {
    const env = {};
    let seen;
    const out = withOutputTokenFlag(40000, () => { seen = env[OUTPUT_TOKEN_FLAG]; return 'ret'; }, env);
    expect(seen).toBe('40000');
    expect(out).toBe('ret');
    expect(Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG)).toBe(false);
  });

  // Named mutant "ALWAYSDELETE": replace the `if (had) … else …` restore with an
  // unconditional `delete env[OUTPUT_TOKEN_FLAG]` — the ambient '64000' is lost
  // and this test fails.
  test('restores an AMBIENT value the user exported, rather than deleting it', () => {
    const env = { [OUTPUT_TOKEN_FLAG]: '64000' };
    let seen;
    withOutputTokenFlag(40000, () => { seen = env[OUTPUT_TOKEN_FLAG]; }, env);
    expect(seen).toBe('40000');
    expect(env[OUTPUT_TOKEN_FLAG]).toBe('64000');
  });

  // Named mutant "NULLGUARD": delete the `if (value === null) { return fn(); }`
  // fast path — the flag is then set to the string 'null' and this test fails.
  test('with no usable budget the env is not touched — an ambient value is honoured as-is', () => {
    const env = { [OUTPUT_TOKEN_FLAG]: '64000' };
    let seen;
    withOutputTokenFlag(null, () => { seen = env[OUTPUT_TOKEN_FLAG]; }, env);
    expect(seen).toBe('64000');
    expect(env).toEqual({ [OUTPUT_TOKEN_FLAG]: '64000' });
    const empty = {};
    withOutputTokenFlag('nope', () => { seen = empty[OUTPUT_TOKEN_FLAG]; }, empty);
    expect(seen).toBeUndefined();
    expect(empty).toEqual({});
  });

  test('restores even when fn throws, and the throw propagates', () => {
    const env = {};
    expect(() => withOutputTokenFlag(40000, () => { throw new Error('spawn failed'); }, env))
      .toThrow('spawn failed');
    expect(Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG)).toBe(false);
  });

  test('a promise-returning fn is returned as-is, and the flag is already gone before it settles', async () => {
    const env = {};
    const p = withOutputTokenFlag(40000, async () => {
      const atCall = env[OUTPUT_TOKEN_FLAG];
      await new Promise((r) => setImmediate(r));
      return { atCall, afterFirstAwait: env[OUTPUT_TOKEN_FLAG] };
    }, env);
    expect(p).toBeInstanceOf(Promise);
    // Named mutant "RESTOREAFTERAWAIT": `return await fn()` inside the try
    // (restoring only once the promise settles) makes afterFirstAwait '40000'.
    expect(Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG)).toBe(false);
    await expect(p).resolves.toEqual({ atCall: '40000', afterFirstAwait: undefined });
  });

  test('defaults to the REAL process.env, and deletes rather than leaving "undefined"', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, OUTPUT_TOKEN_FLAG);
    const saved = process.env[OUTPUT_TOKEN_FLAG];
    delete process.env[OUTPUT_TOKEN_FLAG];
    try {
      let seen;
      withOutputTokenFlag(8000, () => { seen = process.env[OUTPUT_TOKEN_FLAG]; });
      expect(seen).toBe('8000');
      // Assigning `undefined` to a process.env key stores the STRING 'undefined';
      // the engine would then read a malformed flag and fall back silently (D1).
      expect(Object.prototype.hasOwnProperty.call(process.env, OUTPUT_TOKEN_FLAG)).toBe(false);
    } finally {
      if (had) { process.env[OUTPUT_TOKEN_FLAG] = saved; } else { delete process.env[OUTPUT_TOKEN_FLAG]; }
    }
  });
});
