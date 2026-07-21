// tests/skill-stage4-claim-source-docs.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { mustIndexOf } = require('./helpers/docs-extract');

// The working-tree SKILL.md is CRLF; normalise before any ^/\n-anchored regex.
// Repo idiom — see tests/skill-fast-path-docs.test.js.
const SKILL = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

/**
 * Dogfood defect: Stage 4 said "Read <run-folder>/tally.json", then told Claude
 * to "show the claim" for every finding — but tally() findings carry only
 * {id, raiser, severity, tier, basis, confidence, tierOverride, adjudications}.
 * The claim text is dropped by tally(); it survives ONLY in tally-input.json
 * ({id, raiser, severity, claim, location} — see src/council/anonymize.js
 * toGlobalFindings). Stage 4 never named that file, so an agent following the
 * skill literally cannot show the claims it is instructed to show.
 *
 * These pins keep the join documented where it is used: tally.json for
 * tiers/adjudications + tally-input.json for claim/location, keyed on `id`.
 */

/** Guarded slice: an unguarded indexOf returning -1 makes these assertions vacuous. */
function section(startNeedle, endNeedle, label) {
  const start = mustIndexOf(SKILL, startNeedle, `SKILL.md ${label} start`);
  const end = mustIndexOf(SKILL, endNeedle, `SKILL.md ${label} end`);
  expect(end).toBeGreaterThan(start);
  return SKILL.slice(start, end);
}

const STAGE4 = () => section('### Stage 4 — Tiered decisions', '### Stage 5 — Outputs', 'Stage 4');
const STAGE5 = () => section('### Stage 5 — Outputs', '### Stage 6 — Capture lessons', 'Stage 5');

describe('SKILL.md Stage 4 names where the claim text actually lives', () => {
  test('Stage 4 names tally-input.json — not just tally.json', () => {
    expect(STAGE4()).toContain('tally-input.json');
  });

  test('Stage 4 states the join key is the finding id', () => {
    // The two artifacts are joined per finding; without the key the instruction
    // is still unexecutable.
    expect(STAGE4()).toMatch(/join[^.]*\bid\b/i);
  });

  test('Stage 4 attributes claim (and location) to tally-input.json', () => {
    const s = STAGE4();
    const claimIdx = mustIndexOf(s, 'claim', 'Stage 4 "claim" mention');
    const inputIdx = mustIndexOf(s, 'tally-input.json', 'Stage 4 tally-input.json mention');
    // the claim/location attribution sits in the same opening paragraph as the
    // artifact it comes from, not paragraphs away in a different instruction
    expect(Math.abs(claimIdx - inputIdx)).toBeLessThan(400);
    expect(s).toContain('location');
  });

  test('Stage 4 still reads tally.json for the tier data (the join has two sides)', () => {
    expect(STAGE4()).toContain('tally.json');
  });

  test("Stage 4 still instructs showing the claim (the instruction that was unexecutable)", () => {
    expect(STAGE4()).toContain('show the claim');
  });
});

describe("SKILL.md Stage 5's decision log can reach the data it names", () => {
  test('the report.md decision-log contract names tally-input.json as the claim source', () => {
    const s = STAGE5();
    const logIdx = mustIndexOf(s, 'Stage-4 decision log', 'Stage 5 decision-log contract');
    const inputIdx = mustIndexOf(s, 'tally-input.json', 'Stage 5 tally-input.json mention');
    expect(Math.abs(logIdx - inputIdx)).toBeLessThan(300);
  });

  test("the chair's synthesis is still sourced from chair-output.md verbatim", () => {
    expect(STAGE5()).toContain('chair-output.md');
  });
});
