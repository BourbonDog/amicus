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
