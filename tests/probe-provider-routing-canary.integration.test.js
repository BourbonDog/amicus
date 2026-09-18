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
 *   R15 — R12's geometry carrying the SHIPPED document: a single-slug `only`
 *         on a real CI model id, with no `allow_fallbacks`. Added by council
 *         #266 r3 (A1/D4), which found that the two rows above pin the probe's
 *         own `order` preference and leave the shape CI actually writes
 *         unverified on the wire.
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

const ROWS = 'R12,R14,R15';
const PROBE = path.join(__dirname, '..', 'scripts', 'probe-provider-routing.js');
/**
 * What each row must carry on the wire.
 *
 * R12/R14 carry the probe's own `ROUTE` — sentinel values, because neither
 * provider serves the probe's model and the assertion is about the REQUEST BODY,
 * not about anything a provider would do with it.
 *
 * R15 is the row council #266 r3 (A1/D4) added, and it is the one that covers
 * what CI actually ships: the same per-call geometry as R12, but carrying a
 * single-slug `only` on a real CI model id and no `allow_fallbacks` — the
 * document `council-review.yml` documents as its example. Without it the canary
 * pinned that SOME provider block reaches the wire while the shipped shape went
 * unverified, so an engine regression specific to `only` handling would have
 * tripped neither this test nor any gate. The exact body matters as much as the
 * key: an engine that dropped `only` and forwarded `{}` would still say
 * `carried: yes`.
 */
const WIRE = {
  R12: '{"order":["Fireworks"],"allow_fallbacks":false}',
  R14: '{"order":["Fireworks"],"allow_fallbacks":false}',
  R15: '{"only":["reka"]}',
};

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
      expect(line(id)).toContain(WIRE[id]);
    }
    // The summary line, so a row that never captured cannot pass as absent.
    expect(out).toContain(`routing: 3 of 3 cases carried a preference (${ROWS})`);
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
