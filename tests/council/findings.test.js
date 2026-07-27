// tests/council/findings.test.js
'use strict';
const { validateFindings, buildValidateDoc } = require('../../src/council/findings');

const valid = '```json\n' + JSON.stringify({
  overall: 'ok',
  findings: [
    { id: 1, severity: 'blocker', claim: 'c1', location: 'l1', rationale: 'r1' },
    { id: 2, severity: 'minor', claim: 'c2', location: 'l2', rationale: 'r2' },
  ],
}) + '\n```';

describe('validateFindings', () => {
  test('accepts a well-formed fenced block', () => {
    const res = validateFindings('prose...\n' + valid);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(2);
    expect(res.errors).toEqual([]);
  });

  test('uses the LAST fenced json block when prose quotes json', () => {
    const decoy = '```json\n{"findings":[]}\n```';
    const res = validateFindings(decoy + '\nmore prose\n' + valid);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(2);
  });

  test('NO_FENCED_BLOCK when absent', () => {
    const res = validateFindings('just prose, no block');
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('NO_FENCED_BLOCK');
  });

  test('NOT_PARSEABLE on broken json', () => {
    const res = validateFindings('```json\n{not json}\n```');
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('NOT_PARSEABLE');
  });

  test('EMPTY_FINDINGS when list empty', () => {
    const res = validateFindings('```json\n{"findings":[]}\n```');
    expect(res.errors.map(e => e.code)).toContain('EMPTY_FINDINGS');
  });

  test('DUPLICATE_ID and NON_SEQUENTIAL_ID', () => {
    const dup = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'minor', claim: 'a', location: 'a', rationale: 'a' },
      { id: 1, severity: 'minor', claim: 'b', location: 'b', rationale: 'b' },
    ] }) + '\n```';
    expect(validateFindings(dup).errors.map(e => e.code)).toContain('DUPLICATE_ID');
    const gap = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'minor', claim: 'a', location: 'a', rationale: 'a' },
      { id: 3, severity: 'minor', claim: 'b', location: 'b', rationale: 'b' },
    ] }) + '\n```';
    expect(validateFindings(gap).errors.map(e => e.code)).toContain('NON_SEQUENTIAL_ID');
  });

  test('BAD_SEVERITY and MISSING_FIELD', () => {
    const bad = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'critical', claim: 'a', location: 'a', rationale: 'a' },
    ] }) + '\n```';
    expect(validateFindings(bad).errors.map(e => e.code)).toContain('BAD_SEVERITY');
    const miss = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'minor', claim: 'a' },
    ] }) + '\n```';
    expect(validateFindings(miss).errors.map(e => e.code)).toContain('MISSING_FIELD');
  });
});

test('buildValidateDoc stamps the council v2 envelope onto a validateFindings result (v4.0 §7)', () => {
  const result = validateFindings('prose\n```json\n{"findings":[{"id":1,"severity":"minor","claim":"c","location":"l","rationale":"r"}]}\n```');
  const doc = buildValidateDoc(result);
  expect(doc.schemaVersion).toBe(2);
  expect(doc.type).toBe('council-validate');
  expect(doc.ok).toBe(true);
  expect(doc.findings).toEqual(result.findings);
  expect(doc.errors).toEqual([]);
});

describe('lastJsonBlock (exported for parse-stage2)', () => {
  const { lastJsonBlock } = require('../../src/council/findings');

  test('returns the LAST fenced json block body', () => {
    const text = 'prose\n```json\n{"a":1}\n```\nmore\n```json\n{"b":2}\n```\n';
    expect(JSON.parse(lastJsonBlock(text))).toEqual({ b: 2 });
  });

  test('returns null when no fenced json block exists', () => {
    expect(lastJsonBlock('no blocks here')).toBeNull();
  });
});

describe('countAttemptedFindings (LC-11: the repair contract is checked by cardinality)', () => {
  const { countAttemptedFindings } = require('../../src/council/findings');

  test('counts entries in an INVALID block', () => {
    // The block parses as JSON but fails validation (bad severity). We still need
    // its cardinality, because that is the repair contract's checkable half.
    expect(countAttemptedFindings('p\n```json\n{"findings":[{"id":1,"severity":"huge"},'
      + '{"id":2,"severity":"nit"}]}\n```')).toBe(2);
  });

  test('returns null when there is nothing to count', () => {
    expect(countAttemptedFindings('no fenced block here')).toBeNull();
    expect(countAttemptedFindings('```json\n{not json\n```')).toBeNull();
    expect(countAttemptedFindings('')).toBeNull();
    expect(countAttemptedFindings(undefined)).toBeNull();
  });

  test('returns null when the block parses but declares no findings ARRAY', () => {
    expect(countAttemptedFindings('```json\n{"overall":"o"}\n```')).toBeNull();
    expect(countAttemptedFindings('```json\n{"findings":"none"}\n```')).toBeNull();
  });

  test('an explicitly empty findings array counts as zero, not as unverifiable', () => {
    expect(countAttemptedFindings('```json\n{"overall":"o","findings":[]}\n```')).toBe(0);
  });

  test('counts the LAST block, matching validateFindings', () => {
    expect(countAttemptedFindings('```json\n{"findings":[{"id":1}]}\n```\nmore\n'
      + '```json\n{"findings":[{"id":1},{"id":2},{"id":3}]}\n```')).toBe(3);
  });
});
