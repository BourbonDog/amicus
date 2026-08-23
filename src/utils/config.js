/**
 * Amicus Config Module
 *
 * Config directory resolution, file I/O, model alias resolution,
 * config hashing, and alias table formatting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { autoRepairAlias } = require('./alias-resolver');
const { isDirectProvider } = require('./provider-registry');

/** Default model alias map — derived from the curated-models single source (F5) */
const { toDefaultAliases, toGatewayRoutes } = require('./curated-models');
const DEFAULT_ALIASES = toDefaultAliases();
const CURATED_ROUTES = toGatewayRoutes();

/** Built-in council benches (B23) — consulted only when a name is absent from user config. */
const { resolveBuiltinCouncil } = require('./council-presets');

/** @returns {string} Config directory path */
function getConfigDir() {
  const override = process.env.AMICUS_CONFIG_DIR;
  if (override) {
    const resolved = path.resolve(override);
    if (resolved.includes('\0')) {
      throw new Error('Invalid AMICUS_CONFIG_DIR: null bytes not allowed');
    }
    return resolved;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  return path.join(homeDir, '.config', 'amicus');
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
      // Router (route-launch.js / gateway-router.js, #61) owns the
      // direct-vs-OpenRouter decision now — return the stored id verbatim.
      return resolved;
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
    // Router owns the direct-vs-OpenRouter decision now — return verbatim.
    return resolved;
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

/**
 * Request timeout (ms) for local (@ai-sdk/openai-compatible) provider blocks.
 * opencode's default HTTP request timeout is too short for cold local
 * inference: prefilling a large agent prompt (~26k tokens) on a cold local
 * model can exceed it, killing the request during prefill before any stream
 * data arrives -- opencode never creates the assistant message, and the
 * caller polls out its own much longer timeout waiting for a response that
 * will never come. 300000ms (5 minutes) covers cold-start prefill headroom.
 */
const LOCAL_REQUEST_TIMEOUT_MS = 300000;

/** Build OpenCode provider.models config from sidecar aliases, plus the
 * actually-resolved launch route(s). The alias-derived entries let the UI
 * model picker show every configured model (single source of truth for the
 * picker); resolvedRoutes ensures the id OpenCode is ACTUALLY told to launch
 * (config.model) is always registered under its correct provider, even when
 * an alias maps to a different provider for the same model (e.g. an alias
 * stores `openrouter/openai/gpt-5.5` but the router resolves DIRECT to
 * `openai/gpt-5.5` — without this, only `openrouter` would be registered,
 * mismatching config.model).
 *
 * Catalog broadening (#61 whole-branch review, FIX 1): a resolvedRoutes entry
 * only covers the route(s) resolved AT SERVER-CREATION TIME. A long-lived,
 * multi-session server (the MCP shared server, `utils/shared-server.js`) is
 * created ONCE via `sharedServer.ensureServer()` and then serves MANY
 * sessions over its lifetime, each of which independently asks the gateway
 * router (direct-first policy) to route the SAME bare alias — some sessions
 * land DIRECT, others land on OpenRouter, depending on which keys happen to
 * be configured when each session starts. Since the shared server's
 * `provider.models` is fixed at creation and never rebuilt per-session,
 * threading only that first session's resolved id is insufficient. So for
 * every alias that resolves to a BARE direct-capable-vendor id (post-#61
 * default aliases are bare, e.g. `openai/gpt-5.5`), this ALSO registers the
 * alias's OpenRouter form — broadening the catalog to cover BOTH routes the
 * router might pick, regardless of which session created the server. This
 * does NOT change what the alias itself resolves to (still bare, still
 * direct-first) — it only widens what's pre-registered.
 *
 * The mirror is read from the alias's authored gateway route, NOT built by
 * prepending `openrouter/`. For DIVERGENT_VENDORS the two ids are different
 * strings, not merely differently prefixed — OpenRouter serves
 * `anthropic/claude-opus-4.8` while the direct API serves
 * `anthropic/claude-opus-4-8`. v4.1.1 made `toDefaultAliases()` emit the
 * direct form, at which point prepending produced an id OpenRouter does not
 * serve (fixed in v4.1.2). Aliases the user has overridden fall back to the
 * prefix form, since no authored gateway route describes them.
 * @param {string[]} [resolvedRoutes] executable model id(s) actually launched
 * @returns {object} e.g. { openrouter: { models: { "x-ai/grok-4.3": {}, ... } } } */
function buildProviderModels(resolvedRoutes = []) {
  const aliases = getEffectiveAliases();
  const providers = {};

  const addRoute = (fullModel) => {
    if (!fullModel || typeof fullModel !== 'string') { return; }
    const parts = fullModel.split('/');
    if (parts.length < 2) { return; }

    const providerID = parts[0];
    const modelID = parts.slice(1).join('/');

    // providerID is an unvalidated vendor segment split off a user-supplied
    // model string (alias or resolved route). A bare `!providers[providerID]`
    // check walks the prototype chain, so a vendor literally named
    // 'constructor' (a valid, non-reserved local-provider id — see
    // local-providers.js's ID_RE/RESERVED_IDS) reads the inherited
    // Object.prototype.constructor (truthy), skips the init below, and the
    // next line throws on the resulting undefined. Same bug class already
    // fixed in gateway-router.js (19aade4) and local-providers.js +
    // route-suggestions.js (2cba73b).
    if (!Object.prototype.hasOwnProperty.call(providers, providerID)) {
      providers[providerID] = { models: {} };
    }
    providers[providerID].models[modelID] = {};
  };

  for (const [alias, fullModel] of Object.entries(aliases)) {
    addRoute(fullModel);

    // Broaden: a bare direct-capable-vendor route also gets an OpenRouter
    // mirror registered (see catalog-broadening note above). Prefer the
    // alias's AUTHORED OpenRouter route — for divergent vendors it is a
    // different id, not a prefixed one. Guarded on the alias still holding its
    // shipped direct value so a user override never inherits a curated route.
    const curated = CURATED_ROUTES[alias];
    if (curated && curated.openrouter && curated.direct === fullModel) {
      addRoute(curated.openrouter);
      continue;
    }

    // Fallback for user-defined aliases. Gateway-only aliases (already
    // `openrouter/...`, e.g. grok/qwen/x-ai) are untouched — OpenRouter is
    // their only possible route anyway, already covered above.
    if (typeof fullModel === 'string' && !fullModel.startsWith('openrouter/')) {
      const vendor = fullModel.split('/')[0];
      if (isDirectProvider(vendor)) {
        addRoute(`openrouter/${fullModel}`);
      }
    }
  }

  for (const resolved of resolvedRoutes) {
    addRoute(resolved);
  }

  // v4.2 §4.3: for every provider id that is a configured LOCAL provider AND was
  // registered by the loops above, attach the OpenCode openai-compatible block.
  // {env:VAR} interpolation keeps key material out of the config object.
  const { getLocalProviders } = require('./local-providers');
  const localAll = getLocalProviders();
  for (const [id, block] of Object.entries(providers)) {
    // Guarded the same way as the accumulator init above: `localAll` is a
    // plain {} when no local providers are configured, so a bare
    // `localAll[id]` for id === 'constructor' would read the inherited
    // Object.prototype.constructor (truthy) and fabricate a fake local block
    // for a vendor that isn't actually configured as local.
    const entry = Object.prototype.hasOwnProperty.call(localAll, id) ? localAll[id] : undefined;
    if (!entry) { continue; }
    block.npm = '@ai-sdk/openai-compatible';
    block.name = entry.name || id;
    block.options = {
      baseURL: entry.baseURL,
      // @ai-sdk/openai-compatible wants a non-empty apiKey string even for
      // servers that don't require auth (Ollama/LM Studio/llama.cpp ignore
      // it) -- an omitted apiKey is not the same as an accepted empty one.
      apiKey: entry.apiKeyEnv ? `{env:${entry.apiKeyEnv}}` : 'not-needed',
      timeout: LOCAL_REQUEST_TIMEOUT_MS,
    };
  }

  return providers;
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
 * Per-member alias/catalog classification — the SAME check `resolveCouncilMembers`
 * (below) uses to decide the real run path's bench, extracted so `amicus council
 * show` (council/presets-cli.js) can reuse it verbatim instead of re-deriving a
 * parallel (and, pre-v4.5-Wave-2, drifted) check. Each member is resolved to its
 * full model id (alias → id via effective aliases; a member containing '/' is
 * taken as-is) and that id checked against the cached catalog. Tri-state catalog
 * rule: an EMPTY catalog (offline / never fetched) never drops anything —
 * "unknown" is not "delisted" — and a local-vendor member is never dropped on
 * catalog absence either way (v4.2 §4.4: a local server may simply have been off
 * at the last refresh; the leg itself fails pre-flight with the actionable
 * local_endpoint_unreachable error if it is truly down). Only a NON-EMPTY
 * catalog that omits the resolved id is a definitive drop.
 *
 * WHITESPACE (v4.8 SI-22.4). Each member is TRIMMED before it is classified,
 * closing a divergence: `--models` already trimmed
 * (`sidecar/fanout-validate.js :: parseModelsList`, and `cli-council-run-bench.js
 * :: parseList` on the council surface) while `--council` did not, so the same
 * stray space was benign on one flag and, here, converted a typo into a dropped
 * member and a degraded (2) exit. ⚠️ The dominant effect is RESURRECTION, not
 * de-duplication: a padded member that is dropped today starts RUNNING, which
 * is a new paid leg. Where the trim makes two members collide, the bench
 * becomes a real twin and `seats.js :: buildSeats` mints `alias#N` for both.
 * An all-whitespace member trims to `''`, which no alias table names, so gate 1
 * below drops it — the `.filter(Boolean)` half of `parseModelsList`'s shape,
 * reached without a third `reason` string (see the tripwire note below).
 * @param {string[]} members council members as configured — aliases or
 *   provider/model ids, trimmed per member here, never elsewhere
 * @param {Array<{id:string}>} [catalog]
 * @returns {{models:string[], dropped:string[], droppedMembers:Array<{member:string, reason:string}>}}
 *   `dropped` is the flat member-ref list (unchanged shape, pre-v4.5-Wave-2
 *   callers keep working); `droppedMembers` additively pairs each with WHY.
 *   ⚠️ Both report the member RAW — untrimmed, byte-for-byte as configured
 *   (v4.8 SI-22.4, R22.4-2) — so a user can find the offending string in their
 *   own config. Only `models` carries the trimmed value.
 *
 *   Standing note (D18, v4.7 PR5): each `droppedMembers` entry is `{member, reason}`
 *   (that is the real key — BACKLOG.md's description of this shape had drifted to
 *   `{ref, reason}`). The two `reason` literals are produced below, in the
 *   alias-miss and catalog-miss branches of `classifyCouncilMembers`; they are
 *   free text, not a coded enum, and today NO consumer branches on the string. They
 *   are not display-only: `council/presets-cli.js` (`amicus council show`,
 *   `:149-150`) renders `${member} (${reason})`, `council/run.js` (`:80-87`) carries
 *   it verbatim into a degrade-note payload, and `reason` is also persisted into
 *   `run.json` (`run-state.js`, `mcp-council-run.js`) — not merely shown to a human.
 *   `cli-council-run-bench.js` (`:74`) only type-checks that `reason` is a string
 *   when round-tripping `--dropped-members` across the MCP→CLI spawn boundary. The
 *   tripwire: if a THIRD reason string is ever added here, stop and re-decide
 *   whether `reason` should become a coded enum instead of free text — this note
 *   marks that decision point, it does not make it.
 */
function classifyCouncilMembers(members, catalog = []) {
  const aliases = getEffectiveAliases();
  const known = new Set((Array.isArray(catalog) ? catalog : []).map(m => m && m.id).filter(Boolean));
  const { isLocalProvider } = require('./local-providers');
  const models = [];
  const dropped = [];
  const droppedMembers = [];
  for (const raw of members) {
    // v4.8 SI-22.4. Trim BEFORE gate 1 below, never after: a padded ALIAS
    // ('gpt ') must reach the alias table as written in the table, and a padded
    // full id ('openai/gpt-5 ') must reach the catalog lookup clean. Trimming
    // downstream of either gate would leave both misses in place. Non-strings
    // pass through untouched so their `.includes` still throws exactly as it
    // did before this line existed. Named mutant "NOTRIM": drop the `.trim()`.
    const member = typeof raw === 'string' ? raw.trim() : raw;
    const id = member.includes('/') ? member : aliases[member];
    // R22.4-2: `models` gets the TRIMMED value, `dropped`/`droppedMembers` get
    // `raw` — a member still dropped after trimming is reported as the user
    // wrote it, or they cannot grep their own config for it. Named mutant
    // "TRIMDROPPED": report `member` instead of `raw` in the two drop branches.
    if (!id) { // alias no longer resolves
      dropped.push(raw);
      droppedMembers.push({ member: raw, reason: 'alias no longer resolves to a known model' });
      continue;
    }
    const vendor = typeof id === 'string' ? id.split('/')[0] : '';
    if (isLocalProvider(vendor)) { models.push(member); continue; }
    if (known.size > 0 && !known.has(id)) { // delisted model
      dropped.push(raw);
      droppedMembers.push({ member: raw, reason: 'resolved id is not present in the cached model catalog' });
      continue;
    }
    models.push(member);
  }
  return { models, dropped, droppedMembers };
}

/**
 * Expand a saved council into a runnable members list, degrading gracefully.
 * Unresolvable aliases and delisted ids are dropped with a warning rather than
 * fail-fast-aborting the whole wave (classification: classifyCouncilMembers
 * above). Returns members UNRESOLVED (the alias or id as configured, never the
 * id an alias maps to) — leg-time validation resolves them again. ⚠️ Not
 * byte-identical to the configured string since v4.8 SI-22.4: classification
 * trims each member, so `models[i]` is the configured member minus any
 * surrounding whitespace. `dropped`/`droppedMembers` still carry it raw.
 *
 * Resolution order: user config (`config.councils`) is checked first; when
 * `name` is absent there, the built-in benches (`free`/`budget`/`frontier`)
 * are consulted (src/utils/council-presets.js). A user-saved council always
 * shadows a built-in of the same name.
 * @param {string} name
 * @param {Array<{id:string}>} [catalog]
 * @returns {{models:string[], dropped:string[], droppedMembers:Array<{member:string, reason:string}>} | {error:string}}
 */
function resolveCouncilMembers(name, catalog = []) {
  const { members } = getCouncilWithSource(name, catalog);
  if (!members) {
    return { error: `Unknown council '${name}'. Run 'amicus setup' to create one.` };
  }
  if (!Array.isArray(members) || members.length === 0) {
    return { error: `Council '${name}' is empty. Run 'amicus setup' to populate it.` };
  }
  const { models, dropped, droppedMembers } = classifyCouncilMembers(members, catalog);
  if (models.length < 2) {
    return {
      error: `Council '${name}' has fewer than 2 usable members` +
        (dropped.length ? ` (dropped: ${dropped.join(', ')})` : '') +
        '. Run \'amicus setup\' to refresh it.',
    };
  }
  return { models, dropped, droppedMembers };
}

/** @returns {{prefer:'direct'|'openrouter', migration_notified:Object}} routing config with defaults */
function getRoutingConfig() {
  const config = loadConfig() || {};
  const r = (config.routing && typeof config.routing === 'object') ? config.routing : {};
  const prefer = r.prefer === 'openrouter' ? 'openrouter' : 'direct';
  const migration_notified = (r.migration_notified && typeof r.migration_notified === 'object') ? r.migration_notified : {};
  return { prefer, migration_notified };
}

/** Merge --gateway (perCall) with routing.prefer into a router gatewayMode.
 * @param {string|undefined} perCall 'auto'|'direct'|'openrouter'|undefined
 * @returns {'auto'|'direct'|'openrouter'} */
function resolveGatewayMode(perCall) {
  if (perCall && perCall !== 'auto') { return perCall; }
  const { prefer } = getRoutingConfig();
  return prefer === 'openrouter' ? 'openrouter' : 'auto';
}

/**
 * Persist the one-time direct-migration notice flag for a vendor (#61 Task
 * 5.1 — visible-migration guarantee). Best-effort: swallows any saveConfig
 * failure so a persistence hiccup never breaks the launch that triggered it.
 * @param {string} vendor
 */
function markMigrationNotified(vendor) {
  try {
    const config = loadConfig() || {};
    if (!config.routing || typeof config.routing !== 'object') { config.routing = {}; }
    if (!config.routing.migration_notified || typeof config.routing.migration_notified !== 'object') {
      config.routing.migration_notified = {};
    }
    config.routing.migration_notified[vendor] = true;
    saveConfig(config);
  } catch (_err) {
    // best-effort: never fail the launch over a persistence error
  }
}

/**
 * Existing-user one-time onboarding offer (Part 2, Task 9). Mirrors
 * markMigrationNotified's flag pattern: a single boolean persisted at
 * config.routing.tier_onboarded once the notice has fired, so it never
 * repeats.
 * @returns {boolean} true once the notice has fired
 */
function hasTierOnboarded() {
  const config = loadConfig() || {};
  return !!(config.routing && config.routing.tier_onboarded === true);
}

/**
 * v4.5 auto-open (spec §6 guard 4): the Workspace auto-opens on MCP council
 * runs from Claude Code (local) unless config.workspace.autoOpen === false. Only an
 * explicit false disables — absent/junk values stay ON (opt-out semantics).
 * @returns {boolean}
 */
function getWorkspaceAutoOpen() {
  const config = loadConfig() || {};
  return !(config.workspace && config.workspace.autoOpen === false);
}

/**
 * Persist the one-time onboarding-notice flag, preserving any other routing
 * keys (prefer, tier, migration_notified). Best-effort: swallows any
 * saveConfig failure so a persistence hiccup never breaks the command that
 * triggered it (mirrors markMigrationNotified).
 */
function markTierOnboarded() {
  try {
    const config = loadConfig() || {};
    if (!config.routing || typeof config.routing !== 'object') { config.routing = {}; }
    config.routing.tier_onboarded = true;
    saveConfig(config);
  } catch (_err) {
    // best-effort: never fail the command over a persistence error
  }
}

/** Global cost-tier preference (Part 2, Task 1) — priciest-to-cheapest. */
const COST_TIERS = ['frontier', 'balanced', 'economy'];

/** @returns {'frontier'|'balanced'|'economy'} config.routing.tier, defaulting/coercing to 'balanced' */
function getCostTier() {
  const config = loadConfig() || {};
  const tier = config.routing && config.routing.tier;
  return COST_TIERS.includes(tier) ? tier : 'balanced';
}

/**
 * Persist the global cost-tier preference under routing.tier, preserving any
 * other routing keys (prefer, migration_notified).
 * @param {string} tier one of COST_TIERS
 * @throws {Error} when tier is not a recognized cost tier
 */
function setCostTier(tier) {
  if (!COST_TIERS.includes(tier)) {
    throw new Error(`Invalid cost tier '${tier}'. Must be one of: ${COST_TIERS.join(', ')}`);
  }
  const config = loadConfig() || {};
  config.routing = { ...(config.routing || {}), tier };
  saveConfig(config);
}

module.exports = {
  getConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  getDefaultAliases,
  resolveModel,
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
  classifyCouncilMembers,
  resolveCouncilMembers,
  getRoutingConfig,
  resolveGatewayMode,
  markMigrationNotified,
  COST_TIERS,
  getCostTier,
  setCostTier,
  hasTierOnboarded,
  markTierOnboarded,
  getWorkspaceAutoOpen,
};
