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
  // carry-in from T1 review: the unknown-field loop must run BEFORE suggestedAlias
  // validation, or a typo'd key (missing the real suggestedAlias) is misreported
  // as an invalid-name defect on `undefined` instead of the actual typo.
  test('a typo\'d suggestedAlias is reported as an unknown field, not a bad name', () => refuses(d => {
    d.notable[0].suggestedalias = d.notable[0].suggestedAlias;
    delete d.notable[0].suggestedAlias;
  }, "notable[0] has an unknown field 'suggestedalias'"));
});

describe('loadCuratedPins', () => {
  const { loadCuratedPins, validateCuratedPins } = require(MOD);
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-pins-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

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
    const p = path.join(dir, 'pins.json');
    fs.writeFileSync(p, JSON.stringify(good()));
    expect(Object.keys(loadCuratedPins(p).pins)).toEqual(['gemini', 'glm', 'gpt-pro']);
    fs.writeFileSync(p, JSON.stringify({ ...good(), version: 3 }));
    expect(() => loadCuratedPins(p)).toThrow('unsupported version 3');
  });
  // carry-in from T1 review: an explicit-path read/parse failure must carry the
  // same `curated-pins.json: ` prefix as every other defect, plus the path, so
  // a caller can't tell a missing/malformed file apart from a validation defect
  // by message shape alone.
  test('a missing or malformed explicit file throws curated-pins.json: <path>: <reason>', () => {
    const p = path.join(dir, 'bad.json');
    fs.writeFileSync(p, '{not valid json');
    expect(() => loadCuratedPins(p)).toThrow(/^curated-pins\.json: /);
    expect(() => loadCuratedPins(p)).toThrow(p);
  });
});

// MEASURED 2026-09-14 (`npx jest tests/utils/curated-pins.test.js`, restored via
// `git checkout -- src/utils/curated-pins.js`; `git status --porcelain` clean
// after both):
//   STAMP (delete the `next.pins[alias].verifiedOn = today;` line in
//   setPinRoute) — RED (1): "setPinRoute replaces exactly that route, stamps
//   verifiedOn, and returns a COPY (mutant STAMP: skip the stamp)"; every
//   other test in this file stays green.
//   PROVMATCH (in setPinRoute, replace `if (!inNamespace(id, provider))` with
//   `if (typeof id !== 'string')`) — RED (1): "setPinRoute refuses an unknown
//   alias, a namespace the pin has no route in, an id outside the namespace,
//   and a bad date (mutant PROVMATCH: drop the namespace check)"; every other
//   test in this file stays green.
describe('write half — saveCuratedPins / setPinRoute / setPinRuling (owner mode, #238 D8)', () => {
  const { loadCuratedPins, saveCuratedPins, setPinRoute, setPinRuling } = require(MOD);
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-pins-w-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('saveCuratedPins writes the canonical format to the given path and the loader reads it back equal', () => {
    const p = path.join(dir, 'pins.json');
    saveCuratedPins(good(), p);
    expect(fs.readFileSync(p, 'utf8')).toBe(JSON.stringify(good(), null, 2) + '\n');
    expect(loadCuratedPins(p)).toEqual(good());
  });
  test('saveCuratedPins validates BEFORE writing — an invalid document leaves the file untouched', () => {
    const p = path.join(dir, 'pins.json');
    saveCuratedPins(good(), p);
    const bad = good(); delete bad.pins.glm.verifiedOn;
    expect(() => saveCuratedPins(bad, p)).toThrow("pin 'glm' needs verifiedOn");
    expect(loadCuratedPins(p)).toEqual(good());
    expect(fs.readdirSync(dir)).toEqual(['pins.json']); // no temp file left behind
  });
  test('setPinRoute replaces exactly that route, stamps verifiedOn, and returns a COPY (mutant STAMP: skip the stamp)', () => {
    const before = good();
    const after = setPinRoute(before, 'gemini', 'openrouter', 'openrouter/google/gemini-3.7-flash', '2026-09-20');
    expect(after.pins.gemini.routes).toEqual({ openrouter: 'openrouter/google/gemini-3.7-flash', google: 'google/gemini-3.6-flash' });
    expect(after.pins.gemini.verifiedOn).toBe('2026-09-20');
    expect(before.pins.gemini.routes.openrouter).toBe('openrouter/google/gemini-3.6-flash');
    expect(before.pins.gemini.verifiedOn).toBe('2026-08-04');
    expect(Object.keys(after.pins.gemini)).toEqual(['routes', 'verifiedOn']); // key order preserved
  });
  test('setPinRoute refuses an unknown alias, a namespace the pin has no route in, an id outside the namespace, and a bad date (mutant PROVMATCH: drop the namespace check)', () => {
    expect(() => setPinRoute(good(), 'atlas', 'openrouter', 'openrouter/a/b', '2026-09-20')).toThrow("'atlas' is not a shipped pin");
    expect(() => setPinRoute(good(), 'glm', 'google', 'google/x', '2026-09-20')).toThrow("'glm' has no google route to replace (routes: openrouter)");
    expect(() => setPinRoute(good(), 'gemini', 'openrouter', 'google/gemini-3.7-flash', '2026-09-20')).toThrow("'google/gemini-3.7-flash' is not in the openrouter/ namespace");
    expect(() => setPinRoute(good(), 'gemini', 'openrouter', 'openrouter/', '2026-09-20')).toThrow("'openrouter/' is not in the openrouter/ namespace");
    // carry-in from T1 review: inNamespace now requires all 3 openrouter
    // segments (vendor/model, not just a bare vendor) — setPinRoute inherits
    // the rule via the same helper, so a 2-segment id must be refused too.
    expect(() => setPinRoute(good(), 'glm', 'openrouter', 'openrouter/z-ai', '2026-09-20')).toThrow("'openrouter/z-ai' is not in the openrouter/ namespace");
    expect(() => setPinRoute(good(), 'glm', 'openrouter', 'openrouter/z-ai/glm-5.4', 'today')).toThrow("verifiedOn must be YYYY-MM-DD (got 'today')");
  });
  test('setPinRuling sets a trimmed ruling on a copy; blank or unknown alias refused', () => {
    const before = good();
    const after = setPinRuling(before, 'gemini', '  flash tier, verified live  ');
    expect(after.pins.gemini.ruling).toBe('flash tier, verified live');
    expect(before.pins.gemini.ruling).toBeUndefined();
    expect(() => setPinRuling(good(), 'gemini', '   ')).toThrow("ruling for 'gemini' must be a non-empty string");
    expect(() => setPinRuling(good(), 'nope', 'x')).toThrow("'nope' is not a shipped pin");
  });
  test('a setPinRoute → saveCuratedPins → loadCuratedPins round trip through curated-models yields the new gateway routes', () => {
    const p = path.join(dir, 'pins.json');
    saveCuratedPins(setPinRoute(loadCuratedPins(), 'glm', 'openrouter', 'openrouter/z-ai/glm-5.4', '2026-09-20'), p);
    jest.resetModules();
    const real = jest.requireActual('../../src/utils/curated-pins');
    jest.doMock('../../src/utils/curated-pins', () => ({ ...real, loadCuratedPins: () => real.loadCuratedPins(p) }));
    const cm = require('../../src/utils/curated-models');
    expect(cm.toGatewayRoutes().glm).toEqual({ openrouter: 'openrouter/z-ai/glm-5.4' });
    expect(cm.toDefaultAliases().gemini).toBe('google/gemini-3.6-flash'); // untouched pins unchanged
  });
});
