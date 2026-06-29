const path = require('path');
const { pathToFileURL } = require('url');
const { tokenCss, TOKENS } = require('../src/design/tokens');

describe('src/design/tokens.js loader', () => {
  it('exports a TOKENS map of canonical clay/gold/neutral hex values', () => {
    expect(TOKENS).toEqual({
      accent: '#d97757',
      gold: '#e8b24a',
      bg: '#0a0a0a',
      surface1: '#111113',
      surface2: '#161618',
      surface3: '#1c1c1f',
      border: '#222225',
      borderStrong: '#2c2c30',
      text1: '#f5f5f3',
      text2: '#a1a1a0',
      text3: '#666666',
      accentSoft: 'rgba(217, 119, 87, 0.10)',
      accentGlow: 'rgba(217, 119, 87, 0.05)',
      running: '#4ade80'
    });
  });

  it('tokenCss() returns the full :root + @font-face string with clay, no violet', () => {
    const css = tokenCss();
    expect(typeof css).toBe('string');
    expect(css).toMatch(/:root\s*\{/);
    // tokens.css uses single-space declarations (BLOCKER FIX #1), so the
    // spacing-tolerant regex is the robust assertion:
    expect(css).toMatch(/--accent:\s*#d97757/);
    expect(css).toContain('@font-face');
    expect(css.toLowerCase()).not.toContain('#8b5cf6');
  });

  it('tokenCss() leaves relative font URLs by default (report/site context)', () => {
    const css = tokenCss();
    expect(css).toContain("url('./fonts/Outfit-400.ttf')");
    expect(css).not.toContain('file://');
  });

  it('tokenCss({ absoluteFontUrls: true }) rewrites font URLs to file:// under src/design/fonts (Electron context)', () => {
    const css = tokenCss({ absoluteFontUrls: true });
    const expectedUrl = pathToFileURL(
      path.join(__dirname, '..', 'src', 'design', 'fonts', 'Outfit-400.ttf')
    ).href;
    expect(css).toContain(`url('${expectedUrl}')`);
    // the Electron-injected CSS must carry an absolute file:// ttf URL so the
    // bundled webfonts resolve inside data: URLs (BLOCKER FIX #2):
    expect(css).toMatch(/url\('file:\/\/[^']*Outfit-400\.ttf'\)/);
    expect(css).not.toContain("url('./fonts/");
  });
});
