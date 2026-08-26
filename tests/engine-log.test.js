'use strict';

/**
 * v4.9 W10 Task A (#133 piece 2) — src/utils/engine-log.js.
 *
 * WHAT IT EXISTS FOR: when a leg dies silent the NO_OUTPUT_BACKSTOP message
 * used to carry a guess. The engine's OWN error line for that session was
 * sitting on disk the entire time (#133: 30 minutes of debugging spent at
 * model ids and API keys while a `no such column` error sat in the engine log).
 * This resolver reads it, so the death report can quote the truth.
 *
 * EVERY FIXTURE HERE IS SYNTHETIC. No line in this file was copied from a real
 * engine log on any machine — the two line SHAPES are taken from the plan's
 * recon (logfmt at 1.17.x, columnar at 1.2.x) and the payloads are invented.
 *
 * THE LINE-SHAPE RULES MOVED (round 2): `isErrorLine`, `extractMessage`,
 * `collapseExcerpt`, `mentionsSession` and `lineIsAboutSession` now live in
 * src/utils/engine-log-parse.js and are unit-tested in
 * tests/utils/engine-log-parse.test.js. This suite drives them end to end
 * through the resolver, which is where the correlation rules actually have to
 * hold. Both suites share the mutant bench below.
 *
 * ── NAMED MUTANT `LOGBLIND`, with its MEASURED red set ────────────────────
 * MUTATION: `engineErrorForSession` returns null unconditionally — i.e. the
 * resolver ships but is blind, the exact silent degrade this module exists to
 * end (a leg dies, the engine's line is on disk, nothing quotes it).
 * Applied as the first statement of the function body in src/utils/engine-log.js.
 *
 * MEASURED red set (RE-MEASURED 2026-08-26 for round 3 — the record read 25
 * before the round-3 tests; the three earlier numbers, 14, 23 and 25, are
 * retired. Focused scope: this suite + the parse suite + the wiring suite,
 * `npx jest tests/engine-log.test.js tests/utils/engine-log-parse.test.js
 * tests/no-output-backstop-wiring.test.js --maxWorkers=2` → 3 suites / 121
 * tests): **2 suites / 28 tests red.**
 *   tests/engine-log.test.js — 23: every test that expects a NON-null excerpt
 *     (both format tests, the unquoted-value test, the interior-`key=value`
 *     test, newest-file, last-line, bare-id, exact-id-beats-longer-id,
 *     non-id-boundary, owned-by-another-session, the empty-excerpt group — the
 *     next-file fallthrough plus the three round-3 same-file cases — in-tail
 *     match, legacy-candidate, mass-death-wave, CRLF, 200-char collapse,
 *     whitespace collapse, and all three union-of-candidate-dirs tests).
 *   tests/no-output-backstop-wiring.test.js — 5: the Task A poll-loop and
 *     pre-send firing sites, and the three Task B cases that carry an excerpt
 *     (the #133 composite, its pre-send twin, and the no-skew control).
 *   tests/utils/engine-log-parse.test.js — 0, by construction: it calls the
 *     parse functions directly and never goes through the resolver.
 *
 * GREEN BY DESIGN under LOGBLIND — and this is the point, not a gap: every
 * miss-path test asserts null, and the four wiring controls assert the message
 * is BYTE-IDENTICAL to today's. A blind resolver satisfies all of them, which
 * is precisely what "clean fallback" means. The two bound tests that assert
 * null ("older match beyond the tail is invisible", "the scan stops at 2 MiB
 * read") therefore cannot, alone, tell a respected bound from a dead resolver
 * — each is deliberately PAIRED with a positive twin in the red set ("a match
 * INSIDE the tail is found", "a mass-death wave: this leg's own log answers even
 * at 5th-newest"), and it is the pair that pins the bound. The same pairing
 * covers the round-1 review's own null-asserting test ("a LONGER id is never
 * borrowed"), whose twin is "the EXACT id still wins".
 *
 * ── THE OTHER NAMED MUTANTS (all measured 2026-08-26 on the same 3-suite
 *    scope; each applied alone and reverted, sources restored by byte copy and
 *    checksum-verified — never by `git checkout`) ────────────────────────────
 * `UNANCHORED` — `mentionsSession` degrades to `line.includes(needle)`, the
 *   pre-round-1 behaviour: **2 suites / 4 tests red** (was 2 before the round-2
 *   left-boundary tests) — here, "a LONGER id is never borrowed" and "the EXACT
 *   id still wins"; in the parse suite, both `mentionsSession` anchor tests.
 * `FIRSTDIRONLY` — `existingEngineLogDirs` returns after the first existing
 *   dir: **1 suite / 2 tests red**, both here — "a stale XDG dir does not
 *   shadow…" and "a present-but-EMPTY XDG dir does not swallow…". The third
 *   union test stays green by design: it is the control that proves the fix did
 *   not invert precedence.
 * `CUTATLASTPAIR` — the structural run keeps scanning past the message, so it
 *   ends at the last `key=value` anywhere on the line: **2 suites / 6 tests red**
 *   (was 1, then 3) — "a key=value INSIDE a columnar message is text" here, plus
 *   both round-2 A2 cases and three round-3 ownership cases in the parse suite.
 *   The run is now shared by the message cut AND the ownership rule, which is
 *   exactly why one mutation reds both.
 * `THREENEWEST` — `candidateLogFiles` truncates to the 3 newest by mtime, the
 *   pre-round-2 bound: **1 suite / 2 tests red**, both here — "a mass-death
 *   wave…" and "the legacy opencode.log is just another candidate". That second
 *   one is what says the retired reserved slot is genuinely unnecessary now.
 * `NEXTFILE` — round-3 review C4: an empty excerpt ends the FILE's scan instead
 *   of continuing to older lines in it: **1 suite / 2 tests red**, both here —
 *   "an empty excerpt keeps scanning OLDER lines in the SAME file" and "…
 *   exhausts the file before moving on". "a file with ONLY empty excerpts still
 *   yields to the next file" stays GREEN by design: it is the control that says
 *   the fix did not cost the cross-file fallthrough it builds on.
 * `OWNEDBYOTHER`, `BAREMENTION`, `WHOLELINEFIELDS`, `LOGFMTFIRST`,
 *   `ERRORANYWHERE`, `RAWEXCERPT`, `NOBIDI` — the parse-layer mutants; their red
 *   sets are recorded in tests/utils/engine-log-parse.test.js.
 * ⚠️ RE-RUN, NEVER RENUMBER: a recorded red set asserts the set still fails.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { engineErrorForSession, engineLogDirCandidates } = require('../src/utils/engine-log');

const SES = 'ses_w10fixture';

/** Every temp data dir made by a test, torn down in afterAll. */
const MADE = [];

