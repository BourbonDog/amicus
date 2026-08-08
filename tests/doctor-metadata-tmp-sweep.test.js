// tests/doctor-metadata-tmp-sweep.test.js
// v4.6.3 PR3 Task 3 (D8): per-session metadata.json tmp-orphan sweep in
// `amicus doctor --fix`.
//
// A kill between writeFileAtomic's tmp-write and rename leaves a stray
// `.metadata.json.<pid>.<hex>.tmp` file in a session directory forever (the
// B09 orphan class, ~30 write sites). Mirrors tests/doctor-tmp-sweep.test.js
// describe-for-describe: listSessionMetadataTmpFiles/unlinkSessionMetadataTmp
// are injected per test so no test reads or writes the real cwd's
// .claude/amicus_sessions, and `base` below pins every other doctor dep so
// nothing falls through to realDeps().
'use strict';
const doctor = require('../src/cli-handlers-doctor');
const HINTS = require('../src/utils/remediation-hints');

const findCheck = (checks, id) => checks.find((c) => c.id === id);
// Hermeticity guard (same class as the v4.6.2-pr1 wave; see allGood's M14
// comment in tests/cli-handlers-doctor.test.js for the original writeup):
// runDoctorChecks always computes the FULL check list, not just
// 'session-metadata-tmp' -- baseDeps mirrors allGood's full-deps shape so
// every OTHER dep is pinned inert and only the per-test
// listSessionMetadataTmpFiles/unlinkSessionMetadataTmp overrides drive the
// real sweep wiring this file exists to test. listSessionIndexTmpFiles is
// pinned too — its sibling check runs alongside ours in the full list.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
// These suites pass fix:true; before baseDeps existed, unlisted deps inherited
// realDeps() — which made the inherited electron/engine checks SELF-HEAL for
// real. Keep the probe green and both self-heal seams pinned inert; only the
// session-metadata-tmp check is under test here.
const base = makeBaseDeps({
  readApiKeyValues: () => ({}), // offline credit probe
  getElectronPath: () => '/fake/electron', // electron check: ok — repair unreachable
  repairElectron: async () => ({ repaired: true }), // never the real binary self-heal
  repairEngine: async () => ({ repaired: true }), // never the real npx-cache copy-heal
});

const NOW = 1_800_000_000_000; // fixed epoch ms for deterministic age math
const fresh = (name) => ({ name, mtimeMs: NOW - 5_000 }); // 5s old — a live writer
const stale = (name) => ({ name, mtimeMs: NOW - 120_000 }); // 120s old — safely orphaned

