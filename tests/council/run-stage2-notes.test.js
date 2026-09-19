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
 * #257 R-X32 (owner decision A′). A promoted judge leg — one whose engine answer
 * carried no text part, so its reasoning was promoted to output — is never used
 * as it stands. It is RELAUNCHED once with the original bundle briefing; a
 * relaunch with real but unparseable text gets the one remaining repair; a
 * relaunch that is promoted again, or dies, stands the judge down. This note is
 * how each of those endings is said out loud, and it fires on EVERY one of them:
 * a silent path fails the amicus bar as hard as a crash.
 *
 * SIX ARMS, all pinned byte-exact below — `rescued` × {attempt 1, attempt 2},
 * and not-rescued × the four `relaunch` outcomes ('promoted', 'died',
 * 'answered', null = never relaunched, the cost ceiling arrived first). `kind`
 * stays 'info' on all six: a stood-down judge is already counted by
 * thin-cross-review, and this channel has never moved the exit code.
 *
 * NAMED MUTANT — STANDDOWNSILENT is recorded in tests/council/run-stages.test.js,
 * where the call site it removes is driven.
 */
describe('promotedJudgeNote — the note for a judge that answered in reasoning', () => {
  const promotedLeg = (tokens) => ({ status: 'complete', summary: 'judged', promoted: true,
    usage: { tokens } });
  const SEAT = { id: 'gpt-1', alias: 'gpt' };
  const HEAD = 'its own answer was its deliberation, not a judgement; ';
  const RELAUNCHED = 'relaunched once with the original briefing, and ';
  const unread = (r, o) => `the deliberation itself was read by nobody (${r} reasoning / ${o} output tokens)`;
  const COUNTS = 'the adjudication counts; nothing else changes';
  const LOST = 'the judge is not counted; the cross-review proceeds with the judges that '
    + 'answered, and thin-cross-review fires below two';

  test('RESCUED by the relaunch itself (attempt 1): the relaunch\'s adjudication is the one used', () => {
    expect(promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 1200, output: 0 }),
      { attempts: 1, rescued: true, relaunch: 'answered' })).toEqual({
      kind: 'info',
      channel: 'judge-reasoning-only',
      what: 'judge gpt answered in its reasoning channel',
      why: HEAD + RELAUNCHED + "that relaunch's adjudication is the one used; " + unread(1200, 0),
      effect: COUNTS,
      data: { judge: 'gpt', seat: 'gpt-1', reasoningTokens: 1200, outputTokens: 0,
        attempts: 1, relaunched: true, rescued: true },
    });
  });

  test('RESCUED by the relaunch\'s one repair (attempt 2): the note names the repair', () => {
    expect(promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 90, output: 0 }),
      { attempts: 2, rescued: true, relaunch: 'answered' })).toEqual({
      kind: 'info',
      channel: 'judge-reasoning-only',
      // `what` does not fork — the judge did answer in its reasoning channel
      // whichever ending followed.
      what: 'judge gpt answered in its reasoning channel',
      why: HEAD + RELAUNCHED + "the relaunch's answer needed one repair — the adjudication "
        + 'used came from that repair (attempt 2); ' + unread(90, 0),
      effect: COUNTS,
      data: { judge: 'gpt', seat: 'gpt-1', reasoningTokens: 90, outputTokens: 0,
        attempts: 2, relaunched: true, rescued: true },
    });
  });

  test('STOOD DOWN — the relaunch was promoted again', () => {
    expect(promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 1500, output: 0 }),
      { attempts: 1, rescued: false, relaunch: 'promoted' })).toEqual({
      kind: 'info',
      channel: 'judge-reasoning-only',
      what: 'judge gpt answered in its reasoning channel',
      why: HEAD + RELAUNCHED + 'the relaunch answered in its reasoning channel again; '
        + unread(1500, 0),
      effect: LOST,
      data: { judge: 'gpt', seat: 'gpt-1', reasoningTokens: 1500, outputTokens: 0,
        attempts: 1, relaunched: true },
    });
  });

  test('STOOD DOWN — the relaunch died', () => {
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 700, output: 0 }),
      { attempts: 1, rescued: false, relaunch: 'died' });
    expect(note.why).toBe(HEAD + RELAUNCHED + 'the relaunch produced no usable text; '
      + unread(700, 0));
    expect(note.effect).toBe(LOST);
    expect(note.data).toEqual({ judge: 'gpt', seat: null, reasoningTokens: 700, outputTokens: 0,
      attempts: 1, relaunched: true });
  });

  test('STOOD DOWN — the relaunch answered for real and its one repair still did not parse', () => {
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 2 }),
      { attempts: 2, rescued: false, relaunch: 'answered' });
    expect(note.why).toBe(HEAD + RELAUNCHED + "the relaunch's answer did not parse after its "
      + 'one repair; ' + unread(5, 2));
    expect(note.effect).toBe(LOST);
    expect(note.data).toEqual({ judge: 'gpt', seat: null, reasoningTokens: 5, outputTokens: 2,
      attempts: 2, relaunched: true });
  });

  test('STOOD DOWN — the relaunch answered for real and the ceiling arrived BEFORE its repair', () => {
    // Review I1. `ctx.overBudget()` is re-checked between the relaunch and the
    // repair, so `relaunch: 'answered'` with `attempts: 1` is reachable and NO
    // -q2 ever launched. The sentence must not name a repair that `data.attempts`
    // denies in the same record — the defect class R-X13 was raised to remove.
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 40000, output: 0 }),
      { attempts: 1, rescued: false, relaunch: 'answered' });
    expect(note.why).toBe(HEAD + RELAUNCHED + "the relaunch's answer did not parse — the cost "
      + 'ceiling was reached before its repair; ' + unread(40000, 0));
    expect(note.why).not.toContain('after its one repair');
    expect(note.effect).toBe(LOST);
    expect(note.data).toEqual({ judge: 'gpt', seat: null, reasoningTokens: 40000, outputTokens: 0,
      attempts: 1, relaunched: true });
  });

  test('STOOD DOWN — never relaunched at all, because the cost ceiling arrived first', () => {
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 11, output: 0 }),
      { attempts: 0, rescued: false, relaunch: null });
    expect(note.why).toBe(HEAD + 'not relaunched — the cost ceiling was reached first; '
      + unread(11, 0));
    expect(note.effect).toBe(LOST);
    // No `relaunched` key: emit-when-true, so a consumer reading it is never
    // reading a guess about a solo that never launched.
    expect(note.data).toEqual({ judge: 'gpt', seat: null, reasoningTokens: 11, outputTokens: 0,
      attempts: 0 });
  });

  test('`rescued` and `relaunched` are emit-when-true — absent, never false', () => {
    const stoodDown = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 0 }),
      { attempts: 1, rescued: false, relaunch: 'promoted' });
    expect('rescued' in stoodDown.data).toBe(false);
    const never = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 0 }),
      { attempts: 0, rescued: false, relaunch: null });
    expect('relaunched' in never.data).toBe(false);
    expect('rescued' in never.data).toBe(false);
    // The old R-X13 key is gone with the arm that minted it.
    expect('repaired' in never.data).toBe(false);
  });

  test('the options object defaults to the never-relaunched arm', () => {
    const bare = promotedJudgeNote('qwen', null, { status: 'complete', promoted: true });
    expect(bare.why).toBe(HEAD + 'not relaunched — the cost ceiling was reached first; '
      + unread(0, 0));
    expect(bare.data).toEqual({ judge: 'qwen', seat: null, reasoningTokens: 0, outputTokens: 0,
      attempts: 0 });
    // A leg with no usage counts reads zero rather than undefined, and an
    // unbound seat is null — both unchanged by R-X32.
    expect(bare).toEqual(promotedJudgeNote('qwen', null,
      { status: 'complete', promoted: true }, {}));
  });

  test('kind is `info` on both endings — it must never flip degraded, and so never the exit code', () => {
    expect(promotedJudgeNote('gpt', null, {}).kind).toBe('info');
    expect(promotedJudgeNote('gpt', null, {}, { attempts: 1, rescued: true, relaunch: 'answered' })
      .kind).toBe('info');
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

  // Review M1: 'and was not rescued' — a stood-down promoted judge's relaunch
  // may have answered in the OUTPUT channel unparseably, so the old 'with no
  // parseable block' tail was false for one of the four stand-down causes.
  test('a promoted judge that was not rescued gets its OWN clause', () => {
    expect(thinCrossReviewWhy([{ ok: true }, fromReasoning]))
      .toBe('1 answered only in the reasoning channel and was not rescued');
  });

  test('it is NOT also counted as unparseable — the buckets are disjoint', () => {
    expect(thinCrossReviewWhy([{ ok: true }, fromReasoning, fromReasoning]))
      .toBe('2 answered only in the reasoning channel and was not rescued');
    expect(thinCrossReviewWhy([{ ok: true }, unparseable, fromReasoning]))
      .toBe('1 returned no parseable Stage-2 block; '
        + '1 answered only in the reasoning channel and was not rescued');
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
