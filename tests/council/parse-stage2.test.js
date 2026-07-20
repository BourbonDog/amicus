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
