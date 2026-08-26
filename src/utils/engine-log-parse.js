/**
 * @module utils/engine-log-parse
 * Line-shape parsing for the engine log: level, session, message.
 *
 * Is this line an ERROR, is it about THIS session, and where does its human
 * message begin.
 *
 * EXTRACTED from src/utils/engine-log.js (v4.9 W10 round 2). That module is the
 * I/O half — candidate dirs, mtime order, the scan budget and its memo, with the
 * bounded tail reads themselves in `./engine-log-tail.js` since PR #206;
 * everything here is a pure function of ONE line, which is where every
 * correlation and truncation finding has landed since. `engine-log.js`
 * re-exports all of it, so a consumer still has one import site.
 *
 * TWO LINE FORMATS are in the wild and both are matched:
 *   logfmt   (1.17.x): `… level=ERROR … session.id=ses_<id> error=<msg>`
 *   columnar (1.2.x):  `ERROR <iso> +Nms service=… id=ses_<id> <msg>`
 * A session-identity FIELD is the correlation key in both — never a bare
 * mention (round-3 review A1; see lineIsAboutSession).
 *
 * WHAT IS NOT HERE: the excerpt sanitizer, which moved to `./text-sanitize.js`
 * in round 3 when `engine-skew.js` became its second caller. The TOKENIZER
 * stayed: logfmt/columnar token shapes are this module's domain, and all three
 * of its consumers live in this file.
 *
 * PURE: no I/O, no throwing paths that a caller has to guard.
 */

'use strict';

// The excerpt sanitizer MOVED to ./text-sanitize.js (round 3) once `engine-skew`
// became its second caller — see that module's docblock. Re-exported below, as
// the same function object, so every existing import site stays valid.
const { collapseExcerpt, MAX_EXCERPT_CHARS } = require('./text-sanitize');

/** A `key=value` token — the structural shape in both formats. */
const PAIR_TOKEN = /^[\w.[\]-]+=/;
/**
 * The columnar header run before the message: `ERROR <iso> +Nms`. A LEVEL word,
 * an ISO date, or a SIGNED duration — and nothing else.
 *
 * A bare number is deliberately NOT header-shaped (round-2 review B5): the
 * header run ends the prefix on a pairless line, so anything it accepts is
 * something it EATS — the older `[+-]?\d[\w.:+-]*` would have swallowed the `3`
 * of `3 retries exhausted`.
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
 * back as `true was set in config`.
 */
function isColumnarLine(line) {
  return /^\s*[A-Z]+(\s|$)/.test(line);
}

/**
 * The line's tokens: whitespace-separated, except that a QUOTED value
 * (`key="…"`) holds together however much whitespace it contains, backslash
 * escapes honoured so an embedded `\"` does not end it (round-2 review B5).
 *
 * ONE DIALECT, THREE CONSUMERS (round-3 reviews B2 and C5). "Where does a field
 * end and prose begin" had three substring answers, each wrong somewhere: a
 * whitespace split read `error="lost session.id=<them> mid-write"` as two
 * fields, the second a session identity; the `error=` extractor matched that
 * substring anywhere, so `msg="db error=timeout"` became the message. One
 * tokenizer, and all three agree by construction.
 *
 * `at` is the token's offset in `line` — what lets a caller slice the ORIGINAL
 * text rather than re-join tokens and lose its spacing.
 * @param {string} line
 * @returns {{text: string, at: number}[]}
 */
function tokenize(line) {
  const text = String(line);
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    const at = i;
    let quoted = false;
    while (i < text.length && (quoted || !/\s/.test(text[i]))) {
      if (quoted && text[i] === '\\') { i += 2; continue; }
      if (text[i] === '"') { quoted = !quoted; }
      i += 1;
    }
    tokens.push({ text: text.slice(at, i), at });
  }
  return tokens;
}