describe("doctor 'session-metadata-tmp' orphan sweep (D8)", () => {
  test('no tmp files → ok, count 0', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      listSessionMetadataTmpFiles: () => [],
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/0/);
  });

  test('N tmp files present, no --fix → warn with count and the sweep hint', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      listSessionMetadataTmpFiles: () => [stale('abc123/.metadata.json.111.aaa111aaa111.tmp'), stale('abc123/.metadata.json.222.bbb222bbb222.tmp')],
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/2/);
    expect(c.hint).toBe(HINTS.sweepSessionMetadataTmp);
  });

  test('bare doctor NEVER unlinks (side-effect-free, doctor-fix.test.js contract)', async () => {
    const unlinkSessionMetadataTmp = jest.fn();
    await doctor.runDoctorChecks({ ...base,
      listSessionMetadataTmpFiles: () => [stale('abc123/.metadata.json.111.aaa111aaa111.tmp')],
      unlinkSessionMetadataTmp,
    });
    expect(unlinkSessionMetadataTmp).not.toHaveBeenCalled();
  });

  test('--fix sweeps files older than 60s and reports the swept count → ok', async () => {
    const unlinkSessionMetadataTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionMetadataTmpFiles: () => [stale('abc123/.metadata.json.111.aaa111aaa111.tmp'), stale('abc123/subagents/def456/.metadata.json.222.bbb222bbb222.tmp')],
      unlinkSessionMetadataTmp,
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(unlinkSessionMetadataTmp).toHaveBeenCalledTimes(2);
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/swept 2/i);
  });

  test('--fix age-guards a fresh (<60s) tmp file — never races a live writer', async () => {
    const unlinkSessionMetadataTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionMetadataTmpFiles: () => [fresh('abc123/.metadata.json.333.ccc333ccc333.tmp')],
      unlinkSessionMetadataTmp,
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(unlinkSessionMetadataTmp).not.toHaveBeenCalled();
    expect(c.status).toBe('warn'); // 1 survivor left behind, still reported
    expect(c.message).toMatch(/1/);
  });

  test('--fix sweeps only the stale subset when both stale and fresh tmps are present', async () => {
    const unlinkSessionMetadataTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionMetadataTmpFiles: () => [
        stale('abc123/.metadata.json.111.aaa111aaa111.tmp'),
        fresh('abc123/.metadata.json.444.ddd444ddd444.tmp'),
      ],
      unlinkSessionMetadataTmp,
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(unlinkSessionMetadataTmp).toHaveBeenCalledTimes(1);
    expect(unlinkSessionMetadataTmp).toHaveBeenCalledWith('abc123/.metadata.json.111.aaa111aaa111.tmp');
    expect(c.status).toBe('warn'); // the fresh survivor keeps the check from going ok
    expect(c.message).toMatch(/swept 1/i);
  });

  // Pins never-crash for a genuinely unremovable *file* (permissions, AV lock,
  // etc.) — a different contract from SR-3's directory exclusion below, which
  // keeps name-shaped directories out of this list by design so they never
  // reach unlink in the first place.
  test('a throwing unlink degrades gracefully (never crashes doctor)', async () => {
    const unlinkSessionMetadataTmp = jest.fn(() => { throw new Error('EPERM'); });
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionMetadataTmpFiles: () => [stale('abc123/.metadata.json.111.aaa111aaa111.tmp')],
      unlinkSessionMetadataTmp,
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(c.status).not.toBe('error');
  });

  // v4.6 Plan 3 Task 3: repair-success rows carry a structured fixed/fixDetail
  // fact so the doctor-degrade collector never has to parse prose. Prose stays
  // byte-identical — this only ADDS fields.
  test('--fix sweeping every orphan clean marks the row fixed with a human-ready detail', async () => {
    const unlinkSessionMetadataTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionMetadataTmpFiles: () => [stale('abc123/.metadata.json.111.aaa111aaa111.tmp'), stale('abc123/.metadata.json.222.bbb222bbb222.tmp')],
      unlinkSessionMetadataTmp,
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(c.fixed).toBe(true);
    expect(c.fixDetail).toBe('swept 2 orphaned session-metadata tmp file(s)');
    expect(c.message).toBe('swept 2 orphaned tmp file(s)'); // prose byte-identical
  });

  test('--fix that sweeps nothing (fresh survivor only) does NOT mark fixed', async () => {
    const unlinkSessionMetadataTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionMetadataTmpFiles: () => [fresh('abc123/.metadata.json.333.ccc333ccc333.tmp')],
      unlinkSessionMetadataTmp,
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(c.fixed).toBeUndefined();
  });

  test('--fix that sweeps only some (a fresh survivor remains) does NOT mark fixed — only the fully-clean sweep does', async () => {
    const unlinkSessionMetadataTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionMetadataTmpFiles: () => [
        stale('abc123/.metadata.json.111.aaa111aaa111.tmp'),
        fresh('abc123/.metadata.json.444.ddd444ddd444.tmp'),
      ],
      unlinkSessionMetadataTmp,
    });
    const c = findCheck(checks, 'session-metadata-tmp');
    expect(c.fixed).toBeUndefined();
    expect(c.status).toBe('warn'); // unchanged: a fresh survivor keeps the check from going ok
  });
});

