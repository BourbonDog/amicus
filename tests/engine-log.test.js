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
 * ── NAMED MUTANT `LOGBLIND`, with its MEASURED red set ────────────────────
 * MUTATION: `engineErrorForSession` returns null unconditionally — i.e. the
 * resolver ships but is blind, the exact silent degrade this module exists to
 * end (a leg dies, the engine's line is on disk, nothing quotes it).
 * Applied as the first statement of the function body in src/utils/engine-log.js.
 *
 * MEASURED red set (2026-08-25, focused scope: this suite + the wiring suite,
 * `npx jest tests/engine-log.test.js tests/no-output-backstop-wiring.test.js
 * --maxWorkers=2` → 2 suites / 42 tests): 2 suites / 14 tests.
 *   tests/engine-log.test.js — 12: every test that expects a NON-null excerpt
 *     (both format tests, the unquoted-value test, newest-file, last-line,
 *     bare-id, empty-excerpt-fallthrough, in-tail match, legacy-candidate,
 *     CRLF, 200-char collapse, whitespace collapse).
 *   tests/no-output-backstop-wiring.test.js — 2: the poll-loop and pre-send
 *     firing sites (`… — engine log: <excerpt>`).
 *
 * GREEN BY DESIGN under LOGBLIND — and this is the point, not a gap: every
 * miss-path test asserts null, and the four wiring controls assert the message
 * is BYTE-IDENTICAL to today's. A blind resolver satisfies all of them, which
 * is precisely what "clean fallback" means. The two bound tests that assert
 * null ("older match beyond the tail is invisible", "a 4th-newest file is NOT
 * read") therefore cannot, alone, tell a respected bound from a dead resolver
 * — each is deliberately PAIRED with a positive twin in the red set ("a match
 * INSIDE the tail is found", "the legacy opencode.log stays a candidate"), and
 * it is the pair that pins the bound.
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

  test('at most the 3 newest timestamped files are read, but the legacy opencode.log stays a candidate', () => {
    const dataDir = makeDataDir();
    // Four newer timestamped files with no match, plus the OLD legacy file that has one.
    for (let i = 0; i < 4; i++) {
      writeLog(dataDir, `2026-08-25T18553${i}.log`, ['nothing for us here'], 5000 + i);
    }
    writeLog(dataDir, 'opencode.log', [LOGFMT_ERROR], 1000);
    expect(engineErrorForSession(SES, { dataDir }))
      .toBe('SQLiteError: no such column: fixture_seq');
  });

  test('a 4th-newest timestamped file is NOT read (the bound is real, not decorative)', () => {
    const dataDir = makeDataDir();
    writeLog(dataDir, '2026-08-25T185500.log', [LOGFMT_ERROR], 1000); // oldest, has the match
    for (let i = 0; i < 3; i++) {
      writeLog(dataDir, `2026-08-25T18553${i}.log`, ['nothing for us here'], 5000 + i);
    }
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
