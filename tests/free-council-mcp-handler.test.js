'use strict';
const fs = require('fs');
const path = require('path');

describe('amicus_fanout handler (council expansion)', () => {
  it('source routes all three pre-spawn sites through effectiveModels and validates before write', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    // No bare input.models.length / input.models.join survive
    expect(src).not.toContain('input.models.length');
    expect(src).not.toContain('input.models.join');
    // Single resolved array name is used
    expect(src).toContain('effectiveModels');
    expect(src).toContain('resolveCouncilMembers');
    // Cap re-applied
    expect(src).toContain('DEFAULT_MAX_LEGS');
    // Error returned before the metadata write (expansion block precedes mkdirSync)
    const idxExpand = src.indexOf('resolveCouncilMembers');
    const idxMkdir = src.indexOf('mkdirSync', src.indexOf('async amicus_fanout'));
    expect(idxExpand).toBeGreaterThan(-1);
    expect(idxExpand).toBeLessThan(idxMkdir);
  });
});
