'use strict';

/**
 * v4.9 W10 round 2 — src/utils/engine-log-parse.js, the line-shape half of the
 * engine-log resolver, extracted from src/utils/engine-log.js and then fixed.
 *
 * EVERY FIXTURE HERE IS SYNTHETIC. No line was copied from a real engine log on
 * any machine: the two line SHAPES come from the plan's recon (logfmt at 1.17.x,
 * columnar at 1.2.x) and every payload is invented.
 *
 * Control bytes AND Unicode bidi controls are written as `\u….` escapes, never
 * as literal characters — a literal ESC makes this file binary to `grep`, and a
 * literal RLO in source is the trojan-source attack the round-3 A2 fix exists to
 * strip. Both are invisible to the fragment sweeps the review process needs.
 *
 * ── NAMED MUTANTS with MEASURED red sets ───────────────────────────────────
 * Scope for all of these: this suite + tests/engine-log.test.js + the wiring
 * suite (`npx jest tests/engine-log.test.js tests/utils/engine-log-parse.test.js
 * tests/no-output-backstop-wiring.test.js --maxWorkers=2` → 3 suites / 121 tests
 * at HEAD; it read 91 before the round-3 tests and 118 before the text-sanitize
 * extraction, and both numbers are retired). Measured 2026-08-26, each applied
 * ALONE and reverted; sources restored by byte copy and checksum-verified, never
 * by `git checkout`.
 *
 * `OWNEDBYOTHER` — `lineIsAboutSession` degrades to `mentionsSession`, the
 *   pre-round-2 behaviour (any whole-token mention wins the line):
 *   **2 suites / 10 tests red** (it read 4 before round 3) — the two
 *   foreign-`session.id` tests here, the "…id does not get a vote" test here,
 *   all six round-3 structural-ownership tests here, and "a line another session
 *   OWNS is skipped even though it names us" in tests/engine-log.test.js.
 * `BAREMENTION` — round-3 A1 alone: the structural scan stays, but a line with
 *   NO session field falls back to a whole-token mention (round 2's rule):
 *   **1 suite / 3 tests red**, all here — "a line with NO session field…", "a
 *   lone non-session '…id' field…", and "free text cannot MANUFACTURE
 *   ownership…". The precise complement of the next one.
 * `WHOLELINEFIELDS` — round-3 B2 alone: session fields are read from EVERY
 *   token instead of only the structural run: **1 suite / 3 tests red**, all
 *   here — the columnar-message case, the unquoted-logfmt-value case, and
 *   "free text cannot MANUFACTURE ownership…", which both leaks can produce.
 * `LOGFMTFIRST` — `extractMessage` runs the `error=` extractor before the
 *   columnar shape test, the pre-round-2 precedence: **1 suite / 2 tests red**,
 *   both here — the bare and the quoted `error=`-inside-a-columnar-message
 *   cases. The whole B5/B6/A1 block stays green, which is the point: this
 *   mutant is precisely scoped to A2.
 * `ERRORANYWHERE` — round-3 C5: `errorFieldValue` reverts to the two substring
 *   regexes over the whole line: **1 suite / 2 tests red**, both top-level-key
 *   cases here.
 * `RAWEXCERPT` — `collapseExcerpt` drops the whole sanitize pass (ANSI, bidi
 *   and control): **1 suite / 18 tests red** (it read 4 before round 3), every
 *   sanitize case here. "control — ordinary text is untouched" stays green by
 *   design: it is the pin that says the sanitizer does not disturb an excerpt
 *   that needed nothing.
 * `NOBIDI` — round-3 A2 alone, only the bidi strip removed: **1 suite / 14
 *   tests red**, the twelve per-control cases plus the two hostile-run cases.
 *   The four C0/C1+ANSI cases stay green, which is what says the two halves of
 *   the sanitizer are independently pinned.
 *   ⚠️ RAWEXCERPT and NOBIDI are applied in **src/utils/text-sanitize.js**, not
 *   here — the sanitizer moved there in round 3 (see the extraction pin above).
 *   Both red sets were RE-MEASURED after the move and are unchanged, which is
 *   what says the move was a move and not a rewrite.
 * The parse layer is ALSO covered by `LOGBLIND`, `UNANCHORED`, `CUTATLASTPAIR`,
 * `THREENEWEST` and `NEXTFILE`, whose records live in tests/engine-log.test.js.
 * ⚠️ RE-RUN, NEVER RENUMBER: a recorded red set asserts the set still fails.
 */

