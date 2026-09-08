/**
 * The ENV SCRUB — which environment names a hostile REPOSITORY can plant.
 *
 * WHAT THIS MODULE LOST, AND WHY (v4.9.6 second round, council seat B1).
 * It used to build a scrubbed environment for the last-resort `install.js`
 * SPAWN. That spawn is gone — it bypassed the custody and digest gate entirely
 * — so `scrubbedChildEnv` and the `ELECTRON_INSTALL_TARGET_*` artifact selectors
 * went with it: there is no child process left to hand an environment to. The
 * measured enumeration they encoded is kept below as the record it is.
 * `isRepoPlantedName` survives and is now used by the IN-PROCESS download scrub
 * (electron-provision.js), which is the surface seat D5 filed against.
 *
 * SPLIT OUT of electron-trust.js (v4.9.6 F2). That module owns three things —
 * the digest anchor, the gate, and this scrub — and sat at 299 of the repo's
 * 300-line limit, so the F2 repair had nowhere to go. electron-trust.js
 * RE-EXPORTS every name below, so existing imports keep working and the split is
 * invisible to callers. This module is a LEAF (no requires at all); the arrow is
 * electron-install -> electron-provision -> electron-trust -> electron-env-scrub
 * and must never point back.
 *
 * The trust boundary it encodes: a hostile REPOSITORY (a clone the user opens,
 * an unpacked sample) controls the `.npmrc` and `package.json` of the directory
 * amicus's own docs tell people to run `npx -y amicus@latest` in. MEASURED (npm
 * 11.16.0): that reaches the child as exactly two name shapes —
 * `npm_config_<key lowercased>` and `npm_package_config_<key case-preserved>` —
 * and NOTHING else. Bare `ELECTRON_*` and `AMICUS_*` names are out of its reach,
 * which is why the escape hatch is a plain environment variable and why a
 * machine-level `ELECTRON_MIRROR` is still honoured.
 *
 * @module sidecar/electron-env-scrub
 */

'use strict';

/**
 * Env-name PREFIXES an untrusted REPOSITORY can plant for the mirror knobs.
 *
 * PREFIXES, not a hand-maintained name list. RE-ENUMERATED EXHAUSTIVELY for
 * v4.9.6 F2 against `@electron/get` 5.0.0 (`dist/artifact-utils.js`, lines 20-35):
 * `mirrorVar(name)` is called for exactly five names — `mirror`, `nightlyMirror`,
 * `customDir`, `customFilename`, `customVersion` — and reads six spellings of
 * each, thirty names in all:
 *   1. `npm_config_electron_<name.toLowerCase()>`          .npmrc
 *   2. `NPM_CONFIG_ELECTRON_<SNAKE_UPPER>`                 .npmrc, npm's own casing
 *   3. `npm_config_electron_<snake_lower>`                 .npmrc
 *   4. `npm_package_config_electron_<name>` (case KEPT)    package.json "config"
 *   5. `npm_package_config_electron_<snake_lower>`         package.json "config"
 *   6. `ELECTRON_<SNAKE_UPPER>`                            plain env
 * Rows 1-5 — twenty-five names — all begin with one of the two prefixes below
 * under a case fold, so the prefixes cover every repo-reachable mirror knob
 * exactly. Row 6 (`ELECTRON_MIRROR`, `ELECTRON_NIGHTLY_MIRROR`,
 * `ELECTRON_CUSTOM_DIR`, `ELECTRON_CUSTOM_FILENAME`, `ELECTRON_CUSTOM_VERSION`)
 * is BARE and therefore the machine owner's, and is deliberately kept.
 *
 * The prefixes also cover electron's own
 * `npm_config_electron_use_remote_checksums` (install.js lines 47-50 — that name
 * turns electron's bundled pin OFF), plus any knob a future @electron/get adds in
 * the same namespace. Contrast ENGINE_CREDENTIAL_ENV
 * (scripts/run-integration-keyless.js:101), whose own docblock warns that nothing
 * makes a name list follow an upstream bump.
 *
 * The BARE `electron_use_remote_checksums` is deliberately NOT removed: a bare
 * lower-case name is not repo-injectable, so it carries the machine owner's
 * intent, exactly like a bare `ELECTRON_MIRROR`.
 *
 * MATCHED CASE-INSENSITIVELY. This used to fold no case, on the claim that
 * because the Windows environment block is case-insensitive, deleting the
 * lower-case name also removed the `NPM_CONFIG_ELECTRON_*` view @electron/get
 * reads second. That is true of `process.env` and FALSE of the `{...env}` PLAIN
 * OBJECT this module actually deletes from — a plain object is case-sensitive on
 * every platform, so the upper-case key survived and was handed to the child.
 * RE-MEASURED (npm 11.16.0, Windows 11) — two ways a repository reaches an
 * upper-case slot:
 *   1. `.npmrc` `electron_mirror=…` while `NPM_CONFIG_ELECTRON_MIRROR` already
 *      exists in the environment: npm overwrites that slot's VALUE and never
 *      renames it, so the child sees the ATTACKER's URL under the upper-case name.
 *   2. `package.json` `"config": {"ELECTRON_MIRROR": …}`: npm PRESERVES the key's
 *      case, planting `npm_package_config_ELECTRON_MIRROR` with nothing
 *      pre-existing at all — and @electron/get's own lookup for
 *      `npm_package_config_electron_mirror` (row 5 above) finds it, because the
 *      Windows lookup is case-insensitive too.
 * The old docblock's POSIX half (`NPM_CONFIG_ELECTRON_*` is a distinct variable
 * npm never writes there, so it is the machine owner's) is NOT measurable from
 * this machine, and it is load-bearing in the fail-OPEN direction: wrong, it
 * hands the child an attacker's mirror. Wrong the other way it costs one
 * alternate spelling inside a last-resort spawn, while bare `ELECTRON_MIRROR`
 * — which @electron/get ranks FIRST — still carries owner intent. So the fold is
 * unconditional rather than resting on an unverified platform claim.
 */
