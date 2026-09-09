// tests/sidecar/native-extractor-containment.test.js
'use strict';

/**
 * DO THE NATIVE EXTRACTORS CONTAIN THEIR OWN ESCAPES? Measured, on this machine,
 * every time the suite runs.
 *
 * ── WHY THIS FILE EXISTS INSTEAD OF A FENCE (B2) ──────────────────────────
 * Finding B2 said `cleanDir` reaches only inside `dir`, so a native tool writing
 * OUTSIDE it leaves those writes behind. Half of that is already false — anything
 * under `<incoming>` is removed by `extractBytesToDist`'s `finally`
 * (electron-layout.js), and only a write outside `<incoming>` survives. The
 * proposed remedy was a snapshot "fence" around `electronDir`, and it was REFUSED
 * rather than deferred, for reasons worth keeping:
 *   - A names-diff fence is blind to the shapes that matter: MEASURED, an
 *     OVERWRITE of `dist/electron.exe`, `path.txt` or `index.js` produces no new
 *     name and therefore no breach.
 *   - Signalling a breach as "no strategy worked" routes into
 *     `electron-repair-cache.js`'s eviction, which DELETES the user's cached
 *     artifact and calls it corrupt — MEASURED end to end. On the air-gapped
 *     machine this whole feature exists for, a FALSE breach (a concurrent
 *     provision in the same package directory is enough) costs the artifact, the
 *     rescue AND the true explanation.
 *   - It could never have covered darwin's distinctive vector anyway: an
 *     ABSOLUTE symlink target lands outside any `electronDir`-bounded ring.
 * So the control is not a runtime fence. It is this: the claim "the native tools
 * refuse traversal themselves" is the compensating control the rescue's boundary
 * leans on, and a claim that nothing re-measures is a claim that rots. This suite
 * re-measures it on every CI run, on every platform in the matrix.
 *
 * ── WHAT WAS MEASURED WHEN THIS LANDED ────────────────────────────────────
 * 12 escape shapes x every resolvable strategy: nothing appeared outside the
 * directory the tool was given, on any of them.
 *   win32 `tar` (bsdtar 3.8.4)   REFUSES `..` (`Path contains '..'`, exit 1);
 *                                strips `/` and drive letters INTO `dir`.
 *   win32 `Expand-Archive`       REFUSES `..` (`Can not process invalid archive
 *                                entry`); ERRORS on drive-letter and `\\\\?\\` shapes
 *                                with an empty destination; strips a leading `/`.
 *   Info-ZIP `unzip` 6.00        CONTAINS by stripping escaping components and
 *                                writing the entry INSIDE `dir` under a mangled
 *                                name. Its own `-hh` text documents this as the
 *                                default for "[All but Acorn, VM/CMS, MVS,
 *                                Tandem]", with `-:` as the opt-out — and amicus
 *                                does not pass `-:`.
 *   linux `tar` (GNU)            INERT on a zip: `This does not look like a tar
 *                                archive`, exit 2, nothing landed.
 *   darwin `ditto`               THE ONE STRATEGY STILL UNMEASURED when this
 *                                shipped — no darwin machine in that session.
 *                                This suite measures it the first time it runs on
 *                                `macos-latest`, which is already in ci.yml's
 *                                matrix. If `ditto` escapes, THIS BUILD GOES RED,
 *                                and that is the finding, not a flaky test.
 *
 * ⚠️ A NOTE ON THE INFO-ZIP MEASUREMENT: it was taken against the win32 build
 * (Git-for-Windows). Info-ZIP's `mapname()` is a per-platform function, so the
 * result does not formally transfer to the macOS or Linux builds — which is
 * exactly why this suite runs there rather than asserting from a table.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * PLANSTRATEGYUNMEASURED  unzip.js :: nativeUnzipPlan — add a strategy (or rename
 *   one) without measuring it here.
 *   RED: "every strategy the plan can name is one this suite has measured".
 * CONTAINMENTSANDBOXONLY  this file — assert only that nothing appeared inside
 *   the sandbox, without checking the absolute escape targets by path. The three
 *   drive-letter/UNC shapes are STRIPPED INTO `dir` today, so a sandbox-only walk
 *   is green now and stays green on the day that stops being true.
 *   RED: "an absolute escape target is checked by PATH, not by walking the tree".
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { nativeUnzipPlan } = require('../../src/sidecar/unzip');
const { buildZip } = require('../helpers/zip-fixture');

/** Every strategy name this suite has actually driven, per platform. */
const MEASURED = {
  win32: ['tar', 'Expand-Archive'],
  darwin: ['ditto', 'unzip'],
  linux: ['unzip', 'tar'],
};

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** True if the command resolves on this box at all. */
function resolvable(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 20_000 });
    return true;
  } catch (e) {
    // A tool that ran and exited non-zero for `--version` still EXISTS.
    return !!(e && e.status !== undefined && e.code !== 'ENOENT');
  }
}

