// tests/council/briefings-chair-task.test.js
'use strict';

/**
 * v4.9 W7 T-A — the TASK chair surface (#146): the synthesis pair, the ANSWER
 * scale, the concurrence caveat, the repair prompt, and the four forks
 * `buildChairPacket` takes on `intent`. Every review-path assertion here is an
 * ABSENCE pin: spec §4.2 byte identity says a review run's packet and repair
 * prompt must be the same bytes they were before this module existed.
 */

const fs = require('fs');
const path = require('path');
const chair = require('../../src/council/briefings-chair');
const s2 = require('../../src/council/briefings-stage2');
const t = require('../../src/council/briefings-chair-task');

const ARGS = {
  reviews: [{ model: 'deepseek', text: 'DS answer.' }, { model: 'gemini', text: 'G answer.' }],
  rankings: [{ judge: 'deepseek', order: ['gemini', 'deepseek'] }],
  adjudications: [{ findingId: 'A1', judge: 'gemini', verdict: 'agree' }],
  tierCounts: { Confirmed: 1, Contested: 0, Singleton: 1, Disputed: 0 },
  date: '2026-08-25',
};
const CLEAN = { ...ARGS, adjudications: [],
  tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 } };

const taskPacket = (args = ARGS) => chair.buildChairPacket({ ...args, intent: 'task' });

describe('the task synthesis pair frames an ANSWER, never a verdict', () => {
  test('the ordinary instruction names the three moves and the RESIDUAL RISK close', () => {
    expect(t.TASK_CHAIR_SYNTHESIS).toContain('You are the council chair.');
    expect(t.TASK_CHAIR_SYNTHESIS).toContain('Write the synthesized ANSWER across the responses, '
      + 'rankings, and adjudications below');
    expect(t.TASK_CHAIR_SYNTHESIS).toContain('adopt the strongest response, merge complementary '
      + 'ones, or refuse the premise if the bench showed it unsound');
    expect(t.TASK_CHAIR_SYNTHESIS).toContain('close the synthesis with a RESIDUAL RISK section '
      + '— the claims peers disputed that your answer still depends on');
  });

  /**
   * v4.9 fix round 2 (council C3) — the RESIDUAL RISK close must be SATISFIABLE
   * on the bench that actually raised claims but disputed none of them.
   *
   * The no-claims twin below already handles the empty bench by dropping the
   * section outright (LC-10). But the ORDINARY instruction runs on the far more
   * common middle case: claims were raised, adjudicated, and every one of them
   * was concurred. "The claims peers disputed that your answer still depends on"
   * then names the empty set, and the only satisfiable reading of an
   * unfollowable directive is to invent material — the exact LC-10 failure, one
   * bench-shape over.
   *
   * The fix is an escape hatch, not a second instruction: the template names the
   * honest single line for that case. Named mutant RESIDUALNOOUT: delete the
   * escape-hatch clause. RED SET: this pin.
   */
  test('the RESIDUAL RISK close names the honest line for a bench that disputed nothing', () => {
    expect(t.TASK_CHAIR_SYNTHESIS).toContain(
      "RESIDUAL RISK: none — no load-bearing claim was disputed.");
    // The escape hatch is offered as an alternative to the section, not as a
    // separate demand: it has to sit inside the same sentence as the close.
    const close = t.TASK_CHAIR_SYNTHESIS.slice(t.TASK_CHAIR_SYNTHESIS.indexOf('RESIDUAL RISK section'));
    expect(close).toMatch(/or the single line/);
    expect(close).toMatch(/when that is the truth/);
  });

  test('the escape hatch does not smuggle the review scale into a task instruction', () => {
    // The task packet pins `not.toContain('VERDICT')` wholesale; keep the
    // softening on the ANSWER side of that line.
    expect(t.TASK_CHAIR_SYNTHESIS).not.toContain('VERDICT');
  });

  test('it never speaks in reviews or findings', () => {
    expect(t.TASK_CHAIR_SYNTHESIS).not.toMatch(/review/i);
    expect(t.TASK_CHAIR_SYNTHESIS).not.toMatch(/finding/i);
  });

  /**
   * The LC-10-shaped twin. CHAIR_TASK_NO_FINDINGS exists because the ordinary
   * instruction asks for a distinction that CANNOT exist on a clean bench, and
   * the only satisfiable reading of an unfollowable directive is to invent
   * material. The task twin carries that lesson twice over: it drops the
   * adjudications clause AND the RESIDUAL RISK close, because "the claims peers
   * disputed" is precisely the set the bench just declared empty.
   */
  test('the no-claims twin states the empty outcome as valid and asks for no disputes', () => {
    expect(t.TASK_CHAIR_SYNTHESIS_NO_CLAIMS).toContain('this bench declared NO adjudicable claims');
    expect(t.TASK_CHAIR_SYNTHESIS_NO_CLAIMS).toMatch(/valid outcome — not a failed run/);
    expect(t.TASK_CHAIR_SYNTHESIS_NO_CLAIMS).toMatch(/do not manufacture disputes/);
  });

  test('the no-claims twin never asks for a section over material that cannot exist', () => {
    expect(t.TASK_CHAIR_SYNTHESIS_NO_CLAIMS).not.toContain('RESIDUAL RISK');
    expect(t.TASK_CHAIR_SYNTHESIS_NO_CLAIMS).not.toContain('adjudications below');
  });

  test('the concurrence caveat says agreement is not verification', () => {
    expect(t.TASK_CONCURRENCE_CAVEAT).toBe('Peer agreement on a claim is CONCURRENCE, not '
      + 'verification — models correlate on priors. Weigh adjudications accordingly.');
  });
});

