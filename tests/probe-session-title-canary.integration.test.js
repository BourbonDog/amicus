'use strict';
/**
 * #267 — council #294 round 1, findings D1/B2: the ENGINE side of the session title.
 *
 * tests/opencode-client.test.js pins that every session create carries a title;
 * nothing automated proved the pinned engine still SKIPS its title-generation
 * request when it gets one. This runs scripts/probe-session-title.js (two arms,
 * two sessions each, one engine start, in the probe's own keyless sandbox) and
 * fails unless the untitled control still shows the hidden request and every
 * session amicus creates sends exactly one. Integration tier: CI's keyless job
 * runs it on every push, on Linux, so an engine bump that ignores `body.title`,
 * or adds another request of its own, turns that job red instead of quietly
 * reopening spend the ledger cannot see. Zero spend; about 30 seconds.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PROBE = path.join(__dirname, '..', 'scripts', 'probe-session-title.js');

test('the pinned engine sends no title request for a session amicus names (#267)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-267-'));
  try {
    const r = spawnSync(process.execPath, [PROBE, '--n', '2', '--out', path.join(dir, 'digest.json')], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 240000,
      env: process.env, // the probe re-sandboxes itself (OUTER/INNER) regardless
    });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const verdict = out.split(/\r?\n/).find((l) => l.startsWith('verdict: '));
    // The whole line: BLIND (the control lost sight of the request) fails as hard as FAIL.
    expect(verdict).toBe('verdict: PASS — 2 of 2 untitled sessions sent a title request; 2 of 2 amicus sessions sent one request each');
    expect(r.status).toBe(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 300000);
