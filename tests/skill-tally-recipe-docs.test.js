'use strict';
const fs = require('fs');
const path = require('path');
// v4.1 §4.9: the engine assembles the tally input itself, so the hand-assembly
// recipe moved out of SKILL.md into the manual fallback. The pin follows the
// prose. CRLF normalisation is the repo idiom (skill-second-opinion-docs.test.js).
const manual = fs.readFileSync(
  path.join(__dirname, '..', 'skills', 'second-opinion', 'MANUAL-ORCHESTRATION.md'), 'utf-8')
  .replace(/\r\n/g, '\n');

describe('Stage-2 tally assembly recipe (A9, manual path)', () => {
  const recipeStart = manual.indexOf('Stage-2 → tally assembly recipe');
  const recipe = manual.slice(
    recipeStart,
    manual.indexOf('amicus council tally', recipeStart));
  it('the recipe is present in the manual fallback', () => {
    expect(recipeStart).toBeGreaterThan(-1);
    expect(recipe.length).toBeGreaterThan(0);
  });
  it('recipe builds meta with the schema-required fields', () => {
    expect(recipe).toContain('runId');
    expect(recipe).toContain('claudeInCouncil');
    expect(recipe).toMatch(/"?models"?/);
    expect(recipe).toContain('chair');
  });
  it('recipe builds findings[] with {id, raiser, severity}', () => {
    expect(recipe).toMatch(/findings\[\]/);
    expect(recipe).toMatch(/raiser/);
    expect(recipe).toMatch(/severity/);
  });
  it('carries the five-keys checklist and the known failure signature', () => {
    expect(recipe).toMatch(/meta.*findings.*adjudications.*rankings.*runStats/s);
    expect(recipe).toContain("reading 'map'");
  });
});
