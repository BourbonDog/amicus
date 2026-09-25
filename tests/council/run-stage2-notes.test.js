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
 * new function's own output. Verbatim, from `run-stage2.js@61afc84b:252-266`:
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
 * EIGHT ARMS, all pinned byte-exact below — `rescued` × {attempt 1, attempt 2},
 * and not-rescued × the six stand-down states ('relaunch-promoted',
 * 'relaunch-died', 'relaunch-unparseable', 'relaunch-repair-promoted' (R-X49),
 * 'relaunch-unrepaired', 'not-relaunched'), plus R-X36's 'repair-promoted' at the
 * end, whose subject is the REPAIR rather than the judge's own answer. C4 (council round 3) made that
 * cause ONE explicit state set by the caller, in place of the `relaunch` enum
 * this function used to re-derive it from together with `attempts`. `kind` stays
 * 'info' on all of them: a stood-down judge is already counted by
 * thin-cross-review, and this channel has never moved the exit code.
 *
 * NAMED MUTANT — STANDDOWNSILENT is recorded in tests/council/run-stages.test.js,
 * where the call site it removes is driven.
 */
describe('promotedJudgeNote — the note for a judge that answered in reasoning', () => {
  const promotedLeg = (tokens, finish) => ({ status: 'complete', summary: 'judged', promoted: true,
    usage: { tokens }, ...(finish ? { finish } : {}) });
  const SEAT = { id: 'gpt-1', alias: 'gpt' };
  const HEAD = 'its own answer was its deliberation, not a judgement; ';
  const RELAUNCHED = 'relaunched once with the original briefing, and ';
  // R-X44: mirrors promoted.js's tokenSplit — the counts render only when
  // both are reported (integers); otherwise the literal `token usage not
  // reported`, never a fabricated `null reasoning / null output tokens`.
  const unread = (r, o) => `the deliberation itself was read by nobody (${
    Number.isInteger(r) && Number.isInteger(o) ? `${r} reasoning / ${o} output tokens` : 'token usage not reported'
  })`;
  const COUNTS = 'the adjudication counts; nothing else changes';

  // R-X44 (council r4 verification O1): the parenthetical is `tokenSplit(facts)`, so a
  // promoted judge leg that REPORTS a finish carries it — the motivating shape of #257
  // is a `finish 'length'` judge leg. Named mutant "JUDGENOTEFINISHDROPPED": render the
  // counts by hand without the finish clause and this reds.
  test('a promoted judge leg with a reported finish carries the finish clause in `why` (R-X44)', () => {
    const note = promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 32000, output: 1 }, 'length'),
      { attempts: 1, rescued: true });
    expect(note.why).toContain("read by nobody (32000 reasoning / 1 output tokens, finish 'length')");
    expect(note.what).toBe('judge gpt answered in its reasoning channel');
    // No finish reported: byte-identical to the pre-R-X44 parenthetical.
    expect(promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 32000, output: 1 }),
      { attempts: 1, rescued: true }).why).toContain('read by nobody (32000 reasoning / 1 output tokens)');
  });
  const LOST = 'the judge is not counted; the cross-review proceeds with the judges that '
    + 'answered, and thin-cross-review fires below two';

  test('RESCUED by the relaunch itself (attempt 1): the relaunch\'s adjudication is the one used', () => {
    expect(promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 1200, output: 0 }),
      { attempts: 1, rescued: true })).toEqual({
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
      { attempts: 2, rescued: true })).toEqual({
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

  test("STOOD DOWN — 'relaunch-promoted': the relaunch was promoted again", () => {
    expect(promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 1500, output: 0 }),
      { attempts: 1, rescued: false, standDown: 'relaunch-promoted' })).toEqual({
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

  test("STOOD DOWN — 'relaunch-died': the relaunch produced no usable text", () => {
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 700, output: 0 }),
      { attempts: 1, rescued: false, standDown: 'relaunch-died' });
    expect(note.why).toBe(HEAD + RELAUNCHED + 'the relaunch produced no usable text; '
      + unread(700, 0));
    expect(note.effect).toBe(LOST);
    expect(note.data).toEqual({ judge: 'gpt', seat: null, reasoningTokens: 700, outputTokens: 0,
      attempts: 1, relaunched: true });
  });

  test("STOOD DOWN — 'relaunch-unparseable': the relaunch answered for real and its one repair still did not parse", () => {
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 2 }),
      { attempts: 2, rescued: false, standDown: 'relaunch-unparseable' });
    expect(note.why).toBe(HEAD + RELAUNCHED + "the relaunch's answer did not parse after its "
      + 'one repair; ' + unread(5, 2));
    expect(note.effect).toBe(LOST);
    expect(note.data).toEqual({ judge: 'gpt', seat: null, reasoningTokens: 5, outputTokens: 2,
      attempts: 2, relaunched: true });
    // R-X49's DISCRIMINATOR, from the other side: this ending is the one where
    // the repair's own text was real and simply did not parse, so the record
    // carries no `repairPromotedAttempt` at all.
    expect('repairPromotedAttempt' in note.data).toBe(false);
  });

  /**
   * #257 R-X49 (council round 5, C2 — gpt, major, 3-0). THE SEVENTH STAND-DOWN
   * STATE. Chair HQ2: "If a judge's relaunch yields real but unparseable text,
   * and the subsequent repair yields promoted reasoning, the final state is
   * `relaunch-unparseable`. How can an operator tuning prompt budgets distinguish
   * between a model that cannot follow the JSON schema and a model that refused
   * to provide an answer text block entirely?" They cannot — and the two have
   * different fixes, which is the same wrong-cause defect #202, R-X13 and R-X36
   * were each raised to remove. R-X36's arm above cannot be reused for it: that
   * one's opening clause is `its own answer was real`, and this judge's own
   * answer was its deliberation.
   *
   * NAMED MUTANT — SEVENTHARMDROPPED: remove the `'relaunch-repair-promoted'`
   * entry from the stand-down table in run-stage2-notes.js. Reds this test — the
   * `|| 'not relaunched …'` fallback would then misname the ending as one where
   * no relaunch ever ran.
   */
  test("STOOD DOWN — R-X49 'relaunch-repair-promoted': the relaunch answered for real and its one repair answered in ITS reasoning channel", () => {
    const note = promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 32000, output: 1 }),
      { attempts: 2, rescued: false, standDown: 'relaunch-repair-promoted',
        repairPromotedAttempt: 2 });
    expect(note).toEqual({
      kind: 'info',
      channel: 'judge-reasoning-only',
      // `what` does not fork: the judge's OWN answer was still its deliberation.
      what: 'judge gpt answered in its reasoning channel',
      why: HEAD + RELAUNCHED + "the relaunch's answer did not parse and its repair answered "
        + 'in its reasoning channel; ' + unread(32000, 1),
      effect: LOST,
      data: { judge: 'gpt', seat: 'gpt-1', reasoningTokens: 32000, outputTokens: 1,
        attempts: 2, relaunched: true, repairPromotedAttempt: 2 },
    });
    // NOT the 'relaunch-unparseable' sentence — the whole point of the state.
    expect(note.why).not.toContain('did not parse after its one repair');
  });

  test('R-X49: `repairPromotedAttempt` is emit-when-set — every other arm is byte-identical', () => {
    // The field the R-X36 arm already uses, carried onto the promoted-ORIGINAL
    // record for the one ending that has one. A caller that passes none (every
    // other arm, and every pre-R-X49 record) gets a `data` with no such key.
    const unparseable = promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 5, output: 2 }),
      { attempts: 2, rescued: false, standDown: 'relaunch-unparseable' });
    expect('repairPromotedAttempt' in unparseable.data).toBe(false);
    const rescued = promotedJudgeNote('gpt', SEAT, promotedLeg({ reasoning: 90, output: 0 }),
      { attempts: 2, rescued: true });
    expect('repairPromotedAttempt' in rescued.data).toBe(false);
  });

  test("STOOD DOWN — 'relaunch-unrepaired': the ceiling arrived BEFORE the relaunch's repair", () => {
    // Review I1. `ctx.overBudget()` is re-checked between the relaunch and the
    // repair, so this ending is reachable with NO -q2 ever launched — which is
    // why C4 gives it a state of its own rather than reading 'answered' through
    // `attempts`. The sentence must not name a repair that `data.attempts` denies
    // in the same record — the defect class R-X13 was raised to remove.
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 40000, output: 0 }),
      { attempts: 1, rescued: false, standDown: 'relaunch-unrepaired' });
    expect(note.why).toBe(HEAD + RELAUNCHED + "the relaunch's answer did not parse — the cost "
      + 'ceiling was reached before its repair; ' + unread(40000, 0));
    expect(note.why).not.toContain('after its one repair');
    expect(note.effect).toBe(LOST);
    expect(note.data).toEqual({ judge: 'gpt', seat: null, reasoningTokens: 40000, outputTokens: 0,
      attempts: 1, relaunched: true });
  });

  test("STOOD DOWN — 'not-relaunched': the cost ceiling arrived before attempt 1", () => {
    const note = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 11, output: 0 }),
      { attempts: 0, rescued: false, standDown: 'not-relaunched' });
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
      { attempts: 1, rescued: false, standDown: 'relaunch-promoted' });
    expect('rescued' in stoodDown.data).toBe(false);
    const never = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 0 }),
      { attempts: 0, rescued: false, standDown: 'not-relaunched' });
    expect('relaunched' in never.data).toBe(false);
    expect('rescued' in never.data).toBe(false);
    // The old R-X13 key is gone with the arm that minted it.
    expect('repaired' in never.data).toBe(false);
  });

  test('the options object defaults to the never-relaunched arm', () => {
    const bare = promotedJudgeNote('qwen', null, { status: 'complete', promoted: true });
    expect(bare.why).toBe(HEAD + 'not relaunched — the cost ceiling was reached first; '
      + unread(null, null));
    // R-X44: a leg with no usage counts reads null (not reported), never a
    // fabricated 0 — the `data` field is a machine field, so the null rides
    // there directly. An unbound seat is still null, unchanged by R-X32.
    expect(bare.data).toEqual({ judge: 'qwen', seat: null, reasoningTokens: null, outputTokens: null,
      attempts: 0 });
    expect(bare).toEqual(promotedJudgeNote('qwen', null,
      { status: 'complete', promoted: true }, {}));
  });

  test('kind is `info` on both endings — it must never flip degraded, and so never the exit code', () => {
    expect(promotedJudgeNote('gpt', null, {}).kind).toBe('info');
    expect(promotedJudgeNote('gpt', null, {}, { attempts: 1, rescued: true })
      .kind).toBe('info');
  });

  /**
   * #257 R-X36 (council round 3, B1 — gpt, major). THE ONE ARM WHOSE SUBJECT IS
   * THE REPAIR. Every arm above is about a judge whose OWN answer was its
   * deliberation. This one is not: the judge answered for real, unusably, and
   * the ordinary `-q<N>` repair of that answer came back promoted. Before
   * R-X36 that ended in silence — the `-q<N>` ROW said `promoted: true`, the
   * machine record, and the prose said nothing at all.
   *
   * The `what` therefore FORKS, deliberately: a reader who saw the promoted-
   * original sentence here would come away believing the judge's own answer was
   * deliberation, which is the opposite of what happened. The `data` forks too —
   * `reasoningTokens`/`outputTokens` describe a promoted ORIGINAL's leg, and
   * this leg is not one.
   */
  test('STOOD DOWN — R-X36: the judge\'s own answer was real and its repair came back promoted', () => {
    const own = { status: 'complete', summary: 'Judged at length in prose; no trailing JSON.' };
    expect(promotedJudgeNote('gemini', { id: 'gemini', alias: 'gemini' }, own,
      { attempts: 2, rescued: false, standDown: 'repair-promoted', repairPromotedAttempt: 1 }))
      .toEqual({
        kind: 'info',
        channel: 'judge-reasoning-only',
        what: "judge gemini's repair answered in its reasoning channel",
        why: 'its own answer was real but did not parse; repair attempt 1 was written in the '
          + 'reasoning channel and is not a judgement, and the judge ended unusable',
        effect: LOST,
        data: { judge: 'gemini', seat: 'gemini', attempts: 2, repairPromotedAttempt: 1 },
      });
  });

  test('R-X36: the attempt number is the one passed, not `attempts`, and an unbound seat is null', () => {
    const note = promotedJudgeNote('gemini', null, { status: 'complete', summary: 'prose' },
      { attempts: 2, rescued: false, standDown: 'repair-promoted', repairPromotedAttempt: 2 });
    expect(note.why).toContain('repair attempt 2 was written in the reasoning channel');
    expect(note.data).toEqual({ judge: 'gemini', seat: null, attempts: 2, repairPromotedAttempt: 2 });
    // Neither `relaunched` nor `rescued`, and NOT the promoted-original's token
    // counts: the original answered in its output channel, so there is no
    // deliberation of its own to account for.
    expect('relaunched' in note.data).toBe(false);
    expect('reasoningTokens' in note.data).toBe(false);
    expect('outputTokens' in note.data).toBe(false);
  });

  /**
   * C4 (council round 3, contested minor). The cause used to be spread over
   * `relaunch` + `attempts` + a three-conjunct `while` guard, and this function
   * re-derived it. `standDown` is now the one explicit state; `relaunch` is gone
   * and must not be read — a caller still passing it gets the default arm, which
   * is what makes a half-finished rename LOUD rather than silently wrong.
   */
  test('the old `relaunch` option is gone — the note never reads it', () => {
    const viaOld = promotedJudgeNote('gpt', null, promotedLeg({ reasoning: 5, output: 0 }),
      { attempts: 1, rescued: false, relaunch: 'promoted' });
    expect(viaOld.why).toBe(HEAD + 'not relaunched — the cost ceiling was reached first; '
      + unread(5, 0));
    expect('relaunched' in viaOld.data).toBe(false);
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
    // run-stage2-judge.js stamps `!legDied && isPromotedLeg(leg)`, so this shape
    // cannot be produced — pinned anyway so the filter keeps reading `died`.
    expect(thinCrossReviewWhy([{ ok: true }, { ok: false, died: true, fromReasoning: true }]))
      .toBe('1 judge leg died before answering');
  });
});
