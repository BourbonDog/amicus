/**
 * build-social-card Script Tests
 *
 * The site's link-preview card (site/social-card.png, the og:image) is rendered from
 * site/social-card-render.html, which scripts/build-social-card.js generates from the
 * hero in site/index.html. The card went stale once (a June sidecar card outlived the
 * August hero redesign), so the committed render page must stay what the generator
 * produces from the current hero. No browser runs here; --render is a manual step.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  extractHeroAssets, buildCardHtml, fontsStatusFromDom, parseArgs,
} = require('../../scripts/build-social-card');

const SITE = join(__dirname, '..', '..', 'site');
const indexHtml = readFileSync(join(SITE, 'index.html'), 'utf8');

describe('build-social-card', () => {
  test('extracts the nav logo and the round-table art from the site hero', () => {
    const { logoSvg, artSvg } = extractHeroAssets(indexHtml);
    expect(logoSvg.startsWith('<svg')).toBe(true);
    expect(logoSvg.endsWith('</svg>')).toBe(true);
    expect(artSvg.startsWith('<svg')).toBe(true);
    expect(artSvg).toContain('ROUND TABLE');
    expect(artSvg.endsWith('</svg>')).toBe(true);
  });

  test('the committed render page is what the generator builds from site/index.html', () => {
    const committed = readFileSync(join(SITE, 'social-card-render.html'), 'utf8');
    // On failure: run `node scripts/build-social-card.js --render` and commit both files.
    expect(committed).toBe(buildCardHtml(indexHtml));
  });

  test('names the missing hero marker instead of building a broken card', () => {
    expect(() => buildCardHtml('<html><body>no hero</body></html>')).toThrow(/class="logo"/);
    const noArt = '<a href="#" class="logo"><svg></svg></a>';
    expect(() => buildCardHtml(noArt)).toThrow(/hero-anim/);
  });

  test('the frame time is a parameter with the verdict frame as the default', () => {
    expect(buildCardHtml(indexHtml)).toContain("q.get('t') || '10.5'");
    expect(buildCardHtml(indexHtml, { t: 4 })).toContain("q.get('t') || '4'");
  });

  describe('font check (a card in a fallback font must not pass silently)', () => {
    test('the render page reports whether its web fonts loaded', () => {
      const page = buildCardHtml(indexHtml);
      expect(page).toContain('data-fonts');
      expect(page).toContain("'Outfit'");
      expect(page).toContain("'IBM Plex Mono'");
    });

    test('reads the report from the dumped DOM', () => {
      expect(fontsStatusFromDom('<html data-fonts="loaded"><body></body></html>')).toBe('loaded');
      expect(fontsStatusFromDom('<html lang="en" data-fonts="missing:Outfit"><body>')).toBe('missing:Outfit');
    });

    test('no report at all is unknown, never loaded', () => {
      expect(fontsStatusFromDom('<html><body></body></html>')).toBe('unknown');
      expect(fontsStatusFromDom('')).toBe('unknown');
    });
  });

  describe('arguments', () => {
    test('no arguments only regenerates the render page', () => {
      expect(parseArgs([])).toEqual({ render: false, github: undefined, t: undefined });
    });

    test('--github implies a site render too', () => {
      expect(parseArgs(['--github', 'out.png'])).toEqual({ render: true, github: 'out.png', t: undefined });
    });

    test('--t is accepted with a render', () => {
      expect(parseArgs(['--render', '--t', '4'])).toEqual({ render: true, github: undefined, t: '4' });
    });

    test('--t without --render or --github is refused, not ignored', () => {
      expect(() => parseArgs(['--t', '4'])).toThrow(/--t only applies with --render or --github/);
    });

    test('a flag missing its value is refused', () => {
      expect(() => parseArgs(['--render', '--github'])).toThrow(/--github needs a value/);
      expect(() => parseArgs(['--render', '--t', '--github', 'x.png'])).toThrow(/--t needs a value/);
    });

    test('an unknown flag is refused', () => {
      expect(() => parseArgs(['--rendr'])).toThrow(/unknown argument --rendr/);
    });
  });
});
