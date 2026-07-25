'use strict';

const fs = require('fs');
const path = require('path');

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
    const order = ['md-lite.js', 'live-model.js', 'workspace-render.js', 'workspace-matrix.js',
      'workspace-panels.js', 'workspace-verbs.js', 'workspace-app.js'];
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
