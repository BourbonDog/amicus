/**
 * CLI Command Handlers
 *
 * Extracted from bin/amicus.js to keep the CLI entry point
 * under the 300-line limit.
 */

'use strict';

// handleAbort moved to src/cli-handlers-abort.js (B21-rest: --json branch
// needed headroom this file didn't have). Re-exported below for compatibility.
const { handleAbort } = require('./cli-handlers-abort');
// handleKey's local-provider branch (v4.2 Task 11) lives in its own module for
// the same reason — this file had no headroom left for the new bearer flow.
const { handleLocalKey, formatLocalKeyList } = require('./cli-handlers-key-local');

/**
 * Handle 'amicus setup' command
 * Runs interactive setup wizard or adds an alias via --add-alias
 */
async function handleSetup(args) {
  const { addAlias, runInteractiveSetup, runApiKeySetup } = require('./sidecar/setup');

  // Standalone API key window
  if (args['api-keys']) {
    const success = await runApiKeySetup();
    if (success) {
      console.log('API keys configured successfully.');
    } else {
      console.log('API key setup was not completed.');
      process.exit(1);
    }
    return;
  }

  if (args['add-alias']) {
    const spec = args['add-alias'];
    const eqIndex = spec.indexOf('=');
    if (eqIndex === -1) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    const name = spec.slice(0, eqIndex);
    const model = spec.slice(eqIndex + 1);
    if (!name || !model) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    addAlias(name, model);
    console.log(`Alias '${name}' added: ${model}`);
    // F5: warn (never block) when the model is absent from a checkable catalog.
    try {
      const { getCatalog } = require('./utils/model-catalog');
      const { findStaleAliases, suggestReplacements } = require('./utils/alias-audit');
      const catalog = await getCatalog();
      const stale = findStaleAliases([{ alias: name, model, source: 'user-config' }], catalog);
      if (stale.length > 0) {
        const candidates = suggestReplacements(model, catalog);
        console.warn(
          `Warning: '${model}' not found in the model catalog.` +
          (candidates.length > 0 ? ` Did you mean: ${candidates.join(', ')}` : '') +
          `\nDouble-check with: amicus models --search ${model.split('/').pop()}`
        );
      }
    } catch { /* warn-only path */ }
    return;
  }

  await runInteractiveSetup();
}

/**
 * Handle 'amicus update' command
 * Updates amicus to the latest version
 */
