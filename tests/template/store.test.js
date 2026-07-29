// tests/template/store.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let tmp;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-store-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const load = () => require('../../src/template/store');

describe('resolveTemplate by name', () => {
  test('resolves a user file in <configDir>/templates', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mine.md'), 'User template {{prompt}}');
    const res = load().resolveTemplate('mine');
    expect(res.error).toBeUndefined();
    expect(res.name).toBe('mine');
    expect(res.builtin).toBe(false);
    expect(res.text).toBe('User template {{prompt}}');
    expect(res.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  test('falls back to the built-in review template', () => {
    const res = load().resolveTemplate('review');
    expect(res.error).toBeUndefined();
    expect(res.builtin).toBe(true);
    expect(res.path).toBeNull();
    expect(res.text).toContain('{{prompt}}');
    expect(res.text).toContain('{{artifact}}');
  });

  test('a user file named review shadows the built-in', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'review.md'), 'shadowed {{prompt}}');
    const res = load().resolveTemplate('review');
    expect(res.builtin).toBe(false);
    expect(res.text).toBe('shadowed {{prompt}}');
  });

  test('unknown name errors with the template list hint shape', () => {
    const res = load().resolveTemplate('nope');
    expect(res.error).toMatch(/Template 'nope' not found/);
  });

  test('BOM is stripped from user template files', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bom.md'), '﻿{{prompt}}');
    expect(load().resolveTemplate('bom').text).toBe('{{prompt}}');
  });
});

describe('resolveTemplate by path', () => {
  test('a value ending in .md is a path (cwd-relative ok)', () => {
    const f = path.join(tmp, 'custom.md');
    fs.writeFileSync(f, 'From path {{prompt}}');
    const res = load().resolveTemplate(f);
    expect(res.error).toBeUndefined();
    expect(res.name).toBe('custom');
    expect(res.path).toBe(path.resolve(f));
    expect(res.builtin).toBe(false);
  });

  test('an unreadable path errors', () => {
    const res = load().resolveTemplate(path.join(tmp, 'missing.md'));
    expect(res.error).toMatch(/cannot read template/);
  });
});

describe('listTemplates', () => {
  test('merges built-ins and user files, marking shadowing', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'review.md'), 'x');
    fs.writeFileSync(path.join(dir, 'mine.md'), 'y');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
    const list = load().listTemplates();
    expect(list).toEqual(expect.arrayContaining([
      { name: 'mine', builtin: false, shadowed: false },
      { name: 'review', builtin: false, shadowed: true },
    ]));
    expect(list.find((t) => t.name === 'notes')).toBeUndefined();
  });

  test('with no user dir, lists exactly the built-ins', () => {
    expect(load().listTemplates()).toEqual([{ name: 'review', builtin: true, shadowed: false }]);
  });
});
