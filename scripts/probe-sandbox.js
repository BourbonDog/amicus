#!/usr/bin/env node

/**
 * Wave 3.0 Read D — the credential-scrubbed sandbox + capture server, factored
 * out of the #218 harness so two new probes can share one copy of it.
 *
 * Nothing here is new behaviour. `runOuter`/`assertSandboxed` are
 * scripts/probe-max-tokens.js:132-219 verbatim in substance (the same shape
 * scripts/probe-agent-wire.js copied for Read B); `startCapture`/`sse` are
 * scripts/probe-max-tokens.js:282-329 with the responder made pluggable so a
 * caller can HOLD a request open instead of answering it; `startEngine` is
 * scripts/probe-max-tokens.js:387-397 — the env flag set around the SYNCHRONOUS
 * createOpencodeServer call only, exactly as src/utils/engine-output-flag.js ::
 * withOutputTokenFlag ships it. probe-max-tokens.js and probe-agent-wire.js are
 * NOT edited by Read D; this module is additive.
 *
 * SAFETY (identical to #218): a file that requires this module is only an OUTER
 * wrapper until it re-execs itself with `--inner` under the env buildKeylessEnv
 * returns — throwaway sandbox home, every provider key, legacy key name and
 * OPENCODE credential/config channel scrubbed, HOME/USERPROFILE/XDG/APPDATA
 * repointed inside it. The INNER half calls assertSandboxed() and refuses to
 * start an engine unless every scrubbed name is undefined, HOME is a probe
 * sandbox and cwd is inside it. The provider always points at the local capture
 * server; `apiKey: 'probe-key'` is defence in depth. No Authorization header is
 * ever sent anywhere, and the capture server strips the one the engine sends it.
 */

'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const INNER = '--inner';
const SANDBOX_PREFIX = 'amicus-probe-home-';
const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * OUTER half: re-exec `file` with `--inner` under a credential-free env rooted
 * at a throwaway home. Never starts an engine itself.
 * @param {string} file the probe's __filename
 * @param {string[]} args the original argv tail (forwarded verbatim)
 * @param {string} defaultOut the --out path used when the caller passed none
 * @returns {number} the inner run's exit code
 */
function runOuter(file, args, defaultOut) {
  const { buildKeylessEnv } = require('./run-integration-keyless');
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
  try {
    const env = buildKeylessEnv(process.env, sandboxHome);
    const projectDir = path.join(sandboxHome, 'project');
    for (const d of [sandboxHome, env.XDG_DATA_HOME, env.XDG_CONFIG_HOME, env.APPDATA, projectDir]) {
      try { fs.mkdirSync(d, { recursive: true }); } catch { /* best effort */ }
    }
    delete env[FLAG]; // the inner half sets it per engine, never ambiently
    env.OPENCODE_DISABLE_AUTOUPDATE = '1';
    const innerArgs = [...args];
    const outIdx = innerArgs.indexOf('--out');
    if (outIdx >= 0 && innerArgs[outIdx + 1]) { innerArgs[outIdx + 1] = path.resolve(innerArgs[outIdx + 1]); }
    else { innerArgs.push('--out', path.resolve(defaultOut)); }
    const result = spawnSync(process.execPath, [file, INNER, ...innerArgs],
      { env, stdio: 'inherit', cwd: projectDir });
    if (result.error) {
      process.stderr.write(`probe: inner run failed to launch: ${result.error.message}\n`);
      return 1;
    }
    return result.status === null ? 1 : result.status;
  } finally {
    try { fs.rmSync(sandboxHome, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}

/** @returns {boolean} true only when every credential name is gone and HOME is the sandbox. */
function assertSandboxed() {
  const { PROVIDER_ENV_MAP, LEGACY_KEY_NAMES } = require('../src/utils/api-key-store');
  const { ENGINE_CREDENTIAL_ENV } = require('./run-integration-keyless');
  const names = [...new Set([...Object.values(PROVIDER_ENV_MAP),
    ...Object.keys(LEGACY_KEY_NAMES), ...ENGINE_CREDENTIAL_ENV])];
  const refuse = (why) => {
    process.stderr.write(`probe: REFUSING to start an engine — ${why}\n`);
    return false;
  };
  const present = names.filter((n) => process.env[n] !== undefined);
  if (present.length > 0) { return refuse(`still defined: ${present.join(',')}`); }
  const home = process.env.HOME || '';
  if (!path.basename(home).startsWith(SANDBOX_PREFIX)) {
    return refuse(`HOME is not a probe sandbox (${home || '(unset)'})`);
  }
  if (!(path.resolve(process.cwd()) + path.sep).startsWith(path.resolve(home) + path.sep)) {
    return refuse(`cwd ${process.cwd()} is outside the sandbox home`);
  }
  process.stdout.write(`sandbox: HOME=${home} cwd=${process.cwd()} keys-absent=${names.join(',')}\n`);
  return true;
}

const DEFAULT_USAGE = { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 };

/**
 * Answer one chat-completions request as an OpenAI-shaped SSE stream.
 * @param {import('http').ServerResponse} res
 * @param {string} model echoed back in every chunk
 * @param {{content?: string, finish?: string, usage?: object, toolCall?: {name: string, args: object}}} [opts]
 */
function sse(res, model, opts = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const base = { id: 'probe', object: 'chat.completion.chunk', created: 0, model };
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const finish = opts.finish || 'length';
  if (opts.toolCall) {
    chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_probe_1', type: 'function', function: { name: opts.toolCall.name, arguments: '' } }] }, finish_reason: null }] });
    chunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(opts.toolCall.args) } }] }, finish_reason: null }] });
    chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: opts.usage || DEFAULT_USAGE });
  } else {
    chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: opts.content === undefined ? 'ok' : opts.content }, finish_reason: null }] });
    chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: opts.usage || DEFAULT_USAGE });
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * A local server that plays the provider. Every request body is captured before
 * the responder runs; the Authorization / x-api-key headers are dropped from the
 * record so no key-shaped string can ever land in an artifact.
 * @param {(ctx: {req: object, res: object, body: object, capture: object, sse: Function}) => void} [responder]
 *   called for POST /chat/completions. Omitted ⇒ a normal SSE answer. A responder
 *   that returns without touching `res` HOLDS the connection open.
 * @returns {Promise<{captures: object[], origin: string, close: Function}>}
 */
