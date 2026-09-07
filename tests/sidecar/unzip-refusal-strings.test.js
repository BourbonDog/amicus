// tests/sidecar/unzip-refusal-strings.test.js
'use strict';

/**
 * F4 — the refusal classifier can no longer degrade in SILENCE (v4.9.6).
 *
 * Council seat B4 (minor, CONTESTED): "UNSAFE_PATTERNS is a hardcoded four-regex
 * match against current extract-zip/yauzl message strings; an upstream bump or
 * reworded refusal silently degrades C4 back to the pre-fix cleanDir+native-retry
 * laundering with no test red."
 *
 * The objection to it was fair — the strings WERE verified against the installed
 * versions. What was missing is anything that keeps checking. Every existing test
 * for this control hands `robustExtract` a hand-typed message, so the libraries
 * and the classifier could drift apart without one assertion noticing.
 *
 * So this suite fixes the SILENCE, not the design. It drives the REAL installed
 * `extract-zip` and `yauzl` into producing each classified refusal — with a real
 * zip built byte by byte below, and a real directory symlink for the one refusal
 * extract-zip raises itself — and asserts UNSAFE_PATTERNS still recognises what
 * they actually say. The patterns are NOT widened: `A STALL IS NOT A REFUSAL`
 * (mutant STALLTERMINAL, tests/sidecar/unzip.test.js) still governs, and the
 * exhaustiveness check at the end of this file independently goes red if anyone
 * adds a pattern no real library message produces.
 *
 * WHAT A FAILURE HERE MEANS: not "the test is stale". It means an upstream bump
 * changed a refusal string, C4 has stopped classifying it, and a path-traversal
 * archive is about to be handed to tar / Expand-Archive, which have no such
 * check. Re-derive the strings from the new versions before touching the regexes.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Applied and reverted by byte copy, MEASURED 2026-09-07.
 *
 * REFUSALSTRINGDRIFT  src/sidecar/unzip.js — stand in for the upstream reword
 *   the finding is about: `/^invalid relative path: /` ->
 *   `/^invalid relative pathname: /`, the classifier drifting off what yauzl
 *   actually says. RED on three tests here, and on NOTHING in the pre-F4 suite:
 *   "a real traversal zip, through the real extract-zip, is refused with a
 *   classified message", "each UNSAFE_PATTERN matches at least one message a
 *   real library produced", and "a real traversal archive is TERMINAL".
 * STALLTERMINAL       src/sidecar/unzip.js — add `/^stalled: /`, widening the
 *   patterns the way F4 must NOT. Still RED on its own v4.9.5 test
 *   (tests/sidecar/unzip.test.js "A STALL IS NOT A REFUSAL", which threw
 *   UNZIP_UNSAFE_ARCHIVE on "stalled: exceeded 240000ms"), and now red here too:
 *   "each UNSAFE_PATTERN matches at least one message a real library produced"
 *   and "nothing else extract-zip says is classified as a refusal".
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const extractZip = require('extract-zip');
const yauzl = require('yauzl');

const { robustExtract, UNSAFE_PATTERNS } = require('../../src/sidecar/unzip');

// ---------------------------------------------------------------------------
// A minimal STORED-entry zip, written byte by byte. No zip-writing dependency
// exists in this tree, and adding one to test a security control would put a
// third party between the control and its evidence.
// ---------------------------------------------------------------------------
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/** A zip holding zero-length stored entries with exactly these names. */
function makeZip(names) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(0), u32(0), u16(nameBuf.length), u16(0), nameBuf,
    ]);
    locals.push(local);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(0), u32(0), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf,
    ]));
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(names.length), u16(names.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}

const mkTmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function zipFile(names) {
  const p = path.join(mkTmp('amicus-refusal-zip-'), 'a.zip');
  fs.writeFileSync(p, makeZip(names));
  return p;
}

/** Run the REAL extract-zip over a real zip; return its rejection message. */
async function realExtractZipMessage(names, prep) {
  const dir = mkTmp('amicus-refusal-dest-');
  if (prep) { prep(dir); }
  try {
    await extractZip(zipFile(names), { dir });
    return null;                                    // it did NOT refuse
  } catch (e) {
    return (e && e.message) || String(e);
  }
}

/** Point <dir>/link at a directory OUTSIDE dir. Junctions need no privilege on
 *  Windows; 'dir' symlinks need none on POSIX. Returns false if the OS refuses. */
