'use strict';

/**
 * #218 PR 2 — council #231 round 2, finding D1.
 *
 * The above-32000 direction of `outputBudget` rests on ONE fact about the
 * pinned @opencode-ai/sdk: createOpencodeServer spreads process.env into the
 * engine spawn synchronously, before its first await, so withOutputTokenFlag's
 * set / call / restore window covers the spawn. Every other pin either mocks
 * the SDK (tests/opencode-client-output-flag.test.js) or bypasses the wrapper
 * (the probe sets the flag per case in its own env), so an SDK bump that moved
 * the spread behind an await would silently revert every budget above 32000
 * to the engine default with all tests green.
 *
 * This test drives the REAL SDK through the REAL startServer against a fake
 * engine on PATH (tests/fixtures/fake-engine) that records the env it was
 * spawned with. No real engine, no network, no config or credential outside a temp dir (the child env is built with the keyless rail's buildKeylessEnv). It
 * runs in a child node process because the SDK is ESM behind a dynamic
 * import() that jest cannot load. Named mutant "SPREADAFTERAWAIT": edit
 * node_modules/@opencode-ai/sdk/dist/server.js to `await` anything before the
 * launch() call — the first test then sees flag null.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildKeylessEnv } = require('../scripts/run-integration-keyless');

const CHILD = path.join(__dirname, 'helpers', 'sdk-spawn-timing-child.js');

/** @param {object} config written to a temp config.json @returns {{flag:?string,args:string[],configContent:string}} */
function runChild(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-spawn-timing-'));
  const out = path.join(dir, 'seen.json');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  // The same scrub the keyless integration rail uses: no provider key, no
  // OPENCODE_* credential channel and no real HOME reaches the child or the
  // fake engine it spawns. The three amicus dirs then point at the temp dir.
  const env = buildKeylessEnv(process.env, dir);
  env.AMICUS_CONFIG_DIR = dir;
  env.AMICUS_ENV_DIR = dir;
  env.FAKE_ENGINE_OUT = out;
  delete env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
  delete env.ANTHROPIC_BASE_URL; // keeps the host-form notice out of the test output
  try {
    const stdout = execFileSync(process.execPath, [CHILD], { env, encoding: 'utf8', timeout: 60000 });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the real SDK spawn sees the flag withOutputTokenFlag sets around it', () => {
  test('a configured budget is in the engine\'s env at spawn — the SDK spreads process.env before its first await', () => {
    const seen = runChild({ outputBudget: 40000 });
    expect(seen.flag).toBe('40000');
    expect(seen.args[0]).toBe('serve');
    expect(seen.configContent).toBe('present');
    expect(seen.hasProviderKey).toBe(false);
  });

  test('with no budget configured the engine\'s env carries no flag', () => {
    expect(runChild({}).flag).toBeNull();
  });
});