describe('ANSWER_SCALE_ADDENDUM mirrors the verdict scale, phrase-for-phrase', () => {
  test('the HARD QUESTIONS half is the review addendum\'s, verbatim', () => {
    // Lines 0..6 of VERDICT_SCALE_ADDENDUM — the two-closing-sections framing,
    // the whole HARD QUESTIONS item, and the "final line, alone" rule — are
    // scale-independent and must never fork (ruling V11: one vocabulary).
    const shared = chair.VERDICT_SCALE_ADDENDUM.split('\n').slice(0, 7).join('\n');
    expect(shared).toContain('HARD QUESTIONS');
    expect(t.ANSWER_SCALE_ADDENDUM.startsWith(shared)).toBe(true);
  });

  test('the three ANSWER phrases each stand alone on their own line', () => {
    for (const a of t.CHAIR_ANSWER_VALUES) {
      expect(t.ANSWER_SCALE_ADDENDUM.split('\n')).toContain(`   ANSWER: ${a}`);
    }
  });

  test('each phrase is glossed, and the gloss stays off the ANSWER line', () => {
    expect(t.ANSWER_SCALE_ADDENDUM).toContain('"Converged" = the bench substantially agrees');
    expect(t.ANSWER_SCALE_ADDENDUM).toContain('"Split" = material disagreement');
    expect(t.ANSWER_SCALE_ADDENDUM).toContain('"Insufficient" = the bench\'s work cannot');
    expect(t.ANSWER_SCALE_ADDENDUM).toContain('in the synthesis ABOVE, not on the ANSWER line');
  });

  test('it never offers a VERDICT line', () => {
    expect(t.ANSWER_SCALE_ADDENDUM).not.toContain('VERDICT');
  });
});

