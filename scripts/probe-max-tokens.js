#!/usr/bin/env node

/**
 * Wire probe for issue #218: what max_tokens / reasoning / thinking does the
 * PINNED opencode engine actually put on the outbound provider request?
 *
 * Zero spend, no keys. A local capture server plays the provider: the real
 * `openrouter` provider is pointed at it through provider.openrouter.options.baseURL
 * (so the bundled @openrouter/ai-sdk-provider builds the request), the direct
 * `anthropic` provider the same way, and a custom openai-compatible block plays
 * "a model the engine has never heard of". Every request body is captured; the
 * server answers chat completions with an SSE stream whose finish_reason is
 * "length" (so the engine's assistant message records finish) and refuses
 * everything else with a 400 (the body was already captured).
 *
 * SAFETY: the probe spawns a REAL engine, so it never runs in the ambient
 * environment. Invoked without `--inner` it is only an OUTER wrapper: it makes a
 * fresh temp sandbox home, builds a credential-free env with the same
 * `buildKeylessEnv()` the keyless integration rail uses (every PROVIDER_ENV_MAP
 * and legacy key deleted, AMICUS_ENV_DIR/AMICUS_CONFIG_DIR deleted,
 * HOME/USERPROFILE/XDG_DATA_HOME/XDG_CONFIG_HOME/APPDATA repointed inside the
 * sandbox), and re-execs itself with `--inner` under that env. The INNER run
 * re-asserts that every provider key name is undefined and exits 1 BEFORE
 * starting an engine if any survived. The `apiKey: 'probe-key'` in every
 * provider block is defence in depth; the scrubbed env is the safety property.
 *
 * Usage:
 *   node scripts/probe-max-tokens.js [--out output/218-probe.json] [--only A,B,F1]
 *
 * Re-run after every engine bump: OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX is an
 * experimental flag, and the effort table changed between 1.2.20 and 1.18.15.
 * The header line names the engine version and binary that served the run.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ensureNodeModulesBinInPath } = require('../src/utils/path-setup');
ensureNodeModulesBinInPath();

const KIMI = 'moonshotai/kimi-k3';   // models.dev: effort low|high|max, ceiling 943718
const QWEN = 'qwen/qwen3.8-max';      // models.dev: effort minimal..xhigh, ceiling 131072
const HAIKU = 'claude-haiku-4-5';     // models.dev: budget_tokens (min 1024), ceiling 64000
const OR = (id) => ({ providerID: 'openrouter', modelID: id });
const AN = (id) => ({ providerID: 'anthropic', modelID: id });
const CUSTOM = { providerID: 'probe', modelID: 'unknown-model' };

const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';
const INNER = '--inner';

// ---------------------------------------------------------------- credential sandbox
/**
 * OUTER half: re-exec this file with `--inner` under a credential-free env
 * rooted at a throwaway home directory. Never starts an engine itself.
 * @param {string[]} args the original argv tail (forwarded verbatim)
 * @returns {number} the inner run's exit code
 */
function runOuter(args) {
  const { buildKeylessEnv } = require('./run-integration-keyless');
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-probe-home-'));
  try {
    const env = buildKeylessEnv(process.env, sandboxHome);
    // The three sandbox-rooted dirs are read back OUT of the env buildKeylessEnv
    // produced rather than re-derived, so they can never drift from it. On
    // Windows a missing %APPDATA% is a hard crash for spawned GUI children.
    for (const dir of [sandboxHome, env.XDG_DATA_HOME, env.XDG_CONFIG_HOME, env.APPDATA]) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
    // A baseline measurement: the flag must come from the case matrix, never
    // from the developer's shell. Autoupdate off keeps the pin the pin.
    delete env[FLAG];
    env.OPENCODE_DISABLE_AUTOUPDATE = '1';

    const result = spawnSync(process.execPath, [__filename, INNER, ...args], {
      env,
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    if (result.error) {
      process.stderr.write(`probe: failed to launch inner run: ${result.error.message}\n`);
      return 1;
    }
    return result.status === null ? 1 : result.status;
  } finally {
    try { fs.rmSync(sandboxHome, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}

/**
 * INNER half's gate: every provider key name must be undefined before an engine
 * is allowed to start. Prints the sandbox line the run is judged on.
 * @returns {boolean} true when it is safe to proceed
 */
function assertSandboxed() {
  const { PROVIDER_ENV_MAP } = require('../src/utils/api-key-store');
  const names = Object.values(PROVIDER_ENV_MAP);
  const present = names.filter((n) => process.env[n] !== undefined);
  if (present.length > 0) {
    process.stderr.write(`probe: REFUSING to start an engine — still defined: ${present.join(',')}\n`);
    return false;
  }
  process.stdout.write(`sandbox: HOME=${process.env.HOME} keys-absent=${names.join(',')}\n`);
  return true;
}

// ---------------------------------------------------------------- capture server
function sseLength(res, model) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  chunk({ id: 'probe', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] });
  chunk({ id: 'probe', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } });
  res.write('data: [DONE]\n\n');
  res.end();
}

function startCapture() {
  const captures = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = raw;
      try { body = JSON.parse(raw); } catch { /* keep raw text */ }
      const headers = { ...req.headers };
      delete headers.authorization; delete headers['x-api-key'];
      captures.push({ at: Date.now(), method: req.method, url: req.url, headers, body });
      if (req.method === 'POST' && /\/chat\/completions(\?.*)?$/.test(req.url)) {
        if (body && body.stream === false) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'probe', object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }));
          return;
        }
        sseLength(res, body && body.model);
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'probe: request captured' } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      captures,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
}

