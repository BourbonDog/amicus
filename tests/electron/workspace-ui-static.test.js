'use strict';

const fs = require('fs');
const path = require('path');

const { SCRIPT_LOAD_ORDER } = require('../workspace/helpers/script-load-order');

const UI = path.join(__dirname, '..', '..', 'electron', 'workspace-ui');
const HTML = fs.readFileSync(path.join(UI, 'index.html'), 'utf-8');
const CSS = fs.readFileSync(path.join(UI, 'workspace.css'), 'utf-8');

describe('workspace-ui static page posture', () => {
  test('CSP meta is exactly the spec §4.2 policy', () => {
    expect(HTML).toContain('http-equiv="Content-Security-Policy"');
    expect(HTML).toContain(
      "default-src 'none'; script-src file:; style-src file: 'unsafe-inline'; font-src file:; img-src file: data:"
    );
  });

  test('tokens.css is linked RELATIVELY (single token source; fonts resolve on file://)', () => {
    expect(HTML).toContain('href="../../src/design/tokens.css"');
    expect(HTML).toContain('href="./workspace.css"');
  });

  test('zero inline scripts; the seven renderer scripts load in dependency order', () => {
    expect(HTML).not.toMatch(/<script>[^<]/);
    // ⚠️ DE-ROT (F05): was five entries. Task 13 splits workspace-app.js into
    // app / panels / verbs, so index.html and this list both carry seven.
    // ⚠️ CODE REVIEW (round 2, finding 5): sourced from the single canonical list in
    // tests/workspace/helpers/script-load-order.js — this file and
    // workspace-app-boundary.test.js used to hand-duplicate it with no cross-check.
    const order = SCRIPT_LOAD_ORDER.map((name) => `${name}.js`);
    let last = -1;
    for (const s of order) {
      const idx = HTML.indexOf(`src="./${s}"`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  test('all renderer target ids exist', () => {
    for (const id of ['run-list', 'empty-state', 'run-view', 'run-title', 'run-chips',
      'cost-gauge', 'cost-gauge-fill', 'cost-gauge-text', 'blind-toggle', 'abort-btn', 'banner',
      'stage-rail', 'seats-body', 'reviews-panel', 'reviews-body', 'bundle-panel', 'bundle-body',
      'judges-panel', 'judges-body', 'matrix-panel', 'matrix-body', 'verdict-panel', 'verdict-body',
      'cost-panel', 'cost-body', 'dialog-abort', 'dialog-abort-confirm', 'dialog-abort-cancel']) {
      expect(HTML).toContain(`id="${id}"`);
    }
  });

  test('no innerHTML/outerHTML/insertAdjacentHTML anywhere in workspace-ui scripts (H9 hard rule)', () => {
    for (const f of fs.readdirSync(UI).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(UI, f), 'utf-8');
      // ⚠️ DE-ROT (F32b): the original assert was a raw `src.includes('innerHTML')`, which is a
      // PROSE test, not a code test — any comment that merely names the banned API fails it (it
      // failed Task 10's own JSDoc). Strip comments first, then match real assignment/access.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
        .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (`://` in a URL is not a comment)
      // Widened per Task 12 review: the original regex only caught `.innerHTML =`/`.innerHTML[`.
      // md-lite.test.js's own DOM harness traps all three DOM-injection sinks (innerHTML,
      // outerHTML, insertAdjacentHTML) as evidence this one was too narrow — `.outerHTML = x`
      // and `.insertAdjacentHTML(...)` both slipped through untouched.
      const bannedAssignment = /\.(innerHTML|outerHTML)\s*(=|\[)/;
      const bannedCall = /\.insertAdjacentHTML\s*\(/;
      const has = bannedAssignment.test(code) || bannedCall.test(code);
      expect({ file: f, has }).toEqual({ file: f, has: false });
    }
  });

  // ⚠️ DE-ROT (F33): pins the `[hidden]` reset added in Step 4. Without it the author rule
  // `.dialog-backdrop { display: flex }` overrides the UA `[hidden] { display: none }` and the
  // abort modal is on screen from first paint, permanently.
  test('an author [hidden] reset exists (author display: beats the UA hidden rule)', () => {
    expect(CSS).toContain('[hidden]');
    expect(CSS).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });

  // ⚠️ DE-ROT (F61): workspace-panels.js keeps a LOCAL mirror of run-launch.js's
  // sanitizeName (it cannot require() across the sandbox) because filenames carry the
  // sanitized id, which state.labelByModel cannot invert back to the model id — so the
  // two must never drift. Pin them with a behavioral equality assert rather than trusting
  // a copy-paste to stay in sync forever.
  test('workspace-panels.js sanitizeName is behaviorally IDENTICAL to the shipped src/council/run-launch.js sanitizeName', () => {
    const shipped = require('../../src/council/run-launch').sanitizeName;
    const prevWindow = global.window;
    global.window = {};
    delete require.cache[require.resolve(path.join(UI, 'workspace-panels'))];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(path.join(UI, 'workspace-panels'));
    const mirrored = global.window.AmicusPanels.sanitizeName;
    global.window = prevWindow;
    for (const s of ['gemini-2.5-pro', 'gpt-4o', 'a/b\\c:*?"<>|', 'local-model_v1', '', 'RE:VIEW.md']) {
      expect(mirrored(s)).toBe(shipped(s));
    }
  });

  test('workspace.css uses token vars only — no hex colors', () => {
    // ⚠️ DE-ROT (F60): KEEP this assert. It is STRICTER than the repo-wide token-drift guard,
    // which structurally permits `var(--token, #hex)` fallbacks and waives any `drift-allow:`
    // line — see the Interfaces note at the top of this task.
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).toContain('var(--bg)');
    expect(CSS).toContain('var(--tier-confirmed)');
    expect(CSS).toContain('prefers-reduced-motion');
    expect(CSS).toContain('var(--focus-ring)');
  });
});
