'use strict';

/**
 * #202 Lever 2 — council #266 round 1, finding A1 (major): the CI experiment's
 * WIRE REACHABILITY had no standing verification.
 *
 * `.github/workflows/council-review.yml` writes an `opencode.json` into the
 * council run directory to pin one bench model's OpenRouter upstream. Whether
 * that file actually reaches the model's request body is a property of the
 * ENGINE, measured once by PR #265 and then relied on by every later run — and
 * nothing in a run's artifacts can confirm it, because no amicus artifact (not
 * `run.json`, not the spend ledger, not the assistant message) records the
 * serving upstream or the routing block that asked for it. So a silent no-op —
 * an engine bump that stops walking up from the session directory, or that
 * stops forwarding `options.provider` — would be INDISTINGUISHABLE from a
 * working experiment: the pinned seat would simply keep dying of the same
 * backstop the experiment exists to explain, and the run would read the same
 * either way.
 *
 * This is the standing check, modelled on tests/probe-flag-canary.integration.test.js
 * (which pins #218's engine rows the same way). It runs the two cases of
 * scripts/probe-provider-routing.js whose GEOMETRY is the workflow's:
 *
 *   R12 — opencode.json in the per-call `query.directory` only, cwd clean. This
 *         is the Stage-1 seat shape: the file sits in $RUN_DIR and the leg is
 *         scoped there.
 *   R14 — opencode.json at the scoped directory, the call scoped at its
 *         `_scratch` CHILD. This is the Stage-2 judge shape (run-server.js
 *         scopes support legs at `<runDir>/_scratch`), and it is what makes the
 *         workflow's "the pin governs every call that model makes in the run"
 *         claim true rather than hopeful.
 *
 * The probe re-sandboxes itself (OUTER/INNER, credential-scrubbed) and points
 * the provider at a LOCAL capture server, so this is keyless and $0 — it asserts
 * on the captured REQUEST BODY, never on a provider's answer. Two engine starts,
 * ~6 s measured here. Integration tier: CI's keyless job runs it on every push.
 *
 * `--out` is redirected into a temp directory ON PURPOSE. The probe's default is
 * `probe-3/wire-capture.json`, and it writes a `-digest.json` beside whatever it
 * is given — `probe-3/wire-capture-digest.json` is a TRACKED record of the full
 * 15-case matrix, and a 2-case run must never overwrite it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROWS = 'R12,R14';
const PROBE = path.join(__dirname, '..', 'scripts', 'probe-provider-routing.js');
// The routing preference the probe's own tree config asks for (`ROUTE` in
// scripts/probe-provider-routing.js). Sentinel values — neither provider serves
// the probe's model — because the assertion is about the REQUEST BODY, not about
// anything a provider would do with it.
const WIRE = '{"order":["Fireworks"],"allow_fallbacks":false}';

test(`the pinned engine still carries a run-directory opencode.json's options.provider to the wire (probe rows ${ROWS})`, () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-routing-canary-'));
  try {
    const r = spawnSync(process.execPath, [PROBE, '--only', ROWS, '--out', path.join(outDir, 'capture.json')], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 240000,
      env: process.env, // the probe re-sandboxes itself (OUTER/INNER) regardless
    });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const line = (id) => {
      const hit = out.split(/\r?\n/).find((l) => l.startsWith(`${id} — `));
      if (!hit) {
        throw new Error(`probe-provider-routing.js printed no line for ${id}.\nstatus: ${r.status}\n${out}`);
      }
      return hit;
    };

    for (const id of ROWS.split(',')) {
      // `carried: yes` is the probe's own word for "a `provider` key was found
      // on the captured outbound body". `elsewhere` (a sentinel under some
      // other key) and `no` both mean the pin did not reach the wire.
      expect(line(id)).toContain('carried: yes');
      // And the KEYS, not merely the presence of a provider object: an engine
      // that forwarded an empty `{}` would still say `carried: yes`.
      expect(line(id)).toContain(WIRE);
    }
    // The summary line, so a row that never captured cannot pass as absent.
    expect(out).toContain(`routing: 2 of 2 cases carried a preference (${ROWS})`);
    // The other half of the workflow's claim, re-pinned here because the
    // ::notice:: and the env comment both rest on it: the engine surfaces the
    // serving upstream NOWHERE, which is why `only: [one-slug]` is the only
    // self-attributing form.
    expect(out).toContain('it reaches no assistant-message field');
    expect(r.status).toBe(0);
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}, 300000);
