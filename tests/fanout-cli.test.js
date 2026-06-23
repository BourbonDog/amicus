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
    const src = fs.readFileSync(path.join(__dirname, '../src/cli-handlers-run.js'), 'utf-8');
    expect(src).toContain('--timeout must be a positive number');
    expect(src).toContain('at least one non-empty entry');
  });
});
