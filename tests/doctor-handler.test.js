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

  // v4.6 Plan 3 Task 4: the doctor doc gains the shared degrade/heal vocabulary.
  test('--json carries degrades[] for error rows and heals, absent when clean', async () => {
    const rows = [
      { id: 'a', name: 'A', status: 'ok', message: 'fine', hint: null },
      { id: 'engine-mcp', name: 'Engine', status: 'error', message: 'missing: C:\\x', hint: 'npm install -g amicus' },
      { id: 'electron', name: 'Electron', status: 'ok', message: 'installed (self-healed)', fixed: true, fixDetail: 'provisioned the Electron binary in place' },
    ];
    const { code, out } = await capture(() => doctor.handleDoctor({ _: [], json: true }, async () => rows));
    const doc = JSON.parse(out);
    expect(code).toBe(1);
    expect(doc.degrades).toHaveLength(2);
    expect(doc.degrades.map(d => d.kind).sort()).toEqual(['degrade', 'heal']);
    expect(doc.degrades.find(d => d.kind === 'degrade').data.checkId).toBe('engine-mcp');

    const { code: cleanCode, out: cleanOut } = await capture(() => doctor.handleDoctor({ _: [], json: true }, async () => [rows[0]]));
    const cleanDoc = JSON.parse(cleanOut);
    expect(cleanCode).toBe(0);
    expect(cleanDoc.degrades).toBeUndefined(); // absence never interpreted
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

  // v4.6 Plan 3 Task 4 / spec criterion 6: a self-healed run announces the
  // repair in the one voice (formatDegrade) and still exits 0.
  test('human output announces heals in the one voice and STILL exits 0 — criterion 6', async () => {
    const rows = [
      { id: 'electron', name: 'Electron', status: 'ok', message: 'installed (self-healed)', fixed: true, fixDetail: 'provisioned the Electron binary in place' },
    ];
    const { code, out } = await capture(() => doctor.handleDoctor({ _: [], fix: true }, async () => rows));
    expect(code).toBe(0); // a heal never degrades a healthy run
    expect(out).toContain("Recovered: the 'Electron' check was repaired in place — doctor --fix provisioned the Electron binary in place.");
  });

  test('human output does NOT duplicate failures as Notice lines', async () => {
    const rows = [{ id: 'x', name: 'X', status: 'error', message: 'broken', hint: null }];
    const { code, out } = await capture(() => doctor.handleDoctor({ _: [] }, async () => rows));
    expect(code).toBe(1);
    expect(out).not.toContain('Notice:'); // the ✗ row already says it
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
