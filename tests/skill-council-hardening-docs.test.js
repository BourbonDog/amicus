'use strict';
const fs = require('fs');
const path = require('path');
const { mustIndexOf } = require('./helpers/docs-extract');
// CRLF normalisation is the repo idiom for skill-prose pins
// (see tests/skill-second-opinion-docs.test.js).
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8').replace(/\r\n/g, '\n');

describe('opp-8 council hardening', () => {
  it.each(['skills/second-opinion/SKILL.md', 'skills/sidecar/SKILL.md'])(
    '%s has no unquoted --models example', (p) => {
      // an unquoted list = --models followed by a bare token containing a comma
      expect(read(p)).not.toMatch(/--models\s+(?!["'])\S*,/);
    });
  it('Stage 0 mandates current-date injection for time-sensitive artifacts', () => {
    const s = read('skills/second-opinion/SKILL.md');
    // v4.1: Stages 1-3 merged into one engine-run section, so the slice ends at
    // that heading. Guarded — a bare indexOf('### Stage 1') would now return -1
    // and slice nearly the whole file, letting these pins pass for the wrong
    // reason.
    const stage0 = s.slice(
      mustIndexOf(s, '### Stage 0', 'second-opinion SKILL.md "### Stage 0" heading'),
      mustIndexOf(s, '### The engine run', 'second-opinion SKILL.md merged engine-run heading'));
    expect(stage0).toMatch(/current date/i);
    expect(stage0).toMatch(/future-dated/i);
    // The engine now stamps the date onto every composed briefing (§4.3), so
    // Stage 0 must say so rather than telling Claude to inject it by hand.
    expect(stage0).toMatch(/the engine stamps/);
  });
  it('report.html is the default final artifact and the verdict is presented inline', () => {
    const s = read('skills/second-opinion/SKILL.md');
    expect(s).toMatch(/report\.html/);
    expect(s).toMatch(/--html > <run-folder>\/report\.html|--html/);
    expect(s).toMatch(/present the verdict inline in chat/i);
    expect(s).toMatch(/Never hand over only file paths/i);
  });
});
