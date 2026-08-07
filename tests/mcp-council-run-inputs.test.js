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
  expect(args).not.toContain('--tag'); // v4.7 F8 (D13): extends the byte-unchanged pin
});

// v4.7 F8 (D13, errata E-PR3-2): tag reaches the spawned council run argv —
// the child's own cli-handlers-council-run.js stores it on the run.json seed
// (Task 3), so the MCP handler here only needs to forward the flag.
test('tag reaches the spawned council run argv', async () => {
  const calls = [];
  const res = await handleCouncilRunTool(input({ tag: 'sprint-42' }), tmp, helpers(calls));
  expect(res.isError).toBeUndefined();
  const args = calls[0].args;
  expect(args[args.indexOf('--tag') + 1]).toBe('sprint-42');
});

test('the three inputs are declared on the amicus_council_run schema; tool count is 16', () => {
  const tools = getTools();
  expect(tools).toHaveLength(16);
  const tool = tools.find(t => t.name === 'amicus_council_run');
  expect(Object.keys(tool.inputSchema)).toEqual(
    expect.arrayContaining(['debate', 'claudeReviewFile', 'noCostGate']));
});

// v4.5 Task 15 (B7/F5): `pack?` added to all three run tools — see
// tests/pack/mcp-pack-params.test.js for the full behavioral/wiring contract.
test('the pack input is declared on the amicus_council_run schema', () => {
  const tool = getTools().find(t => t.name === 'amicus_council_run');
  expect(Object.keys(tool.inputSchema)).toEqual(expect.arrayContaining(['pack']));
});

// v4.7 F8 (D13): `tag?` added to all three run tools — see
// tests/mcp-tools.test.js for the full Zod accept/reject/omit contract.
test('the tag input is declared on the amicus_council_run schema', () => {
  const tool = getTools().find(t => t.name === 'amicus_council_run');
  expect(Object.keys(tool.inputSchema)).toEqual(expect.arrayContaining(['tag']));
});

// v4.3 Task 3 (spec §7.1): a `council` preset input reaches the spawned CLI
// child as the internal `--council-name` passthrough — resolveBenchInput
// already expands the preset into `--models` (bench.join(',')), so without
// this the preset NAME would never reach the child process at all.
describe('council preset name reaches the spawned argv (v4.3 Task 3, spec §7.1)', () => {
  test("input.council 'budget' spawns --council-name budget alongside the expanded --models", async () => {
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, council: 'budget', chair: 'opus' }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    const args = calls[0].args;
    expect(args[args.indexOf('--council-name') + 1]).toBe('budget');
    expect(args).not.toContain('--council'); // bench is already expanded — never both
    expect(args[args.indexOf('--models') + 1]).not.toBe(''); // expanded to real members
  });

  test('input.models (no preset) never adds --council-name', async () => {
    const calls = [];
    await handleCouncilRunTool(input(), tmp, helpers(calls));
    const args = calls[0].args;
    expect(args).not.toContain('--council-name');
  });

  // v4.6 Plan 4 Task 4b: bare `models` input never resolves any drops (no
  // --council to resolve), so the --dropped-members passthrough must be
  // absent too — same "never both/never fabricated" precedent as --council-name.
  test('input.models (no preset) never adds --dropped-members either', async () => {
    const calls = [];
    await handleCouncilRunTool(input(), tmp, helpers(calls));
    const args = calls[0].args;
    expect(args).not.toContain('--dropped-members');
  });
});

