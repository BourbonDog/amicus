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
 * Create a new config with all default aliases and the chosen default model
 * @param {string} defaultModel - Default model alias or full model string
 * @returns {object} The created config object
 */
function createDefaultConfig(defaultModel) {
  const cfg = {
    default: defaultModel,
    aliases: getDefaultAliases()
  };
  saveConfig(cfg);
  logger.info('Default config created', {
    default: defaultModel,
    aliasCount: Object.keys(cfg.aliases).length
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
 * Run the readline-based setup wizard (headless fallback)
 *
 * Guides the user through:
 * 1. API key detection
 * 2. Default model selection from live quick-picks (read-modify-write, no clobber)
 * 3. Config file save
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
      console.log('No API keys detected.');
      console.log('Set OPENROUTER_API_KEY to get started, or run: amicus setup');
    }
    console.log('');

    const { getCatalog } = require('../utils/model-catalog');
    const { resolveQuickPicks, toLiveSeedAliases } = require('../utils/quick-picks');
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
        cfg.aliases[chosen.alias] = pick.routes.openrouter || Object.values(pick.routes)[0];
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

module.exports = {
  addAlias,
  createDefaultConfig,
  detectApiKeys,
  runInteractiveSetup,
  runReadlineSetup,
  runApiKeySetup,
  seedCatalog,
};