async function handleUpdate() {
  const { performUpdate, getUpdateInfo, initUpdateCheck } = require('./utils/updater');
  await initUpdateCheck();
  const info = getUpdateInfo();
  if (info) {
    console.log(`Updating amicus ${info.current} → ${info.latest}...`);
  } else {
    console.log('Updating amicus to latest...');
  }
  const result = await performUpdate();
  if (result.success) {
    console.log("Updated successfully! Run 'amicus --version' to verify.");
  } else {
    console.error(`Update failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Handle 'amicus mcp' command
 * Starts the MCP server on stdio transport
 */
async function handleMcp() {
  const { startMcpServer } = require('./mcp-server');
  await startMcpServer();
}

/**
 * Handle 'amicus key' command
 * Lists, saves, or removes API keys for a provider without opening the Electron wizard.
 * Local (openai-compatible) providers are config-defined (local-providers.js)
 * rather than in PROVIDER_ENV_MAP, so they're handled by handleLocalKey — a
 * bearer probe/store flow, not the VALIDATION_ENDPOINTS ping the 5 direct
 * vendors use.
 */
async function handleKey(args) {
  const { readApiKeys, readApiKeyHints, saveApiKey, removeApiKey, loadEnvEntries, PROVIDER_ENV_MAP } = require('./utils/api-key-store');
  const { validateApiKey } = require('./utils/api-key-validation');
  const { getLocalProviders } = require('./utils/local-providers');

  const provider = args._[1];
  const keyArg = args._[2];

  // List mode: no provider given
  if (!provider) {
    const configured = readApiKeys();
    const hints = readApiKeyHints();
    const knownProviders = Object.keys(PROVIDER_ENV_MAP);
    console.log('');
    console.log('Configured API keys:');
    for (const p of knownProviders) {
      const status = configured[p] ? `✓  ${hints[p]}` : '✗  not set';
      console.log(`  ${p.padEnd(12)} ${status}`);
    }
    const localProviders = getLocalProviders();
    if (Object.keys(localProviders).length > 0) {
      for (const line of formatLocalKeyList(localProviders, loadEnvEntries())) { console.log(line); }
    }
    console.log('');
    return;
  }

  // Local providers (Ollama/LM Studio/vLLM/any OpenAI-compatible endpoint) are
  // config-defined, not in PROVIDER_ENV_MAP — branch BEFORE the direct-vendor
  // check below. hasOwnProperty guard (recurring v4.2 bug class): a provider
  // literally named 'constructor' is a valid, non-reserved id (ID_RE/
  // RESERVED_IDS in local-providers.js) and must resolve to its real entry,
  // not the inherited Object.prototype.constructor.
  const localProviders = getLocalProviders();
  if (Object.prototype.hasOwnProperty.call(localProviders, provider)) {
    return handleLocalKey(localProviders[provider], provider, args);
  }

  // Validate provider. hasOwnProperty guard (same prototype-chain bug class the
  // local-provider branch above guards against): a bare PROVIDER_ENV_MAP[provider]
  // for provider === 'constructor' reads the inherited Object.prototype.constructor
  // (the Object function — truthy), which would wrongly treat an UNCONFIGURED
  // 'constructor' as a known direct vendor and crash later in validateApiKey
  // instead of reporting Unknown provider (caught by this task's own test suite).
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_ENV_MAP, provider)) {
    console.error(`Error: Unknown provider "${provider}". Known providers: ${Object.keys(PROVIDER_ENV_MAP).join(', ')}`);
    process.exit(1);
  }

  // Remove mode
  if (args.remove) {
    const result = removeApiKey(provider);
    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
    console.log(`${provider} key removed.`);
    return;
  }

  // Save mode: key required
  if (!keyArg) {
    console.error(`Error: API key is required. Usage: amicus key ${provider} <apikey>`);
    process.exit(1);
  }

  console.log(`Validating ${provider} key...`);
  const validation = await validateApiKey(provider, keyArg);
  // A 403 is NOT evidence the key is wrong — it is a disabled API, a quota, or
  // a region/bot block just as often; nor is a 429 or a 5xx, which say only
  // that the provider was busy or broken. Refusing to save on any of them is
  // the same false ALARM the doctor classifier stopped raising. This site
  // branched on the bare `valid` boolean, so the structured status added for
  // that fix never reached it and the alarm was merely reworded; the second
  // review then asked why the doctrine stopped at 403. It no longer does.
  // Only a definitive 401 — or a probe that reached no verdict at all — blocks.
  // Everything else warns, saves, and defers to `amicus doctor`.
  const NOT_A_VERDICT = new Set([403, 408, 429, 500, 502, 503, 504]);
  if (!validation.valid && NOT_A_VERDICT.has(validation.status)) {
    console.warn(`Warning: ${validation.error}`);
    console.warn('Saving the key anyway — run `amicus doctor` to re-check it later.');
  } else if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    process.exit(1);
  }

  const result = saveApiKey(provider, keyArg);
  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
  console.log(`${provider} key validated and saved.`);

  await offerProviderDefault(provider, args);
}

/**
 * After a successful key save, run the per-provider cost-aware default
 * picker (Part 2, Task 6) and print its one-line summary. Wrapped end-to-end
 * in try/catch: the key is ALREADY saved by the time this runs, so a picker
 * failure (offline catalog, bad input, etc.) must never abort `amicus key`
 * -- it just prints a soft notice instead.
 * @param {string} provider
 * @param {object} args parsed CLI args (checked for --json/--quiet to gate interactivity)
 */
async function offerProviderDefault(provider, args) {
  let rl = null;
  try {
    const { runProviderDefaultFlow } = require('./utils/provider-default-prompt');
    const { getCatalog } = require('./utils/model-catalog');

    const interactive = !!process.stdin.isTTY && !args.json && !args.quiet;

    let catalog = [];
    try { catalog = await getCatalog(); } catch { /* offline/empty: handled gracefully by the picker */ }

    let ask;
    if (interactive) {
      const readline = require('readline');
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      ask = (q) => new Promise((resolve) => rl.question(q, (answer) => resolve((answer || '').trim())));
    }

    const { summaryLine } = await runProviderDefaultFlow(provider, {
      interactive, ask, catalog, print: console.log,
    });
    console.log(summaryLine);
  } catch (err) {
    console.log(`Note: couldn't set a per-provider default (${err.message}). Run 'amicus key ${provider}' again later.`);
  } finally {
    if (rl) { rl.close(); }
  }
}

module.exports = {
  handleSetup,
  handleAbort,
  handleUpdate,
  handleMcp,
  handleKey,
};
