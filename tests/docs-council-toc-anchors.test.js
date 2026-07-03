'use strict';
/**
 * Task 17.1 fix round 1 (adversarial-review Fix 1) — docs/council.md's
 * internal TOC anchors must actually resolve.
 *
 * GitHub's heading slugger: lowercase the plain heading text (markdown
 * emphasis/code markers stripped first), strip any character that isn't a
 * word character, space, or hyphen, then replace each remaining space with
 * a hyphen WITHOUT collapsing runs of adjacent hyphens. A heading with
 * multiple consecutive punctuation-separated words (e.g. "save` / `list`")
 * collapses its surrounding backticks/slashes to bare spaces, which then
 * each become their own hyphen — producing doubled hyphens in the slug.
 *
 * The fixup commit (709370c) inverted this: it "fixed" the TOC link to a
 * single-hyphen form that does NOT resolve. This suite parses every
 * `](#...)` in-page link in docs/council.md, computes the real slug of
 * every heading using the algorithm above, and asserts every link target
 * is a heading that actually produced that slug — so this class of bug
 * (an anchor link that silently 404s on GitHub) can't recur.
 */
const fs = require('fs');
const path = require('path');
const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'council.md'), 'utf-8');

/**
 * Reproduces github-slugger's default slug algorithm closely enough for
 * ATX markdown headings: strip markdown emphasis/code markers, lowercase,
 * strip punctuation (keep word chars/spaces/hyphens), then map each space
 * to a hyphen without collapsing adjacent hyphens.
 * @param {string} headingText raw heading text (without the leading `#`s)
 * @returns {string} slug
 */
function githubSlug(headingText) {
  let plain = headingText
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/\*\*([^*]*)\*\*/g, '$1') // bold
    .replace(/\*([^*]*)\*/g, '$1') // italics
    .trim();
  let s = plain.toLowerCase();
  s = s.replace(/[^\w\- ]/g, ''); // strip punctuation, keep word/space/hyphen
  s = s.replace(/ /g, '-'); // spaces -> hyphens, no collapsing
  return s;
}

// Every ATX heading in the doc, in order.
const headings = [...doc.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(m => ({
  level: m[1].length,
  text: m[2].trim(),
  slug: githubSlug(m[2].trim()),
}));

// Every in-page anchor link `](#...)` referenced anywhere in the doc.
const anchorLinks = [...doc.matchAll(/\]\(#([^)]+)\)/g)].map(m => m[1]);

describe('docs/council.md TOC anchors resolve (adversarial-review Fix 1)', () => {
  it('the doc has at least one heading and at least one anchor link (sanity)', () => {
    expect(headings.length).toBeGreaterThan(0);
    expect(anchorLinks.length).toBeGreaterThan(0);
  });

  it.each(anchorLinks)('anchor link #%s resolves to a real heading slug', (anchor) => {
    const slugs = headings.map(h => h.slug);
    expect(slugs).toContain(anchor);
  });

  it('the "Council presets" heading slugs with doubled hyphens (backtick/slash punctuation each strip to their own space)', () => {
    const presetsHeading = headings.find(h => h.text.startsWith('Council presets'));
    expect(presetsHeading).toBeTruthy();
    expect(presetsHeading.slug).toBe('council-presets-save--list--show');
  });

  it('the TOC entry for Council presets links to the doubled-hyphen slug, not the collapsed single-hyphen form', () => {
    const tocLine = doc.split('\n').find(l => l.includes('[Council presets'));
    expect(tocLine).toBeTruthy();
    expect(tocLine).toContain('(#council-presets-save--list--show)');
    expect(tocLine).not.toContain('(#council-presets-save-list-show)');
  });
});
