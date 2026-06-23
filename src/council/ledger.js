// src/council/ledger.js
'use strict';
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/config');

const LEDGER_SCHEMA_VERSION = 1;
const LEDGER_FILE = 'council-ledger.jsonl';

function countSeverity(findings) {
  const c = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of findings) { if (c[f.severity] !== undefined) { c[f.severity] += 1; } }
  return c;
}

/** One model-level row per council model. Rates are over RAW raised findings. */
function buildLedgerRows(record) {
  const { meta, findings, streetCred, runStats, judged } = record;
  const sc = new Map(streetCred.map(s => [s.model, s]));
  const rs = new Map(runStats.map(r => [r.model, r]));
  return meta.models.map(model => {
    const raised = findings.filter(f => f.raiser === model);
    const s = sc.get(model) || {};
    const r = rs.get(model) || {};
    const denom = raised.length;
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      runId: meta.runId, date: meta.date, runType: meta.runType, model,
      role: r.role || 'council', wasChair: !!r.wasChair, judged: judged === true,
      streetCredWithSelf: judged ? (s.withSelf ?? null) : null,
      streetCredPeersOnly: judged ? (s.peersOnly ?? null) : null,
      findingsRaised: denom,
      bySeverity: countSeverity(raised),
      confirmRate: judged && denom ? raised.filter(f => f.tier === 'Confirmed').length / denom : null,
      factErrorRate: judged && denom ? raised.filter(f => f.tier === 'Disputed').length / denom : null,
      conformance: r.conformance || 'clean',
    };
  });
}

function appendRun(record, opts = {}) {
  const dir = opts.dir || getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LEDGER_FILE);
  const rows = buildLedgerRows(record);
  for (const row of rows) { fs.appendFileSync(file, JSON.stringify(row) + '\n'); }
  return rows;
}

function readRows(dir) {
  const file = path.join(dir, LEDGER_FILE);
  if (!fs.existsSync(file)) { return []; }
  return fs.readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function avg(nums) { return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null; }

/** Aggregate the ledger per model. peersOnly nulls excluded; lowN flags < 3 runs. */
function deriveReliability(opts = {}) {
  const dir = opts.dir || getConfigDir();
  const byModel = new Map();
  for (const row of readRows(dir)) {
    if (!byModel.has(row.model)) { byModel.set(row.model, []); }
    byModel.get(row.model).push(row);
  }
  return [...byModel.entries()].map(([model, rows]) => {
    const peers = rows.map(r => r.streetCredPeersOnly).filter(v => typeof v === 'number');
    const confirms = rows.map(r => r.confirmRate).filter(v => typeof v === 'number');
    const facts = rows.map(r => r.factErrorRate).filter(v => typeof v === 'number');
    const conformance = rows.reduce((acc, r) => { acc[r.conformance] = (acc[r.conformance] || 0) + 1; return acc; }, {});
    return {
      model, runs: rows.length, lowN: rows.length < 3,
      avgStreetCredPeersOnly: avg(peers),
      lifetimeConfirmRate: avg(confirms),
      lifetimeFactErrorRate: avg(facts),
      conformance,
    };
  });
}

module.exports = { buildLedgerRows, appendRun, deriveReliability, LEDGER_FILE, LEDGER_SCHEMA_VERSION };
