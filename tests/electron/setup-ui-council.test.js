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
});
