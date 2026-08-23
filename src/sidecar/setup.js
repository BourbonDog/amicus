/**
 * Sidecar Setup Wizard
 *
 * Provides interactive setup, alias management, and API key detection
 * for the sidecar configuration.
 *
 * runInteractiveSetup() is Electron-first: launches the GUI wizard,
 * falls back to runReadlineSetup() for headless environments.
 */

const path = require('path');
const readline = require('readline');
const { loadConfig, saveConfig, getDefaultAliases, getConfigDir } = require('../utils/config');
const { logger } = require('../utils/logger');

/**
 * Add a model alias to the existing config (or create config if none exists)
 * @param {string} name - Alias name
 * @param {string} modelString - Full model identifier
 */
function addAlias(name, modelString) {
  if (typeof name === 'string') { name = name.trim(); }
  if (typeof modelString === 'string') { modelString = modelString.trim(); }
  if (!name || typeof name !== 'string' || name === 'null') {
    throw new Error(`Invalid alias name: '${name}'. Alias name must be a non-empty string.`);
  }
  if (!modelString || typeof modelString !== 'string' || modelString === 'null') {
    throw new Error(
      `Invalid model value for alias '${name}': '${modelString}'. ` +
      'Model must be a non-empty string (e.g., openrouter/google/gemini-3.1-pro-preview).'
    );
  }
  const cfg = loadConfig() || { aliases: {} };
  if (!cfg.aliases) {
    cfg.aliases = {};
  }
  cfg.aliases[name] = modelString;
  saveConfig(cfg);
  logger.info('Alias added', { name, model: modelString });
}

/**
 * Ensure a config exists with the chosen default model. Read-modify-write:
 * preserves every pre-existing top-level key (aliases, councils, …) and only
 * fills in the default + any missing default aliases. Never clobbers.
 * @param {string} defaultModel - Default model alias or full model string
 * @returns {object} The resulting config object
 */
function createDefaultConfig(defaultModel) {
  const existing = loadConfig() || {};
  const cfg = {
    ...existing,
    default: existing.default || defaultModel,
    // Same restatement as the readline gate below (fix round 3, G-2): a spread
    // into `{}` re-materialises Object.prototype. `saveConfig` rebuilds this
    // into its own literal anyway, so this one is defense in depth rather than
    // a measured hole — recorded as such rather than claimed as a fix.
    aliases: { __proto__: null, ...getDefaultAliases(), ...(existing.aliases || {}) },
  };
  saveConfig(cfg);
  logger.info('Default config ensured', {
    default: cfg.default,
    aliasCount: Object.keys(cfg.aliases).length,
  });
  return cfg;
}

/**
 * Detect available API keys from .env file and process.env
 * @returns {{openrouter: boolean, google: boolean, openai: boolean, anthropic: boolean, deepseek: boolean}}
 */
function detectApiKeys() {
  const { readApiKeys } = require('../utils/api-key-store');
  return readApiKeys();
}

/**
 * #38 — Non-blocking OpenRouter credit warning. Reads the OpenRouter key
 * value, calls checkOpenRouterCredit, and prints a WARNING (never blocks) when
 * the key is zero-credit or free tier. Any failure is swallowed silently — a
 * credit probe must never stop setup from completing.
 */
/* eslint-disable no-console -- CLI wizard requires direct console output */
async function warnOnLowOpenRouterCredit() {
  try {
    const { readApiKeyValues } = require('../utils/api-key-store');
    const { checkOpenRouterCredit } = require('../utils/api-key-validation');
    const values = readApiKeyValues();
    const key = values && values.openrouter;
    if (!key) { return; }
    const { warning } = await checkOpenRouterCredit(key);
    if (warning) {
      console.log(`Warning: ${warning}`);
      console.log('');
    }
  } catch (err) {
    logger.debug('OpenRouter credit check skipped', { error: err.message });
  }
}
/* eslint-enable no-console */

/**
 * Prompt the user with a question via readline
 * @param {readline.Interface} rl - Readline interface
 * @param {string} prompt - Question text
 * @returns {Promise<string>} User's answer
 */
