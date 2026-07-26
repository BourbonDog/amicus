// src/observe/watch-render.js
'use strict';

/**
 * @module observe/watch-render
 * Pure renderers + the poll loop for `amicus watch` (spec 5.1). Renderers are
 * pure functions over the composed live doc (wave-progress.js precedent) so the
 * table adds no testing burden beyond string assertions. The loop reads only
 * the data layer: handlers.amicus_status (Surface C) each interval + the events
 * tail (Surface B) for milestone lines. TTY -> in-place refresh table (ANSI
 * erase-line + cursor-up, NO alternate screen — scrollback preserved);
 * non-TTY/--plain -> milestone log lines; --json -> NDJSON.
 */

const { formatCost } = require('../utils/pricing');
// Single source of truth for "what statuses are terminal" across the
// observability layer (live-doc.js's markLive uses the SAME set to decide
// when to stamp view:'live') — redefining it here would risk the two
// modules drifting, which would make this loop spin forever on a run
// live-doc already considers finished (or exit early on one still running).
const { TERMINAL } = require('./live-doc');
// Single source of truth for the wave status -> exit code mapping (same
// drift risk as TERMINAL above) — mapExitCode's non-passthrough branch
// delegates here instead of hand-rolling the complete/partial/else mapping.
const { waveExitCode } = require('../utils/result-schema');

const DASH = '—';
const legCost = (leg) => (leg.usage && leg.usage.cost ? formatCost(leg.usage.cost) : DASH);
const legTokens = (leg) => (leg.usage && leg.usage.tokens ? `${leg.usage.tokens.input || 0}/${leg.usage.tokens.output || 0}` : DASH);
const truncate = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const STAGE_MARK = { complete: '✓', running: '▶', pending: '·' };

/** The in-place refresh block for a composed wave/council/solo doc. */
function renderTable(doc, width = 100) {
  const cost = doc.usage && doc.usage.cost ? formatCost(doc.usage.cost) : DASH;
  const head = `${doc.taskId || doc.runId}  ${doc.status}  ${doc.elapsed || ''}  ` +
    (typeof doc.legsTotal === 'number' ? `legs ${doc.legsComplete}/${doc.legsTotal}  ` : '') +
    `cost ${cost}`;
  const lines = [head];
  if (Array.isArray(doc.stages)) { // council stage checklist
    lines.push(doc.stages.map((s) => `${STAGE_MARK[s.status] || STAGE_MARK.pending} ${s.name}`).join('  '));
  }
  for (const leg of (doc.legs || [])) {
    const flag = leg.stalled ? ' ⏳stalled' : '';
    lines.push(
      `  ${String(leg.model || leg.taskId).padEnd(26)} ${String(leg.phase || leg.status).padEnd(11)} ` +
      `${String(leg.messages || 0).toString().padStart(3)}msg ${legTokens(leg).padStart(11)} ${legCost(leg).padStart(9)} | ` +
      `${truncate(leg.latestPreview, Math.max(10, width - 70))}${flag}`
    );
  }
  return lines.join('\n');
}

/** Non-TTY / --plain milestone lines + a periodic one-line rollup. */
function renderPlainLines(events, doc) {
  const lines = (events || []).map((e) => {
    switch (e.event) {
      case 'wave-started': return `[wave-started] ${e.id} models=${(e.models || []).join(',')}`;
      case 'leg-started': return `[leg-started] ${e.legId} ${e.model}`;
      case 'leg-fallback': return `[leg-fallback] ${e.legId} ${e.fromModel} -> ${e.toModel} (${e.reason})`;
      case 'leg-terminal': return `[leg-terminal] ${e.legId} ${e.model} ${e.status}`;
      case 'wave-terminal': return `[wave-terminal] ${e.id} ${e.status} exit=${e.exitCode}`;
      case 'run-started': return `[run-started] ${e.id} bench=${(e.bench || []).join(',')}`;
      case 'stage-started': return `[stage-started] ${e.stage}`;
      case 'stage-terminal': return `[stage-terminal] ${e.stage} ${e.status}`;
      case 'run-terminal': return `[run-terminal] ${e.id} ${e.status} exit=${e.exitCode}`;
      default: return `[${e.event}] ${e.id || ''}`;
    }
  });
  if (doc) {
    const cost = doc.usage && doc.usage.cost ? formatCost(doc.usage.cost) : DASH;
    lines.push(`… ${doc.status} ${typeof doc.legsTotal === 'number' ? `${doc.legsComplete}/${doc.legsTotal} legs ` : ''}cost ${cost}`);
  }
  return lines;
}

