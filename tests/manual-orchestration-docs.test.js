// tests/manual-orchestration-docs.test.js
'use strict';
const fs = require('fs');
const path = require('path');

const DOC = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'MANUAL-ORCHESTRATION.md'), 'utf-8');

describe('MANUAL-ORCHESTRATION.md relocated pins (spec §4.9)', () => {
  test('headnote marks it the fallback since v4.1', () => {
    expect(DOC).toMatch(/fallback path.*engine is primary since v4\.1/is);
  });
  test('B22: council validate + tri-state + provenance', () => {
    expect(DOC).toContain('amicus council validate <leg-file> --json');
    expect(DOC).toContain('validateFindings');
    expect(DOC).toContain('src/council/findings.js');
  });
  test('B22: council tally recipe with the run-folder redirect', () => {
    expect(DOC).toContain('amicus council tally <run-folder>/tally-input.json --json > <run-folder>/tally.json');
  });
  test('A9: five-keys recipe + the reading-map failure signature', () => {
    expect(DOC).toContain('Five-keys');
    expect(DOC).toContain("reading 'map'");
  });
  test('B8: Stage 2 / Stage 3 anchors + no-tools preamble + begin immediately with A1', () => {
    expect(DOC).toContain('### Stage 2');
    expect(DOC).toContain('### Stage 3');
    expect(DOC).toContain('begin immediately with A1:');
    expect(DOC).toContain('anonymization leak');
    expect(DOC).toContain('_scratch');
  });
  test('Stage 5 anchor present (Task 14 B8 re-point terminates its Stage-3 slice here)', () => {
    expect(DOC).toContain('### Stage 5');
  });
  test('B28: hardening-before-two-things + Task A/Task B + _scratch sessions path', () => {
    expect(DOC).toContain('Task A');
    expect(DOC).toContain('Task B');
    expect(DOC).toContain('_scratch/.claude/amicus_sessions/');
  });
  test('manual Stage 2.5 line-based rebuttal contract survives here', () => {
    expect(DOC).toContain('DEFEND');
    expect(DOC).toContain('WITHDRAW');
  });
  test('PS 5.1 UTF-16 caveat retained', () => {
    expect(DOC).toContain('Out-File -Encoding utf8');
  });
  test('crossreview-matrix.md / verdict.md artifact names retained in the manual path', () => {
    expect(DOC).toContain('crossreview-matrix.md');
    expect(DOC).toContain('verdict.md');
  });
});
