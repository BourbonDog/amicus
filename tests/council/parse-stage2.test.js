// tests/council/parse-stage2.test.js
'use strict';
const { parseJudgeOutput, parseChairVerdict, CHAIR_VERDICTS } =
  require('../../src/council/parse-stage2');

const CTX = { labels: ['Review A', 'Review B', 'Review C'], findingIds: ['A1', 'B1', 'B2'] };
const wrap = (obj) => `Prose reasoning.\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

describe('parseJudgeOutput — good input', () => {
  test('parses ranking and adjudications', () => {
    const r = parseJudgeOutput(wrap({
      ranking: ['Review B', 'Review A', 'Review C'],
      adjudications: [{ id: 'A1', verdict: 'agree' }, { id: 'B2', verdict: 'dispute' }],
    }), CTX);
    expect(r.ok).toBe(true);
    expect(r.ranking).toEqual(['Review B', 'Review A', 'Review C']);
    expect(r.adjudications).toEqual([{ id: 'A1', verdict: 'agree' }, { id: 'B2', verdict: 'dispute' }]);
    expect(r.errors).toEqual([]);
  });

  test('accepts tie groups (nested arrays) in the ranking', () => {
    const r = parseJudgeOutput(wrap({
      ranking: [['Review A', 'Review B'], 'Review C'],
      adjudications: [{ id: 'A1', verdict: 'neutral' }],
    }), CTX);
    expect(r.ok).toBe(true);
    expect(r.ranking).toEqual([['Review A', 'Review B'], 'Review C']);
  });

  test('a finding id missing from adjudications is allowed (absent vote)', () => {
    const r = parseJudgeOutput(wrap({
      ranking: ['Review A', 'Review B', 'Review C'],
      adjudications: [{ id: 'A1', verdict: 'agree' }],
    }), CTX);
    expect(r.ok).toBe(true);
  });
});

describe('parseJudgeOutput — malformed input', () => {
  test('missing block → NO_FENCED_BLOCK', () => {
    const r = parseJudgeOutput('just prose, no json', CTX);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('NO_FENCED_BLOCK');
  });

  test('unparseable JSON → NOT_PARSEABLE', () => {
    const r = parseJudgeOutput('x\n```json\n{nope\n```\n', CTX);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('NOT_PARSEABLE');
  });

  test('unknown label / duplicate label / bad verdict / unknown finding id', () => {
    const r = parseJudgeOutput(wrap({
      ranking: ['Review Z', 'Review A', 'Review A'],
      adjudications: [{ id: 'X9', verdict: 'agree' }, { id: 'A1', verdict: 'maybe' }],
    }), CTX);
    expect(r.ok).toBe(false);
    const codes = r.errors.map(e => e.code);
    expect(codes).toContain('UNKNOWN_LABEL');
    expect(codes).toContain('DUPLICATE_LABEL');
    expect(codes).toContain('UNKNOWN_FINDING_ID');
    expect(codes).toContain('BAD_VERDICT');
  });

  test('empty ranking → BAD_RANKING', () => {
    const r = parseJudgeOutput(wrap({ ranking: [], adjudications: [] }), CTX);
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('BAD_RANKING');
  });

  test('non-array adjudications → BAD_ADJUDICATIONS', () => {
    const r = parseJudgeOutput(wrap({ ranking: ['Review A', 'Review B', 'Review C'], adjudications: null }), CTX);
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('BAD_ADJUDICATIONS');
  });
});

describe('parseChairVerdict', () => {
  test('parses each enum value', () => {
    for (const v of CHAIR_VERDICTS) {
      expect(parseChairVerdict(`Synthesis…\n\nVERDICT: ${v}`)).toBe(v);
    }
  });

  test('LAST matching VERDICT line wins (spec §5)', () => {
    const text = 'VERDICT: Ship it\nmore analysis…\nVERDICT: Fix these first\n';
    expect(parseChairVerdict(text)).toBe('Fix these first');
  });

  test('missing or non-enum line → null', () => {
    expect(parseChairVerdict('no verdict here')).toBeNull();
    expect(parseChairVerdict('VERDICT: Looks fine')).toBeNull();
  });

  test('tolerates leading whitespace and trailing spaces', () => {
    expect(parseChairVerdict('  VERDICT: Ship it  ')).toBe('Ship it');
  });

  test('tolerates trailing rationale after the phrase (live-gate bug, runId b89b67d1)', () => {
    const text = 'Synthesis…\n\nVERDICT: Fix these first — SQL injection (all queries), ' +
      'authorization checks (per-order ownership validation), and money-handling ' +
      'correctness must all be resolved before this code touches production.';
    expect(parseChairVerdict(text)).toBe('Fix these first');
  });

  test('tolerates trailing rationale for each of the other two phrases', () => {
    expect(parseChairVerdict('VERDICT: Ship it — looks solid')).toBe('Ship it');
    expect(parseChairVerdict('VERDICT: Fundamental rethink. The data model is unsound.'))
      .toBe('Fundamental rethink');
  });

  test('is prefix-anchored — a canonical phrase appearing later in the rationale must not win', () => {
    expect(parseChairVerdict('VERDICT: Fix these first — not a Ship it situation'))
      .toBe('Fix these first');
  });

  test('does not over-match a longer word sharing the phrase as a prefix', () => {
    expect(parseChairVerdict('VERDICT: Ship its all good')).toBeNull();
  });
});

/**
 * ⚠️ v4.4.1 Task 10 — the Stage-2 parsers share findings.js's lastJsonBlock, so
 * they carried the SAME truncate-on-inner-fence defect as Stage-1 findings. A
 * judge adjudicating a review about markdown, or a rebuttal quoting a fenced
 * snippet, lost its whole block to NOT_PARSEABLE. Fixed once at the extractor;
 * pinned here per consumer so a future re-implementation cannot regress one of
 * them silently.
 */
describe('Stage-2 parsers inherit the line-start closing-fence fix', () => {
  const { parseDebateDefense, parseRevote } = require('../../src/council/parse-stage2');
  const F = '`'.repeat(3);

  test('parseJudgeOutput: a reason quoting ```js survives', () => {
    const r = parseJudgeOutput(wrap({
      ranking: ['Review A', 'Review B', 'Review C'],
      adjudications: [
        { id: 'A1', verdict: 'agree', reason: `the ${F}js info string is dropped` },
        { id: 'B2', verdict: 'dispute', reason: `/^${F}/ is only a prefix test` },
      ],
    }), CTX);
    expect(r.ok).toBe(true);
    expect(r.adjudications).toHaveLength(2);
    expect(r.errors).toEqual([]);
  });

  test('parseDebateDefense: an argument quoting a fence survives', () => {
    const r = parseDebateDefense(wrap({
      responses: [{ id: 'A1', action: 'defend',
        argument: `The example was ${F}json\n{}\n${F} — still a fence in prose.` }],
    }), ['A1', 'B1']);
    expect(r.ok).toBe(true);
    expect(r.byId.A1.action).toBe('defend');
    expect(r.byId.B1).toEqual({ action: 'no-response' }); // untouched fallback
  });

  test('parseRevote: a reason quoting a fence survives', () => {
    const r = parseRevote(wrap({
      revotes: [{ id: 'A1', verdict: 'dispute', reason: `${F} in a claim is not a bug` }],
    }), ['A1']);
    expect(r.ok).toBe(true);
    expect(r.byId.A1).toEqual({ verdict: 'dispute', reason: `${F} in a claim is not a bug` });
  });
});

