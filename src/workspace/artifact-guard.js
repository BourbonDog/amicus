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
const { isRealpathContained } = require('../utils/path-fence');

const FIXED_ARTIFACTS = Object.freeze(['briefing-stage1.md', 'bundle-stage2.md', 'chair-packet.md', 'chair-output.md', 'tally-input.json']);
// ⚠️ DE-ROT (F28): v4.1's debate stage writes five MORE run-dir artifact kinds the original
// allowlist never named, so the Workspace hard-refused every `--debate` output with
// `artifact not allowed: <name>`. Writers (re-derived v4.8 PR3 — Task 1 moved runRevoteWave):
// tally-provisional.json = src/council/run-debate-stage.js:45; revote-bundle.md =
// run-debate-revote.js:81; debate.json = run-debate.js:221-222; the rebuttal-/revote- pair =
// materializeDebate (run-launch.js:230-240).
// ⚠️ FIVE KINDS, THREE ENTRIES — that is not a miscount (v4.4.1 DOC-7, re-verified). This const
// holds only the three RUN-LEVEL names; the last two of the five, the rebuttal-/revote- pair, are
// appended inside artifactAllowlist below, next to review-/judge-.
const DEBATE_ARTIFACTS = Object.freeze(['tally-provisional.json', 'revote-bundle.md', 'debate.json']);
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
 * @param {object} run parsed run.json (may be partial)
 * @returns {string[]} the allowlist. When two or more DISTINCT bench entries sanitize to the
 *   same artifact name, a non-enumerable-in-spirit (but plain, test-visible) `collisions`
 *   array is attached: `[{sanitized, models: [rawA, rawB, ...]}, ...]`. See the R4
 *   council-review note below for why this is surfaced rather than silently deduped.
 */
