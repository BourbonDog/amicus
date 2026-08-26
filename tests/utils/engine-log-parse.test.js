'use strict';

/**
 * v4.9 W10 round 2 — src/utils/engine-log-parse.js, the line-shape half of the
 * engine-log resolver, extracted from src/utils/engine-log.js and then fixed.
 *
 * EVERY FIXTURE HERE IS SYNTHETIC. No line was copied from a real engine log on
 * any machine: the two line SHAPES come from the plan's recon (logfmt at 1.17.x,
 * columnar at 1.2.x) and every payload is invented.
 *
 * Control bytes are written as `\u….` escapes, never as literal bytes — a
 * literal ESC in the source makes this file binary to `grep` and invisible to
 * the fragment sweeps the review process depends on.
 *
 * ── NAMED MUTANTS with MEASURED red sets ───────────────────────────────────
 * Scope for all three: this suite + tests/engine-log.test.js + the wiring suite
 * (`npx jest tests/engine-log.test.js tests/utils/engine-log-parse.test.js
 * tests/no-output-backstop-wiring.test.js --maxWorkers=2` → 3 suites / 91 tests
 * at HEAD). Measured 2026-08-26, each applied alone and reverted; sources
 * restored by byte copy and checksum-verified, never by `git checkout`.
 *
 * `OWNEDBYOTHER` — `lineIsAboutSession` degrades to `mentionsSession`, the
 *   pre-round-2 behaviour (any whole-token mention wins the line):
 *   **2 suites / 4 tests red** — the two foreign-`session.id` tests here, the
 *   "…id does not get a vote" test here, and "a line another session OWNS is
 *   skipped even though it names us" in tests/engine-log.test.js.
 * `LOGFMTFIRST` — `extractMessage` runs the `error=` extractor before the
 *   columnar shape test, the pre-round-2 precedence: **1 suite / 2 tests red**,
 *   both here — the bare and the quoted `error=`-inside-a-columnar-message
 *   cases. The whole B5/B6/A1 block stays green, which is the point: this
 *   mutant is precisely scoped to A2.
 * `RAWEXCERPT` — `collapseExcerpt` drops the control/ANSI sanitize pass:
 *   **1 suite / 4 tests red**, all four sanitize cases here. "control —
 *   ordinary text is untouched" stays green by design: it is the pin that says
 *   the sanitizer does not disturb an excerpt that needed nothing.
 * The parse layer is ALSO covered by `LOGBLIND`, `UNANCHORED`, `CUTATLASTPAIR`
 * and `THREENEWEST`, whose records live in tests/engine-log.test.js.
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
  test.each([
    ['isErrorLine'], ['extractMessage'], ['collapseExcerpt'], ['mentionsSession'],
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

  test('with NO session field on the line at all, a whole-token mention still counts', () => {
    // The rule is "another session owns this line", not "only keyed lines
    // count" — dropping unkeyed lines would re-introduce the silent miss this
    // module exists to end.
    expect(lineIsAboutSession(`ERROR 2026-08-25T18:55:39 +1ms crash while flushing ${SES} buffers`, SES))
      .toBe(true);
  });

  test('a non-session field named "…id" does not get a vote', () => {
    // `parent.id` / `message.id` are not session identity; only the exact
    // session spellings are, or `parent.id=<us>` would hand us a foreign line.
    expect(lineIsAboutSession(`ERROR 2026-08-25T18:55:39 +1ms message.id=${SES} boom`, SES))
      .toBe(true); // no SESSION field on the line ⇒ the mention still counts
    expect(lineIsAboutSession(
      `ERROR 2026-08-25T18:55:39 +1ms id=ses_other message.id=${SES} boom`, SES)).toBe(false);
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
