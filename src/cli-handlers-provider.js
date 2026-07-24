/**
 * `amicus provider add|list|test|remove` (v4.2 §4.6): configure local /
 * OpenAI-compatible providers (Ollama, LM Studio, vLLM, any OpenAI-compatible
 * endpoint). Writes config.providers, stores bearer secrets in the 0600 .env
 * (never in config), probes the endpoint, and runs the shared per-provider
 * default picker on a reachable server. DI-injected (print/emitJson/warn/probe/
 * readCache/runDefault) so it is unit-testable without a TTY or a live server;
 * `--json` is fully non-interactive.
 */
'use strict';

const {
  PRESETS, RESERVED_IDS, ID_RE, validateProviderEntry, deriveKeyEnv, getLocalProviders,
} = require('./utils/local-providers');

function realDeps() {
  return {
    loadConfig: () => require('./utils/config').loadConfig(),
    saveConfig: (c) => require('./utils/config').saveConfig(c),
    // Bearer persistence: saveRawEnv writes an arbitrary env-var NAME to the 0600
    // .env (re-exported from api-key-store). Named per the Task 10 DI contract.
    saveApiKey: (env, val) => require('./utils/api-key-store').saveRawEnv(env, val),
    // Bearer cleanup (post-Task-11-review flow-gap fix): removeRawEnv deletes an
    // arbitrary env-var NAME line from the same .env. Named to mirror saveApiKey.
    removeApiKey: (env) => require('./utils/api-key-store').removeRawEnv(env),
    probe: (e, o) => require('./utils/local-probe').probeLocalProvider(e, o),
    readCache: () => require('./utils/model-catalog').readCache(),
    runDefault: (id, o) => require('./utils/provider-default-prompt').runProviderDefaultFlow(id, o),
    print: (l) => process.stdout.write(`${l}\n`),
    emitJson: (o) => process.stdout.write(`${JSON.stringify(o, null, 2)}\n`),
    warn: (l) => process.stderr.write(`${l}\n`),
  };
}

/** Exact-hostname loopback test (substring matching would pass 127.0.0.1.evil.com). */
function isLoopbackUrl(baseURL) {
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(baseURL).hostname);
  } catch { return false; }
}

/** A bearer here would traverse the network in cleartext (plain http, non-loopback). */
function isPlaintextRemote(baseURL) {
  try { return new URL(baseURL).protocol === 'http:' && !isLoopbackUrl(baseURL); }
  catch { return false; }
}

/** Build the entry from --preset or --url (+ optional bearer/pricing). */
function entryFromArgs(id, args) {
  // hasOwnProperty guard: args.preset is user input; a bare PRESETS[args.preset]
  // for 'constructor' would walk the prototype chain (the recurring v4.2 bug class).
  const preset = (args.preset && Object.prototype.hasOwnProperty.call(PRESETS, args.preset))
    ? PRESETS[args.preset] : null;
  const baseURL = args.url || (preset && preset.baseURL);
  const flavor = (preset && preset.flavor) || 'generic';
  // D15/M13: every PRESETS entry carries a baseURL, so this fires only when NEITHER
  // flag was given, or when --preset named something unknown — distinguish the two.
  if (!baseURL) {
    return { error: args.preset && !preset
      ? `unknown --preset '${args.preset}' (expected: ${Object.keys(PRESETS).join('|')})`
      : 'a --preset or --url is required' };
  }
  const entry = { type: 'openai-compatible', baseURL, flavor };
  if (args['pricing-in'] !== undefined || args['pricing-out'] !== undefined) {
    entry.pricing = { prompt: Number(args['pricing-in']) || 0, completion: Number(args['pricing-out']) || 0 };
  }
  if (args['bearer-env']) { entry.apiKeyEnv = args['bearer-env']; }
  else if (args.bearer) { entry.apiKeyEnv = deriveKeyEnv(id); }
  return { entry, bearerValue: args.bearer };
}

