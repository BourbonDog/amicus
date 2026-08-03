// tests/council/degrade-surface.test.js
'use strict';

/**
 * Spec §8 surface integration: ONE lost seat must carry the SAME name on every
 * surface a user can meet it — stderr, run.json, verdict.json, report.md.
 * An absence is not a statement (issue #85's epitaph); these tests are the
 * four statements.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { buildReport } = require('../../src/council/report');
const { scriptedLaunchers, baseOptions, review, judgeOut, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'degrade-surface-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};
const deps = (launchers) => ({ launchers, appendRunFn: jest.fn(), statsFn: () => [],
  installSignalAbortFn: noSignals });

test('a dead Stage-1 leg is named identically on stderr, run.json, verdict.json and the report', async () => {
  const stderrLines = [];
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => {
    stderrLines.push(String(s)); return true;
  });
  try {
    // gpt's leg dies; gemini and qwen survive and judge each other.
    const script = {
      'abc123-s1': (_o) => okWave([
        mkLeg('gemini', review('gemini')),
        mkLeg('gpt', '', 'timeout'),
        mkLeg('qwen', review('qwen')),
      ], 2, 'partial'),
      // SL-2: gpt retries once (bench unit, single seat) before this is
      // recorded lost; scripted as a dead retry so it stays lost.
      'abc123-s1r1': () => okWave([]),
      // Adaptation: Stage 2 launches ONE wave whose legs are the surviving
      // judges (run-stage2.js:57-63 — `models: judges`, a WAVE call, never a
      // per-judge `.model` solo), so this keys off `o.models` like
      // happyScript()'s '-s2' entry. gemini/qwen are the only survivors and
      // rank each other via the two labels Stage 1 assigned them.
      'abc123-s2': (o) => okWave(o.models.map(m => mkLeg(m, judgeOut(['Review A', 'Review B'], [])))),
      'abc123-ch1': (o) => okWave([mkLeg(o.model, 'Synthesis.\n\nVERDICT: Ship it')]),
    };
    const opts = baseOptions(tmp);
    const { exitCode } = await runCouncil(opts, deps(scriptedLaunchers(script)));
    expect(exitCode).toBe(2);

    // 1. stderr — the sink's one voice, naming the seat
    expect(stderrLines.join('')).toContain('seat gpt did not review');

    // 2. run.json
    const run = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'run.json'), 'utf-8'));
    const runRec = (run.degrades || []).find(d => d.channel === 'dead-leg');
    expect(runRec.what).toContain('gpt');
    expect(runRec.data.seat).toBe('gpt');

    // 3. verdict.json
    const verdict = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
    const vRec = (verdict.degrades || []).find(d => d.channel === 'dead-leg');
    expect(vRec.what).toContain('gpt');

    // 4. the report — both formats, same section, same seat
    expect(buildReport({ verdict }, { format: 'md' }))
      .toMatch(/## What was lost[\s\S]*gpt/);
    expect(buildReport({ verdict }, { format: 'html' }))
      .toMatch(/What was lost[\s\S]*gpt/);
  } finally { spy.mockRestore(); }
});

test('thin cross-review fires through the REAL runCouncil path, and judges have rows', async () => {
  // Only ONE judge returns a parseable Stage-2 block → usable < 2 → the
  // thin-cross-review channel must fire from run.js's live conditional.
  // This is the wiring pin the Plan 1 final review asked for — Plan 1's
  // channels test (degrade-channels.test.js) pins the WORDING by duplicating
  // the conditional's shape rather than driving the real engine; this test
  // drives it.
  //
  // Adaptation: Stage 2 is one wave whose legs are the FULL judge roster
  // (run-stage2.js), not per-judge solos — the brief's schematic `s2Count`
  // counter modeled repeated per-judge solo calls, which is not how Stage 2
  // launches. A judge whose Stage-2 leg is 'complete' with non-empty (even if
  // unparseable) prose enters the bounded 2-attempt repair loop
  // (run-stage2.js:87-106), so the two "bad" judges' repair solos must ALSO
  // stay unparseable — a successful repair would make that judge usable and
  // defeat the <2 condition this test pins.
  const stillBad = (o) => okWave([mkLeg(o.model, 'still no parseable block')]);
  const script = {
    'abc123-s1': (o) => okWave(o.models.map(m => mkLeg(m, review(m)))),
    'abc123-s2': (o) => okWave(o.models.map((m, i) =>
      mkLeg(m, i === 0 ? judgeOut(['Review A', 'Review B'], []) : 'no parseable block'))),
    // Two malformed judges × the 2-attempt repair bound = four repair solos,
    // all kept unparseable so neither judge becomes usable via repair. Every
    // one of q1..q4 MUST stay scripted: an unscripted repair solo surfaces as
    // INTERNAL exit 1, so this test fails as `expected 2, received 1`.
    'abc123-q1': stillBad, 'abc123-q2': stillBad,
    'abc123-q3': stillBad, 'abc123-q4': stillBad,
    'abc123-ch1': (o) => okWave([mkLeg(o.model, 'Synthesis.\n\nVERDICT: Ship it')]),
  };
  const opts = baseOptions(tmp);
  const { exitCode } = await runCouncil(opts, deps(scriptedLaunchers(script)));
  expect(exitCode).toBe(2);

  const run = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'run.json'), 'utf-8'));
  const thin = (run.degrades || []).find(d => d.channel === 'thin-cross-review');
  expect(thin).toBeDefined();
  expect(thin.what).toMatch(/1 of \d+ judges/);

  // #83 on the same fixture: every judge got a runStats row on the verdict.
  const verdict = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
  const judgeRows = verdict.runStats.filter(r => r.role === 'judge');
  expect(judgeRows.length).toBeGreaterThanOrEqual(2);
});
