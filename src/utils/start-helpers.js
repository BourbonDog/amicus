/**
 * Start Command Helpers
 *
 * Model resolution and validation helpers extracted from bin/amicus.js
 * to keep the CLI entry point under the 300-line limit.
 */

/**
 * Resolve model from args: resolve alias or config default.
 * Returns { model, alias } or calls process.exit(1) on error.
 * @param {object} args - Parsed CLI arguments
 * @returns {{ model: string, alias: string|undefined }}
 */
function resolveModelFromArgs(args) {
  const { resolveModel, loadConfig } = require('./config');
  const rawAlias = args.model;
  let model;
  try {
    model = resolveModel(args.model);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Determine the alias used (explicit or config default)
  let alias = rawAlias;
  if (alias === undefined) {
    const cfg = loadConfig();
    if (cfg && cfg.default && !cfg.default.includes('/')) {
      alias = cfg.default;
    }
  }
  return { model, alias };
}

/**
 * Validate models before launch (F3 #18: default-on).
 * --no-validate-model opts out; the old opt-in --validate-model is a no-op kept for back-compat.
 * Returns the (possibly corrected) model string.
 * @param {object} args - Parsed CLI arguments
 * @param {string|undefined} alias - The alias used for resolution
 * @returns {Promise<string>} Validated model string
 */
async function validateFallbackModel(args, alias) {
  // F3 #18: validation is default-on. --no-validate-model opts out; the old
  // opt-in --validate-model is now a no-op kept for back-compat.
  if (args['no-validate-model']) { return args.model; }

  const headless = args['no-ui'] || !process.stdin.isTTY;
  const { detectFallback } = require('./config');

  // Direct-API fallback path: keep the provider-API existence check.
  if (alias && detectFallback(alias, args.model)) {
    const { validateDirectModel } = require('./model-validator');
    try {
      return await validateDirectModel(args.model, alias, { headless });
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  // OpenRouter (and any) resolved model: validate against the live catalog.
  const { validateAgainstCatalog } = require('./model-validator');
  try {
    return await validateAgainstCatalog(args.model, alias);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  resolveModelFromArgs,
  validateFallbackModel,
};
