// tests/electron-refusal-sanitize.test.js
'use strict';

/**
 * F5 — attacker text is no longer echoed verbatim (v4.9.6, council seat B5).
 *
 * "Unsafe-archive and unreadable refusals echo the archive's own
 * (attacker-controlled) entry name or error text verbatim into stderr and into
 * the returned reason that postinstall and doctor print."
 *
 * Two of the strings in an Electron refusal are written by the party the refusal
 * is about:
 *   - an UNSAFE-ARCHIVE refusal quotes extract-zip's message, which quotes the
 *     archive's own entry name;
 *   - a cached artifact's PATH carries a `<sha>` directory name read out of a
 *     cache root anyone can write.
 * Unsanitized, either can carry ANSI escapes, a newline plus a forged
 * `[amicus] …` line, or a right-to-left override that renders the rest of the
 * sentence backwards — in the one message a user reads when amicus is telling
 * them something is wrong. The repo already owns the remedy and states the rule:
 * `src/utils/text-sanitize.js :: collapseExcerpt` is the ONLY sanitizer.
 *
 * ── NAMED MUTANT ──────────────────────────────────────────────────────────
 * RAWENTRYNAME  electron-refuse.js :: refuseUnsafeArchive — drop the
 *   collapseExcerpt() around `err.message`.
 *   RED: "an unsafe-archive refusal cannot forge an [amicus] line, colour the
 *   terminal, or reverse the sentence".
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { stageArtifact } = require('../src/sidecar/electron-stage');
const { robustExtract } = require('../src/sidecar/unzip');
const { fakeElectronDir, SELF_ANCHOR_OFF, ZIP_BODY } = require('./helpers/fake-electron-dir');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;

const ESC = '\u001b';
/** The payload: colour codes, a forged amicus line, and a bidi override. */
const FORGED_LINE = '[amicus] Electron artifact verified. Nothing further is required.';
const NASTY = `../${ESC}[31mEVIL${ESC}[0m\n${FORGED_LINE}\n\u202eTNEMHCATTA`;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeZip({ body = ZIP_BODY } = {}) {
  const shaDir = path.join(mkTmp('amicus-zip-'), 'a'.repeat(16));
  fs.mkdirSync(shaDir, { recursive: true });
  const zip = path.join(shaDir, ZIP_NAME);
  fs.writeFileSync(zip, body);
  return zip;
}

async function repair({ dir, zip, deps = {} }) {
  return ei.repairElectron({
    cacheOnly: true,
    electronDir: dir,
    platform: PLATFORM,
    version: VERSION,
    arch: ARCH,
    deps: {
      ...SELF_ANCHOR_OFF,
      cachedZip: () => zip,
      extract: jest.fn(),
      spawn: jest.fn(),
      acquireLock: () => ({ release: () => {} }),
      ...deps,
    },
  });
}

/** Every assertion this suite makes about one rendered surface, in one place. */
function expectSafe(text) {
  expect(text).not.toMatch(CONTROL_CHARS);
  expect(text).not.toMatch(BIDI_CONTROLS);
}

/** stderr as it reaches a terminal, with the legitimate line breaks removed so
 *  only an INJECTED control character can fail the check. */
function flatStderr(chunks) {
  return chunks.join('').split('\n').join(' ');
}

let stderr;
let stderrSpy;
beforeEach(() => {
  stderr = [];
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
});
afterEach(() => { stderrSpy.mockRestore(); });

