/**
 * Gateway Routing E2E Integration Test (#61 Task 4.8)
 *
 * Deterministic, hermetic smoke proving a BARE canonical model id (e.g.
 * "x-ai/grok-4.3", "openai/gpt-5.5" -- no "openrouter/" prefix, no config
 * alias) flows through the new Foundation gateway router
 * (resolveRouteForLaunch, src/utils/route-launch.js -> resolveRoute,
 * src/utils/gateway-router.js) in the REAL CLI start path (bin/amicus.js ->
 * src/cli-handlers-run.js:handleStart -> src/utils/start-helpers.js:
 * resolveLaunchModel), and that a missing key produces the router's own
 * structured route-error output (src/utils/route-error.js) -- driving the
 * CLI's actual stderr and exit code, before any launch/network step. This
 * guards the *engine* (the router being wired into the start path) before
 * Phase 8 (guidance/UX) work lands on top of it.
 *
 * Hermeticity: every child process below is spawned with an isolated
 * AMICUS_CONFIG_DIR / AMICUS_ENV_DIR / HOME / USERPROFILE / APPDATA /
 * LOCALAPPDATA (see buildIsolatedEnv), every provider-key env var scrubbed,
 * and a pre-seeded FRESH model-catalog.json cache (see makeIsolatedDirs) so:
 *   - api-key-store.js / config.js never see this developer's real
 *     ~/.config/amicus (keys, config.json, catalog cache);
 *   - auth-json.js:readAuthJsonKeys() -- which resolves via os.homedir()/
 *     XDG_DATA_HOME/APPDATA, NOT AMICUS_CONFIG_DIR -- never sees this
 *     machine's real OpenCode auth.json;
 *   - route-launch.js:resolveRouteForLaunch's unconditional
 *     getRouteCatalogInfo() call never falls through to model-catalog.js's
 *     live (keyless) OpenRouter fetch (model-fetcher.js), which would
 *     otherwise hit the real network on every single invocation below,
 *     including the two "missing key" cases whose routing outcome never
 *     even depends on catalog contents.
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

/**
 * Fresh isolated dirs (config/env/home/cwd) plus a pre-seeded, already-fresh
 * model-catalog.json cache. schemaVersion 2 + fetchedAt: now reads as
 * not-stale to model-catalog.js:getCatalog(), which returns it as-is instead
 * of calling refreshCatalog() (a real, keyless HTTPS GET against
 * https://openrouter.ai/api/v1/models -- see model-fetcher.js).
 * @returns {{base:string, configDir:string, envDir:string, homeDir:string, cwd:string}}
 */
function makeIsolatedDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-gw-e2e-'));
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
    JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: [] })
  );
  return dirs;
}

/**
 * Build an isolated child env: real process.env minus every provider-key
 * var, minus XDG_DATA_HOME/SIDECAR_CONFIG_DIR (which could otherwise leak
 * this machine's real state back in), plus the isolated dirs wired in via
 * AMICUS_CONFIG_DIR/AMICUS_ENV_DIR/HOME/USERPROFILE/APPDATA/LOCALAPPDATA.
 * @param {{configDir:string, envDir:string, homeDir:string}} dirs
 * @param {object} [overrides] - explicit env vars a test wants present (e.g. a fake key)
 * @returns {NodeJS.ProcessEnv}
 */
function buildIsolatedEnv(dirs, overrides = {}) {
  const env = { ...process.env };
  for (const key of PROVIDER_KEY_VARS) { delete env[key]; }
  delete env.XDG_DATA_HOME;
  delete env.SIDECAR_CONFIG_DIR; // legacy override; must not interfere (#19 absence pin)
  env.AMICUS_CONFIG_DIR = dirs.configDir;
  env.AMICUS_ENV_DIR = dirs.envDir;
  env.HOME = dirs.homeDir;
  env.USERPROFILE = dirs.homeDir;
  env.APPDATA = path.join(dirs.homeDir, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(dirs.homeDir, 'AppData', 'Local');
  return { ...env, ...overrides };
}

/**
 * Spawn the real CLI with a bounded timeout. The child is force-killed if it
 * runs past timeoutMs, so a routing regression that reaches a hanging launch
 * path can never hang the suite.
 * @param {string[]} args
 * @param {{env: NodeJS.ProcessEnv, cwd: string, timeoutMs?: number}} opts
 * @returns {Promise<{stdout:string, stderr:string, code:number|null, timedOut:boolean}>}
 */
function runCli(args, { env, cwd, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [AMICUS_BIN, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      cwd,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ stdout, stderr, code: null, timedOut: true });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut: false });
    });
  });
}