/**
 * Build a data dir containing `opencode/log/` — the resolver's `dataDir` seam
 * is the XDG-style DATA dir (it appends `opencode/log` itself), mirroring
 * `$XDG_DATA_HOME` in src/utils/auth-json.js :: authJsonCandidates.
 */
function makeDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-engine-log-'));
  MADE.push(dir);
  fs.mkdirSync(path.join(dir, 'opencode', 'log'), { recursive: true });
  return dir;
}

/** Write one synthetic log file; `mtimeSec` pins mtime so ordering is deterministic. */
function writeLog(dataDir, name, body, mtimeSec) {
  const file = path.join(dataDir, 'opencode', 'log', name);
  fs.writeFileSync(file, Array.isArray(body) ? `${body.join('\n')}\n` : body);
  if (mtimeSec) { fs.utimesSync(file, mtimeSec, mtimeSec); }
  return file;
}

const LOGFMT_ERROR = `time=2026-08-25T18:55:32Z level=ERROR service=session session.id=${SES} `
  + 'error="SQLiteError: no such column: fixture_seq"';
const LOGFMT_INFO = `time=2026-08-25T18:55:30Z level=INFO service=session session.id=${SES} `
  + 'message="session created"';
const COLUMNAR_ERROR = `ERROR 2026-08-25T18:55:34 +2ms service=default id=${SES} `
  + 'fixture endpoint refused the connection';

afterAll(() => {
  for (const dir of MADE) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
  }
});

