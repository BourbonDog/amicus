'use strict';
/**
 * #238 D5 — bin/amicus.js's exit hook is WIRED: a finished command in a
 * terminal prints the alias notice on stderr after its own output and stamps
 * `lastNotified` in `alias-notice-state.json` (council #254 round 1) —
 * never in config.json; without a terminal on stdin, under --json, or for
 * --help, nothing happens and no state file is created. The predicate and
 * the decision are unit-tested in tests/utils/alias-refresh-state.test.js /
 * alias-notice.test.js; this file proves only the wiring, through a real
 * child process (the tests/bin/cwd-guard.test.js spawn idiom). A spawned
 * child's stdin is a pipe, so the positive cases preload
 * tests/helpers/tty-stdin-shim.js with `node -r` — a test-side seam, no
 * production hook. AMICUS_MOCK_UPDATE keeps the real update-notifier
 * (network) out of the child; its fake update notice prints too, which is
 * why the positive assertion is "ends with": it proves the order as well.
 * CI=0 is is-in-ci's override — the runner's own CI=true would veto the
 * predicate. The fixture catalog is FRESH: no case may put a week-old cache
 * in front of a real spawn (the refresh is proven at the module level and
 * live, never here). config.json is asserted byte-identical throughout —
 * the hook itself never opens it for writing; the unit-level CONFIGWRITE
 * tripwire (tests/utils/alias-notice.test.js) is what actually guards the
 * "never" here, so no mutant is carried at this level for it.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'amicus.js');
const SHIM = path.join(__dirname, '..', 'helpers', 'tty-stdin-shim.js');
const LINE = '1 alias update available — amicus aliases --review';

let dir;
let configPath;
let statePath;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-notice-hook-'));
  configPath = path.join(dir, 'config.json');
  statePath = path.join(dir, 'alias-notice-state.json');
  // A CUSTOM alias behind a newer sibling: one proposal whatever the shipped pins say (failure mode #53).
  // A vendor that can never ship (R-P4-12 review Minor 2): no residual weld to the real glm pin.
  fs.writeFileSync(configPath, JSON.stringify({ aliases: { mine: 'openrouter/acme/model-1.0' } }));
  fs.writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify({
    schemaVersion: 2, fetchedAt: Date.now() - 60 * 60 * 1000,
    models: [{ id: 'openrouter/acme/model-1.0' }, { id: 'openrouter/acme/model-1.1' }],
  }));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function run(args, { tty }) {
  const env = { ...process.env, AMICUS_CONFIG_DIR: dir, AMICUS_ENV_DIR: dir, AMICUS_MOCK_UPDATE: 'success', CI: '0' };
  delete env.AMICUS_NO_NETWORK_PROBES;
  const r = spawnSync(process.execPath, [...(tty ? ['-r', SHIM] : []), BIN, ...args, '--cwd', dir], { encoding: 'utf-8', env, timeout: 30000 });
  if (r.error) { throw r.error; }   // a spawn failure surfaces here, not as a TypeError on null streams below (review Minor 3)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const config = () => JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const state = () => JSON.parse(fs.readFileSync(statePath, 'utf-8'));

describe('the exit hook, wired (#238 D5)', () => {
  test('a terminal, a finished command: the notice is the LAST thing on stderr; config.json stays byte-identical and lastNotified lands in alias-notice-state.json (mutant UNWIRED)', () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const beforeTime = Date.now();
    const r = run(['list'], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stderr.trimEnd().endsWith(LINE)).toBe(true);
    expect(r.stderr).toContain('Update available');            // the slot's other tenant printed first
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);   // the hook never writes config.json
    expect(config().aliases).toEqual({ mine: 'openrouter/acme/model-1.0' });
    const s = state();
    expect(s.lastNotified).toBeGreaterThanOrEqual(beforeTime);
    expect(s.lastRefreshSpawned).toBeNull();   // the fixture catalog is fresh: no refresh spawned
  });
  test('a second run within the day is silent and does not re-stamp (Q5)', () => {
    run(['list'], { tty: true });
    const stamp = state().lastNotified;
    const r = run(['list'], { tty: true });
    expect(r.stderr).not.toContain('alias update');
    expect(state().lastNotified).toBe(stamp);
  });
  test('no terminal on stdin: nothing printed, nothing written', () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const r = run(['list'], { tty: false });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('alias update');
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });
  test('--json reaches the hook as args (mutant ARGSDROP: bin passing {} would print here)', () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const r = run(['list', '--json'], { tty: true });
    expect(r.stderr).not.toContain('alias update');
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });
  test('--help exits above the slot: registered inside the guard, never fires (mutant HELPHOOK)', () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const r = run(['list', '--help'], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('alias update');
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });
  test('bare amicus (usage) is not a run: nothing printed, nothing written (R-P4-12; mutant NOCOMMAND)', () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const r = run([], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage');
    expect(r.stderr).not.toContain('alias update');
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });
  test('an unknown command (usage, exit 1) is not a run: nothing printed, nothing written (R-P4-12; mutant UNKNOWNCMD)', () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const r = run(['bogus'], { tty: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown command');
    expect(r.stderr).not.toContain('alias update');
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });
  test('amicus aliases gets no echo of the hook behind its own footer (mutant COMMANDDROP)', () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const r = run(['aliases'], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('1 to review — amicus aliases --review');
    expect(r.stderr).not.toContain('alias update');
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });
});
