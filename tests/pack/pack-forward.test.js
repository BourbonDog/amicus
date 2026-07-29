// tests/pack/pack-forward.test.js
'use strict';

/**
 * Direct unit tests for src/pack/pack-forward.js (Wave-1 review fix wave,
 * items I1/I2/I3): the new module mcp-server.js's amicus_fanout and both
 * amicus_start paths call to validate a pack-forwarded maxCost/template
 * BEFORE any spawn or state write. `forward` is exactly the shape
 * pack-resolve.js's `applyPackToMcpInput(...).forward` returns (that
 * module's own docblock: only ever `maxCost`/`template`, both optional).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ERROR_CODES } = require('../../src/utils/error-doc');

let tmp;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-forward-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const load = () => require('../../src/pack/pack-forward').prepareForward;

describe('prepareForward: maxCost validation (I2)', () => {
  test.each([
    ['a numeric string', '2.00'],
    ['zero', 0],
    ['negative', -5],
  ])('%s maxCost is rejected as PACK_INVALID, naming the pack and the bad value', (_label, badValue) => {
    const res = load()({ forward: { maxCost: badValue }, packRef: 'my-pack', prompt: 'hi', project: tmp });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(ERROR_CODES.PACK_INVALID);
    expect(res.error.message).toContain('my-pack');
    expect(res.error.message).toContain(JSON.stringify(badValue));
  });

  test('a valid positive maxCost passes through unchanged', () => {
    const res = load()({ forward: { maxCost: 5 }, packRef: 'my-pack', prompt: 'hi', project: tmp });
    expect(res.error).toBeUndefined();
    expect(res.maxCost).toBe(5);
  });

  test('no maxCost forwarded: no maxCost key on the result, no error', () => {
    const res = load()({ forward: {}, packRef: 'my-pack', prompt: 'hi', project: tmp });
    expect(res.error).toBeUndefined();
    expect(res.maxCost).toBeUndefined();
  });
});

describe('prepareForward: template dry-run (I1)', () => {
  test('the built-in review template (needs {{artifact}}/{{artifact_path}}) fails dry-run — the ONLY built-in, unreachable from fanout/start which can never supply --artifact', () => {
    const res = load()({ forward: { template: 'review' }, packRef: 'my-pack', prompt: 'Focus on X', project: tmp });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(ERROR_CODES.TEMPLATE_RENDER);
    expect(res.error.message).toMatch(/artifact/);
  });

  test('a prompt-only custom template dry-runs successfully and returns the rendered text', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompt-only.md'), 'Custom wrapper: {{prompt}}');
    const res = load()({ forward: { template: 'prompt-only' }, packRef: 'my-pack', prompt: 'Focus on X', project: tmp });
    expect(res.error).toBeUndefined();
    expect(res.templateName).toBe('prompt-only');
    expect(res.renderedPrompt).toBe('Custom wrapper: Focus on X');
  });

  test('no template forwarded: no templateName/renderedPrompt on the result, no error', () => {
    const res = load()({ forward: {}, packRef: 'my-pack', prompt: 'hi', project: tmp });
    expect(res.error).toBeUndefined();
    expect(res.templateName).toBeUndefined();
    expect(res.renderedPrompt).toBeUndefined();
  });
});

describe('prepareForward: notices pass-through', () => {
  test('applyTemplate notices (e.g. an unused --var) are threaded onto the result unchanged', () => {
    // Isolated (not file-level jest.mock): the OTHER describe blocks above need
    // the REAL applyTemplate/renderTemplate — jest.isolateModules scopes this
    // mock's registration to this one synchronous callback only, so it can
    // never leak into a test that runs before or after it.
    let res;
    jest.isolateModules(() => {
      jest.doMock('../../src/template/apply', () => ({
        applyTemplate: jest.fn(() => ({
          prompt: 'rendered',
          promptMeta: { source: 'template', file: null, chars: 8, template: { name: 'x', hash: 'y' } },
          notices: ['Notice: --var color=... is not used by this template'],
        })),
      }));
      res = require('../../src/pack/pack-forward').prepareForward({
        forward: { template: 'anything' }, packRef: 'my-pack', prompt: 'hi', project: tmp,
      });
    });
    expect(res.error).toBeUndefined();
    expect(res.notices).toEqual(['Notice: --var color=... is not used by this template']);
  });
});
