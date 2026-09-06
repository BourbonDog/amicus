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
 * `buildKeylessEnv()` the keyless integration rail uses, and re-execs itself
 * with `--inner` under that env. What that scrub actually covers, named rather
 * than implied: every PROVIDER_ENV_MAP and legacy key deleted;
 * AMICUS_ENV_DIR/AMICUS_CONFIG_DIR deleted; the engine's own credential/config
 * channels deleted (OPENCODE_AUTH_CONTENT, OPENCODE_API_KEY, OPENCODE_CONFIG,
 * OPENCODE_CONFIG_DIR, OPENCODE_CONFIG_CONTENT -- see ENGINE_CREDENTIAL_ENV); and
 * HOME/USERPROFILE/XDG_DATA_HOME/XDG_CONFIG_HOME/APPDATA repointed inside the
 * sandbox. The INNER run re-asserts that every DELETED key name is undefined --
 * the provider keys, the legacy names, and the engine's own OPENCODE_*
 * credential/config channels -- and that HOME resolves inside the sandbox; it
 * exits 1 BEFORE starting an engine if any of that fails. The
 * `apiKey: 'probe-key'` in every provider block is defence in depth. This is a
 * scrub of the credential channels enumerated above, not a proof that no other
 * channel exists: an engine bump that adds one has to be added to that list.
 *
 * Usage:
 *   node scripts/probe-max-tokens.js [--out output/218-probe.json] [--only A,B,F1]
 *
 * Re-run after every engine bump: OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX is an
 * experimental flag, and the effort table changed between 1.2.20 and 1.18.15.
 * The header line names the engine version and binary that served the run.
 *
 * THE RUN CHECKS ITSELF (council #230 C2). Every case carries a machine-readable
 * `want` holding the behaviour currently MEASURED and filed in the BACKLOG
 * "v4.9.4 records" P1 table. After the table and the dump the run prints
 * `checks: N matched, N mismatched (ids), N recorded` and exits 1 if anything
 * moved — so an engine bump that changes the wire fails the run instead of
 * printing a new table under the old prose. Under `--only` that same line ends
 * in `partial run (--only …)`, so a subset's counts can never be filed or read
 * as a full-matrix verdict.
 *
 * THE K GROUP (#218 PR 2) measures what PR 1 left open: a descriptor's
 * `limit.output` under a thinking variant on the direct Anthropic route
 * (K1/K2/K9), the sum against the model's ceiling (K3/K4/K10), the flag above
 * a ceiling (K5), lever precedence (K7/K8), and the exact shapes amicus ships
 * once the flag is set to the budget (K4/K6/K11/K12/K13). Those rows are the canary
 * for the ENGINE's reading of the flag (an engine bump that ignored it reads
 * 32000 on K6/K12/K13). CI runs A/C3/K6/K12/K13 on every push
 * (tests/probe-flag-canary.integration.test.js). They do not exercise amicus's
 * wrapper — each case sets the flag in this probe's own env — so the SDK
 * spawn-timing fact is pinned by tests/opencode-client-sdk-spawn-timing.test.js
 * instead.
 *
 * THE L GROUP (#218 PR 3) measures what the ASSISTANT MESSAGE carries when the
 * provider stops for length -- the fields amicus reads to name the Mode 2 death
 * (32000 reasoning tokens, no answer): `finish`, the `tokens` split, and which
 * parts exist (a reasoning part with no text part is the shape headless would
 * promote to output). Those rows tell the capture server what to answer with
 * (`serve`: content, reasoning, thinking, usage), and the server now speaks the
 * Anthropic messages SSE too, so the direct rows measure `finish` instead of
 * recording an APIError against an OpenAI-shaped stream. L5 is the K-row gap
 * PR 2 parked: a descriptor above the engine's own ceiling with no variant.
 *
 * THE M GROUP (#218 PR 4) measures the effort lever beside the budget: what
 * every curated route DECLARES as its variants (M0, one engine, every model
 * dumped -- and the startup-refresh race that leaves a model newer than the
 * bundle at `limit 0/0, variants {}` on a cold read, M0 vs M12), that a variant
 * moves the reservation on exactly one shape (M2 vs M1/M9/M10b/M15/M16), the
 * fitted descriptor (M17), the direct openai route's missing reservation
 * (M5/M13/M22), and the runtime config update -- accepted, inert for what the
 * engine serves, and it writes config.json into the engine's cwd (M3/M4/M11;
 * M8 is refused without harm). M18-M21 go through amicus's own sendPrompt so
 * the shipped validator is measured against the live engine (two of them are
 * refused before any request and capture nothing -- `want.refused`). CI runs
 * M2 and M17 with the flag rows.
 * THE SANDBOX CACHE IS SHARED WITHIN A RUN (found by Task 7's full-matrix run): the
 * first engine starts on the engine's bundled catalogue and its models.dev fetch
 * writes HOME/.cache/opencode/models.json; every later engine starts on that cached
 * live catalogue. So `--only X` serves X cold and the full matrix serves everything
 * after A warm; the A dump (always case 1) reads kimi's bundled 1048576 where the live
 * value is 943718, a partial run's M0 reads models newer than the bundle as `limit
 * 0/0, variants {}`, and the full run's M0 knows them -- the "startup-refresh race"
 * the PR 2/PR 3 records describe is this window. A row's want must pin only what
 * both catalogues agree on (M9: max_tokens; its effort field is `reasoning: 'any'`).
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ensureNodeModulesBinInPath } = require('../src/utils/path-setup');
ensureNodeModulesBinInPath();

// The brief's figures for these three came from LIVE models.dev, which is not
// necessarily what the pinned engine's own bundled catalogue reports. Where the
// two differ the run's `/config/providers` dump is the authority -- for kimi the P1
// run reported `output: 1048576` against models.dev's 943718, and the PR 2 run
// reports 943718 (both filed in the BACKLOG records).
const KIMI = 'moonshotai/kimi-k3';   // live models.dev: effort low|high|max, ceiling 943718
const QWEN = 'qwen/qwen3.8-max-0902'; // models.dev: effort minimal..xhigh, ceiling 131072. Renamed from the un-dated `qwen/qwen3.8-max` between 2026-09-04 and 2026-09-05; the engine's variant table for the old id is now empty, so F4 reproduced F3's silent no-op against it (PR 2 record).
const HAIKU = 'claude-haiku-4-5';     // models.dev: budget_tokens (min 1024), ceiling 64000
const OR = (id) => ({ providerID: 'openrouter', modelID: id });
const AN = (id) => ({ providerID: 'anthropic', modelID: id });
const CUSTOM = { providerID: 'probe', modelID: 'unknown-model' };

const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';
const INNER = '--inner';
const SANDBOX_PREFIX = 'amicus-probe-home-';

// ---------------------------------------------------------------- credential sandbox
/**
 * OUTER half: re-exec this file with `--inner` under a credential-free env
 * rooted at a throwaway home directory. Never starts an engine itself.
 * @param {string[]} args the original argv tail (forwarded verbatim)
 * @returns {number} the inner run's exit code
 */
function runOuter(args) {
  const { buildKeylessEnv } = require('./run-integration-keyless');
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
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

    // PR 4 (M group): the INNER run's cwd -- the engine's project directory --
    // is a scratch dir INSIDE the sandbox, not the repo. The engine writes to its
    // cwd: PATCH /config wrote a merged `config.json` there (M3/M4/M11 landed one
    // in the repo root before this moved), so the project dir has to be
    // throwaway too, and listSandboxFiles() lists it whole. `--out` is resolved
    // against the caller's cwd first so the raw captures still land where asked.
    const projectDir = path.join(sandboxHome, 'project');
    try { fs.mkdirSync(projectDir, { recursive: true }); } catch { /* best effort */ }
    const outIdx = args.indexOf('--out');
    const innerArgs = [...args];
    if (outIdx >= 0 && innerArgs[outIdx + 1]) { innerArgs[outIdx + 1] = path.resolve(innerArgs[outIdx + 1]); }

    const result = spawnSync(process.execPath, [__filename, INNER, ...innerArgs], {
      env,
      stdio: 'inherit',
      cwd: projectDir,
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
 * INNER half's gate: every DELETED key name -- the provider keys, the legacy
 * names, and the engine's own OPENCODE_* credential/config channels
 * (ENGINE_CREDENTIAL_ENV) -- must be undefined before an engine is allowed to
 * start, and HOME must resolve inside the sandbox. Prints the sandbox line the
 * run is judged on, which enumerates exactly those names.
 *
 * HOME is checked too, not only the env-var names: a hand-typed `--inner` in a
 * real home has no provider variables set on plenty of machines and would still
 * hand the engine `~/.config/amicus/.env` and OpenCode's `auth.json`. Only the
 * OUTER half can produce a HOME with this prefix.
 * @returns {boolean} true when it is safe to proceed
 */
function assertSandboxed() {
  const { PROVIDER_ENV_MAP, LEGACY_KEY_NAMES } = require('../src/utils/api-key-store');
  const { ENGINE_CREDENTIAL_ENV } = require('./run-integration-keyless');
  // buildKeylessEnv() deletes the legacy names too (GEMINI_API_KEY -> the current
  // GOOGLE_GENERATIVE_AI_API_KEY) and the engine's own credential/config channels
  // (ENGINE_CREDENTIAL_ENV, imported from the scrubber itself so the gate asserts
  // exactly what it scrubs and the two cannot drift apart).
  const names = [...new Set([
    ...Object.values(PROVIDER_ENV_MAP),
    ...Object.keys(LEGACY_KEY_NAMES),
    ...ENGINE_CREDENTIAL_ENV,
  ])];
  const present = names.filter((n) => process.env[n] !== undefined);
  if (present.length > 0) {
    process.stderr.write(`probe: REFUSING to start an engine — still defined: ${present.join(',')}\n`);
    return false;
  }
  const home = process.env.HOME || '';
  if (!path.basename(home).startsWith(SANDBOX_PREFIX)) {
    process.stderr.write(`probe: REFUSING to start an engine — HOME is not a probe sandbox (${home || '(unset)'}); run without --inner\n`);
    return false;
  }
  // The engine's project directory (cwd) must be inside the sandbox too: the
  // engine writes there (PATCH /config -> <cwd>/config.json, measured M3).
  if (!path.resolve(process.cwd()).startsWith(path.resolve(home))) {
    process.stderr.write(`probe: REFUSING to start an engine — cwd ${process.cwd()} is outside the sandbox home; run without --inner\n`);
    return false;
  }
  process.stdout.write(`sandbox: HOME=${home} cwd=${process.cwd()} keys-absent=${names.join(',')}\n`);
  return true;
}

// ---------------------------------------------------------------- capture server
/**
 * What a case asks the capture server to answer with. Every field is optional;
 * the defaults reproduce the P1/P2 rows byte for byte ('ok', one output token).
 * @typedef {{content?: string, reasoning?: string, thinking?: string, usage?: object}} Serve
 */
const DEFAULT_OPENAI_USAGE = { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 };

/**
 * OpenAI-compatible chat-completions SSE ending in finish_reason 'length'.
 * `serve.reasoning` rides on the delta as OpenRouter's `reasoning` field (visible
 * reasoning); an empty `serve.content` sends no content at all (an answer that
 * never started).
 */
function sseLength(res, model, serve = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const content = serve.content === undefined ? 'ok' : serve.content;
  const delta = { role: 'assistant' };
  if (content) { delta.content = content; }
  if (serve.reasoning) { delta.reasoning = serve.reasoning; }
  chunk({ id: 'probe', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta, finish_reason: null }] });
  chunk({ id: 'probe', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
    usage: serve.usage || DEFAULT_OPENAI_USAGE });
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Anthropic messages SSE ending in stop_reason 'max_tokens' (the direct route's
 * "length"). `serve.thinking` adds a thinking block BEFORE the text; an empty
 * `serve.content` sends no text block. Anthropic reports no reasoning/output
 * split -- `usage.output_tokens` is the whole thing -- so that is what goes out.
 */
function sseAnthropicMaxTokens(res, model, serve = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ev = (type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
  const content = serve.content === undefined ? 'ok' : serve.content;
  const usage = serve.usage || { input_tokens: 5, output_tokens: 1 };
  ev('message_start', { message: { id: 'msg_probe', type: 'message', role: 'assistant', model, content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } } });
  let index = 0;
  if (serve.thinking) {
    ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '' } });
    ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: serve.thinking } });
    ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'probe' } });
    ev('content_block_stop', { index });
    index += 1;
  }
  if (content) {
    ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index, delta: { type: 'text_delta', text: content } });
    ev('content_block_stop', { index });
  }
  ev('message_delta', { delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
  ev('message_stop', {});
  res.end();
}

function startCapture() {
  const captures = [];
  // The case being served, set by runCase before it sends -- cases run one at a
  // time on one server, so a single slot is the whole state.
  const state = { current: null };
  const serveFor = () => (state.current && state.current.serve) || {};
  const server = http.createServer((req, res) => {
    // Concat the buffers and decode once: `raw += chunk` decodes each chunk on
    // its own and mangles any multi-byte character split across a boundary.
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = raw;
      try { body = JSON.parse(raw); } catch { /* keep raw text */ }
      const headers = { ...req.headers };
      delete headers.authorization; delete headers['x-api-key'];
      captures.push({ at: Date.now(), method: req.method, url: req.url, headers, body });
      if (req.method === 'POST' && /\/messages(\?.*)?$/.test(req.url)) {
        sseAnthropicMaxTokens(res, body && body.model, serveFor());
        return;
      }
      if (req.method === 'POST' && /\/chat\/completions(\?.*)?$/.test(req.url)) {
        if (body && body.stream === false) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'probe', object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'length' }],
            usage: DEFAULT_OPENAI_USAGE }));
          return;
        }
        sseLength(res, body && body.model, serveFor());
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
      setCase: (c) => { state.current = c; },
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
  // PR 4 (M group): the other three direct providers amicus curates, pointed at
  // the capture server the same way. Their requests are captured (the server
  // answers 400 to any path it does not speak) so the wire shape is recorded,
  // and their `/config/providers` entries expose each model's `variants`.
  if (c.openai) { cfg.provider.openai = { options: { baseURL: `${origin}/v1`, apiKey: 'probe-key' }, models: c.openai }; }
  if (c.google) { cfg.provider.google = { options: { baseURL: `${origin}/v1beta`, apiKey: 'probe-key' }, models: c.google }; }
  if (c.deepseek) { cfg.provider.deepseek = { options: { baseURL: `${origin}/v1`, apiKey: 'probe-key' }, models: c.deepseek }; }
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
  // The C1/C3/H2/J2 rows are the canary for that undocumented SDK behaviour: if a
  // future SDK stops spreading process.env before its first await, those four rows
  // would read 32000 instead of 64000 and this probe would report it. PR 2 adds a
  // unit pin through the `_createOpencodeServer` seam so a regression is caught
  // without a full matrix run.
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

async function providersDump(client, providerID, modelID, fromCase) {
  const r = await client.config.providers();
  const list = (r.data && r.data.providers) || [];
  const p = list.find((x) => x.id === providerID);
  const m = p && p.models && p.models[modelID];
  return m
    ? { fromCase, keys: Object.keys(m), limit: m.limit ?? null, variants: m.variants ?? '(not exposed)', options: m.options ?? null }
    : { fromCase, missing: true, providerIds: list.map((x) => x.id) };
}

/**
 * The descriptor this case puts in `provider.<id>.models.<modelID>`.
 * @param {object} c a CASES entry
 * @returns {object|null}
 */
function descriptorFor(c) {
  if (c.or) { return c.or[c.model.modelID] ?? null; }
  if (c.anthropic) { return c.anthropic[c.model.modelID] ?? null; }
  if (c.custom) { return { name: 'unknown-model' }; }  // buildConfig() writes this one
  return null;
}

/**
 * True when this case adds NOTHING to the model's descriptor that the engine
 * would fold back into `/config/providers` -- no `limit`, no `options`.
 *
 * This is what makes the dump engine-native. `/config/providers` reports the
 * MERGED descriptor, so a case that sets `limit.output: 50000` reads its own
 * input back as if it were the engine's ceiling. Only a bare-descriptor case
 * may seed a model's dump entry: A (kimi), F4 (qwen), H1 (haiku), J1 (custom).
 * @param {object} c a CASES entry
 * @returns {boolean}
 */
function isBareDescriptor(c) {
  const d = descriptorFor(c);
  return !!d && d.limit === undefined && d.options === undefined;
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
    res = await sendPrompt(client, sessionId, { model: `${c.model.providerID}/${c.model.modelID}`, parts, agent: 'chat', variant: c.variant, outputBudget: c.outputBudget, reasoning: c.reasoning });
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
  let msgParts = [];
  let pollError = null;
  try {
    for (let i = 0; i < 25 && !(assistant && (assistant.finish || assistant.error)); i++) {
      await sleep(200);
      const msgs = await client.session.messages({ path: { id: sessionId } });
      const assistants = (msgs.data || []).filter((m) => m && m.info && m.info.role === 'assistant');
      const last = assistants[assistants.length - 1] || null;
      assistant = last ? last.info : null;
      msgParts = last ? (last.parts || []) : [];
    }
  } catch (err) { pollError = err.message; }
  // `parts` keeps only the two content kinds the L rows pin (text / reasoning);
  // step-start / step-finish bookkeeping parts are engine noise here.
  return { engineVersion, status, error, pollError, wire, assistant: assistant ? {
    keys: Object.keys(assistant), finish: assistant.finish ?? null,
    error: assistant.error ? (assistant.error.name || assistant.error.type || 'error') : null,
    variant: assistant.variant ?? null, tokens: assistant.tokens ?? null,
    parts: msgParts.map((p) => p.type).filter((t) => t === 'text' || t === 'reasoning') } : null };
}

// ---------------------------------------------------------------- case matrix
const CTX = 1048576;
const HCTX = 200000;                  // haiku's context per the engine's own dump (H1)

/**
 * The machine-readable half of a case's expectation (council #230 C2). `expect`
 * is prose for the table; `want` is what the run actually CHECKS, and every
 * value here is the CURRENTLY MEASURED behaviour of the pinned engine as filed
 * in the BACKLOG "v4.9.4 records" P1 table — not a prediction. That is the
 * point: an engine bump that moves any of these numbers fails the run instead
 * of quietly re-filing a new table.
 * @param {number|null} maxTokens the body's max_tokens, compared exactly
 * @param {object|null} [reasoning] the body's `reasoning` (else `reasoning_effort`), deep-equal
 * @param {'any'|null} [thinking] present/absent only — the budget rides in maxTokens
 * @returns {{maxTokens: number|null, reasoning: object|null, thinking: 'any'|null}}
 */
const W = (maxTokens, reasoning = null, thinking = null) => ({ maxTokens, reasoning, thinking });
/**
 * The ASSISTANT-MESSAGE half of a `want` (#218 PR 3): what the engine recorded
 * once the provider stopped for length. Attached as `want.assistant`; a row
 * without one checks the wire only, exactly as before.
 * @param {string|null} finish the message's `finish`
 * @param {number} output `tokens.output`
 * @param {number} reasoning `tokens.reasoning`
 * @param {string[]} parts the text/reasoning part types, in order
 */
const WA = (finish, output, reasoning, parts) => ({ finish, output, reasoning, parts });
const LOW = { effort: 'low' };

const CASES = [
  { id: 'A',  title: 'bare {} descriptor', or: { [KIMI]: {} }, model: OR(KIMI), expect: 'max_tokens 32000, no reasoning', want: { ...W(32000), assistant: WA('length', 1, 0, ['text']) } },
  { id: 'B',  title: 'limit.output 4096', or: { [KIMI]: { limit: { context: CTX, output: 4096 } } }, model: OR(KIMI), expect: '4096', want: W(4096) },
  { id: 'C1', title: 'env 64000 + limit.output 100000', env: '64000', or: { [KIMI]: { limit: { context: CTX, output: 100000 } } }, model: OR(KIMI), expect: '64000', want: W(64000) },
  { id: 'C2', title: 'env 64000 + limit.output 50000', env: '64000', or: { [QWEN]: { limit: { context: 1000000, output: 50000 } } }, model: OR(QWEN), expect: '50000', want: W(50000) },
  { id: 'C3', title: 'env 64000 + bare {} (engine reports ceiling 1048576)', env: '64000', or: { [KIMI]: {} }, model: OR(KIMI), expect: '64000', want: W(64000) },
  { id: 'D1', title: 'env 64000abc (malformed)', env: '64000abc', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000 silently', want: W(32000) },
  { id: 'D2', title: 'env 0', env: '0', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000', want: W(32000) },
  { id: 'E1', title: 'options.max_tokens 4096', or: { [KIMI]: { options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '4096 — options.max_tokens reaches the wire (measured 2026-09-04; the plan predicted "dropped")', want: W(4096) },
  { id: 'E2', title: 'options.reasoning {effort:low}', or: { [KIMI]: { options: { reasoning: { effort: 'low' } } } }, model: OR(KIMI), expect: 'reasoning effort low on the wire', want: W(32000, LOW) },
  { id: 'F1', title: 'amicus sendPrompt with the pre-PR-4 `reasoning` option (never a prompt field; ignored since PR 4)', or: { [KIMI]: {} }, model: OR(KIMI), viaAmicus: true, reasoning: { effort: 'low' }, expect: 'NO reasoning on the wire', want: W(32000) },
  { id: 'F2', title: "prompt variant 'low' (kimi: low, high, max)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'low' }, expect: 'reasoning effort low', want: W(32000, LOW) },
  // F3's expectation — "silent no-op OR error" — is satisfied by either outcome,
  // so it cannot fail. `want: 'record'` says so out loud instead of letting a
  // hand-written pass/fail pretend the row was checked.
  { id: 'F3', title: "prompt variant 'medium' (kimi has no medium)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'medium' }, expect: 'record: silent no-op or error', want: 'record' },
  { id: 'F4', title: "prompt variant 'medium' (qwen has medium)", or: { [QWEN]: {} }, model: OR(QWEN), extra: { variant: 'medium' }, expect: 'reasoning effort medium', want: W(32000, { effort: 'medium' }) },
  { id: 'H1', title: 'direct anthropic haiku {}', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '32000', want: { ...W(32000), assistant: WA('length', 1, 0, ['text']) } },
  { id: 'H2', title: 'direct anthropic haiku {} + env 64000', env: '64000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '64000 (engine ceiling 64000)', want: W(64000) },
  { id: 'H3', title: "direct anthropic haiku variant 'high'", anthropic: { [HAIKU]: {} }, model: AN(HAIKU), extra: { variant: 'high' }, expect: 'thinking budget_tokens 16000', want: W(48000, null, 'any') },
  // H4 is the SECOND data point H3 needs. H3 alone (32000 default + 16000 budget
  // = 48000 on the wire) cannot separate "the budget is added to the default"
  // from "variant 'high' just sets 48000 for this model". The dump says haiku's
  // 'max' variant is budgetTokens 31999, so the additive rule predicts 63999.
  { id: 'H4', title: "direct anthropic haiku variant 'max'", anthropic: { [HAIKU]: {} }, model: AN(HAIKU), extra: { variant: 'max' }, expect: 'thinking budget_tokens 31999; max_tokens 63999 if additive', want: W(63999, null, 'any') },
  { id: 'J1', title: 'custom openai-compatible unknown model {}', custom: true, model: CUSTOM, expect: '32000', want: W(32000) },
  { id: 'J2', title: 'custom unknown model + env 64000', env: '64000', custom: true, model: CUSTOM, expect: '64000 (raw budget, nothing to clamp)', want: W(64000) },
  // PR 2 (K group, measured 2026-09-05): descriptor x thinking budget on the
  // direct Anthropic route, the flag above a known ceiling, lever precedence,
  // and the exact shapes amicus ships (env = budget AND limit.output =
  // min(budget, ceiling)). Every `want` is the measurement, as for the rows above.
  { id: 'K1', title: 'direct anthropic haiku limit.output 8000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } }, model: AN(HAIKU), expect: '8000 — the descriptor lowers the reservation on the Anthropic route too', want: W(8000) },
  { id: 'K2', title: "direct anthropic haiku limit.output 8000 + variant 'high'", anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } }, model: AN(HAIKU), extra: { variant: 'high' }, expect: '24000 = 8000 + 16000 — the thinking budget is ADDED to the descriptor value, not carved out of it', want: W(24000, null, 'any') },
  { id: 'K3', title: "direct anthropic haiku {} + env 64000 + variant 'max'", env: '64000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '64000 — 64000 + 31999 clamped to the ceiling', want: W(64000, null, 'any') },
  { id: 'K4', title: "direct anthropic haiku limit.output 64000 + env 64000 + variant 'max'", env: '64000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 64000 } } }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '64000 — the shipped budget-64000 shape, clamped the same way', want: W(64000, null, 'any') },
  { id: 'K5', title: 'direct anthropic haiku {} + env 100000 (above the 64000 ceiling)', env: '100000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '64000 — the flag is clamped to the ceiling the engine knows', want: W(64000) },
  { id: 'K6', title: 'env 100000 + limit.output 100000 (kimi)', env: '100000', or: { [KIMI]: { limit: { context: CTX, output: 100000 } } }, model: OR(KIMI), expect: '100000 — the shipped budget-100000 shape raises the reservation', want: W(100000) },
  { id: 'K7', title: 'env 64000 + options.max_tokens 4096 (kimi)', env: '64000', or: { [KIMI]: { options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '4096 — options.max_tokens wins over the flag (amicus never emits it)', want: W(4096) },
  { id: 'K8', title: 'limit.output 8000 + options.max_tokens 4096 (kimi)', or: { [KIMI]: { limit: { context: CTX, output: 8000 }, options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '4096 — options.max_tokens wins over the descriptor (amicus never emits it)', want: W(4096) },
  { id: 'K9', title: "direct anthropic haiku limit.output 40000 + variant 'max'", anthropic: { [HAIKU]: { limit: { context: HCTX, output: 40000 } } }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '63999 = min(40000, 32000) + 31999 — the default caps the descriptor at 32000; the sum sits under the ceiling and is left alone', want: W(63999, null, 'any') },
  { id: 'K10', title: "direct anthropic haiku limit.output 70000 + env 100000 + variant 'max'", env: '100000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 70000 } } }, model: AN(HAIKU), extra: { variant: 'max' }, expect: '64000 — 70000 + 31999 clamped to the ceiling, not to the descriptor', want: W(64000, null, 'any') },
  { id: 'K11', title: "env 8000 + direct anthropic haiku limit.output 8000 + variant 'high'", env: '8000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } }, model: AN(HAIKU), extra: { variant: 'high' }, expect: '24000 = 8000 + 16000 — the shipped budget-8000 shape with a thinking variant', want: W(24000, null, 'any') },
  { id: 'K12', title: 'env 8000 + bare {} (kimi)', env: '8000', or: { [KIMI]: {} }, model: OR(KIMI), expect: '8000 — the flag lowers a row the amicus catalog cannot clamp', want: W(8000) },
  { id: 'K13', title: 'env 8000 + custom unknown model {}', env: '8000', custom: true, model: CUSTOM, expect: '8000 — a model neither catalog knows receives the budget as-is', want: W(8000) },
  // PR 3 (L group, measured 2026-09-05): the assistant message when the provider
  // stops for length. `serve` is what the capture server answers with; the
  // usage figures replay the #218 ledger rows (32000 reasoning, no answer).
  { id: 'L1', title: 'kimi {} — length, no content, HIDDEN reasoning (usage completion 32000 / reasoning 32000)', or: { [KIMI]: {} }, model: OR(KIMI), serve: { content: '', usage: { prompt_tokens: 5, completion_tokens: 32000, total_tokens: 32005, completion_tokens_details: { reasoning_tokens: 32000 } } }, expect: "finish 'length', tokens 0 output / 32000 reasoning, no text or reasoning part — the Mode 2 shape as the ledger showed it", want: { ...W(32000), assistant: WA('length', 0, 32000, []) } },
  { id: 'L2', title: 'kimi {} — length, no content, VISIBLE reasoning (same usage)', or: { [KIMI]: {} }, model: OR(KIMI), serve: { content: '', reasoning: 'thinking…', usage: { prompt_tokens: 5, completion_tokens: 32000, total_tokens: 32005, completion_tokens_details: { reasoning_tokens: 32000 } } }, expect: "finish 'length', a reasoning part and no text part — the shape headless would promote to output", want: { ...W(32000), assistant: WA('length', 0, 32000, ['reasoning']) } },
  { id: 'L3', title: 'kimi {} — length, visible reasoning AND content (usage completion 40 / reasoning 32)', or: { [KIMI]: {} }, model: OR(KIMI), serve: { content: 'ok', reasoning: 'thinking…', usage: { prompt_tokens: 5, completion_tokens: 40, total_tokens: 45, completion_tokens_details: { reasoning_tokens: 32 } } }, expect: 'output 8 = 40 − 32 if the engine subtracts reasoning from completion; both parts', want: { ...W(32000), assistant: WA('length', 8, 32, ['reasoning', 'text']) } },
  { id: 'L4', title: "direct anthropic haiku {} + variant 'high' — thinking block, no text, stop_reason max_tokens (usage output 24000)", anthropic: { [HAIKU]: {} }, model: AN(HAIKU), extra: { variant: 'high' }, serve: { content: '', thinking: 'thinking…', usage: { input_tokens: 5, output_tokens: 24000 } }, expect: "finish 'length', 24000 output / 0 reasoning (Anthropic reports no split), a reasoning part and no text part", want: { ...W(48000, null, 'any'), assistant: WA('length', 24000, 0, ['reasoning']) } },
  { id: 'L5', title: 'direct anthropic haiku limit.output 70000 + env 100000, no variant', env: '100000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 70000 } } }, model: AN(HAIKU), expect: '64000 if the engine clamps a descriptor above its own ceiling with no variant in play; 70000 if only a thinking sum is clamped (K10)', want: W(64000) },
  // PR 4 (M group): the effort lever (`variant`) beside the budget on every
  // direct provider amicus curates, what each curated route DECLARES as its
  // variants, and the engine's runtime config update (PATCH /config, the SDK's
  // `config.update`) as a way to fit a thinking variant UNDER the budget on the
  // direct Anthropic route, where the engine adds the variant's budget on top of
  // the descriptor (K2/K11). Rows marked `record` are measured first and pinned
  // once the number is known; M0 starts ONE engine and dumps every model.
  { id: 'M0', title: 'dump only: the variants every curated route declares (bare descriptors, one engine)', dumpOnly: true, dump: 'all',
    or: { [KIMI]: {}, [QWEN]: {}, 'openai/gpt-5.6-terra': {}, 'google/gemini-3.6-flash': {}, 'google/gemini-3.1-pro-preview': {}, 'deepseek/deepseek-v4-flash-0731': {}, 'deepseek/deepseek-v4-pro': {}, 'z-ai/glm-5.3': {}, 'anthropic/claude-opus-5': {}, 'anthropic/claude-sonnet-5': {}, 'anthropic/claude-haiku-4.5': {}, 'anthropic/claude-fable-5': {}, 'x-ai/grok-4.3': {}, 'minimax/minimax-m2.7': {}, 'qwen/qwen3.8-27b': {}, 'qwen/qwen3-coder-next': {}, 'qwen/qwen3.6-flash': {}, 'mistralai/mistral-medium-3-5': {}, 'bytedance-seed/seed-2.0-lite': {}, 'thinkingmachines/inkling': {}, 'openai/gpt-4o': {} },
    // claude-sonnet-4-6 (ceiling 128000) and claude-opus-4-5 (64000) are two
    // more budget_tokens-typed ids (models.dev reasoning_options): the engine's
    // per-variant budget is measured on them beside haiku's 16000/31999.
    anthropic: { [HAIKU]: {}, 'claude-opus-5': {}, 'claude-sonnet-5': {}, 'claude-fable-5': {}, 'claude-haiku-4-5-20251001': {}, 'claude-sonnet-4-6': {}, 'claude-opus-4-5': {} },
    openai: { 'gpt-5.6-terra': {}, 'gpt-5.6-sol-pro': {}, 'gpt-5.3-codex': {}, 'gpt-4o': {} },
    google: { 'gemini-3.6-flash': {}, 'gemini-3.1-pro-preview': {} },
    deepseek: { 'deepseek-v4-pro': {} },
    custom: true, model: OR(KIMI), expect: 'record: each model\'s `variants` map as the engine reports it', want: 'record' },
  { id: 'M1', title: "kimi limit.output 8000 + env 8000 + variant 'low' (the shipped budget-8000 shape with an effort)", env: '8000', or: { [KIMI]: { limit: { context: CTX, output: 8000 } } }, model: OR(KIMI), extra: { variant: 'low' }, expect: '8000 + reasoning effort low — on OpenRouter an effort does not move the reservation (F2 showed it at 32000)', want: W(8000, LOW) },
  { id: 'M2', title: "direct anthropic haiku limit.output 24000 + env 24000 + variant 'high' (the shipped budget-24000 shape with a thinking variant, NO fit)", env: '24000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 24000 } } }, model: AN(HAIKU), extra: { variant: 'high' }, expect: '40000 = 24000 + 16000 — the budget is overshot by the variant\'s budget (K2/K11 at a different point)', want: W(40000, null, 'any') },
  { id: 'M3', title: "direct anthropic haiku limit.output 24000 + env 24000, PATCH /config limit.output 8000, then variant 'high'", env: '24000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 24000 } } }, or: { [KIMI]: {} }, model: AN(HAIKU), update: { provider: { anthropic: { models: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } } } } }, dumpAfter: [`anthropic/${HAIKU}`, `openrouter/${KIMI}`], extra: { variant: 'high' }, expect: '40000 — PATCH /config is accepted (200) and changes nothing the engine serves; it wrote config.json into the engine cwd', want: { ...W(40000, null, 'any'), update: { status: 200, configJson: true } } },
  { id: 'M4', title: 'kimi {} then PATCH /config limit.output 4096, no variant', or: { [KIMI]: {} }, model: OR(KIMI), update: { provider: { openrouter: { models: { [KIMI]: { limit: { context: CTX, output: 4096 } } } } } }, dumpAfter: [`openrouter/${KIMI}`], expect: '32000 — the runtime update is accepted (200) on the OpenRouter provider too and changes nothing the engine serves; config.json in the engine cwd is rewritten', want: { ...W(32000), update: { status: 200, configJson: true } } },
  { id: 'M5', title: "direct openai gpt-5.6-terra {} + variant 'high'", openai: { 'gpt-5.6-terra': {} }, model: { providerID: 'openai', modelID: 'gpt-5.6-terra' }, extra: { variant: 'high' }, expect: 'no reservation at all on /v1/responses — the Responses body carries no output limit, and reasoning {effort: high, summary: auto} carries the level', want: W(null, { effort: 'high', summary: 'auto' }) },
  { id: 'M6', title: "direct google gemini-3.6-flash {} + variant 'high'", google: { 'gemini-3.6-flash': {} }, model: { providerID: 'google', modelID: 'gemini-3.6-flash' }, extra: { variant: 'high' }, expect: 'generationConfig.maxOutputTokens 32000 with thinkingConfig {includeThoughts, thinkingLevel: high} — the Google route carries the reservation and the level together', want: W(32000, null, 'any') },
  { id: 'M7', title: "custom unknown model {} + variant 'high' (declares no variants)", custom: true, model: CUSTOM, extra: { variant: 'high' }, expect: '32000 with nothing added — a model whose variants map is empty takes the variant as a silent no-op, F3 on a model the engine does not know', want: W(32000) },
  { id: 'M8', title: 'direct anthropic haiku {} then PATCH /config limit {output: 8000} with NO context (the ConfigInvalidError trap, at runtime)', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), update: { provider: { anthropic: { models: { [HAIKU]: { limit: { output: 8000 } } } } } }, dumpAfter: [`anthropic/${HAIKU}`], expect: '32000 — the bad runtime update is refused (400 BadRequest, missing limit.context) and writes or changes no config file; the running engine keeps serving', want: { ...W(32000), update: { status: 400, configJson: false } } },
  { id: 'M9', title: "openrouter anthropic/claude-haiku-4.5 {} + variant 'high' (the catalogue-dependent effort field is recorded, not pinned)", or: { 'anthropic/claude-haiku-4.5': {} }, model: OR('anthropic/claude-haiku-4.5'), extra: { variant: 'high' }, expect: '32000 on both catalogues — the effort field depends on which catalogue the engine had: the bundled one declares high as reasoning.max_tokens 16000, the live one as reasoning.effort high; either way the reservation is untouched (plan rule 4)', want: W(32000, 'any') },
  { id: 'M10', title: "direct anthropic claude-sonnet-5 {} + variant 'high' (an ADAPTIVE-thinking variant: effort, no budgetTokens)", anthropic: { 'claude-sonnet-5': {} }, model: AN('claude-sonnet-5'), extra: { variant: 'high' }, expect: '32000 — an adaptive variant adds nothing; thinking {type: adaptive, display: summarized} with the effort carried under output_config', want: W(32000, { output_config: { effort: 'high' } }, 'any') },
  { id: 'M10b', title: "direct anthropic claude-sonnet-5 limit.output 8000 + env 8000 + variant 'high' (the shipped budget-8000 shape with an adaptive variant)", env: '8000', anthropic: { 'claude-sonnet-5': { limit: { context: 1000000, output: 8000 } } }, model: AN('claude-sonnet-5'), extra: { variant: 'high' }, expect: '8000 — the budget holds under an adaptive variant, which adds nothing to the reservation', want: W(8000, { output_config: { effort: 'high' } }, 'any') },
  { id: 'M11', title: "direct anthropic haiku limit.output 24000 + env 24000, PATCH /config with the FULL spawn config (limit.output 8000), then variant 'high'", env: '24000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 24000 } } }, model: AN(HAIKU), update: (origin) => buildConfig(origin, { anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } } }), dumpAfter: [`anthropic/${HAIKU}`], extra: { variant: 'high' }, expect: '40000 — a FULL-config PATCH is inert too (200); GET /config still reports the spawn value and config.json in the engine cwd is rewritten', want: { ...W(40000, null, 'any'), update: { status: 200, configJson: true } } },
  { id: 'M12', title: "openrouter qwen3.8-max-0902 {} — wait for the engine's catalogue to know it, then variant 'medium'", or: { [QWEN]: {} }, model: OR(QWEN), waitKnown: `openrouter/${QWEN}`, extra: { variant: 'medium' }, expect: '32000 with reasoning effort medium — the startup refresh made a model newer than the bundle known within 36 ms on a one-model engine and the variant then landed', want: W(32000, { effort: 'medium' }) },
  { id: 'M13', title: 'direct openai gpt-5.6-terra limit.output 8000 + env 8000, no variant', env: '8000', openai: { 'gpt-5.6-terra': { limit: { context: 1050000, output: 8000 } } }, model: { providerID: 'openai', modelID: 'gpt-5.6-terra' }, expect: 'no reservation even with a descriptor and the flag — and the engine sends reasoning {effort: medium, summary: auto} by itself when no variant is given', want: W(null, { effort: 'medium', summary: 'auto' }) },
  { id: 'M14', title: "direct deepseek deepseek-v4-pro {} + variant 'high'", deepseek: { 'deepseek-v4-pro': {} }, model: { providerID: 'deepseek', modelID: 'deepseek-v4-pro' }, extra: { variant: 'high' }, expect: '32000 with reasoning_effort high — the direct DeepSeek route carries the reservation and the level on chat/completions', want: W(32000, 'high') },
  { id: 'M15', title: "direct google gemini-3.6-flash limit.output 8000 + env 8000 + variant 'high'", env: '8000', google: { 'gemini-3.6-flash': { limit: { context: 1048576, output: 8000 } } }, model: { providerID: 'google', modelID: 'gemini-3.6-flash' }, extra: { variant: 'high' }, expect: '8000 — the budget holds on the Google route with a variant in play; thinkingLevel high adds nothing on top', want: W(8000, null, 'any') },
  { id: 'M16', title: "direct deepseek deepseek-v4-pro limit.output 8000 + env 8000 + variant 'high'", env: '8000', deepseek: { 'deepseek-v4-pro': { limit: { context: 1000000, output: 8000 } } }, model: { providerID: 'deepseek', modelID: 'deepseek-v4-pro' }, extra: { variant: 'high' }, expect: '8000 — the budget holds on the direct DeepSeek route with a variant in play; reasoning_effort high adds nothing on top', want: W(8000, 'high') },
  { id: 'M17', title: "direct anthropic haiku limit.output 8000 (= 24000 − the high variant's 16000) + env 24000 + variant 'high' — the FITTED shape", env: '24000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 8000 } } }, model: AN(HAIKU), extra: { variant: 'high' }, expect: '24000 = min(8000, 24000) + 16000 — a descriptor lowered by the variant\'s budget lands the sum exactly on the budget', want: W(24000, null, 'any') },
  { id: 'M22', title: 'direct openai gpt-4o limit.output 8000 + env 8000, no variant (a chat-completions-era id: does the reservation appear on THAT path?)', env: '8000', openai: { 'gpt-4o': { limit: { context: 128000, output: 8000 } } }, model: { providerID: 'openai', modelID: 'gpt-4o' }, expect: 'no reservation on a chat-completions-era id either — the whole direct openai provider goes through /v1/responses, which scopes the M5/M13 finding to the provider, not to one id', want: W(null) },
  // PR 4 rows through amicus's OWN door (opencode-client.js :: sendPrompt), so the
  // validator runs against the live engine: M18 sends a declared level, M19 is
  // refused before the wire, M20 is refused for the budget, M21 sends the K4 shape.
  { id: 'M18', title: "amicus sendPrompt variant 'low' on kimi (declared)", or: { [KIMI]: {} }, model: OR(KIMI), viaAmicus: true, variant: 'low', expect: 'reasoning effort low — F2 through the shipped path', want: W(32000, LOW) },
  { id: 'M19', title: "amicus sendPrompt variant 'medium' on kimi (undeclared: low, high, max)", or: { [KIMI]: {} }, model: OR(KIMI), viaAmicus: true, variant: 'medium', expect: 'refused before any request: VARIANT_UNDECLARED, no capture', want: { refused: 'VARIANT_UNDECLARED' } },
  // M20 uses the BARE-descriptor + flag shape (what amicus ships for a model its
  // catalog does not know, K5/K12): /config/providers echoes a WRITTEN descriptor
  // (M3), and the sandbox has no amicus catalog, so the catalog-known shape is
  // pinned in tests/opencode-client.test.js and tests/utils/engine-variants.test.js
  // instead. Found by this row's first run (Task 2 report).
  { id: 'M20', title: "amicus sendPrompt variant 'high' on direct haiku {} + env 24000 with outputBudget 24000 (bare descriptor + the flag: the catalog-unknown shape)", env: '24000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), viaAmicus: true, variant: 'high', outputBudget: 24000, expect: "refused before any request: VARIANT_OVER_BUDGET — the bare descriptor reads the engine's own 64000 ceiling, and 24000 + 16000 = 40000 would overshoot the budget; no capture", want: { refused: 'VARIANT_OVER_BUDGET' } },
  { id: 'M21', title: "amicus sendPrompt variant 'max' on direct haiku with outputBudget 64000 (the K4 shape)", env: '64000', anthropic: { [HAIKU]: { limit: { context: HCTX, output: 64000 } } }, model: AN(HAIKU), viaAmicus: true, variant: 'max', outputBudget: 64000, expect: '64000 — budget at the ceiling, the sum clamped to it (K4), sent', want: W(64000, null, 'any') },
];

function wireSummary(wire) {
  if (!wire) { return { path: null, maxTokens: null, reasoning: null, thinking: null, reasoningEffort: null }; }
  const b = (wire.body && typeof wire.body === 'object') ? wire.body : {};
  // PR 4 (M group): the OpenAI Responses API spells the reservation
  // `max_output_tokens`; Google's generateContent nests it (and the thinking
  // config) under `generationConfig`. Read as fallbacks so those rows print a
  // number instead of an em dash; the existing rows' bodies carry none of them.
  const gc = (b.generationConfig && typeof b.generationConfig === 'object') ? b.generationConfig : {};
  return {
    path: wire.url,
    maxTokens: b.max_tokens ?? b.max_completion_tokens ?? b.maxOutputTokens ?? b.max_output_tokens ?? gc.maxOutputTokens ?? null,
    // Anthropic's adaptive thinking carries the effort under `output_config`;
    // printed wrapped so the column says which key it came from.
    reasoning: b.reasoning !== undefined ? b.reasoning : (b.output_config !== undefined ? { output_config: b.output_config } : null),
    thinking: b.thinking !== undefined ? b.thinking : (gc.thinkingConfig !== undefined ? gc.thinkingConfig : null),
    reasoningEffort: b.reasoning_effort ?? null,
  };
}

/**
 * Format ONE markdown table cell. Objects are JSON, null/undefined is an em
 * dash, and the two characters that break a table -- a literal `|` (splits the
 * row into extra columns) and a newline (ends the row) -- are neutralised.
 * Every cell goes through here, including case titles and truncated errors,
 * so the probe cannot emit a broken table no matter what a case is named or
 * what an engine error happens to contain.
 * @param {*} v
 * @returns {string}
 */
function cell(v) {
  if (v === null || v === undefined) { return '—'; }
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

/**
 * Every (providerID, modelID) a case configured, for a `dump: 'all'` case.
 * @param {object} c a CASES entry
 * @returns {Array<[string, string]>}
 */
function dumpTargets(c) {
  const blocks = [['openrouter', c.or], ['anthropic', c.anthropic], ['openai', c.openai], ['google', c.google], ['deepseek', c.deepseek]];
  const out = [];
  for (const [providerID, models] of blocks) {
    for (const modelID of Object.keys(models || {})) { out.push([providerID, modelID]); }
  }
  if (c.custom) { out.push([CUSTOM.providerID, CUSTOM.modelID]); }
  return out;
}

/**
 * Every file under the sandbox HOME (the XDG and APPDATA dirs are rooted inside
 * it by buildKeylessEnv) and under the engine's project directory (the inner
 * run's cwd, also inside the sandbox -- see runOuter), each with a size@mtime
 * stamp. Used around a runtime config update so a file the engine WRITES in
 * response shows up as a new or changed path -- on a user's machine that would
 * be their own ~/.config/opencode or their project root, not a temp dir. The
 * whole cwd is listed, not a guessed set of names: the first version of this
 * check looked for opencode.json / .opencode and missed the `config.json` the
 * PATCH actually wrote.
 * @returns {Map<string, string>} relative path -> size@mtimeMs
 */
function listSandboxFiles() {
  const out = new Map();
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, r); } else {
        let stamp = '?';
        try { const st = fs.statSync(p); stamp = `${st.size}@${Math.round(st.mtimeMs)}`; } catch { /* raced */ }
        out.set(r, stamp);
      }
    }
  };
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;
  if (home) { walk(home, 'HOME'); }
  // The project dir is inside HOME by construction (runOuter), so it is already
  // listed as HOME/project/…; walk it separately only if that ever changes.
  if (!home || !path.resolve(process.cwd()).startsWith(home)) { walk(process.cwd(), 'cwd'); }
  return out;
}

/**
 * PATCH /config on the running engine (the SDK's `config.update`), recording
 * the response and every sandbox file the call created.
 * @param {object} client SDK client
 * @param {object} body the partial config to send
 * @returns {Promise<{status: number|null, error: string|null, newFiles: string[]}>}
 */
async function applyUpdate(client, body) {
  const before = listSandboxFiles();
  let status = null;
  let error = null;
  try {
    const u = await client.config.update({ body });
    status = (u && u.response && u.response.status) || null;
    error = u && u.error ? JSON.stringify(u.error).slice(0, 240) : null;
  } catch (err) { error = err.message; }
  const after = listSandboxFiles();
  // What GET /config reports for `provider` afterwards: whether the PATCH was
  // stored at all, separately from whether the provider registry re-read it.
  let configAfter = null;
  try {
    const g = await client.config.get();
    configAfter = JSON.stringify((g.data && g.data.provider) ?? null).slice(0, 400);
  } catch (err) { configAfter = `error: ${err.message}`; }
  // New paths AND paths whose size/mtime moved: a PATCH that rewrote an
  // existing config file would show only in the second list.
  const newFiles = [...after.keys()].filter((f) => !before.has(f));
  const changedFiles = [...after.entries()].filter(([f, s]) => before.has(f) && before.get(f) !== s).map(([f]) => f);
  return { status, error, newFiles, changedFiles, sandboxFiles: [...after.keys()], configAfter };
}

/**
 * Poll `/config/providers` until the engine's catalogue KNOWS a model (its
 * `limit.context` is non-zero) or the deadline passes. The engine refreshes its
 * bundled catalogue from models.dev at startup; a model newer than the bundle
 * reads `limit 0/0, variants {}` until that lands (PR 2 record: kimi's ceiling
 * flipping between runs; this run: qwen3.8-max-0902 and glm-5.3 reading 0/0 on
 * M0). How long that takes is what a validator reading the dump has to know.
 * @param {object} client SDK client
 * @param {string} key 'providerID/modelID'
 * @param {number} deadlineMs
 * @returns {Promise<{key: string, known: boolean, ms: number, polls: number, dump: object|null}>}
 */
async function waitKnown(client, key, deadlineMs) {
  const [providerID, ...rest] = key.split('/');
  const modelID = rest.join('/');
  const start = Date.now();
  let polls = 0;
  let dump = null;
  while (Date.now() - start < deadlineMs) {
    polls += 1;
    try { dump = await providersDump(client, providerID, modelID, 'wait'); } catch (err) { dump = { error: err.message }; }
    if (dump && dump.limit && dump.limit.context > 0) { return { key, known: true, ms: Date.now() - start, polls, dump }; }
    await sleep(250);
  }
  return { key, known: false, ms: Date.now() - start, polls, dump };
}

/**
 * Run one case end to end against its own engine. Never throws: a failure
 * becomes the row. The providers dump happens HERE, while the engine that
 * serves this case is still alive -- the finally below kills it.
 *
 * PR 4 (M group) case fields: `dump: 'all'` dumps every model the case
 * configured (each must be bare -- the dump is engine-native only then);
 * `dumpOnly` skips the prompt; `update` is PATCHed to the running engine after
 * the dump and before the prompt, and `dumpAfter` names the models re-dumped
 * once it has landed (recorded under `update.after`, never in `providers`,
 * which stays the spawn-time, engine-native view).
 */
async function runCase(sdk, cap, c, engines, providers, updates) {
  const base = { id: c.id, title: c.title, expect: c.expect, want: c.want ?? null, env: c.env ?? null };
  let handle = null;
  const captureStart = cap.captures.length; // PR 4 whole-branch review (PR-3): so the refused-row catch can MEASURE "no capture"
  try {
    handle = await startEngine(sdk, buildConfig(cap.origin, c), c.env);
    engines.started += 1;
    const key = `${c.model.providerID}/${c.model.modelID}`;
    if (!providers[key] && isBareDescriptor(c)) {
      try { providers[key] = await providersDump(handle.client, c.model.providerID, c.model.modelID, c.id); } catch (err) { providers[key] = { fromCase: c.id, error: err.message }; }
    }
    if (c.dump === 'all') {
      for (const [providerID, modelID] of dumpTargets(c)) {
        const k = `${providerID}/${modelID}`;
        if (providers[k]) { continue; }
        try { providers[k] = await providersDump(handle.client, providerID, modelID, c.id); } catch (err) { providers[k] = { fromCase: c.id, error: err.message }; }
      }
    }
    let update = null;
    let refresh = null;
    if (c.waitKnown) {
      refresh = await waitKnown(handle.client, c.waitKnown, 20000);
      updates[`${c.id} (wait for the catalogue to know ${c.waitKnown})`] = refresh;
    }
    if (c.update) {
      // A function receives the capture origin, so a case can PATCH the FULL
      // spawn-time config with one field changed (M11).
      update = await applyUpdate(handle.client, typeof c.update === 'function' ? c.update(cap.origin) : c.update);
      update.after = {};
      for (const k of (c.dumpAfter || [])) {
        const [providerID, ...rest] = k.split('/');
        try { update.after[k] = await providersDump(handle.client, providerID, rest.join('/'), c.id); } catch (err) { update.after[k] = { error: err.message }; }
      }
      updates[c.id] = update;
    }
    const config = buildConfig('<capture>', c).provider;
    if (c.dumpOnly) { return { ...base, config, prompt: null, status: null, error: null, wire: null, assistant: null, update, refresh }; }
    cap.setCase(c);
    const r = await send(handle.client, cap.captures, c);
    return { ...base, config, prompt: c.viaAmicus ? { viaAmicus: true, variant: c.variant ?? null, outputBudget: c.outputBudget ?? null, reasoning: c.reasoning ?? null } : (c.extra || {}), ...r, update, refresh };
  } catch (err) {
    // PR 4 whole-branch review (PR-3): a refusal must be measured against the capture server,
    // not asserted by construction — a sendPrompt that sent and THEN threw would otherwise print
    // `wire —` and match. Named mutant "SENTTHENREFUSED" (no unit test — the probe is not
    // requirable; the refuter's extracted-function repro is the evidence): `wire: null` literal.
    const posted = cap.captures.slice(captureStart).find((x) => x.method === 'POST') || null;
    return { ...base, error: err.message, wire: posted, capturedAfterRefusal: cap.captures.length - captureStart, assistant: null };
  } finally {
    if (handle) {
      try { handle.server.close(); engines.closed += 1; } catch (err) { engines.closeErrors.push(`${c.id}: ${err.message}`); }
    }
  }
}

/**
 * One row's verdict against its `want`. `reasoning` is compared against the SAME
 * merged value the table prints (`reasoning`, else `reasoning_effort`), so the
 * checks line and the table can never disagree; `thinking` is present/absent
 * only, because the budget itself is already pinned through `maxTokens`.
 * A case with no `want` at all is a MISMATCH, not a free pass — a matrix entry
 * that forgets its expectation is exactly the hole this check exists to close.
 * @param {object} r a runCase() result
 * @returns {'matched'|'mismatched'|'recorded'}
 */
function checkRow(r) {
  if (r.want === 'record') { return 'recorded'; }
  // PR 4: a row whose expectation is a REFUSAL before the wire — no capture at
  // all (measured: runCase's catch reads the captures taken since the case began), and the thrown reason starts with the code.
  if (r.want && typeof r.want === 'object' && typeof r.want.refused === 'string') {
    return (!r.wire && typeof r.error === 'string' && r.error.startsWith(r.want.refused)) ? 'matched' : 'mismatched';
  }
  if (!r.want || typeof r.want !== 'object') { return 'mismatched'; }
  const w = wireSummary(r.wire);
  const reasoning = w.reasoning ?? w.reasoningEffort ?? null;
  const ok = w.maxTokens === r.want.maxTokens
    // PR 4 (Task 7): `reasoning: 'any'` pins that an effort field is PRESENT, whatever its
    // shape -- the twin of `thinking: 'any'`. Needed because the sandbox cache is shared
    // across a run (see the M-group paragraph in the header): a row served by the first
    // engine reads the bundled catalogue, every later one the cached live catalogue, and
    // a model whose variant DEFINITION differs between the two (M9: openrouter/anthropic/
    // claude-haiku-4.5 -- bundled `reasoning.max_tokens 16000`, live `reasoning.effort high`)
    // must not have its want decided by case order. `max_tokens` is pinned as before.
    && (r.want.reasoning === 'any' ? reasoning !== null : JSON.stringify(reasoning) === JSON.stringify(r.want.reasoning ?? null))
    && (w.thinking !== null) === (r.want.thinking === 'any');
  if (!ok || !assistantMatches(r)) { return 'mismatched'; }
  // PR 4: a row that PATCHes the running engine also pins what the call did —
  // its status and whether it wrote/rewrote config.json in the engine's cwd.
  if (r.want.update) {
    const u = r.update || {};
    const touched = [...(u.newFiles || []), ...(u.changedFiles || [])].some((f) => f.endsWith('/config.json'));
    if (u.status !== r.want.update.status || touched !== r.want.update.configJson) { return 'mismatched'; }
  }
  return 'matched';
}

/**
 * The assistant half of a row's verdict (#218 PR 3): `finish`, the two token
 * counts and the text/reasoning part list, compared exactly. A row that pins
 * no `want.assistant` passes this by construction.
 * @param {object} r a runCase() result
 * @returns {boolean}
 */
function assistantMatches(r) {
  const wa = r.want && r.want.assistant;
  if (!wa) { return true; }
  const a = r.assistant || {};
  const t = a.tokens || {};
  return a.finish === wa.finish && t.output === wa.output && t.reasoning === wa.reasoning
    && JSON.stringify(a.parts || []) === JSON.stringify(wa.parts);
}

/**
 * The one machine-readable verdict line. Nothing else in this script's output
 * is checked by a machine, so this is what CI (or a human after an engine bump)
 * reads, and a non-zero `mismatched` is what makes the run exit 1.
 * @param {Array<object>} results
 * @param {string|null} onlyArg the raw `--only` value, or null for the whole matrix
 * @returns {{line: string, mismatched: number}}
 */
function checksLine(results, onlyArg) {
  const bad = [];
  let matched = 0;
  let recorded = 0;
  for (const r of results) {
    const v = checkRow(r);
    if (v === 'matched') { matched += 1; } else if (v === 'recorded') { recorded += 1; } else { bad.push(r.id); }
  }
  const ids = bad.length > 0 ? bad.join(',') : 'none';
  // A SUBSET's counts must never read as the full-matrix verdict — filed in a
  // record or skimmed on the terminal, `--only` has to be visible on the line
  // that carries the numbers, not just in the shell history that produced them.
  // `!== null`, not truthiness: a bare trailing `--only` parses as the EMPTY
  // string, which selects no case at all — the one run whose "0 matched" most
  // needs the marker (council #230 r4).
  const scope = onlyArg !== null ? ` — partial run (--only ${onlyArg})` : '';
  return { line: `checks: ${matched} matched, ${bad.length} mismatched (${ids}), ${recorded} recorded${scope}`, mismatched: bad.length };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== INNER);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const onlyIdx = args.indexOf('--only');
  const onlyArg = onlyIdx >= 0 ? String(args[onlyIdx + 1] || '') : null;
  const only = onlyArg === null ? null : new Set(onlyArg.split(','));

  if (!assertSandboxed()) { process.exit(1); }

  const sdk = await import('@opencode-ai/sdk');
  const engine = { binary: resolveEngineBinary(), packageVersion: pkgVersion('opencode-ai'), sdkVersion: pkgVersion('@opencode-ai/sdk'), version: null };
  const cap = await startCapture();
  const engines = { started: 0, closed: 0, closeErrors: [] };
  const results = [];
  const providers = {};
  const updates = {};
  for (const c of CASES) {
    if (only && !only.has(c.id)) { continue; }
    const row = await runCase(sdk, cap, c, engines, providers, updates);
    engine.version = engine.version || row.engineVersion || null;
    results.push(row);
  }
  await cap.close();

  process.stdout.write(`\nengine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion}), server reports ${engine.version || '?'}\nbinary: ${engine.binary}\n\n`);
  process.stdout.write('| id | case | expected | env | wire path | max_tokens | reasoning | thinking | prompt status | assistant finish | assistant variant | assistant error | assistant tokens in/out/reasoning | assistant parts |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n');
  for (const r of results) {
    const w = wireSummary(r.wire);
    const a = r.assistant || {};
    const t = a.tokens || null;
    const status = `${cell(r.status)}${r.error ? ' ' + cell(r.error.slice(0, 60)) : ''}`;
    process.stdout.write(`| ${cell(r.id)} | ${cell(r.title)} | ${cell(r.expect)} | ${cell(r.env)} | ${cell(w.path)} | ${cell(w.maxTokens)} | ${cell(w.reasoning ?? w.reasoningEffort)} | ${cell(w.thinking)} | ${status} | ${cell(a.finish)} | ${cell(a.variant)} | ${cell(a.error)} | ${t ? cell(`${t.input}/${t.output}/${t.reasoning}`) : cell(null)} | ${a.parts ? cell(a.parts.join(',') || '(none)') : cell(null)} |\n`);
  }
  process.stdout.write('\n/config/providers per model:\n');
  for (const [k, v] of Object.entries(providers)) { process.stdout.write(`- ${k}: ${JSON.stringify(v)}\n`); }
  if (Object.keys(updates).length > 0) {
    process.stdout.write('\nPATCH /config per case (status, error, sandbox files the call created, /config/providers afterwards):\n');
    for (const [k, v] of Object.entries(updates)) { process.stdout.write(`- ${k}: ${JSON.stringify(v)}\n`); }
  }
  const checks = checksLine(results, onlyArg);
  process.stdout.write(`\n${checks.line}\n`);
  process.stdout.write(`\nengines: ${engines.started} started, ${engines.closed} closed${engines.closeErrors.length ? ` (close errors: ${engines.closeErrors.join('; ')})` : ''}\n`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, engines, providers, updates, checks: checks.line, cases: results }, null, 2));
    process.stdout.write(`\nraw captures: ${outPath}\n`);
  }
  // A moved cell is a FAILED run, not a new table to file.
  if (checks.mismatched > 0) { process.exitCode = 1; }
}

if (process.argv.slice(2).includes(INNER)) {
  main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
} else {
  process.exit(runOuter(process.argv.slice(2)));
}
