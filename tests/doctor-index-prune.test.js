// tests/doctor-index-prune.test.js
// R16: sessions-index.json stale-entry prune in `amicus doctor --fix`.
//
// session-index.js :: recordSession never removes a row, so a project that is
// deleted, renamed or moved leaves its taskId -> path entry behind forever.
// Full-pinned-deps pattern (tests/doctor-tmp-sweep.test.js's sibling suite):
// listStaleSessionIndexEntries/pruneStaleSessionIndexEntries are injected per
// test so no test reads or writes a real ~/.config/amicus, and `base` below
// pins every other doctor dep so nothing falls through to realDeps().
'use strict';
const doctor = require('../src/cli-handlers-doctor');
const HINTS = require('../src/utils/remediation-hints');

const findCheck = (checks, id) => checks.find((c) => c.id === id);

// Hermeticity guard — same class/rationale as doctor-tmp-sweep.test.js's
// `base` (see that file's comment for the full writeup): runDoctorChecks
// always computes the FULL check list, and these suites pass fix:true, so
// every OTHER dep must be pinned inert or it self-heals for real from inside
// the unit suite.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
const base = makeBaseDeps({
  readApiKeyValues: () => ({}), // offline credit probe
  getElectronPath: () => '/fake/electron', // electron check: ok — repair unreachable
  repairElectron: async () => ({ repaired: true }), // never the real binary self-heal
  repairEngine: async () => ({ repaired: true }), // never the real npx-cache copy-heal
});

const listResult = (staleTaskIds, entryCount, distinctProjectCount, staleProjectCount) => (
  () => ({ staleTaskIds, entryCount, distinctProjectCount, staleProjectCount })
);

