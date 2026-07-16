/**
 * Gateway Correct-IDs E2E Integration Test (#61 gateway-correct-model-ids, Task 7)
 *
 * Regression guard for the bug this branch fixes: `--model opus` used to
 * resolve to `anthropic/claude-opus-4.8` (OpenRouter's DOT form) even for a
 * direct-Anthropic-key user, who needs the DASH form
 * (`anthropic/claude-opus-4-8`) -- the dot id 404s against the real Anthropic
 * API (`model_not_found`). Tasks 1-3 fixed the per-gateway route map
 * (curated-models.js:toGatewayRoutes), the router (gateway-router.js), and the
 * alias bridge (route-launch.js:resolveRouteForLaunch) so a direct-eligible
 * alias now carries BOTH gateway-native forms and the router picks the
 * DIRECT one (dashes) whenever a direct key is present. This test drives the
 * REAL CLI start path (bin/amicus.js -> cli-handlers-run.js:handleStart ->
 * start-helpers.js:resolveLaunchModel -> route-launch.js -> gateway-router.js)
 * end to end and observes the id that actually gets handed to the launch
 * stage -- proving the fix, not just the router unit in isolation.
 *
 * Hermeticity + observation technique (mirrors
 * tests/gateway-routing-e2e.integration.test.js exactly):
 *   - Every child process below is spawned with an isolated
 *     AMICUS_CONFIG_DIR/AMICUS_ENV_DIR/HOME/USERPROFILE/APPDATA/LOCALAPPDATA
 *     (see buildIsolatedEnv) and every REAL provider-key env var scrubbed, so
 *     this developer's actual ~/.config/amicus (keys, config.json, catalog
 *     cache) and OpenCode auth.json are never read.
 *   - A STUB `ANTHROPIC_API_KEY` is injected (per-test override) so the
 *     router's direct path is available (keys.anthropic === true) -- this is
 *     never a real key and never reaches a real Anthropic call (see below).
 *   - The on-disk model-catalog.json cache is pre-seeded (see
 *     makeIsolatedDirs) with the DASH id in the `anthropic/` namespace so
 *     gateway-router.js's catalogGate (model-classification.js:classifyModel)
 *     classifies it 'valid' instead of hitting the network
 *     (model-fetcher.js's live OpenRouter fetch).
 *   - NO LIVE LLM CALL: rather than letting the run reach OpenCode's actual
 *     session/network stage (headless.js -> a real local server -> a real
 *     HTTPS call to Anthropic), this test observes the routing decision the
 *     moment it is "handed onward" into the launch stage and then kills the
 *     child. sidecar/start.js's very first act after resolving MCP config is
 *     `logger.info('Starting task', { taskId, model, mode })` (start.js:175)
 *     -- BEFORE buildContext/buildPrompts/runHeadless, i.e. before any local
 *     server spawn or network I/O. logger.js writes structured JSON to
 *     stderr, gated by LOG_LEVEL (default 'error' suppresses 'info' --
 *     buildIsolatedEnv sets LOG_LEVEL=info so this one line is emitted).
 *     runCliUntil below watches stderr for that exact line, parses the
 *     `model` field the instant it appears, and SIGTERMs the child -- so the
 *     assertion is on the router's real executableId as it flows through the
 *     real CLI, with no dependency on network reachability to Anthropic.
 *   - If the router ever regressed to emit the dot id (or any id the seeded
 *     catalog doesn't contain), catalogGate would classify it 'invalid' and
 *     resolveLaunchModel would render a `model_not_found` route-error and
 *     process.exit(1) BEFORE startSidecar is ever entered -- the 'Starting
 *     task' line would never appear, and this test would time out/fail
 *     instead of silently passing. That failure mode IS the regression guard.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AMICUS_BIN = path.join(__dirname, '..', 'bin', 'amicus.js');
const NODE = process.execPath;

/** Provider-key env vars that must never leak into an isolated child. */
const PROVIDER_KEY_VARS = [
  'OPENROUTER_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
];

/** The dash-form direct executable id this whole branch fixes `--model opus` to resolve to. */
const EXPECTED_DIRECT_ID = 'anthropic/claude-opus-4-8';

