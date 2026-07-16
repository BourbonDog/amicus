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
    aliases: { ...getDefaultAliases(), ...(existing.aliases || {}) },
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
  const aliases = { ...getDefaultAliases(), ...((cfg && cfg.aliases) || {}) };
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
 */
async function runFreeCouncilBranch(rl) {
  const keys = detectApiKeys();
  if (!keys.openrouter) {
    console.log('');
    console.log('A free council needs OPENROUTER_API_KEY (free models route only through OpenRouter).');
    console.log('Set OPENROUTER_API_KEY and re-run: amicus setup. No changes made.');
    return;
  }
  const { getCatalog } = require('../utils/model-catalog');
  const { listFreeModels, suggestFreeCouncil, PINNED_FREE_MODELS } = require('../utils/free-models');
  let catalog = [];
  try { catalog = await getCatalog(); } catch (_e) { /* offline */ }
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
    return;
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
}

/**
 * Run the readline-based setup wizard (headless fallback)
 *
 * Guides the user through:
 * 1. API key detection
 * 2. Mode selection (standard or free council)
 * 3. Default model selection from live quick-picks (read-modify-write, no clobber)
 * 4. Config file save
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
    console.log('');

    // #38 — non-blocking zero-credit / free-tier OpenRouter warning. Never
    // blocks: free-tier councils against free models are legitimate.
    if (keys.openrouter) {
      await warnOnLowOpenRouterCredit();
    }

    const mode = await askQuestion(rl,
      'Setup mode — 1) Standard (pick a default model)  2) Free OpenRouter council: ');
    if (mode === '2') {
      await runFreeCouncilBranch(rl);
      return;
    }

    const { getCatalog } = require('../utils/model-catalog');
    const { resolveQuickPicks, toLiveSeedAliases } = require('../utils/quick-picks');
    const { toCanonicalDefault } = require('../utils/curated-models');
    let catalog = [];
    try { catalog = await getCatalog(); } catch (_err) { /* offline: pinned */ }
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
      if (pick && !chosen.noUpgrade) {
        cfg.aliases[chosen.alias] = toCanonicalDefault(pick.routes.openrouter || Object.values(pick.routes)[0]);
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
