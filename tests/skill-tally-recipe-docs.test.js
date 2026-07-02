'use strict';
const fs = require('fs');
const path = require('path');
const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8');

describe('Stage-2 tally assembly recipe (A9)', () => {
  const recipeStart = skill.indexOf('Stage-2 → tally assembly recipe');
  const recipe = skill.slice(
    recipeStart,
    skill.indexOf('amicus council tally', recipeStart));
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
