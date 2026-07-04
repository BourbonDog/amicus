'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const { mustIndexOf } = require('./helpers/docs-extract');

describe('cost-gate doc drift (B9)', () => {
  const council = read('skills/second-opinion/SKILL.md');
  const sidecar = read('skills/sidecar/SKILL.md');
  it('the false solo-start exemption is gone', () => {
    expect(council).not.toMatch(/not\*?\*? subject to the WS-2 fanout cost gate/);
  });
  it('repair + chair calls carry the pass-through instruction', () => {
    // Two shorter anchors instead of the full sentence: the requirement is
    // flag consistency on repair re-prompts AND on the chair call, and each
    // anchor survives intervening word changes independently. Scoped to the
    // Stage 1 repair-loop section, where the pass-through instruction lives.
    const stage1Start = mustIndexOf(council, '### Stage 1', 'second-opinion SKILL.md "### Stage 1" heading');
    const stage1End = mustIndexOf(council, '### Stage 2', 'second-opinion SKILL.md "### Stage 2" heading');
    const stage1 = council.slice(stage1Start, stage1End);
    expect(stage1).toMatch(/repair re-prompt/);
    expect(stage1).toMatch(/chair/);
    expect(stage1).toMatch(/--no-cost-gate|--max-cost/);
  });
  it('sidecar o3 rule documents the in-code budget gate', () => {
    expect(sidecar).toMatch(/budget gate/i);
    expect(sidecar).toMatch(/--no-cost-gate/);
  });
});
