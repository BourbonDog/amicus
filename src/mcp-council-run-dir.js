/**
 * @module mcp-council-run-dir
 * amicus_council_run's run dir: `outDir` resolved and refused before any write (containment, then D-04's in-use check), split out of mcp-council-run.js for the 300-line size gate.
 */

'use strict';

const path = require('path');
const { isPathInside } = require('./project-root-allowlist');
const { otherRunInDir } = require('./council/run-state');

/**
 * Resolve `outDir` (default `<project>/council-<runId>`) and refuse it on either
 * fence. Both run before `mcp-council-run.js :: handleCouncilRunTool` writes
 * anything: the briefing copy and the run.json pre-seed land in this directory,
 * and the spawned child's stdout is discarded (`mcp-server.js :: spawnSidecarProcess`),
 * so a refusal left to the child would reach no one, after the old run's
 * briefing.md and record were already overwritten. The containment fence moved
 * here verbatim (v4.5); the in-use fence is D-04 (SL-4), off the predicate the
 * CLI door shares (`council/run-state.js :: otherRunInDir`).
 * @param {{outDir?: string}} input the tool input (only `outDir` is read)
 * @param {string} project resolved project dir
 * @param {string} runId the id handleCouncilRunTool just generated
 * @returns {{runDir: string}|{error: string}}
 */
function resolveMcpRunDir(input, project, runId) {
  const runDir = input.outDir
    ? path.resolve(project, String(input.outDir))
    : path.join(project, `council-${runId}`);
  if (!isPathInside(runDir, project)) {
    return { error: `outDir must resolve to a path inside the project directory (${project}).` };
  }
  const other = otherRunInDir(runDir, runId);
  if (other) {
    const held = other.runId ? `run ${other.runId}'s run.json` : 'a run.json that is not a readable run record';
    return { error: `outDir '${runDir}' already holds ${held} — pick an outDir with no run.json in it, or move the old run's folder aside.` };
  }
  return { runDir };
}

module.exports = { resolveMcpRunDir };
