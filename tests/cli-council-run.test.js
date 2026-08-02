// tests/cli-council-run.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../src/council/run', () => ({ runCouncil: jest.fn() }));
const { runCouncil } = require('../src/council/run');
const { handleCouncilRun, CHAIR_DEFAULT } = require('../src/cli-handlers-council-run');

let tmp; let out; let err; let briefingFile;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-council-'));
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  runCouncil.mockReset();
});
afterEach(() => {
  out.mockRestore(); err.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const argsBase = (extra = {}) => ({
  _: ['council', 'run'], json: true, cwd: tmp,
  'prompt-file': briefingFile, models: 'gemini,gpt,qwen', ...extra,
});
const lastJson = () => JSON.parse(out.mock.calls[out.mock.calls.length - 1][0]);

describe('pre-flight validation (error envelope, exit 1, before any spend)', () => {
  test.each([
    ['inline --prompt rejected', { prompt: 'x' }, /prompt-file only/],
    ['models XOR council', { council: 'budget' }, /exactly one of --models \/ --council/],
    ['fewer than 2 seats', { models: 'gemini' }, /at least 2 seats/],
    ['chair in bench', { chair: 'gpt' }, /chair 'gpt' is a bench seat/],
    ['critic outside bench', { critic: 'mistral' }, /critic 'mistral' must be one of the bench seats/],
    ['critic + lenses exclusive', { critic: 'gpt', lenses: 'a,b,c' }, /mutually exclusive/],
    ['lens count mismatch', { lenses: 'a,b' }, /one lens per seat/],
    ['bad gateway', { gateway: 'carrier-pigeon' }, /--gateway must be one of/],
    ['bad max-cost', { 'max-cost': -1 }, /--max-cost must be a positive number/],
    ['bad timeout', { timeout: 0 }, /--timeout must be a positive number/],
  ])('%s', async (_name, extra, msgRe) => {
    const code = await handleCouncilRun(argsBase(extra));
    expect(code).toBe(1);
    expect(runCouncil).not.toHaveBeenCalled();
    const doc = lastJson();
    expect(doc.type).toBe('error');
    expect(doc.error.message).toMatch(msgRe);
  });

  test('missing --prompt-file → MISSING_PROMPT', async () => {
    const args = argsBase(); delete args['prompt-file'];
    const code = await handleCouncilRun(args);
    expect(code).toBe(1);
    expect(lastJson().error.code).toBe('MISSING_PROMPT');
  });

  test('chair-in-bench failure carries an actionable hint', async () => {
    await handleCouncilRun(argsBase({ chair: 'gemini' }));
    expect(lastJson().error.hint).toContain('outside --models');
  });
});

describe('engine invocation', () => {
  test('defaults: chair deepseek, out-dir ./council-<runId>, briefing text forwarded', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: { runId: 'r1', status: 'complete' } });
    const code = await handleCouncilRun(argsBase());
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.chair).toBe(CHAIR_DEFAULT);
    expect(opts.models).toEqual(['gemini', 'gpt', 'qwen']);
    expect(opts.briefing).toBe('Review this.');
    expect(opts.project).toBe(tmp);
    expect(opts.runDir).toBe(path.resolve(tmp, `council-${opts.runId}`));
    expect(opts.critic).toBeNull();
    expect(opts.lenses).toBeNull();
  });

  test('--run-id and --out-dir are honored (MCP spawn path)', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: {} });
    await handleCouncilRun(argsBase({ 'run-id': 'feedc0de', 'out-dir': path.join(tmp, 'X') }));
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.runId).toBe('feedc0de');
    expect(opts.runDir).toBe(path.resolve(tmp, 'X'));
  });

  test('bad --run-id → BAD_SESSION', async () => {
    const code = await handleCouncilRun(argsBase({ 'run-id': 'no/slash' }));
    expect(code).toBe(1);
    expect(lastJson().error.code).toBe('BAD_SESSION');
  });

  test('exit codes pass through; --json prints the run manifest on 0/2', async () => {
    runCouncil.mockResolvedValue({ exitCode: 2, run: { schemaVersion: 2, type: 'council-run', runId: 'r1', status: 'partial' } });
    const code = await handleCouncilRun(argsBase());
    expect(code).toBe(2);
    expect(lastJson()).toMatchObject({ type: 'council-run', status: 'partial' });
  });

  test('exit 1 with run.error prints the error doc', async () => {
    runCouncil.mockResolvedValue({
      exitCode: 1,
      run: { status: 'error', error: { code: 'COUNCIL_QUORUM', message: 'only 1 survived' } },
    });
    const code = await handleCouncilRun(argsBase());
    expect(code).toBe(1);
    const doc = lastJson();
    expect(doc.type).toBe('error');
    expect(doc.error.code).toBe('COUNCIL_QUORUM');
  });

  test('human mode prints a summary line', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: {
      runId: 'r1', status: 'complete', exitCode: 0, bench: ['gemini', 'gpt'], chair: 'deepseek',
      options: { outDir: path.join(tmp, 'council-r1') },
      usage: { cost: { amount: 0.09, source: 'reported' } }, error: null,
    } });
    const args = argsBase(); args.json = false;
    await handleCouncilRun(args);
    const text = out.mock.calls.map(c => c[0]).join('');
    expect(text).toContain('Council run r1: complete (exit 0)');
    expect(text).toContain('chair: deepseek');
  });

  /**
   * v4.4: the human summary is one of the four surfaces an unknown cost must be
   * impossible to miss on. Printing `cost: $0.3720 (mixed)` for the real
   * council-wsgate02 — which actually spent $0.9859 — is the headline defect.
   */
  test('human mode marks the cost as a FLOOR when any leg is unpriced', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: {
      runId: 'r1', status: 'complete', exitCode: 0, bench: ['gemini', 'gpt'], chair: 'deepseek',
      options: { outDir: path.join(tmp, 'council-r1'), maxCost: 0.75 },
      usage: {
        cost: { amount: 0.372, source: 'mixed', reportedLegs: 8, estimatedLegs: 0, unpricedLegs: 3 },
        unknownLegs: 3, costExact: false,
      },
      error: null,
    } });
    const args = argsBase(); args.json = false;
    await handleCouncilRun(args);
    const text = out.mock.calls.map(c => c[0]).join('');
    expect(text).toMatch(/\$0\.3720/);
    expect(text).toMatch(/3 leg\(s\) unknown/);
    expect(text).toMatch(/at least/i);
  });

  test('human mode leaves a fully priced cost line alone', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: {
      runId: 'r1', status: 'complete', exitCode: 0, bench: ['gemini'], chair: 'deepseek',
      options: { outDir: path.join(tmp, 'council-r1') },
      usage: { cost: { amount: 0.09, source: 'reported' }, unknownLegs: 0, costExact: true },
      error: null,
    } });
    const args = argsBase(); args.json = false;
    await handleCouncilRun(args);
    const text = out.mock.calls.map(c => c[0]).join('');
    expect(text).toContain('cost:  $0.0900 (reported)');
    expect(text).not.toMatch(/unknown/i);
  });

  test('a run whose cost is ENTIRELY unknown still prints a cost line saying so', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: {
      runId: 'r1', status: 'complete', exitCode: 0, bench: ['gemini'], chair: 'deepseek',
      options: { outDir: path.join(tmp, 'council-r1') },
      usage: {
        cost: { amount: null, source: 'unknown', reportedLegs: 0, estimatedLegs: 0, unpricedLegs: 2 },
        unknownLegs: 2, costExact: false,
      },
      error: null,
    } });
    const args = argsBase(); args.json = false;
    await handleCouncilRun(args);
    const text = out.mock.calls.map(c => c[0]).join('');
    // The pre-fix behaviour printed NO cost line at all here (the `typeof
    // amount === 'number'` guard skipped it), so a fully unpriced run looked
    // like a run that cost nothing worth mentioning.
    expect(text).toMatch(/cost:/);
    expect(text).toMatch(/2 leg\(s\) unknown/);
  });
});

