// src/cli-handlers-council.js
'use strict';
const fs = require('fs');
const { tally } = require('./council/tally');
const { deriveReliability, appendRun, buildStatsDoc } = require('./council/ledger');
const { sumWaveUsage, formatCost } = require('./utils/pricing');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { buildReport } = require('./council/report');
const { validateFindings, buildValidateDoc } = require('./council/findings');
const { buildVerdict, writeVerdictAtomic } = require('./council/verdict');
const {
  runSave: runCouncilSave,
  runList: runCouncilList,
  runShow: runCouncilShow,
} = require('./council/presets-cli');

function runTally(inputPath, useJson, opts = {}) {
  if (!inputPath) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council tally needs an <input.json> path',
      hint: 'amicus council tally <input.json> [--json] [--no-ledger]' });
  }
  let input;
  try { input = JSON.parse(fs.readFileSync(inputPath, 'utf-8')); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read ${inputPath}: ${e.message}`,
      hint: 'pass a valid tally input JSON file' });
  }
  let record;
  try { record = tally(input); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `malformed tally input: ${e.message}`,
      hint: 'input needs meta.models, findings[], adjudications[], rankings[]' });
  }
  // Auto-append the run to the reliability ledger (consumed by `amicus council
  // stats`). Tally is the council's finalize step, so this is where the row is
  // recorded. Best-effort: a ledger write failure must not fail the tally.
  if (opts.append !== false) {
    try { appendRun(record); }
    catch (e) { process.stderr.write(`Notice: council ledger append failed: ${e.message}\n`); }
  }
  process.stdout.write(useJson ? JSON.stringify(record, null, 2) + '\n' : renderRecord(record));
  return 0;
}

function runStats(useJson) {
  const agg = deriveReliability();
  // v4.0 §7: --json emits the enveloped doc (breaking: was a bare array);
  // human output is unchanged (renderStats still takes the rows).
  process.stdout.write(useJson ? JSON.stringify(buildStatsDoc(agg), null, 2) + '\n' : renderStats(agg));
  return 0;
}

function renderRecord(r) {
  const t = r.tierCounts;
  const cost = sumWaveUsage(r.runStats || []).cost;
  return `Council tally (${r.meta.runId})\n` +
    `  Confirmed ${t.Confirmed}  Contested ${t.Contested}  Singleton ${t.Singleton}  Disputed ${t.Disputed}\n` +
    `  Cost: ${formatCost(cost)}\n`;
}
function renderStats(agg) {
  if (!agg.length) { return 'No council runs recorded yet.\n'; }
  return 'model            runs  avg-cred  confirm  fact-err  notes\n' +
    agg.map(a => `${a.model.padEnd(16)} ${String(a.runs).padStart(4)}  ` +
      `${fmt(a.avgStreetCredPeersOnly)}     ${fmt(a.lifetimeConfirmRate)}    ${fmt(a.lifetimeFactErrorRate)}` +
      `${a.lowN ? '   low-N' : ''}`).join('\n') + '\n';
}
function fmt(v) { return (v === null || v === undefined) ? '  —  ' : v.toFixed(2); }

function runReport(args, useJson) {
  const verdictPath = args._[2];
  if (!verdictPath) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council report needs a <verdict.json> path',
      hint: 'amicus council report <verdict.json> [--wave <wave.json>] [--md|--html]' });
  }
  let verdict;
  try { verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf-8')); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read ${verdictPath}: ${e.message}`,
      hint: 'pass a valid verdict.json (from the council flow / amicus_verdict)' });
  }
  let wave = null;
  if (args.wave) {
    try { wave = JSON.parse(fs.readFileSync(args.wave, 'utf-8')); }
    catch (e) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read --wave ${args.wave}: ${e.message}`,
        hint: 'pass a valid wave.json or omit --wave' });
    }
  }
  let report;
  try { report = buildReport({ verdict, wave }, { format: args.html ? 'html' : 'md' }); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot render report: ${e.message}`,
      hint: 'verdict.json needs findings[], streetCred[], runStats[], tierCounts' });
  }
  process.stdout.write(report.endsWith('\n') ? report : report + '\n');
  return 0;
}

/**
 * `amicus council validate <file>` — thin wrapper over `validateFindings`
 * (src/council/findings.js). Tri-state outcome, distinct from the usual
 * two-state (0/1) CLI convention:
 *   exit 0  ok:true              — findings block is well-formed
 *   exit 2  ok:false             — findings block parsed as a *result*, but
 *                                  validation failed (a distinct, scriptable
 *                                  outcome — mirrors the repo's exit-2
 *                                  "completed-with-failure" convention)
 *   exit 1  BAD_ARGS envelope    — missing/unreadable input file
 */
