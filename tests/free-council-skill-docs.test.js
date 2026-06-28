'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('second-opinion free-council docs', () => {
  it('SKILL.md documents the free council path', () => {
    const s = read('skills/second-opinion/SKILL.md');
    expect(s).toContain('--council free');
    expect(s).toMatch(/free council|free-tier|councils\.free/i);
    expect(s).toMatch(/privacy|data-sharing/i);
  });
  it('MODEL-NOTES.md has a free-tier section', () => {
    const s = read('skills/second-opinion/MODEL-NOTES.md');
    expect(s).toMatch(/free[- ]tier/i);
    expect(s).toMatch(/rate.?limit/i);
  });
});
