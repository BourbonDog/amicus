// tests/sidecar/aliases-review-prompt.test.js
'use strict';

/**
 * Drives the REAL readline interface (`createPrompt`, no `ask` injected)
 * over `PassThrough` streams with `terminal: true` -- the trigger the old
 * inline block in aliases-review.js never had a test for (the M1 test in
 * aliases-review.test.js injects an `ask` that throws; it never exercises
 * an actual keystroke). See the module docblock for what was MEASURED.
 */

const { PassThrough } = require('stream');
const { createPrompt } = require('../../src/sidecar/aliases-review-prompt');

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.on('data', () => {}); // drain -- nothing under test reads the prompt text back
  return { input, output };
}

describe('sidecar/aliases-review-prompt (#249 r2 D1)', () => {
  test('a normal answer resolves the trimmed line', async () => {
    const { input, output } = streams();
    const { ask, close } = createPrompt({ input, output, terminal: true });
    const pending = ask('> ');
    input.write('2\r');
    await expect(pending).resolves.toBe('2');
    close();
  });

  test('Ctrl-C (readline\'s own SIGINT event) rejects the pending ask with REVIEW_ABORTED', async () => {
    const { input, output } = streams();
    const { ask } = createPrompt({ input, output, terminal: true });
    const pending = ask('> ');
    input.write('\x03');
    await expect(pending).rejects.toMatchObject({ code: 'REVIEW_ABORTED' });
  });

  test('Ctrl-D (EOF) rejects the pending ask with REVIEW_ABORTED', async () => {
    const { input, output } = streams();
    const { ask } = createPrompt({ input, output, terminal: true });
    const pending = ask('> ');
    input.write('\x04');
    await expect(pending).rejects.toMatchObject({ code: 'REVIEW_ABORTED' });
  });

  test('the input stream ending rejects the pending ask with REVIEW_ABORTED', async () => {
    const { input, output } = streams();
    const { ask } = createPrompt({ input, output, terminal: true });
    const pending = ask('> ');
    input.end();
    await expect(pending).rejects.toMatchObject({ code: 'REVIEW_ABORTED' });
  });

  // F3 (#249 r2 review): Ctrl-C with NO ask pending yet (e.g. during the
  // caller's inline catalog refresh, which runs after createPrompt() and
  // before the first ask()) used to leave `ask` calling `rl.question` on an
  // already-closed interface -- ERR_USE_AFTER_CLOSE, not REVIEW_ABORTED.
  test('Ctrl-C before any ask() still rejects the FIRST ask with REVIEW_ABORTED, not ERR_USE_AFTER_CLOSE', async () => {
    const { input, output } = streams();
    const { ask } = createPrompt({ input, output, terminal: true });
    input.write('\x03'); // no ask() pending at all yet
    await expect(ask('> ')).rejects.toMatchObject({ code: 'REVIEW_ABORTED' });
  });

  test('close() with no pending ask does not throw, and neither does a second close()', () => {
    const { input, output } = streams();
    const { close } = createPrompt({ input, output, terminal: true });
    expect(() => close()).not.toThrow();
    expect(() => close()).not.toThrow();
  });
});
