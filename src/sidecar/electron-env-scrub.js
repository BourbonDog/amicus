/**
 * The ENV SCRUB — which environment names a hostile REPOSITORY can plant, and
 * what is stripped from the last-resort `install.js` spawn because of it.
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
 * The ARTIFACT SELECTORS: the npm-config keys that choose WHICH electron build
 * `install.js` fetches, in every shape a repository can plant them.
 *
 * v4.9.6 F2 (council B2). This used to be the literal pair
 * `['npm_config_platform', 'npm_config_arch']`, so a repo `package.json`
 * `"config": {"platform": …}` — which npm turns into `npm_package_config_platform`
 * — survived the scrub into the unpinned last-resort spawn. The `electron_*`
 * knobs above already handled BOTH npm shapes and this pair simply never got the
 * same treatment; deriving both spellings from the KEY removes the asymmetry
 * instead of adding two more strings to a list.
 *
 * RE-ENUMERATED EXHAUSTIVELY against the installed `node_modules/electron`
 * (43.1.1) `install.js`. Every `process.env` read in that file:
 *   ELECTRON_INSTALL_PLATFORM (20, 99)  bare — amicus SETS it, ranked first
 *   npm_config_platform       (20, 99)  REPO-PLANTABLE  -> scrubbed here
 *   ELECTRON_INSTALL_ARCH     (21)      bare — amicus SETS it, ranked first
 *   npm_config_arch           (21, 27)  REPO-PLANTABLE  -> scrubbed here
 *   force_no_cache            (45)      bare — amicus sets it for `force`
 *   electron_config_cache     (46)      bare — the machine owner's cache root
 *   electron_use_remote_checksums            (48)  bare — the owner's
 *   npm_config_electron_use_remote_checksums (48)  covered by the prefixes above
 *   ELECTRON_OVERRIDE_DIST_PATH (73, 80) bare
 * MEASURED, and worth stating rather than implying: install.js 43.1.1 does NOT
 * itself read `npm_package_config_platform` / `-arch`, so that spelling is not a
 * live exploit against THIS electron. It is scrubbed anyway because the module's
 * whole model is "npm produces two shapes, remove both", because amicus cannot
 * pin what a future install.js reads, and because removing a name no child of
 * ours has any business reading costs nothing.
 */
const ELECTRON_INSTALL_TARGET_KEYS = ['platform', 'arch'];
const ELECTRON_INSTALL_TARGET_ENV = ELECTRON_INSTALL_TARGET_KEYS
  .flatMap((key) => [`npm_config_${key}`, `npm_package_config_${key}`]);

/** True for a name a hostile repository could have planted, in ANY case (see above). */
function isRepoPlantedName(name) {
  const lower = String(name).toLowerCase();
  return REPO_ENV_PREFIXES.some((prefix) => lower.startsWith(prefix))
    || ELECTRON_INSTALL_TARGET_ENV.includes(lower);
}

/**
 * A COPY of env for the runInstaller SPAWN. Never mutates the argument.
 *
 * electron's own install.js honours `npm_config_electron_mirror` (through
 * @electron/get) AND `npm_config_electron_use_remote_checksums` (its lines 47-50,
 * which turns its bundled pin off), so spawning it with an unfiltered
 * `{...process.env}` would funnel a blocked attacker straight into an unpinned
 * downloader. The artifact selectors (its lines 20-21, 27 and 99) choose WHICH
 * artifact it fetches, so they are removed too and amicus's own resolution is
 * pinned through `ELECTRON_INSTALL_PLATFORM`/`_ARCH`, which install.js ranks
 * above them.
 *
 * LEAVES ALONE, deliberately — every one of these is a BARE name a repository
 * cannot plant, so it is the machine owner's: `ELECTRON_MIRROR`,
 * `ELECTRON_CUSTOM_*`, `electron_config_cache`, `ELECTRON_CACHE`,
 * `electron_use_remote_checksums`, `HTTP_PROXY`/`HTTPS_PROXY`/`ELECTRON_GET_USE_PROXY`.
 */
function scrubbedChildEnv({ env = process.env, platform, arch } = {}) {
  const out = { ...env };
  for (const name of Object.keys(out)) {
    if (isRepoPlantedName(name)) { delete out[name]; }
  }
  if (platform) { out.ELECTRON_INSTALL_PLATFORM = platform; }
  if (arch) { out.ELECTRON_INSTALL_ARCH = arch; }
  return out;
}

module.exports = {
  isRepoPlantedName,
  scrubbedChildEnv,
  REPO_ENV_PREFIXES,
  ELECTRON_INSTALL_TARGET_KEYS,
  ELECTRON_INSTALL_TARGET_ENV,
};
