// tests/council/seats.test.js
'use strict';
const { slug, sanitizeName, buildSeats, roleAt } = require('../../src/council/seats');

describe('slug / sanitizeName (moved here so seats.js needs zero requires)', () => {
  test('slug lowercases, hyphenates runs, and trims edges', () => {
    expect(slug('Devil Advocate!')).toBe('devil-advocate');
    expect(slug('  Red / Team  ')).toBe('red-team');
  });
  test('sanitizeName maps # to - (the seat-id collision surface)', () => {
    expect(sanitizeName('deepseek#2')).toBe('deepseek-2');
  });
});

describe('buildSeats', () => {
  test('a unique bench yields seat ids byte-identical to the aliases', () => {
    const seats = buildSeats(['glm', 'qwen', 'deepseek'], null, null);
    expect(seats.map(s => s.id)).toEqual(['glm', 'qwen', 'deepseek']);
    expect(seats.map(s => s.position)).toEqual([1, 2, 3]);
    expect(seats.every(s => s.role === 'seat')).toBe(true);
    expect(seats.every(s => s.lens === null)).toBe(true);
  });

  test('a duplicated alias gets #N suffixes, in bench order, on ALL of its seats', () => {
    const seats = buildSeats(['deepseek', 'glm', 'deepseek'], null, null);
    expect(seats.map(s => s.id)).toEqual(['deepseek#1', 'glm', 'deepseek#2']);
    expect(seats.map(s => s.alias)).toEqual(['deepseek', 'glm', 'deepseek']);
  });

  test('the critic role is by alias when there are no lenses', () => {
    expect(buildSeats(['glm', 'qwen'], 'qwen', null).map(s => s.role)).toEqual(['seat', 'critic']);
  });

  test('under lenses every role is a lens and critic is unreachable — roleFor precedence', () => {
    const seats = buildSeats(['glm', 'qwen'], 'qwen', ['Skeptic', 'Optimist!']);
    expect(seats.map(s => s.role)).toEqual(['lens:skeptic', 'lens:optimist']);
    expect(seats.map(s => s.lens)).toEqual(['Skeptic', 'Optimist!']);
  });

  test('lens roles are POSITIONAL — DELIBERATELY unlike roleFor, whose indexOf gives both twins the FIRST lens', () => {
    const seats = buildSeats(['glm', 'glm'], null, ['First', 'Second']);
    expect(seats.map(s => s.role)).toEqual(['lens:first', 'lens:second']);
  });

  test('an EMPTY lenses array is treated as no lenses — roleFor treats [] as truthy and yields lens:undefined', () => {
    expect(buildSeats(['glm'], 'glm', []).map(s => s.role)).toEqual(['critic']);
  });

  test('a lenses array SHORTER than the bench leaves trailing seats plain — roleFor yields lens:undefined', () => {
    expect(buildSeats(['glm', 'qwen'], null, ['A']).map(s => s.role)).toEqual(['lens:a', 'seat']);
  });

  test('total over legacy/degenerate inputs — never throws', () => {
    expect(buildSeats(null, null, null)).toEqual([]);
    expect(buildSeats([], null, null)).toEqual([]);
    expect(buildSeats(['glm'], null, ['A', 'B']).map(s => s.role)).toEqual(['lens:a']);
  });
});

describe('roleAt', () => {
  test('returns the seat role by id, and "seat" for an unknown id', () => {
    const seats = buildSeats(['glm', 'qwen'], 'qwen', null);
    expect(roleAt(seats, 'qwen')).toBe('critic');
    expect(roleAt(seats, 'glm')).toBe('seat');
    expect(roleAt(seats, 'nope')).toBe('seat');
    expect(roleAt(null, 'glm')).toBe('seat');
  });
});
