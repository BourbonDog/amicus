'use strict';

/**
 * @module tests/council/run-stage2-notes
 * The pure Stage-2 note builders, pinned WITHOUT runStage2, launchers or disk.
 *
 * WHY `judgeDeadNote` IS PINNED AGAINST A HAND-WRITTEN RECORD. #257 needed
 * headroom in `run-stage2.js` (298 of the 300-line gate), so #202's judge-death
 * object literal moved out of that file's leg loop into this module. The move is
 * meant to be BEHAVIOUR-FREE, and the only way to prove that is to assert the
 * record against the old inline text typed out by hand rather than against the
 * new function's own output. Verbatim, from `run-stage2.js:252-266` at
 * 61afc84b:
 *
 *     ctx.degrade.note({
 *       channel: 'stage2-judge',
 *       what: `judge ${judge} did not adjudicate`,
 *       why: `its Stage-2 leg ended '${leg.status}'`
 *         + (leg.error ? `: ${collapseExcerpt(leg.error, 200)}` : ''),
 *       effect: `the cross-review was adjudicated by fewer than the ${judges.length} judges the `
 *         + 'bench implies; the run continues and will exit degraded (2)',
 *       data: { judge, seat: seat ? seat.id : null, waveId: `${o.runId}-s2`,
 *         status: leg.status, reason: leg.error || null },
 *     });
 *
 * Note what is NOT there: a `kind`. The record inherits makeDegrade's default
 * ('degrade'), which is what flips `degraded.value` and takes the run to exit 2
 * — so these use `toEqual`, which fails if the extraction quietly grows one.
 *
 * NAMED MUTANT — JUDGEPROMOTEDSILENT / FROMREASONINGDROPPED / CHANNELUNREGISTERED
 * are recorded in tests/council/run-stages.test.js and
 * tests/council/degrade-contract.test.js, where they red.
 */

const {
  judgeDeadNote, promotedJudgeNote, thinCrossReviewWhy,
} = require('../../src/council/run-stage2-notes');

describe('judgeDeadNote — #202’s record, moved verbatim (#257 headroom)', () => {
  // 300 chars: longer than collapseExcerpt's 200-char cap, so the `why` must
  // come back CUT while `data.reason` stays whole (the #219 split).
  const LONG = 'x'.repeat(300);

  test('the dead-leg record is byte-identical to the old inline object literal', () => {
    const note = judgeDeadNote({
      judge: 'gpt',
      seat: { id: 'gpt-1', alias: 'gpt' },
      leg: { status: 'error', error: LONG },
      judgesCount: 4,
      runId: 'abc123',
    });
    expect(note).toEqual({
      channel: 'stage2-judge',
      what: 'judge gpt did not adjudicate',
      // collapseExcerpt(LONG, 200) => the first 199 chars + a one-char ellipsis.
      // Spelled out rather than computed: calling the sanitizer here would make
      // the assertion agree with the implementation by construction.
      why: 'its Stage-2 leg ended \'error\': ' + 'x'.repeat(199) + '…',
      effect: 'the cross-review was adjudicated by fewer than the 4 judges the '
        + 'bench implies; the run continues and will exit degraded (2)',
      data: { judge: 'gpt', seat: 'gpt-1', waveId: 'abc123-s2', status: 'error', reason: LONG },
    });
    // The #219 contract, asserted as a fact rather than inferred from the string
    // above: prose is bounded, the machine surface is not.
    expect(note.why.length).toBe(231);
    expect(note.data.reason).toBe(LONG);
  });

  test('no kind is stamped — the record still defaults to `degrade` (exit 2)', () => {
    const note = judgeDeadNote({
      judge: 'gpt', seat: null, leg: { status: 'timeout' }, judgesCount: 2, runId: 'r1',
    });
    expect(Object.prototype.hasOwnProperty.call(note, 'kind')).toBe(false);
  });

  test('an error-less death drops the colon clause, and an unbound seat is null', () => {
    const note = judgeDeadNote({
      judge: 'qwen', seat: null, leg: { status: 'timeout' }, judgesCount: 2, runId: 'r1',
    });
    expect(note).toEqual({
      channel: 'stage2-judge',
      what: 'judge qwen did not adjudicate',
      why: 'its Stage-2 leg ended \'timeout\'',
      effect: 'the cross-review was adjudicated by fewer than the 2 judges the '
        + 'bench implies; the run continues and will exit degraded (2)',
      data: { judge: 'qwen', seat: null, waveId: 'r1-s2', status: 'timeout', reason: null },
    });
  });
});

/**
 * #257 (spec R4/R11). A judge has NO retry, so a promoted judge leg — one whose
 * engine answer carried no text part and whose reasoning was promoted to output
 * — is parsed exactly as any other. When its fenced block parses, the
 * adjudication is USED and this note says so on its own channel, as kind 'info':
 * nothing was lost, the exit code does not move, and the only fact worth
 * recording is that the deliberation the judge actually wrote was read by nobody.
 *
 * TWO ARMS (ruling R-X13). The spec enumerated "block parses" / "block does not
 * parse" and missed the third path the runtime has: the promoted leg produced NO
 * block and a bounded `-q<N>` repair supplied the parseable one. The note fires
 * there too — a silent success path fails the amicus bar as hard as a crash —
 * so `why` must name the TRUE cause per arm instead of asserting "its fenced
 * block parsed and was used" about a leg whose block never parsed.
 *
 * NAMED MUTANT — REPAIRARMDROPPED: make `why` unconditional in
 * src/council/run-stage2-notes.js (the attempts === 0 wording on both arms).
 * Reds `the REPAIR arm names the repair, not a parse that never happened` below
 * and `#257 (b2)` in tests/council/run-stages.test.js.
 */