/** Every path under `root`, relative and sorted — the tree, not just its names. */
function walk(root, base = root, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    out.push(path.relative(base, full));
    if (e.isDirectory() && !e.isSymbolicLink()) { walk(full, base, out); }
  }
  return out.sort();
}

describe('the native extractors contain their own escapes (B2)', () => {
  test('every strategy the plan can name is one this suite has measured (PLANSTRATEGYUNMEASURED)', () => {
    // PURE DATA, no spawn, runs everywhere. A strategy added to the plan without
    // a measurement here is the decay this file exists to catch: the rescue's
    // boundary leans on "the tools refuse traversal themselves", and that claim
    // is only as good as the list of tools it was measured over.
    for (const platform of Object.keys(MEASURED)) {
      const named = nativeUnzipPlan('/z.zip', '/d', platform).map((s) => s.name);
      expect(named.length).toBeGreaterThan(0);
      for (const name of named) {
        expect(MEASURED[platform]).toContain(name);
      }
    }
  });

  describe('driving the real tools', () => {
    const plan = nativeUnzipPlan('placeholder', 'placeholder', process.platform);
    const usable = plan.filter((s) => resolvable(s.cmd));

    test('at least one strategy for this platform resolves, or the skip is NAMED', () => {
      // A suite that silently skips everything reports green while measuring
      // nothing. If no tool resolves, say which ones were looked for.
      expect(usable.length).toBeGreaterThan(0);
    });

    for (const strat of usable) {
      test(`${strat.name} writes nothing outside the directory it was given`, () => {
        const root = mkTmp('amicus-contain-');
        const dir = path.join(root, 'incoming', 'dist');
        fs.mkdirSync(dir, { recursive: true });
        // The escape targets live INSIDE the sandbox so a real escape lands
        // somewhere this test both asserts on and cleans up. `root` is
        // realpath'd, so the absolute shapes name a real place on this volume.
        const absTarget = path.join(root, 'ABS-TARGET');
        fs.mkdirSync(absTarget, { recursive: true });
        const drive = path.parse(root).root;                 // 'C:\\' or '/'
        const relFromDrive = path.relative(drive, path.join(absTarget, 'PWNED.txt'))
          .split(path.sep).join('/');

        const SHAPES = [
          '../PWNED.txt',
          '../../PWNED.txt',
          '../../../PWNED.txt',
          'sub/../../../PWNED.txt',
          '..\\PWNED.txt',
          'sub\\..\\..\\PWNED.txt',
          '/PWNED.txt',
          '//PWNED.txt',
          `${drive.replace(/[\\/]+$/, '')}/${relFromDrive}`,  // C:/<abs>/PWNED.txt
          `${drive.replace(/[\\/]+$/, '')}${relFromDrive}`,   // C:<rel-ish>
          `\\\\?\\${path.join(absTarget, 'PWNED.txt')}`,
          'ok/inside.txt',
        ];
        const zip = path.join(root, 'probe.zip');
        fs.writeFileSync(zip, buildZip(SHAPES.map((name) => ({ name, body: 'PWNED' }))));

        const real = nativeUnzipPlan(zip, dir, process.platform).find((s) => s.name === strat.name);
        try {
          execFileSync(real.cmd, real.args, {
            stdio: 'ignore', windowsHide: true, timeout: 120_000, cwd: path.dirname(dir),
          });
        } catch { /* a refusal is a PASS here; the assertions below decide */ }

        // (1) THE TREE. Nothing outside `dist` may have appeared.
        // THE PREDICATE IS THE HOUSE FORM, INCLUDING THE `path.sep`, and this
        // file learned that the hard way: written `inDir.startsWith('..')` it
        // reported an ESCAPE for `<dir>/..\PWNED.txt` on macOS and Linux, where a
        // backslash is a LEGAL FILENAME CHARACTER — so that entry is one ordinary
        // file that `unzip` and `ditto` correctly wrote INSIDE `dir`, and the
        // walker, not the tool, was wrong. Windows never sees it (there the name
        // is a real traversal and both tools refuse it), which is exactly why a
        // suite that only ever ran on one platform could not catch it. Same
        // `path.sep` bug this branch fixed in `electron-exe-rel.js :: distHeldExe`
        // — the fix and its own regression, two files apart.
        const outside = walk(root).filter((rel) => {
          const abs = path.resolve(root, rel);
          const inDir = path.relative(dir, abs);
          const escapes = inDir === '..' || inDir.startsWith(`..${path.sep}`) || path.isAbsolute(inDir);
          return escapes && !['incoming', path.join('incoming', 'dist'), 'ABS-TARGET', 'probe.zip'].includes(rel);
        });
        expect(outside).toEqual([]);

        // (2) AN ABSOLUTE ESCAPE TARGET IS CHECKED BY PATH, NOT BY WALKING THE
        // TREE (CONTAINMENTSANDBOXONLY). The three absolute shapes are stripped
        // INTO `dir` today, so a tree walk alone is green now and would stay
        // green on the day a tool stops stripping them.
        expect(fs.readdirSync(absTarget)).toEqual([]);

        fs.rmSync(root, { recursive: true, force: true });
      });
    }
  });
});
