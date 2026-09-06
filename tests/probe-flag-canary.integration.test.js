'use strict';

/**
 * #218 PR 2 — council #231 round 3, finding B2: the ENGINE side of the flag.
 *
 * tests/opencode-client-sdk-spawn-timing.test.js proves the flag REACHES the
 * engine's spawn env; nothing automated proved the pinned engine still HONOURS
 * it. This runs seven rows of the wire probe in the probe's own keyless sandbox
 * and fails if any cell moved: A (bare row, the 32000 default), C3 (flag 64000
 * on a bare row the engine knows), K6 (flag 100000 with a matching descriptor),
 * K12 (flag 8000 lowering a bare row), K13 (flag 8000 on a model neither
 * catalog knows, passed through as-is). Seven engine starts — about 20 seconds
 * here, up to a minute on a slow runner — zero spend. Integration tier: CI's
 * keyless job runs it on every push, so an engine bump that drops or renames
 * OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX turns that job red instead of silently
 * reverting every budget above 32000. The full 61-case matrix is still the
 * record to re-run and re-file on a bump.
 *
 * #218 PR 4 adds M2 (the direct-Anthropic `enabled` + budgetTokens shape adds
 * its budget on top of the reservation — the fact the VARIANT_OVER_BUDGET
 * refusal stands on) and M17 (the fitted descriptor lands exactly on the budget
 * — the fact the filed exact-fit follow-up stands on). Seven engine starts.
 * The seven rows pin max_tokens (and, for M2 and M17, only the presence of a
 * thinking block) — cells both the engine's bundled catalogue (case A, the run's
 * first engine — cold or live) and the cached live one (every later case) agree
 * on — so the run's case order cannot move them.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROWS = 'A,C3,K6,K12,K13,M2,M17';
const PROBE = path.join(__dirname, '..', 'scripts', 'probe-max-tokens.js');

test(`the pinned engine honours OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX on the wire (probe rows ${ROWS})`, () => {
  const r = spawnSync(process.execPath, [PROBE, '--only', ROWS], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 240000,
    env: process.env, // the probe re-sandboxes itself (OUTER/INNER) regardless
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const checks = out.split(/\r?\n/).find((l) => l.startsWith('checks: '));
  // The whole line, not just "0 mismatched": a row that never captured would
  // count as mismatched, and the partial marker proves the subset ran as such.
  expect(checks).toBe(`checks: 7 matched, 0 mismatched (none), 0 recorded — partial run (--only ${ROWS})`);
  expect(r.status).toBe(0);
}, 300000);
