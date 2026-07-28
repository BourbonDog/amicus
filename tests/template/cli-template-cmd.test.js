// tests/template/cli-template-cmd.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleTemplate } = require('../../src/cli-handlers-template');

let tmp; let out; let err;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-cmd-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  out.mockRestore(); err.mockRestore();
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const stdout = () => out.mock.calls.map((c) => c[0]).join('');

test('template list marks built-ins and shadowing', async () => {
  fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'templates', 'review.md'), 'x');
  fs.writeFileSync(path.join(tmp, 'templates', 'mine.md'), 'y');
  const code = await handleTemplate({ _: ['template', 'list'] });
  expect(code).toBe(0);
  expect(stdout()).toMatch(/mine/);
  expect(stdout()).toMatch(/review.*\[shadows built-in\]/);
});

test('template list --json is a stable array', async () => {
  const code = await handleTemplate({ _: ['template', 'list'], json: true });
  expect(code).toBe(0);
  const doc = JSON.parse(stdout());
  expect(doc.type).toBe('template-list');
  expect(doc.templates).toEqual([{ name: 'review', builtin: true, shadowed: false }]);
});

test('template show prints the text; --json wraps it', async () => {
  expect(await handleTemplate({ _: ['template', 'show', 'review'] })).toBe(0);
  expect(stdout()).toContain('{{artifact}}');
  out.mockClear();
  expect(await handleTemplate({ _: ['template', 'show', 'review'], json: true })).toBe(0);
  const doc = JSON.parse(stdout());
  expect(doc).toMatchObject({ type: 'template', name: 'review', builtin: true, path: null });
  expect(doc.hash).toMatch(/^[0-9a-f]{12}$/);
});

test('template show for an unknown name exits 1 through the envelope', async () => {
  expect(await handleTemplate({ _: ['template', 'show', 'ghost'], json: true })).toBe(1);
  const doc = JSON.parse(stdout());
  expect(doc.error.code).toBe('TEMPLATE_NOT_FOUND');
});

test('unknown subcommand is BAD_ARGS', async () => {
  expect(await handleTemplate({ _: ['template', 'frobnicate'], json: true })).toBe(1);
  expect(JSON.parse(stdout()).error.code).toBe('BAD_ARGS');
});