describe('engineErrorForSession: the two real line formats', () => {
  test('logfmt (1.17.x): extracts the quoted error= value for this session', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [LOGFMT_INFO, LOGFMT_ERROR]);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('columnar (1.2.x): no error= key, so the line\'s trailing message is the excerpt', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185534.log', [COLUMNAR_ERROR]);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('fixture endpoint refused the connection');
  });

  test('an unquoted logfmt error= value keeps the whole rest of the line, not just one token', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185535.log',
      [`time=2026-08-25T18:55:35Z level=ERROR session.id=${SES} error=fixture boom: two words`]);
    expect(engineErrorForSession(SES, { dataDir })).toBe('fixture boom: two words');
  });

  /**
   * W10 round-1 review B2: the columnar branch used to cut the message at the
   * LAST `key=value` token anywhere on the line, so an engine error that quotes
   * a setting mid-sentence lost everything before it. The structural prefix
   * (`ERROR <iso> +Nms service=… id=…`) is what ends; a `key=value` INSIDE the
   * human text is just text.
   */
  test('a key=value INSIDE a columnar message is text, not a cut point', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185536.log',
      [`ERROR 2026-08-25T18:55:36 +3ms service=default id=${SES} `
        + 'could not parse foo=bar in the fixture config']);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('could not parse foo=bar in the fixture config');
  });

  test('both schemes in one dir: the NEWEST file\'s match wins', () => {
    const dataDir = makeDataDir();
    // The legacy single file is OLDER; a per-process timestamped file is newer.
    writeLog(dataDir, 'opencode.log', [LOGFMT_ERROR], 1000);
    writeLog(dataDir, '2026-08-25T185534.log', [COLUMNAR_ERROR], 2000);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('fixture endpoint refused the connection');
  });

  test('within one file the LAST matching ERROR line wins (append-ordered logs)', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      `time=2026-08-25T18:55:31Z level=ERROR session.id=${SES} error="first fixture failure"`,
      LOGFMT_INFO,
      `time=2026-08-25T18:55:33Z level=ERROR session.id=${SES} error="second fixture failure"`,
    ]);
    expect(engineErrorForSession(SES, { dataDir })).toBe('second fixture failure');
  });
});

