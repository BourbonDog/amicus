// tests/template/cli-wiring.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/council/run', () => ({ runCouncil: jest.fn() }));
jest.mock('../../src/sidecar/fanout', () => ({
  runFanout: jest.fn(), parseModelsList: (s) => String(s || '').split(',').filter(Boolean),
}));
const { runCouncil } = require('../../src/council/run');
const { runFanout } = require('../../src/sidecar/fanout');
const { parseArgs } = require('../../src/cli');
const { handleCouncilRun } = require('../../src/cli-handlers-council-run');
const { handleFanout } = require('../../src/cli-handlers-run');

let tmp; let out; let err; let exit;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-cli-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  exit = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`); });
  runCouncil.mockReset();
  runCouncil.mockResolvedValue({ exitCode: 0, run: { runId: 'r', status: 'complete', exitCode: 0 } });
  runFanout.mockReset();
  runFanout.mockResolvedValue({ exitCode: 0 });
});
afterEach(() => {
  out.mockRestore(); err.mockRestore(); exit.mockRestore();
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('parseArgs accumulates repeated --var', () => {
  const args = parseArgs(['fanout', '--var', 'a=1', '--var', 'b=2']);
  expect(args.var).toEqual(['a=1', 'b=2']);
});

test('fanout --template renders and forwards template promptMeta', async () => {
  fs.writeFileSync(path.join(tmp, 'templates', 't.md'), 'T:{{prompt}}');
  const briefing = path.join(tmp, 'b.md');
  fs.writeFileSync(briefing, 'body');
  await handleFanout(parseArgs([
    'fanout', '--models', 'a,b', '--prompt-file', briefing, '--template', 't', '--json',
  ]));
  expect(runFanout).toHaveBeenCalledTimes(1);
  const opts = runFanout.mock.calls[0][0];
  expect(opts.prompt).toBe('T:body');
  expect(opts.promptMeta.source).toBe('template');
  expect(opts.promptMeta.template.name).toBe('t');
});

test('council run --template with no {{prompt}} slot needs no --prompt-file', async () => {
  fs.writeFileSync(path.join(tmp, 'templates', 'fixed.md'), 'Fixed briefing, {{date}}.');
  const code = await handleCouncilRun(parseArgs([
    'council', 'run', '--models', 'a,b,c', '--template', 'fixed', '--json', '--cwd', tmp,
  ]));
  expect(code).toBe(0);
  const opts = runCouncil.mock.calls[0][0];
  expect(opts.briefing).toMatch(/^Fixed briefing, \d{4}-\d{2}-\d{2}\.$/);
  expect(opts.template).toEqual({ name: 'fixed', hash: expect.any(String) });
});

test('--artifact without --template is BAD_ARGS', async () => {
  const briefing = path.join(tmp, 'b.md');
  fs.writeFileSync(briefing, 'body');
  const code = await handleCouncilRun(parseArgs([
    'council', 'run', '--models', 'a,b', '--prompt-file', briefing, '--artifact', briefing, '--json', '--cwd', tmp,
  ]));
  expect(code).toBe(1);
  const doc = JSON.parse(out.mock.calls.map((c) => c[0]).join(''));
  expect(doc.error.code).toBe('BAD_ARGS');
});

test('a TEMPLATE_RENDER violation fails through the envelope pre-spend', async () => {
  fs.writeFileSync(path.join(tmp, 'templates', 'p.md'), 'no slots');
  const briefing = path.join(tmp, 'b.md');
  fs.writeFileSync(briefing, 'body');
  const code = await handleCouncilRun(parseArgs([
    'council', 'run', '--models', 'a,b', '--prompt-file', briefing, '--template', 'p', '--json', '--cwd', tmp,
  ]));
  expect(code).toBe(1);
  expect(runCouncil).not.toHaveBeenCalled();
  const doc = JSON.parse(out.mock.calls.map((c) => c[0]).join(''));
  expect(doc.error.code).toBe('TEMPLATE_RENDER');
});
