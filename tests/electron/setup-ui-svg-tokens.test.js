'use strict';
const { buildSetupHTML } = require('../../electron/setup-ui');
const { buildAliasEditorHTML } = require('../../electron/setup-ui-aliases');
const { __rawWizardCSS } = require('../../electron/setup-ui-styles');

describe('wizard inline-SVG strokes are driven by CSS rules, hex-free markup (BLOCKER FIX #3)', () => {
  test('header + footer brand markup carries no stroke hex and no invalid attribute var()', () => {
    const html = buildSetupHTML();
    // the old hardcoded clay hex is gone from the document chrome
    expect(html).not.toContain('stroke="#D97757"');
    expect(html).not.toContain('stroke="#5A5550"');
    expect(html).not.toContain('stroke="#5a5550"');
    expect(html).not.toContain('stroke="#6BBF6B"');
    expect(html).not.toContain('stroke="#6bbf6b"');
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
    expect(frag).toContain('alias-icon-faint-path');
    for (const dead of ['#D97757', '#6BBF6B', '#5A5550']) {
      expect(frag).not.toContain(`stroke="${dead}"`);
    }
    expect(frag).not.toContain('stroke="var(--');
  });

  test('the wizard CSS drives the alias-icon strokes from tokens', () => {
    const rules = __rawWizardCSS();
    expect(rules).toMatch(/\.alias-icon-accent path\s*\{[^}]*stroke:\s*var\(--accent\)/);
    expect(rules).toMatch(/\.alias-icon-ok path\s*\{[^}]*stroke:\s*var\(--ok\)/);
    expect(rules).toMatch(/\.alias-icon-faint-path\s*\{[^}]*stroke:\s*var\(--text-faint\)/);
  });
});