function startCapture(responder) {
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
      const capture = { at: Date.now(), method: req.method, url: req.url, headers, body };
      captures.push(capture);
      if (req.method === 'POST' && /\/chat\/completions(\?.*)?$/.test(req.url)) {
        if (responder) { responder({ req, res, body, capture, sse }); return; }
        sse(res, body && body.model);
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'probe: captured' } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      captures,
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
}

/**
 * Start one sandboxed engine. The output-token flag is set around the
 * SYNCHRONOUS createOpencodeServer call only and restored before the await —
 * the discipline src/utils/engine-output-flag.js :: withOutputTokenFlag ships,
 * because the pinned SDK spreads process.env before its first await.
 * @param {object} sdk the imported @opencode-ai/sdk namespace
 * @param {object} config the engine config
 * @param {string|undefined} flag the OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX value ('64000'), or undefined
 * @returns {Promise<{server: object, client: object}>}
 */
async function startEngine(sdk, config, flag) {
  const saved = process.env[FLAG];
  if (flag === undefined) { delete process.env[FLAG]; } else { process.env[FLAG] = flag; }
  let pending;
  try {
    pending = sdk.createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 60000, config });
  } finally {
    if (saved === undefined) { delete process.env[FLAG]; } else { process.env[FLAG] = saved; }
  }
  const server = await pending;
  return { server, client: sdk.createOpencodeClient({ baseUrl: server.url }) };
}

/** @returns {string} the engine binary a PATH scan finds (not necessarily the one the SDK spawns). */
function resolveEngineBinary() {
  const names = process.platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode'];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) { return p; }
    }
  }
  return '(opencode not found on PATH)';
}

/** @param {string} name package name @returns {string} its version, or '?' */
function pkgVersion(name) {
  try { return require(`${name}/package.json`).version; } catch { /* exports map may hide it */ }
  const p = path.join(__dirname, '..', 'node_modules', ...name.split('/'), 'package.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).version; } catch { return '?'; }
}

/** @returns {{binary: string, packageVersion: string, sdkVersion: string, amicus: string}} */
function engineHeader() {
  return {
    binary: resolveEngineBinary(),
    packageVersion: pkgVersion('opencode-ai'),
    sdkVersion: pkgVersion('@opencode-ai/sdk'),
    amicus: require('../package.json').version,
  };
}

module.exports = {
  INNER, FLAG, SANDBOX_PREFIX, DEFAULT_USAGE,
  sleep, runOuter, assertSandboxed, startCapture, sse, startEngine,
  resolveEngineBinary, pkgVersion, engineHeader,
};