describe('buildChairPacket forks on intent — and ONLY on the four documented seams', () => {
  test('the no-tools preamble ends with the answer, not the verdict', () => {
    expect(taskPacket().split('\n')[0]).toBe(
      'Do NOT use any tools or read any files; everything is in this message; ' +
      'begin immediately with the answer.'
    );
  });

  test('the task packet carries the ANSWER scale and no VERDICT contract at all', () => {
    const p = taskPacket();
    expect(p).toContain(t.ANSWER_SCALE_ADDENDUM);
    expect(p).not.toContain('VERDICT');
    expect(p).not.toContain(chair.VERDICT_SCALE_ADDENDUM);
  });

  test('the task packet asks for the RESIDUAL RISK close', () => {
    expect(taskPacket()).toContain('RESIDUAL RISK');
  });

  test('the concurrence caveat is pushed for a task run only', () => {
    expect(taskPacket()).toContain(t.TASK_CONCURRENCE_CAVEAT);
    expect(chair.buildChairPacket(ARGS)).not.toContain(t.TASK_CONCURRENCE_CAVEAT);
  });

  test('the caveat sits AFTER the adjudications it qualifies and BEFORE the scale', () => {
    const p = taskPacket();
    expect(p.indexOf(t.TASK_CONCURRENCE_CAVEAT))
      .toBeGreaterThan(p.indexOf('--- PER-FINDING ADJUDICATIONS ---'));
    expect(p.indexOf(t.TASK_CONCURRENCE_CAVEAT))
      .toBeLessThan(p.indexOf(t.ANSWER_SCALE_ADDENDUM));
  });

  test('the R8 same-model section still renders in task mode, ahead of the caveat', () => {
    const p = chair.buildChairPacket({ ...ARGS, intent: 'task',
      findings: [{ id: 'A1', sameModelCorroboration: true }] });
    expect(p).toContain('--- SAME-MODEL CORROBORATION (R8) ---');
    expect(p.indexOf('--- SAME-MODEL CORROBORATION (R8) ---'))
      .toBeLessThan(p.indexOf(t.TASK_CONCURRENCE_CAVEAT));
  });

  test('a clean task bench swaps in the no-claims twin, exactly as review mode swaps', () => {
    const p = taskPacket(CLEAN);
    expect(p).toContain(t.TASK_CHAIR_SYNTHESIS_NO_CLAIMS);
    expect(p).not.toContain(t.TASK_CHAIR_SYNTHESIS);
    expect(p).not.toContain(chair.CHAIR_TASK_NO_FINDINGS);
    // …and the empty-section wording is the SHARED one (V11), not a task twin.
    expect(p).toContain('(none — the bench raised no findings, so there was nothing to adjudicate)');
  });

  /**
   * Ruling V11, and the extension this task records: the SECTION HEADERS and
   * the `Review by` / `Review <letter>` labels are one vocabulary across both
   * intents — a task run's packet is structurally the review packet with a
   * different instruction, scale and caveat. Nothing downstream re-parses
   * these headers, but the chair reads both intents' packets with one habit.
   */
  test('every section header and review label is shared with the review packet', () => {
    const p = taskPacket();
    for (const header of ['Deterministic tier counts (peers-only cascade):',
      '--- STAGE-1 REVIEWS (de-anonymized) ---',
      '--- PEER RANKINGS (judge: order, best first) ---',
      '--- PER-FINDING ADJUDICATIONS ---',
      '--- Review by deepseek ---']) {
      expect(p).toContain(header);
      expect(chair.buildChairPacket(ARGS)).toContain(header);
    }
  });

  test('the ranking and adjudication rows render identically in both intents', () => {
    expect(taskPacket()).toContain('deepseek: ["gemini","deepseek"]');
    expect(taskPacket()).toContain('A1 — gemini: agree');
  });
});

describe('review-run byte identity (absence pins)', () => {
  test('an absent intent is byte-identical to the pre-W7 packet call', () => {
    expect(chair.buildChairPacket({ ...ARGS, intent: undefined }))
      .toBe(chair.buildChairPacket(ARGS));
  });

  test("any other intent value composes the REVIEW packet (fail-closed)", () => {
    expect(chair.buildChairPacket({ ...ARGS, intent: 'review' }))
      .toBe(chair.buildChairPacket(ARGS));
    expect(chair.buildChairPacket({ ...ARGS, intent: 'TASK' }))
      .toBe(chair.buildChairPacket(ARGS));
  });

  test('the review packet still opens with the verdict preamble and the verdict scale', () => {
    const p = chair.buildChairPacket(ARGS);
    expect(p.split('\n')[0]).toBe(
      'Do NOT use any tools or read any files; everything is in this message; ' +
      'begin immediately with the verdict.'
    );
    expect(p).toContain(chair.VERDICT_SCALE_ADDENDUM);
    expect(p).toContain(chair.CHAIR_TASK);
  });

  test('a clean REVIEW bench is untouched by the task pair', () => {
    const p = chair.buildChairPacket(CLEAN);
    expect(p).toContain(chair.CHAIR_TASK_NO_FINDINGS);
    expect(p).not.toContain(t.TASK_CHAIR_SYNTHESIS_NO_CLAIMS);
  });
});

