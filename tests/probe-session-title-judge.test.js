'use strict';
/**
 * #267 — council #294 round 2: the session-title probe's verdict, pinned without an engine.
 *
 * scripts/probe-session-title.js runs the real engine (keyless; CI's canary,
 * tests/probe-session-title-canary.integration.test.js). Its verdict is a pure
 * function of what the capture server saw, so the cases the council raised are
 * pinned here directly:
 *   A1/C1  an amicus session whose one request is NOT the leg's own fails
 *   B2/D5  a side request that lands after every session window still fails
 *   D1/B1  the control is judged by model, never by the title prompt's wording
 *   D7     an unknown verdict never exits 0
 */
const { judge, exitCode, MODEL } = require('../scripts/probe-session-title');

const leg = { model: MODEL, systemHead: 'You are opencode, an interactive CLI' };
const side = { model: 'google/gemini-3.6-flash', systemHead: 'You are a title generator. You outpu' };
const session = (...requests) => ({ requests });

function run({ amicus = [session(leg), session(leg)], untitled = [session(side, leg), session(side, leg)], phaseA } = {}) {
  return judge({ amicus, untitled, phaseA: phaseA || amicus.flatMap((s) => s.requests) });
}

describe('probe-session-title judge (#267)', () => {
  it('passes when every amicus request goes to the leg model and the control shows its side request', () => {
    expect(run().verdict).toBe('PASS');
  });

  it('fails an amicus session whose single request is a side request, not the leg (A1/C1)', () => {
    const amicus = [session(side), session(leg)];
    expect(run({ amicus }).verdict).toBe('FAIL');
  });

  it('fails a side request that arrives outside every amicus session window (B2/D5)', () => {
    const amicus = [session(leg), session(leg)];
    expect(run({ amicus, phaseA: [leg, leg, side] }).verdict).toBe('FAIL');
  });

  it('fails an amicus session that sent two requests', () => {
    const amicus = [session(leg, leg), session(leg)];
    expect(run({ amicus }).verdict).toBe('FAIL');
  });

  it('is BLIND when an untitled session shows no side request (the control lost sight of it)', () => {
    const untitled = [session(side, leg), session(leg)];
    expect(run({ untitled }).verdict).toBe('BLIND');
  });

  it('judges the control by model, so a reworded title prompt still passes (D1/B1)', () => {
    const reworded = { model: 'google/gemini-3.6-flash', systemHead: 'Summarise this thread in five words' };
    expect(run({ untitled: [session(reworded, leg), session(reworded, leg)] }).verdict).toBe('PASS');
  });

  it('lets a leak FAIL even when the control is blind: a side request in the amicus phase is evidence', () => {
    const amicus = [session(side, leg), session(leg)];
    expect(run({ amicus, untitled: [session(leg), session(leg)] }).verdict).toBe('FAIL');
  });

  it('maps an unknown verdict to a failing exit code (D7)', () => {
    expect(exitCode('PASS')).toBe(0);
    expect(exitCode('FAIL')).toBe(1);
    expect(exitCode('BLIND')).toBe(2);
    expect(exitCode('SOMETHING_ELSE')).toBe(1);
  });
});
