// tests/council/findings.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { validateFindings, buildValidateDoc } = require('../../src/council/findings');

/** A literal triple-backtick, built so this file's own fences stay unambiguous. */
const F = '`'.repeat(3);

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

  test('EMPTY_FINDINGS when the list is empty AND overall is absent', () => {
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

describe('EMPTY_FINDINGS — a clean review is a valid review (LC-10, owner ruling)', () => {
  test('a well-formed empty set with a real overall is VALID', () => {
    const text = 'I found nothing wrong.\n```json\n{"overall":"No defects found in '
      + 'any category; the fence and the ordering are both correct.","findings":[]}\n```';
    const r = validateFindings(text);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test('an empty set with an EMPTY overall is still EMPTY_FINDINGS', () => {
    const text = 'x\n```json\n{"overall":"","findings":[]}\n```';
    const r = validateFindings(text);
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('EMPTY_FINDINGS');
  });

  test('an empty set with a WHITESPACE-ONLY overall is still EMPTY_FINDINGS', () => {
    const r = validateFindings('x\n```json\n{"overall":"   \\n ","findings":[]}\n```');
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('EMPTY_FINDINGS');
  });

  test('an empty set with a NON-STRING overall is still EMPTY_FINDINGS', () => {
    // A hollow shell can be typed as well as blank: {"overall": 0} parses, but it
    // is not a model saying "I read this and found nothing".
    for (const bad of ['0', 'null', 'true', '{}', '[]']) {
      const r = validateFindings(`x\n\`\`\`json\n{"overall":${bad},"findings":[]}\n\`\`\``);
      expect(r.errors.map(e => e.code)).toContain('EMPTY_FINDINGS');
    }
  });

  test('an empty set with a MISSING overall is still EMPTY_FINDINGS', () => {
    const r = validateFindings('x\n```json\n{"findings":[]}\n```');
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('EMPTY_FINDINGS');
  });

  test('a MISSING findings key with a real overall is still EMPTY_FINDINGS', () => {
    // `findings` absent is not "I found nothing" — it is a block that never
    // declared the array at all (countAttemptedFindings returns null for it).
    // Keeping it an error is what stops a bare {"overall":"…"} from passing.
    const r = validateFindings('x\n```json\n{"overall":"looks fine to me"}\n```');
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('EMPTY_FINDINGS');
  });

  test('a broken emit is still its own error code, not EMPTY_FINDINGS', () => {
    expect(validateFindings('no block at all').errors[0].code).toBe('NO_FENCED_BLOCK');
    expect(validateFindings('```json\n{nope\n```').errors[0].code).toBe('NOT_PARSEABLE');
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

/**
 * ⚠️ v4.4.1 Task 10 — the closing fence must count only at LINE START.
 *
 * The old pattern was `/```json\s*\n([\s\S]*?)```/g`: the first triple-backtick
 * anywhere INSIDE the body ended the match, so a findings block whose `claim`
 * quotes a fence was truncated mid-JSON-string and reported NOT_PARSEABLE. Any
 * council reviewing markdown — or any model quoting a fenced example — silently
 * lost the seat. Measured on a real paid run: 3 of 4 seats, 11 findings.
 */
describe('lastJsonBlock — a fence INSIDE the body must not close the block', () => {
  const { lastJsonBlock, countAttemptedFindings } = require('../../src/council/findings');

  const fencedClaims = {
    overall: 'The renderer discusses markdown, so the prose quotes fences.',
    findings: [
      { id: 1, severity: 'minor',
        claim: `Fence detection is a loose prefix test (/^${F}/) for both open and close.`,
        location: 'md-lite.js parseMdLite', rationale: 'r1' },
      { id: 2, severity: 'nit',
        claim: `The fence info string (e.g. 'js' in ${F}js) is silently discarded.`,
        location: 'md-lite.js parseMdLite fence branch', rationale: 'r2' },
    ],
  };
  const block = `${F}json\n${JSON.stringify(fencedClaims, null, 2)}\n${F}`;

  test('a claim containing ``` and ```js survives extraction intact', () => {
    const body = lastJsonBlock(`prose about fences\n\n${block}`);
    expect(body).not.toBeNull();
    const parsed = JSON.parse(body);           // the old regex died right here
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0].claim).toContain(F);
    expect(parsed.findings[1].claim).toContain(`${F}js`);
  });

  test('such a block VALIDATES instead of collapsing to NOT_PARSEABLE', () => {
    const res = validateFindings(`prose\n\n${block}`);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.findings).toHaveLength(2);
    expect(countAttemptedFindings(`prose\n\n${block}`)).toBe(2);
  });

  test('the LAST qualifying block still wins when an EARLIER block also holds a fence', () => {
    // The earlier block is the trap: under the old regex it ended at its own
    // inline fence, and the scan resumed mid-body — so "last" was not even
    // well-defined. Both blocks are now delimited correctly and the last wins.
    const earlier = `${F}json\n{"overall":"decoy quoting ${F}js here","findings":[]}\n${F}`;
    const body = lastJsonBlock(`${earlier}\nmore prose\n${block}`);
    expect(JSON.parse(body).findings).toHaveLength(2);
  });

  test('an indented closing fence still closes (CommonMark allows it)', () => {
    const indented = `${F}json\n{"overall":"o","findings":[]}\n   ${F}`;
    expect(JSON.parse(lastJsonBlock(indented))).toEqual({ overall: 'o', findings: [] });
  });

  test('REAL paid-run regression fixture: the seat that was truncated now parses', () => {
    // Verbatim copy of review-opus.md from the md-lite council (the run that
    // exposed this bug). Its finding #4 quotes `/^```/` inside a JSON string —
    // the exact byte sequence that cut the block and cost the seat 5 findings.
    const real = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'review-opus-fenced-claims.md'), 'utf-8');
    const res = validateFindings(real);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(5);
    expect(countAttemptedFindings(real)).toBe(5);
    // The fixture must keep carrying the trigger, or it stops being a regression test.
    expect(res.findings.some((f) => f.claim.includes(F))).toBe(true);
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

describe('repairCanHonorContract (review F2: do not buy a repair that cannot succeed)', () => {
  const { repairCanHonorContract } = require('../../src/council/findings');

  test('a real count is always repairable', () => {
    expect(repairCanHonorContract(1)).toBe(true);
    expect(repairCanHonorContract(7)).toBe(true);
  });

  test('null (nothing to compare) is repairable — the wave\'s main legitimate use', () => {
    expect(repairCanHonorContract(null)).toBe(true);
  });

  test('zero TRACKS the validator rather than hard-coding an answer', () => {
    // The only contract-honoring repair of a zero-finding original is another
    // empty set, so this predicate must be exactly "does the validator accept an
    // empty set?". Asserted as a linkage, not as today's value: Task 3 (LC-10)
    // flips the validator, and this test must keep passing when it does.
    const emptySetIsValid = validateFindings(
      '```json\n{"overall":"nothing found","findings":[]}\n```').ok;
    expect(repairCanHonorContract(0)).toBe(emptySetIsValid);
  });
});
