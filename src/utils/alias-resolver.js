/**
 * Alias Resolver Utilities
 *
 * Handles alias auto-repair, extracted from config.js to keep it under the
 * 300-line limit. The direct-vs-OpenRouter gateway decision that used to live
 * here (applyDirectApiFallback, a prefix-stripping heuristic) is now owned
 * end-to-end by the gateway router (route-launch.js / gateway-router.js,
 * #61) on every launch path — this module no longer makes that call.
 */

/**
 * Auto-repair a null alias by falling back to DEFAULT_ALIASES.
 * Updates config on disk and warns to stderr.
 * @param {string} alias - The alias name with null value
 * @param {object|null} config - Current config object
 * @param {object} defaultAliases - DEFAULT_ALIASES map
 * @param {Function} saveConfig - saveConfig function reference
 * @returns {string} Repaired model string
 * @throws {Error} If no default exists for this alias
 */
function autoRepairAlias(alias, config, defaultAliases, saveConfig) {
  const defaultModel = defaultAliases[alias];
  if (defaultModel) {
    process.stderr.write(
      `Notice: Auto-repaired null alias '${alias}' -> '${defaultModel}'\n`
    );
    if (config && config.aliases) {
      config.aliases[alias] = defaultModel;
      try {
        saveConfig(config);
      } catch (err) {
        process.stderr.write(
          `Notice: Could not persist repaired alias '${alias}' (${err.message}). ` +
          'Using default for this session only.\n'
        );
      }
    }
    return defaultModel;
  }
  throw new Error(
    `Alias '${alias}' is configured but has no model value. ` +
    `Fix with: amicus setup --add-alias ${alias}=provider/model`
  );
}

module.exports = {
  autoRepairAlias,
};
