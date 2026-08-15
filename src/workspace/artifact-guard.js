/**
 * Council Workspace — artifact read guard (v4.4 §4.5 workspace:read-artifact).
 *
 * Two independent fences:
 *  1. The name must be on the manifest-derived allowlist (fixed names +
 *     review-/judge- files for run.json bench seats via v4.0's sanitizeName,
 *     which strips every path separator) — traversal is unrepresentable.
 *  2. The realpath of the resolved file must stay inside the realpath of the
 *     run dir — a symlinked artifact cannot leak files from outside.
 * >200 KB truncates with a flag (spec §4.5). report.html is deliberately NOT
 * readable here — it opens externally via workspace:open-report.
 */
'use strict';

const fsReal = require('fs');
const path = require('path');
const { readPointer } = require('./run-scan');
const { isRealpathContained } = require('../utils/path-fence');
// v4.8 PR5a: name derivation moved to ./artifact-names (the 300-line gate). The two
// constants and artifactAllowlist are re-exported below unchanged, so every existing
// caller and test keeps importing them from here.
// `isSeatTable` joins them (fix-wave, council A1/B1): run-detail.js has to answer "is
// this run in seat space?" with THE predicate artifactAllowlist gates on, not a second
// spelling of it, and this module is already its import surface.
const { artifactAllowlist, isSeatTable, FIXED_ARTIFACTS, DEBATE_ARTIFACTS } = require('./artifact-names');

const MAX_ARTIFACT_BYTES = 200 * 1024;

// isRealpathContained itself now lives in ../utils/path-fence.js (the shared "fence 2"
// primitive: a realpath-based containment test that defeats symlink escapes AND
// tampered/stale pointers). Re-exported below for backward compatibility — callers
// outside this module (electron/ipc-workspace.js's workspace:open-report, this
// file's own tests, and as of the third council-review pass src/workspace/run-detail.js
// and src/workspace/run-scan.js) all reuse the exact same check rather than
// re-implementing it. It could not stay defined here: run-scan.js needs it too, and
// this file already requires run-scan.js for readPointer, so a shared leaf module
// (no workspace/* deps of its own) is what keeps that from becoming a require cycle.

/**
 * Trim a buffer to at most `max` bytes without splitting a multi-byte UTF-8 character.
 * A plain `buf.subarray(0, max)` can land mid-sequence — the tail bytes then decode as
 * U+FFFD replacement characters, which can even push the encoded string back over `max`.
 * Walks back over trailing continuation bytes (10xxxxxx) until it finds a clean boundary,
 * dropping the whole partial character rather than emitting mojibake.
 */
function truncateUtf8(buf, max) {
  let end = max;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) { end -= 1; }
  return buf.subarray(0, end);
}


/**
 * @param {string} project
 * @param {string} runId
 * @param {string} name artifact filename (must be allowlisted)
 * @param {object} [deps] TEST-ONLY dependency injection: {realpathSync}. Never populate this
 *   from renderer/caller-supplied input in production — an attacker-controlled realpathSync
 *   would silently erase fence 2 (the realpath containment check below).
 * @returns {{text: string, truncated?: true} | {error: string}}
 */
function readRunArtifact(project, runId, name, deps = {}) {
  const realpathSync = deps.realpathSync || ((p) => fsReal.realpathSync(p));
  const ptr = readPointer(project, runId);
  if (ptr.error) { return { error: ptr.error }; }

  let realDir;
  try { realDir = realpathSync(ptr.runDir); }
  catch { return { error: 'run dir unreadable' }; }

  // ⚠️ COUNCIL REVIEW R2 (A1) / ROUND 4 ORDERING FIX (third live paid council, blocker):
  // this outer fence — "runDir ITSELF (straight from the pointer file's JSON, validated
  // only for truthiness by src/council/run-state.js's readPointer) stays inside project" —
  // must run BEFORE any read reaches the filesystem. It used to run AFTER an unconditional
  // read+JSON.parse of run.json from ptr.runDir: the fence still refused to hand back
  // artifact bytes, so nothing ever leaked, but a tampered/stale pointer could still force
  // this process to read-and-parse attacker-influenced JSON at an arbitrary path before any
  // containment check ran — a parser surface with no corresponding gate. Mirrors
  // src/workspace/run-detail.js's getRunDetail, which already resolves+fences BEFORE
  // reading anything (round 3); this function was the one place in the workspace surface
  // that got the ordering wrong. Also mirrors electron/ipc-workspace.js's
  // workspace:open-report fence (first council review, finding C1): same isRealpathContained
  // helper, same check, same error wording — now correctly ordered on the channel that
  // actually serves artifact bytes (workspace:read-artifact and workspace:fold's
  // chair-output.md read both funnel through this function).
  let realProject;
  try { realProject = realpathSync(project); }
  catch { return { error: 'project unreadable' }; }
  if (!isRealpathContained(realProject, realDir)) {
    return { error: 'run directory escapes project' };
  }

  let run;
  try { run = JSON.parse(fsReal.readFileSync(path.join(ptr.runDir, 'run.json'), 'utf-8')); }
  // Generic message (round 4): a readFileSync failure's err.message embeds the full
  // resolved path it tried to open — interpolating it here would hand the renderer an
  // internal filesystem path (in the pre-fence-ordering bug, potentially one entirely
  // outside the project) via the IPC response.
  catch { return { error: 'run.json unreadable' }; }

  if (!artifactAllowlist(run).includes(name)) { return { error: `artifact not allowed: ${name}` }; }

  let realTarget;
  try { realTarget = realpathSync(path.join(ptr.runDir, name)); }
  catch (err) {
    // ⚠️ v4.4.1 RN-10: this catch used to answer `not written yet: <name>` for ANY realpath
    // failure — ENOENT, EACCES, EPERM, EIO, ELOOP, a dangling symlink — so a permission problem
    // was indistinguishable from a file the council simply has not produced yet. That is not a
    // cosmetic conflation: electron/ipc-workspace.js's workspace:fold reads chair-output.md
    // through this function, and on a permission error it produced a silent CHAIRLESS fold that
    // still reported {ok: true}. The logger.warn it now emits was the mitigation — but it logged
    // this string, so the log said "not written yet" about a file that was right there.
    //
    // ⚠️ Keep the sanitization. Do NOT re-interpolate `err.message`: a realpath failure's message
    // embeds the full resolved path it tried to open, which round 4 deliberately stopped handing
    // back over IPC (see the run.json catch above). `err.code` is a bare symbolic errno with no
    // path in it, and it is the one piece an operator reading the fold warning actually needs —
    // whitelisted to the errno character class so nothing else can ever ride out through here.
    const code = err && typeof err.code === 'string' && /^[A-Z][A-Z0-9_]{1,15}$/.test(err.code)
      ? err.code : 'unknown';
    if (code === 'ENOENT') { return { error: `not written yet: ${name}` }; }
    return { error: `artifact unreadable (${code}): ${name}` };
  }
  if (!isRealpathContained(realDir, realTarget)) {
    return { error: 'artifact escapes run directory' };
  }

  let buf;
  try { buf = fsReal.readFileSync(realTarget); }
  catch { return { error: 'artifact unreadable' }; }
  if (buf.length > MAX_ARTIFACT_BYTES) {
    return { text: truncateUtf8(buf, MAX_ARTIFACT_BYTES).toString('utf-8'), truncated: true };
  }
  return { text: buf.toString('utf-8') };
}

module.exports = {
  artifactAllowlist, isSeatTable, readRunArtifact, isRealpathContained,
  FIXED_ARTIFACTS, DEBATE_ARTIFACTS, MAX_ARTIFACT_BYTES,
};
