'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mocks for the end-to-end describe block below (Finding 2): same set
// continue-json.test.js / resume-json.test.js already use to drive the REAL
// continueSidecar/resumeSidecar without touching a real model/Electron/OpenCode.
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));
jest.mock('../src/headless', () => ({ runHeadless: jest.fn() }));
jest.mock('../src/sidecar/interactive', () => ({
  runInteractive: jest.fn()
}));
jest.mock('../src/sidecar/interactive-process', () => ({
  checkElectronAvailable: jest.fn(() => true)
}));
jest.mock('../src/utils/mcp-discovery', () => ({ discoverParentMcps: jest.fn(() => null) }));
jest.mock('../src/opencode-client', () => ({
  loadMcpConfig: jest.fn(() => null), parseMcpSpec: jest.fn(() => null)
}));
jest.mock('../src/utils/model-validator', () => ({ warnIfNotInCatalog: jest.fn() }));

const { finalizeSpendForReopen } = require('../src/sidecar/reopen-spend');
const { continueSidecar } = require('../src/sidecar/continue');
const { resumeSidecar } = require('../src/sidecar/resume');
const { runHeadless } = require('../src/headless');
const { readSpendRows } = require('../src/utils/spend-ledger');
const { SessionPaths } = require('../src/sidecar/session-utils');
const { groupRows } = require('../src/spend-query');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-spend-')); }

/** Seed a session dir at the layout continueSidecar/resumeSidecar expect. */
function seedSession(projectDir, taskId, overrides = {}) {
  const dir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    taskId, model: 'google/gemini-2.5-flash', agent: 'build',
    briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete',
    ...overrides,
  }));
  return dir;
}

// ⚠️ The BACKLOG anchor is the entry TITLE, not a line. It read `BACKLOG.md:280` until T-A8
// re-opened it (2026-08-17): `:280` is a docs/usage.md line; the entry is `:289` and will move.
describe('continue/resume finalize writes usage + ledger row (BACKLOG.md :: "continue/resume never compute per-run usage")', () => {
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

  // #218 PR 3 whole-branch review: the reopen ledger row carries `finish` when
  // the result has one. Named mutant "SOLOROWNOFINISH" (drop `finish` from the
  // appendSpend call in reopen-spend.js :: finalizeSpendForReopen).
  test("result.finish 'length' rides the reopen ledger row", () => {
    const dir = tmp();
    const meta = { taskId: 'k3', model: 'gpt', mode: 'headless', status: 'error' };
    finalizeSpendForReopen({
      taskId: 'k3', model: 'gpt', mode: 'headless', op: 'continue',
      result: {
        summary: '', completed: false, error: 'OUTPUT_LENGTH: ...', finish: 'length',
        usage: { tokens: { input: 5, output: 0, reasoning: 32000, cacheRead: 0, cacheWrite: 0 }, costReported: 0.63 },
      },
      status: 'error', project: '/p', metadata: meta,
    }, { dir });
    const rows = require('../src/utils/spend-ledger').readSpendRows(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].finish).toBe('length'); // SOLOROWNOFINISH
  });

  test("a result with no finish leaves the key off the row (appendSpend's typeof-string gate)", () => {
    const dir = tmp();
    const meta = { taskId: 'k4', model: 'gpt', mode: 'headless', status: 'complete' };
    finalizeSpendForReopen({
      taskId: 'k4', model: 'gpt', mode: 'headless', op: 'continue',
      result, status: 'complete', project: '/p', metadata: meta,
    }, { dir });
    const rows = require('../src/utils/spend-ledger').readSpendRows(dir);
    expect(rows).toHaveLength(1);
    expect('finish' in rows[0]).toBe(false);
  });
});

