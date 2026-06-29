# Amicus Design-System Adoption (Clay/Gold, Unified) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Claude Design "Amicus Design System" across the product — re-tinted from Spectrum-violet to the shipped clay→gold rail-yard brand on a neutral-black ramp — and unify the Electron app, council HTML report, and marketing site onto one shared token layer.

**Architecture:** A single shared token source (`src/design/tokens.css` + a `src/design/tokens.js` loader) defines clay/gold + neutral-black **once**; the Electron CSS builder, `src/council/report-html.js`, and `site/index.html` all consume it (the site via a drift-guarded `:root` mirror). The Electron UI stays plain-JS template strings; the design system's JSX kit is a **visual spec, never imported**.

**Tech Stack:** Node / CommonJS, Electron (HTML served as `data:` URLs + inline `<style>`), jest (`testEnvironment: node`), plain-JS HTML/CSS string builders, self-hosted Outfit + IBM Plex Mono TTFs.

## Global Constraints

*(Every task's requirements implicitly include this section.)*

- **Plain-JS only.** The Electron UI is JS template strings (`buildWizardCSS`, `buildToolbarHTML`, fold `executeJavaScript`). NEVER import or render the JSX kit — translate its structure/tokens into the existing builders.
- **Single token source.** All colors come from `tokenCss()` / `TOKENS` (`src/design/tokens.js`). No surface redefines clay/gold/neutral independently. Never invent hex beyond the spec re-tint map.
- **Re-tint values verbatim from the spec** (`docs/superpowers/specs/2026-06-29-design-system-adoption-design.md`): accent `#d97757`, accent-light `#e8a07c`, accent-pressed `#c45c3f`, gold `#e8b24a` / `#d49a2e`, accent-soft `rgba(217,119,87,.10)`, accent-glow `rgba(217,119,87,.05)`; neutral ramp bg `#0a0a0a`, surfaces `#111113` / `#161618` / `#1c1c1f`, border `#222225` / `#2c2c30`, text `#f5f5f3` / `#a1a1a0` / `#666`. Provider colors, status, light-ground tiers, and severity are **unchanged** from the design export. Note: `#c45c3f` (spec) intentionally supersedes the app's old pressed-clay `#C4623F` — do not "correct" it back.
- **Loader font URLs (BLOCKER FIX #2):** `tokenCss()` emits **relative** `./fonts/*.ttf` `@font-face` by default (report + site contexts); `tokenCss({ absoluteFontUrls: true })` emits **absolute `file://`** URLs (resolved from `src/design/fonts/`) for the Electron `data:` URL contexts (wizard CSS builder, toolbar) so the bundled fonts actually resolve. A relative URL in a `data:` URL has no base and would silently fall back — defeating spec AC #2.
- **tokens.css uses single-space `--name: #hex;`** (not column-aligned) so both literal and `\s*` assertions hold (BLOCKER FIX #1).
- **SVG stroke color via a CSS class/rule, NEVER `stroke="var(--x)"` as a presentation attribute** — `var()` is invalid in SVG presentation attributes and renders black/invisible. Keep SVG markup hex-free and drive stroke from a `<style>`/class rule; assert the CSS rule + absence of hex, not the attribute (BLOCKER FIX #3).
- **Tests must genuinely fail-then-pass and assert behavior, not dodge a substring.** Font-stack assertions must require `'Outfit'` to lead the stack (not merely forbid one `system-ui` fragment); CSS-rule assertions must match against the whole rule string, not an arbitrary byte-offset slice.
- **Gates before merge:** full jest suite + `npm run lint` + `npm run check:secrets` + `npm run check:sizes` + `npm run generate-docs:check`, all green. Built in a worktree off `main`; PR to `BourbonDog/amicus`. No version bump.

---

## Phase 1 — Token Foundation

These four tasks create the single shared token source the App/Report/Site phases all consume. No surface files change here. Test runner is jest (`npm test`), `testMatch: **/tests/**/*.test.js`, `testEnvironment: node` (per `jest.config.js`).

---

### Task 1: Bundle Outfit + IBM Plex Mono TTFs into src/design/fonts/

**Files:**
- Create dir `src/design/fonts/` — copy 9 TTFs verbatim from the design export `assets/fonts/`.
- Create `tests/design-fonts-bundled.test.js` (new file).

**Interfaces:**
- Consumes: export fonts at `C:/Users/sendt/AppData/Local/Temp/claude/C--Users-sendt-OneDrive-AIProjects-SecondBrain/fb3f1c49-5e0c-41ec-a02e-0253b537d8e4/scratchpad/amicus-design/assets/fonts/`.
- Produces: 9 font files `src/design/fonts/{Outfit-300,Outfit-400,Outfit-500,Outfit-600,Outfit-700,Outfit-800,IBMPlexMono-400,IBMPlexMono-500,IBMPlexMono-600}.ttf` (relied on by `tokenCss()` font-URL rewrite + @font-face).

**Steps:**

- [ ] Write the FAILING test `tests/design-fonts-bundled.test.js`:
  ```js
  const fs = require('fs');
  const path = require('path');

  const FONT_DIR = path.join(__dirname, '..', 'src', 'design', 'fonts');
  const REQUIRED = [
    'Outfit-300.ttf', 'Outfit-400.ttf', 'Outfit-500.ttf',
    'Outfit-600.ttf', 'Outfit-700.ttf', 'Outfit-800.ttf',
    'IBMPlexMono-400.ttf', 'IBMPlexMono-500.ttf', 'IBMPlexMono-600.ttf'
  ];

  describe('bundled design fonts', () => {
    it('ships all 9 required .ttf weights', () => {
      for (const f of REQUIRED) {
        const p = path.join(FONT_DIR, f);
        expect(fs.existsSync(p)).toBe(true);
      }
    });

    it('each font file is a non-empty TrueType binary (0x00010000 magic)', () => {
      for (const f of REQUIRED) {
        const buf = fs.readFileSync(path.join(FONT_DIR, f));
        expect(buf.length).toBeGreaterThan(10000);
        // TTF sfnt version: 0x00010000
        expect(buf.readUInt32BE(0)).toBe(0x00010000);
      }
    });
  });
  ```

- [ ] Run it, expect FAIL: `npx jest tests/design-fonts-bundled.test.js` → fails on `expect(fs.existsSync(p)).toBe(true)` (dir does not exist yet).

- [ ] Minimal implementation — create the dir and copy the 9 TTFs (run from repo root `C:/Users/sendt/dev/amicus`):
  ```bash
  SRC="C:/Users/sendt/AppData/Local/Temp/claude/C--Users-sendt-OneDrive-AIProjects-SecondBrain/fb3f1c49-5e0c-41ec-a02e-0253b537d8e4/scratchpad/amicus-design/assets/fonts"
  mkdir -p src/design/fonts
  for f in Outfit-300 Outfit-400 Outfit-500 Outfit-600 Outfit-700 Outfit-800 IBMPlexMono-400 IBMPlexMono-500 IBMPlexMono-600; do
    cp "$SRC/$f.ttf" "src/design/fonts/$f.ttf"
  done
  ```

- [ ] Run it, expect PASS: `npx jest tests/design-fonts-bundled.test.js` → 2 passing.

- [ ] Commit: `git add src/design/fonts tests/design-fonts-bundled.test.js && git commit -m "design(foundation): bundle Outfit + IBM Plex Mono TTFs into src/design/fonts"`

---

### Task 2: Create src/design/tokens.css with the re-tinted clay/gold token set + @font-face

**Files:**
- Create `src/design/tokens.css` (new file, full content below).
- Create `tests/design-tokens-css.test.js` (new file).

**Interfaces:**
- Consumes: nothing at runtime (static CSS); semantics ported from the design export `tokens/{colors,fonts,typography,effects,spacing}.css`, re-tinted per the spec re-tint map (spec lines 60-117), neutral ramp = site `:root` (canonical, `site/index.html:28-44`).
- Produces: `src/design/tokens.css` — a single `:root{}` block + the `@font-face` rules, read by `tokenCss()`.

> **Single-space declarations (BLOCKER FIX #1).** All `--name: #hex;` declarations use a **single space** after the colon (never column-aligned padding), so both literal `toContain('--accent: #d97757')` and `/\s*/` regex assertions hold. Do not re-introduce alignment padding.

**Steps:**

- [ ] Write the FAILING test `tests/design-tokens-css.test.js`:
  ```js
  const fs = require('fs');
  const path = require('path');

  const CSS = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'design', 'tokens.css'),
    'utf8'
  );

  describe('src/design/tokens.css', () => {
    it('has a single :root block', () => {
      const roots = CSS.match(/:root\s*\{/g) || [];
      expect(roots.length).toBe(1);
    });

    it('uses the clay/gold accents, never Spectrum violet/lime', () => {
      expect(CSS).toMatch(/--accent:\s*#d97757/);
      expect(CSS).toMatch(/--accent-2:\s*#e8b24a/);
      expect(CSS.toLowerCase()).not.toContain('#8b5cf6'); // violet-500
      expect(CSS.toLowerCase()).not.toContain('#a3e635'); // lime-400
      expect(CSS.toLowerCase()).not.toContain('#7c3aed'); // violet-600
    });

    it('uses the neutral-black ramp (site canonical), never plum/void', () => {
      expect(CSS).toMatch(/--bg:\s*#0a0a0a/);
      expect(CSS).toMatch(/--surface-1:\s*#111113/);
      expect(CSS).toMatch(/--border:\s*#222225/);
      expect(CSS).toMatch(/--text-1:\s*#f5f5f3/);
      expect(CSS.toLowerCase()).not.toContain('#0c0a14'); // plum-bg
      expect(CSS.toLowerCase()).not.toContain('#08070d'); // void-bg
    });

    it('keeps provider anthropic clay fixed', () => {
      expect(CSS).toMatch(/--pv-anthropic:\s*#D97757/i);
    });

    it('declares @font-face for Outfit and IBM Plex Mono with relative ttf urls', () => {
      expect(CSS).toMatch(/@font-face/);
      expect(CSS).toMatch(/font-family:\s*'Outfit'/);
      expect(CSS).toMatch(/font-family:\s*'IBM Plex Mono'/);
      expect(CSS).toMatch(/url\('\.\/fonts\/Outfit-400\.ttf'\)\s*format\('truetype'\)/);
      expect(CSS).toMatch(/url\('\.\/fonts\/IBMPlexMono-400\.ttf'\)\s*format\('truetype'\)/);
    });

    it('retains the council light-ground tier palette + ink', () => {
      expect(CSS).toMatch(/--tier-confirmed:\s*#d7ead0/);
      expect(CSS).toMatch(/--tier-confirmed-ink:\s*#15803d/);
      expect(CSS).toMatch(/--tier-disputed-ink:\s*#a21caf/);
    });
  });
  ```

- [ ] Run it, expect FAIL: `npx jest tests/design-tokens-css.test.js` → fails reading the file (ENOENT, `src/design/tokens.css` does not exist).

- [ ] Minimal implementation — create `src/design/tokens.css` with EXACTLY this content (neutrals from `site/index.html:28-44`; accents/lime re-tinted per spec lines 62-80; status/provider/tier/severity carried verbatim from the export `colors.css`; spacing/effects/typography ported color-free; @font-face uses `./fonts/*.ttf` relative to this file). **Every `--name: #hex;` uses a single space after the colon — no column alignment (BLOCKER FIX #1):**
  ```css
  /* ==========================================================================
     Amicus — shared design tokens (clay/gold, neutral-black)
     Single source of truth for the Electron app, council report, and site.
     Re-tinted from the "Spectrum" design export to the shipped clay→gold brand
     on the site's canonical neutral-black ramp. Injected by src/design/tokens.js.
     ========================================================================== */

  /* ---- Webfonts (bundled, self-hosted) ---------------------------------- */
  /* Paths are relative to THIS file (src/design/tokens.css). The loader
     rewrites them to absolute file:// URLs for the Electron app. */
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 300; font-display: swap; src: url('./fonts/Outfit-300.ttf') format('truetype'); }
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 400; font-display: swap; src: url('./fonts/Outfit-400.ttf') format('truetype'); }
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 500; font-display: swap; src: url('./fonts/Outfit-500.ttf') format('truetype'); }
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 600; font-display: swap; src: url('./fonts/Outfit-600.ttf') format('truetype'); }
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 700; font-display: swap; src: url('./fonts/Outfit-700.ttf') format('truetype'); }
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 800; font-display: swap; src: url('./fonts/Outfit-800.ttf') format('truetype'); }
  @font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url('./fonts/IBMPlexMono-400.ttf') format('truetype'); }
  @font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500; font-display: swap; src: url('./fonts/IBMPlexMono-500.ttf') format('truetype'); }
  @font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 600; font-display: swap; src: url('./fonts/IBMPlexMono-600.ttf') format('truetype'); }

  :root {
    /* ---- Brand accent · clay (re-tinted from violet) ------------------- */
    --accent-500: #d97757;   /* the one brand accent (was #8B5CF6)         */
    --accent-400: #e8a07c;   /* lighter tint — hover text (was #A78BFA)    */
    --accent-600: #c45c3f;   /* pressed / hover fill (was #7C3AED); spec value — intentionally supersedes the app's old #C4623F */
    --accent-soft: rgba(217, 119, 87, 0.10);  /* tint wash / selected — site --asoft */
    --accent-glow: rgba(217, 119, 87, 0.05);  /* radial glow — site --aglow */
    --accent-line: rgba(217, 119, 87, 0.28);  /* dashed connectors, borders */

    /* ---- Counter-accent · gold (re-tinted from lime) ------------------- */
    --gold-400: #e8b24a;   /* counter-accent (was #A3E635)                 */
    --gold-500: #d49a2e;   /* deeper gold (was #84CC16)                    */
    --gold-soft: rgba(232, 178, 74, 0.12);
    --gold-line: rgba(232, 178, 74, 0.28);

    /* ---- Neutral-black ramp (site :root — canonical) ------------------- */
    --bg: #0a0a0a;             /* page / window background                */
    --surface-1: #111113;      /* card / input / inset (site --s1)        */
    --surface-2: #161618;      /* raised / hover (site --s2)              */
    --surface-3: #1c1c1f;      /* inset row (site --s3)                   */
    --surface-sel: #1e1613;    /* selected row (app-additive, provisional)*/
    --border: #222225;         /* hairline                                */
    --border-strong: #2c2c30;  /* hover / focus hairline (site --border2) */
    --text-1: #f5f5f3;         /* primary text                            */
    --text-2: #a1a1a0;         /* secondary text                          */
    --text-3: #666666;         /* tertiary / muted (site --t3 #666)       */
    --text-4: #3a3a3e;         /* disabled / faint (app-additive)         */

    /* ---- Semantic status (unchanged from export) ---------------------- */
    --ok: #6BBF6B;
    --ok-bright: #4ade80;
    --warn: #FBBF24;
    --danger: #E05252;
    --running: #4ade80;

    /* ---- Council verdict tiers (report tables, light ground) ----------- */
    --tier-confirmed: #d7ead0;
    --tier-contested: #efe4c4;
    --tier-disputed: #ecd4ec;
    --tier-singleton: #e2e0ea;
    --tier-confirmed-ink: #15803d;
    --tier-contested-ink: #b45309;
    --tier-disputed-ink: #a21caf;
    --tier-singleton-ink: #4b5563;

    /* ---- Severity ----------------------------------------------------- */
    --sev-blocker: #E05252;
    --sev-major: #FBBF24;
    --sev-minor: #a1a1a0;
    --sev-nit: #666666;

    /* ---- Provider brand colors (fixed external brands) ----------------- */
    --pv-anthropic: #D97757;
    --pv-google: #4285F4;
    --pv-openai: #10A37F;
    --pv-deepseek: #4D6BFE;
    --pv-meta: #0081FB;
    --pv-xai: #ECE9F5;
    --pv-openrouter: #6566F1;

    /* ---- Semantic aliases --------------------------------------------- */
    --surface: var(--surface-1);
    --surface-hover: var(--surface-2);
    --text: var(--text-1);
    --text-muted: var(--text-2);
    --text-faint: var(--text-3);
    --text-disabled: var(--text-4);
    --accent: #d97757;
    --accent-hover: var(--accent-600);
    --accent-2: #e8b24a;
    --accent-text: #ffffff;
    --on-accent: #ffffff;
    --focus-ring: var(--accent-500);

    /* ---- Typography --------------------------------------------------- */
    --font-sans: 'Outfit', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --font-mono: 'IBM Plex Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace;
    --w-light: 300; --w-regular: 400; --w-medium: 500;
    --w-semibold: 600; --w-bold: 700; --w-extra: 800;
    --fs-9: 9px; --fs-10: 10px; --fs-11: 11px; --fs-12: 12px;
    --fs-13: 13px; --fs-15: 15px; --fs-18: 18px; --fs-22: 22px;
    --lh-tight: 1.08; --lh-snug: 1.3; --lh-body: 1.6; --lh-relaxed: 1.7; --lh-display: 0.92;
    --ls-display: -0.05em; --ls-tight: -0.03em; --ls-normal: -0.01em;
    --ls-eyebrow: 0.14em; --ls-label: 0.5px; --ls-brand: 0.8px;

    /* ---- Radii / borders / shadows / motion (color-free, from export) -- */
    --r-2: 2px; --r-3: 3px; --r-4: 4px; --r-6: 6px; --r-7: 7px;
    --r-8: 8px; --r-10: 10px; --r-12: 12px; --r-full: 999px;
    --bd: 1px solid var(--border);
    --bd-strong: 1px solid var(--border-strong);
    --bd-accent: 1px solid var(--accent-500);
    --bd-dashed: 1px dashed var(--border);
    --bd-connector: 0.8px dashed var(--accent-line);
    --shadow-none: none;
    --shadow-card: 0 1px 2px rgba(0,0,0,0.25);
    --shadow-pop: 0 8px 24px rgba(0,0,0,0.45);
    --shadow-glow: 0 0 0 3px var(--accent-soft);
    --ease-out: cubic-bezier(.16, 1, .3, 1);
    --ease-std: ease;
    --dur-fast: 0.15s; --dur-mid: 0.25s; --dur-slow: 0.7s;

    /* ---- Spacing ------------------------------------------------------ */
    --space-1: 2px; --space-2: 4px; --space-3: 6px; --space-4: 8px;
    --space-5: 10px; --space-6: 12px; --space-7: 14px; --space-8: 16px;
    --space-10: 20px; --space-12: 24px; --space-16: 32px;
    --space-20: 40px; --space-24: 48px; --space-32: 64px;
    --pad-pill: 3px 8px;
    --pad-btn-sm: 5px 14px;
    --pad-btn: 7px 12px;
    --pad-input: 7px 10px;
    --pad-card: 12px 16px;
    --toolbar-h: 40px;
    --gap-row: 8px;
  }
  ```

- [ ] Run it, expect PASS: `npx jest tests/design-tokens-css.test.js` → 6 passing.

- [ ] Commit: `git add src/design/tokens.css tests/design-tokens-css.test.js && git commit -m "design(foundation): add re-tinted clay/gold tokens.css + @font-face"`

---

### Task 3: Create src/design/tokens.js loader (tokenCss + TOKENS)

**Files:**
- Create `src/design/tokens.js` (new file, full content below).
- Create `tests/design-tokens-loader.test.js` (new file).

**Interfaces:**
- Consumes: `src/design/tokens.css` (read from disk via `fs`).
- Produces (CommonJS): `module.exports = { tokenCss, TOKENS }`.
  - `tokenCss(opts?)` → returns the full `:root{}` + `@font-face` CSS STRING. With `opts.absoluteFontUrls === true` (Electron), the `./fonts/*.ttf` URLs are rewritten to absolute `file://` URLs under `src/design/fonts/`; default (false) leaves them relative for the report/site context (BLOCKER FIX #2).
  - `TOKENS` → flat JS map of canonical hex/rgba values: `{ accent, gold, bg, surface1, surface2, surface3, border, borderStrong, text1, text2, text3, accentSoft, accentGlow, running }`. (The last three are required by the Phase-4 site drift guard, which maps the site's `--asoft`/`--aglow`/`--green` short names.)

**Steps:**

- [ ] Write the FAILING test `tests/design-tokens-loader.test.js`:
  ```js
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
  ```

- [ ] Run it, expect FAIL: `npx jest tests/design-tokens-loader.test.js` → fails on `require('../src/design/tokens')` (Cannot find module).

- [ ] Minimal implementation — create `src/design/tokens.js`:
  ```js
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
  ```

- [ ] Run it, expect PASS: `npx jest tests/design-tokens-loader.test.js` → 4 passing.

- [ ] Commit: `git add src/design/tokens.js tests/design-tokens-loader.test.js && git commit -m "design(foundation): add tokens.js loader (tokenCss + TOKENS)"`

> **Note on the site drift guard.** The site↔`TOKENS` regression test is owned by the Phase 4 task (`tests/design-site-drift.test.js`), which is the single authoritative drift guard the architecture calls for. It maps the site's short var names (`--asoft`/`--aglow`/`--green`) to the `accentSoft`/`accentGlow`/`running` keys added above. Do not also add a second, partially-overlapping foundation drift test — one guard, owned by Phase 4.

---

## Phase 2a — Electron Setup Wizard

> **Phase 2a scope note (read once).** These three tasks rewrite the Electron *setup wizard* only. `electron/toolbar.js` and `electron/fold.js` are the Phase-2b tasks (not here). Every task below consumes the Phase-1 foundation module `src/design/tokens.js` (`tokenCss()` → full `:root{…}` + `@font-face` CSS string; `TOKENS` → flat hex map). **The wizard CSS builder injects `tokenCss({ absoluteFontUrls: true })`** because the wizard HTML is served via a `data:` URL where a relative font URL has no base to resolve against (BLOCKER FIX #2). The wizard CSS variable names this area consumes — all emitted by `tokenCss()` and re-tinted to clay/gold/neutral-black per the spec re-tint tables — are: `--bg`, `--surface`, `--surface-hover`, `--surface-sel`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--text-disabled`, `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft`, `--ok`, `--danger`, `--warn`, `--font-sans`, `--font-mono`, `--r-3`, `--r-4`, `--r-6`, `--r-8`, `--dur-fast`, `--ease-out`.

---

### Task 4: Re-tint `buildWizardCSS` onto the shared token loader (prepend `tokenCss({ absoluteFontUrls: true })`, swap every hex for token vars)

**Files:**
- Modify `electron/setup-ui-styles.js` lines 1–333 (full rewrite of the `buildWizardCSS` body; the `module.exports` line changes to also export the new `__rawWizardCSS` helper for testing).
- Modify `tests/setup-ui.test.js` lines 40–44 (the `should use the dark theme colors` test — old hex assertions are replaced with token-var assertions).
- Create `tests/electron/setup-ui-styles.test.js` (new drift/token test for the CSS builder).

**Interfaces:**
- Consumes: `tokenCss({ absoluteFontUrls: true })` from `src/design/tokens.js` (Phase 1). Returns the full `:root{…}` + `@font-face` CSS **string** with absolute `file://` ttf URLs (BLOCKER FIX #2 — the wizard is a `data:` URL context).
- Consumes (CSS vars in the emitted `:root`): `--bg --surface --surface-hover --surface-sel --border --border-strong --text --text-muted --text-faint --text-disabled --accent --accent-hover --accent-text --accent-soft --ok --danger --warn --font-sans --font-mono --r-4 --r-6 --dur-fast`.
- Produces: `buildWizardCSS()` (unchanged signature: `() => string`) — now returns `tokenCss({ absoluteFontUrls: true }) + <re-tinted wizard rules>`. Also produces `__rawWizardCSS()` (`() => string`) returning ONLY the wizard rules (no token block) so tests can assert against the rules without the injected `:root`.

- [ ] **Write the failing test.** Create `tests/electron/setup-ui-styles.test.js`:
```js
'use strict';
const { buildWizardCSS, __rawWizardCSS } = require('../../electron/setup-ui-styles');
const { TOKENS } = require('../../src/design/tokens');

describe('buildWizardCSS — token adoption', () => {
  let css, rules;
  beforeAll(() => { css = buildWizardCSS(); rules = __rawWizardCSS(); });

  test('prepends the shared token :root + @font-face block', () => {
    expect(css).toContain(':root');
    expect(css).toContain('@font-face');
    expect(css).toContain("font-family: 'Outfit'");
    expect(css).toContain("font-family: 'IBM Plex Mono'");
    // the token block carries the canonical clay accent
    expect(css).toContain(TOKENS.accent); // '#d97757'
  });

  test('injects ABSOLUTE file:// font URLs so fonts resolve in the data: URL context (BLOCKER FIX #2)', () => {
    // buildWizardCSS() must use tokenCss({ absoluteFontUrls: true }); a relative
    // ./fonts/ url in a data: URL has no base and silently falls back.
    expect(css).toMatch(/url\('file:\/\/[^']*Outfit-400\.ttf'\)/);
    expect(css).not.toContain("url('./fonts/");
  });

  test('the wizard RULES reference token vars, not raw hex', () => {
    expect(rules).toContain('var(--bg)');
    expect(rules).toContain('var(--accent)');
    expect(rules).toContain('var(--surface)');
    expect(rules).toContain('var(--border)');
    expect(rules).toContain('var(--text)');
    expect(rules).toContain('font-family: var(--font-sans)');
    expect(rules).toContain('font-family: var(--font-mono)');
  });

  test('no warm-brown / SF-Mono-only hardcodes survive in the wizard rules', () => {
    // the old plum/warm-brown ramp and ad-hoc hex are fully replaced.
    // NOTE: #c45c3f (spec --accent-600) lives only in the injected :root, never
    // in these rules; the old app hover hex #C4623F is what is forbidden here.
    for (const dead of ['#2D2B2A', '#3D3A38', '#E8E0D8', '#A09B96', '#7A756F',
                        '#5A5550', '#1E1C1B', '#352E2B', '#34312F', '#4A3328',
                        '#1F1D1C', '#D4D0CC', '#C4623F']) {
      expect(rules).not.toContain(dead);
    }
    // the only raw hex allowed in rules is #fff on accent fills (button/pill text)
    const hexes = (rules.match(/#[0-9a-fA-F]{3,6}/g) || []).map(h => h.toLowerCase());
    for (const h of hexes) { expect(['#fff', '#ffffff']).toContain(h); }
  });

  test('mono families come from the token var (no inline SF Mono stacks left)', () => {
    expect(rules).not.toContain("'SF Mono'");
    expect(rules).not.toContain('Menlo');
  });
});
```

- [ ] **Run it — expect FAIL.** `cd C:/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-styles.test.js`
  Expected: fails because `__rawWizardCSS` is not exported (`__rawWizardCSS is not a function`), the `file://` font-URL assertion fails (no absolute URLs / no `tokenCss()` injection yet), and the `var(--bg)` / `not.toContain('#2D2B2A')` assertions fail because the current file is all raw hex.

- [ ] **Implement — rewrite `electron/setup-ui-styles.js` in full:**
```js
/** Setup UI - Shared CSS Styles (clay/gold token-driven) */
const { tokenCss } = require('../src/design/tokens');

/** The wizard's own rules, token-var-driven. No :root here — tokenCss() supplies it. */
function __rawWizardCSS() {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--font-sans);
    display: flex; flex-direction: column; height: 100vh; user-select: none;
    overflow: hidden;
  }

  /* Header */
  .header {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 20px; border-bottom: 1px solid var(--border);
  }
  .header svg { flex-shrink: 0; }
  .header svg path { stroke: var(--accent); }
  .header-title {
    color: var(--accent); font-size: 12px; font-weight: 600;
    letter-spacing: 0.8px; text-transform: uppercase;
  }

  /* Progress bar / stepper */
  .progress-bar {
    display: flex; align-items: center; justify-content: center;
    gap: 14px; padding: 10px 20px; border-bottom: 1px solid var(--border);
  }
  .progress-step {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--text-faint);
  }
  .progress-step.active { color: var(--accent); }
  .progress-step.done { color: var(--ok); }
  .progress-dot {
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid var(--border-strong); display: flex;
    align-items: center; justify-content: center;
    font-size: 9px; font-weight: 600;
  }
  .progress-step.active .progress-dot {
    border-color: var(--accent); background: var(--accent); color: var(--accent-text);
  }
  .progress-step.done .progress-dot {
    border-color: var(--ok); background: var(--ok); color: var(--accent-text);
  }
  .progress-connector { width: 24px; height: 2px; background: var(--border); }

  /* Content area */
  .content { flex: 1; padding: 16px 20px; overflow-y: auto; }
  .wizard-step { display: none; }
  .wizard-step.visible { display: block; }

  /* Shared typography */
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; color: var(--text); }
  .subtitle { color: var(--text-muted); font-size: 13px; margin-bottom: 14px; }

  /* Provider picker (Step 1) */
  .provider-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .provider-btn {
    display: flex; flex-direction: column; gap: 1px; position: relative;
    padding: 8px 12px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-6); cursor: pointer; text-align: left;
    transition: border-color var(--dur-fast), background var(--dur-fast);
  }
  .provider-btn:hover { border-color: var(--border-strong); }
  .provider-btn.selected { border-color: var(--accent); background: var(--surface-sel); }
  .provider-name {
    color: var(--text); font-size: 13px; font-weight: 500;
    display: flex; align-items: center; gap: 6px;
  }
  .provider-desc { color: var(--text-faint); font-size: 11px; }
  .provider-check { position: absolute; top: 8px; right: 12px; font-size: 13px; color: var(--ok); }
  .badge {
    font-size: 9px; background: var(--accent); color: var(--accent-text); padding: 1px 5px;
    border-radius: var(--r-3); font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Key input (Step 1) */
  .key-section { display: none; }
  .key-section.visible { display: block; }
  .field-label {
    display: block; color: var(--text-muted); font-size: 11px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
  }
  .input-row { display: flex; gap: 6px; margin-bottom: 6px; }
  .input-row input {
    flex: 1; padding: 7px 10px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-6); color: var(--text); font-size: 13px;
    font-family: var(--font-mono); outline: none;
    transition: border-color var(--dur-fast);
  }
  .input-row input:focus { border-color: var(--accent); }
  .input-row input::placeholder { color: var(--text-faint); }
  .input-wrap {
    flex: 1; position: relative; display: flex; align-items: center;
  }
  .input-wrap input { width: 100%; padding-right: 34px; }
  .eye-btn {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; color: var(--text-faint);
    padding: 2px; display: flex; align-items: center; transition: color var(--dur-fast);
  }
  .eye-btn:hover { color: var(--text-muted); }
  .eye-btn.active { color: var(--accent); }
  .key-actions {
    display: flex; align-items: center; justify-content: space-between;
    min-height: 18px; margin-bottom: 8px;
  }
  .remove-btn {
    background: none; border: none; color: var(--danger); font-size: 11px;
    cursor: pointer; padding: 0; opacity: 0.8; transition: opacity var(--dur-fast);
  }
  .remove-btn:hover { opacity: 1; text-decoration: underline; }
  .test-btn {
    padding: 7px 12px; background: transparent; border: 1px solid var(--border);
    border-radius: var(--r-6); color: var(--text-muted); font-size: 12px; cursor: pointer;
    white-space: nowrap; transition: border-color var(--dur-fast), color var(--dur-fast);
  }
  .test-btn:hover { border-color: var(--accent); color: var(--accent); }
  .test-btn:disabled { opacity: 0.5; cursor: default; }
  .input-row input.input-valid {
    border-color: var(--ok); background: var(--accent-soft);
  }
  .input-row input.input-invalid {
    border-color: var(--danger); background: var(--accent-soft);
  }
  .input-row input.input-testing {
    border-color: var(--accent);
  }
  #status-msg { font-size: 12px; min-height: 16px; margin-bottom: 8px; }
  .status-valid { color: var(--ok); }
  .status-invalid { color: var(--danger); }
  .status-testing { color: var(--text-muted); }
  .help-link { color: var(--text-faint); font-size: 12px; }
  .help-link a { color: var(--accent); text-decoration: none; }
  .help-link a:hover { text-decoration: underline; }

  /* Model cards (Step 2) */
  .model-list { display: flex; flex-direction: column; gap: 4px; }
  .model-card {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 9px 12px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-6); cursor: pointer;
    transition: border-color var(--dur-fast), background var(--dur-fast);
  }
  .model-card:hover { border-color: var(--border-strong); }
  .model-card:has(input:checked) { border-color: var(--accent); background: var(--surface-sel); }
  .model-card.model-unavailable {
    opacity: 0.45; cursor: not-allowed; border-color: var(--border);
  }
  .model-card.model-unavailable:hover { border-color: var(--border); }
  .model-card input[type="radio"] { accent-color: var(--accent); }
  .model-alias { color: var(--text); font-weight: 500; font-size: 13px; min-width: 80px; font-family: var(--font-mono); }
  .model-label { color: var(--text-muted); font-size: 12px; }
  .no-key-hint {
    margin-left: auto; font-size: 10px; color: var(--text-faint); font-style: italic;
  }

  /* Route toggle / RoutePill (Step 2) */
  .route-toggle {
    display: flex; gap: 0; margin-left: auto;
  }
  .route-pill {
    padding: 3px 8px; font-size: 10px; font-weight: 500;
    font-family: var(--font-sans);
    background: var(--surface); border: 1px solid var(--border);
    color: var(--text-faint); cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast);
  }
  .route-pill:first-child { border-radius: var(--r-4) 0 0 var(--r-4); }
  .route-pill:last-child { border-radius: 0 var(--r-4) var(--r-4) 0; border-left: none; }
  .route-pill:only-child { border-radius: var(--r-4); }
  .route-pill.active {
    background: var(--accent); color: var(--accent-text); border-color: var(--accent);
  }
  .route-pill:hover:not(.active) { border-color: var(--border-strong); color: var(--text-muted); }
  .route-static {
    margin-left: auto; font-size: 11px; color: var(--text-faint); font-style: italic;
  }

  /* Routing example */
  .routing-example {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-8);
    padding: 12px 16px; margin-bottom: 12px;
  }
  .example-label {
    font-size: 10px; color: var(--text-faint); text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 10px; font-weight: 600;
  }
  .example-flow { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .example-step {
    display: flex; align-items: center; gap: 6px; width: 100%;
    background: var(--surface-hover); border: 1px solid var(--border);
    border-radius: var(--r-6); padding: 6px 10px;
  }
  .example-step svg { flex-shrink: 0; }
  .example-connector { display: flex; align-items: center; transform: rotate(90deg); }
  .example-cmd {
    font-family: var(--font-mono); font-size: 12px;
    color: var(--text-muted); overflow: hidden; text-overflow: ellipsis;
  }
  .example-cmd strong { color: var(--accent); }
  .example-model {
    font-family: var(--font-mono); font-size: 11px;
    color: var(--ok); overflow: hidden; text-overflow: ellipsis;
  }

  /* Alias editor (Step 3) */
  .alias-editor { margin-top: 16px; }
  .alias-divider {
    text-align: center; color: var(--text-faint); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;
    border-top: 1px solid var(--border); padding-top: 12px;
  }
  .alias-search {
    width: 100%; padding: 7px 10px; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--r-6); color: var(--text);
    font-size: 12px; font-family: var(--font-mono);
    outline: none; margin-bottom: 8px; transition: border-color var(--dur-fast);
  }
  .alias-search:focus { border-color: var(--accent); }
  .alias-search::placeholder { color: var(--text-faint); }
  .alias-group { margin-bottom: 2px; }
  .alias-group summary {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    cursor: pointer; font-size: 12px; font-weight: 500; color: var(--text-muted);
    border-radius: var(--r-4); transition: color var(--dur-fast); list-style: none;
  }
  .alias-group summary::-webkit-details-marker { display: none; }
  .alias-group summary::before {
    content: '\\25B6'; font-size: 8px; color: var(--text-faint); transition: transform var(--dur-fast);
  }
  .alias-group[open] summary::before { transform: rotate(90deg); }
  .alias-group summary:hover { color: var(--accent); }
  .alias-group summary .alias-count { color: var(--text-faint); font-weight: 400; }
  .alias-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px 3px 22px; font-size: 12px;
  }
  .alias-name {
    font-family: var(--font-mono);
    color: var(--text); min-width: 90px; cursor: pointer;
  }
  .alias-arrow { color: var(--text-faint); font-size: 11px; }
  .alias-model {
    flex: 1; font-family: var(--font-mono);
    color: var(--text-faint); font-size: 11px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
  }
  .alias-delete {
    background: none; border: none; color: var(--text-faint); cursor: pointer;
    font-size: 14px; padding: 0 4px; transition: color var(--dur-fast);
  }
  .alias-delete:hover { color: var(--danger); }
  .alias-name-input, .alias-model-input {
    padding: 2px 6px; background: var(--surface); border: 1px solid var(--accent);
    border-radius: var(--r-3); color: var(--text); font-size: 12px;
    font-family: var(--font-mono); outline: none;
  }
  .alias-name-input { width: 90px; }
  .alias-model-input { flex: 1; }
  .alias-model-select {
    flex: 1; padding: 2px 4px; background: var(--surface);
    border: 1px solid var(--accent); border-radius: var(--r-3);
    color: var(--text); font-size: 11px;
    font-family: var(--font-mono);
    outline: none; cursor: pointer; max-width: 340px;
  }
  .alias-model-select:focus { border-color: var(--accent); }
  .alias-model-select option { background: var(--surface); color: var(--text); }
  .alias-model-select optgroup { color: var(--text-muted); font-style: normal; }
  .alias-add-btn {
    display: block; width: 100%; padding: 6px; margin-top: 8px;
    background: transparent; border: 1px dashed var(--border);
    border-radius: var(--r-6); color: var(--text-faint); font-size: 12px;
    cursor: pointer; transition: border-color var(--dur-fast), color var(--dur-fast);
  }
  .alias-add-btn:hover { border-color: var(--accent); color: var(--accent); }
  .alias-row.alias-deleted { text-decoration: line-through; opacity: 0.4; pointer-events: none; }
  .alias-row.alias-no-key { opacity: 0.45; }
  .alias-row.alias-no-key .alias-model::after {
    content: ' (no key)'; color: var(--text-faint); font-style: italic; font-size: 10px;
  }

  /* Import notice banner */
  .import-notice {
    background: var(--surface-hover); border: 1px solid var(--accent); border-radius: var(--r-6);
    padding: 8px 12px; margin-bottom: 12px; font-size: 11px;
    color: var(--accent); display: flex; align-items: center; gap: 8px;
  }
  .import-notice .dismiss { cursor: pointer; margin-left: auto; opacity: 0.6; }
  .import-notice .dismiss:hover { opacity: 1; }

  /* Review (Step 4) */
  .review-section { margin-bottom: 14px; }
  .review-label { color: var(--text-muted); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .review-value { color: var(--text); font-size: 13px; line-height: 1.5; }

  /* Footer */
  .footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 20px; border-top: 1px solid var(--border);
  }
  .footer-brand {
    color: var(--accent); font-size: 10px; font-weight: 600;
    letter-spacing: 0.8px; text-transform: uppercase;
    display: flex; align-items: center; gap: 6px;
  }
  .footer-brand svg path { stroke: var(--accent); }
  .footer-nav { display: flex; gap: 6px; }
  .nav-btn {
    padding: 6px 16px; border: 1px solid var(--border);
    border-radius: var(--r-6); font-size: 12px; font-weight: 500;
    cursor: pointer; transition: border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast);
    background: transparent; color: var(--text-muted);
  }
  .nav-btn:hover { border-color: var(--accent); color: var(--accent); }
  .nav-btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .nav-btn.primary:hover { background: var(--accent-hover); }
  .nav-btn:disabled { opacity: 0.4; cursor: default; }

  /* Catalog search (Step 2) */
  .search-head { display: flex; gap: 8px; margin: 18px 0 8px; }
  #model-search-input { flex: 1; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--r-6); padding: 8px 10px; font-size: 13px; font-family: var(--font-mono); }
  .search-meta { color: var(--text-faint); font-size: 11px; margin-bottom: 6px; }
  .search-results { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--r-6); }
  .search-results:empty { border: none; }
  .search-row { padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--border); }
  .search-row:hover { background: var(--surface-hover); }
  .search-row.selected { background: var(--surface-sel); outline: 1px solid var(--accent); }
  .search-row-id { color: var(--text); font-size: 12px; font-family: var(--font-mono); }
  .search-row-sub { color: var(--text-muted); font-size: 11px; margin-top: 2px; }
  .icon-btn { background: none; border: 1px solid var(--border); border-radius: var(--r-6); color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 6px 10px; }
  .icon-btn:hover { border-color: var(--accent); color: var(--accent); }
  .icon-btn:disabled { opacity: 0.5; cursor: default; }
  .search-label { margin: 14px 0 6px; font-size: 12px; opacity: 0.75; }
  .pick-badge { font-size: 10px; padding: 1px 5px; border-radius: var(--r-3); background: var(--surface-hover); color: var(--text-muted); margin-left: 6px; }
  .model-resolved { display: block; font-size: 11px; opacity: 0.6; font-family: var(--font-mono); }
  .write-preview { display: none; font-size: 11px; margin-top: 4px; }
  .write-preview-active { display: block; }

  /* Free council picker (Step 2) */
  .council-section { margin-top: 14px; }
  .council-toggle { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); cursor: pointer; }
  .council-results { max-height: 160px; overflow-y: auto; margin-top: 6px; }
  .council-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; color: var(--text); font-family: var(--font-mono); }
  .council-row input[type="checkbox"] { accent-color: var(--accent); }
  .council-note { font-size: 10px; color: var(--text-faint); margin-top: 6px; line-height: 1.4; }`;
}

function buildWizardCSS() {
  return tokenCss({ absoluteFontUrls: true }) + __rawWizardCSS();
}

module.exports = { buildWizardCSS, __rawWizardCSS };
```
> Notes on this rewrite vs. the original 333 lines: `buildWizardCSS()` calls `tokenCss({ absoluteFontUrls: true })` so the `@font-face` `src` URLs become absolute `file://` paths under `src/design/fonts/` — required because the wizard HTML loads via a `data:` URL where relative font URLs have no base (BLOCKER FIX #2). The header/footer brand-SVG strokes are driven by `.header svg path { stroke: var(--accent); }` / `.footer-brand svg path { stroke: var(--accent); }` CSS rules (BLOCKER FIX #3 — `var()` is invalid as a presentation attribute); Task 5 removes the corresponding hardcoded `stroke="#D97757"` from the markup. The `input-valid`/`input-invalid` backgrounds collapse from `#1E2B1E`/`#2B1E1E` onto `var(--accent-soft)` (no dedicated success/danger wash token exists in the contract — accent-soft is the closest spec-sanctioned tint and keeps both legible against the green/red border). `.model-alias`, `.search-row-id`, `#model-search-input` gain `font-family: var(--font-mono)` to match the kit's mono treatment for ids. The previously-CSS-less `.council-*` rules (free-council picker, which had NO styles before — they relied on inherited `.search-meta` only) are added here token-driven so the new section reads on-brand. `--accent-600 #c45c3f` (consumed via `--accent-hover`) is the spec's pressed-clay value and intentionally supersedes the app's old `#C4623F` — reviewers should not "correct" it back.

- [ ] **Run it — expect PASS.** `cd C:/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-styles.test.js`
  Expected: `Tests: 5 passed`.

- [ ] **Update the existing color assertion in `tests/setup-ui.test.js`.** Replace lines 40–44:
```js
    it('should use the dark theme colors', () => {
      expect(html).toContain('#2D2B2A'); // background
      expect(html).toContain('#D97757'); // accent
      expect(html).toContain('#E8E0D8'); // text
    });
```
  with:
```js
    it('should ride the shared clay/gold token layer (no warm-brown ramp)', () => {
      const { TOKENS } = require('../src/design/tokens');
      expect(html).toContain(TOKENS.accent);   // '#d97757' from the injected :root
      expect(html).toContain('var(--bg)');      // wizard rules reference tokens
      expect(html).toContain('var(--accent)');
      expect(html).not.toContain('#2D2B2A');    // the old warm-brown background is gone
    });
```

- [ ] **Run the full setup-ui suite — expect PASS.** `cd C:/Users/sendt/dev/amicus && npx jest tests/setup-ui.test.js tests/electron/setup-ui-styles.test.js`
  Expected: both files green (the other `setup-ui.test.js` cases assert on classes/ids/text, not hex, so they are unaffected).

- [ ] **Commit.** `git add electron/setup-ui-styles.js tests/setup-ui.test.js tests/electron/setup-ui-styles.test.js && git commit -m "Phase 2a: re-tint buildWizardCSS onto shared clay/gold token loader (absolute font URLs)"`

---

### Task 5: Drive the wizard inline-SVG strokes from CSS class rules (header/footer/alias icons), hex-free markup

> **BLOCKER FIX #3.** `var()` is invalid in an SVG presentation attribute — `stroke="var(--accent)"` resolves to black/none in Chromium. This task makes the wizard SVG markup **hex-free** and drives stroke from CSS rules (matching the toolbar task's correct approach). The header/footer-brand stroke rules already ship in Task 4's `__rawWizardCSS()` (`.header svg path`, `.footer-brand svg path`); this task adds the alias-icon stroke rules and strips the hardcoded hex from the three markup builders.

**Files:**
- Modify `electron/setup-ui.js` line 36 (header logo SVG) and line 53 (footer brand SVG) — remove the inline `stroke="#D97757"` (now driven by the `.header svg path` / `.footer-brand svg path` rules from Task 4).
- Modify `electron/setup-ui-aliases.js` lines 54–56 (`terminalIcon`, `arrowIcon`, `modelIcon`) — remove inline strokes (`#D97757`, `#5A5550`, `#6BBF6B`) and add class hooks so a CSS rule drives them.
- Modify `electron/setup-ui-styles.js` `__rawWizardCSS()` — append the alias-icon stroke rules (`.alias-icon-accent path`, `.alias-icon-faint path`, `.alias-icon-ok path`).
- Create `tests/electron/setup-ui-svg-tokens.test.js` (new).

**Interfaces:**
- Consumes: `buildSetupHTML()` from `electron/setup-ui.js`; `buildAliasEditorHTML(aliases)` from `electron/setup-ui-aliases.js`; `__rawWizardCSS()` from `electron/setup-ui-styles.js`. (No signature changes.)
- Produces: no new exports — the rendered HTML strings now carry hex-free SVGs whose strokes are resolved by CSS rules referencing `--accent`, `--ok`, `--text-faint`. The SVG chrome tracks the token theme correctly (real, visible strokes — not the invalid presentation-attribute `var()`).

- [ ] **Write the failing test.** Create `tests/electron/setup-ui-svg-tokens.test.js`:
```js
'use strict';
const { buildSetupHTML } = require('../../electron/setup-ui');
const { buildAliasEditorHTML } = require('../../electron/setup-ui-aliases');
const { __rawWizardCSS } = require('../../electron/setup-ui-styles');

describe('wizard inline-SVG strokes are driven by CSS rules, hex-free markup (BLOCKER FIX #3)', () => {
  test('header + footer brand markup carries no stroke hex and no invalid attribute var()', () => {
    const html = buildSetupHTML();
    // the old hardcoded clay hex is gone from the document chrome
    expect(html).not.toContain('stroke="#D97757"');
    // var() must NEVER appear as a presentation attribute (it renders black/none)
    expect(html).not.toContain('stroke="var(--accent)"');
  });

  test('the wizard CSS drives header/footer brand strokes from --accent', () => {
    const rules = __rawWizardCSS();
    expect(rules).toMatch(/\.header svg path\s*\{[^}]*stroke:\s*var\(--accent\)/);
    expect(rules).toMatch(/\.footer-brand svg path\s*\{[^}]*stroke:\s*var\(--accent\)/);
  });

  test('alias example icons are hex-free and class-hooked for accent / ok / faint', () => {
    const frag = buildAliasEditorHTML({ gemini: 'openrouter/google/gemini-3.5-flash' });
    expect(frag).toContain('alias-icon-accent');
    expect(frag).toContain('alias-icon-ok');
    expect(frag).toContain('alias-icon-faint');
    for (const dead of ['#D97757', '#6BBF6B', '#5A5550']) {
      expect(frag).not.toContain(`stroke="${dead}"`);
    }
    expect(frag).not.toContain('stroke="var(--');
  });

  test('the wizard CSS drives the alias-icon strokes from tokens', () => {
    const rules = __rawWizardCSS();
    expect(rules).toMatch(/\.alias-icon-accent path\s*\{[^}]*stroke:\s*var\(--accent\)/);
    expect(rules).toMatch(/\.alias-icon-ok path\s*\{[^}]*stroke:\s*var\(--ok\)/);
    expect(rules).toMatch(/\.alias-icon-faint path\s*\{[^}]*stroke:\s*var\(--text-faint\)/);
  });
});
```

- [ ] **Run it — expect FAIL.** `cd C:/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-svg-tokens.test.js`
  Expected: `not.toContain('stroke="#D97757"')` fails (markup still has literal hex strokes), and the `.alias-icon-*` rule assertions fail (rules not added yet). The `.header svg path` / `.footer-brand svg path` rule assertions pass once Task 4 has landed (those rules ship in Task 4); if running this task before Task 4 they fail too — Task 4 is a prerequisite.

- [ ] **Implement edit 1 — `electron/setup-ui.js` line 36** (header). Remove every `stroke="#D97757"` from the header SVG (the `.header svg path` rule from Task 4 now supplies the stroke). The `terminalIcon`-style markup keeps `stroke-width`/`stroke-linecap`/`stroke-opacity`:
```js
  <div class="header"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2v12" stroke-width="2" stroke-linecap="round"/><path d="M10 2v5c0 2-3 3-7 5" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/></svg><span class="header-title">${brandName} Setup</span></div>
```

- [ ] **Implement edit 2 — `electron/setup-ui.js` line 53** (footer brand). Same removal in the footer SVG (the `.footer-brand svg path` rule supplies the stroke):
```js
  <div class="footer"><div class="footer-brand"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2v12" stroke-width="2" stroke-linecap="round"/><path d="M10 2v5c0 2-3 3-7 5" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/></svg> ${brandName}</div><div class="footer-nav"><button class="nav-btn" id="back-btn" style="display:none">Back</button><button class="nav-btn primary" id="next-btn" disabled>Next</button><button class="nav-btn primary" id="finish-btn" style="display:none">Finish</button></div></div>
```

- [ ] **Implement edit 3 — `electron/setup-ui-aliases.js` lines 54–56** (example icons). Replace the three icon consts — drop the hex strokes, add a class on each `<svg>` so a CSS rule drives the stroke:
```js
  const terminalIcon = `<svg class="alias-icon-accent" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke-width="1.5"/><path d="M4 6l2.5 2L4 10" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 10H11" class="alias-icon-faint-path" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const arrowIcon = `<svg class="alias-icon-accent" width="20" height="12" viewBox="0 0 20 12" fill="none"><path d="M2 6h14" stroke-width="1.5" stroke-linecap="round"/><path d="M13 2l4 4-4 4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const modelIcon = `<svg class="alias-icon-ok" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke-width="1.5"/><path d="M8 8v3" stroke-width="1.5" stroke-linecap="round"/><circle cx="4" cy="13" r="1.5" stroke-width="1.2"/><circle cx="8" cy="13" r="1.5" stroke-width="1.2"/><circle cx="12" cy="13" r="1.5" stroke-width="1.2"/><path d="M4 11.5L8 11M8 11l4 .5" stroke-width="1" stroke-linecap="round"/></svg>`;
```
  > The terminal icon's third path (the cursor "prompt" tick) was the lone `#5A5550` faint stroke; it gets a `alias-icon-faint-path` class so a rule can stroke it `var(--text-faint)` while the rect/arrow stay `var(--accent)`. The `frag.toContain('alias-icon-faint')` test passes via the `alias-icon-faint-path` substring.

- [ ] **Implement edit 4 — append the alias-icon stroke rules to `__rawWizardCSS()` in `electron/setup-ui-styles.js`** (after the `.alias-*` editor rules; before the final backtick):
```js

  /* Alias example-icon strokes — driven by class rules (var() is invalid as an SVG attribute) */
  .alias-icon-accent path,
  .alias-icon-accent rect { stroke: var(--accent); }
  .alias-icon-accent .alias-icon-faint-path { stroke: var(--text-faint); }
  .alias-icon-faint path { stroke: var(--text-faint); }
  .alias-icon-ok path,
  .alias-icon-ok circle { stroke: var(--ok); }
```

- [ ] **Run it — expect PASS.** `cd C:/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-svg-tokens.test.js`
  Expected: `Tests: 4 passed`.

- [ ] **Re-run Task 4's CSS test** (the appended alias-icon rules must not break it): `cd C:/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-styles.test.js` → green.

- [ ] **Run the keys + aliases + setup-ui suites to confirm no regressions.** `cd C:/Users/sendt/dev/amicus && npx jest tests/setup-ui.test.js tests/setup-ui-aliases.test.js tests/electron/setup-ui-keys.test.js tests/electron/setup-ui-title.test.js`
  Expected: all green (none of these assert on the SVG stroke hex).

- [ ] **Commit.** `git add electron/setup-ui.js electron/setup-ui-aliases.js electron/setup-ui-styles.js tests/electron/setup-ui-svg-tokens.test.js && git commit -m "Phase 2a: drive wizard inline-SVG strokes from CSS rules (hex-free markup)"`

---

### Task 6: Adopt the kit's StatusDot pulse + filled provider status-dot treatment on provider rows

> **Finding #6 resolved.** This task's edits are confined to the wizard CSS (`setup-ui-styles.js`) and its test. The `.provider-check` CSS rule alone restyles the existing empty `<span class="provider-check">` (which `setup-ui.js` init sets to `textContent='✓'`) into a filled status dot — **no `setup-ui-keys.js` markup change is needed**, so that file is intentionally NOT in the Files list. (`buildKeysStepHTML` already emits the bare `<span class="provider-check" id="check-…"></span>` that the `:not(:empty)` rule targets once a key validates.)

**Files:**
- Modify `electron/setup-ui-styles.js` `__rawWizardCSS()` — append the `amicusPulse` keyframes + `.live-dot` rule, and refine the `.provider-check` rule into a filled status dot (replacing the Task-4 one-liner).
- Modify `tests/electron/setup-ui-styles.test.js` (extend the Task-4 file with a pulse/treatment case).

**Interfaces:**
- Consumes: `tokenCss()` vars `--ok`, `--accent`, `--accent-text`, `--ease-out` (motion token from the foundation).
- Produces: CSS classes `.live-dot` (pulsing run-state dot, defined once here in the shared wizard CSS; later consumed by toolbar/fold) and a refined `.provider-check` that renders as a filled green status dot rather than a bare glyph — matching the kit's `StatusDot` and `ModelCard` selected-dot visuals. No markup change required.

- [ ] **Write the failing test.** Append to `tests/electron/setup-ui-styles.test.js`:
```js
describe('buildWizardCSS — kit component treatments', () => {
  let rules;
  beforeAll(() => { rules = require('../../electron/setup-ui-styles').__rawWizardCSS(); });

  test('defines the StatusDot pulse keyframes + a live-dot using the ok + ease-out tokens', () => {
    expect(rules).toContain('@keyframes amicusPulse');
    expect(rules).toContain('.live-dot');
    expect(rules).toContain('var(--ease-out)');
  });

  // Finding #7: assert against the WHOLE rules string, one independent matcher
  // per property — never an arbitrary byte-offset slice.
  test('provider-check renders as a filled status dot (radius 50% + ok token fill)', () => {
    // the base .provider-check rule is a circular chip
    expect(rules).toMatch(/\.provider-check\s*\{[^}]*border-radius:\s*50%/);
    // a separate selector fills it with the ok token once selected / non-empty
    expect(rules).toMatch(/\.provider-check:not\(:empty\)\s*\{[^}]*background:\s*var\(--ok\)/);
  });
});
```

- [ ] **Run it — expect FAIL.** `cd C:/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-styles.test.js -t "kit component treatments"`
  Expected: `@keyframes amicusPulse` / `.live-dot` not found, and the `.provider-check` rule has no `border-radius: 50%` (the Task-4 rule is just color + position).

- [ ] **Implement edit 1 — refine `.provider-check` in `__rawWizardCSS()`.** Replace the Task-4 line:
```js
  .provider-check { position: absolute; top: 8px; right: 12px; font-size: 13px; color: var(--ok); }
```
  with the kit-style filled status dot (the check glyph from `setup-ui.js` init still sets `textContent='✓'`, which now sits inside a circular chip):
```js
  .provider-check {
    position: absolute; top: 9px; right: 12px;
    min-width: 16px; height: 16px; padding: 0 2px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 50%; font-size: 10px; line-height: 1;
    color: var(--accent-text); background: transparent;
  }
  .provider-btn.selected .provider-check,
  .provider-check:not(:empty) { background: var(--ok); }
```

- [ ] **Implement edit 2 — append pulse + live-dot to the end of `__rawWizardCSS()`** (just before the closing backtick, after the alias-icon rules from Task 5):
```js

  /* StatusDot — shared run-state pulse (kit parity; consumed by toolbar/fold too) */
  @keyframes amicusPulse {
    0% { transform: scale(1); opacity: 0.6; }
    70% { transform: scale(2.6); opacity: 0; }
    100% { opacity: 0; }
  }
  .live-dot {
    position: relative; display: inline-block;
    width: 8px; height: 8px; border-radius: 50%; background: var(--ok);
  }
  .live-dot::after {
    content: ''; position: absolute; inset: 0;
    border-radius: 50%; background: var(--ok);
    animation: amicusPulse 1.6s var(--ease-out) infinite;
  }
```

- [ ] **Run it — expect PASS.** `cd C:/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-styles.test.js`
  Expected: all cases (Task-4 + Task-5 alias rules + this task) green.

- [ ] **Run the full wizard-adjacent suite to confirm green.** `cd C:/Users/sendt/dev/amicus && npx jest tests/setup-ui.test.js tests/setup-ui-model.test.js tests/setup-ui-aliases.test.js tests/electron/setup-ui-keys.test.js tests/electron/setup-ui-council.test.js tests/electron/setup-ui-model-search.test.js tests/electron/setup-ui-title.test.js tests/electron/setup-ui-svg-tokens.test.js`
  Expected: all green (these assert on structure/classes/ids/text — none on the removed/added hex).

- [ ] **Commit.** `git add electron/setup-ui-styles.js tests/electron/setup-ui-styles.test.js && git commit -m "Phase 2a: adopt kit StatusDot pulse + filled provider status-dot treatment"`

> **CDP follow-up (deferred to the Phase-2 verify step, not a code task here):** after toolbar/fold land, run the project's CDP recipe on the built wizard — all 4 steps + free-council + alias editor — and eyeball the clay accent / gold counter-accent, stepper states, ModelCard selected wash, RoutePill active fill, and the bundled Outfit/IBM-Plex-Mono fonts resolving (the absolute `file://` URLs from `tokenCss({ absoluteFontUrls: true })`). Spec acceptance criterion #2.

---

## Phase 2b — Toolbar + Fold Overlay

---

### Task 7: Re-tint the bottom toolbar onto shared tokens (`electron/toolbar.js`)

The toolbar (`electron/toolbar.js`) builds a full HTML document whose `baseStyles` block hardcodes the app's old warm-brown neutrals (`#2D2B2A`, `#3D3A38`, `#A09B96`, `#7A756F`, `#4D4A48`, `#D4D0CC`) and clay accent (`#D97757`/`#C4623F`). Phase 1 produced `src/design/tokens.js` exporting `tokenCss()` (the `:root{…}` + `@font-face` CSS string) and the flat `TOKENS` hex map. This task injects `tokenCss({ absoluteFontUrls: true })` into the toolbar `<style>` and replaces every hardcoded hex with the matching token var, mapped per the spec re-tint tables (warm-brown ramp fully replaced by the neutral-black ramp). The toolbar is a `data:`-URL document, so absolute `file://` font URLs are required (BLOCKER FIX #2). The SidecarStage.jsx visual target shows the same structure (brand eyebrow in `--accent`, mono `task:`/timer in muted text, `|` separators, Settings IconButton + primary Fold button) — we keep the existing plain-JS markup and only swap colors + fonts. The logo stroke is driven by a `.logo path` CSS rule (BLOCKER FIX #3 — attribute-level `var()` is invalid in SVG presentation attributes). `--accent-hover` resolves to the spec's `#c45c3f`, which intentionally supersedes the app's old `#C4623F` hover fill — do not "correct" it back.

**Files:**
- Modify `electron/toolbar.js`
  - near top of file (after the JSDoc banner, before `const TOOLBAR_H = 40;` at line 8): add `const { tokenCss } = require('../src/design/tokens');`
  - lines 38–133 (`const baseStyles = \`…\``): re-tint the CSS block and prepend `${tokenCss({ absoluteFontUrls: true })}` (see implementation)
  - lines 135–138 (`const logoSvg`): move the `stroke="#D97757"` onto a CSS class so it tracks `--accent` (attribute-level `var()` is invalid in SVG presentation attributes)
- Modify `tests/toolbar.test.js`
  - append a new `describe('toolbar token adoption', …)` block after the existing `describe('TOOLBAR_H', …)` (currently ends line 63)

**Interfaces:**
- Consumes: `tokenCss({ absoluteFontUrls: true })` and `TOKENS` from `src/design/tokens.js` (Phase 1). Token vars used: `--surface-1`, `--surface-2`, `--border`, `--border-strong`, `--text-1`, `--text-2`, `--text-3`, `--accent`, `--accent-hover`, `--on-accent`, `--font-sans`, `--font-mono`.
- Produces: no new exports. `buildToolbarHTML(options)` signature unchanged; its output HTML now contains `tokenCss()` + token-var styling + absolute `file://` font URLs.

**Steps:**

- [ ] **Write the failing test.** Append to `tests/toolbar.test.js`:
```js
describe('toolbar token adoption', () => {
  const { TOKENS } = require('../src/design/tokens');

  it('injects the shared token CSS (:root with clay accent)', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toContain(':root');
    expect(html).toContain(TOKENS.accent); // #d97757
  });

  it('injects ABSOLUTE file:// font URLs so the bundled fonts resolve (data: URL context)', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toMatch(/url\('file:\/\/[^']*Outfit-400\.ttf'\)/);
    expect(html).not.toContain("url('./fonts/");
  });

  it('drops the old warm-brown neutrals', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).not.toContain('#2D2B2A');
    expect(html).not.toContain('#3D3A38');
    expect(html).not.toContain('#A09B96');
    expect(html).not.toContain('#7A756F');
    expect(html).not.toContain('#4D4A48');
    expect(html).not.toContain('#D4D0CC');
  });

  it('styles chrome from token vars, not literal clay hex in CSS rules', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toContain('background: var(--surface-1)');
    expect(html).toContain('border-top: 1px solid var(--border)');
    expect(html).toContain('color: var(--accent)');
    expect(html).toContain('font-family: var(--font-mono)');
  });

  it('drives the logo stroke from a CSS rule, hex-free markup (BLOCKER FIX #3)', () => {
    const html = buildToolbarHTML({ mode: 'sidecar' });
    expect(html).toMatch(/\.logo path\s*\{[^}]*stroke:\s*var\(--accent\)/);
    expect(html).not.toContain('stroke="#D97757"');
    expect(html).not.toContain('stroke="var(--accent)"');
  });

  it('keeps the brand + task id + Fold button markup', () => {
    const html = buildToolbarHTML({ mode: 'sidecar', taskId: '01J9F2K3', foldShortcut: 'Cmd+Shift+F' });
    expect(html).toContain('>Amicus<');
    expect(html).toContain('task: 01J9F2K3');
    expect(html).toContain('Fold (Cmd+Shift+F)');
  });
});
```

- [ ] **Run it — expect fail.** `npx jest tests/toolbar.test.js -t "toolbar token adoption"` → fails: first on `Cannot find module '../src/design/tokens'` if Phase 1 not merged, then (once Phase 1 lands) on `expect(html).toContain(':root')` / the `file://` font assertion / the warm-brown `not.toContain` assertions, because `electron/toolbar.js` still emits the hardcoded `#2D2B2A`/`#3D3A38`/… block with no `tokenCss()` injected.

- [ ] **Minimal implementation.** In `electron/toolbar.js`:

  1. Add the require near the top (after the JSDoc, before `const TOOLBAR_H = 40;`):
  ```js
  const { tokenCss } = require('../src/design/tokens');
  ```

  2. Replace the entire `const baseStyles = \`…\`;` (lines 38–133) with:
  ```js
  const baseStyles = `
  ${tokenCss({ absoluteFontUrls: true })}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: ${TOOLBAR_H}px;
    background: var(--surface-1);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    font-family: var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-top: 1px solid var(--border);
    -webkit-app-region: no-drag;
    user-select: none;
  }
  .info {
    color: var(--text-2);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand {
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .logo path { stroke: var(--accent); }
  .sep { color: var(--border-strong); font-size: 14px; }
  .detail, .timer {
    color: var(--text-3);
    font-size: 11px;
    font-family: var(--font-mono), 'SF Mono', Menlo, Monaco, monospace;
  }
  .action-btn {
    padding: 5px 14px;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .action-btn:hover { background: var(--accent-hover); }
  .action-btn:disabled { opacity: 0.5; cursor: default; }
  .icon-btn {
    background: none; border: 1px solid var(--border);
    border-radius: 4px; color: var(--text-2); cursor: pointer;
    font-size: 14px; padding: 3px 8px; transition: all 0.15s;
    display: flex; align-items: center;
  }
  .icon-btn:hover { border-color: var(--accent); color: var(--accent); }
  .right-actions { display: flex; align-items: center; gap: 8px; }
  .update-banner {
    position: fixed;
    bottom: ${TOOLBAR_H}px;
    left: 0;
    right: 0;
    height: 32px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-strong);
    display: none;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 12px;
    color: var(--text-1);
    z-index: 100;
  }
  .update-banner .update-btn {
    padding: 2px 10px;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .update-banner .update-btn:hover { background: var(--accent-hover); }
  .update-banner .update-btn:disabled { opacity: 0.5; cursor: default; }
  .update-banner .dismiss-btn {
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
  }
  .update-banner .dismiss-btn:hover { color: var(--text-1); }`;
  ```

  3. Replace the `logoSvg` block (lines 135–138) — drop the per-path `stroke="#D97757"` (now driven by the `.logo path` rule) and add the `logo` class; keep the second stroke's `stroke-opacity`:
  ```js
  const logoSvg = `<svg class="logo" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 2v12" stroke-width="2" stroke-linecap="round"/>
      <path d="M10 2v5c0 2-3 3-7 5" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/>
    </svg>`;
  ```

  (The `setup`-mode and `sidecar`-mode return strings at lines 141–155 / 159–225 are unchanged — they already interpolate `${baseStyles}` and `${logoSvg}`.)

- [ ] **Run it — expect pass.** `npx jest tests/toolbar.test.js` → all toolbar tests green (the pre-existing `getBrandName`/`buildToolbarHTML`/`TOOLBAR_H` cases still pass — the old branding tests assert on `>Amicus<` and `Openwork`, both unaffected by the color swap).

- [ ] **Commit.**
  ```
  git commit -am "Phase 2b: re-tint toolbar onto shared tokenCss() vars (absolute font URLs, CSS-rule logo stroke)"
  ```

---

### Task 8: Re-tint the Fold overlay onto shared tokens (`electron/fold.js`)

`electron/fold.js` injects overlay markup into the live window via `webContents.executeJavaScript`. Three inline `style.cssText`/element strings hardcode old colors: the toolbar fold-button spinner border-top `#fff`; the content-view spinner track `rgba(217,119,87,0.3)` + border-top `#D97757`; the overlay title `#E8E0D8`, subtitle `#7A756F`; and the nudge message `#E8E0D8`. Because these scripts run inside the document that already has `tokenCss()` injected (the toolbar window from the prior task, and the content view once Phase 2 wires fonts there), `var(--…)` resolves at runtime. This task swaps those literals for the token vars per the re-tint map (`--accent`, `--accent-line` for the dashed/translucent track per spec `--violet-line` → `rgba(217,119,87,.28)`, `--text-1`, `--text-3`, `--font-sans`).

**Files:**
- Modify `electron/fold.js`
  - line 66 (nudge `msg.style.cssText`): `#E8E0D8` → `var(--text-1)`; font-family → `var(--font-sans)` chain
  - line 113 (toolbar spinner `style.cssText`): keep the translucent white ring track, border-top `#fff` → `var(--on-accent)`
  - line 144 (content spinner `spinDiv.style.cssText`): `rgba(217,119,87,0.3)` → `var(--accent-line)`, `#D97757` → `var(--accent)`
  - line 148 (content `titleDiv.style.cssText`): `#E8E0D8` → `var(--text-1)`; font-family → `var(--font-sans)` chain
  - line 153 (content `subtitleDiv.style.cssText`): `#7A756F` → `var(--text-3)`; font-family → `var(--font-sans)` chain
- Modify `tests/fold-nudge.test.js`
  - extend the existing single test (currently lines 28–59) with token-var assertions on the captured scripts; add a second `test(...)` for the overlay spinner/title

**Interfaces:**
- Consumes: token vars `--accent`, `--accent-line`, `--on-accent`, `--text-1`, `--text-3`, `--font-sans` (resolved at runtime from the already-injected `tokenCss()`; `fold.js` itself does not `require` the loader — it emits CSS-var strings).
- Produces: no export changes. `createFoldHandler(state)` → `{ triggerFold, hasFolded }` and `showFoldOverlay(mainWindow, contentView)` signatures unchanged.

**Steps:**

- [ ] **Write the failing test.** In `tests/fold-nudge.test.js`, replace the assertion tail of the existing test (after line 56 `const allScripts = executedScripts.join(' ');`) so it reads:
```js
    const allScripts = executedScripts.join(' ');
    expect(allScripts).toContain('Tell Claude');
    expect(allScripts).toContain('done with the Amicus session');
    // token adoption: no hardcoded hex left in the injected overlay scripts
    expect(allScripts).not.toContain('#E8E0D8');
    expect(allScripts).not.toContain('#7A756F');
    expect(allScripts).not.toContain('#D97757');
    expect(allScripts).not.toContain('rgba(217,119,87,0.3)');
    expect(allScripts).toContain('var(--text-1)');
    expect(allScripts).toContain('var(--font-sans)');
```
Then add a second test after it (still inside `describe('Fold nudge message', …)`):
```js
  test('overlay spinner + title use accent/text tokens', async () => {
    const { showFoldOverlay } = require('../electron/fold');
    const scripts = [];
    const view = { webContents: { executeJavaScript: jest.fn((s) => { scripts.push(s); return Promise.resolve(); }) } };
    const win = { webContents: { executeJavaScript: jest.fn((s) => { scripts.push(s); return Promise.resolve(); }) } };
    showFoldOverlay(win, view);
    const all = scripts.join(' ');
    expect(all).toContain('var(--accent)');       // content spinner border-top
    expect(all).toContain('var(--accent-line)');  // content spinner track
    expect(all).toContain('var(--text-1)');       // overlay title
    expect(all).toContain('var(--text-3)');       // overlay subtitle
    expect(all).not.toContain('#D97757');
    expect(all).not.toContain('rgba(217,119,87,0.3)');
  });
```

- [ ] **Run it — expect fail.** `npx jest tests/fold-nudge.test.js` → fails: the existing test's new `not.toContain('#E8E0D8')`/`#D97757` assertions trip because `fold.js` still emits the literal hexes; the new `showFoldOverlay` test fails on `expect(all).toContain('var(--accent)')`.

- [ ] **Minimal implementation.** In `electron/fold.js` apply these exact edits:

  Line 66 (nudge message):
  ```js
              msg.style.cssText = 'color:var(--text-1);font-family:var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:500;text-align:center;max-width:320px;';
  ```

  Line 113 (toolbar fold-button spinner — keep translucent white ring, token the spinning head):
  ```js
          spinner.style.cssText = 'width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:var(--on-accent);border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;';
  ```

  Line 144 (content-view spinner):
  ```js
        spinDiv.style.cssText = 'width:32px;height:32px;border:3px solid var(--accent-line);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px;';
  ```

  Line 148 (overlay title):
  ```js
        titleDiv.style.cssText = 'color:var(--text-1);font-family:var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:500;';
  ```

  Line 153 (overlay subtitle):
  ```js
        subtitleDiv.style.cssText = 'color:var(--text-3);font-family:var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;margin-top:6px;';
  ```

- [ ] **Run it — expect pass.** `npx jest tests/fold-nudge.test.js` → both tests green.

- [ ] **Commit.**
  ```
  git commit -am "Phase 2b: re-tint fold overlay onto shared token vars"
  ```

---

## Phase 3 — Council Report

> **Reads from foundation (Phase 1):** `src/design/tokens.js` exports `{ tokenCss, TOKENS }`. `tokenCss()` returns the full `:root{…}` + `@font-face` CSS string. `TOKENS` is the flat hex map. The council report stays **light-mode** (white ground): it does NOT consume the dark neutral ramp. It injects `tokenCss()` (relative font URLs — the report is opened/served as a file, not a `data:` URL) to pull in the bundled **Outfit / IBM Plex Mono `@font-face`** rules *and* the tier light-ground palette + ink (the four `--tier-*` + four `--tier-*-ink` values are already declared by `tokenCss()`). The report then re-declares those eight tier vars in its own light `:root` for self-documentation / robustness against the loader changing — this is an **intentional re-declaration with identical values** (finding #9), not inert duplication; the cascade resolves to the same color either way. The report uses literal light colors for ground/ink chrome plus the tier vars for row tints. This removes the hardcoded `TIER_COLOR` map and the `system-ui` font.

### Task 9: Re-tint the council report onto the shared light-ground tier tokens + Outfit/Plex type

**Files:**
- Modify `C:/Users/sendt/dev/amicus/src/council/report-html.js` — replace the `TIER_COLOR` const (line 13), the inline `<style>` block (lines 47–54), and the row-background expression (line 30); add a `require` for the foundation loader (after line 11) and a `:root` + `@font-face` injection in the document head.
- Modify `C:/Users/sendt/dev/amicus/tests/council/report.test.js` — extend the existing `describe('buildReport html', …)` block (lines 41–49) with token/tier/type assertions.

**Interfaces:**
- Consumes: `tokenCss()` from `src/design/tokens.js` (Phase 1), `TOKENS` from `src/design/tokens.js` (for the drift assertion in the test), `buildReport(sources, { format:'html' })` from `src/council/report.js` (unchanged entry point), `TIER_ORDER` + `SYMBOL` from `src/council/report.js` (already imported).
- Produces: `renderHtml(model)` — same signature, now emitting `@font-face` + a light `:root` with `--tier-confirmed|contested|disputed|singleton` (+ `-ink`) and Outfit/Plex type; `TIER_COLOR` const **removed** (replaced by `TIER_VAR`/`TIER_INK` maps resolving tier → `var(--tier-…)`).

**Steps:**

- [ ] **Write the failing test.** Add these tests to `tests/council/report.test.js` inside the existing `describe('buildReport html', () => { … })` block (the `html` const on line 42 is already in scope). Append after the existing `test(...)` on line 48, before the closing `});` on line 49:

```js
  test('injects the bundled Outfit / IBM Plex Mono @font-face and leads the sans stack with Outfit', () => {
    expect(html).toContain('@font-face');
    expect(html).toContain('Outfit');
    expect(html).toContain('IBM Plex Mono');
    // Finding #5: assert Outfit LEADS every sans stack, not merely that one
    // 'system-ui, sans-serif' substring is absent. system-ui stays as a
    // legitimate fallback AFTER Outfit.
    const sansStacks = html.match(/font(?:-family)?:\s*[^;]*sans-serif/g) || [];
    expect(sansStacks.length).toBeGreaterThan(0);
    for (const stack of sansStacks) {
      // the first quoted family in the stack must be 'Outfit'
      expect(stack).toMatch(/(?:font-family|font):\s*[^'";]*'Outfit'/);
      const firstFamily = stack.match(/'([^']+)'/);
      expect(firstFamily && firstFamily[1]).toBe('Outfit');
    }
  });
  test('declares the shared light-ground tier palette as CSS vars (not a hardcoded map)', () => {
    expect(html).toContain('--tier-confirmed: #d7ead0');
    expect(html).toContain('--tier-contested: #efe4c4');
    expect(html).toContain('--tier-disputed: #ecd4ec');
    expect(html).toContain('--tier-singleton: #e2e0ea');
    expect(html).toContain('--tier-confirmed-ink: #15803d');
    expect(html).toContain('--tier-contested-ink: #b45309');
    expect(html).toContain('--tier-disputed-ink: #a21caf');
    expect(html).toContain('--tier-singleton-ink: #4b5563');
  });
  test('tints finding rows via the tier var, not an inline hex', () => {
    // av-receiver golden has Disputed + Singleton findings (WS-3)
    expect(html).toContain('background:var(--tier-disputed)');
    expect(html).toContain('background:var(--tier-singleton)');
    expect(html).not.toContain('#fde2e1'); // the old Disputed hex is gone
    expect(html).not.toContain('#dcfce7'); // the old Confirmed hex is gone
  });
```

  Then add a focused drift assertion in a NEW top-level `describe` at the end of `tests/council/report.test.js` (after the `buildReport guards` block on line 55), so the report's tier copy can't drift from the canonical foundation values:

```js
const { renderHtml } = require('../../src/council/report-html');

describe('report tier palette ↔ design tokens', () => {
  const html = renderHtml({
    header: { runType: 'review', runId: 'x', date: '', chair: null, council: [], claudeInCouncil: false },
    judges: [], findings: [], tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    streetCred: [], cost: { rows: [], total: null },
  });
  test('the light-ground tier hexes match src/design/tokens.css', () => {
    // canonical values live in the shared token source; assert the report copies them verbatim
    expect(html).toContain('--tier-confirmed: #d7ead0');
    expect(html).toContain('--tier-singleton-ink: #4b5563');
  });
});
```

- [ ] **Run it, watch it fail.** Command: `cd C:/Users/sendt/dev/amicus && npx jest tests/council/report.test.js`. Expected: the four new tests fail — current output still contains `system-ui, sans-serif` with no leading `'Outfit'` quoted family (line 48 of source), still emits `background:#fde2e1` from `TIER_COLOR` (line 13), and contains no `@font-face` or `--tier-*` vars.

- [ ] **Minimal implementation.** Edit `src/council/report-html.js`:

  1. Add the loader require after line 11 (`const { TIER_ORDER, SYMBOL } = require('./report');`):

  ```js
  const { tokenCss } = require('../design/tokens');
  ```

  2. Replace the `TIER_COLOR` map (line 13) with a tier→var resolver:

  ```js
  const TIER_VAR = {
    Disputed: 'var(--tier-disputed)',
    Contested: 'var(--tier-contested)',
    Confirmed: 'var(--tier-confirmed)',
    Singleton: 'var(--tier-singleton)',
  };
  const TIER_INK = {
    Disputed: 'var(--tier-disputed-ink)',
    Contested: 'var(--tier-contested-ink)',
    Confirmed: 'var(--tier-confirmed-ink)',
    Singleton: 'var(--tier-singleton-ink)',
  };
  ```

  3. In `renderHtml`, replace the matrix-row template (line 30) so the row background uses the tier var and the tier cell gets the ink color:

  ```js
    return `<tr style="background:${TIER_VAR[f.tier] || '#fff'}">` +
      `<td>${esc(f.id)}</td><td>${esc(f.severity)}</td><td>${esc(f.raiser)}</td>${cells}` +
      `<td style="color:${TIER_INK[f.tier] || 'inherit'};font-weight:600">${esc(f.tier)}</td>` +
      `<td>${esc(f.decision || '')}</td></tr>`;
  ```

  4. Replace the document head — the `<style>…</style>` block (lines 47–54) — with the injected `@font-face` (from `tokenCss()`) + a light `:root` carrying the tier palette + the Outfit/Plex type. The eight `--tier-*` vars are an **intentional re-declaration** of the values `tokenCss()` already emits (identical values; documents the report's tier contract in-place and survives a future loader refactor — finding #9). Every sans stack **leads with `'Outfit'`** and keeps `system-ui` as a legitimate fallback (finding #5). Swap the old block for:

  ```js
  <style>
  ${tokenCss()}
  :root {
    /* Council tiers — light-ground palette + ink. Intentionally re-declared
       here with the SAME values tokenCss() emits (self-documenting + robust to
       a loader refactor; the cascade resolves identically). */
    --tier-confirmed: #d7ead0;
    --tier-contested: #efe4c4;
    --tier-disputed: #ecd4ec;
    --tier-singleton: #e2e0ea;
    --tier-confirmed-ink: #15803d;
    --tier-contested-ink: #b45309;
    --tier-disputed-ink: #a21caf;
    --tier-singleton-ink: #4b5563;
  }
  body { font: 14px/1.6 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; background: #fff; }
  h1 { font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 1.5rem; font-weight: 700; letter-spacing: -.02em; }
  h2 { font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; margin-top: 2rem; font-weight: 600; border-bottom: 1px solid #e5e7eb; padding-bottom: .25rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; }
  th, td { border: 1px solid #e5e7eb; padding: .35rem .5rem; text-align: left; }
  th { background: #f9fafb; font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; font-weight: 600; }
  td.c { text-align: center; }
  .meta, .legend { color: #6b7280; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
  .legend { font-size: .85rem; }
  </style>
  ```

  > Font-stack rationale (finding #5): every sans stack is `'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif`. `'Outfit'` LEADS the stack (the meaningful behavior — the bundled webfont is used for real text); the test asserts the first quoted family is `Outfit`, not merely the absence of one `system-ui, sans-serif` fragment. `system-ui`/`-apple-system` remain as legitimate fallbacks should the webfont fail to load.

- [ ] **Run it, watch it pass.** Command: `cd C:/Users/sendt/dev/amicus && npx jest tests/council/report.test.js`. Expected: all tests in the file pass, including the existing `buildReport markdown`, `buildReport html`, `buildReport guards`, the four new html assertions (Outfit leads every sans stack), and the `report tier palette ↔ design tokens` block. Confirm no `#fde2e1` / `#dcfce7` remain and every sans stack leads with `'Outfit'`.

- [ ] **Commit.** `cd C:/Users/sendt/dev/amicus && git add src/council/report-html.js tests/council/report.test.js && git commit -m "Phase 3: re-tint council report onto shared light-ground tier tokens + Outfit/Plex"`

### Task 10: Headless-render the WS-3 golden verdict and verify tier legibility

**Files:**
- No source changes. Verification only — uses the existing `tests/council/fixtures/av-receiver-input.js` golden and the project's puppeteer (already a devDependency) headless-render recipe.

**Interfaces:**
- Consumes: `tally` (`src/council/tally`), `buildVerdict` (`src/council/verdict`), `buildReport` (`src/council/report`), `av-receiver-input` fixture — same chain `tests/council/report.test.js` uses (lines 2–5). `puppeteer` from devDependencies.
- Produces: a PNG render artifact in the scratchpad for visual sign-off (tier rows render the sage/wheat/mauve/gray grounds with AA-legible ink). No code interface.

**Steps:**

- [ ] **Write the render harness.** Create `C:/Users/sendt/dev/amicus/scripts/render-report-golden.mjs`:

```js
// One-shot: render the WS-3 av-receiver golden council report → PNG for visual tier check.
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { tally } = require('../src/council/tally');
const { buildVerdict } = require('../src/council/verdict');
const { buildReport } = require('../src/council/report');
const avInput = require('../tests/council/fixtures/av-receiver-input');

const record = tally(avInput);
const verdict = buildVerdict(record, [{ id: 'C6', decision: 'denied', applied: false }]);
const html = buildReport({ verdict }, { format: 'html' });

const out = process.argv[2] || 'report-golden.png';
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
```

- [ ] **Run it.** Command: `cd C:/Users/sendt/dev/amicus && node scripts/render-report-golden.mjs "C:/Users/sendt/AppData/Local/Temp/claude/C--Users-sendt-OneDrive-AIProjects-SecondBrain/fb3f1c49-5e0c-41ec-a02e-0253b537d8e4/scratchpad/report-golden.png"`. Expected stdout: `wrote …/report-golden.png`.

- [ ] **Verify legibility (manual).** Open the PNG; confirm: Disputed rows are mauve `#ecd4ec` with magenta ink `#a21caf`, Contested wheat `#efe4c4` / amber `#b45309`, Confirmed sage `#d7ead0` / green `#15803d`, Singleton gray `#e2e0ea` / slate `#4b5563`; headings render in Outfit and the legend/meta in IBM Plex Mono (fonts resolved via the bundled `@font-face`, not falling back). Tier text stays AA-legible against its ground (spec risk: "Report tier legibility"). This is a throwaway harness — leave `scripts/render-report-golden.mjs` uncommitted (or `git checkout -- .` after) unless the team wants it kept.

---

## Phase 4 — Site

### Task 11: Bind `site/index.html` `:root` to the shared `TOKENS` (drift-guard, zero visual change)

The marketing site is the spec's **canonical** neutral source (design spec §"Neutrals", lines 82-98: "The live site's `:root` is canonical (so Phase 4 stays zero-change)"). Phase 1 already minted `src/design/tokens.js` exporting `TOKENS` from those same values. This task makes the unification *binding*: a drift-guard test parses the site's `:root` and asserts every clay/gold/neutral value equals `TOKENS`, and the site's `:root` gets a provenance header documenting the short-name→canonical-key mapping so future edits go through the shared source. No hex value changes — render is pixel-identical to v1.4.0. This is the single authoritative site↔`TOKENS` drift guard (no separate foundation-phase drift test is created; see the Phase-1 Task-3 note).

The site uses **short** custom-property names (`--s1`, `--t1`, `--accent2`, `--asoft`…) for byte-compactness; the foundation `TOKENS` map uses **canonical** keys (`surface1`, `text1`, `gold`, `accentSoft`…). The drift-guard owns the mapping table.

**Files:**
- Create `tests/design-site-drift.test.js` (new, ~95 lines) — the site↔`TOKENS` drift guard.
- Modify `site/index.html` lines 28-44 (the `:root{…}` block) — prepend a provenance comment; values unchanged.

**Interfaces:**
- Consumes: `TOKENS` from `../src/design/tokens.js` (foundation Phase 1 — flat hex/rgba map: `accent`, `gold`, `bg`, `surface1`, `surface2`, `surface3`, `border`, `borderStrong`, `text1`, `text2`, `text3`, `accentSoft`, `accentGlow`, `running`).
- Produces: no runtime export (a test + an in-file documentation comment). Establishes the standing regression `tests/design-site-drift.test.js` that later token edits must keep green.

**Steps:**

- [ ] **Write the FAILING test.** Create `tests/design-site-drift.test.js`:
  ```js
  /**
   * Site Drift Guard — Phase 4 (design-system adoption)
   *
   * Asserts site/index.html's :root clay/gold/neutral-black custom properties
   * stay byte-identical to the shared token source (src/design/tokens.js TOKENS).
   * The site uses short var names for compactness; this map pins short -> canonical.
   * Spec: docs/superpowers/specs/2026-06-29-design-system-adoption-design.md §Drift guard.
   */
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

  // Normalize for comparison: lowercase, strip spaces. rgba(...) forms compared verbatim.
  const norm = (v) => String(v).toLowerCase().replace(/\s+/g, '');

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
        expect(norm(siteVars[shortName])).toBe(norm(TOKENS[tokenKey]));
      }
    );

    it('site :root carries the shared-token provenance marker', () => {
      const html = fs.readFileSync(SITE_HTML, 'utf8');
      expect(html).toContain('src/design/tokens.js');
    });
  });
  ```

  > Note: the `it.each` rows compare `norm(siteVars[shortName])` to `norm(TOKENS[tokenKey])`. `norm` strips all whitespace, so the site's `rgba(217,119,87,.10)` and `TOKENS.accentSoft` `rgba(217, 119, 87, 0.10)` normalize differently (`.10` vs `0.10`). **The `accentSoft`/`accentGlow` TOKENS values and the site's `--asoft`/`--aglow` must use the same numeric form.** Pin both to the site's shipped form: `TOKENS.accentSoft = 'rgba(217,119,87,.10)'` and `TOKENS.accentGlow = 'rgba(217,119,87,.05)'` if the site uses `.10`/`.05` — OR extend `norm` to canonicalize (`.replace(/0?\.(\d)/, '.$1')`). Verify the exact shipped site form (`site/index.html` @ v1.4.0 uses `rgba(217,119,87,.10)` / `rgba(217,119,87,.05)`) and make `TOKENS` match byte-for-byte after `norm`, so the rows pass on a correct implementation. If Phase-1 Task 3 wrote `rgba(217, 119, 87, 0.10)`, update either the `norm` helper here or the `TOKENS` literal so the two agree — do not let a spacing/zero mismatch fail a correct site.

- [ ] **Run it — expect FAIL** (provenance marker absent until the edit lands):
  - Command: `npx jest tests/design-site-drift.test.js`
  - Expected: the value-equality `it.each` rows PASS (site already equals `TOKENS`), but `site :root carries the shared-token provenance marker` FAILS with `Expected substring: "src/design/tokens.js"` — proving the test binds and the marker is the only missing piece. (If `../src/design/tokens.js` is absent the suite errors at `require` — that means Phase 1 has not landed; this task depends on it. If an `it.each` row fails on an rgba mismatch, reconcile the numeric form per the note above before proceeding.)

- [ ] **Minimal implementation.** Prepend the provenance comment to `site/index.html`'s `:root` block. Replace the exact current opening (lines 28-29):
  ```
  :root{
    --bg:#0a0a0a;
  ```
  with:
  ```
  /* Shared design tokens — single source of truth: src/design/tokens.js (TOKENS).
     These values are CANONICAL: the loader (tokenCss) and the drift guard
     (tests/design-site-drift.test.js) bind to them. Short names map to canonical
     TOKENS keys: s1->surface1 s2->surface2 s3->surface3 border2->borderStrong
     t1/t2/t3->text1/2/3 accent2->gold asoft->accentSoft aglow->accentGlow
     green->running. Edit tokens.js + here together or the drift guard fails. */
  :root{
    --bg:#0a0a0a;
  ```
  No hex/rgba value in lines 30-44 changes — `--bg`…`--mw` stay exactly as shipped (`#0a0a0a`, `#111113`, `#161618`, `#1c1c1f`, `#222225`, `#2c2c30`, `#f5f5f3`, `#a1a1a0`, `#666`, `#d97757`, `#e8b24a`, `rgba(217,119,87,.10)`, `rgba(217,119,87,.05)`, `#4ade80`, `1200px`).

- [ ] **Run it — expect PASS:**
  - Command: `npx jest tests/design-site-drift.test.js`
  - Expected: all rows green — the 14 value-equality cases, the "defines every mapped color var" case, and the provenance-marker case.

- [ ] **Headless-render check (zero-visual-change proof).** The site phase must render pixel-identical to v1.4.0. Use the repo's established CDP recipe (`chrome-remote-interface`, per `scripts/check-html.js` / `scripts/debug-cdp.js`) — NOT preview-screenshots or ImageMagick (spec §"Testing & verification": both flaky on this machine). Procedure:
  - Capture the computed root palette from the **pre-edit** page and the **post-edit** page and diff them — they must be identical because only a CSS comment was added:
    ```bash
    # from a headless Chrome with the page loaded (CDP on :9222):
    node -e "const CDP=require('chrome-remote-interface');(async()=>{const c=await CDP();await c.Runtime.enable();const e=await c.Runtime.evaluate({expression:'(()=>{const s=getComputedStyle(document.documentElement);return [\"--bg\",\"--accent\",\"--accent2\",\"--t1\",\"--s1\"].map(v=>v+\"=\"+s.getPropertyValue(v).trim()).join(\" | \")})()',returnByValue:true});console.log(e.result.value);await c.close();})()"
    ```
  - Expected output (identical before and after): `--bg=#0a0a0a | --accent=#d97757 | --accent2=#e8b24a | --t1=#f5f5f3 | --s1=#111113`. Confirms the comment did not perturb any custom property. (A comment in CSS cannot change the cascade; this is a belt-and-suspenders render-diff per acceptance criterion 4.)

- [ ] **Run the full guard + adjacent suites** to confirm no regression:
  - Command: `npx jest tests/design-site-drift.test.js tests/drift.test.js`
  - Expected: both green (the pre-existing `tests/drift.test.js` is the unrelated *context*-drift suite and must stay passing).

- [ ] **Commit:**
  - `git add tests/design-site-drift.test.js site/index.html`
  - `git commit -m "$(cat <<'EOF'
Phase 4: bind site :root to shared TOKENS via drift guard

Repoint site/index.html's :root at src/design/tokens.js as the single
source of truth. Values are unchanged (the site palette is canonical),
so the render is pixel-identical to v1.4.0 — the win is the binding
drift guard plus a provenance comment mapping short var names to
canonical TOKENS keys. Closes acceptance criterion 4.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"`
