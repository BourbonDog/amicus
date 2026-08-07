// tests/doctor-tmp-sweep.test.js
// 15a.1/B15: sessions-index.json tmp-orphan sweep in `amicus doctor --fix`.
//
// A kill between writeFileAtomic's tmp-write and rename leaves a stray
// `.sessions-index.json.<pid>.<hex>.tmp` file in the config dir forever (60-73
// were observed accumulating). Full-pinned-deps pattern
// (tests/cli-handlers-doctor.test.js's allGood):
// listSessionIndexTmpFiles/unlinkSessionIndexTmp are injected per test so no
// test reads or writes a real ~/.config/amicus, and `base` below pins every
// other doctor dep so nothing falls through to realDeps().
'use strict';
const doctor = require('../src/cli-handlers-doctor');
const HINTS = require('../src/utils/remediation-hints');

const findCheck = (checks, id) => checks.find((c) => c.id === id);
// Hermeticity guard (same class as the v4.6.2-pr1 wave; see allGood's M14
// comment in tests/cli-handlers-doctor.test.js for the original writeup):
// runDoctorChecks always computes the FULL check list, not just
// 'sessions-index-tmp' -- this file used to pin only the four --fix self-heal
// seams (the `base` overrides below) and let every OTHER dep fall through to
// realDeps() and run for real: engine-install subprocess scans, the OpenRouter
// credit network probe, real config/cache reads, etc. baseDeps mirrors
// allGood's full-deps shape. The per-test
// listSessionIndexTmpFiles/unlinkSessionIndexTmp overrides still drive the
// real sweep wiring this file exists to test.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
// These suites pass fix:true; before baseDeps existed, unlisted deps inherited
// realDeps() — which made the inherited electron/engine checks SELF-HEAL for
// real: on a box where node_modules/electron/dist is missing
// (scripts-suppressed install), the electron check's d.repairElectron({timeoutMs})
// extracts — or DOWNLOADS (~144MB) — the real binary from inside the unit
// suite, racing the repair lock across jest workers. Keep the probe green and
// both self-heal seams pinned inert; only the sessions-index-tmp check is
// under test here.
const base = makeBaseDeps({
  readApiKeyValues: () => ({}), // offline credit probe
  getElectronPath: () => '/fake/electron', // electron check: ok — repair unreachable
  repairElectron: async () => ({ repaired: true }), // never the real binary self-heal
  repairEngine: async () => ({ repaired: true }), // never the real npx-cache copy-heal
});

const NOW = 1_800_000_000_000; // fixed epoch ms for deterministic age math
const fresh = (name) => ({ name, mtimeMs: NOW - 5_000 }); // 5s old — a live writer
const stale = (name) => ({ name, mtimeMs: NOW - 120_000 }); // 120s old — safely orphaned

describe("doctor 'sessions-index-tmp' orphan sweep (B15)", () => {
  test('no tmp files → ok, count 0', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      listSessionIndexTmpFiles: () => [],
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/0/);
  });

  test('N tmp files present, no --fix → warn with count and the sweep hint', async () => {
    const checks = await doctor.runDoctorChecks({ ...base,
      listSessionIndexTmpFiles: () => [stale('.sessions-index.json.111.aaa111aaa111.tmp'), stale('.sessions-index.json.222.bbb222bbb222.tmp')],
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/2/);
    expect(c.hint).toBe(HINTS.sweepSessionIndexTmp);
  });

  test('bare doctor NEVER unlinks (side-effect-free, doctor-fix.test.js contract)', async () => {
    const unlinkSessionIndexTmp = jest.fn();
    await doctor.runDoctorChecks({ ...base,
      listSessionIndexTmpFiles: () => [stale('.sessions-index.json.111.aaa111aaa111.tmp')],
      unlinkSessionIndexTmp,
    });
    expect(unlinkSessionIndexTmp).not.toHaveBeenCalled();
  });

  test('--fix sweeps files older than 60s and reports the swept count → ok', async () => {
    const unlinkSessionIndexTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionIndexTmpFiles: () => [stale('.sessions-index.json.111.aaa111aaa111.tmp'), stale('.sessions-index.json.222.bbb222bbb222.tmp')],
      unlinkSessionIndexTmp,
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(unlinkSessionIndexTmp).toHaveBeenCalledTimes(2);
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/swept 2/i);
  });

  test('--fix age-guards a fresh (<60s) tmp file — never races a live writer', async () => {
    const unlinkSessionIndexTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionIndexTmpFiles: () => [fresh('.sessions-index.json.333.ccc333ccc333.tmp')],
      unlinkSessionIndexTmp,
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(unlinkSessionIndexTmp).not.toHaveBeenCalled();
    expect(c.status).toBe('warn'); // 1 survivor left behind, still reported
    expect(c.message).toMatch(/1/);
  });

  test('--fix sweeps only the stale subset when both stale and fresh tmps are present', async () => {
    const unlinkSessionIndexTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionIndexTmpFiles: () => [
        stale('.sessions-index.json.111.aaa111aaa111.tmp'),
        fresh('.sessions-index.json.444.ddd444ddd444.tmp'),
      ],
      unlinkSessionIndexTmp,
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(unlinkSessionIndexTmp).toHaveBeenCalledTimes(1);
    expect(unlinkSessionIndexTmp).toHaveBeenCalledWith('.sessions-index.json.111.aaa111aaa111.tmp');
    expect(c.status).toBe('warn'); // the fresh survivor keeps the check from going ok
    expect(c.message).toMatch(/swept 1/i);
  });

  test('a throwing unlink degrades gracefully (never crashes doctor)', async () => {
    const unlinkSessionIndexTmp = jest.fn(() => { throw new Error('EPERM'); });
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionIndexTmpFiles: () => [stale('.sessions-index.json.111.aaa111aaa111.tmp')],
      unlinkSessionIndexTmp,
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(c.status).not.toBe('error');
  });

  // v4.6 Plan 3 Task 3: repair-success rows carry a structured fixed/fixDetail
  // fact so the doctor-degrade collector never has to parse prose. Prose stays
  // byte-identical — this only ADDS fields.
  test('--fix sweeping every orphan clean marks the row fixed with a human-ready detail', async () => {
    const unlinkSessionIndexTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionIndexTmpFiles: () => [stale('.sessions-index.json.111.aaa111aaa111.tmp'), stale('.sessions-index.json.222.bbb222bbb222.tmp')],
      unlinkSessionIndexTmp,
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(c.fixed).toBe(true);
    expect(c.fixDetail).toBe('swept 2 orphaned session-index tmp file(s)');
    expect(c.message).toBe('swept 2 orphaned tmp file(s)'); // prose byte-identical
  });

  test('--fix that sweeps nothing (fresh survivor only) does NOT mark fixed', async () => {
    const unlinkSessionIndexTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionIndexTmpFiles: () => [fresh('.sessions-index.json.333.ccc333ccc333.tmp')],
      unlinkSessionIndexTmp,
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(c.fixed).toBeUndefined();
  });

  test('--fix that sweeps only some (a fresh survivor remains) does NOT mark fixed — only the fully-clean sweep does', async () => {
    const unlinkSessionIndexTmp = jest.fn();
    const checks = await doctor.runDoctorChecks({ ...base, fix: true,
      now: () => NOW,
      listSessionIndexTmpFiles: () => [
        stale('.sessions-index.json.111.aaa111aaa111.tmp'),
        fresh('.sessions-index.json.444.ddd444ddd444.tmp'),
      ],
      unlinkSessionIndexTmp,
    });
    const c = findCheck(checks, 'sessions-index-tmp');
    expect(c.fixed).toBeUndefined();
    expect(c.status).toBe('warn'); // unchanged: a fresh survivor keeps the check from going ok
  });
});

