'use strict';
const fs = require('fs');
const path = require('path');
const { mustIndexOf } = require('./helpers/docs-extract');
const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8');
// Key-phrase anchors for the no-tools preamble, not the full verbatim sentence:
// the semantic requirements (no tools/files, and where output must begin) survive
// prose rewording between them.
const NO_TOOLS = /Do NOT use any tools or read any files/;
const BEGIN_AT_A1 = /begin immediately with A1:/;

describe('judge/chair no-tools hardening (B8)', () => {
  it('Stage 2 requires the judge preamble (no tools, begins at A1)', () => {
    const start = mustIndexOf(skill, '### Stage 2', 'second-opinion SKILL.md "### Stage 2" heading');
    const end = mustIndexOf(skill, '### Stage 3', 'second-opinion SKILL.md "### Stage 3" heading');
    const stage2 = skill.slice(start, end);
    expect(stage2).toMatch(NO_TOOLS);
    expect(stage2).toMatch(BEGIN_AT_A1);
    expect(stage2).toMatch(/anonymization leak/i);
  });
  it('Stage 3 chair packet opens with the no-tools preamble', () => {
    const start = mustIndexOf(skill, '### Stage 3', 'second-opinion SKILL.md "### Stage 3" heading');
    const end = mustIndexOf(skill, '### Stage 4', 'second-opinion SKILL.md "### Stage 4" heading');
    const stage3 = skill.slice(start, end);
    // Stage 3's variant is adjusted for the chair ("begin immediately with the
    // verdict", not "...with A1:") — only the shared no-tools anchor applies here.
    expect(stage3).toMatch(NO_TOOLS);
  });
  it('scratch-cwd advice present with the session-location caveat', () => {
    expect(skill).toMatch(/_scratch/);
    expect(skill).toMatch(/--cwd/);
  });
});