/** Warn when the cached catalog already carries an `openrouter/<id>/` namespace (decision 5). */
function shadowsGatewayNamespace(cache, id) {
  return !!(cache && Array.isArray(cache.models) && cache.models.some(
    (m) => m && typeof m.id === 'string' && m.id.startsWith(`openrouter/${id}/`)));
}

async function doAdd(id, args, d) {
  // D7: the CLI owns id validation (validateProviderEntry is id-agnostic).
  if (!ID_RE.test(id || '') || RESERVED_IDS.includes(id)) {
    d.warn(`Invalid or reserved provider id: '${id}'.`); return 1;
  }
  const built = entryFromArgs(id, args);
  if (built.error) { d.warn(built.error); return 1; }
  const v = validateProviderEntry(built.entry); // enforces the http/https scheme allowlist
  if (!v.ok) { d.warn(v.error); return 1; }
  // Security (spec §4.10): a bearer over plain http to a non-loopback host is cleartext.
  if (built.bearerValue && isPlaintextRemote(built.entry.baseURL)) {
    d.warn('Warning: sending a bearer token over plain http:// to a non-loopback host transmits it in cleartext.');
  }
  if (shadowsGatewayNamespace(d.readCache(), id)) {
    d.warn(`Note: '${id}' shadows an OpenRouter vendor namespace for bare model ids. ` +
      `Use openrouter/${id}/... to reach OpenRouter.`);
  }
  // Persist the bearer FIRST so a rejected env-var name aborts before we write config.
  // M12: saveRawEnv returns {success:false,error} WITHOUT throwing — mirror the
  // direct-vendor path (cli-handlers.js:156) and bail before saveConfig.
  if (built.entry.apiKeyEnv && built.bearerValue) {
    const saved = d.saveApiKey(built.entry.apiKeyEnv, built.bearerValue);
    if (saved && saved.success === false) { d.warn(saved.error); return 1; }
  }
  const config = d.loadConfig() || {};
  config.providers = config.providers || {};
  config.providers[id] = v.normalized;
  // B7/D4: do NOT seed config.default here. A bare id is unresolvable by resolveModel
  // unless config.aliases[id] exists, and only applyProviderDefault (via d.runDefault,
  // on a successful probe) writes that pair (alias first, then default). Seeding it
  // before the probe permanently breaks every later keyless start/fanout/continue.
  d.saveConfig(config);
  // Probe (best-effort; a failure never blocks the save — air-gap rule).
  const probe = await d.probe({ ...v.normalized, id }, { timeoutMs: 2000, bearer: built.bearerValue });
  if (probe.status === 'ok') {
    d.print(`Added '${id}' — ${probe.models.length} model(s) found.`);
    try {
      const catalog = probe.models.map((mid) => ({ id: mid, pricing: v.normalized.pricing, local: true }));
      const { summaryLine } = await d.runDefault(id, { interactive: false, catalog });
      if (summaryLine) { d.print(summaryLine); }
    } catch { /* picker is best-effort; a bug here must never fail an already-saved add */ }
  } else {
    d.warn(`Added '${id}' but the endpoint was unreachable — check the server and run \`amicus provider test ${id}\`.`);
  }
  if (args.json) { d.emitJson({ ok: true, id, reachable: probe.status === 'ok', models: probe.models }); }
  return 0;
}

async function doTest(id, args, d) {
  const map = getLocalProviders();
  // hasOwnProperty guard (trap #6): map[id] for id==='constructor' is a proto walk.
  if (!id || !Object.prototype.hasOwnProperty.call(map, id)) { d.warn(`No local provider '${id}'.`); return 1; }
  const entry = map[id];
  const bearer = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined;
  const probe = await d.probe(entry, { timeoutMs: 2000, bearer });
  const ok = probe.status === 'ok';
  // Never surface the Authorization header / token — only the boolean presence.
  if (args.json) { d.emitJson({ ok, id, reachable: ok, models: probe.models, bearer: !!bearer }); }
  else { d.print(ok ? `${id}: ${probe.models.length} model(s) @ ${entry.baseURL}` : `${id}: unreachable @ ${entry.baseURL}`); }
  return ok ? 0 : 1;
}