describe('F5 — an unsafe archive cannot write the refusal it is refused with (RAWENTRYNAME)', () => {
  test('an unsafe-archive refusal cannot forge an [amicus] line, colour the terminal, or reverse the sentence', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const extract = jest.fn(async () => {
      // The shape unzip.js throws, with the ARCHIVE'S entry name inside it.
      const e = new Error(`refusing to extract cached.zip: invalid relative path: ${NASTY}`);
      e.code = 'UNZIP_UNSAFE_ARCHIVE';
      throw e;
    });

    const res = await repair({ dir, zip: writeZip(), deps: { extract } });

    expect(res.integrity).toBe('unsafe-archive');
    expectSafe(res.reason);
    // The returned reason is what postinstall and doctor print, so it must stay ONE
    // line: a newline there is a whole forged sentence in a user's terminal.
    expect(res.reason).not.toContain('\n');
    expect(res.reason).toContain('EVIL');            // and it still says what happened

    const lines = stderr.join('').split('\n');
    expect(lines.some((l) => l.startsWith(FORGED_LINE))).toBe(false);
    expectSafe(flatStderr(stderr));
  });

  test('the same holds one layer down, where unzip.js composes the message', async () => {
    // robustExtract builds `refusing to extract <zip>: <reason>` out of
    // extract-zip's text, and THAT Error is what reaches refuseUnsafeArchive.
    const extractZip = jest.fn(async () => { throw new Error(`invalid relative path: ${NASTY}`); });
    const err = await robustExtract('z.zip', {
      dir: mkTmp('amicus-unsafe-dir-'),
      deps: { extractZip, spawn: jest.fn(), fs },
    }).catch((e) => e);

    expect(err.code).toBe('UNZIP_UNSAFE_ARCHIVE');
    expectSafe(err.message);
    expect(err.message).not.toContain('\n');
  });

  test('an ORDINARY extract failure is sanitized before it narrates the fallback', async () => {
    // Not a refusal: this one falls back to a native extractor, and the line that
    // says so quotes extract-zip's text on the way past.
    const log = [];
    const extractZip = jest.fn(async () => { throw new Error(`something broke: ${NASTY}`); });
    const spawn = jest.fn(() => ({ status: 1 }));
    await expect(robustExtract('z.zip', {
      dir: mkTmp('amicus-ordinary-dir-'), platform: 'win32', deps: { extractZip, spawn, fs, log: (m) => log.push(m) },
    })).rejects.toMatchObject({ code: 'UNZIP_ALL_FAILED' });

    expect(log.join('\n')).toMatch(/falling back to native unzip/);
    for (const line of log) {
      expectSafe(line);
      expect(line.startsWith(FORGED_LINE)).toBe(false);
    }
  });
});

describe('F5 — an attacker-named cache path cannot write the refusal either', () => {
  test('an UNREADABLE artifact at a hostile path is reported on one clean line', async () => {
    // `cachedZip` builds <root>/<sha>/<name> from a readdir of a directory the
    // attacker writes, so the <sha> component is theirs. It does not exist here,
    // so staging refuses it before any hash — the `unstaged` refusal, which prints
    // the same attacker-named path, and must sanitize it the same way.
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const hostile = path.join(os.tmpdir(), `amicus-${ESC}[31m\n${FORGED_LINE}\u202e`, ZIP_NAME);

    const res = await repair({ dir, zip: hostile });

    expect(res.integrity).toBe('unstaged');
    expectSafe(res.reason);
    expect(res.reason).not.toContain('\n');
    const lines = stderr.join('').split('\n');
    expect(lines.some((l) => l.startsWith(FORGED_LINE))).toBe(false);
    expectSafe(flatStderr(stderr));
  });

  test('an implausible artifact NAME is quoted without letting it speak', () => {
    // v4.9.6 second round, F#3 x F5. `fileName` is built from a `version` read out
    // of an untrusted <electronDir>/package.json, so the string this refusal quotes
    // back is the attacker's too — and it fires precisely when that string is
    // malformed, which is when it is most likely to be hostile.
    const lines = [];
    const stage = stageArtifact({
      zip: writeZip(),
      fileName: `electron-v43.1.1/../../${NASTY}-win32-x64.zip`,
      fs,
      log: (m) => lines.push(m),
    });

    expect(stage).toBeNull();
    expect(lines.join('\n')).toMatch(/REFUSING an implausible Electron artifact name/);
    for (const line of lines) {
      expectSafe(line);
      expect(line.startsWith(FORGED_LINE)).toBe(false);
    }
  });
});

describe('F5 — the sanitizer did not eat the message', () => {
  test('an ordinary refusal still reads exactly as it did before', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const extract = jest.fn(async () => {
      const e = new Error('refusing to extract cached.zip: invalid relative path: ../../evil');
      e.code = 'UNZIP_UNSAFE_ARCHIVE';
      throw e;
    });
    const res = await repair({ dir, zip: writeZip(), deps: { extract } });
    expect(res.reason).toBe(
      `Electron artifact ${ZIP_NAME} was REFUSED: refusing to extract cached.zip: `
      + 'invalid relative path: ../../evil. It was NOT retried and NOT removed.',
    );
    expect(stderr.join('')).toContain('invalid relative path: ../../evil');
  });

  test('a REFUSED mismatch still names the real cache path in full', () => {
    // The path cap is deliberately longer than an excerpt's: a truncated path is
    // not something a user can act on.
    const deep = path.join(os.tmpdir(), 'a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60), ZIP_NAME);
    const { collapseExcerpt } = require('../src/utils/text-sanitize');
    expect(collapseExcerpt(deep, 320)).toBe(deep);
  });
});
