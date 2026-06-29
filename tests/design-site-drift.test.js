/**
 * Site Drift Guard — Phase 4 (design-system adoption)
 *
 * Asserts site/index.html's :root clay/gold/neutral-black custom properties
 * stay byte-identical to the shared token source (src/design/tokens.js TOKENS).
 * The site uses short var names for compactness; this map pins short -> canonical.
 * Spec: docs/superpowers/specs/2026-06-29-design-system-adoption-design.md §Drift guard.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { TOKENS } = require('../src/design/tokens');

const SITE_HTML = path.join(__dirname, '..', 'site', 'index.html');

// Site short var name -> canonical TOKENS key.
// --mw is layout-only (not a color) and is intentionally excluded.
const SITE_TO_TOKEN = {
  bg: 'bg',
  s1: 'surface1',
  s2: 'surface2',
  s3: 'surface3',
  border: 'border',
  border2: 'borderStrong',
  t1: 'text1',
  t2: 'text2',
  t3: 'text3',
  accent: 'accent',
  accent2: 'gold',
  asoft: 'accentSoft',
  aglow: 'accentGlow',
  green: 'running'
};

function parseSiteRoot() {
  const html = fs.readFileSync(SITE_HTML, 'utf8');
  const block = html.match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error('site/index.html: no :root{} block found');
  const vars = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block[1]))) vars[m[1].trim()] = m[2].trim();
  return vars;
}

/**
 * Normalize a CSS color value for comparison.
 * Handles:
 *   - Case: lowercase everything
 *   - Whitespace: strip all spaces
 *   - 3-digit hex: expand #abc -> #aabbcc
 *   - rgba alpha: normalize leading-zero (.10 <-> 0.10)
 */
function normalize(value) {
  let v = String(value).toLowerCase().replace(/\s+/g, '');

  // Expand 3-digit hex (#rgb -> #rrggbb)
  v = v.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3');

  // Normalize rgba alpha: strip leading zero (.10 -> .10, 0.10 -> .10) — both to no-leading-zero form
  v = v.replace(/rgba\((\d+),(\d+),(\d+),0?(\.\d+)\)/, 'rgba($1,$2,$3,$4)');

  return v;
}

describe('site :root drift guard', () => {
  const siteVars = parseSiteRoot();

  it('defines every mapped color var in :root', () => {
    for (const shortName of Object.keys(SITE_TO_TOKEN)) {
      expect(siteVars).toHaveProperty(shortName);
    }
  });

  it.each(Object.entries(SITE_TO_TOKEN))(
    'site --%s equals TOKENS.%s',
    (shortName, tokenKey) => {
      expect(TOKENS).toHaveProperty(tokenKey);
      expect(normalize(siteVars[shortName])).toBe(normalize(TOKENS[tokenKey]));
    }
  );

  it('site :root carries the shared-token provenance marker', () => {
    const html = fs.readFileSync(SITE_HTML, 'utf8');
    expect(html).toContain('src/design/tokens.js');
  });
});
