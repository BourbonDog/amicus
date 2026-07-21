// tests/skill-stage5-chair-verdict-docs.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { mustIndexOf } = require('./helpers/docs-extract');

// The working-tree SKILL.md is CRLF; normalise before any ^/\n-anchored regex.
// Repo idiom — see tests/skill-fast-path-docs.test.js.
const SKILL = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

/**
 * Dogfood defect: the prescribed Stage-5 command replaces the engine's
 * verdict.json, which is one of only two homes of the chair's synthesis
 * (the other is chair-output.md) — tally.json and run.json carry no copy.
 * The CLI now recovers it from the run folder automatically; the MCP tool
 * cannot (it receives `record` inline, with no run folder to anchor on), so
 * Cowork must pass `overallVerdict` explicitly. Both halves are pinned here so
 * a future rewrite cannot silently drop the instruction again.
 */

/** Guarded slice: an unguarded indexOf returning -1 makes these assertions vacuous. */
function stage5() {
  const start = mustIndexOf(SKILL, '### Stage 5 — Outputs', 'SKILL.md Stage 5 start');
  const end = mustIndexOf(SKILL, '### Stage 6 — Capture lessons', 'SKILL.md Stage 5 end');
  expect(end).toBeGreaterThan(start);
  return SKILL.slice(start, end);
}

describe("SKILL.md Stage 5 documents that the chair's verdict survives the replacement", () => {
  test('the Bash path states overallVerdict is carried forward automatically', () => {
    const s = stage5();
    expect(s).toContain('overallVerdict');
    expect(s).toMatch(/\*\*carried forward automatically\*\*/);
  });

  test('both source artifacts of the chair verdict are named', () => {
    const s = stage5();
    expect(s).toContain('chair-output.md');
    expect(s).toContain('verdict.json');
  });

  test('it states a chair that produced no verdict stays null — nothing invented', () => {
    expect(stage5()).toMatch(/stays[\s\S]{0,20}`null`/);
  });

  test('the Cowork path tells Claude to pass overallVerdict to amicus_verdict', () => {
    const s = stage5();
    const cowork = s.slice(mustIndexOf(s, 'In Cowork this is', 'Stage 5 Cowork paragraph'));
    expect(cowork).toContain('overallVerdict');
    // and explains why MCP cannot recover it itself
    expect(cowork).toMatch(/no run folder/);
  });

  test('the Stage-5 command still passes --render (the pin it was built alongside)', () => {
    expect(stage5()).toContain('--render');
  });
});
