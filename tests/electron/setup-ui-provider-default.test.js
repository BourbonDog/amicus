'use strict';
const {
  buildProviderDefaultSectionHTML,
  buildProviderDefaultScript,
} = require('../../electron/setup-ui-provider-default');

describe('buildProviderDefaultSectionHTML', () => {
  it('renders the (initially hidden) container, label, and list', () => {
    const html = buildProviderDefaultSectionHTML();
    expect(html).toContain('id="provider-default-section"');
    expect(html).toContain('style="display:none"');
    expect(html).toContain('id="provider-default-label"');
    expect(html).toContain('id="provider-default-list"');
  });
});

describe('buildProviderDefaultScript', () => {
  it('exposes renderProviderDefaultPicker and hideProviderDefaultPicker on window', () => {
    const js = buildProviderDefaultScript();
    expect(js).toContain('window.renderProviderDefaultPicker');
    expect(js).toContain('window.hideProviderDefaultPicker');
  });

  it('applies the pick via sidecar:set-provider-default (literal channel, allowlist-checkable)', () => {
    const js = buildProviderDefaultScript();
    expect(js).toContain("invoke('sidecar:set-provider-default'");
  });

  it('renders one row per choice, radio checked on the preselected row, with a "recommended" badge', () => {
    const js = buildProviderDefaultScript();
    // one <input type=radio> per row.id, sharing a per-provider radio group name
    expect(js).toMatch(/radio\.type = 'radio'/);
    expect(js).toMatch(/radio\.name = 'provider-default-' \+ provider/);
    expect(js).toMatch(/radio\.value = row\.id/);
    expect(js).toMatch(/radio\.checked = !!row\.isPreselected/);
    expect(js).toContain('recommended');
    expect(js).toContain('pick-badge');
    // rows iterate the FULL choice list (one row per entry)
    expect(js).toMatch(/providerDefault\.rows\.forEach/);
  });

  it('builds rows via createElement/textContent, never innerHTML string interpolation of catalog data', () => {
    const js = buildProviderDefaultScript();
    expect(js).toContain('document.createElement');
    expect(js).toMatch(/text\.textContent = row\.name/);
  });

  it('applies the preselected id immediately on render (no-selection case), and again on user change', () => {
    const js = buildProviderDefaultScript();
    expect(js).toMatch(/applyChoice\(provider, providerDefault\.preselectedId\)/);
    expect(js).toMatch(/applyChoice\(provider, row\.id\)/);
  });

  it('a null/empty providerDefault hides the section instead of rendering an empty list', () => {
    const js = buildProviderDefaultScript();
    expect(js).toMatch(/!providerDefault \|\| !Array\.isArray\(providerDefault\.rows\) \|\| providerDefault\.rows\.length === 0/);
    expect(js).toContain('window.hideProviderDefaultPicker(); return;');
  });
});
