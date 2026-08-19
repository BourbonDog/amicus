'use strict';
/**
 * F-6: generalize the single-file anchor gate (docs-council-toc-anchors.test.js)
 * across the docs corpus that actually ships.
 *
 * Scope is deliberately top-level `docs/*.md` (NON-recursive) + README.md,
 * in-page anchors only:
 *   - This is exactly what package.json's `files: ["docs/*.md"]` ships.
 *   - docs/ is 128 .md files recursively (docs/superpowers/** alone is 113
 *     frozen historical plan/spec files). Scraping recursively surfaces 5
 *     unresolvable anchors, two of which are unfixable by editing:
 *     docs/superpowers/plans/2026-08-08-v47-docs.md contains the literal
 *     `](#...)` text used to DESCRIBE this very extractor regex, so a
 *     recursive scrape eats its own documentation as a fake anchor link.
 *   - The scoped set is 0-bad across all in-page links in the 16 files.
 *
 * Ten of the fifteen top-level docs/*.md files have ZERO anchor links, and
 * Jest 29 treats `.each([])` as a hard FAILURE (not a skip/pass) when the
 * table is empty. A naive per-file `describe.each`/`it.each` transcription
 * of docs-council-toc-anchors.test.js would therefore fail on those ten
 * files before checking anything real. Instead: build ONE flat table of
 * `{file, anchor}` pairs across every file, plus a single corpus-level
 * sanity check (file count, total anchor count) instead of a per-file one.
 */
const fs = require('fs');
const path = require('path');

/**
 * Reproduces github-slugger's default slug algorithm closely enough for ATX
 * markdown headings: strip markdown emphasis/code markers, lowercase, strip
 * punctuation (keep word chars/spaces/hyphens), then map each space to a
 * hyphen without collapsing adjacent hyphens.
 *
 * Reused verbatim from tests/docs-council-toc-anchors.test.js:33 — it
 * deliberately does NOT collapse adjacent hyphens, which the "Council
 * presets" case (see that file) depends on.
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

// Build the file list with fs.readdirSync + path.join and compare on
// path.basename, so the windows-latest CI leg's `docs\council.md` separators
// (vs the posix legs' `docs/council.md`) never leak into a comparison.
const docsDir = path.join(__dirname, '..', 'docs');
const docFiles = fs.readdirSync(docsDir)
  .filter((name) => name.endsWith('.md') && fs.statSync(path.join(docsDir, name)).isFile())
  .map((name) => path.join(docsDir, name));
docFiles.push(path.join(__dirname, '..', 'README.md'));

/**
 * Every ATX heading's github-style slug in a file, in order.
 *
 * NOTE: this regex also matches `#`-led comment lines inside fenced code
 * blocks (e.g. shell `# comment` or JS `## foo` in a ```bash/```js sample) —
 * 9 such pseudo-headings in council.md, 10 in electron-testing.md. That only
 * ADDS extra candidate slugs to match against, so it makes the gate more
 * permissive, never falsely red: a real anchor can accidentally resolve
 * against a pseudo-heading's slug, but a real anchor can never be rejected
 * because of one.
 * @param {string} file absolute path to a markdown file
 * @returns {string[]} slugs for every heading (real or fenced-comment) in the file
 */
function slugsFor(file) {
  const doc = fs.readFileSync(file, 'utf-8');
  return [...doc.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => githubSlug(m[2].trim()));
}

// One flat table of {file, anchor} pairs across every in-scope file. Slugs
// are computed once per FILE (not once per anchor match — this corpus is
// small enough that the difference is harmless, but there is no reason to
// re-read and re-regex a file 4+ times over). Duplicate {file, anchor}
// pairs (the same anchor linked twice in one file, e.g. council.md's
// "#where-artifacts-live" from both the TOC and a cross-reference) are
// deduped — otherwise Jest emits two identically-titled tests for the one
// real link, which is confusing in output and doubles the count for no
// added coverage.
const pairs = [];
const seenPairs = new Set();
for (const file of docFiles) {
  const doc = fs.readFileSync(file, 'utf-8');
  const slugs = slugsFor(file);
  const basename = path.basename(file);
  for (const m of doc.matchAll(/\]\(#([^)]+)\)/g)) {
    const key = basename + ' ' + m[1];
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    pairs.push({ file: basename, anchor: m[1], slugs });
  }
}

describe('docs in-page anchors resolve (F-6, generalized from docs-council-toc-anchors.test.js)', () => {
  it('the corpus is the expected size', () => {
    expect(docFiles.length).toBe(17); // 16 top-level docs/*.md + README.md
    expect(pairs.length).toBeGreaterThan(20);
  });

  it.each(pairs)('$file #$anchor resolves to a real heading', ({ file, anchor, slugs }) => {
    expect(slugs).toContain(anchor);
  });
});
