'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('cost-gate doc drift (B9)', () => {
  const council = read('skills/second-opinion/SKILL.md');
  const sidecar = read('skills/sidecar/SKILL.md');
  it('the false solo-start exemption is gone', () => {
    expect(council).not.toMatch(/not\*?\*? subject to the WS-2 fanout cost gate/);
  });
  it('repair + chair calls carry the pass-through instruction', () => {
    expect(council).toMatch(/same flag on every repair re-prompt and on the chair call/);
    const stage3 = council.slice(council.indexOf('### Stage 3'), council.indexOf('### Stage 4'));
    expect(stage3).toMatch(/--no-cost-gate|--max-cost/);
  });
  it('sidecar o3 rule documents the in-code budget gate', () => {
    expect(sidecar).toMatch(/budget gate/i);
    expect(sidecar).toMatch(/--no-cost-gate/);
  });
});
