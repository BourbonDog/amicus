// tests/mcp-verdict-chair-carry.test.js
'use strict';
const { z } = require('zod');
const { handlers } = require('../src/mcp-server');
const { getTools } = require('../src/mcp-tools');

/**
 * MCP half of the Stage-5 chair-verdict defect. `amicus_verdict` had the same
 * `buildVerdict(record, decisions)` shape as the CLI — no `opts` — so the
 * Cowork path (call the tool, write the returned JSON over the engine's
 * verdict.json) destroyed the chair's synthesis exactly like the Bash path.
 *
 * The transport differs: MCP receives `record` as an inline object and has no
 * run-folder path to anchor on, so the chair verdict is an explicit optional
 * input Claude reads from the engine's verdict.json. Omitted → null.
 */

function record() {
  return {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt'], claudeInCouncil: false },
    findings: [{
      id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Confirmed',
      basis: { a: 2, d: 0, n: 0 }, confidence: 'solid', tierOverride: null, adjudications: [],
    }],
    rankings: [], streetCred: [], runStats: [],
    tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 }, judged: true,
  };
}

/** The verdict JSON out of the fenced text result. */
function verdictOf(res) {
  const text = res.content[0].text;
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

test('amicus_verdict carries an explicit overallVerdict into the decided verdict', async () => {
  const res = await handlers.amicus_verdict(
    { record: record(), decisions: [], overallVerdict: 'Fix these first' }, process.cwd());
  expect(verdictOf(res).overallVerdict).toBe('Fix these first');
});

test('amicus_verdict without overallVerdict stays null (skipped chair; nothing invented)', async () => {
  const res = await handlers.amicus_verdict({ record: record(), decisions: [] }, process.cwd());
  expect(verdictOf(res).overallVerdict).toBeNull();
});

test('amicus_verdict with an explicit null overallVerdict stays null', async () => {
  const res = await handlers.amicus_verdict(
    { record: record(), decisions: [], overallVerdict: null }, process.cwd());
  expect(verdictOf(res).overallVerdict).toBeNull();
});

// #87: the same additive-passthrough contract, extended to seatLoss and
// degrades — the two surfaces the Stage-5 rebuild (CLI and MCP alike) was
// silently destroying because tally.json carries neither.
test('#87: amicus_verdict carries seatLoss and degrades through when supplied', async () => {
  const seatLoss = { criticRequested: 'critic-m', criticSeated: false, reason: 'timeout', deadBenchSeats: [] };
  const degrades = [{ kind: 'degrade', channel: 'dead-leg', what: 'w', why: 'y', effect: 'e' }];
  const res = await handlers.amicus_verdict(
    { record: record(), decisions: [], seatLoss, degrades }, process.cwd());
  const v = verdictOf(res);
  expect(v.seatLoss).toEqual(seatLoss);
  expect(v.degrades).toEqual(degrades);
});

test('#87: amicus_verdict without seatLoss/degrades leaves both absent (never fabricated)', async () => {
  const res = await handlers.amicus_verdict({ record: record(), decisions: [] }, process.cwd());
  const v = verdictOf(res);
  expect(v).not.toHaveProperty('seatLoss');
  expect(v).not.toHaveProperty('degrades');
});

// #87 follow-up: degrades lacked `.nullable()`, so the MCP SDK's schema
// validation rejected an explicit `degrades: null` ("Expected array, received
// null") before the handler ever ran — the handler's own guard
// (Array.isArray(input.degrades) && ...) was written to treat null as
// nothing-to-pass but could never see it. This asserts the tool's real Zod
// schema accepts the same explicit-null shape seatLoss already did, then
// drives the handler end-to-end to confirm both keys stay absent.
test('#87: explicit null seatLoss AND degrades is schema-valid and leaves both absent', async () => {
  const tool = getTools().find(t => t.name === 'amicus_verdict');
  const input = { record: record(), decisions: [], seatLoss: null, degrades: null };
  expect(z.object(tool.inputSchema).safeParse(input).success).toBe(true);

  const res = await handlers.amicus_verdict(input, process.cwd());
  const v = verdictOf(res);
  expect(v).not.toHaveProperty('seatLoss');
  expect(v).not.toHaveProperty('degrades');
});

// ── PR #200 tail B1 — the record's `meta.intent` is load-bearing on THIS path ──
//
// MEASURED 2026-08-26, and the reason the tool description now says so out
// loud: `src/mcp-server.js :: amicus_verdict` calls
// `buildVerdict(record, decisions, {overallVerdict, seatLoss?, degrades?})` and
// passes NO `intent`, while `src/council/verdict.js :: buildVerdict` emits the
// key on `(record.meta && record.meta.intent === 'task') || opts.intent ===
// 'task'`. On the MCP transport the SECOND disjunct is dead, so
// `record.meta.intent` is the ONLY carrier of task mode — unlike the CLI, which
// reads three (the record, run.json, and the prior verdict.json:
// `cli-handlers-council.js :: runVerdict`). A caller that trims the record to
// save tokens and drops `meta.intent` therefore silently rebuilds the run on
// the REVIEW scale: `report.js` reads `verdict.intent === 'task' ? … : 'review'`,
// so the rendered heading flips from "Answer summary" back to "Verdict summary".
//
// ── NAMED MUTANT "MCPINTENTCARRIER" ────────────────────────────────────────
// MUTATION: in src/council/verdict.js :: buildVerdict, delete the
// `(record.meta && record.meta.intent === 'task') ||` disjunct, leaving only
// `opts.intent === 'task'` — the exact carrier the MCP path relies on.
// MEASURED 2026-08-26, RED SET 2 of 26, applied and reverted BY HAND (restore
// verified: 26 passed, the pre-mutant baseline). Scope — `npx jest
// tests/mcp-verdict-chair-carry.test.js tests/council/verdict.test.js
// --maxWorkers=2` = 2 suites / 26 tests:
//   mcp-verdict-chair-carry 1 — "a record that KEEPS meta.intent rebuilds on
//     the task scale" (the preserve half below).
//   verdict 1 — "record.meta.intent === 'task' → top-level intent:'task' on the
//     VERDICT document".
// ⚠️ The DROP half below survives it honestly: it asserts an ABSENCE the mutant
// also produces. It is the control, not a second detector — which is precisely
// why the preserve half has to sit beside it.
// ⚠️ RE-RUN, NEVER RENUMBER (house rule, tests/council/chair-packet-seat-mutants.js).
test('a record that KEEPS meta.intent rebuilds on the task scale', async () => {
  const r = record();
  r.meta.intent = 'task';
  const res = await handlers.amicus_verdict({ record: r, decisions: [] }, process.cwd());
  expect(verdictOf(res).intent).toBe('task');
});

test('a hand-trimmed record that DROPS meta.intent loses task mode — nothing else carries it', async () => {
  const r = record();
  r.meta.intent = 'task';
  delete r.meta.intent;
  const res = await handlers.amicus_verdict({ record: r, decisions: [] }, process.cwd());
  expect(verdictOf(res)).not.toHaveProperty('intent');
});

test('amicus_verdict\'s `record` parameter WARNS that meta.intent must survive a hand trim', () => {
  const tool = getTools().find(t => t.name === 'amicus_verdict');
  // Round 3 (C2): the PUBLIC `.description` accessor, not zod-private `_def`.
  // MEASURED on this tree's zod (3.25.76) rather than assumed: the two are
  // `===` the same string here, so the swap is byte-identical today — and it
  // is the documented surface, which is what makes it still true after a zod
  // internals change that `_def` would not survive.
  const describe_ = tool.inputSchema.record.description;
  expect(describe_).toMatch(/meta\.intent/);
  // Says what is lost, not merely that something is: a warning a caller can act
  // on has to name the consequence.
  expect(describe_).toMatch(/trim/i);
  expect(describe_).toMatch(/ANSWER|task/);
});
