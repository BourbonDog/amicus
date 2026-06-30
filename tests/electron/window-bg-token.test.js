'use strict';

/**
 * Issue #50 — the pre-redesign taupe '#2D2B2A' must no longer be hardcoded as a
 * window/BrowserView background. The three BrowserWindow backgroundColor strings
 * in main.js must come from the shared --bg design token (TOKENS.bg), and the
 * BrowserView anti-white-flash injection in preload.js must use var(--bg) with a
 * literal #0a0a0a fallback (so the flash guard holds before #49's token CSS is
 * injected). icon.svg legitimately keeps the taupe (allowlisted by #52) and is
 * NOT in scope here.
 *
 * The source is read as text rather than imported because main.js boots Electron
 * on require; reading the file avoids any real Electron download/extract/network.
 */

const fs = require('fs');
const path = require('path');
const { TOKENS } = require('../../src/design/tokens');

const ELECTRON_DIR = path.join(__dirname, '..', '..', 'electron');
const MAIN_SRC = fs.readFileSync(path.join(ELECTRON_DIR, 'main.js'), 'utf8');
const PRELOAD_SRC = fs.readFileSync(path.join(ELECTRON_DIR, 'preload.js'), 'utf8');
const ICON_SRC = fs.readFileSync(
  path.join(ELECTRON_DIR, 'assets', 'icon.svg'),
  'utf8'
);

describe('Issue #50 — window background uses the --bg token, not hardcoded taupe', () => {
  test('TOKENS.bg is the canonical dark background hex', () => {
    expect(TOKENS.bg).toBe('#0a0a0a');
  });

  test('main.js contains no hardcoded #2D2B2A taupe literal (any case)', () => {
    expect(MAIN_SRC).not.toMatch(/#2D2B2A/i);
  });

  test('main.js requires the shared design tokens', () => {
    expect(MAIN_SRC).toMatch(/require\(['"]\.\.\/src\/design\/tokens['"]\)/);
  });

  test('all three BrowserWindow backgroundColor sites use TOKENS.bg', () => {
    const bgMatches = MAIN_SRC.match(/backgroundColor:\s*([^,\n]+)/g) || [];
    expect(bgMatches.length).toBe(3);
    for (const m of bgMatches) {
      expect(m).toMatch(/backgroundColor:\s*TOKENS\.bg/);
    }
  });

  test('preload.js BrowserView injection uses var(--bg) with a #0a0a0a fallback', () => {
    expect(PRELOAD_SRC).not.toMatch(/#2D2B2A/i);
    expect(PRELOAD_SRC).toMatch(
      /background-color:\s*var\(--bg,\s*#0a0a0a\)\s*!important/i
    );
  });

  test('icon.svg is left untouched — its taupe is allowlisted by #52', () => {
    expect(ICON_SRC).toMatch(/#2D2B2A/i);
  });
});