function doList(args, d) {
  const providers = Object.values(getLocalProviders()).map(
    (e) => ({ id: e.id, baseURL: e.baseURL, flavor: e.flavor, bearer: !!e.apiKeyEnv }));
  if (args.json) { d.emitJson({ providers }); }
  else if (providers.length === 0) { d.print('No local providers configured. Add one: amicus provider add ollama --preset ollama'); }
  else { for (const p of providers) { d.print(`${p.id}  ${p.baseURL}  [${p.flavor}]${p.bearer ? '  (bearer)' : ''}`); } }
  return 0;
}

function doRemove(id, args, d) {
  const config = d.loadConfig() || {};
  const providers = config.providers || {};
  // hasOwnProperty guards (trap #6): providers[id]/aliases[id] proto walks for 'constructor'.
  if (!id || !Object.prototype.hasOwnProperty.call(providers, id)) { d.warn(`No local provider '${id}'.`); return 1; }
  const entry = providers[id];
  delete providers[id];
  if (config.default === id) { delete config.default; }
  if (config.aliases && Object.prototype.hasOwnProperty.call(config.aliases, id)) { delete config.aliases[id]; }
  d.saveConfig(config);

  // Flow-gap fix (post-Task-11-review): the old hint ("remove it with `amicus key
  // <id> --remove`") pointed at a command that fails the instant the config entry
  // above is gone -- isLocalProvider/getLocalProviders derive local-id status from
  // config.providers on every call. Remove the bearer ourselves instead, UNLESS a
  // sibling id still shares this apiKeyEnv via --bearer-env, in which case deleting
  // the line would break that sibling. Iterate remaining OWN keys only (trap #6).
  let bearerRemoved = false;
  let sharedWith = null;
  if (entry.apiKeyEnv) {
    sharedWith = Object.keys(providers).find((otherId) => {
      const other = providers[otherId];
      return other && other.apiKeyEnv === entry.apiKeyEnv;
    }) || null;
    if (!sharedWith) {
      d.removeApiKey(entry.apiKeyEnv);
      bearerRemoved = true;
    }
  }

  if (args.json) {
    d.emitJson({ ok: true, removed: id, bearerRemoved });
  } else if (bearerRemoved) {
    d.print(`Removed '${id}' and its bearer '${entry.apiKeyEnv}'.`);
  } else if (sharedWith) {
    d.print(`Removed '${id}'. Kept '${entry.apiKeyEnv}' in .env — still used by provider '${sharedWith}'.`);
  } else {
    d.print(`Removed '${id}'.`);
  }
  return 0;
}

/**
 * @param {object} args parsed CLI args (args._ = ['provider', <sub>, <id?>])
 * @param {object} [deps] DI overrides (print/emitJson/warn/probe/readCache/...)
 * @returns {Promise<number>} exit code
 */
async function handleProvider(args, deps = {}) {
  const d = { ...realDeps(), ...deps };
  const sub = args._[1];
  const id = args._[2];
  if (sub === 'add') { return doAdd(id, args, d); }
  if (sub === 'test') { return doTest(id, args, d); }
  if (sub === 'list') { return doList(args, d); }
  if (sub === 'remove') { return doRemove(id, args, d); }
  d.warn('Usage: amicus provider add|list|test|remove [--json]');
  return 1;
}

// isLoopbackUrl/isPlaintextRemote are also reused by cli-handlers-key-local.js's
// handleLocalKey (B2, whole-branch review) so the `amicus key <localId> <token>`
// surface warns about cleartext bearer transmission with the SAME exact-hostname
// check `provider add` uses here, instead of growing a second, divergent check.
module.exports = { handleProvider, isLoopbackUrl, isPlaintextRemote };
