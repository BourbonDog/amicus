// tests/mcp-verdict-render.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handlers } = require('../src/mcp-server');

// Scratch tree this suite owns: `project` is what the handler treats as the
// project dir, so every write the tool is allowed to make lands inside it and
// the test can assert on it exactly. (Counting entries in os.tmpdir() itself is
// racy — sibling suites create and delete dirs there in parallel.)
let root; let project;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-render-'));
  project = path.join(root, 'proj');
  fs.mkdirSync(project);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function record() {
  return {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt'], claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Confirmed', basis: { a: 2, d: 0, n: 0 },
      confidence: 'solid', tierOverride: null, adjudications: [] }],
    rankings: [], streetCred: [], runStats: [], tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 }, judged: true,
  };
}

test('amicus_verdict render:true with outDir returns md AND writes report.html; stays fenced', async () => {
  const outDir = path.join(project, 'run');
  const res = await handlers.amicus_verdict({ record: record(), decisions: [], render: true, outDir }, project);
  const text = res.content[0].text;
  expect(text).toContain('untrusted_sidecar_output'); // fence preserved
  expect(text).toContain('Council Report');           // md rendering returned
  expect(fs.existsSync(path.join(outDir, 'report.html'))).toBe(true);
});

test('amicus_verdict render:true without outDir returns md, writes nothing', async () => {
  const res = await handlers.amicus_verdict({ record: record(), render: true }, project);
  expect(res.content[0].text).toContain('Council Report');
  expect(fs.readdirSync(project)).toEqual([]); // the only dir it could have written to is untouched
});

test('amicus_verdict outDir escaping the project dir → isError, nothing written', async () => {
  const res = await handlers.amicus_verdict(
    { record: record(), render: true, outDir: path.join('..', 'escaped-report') }, project);
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/outDir must resolve to a path inside the project directory/);
  expect(fs.existsSync(path.join(root, 'escaped-report'))).toBe(false);
});

test('amicus_verdict without render is byte-compatible with v4.0 (fenced, compact verdict JSON)', async () => {
  const res = await handlers.amicus_verdict({ record: record(), decisions: [] }, project);
  const text = res.content[0].text;
  expect(text).toContain('<untrusted_sidecar_output');
  expect(text).toContain('"type":"council-verdict"'); // JSON.stringify(verdict) — compact, never pretty-printed
});
