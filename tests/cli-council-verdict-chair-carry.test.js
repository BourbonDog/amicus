// tests/cli-council-verdict-chair-carry.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleCouncil } = require('../src/cli-handlers-council');

/**
 * Dogfood defect: SKILL.md Stage 5 tells the user to REPLACE the engine's
 * verdict.json with `amicus council verdict <run>/tally.json --decisions … -o
 * <run>/verdict.json --render`. The chair's synthesis (`overallVerdict`) lives
 * ONLY in that file and in chair-output.md — tally.json and run.json carry no
 * copy — so a `buildVerdict(record, decisions)` call that omits the third
 * `opts` argument silently nulls the single most valuable output of the run.
 *
 * These pins fix the contract: the Stage-5 replacement CARRIES the chair's
 * verdict forward from the run folder, and a chair that never produced one
 * stays null (nothing is ever invented).
 */

function tallyDoc(runId = 'run-1') {
  return {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId, runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt'], claudeInCouncil: false },
    findings: [{
      id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Confirmed',
      basis: { a: 2, d: 0, n: 0 }, confidence: 'solid', tierOverride: null, adjudications: [],
    }],
    rankings: [], streetCred: [], runStats: [],
    tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 }, judged: true,
  };
}

/** A run folder seeded with the named artifacts (objects are JSON-stringified). */
function runFolder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chair-carry-'));
  for (const name of Object.keys(files)) {
    const body = files[name];
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

/** The exact Stage-5 command SKILL.md prescribes. */
async function stage5(dir, outPath) {
  const out = outPath || path.join(dir, 'verdict.json');
  const code = await handleCouncil({ _: ['council', 'verdict', path.join(dir, 'tally.json')], out, render: true });
  expect(code).toBe(0);
  return JSON.parse(fs.readFileSync(out, 'utf-8'));
}

describe("council verdict preserves the chair's verdict across the Stage-5 replacement", () => {
  test("the engine's verdict.json overallVerdict survives being overwritten", async () => {
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: 'Fix these first' },
      'chair-output.md': 'chair prose\n\nVERDICT: Fix these first — two blocking gaps\n',
    });
    expect((await stage5(dir)).overallVerdict).toBe('Fix these first');
  });

  test('falls back to chair-output.md when no prior verdict.json exists, using the engine\'s own parser', async () => {
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'chair-output.md': 'chair prose\n\nVERDICT: Ship it\n',
    });
    expect((await stage5(dir)).overallVerdict).toBe('Ship it');
  });

  test('a skipped chair stays null — no prior verdict line, no chair-output.md', async () => {
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: null },
    });
    expect((await stage5(dir)).overallVerdict).toBeNull();
  });

  test('an unstructured chair (no canonical VERDICT line) stays null — nothing is invented', async () => {
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'chair-output.md': 'the chair rambled and never emitted a verdict line\n',
    });
    expect((await stage5(dir)).overallVerdict).toBeNull();
  });

  // v4.9 W7 fix round (review MEDIUM F2). The fallback re-parsed chair-output.md
  // with parseChairVerdict ALONE, so a task run — whose chair closes on an
  // `ANSWER:` line, never a `VERDICT:` one — recovered null and the Stage-5
  // rebuild destroyed the single most valuable output of the run, exactly the
  // defect these pins exist to prevent, on the newer of the two scales.
  //
  // ⚠️ FIX ROUND 2 (council B1/C2) EDITED THESE TWO PINS. W7 recovered the
  // ANSWER phrase by trying BOTH parsers unconditionally, and these fixtures
  // therefore declared no intent anywhere. That is now the C2 defect, not the
  // contract: the run's intent selects ONE parser, so a task run has to say so.
  // `run.json` is where it says it (`run.js :: runCouncil`'s start checkpoint),
  // and seeding it here is what makes these task fixtures task runs.
  test("a TASK run's ANSWER line is recovered from chair-output.md, same as a VERDICT line", async () => {
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'run.json': { runId: 'run-1', intent: 'task' },
      'chair-output.md': 'chair synthesis…\n\nANSWER: Converged\n',
    });
    expect((await stage5(dir)).overallVerdict).toBe('Converged');
  });

  test('every phrase of BOTH scales survives the rebuild off chair prose alone', async () => {
    const { CHAIR_VERDICTS, CHAIR_ANSWERS } = require('../src/council/parse-stage2');
    for (const [keyword, phrases, intent] of [['VERDICT', CHAIR_VERDICTS, 'review'], ['ANSWER', CHAIR_ANSWERS, 'task']]) {
      for (const phrase of phrases) {
        const dir = runFolder({
          'tally.json': tallyDoc(),
          'run.json': { runId: 'run-1', ...(intent === 'task' ? { intent: 'task' } : {}) },
          'chair-output.md': `chair synthesis…\n\n${keyword}: ${phrase}\n`,
        });
        expect((await stage5(dir)).overallVerdict).toBe(phrase);
      }
    }
  });

  test('an ANSWER-shaped line that names no canonical phrase still yields null', async () => {
    // Widening the fallback must not widen what counts as a terminal line.
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'run.json': { runId: 'run-1', intent: 'task' },
      'chair-output.md': 'chair synthesis…\n\nANSWER: Mostly agreed\n',
    });
    expect((await stage5(dir)).overallVerdict).toBeNull();
  });

  /**
   * v4.9 fix round 2 — the run's INTENT selects the parser (council B1 + C2 +
   * the contested C1; one root, one fix).
   *
   * W7 widened the chair-prose fallback to `parseChairVerdict(text) ||
   * parseChairAnswer(text)`, unconditionally, reasoning that the two scales are
   * disjoint so the order of the two calls cannot change an outcome.
   * Disjointness holds of the PHRASE SETS (chair-scale-drift.test.js). It does
   * NOT hold of the DOCUMENT: chair prose that quotes, contrasts or discusses
   * the other scale carries both keyword lines, and then order decides
   * everything. Both directions were MEASURED red on the shipped code before
   * this fix.
   *
   * Named mutant SCALEFREEFALLBACK: restore the unconditional
   * `parseChairVerdict(text) || parseChairAnswer(text)` in verdict.js ::
   * readOverallVerdict. RED SET, RE-MEASURED 2026-08-25 against the FINAL tree
   * (PR #200 C2) — FIVE tests in this describe, not the two the first cut of
   * this note named: 'C2: a REVIEW run whose chair prose carries an incidental
   * ANSWER line stays null', 'C2 control: a review run with no run.json at all
   * is still review (fail-closed)' (which the old count omitted and which was
   * already red before C2 landed), 'symmetric: a TASK run ignores an incidental
   * VERDICT line…', and the two C2 runId-guard pins added below. The C1 pin has
   * its own mutant, INTENTDROPPED (drop `opts.intent` from buildVerdict's
   * emit-when-task guard).
   */
  describe("the run's intent selects ONE parser, and rides onto the rebuild", () => {
    test('C2: a REVIEW run whose chair prose carries an incidental ANSWER line stays null', async () => {
      // The chair discussed the other scale in passing. A review run must never
      // mint a CHAIR_ANSWERS phrase as its overallVerdict — every downstream
      // surface would then label a task-scale phrase `VERDICT:`.
      const dir = runFolder({
        'tally.json': tallyDoc(),
        'run.json': { runId: 'run-1' },                       // emit-when-task: absent = review
        'chair-output.md': 'the peers argued about scales.\n\nANSWER: Converged\n\nBut I never closed.\n',
      });
      const v = await stage5(dir);
      expect(v.overallVerdict).toBeNull();
      expect('intent' in v).toBe(false);
    });

    test('C2 control: a review run with no run.json at all is still review (fail-closed)', async () => {
      const dir = runFolder({
        'tally.json': tallyDoc(),
        'chair-output.md': 'no run.json here.\n\nANSWER: Converged\n',
      });
      expect((await stage5(dir)).overallVerdict).toBeNull();
    });

    test('symmetric: a TASK run ignores an incidental VERDICT line and reads its own ANSWER', async () => {
      // The VERDICT line comes FIRST in the prose, so under the W7 fallback the
      // review parser won on ordering alone and the task run's verdict.json
      // carried 'Ship it' — a CHAIR_VERDICTS phrase, labelled `ANSWER:`.
      const dir = runFolder({
        'tally.json': tallyDoc(),
        'run.json': { runId: 'run-1', intent: 'task' },
        'chair-output.md': 'quoting a peer:\n\nVERDICT: Ship it\n\nMy own close:\n\nANSWER: Converged\n',
      });
      expect((await stage5(dir)).overallVerdict).toBe('Converged');
    });

    test('C1: a task rebuild whose tally carries no meta.intent still emits intent on the verdict', async () => {
      // MEASURED: the run-dir tally.json copies meta VERBATIM (tally.js), so the
      // canonical Stage-5 path already carried intent through record.meta. This
      // is the leg that did not: a hand-assembled or MCP-supplied tally record
      // (mcp-tools.js :: amicus_verdict types `record` as z.record(z.any())) has
      // no meta.intent, and the rebuilt verdict.json lost the key — regressing
      // the fold's terminal line and the Workspace chip to review scale.
      const tally = tallyDoc();
      expect('intent' in tally.meta).toBe(false);             // the premise, pinned
      const dir = runFolder({
        'tally.json': tally,
        'run.json': { runId: 'run-1', intent: 'task' },
        'chair-output.md': 'chair synthesis…\n\nANSWER: Split\n',
      });
      const v = await stage5(dir);
      expect(v.intent).toBe('task');
      expect(v.overallVerdict).toBe('Split');
    });

    test("C1 control: a review rebuild emits NO intent key — emit-when-task survives the second carrier", async () => {
      const dir = runFolder({
        'tally.json': tallyDoc(),
        'run.json': { runId: 'run-1' },
        'chair-output.md': 'chair synthesis…\n\nVERDICT: Ship it\n',
      });
      const v = await stage5(dir);
      expect('intent' in v).toBe(false);
      expect(v.overallVerdict).toBe('Ship it');
    });

    test('the intent key keeps its slot: a rebuilt task verdict orders keys exactly as the engine does', async () => {
      // Threading intent through buildVerdict's `opts` rather than assigning it
      // after the call is what preserves this. `intent` sits between
      // `claudeInCouncil` and `overallVerdict` in the closed literal; a
      // post-assignment would append it at the TAIL and the rebuilt document
      // would differ in key order from the one the engine wrote.
      const dir = runFolder({
        'tally.json': tallyDoc(),
        'run.json': { runId: 'run-1', intent: 'task' },
        'chair-output.md': 'chair synthesis…\n\nANSWER: Converged\n',
      });
      const keys = Object.keys(await stage5(dir));
      expect(keys.indexOf('intent')).toBe(keys.indexOf('claudeInCouncil') + 1);
      expect(keys.indexOf('overallVerdict')).toBe(keys.indexOf('intent') + 1);
    });

    /**
     * PR #200 round-2 finding C2. The run.json intent read shipped WITHOUT the
     * runId guard its two siblings both carry — readOverallVerdict
     * (verdict.js :: readOverallVerdict) and verdict.js :: readPriorVerdictSurfaces, both
     * `!runId || prior.runId === runId` — so a stale or foreign run.json left
     * in the folder could hand this rebuild another run's intent. That is not
     * cosmetic: intent SELECTS THE CHAIR PARSER, so the leak both mints the
     * `intent` key and can change `overallVerdict` to a phrase off the wrong
     * scale — both asserted below, which is why the fixture prose carries a
     * line of each scale.
     *
     * Named mutant FOREIGNRUNINTENT: drop the runId guard from the runDoc read
     * in cli-handlers-council.js :: runVerdict (`const ownRunDoc = runDoc;`).
     * MEASURED 2026-08-25 over this suite + council/cli-handlers-council +
     * mcp-server (214 tests): 2 RED, both of them BELOW — this test and the
     * no-runId one. Every other fixture in this file seeds `run-1` on both
     * sides, so all of them are structurally blind to the guard; that is why
     * these two exist. Reverted byte-exact.
     */
    test('C2: a FOREIGN run.json (different runId) leaks neither its intent nor its scale', async () => {
      const dir = runFolder({
        'tally.json': tallyDoc('run-1'),
        'run.json': { runId: 'some-other-run', intent: 'task' },
        'chair-output.md': 'quoting the other run:\n\nANSWER: Converged\n\nMy own close:\n\nVERDICT: Ship it\n',
      });
      const v = await stage5(dir);
      expect('intent' in v).toBe(false);
      expect(v.overallVerdict).toBe('Ship it');            // the REVIEW scale, not 'Converged'
    });

    test("C2 control: the same run.json under THIS run's id still carries the task intent", async () => {
      const dir = runFolder({
        'tally.json': tallyDoc('run-1'),
        'run.json': { runId: 'run-1', intent: 'task' },
        'chair-output.md': 'quoting the other run:\n\nANSWER: Converged\n\nMy own close:\n\nVERDICT: Ship it\n',
      });
      const v = await stage5(dir);
      expect(v.intent).toBe('task');
      expect(v.overallVerdict).toBe('Converged');          // the TASK scale
    });

    test('C2: a run.json with NO runId is not trusted — fail-closed to review', async () => {
      // Mirrors the siblings' guard shape exactly: the RECORD's runId being
      // absent is what waives the check, never the DOCUMENT's.
      const dir = runFolder({
        'tally.json': tallyDoc('run-1'),
        'run.json': { intent: 'task' },
        'chair-output.md': 'chair synthesis…\n\nANSWER: Converged\n',
      });
      const v = await stage5(dir);
      expect('intent' in v).toBe(false);
      expect(v.overallVerdict).toBeNull();
    });

    /**
     * PR #200 round-3 findings A1 + B1 (one mechanism, one fix).
     *
     * The chair-prose FALLBACK has been intent-dispatched since fix round 2 —
     * but the branch ABOVE it, the carry of a prior verdict.json's parsed
     * phrase, had no scale check at all. So the guard that stops a chair
     * DOCUMENT from leaking the wrong scale stopped nothing whenever a prior
     * verdict.json was present: `overallVerdict: 'Ship it'` was carried onto a
     * task rebuild verbatim, and the fold line, the report and the Workspace
     * chip then labelled a CHAIR_VERDICTS phrase `ANSWER:` — the exact defect
     * round 2 measured on the prose leg, one branch earlier, and the reason the
     * two pins below are the same test written in both directions.
     *
     * The rule: a carried phrase is trusted only when it is ON the scale the
     * RESOLVED intent selects (CHAIR_VERDICTS for review, CHAIR_ANSWERS for
     * task). Off-scale is treated as no carry at all — fall through to the
     * chair-output.md re-parse, which is intent-dispatched and therefore
     * already correct. Never invents: with no chair prose to fall back to, the
     * off-scale phrase yields null rather than a phrase off the wrong scale.
     *
     * Named mutant CARRIEDPHRASEUNCHECKED: restore the pre-fix condition in
     * verdict.js :: readOverallVerdict —
     * `typeof prior.overallVerdict === 'string' && prior.overallVerdict`.
     */
    describe('a carried phrase must be ON the resolved scale (A1/B1)', () => {
      test('A1: a TASK rebuild finding a stale REVIEW-scale verdict.json re-parses instead of carrying', async () => {
        const dir = runFolder({
          'tally.json': tallyDoc(),
          'run.json': { runId: 'run-1', intent: 'task' },
          // No `intent` key: emit-when-task means a real task verdict.json always
          // carries one, so a CHAIR_VERDICTS phrase without it is precisely the
          // stale/foreign artifact this guard exists for. (It is also what keeps
          // this fixture a REVIEW-scale document after the C3 carrier lands.)
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: 'Ship it' },
          'chair-output.md': 'chair synthesis…\n\nANSWER: Converged\n',
        });
        const v = await stage5(dir);
        expect(v.overallVerdict).toBe('Converged');
        expect(v.intent).toBe('task');
      });

      test('B1 symmetric: a REVIEW rebuild finding a TASK-scale verdict.json re-parses instead of carrying', async () => {
        const dir = runFolder({
          'tally.json': tallyDoc(),
          'run.json': { runId: 'run-1' },                      // emit-when-task: absent = review
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: 'Converged' },
          'chair-output.md': 'chair synthesis…\n\nVERDICT: Fix these first\n',
        });
        const v = await stage5(dir);
        expect(v.overallVerdict).toBe('Fix these first');
        expect('intent' in v).toBe(false);
      });

      test('an off-scale carry with NO chair prose to fall back to is null — never the wrong scale', async () => {
        const dir = runFolder({
          'tally.json': tallyDoc(),
          'run.json': { runId: 'run-1', intent: 'task' },
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: 'Ship it' },
        });
        expect((await stage5(dir)).overallVerdict).toBeNull();
      });

      test('control: an ON-scale carry is still carried, and still beats the chair prose', async () => {
        // The prose says something else entirely; the prior verdict.json wins,
        // exactly as it did before the scale check — this is a narrowing, not a
        // re-ordering.
        const dir = runFolder({
          'tally.json': tallyDoc(),
          'run.json': { runId: 'run-1', intent: 'task' },
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1',
            intent: 'task', overallVerdict: 'Converged' },
          'chair-output.md': 'chair synthesis…\n\nANSWER: Split\n',
        });
        expect((await stage5(dir)).overallVerdict).toBe('Converged');
      });

      test('every phrase of each scale is carriable on its OWN scale, and none on the other', async () => {
        const { CHAIR_VERDICTS, CHAIR_ANSWERS } = require('../src/council/parse-stage2');
        for (const [phrases, intent] of [[CHAIR_VERDICTS, 'review'], [CHAIR_ANSWERS, 'task']]) {
          for (const phrase of phrases) {
            const own = runFolder({
              'tally.json': tallyDoc(),
              'run.json': { runId: 'run-1', ...(intent === 'task' ? { intent: 'task' } : {}) },
              'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: phrase },
            });
            expect((await stage5(own)).overallVerdict).toBe(phrase);
            // The SAME document read as the other intent: no chair prose, so the
            // off-scale phrase has nowhere to fall back to and must be null.
            const other = runFolder({
              'tally.json': tallyDoc(),
              'run.json': { runId: 'run-1', ...(intent === 'task' ? {} : { intent: 'task' }) },
              'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: phrase },
            });
            expect((await stage5(other)).overallVerdict).toBeNull();
          }
        }
      });
    });

    /**
     * PR #200 round-3 finding C3 — the THIRD carrier, one deeper than round 2's
     * two.
     *
     * Round 2 read intent from the record's `meta.intent` and from `run.json`.
     * The prior verdict.json in the very same folder carries the key too — it is
     * emit-when-'task' on the engine's own write (verdict.js :: buildVerdict) —
     * and this function already opens that file twice. The leg that needs it is
     * the one round 2 named and did not close: a hand-assembled or MCP-supplied
     * record (mcp-tools.js :: amicus_verdict types `record` as
     * `z.record(z.any())`) has no meta.intent, and a run folder can be missing
     * run.json — copied out of a container, pruned, or simply never written
     * because the run died before its first checkpoint. The prior verdict.json
     * is then the ONLY document that still knows the run was a task run.
     *
     * All three carriers are emit-when-'task', so they combine as a disjunction:
     * absence is not a vote for review, it is no vote at all, and any one of
     * them saying 'task' is enough. The runId guard rides the third carrier
     * exactly as it rides the second (round-2 C2) — the guard is waived only
     * when the RECORD names no run, never when the DOCUMENT does not.
     *
     * Named mutant INTENTTHIRDCARRIER: drop the third disjunct from the intent
     * expression in cli-handlers-council.js :: runVerdict.
     */
    describe('the prior verdict.json is the THIRD intent carrier (C3)', () => {
      test('C3: hand-assembled record + NO run.json + a task verdict.json → task', async () => {
        const tally = tallyDoc();
        expect('intent' in tally.meta).toBe(false);            // the premise, pinned
        const dir = runFolder({
          'tally.json': tally,
          // deliberately no run.json — the second carrier is absent
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1',
            intent: 'task', overallVerdict: 'Converged' },
          'chair-output.md': 'chair synthesis…\n\nANSWER: Split\n',
        });
        const v = await stage5(dir);
        expect(v.intent).toBe('task');
        // …and because intent selects the scale, the carry survives too: read as
        // review, 'Converged' is off-scale and this rebuild would null it.
        expect(v.overallVerdict).toBe('Converged');
      });

      test('C3: a FOREIGN run.json does not veto the third carrier', async () => {
        // The second carrier is present but unusable (another run's document);
        // the run's own verdict.json still knows what it was.
        const dir = runFolder({
          'tally.json': tallyDoc('run-1'),
          'run.json': { runId: 'some-other-run' },
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1',
            intent: 'task', overallVerdict: 'Insufficient' },
        });
        const v = await stage5(dir);
        expect(v.intent).toBe('task');
        expect(v.overallVerdict).toBe('Insufficient');
      });

      test('C3 guard: a FOREIGN verdict.json leaks neither its intent nor its scale', async () => {
        const dir = runFolder({
          'tally.json': tallyDoc('run-1'),
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'some-other-run',
            intent: 'task', overallVerdict: 'Converged' },
          'chair-output.md': 'quoting the other run:\n\nANSWER: Converged\n\nMy own close:\n\nVERDICT: Ship it\n',
        });
        const v = await stage5(dir);
        expect('intent' in v).toBe(false);
        expect(v.overallVerdict).toBe('Ship it');             // the REVIEW scale
      });

      test('C3 control: a REVIEW prior verdict.json adds no intent — emit-when-task survives the third carrier', async () => {
        const dir = runFolder({
          'tally.json': tallyDoc(),
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1',
            overallVerdict: 'Ship it' },
        });
        const v = await stage5(dir);
        expect('intent' in v).toBe(false);
        expect(v.overallVerdict).toBe('Ship it');
      });

      test("C3 control: an explicit intent:'review' on the prior document is no vote either", async () => {
        // buildVerdict never writes that key (emit-when-'task'), so this shape is
        // hand-written only — and it must resolve exactly as absence does, or the
        // carrier would admit a spelling the producer refuses.
        const dir = runFolder({
          'tally.json': tallyDoc(),
          'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1',
            intent: 'review', overallVerdict: 'Ship it' },
        });
        const v = await stage5(dir);
        expect('intent' in v).toBe(false);
        expect(v.overallVerdict).toBe('Ship it');
      });
    });

    test('a task tally whose meta DOES carry intent needs no run.json — either carrier is enough', async () => {
      const tally = tallyDoc();
      tally.meta.intent = 'task';
      const dir = runFolder({
        'tally.json': tally,
        'chair-output.md': 'chair synthesis…\n\nANSWER: Insufficient\n',
      });
      const v = await stage5(dir);
      expect(v.intent).toBe('task');
      expect(v.overallVerdict).toBe('Insufficient');
    });
  });

  test('a foreign verdict.json (different runId) is NOT carried into this run', async () => {
    const dir = runFolder({
      'tally.json': tallyDoc('run-1'),
      'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'some-other-run', overallVerdict: 'Ship it' },
    });
    expect((await stage5(dir)).overallVerdict).toBeNull();
  });

  test('the carry is anchored on the run folder, not on -o: writing elsewhere still preserves it', async () => {
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'verdict.json': { schemaVersion: 2, type: 'council-verdict', runId: 'run-1', overallVerdict: 'Fundamental rethink' },
    });
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'chair-carry-out-'));
    const v = await stage5(dir, path.join(elsewhere, 'verdict.json'));
    expect(v.overallVerdict).toBe('Fundamental rethink');
    // the engine's original is left untouched at its own path
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'verdict.json'), 'utf-8')).overallVerdict)
      .toBe('Fundamental rethink');
  });
});
