// tests/doctor-curated-pins.test.js
'use strict';
/**
 * `doctor`'s `curated-pins` row: facts for everyone, the owner-mode command
 * only in the source checkout.
 *
 * Named mutants, MEASURED red 2026-09-15 on the committed tree (commit
 * 99937105, `feat/doctor-shipped-pins`), one mutant applied to
 * src/utils/doctor-curated-pins-check.js at a time and restored after each
 * with `git checkout -- src/utils/doctor-curated-pins-check.js` (safe:
 * committed before measuring; `git status --porcelain` confirmed clean after
 * both restores). Command: `npx jest tests/doctor-curated-pins.test.js
 * tests/doctor-output-budget.test.js tests/cli-handlers-doctor.test.js
 * tests/doctor-handler.test.js tests/sidecar/aliases-owner.test.js`.
 *   CHECKOUTGATE — `if (!d.isSourceCheckout())` replaced with `if (false)`,
 *     so the checkout gate is ignored and the owner-mode command reaches an
 *     installed copy. RED (exactly 4, all in this file):
 *     evaluateCuratedPins > "installed copy, no drift: ok, facts only, no
 *     command anywhere"; evaluateCuratedPins > "installed copy, drift: still
 *     ok, says a newer amicus moves them, no command (mutant CHECKOUTGATE)";
 *     evaluateCuratedPins > "a single pin pluralizes as \"1 pin\"; a pin
 *     without a parseable date reads \"unknown\""; and doctor registration >
 *     "runDoctorChecks carries the curated-pins row right after
 *     output-budget, ok on the base fixture". Every test in the other four
 *     files, and the rest of this file, stayed green.
 *   DRIFTWARN — the `behind > 0` branch's `status: 'warn'` hardcoded to
 *     `'ok'` (the hint/message stay correct; only the status lies). RED
 *     (exactly 2, both in this file): evaluateCuratedPins > "source
 *     checkout, drift: warn with the owner command as the hint (mutant
 *     DRIFTWARN)"; and evaluateCuratedPins > "the real shipped file + the
 *     real drift report over a synthetic cache: 21 pins, verified up to
 *     2026-09-05, and glm-5.4 counts as behind". Every test in the other
 *     four files, and the rest of this file, stayed green.
 */
const { evaluateCuratedPins } = require('../src/utils/doctor-curated-pins-check');

const PINS = { version: 1, pins: {
  gemini: { routes: { openrouter: 'openrouter/google/gemini-3.6-flash' }, verifiedOn: '2026-08-04' },
  qwen: { routes: { openrouter: 'openrouter/qwen/qwen3.8-max-0902' }, verifiedOn: '2026-09-05' },
  glm: { routes: { openrouter: 'openrouter/z-ai/glm-5.3' }, verifiedOn: '2026-08-04' },
}, retired: {}, notable: [] };
const CACHE = { fetchedAt: Date.now(), models: [{ id: 'openrouter/z-ai/glm-5.4' }], providerFailures: [] };
const deps = (o = {}) => ({ loadCuratedPins: () => PINS, readCache: () => CACHE, buildFallbackDriftReport: () => [], isSourceCheckout: () => false, ...o });
const CMD = 'node bin/amicus.js aliases --review --owner';

