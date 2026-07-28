// tests/template/render.test.js
'use strict';
// F9 (v4.5): strict template rendering. {{input}} is deliberately NOT a known
// variable in v4.5 — it arrives with v4.6's --input-from.
const { renderTemplate, KNOWN_VARIABLES } = require('../../src/template/render');

const BASE = { date: '2026-07-27', project: 'C:\\proj' };

describe('renderTemplate: substitution', () => {
  test('replaces every known variable, whitespace-tolerant', () => {
    const res = renderTemplate(
      'P:{{prompt}} A:{{ artifact }} AP:{{artifact_path}} D:{{date}} PR:{{ project }} V:{{var.k}}',
      { ...BASE, prompt: 'p', artifact: 'a', artifactPath: '/x/f.md', vars: { k: 'v' } }
    );
    expect(res.error).toBeUndefined();
    expect(res.text).toBe('P:p A:a AP:/x/f.md D:2026-07-27 PR:C:\\proj V:v');
    expect(res.notices).toEqual([]);
  });

  test('the same variable may appear multiple times', () => {
    const res = renderTemplate('{{prompt}} and again {{prompt}}', { ...BASE, prompt: 'x' });
    expect(res.text).toBe('x and again x');
  });

  test('text without any variables passes through untouched', () => {
    const res = renderTemplate('no slots here', BASE);
    expect(res.text).toBe('no slots here');
  });
});

describe('renderTemplate: strict errors', () => {
  test('unknown variable errors and lists the known set', () => {
    const res = renderTemplate('{{model}}', BASE);
    expect(res.error).toMatch(/Unknown template variable \{\{model\}\}/);
    for (const v of ['{{prompt}}', '{{artifact}}', '{{artifact_path}}', '{{date}}', '{{project}}', '{{var.<key>}}']) {
      expect(res.error).toContain(v);
    }
  });

  test('{{input}} is unknown in v4.5 (chaining ships in v4.6)', () => {
    const res = renderTemplate('{{input}}', BASE);
    expect(res.error).toMatch(/Unknown template variable \{\{input\}\}/);
  });

  test('slot without data: {{prompt}} present but no prompt given', () => {
    const res = renderTemplate('{{prompt}}', BASE);
    expect(res.error).toMatch(/\{\{prompt\}\}.*no --prompt/);
  });

  test('data without slot: prompt given but template has no {{prompt}}', () => {
    const res = renderTemplate('static', { ...BASE, prompt: 'p' });
    expect(res.error).toMatch(/no \{\{prompt\}\} slot.*silently dropped/);
  });

  test('slot without data: {{artifact}} present but no --artifact', () => {
    const res = renderTemplate('{{artifact}}', BASE);
    expect(res.error).toMatch(/\{\{artifact\}\}.*no --artifact/);
  });

  test('data without slot: artifact given but neither artifact slot present', () => {
    const res = renderTemplate('static', { ...BASE, artifact: 'a', artifactPath: '/x' });
    expect(res.error).toMatch(/no \{\{artifact\}\}/);
  });

  test('{{artifact_path}} alone satisfies the artifact-slot rule', () => {
    const res = renderTemplate('{{artifact_path}}', { ...BASE, artifact: 'a', artifactPath: '/x/f.md' });
    expect(res.error).toBeUndefined();
    expect(res.text).toBe('/x/f.md');
  });

  test('{{var.k}} without --var k=… errors naming the key', () => {
    const res = renderTemplate('{{var.missing}}', { ...BASE, vars: {} });
    expect(res.error).toMatch(/\{\{var\.missing\}\}.*no --var missing=/);
  });

  test('unused --var produces a notice, not an error', () => {
    const res = renderTemplate('static', { ...BASE, vars: { unused: 'v' } });
    expect(res.error).toBeUndefined();
    expect(res.notices).toEqual(['Notice: --var unused=… is not used by this template']);
  });
});

describe('KNOWN_VARIABLES', () => {
  test('is exactly the v4.5 set', () => {
    expect(KNOWN_VARIABLES).toEqual(['prompt', 'artifact', 'artifact_path', 'date', 'project', 'var.<key>']);
  });
});
