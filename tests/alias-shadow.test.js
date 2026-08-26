// tests/alias-shadow.test.js
'use strict';

/**
 * v4.9 W13 Task B — the alias-shadow notice (BACKLOG C5, #129's own side
 * observation): a user-config alias may repoint a CURATED alias at a different
 * model, so per-model operating notes keyed on that alias silently describe a
 * model the alias no longer resolves to. The notice is pure self-diagnosis —
 * it changes no resolution, no exit code, no artifact.
 *
 * MEASURED SITES (delegated question, v4.9 W13 Task B). The plan asked for "the
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
 *     then `unref`), so the CLI site's line never reaches an MCP caller — it
 *     has to be read out of the run dir.
 *   - ⚠️ RESOLVED in PR #207 council round 2 (A1): round 1 left this as
 *     measure-and-document, the council re-raised it, and the notice now rides
 *     the MCP surface via a SECOND site —
 *     `mcp-council-bench.js :: auditBenchAliases`, called from
 *     `handleCouncilRunTool`. See that describe block below for the two levers
 *     that were measured and why the per-call `notices` array beat the
 *     per-process update-notice latch. The two sites are different SURFACES, not
 *     duplicates: the child still writes `debug.log`, the parent writes the tool
 *     result, and neither surface prints the line twice.
 *   - `config.js :: getEffectiveAliases` merges `{...DEFAULT_ALIASES,
 *     ...userAliases}`, so by the time anything downstream (`resolveModel`,
 *     `route-launch.js :: resolveRouteForLaunch`) sees an id, the two sources
 *     are already collapsed and the shadow is UNRECOVERABLE. The comparison has
 *     to read `loadConfig().aliases` and `toDefaultAliases()` separately — which
 *     is what `alias-shadow.js` does, and why it is its own leaf rather than a
 *     line inside the merge.
 *   - `mcp-council-bench.js :: resolveBenchInput` is the MCP-side bench twin,
 *     but the audit hangs off the HANDLER rather than off it, because only the
 *     handler holds the chair and the critic — and because `resolveBenchInput`
 *     returns an expanded `bench` on BOTH branches, so the handler seam covers
 *     every council_run call instead of the preset branch only.
 *
 * SIX named mutants. All red sets below were RE-MEASURED 2026-08-26 against the
 * PR #207 round-2 tree (post-merge with origin/main @ PR #204) at ONE shared
 * focused scope — 7 suites / 284 tests: this file plus
 * tests/no-output-backstop-wiring.test.js, tests/sidecar/fanout.test.js,
 * tests/council/run-stats-entry.test.js,
 * tests/scripts/council-review-workflow.test.js,
 * tests/sidecar/models-command.test.js, tests/cli-council-run.test.js.
 *
 * "SHADOWSILENT" — `src/utils/alias-shadow.js :: noteAliasShadows`, make the
 * emitter a no-op (an early `return;` after the writer and scope are bound, i.e.
 * the warning is computed and never spoken). RED: 17 tests / 2 suites.
 *   tests/alias-shadow.test.js            — 15 failed
 *     · emits the plan's exact line, one per shadowed alias
 *     · once per scope: a second resolution of the same alias stays quiet
 *     · no module-global latch: two scope-less calls each speak (B3)
 *     · the B1 absence control (a healthy writer still gets every line)
 *     · the default writer is stderr
 *     · a check that CANNOT run says so rather than degrading silently
 *     · a bare --models bench notices the shadow
 *     · two councils in ONE process each get their own audit (A5)
 *     · all four A6 chair/critic pins
 *     · all three A1 MCP-surface pins (bench, default chair, critic)
 *   tests/sidecar/models-command.test.js  — 2 failed
 *     · --check names a local alias that shadows a curated pin, on stderr
 *     · --check --json: the notice never enters the audit document on stdout
 * The `findAliasShadows` pins stay green under it BY DESIGN: they pin the
 * predicate, and the mutant kills only the speech act. That split is the point —
 * a silent degrade of a self-diagnosis feature is exactly the failure the
 * product principle forbids, so the speech act gets its own pins, and the
 * ABSENCE CONTROLS are the ones that stay green in BOTH directions.
 *
 * "WRITERFATAL" (PR #207 round 2, B1) — drop the try/catch inside
 * `alias-shadow.js :: safeWrite`, i.e. let a throwing writer escape again. RED:
 * 3 tests / 1 suite, all in this file — the loop-path throw, the failure-branch
 * throw, and the same through `auditAliasShadows`. Disjoint from SHADOWSILENT:
 * that mutant removes the speech, this one makes the speech lethal, and the B1
 * absence control is the fixture that stays green under WRITERFATAL and dies
 * under SHADOWSILENT, which is what keeps "swallow" from meaning "mute".
 *
 * "MCPMUTE" (PR #207 round 2, A1) — make
 * `mcp-council-bench.js :: auditBenchAliases` a no-op. RED: 3 tests / 1 suite —
 * the three MCP-surface pins. The three MCP ABSENCE CONTROLS (clean config,
 * untouched fenced body, rejected run) stay green in BOTH directions, so the
 * new surface is pinned as an ADDITION rather than as noise. Note the CLI
 * wiring pins do NOT move under it: the two surfaces are independent, which is
 * the property the finding asked for.
 *
 * "GATEWAYFORM" — `findAliasShadows`, replace the canonical comparison with a
 * raw `local === shipped`. RED: 2 tests / 1 suite, both in this file:
 *   · the same model in the other gateway form is NOT a shadow
 *   · this repo's own CI alias map raises only genuine model differences
 * Disjoint from SHADOWSILENT's set by construction: one mutant kills the speech,
 * the other kills the discrimination, and no test dies under both.
 *
 * "SCOPESTUCK" (PR #203 A5) — put the un-resettable per-process latch back.
 * ⚠️ RESTATED in PR #207 round 2 (B3): the mutation used to be "drop the
 * `spoken.clear()` from `auditAliasShadows`", and there is no `spoken.clear()`
 * to drop any more — the module-global Set is gone and the scope is a fresh
 * `new Set()` created per audit. The equivalent mutation is to hoist that Set to
 * module scope and share it across audits. RED: 1 test / 1 suite:
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

    // The scope is an explicit third argument (PR #207 round 2, B3 — it used to
    // be a module-global `spoken` Set). Two calls SHARING one scope still
    // collapse to one line per alias, which is what `auditAliasShadows` relies
    // on internally.
    test('once per scope: a second resolution of the same alias stays quiet', () => {
      writeConfig({ kimi: STALE_KIMI });
      const shadow = load();
      const writes = [];
      const scope = new Set();
      shadow.noteAliasShadows(['kimi'], (s) => writes.push(s), scope);
      shadow.noteAliasShadows(['kimi'], (s) => writes.push(s), scope);
      expect(writes).toHaveLength(1);
    });

    /**
     * PR #207 council round 2, B3 — no module-global dedup state.
     *
     * The old `spoken` Set lived at module scope and `auditAliasShadows` cleared
     * it wholesale, so the dedup of one caller was reachable (and erasable) by
     * every other caller in the process. Two scope-less calls are now two
     * independent scopes; nothing is carried between them.
     */
    test('no module-global latch: two scope-less calls each speak (B3)', () => {
      writeConfig({ kimi: STALE_KIMI });
      const shadow = load();
      const writes = [];
      shadow.noteAliasShadows(['kimi'], (s) => writes.push(s));
      shadow.noteAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes).toHaveLength(2);
    });

    /**
     * PR #207 council round 2, B1 — the 'never throws' contract covers the
     * WRITER too.
     *
     * The guard wrapped `findAliasShadows`, not the write, so an `out()` that
     * threw (a closed stderr / EPIPE, a caller-supplied collector that rejects)
     * escaped and killed the launch this diagnosis exists to protect — and on
     * the failure branch it escaped twice, because the catch block's own
     * announcement used the same broken writer. A notice must never sink the run
     * it diagnoses.
     */
    test('a writer that THROWS cannot kill the run it diagnoses (B1)', () => {
      writeConfig({ kimi: STALE_KIMI });
      const boom = () => { throw new Error('EPIPE: stderr is gone'); };
      expect(() => load().noteAliasShadows(['kimi'], boom)).not.toThrow();
    });

    test('a throwing writer cannot escape through the FAILURE branch either (B1)', () => {
      const boom = () => { throw new Error('EPIPE: stderr is gone'); };
      jest.doMock('../src/utils/config', () => ({ /* loadConfig missing */ }));
      try {
        const shadow = require('../src/utils/alias-shadow');
        expect(() => shadow.noteAliasShadows(['kimi'], boom)).not.toThrow();
      } finally {
        jest.dontMock('../src/utils/config');
      }
    });

    test('the wiring entry point is equally unkillable by a bad writer (B1)', () => {
      writeConfig({ kimi: STALE_KIMI });
      const boom = () => { throw new Error('EPIPE: stderr is gone'); };
      expect(() => load().auditAliasShadows(['kimi'], boom)).not.toThrow();
    });

    // ABSENCE CONTROL for B1: swallowing a writer throw must not swallow the
    // SPEECH — a working writer still gets every line.
    test('ABSENCE CONTROL: swallowing writer throws does not mute a healthy writer (B1)', () => {
      writeConfig({ kimi: STALE_KIMI });
      const writes = [];
      load().auditAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes).toEqual([
        `Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})\n`,
      ]);
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
     * The `spoken` set used to be MODULE scope (and PR #207 round 2's B3 has
     * since removed it entirely — `auditAliasShadows` now creates the Set it
     * passes, so the scope is a local, not a cleared global). A host process
     * that resolves two councils in a row (the CLI child is one run per
     * process, but the engine, the test suite and any programmatic host are
     * not) used to get the audit for the first and SILENCE for every one after
     * — the worst failure shape for a self-diagnosis feature, because it is
     * indistinguishable from "all clear". `resolveBench` opens a fresh notice
     * scope, so the set dedups WITHIN a run and never across runs.
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

  /**
   * PR #207 council round 2, finding A1 — THE MCP SURFACE.
   *
   * Round 1 (A4) measured that the notice reaches an MCP caller nowhere: the
   * council child's stderr is an fd on `<runDir>/debug.log`, so the CLI seam
   * above EXECUTES on the MCP path but SURFACES nothing. Round 1's disposition
   * was measure-and-document; the council re-raised it, so the notice now rides
   * the MCP surface too.
   *
   * MEASURED — two candidate levers, the more direct one taken:
   *   1. `utils/update-notice.js :: maybeAppendUpdateNotice`, wrapped around
   *      every handler at `mcp-server.js` registration. REJECTED: `_noticeShown`
   *      is a per-PROCESS latch, so it fires at most once for the whole server
   *      lifetime and attaches to whichever tool result happens to be first —
   *      a shadowed bench in the second `amicus_council_run` of a long-lived
   *      server would be SILENT. That is finding A5's defect re-introduced on a
   *      new surface, and the wrapper has no access to the resolved bench.
   *   2. `mcp-council-run.js :: handleCouncilRunTool`'s `notices` array —
   *      per-CALL, already assembled into the tool result as extra content
   *      blocks, and it sits directly after bench/chair/critic resolution where
   *      the exact audited name set is in hand. TAKEN. `resolveBenchInput`
   *      returns an EXPANDED `bench` on both its branches (preset and bare
   *      `models`), so auditing at the handler covers every council_run call
   *      rather than the preset branch only.
   *
   * The CLI surface is untouched and byte-identical — the parent writes into
   * `notices`, never to a stream, so a `--json` document stays clean and the
   * child keeps writing its own copy to `debug.log` exactly as before. The two
   * copies are on different surfaces, so no surface ever double-prints.
   */
  describe('wiring: mcp-council-run.js :: handleCouncilRunTool (the MCP surface, A1)', () => {
    /** An MCP council_run against the temp config dir, with the spawn stubbed out. */
    const runTool = async (extra = {}) => {
      const briefingFile = path.join(tempDir, 'briefing.md');
      fs.writeFileSync(briefingFile, 'Review this.');
      const { handleCouncilRunTool } = require('../src/mcp-council-run');
      const res = await handleCouncilRunTool(
        { briefingFile, models: ['glm', 'gpt'], ...extra },
        tempDir, { spawnFn: () => {}, clientName: 'claude-code' });
      return res.content.map(c => c.text);
    };

    test('a shadowed BENCH alias reaches the MCP caller as a content block', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const texts = await runTool({ models: ['kimi', 'glm'] });
      expect(texts.join('\n')).toContain(
        `Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})`);
    });

    // Parity with the CLI's A6 widening: chair and critic resolve through the
    // same table, so they are audited on this surface too.
    test('a shadowed DEFAULT chair reaches the MCP caller (A6 parity)', async () => {
      const LOCAL_DEEPSEEK = 'openrouter/deepseek/deepseek-v3-legacy';
      writeConfig({ deepseek: LOCAL_DEEPSEEK });
      const texts = await runTool();
      expect(texts.join('\n')).toContain(`Notice: alias 'deepseek' resolves to ${LOCAL_DEEPSEEK}`);
    });

    test('a shadowed --critic reaches the MCP caller (A6 parity)', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const texts = await runTool({ models: ['kimi', 'glm'], critic: 'kimi' });
      expect(texts.join('\n')).toContain(`Notice: alias 'kimi' resolves to ${STALE_KIMI}`);
    });

    // The notice is ADDITIVE: the fenced run document is still content[0] and
    // still says what it always said.
    test('the fenced council-run body is untouched — the notice is an extra block', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const texts = await runTool({ models: ['kimi', 'glm'] });
      expect(texts[0]).toContain('<untrusted_sidecar_output');
      expect(JSON.parse(texts[0].match(/\{[\s\S]*\}/)[0]).type).toBe('council-run');
      expect(texts[0]).not.toContain('curated ships');
    });

    /**
     * ABSENCE CONTROL — the byte-identical unshadowed control the finding asks
     * for. A clean config adds NO content block at all, so an ordinary MCP
     * council_run result is exactly what it was before this wiring.
     */
    test('ABSENCE CONTROL: a clean config yields the fenced body and nothing else', async () => {
      writeConfig({ glm: CURATED.glm, deepseek: CURATED.deepseek });
      const texts = await runTool();
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain('<untrusted_sidecar_output');
    });

    // A council_run REJECTED before bench resolution never audits — same
    // by-construction silence as the CLI's rejected-bench control above.
    test('ABSENCE CONTROL: a rejected council_run carries no notice', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const briefingFile = path.join(tempDir, 'briefing.md');
      fs.writeFileSync(briefingFile, 'Review this.');
      const { handleCouncilRunTool } = require('../src/mcp-council-run');
      const res = await handleCouncilRunTool(
        { briefingFile, models: ['kimi'], council: 'budget' },
        tempDir, { spawnFn: () => {}, clientName: 'claude-code' });
      expect(res.isError).toBe(true);
      expect(res.content.map(c => c.text).join('\n')).not.toContain('curated ships');
    });
  });

});
