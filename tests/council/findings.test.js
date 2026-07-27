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
   * ⚠️ THE SAME-LINE CLOSER — THIRD CONTRACT. These two tests have been rewritten twice;
   * the whole history lives here, because the shape they cover is the one every future
   * edit to lastJsonBlock will be tempted to change.
   *
   * CONTRACT 1 (pre-Task-10). `/```json\s*\n([\s\S]*?)```/g` — the first triple-backtick
   * ANYWHERE closed the block. A same-line closer worked; a body that QUOTED a fence was
   * truncated mid-JSON-string. Measured cost on a real paid run: 3 of 4 seats, 11 findings,
   * synthesized by the chair without anyone knowing.
   *
   * CONTRACT 2 (Task 10 + its follow-up, what these tests USED TO ASSERT). The closer was
   * anchored to line start, which rescued the fence-quoting body — and, as its declared
   * cost, stopped a same-line closer from closing anything. The v4.4.1 per-opener ruling
   * then let the same-line reading RECOVER a body but never DISCOVER one, so these two
   * tests kept asserting, verbatim:
   *
   *     lastJsonBlock(`${F}json\n{"a":1}${F}`) === null
   *     lastJsonBlock(`${F}json\n{"a":1}${F} done`) === null
   *     validateFindings(sameLine).errors === [{code:'NO_FENCED_BLOCK', …}]
   *     countAttemptedFindings(sameLine) === null
   *
   * WHY THE CONTRACT CHANGED (owner ruling, this fix wave). That gate was a judgment call
   * surfaced rather than taken, and the owner overruled it: a LONE same-line-fenced block
   * whose JSON is perfectly well-formed was returning null → NO_FENCED_BLOCK → a PAID
   * repair leg, spent on a cosmetic closer. Let JSON.parse arbitrate, full stop.
   *
   * WHY THAT DOES NOT RE-OPEN CONTRACT 1's DEFECT — the point the whole design turns on.
   * Widening is safe only because openers are enumerated INDEPENDENTLY and each one is read
   * BOTH ways with the anchored reading FIRST. For a fence-quoting body the anchored reading
   * is the one that parses, so it still wins; the same-line reading of that same opener is a
   * truncated string that JSON.parse throws on. The regex is no longer choosing — parse
   * success is. Simulated on both shapes before the ruling was issued.
   *
   * ⚠️ WHAT THESE TESTS ACTUALLY GUARANTEE — corrected by the v4.4.1 FINAL WHOLE-BRANCH
   * REVIEW, which measured the claim that stood here and found it false. The old text
   * said the last assertion below "fails the moment anything reorders the readings so the
   * same-line one is tried first." It does not. Mutating `bodyReadings`
   * (`src/council/findings.js:30-37`) to `return out.reverse()` leaves the ENTIRE suite
   * green — the reviewer measured 5,712/5,712 at the release cut, and the mutation was
   * re-run here against these three council parser suites (87/87) before this comment
   * was rewritten.
   *
   * That is not a hole in these tests. Reading order is unobservable BY CONSTRUCTION, and
   * the reason is worth writing down because it is what makes consulting the sloppy
   * reading safe at all. The same-line reading stops at the first ``` ANYWHERE; the
   * anchored one stops at a line-START fence. Where the two disagree materially, the
   * same-line body ends before a fence that is *not* at a line start — one sitting inside
   * the body's own content, which in well-formed JSON means inside a string — and a body
   * cut mid-string never parses. The only way BOTH readings can parse is when they differ
   * by nothing but trailing spaces/tabs, and then they parse to the same value. So at most
   * one reading of an opener is ever complete JSON, ties are semantically identical, and
   * `JSON.parse` cannot tell which was tried first. No assertion resting on parse
   * arbitration can either — including the ones below.
   *
   * WHAT THEY DO PIN, which is worth having: that the same-line reading EXISTS. Delete it
   * from `bodyReadings` and both tests in this pair go red (measured) — and that deletion
   * is exactly what would put a lone same-line-closed block back on a PAID repair leg.
   *
   * ⚠️ WHERE TRAP 1's REAL PROTECTION LIVES — read these before touching the extractor.
   * A findings body that CONTAINS a fence is guarded by NINE assertions, none of which
   * depends on reading order and all of which depend on the ANCHORED reading existing:
   * this file at :176, :185, :193, the `quoting` line inside the first test below, the
   * "sloppy block first AND a fence inside the good body" test, and the REAL paid-run
   * regression fixture at the end of this describe; plus `tests/council/parse-stage2.test.js`
   * at :134, :147 and :157, covering the judge, debate-defense and re-vote consumers.
   */
  test('a closing fence SHARING A LINE with body content DOES close the block (owner ruling)', () => {
    // The canonical single-line emit. Well-formed JSON — under contract 2 this was null.
    expect(lastJsonBlock(`${F}json\n{"a":1}${F}`)).toBe('{"a":1}');
    // …and trailing prose after the fence does not disturb it.
    expect(lastJsonBlock(`${F}json\n{"a":1}${F} done`)).toBe('{"a":1}');
    // A newline before the fence. NOT an ordering probe, despite what this line used to
    // claim: the first ``` here IS the line-start ```, so both readings produce the very
    // same '{"a":1}\n'. What it pins is that the trailing newline is kept, i.e. that a
    // body is sliced at the fence and not trimmed.
    expect(lastJsonBlock(`${F}json\n{"a":1}\n${F}`)).toBe('{"a":1}\n');
    // Trap 1 in one line: same opener, both readings available, and they DISAGREE — the
    // anchored one is the whole object, the same-line one truncates inside the string.
    // Only the anchored reading parses, so it wins whichever order they are tried in;
    // this goes red if the ANCHORED reading is ever dropped, not if it is reordered.
    const quoting = `${F}json\n{"claim":"a fence ${F} inside a string"}\n${F}`;
    expect(JSON.parse(lastJsonBlock(quoting)).claim).toContain(F);
  });

  test('that shape parses instead of buying a repair leg (owner ruling)', () => {
    const sameLine = `here are my findings\n${F}json\n{"overall":"o","findings":[]}${F}`;
    const res = validateFindings(sameLine);
    // Under contract 2 this was NO_FENCED_BLOCK and a paid repair wave. It is a clean,
    // well-formed, zero-finding review; LC-10 makes the empty set valid, so it validates.
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.findings).toEqual([]);
    // countAttemptedFindings now answers 0 (a declared empty set) rather than null
    // (unverifiable) — the difference repairCanHonorContract keys off. Zero still tracks
    // the validator rather than short-circuiting: nothing about that linkage changed.
    expect(countAttemptedFindings(sameLine)).toBe(0);
    expect(repairCanHonorContract(0)).toBe(validateFindings(
      `${F}json\n{"overall":"nothing found","findings":[]}\n${F}`).ok);
  });

  /**
   * The absent case the widening must NOT swallow. An opener with no closing fence of
   * EITHER kind — a cut-off emit — still yields no candidate at all, so `null` /
   * NO_FENCED_BLOCK survives as a reachable answer distinct from NOT_PARSEABLE. Without
   * this, "the model emitted nothing" and "the model emitted something broken" collapse
   * into one code and the repair prompt is told the wrong story.
   */
  test('an opener that never closed at ALL is still absent, not malformed', () => {
    expect(lastJsonBlock(`${F}json\n{"a":1}`)).toBeNull();
    expect(validateFindings(`prose\n${F}json\n{"a":1}`).errors)
      .toEqual([{ code: 'NO_FENCED_BLOCK', detail: 'no ```json block found' }]);
    expect(countAttemptedFindings(`${F}json\n{"a":1}`)).toBeNull();
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
   * the last one that `JSON.parse`s. The pin's purpose survives inverted — but NOT in the
   * way this comment used to claim.
   *
   * ⚠️ CORRECTED by the v4.4.1 FINAL WHOLE-BRANCH REVIEW, which measured it. The old text
   * said this test "goes red the moment the extractor stops considering the same-line
   * reading." It does not: drop the same-line reading from `bodyReadings`
   * (`src/council/findings.js:30-37`) and this test stays GREEN. The good block is still
   * reached, because its own opener's ANCHORED body parses on its own terms. (Measured:
   * that same mutation turns only the two same-line-closer tests above red.)
   *
   * WHAT IT ACTUALLY PINS is move 1 of the algorithm — that openers are enumerated
   * INDEPENDENTLY rather than by one left-to-right scan whose cursor resumes after each
   * match. That is what rescues this shape: the sloppy predecessor's run-on anchored body
   * swallows the good block's opener, so a resuming scan never offers it as a candidate at
   * all. Re-introduce a resuming scan, however the close is written, and this goes red.
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
   *
   * "Preferred" = the last opener's anchored reading when it has one, its same-line reading
   * otherwise. Both shapes below have an anchored close, so both name an anchored body.
   */
  test('when nothing parses, the last opener\'s preferred body is still returned', () => {
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

/**
 * ⚠️ v4.4.1 FINAL WHOLE-BRANCH REVIEW, finding C — a body of literal `null`.
 *
 * `JSON.parse('null')` SUCCEEDS and returns `null`. So a block whose body is `null`
 * sailed straight past validateFindings' try/catch and every dereference of `parsed`
 * below it threw `TypeError: Cannot read properties of null (reading 'findings')`.
 *
 * Why it was worth fixing on release eve rather than deferring: the call site is
 * `run-stages.js:164`, which sits inside `run.js`'s try/catch — so ONE seat emitting
 * a `null` body aborted an entire PAID council as exit 1 instead of degrading that one
 * seat. That is exactly the fail-closed shape this release exists to remove.
 *
 * It was an asymmetry, not a new design: of the five consumers of `lastJsonBlock`,
 * `parse-stage2.js`'s parseDebateDefense (`:129`) and parseRevote (`:167`) already
 * carried the `!parsed` guard. validateFindings and parseJudgeOutput did not.
 */
describe('a JSON body of literal `null` degrades instead of throwing (review C)', () => {
  const { lastJsonBlock, countAttemptedFindings, repairCanHonorContract } =
    require('../../src/council/findings');
  const nullBody = `${F}json\nnull\n${F}`;

  test('the extractor itself was never the problem — it returns the body', () => {
    // Both readings agree here, and `null` is valid JSON, so lastJsonBlock hands
    // back a body and reports success. The crash was strictly downstream of it.
    expect(lastJsonBlock(nullBody)).toBe('null\n');
  });

  test('validateFindings reports NOT_PARSEABLE instead of throwing TypeError', () => {
    expect(() => validateFindings(nullBody)).not.toThrow();
    const res = validateFindings(nullBody);
    expect(res.ok).toBe(false);
    expect(res.findings).toEqual([]);
    expect(res.errors).toHaveLength(1);
    // The code a malformed emit ALREADY takes — deliberately not a new one, and
    // deliberately not NO_FENCED_BLOCK: the model emitted something, and the repair
    // prompt is told which of those two stories is true.
    expect(res.errors[0].code).toBe('NOT_PARSEABLE');
    expect(res.errors[0].detail).toContain('null');
  });

  test('the other contentless scalar bodies join it; a truthy scalar does not move', () => {
    // `!parsed` is the guard the two already-guarded consumers use, so it also picks
    // up 0 / false / "" — bodies that carry no object at all. Every one of them was
    // ok:false before (EMPTY_FINDINGS) and is ok:false now; only the code changed, to
    // the more truthful one. Recorded here so the widening is a decision, not a slip.
    for (const body of ['0', 'false', '""']) {
      const res = validateFindings(`${F}json\n${body}\n${F}`);
      expect(res.ok).toBe(false);
      expect(res.errors[0].code).toBe('NOT_PARSEABLE');
    }
    // A truthy scalar never crashed and is left exactly where it was. The guard
    // widens nothing beyond the falsy set.
    expect(validateFindings(`${F}json\n123\n${F}`).errors[0].code).toBe('EMPTY_FINDINGS');
  });

  test('countAttemptedFindings stays null (unverifiable) and NEVER 0', () => {
    // Load-bearing: repairCanHonorContract reads null as "nothing to compare, so a
    // repair is worth buying" and 0 as "the original declared an empty set". A `null`
    // body declared nothing at all, so it must answer null.
    expect(countAttemptedFindings(nullBody)).toBeNull();
    expect(repairCanHonorContract(countAttemptedFindings(nullBody))).toBe(true);
  });
});
