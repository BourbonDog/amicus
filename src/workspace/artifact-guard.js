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
const { sanitizeName } = require('../council/run-launch');
const { readPointer } = require('./run-scan');

const FIXED_ARTIFACTS = Object.freeze(['briefing-stage1.md', 'bundle-stage2.md', 'chair-packet.md', 'chair-output.md', 'tally-input.json']);
// ⚠️ DE-ROT (F28): v4.1's debate stage writes five MORE run-dir artifact kinds the original
// allowlist never named, so the Workspace hard-refused every `--debate` output with
// `artifact not allowed: <name>`. Writers: tally-provisional.json = src/council/run.js:199;
// revote-bundle.md = run-debate.js:119; debate.json = run-debate.js:261; the per-seat
// rebuttal-/revote- pair = materializeDebate (run-launch.js:127-136).
const DEBATE_ARTIFACTS = Object.freeze(['tally-provisional.json', 'revote-bundle.md', 'debate.json']);
const MAX_ARTIFACT_BYTES = 200 * 1024;

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

/** @param {object} run parsed run.json (may be partial) */
function artifactAllowlist(run) {
  const names = [...FIXED_ARTIFACTS];
  const bench = run && Array.isArray(run.bench) ? run.bench : [];
  // ⚠️ DE-ROT (F28): run.json carries a `debate` key ONLY on --debate runs, and it is seeded
  // on the FIRST write (src/council/run.js:74-77), so this gate is safe and keeps the
  // allowlist tight for the common case.
  const debated = !!(run && run.debate);
  if (debated) { names.push(...DEBATE_ARTIFACTS); }
  for (const m of bench) {
    names.push(`review-${sanitizeName(m)}.md`);
    names.push(`judge-${sanitizeName(m)}.md`);
    // rebuttal-/revote- are keyed on the same BENCH ALIAS through the same sanitizeName
    // (materializeDebate is called with `d.raiser` / the revote leg's model — both aliases).
    if (debated) {
      names.push(`rebuttal-${sanitizeName(m)}.md`);
      names.push(`revote-${sanitizeName(m)}.md`);
    }
  }
  // Dedup: a bench with repeated entries (or an entry that collides with another after
  // sanitizeName) would otherwise push duplicate review-/judge- rows, and Task 3 builds
  // its artifacts presence map straight off this array.
  return [...new Set(names)];
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
  let run;
  try { run = JSON.parse(fsReal.readFileSync(path.join(ptr.runDir, 'run.json'), 'utf-8')); }
  catch (err) { return { error: `run.json: ${err.message}` }; }

  if (!artifactAllowlist(run).includes(name)) { return { error: `artifact not allowed: ${name}` }; }

  let realDir;
  try { realDir = realpathSync(ptr.runDir); }
  catch (err) { return { error: `run dir unreadable: ${err.message}` }; }
  let realTarget;
  try { realTarget = realpathSync(path.join(ptr.runDir, name)); }
  catch { return { error: `not written yet: ${name}` }; }
  if (realTarget !== realDir && !String(realTarget).startsWith(realDir + path.sep)) {
    return { error: 'artifact escapes run directory' };
  }

  let buf;
  try { buf = fsReal.readFileSync(realTarget); }
  catch (err) { return { error: err.message }; }
  if (buf.length > MAX_ARTIFACT_BYTES) {
    return { text: truncateUtf8(buf, MAX_ARTIFACT_BYTES).toString('utf-8'), truncated: true };
  }
  return { text: buf.toString('utf-8') };
}

module.exports = { artifactAllowlist, readRunArtifact, FIXED_ARTIFACTS, DEBATE_ARTIFACTS, MAX_ARTIFACT_BYTES };
