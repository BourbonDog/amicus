'use strict';

/**
 * sameModel (curated-models.js): two ids name the same model when they strip to
 * one string, or when they are the two gateway forms of ONE shipped route pair.
 * The second rule is the divergent-vendor case (Anthropic: dot ids on
 * OpenRouter, dash ids on the direct API) that a raw strip comparison got wrong
 * at five call sites (alias-shadow, aliases-review, aliases, alias-proposals,
 * setup).
 *
 * Named mutant "STRIPONLY": delete the pair loop in sameModel, leaving the strip
 * comparison. Expected red: the live-table and coinciding-fixture pair tests
 * here, plus alias-shadow's "pinning ANY curated alias to its own shipped
 * OpenRouter form" test.
 */

const path = require('path');

describe('sameModel', () => {
  afterEach(() => { jest.resetModules(); });

  test('the two forms of EVERY shipped route pair are the same model (live table)', () => {
    const { toGatewayRoutes, sameModel } = require('../../src/utils/curated-models');
    const paired = Object.entries(toGatewayRoutes()).filter(([, r]) => r.direct && r.openrouter);
    expect(paired.length).toBeGreaterThan(0);
    for (const [alias, r] of paired) {
      expect({ alias, same: sameModel(r.openrouter, r.direct) }).toEqual({ alias, same: true });
      expect({ alias, same: sameModel(r.direct, r.openrouter) }).toEqual({ alias, same: true });
    }
  });

  test('ids that strip to one string are the same model (non-divergent vendor)', () => {
    const { sameModel } = require('../../src/utils/curated-models');
    expect(sameModel('openrouter/openai/gpt-9.9-test', 'openai/gpt-9.9-test')).toBe(true);
    expect(sameModel('openai/gpt-9.9-test', 'openai/gpt-9.9-test')).toBe(true);
  });

  test('an UNCURATED divergent dot/dash pair is never fabricated into a match', () => {
    const { sameModel } = require('../../src/utils/curated-models');
    expect(sameModel('openrouter/anthropic/claude-zeta-9.9', 'anthropic/claude-zeta-9-9')).toBe(false);
  });

  test('two different shipped models are different, whichever gateway form', () => {
    const { toGatewayRoutes, sameModel } = require('../../src/utils/curated-models');
    const r = toGatewayRoutes();
    expect(sameModel(r.opus.openrouter, r.haiku.direct)).toBe(false);
    expect(sameModel(r.opus.direct, r.haiku.direct)).toBe(false);
  });

  test('non-strings are never the same model', () => {
    const { sameModel } = require('../../src/utils/curated-models');
    expect(sameModel(undefined, undefined)).toBe(false);
    expect(sameModel(null, 'anthropic/x')).toBe(false);
  });

  // The frozen table (tests/fixtures/curated-pins-b803a2a.json) keeps BOTH
  // Anthropic shapes covered after the live pins stop carrying one: opus/sonnet
  // whose dot and dash forms COINCIDE (claude-opus-5), and haiku whose forms
  // diverge (claude-haiku-4.5 / claude-haiku-4-5-20251001).
  test('frozen fixture: coinciding AND divergent Anthropic pairs both compare as one model', () => {
    const doc = require(path.join(__dirname, '..', 'fixtures', 'curated-pins-b803a2a.json'));
    const real = jest.requireActual('../../src/utils/curated-pins');
    jest.doMock('../../src/utils/curated-pins', () => ({ ...real, loadCuratedPins: () => JSON.parse(JSON.stringify(doc)) }));
    const { toGatewayRoutes, sameModel } = require('../../src/utils/curated-models');
    const r = toGatewayRoutes();
    expect(r.opus).toEqual({ direct: 'anthropic/claude-opus-5', openrouter: 'openrouter/anthropic/claude-opus-5' });
    expect(r.haiku).toEqual({ direct: 'anthropic/claude-haiku-4-5-20251001', openrouter: 'openrouter/anthropic/claude-haiku-4.5' });
    expect(sameModel(r.opus.openrouter, r.opus.direct)).toBe(true);
    expect(sameModel(r.haiku.openrouter, r.haiku.direct)).toBe(true);
    expect(sameModel(r.haiku.openrouter, r.opus.direct)).toBe(false);
  });
});
