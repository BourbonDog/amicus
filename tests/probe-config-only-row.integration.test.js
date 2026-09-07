'use strict';

/**
 * #218 PR 4 — council #235 round 3, findings C1/B1: the ENGINE side of the row
 * PROVENANCE rule (probe record M23).
 *
 * `src/utils/engine-variants.js :: engineSourced` decides whether a
 * `/config/providers` entry is the engine catalogue's own declaration — in which
 * case an empty `variants` map is a refusal — or nothing but the `limit`
 * descriptor Amicus registered, in which case the read waits and the level is
 * sent unverified. It decides that from `name`, `family`, `release_date`, `cost`
 * and `capabilities`, because `limit` is the one cell Amicus itself writes and
 * the dump echoes back (M3).
 *
 * That rule rests on an UNDOCUMENTED engine behaviour, and it has exactly one
 * dangerous error direction: an engine that started synthesizing display
 * metadata (a name, a date, a price) for a model only the config registers would
 * turn every model the engine has not learned yet into a FALSE REFUSAL. This is
 * the alarm for that direction. Probe row M23 puts the IDENTICAL Amicus
 * descriptor on a model the engine's catalogue knows and on one no catalogue can
 * ever carry, then asserts both rows — including the NEGATIVE cells
 * (`capabilities.toolcall === true`, `status === 'active'`) that a config-only
 * row also fills and that must therefore never become disjuncts.
 *
 * One engine start, on the probe's own cold sandbox HOME, no prompt, no API key,
 * $0. Integration tier: CI's keyless job runs it on every push.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROWS = 'M23';
const PROBE = path.join(__dirname, '..', 'scripts', 'probe-max-tokens.js');

test('the engine still tells its own catalogue row from a config-only one (probe row M23)', () => {
  const r = spawnSync(process.execPath, [PROBE, '--only', ROWS], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120000,
    env: process.env, // the probe re-sandboxes itself (OUTER/INNER) regardless
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const checks = out.split(/\r?\n/).find((l) => l.startsWith('checks: '));
  // The whole line, not just "0 mismatched": a row that never captured would
  // count as mismatched, and the partial marker proves the subset ran as such.
  expect(checks).toBe(`checks: 1 matched, 0 mismatched (none), 0 recorded — partial run (--only ${ROWS})`);
  expect(r.status).toBe(0);
}, 180000);
