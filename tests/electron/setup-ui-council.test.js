'use strict';
const { buildCouncilSectionHTML, buildCouncilScript } = require('../../electron/setup-ui-council');

describe('buildCouncilSectionHTML', () => {
  it('renders the council container, toggle, and results box', () => {
    const html = buildCouncilSectionHTML();
    expect(html).toContain('id="free-council-section"');
    expect(html).toContain('id="free-council-toggle"');
    expect(html).toContain('id="free-council-results"');
  });
});

describe('buildCouncilScript', () => {
  it('fetches free models, gates on the openrouter key, and exposes collectCouncilPicks', () => {
    const js = buildCouncilScript();
    expect(js).toContain("sidecar:fetch-free-models");
    expect(js).toContain('configuredKeys');
    expect(js).toContain('window.collectCouncilPicks');
  });

  it('groups rows into vendor <details class="council-group"> sections with a count badge', () => {
    const js = buildCouncilScript();
    expect(js).toContain('council-group');
    expect(js).toContain('council-group-count');
  });

  it('renders a two-line row: friendly name primary + raw id as mono secondary', () => {
    const js = buildCouncilScript();
    expect(js).toContain('council-row-name');
    expect(js).toContain('council-row-id');
  });

  it('keeps the checkbox value as the RAW model id (selection contract inviolable)', () => {
    const js = buildCouncilScript();
    // the checkbox's value must still be assigned from r.id, not r.name/vendor
    expect(js).toMatch(/cb\.value\s*=\s*r\.id/);
  });

  it('collectCouncilPicks still walks all checked inputs regardless of group nesting', () => {
    const js = buildCouncilScript();
    expect(js).toContain("results.querySelectorAll('input[type=checkbox]:checked')");
  });

  it('meta line reports a vendor count alongside the model count', () => {
    const js = buildCouncilScript();
    expect(js).toMatch(/providers?/i);
  });
});