describe('engineErrorForSession: correlation and filtering', () => {
  test('a bare id (no ses_ prefix) is matched as ses_<id> — createSession returns the prefixed form, callers may not', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [LOGFMT_ERROR]);
    expect(engineErrorForSession('w10fixture', { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('another session\'s ERROR line is never borrowed', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log',
      ['time=2026-08-25T18:55:32Z level=ERROR session.id=ses_someoneelse error="not yours"']);
    expect(engineErrorForSession(SES, { dataDir })).toBeNull();
  });

  /**
   * W10 round-1 review A1+B4: the correlation used to be a bare substring test,
   * and a session id is a PREFIX of every longer id that starts with it —
   * MEASURED on this machine's own engine logs (2026-08-25): 369 distinct ids,
   * every one exactly 30 chars (`ses_` + 26) and every one PURE `[A-Za-z0-9]`
   * after the prefix, so "the next character is not an id character" is a real
   * boundary and not a guess about the charset.
   */
  test('a LONGER id is never borrowed: ses_<id>x9 does not answer for ses_<id>', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      `time=2026-08-25T18:55:32Z level=ERROR session.id=${SES}x9 error="a longer id's failure"`,
    ]);
    expect(engineErrorForSession(SES, { dataDir })).toBeNull();
  });

  test('the EXACT id still wins when a longer id\'s line sits after it in the same file', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      LOGFMT_ERROR,
      `time=2026-08-25T18:55:33Z level=ERROR session.id=${SES}x9 error="a longer id's failure"`,
    ]);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('any NON-id character ends the id — quoted, comma-separated, or end of line', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      `time=2026-08-25T18:55:32Z level=ERROR session.id="${SES}" error="quoted id fixture"`,
    ]);
    expect(engineErrorForSession(SES, { dataDir })).toBe('quoted id fixture');

    const dataDir2 = makeDataDir();
    writeLog(dataDir2, '2026-08-25T185533.log',
      [`ERROR 2026-08-25T18:55:33 +1ms service=default id=${SES}`, // id at end of line
        `ERROR 2026-08-25T18:55:34 +1ms service=default sessions=${SES},ses_other trailing fixture`]);
    expect(engineErrorForSession(SES, { dataDir: dataDir2 })).toBe('trailing fixture');
  });

  /**
   * W10 round-2 review A1. A whole-token mention is not ownership: an ERROR
   * line whose OWN `session.id` names a different session can still carry our
   * id somewhere else (a parent field, a storage path), and the resolver used
   * to hand that stranger's failure to this leg verbatim. The scan skips it and
   * keeps walking back to a line that is actually ours.
   */
  test('a line another session OWNS is skipped even though it names us', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      LOGFMT_ERROR,
      'time=2026-08-25T18:55:33Z level=ERROR service=session session.id=ses_other '
      + `parent.id=${SES} error="another session's failure"`,
      'ERROR 2026-08-25T18:55:34 +2ms service=storage session.id=ses_other '
      + `write failed for storage/session/${SES}/msg.json`,
    ]);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('non-ERROR lines mentioning the session are ignored (INFO/WARN are not failures)', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      LOGFMT_INFO,
      `time=2026-08-25T18:55:31Z level=WARN service=session session.id=${SES} message="slow fixture"`,
      `WARN 2026-08-25T18:55:33 +1ms id=${SES} still slow`,
    ]);
    expect(engineErrorForSession(SES, { dataDir })).toBeNull();
  });

  test('an empty excerpt is not returned — the file falls through to the next candidate', () => {
    const dataDir = makeDataDir();
    // Newest file: an ERROR line for this session whose message part is empty.
    writeLog(dataDir, '2026-08-25T185540.log', [`ERROR 2026-08-25T18:55:40 +0ms id=${SES}`], 3000);
    writeLog(dataDir, '2026-08-25T185532.log', [LOGFMT_ERROR], 2000);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  /**
   * W10 round-3 review C4. The empty-excerpt fallthrough used to skip to the
   * next FILE, so an older line in the SAME file — the one that actually says
   * what happened — was never reached. In the shape that matters the two lines
   * are neighbours: the engine logs its real failure and then a terse, message-
   * less line as the session tears down. The whole file is already in memory by
   * then, so continuing costs nothing and the byte budget still bounds the scan.
   */
  test('an empty excerpt keeps scanning OLDER lines in the SAME file', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      LOGFMT_ERROR, // older, and the only line that carries a message
      `ERROR 2026-08-25T18:55:40 +0ms id=${SES}`, // newest match: nothing to quote
    ]);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('and it exhausts the file before moving on, rather than stopping at the first gap', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [
      LOGFMT_ERROR,
      `ERROR 2026-08-25T18:55:38 +0ms id=${SES}`,
      `ERROR 2026-08-25T18:55:39 +0ms service=default id=${SES}`,
      `ERROR 2026-08-25T18:55:40 +0ms id=${SES}`,
    ]);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('control — a file with ONLY empty excerpts still yields to the next file', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185540.log', [
      `ERROR 2026-08-25T18:55:40 +0ms id=${SES}`,
      `ERROR 2026-08-25T18:55:41 +0ms service=default id=${SES}`,
    ], 3000);
    writeLog(dataDir, '2026-08-25T185532.log', [LOGFMT_ERROR], 2000);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });
});

describe('engineErrorForSession: every miss path returns null (the clean fallback)', () => {
  test('no data dir at all', () => {
    const dataDir = path.join(os.tmpdir(), `amicus-engine-log-absent-${Date.now()}`);
    expect(engineErrorForSession(SES, { dataDir })).toBeNull();
  });

  test('log dir exists but holds no .log files', () => {
    const dataDir = makeDataDir();
    fs.writeFileSync(path.join(dataDir, 'opencode', 'log', 'notes.txt'), 'not a log\n');
    expect(engineErrorForSession(SES, { dataDir })).toBeNull();
  });

  test('an empty session id', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', [LOGFMT_ERROR]);
    expect(engineErrorForSession('', { dataDir })).toBeNull();
    expect(engineErrorForSession(undefined, { dataDir })).toBeNull();
  });

  test('a hostile fs never throws out of the resolver — a log read must not break a leg\'s death report', () => {
    const boom = () => { throw new Error('fixture fs is down'); };
    const hostileFs = { existsSync: boom, readdirSync: boom, statSync: boom, openSync: boom };
    expect(engineErrorForSession(SES, { dataDir: '/nope', fs: hostileFs })).toBeNull();
  });
});

