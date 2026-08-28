#!/usr/bin/env node

/**
 * Amicus CLI Entry Point
 *
 * Spec Reference: §4 CLI Interface
 * Routes commands to appropriate handlers.
 */

// Node version guard: fail fast on unsupported Node versions
const { checkNodeVersion } = require('../src/utils/node-version-guard');
const _nv = checkNodeVersion(process.version);
if (!_nv.ok) { process.stderr.write(_nv.message + '\n'); process.exit(1); }

// Load API keys from all sources: process.env > amicus .env > auth.json
const { loadCredentials } = require('../src/utils/env-loader');
loadCredentials();

// Diagnostics probe live provider endpoints with those keys. That is allowed
// HERE and nowhere else: utils/live-probes.js defaults to off, so a module
// required outside this CLI (a test, a script) can never spend them. A skipped
// probe is reported as unverified, never as healthy — see live-probes.js.
require('../src/utils/live-probes').enableLiveProbes();

const { parseArgs, getUsage, getCommandNames } = require('../src/cli');
const { handleSetup, handleAbort, handleUpdate, handleMcp, handleKey } = require('../src/cli-handlers');
const { handleStart, handleFanout, handleRead } = require('../src/cli-handlers-run');
const { handleResume, handleContinue } = require('../src/cli-handlers-resume-continue');
const { isOneShotCommand, armExitWatchdog } = require('../src/utils/lifecycle');
const { suggestCommand } = require('../src/utils/input-validators');
const { unknownFlags, getKnownFlags } = require('../src/utils/known-flags');
const { packSaveVersionConflict } = require('../src/utils/cli-preflight');
const { failJson } = require('../src/utils/error-doc');
const { logger } = require('../src/utils/logger');

