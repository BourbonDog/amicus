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

// v4.9 W7 T-C (ruling V2) — the debate twins. `intent` rides on each builder's
// args object: 'task' composes the task frame, ANYTHING ELSE (absent included)
// composes the review frame byte-identically (fail-closed, the same shape as
// briefings.js's Stage-1 dispatchers).
//
// The four frame texts below are LITERALS, never imports: a pin that reads the
// constant it is pinning cannot notice that constant changing. Both directions
// are pinned — the task frame present under 'task' AND absent under review, the
// review frame present under review AND absent under 'task'.
//
// ⚠️ PR #200 round-3 finding C4: the two TASK frames were written fresh and
// dropped the review frames' CALIBRATION INCENTIVES — the sentences that tell a
// raiser an unsupported repeat is weaker than a withdrawal, and a judge that
// changing a verdict is good judging. Those are not review-specific: they are
// what stop a task debate from rewarding stubbornness on both sides. Restored
// as claim-worded twins (the defense one swaps "anything" for "any claim"; the
// re-vote one is mode-neutral and is reused VERBATIM), pinned by the exact-text
// assemblies below. Named mutant DEBATEINCENTIVEDROP: delete the trailing
// sentence from either task frame in src/council/briefings-debate.js.
const REVIEW_DEFENSE_FRAME =
  'You reviewed an artifact and raised the findings below. Peer reviewers ' +
  '(anonymous) disputed them for the stated reasons. For EACH finding decide: ' +
  'DEFEND it with evidence, AMEND it with corrected replacement text, or WITHDRAW ' +
  'it. Withdraw anything you cannot defend with evidence — an unsupported repeat ' +
  'of the original claim is weaker than a withdrawal.';
const TASK_DEFENSE_FRAME =
  'You produced an answer and declared the claims below as load-bearing. Peer ' +
  'analysts (anonymous) disputed them. For each claim: defend it with your ' +
  'strongest argument, amend it if the dispute exposed a real flaw, or withdraw it. ' +
  'Withdraw any claim you cannot defend with evidence — an unsupported repeat ' +
  'of the original claim is weaker than a withdrawal.';
const REVIEW_REVOTE_FRAME =
  'You previously adjudicated findings on this artifact and disputed at least ' +
  'one of those below. The (anonymous) raiser has now responded. Re-adjudicate ' +
  'ONLY the findings listed, in light of each response. Changing your verdict ' +
  'when the defense is convincing is good judging, not weakness; so is holding ' +
  'your dispute when it isn\'t.';
const TASK_REVOTE_FRAME =
  'You previously adjudicated claims from this bench\'s answers and disputed at ' +
  'least one of those below. The raiser has now responded. Re-vote each claim: ' +
  'agree / dispute / neutral. Changing your verdict ' +
  'when the defense is convincing is good judging, not weakness; so is holding ' +
  'your dispute when it isn\'t.';

