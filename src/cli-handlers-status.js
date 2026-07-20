/**
 * `amicus status <task_id>` — one-shot human/JSON status for a session or wave.
 * Reads the SAME sources as the MCP amicus_status handler by calling it
 * directly (requiring mcp-server does NOT start the server; the MCP SDK is
 * only loaded inside startMcpServer()). Zero duplicated status logic — this
 * inherits crash detection, wave leg rollup, and P6-3 enrichment for free.
 */

'use strict';

const { validateTaskId } = require('./utils/validators');
const { failJson, ERROR_CODES } = require('./utils/error-doc');

/** Render a key-value block for a single-session status payload. */
function formatRunHuman(d) {
  const lines = [
    `Task:     ${d.taskId}`,
    `Status:   ${d.status}${d.phase ? ` (${d.phase})` : ''}`,
    `Elapsed:  ${d.elapsed}`,
  ];
  if (d.model) { lines.push(`Model:    ${d.model}`); }
  if (d.mode) { lines.push(`Mode:     ${d.mode}`); }
  if (d.messageCount !== undefined) { lines.push(`Messages: ${d.messageCount}`); }
  if (d.lastActivity) { lines.push(`Activity: ${d.lastActivity}`); }
  if (d.latestPreview) { lines.push(`Latest:   ${d.latestPreview}`); }
  else if (d.latest) { lines.push(`Latest:   ${d.latest}`); }
  if (d.stalled) { lines.push(`STALLED:  no activity for ${d.stalledForSeconds}s (see --json for recovery)`); }
  if (d.reason) { lines.push(`Reason:   ${d.reason}`); }
  return lines.join('\n');
}

/** Render a wave payload: header + one line per leg. */
function formatWaveHumanStatus(d) {
  const head = `Wave ${d.taskId}: ${d.status} — ${d.legsComplete}/${d.legsTotal} legs done (${d.elapsed})`;
  const legLines = (d.legs || []).map((l) => {
    const label = String(l.model || l.taskId || '').padEnd(28);
    const st = String(l.status || 'unknown').padEnd(10);
    const msgs = l.messages !== undefined ? `${l.messages} msg` : '';
    const latest = l.latestPreview || l.latestActivity || '';
    const flag = l.stalled ? ' ⏳stalled' : '';
    return `  ${label} ${st} ${msgs} | ${latest}${flag}`;
  });
  return [head, ...legLines].join('\n');
}

/** Render a council-run payload: header + one line per stage. */
function formatCouncilHuman(d) {
  const head = `Council run ${d.runId}: ${d.status}` +
    (d.currentStage ? ` — ${d.currentStage}` : '') +
    (d.legsTotal !== null && d.legsTotal !== undefined ? ` (${d.legsComplete}/${d.legsTotal} legs)` : '') +
    ` (${d.elapsed})`;
  const stageLines = (d.stages || []).map(s =>
    `  ${String(s.name).padEnd(10)} ${String(s.status).padEnd(10)}${s.waveId ? ` wave ${s.waveId}` : ''}`);
  const tail = d.reason ? [`  Reason: ${d.reason}`] : [];
  return [head, ...stageLines, ...tail].join('\n');
}

/**
 * Handle 'amicus status'. Exit code 0 = status retrieved (any run state, even
 * a failed/crashed run — the QUERY succeeded); 1 = missing/invalid/unknown id.
 * @param {object} args parsed CLI args
 * @returns {Promise<number>}
 */
async function handleStatus(args) {
  const useJson = !!args.json;
  const taskId = args.wave || args._[1];
  if (!taskId || taskId === true) {
    // v4.0 §7: --json failures land on stdout as the error doc; human stderr
    // is byte-identical to pre-4.0.
    if (useJson) {
      return failJson(true, { code: ERROR_CODES.BAD_SESSION, message: 'task_id is required for status',
        hint: 'amicus status <task_id> [--json]   (or: amicus status --wave <wave_id>)' });
    }
    process.stderr.write('Error: task_id is required for status\n');
    process.stderr.write('Usage: amicus status <task_id> [--json]   (or: amicus status --wave <wave_id>)\n');
    return 1;
  }
  const check = validateTaskId(String(taskId));
  if (!check.valid) {
    if (useJson) { return failJson(true, { code: ERROR_CODES.BAD_SESSION, message: check.error }); }
    process.stderr.write(`${check.error}\n`);
    return 1;
  }

  const project = args.cwd || process.cwd();
  const { handlers } = require('./mcp-server');
  const result = await handlers.amicus_status({ taskId: String(taskId) }, project);
  const text = result.content[0].text;
  if (result.isError) {
    if (useJson) { return failJson(true, { code: ERROR_CODES.BAD_SESSION, message: text }); }
    process.stderr.write(`${text}\n`);
    return 1;
  }

  let data;
  try { data = JSON.parse(text); } catch { process.stdout.write(`${text}\n`); return 0; }
  delete data.next_poll; // MCP-agent polling guidance, not CLI output

  if (args.json) { process.stdout.write(`${JSON.stringify(data, null, 2)}\n`); return 0; }
  const rendered = data.type === 'wave' ? formatWaveHumanStatus(data)
    : data.type === 'council-run' ? formatCouncilHuman(data)
    : formatRunHuman(data);
  process.stdout.write(`${rendered}\n`);
  return 0;
}

module.exports = { handleStatus, formatRunHuman, formatWaveHumanStatus, formatCouncilHuman };
