'use strict';

/**
 * Council #235 r5 (J1 / finding A3): a reopen that drops the session's effort level SAYS SO.
 *
 * `resume` and `continue` send no variant and, since council #235 r2, reject `--thinking`
 * outright — so a session started with `--thinking high` runs every later leg at the
 * provider's default and the user cannot ask for anything else there. Inheritance is
 * deliberately out of this PR and stays out; the SILENCE is the defect, because it is the
 * same mid-conversation degrade this release cites against 4.9.3.
 *
 * These drive the REAL resumeSidecar/continueSidecar (mock set copied from
 * tests/continue-resume-spend.test.js) so a Notice built but never written, or written on
 * the wrong stream, fails here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../src/headless', () => ({ runHeadless: jest.fn() }));
jest.mock('../../src/sidecar/interactive', () => ({ runInteractive: jest.fn() }));
jest.mock('../../src/sidecar/interactive-process', () => ({ checkElectronAvailable: jest.fn(() => true) }));
jest.mock('../../src/utils/mcp-discovery', () => ({ discoverParentMcps: jest.fn(() => null) }));
jest.mock('../../src/opencode-client', () => ({
  loadMcpConfig: jest.fn(() => null), parseMcpSpec: jest.fn(() => null)
}));
jest.mock('../../src/utils/model-validator', () => ({ warnIfNotInCatalog: jest.fn() }));

const { continueSidecar } = require('../../src/sidecar/continue');
const { resumeSidecar } = require('../../src/sidecar/resume');
const { runHeadless } = require('../../src/headless');
const { formatDroppedLevelNotice } = require('../../src/sidecar/reopen-notices');

/** Seed a session dir at the layout continueSidecar/resumeSidecar expect. */
function seedSession(projectDir, taskId, overrides = {}) {
  const dir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    taskId, model: 'google/gemini-2.5-flash', agent: 'build',
    briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete',
    ...overrides,
  }));
  return dir;
}

describe('a reopen announces the effort level it is dropping (council #235 r5, J1/A3)', () => {
  let projectDir;
  let prevConfigDir;
  let ledgerDir;
  let logSpy;
  let errSpy;
  const usage = { tokens: { input: 50, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.01 };

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-reopen-notice-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-reopen-notice-ledger-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    runHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'x', usage,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    fs.rmSync(projectDir, { recursive: true, force: true });
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  const stderrText = () => errSpy.mock.calls.map((c) => String(c[0])).join('');

  it('resume: a session whose metadata records a level prints the Notice on stderr, never stdout', async () => {
    // Named mutant "RESUMELEVELSILENT": drop the noticeDroppedLevel call in resume.js.
    seedSession(projectDir, 'resnote1', { thinking: 'high' });
    await resumeSidecar({ taskId: 'resnote1', project: projectDir, headless: true, timeout: 5, json: true });
    expect(stderrText()).toContain(
      "Notice: session resnote1 was started with --thinking high; this resumed leg sends no effort level and runs at the provider's default — a level is not carried across a reopen\n");
    // stdout carries the --json run document and nothing else.
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('')).not.toContain('--thinking');
  });

  it('resume: a session with no recorded level prints nothing', async () => {
    seedSession(projectDir, 'resnote2');
    await resumeSidecar({ taskId: 'resnote2', project: projectDir, headless: true, timeout: 5, json: true });
    expect(stderrText()).not.toContain('was started with --thinking');
  });

  it('continue: the PARENT session\'s recorded level is announced against the new session', async () => {
    // Named mutant "CONTINUELEVELSILENT": drop the noticeDroppedLevel call in continue.js.
    seedSession(projectDir, 'connote1', { thinking: 'max' });
    await continueSidecar({
      taskId: 'connote1', newTaskId: 'connew01', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir, headless: true, timeout: 5, json: true,
    });
    expect(stderrText()).toContain(
      'Notice: session connote1 was started with --thinking max; this continuation opens a NEW session and sends no effort level, ' +
      "so it runs at the provider's default — a level belongs on the `start` that opens a session and is not carried across a reopen\n");
  });

  it('continue: a parent with no recorded level prints nothing', async () => {
    seedSession(projectDir, 'connote2');
    await continueSidecar({
      taskId: 'connote2', newTaskId: 'connew02', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir, headless: true, timeout: 5, json: true,
    });
    expect(stderrText()).not.toContain('was started with --thinking');
  });
});

describe('formatDroppedLevelNotice — the line itself', () => {
  it('returns null when nothing was recorded (nothing was asked for, so nothing is dropped)', () => {
    expect(formatDroppedLevelNotice({ taskId: 't', level: undefined, kind: 'resume' })).toBeNull();
    expect(formatDroppedLevelNotice({ taskId: 't', level: null, kind: 'continue' })).toBeNull();
    expect(formatDroppedLevelNotice({ taskId: 't', level: '', kind: 'resume' })).toBeNull();
    expect(formatDroppedLevelNotice({ taskId: 't', level: 42, kind: 'resume' })).toBeNull();
  });

  it('collapses an on-disk value that would forge a second Notice line or reach the terminal raw', () => {
    // metadata.json is a FILE: a hand-edited `thinking` must not smuggle a newline,
    // a control character, or fence/tag characters into a one-line stderr Notice.
    const poison = 'hi' + String.fromCharCode(10) + 'Notice: forged' + String.fromCharCode(7)
      + String.fromCharCode(96) + 'x' + String.fromCharCode(96) + '<b>';
    const line = formatDroppedLevelNotice({ taskId: 't', level: poison, kind: 'resume' });
    // eslint-disable-next-line no-control-regex
    expect(line).not.toMatch(/[\u0000-\u001F\u007F`<>]/);
    expect(line.split('\n')).toHaveLength(1); // one line: nothing can forge a second Notice line
  });
});