describe('buildTaskChairRepairPrompt mirrors the review repair prompt (LC-12 carries)', () => {
  const synthesis = 'The bench converged on the three-tier migration.';

  test('the synthesis rides along, labelled as the chair\'s own', () => {
    const p = t.buildTaskChairRepairPrompt({ synthesis });
    expect(p).toContain(synthesis);
    expect(p).toContain('--- YOUR SYNTHESIS (verbatim — answer on THIS) ---');
    expect(p).toContain('--- END OF YOUR SYNTHESIS ---');
  });

  test('it opens on the ANSWER line and closes with the three phrases', () => {
    const p = t.buildTaskChairRepairPrompt({ synthesis });
    expect(p.startsWith('Do NOT use any tools or read any files; everything is in this '
      + 'message; begin immediately with the ANSWER line.')).toBe(true);
    expect(p.endsWith('ANSWER: Converged\n\nANSWER: Split\n\nANSWER: Insufficient')).toBe(true);
    expect(p).not.toContain('VERDICT');
  });

  test('no synthesis at all: the block is omitted, never rendered empty', () => {
    const p = t.buildTaskChairRepairPrompt({});
    expect(p).not.toContain('YOUR SYNTHESIS');
    expect(p).toContain('Your synthesis was received, but the final parseable line was missing.');
    expect(t.buildTaskChairRepairPrompt()).toBe(p);   // no args at all, same prompt
  });

  test('the synthesis is never truncated, however long', () => {
    const long = 'x'.repeat(40000);
    expect(t.buildTaskChairRepairPrompt({ synthesis: long })).toContain(long);
  });

  test('the module constant is the parser\'s list, so a task chair is asked for '
    + 'exactly what parseChairAnswer can read', () => {
    const { CHAIR_ANSWERS, parseChairAnswer } = require('../../src/council/parse-stage2');
    expect(t.CHAIR_ANSWER_VALUES).toEqual(CHAIR_ANSWERS);
    for (const a of t.CHAIR_ANSWER_VALUES) {
      expect(parseChairAnswer(`ANSWER: ${a}`)).toBe(a);
    }
  });
});

describe('chairRepairPromptFor dispatcher (the W6 shape)', () => {
  const args = { synthesis: 'S.' };

  test('intent undefined → byte-identical to the review builder', () => {
    expect(s2.chairRepairPromptFor(undefined, args)).toBe(chair.buildChairRepairPrompt(args));
    expect(s2.chairRepairPromptFor(undefined)).toBe(chair.buildChairRepairPrompt());
  });

  test("intent 'task' → byte-identical to the task builder", () => {
    expect(s2.chairRepairPromptFor('task', args)).toBe(t.buildTaskChairRepairPrompt(args));
  });

  test('any other intent value falls back to the review prompt (fail-closed)', () => {
    expect(s2.chairRepairPromptFor('review', args)).toBe(chair.buildChairRepairPrompt(args));
  });

  test('briefings-chair.js never top-requires briefings-chair-task (load-acyclic)', () => {
    // Same discipline as the W6 dispatchers: the task module is required AT CALL
    // TIME so the chair surface can never deadlock into a half-initialized module
    // object if the task twins ever need a shared fragment back.
    // ⚠️ Anchored at column 0 — that is what "top-level" actually means. The W6
    // spelling trimmed each line first, which reads an INDENTED call-time
    // require as top-level. MEASURED (v4.9 fix round 2, council C4): both
    // spellings catch the real defect — a genuine column-0 `const … require` —
    // so the trimming variant is not blind, it is OVER-eager: it counts a
    // legitimate lazy require written in `const` form and REDS on correct code.
    // This pin needs the strict spelling to exist at all, because
    // `briefings-chair.js` lazy-requires exactly that way
    // (`  const task = intent === 'task' ? require('./briefings-chair-task') : null;`)
    // — under the trimming variant this test fails at HEAD. Fix round 2 brought
    // briefings-task.test.js and briefings-stage2-task.test.js onto this
    // spelling too, so all three now read identically; copy a fourth from any.
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'council', 'briefings-chair.js'), 'utf-8');
    const topLevelRequires = src.split('\n')
      .filter(l => /^(const|let|var)\s.*require\(/.test(l));
    expect(topLevelRequires.filter(l => l.includes('briefings-chair-task'))).toHaveLength(0);
    expect(topLevelRequires.length).toBeGreaterThan(0);   // the heuristic still finds ./seats
  });

  test('either load order composes the same packet (no half-initialized module)', () => {
    const build = (first, second) => {
      jest.resetModules();
      require(first);
      return require(second).buildChairPacket
        ? require('../../src/council/briefings-chair').buildChairPacket({ ...ARGS, intent: 'task' })
        : null;
    };
    const taskFirst = build('../../src/council/briefings-chair-task',
      '../../src/council/briefings-chair');
    const chairFirst = build('../../src/council/briefings-chair',
      '../../src/council/briefings-chair');
    expect(taskFirst).toBe(chairFirst);
    expect(taskFirst).toContain('ANSWER: Converged');
    jest.resetModules();
  });
});