/**
 * Fresh isolated dirs (config/env/home/cwd) plus a pre-seeded, already-fresh
 * model-catalog.json cache containing the DASH direct id (and, for realism,
 * the dot OpenRouter id) in schema v2 shape -- see model-catalog.js:readCache/
 * getCatalog. Fresh fetchedAt reads as not-stale, so getCatalog() returns it
 * as-is instead of calling refreshCatalog() (a real, keyless HTTPS GET).
 * @returns {{base:string, configDir:string, envDir:string, homeDir:string, cwd:string}}
 */
function makeIsolatedDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-gwid-e2e-'));
  const dirs = {
    base,
    configDir: path.join(base, 'config'),
    envDir: path.join(base, 'envdir'),
    homeDir: path.join(base, 'home'),
    cwd: path.join(base, 'cwd'),
  };
  for (const d of [dirs.configDir, dirs.envDir, dirs.homeDir, dirs.cwd]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dirs.configDir, 'model-catalog.json'),
    JSON.stringify({
      schemaVersion: 2,
      fetchedAt: Date.now(),
      models: [
        { id: EXPECTED_DIRECT_ID, name: 'Claude Opus 4.8 (Anthropic direct)', authoritative: true },
        { id: 'openrouter/anthropic/claude-opus-4.8', name: 'Claude Opus 4.8 (OpenRouter)', authoritative: true },
      ],
    })
  );
  return dirs;
}

/**
 * Build an isolated child env: real process.env minus every provider-key var,
 * minus XDG_DATA_HOME/SIDECAR_CONFIG_DIR, plus the isolated dirs wired in, plus
 * LOG_LEVEL=info so sidecar/start.js's one-line 'Starting task' log (the
 * observation hook -- see module docstring) is actually emitted (logger.js
 * defaults to LOG_LEVEL=error, which would otherwise suppress it).
 * @param {{configDir:string, envDir:string, homeDir:string}} dirs
 * @param {object} [overrides] - explicit env vars a test wants present (e.g. a stub key)
 * @returns {NodeJS.ProcessEnv}
 */
function buildIsolatedEnv(dirs, overrides = {}) {
  const env = { ...process.env };
  for (const key of PROVIDER_KEY_VARS) { delete env[key]; }
  delete env.XDG_DATA_HOME;
  delete env.SIDECAR_CONFIG_DIR;
  env.AMICUS_CONFIG_DIR = dirs.configDir;
  env.AMICUS_ENV_DIR = dirs.envDir;
  env.HOME = dirs.homeDir;
  env.USERPROFILE = dirs.homeDir;
  env.APPDATA = path.join(dirs.homeDir, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(dirs.homeDir, 'AppData', 'Local');
  env.LOG_LEVEL = 'info';
  return { ...env, ...overrides };
}

/**
 * Spawn the real CLI and resolve the INSTANT `isMatch(stderrSoFar)` turns
 * true, then SIGTERM the child -- this is what keeps the test hermetic:
 * sidecar/start.js's 'Starting task' log (the observation hook) fires before
 * any local server spawn or network I/O, so a match-and-kill here never lets
 * the run reach OpenCode's real session/network stage. Falls back to the
 * child's natural close (re-testing isMatch against final stderr) and to a
 * bounded timeout so a routing regression that never logs (e.g. a pre-flight
 * exit) can never hang the suite -- it correctly resolves matched:false instead.
 * @param {string[]} args
 * @param {{env: NodeJS.ProcessEnv, cwd: string, isMatch: (stderr:string)=>boolean, timeoutMs?: number}} opts
 * @returns {Promise<{stdout:string, stderr:string, code:number|null, matched:boolean, timedOut:boolean}>}
 */
function runCliUntil(args, { env, cwd, isMatch, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [AMICUS_BIN, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      cwd,
    });

    let stdout = '';
    let stderr = '';
    let finishing = false; // decided how this run ends; guards against a double finish()
    let timer;

    // Resolve the outer promise. If the child is still alive, SIGTERM it and
    // wait for the OS to actually finish tearing it down ('close', which
    // fires once stdio is fully drained) before resolving -- on Windows,
    // afterEach's fs.rmSync on the isolated temp dir otherwise races a
    // not-yet-fully-terminated process and fails with EPERM (the child still
    // holds a handle on its own cwd/log files for a few ms after kill()).
    const finish = (result) => {
      if (finishing) { return; }
      finishing = true;
      clearTimeout(timer);
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(result);
        return;
      }
      child.once('close', () => resolve(result));
      try { child.kill('SIGTERM'); } catch { resolve(result); }
    };

    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
      if (!finishing && isMatch(stderr)) {
        finish({ stdout, stderr, code: null, matched: true, timedOut: false });
      }
    });

    timer = setTimeout(() => {
      finish({ stdout, stderr, code: null, matched: isMatch(stderr), timedOut: true });
    }, timeoutMs);
    if (timer.unref) { timer.unref(); }

    child.on('close', (code) => {
      finish({ stdout, stderr, code, matched: isMatch(stderr), timedOut: false });
    });
  });
}