// Real-fs coverage for the list/unlink glue itself (the describe block above
// exercises the decision logic via injected fakes; this proves the glob and
// unlink actually work against a real config dir).
describe('session-index-tmp-sweep real fs glue', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let configDir;
  let prevAmicusConfigDir;

  beforeEach(() => {
    prevAmicusConfigDir = process.env.AMICUS_CONFIG_DIR;
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-tmpsweep-'));
    process.env.AMICUS_CONFIG_DIR = configDir;
    jest.resetModules();
  });

  afterEach(() => {
    if (prevAmicusConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevAmicusConfigDir; }
    fs.rmSync(configDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('lists both era naming schemes and ignores unrelated files', () => {
    const { listSessionIndexTmpFiles } = require('../src/utils/session-index-tmp-sweep');
    fs.writeFileSync(path.join(configDir, '.sessions-index.json.111.aaa111aaa111.tmp'), '{}');
    fs.writeFileSync(path.join(configDir, 'sessions-index.json'), '{}'); // the real (non-tmp) index
    fs.writeFileSync(path.join(configDir, 'config.json'), '{}'); // unrelated file
    fs.writeFileSync(path.join(configDir, '.other-file.tmp'), ''); // different base — not ours

    const found = listSessionIndexTmpFiles();
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('.sessions-index.json.111.aaa111aaa111.tmp');
    expect(typeof found[0].mtimeMs).toBe('number');
  });

  test('returns [] when the config dir does not exist yet', () => {
    fs.rmSync(configDir, { recursive: true, force: true });
    const { listSessionIndexTmpFiles } = require('../src/utils/session-index-tmp-sweep');
    expect(listSessionIndexTmpFiles()).toEqual([]);
  });

  test('unlinkSessionIndexTmp removes the named file from the config dir', () => {
    const { listSessionIndexTmpFiles, unlinkSessionIndexTmp } = require('../src/utils/session-index-tmp-sweep');
    const tmpName = '.sessions-index.json.222.bbb222bbb222.tmp';
    fs.writeFileSync(path.join(configDir, tmpName), '{}');
    expect(listSessionIndexTmpFiles()).toHaveLength(1);

    unlinkSessionIndexTmp(tmpName);

    expect(fs.existsSync(path.join(configDir, tmpName))).toBe(false);
    expect(listSessionIndexTmpFiles()).toEqual([]);
  });

  test('end-to-end: a real recordSession-produced tmp file (crash simulated) is found and swept', () => {
    // Simulate the exact orphan scenario: writeFileAtomic's tmp file lands on
    // disk but the rename never happens (process killed mid-write).
    const { writeFileAtomic } = require('../src/utils/atomic-write');
    const target = path.join(configDir, 'sessions-index.json');
    const crypto = require('crypto');
    const orphanTmp = path.join(configDir, `.sessions-index.json.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(orphanTmp, JSON.stringify({ abc123: '/some/project' }));
    // (no rename — this IS the orphan)
    // A separate, successful write should NOT be mistaken for an orphan.
    writeFileAtomic(target, '{}', { mode: 0o600 });

    const { listSessionIndexTmpFiles, unlinkSessionIndexTmp } = require('../src/utils/session-index-tmp-sweep');
    const found = listSessionIndexTmpFiles();
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe(path.basename(orphanTmp));

    unlinkSessionIndexTmp(found[0].name);
    expect(fs.existsSync(orphanTmp)).toBe(false);
    expect(fs.existsSync(target)).toBe(true); // the real index file is untouched
  });
});
