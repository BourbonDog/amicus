// tests/template/apply.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let tmp;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-apply-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const load = () => require('../../src/template/apply');

function userTemplate(name, text) {
  const dir = path.join(tmp, 'templates');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), text);
  return path.join(dir, `${name}.md`);
}

describe('applyTemplate', () => {
  test('renders and returns template-sourced promptMeta', () => {
    const p = userTemplate('t1', 'Do: {{prompt}} on {{date}} in {{project}}');
    const res = load().applyTemplate({ templateRef: 't1', prompt: 'the task', project: '/proj' });
    expect(res.error).toBeUndefined();
    expect(res.prompt).toMatch(/^Do: the task on \d{4}-\d{2}-\d{2} in \/proj$/);
    expect(res.promptMeta.source).toBe('template');
    expect(res.promptMeta.file).toBe(path.resolve(p));
    expect(res.promptMeta.chars).toBe(res.prompt.length);
    expect(res.promptMeta.template).toEqual({ name: 't1', hash: expect.stringMatching(/^[0-9a-f]{12}$/) });
  });

  test('reads --artifact (BOM-stripped) and fills both artifact slots', () => {
    userTemplate('t2', 'A:{{artifact}} at {{artifact_path}}');
    const art = path.join(tmp, 'artifact.txt');
    fs.writeFileSync(art, '\uFEFFbody');
    const res = load().applyTemplate({ templateRef: 't2', artifactFile: art, project: '/p' });
    expect(res.error).toBeUndefined();
    expect(res.prompt).toBe(`A:body at ${path.resolve(art)}`);
  });

  test('artifact over 256 KB is rejected pre-render', () => {
    userTemplate('t3', '{{artifact}}');
    const art = path.join(tmp, 'big.txt');
    fs.writeFileSync(art, 'x'.repeat(256 * 1024 + 1));
    const res = load().applyTemplate({ templateRef: 't3', artifactFile: art, project: '/p' });
    expect(res.error.code).toBe('TEMPLATE_RENDER');
    expect(res.error.message).toMatch(/256 KB/);
  });

  test('unknown template -> TEMPLATE_NOT_FOUND with the list hint', () => {
    const res = load().applyTemplate({ templateRef: 'ghost', project: '/p' });
    expect(res.error.code).toBe('TEMPLATE_NOT_FOUND');
    expect(res.error.hint).toBe('amicus template list');
  });

  test('render violation -> TEMPLATE_RENDER carrying the render message', () => {
    userTemplate('t4', 'static, no slots');
    const res = load().applyTemplate({ templateRef: 't4', prompt: 'dropped?', project: '/p' });
    expect(res.error.code).toBe('TEMPLATE_RENDER');
    expect(res.error.message).toMatch(/silently dropped/);
  });

  test('--var k=v parsing: repeatable, k=v shape enforced', () => {
    userTemplate('t5', '{{var.a}}/{{var.b}}');
    const ok = load().applyTemplate({ templateRef: 't5', varList: ['a=1', 'b=2'], project: '/p' });
    expect(ok.prompt).toBe('1/2');
    const bad = load().applyTemplate({ templateRef: 't5', varList: ['nope'], project: '/p' });
    expect(bad.error.code).toBe('BAD_ARGS');
    expect(bad.error.message).toMatch(/--var expects key=value/);
  });

  // F4 (Task-5 review): parseArgs' inline `--var=a=1` form yields a bare string,
  // not a one-element array — applyTemplate must coerce rather than iterate it
  // char-by-char.
  test('--var= inline form: a bare string varList still renders {{var.*}}', () => {
    userTemplate('t6', '{{var.a}}');
    const res = load().applyTemplate({ templateRef: 't6', varList: 'a=1', project: '/p' });
    expect(res.error).toBeUndefined();
    expect(res.prompt).toBe('1');
  });
});
