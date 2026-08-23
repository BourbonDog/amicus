// tests/council/preset-trim-twin-bench.test.js
'use strict';

/**
 * @module tests/council/preset-trim-twin-bench
 * v4.8 SI-22.4 / T-22.4.2 — the twin-bench knock-on of the preset trim,
 * measured END TO END from a saved `--council` preset through the artifacts a
 * real run writes, never argued from `seats.js :: buildSeats`.
 *
 * THE FIXTURE: preset `padtwin` = `['gemini ', 'gemini']`. Its two configured
 * members are DIFFERENT STRINGS — asserted below before anything else, because
 * a preset that already repeats an alias would produce the twin with or without
 * the trim and this whole file would prove nothing. The catalog is empty (no
 * `models --refresh` has run in the hermetic config dir), which is §0.1's row 2:
 * BEFORE the trim `classifyCouncilMembers` returned `['gemini ', 'gemini']` —
 * two distinct aliases, no repeat, no seat ids, no `meta.seats` — and after it
 * returns `['gemini', 'gemini']`, a real twin bench.
 *
 * WHAT IS DRIVEN: the REAL CLI bench resolver
 * (`cli-council-run-bench.js :: resolveBench`, which is what `amicus council run
 * --council <preset>` calls) feeds the REAL `runCouncil`. Only the model
 * launchers are faked, exactly as every other driver test in this directory
 * fakes them. Every assertion below reads a file the run wrote.
 *
 * THE CONTROL: preset `paduniq` = `['gemini ', 'gpt']` — also padded, also
 * trimmed, but no collision. It must gain NO seat ids, NO `-2` sibling and NO
 * `meta.seats`, which is what separates "the trim made a twin" from "the trim
 * changed everything".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCouncil } = require('../../src/council/run');
const { resolveBench } = require('../../src/cli-council-run-bench');
const { saveConfig } = require('../../src/utils/config');
const { review, judgeOut, mkLeg, okWave, launchersFromScript, baseOptions } =
  require('./helpers/fake-launchers');

const noSignals = () => () => {};

const PADTWIN = ['gemini ', 'gemini'];
const PADUNIQ = ['gemini ', 'gpt'];

let tmp;
const origConfigDir = process.env.AMICUS_CONFIG_DIR;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si224-twin-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  saveConfig({ councils: { padtwin: PADTWIN, paduniq: PADUNIQ } });
});

afterEach(() => {
  if (origConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
  else { process.env.AMICUS_CONFIG_DIR = origConfigDir; }
  if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); tmp = undefined; }
});

/** Two-seat script: both bench legs review, both judge, deepseek chairs. */
function twoSeatScript(runId, benchAliases, judgeAliases) {
  return {
    [`${runId}-s1`]: (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
    [`${runId}-s2`]: () => okWave(judgeAliases.map((j, i) => mkLeg(j, judgeOut(
      i === 0 ? ['Review B', 'Review A'] : ['Review A', 'Review B'],
      [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])))),
    [`${runId}-ch1`]: () => okWave([
      mkLeg('deepseek', `Synthesis of the ${benchAliases.join('/')} bench.\n\nVERDICT: Ship it`,
        'complete', 0.03),
    ]),
  };
}

async function runFromPreset(preset, runId) {
  const benchRes = resolveBench({ council: preset }, false);
  expect(benchRes.fail).toBeUndefined();
  const bench = benchRes.bench;
  const runDir = path.join(tmp, `council-${runId}`);
  const opts = baseOptions(tmp, { models: bench, chair: 'deepseek', runId, runDir });
  const result = await runCouncil(opts, {
    launchers: launchersFromScript(twoSeatScript(runId, bench, bench)),
    appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
  });
  expect(result.exitCode).toBe(0);
  return { benchRes, bench, runDir,
    tallyInput: JSON.parse(fs.readFileSync(path.join(runDir, 'tally-input.json'), 'utf-8')),
    files: fs.readdirSync(runDir).sort() };
}

describe('T-22.4.2: a padded preset becomes a REAL twin bench, proved from artifacts', () => {
  test('the fixture is not already a twin — the two configured members differ', () => {
    // Guard first. If this ever becomes false the rest of the file is vacuous.
    expect(PADTWIN[0]).not.toBe(PADTWIN[1]);
    expect(PADTWIN[0].trim()).toBe(PADTWIN[1].trim());
  });

  test('resolveBench collapses the preset to two identical aliases, dropping nothing', async () => {
    const benchRes = resolveBench({ council: 'padtwin' }, false);
    expect(benchRes.fail).toBeUndefined();
    expect(benchRes.bench).toEqual(['gemini', 'gemini']);
    expect(benchRes.droppedMembers).toEqual([]);   // BEFORE the trim this was empty too,
    expect(benchRes.presetName).toBe('padtwin');   // but the bench held TWO DISTINCT aliases.
  });

  test('buildSeats mints gemini#1/#2, the run dir gains the -2 sibling, meta.seats emits', async () => {
    const { tallyInput, files } = await runFromPreset('padtwin', 'pt001');

    // 1. `meta.seats` — absent on every unique-alias run, present here.
    expect(Array.isArray(tallyInput.meta.seats)).toBe(true);
    expect(tallyInput.meta.seats.map(s => s.id)).toEqual(['gemini#1', 'gemini#2']);
    expect(tallyInput.meta.seats.map(s => s.alias)).toEqual(['gemini', 'gemini']);
    expect(tallyInput.meta.models).toEqual(['gemini', 'gemini']);

    // 2. The `-2` artifact sibling, on disk, for BOTH the review and judge kinds.
    expect(files).toContain('review-gemini-1.md');
    expect(files).toContain('review-gemini-2.md');
    expect(files).toContain('judge-gemini-1.md');
    expect(files).toContain('judge-gemini-2.md');
    // And the unseated spelling a unique-alias bench would have written is gone.
    expect(files).not.toContain('review-gemini.md');

    // 3. The seat channel really reaches the rows, not just the header. FOUR
    // seated rows, not two: each seat contributes a Stage-1 review row AND a
    // Stage-2 judge row, and both carry the stamp.
    const seated = tallyInput.runStats.filter(r => r.seat);
    expect(seated.map(r => r.seat)).toEqual(['gemini#1', 'gemini#2', 'gemini#1', 'gemini#2']);
    expect(seated.map(r => r.role)).toEqual(['seat', 'seat', 'judge', 'judge']);
  });

  test('CONTROL — a padded preset with NO collision gains no seats, no sibling, no meta.seats', async () => {
    const { bench, tallyInput, files } = await runFromPreset('paduniq', 'pu001');
    expect(bench).toEqual(['gemini', 'gpt']);          // trimmed, but distinct
    expect('seats' in tallyInput.meta).toBe(false);    // the emit-when-DIFFERENT predicate
    expect(files).toContain('review-gemini.md');
    expect(files).toContain('review-gpt.md');
    expect(files).not.toContain('review-gemini-1.md');
    expect(files).not.toContain('review-gemini-2.md');
    for (const r of tallyInput.runStats) { expect('seat' in r).toBe(false); }
  });
});
