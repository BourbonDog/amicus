// src/cli-handlers-council.js
'use strict';
const fs = require('fs');
const { tally } = require('./council/tally');
const { deriveReliability } = require('./council/ledger');
const { failJson, ERROR_CODES } = require('./utils/error-doc');

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
  return `Council tally (${r.meta.runId})\n` +
    `  Confirmed ${t.Confirmed}  Contested ${t.Contested}  Singleton ${t.Singleton}  Disputed ${t.Disputed}\n`;
}
function renderStats(agg) {
  if (!agg.length) { return 'No council runs recorded yet.\n'; }
  return 'model            runs  avg-cred  confirm  fact-err  notes\n' +
    agg.map(a => `${a.model.padEnd(16)} ${String(a.runs).padStart(4)}  ` +
      `${fmt(a.avgStreetCredPeersOnly)}     ${fmt(a.lifetimeConfirmRate)}    ${fmt(a.lifetimeFactErrorRate)}` +
      `${a.lowN ? '   low-N' : ''}`).join('\n') + '\n';
}
function fmt(v) { return (v === null || v === undefined) ? '  —  ' : v.toFixed(2); }

/** @param {{_:string[], json?:boolean}} args @returns {Promise<number>} */
async function handleCouncil(args) {
  const sub = args._[1];
  const useJson = !!args.json;
  if (sub === 'tally') { return runTally(args._[2], useJson); }
  if (sub === 'stats') { return runStats(useJson); }
  return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
    message: `unknown council subcommand '${sub || ''}'`, hint: 'amicus council tally|stats' });
}

module.exports = { handleCouncil };
