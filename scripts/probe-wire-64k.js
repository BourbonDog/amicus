#!/usr/bin/env node

/**
 * Wave 3.0 Read D / D2 — Read B's wire table re-captured at CI's REAL output
 * reservation, plus the three server shapes nobody has measured.
 *
 * Read B captured every body at `max_tokens` 32000, the engine's own default.
 * A CI council sends 64000: `.github/amicus-ci-aliases.json` declares
 * `"outputBudget": 64000`, and src/opencode-client.js:867-869 sets
 * OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX to it around the synchronous spawn
 * (src/utils/engine-output-flag.js :: withOutputTokenFlag). Rows C3/K5/K12 of
 * scripts/probe-max-tokens.js measured that a bare `{}` descriptor the ENGINE
 * knows then reserves min(engine ceiling, budget) — this probe re-measures it
 * for the council agents.
 *
 * NEW SHAPES (none previously measured anywhere):
 *   - `plan` on a server with NO council agents registered — the v4.9.7 judge,
 *     but with `chat` registered, which amicus does unconditionally
 *     (src/opencode-client.js:653-657); Read B's A4 registered nothing at all.
 *   - `plan` on a server WITH the council agents registered.
 *   - the DEFAULT agent (promptAsync carries no `agent` at all), both ways.
 *   - `council-support` AFTER the `_scratch` pre-query v4.9.8 performs
 *     (src/council/run-seat-tools-verify.js:42-51, :64-69).
 *
 * ⚠️ Every session here is created the way src/opencode-client.js:147 creates
 * one — no `title` — so the engine's TITLE-GENERATION request fires too. Read B
 * passed `body: {title}` and suppressed it, which is why its table has one row
 * per case and this one has two.
 *
 * Zero spend, no keys: sandbox, capture server and flag discipline all come from
 * scripts/probe-sandbox.js (the #218 harness). The provider is local.
 *
 * Usage: node scripts/probe-wire-64k.js [--out docs/probes/read-D/wire64k.json] [--only D2-4]
 */

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sb = require('./probe-sandbox');
const obs = require('./probe-session-obs');
const { buildCouncilAgents } = require('../src/council/seat-tools');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();

const KIMI = 'moonshotai/kimi-k3';
const QWEN = 'qwen/qwen3.8-27b'; // a real CI bench alias (.github/amicus-ci-aliases.json)
const BUDGET = '64000';
const KEEP = ['build', 'chat', 'council-seat', 'council-support', 'plan'];
/** src/opencode-client.js:637-646 — amicus registers this on EVERY server it starts. */
const CHAT_AGENT = {
  description: 'Conversational agent — reads are auto-approved, writes and commands require permission',
  mode: 'primary', permission: { edit: 'ask', bash: 'ask', webfetch: 'allow' },
};
const V97 = () => ({ chat: CHAT_AGENT });
const V98 = () => ({ chat: CHAT_AGENT, ...buildCouncilAgents({ tools: [] }) });

const CASES = [
  { id: 'D2-1', what: 'v4.9.8 judge leg at CI\'s 64000', agent: 'council-support', agents: V98, model: KIMI },
  { id: 'D2-2', what: 'control — the same leg with NO budget (Read B\'s 32000)', agent: 'council-support', agents: V98, model: KIMI, budget: undefined },
  { id: 'D2-3', what: 'v4.9.7 judge — plan, NO council agents registered', agent: 'plan', agents: V97, model: KIMI },
  { id: 'D2-4', what: 'NEVER MEASURED — plan WITH the council agents registered', agent: 'plan', agents: V98, model: KIMI },
  { id: 'D2-5', what: 'default agent (promptAsync sends none), v4.9.7 server', agent: null, agents: V97, model: KIMI },
  { id: 'D2-6', what: 'default agent, v4.9.8 server', agent: null, agents: V98, model: KIMI },
  { id: 'D2-7', what: 'council-support AFTER the two app.agents pre-queries', agent: 'council-support', agents: V98, model: KIMI, preQuery: true },
  { id: 'D2-8', what: 'council-seat, no tools opted in', agent: 'council-seat', agents: V98, model: KIMI },
  { id: 'D2-9', what: 'D2-1 on a second CI bench id', agent: 'council-support', agents: V98, model: QWEN },
  { id: 'D2-10', what: 'D2-3 on the same second bench id', agent: 'plan', agents: V97, model: QWEN },
];

function buildConfig(origin, c) {
  return {
    agent: c.agents(),
    provider: { openrouter: { options: { baseURL: `${origin}/api/v1`, apiKey: 'probe-key' }, models: { [c.model]: {} } } },
  };
}

