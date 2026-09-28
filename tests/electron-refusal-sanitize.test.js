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
 *   - an UNSAFE-ARCHIVE refusal quotes the extractor's message, which quotes the
 *     archive's own entry name;
 *   - a cached artifact's PATH carries a `<sha>` directory name read out of a
 *     cache root anyone can write.
 * Unsanitized, either can carry ANSI escapes, a newline plus a forged
 * `[amicus] …` line, or a right-to-left override that renders the rest of the
 * sentence backwards — in the one message a user reads when amicus is telling
 * them something is wrong. The repo already owns the remedy and states the rule:
 * `src/utils/text-sanitize.js :: collapseExcerpt` is the ONLY sanitizer.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * RAWENTRYNAME  electron-refuse.js :: refuseUnsafeArchive — drop the
 *   collapseExcerpt() around `err.message`.
 *   RED: "an unsafe-archive refusal cannot forge an [amicus] line, colour the
 *   terminal, or reverse the sentence" (:128, re-measured 2026-09-28).
 * RAWCOMPOSE    zip-entry-write.js :: failure — drop its collapseExcerpt(), so
 *   the LIVE composer throws the entry name raw. It survived every test that
 *   loads the composer until this one.
 *   RED: "one layer down, the in-memory extractor throws an already-safe
 *   refusal (RAWCOMPOSE)" (:147).
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { extractZipBuffer } = require('../src/sidecar/zip-from-buffer');
const { fakeElectronDir, SELF_ANCHOR_OFF, ZIP_BODY } = require('./helpers/fake-electron-dir');
const { buildZip } = require('./helpers/zip-fixture');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;

const ESC = '\u001b';
/** The payload: colour codes, a forged amicus line, and a bidi override. */
const FORGED_LINE = '[amicus] Electron artifact verified. Nothing further is required.';
const NASTY = `../${ESC}[31mEVIL${ESC}[0m\n${FORGED_LINE}\n\u202eTNEMHCATTA`;
/** General-purpose bit 11: the entry name is UTF-8. Without it yauzl decodes the
 *  name as CP437, which already turns ESC and LF into printable glyphs. */
const FLAG_UTF8 = 0x0800;

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
      // yauzl's refusal for this name, in the shape the in-memory extractor
      // raises it (`zip-from-buffer.js :: NAME_REFUSAL`'s branch). That branch
      // sanitizes it first; this injects it RAW, so the pin is on
      // refuseUnsafeArchive's own sanitizer.
      const e = new Error(`invalid relative path: ${NASTY}`);
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

  test('one layer down, the in-memory extractor throws an already-safe refusal (RAWCOMPOSE)', async () => {
    // The LIVE composer, not a mock: real yauzl refuses the name, and
    // `zip-entry-write.js :: failure` builds the UNZIP_UNSAFE_ARCHIVE through
    // collapseExcerpt before anyone quotes it.
    const bytes = buildZip([{ name: NASTY, body: 'x', flags: FLAG_UTF8 }]);
    const err = await extractZipBuffer(bytes, { dir: mkTmp('amicus-compose-') }).catch((e) => e);

    expect(err.code).toBe('UNZIP_UNSAFE_ARCHIVE');
    expectSafe(err.message);
    expect(err.message).not.toContain('\n');
    expect(err.message).toContain('EVIL');            // cleaned, not emptied
  });
});

describe('F5 — an attacker-named cache path cannot write the refusal either', () => {
  test('an UNREADABLE artifact at a hostile path is reported on one clean line', async () => {
    // `cachedZip` builds <root>/<sha>/<name> from a readdir of a directory the
    // attacker writes, so the <sha> component is theirs. It does not exist here,
    // so the ONE read refuses it before any hash — the `unreadable` refusal,
    // which prints that same attacker-named path and must sanitize it the same
    // way. (The intermediate staged-copy cut called this `unstaged`.)
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const hostile = path.join(os.tmpdir(), `amicus-${ESC}[31m\n${FORGED_LINE}\u202e`, ZIP_NAME);

    const res = await repair({ dir, zip: hostile });

    expect(res.integrity).toBe('unreadable');
    expectSafe(res.reason);
    expect(res.reason).not.toContain('\n');
    const lines = stderr.join('').split('\n');
    expect(lines.some((l) => l.startsWith(FORGED_LINE))).toBe(false);
    expectSafe(flatStderr(stderr));
  });

  test('an implausible artifact NAME is quoted without letting it speak', async () => {
    // v4.9.6 second round, F#3 x F5. `fileName` is built from a `version` read out
    // of an untrusted <electronDir>/package.json, so the string this refusal quotes
    // back is the attacker's too — and it fires precisely when that string is
    // malformed, which is when it is most likely to be hostile. The check used to
    // live in the deleted electron-stage.js; it is `repairElectron`'s own
    // `unsafe-name` refusal now, and nothing downstream is reached at all.
    const { dir } = fakeElectronDir({
      withExe: false, platform: PLATFORM, version: `43.1.1/../../${NASTY}`,
    });
    const extract = jest.fn();

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: PLATFORM,
      arch: ARCH,                                    // no `version` — read from the dir
      deps: {
        ...SELF_ANCHOR_OFF, cachedZip: () => writeZip(), extract, spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(extract).not.toHaveBeenCalled();
    expect(res.integrity).toBe('unsafe-name');
    expectSafe(res.reason);
    expect(res.reason.startsWith(FORGED_LINE)).toBe(false);
    expect(res.reason).toMatch(/is not a usable artifact name/);
  });
});

describe('F5 — the sanitizer did not eat the message', () => {
  test('an ordinary refusal reaches the user verbatim: the sanitizer leaves plain text alone', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const extract = jest.fn(async () => {
      // The same live shape as above, without the payload.
      const e = new Error('invalid relative path: ../../evil');
      e.code = 'UNZIP_UNSAFE_ARCHIVE';
      throw e;
    });
    const res = await repair({ dir, zip: writeZip(), deps: { extract } });
    expect(res.reason).toBe(
      `Electron artifact ${ZIP_NAME} was REFUSED: invalid relative path: ../../evil. `
      + 'It was NOT retried and NOT removed.',
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
