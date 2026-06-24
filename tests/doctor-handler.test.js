// tests/doctor-handler.test.js
'use strict';
const path = require('path');
const doctor = require('../src/cli-handlers-doctor');

function capture(fn) {
  const out = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve(fn()).then((code) => { process.stdout.write = orig; return { code, out: out.join('') }; })
    .catch((e) => { process.stdout.write = orig; throw e; });
}

describe('handleDoctor', () => {
  test('--json emits a doctor doc on stdout and returns 0 when healthy', async () => {
    const checks = [{ id: 'node', name: 'Node.js', status: 'ok', message: 'v20', hint: null }];
    const { code, out } = await capture(() => doctor.handleDoctor({ _: ['doctor'], json: true }, () => checks));
    const doc = JSON.parse(out);
    expect(doc.type).toBe('doctor');
    expect(doc.ok).toBe(true);
    expect(code).toBe(0);
  });

  test('returns 1 when any check is an error', async () => {
    const checks = [{ id: 'keys', name: 'API keys', status: 'error', message: 'none', hint: 'amicus key' }];
    const { code } = await capture(() => doctor.handleDoctor({ _: ['doctor'], json: true }, () => checks));
    expect(code).toBe(1);
  });

  test('human output shows ✓/⚠/✗ marks and hints', async () => {
    const checks = [
      { id: 'a', name: 'Node.js', status: 'ok', message: 'v20', hint: null },
      { id: 'b', name: 'API keys', status: 'error', message: 'none', hint: 'amicus key <provider> <key>' },
    ];
    const { out } = await capture(() => doctor.handleDoctor({ _: ['doctor'] }, () => checks));
    expect(out).toMatch(/Node\.js/);
    expect(out).toMatch(/amicus key/);
    expect(out).toMatch(/[✓✗]/);
  });

  test('doctor is a one-shot command', () => {
    const { ONE_SHOT_COMMANDS } = require('../src/utils/lifecycle');
    expect(ONE_SHOT_COMMANDS.has('doctor')).toBe(true);
  });

  test('usage text mentions doctor', () => {
    const { getUsage } = require('../src/cli');
    expect(getUsage()).toMatch(/doctor/);
  });
});