// v4.6 Plan 4 Task 3 (#81, spec §2 — the SILENCE half): MCP's amicus_council_run
// auto-opens the Workspace; the CLI path announced its existence on NO surface.
// getElectronPath is a pure presence probe (same one doctor's electron checks
// use) injected as this handler's first deps seam — a fake stands in here so
// no test ever depends on this machine's real Electron install state.
describe('Workspace notice on the CLI path (#81: the SILENCE half)', () => {
  const noticeFor = (runId) =>
    `Notice: the Council Workspace can render this run live — open it with: amicus watch ${runId} --ui\n`;

  test('human mode + Electron present prints exactly one Workspace notice with the real runId, on stderr', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: { runId: 'r1', status: 'complete' } });
    const args = argsBase(); args.json = false;
    const code = await handleCouncilRun(args, { getElectronPath: () => '/fake/Electron.app' });
    expect(code).toBe(0);
    const runId = runCouncil.mock.calls[0][0].runId;
    const stderrText = err.mock.calls.map(c => c[0]).join('');
    const notice = noticeFor(runId);
    expect(stderrText).toContain(notice);
    expect(stderrText.split(notice).length - 1).toBe(1); // exactly one occurrence
  });

  test('--json mode never emits the Workspace notice, even when Electron is present', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: { runId: 'r2', status: 'complete' } });
    const code = await handleCouncilRun(argsBase(), { getElectronPath: () => '/fake/Electron.app' });
    expect(code).toBe(0);
    const stderrText = err.mock.calls.map(c => c[0]).join('');
    expect(stderrText).not.toContain('Council Workspace');
  });

  test('human mode with Electron absent emits no Workspace notice', async () => {
    runCouncil.mockResolvedValue({ exitCode: 0, run: { runId: 'r3', status: 'complete' } });
    const args = argsBase(); args.json = false;
    const code = await handleCouncilRun(args, { getElectronPath: () => null });
    expect(code).toBe(0);
    const stderrText = err.mock.calls.map(c => c[0]).join('');
    expect(stderrText).not.toContain('Council Workspace');
  });
});