/**
 * True once stderr contains sidecar/start.js's 'Starting task' structured log
 * line (logger.js JSON: {level:'info', msg:'Starting task', taskId, model, mode, ts}).
 * @param {string} stderr accumulated stderr so far
 * @returns {boolean}
 */
function hasStartingTaskLog(stderr) {
  return stderr.includes('"msg":"Starting task"');
}

/**
 * Parse the 'Starting task' log entry out of accumulated stderr (one JSON
 * object per line, per logger.js). Returns the LAST match (there is only
 * ever one per run) or null if absent/unparseable.
 * @param {string} stderr
 * @returns {{level:string, msg:string, taskId:string, model:string, mode:string, ts:string}|null}
 */
function parseStartingTaskLog(stderr) {
  const lines = stderr.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"msg":"Starting task"')) { continue; }
    try {
      const entry = JSON.parse(line);
      if (entry && entry.msg === 'Starting task') { return entry; }
    } catch { /* partial/split line -- keep scanning */ }
  }
  return null;
}

describe('gateway-correct-ids e2e (#61 Task 7): opus resolves direct with dashes through the real CLI start path', () => {
  let dirs;

  beforeEach(() => {
    dirs = makeIsolatedDirs();
  });

  afterEach(() => {
    // maxRetries/retryDelay: defense-in-depth for Windows transient EPERM/EBUSY
    // on a just-killed child's temp dir (finish() above already waits for the
    // child's 'close' event, but a virus scanner or the OS can still hold a
    // handle a few ms longer).
    fs.rmSync(dirs.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('auto gateway mode, ANTHROPIC_API_KEY present -> hands the DASH direct id onward, no model_not_found', async () => {
    const env = buildIsolatedEnv(dirs, { ANTHROPIC_API_KEY: 'sk-ant-test-stub-not-a-real-key' });
    const result = await runCliUntil(
      ['start', '--model', 'opus', '--no-ui', '--prompt', 'hi'],
      { env, cwd: dirs.cwd, isMatch: hasStartingTaskLog }
    );

    expect(result.matched).toBe(true);
    expect(result.timedOut).toBe(false);

    const entry = parseStartingTaskLog(result.stderr);
    expect(entry).not.toBeNull();
    // The router's real executableId, handed onward into sidecar/start.js --
    // DASH form, never the OpenRouter dot form (anthropic/claude-opus-4.8).
    expect(entry.model).toBe(EXPECTED_DIRECT_ID);
    expect(entry.mode).toBe('headless');

    // Defensive: pre-flight was never rejected by the router (route-error.js
    // REASON_TEXT strings would appear here had resolveLaunchModel exited(1)
    // instead of reaching startSidecar).
    expect(result.stderr).not.toContain('model_not_found');
    expect(result.stderr).not.toContain("not found in the model catalog");
    expect(result.stderr).not.toContain('No API key was found for this vendor');
    expect(result.stderr).not.toContain('No OpenRouter API key is configured');
  }, 20000);

  it('explicit --gateway direct, ANTHROPIC_API_KEY present -> same DASH direct id (explicit-direct branch, not just auto fallback)', async () => {
    const env = buildIsolatedEnv(dirs, { ANTHROPIC_API_KEY: 'sk-ant-test-stub-not-a-real-key' });
    const result = await runCliUntil(
      ['start', '--model', 'opus', '--gateway', 'direct', '--no-ui', '--prompt', 'hi'],
      { env, cwd: dirs.cwd, isMatch: hasStartingTaskLog }
    );

    expect(result.matched).toBe(true);
    expect(result.timedOut).toBe(false);

    const entry = parseStartingTaskLog(result.stderr);
    expect(entry).not.toBeNull();
    expect(entry.model).toBe(EXPECTED_DIRECT_ID);

    expect(result.stderr).not.toContain('model_not_found');
    expect(result.stderr).not.toContain('direct_unavailable');
    expect(result.stderr).not.toContain('no_direct_key');
  }, 20000);
});
