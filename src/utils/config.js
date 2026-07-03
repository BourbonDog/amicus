/**
 * Amicus Config Module
 *
 * Config directory resolution, file I/O, model alias resolution,
 * config hashing, and alias table formatting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { applyDirectApiFallback, autoRepairAlias } = require('./alias-resolver');
const { getCompatEnv } = require('./env-compat');

/** Default model alias map — derived from the curated-models single source (F5) */
const { toDefaultAliases } = require('./curated-models');
const DEFAULT_ALIASES = toDefaultAliases();

/** Built-in council benches (B23) — consulted only when a name is absent from user config. */
const { resolveBuiltinCouncil } = require('./council-presets');

/** @returns {string} Config directory path */
function getConfigDir() {
  const override = getCompatEnv('CONFIG_DIR');
  if (override) {
    const resolved = path.resolve(override);
    if (resolved.includes('\0')) {
      throw new Error('Invalid AMICUS_CONFIG_DIR: null bytes not allowed');
    }
    return resolved;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const amicusDir = path.join(homeDir, '.config', 'amicus');
  // DEPRECATED(amicus-shim): fall back to the legacy ~/.config/sidecar dir if it
  // exists and the new one does not, so pre-rebrand credentials keep working.
  // Remove in a future revision — see docs/SHIMS.md.
  if (!fs.existsSync(amicusDir)) {
    const legacyDir = path.join(homeDir, '.config', 'sidecar');
    if (fs.existsSync(legacyDir)) {
      return legacyDir;
    }
  }
  return amicusDir;
}

/**
 * One-time, non-destructive migration of the legacy ~/.config/sidecar config
 * directory onto the canonical ~/.config/amicus. Copies (does not move), so the
 * legacy dir is left intact as a backup. This collapses the two-dir split that
 * let getConfigDir() flip between them and orphan data: once ~/.config/amicus
 * exists it always wins. No-op when amicus already exists, when there is no
 * legacy dir, or when a CONFIG_DIR override is set. Best-effort — returns a
 * result object and never throws. Call once at startup, before any config read.
 *
 * @param {{home?: string}} [opts]
 * @returns {{migrated: boolean, from?: string, to?: string, reason?: string, error?: string}}
 */
function migrateLegacyConfigDir(opts = {}) {
  if (getCompatEnv('CONFIG_DIR')) { return { migrated: false, reason: 'override-set' }; }
  const home = opts.home || process.env.HOME || process.env.USERPROFILE;
  if (!home) { return { migrated: false, reason: 'no-home' }; }
  const amicusDir = path.join(home, '.config', 'amicus');
  const legacyDir = path.join(home, '.config', 'sidecar');
  try {
    if (fs.existsSync(amicusDir)) { return { migrated: false, reason: 'amicus-exists' }; }
    if (!fs.existsSync(legacyDir)) { return { migrated: false, reason: 'no-legacy' }; }
    fs.cpSync(legacyDir, amicusDir, { recursive: true });
    return { migrated: true, from: legacyDir, to: amicusDir };
  } catch (err) {
    return { migrated: false, reason: 'error', error: err.message };
  }
}

/** @returns {string} Full path to config.json */
function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

/** @returns {object|null} Parsed config data, or null if missing/invalid */
function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    if (!content || content.trim().length === 0) {
      return null;
    }
    return JSON.parse(content);
  } catch (_err) {
    return null;
  }
}

/** Save config data to disk, creating the directory if needed. Strips invalid aliases. */
function saveConfig(configData) {
  if (configData && configData.aliases) {
    const cleaned = {};
    for (const [key, value] of Object.entries(configData.aliases)) {
      if (key === 'null' || !value || typeof value !== 'string' || value === 'null') {
        process.stderr.write(
          `Notice: Removing invalid alias '${key}' (value: ${JSON.stringify(value)}) from config.\n`
        );
        continue;
      }
      cleaned[key] = value;
    }
    configData.aliases = cleaned;
  }
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), { mode: 0o600 });
}

/** @returns {object} Copy of the default alias map */
function getDefaultAliases() {
  return { ...DEFAULT_ALIASES };
}

