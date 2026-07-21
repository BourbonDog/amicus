// tests/mcp-council-run-inputs.test.js
'use strict';

/**
 * v4.1 Task 8 — `amicus_council_run` gains `debate` / `claudeReviewFile` /
 * `noCostGate` inputs.
 *
 * The ARGV is the real boundary: handleCouncilRunTool never calls runCouncil —
 * it validates, pre-seeds the run dir, then hands an argv to the injected
 * spawnFn. A test that mocked runCouncil would never touch it, so every
 * assertion behind it would silently skip.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleCouncilRunTool } = require('../src/mcp-council-run');
const { getTools } = require('../src/mcp-tools');

let tmp; let briefingFile; let reviewFile;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-council-inputs-'));
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
  reviewFile = path.join(tmp, 'review-claude.md');
  fs.writeFileSync(reviewFile, 'Claude prose.\n');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// spawnFn is injected by mcp-server; capture the argv instead of spawning.
const helpers = (spawnCalls) => ({
  spawnFn: (args, dir) => { spawnCalls.push({ args, dir }); return { pid: 4242 }; },
  clientName: 'claude-code',
});
// `models` is an ARRAY on this tool (resolveBenchInput ignores a comma string).
const input = (extra = {}) => ({ briefingFile, models: ['gemini', 'gpt', 'qwen'], ...extra });

test('debate/claudeReviewFile/noCostGate reach the spawned council run argv', async () => {
  const calls = [];
  const res = await handleCouncilRunTool(
    input({ debate: true, claudeReviewFile: reviewFile, noCostGate: true }), tmp, helpers(calls));
  expect(res.isError).toBeUndefined();
  expect(calls).toHaveLength(1);
  const args = calls[0].args;
  expect(args).toContain('--debate');
  expect(args).toContain('--no-cost-gate');
  expect(args[args.indexOf('--claude-review') + 1]).toBe(reviewFile);   // absolute
});

test('a relative claudeReviewFile is resolved against the project dir', async () => {
  const calls = [];
  await handleCouncilRunTool(
    input({ claudeReviewFile: 'sub/review.md' }), tmp, helpers(calls));
  const args = calls[0].args;
  expect(args[args.indexOf('--claude-review') + 1]).toBe(path.resolve(tmp, 'sub/review.md'));
});

test('omitted inputs add no flags (v4.0 argv byte-unchanged)', async () => {
  const calls = [];
  await handleCouncilRunTool(input(), tmp, helpers(calls));
  const args = calls[0].args;
  expect(args).not.toContain('--debate');
  expect(args).not.toContain('--no-cost-gate');
  expect(args).not.toContain('--claude-review');
});

test('the three inputs are declared on the amicus_council_run schema; tool count stays 15', () => {
  const tools = getTools();
  expect(tools).toHaveLength(15);
  const tool = tools.find(t => t.name === 'amicus_council_run');
  expect(Object.keys(tool.inputSchema)).toEqual(
    expect.arrayContaining(['debate', 'claudeReviewFile', 'noCostGate']));
});