describe('promotedJudgeNote — the info note for a judge that answered in reasoning', () => {
  const promotedLeg = (tokens) => ({ status: 'complete', summary: 'judged', promoted: true,
    usage: { tokens } });

  test('the record carries the token split and the seat id', () => {
    expect(promotedJudgeNote('gpt', { id: 'gpt-1', alias: 'gpt' },
      promotedLeg({ reasoning: 1200, output: 0 }))).toEqual({
      kind: 'info',
      channel: 'judge-reasoning-only',
      what: 'judge gpt answered in its reasoning channel',
      why: 'its fenced block parsed and was used; the deliberation itself was read by '
        + 'nobody (1200 reasoning / 0 output tokens)',
      effect: 'the adjudication counts; nothing else changes',
      data: { judge: 'gpt', seat: 'gpt-1', reasoningTokens: 1200, outputTokens: 0 },
    });
  });

  test('attempts defaults to 0, and the parse arm carries NO `repaired` key', () => {
    // emit-when-true: a consumer that reads `data.repaired` must never be
    // reading a `false` this module invented for shape's sake.
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 0 }), 0);
    expect(note.why.startsWith('its fenced block parsed and was used;')).toBe(true);
    expect('repaired' in note.data).toBe(false);
    // The 3-argument call (the pre-R-X13 signature) must behave as attempts 0.
    expect(promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 0 }))).toEqual(note);
  });

  test('the REPAIR arm names the repair, not a parse that never happened', () => {
    expect(promotedJudgeNote('gpt', { id: 'gpt-1', alias: 'gpt' },
      promotedLeg({ reasoning: 90, output: 0 }), 2)).toEqual({
      kind: 'info',
      channel: 'judge-reasoning-only',
      // `what` and `effect` are the SAME on both arms — the judge did answer in
      // its reasoning channel either way, and the adjudication counts either way.
      what: 'judge gpt answered in its reasoning channel',
      why: 'its own answer carried no parseable block; the adjudication used came from '
        + 'the judge repair (attempt 2); the deliberation itself was read by nobody '
        + '(90 reasoning / 0 output tokens)',
      effect: 'the adjudication counts; nothing else changes',
      data: { judge: 'gpt', seat: 'gpt-1', reasoningTokens: 90, outputTokens: 0, repaired: true },
    });
  });

  test('the repair arm reports the attempt it actually took', () => {
    const one = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 7, output: 1 }), 1);
    expect(one.why).toContain('the judge repair (attempt 1)');
    expect(one.data.repaired).toBe(true);
  });

  test('a leg with no usage counts reads zero rather than undefined, and an unbound seat is null', () => {
    const note = promotedJudgeNote('qwen', null, { status: 'complete', promoted: true });
    expect(note.why).toBe('its fenced block parsed and was used; the deliberation itself was '
      + 'read by nobody (0 reasoning / 0 output tokens)');
    expect(note.data).toEqual({ judge: 'qwen', seat: null, reasoningTokens: 0, outputTokens: 0 });
  });

  test('kind is `info` — it must never flip degraded, and so never the exit code', () => {
    expect(promotedJudgeNote('gpt', null, {}).kind).toBe('info');
  });
});

/**
 * #257 spec R4's other half: when a promoted judge's block does NOT parse, the
 * thin-cross-review reason must name the reasoning channel rather than the
 * generic "no parseable Stage-2 block". The two have different fixes — a
 * missing text part is a provider/engine fact, an unparseable block is an
 * output-contract fact — which is the same wrong-cause defect the four existing
 * buckets were split to remove (#202, #251 item 3, council #263 D3/A1).
 */
describe('thinCrossReviewWhy — the fromReasoning bucket', () => {
  const unparseable = { ok: false, died: false, emptyAnswer: false };
  const fromReasoning = { ok: false, died: false, emptyAnswer: false, fromReasoning: true };

  test('a promoted judge with no parseable block gets its OWN clause', () => {
    expect(thinCrossReviewWhy([{ ok: true }, fromReasoning]))
      .toBe('1 answered only in the reasoning channel with no parseable block');
  });

  test('it is NOT also counted as unparseable — the buckets are disjoint', () => {
    expect(thinCrossReviewWhy([{ ok: true }, fromReasoning, fromReasoning]))
      .toBe('2 answered only in the reasoning channel with no parseable block');
    expect(thinCrossReviewWhy([{ ok: true }, unparseable, fromReasoning]))
      .toBe('1 returned no parseable Stage-2 block; '
        + '1 answered only in the reasoning channel with no parseable block');
  });

  test('BYTE-IDENTITY: with no promoted judge the sentence is unchanged', () => {
    // spec R6/R9: `fromReasoning` is ABSENT on every pre-#257 judgeResult (and
    // on every post-#257 one that is not promoted). Absent must read exactly as
    // it did before — this is the same wording the degrade-channels pins hold.
    expect(thinCrossReviewWhy([{ ok: true }, unparseable, unparseable]))
      .toBe('2 returned no parseable Stage-2 block');
  });

  test('a FALSY fromReasoning is not the bucket — only the literal true', () => {
    expect(thinCrossReviewWhy([{ ok: true }, { ...unparseable, fromReasoning: false }]))
      .toBe('1 returned no parseable Stage-2 block');
  });

  test('a judge that DIED is never in this bucket, whatever fromReasoning says', () => {
    // run-stage2.js stamps `!legDied && isPromotedLeg(leg)`, so this shape
    // cannot be produced — pinned anyway so the filter keeps reading `died`.
    expect(thinCrossReviewWhy([{ ok: true }, { ok: false, died: true, fromReasoning: true }]))
      .toBe('1 judge leg died before answering');
  });
});