const parse = require('../../src/utils/engine-log-parse');
const engineLog = require('../../src/utils/engine-log');

const {
  isErrorLine, extractMessage, collapseExcerpt, mentionsSession, lineIsAboutSession,
} = parse;

const SES = 'ses_w10fixture';
const ESC = '\u001b';

/**
 * The extraction pin (W10 round 2). `engine-log.js` re-exports these so a
 * consumer still has one import site; this asserts the re-exports are the SAME
 * function objects, not a second copy that could drift from the first.
 */
describe('the extraction from engine-log.js is a move, not a copy', () => {
  // `lineIsAboutSession` was missing from this set through round 2 (round-3
  // review B4) — the one re-export the correlation rules actually turn on.
  test.each([
    ['isErrorLine'], ['extractMessage'], ['collapseExcerpt'], ['mentionsSession'],
    ['lineIsAboutSession'],
  ])('engine-log.%s is engine-log-parse\'s own function object', (name) => {
    expect(typeof parse[name]).toBe('function');
    expect(engineLog[name]).toBe(parse[name]);
  });

  test('the read-bound constants are NOT part of the exported surface', () => {
    // They were internal to the resolver and nothing consumed them; a constant
    // in a `Key Exports` cell renders as a function it is not (round-2 B8).
    expect(engineLog.MAX_TAIL_BYTES).toBeUndefined();
    expect(engineLog.MAX_EXCERPT_CHARS).toBeUndefined();
  });
});

/**
 * The SECOND extraction pin (W10 round 3). The sanitizer moved on to
 * src/utils/text-sanitize.js once `engine-skew.js` became its second caller —
 * keeping it here would have made the skew detector depend on the log parser to
 * clean a version number. Both older import paths still work, and all three
 * names are ONE object: a copy is how "one sanitizer, one dialect" quietly
 * becomes two dialects with two sets of holes.
 */
describe('the extraction to text-sanitize.js is a move, not a copy', () => {
  const sanitize = require('../../src/utils/text-sanitize');

  test('parse, engine-log and text-sanitize all name the same function', () => {
    expect(typeof sanitize.collapseExcerpt).toBe('function');
    expect(parse.collapseExcerpt).toBe(sanitize.collapseExcerpt);
    expect(engineLog.collapseExcerpt).toBe(sanitize.collapseExcerpt);
  });

  test('MAX_EXCERPT_CHARS rides along, and is still the default cap', () => {
    expect(parse.MAX_EXCERPT_CHARS).toBe(sanitize.MAX_EXCERPT_CHARS);
    expect(sanitize.MAX_EXCERPT_CHARS).toBe(200);
    expect(collapseExcerpt('z'.repeat(500))).toHaveLength(sanitize.MAX_EXCERPT_CHARS);
  });

  test('engine-skew reaches the sanitizer WITHOUT going through the log parser', () => {
    // The dependency edge this extraction exists to delete: a version string is
    // not log-shaped, and the skew module has no other business here.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'utils', 'engine-skew.js'), 'utf-8');
    expect(src).toContain("require('./text-sanitize')");
    expect(src).not.toContain("require('./engine-log-parse')");
  });
});

