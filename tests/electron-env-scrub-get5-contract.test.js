// tests/electron-env-scrub-get5-contract.test.js
'use strict';

/**
 * THE ENV SCRUB'S COVERAGE, RE-MEASURED AGAINST THE INSTALLED LIBRARY.
 *
 * THE FINDING (v4.9.6 council round 3, seat B1 major + B3 minor). The scrub in
 * `electron-env-scrub.js` is held across `downloadArtifact`'s SYNCHRONOUS PREFIX
 * only, on the claim that every repo-plantable read happens there. B1: that is
 * "an unverified invariant about @electron/get internals", and the scrub is
 * "effectively a no-op for any env read that happens after the first await".
 * B3: it mutates shared `process.env` while the download is in flight, so
 * "concurrent repairs can interleave".
 *
 * Both were argued, and the answer had to be MEASURED. The child helper replaces
 * `process.env` with a recording Proxy and drives the REAL installed
 * @electron/get 5.0.0 through a real `downloadArtifact` with an injected offline
 * downloader. This suite asserts what it measured, so a future @electron/get that
 * moves a read past an `await` — or a future edit that restores the environment
 * too early — turns red HERE rather than in the field. That is the same
 * anti-decay contract `tests/sidecar/unzip-refusal-strings.js` gives
 * `UNSAFE_PATTERNS`.
 *
 * ── NAMED MUTANT ──────────────────────────────────────────────────────────
 * SCRUBTOOEARLY  electron-env-scrub.js :: withScrubbedRepoEnv — restore every
 *   removed name BEFORE calling `fn`, so the library reads an unscrubbed
 *   environment.
 *   RED: "the PINNED download goes to the OFFICIAL release URL with an attacker
 *   mirror planted (SCRUBTOOEARLY)".
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHILD = path.join(__dirname, 'helpers', 'electron-get5-scrub-child.js');

/** The installed @electron/get major, read via fs (its exports map forbids require of package.json). */
function get5Installed() {
  try {
    const pkg = path.join(__dirname, '..', 'node_modules', '@electron', 'get', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version.startsWith('5');
  } catch { return false; }
}

const d = get5Installed() ? describe : describe.skip;

d('withScrubbedRepoEnv vs the INSTALLED @electron/get 5.x (no network)', () => {
  jest.setTimeout(120000);
  let m;

  beforeAll(() => {
    m = JSON.parse(execFileSync(process.execPath, [CHILD], {
      encoding: 'utf-8', cwd: path.join(__dirname, '..'),
    }));
  });

  test('the PINNED download goes to the OFFICIAL release URL with an attacker mirror planted (SCRUBTOOEARLY)', () => {
    // The positive control and its negative twin, measured in the same process:
    // the ONLY difference between these two rows is whether the scrub was held.
    expect(m.pinnedScrubbedUrls).toHaveLength(1);
    expect(m.pinnedScrubbedUrls[0].startsWith(m.official)).toBe(true);
    expect(m.pinnedUnscrubbedUrls[0].startsWith(m.attacker)).toBe(true);
  });

  test('EVERY repo-plantable read the pinned call makes lands INSIDE the scrub window', () => {
    // 20 reads on a stable version: four knobs (customVersion, mirror, customDir,
    // customFilename) x five repo-reachable spellings each. `nightlyMirror` adds
    // five more only for a nightly version. NONE after the restore — which is the
    // invariant B1 said was unverified, now verified against the real library.
    expect(m.pinned.inside).toBe(20);
    expect(m.pinned.after).toBe(0);
  });

  test('the UNPINNED route DOES read them again after the restore — the named, measured residual', () => {
    // Pinned on purpose, because the docs must not be wider than the code. With
    // no `checksums` table, `validateArtifact` recursively downloadArtifact()s
    // SHASUMS256.txt AFTER awaits, with the environment restored, and reads the
    // planted names back (13, not 20: mirrorVar's `||` chain short-circuits as
    // soon as a planted name answers). The ARTIFACT still comes from the official
    // URL — its URL was fixed inside the scrub — so the escape can only make the
    // checksum file disagree with official bytes, i.e. FAIL the download. If a
    // future @electron/get closes this, this test says so and the docs follow.
    expect(m.unpinned.inside).toBe(20);
    expect(m.unpinned.after).toBe(13);
    expect(m.unpinnedScrubbedUrls[0].startsWith(m.official)).toBe(true);
    expect(m.unpinnedScrubbedUrls[1].startsWith(m.attacker)).toBe(true);
  });

  test('NOTHING outside the scrub can observe it — concurrent repairs do not interleave (B3)', () => {
    // B3 read the scrub as live across the download. It is not: delete -> call ->
    // restore contains no `await`, so it is one synchronous turn. Two concurrent
    // scrubbed downloads, sampled from the microtask, immediate and timer queues.
    expect(m.interleaving.samples).toBeGreaterThan(1000);
    expect(m.interleaving.sawScrubbed).toBe(0);
    for (const url of m.interleaving.concurrentUrls) {
      expect(url.startsWith(m.official)).toBe(true);
    }
  });
});
