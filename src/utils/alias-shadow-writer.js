/**
 * @module utils/alias-shadow-writer
 * The alias-shadow notice's WRITE half: say it without ever sinking the run.
 *
 * EXTRACTED from src/utils/alias-shadow.js (PR #207 round 4). That file already
 * separated the CHECK (read two alias tables, compare canonical forms) from the
 * WRITE (get one advisory line onto a stream that may be a closed pipe), and
 * rounds 2 and 3 put two independent hardenings on the write half alone —
 * `safeWrite`'s synchronous guard and `armStream`'s asynchronous one. Round 4's
 * B1 landed a third. The seam was already there; the file was at 286/300, and
 * shaving the measurement prose that makes these guards auditable would have
 * been the wrong economy, so the write half moved out whole.
 *
 * Nothing here was ever part of `alias-shadow.js`'s `module.exports` — these are
 * internal helpers, not a public API — so there is no re-export shim and no
 * import path anywhere in the tree that changes.
 *
 * Named mutants live with their red sets in tests/alias-shadow.test.js:
 * "WRITERFATAL" (drop `safeWrite`'s try/catch) and "STREAMFATAL" (drop
 * `armStream`'s attach-once 'error' handler).
 */

'use strict';

/**
 * Write a notice without ever letting the writer sink the run (round 2, B1).
 *
 * The 'never throws' contract used to cover only the CHECK: the guard wrapped
 * `findAliasShadows`, so a writer that threw — a caller-supplied collector that
 * rejects, a stream whose write throws — escaped and killed the launch this
 * diagnosis exists to protect. Worse, on the failure branch it escaped a second
 * time, because that branch announced itself through the SAME broken writer. A
 * notice must never be fatal to what it is describing, so the write is swallowed
 * here and nowhere else.
 *
 * ⚠️ This covers the SYNCHRONOUS half only. A piped stderr fails on a later turn
 * and never throws from `write()` at all — see `armStream` below, which is the
 * other half of the same contract.
 * @param {(line: string) => void} out
 * @param {string} line
 */
function safeWrite(out, line) {
  try { out(line); } catch { /* a diagnosis must never sink the run it diagnoses */ }
}

/**
 * The armed marker, keyed ON THE STREAM (PR #207 round 4, B1).
 *
 * It used to be a module-scoped `WeakSet`, which made "attach once" true only
 * once per MODULE INSTANCE. `jest.resetModules()` builds a fresh registry, the
 * fresh copy of this module starts with an empty set, and the SAME
 * `process.stderr` collects a second listener — measured at SEVEN across
 * tests/alias-shadow.test.js alone, against Node's 10-listener
 * MaxListenersExceededWarning. That warning is emitted ASYNCHRONOUSLY onto
 * `process.stderr.write`, which is the method several of this feature's absence
 * controls replace and exact-match on, so the accumulation was a
 * nondeterministic flake waiting for two more fixtures. A marker that lives on
 * the stream is immune: it is the same object either way.
 *
 * `Symbol.for`, not `Symbol()`: the well-known-symbol registry is per REALM, so
 * every instance of this module — reset registry, second resolved path, npx
 * copy loaded beside a global one — computes the SAME key and therefore agrees
 * about what is already armed. A module-local `Symbol()` would be a fresh key
 * per instance and would re-arm exactly like the WeakSet did.
 *
 * It also retains nothing: a swapped-out stream (tests do this) is dropped with
 * its own marker attached, where the WeakSet had to be weak on purpose.
 */
const ARMED = Symbol.for('amicus.alias-shadow.armed');

/**
 * Make a stream's write failures non-fatal, once (PR #207 round 3, A1).
 *
 * MEASURED, node v24.18.0 on Windows, against a REAL closed pipe (parent spawns
 * a child with `stdio: ['ignore','ignore','pipe']` and destroys the read end;
 * the child then writes to `process.stderr`):
 *
 *   · `write(line)` returns FALSE and throws NOTHING. `safeWrite`'s try/catch
 *     sees nothing at all. The EPIPE arrives on a LATER turn, as an 'error'
 *     event; with no listener, EventEmitter throws it, and that throw is an
 *     uncaughtException that ends the process (measured: exit code 7).
 *   · Passing a write CALLBACK does NOT fix it. The callback received the EPIPE
 *     AND the 'error' event still fired unhandled — same exit 7. This is why
 *     there is no callback here: it would observe the failure without disarming
 *     it, and read like a guard while being none.
 *   · Attaching for the duration of the write and detaching after is not merely
 *     racy, it is always WRONG: delivery is always on a later turn, so the
 *     detach always wins (measured: exit 7 again, with the handler's own log
 *     line showing it was removed before the error landed).
 *   · A persistent listener absorbs it, and a SECOND write raises a SECOND
 *     'error' — so this must be `on`, never `once`.
 *
 * Hence: attach once, per stream object, and leave it. That is a process-wide
 * change to `process.stderr`'s behaviour, so it was checked rather than assumed
 * — nothing in src/, bin/ or scripts/ attaches to or depends on that stream's
 * 'error' event (the `.on('error')` hits in the tree are all on CHILD process
 * streams), `logger.js` already treats an EPIPE from its own write as
 * ignorable, and `electron/main.js` installs precisely this handler for
 * precisely this reason in the GUI process. Adding a listener also removes
 * nobody else's: any handler another module attaches still runs alongside this
 * one. All this removes is the unhandled-'error' throw — which for a CLI
 * writing an advisory line into `| head` was never the right outcome.
 *
 * ⚠️ Scoped to the module's OWN default writer. An INJECTED writer (every test
 * collector, and the MCP notices array) never reaches here, so nothing is armed
 * on its behalf.
 * @param {NodeJS.WritableStream} stream
 */
function armStream(stream) {
  if (!stream || typeof stream.on !== 'function' || stream[ARMED]) { return; }
  try {
    // `configurable` so a test that borrows a real stream can still take it
    // back; symbol-keyed, so it is invisible to `Object.keys`, `JSON.stringify`
    // and anything else that walks the stream object we are borrowing.
    Object.defineProperty(stream, ARMED, { value: true, configurable: true });
  } catch {
    // A stream nobody can MARK cannot be armed exactly once, and arming it
    // without a mark would trade round 3's unhandled-'error' hazard for an
    // unbounded-listener one on that same stream. Node never freezes
    // `process.stderr`, so this is a guard, not a path.
    return;
  }
  stream.on('error', () => { /* a diagnosis must never sink the run it diagnoses */ });
}

/** The default writer: stderr, armed against its own asynchronous failure. */
function writeNoticeToStderr(line) {
  const stream = process.stderr;
  armStream(stream);
  stream.write(line);
}

// `ARMED` is deliberately NOT exported: it is this module's private marker, and
// a second holder of the key is a second thing that could clear it.
module.exports = { safeWrite, armStream, writeNoticeToStderr };