/**
 * Round-2 review A2. `extractMessage` used to run the logfmt `error=`
 * extractor FIRST, on every line, so a columnar message that merely CONTAINS
 * `error=` was cut at that substring — MEASURED before the fix: `… id=ses_…
 * retry limit reached, error=true was set in config` returned
 * `"true was set in config"`, and `… could not parse error="x" flag` returned
 * `"x"`. Format detection is now per LINE SHAPE (a columnar line opens with a
 * bare level token), not per substring presence.
 */
describe('extractMessage: the format is decided by line shape, not by substring', () => {
  test('a bare error= INSIDE a columnar message is text, not a cut point', () => {
    expect(extractMessage(`ERROR 2026-08-25T18:55:37 +3ms service=default id=${SES} `
      + 'retry limit reached, error=true was set in config'))
      .toBe('retry limit reached, error=true was set in config');
  });

  test('a QUOTED error="…" inside a columnar message is text too', () => {
    expect(extractMessage(`ERROR 2026-08-25T18:55:37 +3ms service=default id=${SES} `
      + 'could not parse error="x" flag'))
      .toBe('could not parse error="x" flag');
  });

  test('control — a real logfmt line still yields its error= value', () => {
    expect(extractMessage(`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES} `
      + 'error="SQLiteError: no such column: fixture_seq"'))
      .toBe('SQLiteError: no such column: fixture_seq');
    expect(extractMessage(`time=2026-08-25T18:55:35Z level=ERROR session.id=${SES} `
      + 'error=fixture boom: two words')).toBe('fixture boom: two words');
  });
});

/**
 * Round-2 review B5. Two independent truncations in one heuristic.
 */
describe('extractMessage: the structural run and the quoted value', () => {
  test('a columnar line with NO key=value pairs loses its header, not its message', () => {
    // MEASURED before the fix: the whole line came back — level, timestamp and
    // all — because the run only ever advanced on `key=value` tokens, so a
    // pairless line never had a prefix to end.
    expect(extractMessage('ERROR 2026-08-25T18:55:38 +2ms 3 retries exhausted'))
      .toBe('3 retries exhausted');
  });

  test('a leading NUMBER token starts the message; it is not eaten as a header', () => {
    expect(extractMessage(`ERROR 2026-08-25T18:55:38 +2ms service=default id=${SES} `
      + '3 retries exhausted')).toBe('3 retries exhausted');
  });

  test('an ALL-CAPS word can still open a message — the header run ends at the first pair', () => {
    expect(extractMessage(`ERROR 2026-08-25T18:55:38 +2ms service=default id=${SES} `
      + 'FATAL disk error')).toBe('FATAL disk error');
  });

  test('an ESCAPED quote inside error="…" does not end the value', () => {
    // MEASURED before the fix: `he said \` — everything from the first escaped
    // quote on was dropped, and the backslash rode into the excerpt.
    expect(extractMessage(`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES} `
      + 'error="he said \\"boom\\" then died"')).toBe('he said "boom" then died');
  });

  test('a line with no structural token at all degrades to the whole line', () => {
    expect(extractMessage('something entirely unrecognized happened'))
      .toBe('something entirely unrecognized happened');
  });
});

/**
 * Round-3 review C5. The `error=` extractor was substring-driven over the whole
 * line, so an `error=` sitting inside ANOTHER field's quoted value was taken as
 * the message. It is now matched only as a TOP-LEVEL key — at a whitespace or
 * line-start boundary, outside every quoted value — by the same tokenizer the
 * structural run and the ownership rule use. One dialect, three consumers.
 */
