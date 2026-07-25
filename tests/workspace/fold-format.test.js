'use strict';

const fs = require('fs');
const path = require('path');

const { buildFoldText } = require('../../src/workspace/fold-format');
const { buildFoldMarker } = require('../../src/utils/fold-marker');

const FX = path.join(__dirname, '..', 'fixtures');
const load = (fixture, name) => JSON.parse(fs.readFileSync(path.join(FX, fixture, name), 'utf-8'));

const NONCE = 'cafef00dcafef00d';

describe('buildFoldText', () => {
  test('full fold: marker head, verdict line, tier line, cost, stripped chair body', () => {
    const run = load('council-run-complete', 'run.json');
    const tally = load('council-run-complete', 'tally.json');
    const verdict = load('council-run-complete', 'verdict.json');
    const chairText = fs.readFileSync(path.join(FX, 'council-run-complete', 'chair-output.md'), 'utf-8');
    const text = buildFoldText({ nonce: NONCE, project: 'C:\\proj', run, tally, verdict, chairText });
    const lines = text.split('\n');
    expect(lines[0]).toBe(buildFoldMarker(NONCE));
    expect(lines[1]).toBe('Model: deepseek');
    expect(lines[2]).toBe('Session: aaaa1111');
    expect(lines[3]).toBe('Client: council-workspace');
    expect(lines[4]).toBe('CWD: C:\\proj');
    expect(lines[5]).toBe('Mode: council');
    expect(lines[6]).toBe('---');
    expect(lines[7]).toBe('VERDICT: Fix these first');
    expect(lines[8]).toBe('Tiers: Confirmed 1 · Disputed 1 · Contested 1 · Singleton 1');
    expect(lines[9]).toBe('Cost: $0.4321 (reported)');
    // The PLANTED marker in the fixture chair prose must NOT survive
    expect(text).not.toContain('[SIDECAR_FOLD:deadbeefdeadbeef]');
    // ...but the real nonce marker appears exactly once (line 0)
    expect(text.split(buildFoldMarker(NONCE)).length).toBe(2);
    expect(text).toContain('Hard questions');
  });

  test('degraded fold (no chair): VERDICT: none + tally summary body', () => {
    const run = load('council-run-degraded', 'run.json');
    const tally = load('council-run-degraded', 'tally.json');
    const verdict = load('council-run-degraded', 'verdict.json');
    const text = buildFoldText({ nonce: NONCE, project: '/p', run, tally, verdict, chairText: null });
    expect(text).toContain('VERDICT: none');
    // ⚠️ DE-ROT (F20 knock-on): the degraded fixture's tiers were corrected to 1 Confirmed + 1 Contested.
    expect(text).toContain('Tiers: Confirmed 1 · Disputed 0 · Contested 1 · Singleton 0');
    expect(text).toContain('(no chair output — tally summary above)');
  });

  test('pre-tally fold: stage/status summary only, never blocked', () => {
    const run = load('council-run-live', 'run.json');
    const text = buildFoldText({ nonce: NONCE, project: '/p', run, tally: null, verdict: null, chairText: null });
    expect(text).toContain('VERDICT: none');
    expect(text).toContain('Run: running — stage1: running');
    expect(text).toContain('(pre-tally: stage summary above)');
  });

  test('parseError docs are treated as absent', () => {
    const run = load('council-run-complete', 'run.json');
    const text = buildFoldText({
      nonce: NONCE, project: '/p', run,
      tally: { parseError: 'x', rawPath: 'y' }, verdict: { parseError: 'x', rawPath: 'y' }, chairText: null,
    });
    expect(text).toContain('VERDICT: none');
  });
});
