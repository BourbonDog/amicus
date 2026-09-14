/**
 * @module sidecar/aliases-review-prompt
 * The real-readline prompt for `amicus aliases --review`, split out of
 * aliases-review.js (#249 r2 D1) once that file hit the 300-line wall —
 * the same reason aliases-review-render.js and aliases-review-gate.js were
 * split out before it.
 *
 * Ctrl-C and Ctrl-D/EOF, MEASURED (Node 24, `terminal: true` over a
 * `PassThrough`, `input.write('\x03')`/`'\x04'`, `input.end()`): the two
 * keystrokes are NOT the same event. Ctrl-D/EOF closes the input stream,
 * which readline surfaces as its own `'close'` event. Ctrl-C in a raw-mode
 * terminal is readline's own `'SIGINT'` event — NOT the process `SIGINT`
 * signal — and with no listener attached, readline's default action is to
 * pause and then close the interface itself, which is why the pre-existing
 * `'close'` handler already covered Ctrl-C even before this split (the r2
 * D1 finding's MECHANISM claim — "Ctrl-C is dead" — was refuted). What
 * had no real-trigger test was that this depended on an inherited default:
 * the previous M1 test (aliases-review.test.js) injects an `ask` that
 * throws, and never drives an actual keystroke through readline. Attaching
 * `rl.on('SIGINT', () => rl.close())` below makes the abort path OURS —
 * explicit, and still correct if anything else ever attaches its own
 * `'SIGINT'` listener to this interface, which would otherwise suppress
 * readline's default close-on-SIGINT behaviour.
 */

'use strict';

/**
 * @param {{input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, terminal?: boolean}} [opts]
 *   `terminal` is passed through to `readline.createInterface` only when it
 *   is a boolean; omitted, readline picks its own default (`output.isTTY`).
 * @returns {{ask: (q: string) => Promise<string>, close: () => void}}
 *   `ask` resolves the trimmed answer; on an aborted prompt (Ctrl-C,
 *   Ctrl-D/EOF, or the input stream ending) it rejects with
 *   `Error('aliases --review interrupted')`, `code: 'REVIEW_ABORTED'`.
 *   `close` closes the interface; safe to call with no pending `ask` and
 *   safe to call more than once (readline's own `close` is idempotent).
 */
function createPrompt(opts = {}) {
  const { input = process.stdin, output = process.stdout, terminal } = opts;
  const readline = require('readline');
  const rl = readline.createInterface(
    typeof terminal === 'boolean' ? { input, output, terminal } : { input, output }
  );
  let pendingReject = null;
  // Ctrl-D/EOF (or the stream simply ending) closes stdin without ever
  // invoking the `question` callback -- reject any in-flight `ask` so the
  // caller's loop ends with a summary instead of hanging or exiting silently.
  rl.on('close', () => {
    if (pendingReject) {
      const reject = pendingReject;
      pendingReject = null;
      const err = new Error('aliases --review interrupted');
      err.code = 'REVIEW_ABORTED';
      reject(err);
    }
  });
  // See the module docblock: this is readline's own 'SIGINT' event (a
  // raw-mode-terminal Ctrl-C), not the process signal. Closing here makes
  // the abort path explicit rather than relying on readline's inherited
  // default, which only fires when nothing else has claimed this event.
  rl.on('SIGINT', () => rl.close());
  const ask = (q) => new Promise((resolve, reject) => {
    pendingReject = reject;
    rl.question(q, (a) => { pendingReject = null; resolve((a || '').trim()); });
  });
  const close = () => rl.close();
  return { ask, close };
}

module.exports = { createPrompt };
