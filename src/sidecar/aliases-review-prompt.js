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
 *
 * F3 (#249 r2 review): a Ctrl-C with no `ask` PENDING — e.g. during the
 * caller's inline catalog refresh, which runs after `createPrompt()` and
 * before the first `ask()` — closes `rl` with nothing to reject; the next
 * `ask()` then calls `rl.question` on an already-closed interface, which
 * throws `ERR_USE_AFTER_CLOSE` instead of ever reaching `'close'`'s reject.
 * `ask` tracks that window itself (a plain closure flag, not the
 * undocumented `rl.closed`) and short-circuits to the SAME `REVIEW_ABORTED`
 * error the pending-ask path builds.
 */

'use strict';

/** @returns {Error} the one `REVIEW_ABORTED` shape both abort paths in `createPrompt` build. */
function abortedError() {
  const err = new Error('aliases --review interrupted');
  err.code = 'REVIEW_ABORTED';
  return err;
}

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
  let closed = false; // F3: ours, not the undocumented rl.closed -- see module docblock
  // Ctrl-D/EOF (or the stream simply ending) closes stdin without ever
  // invoking the `question` callback -- reject any in-flight `ask` so the
  // caller's loop ends with a summary instead of hanging or exiting silently.
  rl.on('close', () => {
    closed = true;
    if (pendingReject) {
      const reject = pendingReject;
      pendingReject = null;
      reject(abortedError());
    }
  });
  // See the module docblock: this is readline's own 'SIGINT' event (a
  // raw-mode-terminal Ctrl-C), not the process signal. Closing here makes
  // the abort path explicit rather than relying on readline's inherited
  // default, which only fires when nothing else has claimed this event.
  rl.on('SIGINT', () => rl.close());
  const ask = (q) => new Promise((resolve, reject) => {
    // F3: already closed with no pending ask (see module docblock) -- calling
    // rl.question here would throw ERR_USE_AFTER_CLOSE instead of ever
    // reaching the 'close' handler's reject above.
    if (closed) { reject(abortedError()); return; }
    pendingReject = reject;
    rl.question(q, (a) => { pendingReject = null; resolve((a || '').trim()); });
  });
  const close = () => rl.close();
  return { ask, close };
}

module.exports = { createPrompt };
