// tests/electron-provision-result-shape.test.js
'use strict';

/**
 * F3 (round 3, seat B4) — AN UNRECOGNISED PROVISION RESULT IS A FAILURE.
 *
 * > "An unexpected undefined/null return from controlledProvision is silently
 * > treated as a valid unpinned provision rather than a failure."
 *
 * `repairElectron` wrote `await controlledProvision({...}) || { pinned: false }`
 * and called that "an unrecognisable return marks, never claims a pin". It did
 * something worse: a provision that returned NOTHING became a successful
 * unpinned provision, so the code went on to `verifyExtractOutcome` — whose
 * whole contract is "a NON-throwing extract left no exe, which on win32 is the
 * antivirus signature". The user was told
 *
 *   "electron.exe was removed right after it was extracted — antivirus
 *    (e.g. Windows Defender) likely quarantined it."
 *
 * about an extraction that never happened, and pointed at an AV allow-list that
 * could not possibly help. Fail-open in the direction of a false diagnosis.
 *
 * WHY THIS FILE MOCKS A MODULE. `controlledProvision` cannot return a bad shape
 * on its own, and `repairElectron` destructures it at require time, so a
 * `jest.spyOn` after the fact is never seen. The mock is scoped to this file for
 * that reason and for no other; everything else is the real module.
 *
 * ── NAMED MUTANT ──────────────────────────────────────────────────────────
 * NULLISPINNED  electron-install.js :: repairElectron — restore
 *   `|| { pinned: false }` in place of the shape check, so an unrecognised
 *   return is treated as a successful unpinned provision.
 *   RED: "a provision that returns undefined is a FAILURE, not an unpinned
 *   success (NULLISPINNED)".
 * ──────────────────────────────────────────────────────────────────────────
 */

jest.mock('../src/sidecar/electron-provision', () => ({
  ...jest.requireActual('../src/sidecar/electron-provision'),
  controlledProvision: jest.fn(),
}));

const { controlledProvision } = require('../src/sidecar/electron-provision');
const ei = require('../src/sidecar/electron-install');
const { fakeElectronDir, SELF_ANCHOR_OFF } = require('./helpers/fake-electron-dir');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';

/** Repair with NO cached zip and no exe on disk, so the download route runs alone. */
async function repairWithProvision(result) {
  controlledProvision.mockReset();
  controlledProvision.mockResolvedValue(result);
  const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
  return ei.repairElectron({
    electronDir: dir,
    platform: PLATFORM,
    version: VERSION,
    arch: ARCH,
    deps: {
      ...SELF_ANCHOR_OFF,
      cachedZip: () => null,
      extract: jest.fn(),
      acquireLock: () => ({ release: () => {} }),
      downloadArtifact: jest.fn(),
    },
  });
}

let stderrSpy;
beforeEach(() => { stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true); });
afterEach(() => { stderrSpy.mockRestore(); });

describe('an unrecognised controlledProvision result (NULLISPINNED)', () => {
  test('a provision that returns undefined is a FAILURE, not an unpinned success (NULLISPINNED)', async () => {
    const res = await repairWithProvision(undefined);

    expect(res.repaired).toBe(false);
    // It says what actually went wrong...
    expect(res.reason).toMatch(/controlled download failed/i);
    expect(res.reason).toMatch(/no usable result/i);
    // ...and does NOT blame the antivirus for an extraction that never ran.
    expect(res.quarantined).toBeUndefined();
    expect(res.reason).not.toMatch(/antivirus|quarantin/i);
  });

  test('null and a non-object are refused the same way', async () => {
    for (const bad of [null, 'ok', 0]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await repairWithProvision(bad);
      expect(res.repaired).toBe(false);
      expect(res.reason).toMatch(/no usable result/i);
    }
  });

  test('an object with no boolean `pinned` is unrecognised too', async () => {
    // The contract is {pinned:boolean, refused?:object}. `{}` reads as "unpinned"
    // under a truthiness check and would have been marked `unverified` over bytes
    // nobody extracted — the same fail-open one shape to the left.
    const res = await repairWithProvision({});

    expect(res.repaired).toBe(false);
    expect(res.reason).toMatch(/no usable result/i);
    expect(res.unverified).toBeUndefined();
  });

  test('the RECOGNISED shapes still pass through untouched', async () => {
    // The guard must not turn a legitimate provision into a failure. A pinned
    // result reports a clean repair; an unpinned one is marked `unverified`.
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const fs = require('fs');
    const path = require('path');
    controlledProvision.mockReset();
    controlledProvision.mockImplementation(async () => {
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'dist', exeName), 'MZ');
      return { pinned: true };
    });
    const deps = {
      ...SELF_ANCHOR_OFF,
      cachedZip: () => null,
      extract: jest.fn(),
      acquireLock: () => ({ release: () => {} }),
      downloadArtifact: jest.fn(),
    };

    const pinned = await ei.repairElectron({
      electronDir: dir, platform: PLATFORM, version: VERSION, arch: ARCH, deps,
    });
    expect(pinned).toEqual({ repaired: true });

    controlledProvision.mockResolvedValue({ pinned: false });
    const unpinned = await ei.repairElectron({
      electronDir: dir, platform: PLATFORM, version: VERSION, arch: ARCH, deps,
    });
    expect(unpinned).toEqual({ repaired: true, unverified: true });
  });
});