describe("doctor 'sessions-index-prune' stale-entry check (R16)", () => {
  test('no entries → ok, 0 stale', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      listStaleSessionIndexEntries: listResult([], 0, 0, 0),
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/0 stale/);
  });

  test('all entries live → ok, 0 stale, counts still reported', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      listStaleSessionIndexEntries: listResult([], 12, 5, 0),
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/0 stale/);
    expect(c.message).toMatch(/12 entries/);
    expect(c.message).toMatch(/5 distinct project/);
  });

  test('stale entries present, no --fix → warn with both counts (R16-3) and the hint', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      // 4 stale task ids collapse to 2 distinct dead projects — proves the
      // reported counts are project-shaped, not entry-shaped.
      listStaleSessionIndexEntries: listResult(['t1', 't2', 't3', 't4'], 10, 6, 2),
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/4 stale row\(s\) of 10/);
    expect(c.message).toMatch(/2 of 6 distinct project/);
    expect(c.message).toMatch(/--fix/);
    expect(c.hint).toBe(HINTS.pruneSessionIndex);
  });

  test('bare doctor NEVER prunes (side-effect-free, matches the tmp-sweep contract)', async () => {
    const pruneStaleSessionIndexEntries = jest.fn();
    await doctor.runDoctorChecks({ ...base,
      listStaleSessionIndexEntries: listResult(['t1'], 3, 2, 1),
      pruneStaleSessionIndexEntries,
    });
    expect(pruneStaleSessionIndexEntries).not.toHaveBeenCalled();
  });

  test('--fix with 0 stale entries never calls prune (nothing to announce)', async () => {
    const pruneStaleSessionIndexEntries = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      listStaleSessionIndexEntries: listResult([], 5, 5, 0),
      pruneStaleSessionIndexEntries,
    });
    expect(pruneStaleSessionIndexEntries).not.toHaveBeenCalled();
    expect(findCheck(checks, 'sessions-index-prune').status).toBe('ok');
  });

  test('--fix prunes every stale entry and reports the pruned count → ok, fixed', async () => {
    const pruneStaleSessionIndexEntries = jest.fn(() => 3);
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      listStaleSessionIndexEntries: listResult(['t1', 't2', 't3'], 8, 4, 2),
      pruneStaleSessionIndexEntries,
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(pruneStaleSessionIndexEntries).toHaveBeenCalledWith(['t1', 't2', 't3']);
    expect(c.status).toBe('ok');
    expect(c.message).toBe('pruned 3 stale row(s)');
    expect(c.fixed).toBe(true);
    expect(c.fixDetail).toBe('pruned 3 stale session-index row(s) (2 deleted project(s))');
  });

  test('--fix that prunes only some (write raced or partially failed) does NOT mark fixed', async () => {
    const pruneStaleSessionIndexEntries = jest.fn(() => 1); // asked for 3, got 1
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      listStaleSessionIndexEntries: listResult(['t1', 't2', 't3'], 8, 4, 2),
      pruneStaleSessionIndexEntries,
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/pruned 1, 2 remaining/);
    expect(c.fixed).toBeUndefined();
    expect(c.hint).toBe(HINTS.pruneSessionIndex);
  });

  // Mirrors doctor-tmp-sweep.test.js's throwing-unlink pin: a genuinely
  // unremovable index write (disk full, EACCES on the config dir, etc.) must
  // never crash doctor.
  test('a throwing prune degrades gracefully (never crashes doctor)', async () => {
    const pruneStaleSessionIndexEntries = jest.fn(() => { throw new Error('EACCES'); });
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      listStaleSessionIndexEntries: listResult(['t1'], 1, 1, 1),
      pruneStaleSessionIndexEntries,
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(c.status).not.toBe('error');
    expect(c.message).toMatch(/pruned 0, 1 remaining/);
  });

  // Council R16 fix round A3: a listing failure must read as ITS OWN status,
  // never coalesced into "0 stale" — see session-index-prune.js's
  // evaluateSessionIndexPrune / listStaleSessionIndexEntries catch.
  test('list reporting an internal failure surfaces as its own status, not "0 stale" (A3)', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      listStaleSessionIndexEntries: () => ({
        staleTaskIds: [], entryCount: 0, distinctProjectCount: 0, staleProjectCount: 0,
        error: 'boom',
      }),
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(c.status).toBe('error');
    expect(c.message).toMatch(/could not determine/);
    expect(c.message).toMatch(/boom/);
  });

  // Council R16 fix round A2: the message must name the REAL cause, not
  // conflate a thrown write failure with a benign "ids already gone" race.
  test('a throwing prune surfaces the real error detail, not a generic guess (A2)', async () => {
    const pruneStaleSessionIndexEntries = jest.fn(() => { throw new Error('EACCES: permission denied'); });
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      listStaleSessionIndexEntries: listResult(['t1'], 1, 1, 1),
      pruneStaleSessionIndexEntries,
    });
    const c = findCheck(checks, 'sessions-index-prune');
    expect(c.status).toBe('warn'); // still not 'error' — matches the sibling pin above
    expect(c.message).toMatch(/pruned 0, 1 remaining/);
    expect(c.message).toMatch(/EACCES/);
  });
});

