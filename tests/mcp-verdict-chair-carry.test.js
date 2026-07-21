// tests/mcp-verdict-chair-carry.test.js
'use strict';
const { handlers } = require('../src/mcp-server');

/**
 * MCP half of the Stage-5 chair-verdict defect. `amicus_verdict` had the same
 * `buildVerdict(record, decisions)` shape as the CLI — no `opts` — so the
 * Cowork path (call the tool, write the returned JSON over the engine's
 * verdict.json) destroyed the chair's synthesis exactly like the Bash path.
 *
 * The transport differs: MCP receives `record` as an inline object and has no
 * run-folder path to anchor on, so the chair verdict is an explicit optional
 * input Claude reads from the engine's verdict.json. Omitted → null.
 */

function record() {
  return {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt'], claudeInCouncil: false },
    findings: [{
      id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Confirmed',
      basis: { a: 2, d: 0, n: 0 }, confidence: 'solid', tierOverride: null, adjudications: [],
    }],
    rankings: [], streetCred: [], runStats: [],
    tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 }, judged: true,
  };
}

/** The verdict JSON out of the fenced text result. */
function verdictOf(res) {
  const text = res.content[0].text;
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

test('amicus_verdict carries an explicit overallVerdict into the decided verdict', async () => {
  const res = await handlers.amicus_verdict(
    { record: record(), decisions: [], overallVerdict: 'Fix these first' }, process.cwd());
  expect(verdictOf(res).overallVerdict).toBe('Fix these first');
});

test('amicus_verdict without overallVerdict stays null (skipped chair; nothing invented)', async () => {
  const res = await handlers.amicus_verdict({ record: record(), decisions: [] }, process.cwd());
  expect(verdictOf(res).overallVerdict).toBeNull();
});

test('amicus_verdict with an explicit null overallVerdict stays null', async () => {
  const res = await handlers.amicus_verdict(
    { record: record(), decisions: [], overallVerdict: null }, process.cwd());
  expect(verdictOf(res).overallVerdict).toBeNull();
});