function linkOutside(dir) {
  try {
    fs.symlinkSync(mkTmp('amicus-refusal-outside-'), path.join(dir, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch { return false; }
}

// Collected once: the message each installed library ACTUALLY produces.
const real = {};
let symlinkable = true;

beforeAll(async () => {
  real.relative = await realExtractZipMessage(['../evil.txt']);
  real.absolute = await realExtractZipMessage(['/etc/passwd']);
  real.drive = await realExtractZipMessage(['C:/evil.txt']);
  real.clean = await realExtractZipMessage(['good.txt']);
  // extract-zip's OWN refusal, reached the only way it is reachable: an entry
  // whose destination directory resolves outside `dir` through a symlink.
  real.outOfBound = await realExtractZipMessage(['link/x.txt'], (dir) => {
    symlinkable = linkOutside(dir);
  });
  // yauzl rewrites backslashes to '/' before validating unless strictFileNames
  // is set (extract-zip does not set it), so this one is unreachable THROUGH
  // extract-zip and is taken from yauzl directly — which is exactly what
  // src/sidecar/unzip.js's docblock claims.
  real.backslash = yauzl.validateFileName('evil\\..\\..\\x');
});

describe('F4 — the installed libraries still say what UNSAFE_PATTERNS expects', () => {
  test('yauzl raises the three validateFileName refusals, verbatim', () => {
    expect(yauzl.validateFileName('../evil')).toBe('invalid relative path: ../evil');
    expect(yauzl.validateFileName('/etc/passwd')).toBe('absolute path: /etc/passwd');
    expect(yauzl.validateFileName('C:/x')).toBe('absolute path: C:/x');
    expect(real.backslash).toBe('invalid characters in fileName: evil\\..\\..\\x');
    // ...and a clean name is not a refusal at all.
    expect(yauzl.validateFileName('dist/electron.exe')).toBeNull();
  });

  test('a real traversal zip, through the real extract-zip, is refused with a classified message', () => {
    expect(real.relative).toBe('invalid relative path: ../evil.txt');
    expect(real.absolute).toBe('absolute path: /etc/passwd');
    expect(real.drive).toBe('absolute path: C:/evil.txt');
    for (const message of [real.relative, real.absolute, real.drive]) {
      expect(UNSAFE_PATTERNS.some((p) => p.test(message))).toBe(true);
    }
  });

  test('extract-zip\'s OWN out-of-bound refusal is still classified', () => {
    if (!symlinkable) {
      // Fall back to the source rather than passing on nothing: the literal must
      // still be there even where this box cannot make the link.
      const src = fs.readFileSync(require.resolve('extract-zip'), 'utf8');
      expect(src).toContain('Out of bound path "');
      return;
    }
    expect(real.outOfBound).toMatch(/^Out of bound path "/);
    expect(real.outOfBound).toContain('link/x.txt');
    expect(UNSAFE_PATTERNS.some((p) => p.test(real.outOfBound))).toBe(true);
  });

  test('a CLEAN archive is not refused — the probes above prove refusal, not breakage', () => {
    expect(real.clean).toBeNull();
  });

  test('backslashes stay UNREACHABLE through extract-zip, as the docblock says', () => {
    // If a yauzl bump flips strictFileNames on by default this goes red, and the
    // note in src/sidecar/unzip.js stops being true — which is the point.
    return expect(realExtractZipMessage(['evil\\x.txt'])).resolves.toBeNull();
  });
});

describe('F4 — every pattern is answered by a real message, and only by one', () => {
  test('each UNSAFE_PATTERN matches at least one message a real library produced', () => {
    const messages = [real.relative, real.absolute, real.drive, real.backslash,
      symlinkable ? real.outOfBound : 'Out of bound path "x" found while processing file y']
      .filter(Boolean);
    for (const pattern of UNSAFE_PATTERNS) {
      expect({ pattern: String(pattern), matched: messages.some((m) => pattern.test(m)) })
        .toEqual({ pattern: String(pattern), matched: true });
    }
    // A pattern with no real message behind it is either dead or — the
    // STALLTERMINAL shape — a refusal class that was never a refusal.
    expect(UNSAFE_PATTERNS).toHaveLength(4);
  });

  test('nothing else extract-zip says is classified as a refusal', () => {
    // The narrowness IS the control: a stall or a corrupt archive must still
    // reach the native fallback the Node-24 workaround depends on.
    for (const benign of [
      'stalled: no extract progress for 30000ms',
      'stalled: exceeded 240000ms',
      'end of central directory record signature not found',
      'compressed/uncompressed size mismatch for stored file: 5 != 4',
      'extract-zip unavailable: Cannot find module \'extract-zip\'',
    ]) {
      expect(UNSAFE_PATTERNS.some((p) => p.test(benign))).toBe(false);
    }
  });
});

describe('F4 — and the classification still reaches robustExtract, over real bytes', () => {
  test('a real traversal archive is TERMINAL: no native retry, no cleanDir', async () => {
    const dir = mkTmp('amicus-refusal-robust-');
    const spawn = jest.fn(() => ({ status: 0 }));
    // No injected extractZip: the REAL one runs, over the REAL zip built above.
    await expect(robustExtract(zipFile(['../../evil.exe']), { dir, deps: { fs, spawn } }))
      .rejects.toMatchObject({ code: 'UNZIP_UNSAFE_ARCHIVE' });
    expect(spawn).not.toHaveBeenCalled();
  });

  test('a real CLEAN archive still extracts through extract-zip', async () => {
    const dir = mkTmp('amicus-refusal-robust-ok-');
    const spawn = jest.fn(() => ({ status: 0 }));
    const res = await robustExtract(zipFile(['good.txt']), { dir, deps: { fs, spawn } });
    expect(res.strategy).toBe('extract-zip');
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'good.txt'))).toBe(true);
  });
});
