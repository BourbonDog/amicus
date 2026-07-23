'use strict';

/**
 * Local Provider E2E Integration Test (v4.2 Task 7, spec §6 -- the flagship).
 *
 * Hermetic stub OpenAI-compatible server (node:http only, zero new deps)
 * proving the full local/OpenAI-compatible route path composes end-to-end,
 * offline, with zero network and zero spend: config.providers ->
 * local-providers.js's resolveLocalRouteInputs -> local-probe.js's live GET
 * -> gateway-router.js's resolveLocal branch -> route-launch.js's
 * resolveRouteForLaunch -> config.js's buildProviderModels. Local providers
 * are the ONE gateway class genuinely e2e-testable without a real model
 * server (LM Studio/Ollama parity is a manual smoke -- Task 17's testing
 * recipe; this file stands in for that in CI).
 *
 * Entry points driven (M1/M7, Task 0 Step 5.5's C2 "transparent consumer"
 * cross-check): resolveRouteForLaunch has three production call sites beyond
 * being called directly -- src/utils/start-helpers.js, src/mcp-server.js, and
 * src/sidecar/fanout-validate.js. This file drives fanout-validate.js's
 * validateFanoutModels for a real 2-leg fan-out (the specific gap
 * task-3-report.md flagged: "no integration test exercises the fanout path
 * ... with a hint-bearing local result"). start-helpers.js (the CLI `amicus
 * start` path) and mcp-server.js (the MCP tool-call path) are NOT driven
 * here -- both would need a spawned child process; start-helpers.js already
 * has that coverage for the non-local case in
 * gateway-routing-e2e.integration.test.js, and mcp-server.js has its own
 * separate MCP-protocol integration tests. Left uncovered deliberately, so
 * the gap is stated, not silent.
 *
 * Isolation: every test isolates AMICUS_CONFIG_DIR / AMICUS_ENV_DIR / HOME /
 * USERPROFILE / APPDATA / LOCALAPPDATA to a fresh mkdtemp'd directory (the
 * same set gateway-routing-e2e.integration.test.js's buildIsolatedEnv uses),
 * snapshotted and restored in afterEach. resolveRouteForLaunch /
 * validateFanoutModels run IN-PROCESS here (not spawned), which is what
 * makes that restore load-bearing: an un-restored process.env override would
 * leak into any sibling *.test.js file sharing this Jest worker, exactly the
 * leak class this task was warned against. The isolated config dir also
 * carries a pre-seeded, already-fresh model-catalog.json: without it,
 * route-launch.js's unconditional getRouteCatalogInfo() call finds no cache
 * and falls through to model-catalog.js's live keyless OpenRouter fetch on
 * every resolve (model-catalog.js's getCatalog() staleness check) -- a real
 * network call this suite must never make. An empty models:[] cache is fine
 * content-wise: resolveLocal() never reads req.catalogInfo at all. Provider
 * key env vars (OPENROUTER_API_KEY etc.) are deliberately NOT scrubbed --
 * verified by reading gateway-router.js's resolveLocal(), which never
 * consults req.keys, so the ambient developer shell's keys (if any) cannot
 * change any assertion below.
 *
 * Pricing note: fanout-validate.js's leg.pricing comes from pricing.js's
 * lookupPricing(), still a pure model-catalog-cache lookup at this HEAD --
 * confirmed by reading pricing.js, which has no local-provider awareness.
 * The local-aware $0 fallback ("lookupPricing local fallback; resolveLegCost
 * explicit-zero branch") is Task 9 and has not landed. A stub model is never
 * in the catalog cache, so the correct CURRENT assertion is `pricing: null`
 * (unpriced) -- the brief's illustrative `{prompt:0, completion:0}` was
 * itself commented "(Task 9)"; update this assertion when Task 9 lands.
 *
 * Skip-guard: this suite needs no external credential (fully offline via the
 * stub), so there's no "is the real resource here" condition the way
 * HAS_API_KEY checks for the credentialed e2e files. Per the plan's Global
 * Constraints, the file still carries a guard shaped like its siblings, for
 * structural parity -- electron-toolbar-e2e.integration.test.js's
 * HAS_ELECTRON (a require.resolve capability check) is the closer analog
 * here than HAS_API_KEY, so that shape is reused -- checking the sibling
 * stub-helper module resolves -- rather than inventing a new single-purpose
 * toggle env var (the brief's own illustrative AMICUS_RUN_E2E has no other
 * user anywhere in this repo and was rejected for that reason).
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { startStub } = require('./helpers/stub-openai-server');

const HAS_STUB_HELPER = (() => {
  try {
    require.resolve('./helpers/stub-openai-server');
    return true;
  } catch { return false; }
})();

const describeE2E = HAS_STUB_HELPER ? describe : describe.skip;

/** process.env keys this suite mutates in-process; snapshotted/restored around every test. */
const ISOLATED_VARS = [
  'AMICUS_CONFIG_DIR', 'AMICUS_ENV_DIR', 'HOME', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'STUB_TEST_API_KEY',
];

