'use strict';

/**
 * Electron Token-Drift Guard — Issue #52 (terminal task of the theming lane).
 *
 * Scans the electron/ source tree and FAILS if anyone re-introduces a raw
 * color or non-token font into the now-cleaned surface. After #49/#50/#51
 * repointed every electron literal at the shared design tokens
 * (src/design/tokens.js -> tokens.css var(--*)), this guard locks that win in:
 * a new hardcoded hex (e.g. #2D2B2A / #d97757), a raw rgb()/hsl() theme color,
 * or a literal font stack that does not lead with var(--font-sans|mono) will
 * trip the build.
 *
 * Mirrors tests/design-site-drift.test.js: a regex-scan + normalize pass over
 * source text, bound to the token system. The site guard pins values byte-for-
 * byte; this one is a *negative* guard (no raw literals at all), so it needs an
 * allowlist for the handful of values #49/#51/#50 deliberately kept.
 *
 * Source is read as TEXT (never require()d): electron/main.js boots Electron on
 * import, so reading files avoids any real Electron download/extract/network.
 *
 * --- ALLOWLIST MECHANISMS (two, both honored) ---
 *  1. Inline marker: put `drift-allow: <reason>` in a comment on the SAME line
 *     as a genuinely-external value. Use this for one-off, in-source exceptions.
 *  2. File-level skip set (SKIP_FILES below): whole files excluded from the
 *     scan — used for non-source assets (icon.svg / icon.png) that legitimately
 *     carry brand hex and are not theme code.
 *
 * Plus two STRUCTURAL allowances baked into the matchers (token-led, not drift):
 *  - a hex used as the fallback of var(--token, #hex)  [anti-white-flash guard]
 *  - a neutral black/white scrim  rgba(0,0,0,a) / rgba(255,255,255,a)  [overlay
 *    backdrops & spinner tracks — system scrims, not brand colors]
 */

const fs = require('fs');
const path = require('path');

const ELECTRON_DIR = path.join(__dirname, '..', '..', 'electron');

/**
 * Whole-file skip set. Paths are relative to electron/ (POSIX separators).
 * Only non-source assets belong here — anything that is real theme code must
 * stay in scope and earn its exceptions with inline `drift-allow:` markers.
 *
 * - assets/icon.svg : the app icon legitimately bakes in the pre-redesign taupe
 *   (#2D2B2A) and the clay brand stroke (#D97757). It is a static brand asset,
 *   not styleable surface, so it is excluded wholesale (see #50's
 *   window-bg-token.test.js, which asserts the svg KEEPS its taupe).
 * - assets/icon.png : binary; nothing to scan.
 */
const SKIP_FILES = new Set(['assets/icon.svg', 'assets/icon.png']);

/** Recursively collect every file under electron/, relative POSIX paths. */
function collectFiles(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectFiles(path.join(dir, entry.name), relPath));
    } else {
      out.push(relPath);
    }
  }
  return out;
}

/** Source files in scope: every electron/ file minus SKIP_FILES + binaries. */
function scannedFiles() {
  return collectFiles(ELECTRON_DIR)
    .filter((rel) => !SKIP_FILES.has(rel))
    .filter((rel) => /\.(js|css|html)$/i.test(rel));
}

/** True if the line carries an inline `drift-allow:` allowlist marker. */
function isAllowed(line) {
  return /drift-allow:/i.test(line);
}

/** A hex literal anywhere in a line: #rgb, #rrggbb, or #rrggbbaa. */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * Is this hex the fallback inside a var(--token, #hex) reference?
 * Token-led — the var() drives the value, the hex is only the pre-token
 * fallback (preload.js's anti-white-flash guard). Not drift.
 */
function isVarFallbackHex(line, index) {
  // Look back from the hex for the nearest '(' — accept only var(... , #hex)
  const before = line.slice(0, index);
  return /var\(\s*--[a-z0-9-]+\s*,\s*$/i.test(before);
}

/** A raw rgb()/rgba()/hsl()/hsla() functional color. */
const FUNC_COLOR_RE = /\b(rgba?|hsla?)\(([^)]*)\)/gi;

/**
 * Neutral black/white scrim: rgb(a) where the three channels are all 0 or all
 * 255 (an overlay backdrop or spinner track), regardless of alpha. These are
 * system scrims, not brand/theme colors, so they are allowed structurally.
 */
function isNeutralScrim(fn, args) {
  if (!/^rgba?$/i.test(fn)) {
    return false;
  }
  const parts = args.split(',').map((s) => s.trim());
  const [r, g, b] = parts;
  return (r === '0' && g === '0' && b === '0') ||
    (r === '255' && g === '255' && b === '255');
}

/** font-family declarations and their value (up to ; ' " or end-of-string). */
const FONT_FAMILY_RE = /font-family\s*:\s*([^;'"`\n]+)/gi;

/**
 * A token-led font value leads with var(--font-...). Anything else (a literal
 * "Arial, sans-serif" stack, or a system font with no token in front) is drift.
 */
function isTokenLedFont(value) {
  return /^\s*var\(\s*--font-[a-z0-9-]+\s*\)/i.test(value);
}

describe('electron/ token-drift guard (#52)', () => {
  const files = scannedFiles();

  test('there is something to scan (sanity)', () => {
    expect(files.length).toBeGreaterThan(0);
    // The key themed source files must be in scope.
    expect(files).toEqual(
      expect.arrayContaining([
        'preload.js',
        'fold.js',
        'load-failsafe.js',
        'opencode-theme.js',
        'toolbar.js',
        'setup-ui-styles.js',
      ])
    );
  });

  test('no hardcoded hex colors (outside var() token fallbacks / allowlist)', () => {
    const offenders = [];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ELECTRON_DIR, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (isAllowed(line)) {
          return;
        }
        let m;
        HEX_RE.lastIndex = 0;
        while ((m = HEX_RE.exec(line))) {
          if (isVarFallbackHex(line, m.index)) {
            continue;
          }
          offenders.push(`${rel}:${i + 1}  ${m[0]}  | ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('no raw rgb()/hsl() theme colors (neutral scrims & allowlist excepted)', () => {
    const offenders = [];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ELECTRON_DIR, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (isAllowed(line)) {
          return;
        }
        let m;
        FUNC_COLOR_RE.lastIndex = 0;
        while ((m = FUNC_COLOR_RE.exec(line))) {
          const [whole, fn, args] = m;
          if (isNeutralScrim(fn, args)) {
            continue;
          }
          offenders.push(`${rel}:${i + 1}  ${whole}  | ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('every font-family leads with a var(--font-*) token', () => {
    const offenders = [];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ELECTRON_DIR, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (isAllowed(line)) {
          return;
        }
        let m;
        FONT_FAMILY_RE.lastIndex = 0;
        while ((m = FONT_FAMILY_RE.exec(line))) {
          if (!isTokenLedFont(m[1])) {
            offenders.push(`${rel}:${i + 1}  ${m[1].trim()}  | ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
