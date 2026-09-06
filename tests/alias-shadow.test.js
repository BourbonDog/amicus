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
 * FOURTEEN named mutants. All red sets below were RE-MEASURED 2026-08-26 against
 * the PR #207 round-5 tree at ONE shared focused scope — 8 suites / 346 tests:
 * this file plus tests/no-output-backstop-wiring.test.js,
 * tests/sidecar/fanout.test.js, tests/council/run-stats-entry.test.js,
 * tests/council/runstats-byte-order.test.js,
 * tests/scripts/council-review-workflow.test.js,
 * tests/sidecar/models-command.test.js, tests/cli-council-run.test.js.
 * (Round 2 measured 7 suites / 284 tests, round 3 measured 8 / 323 and round 4
 * 8 / 330; runstats-byte-order.test.js joined the scope at round 3 and each
 * round added fixtures, so the TOTALS are not comparable — the per-mutant sets
 * are, and each is marked grown or unchanged.)
 *
 * ROUND 5 added four: "STREAMDEAF" and "THROWNRAW" below, plus "AUDITEARLY"
 * (A1 — put the MCP audit back above the remaining rejections; RED 2 tests / 1
 * suite, both in this file: the critic+lenses and lens-count rejection pins. The
 * accepted-call control stays GREEN, which is what keeps "never computed on a
 * rejection" from being satisfied by never computing at all) and "MCPNEWLINE"
 * (D3 — push the stderr-shaped line into the MCP notices array untrimmed; RED
 * 1 test / 1 suite).
 *
 * "SHADOWSILENT" — `src/utils/alias-shadow.js :: noteAliasShadows`, make the
 * emitter a no-op (an early `return;` after the writer and scope are bound, i.e.
 * the warning is computed and never spoken). RED: 36 tests / 2 suites — GROWN
 * from round 4's 31 by five round-5 fixtures (the two C1 hostile-thrown pins and
 * its byte-identical control, the A1 accepted-call control, and the D3 newline
 * pin — all five assert a line was actually produced). Every one asserts a line
 * was actually produced; the A1 hostile-NAME control is the round-4 fixture that
 * does NOT die, because a name that cannot become a row cannot become a line
 * either, and round 5's own arming fixtures do not die because they never emit
 * a notice at all.
 *   tests/alias-shadow.test.js            — 34 failed
 *     · emits the plan's exact line, one per shadowed alias
 *     · once per scope: a second resolution of the same alias stays quiet
 *     · no module-global latch: two scope-less calls each speak (B3)
 *     · the B1 absence control (a healthy writer still gets every line)
 *     · the default writer is stderr
 *     · a check that CANNOT run says so rather than degrading silently
 *     · all five round-3 A1 async-failure fixtures (round 4's cross-registry
 *       pin joined that describe block)
 *     · all five round-3 B1 failure-branch fixtures
 *     · four of the five round-4 A1 sanitizing fixtures
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
 * ABSENCE CONTROLS are the ones that stay green in BOTH directions. ⚠️ FOUR
 * fixtures LABELLED "ABSENCE CONTROL" do die here (round 3 counted two of them;
 * re-counted against the measurement at round 4): the healthy-writer control,
 * the injected-writer control, the real-Error control and round 4's
 * byte-identical-rendering control. Every one is a control for OVER-REACH — of
 * the writer guard, the stream arming, the message hardening, the sanitizer —
 * not a control for silence, and each carries a positive "…and the line was
 * still produced" assertion, which is exactly what SHADOWSILENT removes.
 *
 * "WRITERFATAL" (PR #207 round 2, B1) — drop the try/catch inside
 * `alias-shadow-writer.js :: safeWrite`, i.e. let a SYNCHRONOUSLY throwing writer
 * escape again. RED: 3 tests / 1 suite, all in this file — the loop-path throw,
 * the failure-branch throw, and the same through `auditAliasShadows`.
 * RE-MEASURED at rounds 3 and 4: UNCHANGED. Disjoint from SHADOWSILENT (that mutant
 * removes the speech, this one makes the speech lethal), and disjoint from
 * STREAMFATAL below, which is the ASYNCHRONOUS half of the same contract — no
 * fixture dies under both, which is what proves the two failure modes are
 * separately defended. The B1 absence control is the fixture that stays green
 * under WRITERFATAL and dies under SHADOWSILENT, which is what keeps "swallow"
 * from meaning "mute".
 *
 * "STREAMFATAL" (PR #207 round 3, A1) — drop the `armStream(stream)` call from
 * `alias-shadow-writer.js`'s default stderr writer, i.e. stop attaching the
 * 'error' handler at all. RED: 4 tests / 1 suite, all in this file — UNCHANGED
 * at round 5, whose own fixtures call `armStream` DIRECTLY and so cannot notice
 * that the default writer stopped calling it. GROWN at round 4 from round 3's 3
 * by the cross-registry pin, which counts listeners and so
 * dies at zero as readily as at two. The set is the later-turn failure, the
 * second later-turn failure (which is what forbids `once`), the attach-once pin
 * and the cross-registry pin. The measured Node contract this defends, and why
 * a write callback is NOT a substitute for it, is recorded on `armStream`
 * itself and in the describe block below. The injected-writer control stays
 * green in BOTH directions, so the arming is pinned as an addition rather than
 * as a process-wide side effect. ⚠️ The round-4 META-PIN stays GREEN under this
 * mutant on purpose: it is an upper bound ("at most one"), so removing the
 * arming satisfies it. It is the pin for accumulation, not for absence.
 *
 * "ARMPERMODULE" (PR #207 round 4, B1) — put the module-scoped `WeakSet` back in
 * place of the stream-keyed `Symbol.for` marker, i.e. make "attach once" mean
 * once per MODULE INSTANCE again. RED: 2 tests / 1 suite, both in this file —
 * the cross-registry pin and the suite-wide meta-pin (which measured SEVEN
 * accumulated listeners on the real `process.stderr` before the fix, exactly
 * the count the finding predicted). Disjoint from STREAMFATAL in one direction:
 * every round-3 A1 fixture stays green here, because the handler IS attached —
 * just too many times.
 *
 * "NOTICERAW" (PR #207 round 4, A1) — interpolate the config-sourced fragments
 * into `formatAliasShadow`'s template unsanitized. RED: 3 tests / 1 suite — the
 * CLI hostile-value pin, the MCP hostile-value pin and the length bound. The
 * byte-identical control stays GREEN, which is the whole point of it: the
 * sanitizer is a pass over hostile bytes, not a reformatting of the notice.
 *
 * "STREAMDEAF" (PR #207 round 5, A3+B2+D1+C2) — put `armStream`'s PURE no-op
 * handler back, so the arming swallows every error class again instead of only
 * the benign one. RED: 4 tests / 1 suite, all in this file — the non-EPIPE
 * report, the bounded-report pin, the code-less error and the default-seam
 * wiring pin. The three benign-class controls and both never-re-raises controls
 * stay GREEN in both directions, which is what pins the change as a widening of
 * what the handler SAYS rather than a change to what it SURVIVES. Disjoint from
 * STREAMFATAL: that one removes the handler, this one removes its judgement.
 *
 * "THROWNRAW" (PR #207 round 5, C1) — return `describeThrown`'s `String(...)`
 * without the sanitizing pass, leaving the FAILURE line raw and unbounded. RED:
 * 2 tests / 1 suite — the CLI hostile-thrown pin and the MCP one. The
 * byte-identical control stays GREEN, and so do all four round-3 B1 fixtures:
 * the pass is over hostile bytes, not a reformatting of the notice, which is the
 * same split round 4's NOTICERAW carries one function away.
 *
 * "MESSAGERAW" (PR #207 round 3, B1) — interpolate `err.message` straight into
 * the failure line again, evaluating it before `safeWrite` can guard anything.
 * RED: 5 tests / 1 suite — GROWN from 3 at round 5 by the two C1 hostile-thrown
 * pins, which this mutant kills by bypassing `describeThrown` (and therefore its
 * sanitizer) altogether. The set is the thrown null, the thrown undefined, the
 * thrown bare string and those two.
 * ⚠️ The fourth B1 fixture ("a thrown value with NO printable form") stays GREEN
 * under MESSAGERAW, and that is deliberate: it is the pin for the OTHER wrong
 * fix. MEASURED against a `describeThrown` with no try/catch — the obvious
 * repair, and the one the finding itself suggested — that fixture is the ONLY
 * failure in the whole scope (re-measured at round 5 against the sanitizing
 * body: still the only one, now out of 346).
 * `String(Object.create(null))` throws, so the naive
 * repair moves the escape rather than closing it. Do not thin that fixture.
 *
 * "MCPMUTE" (PR #207 round 2, A1) — make
 * `mcp-council-bench.js :: auditBenchAliases` a no-op. RED: 7 tests / 1 suite —
 * GROWN from round 4's 4 by three round-5 fixtures (the C1 MCP hostile-thrown
 * pin, the A1 accepted-call control and the D3 newline pin), all of which reach
 * the notices array through this same site. The set is the three MCP-surface
 * pins, round 4's hostile-value pin and those three. ⚠️ The two A1 REJECTION
 * pins stay green under it by construction: they assert the site is never
 * CALLED, and this mutant empties the site rather than removing the call. The
 * three MCP ABSENCE CONTROLS (clean config, untouched fenced
 * body, rejected run) stay green in BOTH directions, so the new surface is
 * pinned as an ADDITION rather than as noise. Note the CLI wiring pins do NOT
 * move under it: the two surfaces are independent, which is the property the
 * finding asked for — and the round-4 A1 pins carry that same split, one
 * fixture per surface rather than one fixture trusted for both.
 *
 * "GATEWAYFORM" — `findAliasShadows`, replace the canonical comparison with a
 * raw `local === shipped`. RED: 2 tests / 1 suite, both in this file
 * (RE-MEASURED at rounds 3 and 4: unchanged):
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
 * module scope and share it across audits. RED: 2 tests / 1 suite — GROWN from
 * 1 at round 3 (round 4: unchanged), because the attach-once fixture audits twice and counts the
 * lines:
 *   · two councils in ONE process each get their own audit (PR #203 A5)
 *   · ATTACH-ONCE: repeated audits do not stack handlers on the stream (A1)
 * Every other speech pin stays green — the latch only ever silences the SECOND
 * run, which is exactly why one dedicated fixture had to exist.
 *
 * "SEATSBLIND" (PR #203 A6) — audit `res.bench` alone again, dropping the chair
 * and critic from the name list. RED: 3 tests / 1 suite (RE-MEASURED at rounds 3 and 4:
 * unchanged) — the explicit --chair pin, the DEFAULT-chair pin and the --critic
 * pin. The two A6 controls stay green in both directions, so the widening is
 * pinned as an ADDITION rather than as noise.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { toDefaultAliases } = require('../src/utils/curated-models');

/** Round 4, B1: whatever this worker already had, BEFORE any fixture ran. Read
 *  at module load so the meta-pin at the bottom measures THIS file's footprint
 *  on the real stream rather than the worker's history. */
const STDERR_ERROR_LISTENERS_AT_LOAD = process.stderr.listenerCount('error');

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
      // gpt. That must be silent; a map entry naming a DIFFERENT model (glm and
      // qwen, deliberately off the shipped pins; deepseek, benched on
      // v4-flash-0731 where the shipped table pins v4-pro) must not be.
      const map = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '.github', 'amicus-ci-aliases.json'), 'utf-8'));
      writeConfig(map.aliases);
      const shadows = load().findAliasShadows(Object.keys(map.aliases));
      const { stripGatewayPrefix } = require('../src/utils/curated-models');
      for (const s of shadows) {
        expect(stripGatewayPrefix(s.local)).not.toBe(stripGatewayPrefix(s.curated));
      }
      expect(shadows.map(s => s.alias)).not.toContain('gpt');
      expect(shadows.map(s => s.alias)).toContain('deepseek');
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

    // ⚠️ PR #207 round 3, B2 renamed this. It used to read "…inspects every
    // configured alias", which is what the docstring claimed and what the
    // fixture had ALREADY disproved: `my-local` is configured, is inspected by
    // nobody, and never could be — it has no curated twin to stand in front of.
    test('omitting the names inspects every CURATED alias, reporting the configured ones', () => {
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

    /**
     * PR #207 council round 3, B2 — the CONTROL for the docstring's true scope.
     *
     * `findAliasShadows` with no names iterates the CURATED keys and reports the
     * ones the user has also configured — it does NOT iterate "every alias the
     * user has configured", which is what the docstring used to claim. The
     * narrower scope is the CORRECT one: a shadow requires a curated twin by
     * definition, and a purely local alias has nothing to shadow. The predicate
     * side of that is pinned above; this is the SPEECH side, so the honest
     * behaviour is pinned rather than implied by the prose.
     */
    test('ABSENCE CONTROL: a purely-local alias is silent in the omit-names scope too (B2)', () => {
      writeConfig({ 'my-local': 'openrouter/vendor/whatever', 'also-mine': 'x/y/z' });
      const writes = [];
      load().auditAliasShadows(undefined, (s) => writes.push(s));
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

  /**
   * PR #207 council round 3, A1 — the ASYNCHRONOUS half of "never fatal".
   *
   * Round 2's `safeWrite` try/catch covers only a writer that throws
   * SYNCHRONOUSLY. MEASURED against a real closed pipe (node v24.18.0, Windows;
   * parent spawns a child with `stdio: ['ignore','ignore','pipe']` and destroys
   * the read end, child writes to `process.stderr`):
   *
   *   | shape                              | outcome                              |
   *   |------------------------------------|--------------------------------------|
   *   | `write(line)`                      | returns FALSE, throws nothing; EPIPE  |
   *   |                                    | lands a turn later as an unhandled    |
   *   |                                    | 'error' -> uncaughtException, exit 7  |
   *   | `write(line, cb)`                  | cb receives EPIPE **and** 'error'     |
   *   |                                    | still emits unhandled -> exit 7       |
   *   | attach 'error', write, detach      | detach wins the race; the error lands |
   *   |                                    | with 0 listeners -> exit 7            |
   *   | persistent `on('error', noop)`     | absorbed, process survives; a SECOND  |
   *   |                                    | write emits a SECOND 'error'          |
   *
   * Three consequences, each pinned below. (1) A write callback is NOT the fix —
   * it observes the error without disarming the unhandled-'error' throw. (2) A
   * scoped attach/detach is not merely racy, it is always wrong: delivery is
   * always on a later turn. (3) The handler must be `on`, not `once` — a second
   * notice raises a second event.
   *
   * The stub below reproduces exactly that shape: `write()` succeeds
   * synchronously, then emits 'error' on a later turn. `emit('error')` with no
   * listener THROWS (EventEmitter's documented behaviour) — the stub catches that
   * throw into `fatal`, standing in for the process-fatal uncaughtException the
   * real pipe produced, so the pin can assert on it instead of killing the worker.
   *
   * Named mutant "STREAMFATAL" — drop the attach-once 'error' arming from
   * `alias-shadow.js`'s default stderr writer. Disjoint from WRITERFATAL: that
   * one restores the SYNCHRONOUS throw path, this one the asynchronous one, and
   * no fixture dies under both.
   */
  describe('the notice survives an ASYNCHRONOUS stderr failure (round 3, A1)', () => {
    const { EventEmitter } = require('events');

    let realStderrDesc;
    let stub;

    /** A stderr whose write() succeeds now and fails on a later turn. */
    function asyncFailingStderr() {
      const s = new EventEmitter();
      s.written = [];
      s.fatal = [];
      s.pending = [];
      s.write = (line) => {
        s.written.push(String(line));
        s.pending.push(new Promise((resolve) => setImmediate(() => {
          const epipe = Object.assign(new Error('EPIPE: broken pipe, write'), { code: 'EPIPE' });
          try { s.emit('error', epipe); } catch (e) { s.fatal.push(e); }
          resolve();
        })));
        return false; // measured: a failing pipe returns false, it does not throw
      };
      return s;
    }

    beforeEach(() => {
      realStderrDesc = Object.getOwnPropertyDescriptor(process, 'stderr');
      stub = asyncFailingStderr();
      Object.defineProperty(process, 'stderr', { value: stub, configurable: true });
    });

    afterEach(() => { Object.defineProperty(process, 'stderr', realStderrDesc); });

    test('a stream that fails on a LATER turn cannot kill the run it diagnoses (A1)', async () => {
      writeConfig({ kimi: STALE_KIMI });
      // The synchronous half survives on its own — that is round 2's guard, and
      // it is exactly why this defect was invisible.
      expect(() => load().noteAliasShadows(['kimi'])).not.toThrow();
      await Promise.all(stub.pending); // ...and the async turn the EPIPE lands on
      expect(stub.written.join('')).toContain("alias 'kimi' resolves to");
      expect(stub.fatal).toEqual([]);
    });

    test('a SECOND async failure is absorbed too — the handler is not a one-shot (A1)', async () => {
      writeConfig({ kimi: STALE_KIMI, glm: 'openrouter/z-ai/glm-not-the-shipped-one' });
      load().auditAliasShadows(['kimi', 'glm']);
      await Promise.all(stub.pending);
      expect(stub.written).toHaveLength(2);
      expect(stub.fatal).toEqual([]);
    });

    test('ATTACH-ONCE: repeated audits do not stack handlers on the stream (A1)', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const shadow = load();
      shadow.auditAliasShadows(['kimi']);
      shadow.auditAliasShadows(['kimi']);
      await Promise.all(stub.pending);
      expect(stub.written).toHaveLength(2); // two audits, two notices — still spoken
      expect(stub.listenerCount('error')).toBe(1);
      expect(stub.fatal).toEqual([]);
    });

    // ABSENCE CONTROL: the arming is scoped to the module's OWN default writer.
    // An injected writer (every test collector, and the MCP notices array) must
    // leave the process's stderr completely untouched — no write, no listener.
    test('ABSENCE CONTROL: an INJECTED writer leaves the stream alone entirely (A1)', () => {
      writeConfig({ kimi: STALE_KIMI });
      const writes = [];
      load().auditAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes).toHaveLength(1);
      expect(stub.written).toEqual([]);
      expect(stub.listenerCount('error')).toBe(0);
    });

    /**
     * PR #207 council round 4, B1 — "attach once" must mean once per STREAM, not
     * once per MODULE INSTANCE.
     *
     * The marker used to be a module-scoped WeakSet, so a fresh module registry
     * carried a fresh, empty one: the SAME stream got a second listener, a third,
     * and so on, one per `jest.resetModules()` that reaches a default-writer
     * fixture. Nothing in production resets a registry, but the hazard is not
     * hypothetical here — this suite alone is measured at the bottom of the file,
     * against Node's 10-listener MaxListenersExceededWarning, which is emitted
     * ASYNCHRONOUSLY onto `process.stderr.write`: the very method the absence
     * controls in this file replace and exact-match on.
     *
     * The pin is the ONE listener, not the mechanism — but it is only meaningful
     * if the two instances really are two, so that is asserted first.
     */
    test('ARM-ONCE spans module registries: two instances, one listener (round 4, B1)', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const first = load();
      jest.resetModules();
      const second = require('../src/utils/alias-shadow');
      expect(second).not.toBe(first); // two genuinely separate module instances
      first.auditAliasShadows(['kimi']);
      second.auditAliasShadows(['kimi']);
      await Promise.all(stub.pending);
      expect(stub.written).toHaveLength(2); // both instances still speak
      expect(stub.listenerCount('error')).toBe(1);
      expect(stub.fatal).toEqual([]);
    });
  });

  /**
   * PR #207 council round 5 — A3 + B2 + D1, and the CONTESTED C2: three raisers,
   * one mechanism. The arming listener has to be HONEST, not merely quiet.
   *
   * Round 3 (A1) bought the right thing — an unhandled 'error' on stderr is an
   * uncaughtException, and a CLI writing an advisory line into `| head` must not
   * die of it — but it paid with a PURE NO-OP handler. Attaching one is a
   * PROCESS-WIDE change: from the first notice onward, EVERY future 'error' on
   * `process.stderr`, raised by any producer anywhere in the process, lands in
   * this handler and is discarded. Sharpest in the long-lived MCP server, which
   * imports this in-tree and outlives every individual run. That is the exact
   * correct-but-SILENT degrade the product principle forbids.
   *
   * The round-4 measurement stands and is NOT relitigated here: scoped
   * attach/detach always loses (delivery is on a later turn, so the detach always
   * wins) and a write callback observes the failure without disarming it. So the
   * arming stays; what changes is what the handler DOES.
   *
   * ⚠️ MEASURED, and it is why the self-report is bounded: `utils/logger.js`
   * writes through `console.error`, i.e. onto `process.stderr` — the SAME stream
   * that just failed. (Its own header says so: "Outputs JSON-formatted logs to
   * stderr".) An unbounded report would therefore be able to provoke the next
   * 'error', handle it, report again, and spin the event loop forever. Hence: at
   * most ONE report per stream, wrapped, and never a re-raise.
   *
   * Named mutant "STREAMDEAF" — put the pure no-op handler back
   * (`stream.on('error', () => {})`), i.e. swallow every class silently again.
   */
  describe('the arming listener swallows only the BENIGN class (round 5, A3/B2/D1/C2)', () => {
    const { EventEmitter } = require('events');

    /** A stream error as Node raises one: an Error carrying a `code`. */
    const streamError = (code, message = `${code}: stream failed, write`) =>
      Object.assign(new Error(message), { code });

    /** A bare armable stream plus the reports its logger seam received. */
    function armed() {
      const { armStream } = require('../src/utils/alias-shadow-writer');
      const stream = new EventEmitter();
      const reports = [];
      armStream(stream, (msg, ctx) => reports.push({ msg, ctx }));
      return { stream, reports };
    }

    test('a NON-EPIPE stderr error reaches the logger seam instead of vanishing', () => {
      const { stream, reports } = armed();
      stream.emit('error', streamError('ENOSPC', 'ENOSPC: no space left on device, write'));
      expect(reports).toHaveLength(1);
      expect(JSON.stringify(reports[0])).toContain('ENOSPC');
    });

    /**
     * The bound is the whole reason this can report at all — see the ⚠️ above.
     * Two DIFFERENT codes, so this cannot pass by de-duplicating on the code.
     */
    test('the self-report is BOUNDED: a second non-EPIPE error does not re-report', () => {
      const { stream, reports } = armed();
      stream.emit('error', streamError('ENOSPC'));
      stream.emit('error', streamError('ECONNRESET'));
      expect(reports).toHaveLength(1);
    });

    test.each([['EPIPE'], ['EOF'], ['ERR_STREAM_DESTROYED']])(
      'ABSENCE CONTROL: %s stays silent — the benign class this feature exists to survive',
      (code) => {
        const { stream, reports } = armed();
        expect(() => stream.emit('error', streamError(code))).not.toThrow();
        expect(reports).toEqual([]);
      });

    // The round-3 contract, unchanged by the round-5 widening: NEITHER class may
    // re-raise. This is the fixture that keeps "speak up" from meaning "throw".
    test('ABSENCE CONTROL: nothing ever re-raises — neither class escapes the handler', () => {
      const { stream } = armed();
      expect(() => stream.emit('error', streamError('EPIPE'))).not.toThrow();
      expect(() => stream.emit('error', streamError('ENOSPC'))).not.toThrow();
    });

    // A code-less throw is not the benign class (nothing says it is), so it is
    // reported — and reporting it must not become the next failure either.
    test('an error with NO code is reported, not assumed benign', () => {
      const { stream, reports } = armed();
      expect(() => stream.emit('error', new Error('bare'))).not.toThrow();
      expect(reports).toHaveLength(1);
    });

    test('a THROWING logger seam cannot sink the run it is diagnosing', () => {
      const { armStream } = require('../src/utils/alias-shadow-writer');
      const stream = new EventEmitter();
      armStream(stream, () => { throw new Error('logger exploded'); });
      expect(() => stream.emit('error', streamError('ENOSPC'))).not.toThrow();
    });

    /**
     * WIRING: the default seam is the HOUSE logger, not a second private one.
     * The `finally` is not decoration — it is the lesson of round 5's A2, in the
     * same suite run: a mock left installed by a throwing body leaks into every
     * later test in the file.
     */
    test('the DEFAULT seam is the house logger (utils/logger.js)', () => {
      const error = jest.fn();
      jest.doMock('../src/utils/logger', () => ({
        logger: { error, warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
        LOG_LEVELS: { error: 0, warn: 1, info: 2, debug: 3 },
      }));
      try {
        const { armStream } = require('../src/utils/alias-shadow-writer');
        const stream = new EventEmitter();
        armStream(stream);
        stream.emit('error', streamError('ENOSPC'));
        expect(error).toHaveBeenCalledTimes(1);
      } finally {
        jest.dontMock('../src/utils/logger');
      }
    });
  });

  /**
   * PR #207 council round 3, B1 — the failure branch must survive what it caught.
   *
   * The catch block built its line with a template literal, so `${err.message}`
   * was evaluated BEFORE `safeWrite` ever ran: a thrown `null`/`undefined` raised
   * a fresh TypeError inside the catch and escaped `noteAliasShadows` entirely —
   * the very failure round 2's guard exists to prevent, re-entering through the
   * guard's own announcement. A thrown bare string was the quieter half: strings
   * carry no `.message`, so a real reason printed as `(undefined)`.
   *
   * ⚠️ `String(x)` is itself not total (MEASURED: `String(Object.create(null))`
   * throws `TypeError: Cannot convert object to primitive value`), so the
   * extraction is guarded rather than merely defensive. Nothing in this catch may
   * throw, including the code that describes the throw.
   *
   * Named mutant "MESSAGERAW" — put the bare `${err.message}` template back.
   */
  describe('the failure branch describes what was thrown (round 3, B1)', () => {
    /** Drive the catch branch with an arbitrary thrown value. */
    function noteWithThrow(thrown) {
      const writes = [];
      jest.doMock('../src/utils/config', () => ({ loadConfig: () => { throw thrown; } }));
      try {
        const shadow = require('../src/utils/alias-shadow');
        expect(() => shadow.noteAliasShadows(['kimi'], (s) => writes.push(s))).not.toThrow();
      } finally { jest.dontMock('../src/utils/config'); }
      return writes;
    }

    const PREFIX = 'could not check whether local aliases shadow the curated table';

    test('a thrown NULL is announced, not turned into a TypeError inside the catch', () => {
      const writes = noteWithThrow(null);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain(PREFIX);
      expect(writes[0]).toContain('(null)');
    });

    test('a thrown UNDEFINED is announced too', () => {
      const writes = noteWithThrow(undefined);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('(undefined)');
    });

    test('a thrown bare STRING renders the string itself, never "(undefined)"', () => {
      const writes = noteWithThrow('config.json is a directory');
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('(config.json is a directory)');
      expect(writes[0]).not.toContain('(undefined)');
    });

    test('a thrown value with NO printable form still cannot escape (String() itself throws)', () => {
      const writes = noteWithThrow(Object.create(null));
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain(PREFIX);
    });

    // ABSENCE CONTROL: the ordinary case is unchanged — a real Error still
    // reports its own message, so the hardening did not cost the diagnosis.
    test('ABSENCE CONTROL: a real Error still reports its own message verbatim', () => {
      const writes = noteWithThrow(new Error('EACCES: permission denied'));
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('(EACCES: permission denied)');
    });

    /**
     * PR #207 council round 5, C1 — round 4 sanitized the SHADOW notice's
     * fragments and left the FAILURE notice's raw.
     *
     * `describeThrown`'s result is interpolated straight into a line that
     * reaches a terminal AND an MCP tool result, and the thrown value is not
     * house data: it carries a provider's text, a filesystem path, or (the case
     * that actually motivated round 4) a config file the user controls. Same
     * hole, same surfaces, one describe later.
     *
     * THE CAP, picked and recorded: the house default, 200
     * (`text-sanitize.js :: MAX_EXCERPT_CHARS`), NOT `alias-shadow.js`'s
     * 64-char fragment cap. A fragment is a MODEL ID — measured longest 39 — so
     * 64 bounds it with room to spare. A thrown error's message is a SENTENCE:
     * `EACCES: permission denied, open 'C:\\Users\\…\\config.json'` already runs
     * past 64, and clipping it there would bound the payload by destroying the
     * diagnosis. 200 is the cap `text-sanitize.js` documents as "long enough for
     * a real engine error", and it leaves this composed line the same order of
     * magnitude as the shadow line's three 64-char fragments.
     *
     * Named mutant "THROWNRAW" — return `describeThrown`'s `String(...)` without
     * the sanitizing pass.
     */
    describe('...and neutralizes it, on both surfaces (round 5, C1)', () => {
      const { MAX_EXCERPT_CHARS } = require('../src/utils/text-sanitize');
      // ANSI colour + a forged second "Notice:" line + a right-to-left override,
      // then padded past the cap: every rule at once, on one thrown message.
      const HOSTILE_MESSAGE = "EACCES \u001b[31mred\u001b[0m\nNotice: alias 'gpt' resolves"
        + ` to totally/legit\u202eDROW ${'z'.repeat(500)}`;

      /** Every rendering rule the failure line owes, on one string. */
      function expectNeutralized(line) {
        expect(line).not.toContain('\u001b');                     // no escape sequences
        expect(line).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/); // no bidi reordering
        expect(line.slice(0, -1)).not.toMatch(/[\n\r]/);          // one line: only the trailing \n
        expect(line).toMatch(/^Notice: could not check .*\(.*\)\n$/);
        // ...and BOUNDED: the quoted reason cannot be the whole payload.
        expect(line.match(/\(([\s\S]*)\)\n$/)[1].length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS);
      }

      test('a hostile thrown message reaches the CLI writer neutralized and bounded', () => {
        const writes = noteWithThrow(new Error(HOSTILE_MESSAGE));
        expect(writes).toHaveLength(1);
        expectNeutralized(writes[0]);
        // ...and it still diagnoses: the surviving text, not just its absence.
        expect(writes[0]).toContain('EACCES');
      });

      test('a hostile thrown message reaches the MCP notices array neutralized and bounded', async () => {
        const briefingFile = path.join(tempDir, 'briefing.md');
        fs.writeFileSync(briefingFile, 'Review this.');
        // Only `loadConfig` throws — the handler's other config consumers
        // (resolveCouncilMembers, getWorkspaceAutoOpen) stay real.
        jest.doMock('../src/utils/config', () => ({
          ...jest.requireActual('../src/utils/config'),
          loadConfig: () => { throw new Error(HOSTILE_MESSAGE); },
        }));
        let res;
        try {
          const { handleCouncilRunTool } = require('../src/mcp-council-run');
          res = await handleCouncilRunTool(
            { briefingFile, models: ['kimi', 'glm'] },
            tempDir, { spawnFn: () => {}, clientName: 'claude-code' });
        } finally { jest.dontMock('../src/utils/config'); }
        const notice = res.content.map(c => c.text).find(t => t.includes('could not check'));
        expect(notice).toBeDefined();
        expectNeutralized(notice.endsWith('\n') ? notice : `${notice}\n`);
      });

      /**
       * ABSENCE CONTROL, and the point of the whole pass: an ordinary reason is
       * rendered BYTE-IDENTICALLY. The sanitizer is a pass over hostile bytes,
       * not a reformatting of the notice — the four round-3 B1 fixtures above
       * (null/undefined/bare string/unprintable) are the rest of that control,
       * and every one of them stays green under this change.
       */
      test('ABSENCE CONTROL: an ordinary reason is rendered byte-identically', () => {
        const writes = noteWithThrow(new Error('EACCES: permission denied'));
        expect(writes[0]).toBe(
          'Notice: could not check whether local aliases shadow the curated table '
          + '(EACCES: permission denied)\n');
      });
    });
  });

  /**
   * PR #207 council round 4, A1 — the notice quotes the USER'S CONFIG FILE, so
   * every fragment of it is third-party text on its way to a terminal and to an
   * MCP client.
   *
   * MEASURED, which fragment is actually hostile-capable:
   *   · `local` — a raw `config.json` VALUE, arbitrary bytes. THE hole.
   *   · `alias` — user-supplied too, but a row exists only when the name is
   *     byte-identical to a curated key (`curated[alias]` must be a string, on a
   *     null-prototype table), and all 21 curated names measure
   *     `/^[a-z0-9.-]+$/`. So an escape-carrying NAME can never reach the line;
   *     the pin for that is the absence control below, not a neutralization pin.
   *   · `curated` — the shipped table, house data.
   * All three are sanitized anyway: the guarantee "this notice is one line, and
   * its structure is ours" should not rest on that chain of reasoning staying
   * true after the curated table changes.
   *
   * FRAGMENTS, not the composed line: `collapseExcerpt` trims and caps, so
   * running the whole line through it would eat the trailing newline the writers
   * depend on and could clip `(curated ships …)` off the end — sanitizing the
   * values keeps the quotes, the parens and the newline, which are ours.
   *
   * Named mutant "NOTICERAW" — interpolate `s.alias`/`s.local`/`s.curated`
   * straight into the template again.
   */
  describe('the notice neutralizes what it quotes (round 4, A1)', () => {
    // ANSI colour + a forged second "Notice:" line + a right-to-left override.
    const HOSTILE = "openrouter/x/\u001b[31mred\u001b[0m\nNotice: alias 'gpt' resolves to totally/legit\u202eDROW";

    /** Every rendering rule the sanitizer owes this line, on one string. */
    function expectNeutralized(line) {
      expect(line).not.toContain('\u001b');                     // no escape sequences
      expect(line).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/); // no bidi reordering
      expect(line.slice(0, -1)).not.toMatch(/[\n\r]/);          // one line: only the trailing \n
      expect(line.endsWith('\n')).toBe(true);
      expect(line).toMatch(/^Notice: alias 'kimi' resolves to .* \(curated ships .*\)\n$/);
    }

    test('a hostile config VALUE reaches the CLI writer neutralized', () => {
      writeConfig({ kimi: HOSTILE });
      const writes = [];
      load().auditAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes).toHaveLength(1);
      expectNeutralized(writes[0]);
      // ...and it still says something: the surviving text, not just its absence.
      expect(writes[0]).toContain('openrouter/x/red');
    });

    test('a hostile config VALUE reaches the MCP notices array neutralized', async () => {
      writeConfig({ kimi: HOSTILE });
      const briefingFile = path.join(tempDir, 'briefing.md');
      fs.writeFileSync(briefingFile, 'Review this.');
      const { handleCouncilRunTool } = require('../src/mcp-council-run');
      const res = await handleCouncilRunTool(
        { briefingFile, models: ['kimi', 'glm'] },
        tempDir, { spawnFn: () => {}, clientName: 'claude-code' });
      const notice = res.content.map(c => c.text).find(t => t.includes('curated ships'));
      expect(notice).toBeDefined();
      expectNeutralized(notice.endsWith('\n') ? notice : `${notice}\n`);
    });

    // A value long enough to be a payload rather than a model id is bounded,
    // the same caller convention `engine-skew.js :: safeVersion` uses.
    test('an over-long config VALUE is bounded, not pasted whole', () => {
      writeConfig({ kimi: `openrouter/x/${'z'.repeat(400)}` });
      const writes = [];
      load().auditAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes[0].length).toBeLessThan(200);
      expect(writes[0]).toContain('…');
    });

    /**
     * ABSENCE CONTROL — the byte-identical clean case. An ordinary shadow must
     * render EXACTLY the string it rendered before this hardening: the sanitizer
     * is a pass over hostile bytes, not a reformatting of the notice.
     */
    test('ABSENCE CONTROL: an ordinary shadow renders byte-identically', () => {
      writeConfig({ kimi: STALE_KIMI });
      const writes = [];
      load().auditAliasShadows(['kimi'], (s) => writes.push(s));
      expect(writes).toEqual([
        `Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})\n`,
      ]);
    });

    /**
     * ABSENCE CONTROL for the measurement above: a hostile alias NAME is not a
     * sanitization case, it is a no-row case. `\u001b[31mkimi` is not a curated
     * key, so it has nothing to shadow and never becomes a line at all.
     */
    test('ABSENCE CONTROL: a hostile alias NAME produces no row to sanitize', () => {
      writeConfig({ '\u001b[31mkimi': STALE_KIMI });
      const writes = [];
      load().auditAliasShadows(['\u001b[31mkimi'], (s) => writes.push(s));
      expect(load().findAliasShadows(['\u001b[31mkimi'])).toEqual([]);
      expect(writes).toEqual([]);
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

    /**
     * PR #207 council round 5, A1 — the audit must not be DEAD WORK.
     *
     * The control above only ever exercised the models+council rejection, which
     * returns from `resolveBenchInput` BEFORE the audit site. Every rejection
     * AFTER it — critic+lenses mutual exclusion, the lens-count mismatch,
     * timeoutMinutes, maxCost, the outDir containment check — computed the
     * notices and then threw them away with the rest of the result. That is work
     * whose only output is discarded, and it contradicts both the CLI's "a
     * rejected bench is silent by construction" and this block's own claim.
     *
     * So the site moved past the last thing that can fail. The fixture spies on
     * the audit FUNCTION rather than on the absent output, because absent output
     * is exactly what the old placement also produced — only a call count can
     * tell "never computed" from "computed and discarded".
     */
    describe('a rejected call computes NO audit at all (round 5, A1)', () => {
      /** Run the tool with `auditBenchAliases` spied on; returns the spy. */
      async function runWithAuditSpy(extra) {
        const briefingFile = path.join(tempDir, 'briefing.md');
        fs.writeFileSync(briefingFile, 'Review this.');
        const actual = jest.requireActual('../src/mcp-council-bench');
        const spy = jest.fn(actual.auditBenchAliases);
        jest.doMock('../src/mcp-council-bench', () => ({ ...actual, auditBenchAliases: spy }));
        try {
          const { handleCouncilRunTool } = require('../src/mcp-council-run');
          const res = await handleCouncilRunTool(
            { briefingFile, models: ['kimi', 'glm'], ...extra },
            tempDir, { spawnFn: () => {}, clientName: 'claude-code' });
          return { spy, res };
        } finally { jest.dontMock('../src/mcp-council-bench'); }
      }

      test('the critic+lenses rejection never reaches the audit', async () => {
        writeConfig({ kimi: STALE_KIMI });
        const { spy, res } = await runWithAuditSpy({ critic: 'kimi', lenses: ['a', 'b'] });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/mutually exclusive/);
        expect(spy).not.toHaveBeenCalled();
      });

      test('the lens-count rejection never reaches the audit either', async () => {
        writeConfig({ kimi: STALE_KIMI });
        const { spy, res } = await runWithAuditSpy({ lenses: ['only-one'] });
        expect(res.isError).toBe(true);
        expect(spy).not.toHaveBeenCalled();
      });

      /**
       * ABSENCE CONTROL, in the other direction: the move must not have muted
       * the surface. An ACCEPTED call still audits exactly once, and the notice
       * still arrives — otherwise "never computed on rejection" would be
       * satisfied by never computing at all.
       */
      test('ABSENCE CONTROL: an ACCEPTED call still audits exactly once', async () => {
        writeConfig({ kimi: STALE_KIMI });
        const { spy, res } = await runWithAuditSpy({});
        expect(res.isError).toBeUndefined();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(res.content.map(c => c.text).join('\n')).toContain('curated ships');
      });
    });

    /**
     * PR #207 council round 5, D3 — the line is shaped for a STREAM, not for a
     * tool result.
     *
     * `formatAliasShadow` ends every notice with `\n` because both writers write
     * it to a stream, where the newline is what makes it a line. An MCP content
     * block is not a stream: its sibling notices from `pack-resolve.js` carry no
     * trailing newline ("…which amicus_council_run does not support over MCP —
     * ignored."), so the alias-shadow blocks were the odd ones out, arriving with
     * a stray blank line in the client's rendering.
     *
     * Trimmed at the MCP WRITER, not in `formatAliasShadow`: the newline is
     * correct for the two stream surfaces, and both of them still depend on it
     * (the round-4 sanitizing pins assert `line.endsWith('\n')` on the CLI side).
     */
    test('the MCP notice carries no stderr-shaped trailing newline (round 5, D3)', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const texts = await runTool({ models: ['kimi', 'glm'] });
      const notice = texts.find(t => t.includes('curated ships'));
      expect(notice).toBeDefined();
      expect(notice.endsWith('\n')).toBe(false);
      expect(notice).not.toMatch(/[\n\r]/); // and it is still exactly ONE line
    });
  });

  /**
   * META-PIN (PR #207 round 4, B1) — the whole suite's footprint on the REAL
   * process.stderr, asserted where the accumulation would actually show up.
   *
   * The fixture above pins arm-once against a STUB stream, which is the
   * mechanism. This one pins the consequence: every default-writer fixture in
   * this file runs against the real `process.stderr` object (the stdout/stderr
   * test replaces the `write` METHOD, not the stream), and each one loads a
   * fresh module registry. Under the old module-scoped WeakSet that was one new
   * listener per fixture; Node warns at 10, ASYNCHRONOUSLY, onto
   * `process.stderr.write` — the method the absence controls exact-match on.
   *
   * DECLARED LAST on purpose: jest runs a file's tests in declaration order, so
   * this is the only position from which it can see the whole file's total.
   */
  describe('meta: this suite arms the real stderr at most ONCE (round 4, B1)', () => {
    test('every default-writer fixture above shares one listener', () => {
      const added = process.stderr.listenerCount('error') - STDERR_ERROR_LISTENERS_AT_LOAD;
      expect(added).toBeLessThanOrEqual(1);
    });
  });

});
