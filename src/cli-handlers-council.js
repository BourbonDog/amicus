// src/cli-handlers-council.js
'use strict';
const fs = require('fs');
const path = require('path');
const { tally } = require('./council/tally');
const { deriveReliability, appendRun, buildStatsDoc } = require('./council/ledger');
const { sumWaveUsage, formatCost } = require('./utils/pricing');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { buildReport } = require('./council/report');
const { validateFindings, buildValidateDoc } = require('./council/findings');
const { buildVerdict, readOverallVerdict, readPriorVerdictSurfaces, writeVerdictAtomic } = require('./council/verdict');
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
  // v4.9 W5.4 gate 2: task-run records never feed it — gated on the RECORD's
  // meta.intent (tally copies meta verbatim from the input, measured).
  if (opts.append !== false && !(record.meta && record.meta.intent === 'task')) {
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
  // v4.9 W8 (ruling V5 / R10): an empty table is ambiguous — a fresh install and a
  // task-only install look the same, because task runs never append a row (the
  // intent gate in runTally above). Say so here rather than let silence imply that
  // no council ever ran. Human render only; --json's doc shape is untouched.
  if (!agg.length) {
    return 'No council runs recorded yet.\n'
      + 'Task runs never write reliability rows; a task-only install has no history here.\n';
  }
  // v4.7 GOA-7 D10: group keys may be executable ids (>16 chars) — size the
  // model column to the longest key; legacy (alias-keyed) groups get a notes
  // marker beside low-N.
  const w = Math.max(16, ...agg.map(a => String(a.model).length));
  return 'model'.padEnd(w) + ' runs  avg-cred  confirm  fact-err  notes\n' +
    agg.map(a => `${String(a.model).padEnd(w)} ${String(a.runs).padStart(4)}  ` +
      `${fmt(a.avgStreetCredPeersOnly)}     ${fmt(a.lifetimeConfirmRate)}    ${fmt(a.lifetimeFactErrorRate)}` +
      `${a.lowN ? '   low-N' : ''}${a.legacy ? '   legacy' : ''}`).join('\n') + '\n';
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
  // R1 (v4.6.3): parseArgs records a valueless trailing -o/--out as boolean
  // true (and --out= as ''). The boolean crashes writeVerdictAtomic mid-write
  // (renameSync TypeError on a non-string path) leaving an orphaned
  // true.tmp-<pid>; the empty string silently falls through to the default
  // path. Name the flag and refuse both — the unknown-flag precedent.
  // R5 (v4.7): a dash-leading value ('-x') is a well-formed string as far as
  // parseArgs is concerned (it normalizes, it does not validate) — refuse it
  // here too, or it resolves straight through to writeVerdictAtomic('-x', ...)
  // and writes a file literally named '-x' in cwd. Same failure class as R1,
  // one form short.
  if (args.out !== undefined && (typeof args.out !== 'string' || args.out === '' || args.out.startsWith('-'))) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: (typeof args.out !== 'string' || args.out === '')
        ? '-o/--out requires a value'
        : `-o/--out cannot start with '-': got '${args.out}'`,
      hint: 'amicus council verdict <tally.json> [--decisions <decisions.json>] [-o|--out <out.json>]' });
  }
  const outPath = args.out || './verdict.json';
  let verdict;
  try {
    // The Stage-5 replacement overwrites the engine's verdict.json, which is
    // one of only two homes of the chair's synthesis (the other is
    // chair-output.md); tally.json carries no copy. Recover it from the RUN
    // folder — the tally's own directory, not `-o` — before rebuilding.
    const runDir = path.dirname(path.resolve(tallyPath));
    const overallVerdict = readOverallVerdict(runDir, record.meta.runId);
    // #87: tally.json carries neither seatLoss nor degrades — recover both from
    // the run folder's verdict the same way the chair line is recovered.
    const prior = readPriorVerdictSurfaces(runDir, record.meta.runId);
    verdict = buildVerdict(record, decisions, { overallVerdict,
      ...(prior.seatLoss ? { seatLoss: prior.seatLoss } : {}),
      ...(prior.degrades ? { degrades: prior.degrades } : {}) });
  }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot build verdict: ${e.message}`,
      hint: 'either tally.json needs meta, findings[], streetCred[], runStats, tierCounts, or decisions.json must be a JSON array of {id, decision, …} objects' });
  }
  writeVerdictAtomic(outPath, verdict);
  if (args.render) {
    // v4.1 §4.5c: refresh report.html next to the decided verdict.
    try {
      const html = buildReport({ verdict }, { format: 'html' });
      fs.writeFileSync(path.join(path.dirname(outPath), 'report.html'), html, { mode: 0o600 });
    } catch (e) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `verdict written but render failed: ${e.message}`,
        hint: 'the verdict.json is valid; re-run `amicus council report <verdict.json> --html` manually' });
    }
  }
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
  if (sub === 'run') { return require('./cli-handlers-council-run').handleCouncilRun(args); }
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
    hint: 'amicus council run|tally|stats|report|validate|verdict|save|list|show' });
}

module.exports = { handleCouncil };
