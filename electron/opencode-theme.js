'use strict';

/**
 * Issue #49 — token-driven theme for the embedded OpenCode web UI.
 *
 * main.js injects this via `contentView.webContents.insertCSS(...)` on
 * `dom-ready`. Before #49 that hook only HID OpenCode's header/wordmark; this
 * module extends it so the embedded chat surface inherits the clay/gold tokens
 * and matches the token-driven Amicus toolbar (toolbar.js).
 *
 * Robustness note (the fragile bit): OpenCode (1.17.11 at time of writing) is a
 * SolidStart app whose generated class names can change between releases. So we
 * PREFER overriding OpenCode's OWN :root CSS custom properties — a much more
 * stable surface than `.css-abc123` class selectors. We:
 *   1. inline the canonical token CSS (tokenCss) so OUR vars + @font-face are
 *      available inside the BrowserView (absolute font URLs, same as toolbar.js
 *      / setup-ui-styles.js / load-failsafe.js do),
 *   2. remap a generous superset of OpenCode's plausible theme custom-property
 *      names to our tokens (var(--...)), covering the prefixes OpenCode has
 *      shipped (--sst-*, --theme-*, --ock-*, --color-*), and
 *   3. add a few low-specificity element fallbacks (body/font) for the case
 *      where a release renames its root vars entirely.
 *
 * Keep this side-effect-free and Electron-free so it stays unit-testable
 * without booting Electron (main.js boots Electron on require).
 *
 * NOT verifiable headless: the live visual match against a running OpenCode
 * session is a USER-SIDE CDP/manual check.
 */

const { tokenCss } = require('../src/design/tokens');

/**
 * The original hide-only rules (header + wordmark) preserved from the pre-#49
 * dom-ready hook. rebrandUI() swaps the wordmark; these keep OpenCode's own
 * chrome out of view until/while that runs.
 */
const HIDE_CHROME = `
  #root > div > header { display: none !important; }
  svg[viewBox="0 0 234 42"] { visibility: hidden !important; }
`;

/**
 * Map OpenCode's own theme custom properties onto our clay/gold tokens. We list
 * the property names under every prefix OpenCode has used so a rename in one
 * family still leaves the others driving the surface. Unknown vars are simply
 * inert — setting an unused custom property has no effect — so over-listing is
 * safe and is the robust play here.
 */
const OPENCODE_ROOT_OVERRIDES = `
  :root {
    /* --- backgrounds / surfaces --- */
    --sst-color-background: var(--bg);
    --sst-color-background-panel: var(--surface-1);
    --sst-color-background-element: var(--surface-2);
    --theme-background: var(--bg);
    --theme-background-panel: var(--surface-1);
    --theme-background-element: var(--surface-2);
    --ock-background: var(--bg);
    --ock-background-panel: var(--surface-1);
    --color-background: var(--bg);
    --color-surface: var(--surface-1);
    --color-surface-raised: var(--surface-2);

    /* --- borders --- */
    --sst-color-border: var(--border);
    --theme-border: var(--border);
    --ock-border: var(--border);
    --color-border: var(--border);
    --color-border-strong: var(--border-strong);

    /* --- text --- */
    --sst-color-text: var(--text-1);
    --sst-color-text-secondary: var(--text-2);
    --sst-color-text-muted: var(--text-3);
    --theme-text: var(--text-1);
    --theme-text-muted: var(--text-2);
    --ock-text: var(--text-1);
    --ock-text-muted: var(--text-2);
    --color-text: var(--text-1);
    --color-text-muted: var(--text-2);

    /* --- brand accent (clay) --- */
    --sst-color-primary: var(--accent-500);
    --sst-color-accent: var(--accent-500);
    --theme-primary: var(--accent-500);
    --theme-accent: var(--accent-500);
    --ock-primary: var(--accent-500);
    --ock-accent: var(--accent-500);
    --color-primary: var(--accent-500);
    --color-accent: var(--accent-500);
    --color-link: var(--accent-400);

    /* --- counter-accent (gold) --- */
    --sst-color-secondary: var(--gold-400);
    --theme-secondary: var(--gold-400);
    --ock-secondary: var(--gold-400);
    --color-secondary: var(--gold-400);
  }
`;

/**
 * Low-specificity element fallbacks. These only bite if OpenCode renamed its
 * root vars entirely (so the overrides above no-op); they intentionally avoid
 * generated class names. Kept gentle so they don't fight OpenCode's layout.
 */
const ELEMENT_FALLBACKS = `
  html, body {
    background-color: var(--bg);
    color: var(--text-1);
    font-family: var(--font-sans);
  }
  a { color: var(--accent-500); }
  ::selection { background: var(--accent-soft); }
`;

/**
 * Build the full theme CSS string injected into the OpenCode BrowserView.
 * @returns {string} hide-chrome + inlined tokens + :root overrides + fallbacks.
 */
function buildOpencodeThemeCSS() {
  return [
    HIDE_CHROME,
    tokenCss({ absoluteFontUrls: true }),
    OPENCODE_ROOT_OVERRIDES,
    ELEMENT_FALLBACKS,
  ].join('\n');
}

module.exports = { buildOpencodeThemeCSS };