/**
 * Resolve a model argument to a full model identifier
 *
 * Resolution order:
 * 1. If modelArg contains '/' -> return as-is (full model string)
 * 2. If modelArg is a key in config.aliases -> return resolved string
 * 3. If modelArg is unknown alias -> throw Error mentioning 'amicus setup'
 * 4. If modelArg is undefined and config.default exists -> resolve that alias
 * 5. If no default -> throw Error
 *
 * @param {string|undefined} modelArg - Model argument from CLI or undefined
 * @returns {string} Resolved full model identifier
 * @throws {Error} When alias is unknown or no default configured
 */
function resolveModel(modelArg) {
  const config = loadConfig();

  const effectiveAliases = getEffectiveAliases();

  // If modelArg is provided
  if (modelArg !== undefined && modelArg !== null) {
    // Full model string with slash - return as-is
    if (modelArg.includes('/')) {
      return modelArg;
    }

    // Try to resolve as alias (user config + defaults)
    if (effectiveAliases[modelArg] !== undefined) {
      const resolved = effectiveAliases[modelArg];
      if (!resolved || resolved === 'null') {
        return autoRepairAlias(modelArg, config, DEFAULT_ALIASES, saveConfig);
      }
      return applyDirectApiFallback(resolved);
    }

    // Unknown alias
    throw new Error(
      `Unknown model alias '${modelArg}'. Run 'amicus setup' to configure aliases.`
    );
  }

  // modelArg is undefined - use default
  if (!config || !config.default) {
    throw new Error(
      'No model specified and no default configured. Run \'amicus setup\' to set a default model.'
    );
  }

  const defaultValue = config.default;

  // Default is a full model string
  if (defaultValue.includes('/')) {
    return defaultValue;
  }

  // Default is an alias - resolve via user config + defaults
  if (effectiveAliases[defaultValue] !== undefined) {
    const resolved = effectiveAliases[defaultValue];
    if (!resolved || resolved === 'null') {
      return autoRepairAlias(defaultValue, config, DEFAULT_ALIASES, saveConfig);
    }
    return applyDirectApiFallback(resolved);
  }

  // Default alias not found anywhere
  throw new Error(
    `Default alias '${defaultValue}' not found in aliases. Run 'amicus setup' to fix configuration.`
  );
}

/** @returns {string|null} 8-char hex hash of config file, or null if missing */
function computeConfigHash() {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
  } catch (_err) {
    return null;
  }
}

/** @returns {string} Markdown alias table with (default) marker, or empty string */
function buildAliasTable() {
  const config = loadConfig();
  if (!config || !config.aliases || Object.keys(config.aliases).length === 0) {
    return '';
  }

  const defaultAlias = config.default || null;
  const lines = [];

  lines.push('| Alias | Model |');
  lines.push('|-------|-------|');

  for (const [alias, model] of Object.entries(config.aliases)) {
    const marker = (alias === defaultAlias) ? ' (default)' : '';
    lines.push(`| ${alias}${marker} | ${model} |`);
  }

  return lines.join('\n');
}

/** Check whether the config file has changed compared to a known hash */
function checkConfigChanged(currentHash) {
  const newHash = computeConfigHash();

  if (currentHash === newHash) {
    return { changed: false, newHash };
  }

  // Config has changed (or was created/removed)
  const aliasTable = buildAliasTable();
  const hashComment = newHash ? `<!-- amicus-config-hash: ${newHash} -->` : '';
  const updateData = [hashComment, aliasTable].filter(Boolean).join('\n');

  return {
    changed: true,
    newHash,
    updateData: updateData || undefined,
  };
}

/**
 * Get effective aliases: defaults merged with user config (user wins)
 * @returns {object} Merged alias map
 */
function getEffectiveAliases() {
  const config = loadConfig();
  const userAliases = (config && config.aliases) || {};
  return { ...DEFAULT_ALIASES, ...userAliases };
}

/**
 * Format alias names as a comma-separated string for tool descriptions
 * @returns {string} e.g. "gemini, opus, gpt, deepseek, ..."
 */
function formatAliasNames() {
  return Object.keys(getEffectiveAliases()).join(', ');
}

/**
 * Non-throwing wrapper around resolveModel
 * @param {string|undefined} modelArg - Model argument
 * @returns {{model?: string, error?: string}} Resolved model or error message
 */
function tryResolveModel(modelArg) {
  try {
    return { model: resolveModel(modelArg) };
  } catch (err) {
    return { error: err.message };
  }
}

/** Build OpenCode provider.models config from sidecar aliases.
 * @returns {object} e.g. { openrouter: { models: { "x-ai/grok-4.3": {}, ... } } } */
