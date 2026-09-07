/**
 * @module reopen-notices
 * The stderr Notice a reopen owes the user for the effort level it does NOT carry (#218 PR 4, council #235 r5 J1/A3).
 * A session started with `--thinking <level>` sends no variant on any resumed or
 * continued leg, and since council #235 r2 both commands REJECT the flag, so the
 * user cannot ask for one there either. Level inheritance was scoped out of this PR
 * deliberately and stays out (filed, not built) — but the silence is the defect: it
 * is the same mid-conversation degrade this release cites against 4.9.3, and the
 * project's rule is that a level which will not take effect says so. Named mutants
 * "RESUMELEVELSILENT" / "CONTINUELEVELSILENT" (tests/sidecar/reopen-thinking-notice.test.js):
 * drop the call at either reopen site.
 *
 * Notices go to STDERR only — stdout carries the `--json` run document and the
 * fold summary, and nothing here may perturb either (same rule as the unverified
 * note in src/headless.js and src/sidecar/interactive.js).
 */

/** Longest fragment echoed from on-disk metadata into a one-line Notice. */
const MAX_FRAGMENT_CHARS = 40;

/**
 * Collapse an on-disk fragment to one safe line.
 * metadata.json is a FILE — a hand-edited or corrupted `thinking` value must not be
 * able to forge a second `Notice:` line or smuggle control characters into a terminal
 * (the hazard src/utils/alias-shadow.js :: safeFragment was written against).
 * @param {unknown} value
 * @returns {string}
 */
function safeFragment(value) {
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F`<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FRAGMENT_CHARS);
}

/**
 * The Notice line for a reopen that drops the session's recorded effort level, or null.
 * Null whenever the session records no level — nothing was asked for, so nothing is dropped.
 * @param {{taskId: string, level: unknown, kind: 'resume'|'continue'}} a
 * @returns {string|null}
 */
function formatDroppedLevelNotice({ taskId, level, kind }) {
  if (typeof level !== 'string') { return null; }
  const shown = safeFragment(level);
  if (!shown) { return null; }
  const what = kind === 'continue'
    ? 'this continuation opens a NEW session and sends no effort level, so it runs at the provider\'s default — a level belongs on the `start` that opens a session and is not carried across a reopen'
    : 'this resumed leg sends no effort level and runs at the provider\'s default — a level is not carried across a reopen';
  return `Notice: session ${safeFragment(taskId)} was started with --thinking ${shown}; ${what}`;
}

/**
 * Write that Notice to stderr when the session recorded a level. No-op otherwise.
 * @param {object} metadata - the session metadata whose `thinking` is read (resume: the session's own; continue: the PARENT's)
 * @param {{taskId: string, kind: 'resume'|'continue'}} a
 * @returns {string|null} the line written, or null when nothing was written
 */
function noticeDroppedLevel(metadata, { taskId, kind }) {
  const note = formatDroppedLevelNotice({ taskId, level: metadata && metadata.thinking, kind });
  if (note) { process.stderr.write(`${note}\n`); }
  return note;
}

module.exports = { formatDroppedLevelNotice, noticeDroppedLevel };
