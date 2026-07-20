// tests/council/anonymize.test.js
'use strict';
const { assignLabels, toGlobalId, toGlobalFindings, rankingToOrder } =
  require('../../src/council/anonymize');

describe('assignLabels', () => {
  test('assigns Review A/B/C in model order with both maps', () => {
    const { entries, labelMap, letterByModel } = assignLabels(['deepseek', 'gemini', 'gpt']);
    expect(entries).toEqual([
      { label: 'Review A', letter: 'A', model: 'deepseek' },
      { label: 'Review B', letter: 'B', model: 'gemini' },
      { label: 'Review C', letter: 'C', model: 'gpt' },
    ]);
    expect(labelMap['Review B']).toBe('gemini');
    expect(letterByModel.gpt).toBe('C');
  });

  test('throws on an empty bench', () => {
    expect(() => assignLabels([])).toThrow(/1-26/);
  });

  test('succeeds with exactly 26 models', () => {
    const { entries } = assignLabels(Array(26).fill().map((_, i) => `m${i}`));
    expect(entries).toHaveLength(26);
  });

  test('throws on 27 models', () => {
    expect(() => assignLabels(Array(27).fill().map((_, i) => `m${i}`))).toThrow(/1-26/);
  });
});

describe('id rewriting roundtrip', () => {
  test('toGlobalId prefixes the review letter', () => {
    expect(toGlobalId('A', 1)).toBe('A1');
    expect(toGlobalId('C', 12)).toBe('C12');
  });

  test('toGlobalFindings rewrites local ids and attaches the raiser', () => {
    const out = toGlobalFindings('B', 'gemini', [
      { id: 1, severity: 'major', claim: 'x', location: 'l', rationale: 'r' },
      { id: 2, severity: 'nit', claim: 'y', location: 'l', rationale: 'r' },
    ]);
    expect(out).toEqual([
      { id: 'B1', raiser: 'gemini', severity: 'major', claim: 'x', location: 'l' },
      { id: 'B2', raiser: 'gemini', severity: 'nit', claim: 'y', location: 'l' },
    ]);
  });
});

describe('rankingToOrder (de-anonymization for tally rankings)', () => {
  const { labelMap } = assignLabels(['deepseek', 'gemini', 'gpt']);

  test('maps labels to model ids preserving order', () => {
    const { order, errors } = rankingToOrder(['Review C', 'Review A', 'Review B'], labelMap);
    expect(order).toEqual(['gpt', 'deepseek', 'gemini']);
    expect(errors).toEqual([]);
  });

  test('preserves tie groups as nested arrays', () => {
    const { order } = rankingToOrder([['Review A', 'Review B'], 'Review C'], labelMap);
    expect(order).toEqual([['deepseek', 'gemini'], 'gpt']);
  });

  test('unknown label lands in errors', () => {
    const { errors } = rankingToOrder(['Review Z'], labelMap);
    expect(errors).toEqual(["unknown label 'Review Z'"]);
  });
});