describe('gateway routing e2e (#61 Task 4.8): bare canonical id through the real CLI start path', () => {
  let dirs;

  beforeEach(() => {
    dirs = makeIsolatedDirs();
  });

  afterEach(() => {
    fs.rmSync(dirs.base, { recursive: true, force: true });
  });

  it('gateway-only vendor (x-ai/grok-4.3), no OpenRouter key -> non-zero exit + missing-OpenRouter-key route error', async () => {
    const env = buildIsolatedEnv(dirs);
    const result = await runCli(
      ['start', '--model', 'x-ai/grok-4.3', '--no-ui', '--prompt', 'hi'],
      { env, cwd: dirs.cwd }
    );

    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    // route-error.js REASON_TEXT.no_openrouter_key + FIX_HINTS.no_openrouter_key.
    // grok has no direct integration (provider-registry.js has no "x-ai" entry),
    // so gateway-router.js's resolveRoute hits case 4 ("gateway-only vendor")
    // and returns this reason directly -- proof the bare canonical id reached
    // the router and its decision, not a stubbed/legacy path, drove the output.
    expect(result.stderr).toContain('No OpenRouter API key is configured');
    expect(result.stderr).toContain('x-ai/grok-4.3');
    expect(result.stderr).toContain('Set OPENROUTER_API_KEY');
  }, 20000);

  it('direct vendor (openai/gpt-5.5), no key anywhere -> non-zero exit + direct-first route error', async () => {
    const env = buildIsolatedEnv(dirs);
    const result = await runCli(
      ['start', '--model', 'openai/gpt-5.5', '--no-ui', '--prompt', 'hi'],
      { env, cwd: dirs.cwd }
    );

    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    // Default gatewayMode is 'auto': routing.prefer defaults to 'direct', but
    // config.js:resolveGatewayMode only ever emits the literal 'direct' mode
    // for an EXPLICIT --gateway direct -- an unset --gateway always maps to
    // 'auto' (or 'openrouter' if routing.prefer is 'openrouter'). In 'auto'
    // mode, gateway-router.js:resolveRoute's case 7 checks THIS VENDOR'S OWN
    // key first, then OpenRouter's, before giving up -- that check order is
    // the direct-first policy. Because openai IS a direct-capable vendor
    // (provider-registry.js: direct:true), it reaches that shared
    // not-found-anywhere branch (reason 'no_key_for_vendor'/REASON_TEXT +
    // FIX_HINTS in route-error.js) -- a DIFFERENT reason/message than the
    // gateway-only vendor above (reason 'no_openrouter_key', asserted not to
    // appear here), proving the router took the direct-eligible branch for
    // this bare canonical id rather than treating it identically to a
    // gateway-only vendor.
    expect(result.stderr).toContain('No API key was found for this vendor via any gateway');
    expect(result.stderr).toContain('openai/gpt-5.5');
    expect(result.stderr).toContain('Add a provider key or an OpenRouter key');
    expect(result.stderr).not.toContain('No OpenRouter API key is configured');
  }, 20000);

  // Assertion 3 (OPENAI_API_KEY set + --no-validate-model -> clears routing,
  // reaches the launch stage) is SKIPPED -- verified manually, not committed
  // as a live test. With a real-looking key set, the run does clear routing
  // (no router route-error text anywhere in stderr) and reaches the launch
  // stage, but that stage spawns a REAL OpenCode session which makes an
  // actual network call to OpenAI's API to learn the key is invalid
  // (confirmed by observing a live "Incorrect API key provided: test-key"
  // error surface through OpenCode's session polling, ~2s round trip in this
  // sandbox). That depends on outbound network reachability to
  // api.openai.com, which is not guaranteed in every CI/sandbox environment
  // (an offline runner could hang or fail differently instead of failing
  // fast with a 401) -- exactly the non-deterministic case the task brief
  // calls out to skip rather than risk a flaky suite. This is a test-only
  // task (no source changes allowed), so there is no way to stub the launch
  // stage's network call from here. Left in (skipped, not deleted) with the
  // real assertions so it can be flipped back on if a deterministic
  // no-network path to "reached the launch stage" is added later.
  // eslint-disable-next-line jest/no-disabled-tests -- not lint'd; tests/ is out of scope for `npm run lint` (src/ only)
  it.skip('resolved route (OPENAI_API_KEY set, --no-validate-model) proceeds past routing into the launch stage', async () => {
    const env = buildIsolatedEnv(dirs, { OPENAI_API_KEY: 'test-key' });
    const result = await runCli(
      ['start', '--model', 'openai/gpt-5.5', '--no-ui', '--prompt', 'hi', '--no-validate-model'],
      { env, cwd: dirs.cwd, timeoutMs: 30000 }
    );

    // Proves routing was NOT the failure: none of the router's structured
    // route-error reasons/messages (route-error.js REASON_TEXT) appear.
    expect(result.stderr).not.toContain('No API key was found for this vendor via any gateway');
    expect(result.stderr).not.toContain('No OpenRouter API key is configured');
    expect(result.stderr).not.toContain("No API key is configured for this vendor's direct API");
  }, 35000);
});
