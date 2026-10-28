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
 * and counts, per session, the provider requests the capture server saw by kind.
 * The fix holds when every `amicus` session shows `main` only.
 *
 * Zero spend, no keys: sandbox, capture server and engine start all come from
 * scripts/probe-sandbox.js (the #218 harness). The provider is local.
 *
 * It records no request bodies, so its one output is a digest (committed, per .gitignore).
 *
 * Usage: node scripts/probe-session-title.js [--out docs/probes/267/session-title-digest.json] [--n 4]
 */

'use strict';
const fs = require('fs');
const path = require('path');
const sb = require('./probe-sandbox');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();

const MODEL = 'qwen/qwen3.8-27b'; // a real CI bench id (.github/amicus-ci-aliases.json)
const SETTLE_MS = 6000; // after the leg's own request, how long a late title request may take

/** @returns {Promise<{kinds: string[], threw?: string}>} the request kinds one session caused */
async function runSession(client, cap, create) {
  const start = cap.captures.length;
  try {
    const sessionId = await create();
    await client.session.promptAsync({
      path: { id: sessionId }, query: { directory: process.cwd() },
      body: { model: { providerID: 'openrouter', modelID: MODEL }, parts: [{ type: 'text', text: 'ping' }] },
    });
    const mine = () => cap.captures.slice(start).filter((x) => x.method === 'POST');
    let mainAt = null;
    for (const end = Date.now() + 30000; Date.now() < end;) {
      if (mainAt === null && mine().some((x) => x.kind === 'main')) { mainAt = Date.now(); }
      if (mainAt !== null && Date.now() - mainAt >= SETTLE_MS) { break; }
      await sb.sleep(150);
    }
    return { kinds: mine().map((x) => x.kind) };
  } catch (err) {
    return { kinds: [], threw: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== sb.INNER);
  const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const outPath = val('--out');
  const n = Number(val('--n') || 4);
  if (!sb.assertSandboxed()) { process.exit(1); }
  const sdk = await import('@opencode-ai/sdk');
  const { createSession } = require('../src/opencode-client');
  const engine = { ...sb.engineHeader(), declared: require('../package.json').dependencies['opencode-ai'] };
  process.stdout.write(`engine: opencode-ai ${engine.packageVersion} (declared ${engine.declared}, sdk ${engine.sdkVersion}), amicus ${engine.amicus}\n\n`);
  const cap = await sb.startCapture(({ res, body, capture, sse }) => {
    const sys = ((body && body.messages) || []).filter((m) => m && m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    capture.kind = /You are a title generator/.test(sys) ? 'title' : 'main';
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
        process.stdout.write(`${arm.padEnd(9)} #${i + 1}: ${r.threw ? `THREW ${r.threw}` : r.kinds.join(' > ') || '(no requests)'}\n`);
      }
    }
  } finally {
    try { server.close(); } catch { /* engine gone */ }
    await cap.close();
  }
  const count = (arm, kind) => results[arm].reduce((s, r) => s + r.kinds.filter((k) => k === kind).length, 0);
  const summary = Object.fromEntries(Object.keys(arms).map((arm) => [arm, {
    sessions: n, main: count(arm, 'main'), title: count(arm, 'title'),
    threw: results[arm].filter((r) => r.threw).length,
  }]));
  process.stdout.write(`\nsummary: ${JSON.stringify(summary)}\n`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, model: MODEL, settleMs: SETTLE_MS, summary, results }, null, 2) + '\n');
    process.stdout.write(`digest: ${outPath}\n`);
  }
  const ok = summary.amicus.title === 0 && summary.amicus.main === n && summary.amicus.threw === 0;
  process.exit(ok ? 0 : 1);
}

if (process.argv.slice(2).includes(sb.INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(sb.runOuter(__filename, process.argv.slice(2), path.resolve('docs', 'probes', '267', 'session-title-digest.json')));
}
