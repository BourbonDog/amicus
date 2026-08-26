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
  // defect these pins exist to prevent, on the newer of the two scales. The two
  // scales are DISJOINT by pinned construction (chair-scale-drift.test.js), so
  // trying both parsers cannot make either read the other's phrase.
  test("a TASK run's ANSWER line is recovered from chair-output.md, same as a VERDICT line", async () => {
    const dir = runFolder({
      'tally.json': tallyDoc(),
      'chair-output.md': 'chair synthesis…\n\nANSWER: Converged\n',
    });
    expect((await stage5(dir)).overallVerdict).toBe('Converged');
  });

  test('every phrase of BOTH scales survives the rebuild off chair prose alone', async () => {
    const { CHAIR_VERDICTS, CHAIR_ANSWERS } = require('../src/council/parse-stage2');
    for (const [keyword, phrases] of [['VERDICT', CHAIR_VERDICTS], ['ANSWER', CHAIR_ANSWERS]]) {
      for (const phrase of phrases) {
        const dir = runFolder({
          'tally.json': tallyDoc(),
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
      'chair-output.md': 'chair synthesis…\n\nANSWER: Mostly agreed\n',
    });
    expect((await stage5(dir)).overallVerdict).toBeNull();
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