/** Everything about one outbound body except the two big arrays. */
function digestBody(body) {
  if (!body || typeof body !== 'object') { return { bodyKeys: null }; }
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const sys = msgs.filter((m) => m && m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const tools = Array.isArray(body.tools) ? body.tools : null;
  const sampling = {};
  for (const [k, v] of Object.entries(body)) {
    if (['messages', 'tools', 'model', 'stream', 'tool_choice', 'max_tokens'].includes(k)) { continue; }
    sampling[k] = v;
  }
  return {
    bodyKeys: Object.keys(body).sort(), model: body.model ?? null,
    maxTokens: body.max_tokens ?? null,
    toolsPresent: tools !== null, toolCount: tools ? tools.length : 0,
    toolNames: tools ? tools.map((t) => (t && t.function && t.function.name) || t.name || '?') : null,
    toolChoice: Object.prototype.hasOwnProperty.call(body, 'tool_choice') ? body.tool_choice : '(absent)',
    messageRoles: msgs.map((m) => m && m.role), systemChars: sys.length,
    systemFirstLine: sys.split('\n')[0].slice(0, 120),
    systemSha1: crypto.createHash('sha1').update(sys).digest('hex'),
    samplingKeys: Object.keys(sampling).sort(), sampling,
  };
}

async function runCase(sdk, cap, c) {
  const budget = Object.prototype.hasOwnProperty.call(c, 'budget') ? c.budget : BUDGET;
  const runDir = path.join(process.cwd(), `wire-${c.id}`);
  const scratch = path.join(runDir, '_scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const base = {
    id: c.id, what: c.what, agent: c.agent, model: c.model, budget: budget ?? null,
    registered: Object.keys(c.agents()), preQuery: !!c.preQuery, directory: scratch,
  };
  const start = cap.captures.length;
  let server = null;
  try {
    const started = await sb.startEngine(sdk, buildConfig(cap.origin, c), budget);
    server = started.server;
    const client = started.client;
    base.renderedBefore = obs.agentDigest(await obs.agentsFor(client, undefined, KEEP));
    if (c.preQuery) {
      base.renderedRunDir = obs.agentDigest(await obs.agentsFor(client, runDir, KEEP));
      base.renderedScratch = obs.agentDigest(await obs.agentsFor(client, scratch, KEEP));
    }
    const created = await client.session.create({ query: { directory: scratch } });
    const sessionId = created.data && (created.data.id || (created.data.session && created.data.session.id));
    const res = await client.session.promptAsync({
      path: { id: sessionId }, query: { directory: scratch },
      body: {
        model: { providerID: 'openrouter', modelID: c.model },
        ...(c.agent ? { agent: c.agent } : {}),
        system: 'You are a council judge. Rank the reviews.',
        parts: [{ type: 'text', text: 'ping' }],
      },
    });
    base.promptStatus = (res && res.response && res.response.status) || null;
    base.promptError = res && res.error ? JSON.stringify(res.error).slice(0, 200) : null;
    const mine = () => cap.captures.slice(start).filter((x) => x.method === 'POST');
    for (const end = Date.now() + 30000; Date.now() < end;) {
      const seen = mine();
      if (seen.some((x) => x.kind === 'main') && seen.some((x) => x.kind === 'title')) { break; }
      await sb.sleep(150);
    }
    const seen = mine();
    const main = seen.find((x) => x.kind === 'main') || null;
    const title = seen.find((x) => x.kind === 'title') || null;
    base.requestOrder = seen.map((x) => x.kind);
    base.main = digestBody(main && main.body);
    base.title = digestBody(title && title.body);
    base.mainBody = main && main.body;
    base.renderedAfter = obs.agentDigest(await obs.agentsFor(client, scratch, KEEP));
    return base;
  } catch (err) {
    return { ...base, threw: true, error: err.message, main: digestBody(null), title: digestBody(null) };
  } finally {
    if (server) { try { server.close(); } catch { /* engine gone */ } }
  }
}

function line(r) {
  const m = r.main || {};
  return `${r.id.padEnd(6)} agent=${String(r.agent || '(default)').padEnd(16)}`
    + ` reg=${r.registered.length === 1 ? 'chat' : 'chat+council'}`
    + ` budget=${r.budget || '(none)'} → max_tokens=${m.maxTokens}`
    + ` tools=${m.toolsPresent ? m.toolCount : 'ABSENT'} tool_choice=${JSON.stringify(m.toolChoice)}`
    + ` sys=${m.systemChars} sampling=${JSON.stringify(m.samplingKeys)}`
    + ` order=${(r.requestOrder || []).join('>')}`;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== sb.INNER);
  const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const outPath = val('--out');
  const only = val('--only') ? new Set(String(val('--only')).split(',')) : null;
  if (!sb.assertSandboxed()) { process.exit(1); }
  const sdk = await import('@opencode-ai/sdk');
  const engine = sb.engineHeader();
  process.stdout.write(`engine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion}), amicus ${engine.amicus}\n`
    + `binary (PATH scan, not the path the SDK spawned): ${engine.binary}\n\n`);
  const cap = await sb.startCapture(({ res, body, capture, sse }) => {
    const msgs = (body && body.messages) || [];
    const sys = msgs.filter((m) => m && m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    capture.kind = /You are a title generator/.test(sys) ? 'title' : 'main';
    sse(res, body && body.model, { finish: 'length' });
  });
  const results = [];
  for (const c of CASES) {
    if (only && !only.has(c.id)) { continue; }
    const r = await runCase(sdk, cap, c);
    results.push(r);
    process.stdout.write(line(r) + '\n');
  }
  await cap.close();
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, cases: results, captures: cap.captures }, null, 2));
    const digestPath = outPath.replace(/(\.json)?$/, '').concat('-digest.json');
    fs.writeFileSync(digestPath, JSON.stringify({
      engine, cases: results.map((r) => { const d = { ...r }; delete d.mainBody; return d; }),
    }, null, 2));
    process.stdout.write(`\nraw: ${outPath}\ndigest: ${digestPath}\n`);
  }
}

if (process.argv.slice(2).includes(sb.INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(sb.runOuter(__filename, process.argv.slice(2), path.resolve('docs', 'probes', 'read-D', 'wire64k.json')));
}