const REPO_ENV_PREFIXES = ['npm_config_electron_', 'npm_package_config_electron_'];

/**
 * THE ARTIFACT SELECTORS ARE GONE WITH THE SPAWN, and this is the record of what
 * they were, because it was measured and a later change may need it.
 *
 * `ELECTRON_INSTALL_TARGET_ENV` held `npm_config_platform` / `npm_config_arch`
 * and their `npm_package_config_*` spellings (council B2 added the second pair).
 * They mattered because they chose WHICH artifact `install.js` fetched. Nothing
 * spawns install.js any more (seat B1), and amicus's own downloader is passed
 * `platform` and `arch` as ARGUMENTS, so no environment name can choose them.
 *
 * RE-ENUMERATED EXHAUSTIVELY, before the deletion, against the installed
 * `node_modules/electron` (43.1.1) `install.js`. Every `process.env` read there:
 *   ELECTRON_INSTALL_PLATFORM (20, 99)  bare — amicus used to SET it
 *   npm_config_platform       (20, 99)  REPO-PLANTABLE
 *   ELECTRON_INSTALL_ARCH     (21)      bare — amicus used to SET it
 *   npm_config_arch           (21, 27)  REPO-PLANTABLE
 *   force_no_cache            (45)      bare
 *   electron_config_cache     (46)      bare — the machine owner's cache root
 *   electron_use_remote_checksums            (48)  bare — the owner's
 *   npm_config_electron_use_remote_checksums (48)  covered by the prefixes above
 *   ELECTRON_OVERRIDE_DIST_PATH (73, 80) bare
 * install.js 43.1.1 did NOT itself read `npm_package_config_platform` / `-arch`.
 *
 * WHAT THE IN-PROCESS SCRUB NEEDS is only the prefixes: `@electron/get` 5.0.0
 * reads `mirror`, `nightlyMirror`, `customDir`, `customFilename` and
 * `customVersion` under `npm_config_electron_*` / `npm_package_config_electron_*`
 * (dist/artifact-utils.js, lines 20-35) and takes platform and arch as call
 * arguments. So `isRepoPlantedName` covers the download surface exactly.
 */

/** True for a name a hostile repository could have planted, in ANY case (see above). */
function isRepoPlantedName(name) {
  return REPO_ENV_PREFIXES.some((prefix) => String(name).toLowerCase().startsWith(prefix));
}

