#!/usr/bin/env node

/**
 * #267 — does a titled session stop the engine's hidden title-generation request?
 *
 * Wave 3.0 Read D measured that an UNTITLED `session.create` makes the engine send
 * a second provider request before the leg's own: a title generator carrying the
 * leg's full prompt, which returns no usage and so never reaches the spend ledger
 * (scripts/probe-wire-64k.js records it as `title`). This probe runs two arms on
 * one sandboxed engine, the same prompt each time:
 *   - `untitled` — `client.session.create({query:{directory}})`, the pre-#267 shape
 *   - `amicus`   — src/opencode-client.js :: createSession(client, directory, taskId),
 *                  the call every amicus leg now makes
 * and records, per session, every provider request the capture server saw.
 *
 * The verdict rests on COUNTS, not on recognising the title prompt (#294 council
 * round 1, A4/B1/D3):
 *   - the control must hold: every `untitled` session sent more than one request,
 *     at least one of them recognised as `title`. If not, the probe can no longer
 *     see the request it exists to count, and says so (`verdict: BLIND`);
 *   - the fix must hold: every `amicus` session sent exactly one request.
 * Each request's model, `max_tokens` and the head of its system prompt go in the
 * digest, so the classification can be re-checked without the raw capture. It
 * records no request bodies, so its one output is a digest (committed, per
 * .gitignore). tests/probe-session-title-canary.integration.test.js runs it in
 * CI's keyless job.
 *
 * Zero spend, no keys: sandbox, capture server and engine start all come from
 * scripts/probe-sandbox.js (the #218 harness). The provider is local.
 *
 * Usage: node scripts/probe-session-title.js [--out docs/probes/267/session-title-digest.json] [--n 4]
 * Exit: 0 PASS, 1 FAIL (an amicus session sent a hidden request), 2 BLIND.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const sb = require('./probe-sandbox');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();

const MODEL = 'qwen/qwen3.8-27b'; // a real CI bench id (.github/amicus-ci-aliases.json)
const SETTLE_MS = 6000; // after the leg's own request, how long a late title request may take
const REPO = path.join(__dirname, '..');

/** @returns {string} every system message of a chat-completions body, joined */
function systemText(body) {
  return ((body && body.messages) || []).filter((m) => m && m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
}

/** @returns {{kind: string, model: string|null, maxTokens: number|null, systemHead: string}} */
function describeRequest(capture) {
  const body = capture.body && typeof capture.body === 'object' ? capture.body : {};
  return {
    kind: capture.kind, model: body.model || null,
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? null,
    systemHead: systemText(body).slice(0, 60),
  };
}

/** @returns {Promise<{requests: object[], threw?: string}>} every request one session caused */
async function runSession(client, cap, create) {
  const start = cap.captures.length;
  const mine = () => cap.captures.slice(start).filter((x) => x.method === 'POST');
  try {
    const sessionId = await create();
    await client.session.promptAsync({
      path: { id: sessionId }, query: { directory: process.cwd() },
      body: { model: { providerID: 'openrouter', modelID: MODEL }, parts: [{ type: 'text', text: 'ping' }] },
    });
    let mainAt = null;
    for (const end = Date.now() + 30000; Date.now() < end;) {
      if (mainAt === null && mine().some((x) => x.kind === 'main')) { mainAt = Date.now(); }
      if (mainAt !== null && Date.now() - mainAt >= SETTLE_MS) { break; }
      await sb.sleep(150);
    }
    return { requests: mine().map(describeRequest) };
  } catch (err) {
    return { requests: mine().map(describeRequest), threw: err.message };
  }
}

/** @returns {{verdict: 'PASS'|'FAIL'|'BLIND', why: string}} */
function judge(results, n) {
  const blind = results.untitled.filter((r) => r.threw || r.requests.length < 2
    || !r.requests.some((q) => q.kind === 'title'));
  if (blind.length > 0) {
    return { verdict: 'BLIND', why: `${blind.length} of ${n} untitled sessions showed no title request — the probe cannot see what it counts` };
  }
  const leaked = results.amicus.filter((r) => r.threw || r.requests.length !== 1);
  if (leaked.length > 0) {
    return { verdict: 'FAIL', why: `${leaked.length} of ${n} amicus sessions did not send exactly one request` };
  }
  return { verdict: 'PASS', why: `${n} of ${n} untitled sessions sent a title request; ${n} of ${n} amicus sessions sent one request each` };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== sb.INNER);
  const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const outPath = val('--out');
  const n = Number(val('--n') || 4);
  if (!sb.assertSandboxed()) { process.exit(1); }
  const sdk = await import('@opencode-ai/sdk');
  const { createSession } = require('../src/opencode-client');
  const header = sb.engineHeader();
  const engine = {
    ...header, binary: path.relative(REPO, header.binary).split(path.sep).join('/'),
    declared: require('../package.json').dependencies['opencode-ai'], platform: process.platform,
  };
  process.stdout.write(`engine: opencode-ai ${engine.packageVersion} (declared ${engine.declared}, sdk ${engine.sdkVersion}), amicus ${engine.amicus}, ${engine.platform}\n\n`);
  const cap = await sb.startCapture(({ res, body, capture, sse }) => {
    capture.kind = /You are a title generator/.test(systemText(body)) ? 'title' : 'main';
    sse(res, body && body.model, { finish: 'stop' });
  });
  const config = { provider: { openrouter: { options: { baseURL: `${cap.origin}/api/v1`, apiKey: 'probe-key' }, models: { [MODEL]: {} } } } };
  const { server, client } = await sb.startEngine(sdk, config, undefined);
  const dir = process.cwd();
  const arms = {
    untitled: async () => {
      const r = await client.session.create({ query: { directory: dir } });
      return r.data && (r.data.id || (r.data.session && r.data.session.id));
    },
    amicus: (i) => createSession(client, dir, `probe-267-${i}`),
  };
  const results = {};
  try {
    for (const [arm, create] of Object.entries(arms)) {
      results[arm] = [];
      for (let i = 0; i < n; i++) {
        const r = await runSession(client, cap, () => create(i));
        results[arm].push(r);
        const kinds = r.requests.map((q) => q.kind).join(' > ') || '(no requests)';
        process.stdout.write(`${arm.padEnd(9)} #${i + 1}: ${kinds}${r.threw ? ` — THREW ${r.threw}` : ''}\n`);
      }
    }
  } finally {
    try { server.close(); } catch { /* engine gone */ }
    await cap.close();
  }
  const count = (arm, kind) => results[arm].reduce((s, r) => s + r.requests.filter((q) => !kind || q.kind === kind).length, 0);
  const summary = Object.fromEntries(Object.keys(arms).map((arm) => [arm, {
    sessions: n, requests: count(arm), title: count(arm, 'title'), main: count(arm, 'main'),
    threw: results[arm].filter((r) => r.threw).length,
  }]));
  const { verdict, why } = judge(results, n);
  process.stdout.write(`\nsummary: ${JSON.stringify(summary)}\nverdict: ${verdict} — ${why}\n`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, model: MODEL, settleMs: SETTLE_MS, verdict, why, summary, results }, null, 2) + '\n');
    process.stdout.write(`digest: ${outPath}\n`);
  }
  process.exit({ PASS: 0, FAIL: 1, BLIND: 2 }[verdict]);
}

if (process.argv.slice(2).includes(sb.INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(sb.runOuter(__filename, process.argv.slice(2), path.resolve('docs', 'probes', '267', 'session-title-digest.json')));
}
