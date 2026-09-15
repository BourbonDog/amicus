// tests/utils/curated-pins.test.js
'use strict';
/**
 * #238 D8 — the shipped pin set's loader and validator. The validator's rules
 * are enumerated one refusal per test (fail-closed: every defect the file can
 * carry has a named message), and `loadCuratedPins` is proven to hand out a
 * COPY (mutant CLONE: in loadCuratedPins, `return raw` instead of
 * `return JSON.parse(JSON.stringify(raw))` — for the no-argument path `raw`
 * IS the module-cached SHIPPED object, so this is literally "return the
 * cached object instead"). MEASURED 2026-09-14 (`npx jest
 * tests/utils/curated-pins.test.js`, restored via `git checkout --`): RED
 * (1) — "loadCuratedPins" › "every call returns a fresh deep copy —
 * mutating one never reaches the next (mutant CLONE)"; every other test in
 * this file (including the canonical-format and explicit-path tests) stays
 * green. The shipped file itself must validate and be in canonical format,
 * so an owner-mode write of an unchanged document leaves no diff.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = '../../src/utils/curated-pins';
const SHIPPED_PATH = path.resolve(__dirname, '../../src/utils/curated-pins.json');

function good() {
  return {
    version: 1,
    pins: {
      gemini: { routes: { openrouter: 'openrouter/google/gemini-3.6-flash', google: 'google/gemini-3.6-flash' }, verifiedOn: '2026-08-04' },
      glm: { routes: { openrouter: 'openrouter/z-ai/glm-5.3' }, verifiedOn: '2026-08-04', ruling: 'why' },
      'gpt-pro': { routes: { openrouter: 'openrouter/openai/gpt-5.6-sol-pro' }, verifiedOn: '2026-08-05', gatewayOnly: true },
    },
    retired: { devstral: { on: '2026-08-04', ruling: 'delisted' } },
    notable: [{ id: 'openrouter/newco/atlas-1', suggestedAlias: 'atlas', note: 'new entrant' }],
  };
}

describe('validateCuratedPins — one refusal per rule', () => {
  const { validateCuratedPins } = require(MOD);
  const refuses = (mutate, message) => {
    const doc = good();
    mutate(doc);
    expect(() => validateCuratedPins(doc)).toThrow(message);
  };
  test('the good document validates', () => { expect(() => validateCuratedPins(good())).not.toThrow(); });
  test('not an object', () => { expect(() => validateCuratedPins(null)).toThrow('curated-pins.json: document is not an object'); });
  test('unknown top-level field', () => refuses(d => { d.extra = 1; }, "unknown top-level field 'extra'"));
  test('wrong version', () => refuses(d => { d.version = 2; }, 'unsupported version 2 (expected 1)'));
  test('empty pins', () => refuses(d => { d.pins = {}; }, 'pins must be a non-empty object'));
  test('pin is not an object', () => refuses(d => { d.pins.glm = 'x'; }, "pin 'glm' is not an object"));
  test('pin with an unknown field (a typo is caught, not ignored)', () => refuses(d => { d.pins.glm.gatewayonly = true; }, "pin 'glm' has an unknown field 'gatewayonly'"));
  test('pin without routes', () => refuses(d => { d.pins.glm.routes = {}; }, "pin 'glm' has no routes"));
  test('pin without an openrouter route', () => refuses(d => { d.pins.glm.routes = { google: 'google/x' }; }, "pin 'glm' has no openrouter route"));
  test('route id must live in its key\'s namespace', () => refuses(d => { d.pins.gemini.routes.google = 'openrouter/google/gemini-3.6-flash'; }, "pin 'gemini' route 'google' must be a 'google/…' id"));
  test('route id must have a model segment', () => refuses(d => { d.pins.glm.routes.openrouter = 'openrouter/'; }, "pin 'glm' route 'openrouter' must be a 'openrouter/…' id"));
  test('verifiedOn is required', () => refuses(d => { delete d.pins.glm.verifiedOn; }, "pin 'glm' needs verifiedOn as YYYY-MM-DD"));
  test('verifiedOn must be an ISO date', () => refuses(d => { d.pins.glm.verifiedOn = 'yesterday'; }, "pin 'glm' needs verifiedOn as YYYY-MM-DD"));
  test('ruling, when present, is a non-empty string', () => refuses(d => { d.pins.glm.ruling = ''; }, "pin 'glm' ruling must be a non-empty string"));
  test('gatewayOnly may only be true', () => refuses(d => { d.pins.glm.gatewayOnly = false; }, "pin 'glm' gatewayOnly may only be true"));
  // `d.pins.__proto__ = …` would SET the prototype, not add an own key; JSON.parse is how a file smuggles the name in as an own property
  test('a prototype-polluting pin name is refused', () => refuses(d => { d.pins = JSON.parse('{"__proto__":{"routes":{"openrouter":"openrouter/a/b"},"verifiedOn":"2026-01-01"}}'); }, "'__proto__' is not a valid name"));
  test('a padded pin name is refused', () => refuses(d => { d.pins[' glm'] = d.pins.glm; }, "' glm' is not a valid name"));
  test('retired must be an object', () => refuses(d => { d.retired = []; }, 'retired must be an object'));
  test('an alias cannot be both pinned and retired', () => refuses(d => { d.retired.glm = { on: '2026-01-01', ruling: 'x' }; }, "'glm' is both pinned and retired"));
  test('retired entry has exactly on + ruling', () => refuses(d => { d.retired.devstral.note = 'x'; }, "retired 'devstral' must have exactly on + ruling"));
  test('retired.on is an ISO date', () => refuses(d => { d.retired.devstral.on = '2026-8-4'; }, "retired 'devstral' needs on as YYYY-MM-DD"));
  test('retired needs a ruling', () => refuses(d => { d.retired.devstral.ruling = ''; }, "retired 'devstral' needs a ruling"));
  test('notable must be an array', () => refuses(d => { d.notable = {}; }, 'notable must be an array'));
  test('notable entry needs a provider/model id', () => refuses(d => { d.notable[0].id = 'atlas'; }, 'notable[0] needs a provider/model id'));
  test('notable suggestedAlias must not be a pin or retired', () => refuses(d => { d.notable[0].suggestedAlias = 'glm'; }, "notable[0] suggestedAlias 'glm' is already a pin or retired"));
  test('notable note must be a string', () => refuses(d => { d.notable[0].note = 3; }, 'notable[0] note must be a string'));
  test('notable entry with an unknown field', () => refuses(d => { d.notable[0].why = 'x'; }, "notable[0] has an unknown field 'why'"));
});

describe('loadCuratedPins', () => {
  const { loadCuratedPins, validateCuratedPins } = require(MOD);
  test('the shipped file validates and carries the 21 curated aliases + retired.devstral + an empty notable list', () => {
    const doc = loadCuratedPins();
    expect(Object.keys(doc.pins)).toHaveLength(21);
    expect(Object.keys(doc.pins).slice(0, 5)).toEqual(['gemini', 'gemini-pro', 'gpt', 'opus', 'deepseek']);
    expect(doc.retired.devstral.on).toBe('2026-08-04');
    expect(doc.notable).toEqual([]);
    expect(() => validateCuratedPins(doc)).not.toThrow();
  });
  test('the shipped file is in canonical format (JSON.stringify(doc, null, 2) + LF) so an unchanged owner write leaves no diff', () => {
    const raw = fs.readFileSync(SHIPPED_PATH, 'utf8');
    expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2) + '\n');
  });
  test('every call returns a fresh deep copy — mutating one never reaches the next (mutant CLONE)', () => {
    const a = loadCuratedPins();
    a.pins.glm.routes.openrouter = 'openrouter/z-ai/glm-9.9';
    a.retired.zzz = { on: '2026-01-01', ruling: 'x' };
    const b = loadCuratedPins();
    expect(b.pins.glm.routes.openrouter).toBe('openrouter/z-ai/glm-5.3');
    expect(b.retired.zzz).toBeUndefined();
  });
  test('an explicit path reads THAT file, fresh, and validates it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-pins-'));
    const p = path.join(dir, 'pins.json');
    fs.writeFileSync(p, JSON.stringify(good()));
    expect(Object.keys(loadCuratedPins(p).pins)).toEqual(['gemini', 'glm', 'gpt-pro']);
    fs.writeFileSync(p, JSON.stringify({ ...good(), version: 3 }));
    expect(() => loadCuratedPins(p)).toThrow('unsupported version 3');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
