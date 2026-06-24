// src/cli-handlers-council.js
'use strict';
const fs = require('fs');
const { tally } = require('./council/tally');
const { deriveReliability } = require('./council/ledger');
const { sumWaveUsage, formatCost } = require('./utils/pricing');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { buildReport } = require('./council/report');

function runTally(inputPath, useJson) {
  if (!inputPath) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council tally needs an <input.json> path',
      hint: 'amicus council tally <input.json> [--json]' });
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
  process.stdout.write(useJson ? JSON.stringify(record, null, 2) + '\n' : renderRecord(record));
  return 0;
}

function runStats(useJson) {
  const agg = deriveReliability();
  process.stdout.write(useJson ? JSON.stringify(agg, null, 2) + '\n' : renderStats(agg));
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

/** @param {{_:string[], json?:boolean}} args @returns {Promise<number>} */
async function handleCouncil(args) {
  const sub = args._[1];
  const useJson = !!args.json;
  if (sub === 'tally') { return runTally(args._[2], useJson); }
  if (sub === 'stats') { return runStats(useJson); }
  if (sub === 'report') { return runReport(args, useJson); }
  return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
    message: `unknown council subcommand '${sub || ''}'`, hint: 'amicus council tally|stats|report' });
}

module.exports = { handleCouncil };