function askQuestion(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Resolve readline input against the live picks.
 * @returns {{alias?: string, modelId?: string, noUpgrade?: boolean}|null}
 *   alias  → numbered/named quick pick (upgrades that alias unless noUpgrade)
 *   modelId → free-form full model id (default only, no alias writes)
 */
function resolveChoice(input, picks, catalog) {
  const num = parseInt(input, 10);
  if (num >= 1 && num <= picks.length) {
    return { alias: picks[num - 1].alias };
  }
  if (input.includes('/')) {
    const known = (catalog || []).some(m => m && m.id === input);
    if (!known) {
      console.log(`Warning: '${input}' not found in the model catalog (offline or new model) — using it anyway.`); // eslint-disable-line no-console
    }
    return { modelId: input };
  }
  const cfg = loadConfig();
  // ⚠️ `__proto__: null` — v4.8 SI-22.4 fix round 3 (council G-2). `input` here
  // is FREE-FORM readline text, and the gate below is `aliases[input] !==
  // undefined`, so on a plain literal `toString` / `valueOf` / `constructor` /
  // `hasOwnProperty` all measured TRUE and returned `{alias: input, noUpgrade:
  // true}` — setup accepted them as existing aliases. Spreading a
  // null-prototype object into a bare `{}` produces a PLAIN object again, so the
  // curated-models fix does not reach this literal; the seed has to be restated.
  const aliases = { __proto__: null, ...getDefaultAliases(), ...((cfg && cfg.aliases) || {}) };
  if (aliases[input] !== undefined) {
    return { alias: input, noUpgrade: true };
  }
  return null;
}

/**
 * Launch the Electron setup wizard
 * @returns {Promise<{success: boolean, default?: string, keyCount?: number}>}
 */
async function launchWizard() {
  const { launchSetupWindow } = require('./setup-window');
  return launchSetupWindow();
}

/**
 * Local / self-hosted provider add step for the readline wizard (v4.2 §4.6,
 * Task 12). Thin re-export -- RULING D14 keeps the real implementation out of
 * this file (516 lines, grandfathered on check-file-sizes.js's exclude list).
 * Owning module: ./setup-local.
 * @param {(question: string) => Promise<string>} ask
 * @param {(line: string) => void} print
 * @param {object} [deps]
 * @returns {Promise<void>}
 */
function addLocalProviderInteractive(ask, print, deps) {
  return require('./setup-local').addLocalProviderInteractive(ask, print, deps);
}

/**
 * Standalone API key setup — launches the Electron window directly
 * Used by `sidecar setup --api-keys`
 * @returns {Promise<boolean>} true if keys were configured
 */
async function runApiKeySetup() {
  try {
    const result = await launchWizard();
    return result.success;
  } catch (err) {
    logger.warn('Could not launch setup window', { error: err.message });
    return false;
  }
}

/**
 * Seed/refresh the model catalog (F5). Never throws — setup must complete offline.
 * A floor-only/offline refresh returns [] (see model-catalog), reported as unavailable.
 * @param {(line: string) => void} [print] - defaults to console.log
 */
/* eslint-disable no-console -- CLI wizard requires direct console output */
async function seedCatalog(print) {
  const log = print ?? console.log;
  try {
    log('Refreshing model catalog...');
    const { refreshCatalog } = require('../utils/model-catalog');
    const models = await refreshCatalog();
    if (models.length > 0) {
      log(`Model catalog seeded (${models.length} models).`);
      return;
    }
  } catch (err) {
    logger.debug('Catalog seed failed', { error: err.message });
  }
  log('Model catalog unavailable (offline?) — it will refresh on first start.');
}

/**
 * Free OpenRouter council branch of the readline wizard. Requires
 * OPENROUTER_API_KEY; lists free catalog models, lets the user multi-pick
 * (Enter = the vendor-diverse default), seeds aliases + councils.free, and
 * never touches config.default.
 * @param {readline.Interface} rl
 * @param {Array<object>} [catalogArg] pre-fetched catalog from the caller
 *   (`runReadlineSetup` already fetches one for the per-provider phase) --
 *   reused as-is to avoid a second `getCatalog()` round trip. Falls back to
 *   fetching its own when omitted (e.g. direct unit-test callers).
 * @returns {Promise<boolean>} true when the branch actually seeded a council
 *   (a completed setup -- the caller then prints the C8 doctor finale, Finding
 *   2 post-review); false when it aborted early (no OPENROUTER_API_KEY, or
 *   fewer than 2 models picked) -- parity with the invalid-choice branch,
 *   which also configured nothing and so also gets no finale.
 */
async function runFreeCouncilBranch(rl, catalogArg) {
  const keys = detectApiKeys();
  if (!keys.openrouter) {
    console.log('');
    console.log('A free council needs OPENROUTER_API_KEY (free models route only through OpenRouter).');
    console.log('Set OPENROUTER_API_KEY and re-run: amicus setup. No changes made.');
    return false;
  }
  const { listFreeModels, suggestFreeCouncil, PINNED_FREE_MODELS } = require('../utils/free-models');
  let catalog = [];
  if (Array.isArray(catalogArg)) {
    catalog = catalogArg;
  } else {
    const { getCatalog } = require('../utils/model-catalog');
    try { catalog = await getCatalog(); } catch (_e) { /* offline */ }
  }
  let free = listFreeModels(catalog);
  if (free.length === 0) {
    console.log('Live free-model list unavailable (offline?) — using a small pinned set.');
    free = PINNED_FREE_MODELS.map(id => ({ id }));
  }
  const defaults = new Set(suggestFreeCouncil(free, 3).map(r => r.id));
  console.log('');
  console.log('Free OpenRouter models (★ = default council):');
  free.forEach((r, i) => {
    const star = defaults.has(r.id) ? '★' : ' ';
    console.log(`  ${star} ${i + 1}) ${r.id}`);
  });
  console.log('');
  const answer = await askQuestion(rl,
    'Pick members (comma-separated numbers, or Enter for the ★ default): ');
  let pickIds;
  if (!answer) {
    pickIds = free.filter(r => defaults.has(r.id)).map(r => r.id);
  } else {
    pickIds = answer.split(',').map(s => parseInt(s.trim(), 10))
      .filter(n => n >= 1 && n <= free.length).map(n => free[n - 1].id);
  }
  if (pickIds.length < 2) {
    console.log('A council needs at least 2 models. No changes made.');
    return false;
  }
  const { council } = seedFreeCouncil(pickIds);
  await seedCatalog();
  console.log('');
  console.log(`Free council saved: councils.free = [${council.join(', ')}]`);
  console.log('Run it:   amicus fanout --council free --prompt "..."');
  console.log('config.default left unchanged.');
  console.log('');
  console.log('Heads up (free tier): rate-limited & quality-variable; some models 404');
  console.log('unless you enable data-sharing at openrouter.ai/settings/privacy.');
  return true;
}

/**
 * Run the shared per-provider default-model picker (Task 6, `runProviderDefaultFlow`)
 * once for each keyed provider, in `foundKeys` detection order -- whichever
 * comes first seeds `config.default` (`applyProviderDefault`'s
 * seed-only-when-absent rule; see `provider-default-picker.js`). Each provider
 * is its own read-modify-write against the real config file, so an alias
 * written here is on disk before the standard model step's own `loadConfig()`
 * runs -- no clobber, no shared in-memory object to race.
 *
 * Skippable and crash-proof: `runProviderDefaultFlow` already degrades to a
 * graceful summary line on an empty/offline catalog (never calls `ask`), and
 * a per-provider try/catch means one provider's failure can't block the rest
 * of setup (mirrors `cli-handlers.js`'s `offerProviderDefault`). It's also a
 * graceful no-op for a gateway provider (`openrouter`) -- see
 * `runProviderDefaultFlow`'s `isDirectProvider` gate.
 * @param {readline.Interface} rl
 * @param {string[]} foundKeys keyed providers, in detection order
 * @param {Array<object>} catalog
 * @returns {Promise<Set<string>>} vendor alias NAMES actually written this run
 *   (i.e. `runProviderDefaultFlow` returned a non-null `chosenId`) -- the
 *   standard model step must not clobber these when a quick-pick family
 *   alias collides with one (see the standard-model-step alias-upgrade guard).
 */
async function runProviderDefaultPickers(rl, foundKeys, catalog) {
  const written = new Set();
  if (foundKeys.length === 0) { return written; }
  const { runProviderDefaultFlow } = require('../utils/provider-default-prompt');
  for (const provider of foundKeys) {
    try {
      const { chosenId, summaryLine } = await runProviderDefaultFlow(provider, {
        interactive: true,
        ask: (q) => askQuestion(rl, q),
        catalog,
        print: console.log,
      });
      if (chosenId) { written.add(provider); }
      console.log(summaryLine);
    } catch (err) {
      console.log(
        `Note: couldn't set a default for ${provider} (${err.message}). ` +
        `Run \`amicus key ${provider}\` again later.`
      );
    }
  }
  console.log('');
  return written;
}

/**
 * C8 (v4.2 §4.7) -- print the compact doctor summary at the wizard's finale.
 * Shared by runReadlineSetup and the Electron-success path of
 * runInteractiveSetup. Best-effort / guarded: a doctor bug (or a check that
 * throws) must never abort setup or change its outcome -- setup has already
 * done its job by the time this runs, so a failure here is swallowed.
 *
 * Injectable (post-review hardening, M14-class fix): `deps.runDoctorChecks`
 * lets tests replace the real doctor directly instead of relying on jest's
 * module-mock resolution coincidentally intercepting this function's own
 * lazy require (see tests/sidecar/setup.test.js's `cli-handlers-doctor`
 * mock, added for exactly this reason). Every production call site
 * (runReadlineSetup / runInteractiveSetup) calls this with no args, so the
 * default -- the real, network-probing runDoctorChecks -- is always what
 * actually ships.
 * @param {{runDoctorChecks?: () => Promise<Array<object>>}} [deps]
 */
async function printDoctorFinale(deps = {}) {
  try {
    const runDoctorChecks = deps.runDoctorChecks || require('../cli-handlers-doctor').runDoctorChecks;
    const { summarizeDoctor } = require('../utils/doctor-summary');
    const checks = await runDoctorChecks();
    console.log('');
    console.log(summarizeDoctor(checks));
  } catch (err) {
    logger.debug('Doctor finale skipped', { error: err.message });
  }
}

/**
 * Run the readline-based setup wizard (headless fallback)
 *
 * Guides the user through:
 * 1. API key detection
 * 2. Per-provider default-model picker (Task 7) -- once per keyed provider
 * 3. Mode selection (standard or free council)
 * 4. Default model selection from live quick-picks (read-modify-write, no clobber)
 * 5. Config file save
 * 6. C8: a compact `amicus doctor` summary, best-effort
 */
async function runReadlineSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log('');
    console.log('=== Amicus Setup Wizard ===');
    console.log('');

    const keys = detectApiKeys();

    const foundKeys = Object.entries(keys)
      .filter(([, found]) => found)
      .map(([provider]) => provider);

    if (foundKeys.length > 0) {
      console.log(`API keys detected: ${foundKeys.join(', ')}`);
    } else {
      const { runDoctor } = require('../utils/remediation-hints');
      console.log('No API keys detected.');
      console.log('Set OPENROUTER_API_KEY to get started, or run: amicus setup');
      console.log(`Not sure what's wrong? ${runDoctor}`);
    }
    // Local / self-hosted providers (v4.2 §4.6) already configured (e.g. via a
    // prior `amicus provider add`) are listed alongside detected keys. Guarded:
    // getLocalProviders() is documented never-fatal, but a listing step must
    // not be able to block setup even if that contract is ever violated.
    try {
      const { getLocalProviders } = require('../utils/local-providers');
      const localIds = Object.keys(getLocalProviders());
      if (localIds.length > 0) {
        console.log(`Local providers configured: ${localIds.join(', ')}`);
      }
    } catch (_err) { /* best-effort: never block setup over this listing */ }
    console.log('');

    // #38 — non-blocking zero-credit / free-tier OpenRouter warning. Never
    // blocks: free-tier councils against free models are legitimate.
    if (keys.openrouter) {
      await warnOnLowOpenRouterCredit();
    }

    const { getCatalog } = require('../utils/model-catalog');
    let catalog = [];
    try { catalog = await getCatalog(); } catch (_err) { /* offline: pinned */ }

    // Task 7 (cost-aware defaults P2): per-provider picker, once per keyed
    // provider, BEFORE the mode prompt -- orthogonal to standard-vs-free-council.
    // `vendorAliasesWritten` is consulted by the standard model step below so
    // it never clobbers a vendor alias this phase just wrote (Fix 2).
    const vendorAliasesWritten = await runProviderDefaultPickers(rl, foundKeys, catalog);

    // Task 12 (v4.2 §4.6): offer to add a local / self-hosted server. Pinned
    // insertion point -- after the per-provider pickers, before the mode
    // prompt, so all provider configuration stays grouped ahead of the
    // standard/free-council branch. Guarded (house best-effort rule, mirrors
    // provisionElectron/maybeMigrationNotice): addLocalProviderInteractive
    // already swallows its own errors, but this optional step must not be
    // able to abort the wizard even if that inner guard is ever weakened.
    try {
      const wantLocal = await askQuestion(rl,
        'Add a local / self-hosted server (Ollama, LM Studio, vLLM)? (y/N): ');
      if (wantLocal.toLowerCase() === 'y' || wantLocal.toLowerCase() === 'yes') {
        await addLocalProviderInteractive((q) => askQuestion(rl, q), console.log, {});
      }
    } catch (err) {
      logger.debug('Local-provider wizard step skipped', { error: err.message });
    }

    const mode = await askQuestion(rl,
      'Setup mode — 1) Standard (pick a default model)  2) Free OpenRouter council: ');
    if (mode === '2') {
      const completed = await runFreeCouncilBranch(rl, catalog);
      if (completed) {
        // C8 (Finding 2, post-review): parity with the standard path below --
        // a completed free-council setup gets the doctor finale too. An
        // aborted attempt (no key / <2 picks) configured nothing, so -- like
        // the invalid-choice branch just below -- it gets none.
        await printDoctorFinale();
      }
      return;
    }

    const { resolveQuickPicks, toLiveSeedAliases, toStorableRoute } = require('../utils/quick-picks');
    const picks = resolveQuickPicks(catalog);

    console.log('Choose your default model:');
    console.log('');
    picks.forEach((p, i) => {
      const badge = p.source === 'fallback' ? ' [offline list]' : '';
      console.log(`  ${i + 1}) ${p.alias} - ${p.label} (${p.blurb}) → ${p.routes.openrouter}${badge}`);
    });
    console.log('');

    const answer = await askQuestion(rl,
      `Pick a default (1-${picks.length}, alias name, or any full model id): `);
    const chosen = resolveChoice(answer, picks, catalog);

    if (!chosen) {
      console.log(`Invalid choice: "${answer}". Keeping configuration unchanged.`);
      return;
    }

    // Read-modify-write — never rebuild the alias table (no-clobber rule).
    const cfg = loadConfig() || { aliases: toLiveSeedAliases(catalog) };
    if (!cfg.aliases) { cfg.aliases = {}; }
    if (chosen.alias) {
      cfg.default = chosen.alias;
      const pick = picks.find(p => p.alias === chosen.alias);
      // Fix 2: a quick-pick family alias (e.g. 'deepseek') can collide with a
      // vendor alias the per-provider phase just wrote this run. `config.default`
      // pointing at that alias name is fine (the user's explicit overall-default
      // choice), but the alias's VALUE must stay the vendor phase's tier choice --
      // skip the curated-flagship upgrade so it isn't discarded.
      if (pick && !chosen.noUpgrade && !vendorAliasesWritten.has(chosen.alias)) {
        cfg.aliases[chosen.alias] = toStorableRoute(pick);
      } else if (cfg.aliases[chosen.alias] === undefined) {
        const fallback = getDefaultAliases()[chosen.alias];
        if (fallback !== undefined) { cfg.aliases[chosen.alias] = fallback; }
      }
    } else {
      cfg.default = chosen.modelId;
    }
    saveConfig(cfg);
    await seedCatalog();

    console.log('');
    console.log(`Default model set to: ${cfg.default}`);
    console.log(`Config saved (${Object.keys(cfg.aliases).length} aliases).`);
    console.log(`Config path: ${path.join(getConfigDir(), 'config.json')}`);

    // C8: compact doctor summary, best-effort (see printDoctorFinale).
    await printDoctorFinale();
  } finally {
    rl.close();
  }
}