/**
 * The index of the STRUCTURAL RUN's last token, or -1 when the line opens with
 * prose. The run is `ERROR <iso> +Nms service=… id=ses_…` at a columnar line's
 * start, and the whole `key=value` sequence of a logfmt line.
 *
 * Deliberately not "up to the LAST key=value on the line" (W10 round-1 review
 * B2): an engine error naming a setting mid-sentence — `could not parse foo=bar
 * in the config` — would lose everything before it. Once the run ends, the rest
 * of the line is text, `=` and all.
 *
 * HEADER tokens count only until the first pair; after one, an all-caps or
 * numeric word is message text (`… id=ses_x FATAL disk error`). But they do
 * ADVANCE the run, letting a PAIRLESS columnar line shed its header (round-2 B5).
 * @param {{text: string, at: number}[]} tokens
 * @returns {number}
 */
function structuralRunEnd(tokens) {
  let runEnd = -1;
  let seenPair = false;
  for (let i = 0; i < tokens.length; i++) {
    if (PAIR_TOKEN.test(tokens[i].text)) { seenPair = true; runEnd = i; continue; }
    if (!seenPair && HEADER_TOKEN.test(tokens[i].text)) { runEnd = i; continue; }
    break;
  }
  return runEnd;
}

/** A leading QUOTED run's content, escapes decoded by `tokenize`'s own rule. */
function unquote(raw) {
  let out = '';
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) { out += raw[i + 1]; i += 1; continue; }
    if (raw[i] === '"') { break; }
    out += raw[i];
  }
  return out;
}

/**
 * The logfmt `error=` value: quoted content when quoted, else the rest of the
 * line, since an unquoted engine error is a sentence, not one token, and is
 * conventionally last. Null when the line has no such key.
 *
 * A TOP-LEVEL key only (round-3 review C5). The old match was a substring sweep,
 * so an `error=` inside another field's quoted value was taken as the message —
 * MEASURED before the fix, `… msg="db error=timeout" error=connection refused`
 * returned `timeout" error=connection refused`. Tokenizing first makes the
 * boundary structural instead of textual.
 */
function errorFieldValue(line) {
  const text = String(line);
  for (const token of tokenize(text)) {
    if (!token.text.startsWith('error=')) { continue; }
    const value = token.text.slice('error='.length);
    return value.startsWith('"') ? unquote(value) : text.slice(token.at + 'error='.length);
  }
  return null;
}

/**
 * Everything after the structural run — exactly where a columnar message
 * begins. With no structural token at all the whole line comes back, so an
 * unrecognized future format degrades to "slightly noisy" rather than silence.
 */
function afterStructuralRun(line) {
  const text = String(line);
  const tokens = tokenize(text);
  const runEnd = structuralRunEnd(tokens);
  if (runEnd === -1) { return text.trim(); }
  const next = tokens[runEnd + 1];
  return next ? text.slice(next.at).trim() : '';
}

/** The human part of an ERROR line, chosen by the line's SHAPE. */
function extractMessage(line) {
  if (!isColumnarLine(line)) {
    const value = errorFieldValue(line);
    if (value !== null) { return value; }
  }
  return afterStructuralRun(line);
}

/** A token character. MEASURED (2026-08-25) over this machine's own engine logs:
 *  369 distinct ids, each exactly `ses_` + 26 characters, every one drawn from
 *  `[A-Za-z0-9]` — no `-`, `_`, or `.`. `_` counts here anyway: an id cannot
 *  contain one, so a `_` beside a match means the token is longer than an id. */
function isTokenCharCode(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122) || code === 95;
}

/**
 * Does `text` mention session `needle` as a WHOLE id?
 *
 * `String.includes` is wrong here: ids share prefixes, so `ses_abc` matches
 * `ses_abc123`'s line and a leg would quote a stranger's failure as its own
 * (W10 round-1 review A1). BOTH edges are anchored — round-1 anchored only the
 * right one, so `Xses_abc` and `prev_ses_abc` still matched (round-2 review B6).
 * A char-code boundary test rather than a regex: this runs per candidate field
 * of every ERROR line in a tail read, once per dead seat in a wave.
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
 *  else entirely; treating them as identity hands us a foreign line. */
