#!/usr/bin/env node

/**
 * Wave 3.0 Read B — what leaves the engine for a leg running as `council-support`
 * (v4.9.8+) versus the engine's own `Plan` agent (v4.9.7 and earlier)?
 *
 * The question is H1: an agent whose tool allowlist is `{'*': false}` may send
 * NO `tools` array at all, and OpenRouter routes a request carrying `tools`
 * only to providers that support tool calling — so dropping it would WIDEN the
 * eligible provider pool for many-provider models (glm/deepseek/qwen) while
 * leaving single-vendor models (gpt, gemini) untouched. This probe measures the
 * outbound body under each agent; it does not spend.
 *
 * Zero spend, no keys. The sandbox wrapper and capture server are COPIED from
 * the #218 harness exactly as probe-provider-routing.js (probe 3) copied them:
 * runOuter()/assertSandboxed() from scripts/probe-max-tokens.js:132-219,
 * startCapture() from :282-329 (the OpenAI/OpenRouter half), the engine
 * resolvers from :331-354. `buildKeylessEnv`/`ENGINE_CREDENTIAL_ENV` are
 * imported from scripts/run-integration-keyless.js. Neither probe-max-tokens.js
 * nor probe-provider-routing.js is edited.
 *
 * SAFETY (identical to #218): without `--inner` this file is only an OUTER
 * wrapper — throwaway sandbox home; every provider key, legacy key name and
 * OPENCODE credential/config channel scrubbed; HOME, USERPROFILE, the two XDG
 * dirs and APPDATA repointed inside it; then a re-exec `--inner` under that env.
 * The INNER half refuses to start an engine unless every scrubbed name is
 * undefined, HOME is a probe sandbox and cwd is inside it. `apiKey: 'probe-key'`
 * is defence in depth: the provider points at a local capture server.
 *
 * THE AGENTS ARE AMICUS'S OWN. `buildCouncilAgents()` is imported from
 * src/council/seat-tools.js, so `council-support`/`council-seat` are rendered by
 * the shipping function, not replicated by hand. The `chat` case uses the same
 * literal opencode-client.js:637-646 builds. `plan`/`build` are the engine's.
 *
 * Usage: node scripts/probe-agent-wire.js [--out read-B/wire-capture.json] [--only A1,A4]
 * One line per case: `id — agent — tools: N — tool_choice — system chars`.
 */

