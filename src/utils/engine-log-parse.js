/**
 * @module utils/engine-log-parse
 * Line-shape parsing for the engine log: level, session, message.
 *
 * Is this line an ERROR, is it about THIS session, and where does its human
 * message begin.
 *
 * EXTRACTED from src/utils/engine-log.js (v4.9 W10 round 2). That module is the
 * I/O half — candidate dirs, mtime order, bounded tail reads — and sits against
 * the 300-line gate; everything here is a pure function of ONE line, which is
 * where every round-2 correlation and truncation finding landed. Splitting the
 * two lets the parsing rules grow the tests they need without shaving prose off
 * the resolver. `engine-log.js` re-exports all of it, so a consumer still has
 * one import site.
 *
 * TWO LINE FORMATS are in the wild and both are matched:
 *   logfmt   (1.17.x): `… level=ERROR … session.id=ses_<id> error=<msg>`
 *   columnar (1.2.x):  `ERROR <iso> +Nms service=… id=ses_<id> <msg>`
 * The `ses_<id>` token is the correlation key in both.
 *
 * PURE: no I/O, no throwing paths that a caller has to guard.
 */

'use strict';

/** One short line: long enough for a real engine error, short enough to ride
 *  inside an error string that already carries the backstop's own sentence. */
const MAX_EXCERPT_CHARS = 200;

/** ERROR level in either format: logfmt `level=ERROR`, columnar leading `ERROR`. */
function isErrorLine(line) {
  return /(^|\s)level=ERROR(\s|$)/.test(line) || /^\s*ERROR\b/.test(line);
}

/** A `key=value` token — the columnar format's structural shape. */
const PAIR_TOKEN = /^[\w.[\]-]+=/;
/**
 * The columnar header run before the message: `ERROR <iso> +Nms`. A LEVEL word,
 * an ISO date, or a SIGNED duration — and nothing else.
 *
 * A bare number is deliberately NOT header-shaped (round-2 review B5). The
 * header run now ends the prefix on a pairless line, so anything it accepts is
 * something it EATS: the older `[+-]?\d[\w.:+-]*` would have swallowed the `3`
 * of `3 retries exhausted` the moment that rule started applying.
 */
const HEADER_TOKEN = /^(?:[A-Z]+|\d{4}-\d\d-\d\d[\w:.+-]*|[+-]\d[\w.]*)$/;

/**
 * Which format is this line? A columnar line OPENS with a bare level token; a
 * logfmt line opens with a `key=value`.
 *
 * Round-2 review A2: the shape decides, NOT the presence of the substring
 * `error=` somewhere in the text. Running the logfmt extractor first on every
 * line cut columnar messages that merely CONTAINED `error=` — measured before
 * the fix, `… id=ses_… retry limit reached, error=true was set in config` came
 * back as `true was set in config`, and a quoted `error="x"` mid-sentence came
 * back as `x`.
 */
function isColumnarLine(line) {
  return /^\s*[A-Z]+(\s|$)/.test(line);
}

/** The logfmt `error=` value. Quoted content when quoted — honouring BACKSLASH
 *  ESCAPES, so an embedded `\"` does not end the value (round-2 review B5) —
 *  else the rest of the line, since an unquoted engine error is a sentence, not
 *  one token, and is conventionally last. Null when the line has no such key. */
function errorFieldValue(line) {
  const quoted = /\berror="((?:[^"\\]|\\.)*)"/.exec(line);
  if (quoted) { return quoted[1].replace(/\\(.)/g, '$1'); }
  const bare = /\berror=(?!")(.*)$/.exec(line);
  return bare ? bare[1] : null;
}

/**
 * Everything after the STRUCTURAL RUN at the line's start — `ERROR <iso> +Nms
 * service=… id=ses_…` — which is exactly where a columnar message begins.
 *
 * Deliberately not "after the LAST key=value on the line" (W10 round-1 review
 * B2): an engine error naming a setting mid-sentence — `could not parse foo=bar
 * in the config` — would lose everything before it. Once the run ends, the rest
 * of the line is text, `=` and all.
 *
 * HEADER tokens count only until the first pair; after one, an all-caps or
 * numeric word is message text (`… id=ses_x FATAL disk error`). But they do
 * ADVANCE the run, which is what lets a PAIRLESS columnar line shed its header
 * (round-2 review B5): before, the run only moved on pairs, so such a line
 * returned itself — level, timestamp and all — as its own "message".
 *
 * With no structural token at all the whole line comes back, so an
 * unrecognized future format degrades to "slightly noisy" rather than silence.
 */
function afterStructuralRun(line) {
  const tokens = line.trim().split(/\s+/);
  let runEnd = -1;
  let seenPair = false;
  for (let i = 0; i < tokens.length; i++) {
    if (PAIR_TOKEN.test(tokens[i])) { seenPair = true; runEnd = i; continue; }
    if (!seenPair && HEADER_TOKEN.test(tokens[i])) { runEnd = i; continue; }
    break;
  }
  const tail = tokens.slice(runEnd + 1).join(' ');
  return tail || (runEnd === -1 ? line : '');
}

