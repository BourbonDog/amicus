// tests/council/briefings-debate.test.js
'use strict';
const d = require('../../src/council/briefings-debate');
const s2 = require('../../src/council/briefings-stage2');

const DATE = '2026-07-19';

describe('DEBATE_NO_TOOLS_PREAMBLE', () => {
  test('is the verbatim no-tools preamble', () => {
    expect(d.DEBATE_NO_TOOLS_PREAMBLE).toBe(
      'Do NOT use any tools or read any files; everything is in this message; ' +
      'begin immediately with the JSON block.'
    );
  });
});

describe('buildDefenseBrief (spec §5.3a)', () => {
  const brief = d.buildDefenseBrief({ date: DATE, findings: [
    { id: 'A1', claim: 'The retry loop is infinite.', severity: 'major',
      peerVerdicts: ['dispute', 'dispute', 'agree'],
      disputeReasons: ['the backoff caps at 5 attempts', 'guarded by a flag'] },
  ] });
  test('opens with the no-tools preamble and the date line', () => {
    expect(brief.split('\n')[0]).toBe(d.DEBATE_NO_TOOLS_PREAMBLE);
    expect(brief).toContain("Today's date is 2026-07-19.");
  });
  test('names the three verbs and the strict responses contract', () => {
    expect(brief).toContain('DEFEND');
    expect(brief).toContain('AMEND');
    expect(brief).toContain('WITHDRAW');
    expect(brief).toContain('"responses"');
    expect(brief).toContain('"action": "defend"');
    expect(brief).toContain('"action": "amend"');
    expect(brief).toContain('"action": "withdraw"');
    expect(brief).toContain('Every listed finding id must appear exactly once');
  });
  test('lists the finding, the REAL peer split and the anonymized reasons, no judge identities', () => {
    expect(brief).toContain('A1');
    expect(brief).toContain('The retry loop is infinite.');
    expect(brief).toContain('the backoff caps at 5 attempts');
    expect(brief).toContain('Peer verdicts (anonymized): 2 dispute, 1 agree, 0 neutral.');
    for (const w of ['gemini', 'gpt', 'deepseek', 'Review A', 'judge']) {
      expect(brief.toLowerCase()).not.toContain(w.toLowerCase());
    }
  });
  test('with no captured reasons it reports the real split, never a filler reason', () => {
    const bare = d.buildDefenseBrief({ date: DATE, findings: [
      { id: 'B2', claim: 'Typo remains.', severity: 'nit',
        peerVerdicts: ['dispute', 'neutral'], disputeReasons: [] },
    ] });
    expect(bare).toContain('Peer verdicts (anonymized): 1 dispute, 0 agree, 1 neutral.');
    expect(bare).toContain('No written dispute reasons were captured');
    expect(bare).not.toContain('Peers disputed it for:');
    expect(bare).not.toContain('a peer disputed this finding');
  });
});

describe('buildRevoteBundle (spec §5.3b)', () => {
  const bundle = d.buildRevoteBundle({ date: DATE, findings: [
    { id: 'A1', claim: 'Corrected claim.', severity: 'major', amended: true, argument: 'narrowed to the retry path' },
    { id: 'B2', claim: 'Typo remains.', severity: 'nit', amended: false, argument: 'still reproduces on line 4' },
  ] });
  test('opens with the preamble + date and carries the revotes contract', () => {
    expect(bundle.split('\n')[0]).toBe(d.DEBATE_NO_TOOLS_PREAMBLE);
    expect(bundle).toContain("Today's date is 2026-07-19.");
    expect(bundle).toContain('"revotes"');
    expect(bundle).toContain('agree | dispute | neutral');
    expect(bundle).toContain('Every listed finding id must appear exactly once');
  });
  test('marks amended findings and carries the raiser defense', () => {
    expect(bundle).toContain('AMENDED');
    expect(bundle).toContain('Corrected claim.');
    expect(bundle).toContain('narrowed to the retry path');
  });
});

describe('repair prompts', () => {
  test('defense repair quotes errors and demands only the JSON block', () => {
    const t = d.buildDefenseRepairPrompt({ errors: [{ code: 'BAD_RESPONSES', detail: 'responses must be an array' }] });
    expect(t.startsWith('Do NOT use any tools')).toBe(true);
    expect(t).toContain('BAD_RESPONSES: responses must be an array');
    expect(t).toContain('"responses"');
  });
  test('revote repair quotes errors and demands only the JSON block', () => {
    const t = d.buildRevoteRepairPrompt({ errors: [{ code: 'NOT_PARSEABLE', detail: 'x' }] });
    expect(t).toContain('NOT_PARSEABLE: x');
    expect(t).toContain('"revotes"');
  });
});

describe('buildDebateAddendum (spec §5.3c)', () => {
  const section = d.buildDebateAddendum({ outcomes: [
    { id: 'A1', originalClaim: 'orig', action: 'amended', amendedClaim: 'new',
      priorVerdicts: { gpt: 'dispute', qwen: 'neutral' }, revotes: { gpt: 'agree', qwen: 'agree' } },
    { id: 'B2', originalClaim: 'b', action: 'withdrawn', amendedClaim: null,
      priorVerdicts: {}, revotes: {} },
  ] });
  test('names the section and reports actions + before→after', () => {
    expect(section).toContain('Debate round outcomes');
    expect(section).toContain('A1');
    expect(section).toContain('amended');
    expect(section).toContain('new');
    expect(section).toContain('gpt: dispute → agree');
    expect(section).toContain('withdrawn');
  });
  test('uses each judge\'s REAL prior verdict, never an assumed dispute', () => {
    expect(section).toContain('qwen: neutral → agree');   // qwen never disputed A1
    expect(section).not.toContain('qwen: dispute');
    expect(section).toContain('Re-vote changes: none');
  });
});

describe('date-stamp on Stage-2 / chair briefings (spec §4.3)', () => {
  test('buildJudgeBundle prepends the date when given', () => {
    const bundle = s2.buildJudgeBundle({
      reviews: [{ label: 'Review A', text: 'a' }], findings: [{ id: 'A1', severity: 'nit', claim: 'c' }], date: DATE,
    });
    expect(bundle).toContain("Today's date is 2026-07-19.");
    expect(bundle.split('\n')[0]).toBe(s2.JUDGE_NO_TOOLS_PREAMBLE); // preamble is still line 1
  });
  test('buildJudgeBundle without a date is unchanged (v4.0 back-compat)', () => {
    const bundle = s2.buildJudgeBundle({
      reviews: [{ label: 'Review A', text: 'a' }], findings: [{ id: 'A1', severity: 'nit', claim: 'c' }],
    });
    expect(bundle).not.toContain("Today's date is");
  });
  test('buildChairPacket prepends the date when given', () => {
    const packet = s2.buildChairPacket({
      reviews: [{ model: 'deepseek', text: 'x' }], rankings: [], adjudications: [],
      tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 }, date: DATE,
    });
    expect(packet).toContain("Today's date is 2026-07-19.");
  });
});
