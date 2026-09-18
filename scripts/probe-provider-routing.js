#!/usr/bin/env node

/**
 * Wire probe for issue #202 Lever 2: does an OpenRouter PROVIDER-ROUTING
 * preference (`provider: {order, allow_fallbacks, ignore, only, sort, ...}`)
 * reach the outbound request body when it is written into the pinned opencode
 * engine's config?
 *
 * Zero spend, no keys. The #218 harness (`scripts/probe-max-tokens.js`) is NOT
 * modular, so its sandbox wrapper and capture server are COPIED here, not
 * imported: runOuter() from probe-max-tokens.js:132-171, assertSandboxed() from
 * :188-219, startCapture() from :282-329 (the OpenAI/OpenRouter half only),
 * resolveEngineBinary()/pkgVersion() from :331-354, the assistant poll from
 * :479-494. `buildKeylessEnv`/`ENGINE_CREDENTIAL_ENV` are imported from
 * scripts/run-integration-keyless.js, as in #218. probe-max-tokens.js is NOT
 * edited: its `checks:` line is a full-matrix verdict CI and the records read.
 *
 * SAFETY (identical to #218): without `--inner` this file is only an OUTER
 * wrapper -- throwaway sandbox home; every provider key, legacy key name and
 * OPENCODE credential/config channel scrubbed; HOME, USERPROFILE, the two XDG
 * dirs and APPDATA repointed inside it; then a re-exec `--inner` under that env.
 * The INNER half refuses to start an engine unless every scrubbed name is
 * undefined, HOME is a probe sandbox and cwd is inside it. `apiKey: 'probe-key'`
 * is defence in depth: the provider points at a local capture server, so nothing
 * leaves the box. R11-R15 write `opencode.json` inside that sandbox cwd only.
 * Usage: node scripts/probe-provider-routing.js [--out probe-3/wire-capture.json] [--only R1,R3]
 * One line per case: `case id — path — carried: yes/no — shape`.
 */

'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureNodeModulesBinInPath } = require('../src/utils/path-setup');
ensureNodeModulesBinInPath();
const INNER = '--inner';
const SANDBOX_PREFIX = 'amicus-probe-home-';
const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';
const KIMI = 'moonshotai/kimi-k3';
const QWEN_CI = 'qwen/qwen3.8-27b'; // a real CI bench alias (.github/amicus-ci-aliases.json)
const ROUTE = { order: ['Fireworks'], allow_fallbacks: false };
const SERVED_BY = 'ProbeServingProvider'; // see sseLength(): the response-side sentinel
const SENTINELS = ['Fireworks', 'DeepInfra', 'Together', 'latency', 'deny', 'zz_probe_unknown', SERVED_BY];
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
    else { innerArgs.push('--out', path.resolve('probe-3', 'wire-capture.json')); }
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
// Question 4: the REAL OpenRouter stream names the serving upstream in a top-level `provider`
// field on every chunk. The server plays that back (SERVED_BY) to see if the engine surfaces it.
function sseLength(res, model) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const base = { id: 'probe', object: 'chat.completion.chunk', created: 0, model };
  const chunk = (o) => res.write(`data: ${JSON.stringify({ provider: SERVED_BY, ...o })}\n\n`);
  chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] });
  chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'length' }], usage: DEFAULT_USAGE });
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
      if (req.method === 'POST' && /\/chat\/completions(\?.*)?$/.test(req.url)) { sseLength(res, body && body.model); return; }
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
/** The SAME agent shape amicus hands the engine (opencode-client.js :: buildServerOptions). */
const CHAT_AGENT = { description: 'routing probe', mode: 'primary',
  permission: { edit: 'ask', bash: 'ask', webfetch: 'allow' } };