/**
 * Run the interactive setup wizard (Electron-first)
 *
 * Attempts to launch the Electron GUI wizard. If Electron is not
 * available or fails, falls back to the readline-based setup.
 */
async function runInteractiveSetup() {
  try {
    const result = await launchWizard();
    if (result.success) {
      // Wizard handled config creation; if it returned a default, ensure config exists
      if (result.default) {
        const existing = loadConfig();
        if (!existing || !existing.default) {
          createDefaultConfig(result.default);
        }
      }

      await seedCatalog();

      const configPath = path.join(getConfigDir(), 'config.json');
      const keyLabel = result.keyCount
        ? `${result.keyCount} API key(s) configured.`
        : 'API keys configured.';
      const modelLabel = result.default
        ? `Default model: ${result.default}`
        : '';

      console.log('');
      console.log('Setup complete!');
      if (keyLabel) { console.log(keyLabel); }
      if (modelLabel) { console.log(modelLabel); }
      console.log(`Config: ${configPath}`);

      // C8: compact doctor summary, best-effort (see printDoctorFinale).
      // runReadlineSetup prints its own further down -- only the Electron
      // success path needs it added here explicitly; the fallback below
      // delegates to runReadlineSetup and inherits its finale, so adding it
      // here too would double-print.
      await printDoctorFinale();
      return;
    }
  } catch (err) {
    logger.debug('Electron wizard unavailable, falling back to readline', {
      error: err.message
    });
  }

  // Fallback to readline
  await runReadlineSetup();
}

