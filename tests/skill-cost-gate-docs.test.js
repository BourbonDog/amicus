'use strict';
const fs = require('fs');
const path = require('path');
// CRLF normalisation is the repo idiom for skill-prose pins
// (see tests/skill-second-opinion-docs.test.js).
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8').replace(/\r\n/g, '\n');
const { mustIndexOf } = require('./helpers/docs-extract');

describe('cost-gate doc drift (B9)', () => {
  const council = read('skills/second-opinion/SKILL.md');
  // v4.1 §4.9: the per-call pass-through rule (repair re-prompts + the chair
  // call each needing the same flag) is a MANUAL-path concern now — the engine
  // forwards one --max-cost/--no-cost-gate to every internal launch. The old
  // pin moved with the prose; the fast path gets the replacement pin below.
  const manual = read('skills/second-opinion/MANUAL-ORCHESTRATION.md');
  const sidecar = read('skills/sidecar/SKILL.md');
  it('the false solo-start exemption is gone', () => {
    expect(council).not.toMatch(/not\*?\*? subject to the WS-2 fanout cost gate/);
  });
  it('manual path: repair + chair calls carry the pass-through instruction', () => {
    // Two shorter anchors instead of the full sentence: the requirement is
    // flag consistency on repair re-prompts AND on the chair call, and each
    // anchor survives intervening word changes independently. Scoped to the
    // manual Stage 1 repair-loop section, where the pass-through rule lives.
    // MANUAL-ORCHESTRATION.md keeps `### Stage 1` / `### Stage 2`, so the same
    // two anchors still resolve after the SKILL.md stage merge.
    const stage1Start = mustIndexOf(manual, '### Stage 1', 'MANUAL-ORCHESTRATION.md "### Stage 1" heading');
    const stage1End = mustIndexOf(manual, '### Stage 2', 'MANUAL-ORCHESTRATION.md "### Stage 2" heading');
    const stage1 = manual.slice(stage1Start, stage1End);
    expect(stage1).toMatch(/repair re-prompt/);
    expect(stage1).toMatch(/chair/);
    expect(stage1).toMatch(/--no-cost-gate|--max-cost/);
  });
  it('fast path: the council run launch documents one budget flag for every internal stage', () => {
    // Unsliced on purpose — the fast path merges Stages 1-3 under one heading,
    // so there is no `### Stage 1`/`### Stage 2` pair to bound this with.
    expect(council).toMatch(/--max-cost/);
    expect(council).toMatch(/--no-cost-gate/);
    expect(council).toMatch(/every internal launch/i);
    const idx = mustIndexOf(council, 'every internal launch', 'second-opinion SKILL.md budget-gate pass-through sentence');
    const scope = council.slice(idx, idx + 400);
    expect(scope).toMatch(/repair/i);
    expect(scope).toMatch(/chair/);
  });
  it('sidecar o3 rule documents the in-code budget gate', () => {
    expect(sidecar).toMatch(/budget gate/i);
    expect(sidecar).toMatch(/--no-cost-gate/);
  });
});
