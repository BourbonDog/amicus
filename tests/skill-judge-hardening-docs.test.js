'use strict';
const fs = require('fs');
const path = require('path');
const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8');
const PREAMBLE = 'Do NOT use any tools or read any files; everything is in this message; begin immediately with A1:';

describe('judge/chair no-tools hardening (B8)', () => {
  it('Stage 2 requires the exact judge preamble', () => {
    const stage2 = skill.slice(skill.indexOf('### Stage 2'), skill.indexOf('### Stage 3'));
    expect(stage2).toContain(PREAMBLE);
    expect(stage2).toMatch(/anonymization leak/i);
  });
  it('Stage 3 chair packet opens with the no-tools preamble', () => {
    const stage3 = skill.slice(skill.indexOf('### Stage 3'), skill.indexOf('### Stage 4'));
    expect(stage3).toMatch(/Do NOT use any tools or read any files; everything is in this message/);
  });
  it('scratch-cwd advice present with the session-location caveat', () => {
    expect(skill).toMatch(/_scratch/);
    expect(skill).toMatch(/--cwd/);
  });
});