const VERSION = require('../package.json').version;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  // Reject unknown flags BEFORE anything can act on a half-understood command
  // line. parseArgs accepts any `--token`, so an unrecognized one used to land
  // on `args`, go unread, and let the command run as though it were never typed
  // — `start … --headless` silently took the interactive path, ignored `--model`
  // and left a session running. Same treatment as an unknown command: name it,
  // suggest the nearest real flag, point at help, exit 1. See
  // src/utils/known-flags.js for what counts as known and why.
  const badFlags = unknownFlags(args);
  if (badFlags.length > 0) {
    for (const flag of badFlags) {
      console.error(`Unknown option: --${flag}`);
      const candidates = suggestCommand(flag, [...getKnownFlags()]);
      if (candidates.length > 0) {
        console.error(`Did you mean: ${candidates.map(c => `--${c}`).join(', ')}`);
      }
    }
    console.error(command
      ? `Run \`amicus ${command} --help\` to see valid options.`
      : 'Run `amicus --help` to see valid options.');
    process.exit(1);
  }

  // `--cwd` typed with no value parses as boolean `true` (src/cli.js:101) and
  // `--cwd=` as '' (src/cli.js:72). DEFAULTS (src/cli.js:28) always seeds a
  // real absolute string, so a non-string or empty cwd can ONLY mean "typed
  // without a value" — which makes this guard provably free of false
  // positives. Left unguarded it reached 16 `args.cwd || process.cwd()`
  // sites across 9 handlers: council run threw a raw TypeError, template
  // silently resolved <cwd>/true.
  // No dash check here: absolute paths never start with '-', and
  // `--cwd ./x` is legitimate.
  if (typeof args.cwd !== 'string' || args.cwd === '') {
    console.error('Error: --cwd requires a value');
    console.error(command
      ? `Run \`amicus ${command} --help\` to see valid options.`
      : 'Run `amicus --help` to see valid options.');
    process.exit(1);
  }

  // Install crash handler for MCP-spawned processes (have --task-id)
  if (args['task-id'] && (command === 'start' || command === 'continue')) {
    const { installCrashHandler } = require('../src/sidecar/crash-handler');
    const project = args.cwd || process.cwd();
    const handler = installCrashHandler(args['task-id'], project);
    process.on('uncaughtException', (err) => {
      handler(err);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      handler(reason instanceof Error ? reason : new Error(String(reason)));
      process.exit(1);
    });
  }

  // Non-interactive update check (skip for mcp, --version, --help)
  if (command !== 'mcp' && !args.version && !args.help) {
    const { initUpdateCheck, getUpdateInfo, notifyUpdate } = require('../src/utils/updater');
    await initUpdateCheck();
    // Pass update info to Electron child process via env var,
    // because update-notifier deletes the cache entry after reading it.
    const cliUpdateInfo = getUpdateInfo();
    if (cliUpdateInfo) {
      process.env.AMICUS_UPDATE_INFO = JSON.stringify(cliUpdateInfo);
      process.on('exit', () => {
        process.stderr.write(
          `\n  Update available: v${cliUpdateInfo.current} → v${cliUpdateInfo.latest}\n` +
          '  Run `npm install -g amicus` to upgrade.\n\n'
        );
      });
    }
  }

  // `pack save` documents a per-pack `--pack-version <semver>`. `--version` is a
  // global BOOLEAN_FLAG, so `pack save … --version 2.0.0` used to fall straight
  // into the banner below: exit 0, no pack written, the semver stranded in
  // positionals. Reject that one combination by name instead of silently doing
  // something else; every other --version still prints the banner.
  const versionConflict = packSaveVersionConflict(args);
  if (versionConflict) {
    process.exit(failJson(!!args.json, versionConflict));
  }

  // Handle --version
  if (args.version) {
    console.log(`amicus v${VERSION}`);
    process.exit(0);
  }

  // Handle --help or no command. 'amicus <cmd> --help' scopes the usage to that
  // subcommand; bare 'amicus --help' (or no command) prints the full usage.
  if (args.help || args._.length === 0) {
    console.log(getUsage(args.help ? command : undefined));
    process.exit(0);
  }

  let exitCode = 0;
  try {
    switch (command) {
      case 'start':
        exitCode = await handleStart(args);
        break;
      case 'fanout':
        exitCode = await handleFanout(args);
        break;
      case 'list':
        await handleList(args);
        break;
      case 'status': {
        const { handleStatus } = require('../src/cli-handlers-status');
        exitCode = await handleStatus(args);
        break;
      }
      case 'resume':
        exitCode = await handleResume(args);
        break;
      case 'continue':
        exitCode = await handleContinue(args);
        break;
      case 'read':
        await handleRead(args);
        break;
      case 'models': {
        const { handleModels } = require('../src/sidecar/models');
        exitCode = await handleModels(args);
        break;
      }
      case 'council': {
        const { handleCouncil } = require('../src/cli-handlers-council');
        exitCode = await handleCouncil(args);
        break;
      }
      case 'doctor': {
        const { handleDoctor } = require('../src/cli-handlers-doctor');
        exitCode = await handleDoctor(args);
        break;
      }
      case 'init': {
        const { handleInit } = require('../src/cli-handlers-init');
        exitCode = await handleInit(args);
        break;
      }
      case 'spend': {
        const { handleSpend } = require('../src/cli-handlers-spend');
        exitCode = await handleSpend(args);
        break;
      }
      case 'watch': {
        const { handleWatch } = require('../src/cli-handlers-watch');
        exitCode = await handleWatch(args);
        break;
      }
      case 'provider': {
        const { handleProvider } = require('../src/cli-handlers-provider');
        exitCode = await handleProvider(args);
        break;
      }
      case 'setup':
        await handleSetup(args);
        break;
      case 'key':
        await handleKey(args);
        break;
      case 'abort':
        exitCode = await handleAbort(args);
        break;
      case 'mcp':
        await handleMcp();
        break;
      case 'update':
        await handleUpdate();
        break;
      case 'template': {
        const { handleTemplate } = require('../src/cli-handlers-template');
        exitCode = await handleTemplate(args);
        break;
      }
      case 'pack': {
        const { handlePack } = require('../src/cli-handlers-pack');
        exitCode = await handlePack(args);
        break;
      }
      default: {
        console.error(`Unknown command: ${command}`);
        // suggestCommand honors a cap-3 contract (up to 3 candidates, closest
        // first) — print all of them, not just the closest, matching the
        // join precedent in src/cli-handlers.js.
        const candidates = suggestCommand(command, getCommandNames());
        if (candidates.length > 0) { console.error(`Did you mean: ${candidates.join(', ')}`); }
        console.log(getUsage());
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  // F3 #15: one-shot commands must not hang on a lingering handle. The work is
  // done here; give natural drain a brief grace, then force-exit as a net.
  // (mcp is long-lived and never reaches this point.)
  if (exitCode) { process.exitCode = exitCode; }
  if (isOneShotCommand(command)) {
    armExitWatchdog(exitCode, 1500, { log: (m, meta) => logger.debug(m, meta) });
  }
}

/**
 * Handle 'sidecar list' command
 * Spec Reference: §4.2
 */
async function handleList(args) {
  const { listAmicus } = require('../src/index');

  await listAmicus({
    status: args.status,
    all: args.all,
    json: args.json,
    search: args.search,
    limit: args.limit,
    project: args.cwd
  });
}

// Run main
main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