/** Exit mapping (spec 5.1). Council passes through its recorded exitCode. */
function mapExitCode(doc) {
  if (doc && typeof doc.exitCode === 'number') { return doc.exitCode; }
  if (!doc) { return 1; }
  return waveExitCode(doc.status);
}

/** Stable-stringify diff: emit the composed doc only when it changed. */
function emitJsonChange(doc, prevText) {
  const text = JSON.stringify(doc);
  return text === prevText ? { emit: false } : { emit: true, text };
}

/**
 * The watch poll loop. DI-injected clock/status/tail for testability.
 * @returns {Promise<number>} exit code
 */
async function runWatchLoop(target, args, project, deps = {}) {
  // Pointer-containment fence, defence in depth. cli-handlers-watch.js's
  // resolveWatchTarget already refuses a council pointer whose runDir escapes
  // the project, but this loop is exported, takes `target` from its caller, and
  // opens events.jsonl straight out of target.runDir below — so it re-checks
  // rather than trusting the hand-off. Reuses the shared fence
  // (src/utils/path-fence.js) and reports through the SAME failJson
  // BAD_SESSION envelope handleWatch uses for an unresolvable id, so a --json
  // caller still gets exactly one typed error doc.
  if (target.kind === 'council') {
    const { containsOnDisk } = require('../utils/path-fence');
    if (!containsOnDisk(project, target.runDir)) {
      const { failJson, ERROR_CODES } = require('../utils/error-doc');
      return failJson(!!args.json, {
        code: ERROR_CODES.BAD_SESSION,
        message: `watch: run directory for '${target.id}' resolves outside project ${project}`,
        hint: 'Pass --project if the run was launched elsewhere.',
      });
    }
  }
  const intervalSec = Math.max(0.5, Number(args.interval) || 2);
  const statusFn = deps.statusFn || ((id, p) => require('../mcp-server').handlers.amicus_status({ taskId: id }, p));
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const isTTY = deps.isTTY !== undefined ? deps.isTTY : process.stdout.isTTY;
  const { createEventTail, EVENTS_FILE } = require('./events');
  const { getSessionDir } = require('../session-manager');
  const path = require('path');
  const eventsFile = target.kind === 'council'
    ? path.join(target.runDir, EVENTS_FILE)
    : path.join(getSessionDir(project, target.id), EVENTS_FILE);
  const tail = createEventTail(eventsFile);
  let prevJson = null;
  let prevRollup = null;
  let lastLineCount = 0;

  for (;;) {
    const res = await statusFn(target.id, project);
    let doc;
    try { doc = JSON.parse(res.content[0].text); } catch { doc = null; }
    const events = tail.poll();
    const isTerminal = doc && TERMINAL.has(doc.status);
    if (args.json) {
      for (const e of events) { process.stdout.write(JSON.stringify(e) + '\n'); }
      if (doc) { const c = emitJsonChange(doc, prevJson); if (c.emit) { process.stdout.write(c.text + '\n'); prevJson = c.text; } }
    } else if (isTTY && !args.plain) {
      if (lastLineCount) { process.stdout.write(`\x1b[${lastLineCount}A\x1b[0J`); }
      const block = renderTable(doc || { status: 'unknown', legs: [] }, process.stdout.columns || 100);
      process.stdout.write(block + '\n');
      lastLineCount = block.split('\n').length;
    } else {
      // Milestone event lines: the tail only yields new events, so these are
      // always fresh — print every tick, unthrottled.
      for (const line of renderPlainLines(events, null)) { process.stdout.write(line + '\n'); }
      // Rollup line: change-only (mirrors the --json path above), so a
      // multi-minute --plain watch doesn't spam an identical line every
      // interval. Always printed on the terminal tick so the final state
      // is never silently swallowed.
      if (doc) {
        const rollup = renderPlainLines([], doc)[0];
        if (rollup !== prevRollup || isTerminal) {
          process.stdout.write(rollup + '\n');
          prevRollup = rollup;
        }
      }
    }
    if (isTerminal) {
      if (args.json) { process.stdout.write(JSON.stringify(doc) + '\n'); }
      return mapExitCode(doc);
    }
    await sleep(intervalSec * 1000);
  }
}

module.exports = { renderTable, renderPlainLines, mapExitCode, emitJsonChange, runWatchLoop, DASH };
