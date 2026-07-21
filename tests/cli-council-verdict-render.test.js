// tests/cli-council-verdict-render.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleCouncil } = require('../src/cli-handlers-council');

function tallyDoc() {
  return {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt'], claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Confirmed', basis: { a: 2, d: 0, n: 0 },
      confidence: 'solid', tierOverride: null, adjudications: [] }],
    rankings: [], streetCred: [], runStats: [], tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 }, judged: true,
  };
}

test('council verdict --render writes verdict.json AND report.html next to it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify(tallyDoc()));
  const outPath = path.join(dir, 'verdict.json');
  const code = await handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath, render: true });
  expect(code).toBe(0);
  expect(fs.existsSync(outPath)).toBe(true);
  expect(fs.existsSync(path.join(dir, 'report.html'))).toBe(true);
  expect(fs.readFileSync(path.join(dir, 'report.html'), 'utf-8')).toContain('Council Report');
});

test('council verdict without --render writes only verdict.json (v4.0 behavior)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norender-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify(tallyDoc()));
  const outPath = path.join(dir, 'verdict.json');
  await handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath });
  expect(fs.existsSync(path.join(dir, 'report.html'))).toBe(false);
});