const SESSION_FIELDS = new Set(['id', 'session', 'sessions', 'sessionid', 'session.id']);
const FIELD_TOKEN = /^([\w.[\]-]+)=(.*)$/;

/**
 * ERROR level in either format: columnar's leading `ERROR` word, or logfmt's
 * `level=ERROR` read as a TOP-LEVEL FIELD of the structural run.
 *
 * A FIELD, not a substring (#201 final-round tail C1). The old logfmt half was
 * `/(^|\s)level=ERROR(\s|$)/` over the raw line — the last substring sweep left
 * in this module, the shape rounds 2 and 3 replaced in the format test (A2),
 * the `error=` extractor (C5) and the ownership scan (B2). A quoted value that
 * merely CONTAINS the delimited text promoted the whole line, and an INFO line
 * is ordinary prose about a retry: MEASURED before the fix, `… level=INFO …
 * msg="upstream logged level=ERROR moments ago" fixture fell back to the cache`
 * was reported as the leg's cause of death as `fixture fell back to the cache`.
 * The same run bound applies as everywhere else: past the fields, `level=ERROR`
 * is text a human wrote, `=` and all.
 *
 * The substring is still the FIRST test, just no longer the LAST word: it is a
 * necessary condition, so a line without it rejects on one `indexOf` and never
 * tokenizes — which is what keeps this the cheap half of the pair in
 * `engine-log-tail.js :: newestExcerptInFile`.
 */
function isErrorLine(line) {
  const text = String(line);
  if (/^\s*ERROR\b/.test(text)) { return true; }
  if (text.indexOf('level=ERROR') === -1) { return false; }
  const tokens = tokenize(text);
  const runEnd = structuralRunEnd(tokens);
  for (let i = 0; i <= runEnd; i++) {
    const field = FIELD_TOKEN.exec(tokens[i].text);
    if (field && field[1].toLowerCase() === 'level' && field[2] === 'ERROR') { return true; }
  }
  return false;
}

/**
 * Is this line ABOUT session `needle` — not merely one that mentions it?
 *
 * OWNERSHIP COMES ONLY FROM A SESSION-IDENTITY FIELD IN THE STRUCTURAL RUN. A
 * line carrying no such field is NEVER attributed — no exception, no fallback.
 *
 * Round 2 established the first half (a whole-token MENTION is not ownership:
 * `… session.id=ses_other parent.id=<us> error="…"` was returning another
 * session's failure as this leg's own) but kept a bare-mention fallback for
 * lines with no session field, and scanned fields by splitting on whitespace.
 * Round-3 reviews A1+B2 measured both leaks: a foreign line's FREE TEXT still
 * decided ownership whenever the line named no session in a field, and a
 * `session.id=`-shaped token INSIDE free text — a storage path, an `error=`
 * sentence, another field's quoted value — was read as a field and voted.
 *
 * PRECISION OVER RECALL is the lead's ruling, and the trade is cheap one way
 * only: a missed attribution falls through to the byte-identical message this
 * module's whole miss path is pinned on (and the skew clause is independent of
 * it), while a wrong one states a stranger's failure as this leg's own.
 */
function lineIsAboutSession(line, needle) {
  const tokens = tokenize(line);
  const runEnd = structuralRunEnd(tokens);
  let ours = false;
  for (let i = 0; i <= runEnd; i++) {
    const field = FIELD_TOKEN.exec(tokens[i].text);
    if (!field || !SESSION_FIELDS.has(field[1].toLowerCase())) { continue; }
    if (mentionsSession(field[2], needle)) { ours = true; }
  }
  return ours;
}

module.exports = {
  isErrorLine,
  extractMessage,
  collapseExcerpt,
  mentionsSession,
  lineIsAboutSession,
  MAX_EXCERPT_CHARS,
};