/**
 * Run `fn` with every repo-plantable electron name DELETED from `env`, restoring
 * each one before returning — whether `fn` returned a value, returned a promise,
 * or threw (council seat D5).
 *
 * THE HOLE THIS CLOSES. The v4.9.6 mirror-knob scrub covered only the
 * last-resort `install.js` SPAWN, and amicus's own controlled download runs
 * `@electron/get` IN THIS PROCESS, reading `process.env` directly. So a hostile
 * repository could still point amicus's own download at its mirror. It was filed
 * as a nit because the digest pin refuses the redirected bytes anyway — this is
 * a wasted download, not a compromise — but a stated threat model that is wider
 * than the code is its own defect.
 *
 * ── WHAT IT COVERS, MEASURED RATHER THAN REASONED (round 3, seat B1) ───────
 * The previous version of this docblock ARGUED, from a source read, that every
 * repo-plantable name is read in `downloadArtifact`'s synchronous prefix. Seat
 * B1 called that "an unverified invariant about @electron/get internals" and
 * was right to: the argument had never been run, and the scrub pattern was
 * copied from `utils/engine-output-flag.js :: withOutputTokenFlag`, where it is
 * correct only because the thing it guards reads the env synchronously at spawn.
 *
 * So it was MEASURED, against the INSTALLED @electron/get 5.0.0 (Node 24.18.0,
 * Windows 11), by replacing `process.env` with a recording Proxy and driving a
 * real `downloadArtifact` with an injected offline downloader:
 *
 *   PINNED call (amicus's normal route — a `checksums` table goes out)
 *     20 repo-plantable reads, ALL INSIDE the scrub window; 0 after the restore.
 *     Four knobs on a stable version (`customVersion` from `getArtifactVersion`,
 *     then `mirror`, `customDir`, `customFilename` from `getArtifactRemoteURL`)
 *     x five repo-reachable spellings; `nightlyMirror` adds five on a nightly.
 *     POSITIVE CONTROL, `npm_config_electron_mirror=https://ATTACKER.example/mirror/`:
 *       scrubbed   -> https://github.com/electron/electron/releases/download/v43.1.1/…
 *       unscrubbed -> https://ATTACKER.example/mirror/ATTACKERDIR/ATTACKER.zip
 *     The scrub is therefore NOT a no-op: it is what puts that download back on
 *     the official URL.
 *
 *   UNPINNED call (no anchor, or the hatch dropped the pin — no `checksums`)
 *     The same 20 land inside the window and the ARTIFACT still comes from the
 *     official URL. Then `validateArtifact` recursively `downloadArtifact`s
 *     `SHASUMS256.txt` AFTER awaits, with the environment restored, and reads
 *     the planted names back — 13, not 20, because `mirrorVar`'s `||` chain
 *     short-circuits as soon as a planted name answers.
 *
 * THE RESIDUAL IS AVAILABILITY-ONLY, and that is why it is documented rather
 * than closed. The zip's URL was already fixed inside the scrub, so a planted
 * mirror cannot substitute the bytes — it can only serve a checksum file that
 * disagrees with the official artifact, which FAILS the download. Stated in
 * `docs/configuration.md` in those terms; that page used to say these names stay
 * stripped "for the length of amicus's own download call", which is wider than
 * the code and is corrected.
 *
 * ── NOTHING OUTSIDE CAN OBSERVE IT (seat B3, REFUTED BY MEASUREMENT) ───────
 * B3 read this as mutating shared `process.env` "while the download is still in
 * flight", so "concurrent repairs can interleave". They cannot: delete -> call
 * -> restore contains no `await`, so it is ONE synchronous turn and no other
 * task can be scheduled inside it. MEASURED: two concurrent scrubbed downloads
 * with an outside observer sampling `process.env` from the microtask, immediate
 * and timer queues — 11380 samples, 0 saw a scrubbed environment, and both
 * resolved to the official URL. The await-free window IS the control, which is
 * why `fn` is called synchronously and its promise is returned UNAWAITED.
 * `tests/electron-env-scrub-get5-contract.test.js` re-measures every number
 * above against the installed library on each run, so a @electron/get that moves
 * a read past an await turns red there instead of in the field.
 *
 * ── THREE REMEDIES CONSIDERED AND REJECTED, each with its reason ───────────
 * 1. Pass the values instead of scrubbing. IMPOSSIBLE: `mirrorVar` ranks
 *    `process.env` ABOVE `options[name]` (dist/artifact-utils.js, lines 20-35),
 *    so a planted name beats anything amicus puts in `mirrorOptions`.
 * 2. `mirrorOptions.resolveAssetURL`, which does override the URL outright and
 *    IS inherited by the recursive SHASUMS256 call. Rejected: it bypasses
 *    `base` entirely, so a machine owner's bare `ELECTRON_MIRROR` — which this
 *    module deliberately keeps — would silently stop being honoured, and amicus
 *    would have to hand-build electron release URLs.
 * 3. Hold the scrub for the whole call. Rejected by the finding itself: that is
 *    the shared-mutation-across-an-await B3 filed, and it would hand a scrubbed
 *    environment to every unrelated child a long-lived MCP process spawns in
 *    that window.
 *
 * `delete` and restore, not `= undefined`: assigning undefined to a process.env
 * key stores the STRING 'undefined', which `mirrorVar` would read as a truthy
 * mirror URL and use.
 * @template T
 * @param {() => T} fn called synchronously, exactly once
 * @param {NodeJS.ProcessEnv} [env] defaults to process.env
 * @returns {T} whatever fn returned (a promise is returned, never awaited here)
 */
function withScrubbedRepoEnv(fn, env = process.env) {
  const removed = [];
  for (const name of Object.keys(env)) {
    if (isRepoPlantedName(name)) {
      removed.push([name, env[name]]);
      delete env[name];
    }
  }
  try {
    return fn();
  } finally {
    for (const [name, value] of removed) { env[name] = value; }
  }
}

module.exports = { isRepoPlantedName, withScrubbedRepoEnv, REPO_ENV_PREFIXES };