// Real-fs coverage for the list/prune glue itself (the describe block above
// exercises the decision logic via injected fakes; this proves the dedupe,
// the liveness probe, and the atomic write actually work against a real
// config dir and real project directories).
describe('session-index-prune real fs glue', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { recordSession } = require('../src/utils/session-index');
  const {
    listStaleSessionIndexEntries, pruneStaleSessionIndexEntries,
  } = require('../src/utils/session-index-prune');
  let configDir;
  let prevAmicusConfigDir;

  beforeEach(() => {
    prevAmicusConfigDir = process.env.AMICUS_CONFIG_DIR;
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idxprune-'));
    process.env.AMICUS_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (prevAmicusConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevAmicusConfigDir; }
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  test('returns the all-clear shape when the index file does not exist yet', () => {
    expect(listStaleSessionIndexEntries()).toEqual({
      staleTaskIds: [], entryCount: 0, distinctProjectCount: 0, staleProjectCount: 0,
    });
  });

  test('a corrupt index degrades to the all-clear shape (matches readIndex, never throws)', () => {
    const indexPath = path.join(configDir, 'sessions-index.json');
    fs.writeFileSync(indexPath, '{not json');
    expect(listStaleSessionIndexEntries()).toEqual({
      staleTaskIds: [], entryCount: 0, distinctProjectCount: 0, staleProjectCount: 0,
    });
  });

  test('a real deleted project is detected stale; a real live one is not (R16-2)', () => {
    const liveProject = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idxprune-live-'));
    const deadProject = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idxprune-dead-'));
    fs.rmSync(deadProject, { recursive: true, force: true }); // gone before we ever list

    recordSession('live-task', liveProject);
    recordSession('dead-task', deadProject);

    const result = listStaleSessionIndexEntries();
    expect(result.staleTaskIds).toEqual(['dead-task']);
    expect(result.entryCount).toBe(2);
    expect(result.distinctProjectCount).toBe(2);
    expect(result.staleProjectCount).toBe(1);

    fs.rmSync(liveProject, { recursive: true, force: true });
  });

  // R16-3: the whole point of dedup — many task ids sharing ONE dead project
  // must count as ONE distinct/stale project, not N.
  test('task ids sharing one dead project dedupe to a single project count', () => {
    const deadProject = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idxprune-shared-'));
    fs.rmSync(deadProject, { recursive: true, force: true });

    recordSession('t1', deadProject);
    recordSession('t2', deadProject);
    recordSession('t3', deadProject);

    const result = listStaleSessionIndexEntries();
    expect(result.staleTaskIds.sort()).toEqual(['t1', 't2', 't3']);
    expect(result.entryCount).toBe(3);
    expect(result.distinctProjectCount).toBe(1); // NOT 3
    expect(result.staleProjectCount).toBe(1); // NOT 3
  });

  // A project path replaced by a plain FILE is no longer a usable directory —
  // reads as gone the same way a missing path does.
  test('a project path now occupied by a file (not a directory) reads as stale', () => {
    const filePath = path.join(configDir, 'not-a-project-dir');
    fs.writeFileSync(filePath, 'x');
    recordSession('file-task', filePath);

    const result = listStaleSessionIndexEntries();
    expect(result.staleTaskIds).toEqual(['file-task']);
  });

  // The EACCES judgment call: an injected statSync simulates a permissions
  // blip without depending on real, platform-specific OS permission behavior
  // (unreliable to fabricate for real on Windows). "Cannot confirm gone" must
  // read as LIVE, never as stale — see session-index-prune.js :: projectExists.
  test.each(['EACCES', 'EPERM', 'EIO'])(
    'a statSync failure with code %s is treated as LIVE, not stale',
    (code) => {
      recordSession('blip-task', '/some/unreadable/project');
      const err = new Error(code);
      err.code = code;
      const result = listStaleSessionIndexEntries({
        statSync: () => { throw err; },
      });
      expect(result.staleTaskIds).toEqual([]);
      expect(result.staleProjectCount).toBe(0);
    },
  );

  test('ENOENT via injected statSync is treated as stale (the confirmed-gone case)', () => {
    recordSession('gone-task', '/some/deleted/project');
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    const result = listStaleSessionIndexEntries({ statSync: () => { throw err; } });
    expect(result.staleTaskIds).toEqual(['gone-task']);
  });

  // Council R16 fix round A3: an internal failure (here, a throwing injected
  // readIndex — a real injection point, not hypothetical) must be reported
  // distinctly from "0 stale", never collapsed to the same EMPTY_RESULT shape.
  test('an internal failure (e.g. a throwing injected readIndex) is reported distinctly from "0 stale" (A3)', () => {
    const result = listStaleSessionIndexEntries({
      readIndex: () => { throw new Error('boom'); },
    });
    expect(result.staleTaskIds).toEqual([]);
    expect(result.error).toBe('boom');
  });

  test('a malformed entry (empty project string) is treated as stale dead weight', () => {
    const indexPath = path.join(configDir, 'sessions-index.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({ 'bad-task': '' }));
    const result = listStaleSessionIndexEntries();
    expect(result.staleTaskIds).toEqual(['bad-task']);
  });

  test('pruneStaleSessionIndexEntries removes only the given ids and writes atomically', () => {
    recordSession('keep-me', '/proj/a');
    recordSession('drop-me-1', '/proj/b');
    recordSession('drop-me-2', '/proj/c');

    const removed = pruneStaleSessionIndexEntries(['drop-me-1', 'drop-me-2']);
    expect(removed).toBe(2);

    const indexPath = path.join(configDir, 'sessions-index.json');
    const onDisk = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(onDisk).toEqual({ 'keep-me': '/proj/a' });
  });

  test('pruneStaleSessionIndexEntries is a no-op (no write at all) when nothing given is present', () => {
    recordSession('keep-me', '/proj/a');
    const indexPath = path.join(configDir, 'sessions-index.json');
    const before = fs.statSync(indexPath).mtimeMs;

    const removed = pruneStaleSessionIndexEntries(['never-existed']);

    expect(removed).toBe(0);
    expect(fs.statSync(indexPath).mtimeMs).toBe(before); // untouched, not just unchanged content
  });

  // Council R16 fix round A1/A4: prune now takes the same injectable
  // `deps.readIndex` shape as list, and guards its return value the same way
  // (`|| {}`) — closing the one asymmetry between the two siblings (list was
  // stub-testable for a corrupt/absent readIndex; prune was not testable at
  // all without a real config dir).
  test('pruneStaleSessionIndexEntries treats a null readIndex() as an empty index, not a crash (A1/A4)', () => {
    const removed = pruneStaleSessionIndexEntries(['t1'], { readIndex: () => null });
    expect(removed).toBe(0);
  });

  test('pruneStaleSessionIndexEntries treats an undefined readIndex() as an empty index, not a crash (A1/A4)', () => {
    const removed = pruneStaleSessionIndexEntries(['t1'], { readIndex: () => undefined });
    expect(removed).toBe(0);
  });

  test('pruneStaleSessionIndexEntries still lets a throwing readIndex() propagate (A1/A4 — matches its documented "does not guard throws" contract)', () => {
    expect(() => pruneStaleSessionIndexEntries(['t1'], {
      readIndex: () => { throw new Error('boom'); },
    })).toThrow('boom');
  });

  // B1 (council R16 fix round, adjudicated — real pre-existing race, not
  // fixed here): confirms what the ruling relies on — prune touches ONLY the
  // ids it was handed. An entry recorded by another process between list and
  // prune (the exact window session-index.js :: recordSession already races
  // on) must survive.
  test('B1: prune deletes only the exact ids it was handed — an entry added between list and prune survives', () => {
    const deadProject = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idxprune-b1-'));
    fs.rmSync(deadProject, { recursive: true, force: true });
    recordSession('b1-dead', deadProject);

    const listed = listStaleSessionIndexEntries();
    expect(listed.staleTaskIds).toEqual(['b1-dead']);

    // Simulate a concurrent session start landing between list and prune.
    recordSession('b1-concurrent', configDir); // configDir always exists — live

    pruneStaleSessionIndexEntries(listed.staleTaskIds);

    // Key set only (not the path string's exact separator form) — recordSession
    // canonicalizes backslashes to forward slashes, orthogonal to what B1 tests.
    const indexPath = path.join(configDir, 'sessions-index.json');
    const onDisk = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(Object.keys(onDisk)).toEqual(['b1-concurrent']);
  });

  test('end-to-end: list finds it, prune removes it, a second list confirms it is gone', () => {
    const deadProject = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idxprune-e2e-'));
    fs.rmSync(deadProject, { recursive: true, force: true });
    recordSession('e2e-dead', deadProject);
    recordSession('e2e-live', configDir); // configDir itself always exists

    const first = listStaleSessionIndexEntries();
    expect(first.staleTaskIds).toEqual(['e2e-dead']);

    pruneStaleSessionIndexEntries(first.staleTaskIds);

    const second = listStaleSessionIndexEntries();
    expect(second.staleTaskIds).toEqual([]);
    expect(second.entryCount).toBe(1); // e2e-live survives
  });
});
