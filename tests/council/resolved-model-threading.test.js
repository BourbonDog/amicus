// tests/council/resolved-model-threading.test.js — v4.7 GOA-7 (PR2): the
// resolved-id thread, leg → runStats row → tally.json/verdict.json → ledger
// row → deriveReliability group. mkLeg sets model === modelInput (both the
// alias), so every scripted leg here overrides .model to a distinct
// executable id — proving the field carries what SERVED, not the alias.
// Substitution attribution rides the same shape: a fallback-substituted leg's
// doc arrives with .model = the substitute's id (fanout-leg-fallback.js:232),
// indistinguishable from these fixtures by design.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { deriveReliability, buildLedgerRows } = require('../../src/council/ledger');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave } = require('./helpers/fake-launchers');

const RESOLVED = { gemini: 'google/gemini-3.5-pro', gpt: 'openai/gpt-5.2',
  qwen: 'qwen/qwen3-max', deepseek: 'deepseek/deepseek-v4' };

/** happyScript with every leg's .model rewritten to its executable id. */
function resolvedScript() {
  const script = happyScript();
  for (const [k, fn] of Object.entries(script)) {
    script[k] = (opts) => {
      const r = fn(opts);
      r.wave.legs = r.wave.legs.map(l => ({ ...l, model: RESOLVED[l.model] || l.model }));
      return r;
    };
  }
  return script;
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rm-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('resolvedModel threading (GOA-7 D8/D9 end-to-end)', () => {
  let runDir; let ledgerRows;

  beforeEach(async () => {
    const opts = baseOptions(tmp);
    runDir = opts.runDir;
    const appendRunFn = jest.fn(record => { ledgerRows = buildLedgerRows(record); });
    const res = await runCouncil(opts, {
      launchers: scriptedLaunchers(resolvedScript()),
      appendRunFn, statsFn: () => [], installSignalAbortFn: () => () => {},
    });
    expect(appendRunFn).toHaveBeenCalledTimes(1);
    expect(res.exitCode).toBe(0);
  });

  test('every leg-bearing runStats row carries resolvedModel = the executable id; model stays the alias', () => {
    const input = JSON.parse(fs.readFileSync(path.join(runDir, 'tally-input.json'), 'utf-8'));
    for (const row of input.runStats) {
      expect(row.resolvedModel).toBe(RESOLVED[row.model]);   // every happy-path row has a leg
      expect(RESOLVED[row.model]).toBeDefined();             // model is still the alias
    }
  });

  test('tally.json and verdict.json carry the field through the allowlist', () => {
    for (const f of ['tally.json', 'verdict.json']) {
      const doc = JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf-8'));
      const seat = doc.runStats.find(r => r.model === 'gemini' && r.role !== 'judge');
      expect(seat.resolvedModel).toBe('google/gemini-3.5-pro');
    }
  });

  test('ledger rows are v2 and carry resolvedModel from the joined primary row', () => {
    expect(ledgerRows).toHaveLength(3);
    for (const row of ledgerRows) {
      expect(row.schemaVersion).toBe(2);
      expect(row.resolvedModel).toBe(RESOLVED[row.model]);
    }
  });

  test('deriveReliability groups those rows by executable id with the alias in aliases[]', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rm-cfg-'));
    try {
      const file = path.join(dir, 'council-ledger.jsonl');
      fs.writeFileSync(file, ledgerRows.map(r => JSON.stringify(r)).join('\n') + '\n');
      const agg = deriveReliability({ dir });
      const g = agg.find(a => a.model === 'google/gemini-3.5-pro');
      expect(g).toBeDefined();
      expect(g.aliases).toEqual(['gemini']);
      expect('legacy' in g).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('leg-less rows stay resolvedModel-free (the R2/E-PR2-7 absence class)', () => {
  test('the give-up chair error row carries no resolvedModel (the R2/E-PR2-7 absence class)', async () => {
    // Chair walk dies: ch1/ch2 return dead legs, no ledger rows to promote a ch3.
    // Mirrors tests/council/run-chair.test.js's give-up idiom exactly (mkLeg
    // dead legs, statsFn empty so no ch3 promotion).
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    const opts = baseOptions(tmp);
    const res = await runCouncil(opts, { launchers: scriptedLaunchers(script), appendRunFn: jest.fn(),
      statsFn: () => [], installSignalAbortFn: () => () => {} });
    expect(res.exitCode).toBe(2);
    const input = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally-input.json'), 'utf-8'));
    const giveUp = input.runStats.find(r => r.role === 'chair' && r.status === 'error');
    expect(giveUp).toBeDefined();
    expect('resolvedModel' in giveUp).toBe(false);
  });
});