function buildProviderModels() {
  const aliases = getEffectiveAliases();
  const providers = {};

  for (const fullModel of Object.values(aliases)) {
    if (!fullModel || typeof fullModel !== 'string') { continue; }
    const parts = fullModel.split('/');
    if (parts.length < 2) { continue; }

    const providerID = parts[0];
    const modelID = parts.slice(1).join('/');

    if (!providers[providerID]) {
      providers[providerID] = { models: {} };
    }
    providers[providerID].models[modelID] = {};
  }

  return providers;
}

/** Detect if direct API fallback was applied during alias resolution */
function detectFallback(alias, resolvedModel) {
  if (!alias || alias.includes('/')) { return false; }
  const val = getEffectiveAliases()[alias];
  return !!(val && val.startsWith('openrouter/') && !resolvedModel.startsWith('openrouter/'));
}

/** @returns {Object<string,string[]>} the councils map (empty if none) */
function getCouncils() {
  const config = loadConfig();
  return (config && config.councils) || {};
}

/** @param {string} name @returns {string[]|null} council members, or null if absent */
function getCouncil(name) {
  return getCouncils()[name] || null;
}

/**
 * Look up a council's raw member list, checking user config FIRST and the
 * built-in benches (free/budget/frontier — src/utils/council-presets.js)
 * only when the name is absent from user config. User config always shadows
 * a same-named built-in — this matches the pre-existing last-write-wins
 * posture the wizard's `councils.free` seeding already relied on.
 * @param {string} name
 * @param {Array<{id:string}>} [catalog] needed only to resolve the dynamic 'free' bench
 * @returns {{members:string[]|null, builtin:boolean}}
 */
function getCouncilWithSource(name, catalog = []) {
  const userMembers = getCouncil(name);
  if (userMembers) { return { members: userMembers, builtin: false }; }
  const builtinMembers = resolveBuiltinCouncil(name, catalog);
  if (builtinMembers) { return { members: builtinMembers, builtin: true }; }
  return { members: null, builtin: false };
}

/**
 * Expand a saved council into a runnable members list, degrading gracefully.
 * Each member is resolved to its full model id (alias → id via effective
 * aliases; a member containing '/' is taken as-is) and that id checked against
 * the cached catalog. Unresolvable aliases and delisted ids are dropped with a
 * warning rather than fail-fast-aborting the whole wave. The catalog check is
 * skipped when the catalog is empty (offline). Returns members RAW (alias or
 * id) — leg-time validation resolves them again.
 *
 * Resolution order: user config (`config.councils`) is checked first; when
 * `name` is absent there, the built-in benches (`free`/`budget`/`frontier`)
 * are consulted (src/utils/council-presets.js). A user-saved council always
 * shadows a built-in of the same name.
 * @param {string} name
 * @param {Array<{id:string}>} [catalog]
 * @returns {{models:string[], dropped:string[]} | {error:string}}
 */
function resolveCouncilMembers(name, catalog = []) {
  const { members } = getCouncilWithSource(name, catalog);
  if (!members) {
    return { error: `Unknown council '${name}'. Run 'amicus setup' to create one.` };
  }
  if (!Array.isArray(members) || members.length === 0) {
    return { error: `Council '${name}' is empty. Run 'amicus setup' to populate it.` };
  }
  const aliases = getEffectiveAliases();
  const known = new Set((Array.isArray(catalog) ? catalog : []).map(m => m && m.id).filter(Boolean));
  const models = [];
  const dropped = [];
  for (const member of members) {
    const id = member.includes('/') ? member : aliases[member];
    if (!id) { dropped.push(member); continue; }                 // alias no longer resolves
    if (known.size > 0 && !known.has(id)) { dropped.push(member); continue; } // delisted model
    models.push(member);
  }
  if (models.length < 2) {
    return {
      error: `Council '${name}' has fewer than 2 usable members` +
        (dropped.length ? ` (dropped: ${dropped.join(', ')})` : '') +
        '. Run \'amicus setup\' to refresh it.',
    };
  }
  return { models, dropped };
}

module.exports = {
  getConfigDir,
  migrateLegacyConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  getDefaultAliases,
  resolveModel,
  detectFallback,
  computeConfigHash,
  buildAliasTable,
  checkConfigChanged,
  getEffectiveAliases,
  formatAliasNames,
  tryResolveModel,
  buildProviderModels,
  getCouncils,
  getCouncil,
  getCouncilWithSource,
  resolveCouncilMembers,
};