function snapshotEnv() {
  const snap = {};
  for (const k of ISOLATED_VARS) { snap[k] = process.env[k]; }
  return snap;
}

function restoreEnv(snap) {
  for (const k of ISOLATED_VARS) {
    if (snap[k] === undefined) { delete process.env[k]; } else { process.env[k] = snap[k]; }
  }
}

/**
 * Seed the isolated AMICUS_CONFIG_DIR with (1) config.json wiring `id` to the
 * stub as an openai-compatible local provider and (2) a fresh model-catalog
 * cache (see header comment -- prevents a live network refresh).
 */
function seedConfig(configDir, id, stubUrl, { apiKeyEnv, flavor = 'generic' } = {}) {
  fs.mkdirSync(configDir, { recursive: true });
  const entry = { type: 'openai-compatible', baseURL: stubUrl, flavor };
  if (apiKeyEnv) { entry.apiKeyEnv = apiKeyEnv; }
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
    default: `${id}/test-model`, aliases: {}, providers: { [id]: entry },
  }));
  fs.writeFileSync(path.join(configDir, 'model-catalog.json'),
    JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: [] }));
}

describeE2E('local provider e2e (hermetic stub, Task 7)', () => {
  let stub;
  let envSnapshot;
  let base;

  beforeEach(async () => {
    envSnapshot = snapshotEnv();
    stub = await startStub({ models: ['test-model'] });
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-local-e2e-'));
    const configDir = path.join(base, 'config');
    const homeDir = path.join(base, 'home');
    process.env.AMICUS_CONFIG_DIR = configDir;
    process.env.AMICUS_ENV_DIR = path.join(base, 'envdir');
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.APPDATA = path.join(homeDir, 'AppData', 'Roaming');
    process.env.LOCALAPPDATA = path.join(homeDir, 'AppData', 'Local');
    fs.mkdirSync(process.env.AMICUS_ENV_DIR, { recursive: true });
    delete process.env.STUB_TEST_API_KEY;
    seedConfig(configDir, 'stub', stub.url);
    jest.resetModules();
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    if (stub) { await stub.close(); }
    if (base) { fs.rmSync(base, { recursive: true, force: true }); }
  });

  test('reachable server: resolveRouteForLaunch resolves stub/test-model to gateway:local', async () => {
    const { resolveRouteForLaunch } = require('../src/utils/route-launch');
    const r = await resolveRouteForLaunch({
      model: 'stub/test-model', gatewayMode: 'auto', source: 'e2e', validateModel: true,
    });
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
    expect(r.executableId).toBe('stub/test-model');
    expect(r.model).toBe('stub/test-model');
    expect(r.provenance.source).toBe('e2e');
  });

  test('buildProviderModels wires the stub baseURL for the engine', () => {
    const { buildProviderModels } = require('../src/utils/config');
    const providers = buildProviderModels(['stub/test-model']);
    expect(providers.stub.npm).toBe('@ai-sdk/openai-compatible');
    expect(providers.stub.options.baseURL).toBe(stub.url);
    expect(providers.stub.options.apiKey).toBeUndefined(); // no apiKeyEnv configured for this entry
  });

  // M1/M7: drives fanout-validate.js's validateFanoutModels -- the ONLY
  // production code that resolves a --models leg list (fanout-validate.js
  // :52-60) -- instead of calling resolveRouteForLaunch twice inline, which
  // would touch no fan-out code and let the "2-leg fanout" claim be
  // vacuously true. Also discharges the C2 "transparent consumer"
  // assumption for this entry point (see header comment).
  test('a 2-leg fanout (stub + stub) both resolve local, through validateFanoutModels', async () => {
    const { validateFanoutModels } = require('../src/sidecar/fanout-validate');
    const { legs } = await validateFanoutModels('stub/test-model,stub/test-model', { gatewayMode: 'auto' });
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.ok === true)).toBe(true);
    expect(legs.every((l) => l.gateway === 'local')).toBe(true);
    expect(legs.every((l) => l.model === 'stub/test-model')).toBe(true);
    // See header "Pricing note": Task 9's local $0 fallback hasn't landed --
    // an unpriced (null) leg is the correct, current, real behavior.
    expect(legs[0].pricing).toBeNull();
  });

  test('unreachable server: local_endpoint_unreachable with the generic-flavor hint', async () => {
    await stub.close();
    const { resolveRouteForLaunch } = require('../src/utils/route-launch');
    const r = await resolveRouteForLaunch({
      model: 'stub/test-model', gatewayMode: 'auto', source: 'e2e', validateModel: true,
    });
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('local_endpoint_unreachable');
    expect(r.hint).toBe(`Check the server at ${stub.url}.`); // gateway-router.js's localHint(), flavor:'generic'
    stub = await startStub({ models: ['test-model'] }); // re-open so afterEach's close() is harmless
  });

  test('unreachable server: ollama flavor gets the ollama-specific hint (flavor-correct, not generic)', async () => {
    const configDir = process.env.AMICUS_CONFIG_DIR;
    seedConfig(configDir, 'stub', stub.url, { flavor: 'ollama' });
    await stub.close();
    const { resolveRouteForLaunch } = require('../src/utils/route-launch');
    const r = await resolveRouteForLaunch({
      model: 'stub/test-model', gatewayMode: 'auto', source: 'e2e', validateModel: true,
    });
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('local_endpoint_unreachable');
    expect(r.hint).toBe('Is Ollama running? `ollama serve`');
    stub = await startStub({ models: ['test-model'] });
  });

  test('declared-but-absent bearer: no_local_key', async () => {
    const configDir = process.env.AMICUS_CONFIG_DIR;
    seedConfig(configDir, 'stub', stub.url, { apiKeyEnv: 'STUB_TEST_API_KEY' });
    const { resolveRouteForLaunch } = require('../src/utils/route-launch');
    const r = await resolveRouteForLaunch({
      model: 'stub/test-model', gatewayMode: 'auto', source: 'e2e', validateModel: true,
    });
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('no_local_key');
    // gateway-router.js's resolveLocal() checks apiKeyEnv/keyPresent before it
    // ever reads localLive, but resolveLocalRouteInputs() still runs the
    // probe unconditionally beforehand -- it just has no bearer to attach:
    // getJson only sends Authorization when `bearer` is truthy. So the
    // request reaches the stub, but never carries a credential-shaped header.
    expect(stub.state.lastAuth).toBeUndefined();
  });

  test('declared-and-present bearer reaches the server and resolves', async () => {
    const configDir = process.env.AMICUS_CONFIG_DIR;
    seedConfig(configDir, 'stub', stub.url, { apiKeyEnv: 'STUB_TEST_API_KEY' });
    process.env.STUB_TEST_API_KEY = 'test-fixture-bearer-not-a-secret';
    const { resolveRouteForLaunch } = require('../src/utils/route-launch');
    const r = await resolveRouteForLaunch({
      model: 'stub/test-model', gatewayMode: 'auto', source: 'e2e', validateModel: true,
    });
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
    expect(stub.state.lastAuth).toBe('Bearer test-fixture-bearer-not-a-secret');
  });

  test('--no-validate-model resolves without probing a down server', async () => {
    await stub.close();
    const { resolveRouteForLaunch } = require('../src/utils/route-launch');
    const r = await resolveRouteForLaunch({
      model: 'stub/test-model', gatewayMode: 'auto', source: 'e2e', validateModel: false,
    });
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
    expect(r.notice).toMatch(/unverified/i);
    // The stub is CLOSED for the entire test above -- resolving anyway (instead
    // of local_endpoint_unreachable) is the direct proof the probe was never
    // consulted, not merely "didn't error."
    stub = await startStub({ models: ['test-model'] });
  });
});