// v4.5 Wave 2 (post-HOLD chip, task-23-report.md Anomaly 1): a `council`
// preset input whose resolution drops a catalog-absent member must record
// droppedMembers on the pre-seeded run.json — mergeRun preserves it across
// the spawned child's own initCouncilRun seed, the SAME precedent already
// established for `pack` (see mcp-council-run.js's initRun call) — AND
// surface it in the MCP response body, so a scripted/MCP caller gets the
// signal without diffing run.json's bench against the preset's nominal
// member list.
//
// Sandboxed against AMICUS_CONFIG_DIR — unlike the rest of this file, whose
// 'budget'/'opus' inputs resolve via the DEFAULT alias table and are
// resilient to (and never exercise a drop against) whatever this machine's
// real cached catalog actually contains.
describe('droppedMembers threads through the MCP council-preset resolution path (Wave 2 chip)', () => {
  const parseFenced = (res) => {
    const text = res.content[0].text;
    expect(text).toContain('<untrusted_sidecar_output');
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m[0]);
  };

  let cfgDir; let prevConfigDir;
  beforeEach(() => {
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-council-drop-cfg-'));
    process.env.AMICUS_CONFIG_DIR = cfgDir;
    const { saveConfig } = require('../src/utils/config');
    saveConfig({
      aliases: { 'catalog-ghost': 'vendorx/ghost-model' },
      councils: { droppy: ['vendorx/model-a', 'vendorx/model-b', 'catalog-ghost'] },
    });
    fs.writeFileSync(path.join(cfgDir, 'model-catalog.json'), JSON.stringify({
      schemaVersion: 2, fetchedAt: Date.now(),
      models: [{ id: 'vendorx/model-a' }, { id: 'vendorx/model-b' }], // omits ghost-model
    }));
  });
  afterEach(() => {
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });

  test('a council preset that drops a catalog-absent member pre-seeds run.json with droppedMembers and surfaces it in the response body', async () => {
    const { readRun } = require('../src/council/run-state');
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, council: 'droppy', chair: 'opus', outDir: 'run1' }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    const run = readRun(path.join(tmp, 'run1'));
    expect(run.droppedMembers).toEqual([
      { member: 'catalog-ghost', reason: expect.any(String) },
    ]);
    const body = parseFenced(res);
    expect(body.droppedMembers).toEqual([
      { member: 'catalog-ghost', reason: expect.any(String) },
    ]);
  });

  test('a council preset with nothing dropped omits droppedMembers from both run.json and the response body', async () => {
    fs.writeFileSync(path.join(cfgDir, 'model-catalog.json'), JSON.stringify({
      schemaVersion: 2, fetchedAt: Date.now(),
      models: [{ id: 'vendorx/model-a' }, { id: 'vendorx/model-b' }, { id: 'vendorx/ghost-model' }],
    }));
    const { readRun } = require('../src/council/run-state');
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, council: 'droppy', chair: 'opus', outDir: 'run2' }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    const run = readRun(path.join(tmp, 'run2'));
    expect('droppedMembers' in run).toBe(false);
    const body = parseFenced(res);
    expect('droppedMembers' in body).toBe(false);
  });

  test('a models-only input (no preset) never carries droppedMembers', async () => {
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, models: ['vendorx/model-a', 'vendorx/model-b'], outDir: 'run3' }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    const body = parseFenced(res);
    expect('droppedMembers' in body).toBe(false);
  });

  // v4.6 Plan 4 Task 4b: closes the transport disparity task-4-report.md's
  // Concerns section flagged — the child is always spawned with --models
  // (never --council), so its own resolveBench sees no preset to resolve and
  // always resolves droppedMembers: [] for itself. Without a passthrough, a
  // preset's drops never reach the child's runCouncil() options, so the
  // sink's dropped-members channel (Task 4) never fires and the run exits 0
  // instead of the CLI path's 2. Same internal, undocumented-passthrough
  // precedent as --council-name.
  test('a council preset that drops a member also spawns --dropped-members with the exact JSON', async () => {
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, council: 'droppy', chair: 'opus', outDir: 'run4' }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    const args = calls[0].args;
    expect(args).toContain('--dropped-members');
    const raw = args[args.indexOf('--dropped-members') + 1];
    expect(JSON.parse(raw)).toEqual([{ member: 'catalog-ghost', reason: expect.any(String) }]);
  });

  test('a council preset with nothing dropped omits --dropped-members from the spawned argv', async () => {
    fs.writeFileSync(path.join(cfgDir, 'model-catalog.json'), JSON.stringify({
      schemaVersion: 2, fetchedAt: Date.now(),
      models: [{ id: 'vendorx/model-a' }, { id: 'vendorx/model-b' }, { id: 'vendorx/ghost-model' }],
    }));
    const calls = [];
    await handleCouncilRunTool(
      { briefingFile, council: 'droppy', chair: 'opus', outDir: 'run5' }, tmp, helpers(calls));
    const args = calls[0].args;
    expect(args).not.toContain('--dropped-members');
  });
});