// ---------------------------------------------------------------- engine
function resolveEngineBinary() {
  const names = process.platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) { continue; }
    for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) { return p; } }
  }
  return '(opencode not found on PATH)';
}

/**
 * Read a dependency's version without going through its "exports" map.
 * @opencode-ai/sdk does NOT export ./package.json, so a bare
 * require('@opencode-ai/sdk/package.json') throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * @param {string} name package name
 * @returns {string} the version, or '?' when it cannot be read
 */
function pkgVersion(name) {
  try { return require(`${name}/package.json`).version; } catch { /* exports map may hide it */ }
  try {
    const p = path.join(__dirname, '..', 'node_modules', ...name.split('/'), 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch { return '?'; }
}

/** The SAME shape amicus hands the engine (opencode-client.js :: buildServerOptions). */
function chatAgent() {
  return { description: 'wire probe', mode: 'primary', permission: { edit: 'ask', bash: 'ask', webfetch: 'allow' } };
}

function buildConfig(origin, c) {
  const cfg = { agent: { chat: chatAgent() }, provider: {} };
  if (c.or) { cfg.provider.openrouter = { options: { baseURL: `${origin}/api/v1`, apiKey: 'probe-key' }, models: c.or }; }
  if (c.anthropic) { cfg.provider.anthropic = { options: { baseURL: `${origin}/v1`, apiKey: 'probe-key' }, models: c.anthropic }; }
  if (c.custom) {
    cfg.provider.probe = { npm: '@ai-sdk/openai-compatible', name: 'probe',
      options: { baseURL: `${origin}/v1`, apiKey: 'probe-key' },
      models: { 'unknown-model': { name: 'unknown-model' } } };
  }
  return cfg;
}

async function startEngine(sdk, config, env) {
  // Same discipline PR 2 will ship: set only around the synchronous spawn, restore
  // before awaiting. The pinned SDK spreads process.env before its first await.
  const saved = process.env[FLAG];
  if (env === undefined) { delete process.env[FLAG]; } else { process.env[FLAG] = env; }
  let pending;
  try {
    pending = sdk.createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 60000, config });
  } finally {
    if (saved === undefined) { delete process.env[FLAG]; } else { process.env[FLAG] = saved; }
  }
  const server = await pending;
  const client = sdk.createOpencodeClient({ baseUrl: server.url });
  return { server, client };
}

