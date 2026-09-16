'use strict';
/**
 * #238 D5 — the ONE live integration test for the detached background
 * catalog refresh (council #254 round 2, qwen #1/D7): every other test in
 * this feature fakes `spawn`; this one runs the REAL `amicus models
 * --refresh` child end to end, through a real `OPENROUTER_API_KEY`, and
 * waits for `model-catalog.json` to be rewritten and for
 * `alias-notice-state/last-refresh.log` to carry the child's own trace line
 * (R-P4-19). Mirrors tests/cli-headless-e2e.integration.test.js's
 * HAS_API_KEY / describeE2E pattern exactly, so it is skipped automatically
 * without a key — the keyless rail (`npm run test:integration`) must report
 * this file as skipped, never failing. Spends nothing: every call here is a
 * model-LIST endpoint (`amicus models --refresh`), never a completion.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'amicus.js');
const SHIM = path.join(__dirname, '..', 'helpers', 'tty-stdin-shim.js');
const DAY = 24 * 60 * 60 * 1000;

const HAS_API_KEY = !!(
  process.env.OPENROUTER_API_KEY ||
  (() => {
    try {
      const envPath = path.join(os.homedir(), '.config', 'amicus', '.env');
      const content = fs.readFileSync(envPath, 'utf-8');
      return content.includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);

const describeE2E = HAS_API_KEY ? describe : describe.skip;

describeE2E('the detached weekly background refresh, live (#238 D5, qwen #1/D7)', () => {
  jest.setTimeout(240000);

  let dir;

  afterAll(() => {
    if (dir) { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a real detached `amicus models --refresh` rewrites the catalog and traces to last-refresh.log', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-notice-refresh-'));
    // Every spawn below shares this env: a scratch config dir, CI's override so is-in-ci never
    // vetoes the run, and the mocked update-notifier so the (irrelevant) network update check
    // never fires. AMICUS_ENV_DIR is deliberately NOT set — the key comes from whatever the
    // caller's shell/rail already provides (HAS_API_KEY's own two sources).
    const env = { ...process.env, AMICUS_CONFIG_DIR: dir, CI: '0', AMICUS_MOCK_UPDATE: 'success' };
    delete env.AMICUS_NO_NETWORK_PROBES;

    // 1. A real catalog, built the ordinary way.
    const catalogPath = path.join(dir, 'model-catalog.json');
    const build = spawnSync(process.execPath, [BIN, 'models', '--refresh', '--cwd', dir], { env, timeout: 120000, encoding: 'utf-8' });
    if (build.status !== 0) { console.error('models --refresh (initial build) stderr:\n', build.stderr); }
    expect(build.status).toBe(0);
    const built = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    expect(built.models.length).toBeGreaterThan(0);

    // 2. Age it past the weekly threshold, and drop in a fresh, empty-aliases config so the
    //    exit hook's notice finds nothing to review while the refresh still finds an old catalog.
    const agedFetchedAt = Date.now() - 8 * DAY;
    fs.writeFileSync(catalogPath, JSON.stringify({ ...built, fetchedAt: agedFetchedAt }));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ aliases: {} }));

    // 3. `amicus list` in a terminal: the exit hook fires, stamps the spawn receipt, and detaches
    //    the real `amicus models --refresh` child — the same binary, never a fake spawn.
    const spawnedPath = path.join(dir, 'alias-notice-state', 'last-refresh-spawned.json');
    const hookRun = spawnSync(process.execPath, ['-r', SHIM, BIN, 'list', '--cwd', dir], { env, timeout: 30000, encoding: 'utf-8' });
    if (hookRun.status !== 0) { console.error('amicus list (hook run) stderr:\n', hookRun.stderr); }
    expect(hookRun.status).toBe(0);
    expect(fs.existsSync(spawnedPath)).toBe(true);

    // 4. Wait for the detached child to actually finish: model-catalog.json's fetchedAt moves
    //    past the aged value, and its own log (R-P4-19) carries the trace line.
    const logPath = path.join(dir, 'alias-notice-state', 'last-refresh.log');
    const deadline = Date.now() + 90000;
    let refreshed = false;
    while (Date.now() < deadline) {
      try {
        const doc = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
        // The child prints `Refreshed catalog:` a few ms AFTER the cache rename (models.js re-reads the
        // cache first), so wait for both — the fresh stamp and the log line — before asserting.
        const logged = fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf-8').includes('Refreshed catalog:');
        if (typeof doc.fetchedAt === 'number' && doc.fetchedAt > agedFetchedAt && logged) { refreshed = true; break; }
      } catch { /* the child may be mid-write; poll again */ }
      // eslint-disable-next-line no-await-in-loop -- a deliberate poll, not accidental serialization
      await new Promise((resolve) => { setTimeout(resolve, 2000); });
    }
    if (!refreshed) {
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '(no log file)';
      throw new Error(`model-catalog.json was not refreshed within 90s. last-refresh.log:\n${log}`);
    }
    expect(fs.readFileSync(logPath, 'utf-8')).toContain('Refreshed catalog:');
  });
});
