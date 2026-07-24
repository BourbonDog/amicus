// tests/cli-council-run-flags.test.js
'use strict';

/**
 * v4.1 Task 8 — `--debate` / `--claude-review` / `--no-cost-gate` on the
 * `amicus council run` CLI surface: parse (cli.js) + forward (the handler).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/council/run', () => ({ runCouncil: jest.fn() }));
const { runCouncil } = require('../src/council/run');
const { parseArgs } = require('../src/cli');
const { handleCouncilRun } = require('../src/cli-handlers-council-run');

let tmp; let out; let err; let briefingFile; let reviewFile;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-council-flags-'));
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
  reviewFile = path.join(tmp, 'review-claude.md');
  fs.writeFileSync(reviewFile, 'Claude prose.\n');
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  runCouncil.mockReset();
  runCouncil.mockResolvedValue({ exitCode: 0, run: { runId: 'r', status: 'complete', exitCode: 0 } });
});
afterEach(() => {
  out.mockRestore(); err.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const argsBase = (extra = {}) => ({
  _: ['council', 'run'], json: true, cwd: tmp,
  'prompt-file': briefingFile, models: 'gemini,gpt,qwen', ...extra,
});

describe('parseArgs registers --debate as a boolean flag', () => {
  // RED-PHASE NOTE: an UNREGISTERED `--flag` sitting at the END of argv (or in
  // front of another `--flag`) already parses as `true` today — parseArgs falls
  // through to `result[key] = true` when `next` is missing or starts with `--`.
  // A test shaped that way can never fail. The contract that actually needs
  // guarding is: the parsed value is a BOOLEAN, and the FOLLOWING TOKEN is not
  // consumed as the flag's value. Both assertions fail before `isBooleanFlag`
  // learns 'debate'.
  test('--debate is boolean and does not swallow the next token', () => {
    const args = parseArgs(['council', 'run', '--debate', 'extra']);
    expect(args.debate).toBe(true);          // before: 'extra' (a string)
    expect(args._).toContain('extra');       // before: eaten as --debate's value
  });

  test('--debate does not swallow a following --prompt-file value', () => {
    const args = parseArgs(['council', 'run', '--debate', 'briefing.md', '--models', 'a,b']);
    expect(args.debate).toBe(true);
    expect(args.models).toBe('a,b');
    expect(args._).toContain('briefing.md');
  });
});

describe('council run forwards the three v4.1 flags into runCouncil options', () => {
  test('--debate / --claude-review / --no-cost-gate all reach runCouncil', async () => {
    const code = await handleCouncilRun(argsBase({
      'claude-review': reviewFile, debate: true, 'no-cost-gate': true,
    }));
    expect(code).toBe(0);
    expect(runCouncil).toHaveBeenCalledTimes(1);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.debate).toBe(true);
    expect(opts.noCostGate).toBe(true);
    expect(path.isAbsolute(opts.claudeReviewFile)).toBe(true);
    expect(opts.claudeReviewFile).toBe(reviewFile);
  });

  test('a relative --claude-review is resolved to an absolute path', async () => {
    await handleCouncilRun(argsBase({ 'claude-review': './rel/review.md' }));
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.claudeReviewFile).toBe(path.resolve('./rel/review.md'));
  });

  // Additive contract: a run passing NONE of the new flags must produce the
  // same engine options a v4.0 run produced (debate off, gate on, no file).
  test('omitting the flags leaves debate/noCostGate false and claudeReviewFile null', async () => {
    await handleCouncilRun(argsBase());
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.debate).toBe(false);
    expect(opts.noCostGate).toBe(false);
    expect(opts.claudeReviewFile).toBeNull();
  });
});

// v4.3 Task 3 (spec §7.1): councilName threading — the preset name reaches
// runCouncil() when launched via --council <preset>, and stays null (never
// fabricated) when launched via --models.
describe('council run threads councilName (v4.3 Task 3, spec §7.1)', () => {
  test('--council <preset> threads the preset name into runCouncil options', async () => {
    // budget's bench includes the 'deepseek' alias (the default chair) — pick
    // an explicit chair outside it so this doesn't trip the bench/chair guard.
    const args = argsBase({ council: 'budget', chair: 'opus' });
    delete args.models;
    const code = await handleCouncilRun(args);
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.councilName).toBe('budget');
  });

  test('--models with no preset leaves councilName null', async () => {
    const code = await handleCouncilRun(argsBase());
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.councilName).toBeNull();
  });

  // The internal --council-name passthrough (mcp-council-run.js spawns the
  // CLI child with an already-expanded --models list, never --council) is
  // the ONLY way the preset name reaches this process in that path.
  test('the internal --council-name passthrough also threads the preset name (MCP spawn path)', async () => {
    const code = await handleCouncilRun(argsBase({ 'council-name': 'nightly-council' }));
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.councilName).toBe('nightly-council');
  });

  // Task 4 review fix: the passthrough is user-supplied/unbounded/unvalidated
  // (unlike a real --council <preset>, catalog-validated upstream) and lands
  // verbatim in the spend ledger's councilName column — exactly the dimension
  // --group-by council reads. Trim, drop control/non-printable chars, cap 64.
  test('the --council-name passthrough is sanitized (control chars stripped, capped at 64 chars)', async () => {
    const base = 'nightly-council';
    // Control chars (including \x00/\x1F/\x7F and internal whitespace like \t,
    // all in \x00-\x1F) are stripped; leading/trailing whitespace is trimmed
    // AFTER stripping; length is capped at 64.
    const dirty = `  ${base}\x00\x1F\x7F${'x'.repeat(100)}  `;
    const code = await handleCouncilRun(argsBase({ 'council-name': dirty }));
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    const expected = (base + 'x'.repeat(100)).slice(0, 64);
    expect(opts.councilName).toBe(expected);
    expect(opts.councilName.length).toBe(64);
    expect(opts.councilName).not.toMatch(/[\x00-\x1F\x7F]/);
  });

  // A real preset must still outrank the passthrough (precedence unchanged).
  test('a catalog --council preset still outranks a dirty --council-name passthrough', async () => {
    const args = argsBase({ council: 'budget', chair: 'opus', 'council-name': 'ignored\x00junk' });
    delete args.models;
    const code = await handleCouncilRun(args);
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.councilName).toBe('budget');
  });
});
