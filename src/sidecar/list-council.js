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

const { collapseExcerpt } = require('../utils/text-sanitize');

/** The MODEL column's width, shared by the header and every cell. Not exported
 *  — `padModel` is, so the width has exactly one home and THIS module's
 *  `Key Exports` cell does not advertise a constant as a function
 *  (utils/engine-log.js's rule). That rule is a per-module discipline, not
 *  something the generator enforces: `scripts/generate-docs-helpers.js` renders
 *  every export as `name()` repo-wide, and a module with five or fewer exports
 *  cannot hide a constant behind the cap at all — see the floor recorded in
 *  BACKLOG.md, and `utils/untrusted-fence.js :: OUTBOUND_FENCE_TAGS` living in
 *  it. Not exporting one is what a module can still do for itself. */
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
 * ellipsis instead. The chrome is 10 characters (`council(` is 8, `…)` is 2),
 * so `MODEL_COL - 10` would rebuild a cell of exactly MODEL_COL and `padModel`
 * would pad it by nothing — the same butted cell. The stage keeps
 * `MODEL_COL - 11` instead: one character less than fits, which is what buys
 * the space before STATUS. Session and wave
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
 * caller already had — and, since round 3 (B1), SAYS SO. The catch used to be
 * blanket and mute, so a failed lazy require or a pointer that throws inside
 * `listCouncilRuns` dropped EVERY council row while the output looked exactly
 * like a project that has none: a correct-but-silent degrade, which the product
 * principle rejects as hard as a crash. The failure now leaves through
 * `opts.onUnavailable` and read.js prints it.
 *
 * WHY A SINK AND NOT A RETURN SHAPE (the seam, chosen rather than assumed). The
 * merge cannot print — it is a pure row function, and its one consumer owns the
 * two output modes. read.js cannot format either: the notice text belongs beside
 * the rule it restates, which is why `councilScopeNotice` lives here. So this
 * function formats and records. An envelope return (`{rows, failure}`) would
 * rewrite the signature every caller and pin reads, to carry a field that is
 * null on every call that works; an OPTIONAL sink leaves the array return
 * byte-identical, fires at the moment of failure, and parks no state a later
 * call could inherit. The sink is the caller's own function — this module makes
 * no promise about one that throws.
 * @param {object[]} rows - already-sorted, already-status-filtered session rows
 * @param {string} project
 * @param {{status?: string, all?: boolean, onUnavailable?: (note: string) => void}} [opts]
 * @returns {object[]}
 */
function mergeCouncilRows(rows, project, opts = {}) {
  let council;
  try { council = require('../mcp-council-awareness').listCouncilRuns(project); }
  catch (err) {
    if (typeof opts.onUnavailable === 'function') {
      opts.onUnavailable(councilUnavailableNotice(err));
    }
    return rows;
  }
  if (opts.status && opts.status !== 'all') {
    council = council.filter(r => r.status === opts.status);
  }
  if (opts.all) { council = council.map(r => ({ ...r, project })); }
  if (!council.length) { return rows; }
  return rows.concat(council).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * The `--all` scope disclosure, for the human-readable listing.
 *
 * Round 2 (A1): the SCOPE note above documents the limit for a reader of this
 * file, and `--all` stamps every merged row with the project it came from — but
 * neither tells the person at the terminal that the rows they did NOT get were
 * never looked for. A correct-but-silent degrade fails the product principle as
 * hard as a crash (README / BACKLOG.md: self-heal or self-diagnose, ALWAYS
 * transparently), so the runtime says it out loud.
 *
 * The text lives here, beside the scope rule it restates, and read.js prints it
 * — the same split as `list-limit.js :: truncationNotice`, whose notice this
 * one is deliberately shaped like. Unlike that one it names no remedy: there is
 * no flag that widens this, which is the whole disclosure.
 * @returns {string}
 */
function councilScopeNotice() {
  return 'council runs: current project only (no cross-project index).';
}

/**
 * The merge-failed disclosure, for the human-readable listing (round 3, B1).
 *
 * Names the CAUSE, not just the fact: "unavailable" alone would tell the reader
 * their council rows are missing without telling them why, which is half a
 * disclosure. The message is a THIRD PARTY's string — an fs error carries a
 * path, a JSON error carries the bytes it choked on — so it rides the house
 * sanitizer (`utils/text-sanitize.js :: collapseExcerpt`) like every other
 * quoted foreign string in the tree: ANSI and bidi controls dropped, remaining
 * control bytes collapsed to spaces, one line. The cap is 120 rather than that
 * module's 200 default because this is a LISTING line sitting beside 80- and
 * 100-column rules, not an error string standing on its own.
 * @param {Error|*} err whatever the merge's catch caught
 * @returns {string}
 */
function councilUnavailableNotice(err) {
  const raw = (err && err.message) || String(err);
  return `council runs: unavailable (${collapseExcerpt(raw, 120)})`;
}

// `councilUnavailableNotice` is deliberately NOT exported: its one caller is
// `mergeCouncilRows` in this file (hoisted, so the definition may sit below it),
// and the string reaches read.js through the sink rather than through an import.
// The export list stays at four — see the MODEL_COL note above for why the size
// of this list is worth minding at all.
module.exports = { padModel, modelCell, mergeCouncilRows, councilScopeNotice };
