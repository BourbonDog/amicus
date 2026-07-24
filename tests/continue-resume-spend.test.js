'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { finalizeSpendForReopen } = require('../src/sidecar/continue');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-spend-')); }

describe('continue/resume finalize writes usage + ledger row (BACKLOG.md:280)', () => {
  const result = { summary: 'x', completed: true, usage: { tokens: { input: 100, output: 40 }, costReported: 0.03 } };

  test('resolves usage into metadata and appends a row with the given op', () => {
    const dir = tmp();
    const meta = { taskId: 'k1', model: 'gpt', mode: 'headless', status: 'complete' };
    const out = finalizeSpendForReopen({
      taskId: 'k1', model: 'gpt', mode: 'headless', op: 'continue',
      result, status: 'complete', project: '/p', metadata: meta,
    }, { dir });
    expect(out.usage.tokens.input).toBe(100);
    expect(meta.usage.tokens.input).toBe(100);
    const rows = require('../src/utils/spend-ledger').readSpendRows(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: 'k1', op: 'continue', model: 'gpt', status: 'complete' });
  });

  test('no usage totals -> no row, no metadata.usage (an errored reopen)', () => {
    const dir = tmp();
    const meta = { taskId: 'k2', model: 'gpt' };
    const out = finalizeSpendForReopen({
      taskId: 'k2', model: 'gpt', mode: 'headless', op: 'resume',
      result: { summary: '', completed: false, error: 'boom' }, status: 'error', project: '/p', metadata: meta,
    }, { dir });
    expect(out.usage).toBeNull();
    expect('usage' in meta).toBe(false);
    expect(require('../src/utils/spend-ledger').readSpendRows(dir)).toEqual([]);
  });
});