/** The human part of an ERROR line, chosen by the line's SHAPE. */
function extractMessage(line) {
  if (!isColumnarLine(line)) {
    const value = errorFieldValue(line);
    if (value !== null) { return value; }
  }
  return afterStructuralRun(line);
}

/** An ANSI escape sequence: CSI (`ESC [ … final`), OSC (`ESC ] … BEL/ST`), or a
 *  bare two-character escape. */
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-_])/g;
/** C0 and C1 control characters, DEL included. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * One line, no control characters, at most MAX_EXCERPT_CHARS characters.
 *
 * SANITIZED, not just collapsed (round-2 review B2). This excerpt is quoted
 * verbatim from a third party's error text into a death report that reaches
 * terminals and MCP surfaces; engine lines can embed provider output, colour
 * codes and all. Escape sequences are DROPPED (they are formatting, so removing
 * them keeps `<esc>[31mred<esc>[0m` as `red` rather than as spaced-out text);
 * every remaining control byte becomes a space, which the whitespace collapse
 * below then tidies.
 */
function collapseExcerpt(text) {
  const oneLine = String(text === undefined || text === null ? '' : text)
    .replace(ANSI_SEQUENCE, '')
    .replace(CONTROL_CHAR, ' ')
    .replace(/\s+/g, ' ').trim();
  if (oneLine.length <= MAX_EXCERPT_CHARS) { return oneLine; }
  return `${oneLine.slice(0, MAX_EXCERPT_CHARS - 1)}…`;
}

/** A token character. MEASURED (2026-08-25) over this machine's own engine logs:
 *  369 distinct ids, each exactly `ses_` + 26 characters, every one of those 26
 *  drawn from `[A-Za-z0-9]` — no `-`, `_`, or `.`. `_` counts here anyway: an id
 *  cannot contain one, so a `_` on either side of a match means the surrounding
 *  token is something longer than an id. */
function isTokenCharCode(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122) || code === 95;
}

/**
 * Does `line` mention session `needle` as a WHOLE id?
 *
 * `String.includes` is wrong here: ids share prefixes, so `ses_abc` matches
 * `ses_abc123`'s line and a leg would quote a stranger's failure as its own
 * (W10 round-1 review A1). BOTH edges are anchored — round-1 anchored only the
 * right one, so `Xses_abc` and `prev_ses_abc` still matched (round-2 review
 * B6). A char-code boundary test rather than a per-line regex: this runs over
 * every line of every tail read, once per dead seat in a wave.
 */
function mentionsSession(line, needle) {
  let from = 0;
  for (;;) {
    const at = line.indexOf(needle, from);
    if (at === -1) { return false; }
    const after = at + needle.length;
    if ((at === 0 || !isTokenCharCode(line.charCodeAt(at - 1)))
      && (after >= line.length || !isTokenCharCode(line.charCodeAt(after)))) { return true; }
    from = at + 1;
  }
}

/** The field names that carry SESSION identity, in both formats. Exact
 *  spellings: `parent.id` and `message.id` also end in `id` and name something
 *  else entirely, and treating them as identity is how a foreign line gets
 *  handed to us. */
const SESSION_FIELDS = new Set(['id', 'session', 'sessions', 'sessionid', 'session.id']);
const FIELD_TOKEN = /^([\w.[\]-]+)=(.*)$/;

/**
 * Is this line ABOUT session `needle` — not merely one that mentions it?
 *
 * Round-2 review A1. A whole-token mention is not ownership: measured before
 * this rule existed, `… session.id=ses_other parent.id=<us> error="…"` and
 * `… session.id=ses_other write failed for storage/session/<us>/msg.json` both
 * returned ANOTHER session's failure as this leg's own. When a line names a
 * session in a session-identifying FIELD, that field decides whose line it is.
 *
 * When no such field is present the whole-token mention still counts — the rule
 * is "another session owns this line", not "only keyed lines count". Dropping
 * unkeyed lines would trade a wrong attribution for the silent miss this whole
 * module exists to end.
 */
function lineIsAboutSession(line, needle) {
  let keyed = false;
  let ours = false;
  for (const token of String(line).trim().split(/\s+/)) {
    const field = FIELD_TOKEN.exec(token);
    if (!field || !SESSION_FIELDS.has(field[1].toLowerCase())) { continue; }
    keyed = true;
    if (mentionsSession(field[2], needle)) { ours = true; }
  }
  return keyed ? ours : mentionsSession(line, needle);
}

module.exports = {
  isErrorLine,
  extractMessage,
  collapseExcerpt,
  mentionsSession,
  lineIsAboutSession,
  MAX_EXCERPT_CHARS,
};
