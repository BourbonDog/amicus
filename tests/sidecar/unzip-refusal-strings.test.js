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
 * REWORKED FOR N-06 (removal of `robustExtract`/`extract-zip`): the Electron
 * self-heal now extracts only through the in-memory path
 * (`zip-from-buffer.js`), so the library whose wording UNSAFE_PATTERNS must
 * keep matching is `yauzl` — for three of the four patterns, raised by
 * `yauzl.validateFileName` directly; for `Out of bound path `, amicus's own
 * `zip-entry-write.js :: outOfBound`, which composes that wording itself
 * (it is not a real `extract-zip` refusal any more — nothing in the shipped
 * tree calls `extract-zip`). This drives both real sources and asserts
 * UNSAFE_PATTERNS still recognises what they actually say.
 *
 * WHAT A FAILURE HERE MEANS: not "the test is stale". It means either yauzl
 * reworded a refusal, or `outOfBound` did, and UNSAFE_PATTERNS has stopped
 * classifying it. A yauzl reword is the one with a runtime effect:
 * `zip-from-buffer.js :: NAME_REFUSAL` carries the same three prefixes, so it
 * misses the new wording too, and the archive is reported UNZIP_BUFFER_FAILED
 * — evictable and rescuable — instead of the terminal UNZIP_UNSAFE_ARCHIVE
 * (C4). Re-derive the strings before touching the regexes.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Applied and reverted by byte copy, MEASURED 2026-09-28 against this file.
 *
 * REFUSALSTRINGDRIFT  src/sidecar/unzip.js — stand in for an upstream reword:
 *   `/^invalid relative path: /` -> `/^invalid relative pathname: /`.
 *   RED: "each UNSAFE_PATTERN matches at least one message a real source
 *   produced" (:81).
 * STALLTERMINAL       src/sidecar/unzip.js — add `/^stalled: /`, widening the
 *   patterns the way F4 must NOT.
 *   RED: "each UNSAFE_PATTERN matches at least one message a real source
 *   produced" (:81) and "nothing else yauzl or an ordinary extract failure
 *   says is classified as a refusal" (:102, on the two 'stalled: …' literals).
 * ──────────────────────────────────────────────────────────────────────────
 */

const yauzl = require('yauzl');

const { UNSAFE_PATTERNS } = require('../../src/sidecar/unzip');
const { outOfBound, extractorUnavailable } = require('../../src/sidecar/zip-entry-write');
const { stalled } = require('../../src/sidecar/zip-stall-bound');

// Collected once: the message each real source ACTUALLY produces.
const real = {
  relative: yauzl.validateFileName('../evil.txt'),
  absolute: yauzl.validateFileName('/etc/passwd'),
  drive: yauzl.validateFileName('C:/evil.txt'),
  backslash: yauzl.validateFileName('evil\\..\\..\\x'),
  outOfBound: outOfBound('/outside/dir', '../../evil.exe').message,
};

describe('F4 — yauzl and outOfBound still say what UNSAFE_PATTERNS expects', () => {
  test('yauzl raises the three validateFileName refusals, verbatim', () => {
    expect(real.relative).toBe('invalid relative path: ../evil.txt');
    expect(real.absolute).toBe('absolute path: /etc/passwd');
    expect(real.drive).toBe('absolute path: C:/evil.txt');
    expect(real.backslash).toBe('invalid characters in fileName: evil\\..\\..\\x');
    // ...and a clean name is not a refusal at all.
    expect(yauzl.validateFileName('dist/electron.exe')).toBeNull();
  });

  test('outOfBound composes the "Out of bound path" wording UNSAFE_PATTERNS expects', () => {
    expect(real.outOfBound).toMatch(/^Out of bound path "/);
    expect(real.outOfBound).toContain('../../evil.exe');
  });
});

describe('F4 — every pattern is answered by a real message, and only by one', () => {
  test('each UNSAFE_PATTERN matches at least one message a real source produced', () => {
    const messages = [real.relative, real.absolute, real.drive, real.backslash, real.outOfBound];
    for (const pattern of UNSAFE_PATTERNS) {
      expect({ pattern: String(pattern), matched: messages.some((m) => pattern.test(m)) })
        .toEqual({ pattern: String(pattern), matched: true });
    }
    // A pattern with no real message behind it is either dead or — the
    // STALLTERMINAL shape — a refusal class that was never a refusal.
    expect(UNSAFE_PATTERNS).toHaveLength(4);
  });

  test('nothing else yauzl or an ordinary extract failure says is classified as a refusal', () => {
    // The narrowness IS the control: a stall or a corrupt archive must still
    // reach the caller as a non-terminal failure, never as UNZIP_UNSAFE_ARCHIVE.
    for (const benign of [
      // robustExtract's old stall wording: STALLTERMINAL's kill depends on it.
      'stalled: no extract progress for 30000ms',
      'stalled: exceeded 240000ms',
      // ...and what the in-memory path says now, from its real constructors.
      stalled('no extract progress for 30000ms').message,
      stalled('extraction exceeded 240000ms').message,
      extractorUnavailable('Cannot find module').message,
      'end of central directory record signature not found',
      'compressed/uncompressed size mismatch for stored file: 5 != 4',
    ]) {
      expect(UNSAFE_PATTERNS.some((p) => p.test(benign))).toBe(false);
    }
  });
});

describe('F4 — the LIVE classifier, zip-from-buffer.js :: NAME_REFUSAL', () => {
  // The copy the in-memory extractor applies to every yauzl 'error': a match is
  // the terminal UNZIP_UNSAFE_ARCHIVE, a miss is the UNZIP_BUFFER_FAILED the
  // native rescue fires on. The rescue's pre-scan never passes through it (the
  // boundary builds its own refusal), so what it must recognise is REAL
  // yauzl's wording, and nothing else.
  const { NAME_REFUSAL } = require('../../src/sidecar/zip-from-buffer');
  const { buildZip, FLAG_ENCRYPTED } = require('../helpers/zip-fixture');

  /** The message REAL yauzl emits when its walk over `bytes` breaks, or null. */
  const walkError = (bytes) => new Promise((resolve) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
      if (err) { resolve(err.message); return; }
      zipfile.on('error', (e) => resolve(e.message));
      zipfile.on('entry', () => zipfile.readEntry());
      zipfile.on('end', () => resolve(null));
      zipfile.readEntry();
    });
  });

  test('NAME_REFUSAL recognises every refusal real yauzl raises', () => {
    for (const message of [real.relative, real.absolute, real.drive, real.backslash]) {
      expect({ message, matched: NAME_REFUSAL.test(message) }).toEqual({ message, matched: true });
    }
  });

  test('NAME_REFUSAL recognises nothing benign, so a clean but broken archive stays rescuable', async () => {
    // What real yauzl raises on the rescue's own fixture: an entry with the
    // encrypted flag set, which breaks the walk before any name is validated.
    const realWalk = await walkError(buildZip([{ name: 'first.bin', body: 'DATA', flags: FLAG_ENCRYPTED }]));
    expect(realWalk).toMatch(/^compressed\/uncompressed size mismatch/);
    for (const benign of [
      realWalk,
      'end of central directory record signature not found',
      stalled('no extract progress for 30000ms').message,
      extractorUnavailable('Cannot find module').message,
    ]) {
      expect({ benign, matched: NAME_REFUSAL.test(benign) }).toEqual({ benign, matched: false });
    }
  });
});
