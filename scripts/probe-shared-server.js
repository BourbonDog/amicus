#!/usr/bin/env node

/**
 * Wave 3.0 Read D — D1 (Read A's Test R1) and D3 (one observable for Read C).
 *
 * D1. v4.9.8 replaced `config.agent` on the ONE shared engine a council run uses
 * (src/opencode-client.js:678-682, src/council/run-server.js:218-226), creates
 * `<runDir>/_scratch` at run start and queries `app.agents({directory})` for the
 * run dir and for `_scratch` BEFORE Stage 1 (src/council/run-seat-tools-verify.js:42-51,
 * :64-69) — then runs FOUR concurrent judge sessions scoped at `_scratch` on that
 * one engine, with no per-wave fallback server. No run artifact can say whether
 * that construction path can PARK or STARVE a session or ALTER a rendered agent,
 * because every failure would look like the same 480 s silence. This probe
 * measures it: the two per-directory queries against a baseline, then four
 * concurrent sessions against a capture server that answers three and NEVER
 * answers the fourth.
 *
 * Arms: A = the v4.9.8 shape (both pre-queries, sessions in `_scratch`);
 *       B = the pre-queries omitted (the control for the `_scratch` residual);
 *       C = pre-queries done, sessions scoped at `<runDir>` (the two `repair`
 *           kills' configuration — src/council/run-stages.js:196 passes o.runDir).
 * D3 = one `plan` session whose model calls `read` and is then answered with
 *      silence, to time when a tool call becomes a PERSISTED part.
 *
 * Zero spend, no keys: the sandbox, the capture server and the engine-flag
 * discipline all come from scripts/probe-sandbox.js (itself the #218 harness).
 * The provider is a local capture server; nothing paid is reachable.
 *
 * Usage: node scripts/probe-shared-server.js [--out docs/probes/read-D/r1-capture.json]
 *          [--hold-ms 90000] [--arms A,B,C,D3]
 */

'use strict';
const fs = require('fs');
const path = require('path');
const sb = require('./probe-sandbox');
const obs = require('./probe-session-obs');
const { buildCouncilAgents } = require('../src/council/seat-tools');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();

const KIMI = 'moonshotai/kimi-k3';
const BUDGET = '64000'; // .github/amicus-ci-aliases.json :: outputBudget — CI's real reservation
const SESSIONS = 4;     // one judge per bench seat (src/council/run-stage2.js:135-141)
/** src/opencode-client.js:637-646 — amicus registers this on EVERY server it starts. */
const CHAT_AGENT = {
  description: 'Conversational agent — reads are auto-approved, writes and commands require permission',
  mode: 'primary', permission: { edit: 'ask', bash: 'ask', webfetch: 'allow' },
};
const KEEP = ['build', 'chat', 'council-seat', 'council-support', 'plan'];

/** The capture server's behaviour for the arm currently running. */
let policy = { heldMarker: null, holdMs: 90000, mode: 'plain', served: 0 };

function buildConfig(origin, withCouncil) {
  const agent = { chat: CHAT_AGENT, ...(withCouncil ? buildCouncilAgents({ tools: [] }) : {}) };
  return {
    agent,
    provider: { openrouter: { options: { baseURL: `${origin}/api/v1`, apiKey: 'probe-key' }, models: { [KIMI]: {} } } },
  };
}

/**
 * ⚠️ MEASURED 2026-09-17: a session created WITHOUT a title — exactly what
 * src/opencode-client.js:147 does — makes the engine fire a SECOND provider
 * request per leg, a title-generation call, BEFORE the leg's own completion.
 * Read B's probe passed `body: {title}` and so never saw it. It is classified
 * and answered normally here, so the held leg's one unanswered request is its own.
 */