function buildConfig(origin, c) {
  const options = { baseURL: `${origin}/api/v1`, apiKey: 'probe-key', ...(c.topOptions || {}) };
  return { agent: { chat: CHAT_AGENT }, provider: { openrouter: { options, models: c.or } } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---------------------------------------------------------------- cases
// `or` is the provider's `models` block; `topOptions` merges into the provider-level
// `options` block (the one carrying baseURL); `extra` is spread into the promptAsync BODY;
// `treeConfig` writes an `opencode.json` at the engine's cwd; `scopedTreeConfig` writes one
// in a FRESH dir passed as `query.directory` on every call (amicus's per-call scoping —
// run-server.js:18-24: the server itself is directory-agnostic); `scopeTo` scopes the calls
// at an EMPTY fresh dir. R4-R8 take one routing key each.
const TREE = { provider: { openrouter: { models: { [KIMI]: { options: { provider: ROUTE } } } } } };
// The shape council-review.yml documents as its example, byte-for-byte (case R15).
const TREE_ONLY = { provider: { openrouter: { models: { [QWEN_CI]: { options: { provider: { only: ['reka'] } } } } } } };
const perKey = (id, provider) => ({ id, model: KIMI, or: { [KIMI]: { options: { provider } } }, path: `(a) options.provider.${Object.keys(provider)[0]}` });
const CASES = [
  { id: 'R0', path: 'control — bare {} descriptor', model: KIMI, or: { [KIMI]: {} } },
  { id: 'R1', path: '(a) models.<id>.options.provider', model: KIMI, or: { [KIMI]: { options: { provider: ROUTE } } } },
  // R2's key is INVENTED: the engine's declared prompt fields are model/parts/system/agent/tools/variant,
  // so this measures "an undeclared body field is dropped", not "there is no per-request channel".
  { id: 'R2', path: '(b) an invented per-request body key providerOptions.openrouter.provider', model: KIMI, or: { [KIMI]: {} }, extra: { providerOptions: { openrouter: { provider: ROUTE } } } },
  { id: 'R3', path: '(c) provider.openrouter.options.provider (the baseURL block)', model: KIMI, or: { [KIMI]: {} }, topOptions: { provider: ROUTE } },
  perKey('R4', { ignore: ['DeepInfra'] }), perKey('R5', { only: ['Fireworks'] }),
  perKey('R6', { sort: 'latency' }), perKey('R7', { require_parameters: true }),
  perKey('R8', { data_collection: 'deny' }),
  // R9's id is a real CI bench id; its VALUES are wire sentinels only -- neither Fireworks nor
  // Together serves qwen/qwen3.8-27b, and display names are not the slugs OpenRouter accepts.
  { id: 'R9', path: '(a) the full shape on a REAL CI bench id (sentinel values, not usable names)', model: QWEN_CI,
    or: { [QWEN_CI]: { options: { provider: { order: ['Fireworks', 'Together'], allow_fallbacks: false, sort: 'latency' } } } } },
  { id: 'R10', path: '(a) an unknown options key (allowlist vs pass-through)', model: KIMI, or: { [KIMI]: { options: { zz_probe_unknown: 'zz_probe_unknown' } } } },
  { id: 'R11', path: '(e) an opencode.json at the engine cwd, amicus config untouched', model: KIMI,
    or: { [KIMI]: {} }, treeConfig: TREE },
  { id: 'R12', path: '(f) an opencode.json in the per-call query.directory ONLY, cwd clean — the CI shape',
    model: KIMI, or: { [KIMI]: {} }, scopedTreeConfig: TREE },
  { id: 'R13', path: '(g) the mirror: opencode.json at cwd, calls scoped at an empty directory',
    model: KIMI, or: { [KIMI]: {} }, treeConfig: TREE, scopeTo: true },
  // R14 is the Stage-2 judge shape: run-server.js:16-30 scopes judges at <runDir>/_scratch.
  { id: 'R14', path: '(h) opencode.json at the scoped dir, calls scoped at its _scratch CHILD (the judge shape)',
    model: KIMI, or: { [KIMI]: {} }, scopedTreeConfig: TREE, scopeChild: '_scratch' },
  // R15 (council #266 r3, A1/D4): R12's geometry carrying the SHIPPED shape — a
  // real CI model id, a single-slug `only`, no `allow_fallbacks`. R12/R14 carry
  // the probe's own `order` preference, so an engine regression specific to
  // `only` handling would have tripped nothing. Real values, not sentinels: the
  // assertion is on the request body and nothing is ever sent to a provider.
  { id: 'R15', path: '(f) the SHIPPED shape: single-slug only, real CI model, in the per-call directory',
    model: QWEN_CI, or: { [QWEN_CI]: {} }, scopedTreeConfig: TREE_ONLY },
];

/** Every JSON path in `value` whose key or value is one of SENTINELS. The probe must
 * not ASSUME the landing site: a preference landing under some other key is still found. */
function findSentinels(value, prefix = '') {
  const hits = [];
  if (value === null || value === undefined) { return hits; }
  if (typeof value !== 'object') { return SENTINELS.includes(String(value)) ? [`${prefix} = ${value}`] : hits; }
  for (const [k, v] of Object.entries(value)) {
    if (SENTINELS.includes(k)) { hits.push(`${prefix}.${k} (key)`); }
    hits.push(...findSentinels(v, `${prefix}.${k}`));
  }
  return hits;
}

/** Question 4: the assistant `info` key list, plus every path under the whole
 * message (info + parts) carrying the SERVED_BY sentinel -- i.e. whether the
 * serving upstream survives anywhere the engine exposes. */
async function readAssistant(client, sessionId, dq) {
  let info = null;
  let parts = [];
  for (let i = 0; i < 25 && !(info && (info.finish || info.error)); i++) {
    await sleep(200);
    try {
      const msgs = await client.session.messages({ path: { id: sessionId }, ...dq });
      const last = (msgs.data || []).filter((m) => m && m.info && m.info.role === 'assistant').pop() || null;
      info = last ? last.info : null;
      parts = last ? (last.parts || []) : [];
    } catch (err) { return { assistantError: err.message }; }
  }
  // review round 1: the raw message is kept, not just a derived boolean, so the
  // 0-of-N negative is auditable from the artifact rather than on trust.
  return { assistantKeys: info ? Object.keys(info) : null,
    assistantFinish: info ? (info.finish ?? null) : null, assistantRaw: { info, parts },
    servedByInMessage: JSON.stringify({ info, parts }).includes(SERVED_BY),
    servedByPaths: findSentinels({ info, parts }, 'message') };
}

async function runCase(sdk, cap, c) {
  const base = { id: c.id, path: c.path, config: buildConfig('<capture>', c).provider };
  let server = null;
  const start = cap.captures.length;
  const treePath = path.join(process.cwd(), 'opencode.json');
  const scopeDir = (c.scopedTreeConfig || c.scopeTo) ? fs.mkdtempSync(path.join(process.cwd(), `scope-${c.id}-`)) : null;
  const callDir = scopeDir && c.scopeChild ? path.join(scopeDir, c.scopeChild) : scopeDir;
  if (callDir !== scopeDir) { fs.mkdirSync(callDir, { recursive: true }); }
  const dq = scopeDir ? { query: { directory: callDir } } : {};
  try {
    if (c.treeConfig) { fs.writeFileSync(treePath, JSON.stringify(c.treeConfig)); }
    if (c.scopedTreeConfig) { fs.writeFileSync(path.join(scopeDir, 'opencode.json'), JSON.stringify(c.scopedTreeConfig)); }
    server = await sdk.createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 60000,
      config: buildConfig(cap.origin, c) });
    const client = sdk.createOpencodeClient({ baseUrl: server.url });
    const created = await client.session.create({ body: { title: `probe ${c.id}` }, ...dq });
    const sessionId = created.data && created.data.id;
    const res = await client.session.promptAsync({ path: { id: sessionId }, ...dq,
      body: { model: { providerID: 'openrouter', modelID: c.model }, agent: 'chat',
        parts: [{ type: 'text', text: 'ping' }], ...(c.extra || {}) } });
    const status = (res && res.response && res.response.status) || null;
    const error = res && res.error ? JSON.stringify(res.error).slice(0, 240) : null;
    for (const end = Date.now() + 20000; cap.captures.length === start && Date.now() < end;) { await sleep(100); }
    const wire = cap.captures.slice(start).find((x) => x.method === 'POST') || null;
    const body = wire && typeof wire.body === 'object' ? wire.body : null;
    return { ...base, status, error, wireUrl: wire ? wire.url : null, wireBody: body,
      scopedAt: callDir ? path.relative(process.cwd(), callDir) : null,
      provider: body && body.provider !== undefined ? body.provider : null,
      bodyKeys: body ? Object.keys(body) : null, maxTokens: body ? (body.max_tokens ?? null) : null,
      sentinels: body ? findSentinels(body, 'body') : [], ...(await readAssistant(client, sessionId, dq)) };
  } catch (err) { return { ...base, threw: true, error: err.message, wireBody: null, sentinels: [] }; } finally {
    if (server) { try { server.close(); } catch { /* engine already gone */ } }
    if (c.treeConfig) { try { fs.unlinkSync(treePath); } catch { /* already gone */ } }
    if (scopeDir) { try { fs.rmSync(scopeDir, { recursive: true, force: true }); } catch { /* temp dir */ } }
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
  const engine = { binary: resolveEngineBinary(), packageVersion: pkgVersion('opencode-ai'),
    sdkVersion: pkgVersion('@opencode-ai/sdk') };
  const cap = await startCapture();
  const results = [];
  for (const c of CASES) {
    if (only && !only.has(c.id)) { continue; }
    results.push(await runCase(sdk, cap, c));
  }
  await cap.close();
  process.stdout.write(`\nengine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion})\n`
    + `binary (PATH scan, not the path the SDK spawned): ${engine.binary}\n\n`);
  for (const r of results) {
    const carried = r.provider !== null ? 'yes' : (r.sentinels.length > 0 ? 'elsewhere' : 'no');
    const shape = r.provider !== null ? JSON.stringify(r.provider) : (r.sentinels.length > 0 ? r.sentinels.join(' ')
      : (r.wireBody ? '(no provider key on the wire)' : `(no capture: ${r.error || 'none'})`));
    process.stdout.write(`${r.id} — ${r.path} — carried: ${carried} — ${shape}\n`);
  }
  const ids = results.filter((r) => r.provider !== null || r.sentinels.length > 0).map((r) => r.id);
  // Question 4: the response named the serving upstream on EVERY chunk (SERVED_BY) -- surfaced anywhere?
  const echoed = results.filter((r) => r.servedByInMessage).map((r) => r.id);
  process.stdout.write(`\nrouting: ${ids.length} of ${results.length} cases carried a preference (${ids.join(',') || 'none'})\n`
    + `serving provider echoed by the engine's message surface: ${echoed.length} of ${results.length}`
    + `${echoed.length ? ` (${echoed.join(',')})` : ' — it reaches no assistant-message field'}\n`
    + `assistant info keys (first case): ${JSON.stringify(results[0] && results[0].assistantKeys)}\n`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, cases: results, captures: cap.captures }, null, 2));
    // A few-KB DIGEST beside the full capture (review round 1): the full bodies carry the
    // engine's whole system prompt and tool schemas (~1.1 MB) and do not belong in a git
    // history. The digest is the committable record; the full capture is the evidence store's.
    const ua = (cap.captures.find((x) => x.method === 'POST') || { headers: {} }).headers['user-agent'] || null;
    const digestPath = outPath.replace(/(\.json)?$/, '').concat('-digest.json');
    fs.writeFileSync(digestPath, JSON.stringify({ engine, userAgent: ua, cases: results.map((r) => ({
      id: r.id, path: r.path, config: r.config, scopedAt: r.scopedAt, status: r.status, error: r.error,
      provider: r.provider, bodyKeys: r.bodyKeys, maxTokens: r.maxTokens, sentinels: r.sentinels,
      assistantKeys: r.assistantKeys, assistantFinish: r.assistantFinish,
      servedByInMessage: r.servedByInMessage, servedByPaths: r.servedByPaths })) }, null, 2));
    process.stdout.write(`raw captures: ${outPath}\ndigest: ${digestPath}\n`);
  }
}

if (process.argv.slice(2).includes(INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(runOuter(process.argv.slice(2)));
}