// Real-fs coverage for the list/unlink glue itself (the describe block above
// exercises the decision logic via injected fakes; this proves the walk and
// unlink actually work against a real cwd-scoped sessions root, at both the
// session and subagent nesting levels).
describe('session-metadata-tmp-sweep real fs glue', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  let projectDir;
  let prevCwd;

  beforeEach(() => {
    prevCwd = process.cwd();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-metasweep-'));
    process.chdir(projectDir);
    jest.resetModules();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(projectDir, { recursive: true, force: true });
    jest.resetModules();
  });

  function sessionsRoot() {
    return path.join(projectDir, '.claude', 'amicus_sessions');
  }

  test('lists orphans at both the session and subagent nesting levels, ignoring unrelated files', () => {
    const { listSessionMetadataTmpFiles } = require('../src/utils/session-metadata-tmp-sweep');
    const root = sessionsRoot();
    const taskDir = path.join(root, 'abc123');
    const subDir = path.join(taskDir, 'subagents', 'def456');
    fs.mkdirSync(subDir, { recursive: true });

    fs.writeFileSync(path.join(taskDir, '.metadata.json.111.aaa111aaa111.tmp'), '{}');
    fs.writeFileSync(path.join(taskDir, 'metadata.json'), '{}'); // the real (non-tmp) metadata
    fs.writeFileSync(path.join(taskDir, '.progress.json.111.aaa111aaa111.tmp'), '{}'); // different base — not ours
    fs.writeFileSync(path.join(subDir, '.metadata.json.222.bbb222bbb222.tmp'), '{}');
    fs.writeFileSync(path.join(subDir, 'metadata.json'), '{}');

    fs.mkdirSync(path.join(projectDir, 'outside'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'outside', '.metadata.json.333.ccc333ccc333.tmp'), '{}'); // outside the sessions root

    const found = listSessionMetadataTmpFiles();
    expect(found).toHaveLength(2);
    const names = found.map((f) => f.name.split(path.sep).join('/')).sort();
    expect(names).toEqual([
      'abc123/.metadata.json.111.aaa111aaa111.tmp',
      'abc123/subagents/def456/.metadata.json.222.bbb222bbb222.tmp',
    ]);
    for (const f of found) { expect(typeof f.mtimeMs).toBe('number'); }
  });

  test('returns [] when the sessions root does not exist yet', () => {
    const { listSessionMetadataTmpFiles } = require('../src/utils/session-metadata-tmp-sweep');
    expect(listSessionMetadataTmpFiles()).toEqual([]);
  });

  // SR-3: a directory can carry a name shaped exactly like an orphan tmp
  // file (e.g. left by a tool that mkdir'd instead of writeFileAtomic'd, or
  // by anything else that produces a same-named dir). isMetadataTmp filters
  // on basename only, so without a file-type check this dir would pass the
  // filter, get lstat'd for mtimeMs (which a directory has), survive the
  // `.filter((f) => f.mtimeMs !== null)` gate, and be reported as an orphan
  // — then unlinkSync would throw EISDIR/EPERM on it forever. It must be
  // excluded, not just tolerated.
  test('a name-shaped directory is excluded, not reported as an orphan', () => {
    const { listSessionMetadataTmpFiles } = require('../src/utils/session-metadata-tmp-sweep');
    const taskDir = path.join(sessionsRoot(), 'abc123');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(path.join(taskDir, '.metadata.json.111.aaa111aaa111.tmp'));

    expect(listSessionMetadataTmpFiles()).toEqual([]);
  });

  test('unlinkSessionMetadataTmp removes the named file relative to the sessions root', () => {
    const { listSessionMetadataTmpFiles, unlinkSessionMetadataTmp } = require('../src/utils/session-metadata-tmp-sweep');
    const taskDir = path.join(sessionsRoot(), 'abc123');
    fs.mkdirSync(taskDir, { recursive: true });
    const tmpPath = path.join(taskDir, '.metadata.json.222.bbb222bbb222.tmp');
    fs.writeFileSync(tmpPath, '{}');
    const [found] = listSessionMetadataTmpFiles();
    expect(found).toBeTruthy();

    unlinkSessionMetadataTmp(found.name);

    expect(fs.existsSync(tmpPath)).toBe(false);
    expect(listSessionMetadataTmpFiles()).toEqual([]);
  });

  test('end-to-end: real writeFileAtomic-produced tmp files (crash simulated) are found and swept at both levels', () => {
    const { writeFileAtomic } = require('../src/utils/atomic-write');
    const taskDir = path.join(sessionsRoot(), 'abc123');
    const subDir = path.join(taskDir, 'subagents', 'def456');
    fs.mkdirSync(subDir, { recursive: true });

    const target = path.join(taskDir, 'metadata.json');
    const subTarget = path.join(subDir, 'metadata.json');
    const orphanTmp = path.join(taskDir, `.metadata.json.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    const subOrphanTmp = path.join(subDir, `.metadata.json.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(orphanTmp, JSON.stringify({ status: 'running' }));
    fs.writeFileSync(subOrphanTmp, JSON.stringify({ status: 'running' }));
    // (no rename — these ARE the orphans)
    // Separate, successful writes should NOT be mistaken for orphans.
    writeFileAtomic(target, '{}', { mode: 0o600 });
    writeFileAtomic(subTarget, '{}', { mode: 0o600 });

    const { listSessionMetadataTmpFiles, unlinkSessionMetadataTmp } = require('../src/utils/session-metadata-tmp-sweep');
    const found = listSessionMetadataTmpFiles();
    expect(found).toHaveLength(2);

    for (const f of found) { unlinkSessionMetadataTmp(f.name); }
    expect(fs.existsSync(orphanTmp)).toBe(false);
    expect(fs.existsSync(subOrphanTmp)).toBe(false);
    expect(fs.existsSync(target)).toBe(true); // the real metadata files are untouched
    expect(fs.existsSync(subTarget)).toBe(true);
  });
});