function artifactAllowlist(run) {
  const names = [...FIXED_ARTIFACTS];
  const bench = run && Array.isArray(run.bench) ? run.bench : [];
  // ⚠️ DE-ROT (F28): run.json carries a `debate` key ONLY on --debate runs, and it is seeded
  // on the FIRST write (initCouncilRun, src/council/run-state.js:100-103), so this gate is safe
  // and keeps the allowlist tight for the common case.
  const debated = !!(run && run.debate);
  if (debated) { names.push(...DEBATE_ARTIFACTS); }

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): sanitizeName is NOT
  // injective — it maps every character outside [a-zA-Z0-9._-] to '-', so two DISTINCT bench
  // entries ('vendor/a', 'vendor?a') both produce 'vendor-a'. Both models would then request
  // the SAME artifact file, and the renderer's `[data-artifact="..."]` lookup (drillIntoJudge)
  // hands back whichever section matches first — prose silently misattributed to the wrong
  // model. That is a run-integrity defect (this run directory genuinely cannot hold both
  // models' review/judge files under distinct names), not a display quirk, so it must be
  // DETECTED and surfaced, never smoothed away by deduping the resulting name list.
  //
  // A bench with genuinely REPEATED identical entries (['gemini', 'gemini']) is a different,
  // harmless case that must keep collapsing to one set of rows (preserved intent) — collapse
  // those via a Set over the RAW bench values FIRST, so identical entries never even reach
  // the collision check below (only entries that are distinct as raw strings but coincide
  // after sanitizeName count as a collision).
  const uniqueModels = [...new Set(bench)];
  const rawBySanitized = new Map(); // sanitized name -> first raw model seen for it
  const collisionModels = new Map(); // sanitized name -> Set(raw models) once >1 raw maps to it
  for (const m of uniqueModels) {
    const s = sanitizeName(m);
    if (rawBySanitized.has(s)) {
      if (!collisionModels.has(s)) { collisionModels.set(s, new Set([rawBySanitized.get(s)])); }
      collisionModels.get(s).add(m);
    } else {
      rawBySanitized.set(s, m);
    }
  }

  // ⚠️ Task 18 (RN-1): the collision above is a real run-integrity defect — the run directory
  // physically holds ONE file where two models' artifacts should be, and no renderer trick can
  // recover both. What the renderer CAN stop doing is showing model A's prose under model B's
  // name. Deterministic disambiguation: per colliding sanitized name, sort the RAW models
  // (sorting, not insertion order, is what keeps this reproducible across processes/runs); the
  // first (sorted) keeps the bare sanitized name, the rest get `~2`, `~3`, ... The suffixed
  // names deliberately do not exist on disk — the presence manifest (run-detail.js, via
  // fs.statSync over this same allowlist) marks them absent, so the renderer shows the honest
  // "not written yet" empty state for every model but the first, instead of cross-matching.
  const nameFor = new Map(); // raw model -> its (possibly suffixed) sanitized name
  for (const m of uniqueModels) {
    let s = sanitizeName(m);
    const collision = collisionModels.get(s);
    if (collision) {
      const sortedRaw = [...collision].sort();
      const index = sortedRaw.indexOf(m);
      if (index > 0) { s = `${s}~${index + 1}`; }
    }
    nameFor.set(m, s);
  }

  for (const m of uniqueModels) {
    const s = nameFor.get(m);
    names.push(`review-${s}.md`);
    names.push(`judge-${s}.md`);
    // rebuttal-/revote- are listed here under the same BENCH ALIAS through the same (now
    // possibly suffixed) name, so a pair of DISTINCT aliases colliding after sanitizeName is
    // disambiguated the same way review-/judge- are.
    // ⚠️ v4.8 PR3: this no longer matches what the engine WRITES on a bench that repeats an
    // alias. materializeDebate (run-launch.js:234) now names the file from the leg's SEAT when
    // one is bound — run-debate.js:139-140 and run-debate-revote.js:161-163 attach it — so two
    // twins write `rebuttal-<alias>-1.md` / `-2.md` while this loop lists one
    // `rebuttal-<alias>.md` that nobody writes. `review-`/`judge-` above diverge identically —
    // materializeReviews (run-launch.js:207) and run-stage2.js:145 also name from the seat — so
    // on such a bench NEITHER twin's file is on this list and readRunArtifact refuses both. The
    // whole allowlist is rebuilt from `run.seats` in the PR5 Workspace flip (BACKLOG: "Hard
    // prerequisite for PR5"). Every bench with no repeated alias is unaffected — the seat id
    // and the alias are the same string there.
    if (debated) {
      names.push(`rebuttal-${s}.md`);
      names.push(`revote-${s}.md`);
    }
  }
  // `uniqueModels` already collapsed genuinely-repeated bench entries, so this final Set is
  // now just a belt-and-suspenders no-op for names — it can no longer mask a real collision,
  // since that path is detected above from the RAW (pre-sanitize) values instead.
  const list = [...new Set(names)];
  if (collisionModels.size) {
    list.collisions = [...collisionModels.entries()].map(([sanitized, models]) => ({
      sanitized, models: [...models],
    }));
  }
  // Consumed by workspace-panels.js (wireLazyPanels' file lists + drillIntoJudge's artifact
  // lookup), which prefers this map over re-deriving names via sanitizeName(model) directly —
  // that re-derivation is exactly what would ignore the suffixing above and misattribute prose.
  // ⚠️ Fix-wave (review finding 1) residual limit this map cannot close: the BARE (unsuffixed)
  // name is still exactly ONE physical file on disk, and its actual bytes belong to whichever
  // colliding model's writer ran LAST — no map can recover which one that was. The guarantee
  // delivered here is narrower than "attribution is fully sound": at most the sorted-first
  // model can still be misattributed under the bare name; artifactCollisions (the run-integrity
  // banner rendered by workspace-app.js's renderBanners) is what covers that residual case.
  list.artifactsByModel = Object.fromEntries(
    [...nameFor].map(([m, s]) => [m, {
      review: `review-${s}.md`, judge: `judge-${s}.md`,
      rebuttal: `rebuttal-${s}.md`, revote: `revote-${s}.md`,
    }]),
  );
  return list;
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
  artifactAllowlist, readRunArtifact, isRealpathContained,
  FIXED_ARTIFACTS, DEBATE_ARTIFACTS, MAX_ARTIFACT_BYTES,
};
