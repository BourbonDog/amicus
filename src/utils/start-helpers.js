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

/**
 * Derive the alias used for resolution (needed downstream by the budget gate,
 * which reports `alias || args.model` as the pricing lookup's modelInput).
 * Mirrors the alias-derivation half of resolveModelFromArgs, but — per the
 * #61 Task 4.5 design — only ever returns a no-slash token: an explicit
 * `--model` containing '/' or a slash-bearing config default both resolve to
 * undefined here (resolveModelFromArgs, by contrast, echoes a slash-bearing
 * explicit --model back as "alias"; that's fine there because detectFallback/
 * validateDirectModel both no-op on a slash-bearing alias, but this router
 * path has no such tolerant caller).
 * @param {object} args - Parsed CLI arguments
 * @returns {string|undefined}
 */
function deriveAlias(args) {
  const raw = args.model;
  if (raw !== undefined && raw !== null && !raw.includes('/')) {
    return raw;
  }
  if (raw === undefined || raw === null) {
    const { loadConfig } = require('./config');
    const cfg = loadConfig();
    if (cfg && cfg.default && !cfg.default.includes('/')) {
      return cfg.default;
    }
  }
  return undefined;
}

/**
 * Resolve the model for a `start` launch through the Foundation gateway
 * router (#61 Task 4.5), replacing the resolveModelFromArgs +
 * validateFallbackModel pipeline for the start path only — resume/continue
 * keep using that legacy pair (above) until Tasks 5.2/7.3 migrate them too.
 *
 * On `resolved`, returns `{ model, alias, gateway, provenance }` (and prints
 * any advisory `notice` to stderr). On `error` or `selection_required`,
 * renders the appropriate message to stderr and exits(1) — this never
 * returns in that case.
 * @param {object} args - Parsed CLI arguments
 * @returns {Promise<{model: string, alias: string|undefined, gateway: string, provenance: object}>}
 */
async function resolveLaunchModel(args) {
  const { resolveGatewayMode, loadConfig } = require('./config');
  const { resolveRouteForLaunch } = require('./route-launch');
  const { toCliMessage, toStructuredError } = require('./route-error');

  const gatewayMode = resolveGatewayMode(args.gateway);
  const validateModel = !args['no-validate-model'];
  // allowSelection is hardcoded false: the interactive picker is Task 6.3.
  // Until it lands, a direct miss must produce a structured error/
  // selection_required we can render below, not an unhandled prompt.
  const allowSelection = false;

  // No --model given: the parser does not inject a default, so resolve the
  // configured default here (mirroring the pre-#61 resolveModelFromArgs
  // behavior) before handing off to the router. Without this, `undefined`
  // would reach resolveRouteForLaunch -> parseDescriptor(undefined) -> an
  // `invalid` result, breaking the common `amicus start` (no --model) case.
  let modelInput = args.model;
  if (modelInput === undefined || modelInput === null) {
    const cfg = loadConfig();
    if (cfg && cfg.default) {
      modelInput = cfg.default;
    } else {
      process.stderr.write(
        'No model specified and no default configured. Run \'amicus setup\' to set a default model.\n'
      );
      process.exit(1);
    }
  }

  const result = await resolveRouteForLaunch({
    model: modelInput,
    gatewayMode,
    source: 'cli',
    allowSelection,
    validateModel,
  });

  if (result.kind === 'resolved') {
    if (result.notice) {
      process.stderr.write(`${result.notice}\n`);
    }
    return {
      model: result.executableId,
      alias: deriveAlias(args),
      gateway: result.gateway,
      provenance: result.provenance,
    };
  }

  // 'error' or 'selection_required': render and exit.
  if (args.json) {
    process.stderr.write(`${JSON.stringify(toStructuredError(result))}\n`);
  } else {
    process.stderr.write(`${toCliMessage(result)}\n`);
  }
  process.exit(1);
}

module.exports = {
  resolveModelFromArgs,
  validateFallbackModel,
  resolveLaunchModel,
  deriveAlias,
};
