/**
 * Start Command Helpers
 *
 * Model resolution and validation helpers extracted from bin/amicus.js
 * to keep the CLI entry point under the 300-line limit.
 */

/**
 * Derive the alias used for resolution (needed downstream by the budget gate,
 * which reports `alias || args.model` as the pricing lookup's modelInput).
 * Per the #61 Task 4.5 design, only ever returns a no-slash token: an
 * explicit `--model` containing '/' or a slash-bearing config default both
 * resolve to undefined here.
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
 * Resolve the model for a launch through the Foundation gateway router (#61
 * Task 4.5), used by every launch path — start, continue (Task 7.3), and the
 * MCP amicus_start handler (via the same router, Task 6.2). This replaced the
 * legacy resolveModelFromArgs + validateFallbackModel pair, which was retired
 * once no launch path depended on it (#61 Task 4.7).
 *
 * On `resolved`, returns `{ model, alias, gateway, provenance }` (and prints
 * any advisory `notice` to stderr). On `error` or `selection_required`,
 * renders the appropriate message to stderr and exits(1) — this never
 * returns in that case.
 * @param {object} args - Parsed CLI arguments
 * @returns {Promise<{model: string, alias: string|undefined, gateway: string, provenance: object}>}
 */
async function resolveLaunchModel(args) {
  const { resolveGatewayMode } = require('./config');
  const { resolveRouteForLaunch } = require('./route-launch');
  const { toCliMessage, toErrorDocFields } = require('./route-error');
  const { failJson, ERROR_CODES } = require('./error-doc');
  const { resolveModelInputOrDefault } = require('./model-input-default');

  const gatewayMode = resolveGatewayMode(args.gateway);
  const validateModel = !args['no-validate-model'];
  // Interactive alternatives picker (#61 Task 6.3): only offered on a real
  // interactive TTY session that hasn't opted out with --no-ui. A headless/
  // non-TTY run (CI, piped output, --no-ui) keeps allowSelection false, so a
  // direct miss there still produces the structured error/selection_required
  // rendered below rather than an unhandled prompt.
  const allowSelection = !args['no-ui'] && !!process.stdin.isTTY;

  // No --model given: the parser does not inject a default, so resolve the
  // configured default here before handing off to the router. Without this, `undefined`
  // would reach resolveRouteForLaunch -> parseDescriptor(undefined) -> an
  // `invalid` result, breaking the common `amicus start` (no --model) case.
  // Shared with the MCP amicus_start handler (mcp-server.js, #61 Task 6.2)
  // via model-input-default.js, so this lookup lives in exactly one place.
  const modelInput = resolveModelInputOrDefault(args.model);
  if (modelInput === undefined) {
    const message = 'No model specified and no default configured. Run \'amicus setup\' to set a default model.';
    if (args.json) {
      // v4.0 §7: --json pre-flight failures land on STDOUT as the error doc.
      failJson(true, { code: ERROR_CODES.BAD_MODEL, message, hint: 'amicus setup' });
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exit(1);
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

  // Interactive alternatives picker (#61 Task 6.3): only reachable when
  // allowSelection was true above (real TTY, no --no-ui), so the router only
  // ever hands back selection_required here in that same interactive case.
  if (result.kind === 'selection_required') {
    const { promptRouteSelection } = require('./model-validator');
    try {
      const chosen = await promptRouteSelection(result, deriveAlias(args));
      return {
        model: chosen.model,
        alias: deriveAlias(args),
        gateway: chosen.gateway,
        provenance: result.provenance || {},
      };
    } catch (err) {
      const message = err.message || 'Model selection cancelled.';
      if (args.json) {
        failJson(true, { code: ERROR_CODES.BAD_MODEL, message,
          hint: 'Pass --model <vendor/model> explicitly to skip the picker.' });
      } else {
        process.stderr.write(`${message}\n`);
      }
      process.exit(1);
    }
  }

  // 'error': render and exit. Under --json the error doc goes to STDOUT
  // (v4.0 §7 — was toStructuredError on stderr); human stderr is unchanged.
  if (args.json) {
    failJson(true, toErrorDocFields(result));
  } else {
    process.stderr.write(`${toCliMessage(result)}\n`);
  }
  process.exit(1);
}

/**
 * Existing-user one-time onboarding offer (Part 2, Task 9). Prints a single
 * non-blocking notice line pointing configured-but-not-yet-onboarded users at
 * the per-provider cost-aware default picker (`amicus key <provider>`, Task
 * 6). This is a PRINTED LINE, never an interactive prompt -- it must never
 * wait on stdin.
 *
 * Fires only when ALL of:
 *  - the session is interactive (a real TTY, and not --json/--quiet)
 *  - the user hasn't already seen this notice (`hasTierOnboarded()` false)
 *  - at least one DIRECT provider (openai/anthropic/google/deepseek, via
 *    `provider-registry.listDirectProviders`) has a key configured
 *  - the user hasn't already used the picker (no vendor-named alias set --
 *    no key of `config.aliases` matches a direct-provider id)
 *
 * The flag is only ever set when the notice actually printed. If any gate
 * fails, this is a no-op AND the flag is left unset -- a user who later adds
 * a direct key (or a non-interactive run that becomes interactive) can still
 * see the notice once. Wrapped end-to-end in try/catch: a bug here must never
 * break the command it's attached to.
 * @param {object} [args] parsed CLI args (checked for --json/--quiet to gate interactivity)
 */
function maybeOfferProviderDefaults(args = {}) {
  try {
    const interactive = !!process.stdin.isTTY && !args.json && !args.quiet;
    if (!interactive) { return; }

    const { hasTierOnboarded, markTierOnboarded, loadConfig } = require('./config');
    if (hasTierOnboarded()) { return; }

    const { listDirectProviders } = require('./provider-registry');
    const { readApiKeys } = require('./api-key-store');
    const directProviders = listDirectProviders();
    const apiKeys = readApiKeys();
    const hasDirectKey = directProviders.some((p) => apiKeys[p]);
    if (!hasDirectKey) { return; }

    const config = loadConfig() || {};
    const aliases = (config.aliases && typeof config.aliases === 'object') ? config.aliases : {};
    const hasVendorAlias = directProviders.some((p) => Object.prototype.hasOwnProperty.call(aliases, p));
    if (hasVendorAlias) { return; }

    process.stdout.write(
      'Tip: run `amicus key <provider>` to pick a cost-aware default model per provider ' +
      '(avoids defaulting to the priciest flagship).\n'
    );
    markTierOnboarded();
  } catch (_err) {
    // best-effort: never break the command this is attached to
  }
}

module.exports = {
  resolveLaunchModel,
  deriveAlias,
  maybeOfferProviderDefaults,
};
