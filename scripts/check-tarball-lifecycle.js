#!/usr/bin/env node

/**
 * CI guard: assert every script referenced by an npm *lifecycle* hook actually
 * ships in the published tarball.
 *
 * package.json whitelists lifecycle scripts individually in "files"
 * (e.g. scripts/postinstall.js, scripts/setup-hooks.js). Nothing stops a
 * future-added lifecycle script from being silently dropped from the tarball —
 * which would make `npm install amicus` skip a postinstall/prepare step with no
 * error. This durable regression guard derives the lifecycle scripts from
 * package.json, runs `npm pack --dry-run --json` (SAFE — no install), and fails
 * if any lifecycle-referenced local script is absent from the tarball file list.
 *
 * Usage:
 *   node scripts/check-tarball-lifecycle.js                    # CI / manual
 *   const { checkTarball } = require('./scripts/check-tarball-lifecycle');
 *
 * Cross-platform: no shell, no bash-isms; path separators normalized.
 */

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * npm lifecycle hook names that run package scripts. Derived from npm's
 * documented lifecycle events (the install, publish, pack, version and restart
 * families) plus the generic pre/post wrappers. We treat any script whose
 * name is in this set — or is a pre/post wrapper of any other script — as a
 * lifecycle hook. (Plain user scripts like "test"/"lint" only run via
 * `npm run`, so they need not ship in the tarball.)
 */
const NPM_LIFECYCLE_EVENTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublishOnly',
  'prepack',
  'postpack',
  'dependencies',
  'prerestart',
  'restart',
  'postrestart',
  'preversion',
  'version',
  'postversion',
]);

/** Normalize a path to forward slashes for cross-platform comparison. */
function normalizePath(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * Extract local script file paths referenced by lifecycle-hook commands.
 *
 * A "lifecycle hook" is any package.json script whose name is a known npm
 * lifecycle event (derived dynamically from NPM_LIFECYCLE_EVENTS, not from a
 * hardcoded list of file paths). For each such hook we pull out every local
 * relative path mentioned in its command (e.g. `node scripts/postinstall.js`).
 *
 * @param {object} pkg - Parsed package.json.
 * @returns {string[]} Unique, forward-slash-normalized local script paths.
 */
function collectLifecycleScripts(pkg) {
  const scripts = (pkg && pkg.scripts) || {};
  const found = new Set();

  for (const [name, command] of Object.entries(scripts)) {
    if (!NPM_LIFECYCLE_EVENTS.has(name)) {
      continue;
    }
    // Pull out tokens that look like local relative file paths, e.g.
    // "scripts/postinstall.js" from "node scripts/postinstall.js".
    const tokenRe = /(?:^|[\s=])([\w.\-/\\]+\.(?:js|cjs|mjs|sh))(?=$|[\s"'])/g;
    let m;
    while ((m = tokenRe.exec(command)) !== null) {
      const candidate = normalizePath(m[1]);
      // Skip absolute paths and bare node flags; keep repo-relative paths.
      if (candidate.startsWith('/') || candidate.startsWith('-')) {
        continue;
      }
      found.add(candidate);
    }
  }

  return [...found];
}

/**
 * Parse the file-path list from `npm pack --dry-run --json` output.
 * @param {string|Array} packOutput - Raw JSON string or already-parsed array.
 * @returns {string[]} Forward-slash-normalized packed file paths.
 */
function extractPackedPaths(packOutput) {
  const parsed = typeof packOutput === 'string' ? JSON.parse(packOutput) : packOutput;
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = (entry && entry.files) || [];
  return files.map((f) => normalizePath(f.path));
}

/**
 * Return the lifecycle scripts that are NOT present in the packed file list.
 * Comparison is path-separator-insensitive.
 * @param {string[]} lifecycleScripts
 * @param {string[]} packedPaths
 * @returns {string[]} Missing script paths (normalized).
 */
function findMissing(lifecycleScripts, packedPaths) {
  const packedSet = new Set(packedPaths.map(normalizePath));
  return lifecycleScripts.map(normalizePath).filter((s) => !packedSet.has(s));
}

/**
 * Run `npm pack --dry-run --json` and return its parsed output.
 *
 * SAFE: --dry-run never writes a tarball and never installs. --ignore-scripts
 * is REQUIRED so npm does not execute this package's own prepare/prepack hooks
 * (which mutate git config and pollute stdout) during the dry run.
 *
 * @param {string} [cwd] - Directory to pack from.
 * @returns {Array} Parsed npm pack JSON.
 */
function runPack(cwd = process.cwd()) {
  // On Windows the npm entrypoint is npm.cmd, which Node cannot spawn via
  // execFileSync without a shell (EINVAL on .cmd). Enable shell only there.
  // The argument list is fully static and trusted, so there is no injection
  // surface despite shell:true.
  const out = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd, encoding: 'utf-8', shell: process.platform === 'win32' }
  );
  return JSON.parse(out);
}

/**
 * Core check: do all lifecycle-referenced scripts ship in the tarball?
 * @param {object} opts
 * @param {object} opts.pkg - Parsed package.json.
 * @param {string|Array} opts.packOutput - npm pack --dry-run --json output.
 * @returns {{ok: boolean, missing: string[], lifecycleScripts: string[]}}
 */
function checkTarball({ pkg, packOutput }) {
  const lifecycleScripts = collectLifecycleScripts(pkg);
  const packedPaths = extractPackedPaths(packOutput);
  const missing = findMissing(lifecycleScripts, packedPaths);
  return { ok: missing.length === 0, missing, lifecycleScripts };
}

/** CLI: read the real package, run a real (script-free) pack, assert, exit. */
function main() {
  const root = join(__dirname, '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  let packOutput;
  try {
    packOutput = runPack(root);
  } catch (err) {
    console.error(`check:tarball — failed to run 'npm pack --dry-run --json': ${err.message}`);
    process.exit(1);
  }

  const { ok, missing, lifecycleScripts } = checkTarball({ pkg, packOutput });

  if (!ok) {
    console.error(
      '\n  check:tarball — BLOCKED: lifecycle scripts missing from the published tarball:'
    );
    for (const m of missing) {
      console.error(`    - ${m} (referenced by a package.json lifecycle hook but not in "files")`);
    }
    console.error('\n  Add the missing path(s) to the "files" array in package.json.\n');
    process.exit(1);
  }

  console.log(
    `check:tarball — OK: ${lifecycleScripts.length} lifecycle script(s) all ship in the tarball.`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  collectLifecycleScripts,
  extractPackedPaths,
  findMissing,
  runPack,
  checkTarball,
  normalizePath,
};
