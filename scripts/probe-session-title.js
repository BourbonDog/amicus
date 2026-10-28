#!/usr/bin/env node

/**
 * #267 — does a titled session stop the engine's hidden title-generation request?
 *
 * Wave 3.0 Read D measured that an UNTITLED `session.create` makes the engine send
 * a second provider request before the leg's own: a title generator carrying the
 * leg's full prompt, sent to a small model, which returns no usage and so never
 * reaches the spend ledger. This probe drives one sandboxed engine in two phases:
 *   A. `amicus` and `amicus-unscoped` — src/opencode-client.js :: createSession,
 *      the call every amicus leg makes, with and without a directory (headless
 *      without --directory and interactive without --cwd use the second shape).
 *      Then it waits PHASE_SETTLE_MS, so a late request still lands in phase A.
 *   B. `untitled` — `client.session.create({query:{directory}})`, the pre-#267
 *      shape: the control.
 *
 * The verdict is judged by the MODEL each chat request goes to, never by the title
 * prompt's wording (#294 council round 2, A1/C1/D1/B2/D5):
 *   - FAIL if any phase-A request goes to a model other than the leg's, or any
 *     amicus session did not send exactly one request: evidence of a leak, so it
 *     holds even when the control is blind;
 *   - BLIND if any untitled session sent no request to another model: the probe
 *     can no longer see the request it exists to count;
 *   - PASS otherwise.
 * Timing: in every capture so far the title request went out BEFORE the leg's own,
 * so SESSION_SETTLE_MS only has to cover ordering jitter. PHASE_SETTLE_MS bounds
 * how late a phase-A leak may arrive and still be caught; a leak later than that
 * would be counted in the control phase. Only POSTs to /chat/completions count.
 *
 * Each request's model, `max_tokens`, system-prompt head and whether that head
 * reads as the title generator go in the digest. It records no request bodies, so
 * its one output is a digest (committed, per .gitignore); the verdict is a pure
 * function, `judge`, pinned by tests/probe-session-title-judge.test.js, and
 * tests/probe-session-title-canary.integration.test.js runs the probe in CI's
 * keyless job.
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

const MODEL = 'qwen/qwen3.8-27b'; // a real CI bench id (.github/amicus-ci-aliases.json)
const SESSION_SETTLE_MS = 3000;
const PHASE_SETTLE_MS = 15000;
const REPO = path.join(__dirname, '..');
const CHAT = /\/chat\/completions(\?.*)?$/;
const isChat = (x) => x.method === 'POST' && CHAT.test(x.url);

/** @returns {string} every system message of a chat-completions body, joined */
function systemText(body) {
  return ((body && body.messages) || []).filter((m) => m && m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
}

/** @returns {{model: string|null, maxTokens: number|null, systemHead: string, titlePrompt: boolean}} */
function describeRequest(capture) {
  const body = capture.body && typeof capture.body === 'object' ? capture.body : {};
  return {
    model: body.model || null,
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? null,
    systemHead: systemText(body).slice(0, 60),
    titlePrompt: /You are a title generator/.test(systemText(body)), // recorded, never judged
  };
}

/**
 * The verdict, from what the capture server saw. A "side" request is any request
 * to a model other than the leg's.
 * @param {{amicus: {requests: object[], threw?: string}[], untitled: {requests: object[], threw?: string}[], phaseA: object[]}} r
 * @returns {{verdict: 'PASS'|'FAIL'|'BLIND', why: string}}
 */
function judge({ amicus, untitled, phaseA }) {
  const isSide = (q) => q.model !== MODEL;
  const bad = amicus.filter((s) => s.threw || s.requests.length !== 1 || isSide(s.requests[0]));
  const stray = phaseA.filter(isSide);
  if (bad.length > 0 || stray.length > 0 || phaseA.length !== amicus.length) {
    return { verdict: 'FAIL', why: `${bad.length} of ${amicus.length} amicus sessions did not send exactly one request to the leg's model; `
      + `phase A saw ${phaseA.length} requests, ${stray.length} to another model` };
  }
  const blind = untitled.filter((s) => s.threw || !s.requests.some(isSide) || !s.requests.some((q) => !isSide(q)));
  if (untitled.length === 0 || blind.length > 0) {
    return { verdict: 'BLIND', why: `${blind.length} of ${untitled.length} untitled sessions sent no request to another model — the probe cannot see what it counts` };
  }
  return { verdict: 'PASS', why: `${untitled.length} of ${untitled.length} untitled sessions sent a request to another model; `
    + `${amicus.length} amicus sessions sent ${phaseA.length} requests, all to the leg's model` };
}

/** @returns {number} the process exit code for a verdict; anything unknown fails */
function exitCode(verdict) {
  return { PASS: 0, FAIL: 1, BLIND: 2 }[verdict] ?? 1;
}

/** @returns {Promise<{requests: object[], threw?: string}>} every chat request in one session's window */
async function runSession(client, cap, create, directory) {
  const start = cap.captures.length;
  const mine = () => cap.captures.slice(start).filter(isChat);
  try {
    const sessionId = await create();
    await client.session.promptAsync({
      path: { id: sessionId }, ...(directory === undefined ? {} : { query: { directory } }),
      body: { model: { providerID: 'openrouter', modelID: MODEL }, parts: [{ type: 'text', text: 'ping' }] },
    });
    let legAt = null;
    for (const end = Date.now() + 30000; Date.now() < end;) {
      if (legAt === null && mine().some((x) => x.body && x.body.model === MODEL)) { legAt = Date.now(); }
      if (legAt !== null && Date.now() - legAt >= SESSION_SETTLE_MS) { break; }
      await sb.sleep(150);
    }
    return { requests: mine().map(describeRequest) };
  } catch (err) {
    return { requests: mine().map(describeRequest), threw: err.message };
  }
}

async function main() {
  require('../src/utils/path-setup').ensureNodeModulesBinInPath();
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
  const cap = await sb.startCapture(({ res, body, sse }) => { sse(res, body && body.model, { finish: 'stop' }); });
  const config = { provider: { openrouter: { options: { baseURL: `${cap.origin}/api/v1`, apiKey: 'probe-key' }, models: { [MODEL]: {} } } } };
  const { server, client } = await sb.startEngine(sdk, config, undefined);
  const dir = process.cwd();
  const arms = [
    ['amicus', (i) => createSession(client, dir, `probe-267-${i}`), dir],
    ['amicus-unscoped', (i) => createSession(client, undefined, `probe-267-u${i}`), undefined],
    ['untitled', async () => {
      const r = await client.session.create({ query: { directory: dir } });
      return r.data && (r.data.id || (r.data.session && r.data.session.id));
    }, dir],
  ];
  const sessions = {};
  let phaseA = [];
  const phaseAStart = cap.captures.length;
  try {
    for (const [arm, create, directory] of arms) {
      if (arm === 'untitled') {
        await sb.sleep(PHASE_SETTLE_MS);
        phaseA = cap.captures.slice(phaseAStart).filter(isChat).map(describeRequest);
      }
      sessions[arm] = [];
      for (let i = 0; i < n; i++) {
        const r = await runSession(client, cap, () => create(i), directory);
        sessions[arm].push(r);
        const models = r.requests.map((q) => q.model).join(' > ') || '(no requests)';
        process.stdout.write(`${arm.padEnd(15)} #${i + 1}: ${models}${r.threw ? ` — THREW ${r.threw}` : ''}\n`);
      }
    }
  } finally {
    try { server.close(); } catch { /* engine gone */ }
    await cap.close();
  }
  const amicus = [...sessions.amicus, ...sessions['amicus-unscoped']];
  const { verdict, why } = judge({ amicus, untitled: sessions.untitled, phaseA });
  process.stdout.write(`\nverdict: ${verdict} — ${why}\n`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      engine, model: MODEL, settle: { sessionMs: SESSION_SETTLE_MS, phaseMs: PHASE_SETTLE_MS },
      verdict, why, phaseA, sessions,
    }, null, 2) + '\n');
    process.stdout.write(`digest: ${outPath}\n`);
  }
  process.exit(exitCode(verdict));
}

module.exports = { judge, exitCode, MODEL };

if (require.main === module) {
  if (process.argv.slice(2).includes(sb.INNER)) {
    main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
  } else {
    process.exit(sb.runOuter(__filename, process.argv.slice(2), path.resolve('docs', 'probes', '267', 'session-title-digest.json')));
  }
}
