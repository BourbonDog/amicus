/**
 * @module sidecar/list-council
 * Council rows on the CLI `amicus list` surface (v4.9 W12).
 *
 * `amicus_list` has merged council runs since v4.0 §8 (src/mcp-server.js ::
 * amicus_list); the CLI never did, so a council run launched from the terminal
 * was invisible to the terminal — `amicus list` reported "No amicus sessions
 * found." in a project whose only work was a council. `listCouncilRuns`
 * (src/mcp-council-awareness.js :: listCouncilRuns) has no MCP-specific
 * coupling, so this is the SAME merge on the other surface, not a second
 * enumeration.
 *
 * Split out of read.js for the same reason list-search.js and list-limit.js
 * were: that file is at its line budget, and read.js re-exports nothing from
 * here — it is the only consumer.
 */

'use strict';

/** The MODEL column's width, shared by the header and every cell. Not exported
 *  — `padModel` is, so the width has exactly one home and a `Key Exports` cell
 *  never advertises a constant as a function (utils/engine-log.js's rule). */
const MODEL_COL = 23;

/** One MODEL column: the header word or a rendered cell, padded to the width. */
function padModel(text) {
  return String(text).padEnd(MODEL_COL);
}

/**
 * The MODEL cell for one row.
 *
 * A council run has no model of its own — the seats do — so the cell carries
 * the live STAGE instead, mirroring the wave row's `wave(N legs)` (kickoff
 * ruling). A TERMINAL run has no running stage at all, and rather than invent a
 * word for that the cell is a bare `council`: the STATUS column beside it
 * already says how the run ended.
 *
 * The council cell OWNS its width (the other kickoff ruling). `debate-defense`
 * is the longest stage that is ever checkpointed running
 * (src/council/run-debate-stage.js :: runDebateStage), and
 * `council(debate-defense)` is 23
 * characters — exactly the column, which would leave the STATUS cell butted
 * against it. Anything that long loses the tail of the stage name to an
 * ellipsis instead, keeping the ) and one space: `council(` + `…)` is 10
 * characters of chrome, so the stage keeps `MODEL_COL - 11`. Session and wave
 * rows are deliberately NOT capped — a long model id overflows the column today
 * and this merge is not the place to change what a review row prints.
 */
function modelCell(row) {
  if (row.type === 'wave') { return `wave(${row.legCount ?? 0} legs)`; }
  if (row.type !== 'council-run') { return row.model || ''; }
  if (!row.stage) { return 'council'; }
  const label = `council(${row.stage})`;
  return label.length < MODEL_COL ? label : `council(${row.stage.slice(0, MODEL_COL - 11)}…)`;
}

/**
 * `rows` with this project's council runs merged in, newest-first.
 *
 * THE ORDERING STORY (measured, not assumed). Both CLI enumerators already sort
 * newest-first by `createdAt` with this exact comparator (read.js's
 * `enumerateSessions` and `enumerateAllProjects`), so re-sorting the
 * concatenation cannot reorder the session rows among themselves —
 * `Array.prototype.sort` is stable, and a stable sort over an already-sorted
 * array is the identity. Council rows join that one order, and on an exact
 * `createdAt` tie the session row stays ahead of the council row because it was
 * concatenated first. Same shape as amicus_list's own merge.
 *
 * The status filter is applied HERE rather than by the caller because the
 * session rows arrive already filtered (both enumerators take `status`), and
 * one filter over the merged array would run it twice.
 *
 * SCOPE, stated rather than silent: only THIS project's council runs are
 * merged, `--all` included — council runs are found through per-project pointer
 * files (src/council/run-state.js :: listPointers) and there is no
 * cross-project council
 * index to walk. Under `--all` the rows are stamped with the project they were
 * actually read from, so the PROJECT column tells the truth about every row it
 * prints.
 *
 * Never throws: a listing that cannot be built degrades to the session rows the
 * caller already had, which is exactly today's output.
 * @param {object[]} rows - already-sorted, already-status-filtered session rows
 * @param {string} project
 * @param {{status?: string, all?: boolean}} [opts]
 * @returns {object[]}
 */
function mergeCouncilRows(rows, project, opts = {}) {
  let council;
  try { council = require('../mcp-council-awareness').listCouncilRuns(project); }
  catch { return rows; }
  if (opts.status && opts.status !== 'all') {
    council = council.filter(r => r.status === opts.status);
  }
  if (opts.all) { council = council.map(r => ({ ...r, project })); }
  if (!council.length) { return rows; }
  return rows.concat(council).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { padModel, modelCell, mergeCouncilRows };