function respond(ctx) {
  const { res, body, capture, sse } = ctx;
  const msgs = (body && body.messages) || [];
  const sys = msgs.filter((m) => m && m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  capture.marker = (JSON.stringify(msgs).match(/PROBE-LEG-\d+/) || [])[0] || null;
  capture.kind = /You are a title generator/.test(sys) ? 'title' : 'main';
  capture.sysChars = sys.length;
  capture.nth = ++policy.served;
  const hold = () => {
    capture.served = 'HELD';
    capture.heldUntil = Date.now() + policy.holdMs;
    setTimeout(() => { try { res.destroy(); } catch { /* already gone */ } }, policy.holdMs);
  };
  if (capture.kind === 'title') { capture.served = 'sse-title'; sse(res, body && body.model); return; }
  if (policy.mode === 'tool') {
    policy.mains = (policy.mains || 0) + 1;
    if (policy.mains === 1) {
      capture.served = 'tool_call';
      sse(res, body && body.model, { toolCall: { name: 'read', args: { filePath: policy.readPath } } });
      return;
    }
    hold(); return;
  }
  if (capture.marker === policy.heldMarker) { hold(); return; }
  capture.served = 'sse';
  sse(res, body && body.model, { finish: 'length' });
}

/** Create + prompt one leg. Mirrors src/headless.js:570 then :768 — create carries no model. */
async function openLeg(client, directory, i, agent, t0) {
  const leg = { i, marker: `PROBE-LEG-${i}`, agent };
  const cs = Date.now();
  try {
    const r = await client.session.create({ query: { directory } });
    leg.createMs = Date.now() - cs;
    leg.createAt = cs - t0;
    leg.sessionId = (r.data && (r.data.id || (r.data.session && r.data.session.id))) || null;
    if (!leg.sessionId) { leg.createError = JSON.stringify(r.error || r).slice(0, 200); return leg; }
  } catch (err) { leg.createMs = Date.now() - cs; leg.createError = err.message; return leg; }
  const ps = Date.now();
  try {
    const r = await client.session.promptAsync({
      path: { id: leg.sessionId }, query: { directory },
      body: {
        model: { providerID: 'openrouter', modelID: KIMI }, agent,
        system: 'You are a council judge. Rank the reviews.',
        parts: [{ type: 'text', text: `${leg.marker}: reply with one word.` }],
      },
    });
    leg.promptMs = Date.now() - ps;
    leg.promptStatus = (r && r.response && r.response.status) || null;
    leg.promptError = r && r.error ? JSON.stringify(r.error).slice(0, 200) : null;
  } catch (err) { leg.promptMs = Date.now() - ps; leg.promptError = err.message; }
  return leg;
}

/** Every POST the capture server saw for this arm, relative to the arm's t0. */
function reqRows(cap, from, t0) {
  return cap.captures.slice(from).filter((c) => c.method === 'POST').map((c) => ({
    at: c.at - t0, nth: c.nth, kind: c.kind, marker: c.marker, served: c.served, sysChars: c.sysChars,
    bodyKeys: Object.keys(c.body || {}).sort(), maxTokens: c.body && c.body.max_tokens,
    toolCount: ((c.body && c.body.tools) || []).length, roles: ((c.body && c.body.messages) || []).map((m) => m.role),
  }));
}

async function runArm(sdk, cap, arm, holdMs) {
  const runDir = path.join(process.cwd(), `run-${arm}`);
  const scratch = path.join(runDir, '_scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = arm === 'C' ? runDir : scratch;
  policy = { heldMarker: `PROBE-LEG-${SESSIONS - 1}`, holdMs, mode: 'plain', served: 0 };
  const startCaptureIdx = cap.captures.length;
  const { server, client } = await sb.startEngine(sdk, buildConfig(cap.origin, true), BUDGET);
  const rec = { arm, runDir, scratch, sessionDirectory: dir, heldMarker: policy.heldMarker, holdMs, queries: {} };
  try {
    rec.queries.T0_baseline_nodir = obs.agentDigest(await obs.agentsFor(client, undefined, KEEP));
    if (arm !== 'B') {
      rec.queries.T1_runDir = obs.agentDigest(await obs.agentsFor(client, runDir, KEEP));
      rec.queries.T2_scratch = obs.agentDigest(await obs.agentsFor(client, scratch, KEEP));
      rec.queries.T3_scratch_again = obs.agentDigest(await obs.agentsFor(client, scratch, KEEP));
    }
    rec.queries.T4_baseline_again = obs.agentDigest(await obs.agentsFor(client, undefined, KEEP));
    rec.queries.T5_sessionDir = obs.agentDigest(await obs.agentsFor(client, dir, KEEP));
    const t0 = Date.now();
    rec.legs = await Promise.all(Array.from({ length: SESSIONS }, (_, i) => openLeg(client, dir, i, 'council-support', t0)));
    rec.timeline = await obs.pollTimeline(client, rec.legs, dir, holdMs + 20000, t0);
    rec.requests = reqRows(cap, startCaptureIdx, t0);
  } finally { try { server.close(); } catch { /* engine gone */ } }
  return rec;
}

async function runD3(sdk, cap, holdMs) {
  const runDir = path.join(process.cwd(), 'run-D3');
  const scratch = path.join(runDir, '_scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const readPath = path.join(scratch, 'notes.txt');
  fs.writeFileSync(readPath, 'line one\nline two\n');
  policy = { heldMarker: null, holdMs, mode: 'tool', served: 0, readPath };
  const startCaptureIdx = cap.captures.length;
  const { server, client } = await sb.startEngine(sdk, buildConfig(cap.origin, false), BUDGET);
  const rec = { arm: 'D3', runDir, scratch, readPath, holdMs };
  try {
    await obs.agentsFor(client, scratch, KEEP);
    const t0 = Date.now();
    const leg = await openLeg(client, scratch, 0, 'plan', t0);
    rec.legs = [leg];
    rec.timeline = await obs.pollTimeline(client, [leg], scratch, holdMs + 20000, t0);
    rec.requests = reqRows(cap, startCaptureIdx, t0);
  } finally { try { server.close(); } catch { /* engine gone */ } }
  return rec;
}

function report(rec) {
  const held = (rec.legs || []).filter((l) => l.marker === rec.heldMarker);
  const lines = [`\n== arm ${rec.arm} — sessions in ${rec.sessionDirectory || rec.scratch}`];
  for (const l of rec.legs || []) {
    lines.push(`  leg ${l.i} ${l.marker} create ${l.createMs}ms @${l.createAt}ms prompt ${l.promptMs}ms `
      + `status=${l.promptStatus} id=${l.sessionId || 'NONE'}`
      + `${l.createError ? ` createError=${l.createError}` : ''}${l.promptError ? ` promptError=${l.promptError}` : ''}`);
  }
  for (const r of rec.requests || []) { lines.push(`  request #${r.nth} @${r.at}ms ${r.kind} marker=${r.marker || '-'} served=${r.served} sys=${r.sysChars} max_tokens=${r.maxTokens} tools=${r.toolCount}`); }
  for (let i = 0; i < (rec.timeline || []).length; i++) {
    for (const row of rec.timeline[i]) {
      lines.push(`  t[${i}] ${row.t}${row.tEnd ? `-${row.tEnd}` : ''}ms n=${row.n} ${row.parts} own=${JSON.stringify(row.own)} mapKeys=${row.mapKeys}`);
    }
  }
  if (held.length) { lines.push(`  held leg: ${held[0].marker}`); }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== sb.INNER);
  const val = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
  const outPath = val('--out', null);
  const holdMs = Number(val('--hold-ms', '90000'));
  const arms = String(val('--arms', 'A,B,C,D3')).split(',').filter(Boolean);
  if (!sb.assertSandboxed()) { process.exit(1); }
  const sdk = await import('@opencode-ai/sdk');
  const engine = sb.engineHeader();
  process.stdout.write(`engine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion}), amicus ${engine.amicus}\n`
    + `binary (PATH scan, not the path the SDK spawned): ${engine.binary}\nhold: ${holdMs}ms  arms: ${arms.join(',')}\n`);
  const cap = await sb.startCapture(respond);
  const results = [];
  for (const arm of arms) {
    const rec = arm === 'D3' ? await runD3(sdk, cap, holdMs) : await runArm(sdk, cap, arm, holdMs);
    results.push(rec);
    process.stdout.write(report(rec) + '\n');
  }
  await cap.close();
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, holdMs, results, captures: cap.captures }, null, 2));
    const digest = { engine, holdMs, results: results.map((r) => ({ ...r, captures: undefined })) };
    fs.writeFileSync(outPath.replace(/(\.json)?$/, '').concat('-digest.json'), JSON.stringify(digest, null, 2));
    process.stdout.write(`\nraw: ${outPath}\ndigest: ${outPath.replace(/(\.json)?$/, '').concat('-digest.json')}\n`);
  }
}

if (process.argv.slice(2).includes(sb.INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(sb.runOuter(__filename, process.argv.slice(2), path.resolve('docs', 'probes', 'read-D', 'r1-capture.json')));
}
