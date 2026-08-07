/**
 * @module sidecar/list-search
 * The `--search` core behind both list surfaces (F8 D15, errata E-PR3-5).
 * Split out of read.js (T6 review) to keep that file under its line budget.
 * Re-exported from src/sidecar/read.js, which is what both consumers
 * (mcp-server.js's amicus_list, the CLI's listSidecars) and the tests already
 * require — nothing outside read.js needs to know this file exists.
 */

const fs = require('fs');
const path = require('path');
const { safeSessionDir } = require('../utils/validators');

const COUNCIL_MATERIAL_SEPARATOR = '--- MATERIAL / BRIEFING ---';

// Council row search material (MCP-only): runDir/briefing.md when readable
// (MCP-launched runs write one before the engine spawns), else the portion of
// briefing-stage1.md after the separator (CLI-launched runs have only this),
// else null. Re-derives runDir from the pointer and re-fences it with
// containsOnDisk exactly as mcp-council-awareness.js:214 — never a bare join.
function councilSearchMaterial(project, runId) {
  if (!project) { return null; }
  const { readPointer } = require('../council/run-state');
  const { containsOnDisk } = require('../utils/path-fence');
  const ptr = readPointer(project, runId);
  if (!ptr || !containsOnDisk(project, ptr.runDir)) { return null; }
  try { return fs.readFileSync(path.join(ptr.runDir, 'briefing.md'), 'utf-8'); } catch { /* try stage1 */ }
  try {
    const s1 = fs.readFileSync(path.join(ptr.runDir, 'briefing-stage1.md'), 'utf-8');
    const idx = s1.indexOf(COUNCIL_MATERIAL_SEPARATOR);
    return idx === -1 ? null : s1.slice(idx + COUNCIL_MATERIAL_SEPARATOR.length);
  } catch { return null; }
}

// Wave material: waveDir/briefing.md (full prompt) when readable, else the
// 200-char excerpt already on the row (fanout.js:146). safeSessionDir (not a
// bare path.join) so this gets the same traversal guard every other session
// path read in the codebase gets.
function waveSearchMaterial(project, waveId, excerpt) {
  try { return fs.readFileSync(path.join(safeSessionDir(project, waveId), 'briefing.md'), 'utf-8'); }
  catch { return String(excerpt || ''); }
}

// LEG rows (parentWave set) are id/tag ONLY — briefing embeds the parent's material; matching it would hit every leg N+1 times per wave.
function rowMatchesSearch(row, needle, project) {
  if (String(row.id || '').toLowerCase().includes(needle)) { return true; }
  if (String(row.tag || '').toLowerCase().includes(needle)) { return true; }
  if (row.parentWave) { return false; }
  // --all rows are stamped with their OWN project (enumerateAllProjects,
  // read.js) — a cross-project wave/council row's material lives under THAT
  // project, not the caller's cwd. Using the wrong one doesn't throw; it
  // silently falls back to the low-fidelity excerpt/id-tag match instead of
  // the full text, which is worse than a crash because nothing signals it.
  const proj = row.project || project;
  const material = row.type === 'council-run' ? councilSearchMaterial(proj, row.id)
    : row.type === 'wave' ? waveSearchMaterial(proj, row.id, row.briefing) : row.briefing;
  return String(material || '').toLowerCase().includes(needle);
}

// Case-insensitive substring filter behind both list surfaces (CLI `amicus list
// --search`, MCP `amicus_list {search}` — F8 D15, errata E-PR3-5), mirroring
// the models.js:70-73 idiom. Missing material never throws — it degrades to
// an id/tag-only match (read.js:58 idiom).
function searchSessions(rows, q, ctx) {
  const needle = String(q).toLowerCase();
  return rows.filter(row => rowMatchesSearch(row, needle, ctx && ctx.project));
}

module.exports = { searchSessions };