function runValidate(filePath, useJson) {
  if (!filePath) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council validate needs a <file> path',
      hint: 'amicus council validate <file> [--json]' });
  }
  let text;
  try { text = fs.readFileSync(filePath, 'utf-8'); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read ${filePath}: ${e.message}`,
      hint: 'pass a Stage-1 reviewer output file (prose + trailing ```json findings block)' });
  }
  const result = validateFindings(text);
  process.stdout.write(useJson ? JSON.stringify(buildValidateDoc(result), null, 2) + '\n' : renderValidate(result));
  return result.ok ? 0 : 2;
}

function renderValidate(result) {
  if (result.ok) {
    const hist = {};
    for (const f of result.findings) { hist[f.severity] = (hist[f.severity] || 0) + 1; }
    const parts = Object.keys(hist).map(sev => `${sev} ${hist[sev]}`).join(', ');
    const n = result.findings.length;
    return `OK — ${n} finding${n === 1 ? '' : 's'}${parts ? ` (${parts})` : ''}\n`;
  }
  return 'INVALID\n' + result.errors.map(e => `  ${e.code}: ${e.detail}`).join('\n') + '\n';
}

/**
 * `amicus council verdict <tally.json> --decisions <decisions.json> [-o|--out <out.json>]`
 * Thin wrapper over `buildVerdict` + `writeVerdictAtomic` (src/council/verdict.js).
 * `--decisions` is optional (buildVerdict defaults decisions to []). Writes to
 * `-o`/`--out` (default `./verdict.json`) via the atomic tmp+rename convention.
 */
function runVerdict(args, useJson) {
  const tallyPath = args._[2];
  if (!tallyPath) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council verdict needs a <tally.json> path',
      hint: 'amicus council verdict <tally.json> [--decisions <decisions.json>] [-o|--out <out.json>]' });
  }
  let record;
  try { record = JSON.parse(fs.readFileSync(tallyPath, 'utf-8')); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read ${tallyPath}: ${e.message}`,
      hint: 'pass a valid tally.json (from `amicus council tally` / amicus_council_tally)' });
  }
  let decisions = [];
  const decisionsPath = args.decisions;
  if (decisionsPath) {
    try { decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf-8')); }
    catch (e) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read --decisions ${decisionsPath}: ${e.message}`,
        hint: 'pass a valid decisions.json array or omit --decisions' });
    }
  }
  const outPath = args.out || './verdict.json';
  let verdict;
  try { verdict = buildVerdict(record, decisions); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot build verdict: ${e.message}`,
      hint: 'either tally.json needs meta, findings[], streetCred[], runStats, tierCounts, or decisions.json must be a JSON array of {id, decision, …} objects' });
  }
  writeVerdictAtomic(outPath, verdict);
  process.stdout.write(useJson ? JSON.stringify(verdict, null, 2) + '\n' : renderVerdict(verdict, outPath));
  return 0;
}

function renderVerdict(v, outPath) {
  const counts = {};
  for (const f of v.findings) {
    const key = f.decision || 'undecided';
    counts[key] = (counts[key] || 0) + 1;
  }
  const parts = Object.keys(counts).map(k => `${k} ${counts[k]}`).join('  ');
  return `Verdict (schema v${v.schemaVersion}, ${v.runId}) → ${outPath}\n  ${parts}\n`;
}

/** @param {{_:string[], json?:boolean}} args @returns {Promise<number>} */
async function handleCouncil(args) {
  const sub = args._[1];
  const useJson = !!args.json;
  if (sub === 'tally') { return runTally(args._[2], useJson, { append: !args['no-ledger'] }); }
  if (sub === 'stats') { return runStats(useJson); }
  if (sub === 'report') { return runReport(args, useJson); }
  if (sub === 'validate') { return runValidate(args._[2], useJson); }
  if (sub === 'verdict') { return runVerdict(args, useJson); }
  if (sub === 'save') { return runCouncilSave(args._[2], args.models, useJson); }
  if (sub === 'list') { return runCouncilList(useJson); }
  if (sub === 'show') { return runCouncilShow(args._[2], useJson); }
  return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
    message: `unknown council subcommand '${sub || ''}'`,
    hint: 'amicus council tally|stats|report|validate|verdict|save|list|show' });
}

module.exports = { handleCouncil };
