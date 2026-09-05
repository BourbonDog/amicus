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
 * once the flag is set to the budget (K4/K6/K11/K12/K13). Those rows are the
 * canary for opencode-client.js :: startServer's flag wiring as well as for
 * the engine: if a bump stops the flag reaching the spawn, K6/K12/K13 read
 * 32000.
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
  process.stdout.write(`sandbox: HOME=${home} keys-absent=${names.join(',')}\n`);
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
const LOW = { effort: 'low' };

const CASES = [
  { id: 'A',  title: 'bare {} descriptor', or: { [KIMI]: {} }, model: OR(KIMI), expect: 'max_tokens 32000, no reasoning', want: W(32000) },
  { id: 'B',  title: 'limit.output 4096', or: { [KIMI]: { limit: { context: CTX, output: 4096 } } }, model: OR(KIMI), expect: '4096', want: W(4096) },
  { id: 'C1', title: 'env 64000 + limit.output 100000', env: '64000', or: { [KIMI]: { limit: { context: CTX, output: 100000 } } }, model: OR(KIMI), expect: '64000', want: W(64000) },
  { id: 'C2', title: 'env 64000 + limit.output 50000', env: '64000', or: { [QWEN]: { limit: { context: 1000000, output: 50000 } } }, model: OR(QWEN), expect: '50000', want: W(50000) },
  { id: 'C3', title: 'env 64000 + bare {} (engine reports ceiling 1048576)', env: '64000', or: { [KIMI]: {} }, model: OR(KIMI), expect: '64000', want: W(64000) },
  { id: 'D1', title: 'env 64000abc (malformed)', env: '64000abc', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000 silently', want: W(32000) },
  { id: 'D2', title: 'env 0', env: '0', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000', want: W(32000) },
  { id: 'E1', title: 'options.max_tokens 4096', or: { [KIMI]: { options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '4096 — options.max_tokens reaches the wire (measured 2026-09-04; the plan predicted "dropped")', want: W(4096) },
  { id: 'E2', title: 'options.reasoning {effort:low}', or: { [KIMI]: { options: { reasoning: { effort: 'low' } } } }, model: OR(KIMI), expect: 'reasoning effort low on the wire', want: W(32000, LOW) },
  { id: 'F1', title: 'amicus sendPrompt today: body.reasoning {effort:low}', or: { [KIMI]: {} }, model: OR(KIMI), viaAmicus: true, reasoning: { effort: 'low' }, expect: 'NO reasoning on the wire', want: W(32000) },
  { id: 'F2', title: "prompt variant 'low' (kimi: low, high, max)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'low' }, expect: 'reasoning effort low', want: W(32000, LOW) },
  // F3's expectation — "silent no-op OR error" — is satisfied by either outcome,
  // so it cannot fail. `want: 'record'` says so out loud instead of letting a
  // hand-written pass/fail pretend the row was checked.
  { id: 'F3', title: "prompt variant 'medium' (kimi has no medium)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'medium' }, expect: 'record: silent no-op or error', want: 'record' },
  { id: 'F4', title: "prompt variant 'medium' (qwen has medium)", or: { [QWEN]: {} }, model: OR(QWEN), extra: { variant: 'medium' }, expect: 'reasoning effort medium', want: W(32000, { effort: 'medium' }) },
  { id: 'H1', title: 'direct anthropic haiku {}', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '32000', want: W(32000) },
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
 * Run one case end to end against its own engine. Never throws: a failure
 * becomes the row. The providers dump happens HERE, while the engine that
 * serves this case is still alive -- the finally below kills it.
 */
async function runCase(sdk, cap, c, engines, providers) {
  const base = { id: c.id, title: c.title, expect: c.expect, want: c.want ?? null, env: c.env ?? null };
  let handle = null;
  try {
    handle = await startEngine(sdk, buildConfig(cap.origin, c), c.env);
    engines.started += 1;
    const key = `${c.model.providerID}/${c.model.modelID}`;
    if (!providers[key] && isBareDescriptor(c)) {
      try { providers[key] = await providersDump(handle.client, c.model.providerID, c.model.modelID, c.id); } catch (err) { providers[key] = { fromCase: c.id, error: err.message }; }
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
  if (!r.want || typeof r.want !== 'object') { return 'mismatched'; }
  const w = wireSummary(r.wire);
  const reasoning = w.reasoning ?? w.reasoningEffort ?? null;
  const ok = w.maxTokens === r.want.maxTokens
    && JSON.stringify(reasoning) === JSON.stringify(r.want.reasoning ?? null)
    && (w.thinking !== null) === (r.want.thinking === 'any');
  return ok ? 'matched' : 'mismatched';
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
  for (const c of CASES) {
    if (only && !only.has(c.id)) { continue; }
    const row = await runCase(sdk, cap, c, engines, providers);
    engine.version = engine.version || row.engineVersion || null;
    results.push(row);
  }
  await cap.close();

  process.stdout.write(`\nengine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion}), server reports ${engine.version || '?'}\nbinary: ${engine.binary}\n\n`);
  process.stdout.write('| id | case | expected | env | wire path | max_tokens | reasoning | thinking | prompt status | assistant finish | assistant variant | assistant error |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n');
  for (const r of results) {
    const w = wireSummary(r.wire);
    const a = r.assistant || {};
    const status = `${cell(r.status)}${r.error ? ' ' + cell(r.error.slice(0, 60)) : ''}`;
    process.stdout.write(`| ${cell(r.id)} | ${cell(r.title)} | ${cell(r.expect)} | ${cell(r.env)} | ${cell(w.path)} | ${cell(w.maxTokens)} | ${cell(w.reasoning ?? w.reasoningEffort)} | ${cell(w.thinking)} | ${status} | ${cell(a.finish)} | ${cell(a.variant)} | ${cell(a.error)} |\n`);
  }
  process.stdout.write('\n/config/providers per model:\n');
  for (const [k, v] of Object.entries(providers)) { process.stdout.write(`- ${k}: ${JSON.stringify(v)}\n`); }
  const checks = checksLine(results, onlyArg);
  process.stdout.write(`\n${checks.line}\n`);
  process.stdout.write(`\nengines: ${engines.started} started, ${engines.closed} closed${engines.closeErrors.length ? ` (close errors: ${engines.closeErrors.join('; ')})` : ''}\n`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, engines, providers, checks: checks.line, cases: results }, null, 2));
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
