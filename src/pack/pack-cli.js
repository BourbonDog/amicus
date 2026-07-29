// src/pack/pack-cli.js
'use strict';

/**
 * @module pack/pack-cli
 * v4.5 Task 13: shared --pack CLI wiring for handleFanout and handleStart
 * (src/cli-handlers-run.js). Task 12 wired handleCouncilRun's pack block
 * inline; fanout/start need the identical resolve-or-exit shape at TWO call
 * sites in the SAME file, which would push cli-handlers-run.js over the
 * 300-line size gate — extracted here instead. Deliberately excludes
 * council's packSuffix helper: neither fanout nor start has a
 * chair/critic/lenses pre-flight to attribute a failure to (Task-12 reviewer
 * confirmed no analog is needed here).
 */

const { applyPackToArgs } = require('./pack-resolve');
const { failJson } = require('../utils/error-doc');

/**
 * Resolve `args.pack` (when present) into `args`, in place, using
 * cli-handlers-run.js's own exit-on-error style (`process.exit(failJson(...))`)
 * rather than handleCouncilRun's `return failJson(...)`. A no-op — returns
 * null without touching `args` or exiting — when --pack was not passed.
 * @param {object} args - parsed CLI args; explicit-flag keys read from args.__explicit
 * @param {'fanout'|'solo'} expectedKind
 * @param {boolean} useJson
 * @returns {{name: string, version: string, hash: string, source: string}|null}
 */
function applyPackOrExit(args, expectedKind, useJson) {
  if (args.pack === undefined) { return null; }
  const explicit = args.__explicit || new Set();
  const pr = applyPackToArgs({ packRef: args.pack, expectedKind, args, explicit, useJson });
  if (pr.error) { process.exit(failJson(useJson, pr.error)); }
  for (const n of pr.notices) { process.stderr.write(n + '\n'); }
  return pr.packRecord;
}

module.exports = { applyPackOrExit };
