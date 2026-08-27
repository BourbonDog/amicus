/**
 * @module utils/session-status
 * #202: render the engine's SESSION STATUS as a clause on a leg's death report.
 *
 * ⚠️ The JSDoc leads this file, ahead of `'use strict'`, matching
 * `utils/ttft.js` / `utils/text-sanitize.js` / `utils/engine-skew.js`:
 * `scripts/generate-docs.js` only reads a block comment that starts at byte
 * zero, so a `// path` line above it would leave this module's CLAUDE.md row
 * blank.
 *
 * WHY THIS EXISTS. `headless.js` asks the engine for session status only inside
 * `if (mirror.output.length > 0)` — a gate a zero-output leg never satisfies. So
 * the one leg that needs diagnosing is precisely the one that never asks, and
 * every silent death was reported as "no output in Ns" with no cause attached.
 * The pinned SDK publishes `SessionStatus` as
 * `{type:'idle'} | {type:'retry', attempt, message, next} | {type:'busy'}`, and
 * the `retry` arm carries the upstream error verbatim.
 *
 * NONE of the three types is suppressed as uninteresting — they point in
 * DIFFERENT directions, and which one comes back is the discrimination #202
 * spent six CI runs failing to make by argument:
 *   · `busy`  — the engine is still waiting on the provider ⇒ provider-side.
 *   · `idle`  — the engine believes it is DONE having produced nothing ⇒
 *               engine-side, which is the shape #133 turned out to be.
 *   · `retry` — the engine is re-attempting, and says why ⇒ the named cause.
 *
 * ⚠️ APPEND-ONLY, exactly like `engine-skew.js :: formatSkewSuffix`: no status
 * (or an unusable one) returns `''`, so a reason string built without one is
 * byte-for-byte what it was before this module existed, and
 * `sidecar/models-probe.js`'s `/^NO_OUTPUT_BACKSTOP:/` classification — a PREFIX
 * test — is unaffected either way.
 *
 * ⚠️ `message` is UNTRUSTED third-party text: it originates at the provider,
 * lands in run.json, and on CI is rendered into a sticky PR comment. It goes
 * through the house sanitizer (`text-sanitize.js :: collapseExcerpt`) at a short
 * cap rather than being trusted to the workflow's downstream sed rules — one
 * sanitizer, one dialect, per that module's own ruling.
 */

'use strict';

const { collapseExcerpt } = require('./text-sanitize');

/** Short cap: this is a clause on a one-line death report, not a log dump. */
const MAX_STATUS_MESSAGE_CHARS = 200;

/**
 * The death-report clause for an engine session status.
 * @param {*} status - an SDK SessionStatus, or anything at all
 * @returns {string} ` (session: …)`, or '' when nothing usable was observed
 */
function formatSessionStatusSuffix(status) {
  if (!status || typeof status !== 'object') { return ''; }
  // A non-string `type` is DROPPED rather than coerced: `String({})` renders
  // '[object Object]', which would read as an observation rather than as the
  // absence it actually is.
  if (typeof status.type !== 'string') { return ''; }
  // ⚠️ CLASSIFY on the RAW value, RENDER the sanitized one (#219 round 2,
  // deepseek). Branching on the sanitized type let the sanitizer's own
  // normalisation decide the arm — anything collapsing to 'retry' took the retry
  // path — so a future SDK identifier could be misclassified by a function whose
  // job is display, not semantics. Only the exact published identifier routes.
  const type = collapseExcerpt(status.type, 40);
  if (!type) { return ''; }
  // An unrecognised type is still reported. A future SDK arm must not read as
  // "no status was observed" — that silence is what this clause removes.
  if (status.type !== 'retry') { return ` (session: ${type})`; }
  const attempt = Number.isFinite(status.attempt) ? ` attempt ${status.attempt}` : '';
  const raw = collapseExcerpt(status.message, MAX_STATUS_MESSAGE_CHARS);
  return ` (session: retry${attempt}${raw ? ` — ${raw}` : ''})`;
}

module.exports = { formatSessionStatusSuffix, MAX_STATUS_MESSAGE_CHARS };