describe('debate task twins (v4.9 W7 T-C, ruling V2)', () => {
  const DEF_FINDINGS = [
    { id: 'A1', claim: 'The retry loop is infinite.', severity: 'major',
      peerVerdicts: ['dispute', 'dispute', 'agree'],
      disputeReasons: ['the backoff caps at 5 attempts'] },
  ];
  const RV_FINDINGS = [
    { id: 'A1', claim: 'Corrected claim.', severity: 'major', amended: true,
      argument: 'narrowed to the retry path' },
  ];
  // The rendered finding blocks, spelled out: V11 says the block renderers are
  // ONE vocabulary across both intents, so the same literal has to appear in the
  // task assembly and the review assembly below.
  const DEF_BLOCK = [
    '- A1 [major]: The retry loop is infinite.',
    '  Peer verdicts (anonymized): 2 dispute, 1 agree, 0 neutral.',
    '  Peers disputed it for:',
    '    - the backoff caps at 5 attempts',
  ].join('\n');
  const RV_BLOCK = [
    '- A1 [major] **AMENDED**: Corrected claim.',
    '  Raiser\'s response: narrowed to the retry path',
  ].join('\n');
  const DATED = `Today's date is ${DATE}.`;

  test('REVIEW defense brief (intent absent) is byte-identical to the pre-W7 assembly', () => {
    expect(d.buildDefenseBrief({ findings: DEF_FINDINGS, date: DATE })).toBe(
      [d.DEBATE_NO_TOOLS_PREAMBLE, DATED, REVIEW_DEFENSE_FRAME, DEF_BLOCK,
        d.DEFENSE_CONTRACT].join('\n\n'));
  });

  test('TASK defense brief swaps ONLY the frame — same preamble, date, block, contract', () => {
    expect(d.buildDefenseBrief({ findings: DEF_FINDINGS, date: DATE, intent: 'task' })).toBe(
      [d.DEBATE_NO_TOOLS_PREAMBLE, DATED, TASK_DEFENSE_FRAME, DEF_BLOCK,
        d.DEFENSE_CONTRACT].join('\n\n'));
  });

  test('REVIEW re-vote bundle (intent absent) is byte-identical to the pre-W7 assembly', () => {
    expect(d.buildRevoteBundle({ findings: RV_FINDINGS, date: DATE })).toBe(
      [d.DEBATE_NO_TOOLS_PREAMBLE, DATED, REVIEW_REVOTE_FRAME, RV_BLOCK,
        d.REVOTE_CONTRACT].join('\n\n'));
  });

  test('TASK re-vote bundle swaps ONLY the frame — same preamble, date, block, contract', () => {
    expect(d.buildRevoteBundle({ findings: RV_FINDINGS, date: DATE, intent: 'task' })).toBe(
      [d.DEBATE_NO_TOOLS_PREAMBLE, DATED, TASK_REVOTE_FRAME, RV_BLOCK,
        d.REVOTE_CONTRACT].join('\n\n'));
  });

  test('the frames are disjoint in BOTH directions, on both builders', () => {
    const dTask = d.buildDefenseBrief({ findings: DEF_FINDINGS, date: DATE, intent: 'task' });
    const dRev = d.buildDefenseBrief({ findings: DEF_FINDINGS, date: DATE });
    expect(dTask).not.toContain('You reviewed an artifact');
    expect(dRev).not.toContain('You produced an answer');
    const rTask = d.buildRevoteBundle({ findings: RV_FINDINGS, date: DATE, intent: 'task' });
    const rRev = d.buildRevoteBundle({ findings: RV_FINDINGS, date: DATE });
    expect(rTask).not.toContain('adjudicated findings on this artifact');
    expect(rRev).not.toContain('adjudicated claims from this bench');
  });

  test('anything that is not the exact string \'task\' composes the review brief', () => {
    const dRev = d.buildDefenseBrief({ findings: DEF_FINDINGS, date: DATE });
    const rRev = d.buildRevoteBundle({ findings: RV_FINDINGS, date: DATE });
    for (const intent of [undefined, null, '', 'review', 'Task', 'TASK', 'tasks', 0, true]) {
      expect(d.buildDefenseBrief({ findings: DEF_FINDINGS, date: DATE, intent })).toBe(dRev);
      expect(d.buildRevoteBundle({ findings: RV_FINDINGS, date: DATE, intent })).toBe(rRev);
    }
  });

  test('a dateless brief still forks on intent (the date line is optional, the frame is not)', () => {
    const dTask = d.buildDefenseBrief({ findings: DEF_FINDINGS, intent: 'task' });
    expect(dTask).not.toContain('Today\'s date is');
    expect(dTask).toContain(TASK_DEFENSE_FRAME);
    const rTask = d.buildRevoteBundle({ findings: RV_FINDINGS, intent: 'task' });
    expect(rTask).not.toContain('Today\'s date is');
    expect(rTask).toContain(TASK_REVOTE_FRAME);
  });

  // The plan's "repair prompts ride the shared repair() — verify, don't fork".
  // Both repair builders carry the CONTRACT and no frame at all, so there is
  // nothing intent-shaped in them to fork; this pin reds if one ever grows a frame.
  test('repair prompts ride the shared repair() — frame-neutral in both intents', () => {
    const errors = [{ code: 'BAD_RESPONSES', detail: 'responses must be an array' }];
    const def = d.buildDefenseRepairPrompt({ errors, defense: 'prior text' });
    const rv = d.buildRevoteRepairPrompt({ errors, revote: 'prior text' });
    for (const t of [def, rv]) {
      expect(t).not.toContain('You reviewed an artifact');
      expect(t).not.toContain('You produced an answer');
      expect(t).not.toContain('You previously adjudicated');
    }
    expect(def).toContain(d.DEFENSE_CONTRACT);
    expect(rv).toContain(d.REVOTE_CONTRACT);
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
