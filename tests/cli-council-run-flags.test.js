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
const stdout = () => out.mock.calls.map((c) => c[0]).join('');

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

// v4.6 Plan 4 Task 4b: the internal `--dropped-members` MCP→child passthrough
// — same precedent as --council-name (mcp-council-run.js spawns the CLI child
// with an already-expanded --models list, never --council, so the child's own
// resolveBench never resolves any drops for itself). Internal flag: malformed
// input means an amicus bug, not a user typo, so resolveBench fails loud
// rather than silently defaulting to [].
describe('the internal --dropped-members MCP→child passthrough (v4.6 Plan 4 Task 4b)', () => {
  test('a valid JSON array of {member, reason} threads through to runCouncil options', async () => {
    const json = JSON.stringify([{ member: 'vendorx/ghost', reason: 'not present in the cached model catalog' }]);
    const code = await handleCouncilRun(argsBase({ 'dropped-members': json }));
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.droppedMembers).toEqual([
      { member: 'vendorx/ghost', reason: 'not present in the cached model catalog' },
    ]);
  });

  test('absent --dropped-members leaves droppedMembers empty (unchanged default)', async () => {
    const code = await handleCouncilRun(argsBase());
    expect(code).toBe(0);
    expect(runCouncil.mock.calls[0][0].droppedMembers).toEqual([]);
  });

  test.each([
    ['not valid JSON at all', 'not-json{{{'],
    ['valid JSON but not an array', '{"member":"x","reason":"y"}'],
    ['an array of non-objects', '["x","y"]'],
    ['an array with a missing reason', '[{"member":"x"}]'],
    ['an array with a non-string member', '[{"member":1,"reason":"y"}]'],
  ])('malformed --dropped-members (%s) fails loud: BAD_ARGS naming the flag, no spawn', async (_name, raw) => {
    const code = await handleCouncilRun(argsBase({ 'dropped-members': raw }));
    expect(code).toBe(1);
    expect(runCouncil).not.toHaveBeenCalled();
    const doc = JSON.parse(out.mock.calls[0][0]);
    expect(doc.type).toBe('error');
    expect(doc.error.code).toBe('BAD_ARGS');
    expect(doc.error.message).toMatch(/--dropped-members/);
  });
});