/**
 * ⚠️ v4.4.1 FINAL WHOLE-BRANCH REVIEW, finding C — the Stage-2 half.
 *
 * `JSON.parse('null')` succeeds, so a body of literal `null` reached
 * `parsed.ranking` at `parse-stage2.js:38` and threw `TypeError`. Two of the five
 * consumers of `lastJsonBlock` — parseDebateDefense (`:129`) and parseRevote (`:167`)
 * — already carried `!parsed`; parseJudgeOutput and findings.js's validateFindings
 * did not. This was an asymmetry among siblings, not a new design.
 *
 * The fix reuses the shape errors the judge path ALREADY produces for a body with no
 * usable keys, so nothing new appears in a repair prompt's error list.
 */
describe('a JSON body of literal `null` degrades instead of throwing (review C)', () => {
  const { parseDebateDefense, parseRevote } = require('../../src/council/parse-stage2');
  const nullBlock = '```json\nnull\n```';

  test('parseJudgeOutput: null takes the SAME path an empty object already took', () => {
    expect(() => parseJudgeOutput(nullBlock, CTX)).not.toThrow();
    const r = parseJudgeOutput(nullBlock, CTX);
    expect(r.ok).toBe(false);
    expect(r.ranking).toBeNull();
    expect(r.adjudications).toBeNull();
    // Asserted as an EQUIVALENCE, not as a literal list: whatever a keyless body
    // reports, a `null` body must report identically. No invented code.
    expect(r.errors.map((e) => e.code))
      .toEqual(parseJudgeOutput(wrap({}), CTX).errors.map((e) => e.code));
    expect(r.errors.map((e) => e.code)).toEqual(['BAD_RANKING', 'BAD_ADJUDICATIONS']);
  });

  test('parseDebateDefense and parseRevote were already guarded — pinned so they stay', () => {
    const d = parseDebateDefense(nullBlock, ['A1', 'B1']);
    expect(d.ok).toBe(false);
    expect(d.errors[0].code).toBe('BAD_RESPONSES');
    expect(d.byId).toEqual({ A1: { action: 'no-response' }, B1: { action: 'no-response' } });

    const v = parseRevote(nullBlock, ['A1']);
    expect(v.ok).toBe(false);
    expect(v.errors[0].code).toBe('BAD_REVOTES');
    expect(v.byId).toEqual({});
  });
});
