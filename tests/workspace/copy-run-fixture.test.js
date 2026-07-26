'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { copyRunFixture } = require('../helpers/copy-run-fixture');

const FX = path.join(__dirname, '..', 'fixtures');

describe('copyRunFixture', () => {
  let scratch;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-run-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test('copies council-run-live and rewrites the bare __RUNDIR__ sentinel to dest', () => {
    const dest = path.join(scratch, 'live-run');
    const returned = copyRunFixture(path.join(FX, 'council-run-live'), dest);

    expect(returned).toBe(dest);
    expect(fs.existsSync(path.join(dest, 'run.json'))).toBe(true);

    const run = JSON.parse(fs.readFileSync(path.join(dest, 'run.json'), 'utf-8'));
    expect(run.options.outDir).toBe(dest);
    expect(run.stages[0].project).toBe(dest);

    // The leg session files came along for the copy too.
    expect(fs.existsSync(path.join(dest, '.claude', 'amicus_sessions', 'dddd0001', 'progress.json'))).toBe(true);
  });

  test('copies council-run-complete and rewrites the __RUNDIR__/_scratch sentinel too', () => {
    const dest = path.join(scratch, 'complete-run');
    copyRunFixture(path.join(FX, 'council-run-complete'), dest);

    const run = JSON.parse(fs.readFileSync(path.join(dest, 'run.json'), 'utf-8'));
    expect(run.options.outDir).toBe(dest);
    // stage1/chair carry the bare sentinel
    expect(run.stages[0].project).toBe(dest);
    expect(run.stages[2].project).toBe(dest);
    // stage2 carries the "/_scratch" suffix — this is the branch that exercises
    // path.join(dest, s.project.slice('__RUNDIR__'.length)) with a non-empty suffix.
    expect(run.stages[1].project).toBe(path.join(dest, '_scratch'));
  });
});