'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildCouncilAgents } = require('../src/council/seat-tools');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();
const INNER = '--inner';
const SANDBOX_PREFIX = 'amicus-probe-home-';
const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';
const KIMI = 'moonshotai/kimi-k3';
const QWEN_CI = 'qwen/qwen3.8-27b'; // a real CI bench alias (.github/amicus-ci-aliases.json)
// ---------------------------------------------------------------- sandbox
function runOuter(args) {
  const { buildKeylessEnv } = require('./run-integration-keyless');
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
  try {
    const env = buildKeylessEnv(process.env, sandboxHome);
    const projectDir = path.join(sandboxHome, 'project');
    for (const d of [sandboxHome, env.XDG_DATA_HOME, env.XDG_CONFIG_HOME, env.APPDATA, projectDir]) {
      try { fs.mkdirSync(d, { recursive: true }); } catch { /* best effort */ } }
    delete env[FLAG];
    env.OPENCODE_DISABLE_AUTOUPDATE = '1';
    const innerArgs = [...args];
    const outIdx = innerArgs.indexOf('--out');
    if (outIdx >= 0 && innerArgs[outIdx + 1]) { innerArgs[outIdx + 1] = path.resolve(innerArgs[outIdx + 1]); }
    else { innerArgs.push('--out', path.resolve('read-B', 'wire-capture.json')); }
    const result = spawnSync(process.execPath, [__filename, INNER, ...innerArgs],
      { env, stdio: 'inherit', cwd: projectDir });
    if (result.error) { process.stderr.write(`probe: inner run failed to launch: ${result.error.message}\n`); return 1; }
    return result.status === null ? 1 : result.status;
  } finally { try { fs.rmSync(sandboxHome, { recursive: true, force: true }); } catch { /* temp dir */ } }
}
function assertSandboxed() {
  const { PROVIDER_ENV_MAP, LEGACY_KEY_NAMES } = require('../src/utils/api-key-store');
  const { ENGINE_CREDENTIAL_ENV } = require('./run-integration-keyless');
  const names = [...new Set([...Object.values(PROVIDER_ENV_MAP),
    ...Object.keys(LEGACY_KEY_NAMES), ...ENGINE_CREDENTIAL_ENV])];
  const refuse = (why) => { process.stderr.write(`probe: REFUSING to start an engine — ${why}\n`); return false; };
  const present = names.filter((n) => process.env[n] !== undefined);
  if (present.length > 0) { return refuse(`still defined: ${present.join(',')}`); }
  const home = process.env.HOME || '';
  if (!path.basename(home).startsWith(SANDBOX_PREFIX)) { return refuse(`HOME is not a probe sandbox (${home || '(unset)'})`); }
  if (!(path.resolve(process.cwd()) + path.sep).startsWith(path.resolve(home) + path.sep)) {
    return refuse(`cwd ${process.cwd()} is outside the sandbox home`); }
  process.stdout.write(`sandbox: HOME=${home} cwd=${process.cwd()} keys-absent=${names.join(',')}\n`);
  return true;
}
// ---------------------------------------------------------------- capture server
const DEFAULT_USAGE = { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 };
function sse(res, model) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const base = { id: 'probe', object: 'chat.completion.chunk', created: 0, model };
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] });
  chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: DEFAULT_USAGE });
  res.write('data: [DONE]\n\n');
  res.end();
}
function startCapture() {
  const captures = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = raw;
      try { body = JSON.parse(raw); } catch { /* keep raw text */ }
      const headers = { ...req.headers };
      delete headers.authorization; delete headers['x-api-key'];
      captures.push({ at: Date.now(), method: req.method, url: req.url, headers, body });
      if (req.method === 'POST' && /\/chat\/completions(\?.*)?$/.test(req.url)) { sse(res, body && body.model); return; }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'probe: captured' } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ captures, origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(() => r())) }));
  });
}
// ---------------------------------------------------------------- engine
function resolveEngineBinary() {
  const names = process.platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode'];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) { return p; } } }
  return '(opencode not found on PATH)';
}
function pkgVersion(name) {
  try { return require(`${name}/package.json`).version; } catch { /* exports map may hide it */ }
  const p = path.join(__dirname, '..', 'node_modules', ...name.split('/'), 'package.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).version; } catch { return '?'; }
}
/** opencode-client.js:637-646 — amicus's own `chat` agent, verbatim. */
const CHAT_AGENT = { description: 'Conversational agent — reads are auto-approved, writes and commands require permission',
  mode: 'primary', permission: { edit: 'ask', bash: 'ask', webfetch: 'allow' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---------------------------------------------------------------- cases
// `agents` is the agent map registered in the server config (what
// opencode-client.js's `options.agents` block writes into `config.agent`);
// `agent` is the name promptAsync carries (headless.js:743-744 lowercases it).
const support = () => buildCouncilAgents({ tools: [] });
const CASES = [
  { id: 'A1', what: 'v4.9.8 judge/debate/chair leg — council-support, tools {*: false}',
    agent: 'council-support', agents: support(), model: KIMI },
  { id: 'A2', what: 'v4.9.8 review-mode stage-1 seat — council-seat, no tools opted in',
    agent: 'council-seat', agents: support(), model: KIMI },
  { id: 'A3', what: 'v4.9.8 task-mode stage-1 seat — council-seat, webfetch',
    agent: 'council-seat', agents: buildCouncilAgents({ tools: ['webfetch'] }), model: KIMI },
  { id: 'A4', what: 'v4.9.7 judge leg — the engine\'s own Plan agent (run-launch.js:120 old default)',
    agent: 'plan', agents: null, model: KIMI },
  { id: 'A5', what: 'reference — the engine\'s Build agent (the --agent Build escape hatch)',
    agent: 'build', agents: null, model: KIMI },
  { id: 'A6', what: 'reference — amicus\'s own chat agent (opencode-client.js:637)',
    agent: 'chat', agents: null, chat: true, model: KIMI },
  { id: 'B1', what: 'A1 on a REAL CI bench id (is the tools array model-dependent?)',
    agent: 'council-support', agents: support(), model: QWEN_CI },
  { id: 'B4', what: 'A4 on the same CI bench id', agent: 'plan', agents: null, model: QWEN_CI },
];

function buildConfig(origin, c) {
  const options = { baseURL: `${origin}/api/v1`, apiKey: 'probe-key' };
  const agent = { ...(c.chat ? { chat: CHAT_AGENT } : {}), ...(c.agents || {}) };
  return { ...(Object.keys(agent).length ? { agent } : {}),
    provider: { openrouter: { options, models: { [c.model]: {} } } } };
}

/** Everything about the outbound body except the two big arrays. */
function digestBody(body) {
  if (!body || typeof body !== 'object') { return { bodyKeys: null }; }
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const sys = msgs.filter((m) => m && m.role === 'system');
  const sysText = sys.map((m) => (typeof m.content === 'string' ? m.content
    : JSON.stringify(m.content))).join('\n');
  const tools = Array.isArray(body.tools) ? body.tools : null;
  const options = {};
  for (const [k, v] of Object.entries(body)) {
    if (['messages', 'tools', 'model', 'stream', 'tool_choice'].includes(k)) { continue; }
    options[k] = v;
  }
  return {
    bodyKeys: Object.keys(body).sort(),
    model: body.model ?? null,
    toolsPresent: tools !== null,
    toolCount: tools ? tools.length : 0,
    toolNames: tools ? tools.map((t) => (t && t.function && t.function.name) || t.name || '?') : null,
    toolChoice: Object.prototype.hasOwnProperty.call(body, 'tool_choice') ? body.tool_choice : '(absent)',
    messageRoles: msgs.map((m) => m && m.role),
    systemMessages: sys.length,
    systemChars: sysText.length,
    systemFirstLine: sysText.split('\n')[0].slice(0, 160),
    systemSha1: require('crypto').createHash('sha1').update(sysText).digest('hex'),
    maxTokens: body.max_tokens ?? null,
    otherOptionKeys: Object.keys(options).sort(),
    otherOptions: options,
  };
}

async function runCase(sdk, cap, c) {
  const base = { id: c.id, what: c.what, agent: c.agent, model: c.model,
    registered: c.agents ? Object.keys(c.agents) : [] };
  let server = null;
  const start = cap.captures.length;
  try {
    server = await sdk.createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 60000,
      config: buildConfig(cap.origin, c) });
    const client = sdk.createOpencodeClient({ baseUrl: server.url });
    const created = await client.session.create({ body: { title: `probe ${c.id}` } });
    const sessionId = created.data && created.data.id;
    // headless.js:828-744 shape: a `system` string plus one text part, on the named agent.
    const res = await client.session.promptAsync({ path: { id: sessionId },
      body: { model: { providerID: 'openrouter', modelID: c.model }, agent: c.agent,
        system: 'You are a council judge. Rank the reviews.',
        parts: [{ type: 'text', text: 'ping' }] } });
    const status = (res && res.response && res.response.status) || null;
    const error = res && res.error ? JSON.stringify(res.error).slice(0, 240) : null;
    for (const end = Date.now() + 25000; cap.captures.length === start && Date.now() < end;) { await sleep(100); }
    const wire = cap.captures.slice(start).find((x) => x.method === 'POST') || null;
    const body = wire && typeof wire.body === 'object' ? wire.body : null;
    return { ...base, status, error, wireUrl: wire ? wire.url : null, wireBody: body, ...digestBody(body) };
  } catch (err) {
    return { ...base, threw: true, error: err.message, wireBody: null, ...digestBody(null) };
  } finally {
    if (server) { try { server.close(); } catch { /* engine already gone */ } }
  }
}

/** The agent list the engine renders back, so the config is shown to have landed. */
async function readRenderedAgents(sdk, cap) {
  const server = await sdk.createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 60000,
    config: buildConfig(cap.origin, { model: KIMI, agents: support(), chat: true }) });
  try {
    const client = sdk.createOpencodeClient({ baseUrl: server.url });
    for (let i = 0; i < 60; i++) {
      try {
        const r = await client.app.agents({ query: { directory: process.cwd() } });
        if (r && Array.isArray(r.data)) {
          const keep = ['council-support', 'council-seat', 'plan', 'build', 'chat'];
          return r.data.filter((a) => keep.includes(a.name));
        }
      } catch { /* not up yet */ }
      await sleep(500);
    }
    return null;
  } finally { try { server.close(); } catch { /* gone */ } }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== INNER);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(String(args[onlyIdx + 1] || '').split(',')) : null;
  if (!assertSandboxed()) { process.exit(1); }
  const sdk = await import('@opencode-ai/sdk');
  const engine = { binary: resolveEngineBinary(), packageVersion: pkgVersion('opencode-ai'),
    sdkVersion: pkgVersion('@opencode-ai/sdk'), amicus: require('../package.json').version };
  const cap = await startCapture();
  const results = [];
  for (const c of CASES) {
    if (only && !only.has(c.id)) { continue; }
    results.push(await runCase(sdk, cap, c));
  }
  const rendered = only ? null : await readRenderedAgents(sdk, cap);
  await cap.close();
  process.stdout.write(`\nengine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion})\n`
    + `binary (PATH scan, not the path the SDK spawned): ${engine.binary}\n\n`);
  for (const r of results) {
    process.stdout.write(`${r.id} — agent=${r.agent} — tools: ${r.toolsPresent ? r.toolCount : 'ABSENT'}`
      + ` — tool_choice: ${JSON.stringify(r.toolChoice)} — system: ${r.systemChars} chars`
      + ` — max_tokens: ${r.maxTokens}${r.wireBody ? '' : ` — (no capture: ${r.error || 'none'})`}\n`);
  }
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, cases: results, renderedAgents: rendered,
      captures: cap.captures }, null, 2));
    const ua = (cap.captures.find((x) => x.method === 'POST') || { headers: {} }).headers['user-agent'] || null;
    const digestPath = outPath.replace(/(\.json)?$/, '').concat('-digest.json');
    fs.writeFileSync(digestPath, JSON.stringify({ engine, userAgent: ua, renderedAgents: rendered,
      cases: results.map((r) => { const d = { ...r }; delete d.wireBody; return d; }) }, null, 2));
    process.stdout.write(`raw captures: ${outPath}\ndigest: ${digestPath}\n`);
  }
}

if (process.argv.slice(2).includes(INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(runOuter(process.argv.slice(2)));
}
