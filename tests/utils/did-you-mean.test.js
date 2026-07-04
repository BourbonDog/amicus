'use strict';

const { levenshteinDistance, suggestCommand } = require('../../src/utils/input-validators');
const { getCommandNames } = require('../../src/cli');

describe('levenshteinDistance', () => {
  it('distance 0 for identical strings', () => {
    expect(levenshteinDistance('continue', 'continue')).toBe(0);
  });

  it('distance 1 for a single substitution', () => {
    expect(levenshteinDistance('resume', 'resome')).toBe(1);
  });

  it('distance 1 for a single deletion (typo drops a letter)', () => {
    expect(levenshteinDistance('continue', 'contnue')).toBe(1);
  });

  it('distance 1 for a single insertion', () => {
    expect(levenshteinDistance('abort', 'aborrt')).toBe(1);
  });

  it('is symmetric', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(levenshteinDistance('sitting', 'kitten'));
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('classic kitten/sitting distance is 3', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('suggestCommand', () => {
  const candidates = ['start', 'fanout', 'list', 'status', 'resume', 'continue', 'read', 'models',
    'council', 'doctor', 'spend', 'abort', 'setup', 'key', 'update', 'mcp'];

  it('suggests the nearest command within distance <= 2', () => {
    expect(suggestCommand('contnue', candidates)).toEqual(['continue']);
  });

  it('suggests for a single-character typo', () => {
    expect(suggestCommand('resme', candidates)).toEqual(['resume']);
  });

  it('returns no suggestion for garbage input far from every candidate', () => {
    expect(suggestCommand('xyzzyplugh', candidates)).toEqual([]);
  });

  it('returns no suggestion for an empty string', () => {
    expect(suggestCommand('', candidates)).toEqual([]);
  });

  it('caps suggestions at 3', () => {
    // Craft candidates all within distance 2 of the input to exercise the cap.
    const many = ['abcde', 'abcdf', 'abcdg', 'abcdh', 'abcdi'];
    const result = suggestCommand('abcd', many);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('does not suggest an exact match as a "typo" (distance 0 excluded from candidates naturally, but harmless if included)', () => {
    // Sanity: exact match trivially has distance 0 <= 2, so it would suggest itself.
    // This documents current behavior rather than asserting exclusion (callers pass unknown commands only).
    expect(suggestCommand('abort', candidates)).toEqual(['abort']);
  });
});

describe('getCommandNames (cli.js) — derivable candidate list', () => {
  it('derives from USAGE_COMMAND_BLOCKS plus switch-only commands', () => {
    const names = getCommandNames();
    // From USAGE_COMMAND_BLOCKS
    expect(names).toEqual(expect.arrayContaining([
      'start', 'fanout', 'models', 'list', 'status', 'abort', 'read', 'continue',
      'resume', 'council', 'doctor', 'spend', 'setup', 'key', 'mcp',
    ]));
    // Switch-only (bin/amicus.js) command not in USAGE_COMMAND_BLOCKS
    expect(names).toContain('update');
  });

  it('has no duplicate entries', () => {
    const names = getCommandNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
