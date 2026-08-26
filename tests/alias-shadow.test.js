// tests/alias-shadow.test.js
'use strict';

/**
 * v4.9 W13 Task B — the alias-shadow notice (BACKLOG C5, #129's own side
 * observation): a user-config alias may repoint a CURATED alias at a different
 * model, so per-model operating notes keyed on that alias silently describe a
 * model the alias no longer resolves to. The notice is pure self-diagnosis —
 * it changes no resolution, no exit code, no artifact.
 *
 * MEASURED SITE (delegated question, v4.9 W13 Task B). The plan asked for "the
 * shared resolution helper, not a handler", so that BOTH council transports get
 * it. Measurement:
 *   - `mcp-council-run.js` spawns the CLI child with `--models <expanded>`
 *     — ALWAYS, never `--council`. So the MCP council path re-enters the CLI
 *     and lands in `cli-council-run-bench.js :: resolveBench` exactly like a
 *     hand-typed `amicus council run`. That function is therefore the ONE
 *     bench-resolution helper both transports EXECUTE.
 *   - ⚠️ EXECUTE, not "surface" (PR #203 round 1, finding A4). The child's
 *     stderr is redirected to `<runDir>/debug.log` by
 *     `mcp-server.js :: spawnSidecarProcess` (`stdio: ['ignore','ignore',<fd>]`,
 *     then `unref`), so an MCP caller never sees this line — it has to be read
 *     out of the run dir. Recorded in alias-shadow.js's docblock and BACKLOG.md;
 *     giving it an MCP channel is a transport change, out of scope here.
 *   - `config.js :: getEffectiveAliases` merges `{...DEFAULT_ALIASES,
 *     ...userAliases}`, so by the time anything downstream (`resolveModel`,
 *     `route-launch.js :: resolveRouteForLaunch`) sees an id, the two sources
 *     are already collapsed and the shadow is UNRECOVERABLE. The comparison has
 *     to read `loadConfig().aliases` and `toDefaultAliases()` separately — which
 *     is what `alias-shadow.js` does, and why it is its own leaf rather than a
 *     line inside the merge.
 *   - `mcp-council-bench.js :: resolveBenchInput` is the MCP-side twin, but it
 *     runs in the MCP server process for the PRESET branch only; wiring it too
 *     would double-print for a preset run (the child re-resolves the expanded
 *     bench). One site, in the child, is what "once per run" means here.
 *
 * FOUR named mutants. All red sets below were RE-MEASURED 2026-08-26 against the
 * PR #203 round-1 tree at ONE shared focused scope — 7 suites / 273 tests: this
 * file plus tests/no-output-backstop-wiring.test.js, tests/sidecar/fanout.test.js,
 * tests/council/run-stats-entry.test.js,
 * tests/scripts/council-review-workflow.test.js,
 * tests/sidecar/models-command.test.js, tests/cli-council-run.test.js.
 *
 * "SHADOWSILENT" — `src/utils/alias-shadow.js :: noteAliasShadows`, make the
 * emitter a no-op (an early `return;` after the writer is bound, i.e. the
 * warning is computed and never spoken). RED: 12 tests / 2 suites.
 *   tests/alias-shadow.test.js            — 10 failed
 *     · emits the plan's exact line, one per shadowed alias
 *     · once per run: a second resolution of the same alias stays quiet
 *     · the default writer is stderr
 *     · a check that CANNOT run says so rather than degrading silently
 *     · a bare --models bench notices the shadow
 *     · two councils in ONE process each get their own audit (A5)
 *     · all four A6 chair/critic pins
 *   tests/sidecar/models-command.test.js  — 2 failed
 *     · --check names a local alias that shadows a curated pin, on stderr
 *     · --check --json: the notice never enters the audit document on stdout
 * The `findAliasShadows` pins stay green under it BY DESIGN: they pin the
 * predicate, and the mutant kills only the speech act. That split is the point —
 * a silent degrade of a self-diagnosis feature is exactly the failure the
 * product principle forbids, so the speech act gets its own pins, and the
 * ABSENCE CONTROLS are the ones that stay green in BOTH directions.
 *
 * "GATEWAYFORM" — `findAliasShadows`, replace the canonical comparison with a
 * raw `local === shipped`. RED: 2 tests / 1 suite, both in this file:
 *   · the same model in the other gateway form is NOT a shadow
 *   · this repo's own CI alias map raises only genuine model differences
 * Disjoint from SHADOWSILENT's set by construction: one mutant kills the speech,
 * the other kills the discrimination, and no test dies under both.
 *
 * "SCOPESTUCK" (PR #203 A5) — drop the `spoken.clear()` from
 * `auditAliasShadows`, i.e. put the un-resettable per-process latch back. RED:
 * 1 test / 1 suite:
 *   · two councils in ONE process each get their own audit (PR #203 A5)
 * Every other speech pin stays green — the latch only ever silences the SECOND
 * run, which is exactly why one dedicated fixture had to exist.
 *
 * "SEATSBLIND" (PR #203 A6) — audit `res.bench` alone again, dropping the chair
 * and critic from the name list. RED: 3 tests / 1 suite — the explicit --chair
 * pin, the DEFAULT-chair pin and the --critic pin. The two A6 controls stay
 * green in both directions, so the widening is pinned as an ADDITION rather
 * than as noise.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { toDefaultAliases } = require('../src/utils/curated-models');

describe('v4.9 W13 Task B: the alias-shadow notice (C5)', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-alias-shadow-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Write a user config.json carrying exactly these aliases. */
  function writeConfig(aliases) {
    fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({ aliases }, null, 2));
  }

  /** Fresh require AFTER the config is on disk (loadConfig reads at call time). */
  function load() {
    return require('../src/utils/alias-shadow');
  }

  // The curated pin is read from the shipped table, never re-typed: a pin
  // refresh (this same task moves kimi/qwen forward) must not rot these tests.
  const CURATED = toDefaultAliases();
  const STALE_KIMI = 'openrouter/moonshotai/kimi-k2.6';

  describe('findAliasShadows — the predicate', () => {
    test('a local alias pointing at a DIFFERENT id than the curated pin is a shadow', () => {
      writeConfig({ kimi: STALE_KIMI });
      expect(load().findAliasShadows(['kimi'])).toEqual([
        { alias: 'kimi', local: STALE_KIMI, curated: CURATED.kimi },
      ]);
    });

    test('a local alias with the SAME id as the curated pin is silent', () => {
      writeConfig({ kimi: CURATED.kimi });
      expect(load().findAliasShadows(['kimi'])).toEqual([]);
    });

    // The same false-positive class tests/alias-drift.test.js already guards for
    // `findDriftedStoredAliases`: a direct-capable vendor's curated pin is the
    // BARE canonical form (`openai/gpt-5.6-terra`, policy-routed by the gateway
    // router), so a config that pins the explicit OpenRouter form of THE SAME
    // MODEL differs as a string and not as a model. Reporting it would put two
    // spurious lines on every CI council run (gpt and deepseek both hit this in
    // .github/amicus-ci-aliases.json), which is how a real signal gets trained
    // out. Gateway ROUTING has its own audit — `models --check`'s per-gateway
    // section; this notice is only about naming a different MODEL.
    test('the same model in the other gateway form is NOT a shadow', () => {
      writeConfig({ gpt: 'openrouter/openai/gpt-5.6-terra' });
      expect(CURATED.gpt).toBe('openai/gpt-5.6-terra'); // guards the premise
      expect(load().findAliasShadows(['gpt'])).toEqual([]);
    });

    test("this repo's own CI alias map raises only genuine model differences", () => {
      // Concrete, non-hypothetical version of the pin above: the map is real,
      // provisioned into every CI council run, and pins the OpenRouter form of
      // gpt/deepseek. Those must be silent; a map entry naming a DIFFERENT model
      // (glm, deliberately ahead of the shipped floor) must not be.
      const map = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '.github', 'amicus-ci-aliases.json'), 'utf-8'));
      writeConfig(map.aliases);
      const shadows = load().findAliasShadows(Object.keys(map.aliases));
      const { toCanonicalDefault } = require('../src/utils/curated-models');
      for (const s of shadows) {
        expect(toCanonicalDefault(s.local)).not.toBe(toCanonicalDefault(s.curated));
      }
      expect(shadows.map(s => s.alias)).not.toContain('gpt');
      expect(shadows.map(s => s.alias)).not.toContain('deepseek');
    });

    test('an alias with no local override at all is silent', () => {
      writeConfig({ glm: 'openrouter/z-ai/glm-5.3' });
      expect(load().findAliasShadows(['kimi'])).toEqual([]);
    });

    test('a purely local alias the curated table never ships is silent (nothing to shadow)', () => {
      writeConfig({ 'my-local': 'openrouter/vendor/whatever' });
      expect(load().findAliasShadows(['my-local'])).toEqual([]);
    });

    test('a bench member that is a full model id is not an alias — silent', () => {
      writeConfig({ kimi: STALE_KIMI });
      expect(load().findAliasShadows(['openrouter/moonshotai/kimi-k2.6'])).toEqual([]);
    });

    test('no config file at all (loadConfig -> null) is silent, not a throw', () => {
      expect(load().findAliasShadows(['kimi', 'qwen', 'gpt'])).toEqual([]);
    });

    test('members are trimmed and de-duplicated — a twin bench reports one row', () => {
      writeConfig({ kimi: STALE_KIMI });
      expect(load().findAliasShadows([' kimi ', 'kimi', ''])).toEqual([
        { alias: 'kimi', local: STALE_KIMI, curated: CURATED.kimi },
      ]);
    });

    test('omitting the names inspects every configured alias (the models --check surface)', () => {
      writeConfig({ kimi: STALE_KIMI, glm: CURATED.glm, 'my-local': 'x/y' });
      expect(load().findAliasShadows()).toEqual([
        { alias: 'kimi', local: STALE_KIMI, curated: CURATED.kimi },
      ]);
    });
  });

  describe('noteAliasShadows — the speech act (mutant SHADOWSILENT)', () => {
    test('emits the plan\'s exact line, one per shadowed alias', () => {
      writeConfig({ kimi: STALE_KIMI });
      const writes = [];
      load().noteAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes).toEqual([
        `Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})\n`,
      ]);
    });

    test('once per run: a second resolution of the same alias stays quiet', () => {
      writeConfig({ kimi: STALE_KIMI });
      const shadow = load();
      const writes = [];
      shadow.noteAliasShadows(['kimi'], (s) => writes.push(s));
      shadow.noteAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes).toHaveLength(1);
    });

    test('the default writer is stderr (never stdout — --json documents stay clean)', () => {
      writeConfig({ kimi: STALE_KIMI });
      const errs = [];
      const outs = [];
      const origErr = process.stderr.write;
      const origOut = process.stdout.write;
      process.stderr.write = (s) => { errs.push(String(s)); return true; };
      process.stdout.write = (s) => { outs.push(String(s)); return true; };
      try {
        load().noteAliasShadows(['kimi']);
      } finally {
        process.stderr.write = origErr;
        process.stdout.write = origOut;
      }
      expect(errs.join('')).toContain("alias 'kimi' resolves to");
      expect(outs).toEqual([]);
    });

    test('ABSENCE CONTROL: a clean config produces no output whatsoever', () => {
      writeConfig({ kimi: CURATED.kimi, glm: CURATED.glm });
      const writes = [];
      load().noteAliasShadows(['kimi', 'glm'], (s) => writes.push(s));
      expect(writes).toEqual([]);
    });

    // The check failing must never be indistinguishable from the check passing.
    // This is not hypothetical: during development a leaked module mock made
    // `loadConfig` undefined and the whole feature went quiet with a green suite.
    test('a check that CANNOT run says so rather than degrading silently', () => {
      const writes = [];
      // ⚠️ `jest.doMock` installs into the MOCK registry, which neither
      // `jest.resetModules()` nor `jest.isolateModules` clears — leaving it
      // installed would hand every later test in this file a config module with
      // no `loadConfig`. That exact leak (in tests/sidecar/models-command.test.js)
      // is what this test exists to make loud, so undo it in a `finally`.
      jest.doMock('../src/utils/config', () => ({ /* loadConfig missing */ }));
      try {
        require('../src/utils/alias-shadow').noteAliasShadows(['kimi'], (s) => writes.push(s));
      } finally {
        jest.dontMock('../src/utils/config');
      }
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('could not check whether local aliases shadow the curated table');
    });
  });

  describe('wiring: cli-council-run-bench.js :: resolveBench (BOTH transports)', () => {
    test('a bare --models bench notices the shadow', () => {
      writeConfig({ kimi: STALE_KIMI });
      const writes = [];
      const origErr = process.stderr.write;
      process.stderr.write = (s) => { writes.push(String(s)); return true; };
      let res;
      try {
        res = require('../src/cli-council-run-bench').resolveBench({ models: 'kimi,glm' }, false);
      } finally {
        process.stderr.write = origErr;
      }
      // No behavior change: the bench comes back exactly as before.
      expect(res.bench).toEqual(['kimi', 'glm']);
      expect(res.presetName).toBeNull();
      expect(writes.join('')).toContain(
        `Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})\n`);
    });

    test('ABSENCE CONTROL: a bench with no shadowed alias writes nothing', () => {
      writeConfig({ kimi: CURATED.kimi });
      const writes = [];
      const origErr = process.stderr.write;
      process.stderr.write = (s) => { writes.push(String(s)); return true; };
      let res;
      try {
        res = require('../src/cli-council-run-bench').resolveBench({ models: 'kimi,glm' }, false);
      } finally {
        process.stderr.write = origErr;
      }
      expect(res.bench).toEqual(['kimi', 'glm']);
      expect(writes).toEqual([]);
    });

    /**
     * PR #203 council round 1, finding A5 — the dedup must RESET between runs.
     *
     * The `spoken` set is module scope. A host process that resolves two
     * councils in a row (the CLI child is one run per process, but the engine,
     * the test suite and any programmatic host are not) used to get the audit
     * for the first and SILENCE for every one after — the worst failure shape
     * for a self-diagnosis feature, because it is indistinguishable from "all
     * clear". `resolveBench` now opens a fresh notice scope, so the set dedups
     * WITHIN a run and never across runs.
     *
     * MEASURED, on the delegated question of what identifies a run at this
     * seam: nothing does. `runId` is assigned in
     * cli-handlers-council-run.js AFTER this call (it is not in `args`, and on
     * the MCP path the child receives `--run-id` but the handler has not read it
     * yet), so there is no id to key on. Opening the scope at the audit's own
     * entry site is the smallest honest seam: each wired site is reached exactly
     * once per command invocation, so one scope IS one run.
     */
    test('two councils in ONE process each get their own audit (PR #203 A5)', () => {
      writeConfig({ kimi: STALE_KIMI });
      const bench = require('../src/cli-council-run-bench');
      const runOnce = () => {
        const writes = [];
        const origErr = process.stderr.write;
        process.stderr.write = (s) => { writes.push(String(s)); return true; };
        try { bench.resolveBench({ models: 'kimi,glm' }, false); } finally { process.stderr.write = origErr; }
        return writes;
      };
      const first = runOnce();
      const second = runOnce();
      const line = `Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})\n`;
      expect(first).toEqual([line]);
      expect(second).toEqual([line]); // …not silence, and not two copies either
    });

    /**
     * PR #203 council round 1, finding A6 — the CHAIR and the CRITIC resolve
     * through the very same alias table as a bench seat, so a shadow there is
     * exactly as invisible and exactly as worth naming.
     */
    describe('the chair and the critic are audited too (PR #203 A6)', () => {
      const runBench = (args) => {
        const writes = [];
        const origErr = process.stderr.write;
        process.stderr.write = (s) => { writes.push(String(s)); return true; };
        try { require('../src/cli-council-run-bench').resolveBench(args, false); }
        finally { process.stderr.write = origErr; }
        return writes.join('');
      };

      test('an explicit --chair naming a shadowed alias notices, though it is not a bench seat', () => {
        writeConfig({ kimi: STALE_KIMI });
        const out = runBench({ models: 'glm,gpt', chair: 'kimi' });
        expect(out).toContain(`Notice: alias 'kimi' resolves to ${STALE_KIMI}`);
      });

      // The chair a run gets when nobody passes --chair is still an alias, and
      // a shadow on it repoints the seat that writes the verdict.
      test('the DEFAULT chair is audited when --chair is absent', () => {
        const LOCAL_DEEPSEEK = 'openrouter/deepseek/deepseek-v3-legacy';
        writeConfig({ deepseek: LOCAL_DEEPSEEK });
        const out = runBench({ models: 'glm,gpt' });
        expect(out).toContain(`Notice: alias 'deepseek' resolves to ${LOCAL_DEEPSEEK}`);
      });

      // ⚠️ MEASURED: for a run that survives validation the critic is ALWAYS a
      // bench seat (cli-handlers-council-run.js rejects `--critic` outside
      // `--models`, and mcp-council-run.js enforces the same), so on a valid run
      // this name is a duplicate the audit's own de-dup removes. It is included
      // so the notice does not silently depend on a rule enforced in a different
      // file — hence the only fixture that can discriminate it is a critic
      // outside the bench, i.e. a run about to be rejected downstream.
      test('a --critic naming a shadowed alias notices', () => {
        writeConfig({ kimi: STALE_KIMI });
        const out = runBench({ models: 'glm,gpt', critic: 'kimi' });
        expect(out).toContain(`Notice: alias 'kimi' resolves to ${STALE_KIMI}`);
      });

      test('CONTROL: a shadowed bench seat still reports exactly one row, chair and critic clean', () => {
        writeConfig({ kimi: STALE_KIMI });
        const out = runBench({ models: 'kimi,glm', critic: 'kimi' });
        expect(out).toBe(`Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})\n`);
      });

      test('ABSENCE CONTROL: a clean chair and critic add nothing to a clean bench', () => {
        writeConfig({ kimi: CURATED.kimi, deepseek: CURATED.deepseek });
        expect(runBench({ models: 'kimi,glm', chair: 'deepseek', critic: 'kimi' })).toBe('');
      });
    });

    test('ABSENCE CONTROL: a REJECTED bench (both --models and --council) carries no bench, so nothing is noticed', () => {
      writeConfig({ kimi: STALE_KIMI });
      const writes = [];
      const origErr = process.stderr.write;
      process.stderr.write = (s) => { writes.push(String(s)); return true; };
      let res;
      try {
        res = require('../src/cli-council-run-bench').resolveBench({ models: 'kimi', council: 'budget' }, false);
      } finally {
        process.stderr.write = origErr;
      }
      expect(res.fail).toBeDefined();
      expect(res.bench).toBeUndefined();
      expect(writes.join('')).not.toContain('curated ships');
    });
  });
});