describe('evaluateCuratedPins', () => {
  test('installed copy, no drift: ok, facts only, no command anywhere', () => {
    const r = evaluateCuratedPins(deps());
    expect(r).toEqual({ id: 'curated-pins', name: 'Shipped pins', status: 'ok', message: '3 pins, verified up to 2026-09-05, none behind the catalog', hint: null });
  });
  test('installed copy, drift: still ok, says a newer amicus moves them, no command (mutant CHECKOUTGATE)', () => {
    const r = evaluateCuratedPins(deps({ buildFallbackDriftReport: () => ['a', 'b'] }));
    expect(r.status).toBe('ok');
    expect(r.message).toBe('3 pins, verified up to 2026-09-05; 2 behind the catalog — a newer amicus will move them');
    expect(r.hint).toBeNull();
    expect(JSON.stringify(r)).not.toContain('--owner');
  });
  test('source checkout, drift: warn with the owner command as the hint (mutant DRIFTWARN)', () => {
    const calls = [];
    const r = evaluateCuratedPins(deps({ isSourceCheckout: () => true, buildFallbackDriftReport: (info) => { calls.push(info); return ['x']; } }));
    expect(r.status).toBe('warn');
    expect(r.message).toBe('3 pins, verified up to 2026-09-05; 1 behind the catalog');
    expect(r.hint).toBe(`${CMD}  — resets the shipped pins; then commit src/utils/curated-pins.json`);
    expect(calls[0]).toEqual({ models: CACHE.models, providerFailures: [] }); // the drift report gets the §5 shape, from the CACHE
  });
  test('source checkout, no drift: ok, the command lives in the message (doctor prints hints only for non-ok rows)', () => {
    const r = evaluateCuratedPins(deps({ isSourceCheckout: () => true }));
    expect(r.status).toBe('ok');
    expect(r.message).toBe(`3 pins, verified up to 2026-09-05, none behind the catalog — reset with: ${CMD}`);
    expect(r.hint).toBeNull();
  });
  test('no catalog cache: drift unknown, never computed, command still present in the checkout', () => {
    const drift = jest.fn(() => ['x']);
    const r = evaluateCuratedPins(deps({ isSourceCheckout: () => true, readCache: () => null, buildFallbackDriftReport: drift }));
    expect(drift).not.toHaveBeenCalled();
    expect(r.status).toBe('ok');
    expect(r.message).toBe(`3 pins, verified up to 2026-09-05 (catalog not cached — drift unknown) — reset with: ${CMD}`);
  });
  test('a single pin pluralizes as "1 pin"; a pin without a parseable date reads "unknown"', () => {
    const one = { version: 1, pins: { glm: { routes: { openrouter: 'openrouter/z-ai/glm-5.3' } } }, retired: {}, notable: [] };
    expect(evaluateCuratedPins(deps({ loadCuratedPins: () => one })).message).toBe('1 pin, verified up to unknown, none behind the catalog');
  });
  test('the real shipped file + the real drift report over a synthetic cache: 21 pins, verified up to 2026-09-05, and glm-5.4 counts as behind', () => {
    const { loadCuratedPins } = require('../src/utils/curated-pins');
    const { buildFallbackDriftReport } = require('../src/sidecar/models');
    const models = Object.values(loadCuratedPins().pins).map(p => ({ id: p.routes.openrouter })).concat([{ id: 'openrouter/z-ai/glm-5.4' }]);
    const r = evaluateCuratedPins({ loadCuratedPins, buildFallbackDriftReport, isSourceCheckout: () => true, readCache: () => ({ fetchedAt: Date.now(), models, providerFailures: [] }) });
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/^\d+ pins, verified up to \d{4}-\d{2}-\d{2}; 1 behind the catalog$/);
  });
});

describe('isSourceCheckout', () => {
  const { isSourceCheckout } = require('../src/sidecar/aliases-owner-gate');
  test('true only for an empty --show-prefix; false for a nested copy, a throwing git, or ENOENT', () => {
    expect(isSourceCheckout(() => '')).toBe(true);
    expect(isSourceCheckout(() => 'node_modules/amicus/')).toBe(false);
    expect(isSourceCheckout(() => { throw new Error('fatal: not a git repository'); })).toBe(false);
    expect(isSourceCheckout(() => { const e = new Error('spawn git ENOENT'); e.code = 'ENOENT'; throw e; })).toBe(false);
  });
});

// Registration — hermetic, same rationale as tests/doctor-output-budget.test.js.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
describe('doctor registration', () => {
  test('runDoctorChecks carries the curated-pins row right after output-budget, ok on the base fixture', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks(makeBaseDeps());
    const ids = rows.map(r => r.id);
    expect(ids.indexOf('curated-pins')).toBe(ids.indexOf('output-budget') + 1);
    expect(rows.find(r => r.id === 'curated-pins')).toEqual({ id: 'curated-pins', name: 'Shipped pins', status: 'ok', message: '1 pin, verified up to 2026-08-04, none behind the catalog', hint: null });
  });
  test('a thrown loader becomes an error row, never a crash', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks(makeBaseDeps({ loadCuratedPins: () => { throw new Error('curated-pins.json: boom'); } }));
    const row = rows.find(r => r.id === 'curated-pins');
    expect(row.status).toBe('error');
    expect(row.message).toBe('curated-pins.json: boom');
  });
});
