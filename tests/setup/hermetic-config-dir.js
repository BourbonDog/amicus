'use strict';

/**
 * Global hermetic baseline for the unit suite (wired via jest.config.js setupFiles;
 * omitted for the integration rails, which manage their own credential env).
 *
 * getConfigDir() (src/utils/config.js) and getEnvPath() (src/utils/api-key-store.js)
 * read AMICUS_CONFIG_DIR / AMICUS_ENV_DIR straight from process.env, so pinning them
 * here — before the test framework loads, once per test file — guarantees no test can
 * read or write the developer's real ~/.config/amicus or its .env keys.
 *
 * Scoped to a per-worker scratch dir that is reset at the start of every test file, so
 * nothing leaks across files, across runs, or into real config. Set-if-unset: a test
 * that pins its own dir (the 40+ that already do) or the keyless integration wrapper
 * (which deletes these vars to force self-skip) still wins.
 *
 * This closes the config/keys-dir door only. It does NOT sandbox os.homedir()-based
 * reads (OpenCode auth.json); that credential door is handled separately by the
 * parent-process scrub in scripts/run-integration-keyless.js.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const workerId = process.env.JEST_WORKER_ID || '0';
const scratch = path.join(os.tmpdir(), `amicus-hermetic-w${workerId}`);

// Reset to empty at the start of each file: clears any config a prior file (or run)
// wrote, and bounds the footprint to one reused dir per worker (no accumulation).
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });

if (!process.env.AMICUS_CONFIG_DIR) { process.env.AMICUS_CONFIG_DIR = scratch; }
if (!process.env.AMICUS_ENV_DIR) { process.env.AMICUS_ENV_DIR = scratch; }