// v4.5 Wave 2 (post-HOLD chip, task-23-report.md Anomaly 1): the live repro
// found `--council <preset>` silently dropping a member (whose alias resolves
// to a catalog-absent id) with ZERO signal reaching `--json`/MCP callers —
// only a stderr-only human-mode notice. resolveBench's droppedMembers (from
// resolveCouncilMembers) must thread into runCouncil's options so the engine
// can record them on run.json (see tests/council/run-schema.test.js for the
// engine-side proof that they land there and survive to the terminal doc).
//
// Sandboxed against AMICUS_CONFIG_DIR — unlike the 'budget'-based describe
// block above, which is resilient to (and never exercises) whatever this
// machine's real catalog/config actually contains.
describe('council run threads droppedMembers into runCouncil options (Wave 2 chip)', () => {
  let cfgDir; let prevConfigDir;
  beforeEach(() => {
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-drop-cfg-'));
    process.env.AMICUS_CONFIG_DIR = cfgDir;
    const { saveConfig } = require('../src/utils/config');
    // Two raw provider/model ids (need no alias) + one alias whose resolved id
    // will be absent from the seeded catalog below — mirrors the live repro's
    // shape (2 survivors, 1 dropped) without depending on any real alias table.
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

  test('a --council preset that drops a catalog-absent member threads droppedMembers (ref+reason) into runCouncil options', async () => {
    const args = argsBase({ council: 'droppy', chair: 'opus' });
    delete args.models;
    const code = await handleCouncilRun(args);
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.droppedMembers).toEqual([
      { member: 'catalog-ghost', reason: expect.any(String) },
    ]);
  });

  test('a --council preset with nothing dropped threads an empty droppedMembers (no false positives)', async () => {
    // Widen the catalog so all three members resolve — nothing dropped.
    fs.writeFileSync(path.join(cfgDir, 'model-catalog.json'), JSON.stringify({
      schemaVersion: 2, fetchedAt: Date.now(),
      models: [{ id: 'vendorx/model-a' }, { id: 'vendorx/model-b' }, { id: 'vendorx/ghost-model' }],
    }));
    const args = argsBase({ council: 'droppy', chair: 'opus' });
    delete args.models;
    const code = await handleCouncilRun(args);
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.droppedMembers).toEqual([]);
  });

  test('--models (no preset) leaves droppedMembers empty — no resolution ever ran', async () => {
    const code = await handleCouncilRun(argsBase());
    expect(code).toBe(0);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.droppedMembers).toEqual([]);
  });

  // Surface (b) from the wave-2 brief: the --json envelope IS the run doc
  // runCouncil resolved — no separate serialization path to keep in sync.
  // Once run.json carries droppedMembers (engine side, proved in
  // tests/council/run-schema.test.js), this rides for free through the same
  // `JSON.stringify(run, ...)` call every other run.json field already takes.
  test('the --json envelope carries whatever droppedMembers runCouncil resolved onto the run doc', async () => {
    runCouncil.mockResolvedValue({
      exitCode: 0,
      run: {
        runId: 'r', status: 'complete', exitCode: 0,
        droppedMembers: [{ member: 'catalog-ghost', reason: 'not present in the cached model catalog' }],
      },
    });
    const args = argsBase({ council: 'droppy', chair: 'opus' });
    delete args.models;
    const code = await handleCouncilRun(args);
    expect(code).toBe(0);
    const printed = JSON.parse(out.mock.calls[0][0]);
    expect(printed.droppedMembers).toEqual([
      { member: 'catalog-ghost', reason: 'not present in the cached model catalog' },
    ]);
  });

  // v4.6 Plan 4 Task 4: the bare, --json-blind stderr Notice this same fixture
  // used to print in human mode is gone — superseded by the sink's per-member
  // announcement (which fires inside runCouncil, mocked away in this suite).
  // Nothing else about this path changed: droppedMembers still threads through.
  test('human mode: the old "Notice: dropped unavailable council member(s)" line is GONE', async () => {
    const args = argsBase({ council: 'droppy', chair: 'opus', json: false });
    delete args.models;
    const code = await handleCouncilRun(args);
    expect(code).toBe(0);
    const stderrText = err.mock.calls.map(c => c[0]).join('');
    expect(stderrText).not.toMatch(/Notice: dropped unavailable council member/);
    const opts = runCouncil.mock.calls[0][0];
    expect(opts.droppedMembers).toEqual([
      { member: 'catalog-ghost', reason: expect.any(String) },
    ]);
  });

  // v4.6 Plan 4 Task 4b — THE PARITY PIN: an MCP-shaped invocation (bare
  // --models + the internal --dropped-members passthrough mcp-council-run.js
  // now spawns) must drive runCouncil with the SAME droppedMembers option a
  // real --council <preset> CLI invocation produces for an identical drop.
  // This is the exact disparity task-4-report.md's Concerns section flagged:
  // CLI exit 2 vs MCP exit 0 on the same preset dropping the same member.
  test('an MCP-shaped invocation (--models + --dropped-members) matches the CLI --council preset path', async () => {
    // Path A: a real --council <preset> CLI invocation.
    const presetArgs = argsBase({ council: 'droppy', chair: 'opus' });
    delete presetArgs.models;
    await handleCouncilRun(presetArgs);
    const presetDropped = runCouncil.mock.calls[0][0].droppedMembers;
    expect(presetDropped).toEqual([{ member: 'catalog-ghost', reason: expect.any(String) }]);

    // Path B: an MCP-shaped invocation — bare --models plus the internal
    // passthrough carrying the SAME drop list mcp-council-run.js would have
    // produced for this preset (mirrors how the MCP parent forwards it).
    runCouncil.mockClear();
    const mcpShapedArgs = argsBase({
      models: 'vendorx/model-a,vendorx/model-b',
      'dropped-members': JSON.stringify(presetDropped),
    });
    await handleCouncilRun(mcpShapedArgs);
    const mcpDropped = runCouncil.mock.calls[0][0].droppedMembers;

    expect(mcpDropped).toEqual(presetDropped);
  });
});

describe('valueless and dash-leading value flags (v4.7 PR6)', () => {
  // These flags reached runCouncil as `true`, as a NaN, or as a path escaping
  // the project — the CLI had no containment fence where MCP has isPathInside.
  const bad = [
    ['out-dir', true, /--out-dir requires a value/],
    ['out-dir', '-x', /--out-dir cannot start with '-'/],
    ['claude-review', true, /--claude-review requires a value/],
    ['run-id', true, /--run-id requires a value/],
    ['timeout', true, /--timeout requires a number/],
    ['timeout', 'abc', /--timeout requires a number/],
  ];
  for (const [flag, value, re] of bad) {
    it(`rejects --${flag} ${JSON.stringify(value)}`, async () => {
      const args = { ...argsBase(), [flag]: value, __explicit: new Set([flag]) };
      const code = await handleCouncilRun(args);
      expect(code).toBe(1);
      // The assertion that actually goes RED: the handler writes nothing to disk,
      // so a leak check would be vacuous. Prove the engine was never reached.
      expect(runCouncil).not.toHaveBeenCalled();
      expect(JSON.parse(stdout()).error.message).toMatch(re);
    });
  }

  it('rejects an --out-dir that escapes the project', async () => {
    const args = { ...argsBase(), 'out-dir': path.join('..', '..', 'escape'), __explicit: new Set(['out-dir']) };
    expect(await handleCouncilRun(args)).toBe(1);
    expect(runCouncil).not.toHaveBeenCalled();
    expect(JSON.parse(stdout()).error.message).toMatch(/must stay inside the project/);
  });

  it('still accepts a normal --out-dir', async () => {
    const args = { ...argsBase(), 'out-dir': 'my-run', __explicit: new Set(['out-dir']) };
    await handleCouncilRun(args);
    expect(runCouncil).toHaveBeenCalled();
  });
});