// Finding 2: only the pure helper above had coverage — the reload -> call-helper
// -> conditional write-back wiring at continue.js:~270-278 / resume.js:~252-261
// was entirely unexercised. These drive the REAL continueSidecar/resumeSidecar
// (not the helper directly) so a wrong-variable capture, a swapped `op`, or a
// dropped write-back would actually fail a test.
describe('continue/resume wiring: end-to-end spend-ledger + metadata.usage (Finding 2)', () => {
  let projectDir;
  let prevConfigDir;
  let ledgerDir;
  let logSpy;
  const usage = { tokens: { input: 50, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.01 };

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-e2espend-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-e2espend-ledger-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(projectDir, { recursive: true, force: true });
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  it('continueSidecar appends a spend-ledger row with op:"continue" and writes metadata.usage', async () => {
    seedSession(projectDir, 'old0e2e1');
    runHeadless.mockResolvedValue({
      summary: 'continued', completed: true, timedOut: false, aborted: false, taskId: 'new0e2e1', usage,
    });
    await continueSidecar({
      taskId: 'old0e2e1', newTaskId: 'new0e2e1', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    // Guards the op values NOT being swapped between continue.js/resume.js.
    expect(rows[0]).toMatchObject({ taskId: 'new0e2e1', op: 'continue', status: 'complete' });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.usage.tokens.input).toBe(50);
  });

  it('resumeSidecar appends a spend-ledger row with op:"resume" and writes metadata.usage', async () => {
    seedSession(projectDir, 'res0e2e1');
    runHeadless.mockResolvedValue({
      summary: 'resumed', completed: true, timedOut: false, aborted: false, taskId: 'res0e2e1', usage,
    });
    await resumeSidecar({
      taskId: 'res0e2e1', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    // Guards the op values NOT being swapped between continue.js/resume.js.
    expect(rows[0]).toMatchObject({ taskId: 'res0e2e1', op: 'resume', status: 'complete' });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.usage.tokens.input).toBe(50);
  });

  it('timed-out continue writes a ledger row with status "timeout" (start.js vocabulary, not "timed-out")', async () => {
    seedSession(projectDir, 'old0e2e2');
    runHeadless.mockResolvedValue({
      summary: 'partial', completed: false, timedOut: true, aborted: false, taskId: 'new0e2e2', usage,
    });
    await continueSidecar({
      taskId: 'old0e2e2', newTaskId: 'new0e2e2', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('timeout');
  });

  it('timed-out resume writes a ledger row with status "timeout" (start.js vocabulary, not "timed-out")', async () => {
    seedSession(projectDir, 'res0e2e2');
    runHeadless.mockResolvedValue({
      summary: 'partial', completed: false, timedOut: true, aborted: false, taskId: 'res0e2e2', usage,
    });
    await resumeSidecar({
      taskId: 'res0e2e2', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('timeout');
  });

  // #218 PR 3 whole-branch review: an OUTPUT_LENGTH death is `status: 'error'`,
  // so it takes continue.js/resume.js's `terminal.status === 'error'` branch —
  // the one that writes metadata.json directly and never calls finalizeSession.
  // Named mutants: "SOLOERRORNOFINISH" (drop the `meta.finish` line from that
  // branch) and "SOLOROWNOFINISH" (drop `finish` from the appendSpend call).
  const OUTPUT_LENGTH_REASON = "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — 32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — raise outputBudget in config.json (docs/configuration.md, Output budget)";
  const lengthDeath = {
    completed: false, error: OUTPUT_LENGTH_REASON, summary: '', finish: 'length',
    variant: 'high', variantUnverified: true,
    usage: { tokens: { input: 5, output: 0, reasoning: 32000, cacheRead: 0, cacheWrite: 0 }, costReported: 0.63 },
  };

  it("an OUTPUT_LENGTH continue writes finish 'length' on metadata.json and on its ledger row", async () => {
    seedSession(projectDir, 'old0e2e3');
    runHeadless.mockResolvedValue({ ...lengthDeath, timedOut: false, aborted: false, taskId: 'new0e2e3' });
    await continueSidecar({
      taskId: 'old0e2e3', newTaskId: 'new0e2e3', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      SessionPaths.metadataFile(SessionPaths.sessionDir(projectDir, 'new0e2e3')), 'utf-8'));
    expect(meta.status).toBe('error');
    expect(meta.reason.startsWith('OUTPUT_LENGTH:')).toBe(true);
    expect(meta.finish).toBe('length'); // SOLOERRORNOFINISH
    expect(meta.variant).toBe('high'); // CONTINUEERRORNOVARIANT
    expect(meta.variantUnverified).toBe(true);
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
    expect(rows[0].finish).toBe('length'); // SOLOROWNOFINISH
    expect(rows[0].variant).toBe('high'); // SOLOROWNOVARIANT
  });

  it("an OUTPUT_LENGTH resume writes finish 'length' on metadata.json and on its ledger row", async () => {
    seedSession(projectDir, 'res0e2e3');
    runHeadless.mockResolvedValue({ ...lengthDeath, timedOut: false, aborted: false, taskId: 'res0e2e3' });
    await resumeSidecar({
      taskId: 'res0e2e3', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      SessionPaths.metadataFile(SessionPaths.sessionDir(projectDir, 'res0e2e3')), 'utf-8'));
    expect(meta.status).toBe('error');
    expect(meta.reason.startsWith('OUTPUT_LENGTH:')).toBe(true);
    expect(meta.finish).toBe('length'); // SOLOERRORNOFINISH
    expect(meta.variant).toBe('high'); // RESUMEERRORNOVARIANT
    expect(meta.variantUnverified).toBe(true);
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
    expect(rows[0].finish).toBe('length'); // SOLOROWNOFINISH
    expect(rows[0].variant).toBe('high'); // SOLOROWNOVARIANT
  });

  // #218 PR 4 whole-branch review (§C2 / TM-4, parked m6): the COMPLETE branch's
  // finalizeSession passthrough was unpinned at both reopen sites too.
  it('a COMPLETED continue stamps the variant it sent and no unverified flag', async () => {
    // Named mutant "CONTINUEVARIANTDROPPED": drop the variant args from continue.js's finalizeSession call.
    seedSession(projectDir, 'old0e2e6');
    runHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'new0e2e6', variant: 'low', usage,
    });
    await continueSidecar({
      taskId: 'old0e2e6', newTaskId: 'new0e2e6', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      SessionPaths.metadataFile(SessionPaths.sessionDir(projectDir, 'new0e2e6')), 'utf-8'));
    expect(meta.status).toBe('complete');
    expect(meta.variant).toBe('low');
    expect('variantUnverified' in meta).toBe(false);
  });

  it('a COMPLETED resume stamps the variant it sent and no unverified flag', async () => {
    // Named mutant "RESUMEVARIANTDROPPED": drop the variant args from resume.js's finalizeSession call.
    seedSession(projectDir, 'res0e2e6');
    runHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'res0e2e6', variant: 'low', usage,
    });
    await resumeSidecar({
      taskId: 'res0e2e6', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      SessionPaths.metadataFile(SessionPaths.sessionDir(projectDir, 'res0e2e6')), 'utf-8'));
    expect(meta.status).toBe('complete');
    expect(meta.variant).toBe('low');
    expect('variantUnverified' in meta).toBe(false);
  });

  // Council #232 r1 B1: a resume REUSES the session's own metadata.json, so a
  // finish stamped by the previous attempt is still on the object resume.js
  // writes back. When this attempt records none, it must be removed.
  // Named mutant "STALEFINISH": drop the `else { delete … }` from resume.js's
  // error branch / session-utils.js :: finalizeSession.
  it("a resumed run that errors with no finish REMOVES the prior attempt's (council #232 r1 B1)", async () => {
    seedSession(projectDir, 'res0e2e4', { finish: 'length', variant: 'low', variantUnverified: true });
    runHeadless.mockResolvedValue({
      summary: '', completed: false, timedOut: false, aborted: false,
      taskId: 'res0e2e4', error: 'connection reset', usage,
    });
    await resumeSidecar({
      taskId: 'res0e2e4', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      SessionPaths.metadataFile(SessionPaths.sessionDir(projectDir, 'res0e2e4')), 'utf-8'));
    expect(meta.status).toBe('error');
    expect('finish' in meta).toBe(false); // STALEFINISH
    // #218 PR 4: variant/variantUnverified follow the same removal rule as finish.
    expect('variant' in meta).toBe(false);
    expect('variantUnverified' in meta).toBe(false);
  });

  it("a resumed run that completes with no finish also drops the prior attempt's (council #232 r1 B1)", async () => {
    seedSession(projectDir, 'res0e2e5', { finish: 'length' });
    runHeadless.mockResolvedValue({
      summary: 'resumed', completed: true, timedOut: false, aborted: false, taskId: 'res0e2e5', usage,
    });
    await resumeSidecar({
      taskId: 'res0e2e5', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      SessionPaths.metadataFile(SessionPaths.sessionDir(projectDir, 'res0e2e5')), 'utf-8'));
    expect(meta.status).toBe('complete');
    expect('finish' in meta).toBe(false); // STALEFINISH
  });
});

// v4.7.1 Task 7 (R-C): `continue`/`resume` must inherit the parent session's
// tag instead of writing `tag: null` — today's behavior mis-buckets continued
// work under `(unattributed)` in `amicus spend --group-by tag`.
describe('continue/resume inherit the parent tag (v4.7.1 Task 7)', () => {
  let projectDir;
  let prevConfigDir;
  let ledgerDir;
  let logSpy;
  const usage = { tokens: { input: 50, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.01 };

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-tagspend-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-tagspend-ledger-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(projectDir, { recursive: true, force: true });
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  /** metadata.json path for a session that hasn't necessarily been read yet. */
  function newSessionMetadataPath(taskId) {
    return SessionPaths.metadataFile(SessionPaths.sessionDir(projectDir, taskId));
  }

  it('a continued session inherits the parent tag onto its own metadata.json', async () => {
    seedSession(projectDir, 'tagparent1', { tag: 'demo' });
    runHeadless.mockResolvedValue({
      summary: 'continued', completed: true, timedOut: false, aborted: false, taskId: 'tagchild1', usage,
    });
    await continueSidecar({
      taskId: 'tagparent1', newTaskId: 'tagchild1', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(newSessionMetadataPath('tagchild1'), 'utf-8'));
    expect(meta.tag).toBe('demo');
  });

  it('an untagged parent leaves the key ABSENT, not null (D13)', async () => {
    seedSession(projectDir, 'tagparent2', {});
    runHeadless.mockResolvedValue({
      summary: 'continued', completed: true, timedOut: false, aborted: false, taskId: 'tagchild2', usage,
    });
    await continueSidecar({
      taskId: 'tagparent2', newTaskId: 'tagchild2', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const meta = JSON.parse(fs.readFileSync(newSessionMetadataPath('tagchild2'), 'utf-8'));
    expect(meta.tag).toBeUndefined();
    expect('tag' in meta).toBe(false);
  });

  it('the continue spend row carries the tag instead of landing in (unattributed)', async () => {
    seedSession(projectDir, 'tagparent3', { tag: 'demo' });
    runHeadless.mockResolvedValue({
      summary: 'continued', completed: true, timedOut: false, aborted: false, taskId: 'tagchild3', usage,
    });
    await continueSidecar({
      taskId: 'tagparent3', newTaskId: 'tagchild3', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows[0].tag).toBe('demo');
    expect(groupRows(rows, 'tag').map((g) => g.key)).not.toContain('(unattributed)');
  });

  it('resume carries the tag with no change to resume.js', async () => {
    seedSession(projectDir, 'tagsolo1', { tag: 'demo' });
    runHeadless.mockResolvedValue({
      summary: 'resumed', completed: true, timedOut: false, aborted: false, taskId: 'tagsolo1', usage,
    });
    await resumeSidecar({
      taskId: 'tagsolo1', project: projectDir, headless: true, timeout: 5, json: true,
    });
    expect(readSpendRows(ledgerDir)[0].tag).toBe('demo');
  });

  it('a two-hop chain keeps the tag — this is what a ledger-only fix breaks', async () => {
    // Continue #2 reads continue #1's metadata. If the tag were only forwarded
    // to appendSpend (a ledger-only pass-through) and never persisted onto the
    // continuation's own metadata.json, hop #1's ledger row would carry the tag
    // correctly (read straight off the ORIGINAL parent) but hop #1's metadata.json
    // would stay tagless — so hop #2, which reads hop #1's metadata as ITS
    // "parent", would find nothing to inherit and scatter back to
    // `(unattributed)`. Asserting on the LAST row (not the first) is what makes
    // this test actually exercise persistence rather than the ledger call alone.
    seedSession(projectDir, 'tagchain0', { tag: 'demo' });
    runHeadless.mockResolvedValueOnce({
      summary: 'first hop', completed: true, timedOut: false, aborted: false, taskId: 'tagchain1', usage,
    });
    await continueSidecar({
      taskId: 'tagchain0', newTaskId: 'tagchain1', briefing: 'follow-up 1',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    runHeadless.mockResolvedValueOnce({
      summary: 'second hop', completed: true, timedOut: false, aborted: false, taskId: 'tagchain2', usage,
    });
    await continueSidecar({
      taskId: 'tagchain1', newTaskId: 'tagchain2', briefing: 'follow-up 2',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    expect(readSpendRows(ledgerDir).at(-1).tag).toBe('demo');
  });
});