describe('extractMessage: error= counts only as a top-level key', () => {
  test('an error= inside another field\'s quoted value is not the message', () => {
    // MEASURED before the fix: the bare-value branch matched the INNER one and
    // returned `timeout" error=connection refused by fixture` — the stray quote
    // and the real key both riding into the excerpt.
    expect(extractMessage(`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES} `
      + 'msg="db error=timeout" error=connection refused by fixture'))
      .toBe('connection refused by fixture');
  });

  test('a line whose ONLY error= sits inside a quoted value yields no stolen value', () => {
    // Correct by ABSTENTION: with no top-level `error=` the logfmt branch has
    // nothing to claim, the structural run covers the whole line, and the empty
    // excerpt is skipped by the resolver (which keeps scanning older lines).
    // MEASURED before the fix: `EACCES"`.
    expect(extractMessage(`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES} `
      + 'message="write failed: error=EACCES"')).toBe('');
  });

  test('control — a top-level error= is still extracted, quoted or bare', () => {
    expect(extractMessage(`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES} `
      + 'error="SQLiteError: no such column: fixture_seq"'))
      .toBe('SQLiteError: no such column: fixture_seq');
    expect(extractMessage(`time=2026-08-25T18:55:35Z level=ERROR session.id=${SES} `
      + 'error=fixture boom: two words')).toBe('fixture boom: two words');
  });
});

/**
 * Round-2 review B2. Death reports reach terminals and MCP surfaces, and engine
 * lines can embed provider text verbatim — so an excerpt can carry ANSI colour
 * codes and raw C0 control bytes straight out of a third party's error string.
 */
