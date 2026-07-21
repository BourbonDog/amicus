'use strict';
const fs = require('fs');
const path = require('path');
const { mustIndexOf } = require('./helpers/docs-extract');
// v4.1 §4.9: Stages 1-3 collapse into the engine's single `council run`, so the
// `### Stage 2` / `### Stage 3` headings and the judge/chair briefing mechanics
// left SKILL.md for the manual fallback. The pins follow the prose; the
// engine-side equivalents are covered by the briefings-template unit tests.
// CRLF normalisation is the repo idiom (see skill-second-opinion-docs.test.js).
const manual = fs.readFileSync(
  path.join(__dirname, '..', 'skills', 'second-opinion', 'MANUAL-ORCHESTRATION.md'), 'utf-8')
  .replace(/\r\n/g, '\n');
// Key-phrase anchors for the no-tools preamble, not the full verbatim sentence:
// the semantic requirements (no tools/files, and where output must begin) survive
// prose rewording between them.
const NO_TOOLS = /Do NOT use any tools or read any files/;
const BEGIN_AT_A1 = /begin immediately with A1:/;

describe('judge/chair no-tools hardening (B8)', () => {
  it('Stage 2 requires the judge preamble (no tools, begins at A1)', () => {
    const start = mustIndexOf(manual, '### Stage 2', 'MANUAL-ORCHESTRATION.md "### Stage 2" heading');
    const end = mustIndexOf(manual, '### Stage 3', 'MANUAL-ORCHESTRATION.md "### Stage 3" heading');
    const stage2 = manual.slice(start, end);
    expect(stage2).toMatch(NO_TOOLS);
    expect(stage2).toMatch(BEGIN_AT_A1);
    expect(stage2).toMatch(/anonymization leak/i);
  });
  it('Stage 3 chair packet opens with the no-tools preamble', () => {
    // Slice end is MANUAL's own next heading: Stage 4 (tiered decisions) stays
    // in the fast-path SKILL.md, so `### Stage 4` does not exist here and
    // mustIndexOf would throw before any expectation ran.
    const start = mustIndexOf(manual, '### Stage 3', 'MANUAL-ORCHESTRATION.md "### Stage 3" heading');
    const end = mustIndexOf(manual, '### Stage 5', 'MANUAL-ORCHESTRATION.md "### Stage 5 artifacts" heading');
    const stage3 = manual.slice(start, end);
    // Stage 3's variant is adjusted for the chair ("begin immediately with the
    // verdict", not "...with A1:") — only the shared no-tools anchor applies here.
    expect(stage3).toMatch(NO_TOOLS);
  });
  it('scratch-cwd advice present with the session-location caveat', () => {
    expect(manual).toMatch(/_scratch/);
    expect(manual).toMatch(/--cwd/);
  });
});