describe('engineErrorForSession: bounded reads', () => {
  test('only the LAST 256 KiB of a file is read — an older match beyond the tail is invisible', () => {
    const dataDir = makeDataDir();
    const filler = `${'x'.repeat(120)}\n`.repeat(3000); // ~363 KiB of padding
    writeLog(dataDir, '2026-08-25T185532.log',
      `time=2026-08-25T18:00:00Z level=ERROR session.id=${SES} error="beyond the tail"\n${filler}`);
    expect(engineErrorForSession(SES, { dataDir })).toBeNull();
  });

  test('a match INSIDE the tail of that same oversized file is found', () => {
    const dataDir = makeDataDir();
    const filler = `${'x'.repeat(120)}\n`.repeat(3000);
    writeLog(dataDir, '2026-08-25T185532.log', `${filler}${LOGFMT_ERROR}\n`);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('the legacy opencode.log is just another candidate, reached in mtime order', () => {
    const dataDir = makeDataDir();
    // Four newer timestamped files with no match, plus the OLD legacy file that has one.
    for (let i = 0; i < 4; i++) {
      writeLog(dataDir, `2026-08-25T18553${i}.log`, ['nothing for us here'], 5000 + i);
    }
    writeLog(dataDir, 'opencode.log', [LOGFMT_ERROR], 1000);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  /**
   * W10 round-2 review B1 — the sharp one. The cut used to be "the 3 newest
   * files by mtime", and the engine writes ONE log PER PROCESS. In a mass-death
   * wave every seat has its own file and the SURVIVORS keep writing, so the
   * dead leg's own log is pushed down the mtime order by the very legs that did
   * not die — the excerpt went missing precisely in the wave it exists for.
   * The bound is now on BYTES READ, not on how many files may be opened.
   */
  test('a mass-death wave: this leg\'s own log answers even at 5th-newest', () => {
    const dataDir = makeDataDir();
    for (let i = 0; i < 4; i++) { // four survivors, still writing
      writeLog(dataDir, `2026-08-25T18560${i}.log`, ['nothing for us here'], 9000 + i);
    }
    writeLog(dataDir, '2026-08-25T185532.log', [LOGFMT_ERROR], 5000); // 5th-newest: ours
    writeLog(dataDir, '2026-08-25T185500.log', ['older still'], 1000);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  /**
   * The bound that replaced the file count, pinned in the direction that costs
   * something: PAIRED with the test above, which is what proves this null comes
   * from a respected budget rather than from a dead resolver.
   */
  test('the scan stops at 2 MiB read — a match past the budget is invisible', () => {
    const dataDir = makeDataDir();
    const bulk = `${'x'.repeat(120)}\n`.repeat(2600); // ~315 KiB: over one tail read
    for (let i = 0; i < 8; i++) { // 8 x 256 KiB of tail = the whole budget
      writeLog(dataDir, `2026-08-25T1857${String(i).padStart(2, '0')}.log`, bulk, 9000 + i);
    }
    writeLog(dataDir, '2026-08-25T185500.log', [LOGFMT_ERROR], 1000); // 9th-newest
    expect(engineErrorForSession(SES, { dataDir })).toBeNull();
  });
});

describe('engineErrorForSession: the excerpt is one short line', () => {
  test('CRLF files yield a carriage-return-free, newline-free excerpt', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log', `${LOGFMT_INFO}\r\n${LOGFMT_ERROR}\r\n`);
    const excerpt = engineErrorForSession(SES, { dataDir });
    expect(excerpt).toBe('SQLiteError: no such column: fixture_seq');
    expect(excerpt).not.toMatch(/[\r\n]/);
  });

  test('a very long error value is collapsed to at most 200 characters', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log',
      [`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES} error="${'z'.repeat(500)}"`]);
    const excerpt = engineErrorForSession(SES, { dataDir });
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  test('interior whitespace runs collapse to single spaces', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185532.log',
      [`time=2026-08-25T18:55:32Z level=ERROR session.id=${SES} error="a\t\tb   c"`]);
    expect(engineErrorForSession(SES, { dataDir })).toBe('a b c');
  });
});

/**
 * W10 round-1 review A2: the resolver used to stop at the FIRST candidate dir
 * that exists, so a present-but-stale (or empty) XDG dir shadowed the dir the
 * live engine is actually writing to — the silent, forever miss this module was
 * built to end, reintroduced one layer up. The candidates are now a UNION.
 *
 * Driven through the REAL `env` path (not the `dataDir` override, which is a
 * single dir by construction and cannot exercise this). The second candidate is
 * `~/.local/share/opencode/log`, whose location no env var controls, so the fs
 * seam redirects that one virtual prefix onto a temp tree — the test never
 * reads or writes the developer's own engine logs, and the outcome does not
 * depend on whether that machine happens to have any.
 */
describe('engineErrorForSession: EVERY existing candidate dir is searched', () => {
  const HOME_DATA = path.join(os.homedir(), '.local', 'share');

  /** Real fs, with the `~/.local/share` candidate rebased onto `toPrefix`. */
  function redirectingFs(toPrefix) {
    const at = (p) => {
      const s = String(p);
      return s.startsWith(HOME_DATA) ? path.join(toPrefix, s.slice(HOME_DATA.length)) : s;
    };
    return {
      existsSync: (p) => fs.existsSync(at(p)),
      readdirSync: (p) => fs.readdirSync(at(p)),
      statSync: (p) => fs.statSync(at(p)),
      openSync: (p, flags) => fs.openSync(at(p), flags),
      readSync: (...args) => fs.readSync(...args),
      closeSync: (fd) => fs.closeSync(fd),
    };
  }

  /** XDG points at a real fixture dir; the win32 APPDATA candidate does not exist. */
  const unionEnv = (xdg) => ({
    XDG_DATA_HOME: xdg,
    APPDATA: path.join(os.tmpdir(), `amicus-engine-log-no-appdata-${Date.now()}`),
  });

  const XDG_STALE = `time=2026-08-25T18:00:00Z level=ERROR session.id=${SES} `
    + 'error="stale xdg failure"';

  test('a stale XDG dir does not shadow the newest match in ~/.local/share', () => {
    const xdg = makeDataDir();
    const homeData = makeDataDir();
    writeLog(xdg, '2026-08-25T180000.log', [XDG_STALE], 1000);
    writeLog(homeData, '2026-08-25T185532.log', [LOGFMT_ERROR], 5000);

    expect(engineErrorForSession(SES, { env: unionEnv(xdg), fs: redirectingFs(homeData) }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('a present-but-EMPTY XDG dir does not swallow the search', () => {
    const xdg = makeDataDir(); // exists; holds no .log file at all
    const homeData = makeDataDir();
    writeLog(homeData, '2026-08-25T185532.log', [LOGFMT_ERROR], 5000);

    expect(engineErrorForSession(SES, { env: unionEnv(xdg), fs: redirectingFs(homeData) }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('control — the union did not invert precedence: a newest XDG file still wins', () => {
    // Paired with the first test: that one proves the search no longer stops at
    // the first existing dir, this one proves mtime — not dir order — is what
    // decides, in the direction where the old behaviour was already right.
    const xdg = makeDataDir();
    const homeData = makeDataDir();
    writeLog(xdg, '2026-08-25T185540.log', [LOGFMT_ERROR], 9000);
    writeLog(homeData, '2026-08-25T180000.log', [XDG_STALE], 1000);

    expect(engineErrorForSession(SES, { env: unionEnv(xdg), fs: redirectingFs(homeData) }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });
});

describe('engineLogDirCandidates: the auth-json.js precedent', () => {
  test('XDG_DATA_HOME comes first, ~/.local/share/opencode/log always follows', () => {
    const candidates = engineLogDirCandidates({ XDG_DATA_HOME: path.join('/xdg', 'data') });
    expect(candidates[0]).toBe(path.join('/xdg', 'data', 'opencode', 'log'));
    expect(candidates.some(c => c === path.join(os.homedir(), '.local', 'share', 'opencode', 'log')))
      .toBe(true);
  });

  test('without XDG_DATA_HOME the ~/.local/share path leads — same order as src/utils/auth-json.js :: authJsonCandidates', () => {
    const candidates = engineLogDirCandidates({});
    expect(candidates[0]).toBe(path.join(os.homedir(), '.local', 'share', 'opencode', 'log'));
  });

  test('candidates are de-duplicated', () => {
    const candidates = engineLogDirCandidates({ XDG_DATA_HOME: path.join(os.homedir(), '.local', 'share') });
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
