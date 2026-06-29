'use strict';

/**
 * Shared design-token loader.
 *
 * tokenCss(opts)  -> the full :root{} + @font-face CSS string from tokens.css.
 *                    opts.absoluteFontUrls (default false) rewrites the
 *                    relative ./fonts/*.ttf URLs to absolute file:// URLs so
 *                    the Electron app (which injects this inline into data:
 *                    URLs) resolves the bundled webfonts. The report/site
 *                    leave them relative.
 * TOKENS          -> flat map of the canonical hex/rgba values, used by the
 *                    site drift-guard test.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const TOKENS_CSS_PATH = path.join(__dirname, 'tokens.css');
const FONTS_DIR = path.join(__dirname, 'fonts');

const TOKENS = {
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
};

function tokenCss(opts = {}) {
  let css = fs.readFileSync(TOKENS_CSS_PATH, 'utf8');
  if (opts.absoluteFontUrls) {
    css = css.replace(/url\('\.\/fonts\/([^']+)'\)/g, (_m, file) => {
      const abs = pathToFileURL(path.join(FONTS_DIR, file)).href;
      return `url('${abs}')`;
    });
  }
  return css;
}

module.exports = { tokenCss, TOKENS };