describe('collapseExcerpt: control characters and ANSI escapes never reach the excerpt', () => {
  test('ANSI SGR colour codes are stripped, C0 bytes become spaces', () => {
    expect(collapseExcerpt(`${ESC}[31mred${ESC}[0m and \u0007bell\u0000nul`))
      .toBe('red and bell nul');
  });

  // Deliberately different treatments: an escape SEQUENCE is formatting and
  // vanishes, so `a<esc>[2Kb` reads `ab`; a lone control BYTE may be standing
  // in for a separator, so it becomes a space rather than closing the gap.
  test('a cursor-move sequence is dropped; a DEL byte becomes a space', () => {
    expect(collapseExcerpt(`a${ESC}[2Kb\u007fc`)).toBe('ab c');
  });

  test('an OSC title-set sequence does not smuggle its payload through', () => {
    expect(collapseExcerpt(`${ESC}]0;pwned\u0007done`)).toBe('done');
  });

  test('the excerpt has no C0/C1 control character left anywhere', () => {
    const hostile = `${ESC}[1;31m\u0001\u0002\u0003boom\u009b31m${ESC}[0m`;
    // eslint-disable-next-line no-control-regex
    expect(collapseExcerpt(hostile)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  test('control — ordinary text is untouched', () => {
    expect(collapseExcerpt('SQLiteError: no such column: fixture_seq'))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  /**
   * Round-3 review A2. C0/C1 stripping is not enough: the BIDI controls are
   * ordinary printable-range code points that reorder every character after
   * them, so a third party's error text can rewrite the death report's own
   * sentence around itself: raw in a terminal, a RIGHT-TO-LEFT OVERRIDE makes
   * the rest of the line render backwards. Formatting, so they are DROPPED.
   */
  const BIDI = [
    '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', // the embedding/override set
    '\u2066', '\u2067', '\u2068', '\u2069', // the isolates
    '\u200e', '\u200f', '\u061c', // the marks
  ];
  /** All of them as one character class, for the sweep assertions. */
  const BIDI_CLASS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;

  test.each(BIDI.map((ch) => [`U+${ch.codePointAt(0).toString(16).toUpperCase()}`, ch]))(
    '%s is dropped from the excerpt', (_label, ch) => {
      expect(collapseExcerpt(`a${ch}b`)).toBe('ab');
    });

  test('a hostile run of bidi controls leaves none behind', () => {
    // RLI + RLO around a filename, then PDF + PDI. Rendered raw in a terminal
    // this reads as a different filename than the one the engine named.
    expect(collapseExcerpt('\u2066\u202edeleted \u202dgnp.txt\u202c\u2069'))
      .toBe('deleted gnp.txt');
  });

  test('bidi and control bytes together, in one excerpt', () => {
    const hostile = `${ESC}[31m\u202eboom\u0007\u2069${ESC}[0m`;
    // eslint-disable-next-line no-control-regex
    expect(collapseExcerpt(hostile)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(collapseExcerpt(hostile)).not.toMatch(BIDI_CLASS);
    expect(collapseExcerpt(hostile)).toBe('boom');
  });
});

/**
 * Round-2 review B6. The round-1 fix anchored the RIGHT edge of the id only, so
 * a token that merely ENDS with the id still matched.
 */
describe('mentionsSession: both edges of the id are anchored', () => {
  test('a token that ends with the id does not match it', () => {
    expect(mentionsSession(`session.id=X${SES} error="not ours at all"`, SES)).toBe(false);
    expect(mentionsSession(`prev_${SES} died`, SES)).toBe(false);
  });

  test('a token that extends the id on the right still does not match it', () => {
    expect(mentionsSession(`session.id=${SES}x9`, SES)).toBe(false);
    expect(mentionsSession(`session.id=${SES}_2`, SES)).toBe(false);
  });

  test('control — real separators on either side still match', () => {
    expect(mentionsSession(`session.id=${SES} error="x"`, SES)).toBe(true);
    expect(mentionsSession(`session.id="${SES}"`, SES)).toBe(true);
    expect(mentionsSession(`sessions=${SES},ses_other`, SES)).toBe(true);
    expect(mentionsSession(`ses_other,${SES}`, SES)).toBe(true);
    expect(mentionsSession(SES, SES)).toBe(true);
  });
});

/**
 * Round-2 review A1 — the sharp half of the correlation rule.
 *
 * A whole-token MENTION is not ownership. MEASURED before the fix, both of
 * these returned another session's failure as this leg's own:
 *   `… session.id=ses_other parent.id=<us> error="another session's failure"`
 *   `… session.id=ses_other write failed for storage/session/<us>/msg.json`
 * When a line names a session in a SESSION-identifying field, that field
 * decides whose line it is; a mention anywhere else is not evidence.
 *
 * Round 3 finished the job — see the next block: the field must also sit in the
 * line's STRUCTURAL region, and a line with no such field is not attributed at
 * all. These cases are unchanged by that, and still pass for the same reason.
 */
describe('lineIsAboutSession: a line another session OWNS is never borrowed', () => {
  test('a foreign session.id owns the line even when we are named elsewhere on it', () => {
    expect(lineIsAboutSession(
      'time=2026-08-25T18:55:32Z level=ERROR service=session session.id=ses_other '
      + `parent.id=${SES} error="another session's failure"`, SES)).toBe(false);
  });

  test('a foreign session.id owns the line even when our id sits in a path', () => {
    expect(lineIsAboutSession(
      'ERROR 2026-08-25T18:55:32 +2ms service=storage session.id=ses_other '
      + `write failed for storage/session/${SES}/msg.json`, SES)).toBe(false);
  });

  test.each([
    ['session.id', `session.id=${SES}`],
    ['id (the columnar spelling)', `id=${SES}`],
    ['sessionID', `sessionID=${SES}`],
    ['a quoted value', `session.id="${SES}"`],
    ['a comma-separated list', `sessions=${SES},ses_other`],
  ])('our own id in %s owns the line', (_label, field) => {
    expect(lineIsAboutSession(`ERROR 2026-08-25T18:55:32 +2ms service=default ${field} boom`, SES))
      .toBe(true);
  });

  test('a non-session field named "…id" does not get a vote', () => {
    // `parent.id` / `message.id` are not session identity; only the exact
    // session spellings are, or `parent.id=<us>` would hand us a foreign line.
    expect(lineIsAboutSession(
      `ERROR 2026-08-25T18:55:39 +1ms id=ses_other message.id=${SES} boom`, SES)).toBe(false);
  });
});

/**
 * Round-3 review A1+B2 — the ownership rule's LAST hole, closed by the lead's
 * ruling: ownership comes ONLY from a session-identity field in the line's
 * STRUCTURAL region (the `key=value` block before the message; in logfmt every
 * top-level `key=value` token is structural). A line with NO recognized
 * session-identity field is NEVER attributed. Precision over recall — the miss
 * path is the pinned byte-identical fallback, and the skew clause is
 * independent of it, so an unattributed line costs a nicety, while a wrong
 * attribution quotes a stranger's failure into this leg's death report.
 *
 * ROUND 2 KEPT A BARE-MENTION FALLBACK ("no session field ⇒ any whole-token
 * mention wins the line"), which left both halves of this open:
 *   A1 — a foreign line's FREE TEXT still voted, since a line that names no
 *        session in a field at all was decided by its prose.
 *   B2 — a `session.id=`-shaped token INSIDE free text regained a vote, because
 *        the field scan split on whitespace and never asked WHERE on the line
 *        the token sat.
 * Both directions are pinned below.
 */
describe('lineIsAboutSession: only a STRUCTURAL session field can attribute a line', () => {
  test('a line with NO session field is never attributed, however clearly it names us', () => {
    expect(lineIsAboutSession(`ERROR 2026-08-25T18:55:39 +1ms crash while flushing ${SES} buffers`, SES))
      .toBe(false);
  });

  test('a lone non-session "…id" field is not identity either', () => {
    expect(lineIsAboutSession(`ERROR 2026-08-25T18:55:39 +1ms message.id=${SES} boom`, SES))
      .toBe(false);
  });

  test('a session.id= shaped token in a COLUMNAR message does not vote', () => {
    // The line is another session's; our id only appears in the storage path it
    // was writing. Round 2 read that path fragment as a session field.
    expect(lineIsAboutSession('ERROR 2026-08-25T18:55:34 +2ms service=storage id=ses_other '
      + `write failed for session.id=${SES}`, SES)).toBe(false);
  });

  test('and free text cannot MANUFACTURE ownership on a line with no structural session field', () => {
    expect(lineIsAboutSession('ERROR 2026-08-25T18:55:34 +2ms service=storage '
      + `retry queue still holds session.id=${SES}`, SES)).toBe(false);
  });

  test('a session id inside another field\'s QUOTED value does not vote', () => {
    expect(lineIsAboutSession('time=2026-08-25T18:55:32Z level=ERROR session.id=ses_other '
      + `error="lost session.id=${SES} mid-write"`, SES)).toBe(false);
  });

  test('nor in the free text of an UNQUOTED logfmt value', () => {
    // `error=` unquoted runs to end of line by convention, so everything after
    // it is prose — including anything shaped like a field.
    expect(lineIsAboutSession('time=2026-08-25T18:55:32Z level=ERROR session.id=ses_other '
      + `error=write failed for session.id=${SES}`, SES)).toBe(false);
  });

  test('control — a structural field AFTER a quoted one still owns the line', () => {
    // The other direction of the same rule: a quoted value is one token, so it
    // does not end the structural run, and the fields past it still count.
    expect(lineIsAboutSession('time=2026-08-25T18:55:32Z level=ERROR msg="starting up" '
      + `session.id=${SES} error="boom"`, SES)).toBe(true);
  });
});

describe('isErrorLine: unchanged by the extraction', () => {
  test('both formats are recognized, and non-ERROR levels are not', () => {
    expect(isErrorLine(`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES}`)).toBe(true);
    expect(isErrorLine(`ERROR 2026-08-25T18:55:32 +2ms id=${SES}`)).toBe(true);
    expect(isErrorLine(`time=2026-08-25T18:55:32Z level=WARN session.id=${SES}`)).toBe(false);
    expect(isErrorLine(`WARN 2026-08-25T18:55:32 +2ms id=${SES}`)).toBe(false);
  });
});
