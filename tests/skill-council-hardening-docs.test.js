'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('opp-8 council hardening', () => {
  it.each(['skills/second-opinion/SKILL.md', 'skills/sidecar/SKILL.md'])(
    '%s has no unquoted --models example', (p) => {
      // an unquoted list = --models followed by a bare token containing a comma
      expect(read(p)).not.toMatch(/--models\s+(?!["'])\S*,/);
    });
  it('Stage 0 mandates current-date injection for time-sensitive artifacts', () => {
    const s = read('skills/second-opinion/SKILL.md');
    const stage0 = s.slice(s.indexOf('### Stage 0'), s.indexOf('### Stage 1'));
    expect(stage0).toMatch(/current date/i);
    expect(stage0).toMatch(/future-dated/i);
  });
  it('report.html is the default final artifact and the verdict is presented inline', () => {
    const s = read('skills/second-opinion/SKILL.md');
    expect(s).toMatch(/report\.html/);
    expect(s).toMatch(/--html > <run-folder>\/report\.html|--html/);
    expect(s).toMatch(/present the verdict inline in chat/i);
    expect(s).toMatch(/Never hand over only file paths/i);
  });
});
