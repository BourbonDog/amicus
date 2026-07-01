// tests/council/ledger.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLedgerRows, appendRun, deriveReliability } = require('../../src/council/ledger');
const { tally } = require('../../src/council/tally');
const avInput = require('./fixtures/av-receiver-input');

const record = tally(avInput);

test('buildLedgerRows computes raw rates and carries role/wasChair/conformance', () => {
  const rows = buildLedgerRows(record);
  const gpt = rows.find(r => r.model === 'gpt');
  expect(gpt.findingsRaised).toBe(12);
  expect(gpt.confirmRate).toBeCloseTo(12 / 12);  // raw, not de-duped; lone-peer agrees now count as Confirmed
  expect(gpt.factErrorRate).toBe(0);
  expect(gpt.bySeverity).toEqual({ blocker: 1, major: 5, minor: 5, nit: 1 });
  const ds = rows.find(r => r.model === 'deepseek');
  expect(ds.wasChair).toBe(true);
  expect(ds.judged).toBe(true);
});

test('judged:false record yields null rates and street-cred', () => {
  const single = { ...record, judged: false,
    streetCred: record.streetCred.map(s => ({ ...s, withSelf: null, peersOnly: null })) };
  const rows = buildLedgerRows(single);
  expect(rows[0].confirmRate).toBeNull();
  expect(rows[0].streetCredPeersOnly).toBeNull();
  expect(rows[0].judged).toBe(false);
});

test('appendRun + deriveReliability round-trip; trailing partial line tolerated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  appendRun(record, { dir });
  appendRun(record, { dir });
  fs.appendFileSync(path.join(dir, 'council-ledger.jsonl'), '{ broken partial');
  const agg = deriveReliability({ dir });
  const gpt = agg.find(a => a.model === 'gpt');
  expect(gpt.runs).toBe(2);
  expect(gpt.lowN).toBe(true);                 // < 3 runs
  expect(gpt.avgStreetCredPeersOnly).toBeCloseTo(1.0);
});

test('peersOnly:null rows are excluded from the average', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const r2 = { ...record, streetCred: record.streetCred.map(s =>
    s.model === 'gpt' ? { ...s, peersOnly: null } : s) };
  appendRun(record, { dir });   // gpt peersOnly 1.0
  appendRun(r2, { dir });       // gpt peersOnly null → ignored
  const gpt = deriveReliability({ dir }).find(a => a.model === 'gpt');
  expect(gpt.avgStreetCredPeersOnly).toBeCloseTo(1.0);
});

test('aggregates rows written under a newer schemaVersion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  appendRun(record, { dir });
  const gptRow = buildLedgerRows(record).find(r => r.model === 'gpt');
  const future = { ...gptRow, schemaVersion: 2 };
  fs.appendFileSync(path.join(dir, 'council-ledger.jsonl'), JSON.stringify(future) + '\n');
  expect(deriveReliability({ dir }).find(a => a.model === 'gpt').runs).toBe(2);
});
