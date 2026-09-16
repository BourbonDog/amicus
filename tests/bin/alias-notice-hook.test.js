'use strict';
/**
 * #238 D5 — bin/amicus.js's exit hook is WIRED: a finished command in a
 * terminal prints the alias notice on stderr after its own output and stamps
 * `aliasReview.lastNotified`; without a terminal on stdin, under --json, or
 * for --help, nothing happens. The predicate and the decision are unit-tested
 * in tests/utils/alias-refresh-state.test.js / alias-notice.test.js; this
 * file proves only the wiring, through a real child process (the
 * tests/bin/cwd-guard.test.js spawn idiom). A spawned child's stdin is a pipe,
 * so the positive cases preload tests/helpers/tty-stdin-shim.js with `node -r`
 * — a test-side seam, no production hook. AMICUS_MOCK_UPDATE keeps the real
 * update-notifier (network) out of the child; its fake update notice prints
 * too, which is why the positive assertion is "ends with": it proves the
 * order as well. CI=0 is is-in-ci's override — the runner's own CI=true would
 * veto the predicate. The fixture catalog is FRESH: no case may put a
 * week-old cache in front of a real spawn (the refresh is proven at the
 * module level and live, never here).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'amicus.js');
const SHIM = path.join(__dirname, '..', 'helpers', 'tty-stdin-shim.js');
const LINE = '1 alias update available — amicus aliases --review';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-notice-hook-'));
  // A CUSTOM alias behind a newer sibling: one proposal whatever the shipped pins say (failure mode #53).
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ aliases: { mine: 'openrouter/z-ai/glm-5.2' } }));
  fs.writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify({
    schemaVersion: 2, fetchedAt: Date.now() - 60 * 60 * 1000,
    models: [{ id: 'openrouter/z-ai/glm-5.2' }, { id: 'openrouter/z-ai/glm-5.4' }],
  }));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function run(args, { tty }) {
  const env = { ...process.env, AMICUS_CONFIG_DIR: dir, AMICUS_ENV_DIR: dir, AMICUS_MOCK_UPDATE: 'success', CI: '0' };
  delete env.AMICUS_NO_NETWORK_PROBES;
  const r = spawnSync(process.execPath, [...(tty ? ['-r', SHIM] : []), BIN, ...args, '--cwd', dir], { encoding: 'utf-8', env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const config = () => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));

describe('the exit hook, wired (#238 D5)', () => {
  test('a terminal, a finished command: the notice is the LAST thing on stderr and lastNotified is stamped (mutant UNWIRED)', () => {
    const before = Date.now();
    const r = run(['list'], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stderr.trimEnd().endsWith(LINE)).toBe(true);
    expect(r.stderr).toContain('Update available');            // the slot's other tenant printed first
    expect(config().aliasReview.lastNotified).toBeGreaterThanOrEqual(before);
  });
  test('a second run within the day is silent and does not re-stamp (Q5)', () => {
    run(['list'], { tty: true });
    const stamp = config().aliasReview.lastNotified;
    const r = run(['list'], { tty: true });
    expect(r.stderr).not.toContain('alias update');
    expect(config().aliasReview.lastNotified).toBe(stamp);
  });
  test('no terminal on stdin: nothing printed, nothing written', () => {
    const r = run(['list'], { tty: false });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('alias update');
    expect(config().aliasReview).toBeUndefined();
  });
  test('--json reaches the hook as args (mutant ARGSDROP: bin passing {} would print here)', () => {
    const r = run(['list', '--json'], { tty: true });
    expect(r.stderr).not.toContain('alias update');
    expect(config().aliasReview).toBeUndefined();
  });
  test('--help exits above the slot: registered inside the guard, never fires (mutant HELPHOOK)', () => {
    const r = run(['list', '--help'], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('alias update');
  });
});
