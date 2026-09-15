// tests/curated-models-move.test.js
'use strict';
/**
 * #238 D8 / spec §6.8 — the pins moved from curated-models.js into
 * curated-pins.json; the builders must be BYTE-IDENTICAL over the data the
 * source used to hold. Two fixtures frozen at b803a2a (curated-models.js is
 * unchanged between b803a2a and cd6b8cfb, measured): the INPUT
 * (tests/fixtures/curated-pins-b803a2a.json, the initial data file) is fed to
 * the builders through the loader seam, and their outputs must equal the
 * OUTPUT snapshot taken from the pre-move source. Frozen fixtures, not the
 * live file, so the shipped pins may move (the D3 baseline session) without
 * touching this proof.
 *
 * Named mutants — MEASURED RED sets (2026-09-14, `npx jest
 * tests/curated-models-move.test.js` after each mutation, restored via
 * `git checkout --` between mutants):
 *   LOOPORDER — in toGatewayRoutes swap the two `for` lines (cardless loop
 *               first). RED (2): "the live shipped file today" › "produces
 *               the b803a2a gateway routes (delete this test in the D3
 *               baseline commit)"; "curated-models over the b803a2a data
 *               file" › "every builder is byte-identical to the pre-move
 *               source (spec §6.8)". Both consume toGatewayRoutes()'s
 *               insertion order via JSON.stringify, so both see it change.
 *   FAMILYPIN — pinFor returns `{ routes: {} }` instead of throwing when a
 *               family has no pin. RED (1): "curated-models over the
 *               b803a2a data file" › "a family without a pin is a named
 *               defect, never a route-less family (mutant FAMILYPIN)". The
 *               byte-identical test stays green — it never deletes a pin,
 *               so pinFor's fallback branch is never exercised there.
 */
const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, 'fixtures/curated-pins-b803a2a.json');
const OUTPUT = path.resolve(__dirname, 'fixtures/curated-models-b803a2a-outputs.json');

function loadWith(docFactory) {
  jest.resetModules();
  const real = jest.requireActual('../src/utils/curated-pins');
  jest.doMock('../src/utils/curated-pins', () => ({ ...real, loadCuratedPins: () => docFactory() }));
  return require('../src/utils/curated-models');
}

describe('curated-models over the b803a2a data file', () => {
  const input = () => JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  test('every builder is byte-identical to the pre-move source (spec §6.8)', () => {
    const cm = loadWith(input);
    const out = {
      routes: cm.toGatewayRoutes(),
      defaults: cm.toDefaultAliases(),
      provenance: cm.directFormProvenance(),
      curatedRoutes: cm.listCuratedRoutes(),
      families: cm.getFamilies().map(f => ({ ...f, idPattern: String(f.idPattern) })),
    };
    expect(JSON.stringify(out, null, 2) + '\n').toBe(fs.readFileSync(OUTPUT, 'utf8'));
  });
  test('the b803a2a fixtures still describe 21 aliases and 28 routes (guards a silently edited fixture)', () => {
    const snap = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    expect(Object.keys(snap.routes)).toHaveLength(21);
    expect(snap.curatedRoutes).toHaveLength(28);
    expect(Object.keys(input().pins)).toHaveLength(21);
  });
  test('Appendix A field presence: every pin has verifiedOn; the six rulings and retired.devstral are present', () => {
    const doc = input();
    for (const [alias, pin] of Object.entries(doc.pins)) { expect([alias, pin.verifiedOn]).toEqual([alias, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]); }
    for (const alias of ['gpt', 'opus', 'gpt-pro', 'fable', 'qwen', 'inkling']) { expect(typeof doc.pins[alias].ruling).toBe('string'); }
    expect(doc.pins['gpt-pro'].gatewayOnly).toBe(true);
    expect(doc.pins.codex.verifiedOn).toBe('2026-06-09');
    expect(doc.pins.kimi.verifiedOn).toBe('2026-08-26');
    expect(doc.pins.qwen.verifiedOn).toBe('2026-09-05');
    expect(doc.retired.devstral).toEqual({ on: '2026-08-04', ruling: expect.stringContaining('devstral') });
  });
  test('a family without a pin is a named defect, never a route-less family (mutant FAMILYPIN)', () => {
    const cm = loadWith(() => { const d = input(); delete d.pins.gemini; return d; });
    for (const fn of ['getFamilies', 'toGatewayRoutes', 'toDefaultAliases', 'listCuratedRoutes', 'directFormProvenance']) {
      expect(() => cm[fn]()).toThrow("curated-pins.json: no pin for family 'gemini'");
    }
  });
  test('a family pin may carry gatewayOnly and provenance honours it (the owner can rule it later without a code change)', () => {
    const cm = loadWith(() => { const d = input(); d.pins.gpt.gatewayOnly = true; return d; });
    expect(cm.directFormProvenance().gpt.gatewayOnly).toBe(true);
  });
});
