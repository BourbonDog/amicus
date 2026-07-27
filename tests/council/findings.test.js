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
  const { lastJsonBlock, countAttemptedFindings, repairCanHonorContract } = require('../../src/council/findings');

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

  /**
   * ⚠️ THE DECLARED COST OF THE ANCHOR, made executable (v4.4.1, Task 10 follow-up).
   *
   * Anchoring the closing fence to line start bought back three of four seats, but it is
   * not free: a fence SHARING A LINE with body content no longer closes a block. That
   * consequence was stated in c5f4a9e's message and in lastJsonBlock's docblock, and
   * asserted nowhere — so the whole trade lived in prose.
   *
   * Why that is dangerous rather than merely untidy: this shape routes to the PAID repair
   * wave instead of parsing, so it shows up in the field as "the repair leg fired on a
   * block that looks fine to me". Someone reacting to that complaint by dropping the `m`
   * flag / re-loosening the anchor would have a fully green suite and would silently
   * re-open the 15-findings-lost defect. These tests are the tripwire on that edit: they
   * fail the moment the anchor is loosened, and they say WHY the behaviour is intended.
   *
   * The behaviour is also correct on its own terms. A raw newline inside a JSON string is
   * invalid JSON, so no line of a WELL-FORMED body can begin with a fence — which means
   * treating a same-line fence as a closer can only ever be a guess about a malformed
   * emit, and guessing is exactly what handed the chair truncated reviews before.
   *
   * ⚠️ Amended by the v4.4.1 owner ruling two tests below. The same-line reading is now
   * consulted — but only to RE-SEGMENT text in which the anchored reading already found a
   * closed block, and only where JSON.parse ratifies the result. It is never used to
   * DISCOVER a block, which is why these assertions still hold: with no anchored close
   * anywhere in the text, there is nothing to re-segment and the extractor still declines
   * to guess. The guess the paragraph above warns about is the unratified kind.
   */
  test('a closing fence SHARING A LINE with body content does not close the block', () => {
    // The canonical single-line emit. Well-formed JSON, no closing fence on its own line.
    expect(lastJsonBlock(`${F}json\n{"a":1}${F}`)).toBeNull();
    // …nor does trailing prose after the fence rescue it.
    expect(lastJsonBlock(`${F}json\n{"a":1}${F} done`)).toBeNull();
    // A newline before the fence is what closes it — the ONLY difference from the above.
    expect(lastJsonBlock(`${F}json\n{"a":1}\n${F}`)).toBe('{"a":1}\n');
  });

  test('that shape routes to the repair wave rather than being silently mis-parsed', () => {
    const sameLine = `here are my findings\n${F}json\n{"overall":"o","findings":[]}${F}`;
    const res = validateFindings(sameLine);
    // NO_FENCED_BLOCK, not NOT_PARSEABLE and never a partial parse: the extractor declines
    // to guess where the body ended.
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([{ code: 'NO_FENCED_BLOCK', detail: 'no ```json block found' }]);
    // countAttemptedFindings answers null (nothing to compare), which is precisely the
    // input repairCanHonorContract treats as "always repairable" — so the leg is handed to
    // the repair wave with an honest "unverified", not scored against a fabricated count.
    expect(countAttemptedFindings(sameLine)).toBeNull();
    expect(repairCanHonorContract(countAttemptedFindings(sameLine))).toBe(true);
  });

  /**
   * ⚠️ OWNER RULING (v4.4.1): "the last block" means the last candidate that PARSES.
   *
   * WHAT THIS TEST USED TO ASSERT. Task 11 measured this exact shape and pinned it as
   * `MEASURED: a sloppy same-line block BEFORE a good one swallows it — loudly, into
   * repair`, asserting the DEFECT's own output:
   *
   *     lastJsonBlock(composite) === '{"overall":"decoy","findings":[]}```\nprose\n'
   *     validateFindings(composite).errors[0].code === 'NOT_PARSEABLE'
   *
   * Because the sloppy block's closer is not at line start, the anchored close let its
   * lazy body run on to the next line-START fence — which is the GOOD block's OPENING
   * fence — so the well-formed block was never reached and a paid repair leg was bought.
   * (The pre-Task-10 unanchored regex found the good block here; the anchor, which is
   * what rescues a body CONTAINING a fence, is what lost it.) It was pinned rather than
   * fixed because changing the extractor is a product decision, not a test-task one.
   *
   * The owner ruled: generate candidates under BOTH closing-fence readings and return
   * the last one that `JSON.parse`s. The pin's purpose survives inverted — it still goes
   * red the moment the extractor stops considering the same-line reading, which is the
   * one edit that re-opens this trap.
   */
  test('a sloppy same-line block BEFORE a good one no longer swallows it (owner ruling)', () => {
    const sloppy = `${F}json\n{"overall":"decoy","findings":[]}${F}`;
    const good = `${F}json\n{"overall":"real","findings":[]}\n${F}`;
    const composite = `${sloppy}\nprose\n${good}`;

    // The well-formed block wins: it is the last opener whose body parses. The decoy
    // also parses (under the same-line reading) but comes first; the swallowed run-on
    // body, which is all the anchored reading alone produced, parses not at all.
    expect(lastJsonBlock(composite)).toBe('{"overall":"real","findings":[]}\n');
    const res = validateFindings(composite);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(countAttemptedFindings(composite)).toBe(0);
  });

  /**
   * BOTH TRAPS AT ONCE, which is the shape that decides the algorithm.
   *
   * A sloppy block first (trap 2) AND the good block's body quotes a fence (trap 1) —
   * the ordinary case for any council reviewing markdown. Neither closing-fence reading
   * finds the good block on its own here: the anchored one is swallowed by the sloppy
   * predecessor, and the same-line one truncates at the fence inside the claim. Only
   * enumerating each ```json opener INDEPENDENTLY reaches it.
   *
   * This is the test that fails if the extractor ever goes back to one left-to-right
   * scan whose cursor resumes after each match, however the close is written — and it
   * fails LOUD rather than subtly: without it, the decoy parses cleanly and a seat's
   * findings are replaced, silently, by an empty set the model never declared.
   */
  test('sloppy block first AND a fence inside the good body — the good block still wins', () => {
    const sloppy = `${F}json\n{"overall":"decoy","findings":[]}${F}`;
    const good = `${F}json\n${JSON.stringify(fencedClaims, null, 2)}\n${F}`;
    const res = validateFindings(`${sloppy}\nprose\n${good}`);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(2);
    expect(res.findings[0].claim).toContain(F);
    expect(countAttemptedFindings(`${sloppy}\nprose\n${good}`)).toBe(2);
  });

  /**
   * The other half of the ruling: when NO candidate parses, a malformed emit must not be
   * dressed up as an absent one. `null` and "a body that fails JSON.parse" are different
   * answers to different questions, and the difference is load-bearing downstream —
   * countAttemptedFindings returns null either way here, but validateFindings must say
   * NOT_PARSEABLE (the model emitted something broken) rather than NO_FENCED_BLOCK (the
   * model emitted nothing at all), because that is what the repair prompt is told.
   */
  test('when nothing parses, the last ANCHORED body is still returned', () => {
    const broken = `${F}json\n{"overall": broken,\n${F}`;
    expect(lastJsonBlock(broken)).toBe('{"overall": broken,\n');
    expect(validateFindings(broken).errors[0].code).toBe('NOT_PARSEABLE');

    // …including in the composite shape above when the trailing block is ALSO malformed.
    // The fallback names the LAST opener's anchored body — the block the model finished
    // on, which is the one a repair prompt is about — not the first opener's run-on.
    const composite = `${F}json\n{"decoy":}${F}\nprose\n${F}json\n{"real":}\n${F}`;
    expect(lastJsonBlock(composite)).toBe('{"real":}\n');
    expect(validateFindings(composite).errors[0].code).toBe('NOT_PARSEABLE');
    expect(countAttemptedFindings(composite)).toBeNull();
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