/* eslint-enable no-console */

/**
 * Collision-safe alias name from a free model id. Strips the openrouter/
 * prefix and trailing :free, sanitizes '/'/':' to '-', prefixes 'free-',
 * and disambiguates against `taken` with a numeric suffix.
 * @param {string} id e.g. openrouter/deepseek/deepseek-r1:free
 * @param {Set<string>} taken alias names already in use
 * @returns {string} e.g. free-deepseek-deepseek-r1
 */
function deriveFreeAlias(id, taken) {
  const base = 'free-' + id
    .replace(/^openrouter\//, '')
    .replace(/:free$/, '')
    .replace(/[/:]/g, '-')
    .replace(/-+/g, '-');
  let name = base;
  let n = 2;
  while (taken.has(name)) { name = `${base}-${n++}`; }
  taken.add(name);
  return name;
}

/**
 * Seed free-model aliases + councils.free from chosen catalog ids.
 * Single atomic read-modify-write. Reuses an existing alias that already
 * maps to the same id (idempotent re-runs); never touches config.default.
 * @param {string[]} pickIds full openrouter/.../...:free ids
 * @returns {{added: Array<{alias:string, model:string}>, council: string[]}}
 */
function seedFreeCouncil(pickIds) {
  const cfg = loadConfig() || { aliases: {} };
  if (!cfg.aliases) { cfg.aliases = {}; }
  const taken = new Set(Object.keys(cfg.aliases));
  const council = [];
  const added = [];
  for (const id of pickIds) {
    const existing = Object.entries(cfg.aliases).find(([, m]) => m === id);
    if (existing) { if (!council.includes(existing[0])) { council.push(existing[0]); } continue; }
    const alias = deriveFreeAlias(id, taken);
    cfg.aliases[alias] = id;
    added.push({ alias, model: id });
    council.push(alias);
  }
  if (!cfg.councils) { cfg.councils = {}; }
  cfg.councils.free = Array.from(new Set(council));
  saveConfig(cfg);
  logger.info('Free council seeded', { count: cfg.councils.free.length });
  return { added, council: cfg.councils.free };
}

module.exports = {
  addAlias,
  addLocalProviderInteractive,
  createDefaultConfig,
  deriveFreeAlias,
  detectApiKeys,
  runFreeCouncilBranch,
  runInteractiveSetup,
  runReadlineSetup,
  runApiKeySetup,
  seedCatalog,
  seedFreeCouncil,
  warnOnLowOpenRouterCredit,
};
