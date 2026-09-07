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

const { collapseExcerpt } = require('../utils/text-sanitize');

/** Longest LEVEL echoed from on-disk metadata into a one-line Notice — a level is one word. */
const MAX_LEVEL_CHARS = 40;
/**
 * Longest TASK ID echoed. It is not an attacker-shaped fragment: `validators.js ::
 * TASK_ID_PATTERN` is `/^[a-zA-Z0-9_-]{1,64}$/`, which already excludes every character the
 * sanitizer strips — so the cap is what a VALID id can be. Capping it at the LEVEL's 40
 * named a session that does not exist (council #235 r5 wave 6 repair).
 */
const MAX_TASK_ID_CHARS = 64;

/**
 * Collapse an on-disk fragment to one safe line.
 * metadata.json is a FILE — a hand-edited or corrupted `thinking` value must not be
 * able to forge a second `Notice:` line or smuggle control characters into a terminal
 * (the hazard src/utils/alias-shadow.js :: safeFragment was written against).
 *
 * The SANITIZING is the house sanitizer's: `utils/text-sanitize.js :: collapseExcerpt` is the
 * only one ("a second implementation would be a second set of holes", and the holes are the
 * point — ANSI sequences and the PRINTABLE-range bidi controls are classes a private
 * control-character regex cannot see, and this module quotes both straight out of a file).
 * The fence/tag defang here is ADDITIVE and runs BEFORE that pass, so the house whitespace
 * collapse and cap still govern the result: it adds a class, it never replaces one. Same
 * shape as src/utils/alias-shadow.js :: safeFragment (council #235 r5 wave 6 repair).
 * @param {unknown} value
 * @param {number} maxChars
 * @returns {string}
 */
function safeFragment(value, maxChars) {
  return collapseExcerpt(String(value).replace(/[`<>]/g, ' '), maxChars);
}

/**
 * The value 4.9.3 and earlier stamped on EVERY session's metadata whether or not the flag was
 * typed — and never sent (probe F1). It is the one recorded level whose provenance is unknowable
 * from disk, so the line SAYS that rather than reporting it as something the user asked for.
 */
const LEGACY_UNCONDITIONAL_STAMP = 'medium';

/**
 * The Notice line for a reopen that drops the session's recorded effort level, or null.
 * Null whenever the session records no level — nothing was asked for, so nothing is dropped.
 *
 * It reports what the metadata RECORDS, not what was typed (council #235 r5 wave 6 repair).
 * Those are not the same proposition: 4.9.3 and earlier wrote `thinking: 'medium'` on every
 * session, flag or no flag, so the entire on-disk session history at upgrade time reaches this
 * line carrying a level nobody requested — and for those legs nothing degraded, because that
 * `medium` was never sent either. Nothing on disk tells the two apart (the same reason this
 * release refuses a pack migration), so the line states the record and names the ambiguity.
 * @param {{taskId: string, level: unknown, kind: 'resume'|'continue'}} a
 * @returns {string|null}
 */
function formatDroppedLevelNotice({ taskId, level, kind }) {
  if (typeof level !== 'string') { return null; }
  const shown = safeFragment(level, MAX_LEVEL_CHARS);
  if (!shown) { return null; }
  // Named mutant "NOTICECLAIMSINTENT": say "was started with" again, or drop this clause.
  const provenance = shown === LEGACY_UNCONDITIONAL_STAMP
    ? ' (4.9.3 and earlier recorded medium on every session, typed or not, and never sent it)'
    : '';
  const what = kind === 'continue'
    ? 'this continuation opens a NEW session and sends no effort level, so it runs at the provider\'s default — a level belongs on the `start` that opens a session and is not carried across a reopen'
    : 'this resumed leg sends no effort level and runs at the provider\'s default — a level is not carried across a reopen';
  return `Notice: session ${safeFragment(taskId, MAX_TASK_ID_CHARS)} records --thinking ${shown}${provenance}; ${what}`;
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
