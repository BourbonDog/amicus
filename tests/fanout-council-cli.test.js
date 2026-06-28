'use strict';
const fs = require('fs');
const path = require('path');

describe('fanout --council (CLI surface + wiring)', () => {
  it('cli.js usage documents --council', () => {
    const { getUsage } = require('../src/cli');
    expect(getUsage()).toContain('--council');
  });

  it('handleFanout source enforces mutual exclusion and string-value guard', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/cli-handlers-run.js'), 'utf-8');
    expect(src).toContain('resolveCouncilMembers');
    expect(src).toContain('exactly one of --models / --council'); // error text
    expect(src).toContain("typeof args.council"); // boolean-true guard
  });
});
