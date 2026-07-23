'use strict';

const { summarizeDoctor } = require('../src/utils/doctor-summary');

test('all ok → single line', () => {
  expect(summarizeDoctor([{ status: 'ok' }, { status: 'ok' }])).toBe('doctor: all 2 checks pass');
});

test('non-ok → lines + counts', () => {
  const out = summarizeDoctor([
    { status: 'ok', name: 'Node.js' },
    { status: 'warn', name: 'Electron', message: 'not installed' },
    { status: 'error', name: 'API keys', message: 'none' },
  ]);
  expect(out).toMatch(/Electron/);
  expect(out).toMatch(/API keys/);
  expect(out).toMatch(/1 error\(s\), 1 warning\(s\)/);
  expect(out).toMatch(/run `amicus doctor`/);
});

test('ok checks are never listed — only non-ok lines appear', () => {
  const out = summarizeDoctor([
    { status: 'ok', name: 'Node.js' },
    { status: 'warn', name: 'Electron', message: 'not installed' },
  ]);
  expect(out).not.toMatch(/Node\.js/);
});

test('warn-only set (zero errors) still pluralizes both counters correctly', () => {
  const out = summarizeDoctor([
    { status: 'warn', name: 'Electron', message: 'not installed' },
    { status: 'warn', name: 'Local providers', message: 'ollama unreachable' },
  ]);
  expect(out).toMatch(/0 error\(s\), 2 warning\(s\)/);
});

test('error-only set (zero warnings) still pluralizes both counters correctly', () => {
  const out = summarizeDoctor([
    { status: 'error', name: 'API keys', message: 'none' },
  ]);
  expect(out).toMatch(/1 error\(s\), 0 warning\(s\)/);
});

test('falls back to id when name is absent', () => {
  const out = summarizeDoctor([{ status: 'warn', id: 'local-providers', message: 'ollama unreachable' }]);
  expect(out).toMatch(/local-providers/);
});

test('empty checks array → zero-count all-pass line (no division/formatting crash)', () => {
  expect(summarizeDoctor([])).toBe('doctor: all 0 checks pass');
});
