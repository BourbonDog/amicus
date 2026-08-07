// src/council/ledger.js
'use strict';
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/config');

const LEDGER_SCHEMA_VERSION = 1;
const LEDGER_FILE = 'council-ledger.jsonl';

// v4.7 D4/E1/E2 (Task-7, task-6 adjudication): fail-closed ALLOWLIST of
// runStats roles the ledger join (below) may consume as a model's ledger
// identity. 'council' is the legacy default role (pre-#83 runs, and the
// av-receiver golden fixture — errata E2, must stay green). 'judge' stays
// excluded (#83's overwrite-guard: judges ARE bench models, and their Stage-2
// cost-attribution row must never win over the seat row). Every OTHER
// non-primary row-per-launch producer — 'chair-attempt', 'repair',
// 'superseded', and the debate pair 'rebuttal'/'revote' — shares a model with
// that model's real bench row and must never join either: skipped by
// omission, including any future role never added here (fail-closed, not a
// skip-list that a new producer could silently slip past).
const LEDGER_JOIN_ROLES = new Set(['seat', 'critic', 'chair', 'claude', 'council']);
function joinsLedger(role) {
  return LEDGER_JOIN_ROLES.has(role) || (typeof role === 'string' && role.startsWith('lens:'));
}

function countSeverity(findings) {
  const c = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of findings) { if (c[f.severity] !== undefined) { c[f.severity] += 1; } }
  return c;
}

/** One model-level row per council model. Rates are over RAW raised findings. */
function buildLedgerRows(record) {
  const { meta, findings, streetCred, runStats, judged } = record;
  const sc = new Map(streetCred.map(s => [s.model, s]));
  // The join below is keyed by MODEL — only allowlisted roles (joinsLedger,
  // above) may win it, so a non-primary row-per-launch row can never
  // silently overwrite a model's real bench (seat) row.
  const rs = new Map(runStats.filter(r => joinsLedger(r.role))
    .map(r => [r.model, r]));
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

/**
 * v4.0 §7: wrap the deriveReliability() rows in the council v2 envelope —
 * THE one sanctioned breaking shape change (`council stats --json` used to
 * emit the bare array). Human rendering keeps consuming the bare rows.
 * @param {Array<object>} models deriveReliability() output
 * @returns {{schemaVersion: number, type: 'council-stats', models: Array<object>}}
 */
function buildStatsDoc(models) {
  const { COUNCIL_SCHEMA_VERSION } = require('./tally');
  return { schemaVersion: COUNCIL_SCHEMA_VERSION, type: 'council-stats', models };
}

module.exports = { buildLedgerRows, appendRun, deriveReliability, buildStatsDoc, LEDGER_FILE, LEDGER_SCHEMA_VERSION };