async function providersDump(client, providerID, modelID) {
  const r = await client.config.providers();
  const list = (r.data && r.data.providers) || [];
  const p = list.find((x) => x.id === providerID);
  const m = p && p.models && p.models[modelID];
  return m ? { keys: Object.keys(m), limit: m.limit ?? null, variants: m.variants ?? '(not exposed)', options: m.options ?? null } : { missing: true, providerIds: list.map((x) => x.id) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(client, captures, c) {
  const created = await client.session.create({ body: { title: `probe ${c.id}` } });
  const sessionId = created.data && created.data.id;
  const engineVersion = (created.data && (created.data.version || (created.data.session && created.data.session.version))) || null;
  const before = captures.length;
  const parts = [{ type: 'text', text: 'ping' }];
  let res;
  if (c.viaAmicus) {
    const { sendPrompt } = require('../src/opencode-client');
    res = await sendPrompt(client, sessionId, { model: `${c.model.providerID}/${c.model.modelID}`, parts, agent: 'chat', reasoning: c.reasoning });
  } else {
    res = await client.session.promptAsync({ path: { id: sessionId }, body: { model: c.model, agent: 'chat', parts, ...(c.extra || {}) } });
  }
  const status = (res && res.response && res.response.status) || null;
  const error = res && res.error ? JSON.stringify(res.error).slice(0, 240) : null;
  const deadline = Date.now() + 20000;
  while (captures.length === before && Date.now() < deadline) { await sleep(100); }
  const wire = captures.slice(before).find((x) => x.method === 'POST') || null;
  // A case that never captures still has to yield a ROW: the promptAsync
  // status/error plus whatever assistant state exists is the measurement then.
  let assistant = null;
  let pollError = null;
  try {
    for (let i = 0; i < 25 && !(assistant && (assistant.finish || assistant.error)); i++) {
      await sleep(200);
      const msgs = await client.session.messages({ path: { id: sessionId } });
      const infos = (msgs.data || []).map((m) => m.info).filter((m) => m && m.role === 'assistant');
      assistant = infos[infos.length - 1] || null;
    }
  } catch (err) { pollError = err.message; }
  return { engineVersion, status, error, pollError, wire, assistant: assistant ? {
    keys: Object.keys(assistant), finish: assistant.finish ?? null,
    error: assistant.error ? (assistant.error.name || assistant.error.type || 'error') : null,
    variant: assistant.variant ?? null, tokens: assistant.tokens ?? null } : null };
}

// ---------------------------------------------------------------- case matrix
const CTX = 1048576;
const CASES = [
  { id: 'A',  title: 'bare {} descriptor', or: { [KIMI]: {} }, model: OR(KIMI), expect: 'max_tokens 32000, no reasoning' },
  { id: 'B',  title: 'limit.output 4096', or: { [KIMI]: { limit: { context: CTX, output: 4096 } } }, model: OR(KIMI), expect: '4096' },
  { id: 'C1', title: 'env 64000 + limit.output 100000', env: '64000', or: { [KIMI]: { limit: { context: CTX, output: 100000 } } }, model: OR(KIMI), expect: '64000' },
  { id: 'C2', title: 'env 64000 + limit.output 50000', env: '64000', or: { [QWEN]: { limit: { context: 1000000, output: 50000 } } }, model: OR(QWEN), expect: '50000' },
  { id: 'C3', title: 'env 64000 + bare {} (engine ceiling 943718)', env: '64000', or: { [KIMI]: {} }, model: OR(KIMI), expect: '64000' },
  { id: 'D1', title: 'env 64000abc (malformed)', env: '64000abc', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000 silently' },
  { id: 'D2', title: 'env 0', env: '0', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000' },
  { id: 'E1', title: 'options.max_tokens 4096', or: { [KIMI]: { options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '32000 (dropped)' },
  { id: 'E2', title: 'options.reasoning {effort:low}', or: { [KIMI]: { options: { reasoning: { effort: 'low' } } } }, model: OR(KIMI), expect: 'reasoning effort low on the wire' },
  { id: 'F1', title: 'amicus sendPrompt today: body.reasoning {effort:low}', or: { [KIMI]: {} }, model: OR(KIMI), viaAmicus: true, reasoning: { effort: 'low' }, expect: 'NO reasoning on the wire' },
  { id: 'F2', title: "prompt variant 'low' (kimi: low|high|max)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'low' }, expect: 'reasoning effort low' },
  { id: 'F3', title: "prompt variant 'medium' (kimi has no medium)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'medium' }, expect: 'record: silent no-op or error' },
  { id: 'F4', title: "prompt variant 'medium' (qwen has medium)", or: { [QWEN]: {} }, model: OR(QWEN), extra: { variant: 'medium' }, expect: 'reasoning effort medium' },
  { id: 'H1', title: 'direct anthropic haiku {}', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '32000' },
  { id: 'H2', title: 'direct anthropic haiku {} + env 64000', env: '64000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '64000 (engine ceiling 64000)' },
  { id: 'H3', title: "direct anthropic haiku variant 'high'", anthropic: { [HAIKU]: {} }, model: AN(HAIKU), extra: { variant: 'high' }, expect: 'thinking budget_tokens 16000' },
  { id: 'J1', title: 'custom openai-compatible unknown model {}', custom: true, model: CUSTOM, expect: '32000' },
  { id: 'J2', title: 'custom unknown model + env 64000', env: '64000', custom: true, model: CUSTOM, expect: '64000 (raw budget, nothing to clamp)' },
];

function wireSummary(wire) {
  if (!wire) { return { path: null, maxTokens: null, reasoning: null, thinking: null, reasoningEffort: null }; }
  const b = (wire.body && typeof wire.body === 'object') ? wire.body : {};
  return {
    path: wire.url,
    maxTokens: b.max_tokens ?? b.max_completion_tokens ?? b.maxOutputTokens ?? null,
    reasoning: b.reasoning === undefined ? null : b.reasoning,
    thinking: b.thinking === undefined ? null : b.thinking,
    reasoningEffort: b.reasoning_effort ?? null,
  };
}

function fmt(v) { return v === null || v === undefined ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }

/**
 * Run one case end to end against its own engine. Never throws: a failure
 * becomes the row. The providers dump happens HERE, while the engine that
 * serves this case is still alive -- the finally below kills it.
 */
async function runCase(sdk, cap, c, engines, providers) {
  const base = { id: c.id, title: c.title, expect: c.expect, env: c.env ?? null };
  let handle = null;
  try {
    handle = await startEngine(sdk, buildConfig(cap.origin, c), c.env);
    engines.started += 1;
    const key = `${c.model.providerID}/${c.model.modelID}`;
    if (!providers[key]) {
      try { providers[key] = await providersDump(handle.client, c.model.providerID, c.model.modelID); } catch (err) { providers[key] = { error: err.message }; }
    }
    const r = await send(handle.client, cap.captures, c);
    return { ...base, config: buildConfig('<capture>', c).provider, prompt: c.viaAmicus ? { viaAmicus: true, reasoning: c.reasoning } : (c.extra || {}), ...r };
  } catch (err) {
    return { ...base, error: err.message, wire: null, assistant: null };
  } finally {
    if (handle) {
      try { handle.server.close(); engines.closed += 1; } catch (err) { engines.closeErrors.push(`${c.id}: ${err.message}`); }
    }
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== INNER);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(String(args[onlyIdx + 1] || '').split(',')) : null;

  if (!assertSandboxed()) { process.exit(1); }

  const sdk = await import('@opencode-ai/sdk');
  const engine = { binary: resolveEngineBinary(), packageVersion: pkgVersion('opencode-ai'), sdkVersion: pkgVersion('@opencode-ai/sdk'), version: null };
  const cap = await startCapture();
  const engines = { started: 0, closed: 0, closeErrors: [] };
  const results = [];
  const providers = {};
  for (const c of CASES) {
    if (only && !only.has(c.id)) { continue; }
    const row = await runCase(sdk, cap, c, engines, providers);
    engine.version = engine.version || row.engineVersion || null;
    results.push(row);
  }
  await cap.close();

  process.stdout.write(`\nengine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion}), server reports ${engine.version || '?'}\nbinary: ${engine.binary}\n\n`);
  process.stdout.write('| id | case | expected | env | wire path | max_tokens | reasoning | thinking | prompt status | assistant finish | assistant error |\n|---|---|---|---|---|---|---|---|---|---|---|\n');
  for (const r of results) {
    const w = wireSummary(r.wire);
    const a = r.assistant || {};
    process.stdout.write(`| ${r.id} | ${r.title} | ${r.expect} | ${fmt(r.env)} | ${fmt(w.path)} | ${fmt(w.maxTokens)} | ${fmt(w.reasoning ?? w.reasoningEffort)} | ${fmt(w.thinking)} | ${fmt(r.status)}${r.error ? ' ' + r.error.slice(0, 60) : ''} | ${fmt(a.finish)} | ${fmt(a.error)} |\n`);
  }
  process.stdout.write('\n/config/providers per model:\n');
  for (const [k, v] of Object.entries(providers)) { process.stdout.write(`- ${k}: ${JSON.stringify(v)}\n`); }
  process.stdout.write(`\nengines: ${engines.started} started, ${engines.closed} closed${engines.closeErrors.length ? ` (close errors: ${engines.closeErrors.join('; ')})` : ''}\n`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, engines, providers, cases: results }, null, 2));
    process.stdout.write(`\nraw captures: ${outPath}\n`);
  }
}

if (process.argv.slice(2).includes(INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(runOuter(process.argv.slice(2)));
}
