// tests/fanout-cli.test.js
'use strict';

const { getUsage } = require('../src/cli');
const { ONE_SHOT_COMMANDS } = require('../src/utils/lifecycle');

describe('fanout CLI surface', () => {
  it('usage text documents fanout, --models, --prompt-file, --json and exit codes', () => {
    const usage = getUsage();
    expect(usage).toContain('fanout');
    expect(usage).toContain('--models');
    expect(usage).toContain('--prompt-file');
    expect(usage).toContain('--wave-id');
    expect(usage).toMatch(/exit code/i);
  });

  it('fanout is a one-shot command (exit watchdog armed)', () => {
    expect(ONE_SHOT_COMMANDS.has('fanout')).toBe(true);
  });

  it('bin/amicus.js routes fanout and plumbs the exit code', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../bin/amicus.js'), 'utf-8');
    expect(src).toContain("case 'fanout':");
    expect(src).toContain('handleFanout');
    expect(src).toContain('armExitWatchdog(exitCode');
  });

  it('handleFanout source guards timeout and empty model lists', () => {
    const fs = require('fs');
    const path = require('path');
    // handleFanout was extracted from bin/amicus.js to src/cli-handlers-run.js (WS-2 #6)
    const src = fs.readFileSync(path.join(__dirname, '../src/cli-handlers-fanout.js'), 'utf-8');
    expect(src).toContain('--timeout must be a positive number');
    expect(src).toContain('at least one non-empty entry');
  });
});

describe('handleFanout argument checks', () => {
  afterEach(() => { jest.resetModules(); });

  it('rejects an out-of-vocabulary --thinking before anything starts, as `start` does (#218 PR 4 whole-branch review, VCMD-2)', async () => {
    // Named mutant "FANOUTTHINKINGUNCHECKED": drop the check — process.exit is never called and runFanout receives thinking 'turbo'.
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`); });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.doMock('../src/pack/pack-cli', () => ({ applyPackOrExit: jest.fn(() => null) }));
    const runFanout = jest.fn();
    jest.doMock('../src/sidecar/fanout', () => ({ runFanout }));
    try {
      const { handleFanout } = require('../src/cli-handlers-fanout');
      await expect(handleFanout({ models: 'kimi,haiku', prompt: 'p', thinking: 'turbo', 'no-context': true })).rejects.toThrow(/^exit /);
      expect(runFanout).not.toHaveBeenCalled();
      expect(errSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('Error: --thinking must be one of: none, minimal, low, medium, high, xhigh, max');
    } finally { exitSpy.mockRestore(); errSpy.mockRestore(); jest.dontMock('../src/pack/pack-cli'); jest.dontMock('../src/sidecar/fanout'); }
  });
});
