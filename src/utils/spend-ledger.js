// src/utils/spend-ledger.js
'use strict';

/**
 * @module spend-ledger
 * Cross-run cost ledger (B24). One JSONL row per completed RUN, appended at
 * the same points the per-run `usage` block is already resolved and written
 * into that run's own `metadata.json` (src/utils/pricing.js resolveUsage):
 * currently `start` (src/sidecar/start.js, mode headless|interactive) and
 * each fanout leg (src/sidecar/fanout-leg.js, mode leg). `continue`/`resume`
 * do NOT currently call resolveUsage at all — no usage block exists at their
 * finalize points to append here either, a pre-existing gap outside this
 * module's scope (see the B24 task report for the inventory).
 * `amicus spend` (src/cli-handlers-spend.js) reads this file to build a
 * cross-run rollup; nothing else consumes it.
 *
 * Precedent: src/council/ledger.js (council-ledger.jsonl). Same tradeoffs:
 *   - plain fs.appendFileSync — a torn/lost row on a hard crash mid-write is
 *     an acceptable loss for a ledger (best-effort spend visibility, not a
 *     billing record of truth — the per-run metadata.json is that).
 *   - corrupt/partial lines are skipped on read, never thrown.
 * Departure from council/ledger.js: appendSpend() itself is wrapped so it
 * NEVER throws — a run's usage must never fail the run it's recording. Every
 * call site is expected to call this fire-and-forget with its own try/catch
 * as a second belt (defense in depth), but the ledger guarantees it too.
 */

const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config');
const { logger } = require('./logger');

const SPEND_LEDGER_SCHEMA_VERSION = 1;
const SPEND_LEDGER_FILE = 'spend-ledger.jsonl';

/**
 * Append one row for a completed run. Best-effort: swallows any failure
 * (unwritable config dir, disk full, etc.) and logs at debug — never throws,
 * never rejects, never blocks/fails the run it's recording. A no-op when
 * `usage` is null (nothing priced to record, e.g. an errored run that never
 * reached resolveUsage).
 *
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} [opts.waveId] present for a fanout leg
 * @param {string} opts.model resolved model id (or alias, if that's all the caller has)
 * @param {'headless'|'interactive'|'leg'} opts.mode
 * @param {{tokens:object, cost:{amount:number|null,currency:string,source:string}}|null} opts.usage
 * @param {string} [opts.op] 'leg' | 'start' | 'continue' | 'resume'
 * @param {string} [opts.status] terminal status
 * @param {string} [opts.councilRunId] council run id (additive attribution)
 * @param {string} [opts.councilName] council name (additive attribution)
 * @param {string} [opts.project] project directory (additive attribution)
 * @param {string} [opts.gateway] resolved gateway ('direct'|'openrouter'|'local', additive attribution)
 * @param {number} [opts.attempt] fallback attempt count (omitted if absent)
 * @param {string} [opts.substitutedFor] substituted model (omitted if absent)
 * @param {string} [opts.retryOfWaveId] wave id being retried (omitted if absent)
 * @param {{dir?:string}} [ctx] test seam — dir overrides getConfigDir()
 */
function appendSpend({ taskId, waveId, model, mode, usage,
  op, status, councilRunId, councilName, project, gateway,
  attempt, substitutedFor, retryOfWaveId }, ctx = {}) {
  if (!usage) { return; }
  try {
    const dir = ctx.dir || getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    const row = {
      schemaVersion: SPEND_LEDGER_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      taskId: taskId || null,
      waveId: waveId || null,
      model: model || null,
      mode: mode || null,
      tokens: usage.tokens || null,
      cost: usage.cost || null,
      // v4.3 additive attribution (spec 7.1). Nullable dimensions default to
      // null (so a row is always groupable); linkage fields are OMITTED unless
      // present (they only exist on fallback/retry rows).
      op: op || null,
      status: status || null,
      councilRunId: councilRunId || null,
      councilName: councilName || null,
      project: project || null,
      gateway: gateway || null,
    };
    if (attempt !== undefined) { row.attempt = attempt; }
    if (substitutedFor !== undefined) { row.substitutedFor = substitutedFor; }
    if (retryOfWaveId !== undefined) { row.retryOfWaveId = retryOfWaveId; }
    fs.appendFileSync(path.join(dir, SPEND_LEDGER_FILE), JSON.stringify(row) + '\n');
  } catch (e) {
    logger.debug('spend-ledger append failed (best-effort, run unaffected)', { taskId, error: e.message });
  }
}

/** @param {string} [dir] @returns {Array<object>} parsed rows; corrupt lines skipped */
function readSpendRows(dir) {
  const file = path.join(dir || getConfigDir(), SPEND_LEDGER_FILE);
  if (!fs.existsSync(file)) { return []; }
  return fs.readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

module.exports = { appendSpend, readSpendRows, SPEND_LEDGER_FILE, SPEND_LEDGER_SCHEMA_VERSION };
