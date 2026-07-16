/**
 * Provider-default prompt flow (Part 2, Task 6/7 shared helper).
 *
 * Wraps the transport-agnostic picker core (`provider-default-picker.js`) in
 * a single reusable flow that both the CLI (`amicus key`, Task 6) and the
 * readline setup wizard (Task 7) call after a provider's API key is saved:
 * build the priced choice list, either prompt for a selection (interactive)
 * or silently take the tier-preselected id (non-interactive), then apply it.
 *
 * Transport-agnostic by injection: `ask` (a `(prompt: string) => Promise<string>`
 * readline reader) and `print` (a `(line: string) => void` line writer) are
 * both passed in by the caller, so this module is unit-testable without a
 * real TTY and never imports `readline`/`console` itself.
 */

'use strict';

const { buildProviderDefaultChoices, applyProviderDefault } = require('./provider-default-picker');
const { isDirectProvider } = require('./provider-registry');

/** Format a $/M-input price for display; `null`/`undefined` -> 'n/a'. @param {number|null|undefined} pricePerMInput */
function formatPrice(pricePerMInput) {
  return (pricePerMInput === null || pricePerMInput === undefined)
    ? 'n/a'
    : `$${pricePerMInput.toFixed(2)}/M in`;
}

/** One numbered display line for a single choice row. @param {object} row @param {number} index 1-based */
function formatRow(row, index) {
  const ctx = (row.contextLength === null || row.contextLength === undefined) ? '' : ` · ctx ${row.contextLength}`;
  const recommended = row.isPreselected ? '  (recommended)' : '';
  return `  ${index}) ${row.name}${ctx} · ${formatPrice(row.pricePerMInput)}${recommended}`;
}

/**
 * Read one selection line, re-prompting once on an invalid non-empty entry
 * before falling back to the preselected id. Empty input (bare Enter) always
 * accepts the preselected id immediately, no re-prompt.
 * @param {(prompt: string) => Promise<string>} ask
 * @param {(line: string) => void} print
 * @param {{preselectedId: string, rows: Array<{id: string}>}} choices
 * @returns {Promise<string>}
 */
async function promptForChoice(ask, print, choices) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = (await ask(`Pick a number (1-${choices.rows.length}, Enter for recommended): `) || '').trim();
    if (answer === '') { return choices.preselectedId; }
    if (/^\d+$/.test(answer)) {
      const num = Number.parseInt(answer, 10);
      if (num >= 1 && num <= choices.rows.length) {
        return choices.rows[num - 1].id;
      }
    }
    if (attempt === 0) { print(`Invalid choice: "${answer}".`); }
  }
  return choices.preselectedId;
}

/**
 * Run the per-provider default-model flow: build choices, resolve a pick
 * (prompted or silent), apply it, and hand back a one-line summary for the
 * caller to print. Never throws for an empty/offline catalog -- callers
 * should still wrap this in a try/catch (a picker bug must never abort an
 * already-successful key save).
 *
 * Gateway providers (e.g. `openrouter`) are a graceful no-op: `openrouter` is
 * the GATEWAY, not a model vendor, so `buildProviderDefaultChoices` would
 * match every OR-namespaced catalog row, "recommended" would be arbitrary,
 * and writing `aliases.openrouter = "<some vendor>/<model>"` would be
 * nonsensical. Per-provider defaults only make sense for DIRECT model
 * vendors (`provider-registry.isDirectProvider`) -- no choices are built, no
 * alias is written, and `config.default` is never seeded for a gateway.
 * @param {string} provider vendor name, e.g. 'anthropic'
 * @param {{interactive?: boolean, ask?: (prompt: string) => Promise<string>,
 *   catalog?: Array<object>, print?: (line: string) => void}} [options]
 * @returns {Promise<{chosenId: (string|null), setAsDefault: boolean, summaryLine: string}>}
 */
async function runProviderDefaultFlow(provider, options = {}) {
  const { interactive = false, ask } = options;
  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  const print = typeof options.print === 'function' ? options.print : () => {};

  if (!isDirectProvider(provider)) {
    return {
      chosenId: null,
      setAsDefault: false,
      summaryLine: 'Per-provider defaults apply to direct provider keys (openai/anthropic/google/deepseek) -- ' +
        'models routed via OpenRouter use your overall default.',
    };
  }

  const choices = buildProviderDefaultChoices(provider, { catalog });
  if (!choices.rows || choices.rows.length === 0) {
    return {
      chosenId: null,
      setAsDefault: false,
      summaryLine: `Couldn't reach the model catalog for ${provider} — no default set. ` +
        `Run \`amicus key ${provider}\` again later.`,
    };
  }

  let chosenId = choices.preselectedId;
  if (interactive && typeof ask === 'function') {
    print('');
    print(`Pick a default model for ${provider}:`);
    choices.rows.forEach((row, i) => print(formatRow(row, i + 1)));
    print('');
    chosenId = await promptForChoice(ask, print, choices);
  }

  const { setAsDefault } = applyProviderDefault(provider, chosenId, { seedDefaultIfAbsent: true });
  const summaryLine = `\`amicus start --model ${provider}\` → ${chosenId}` +
    (setAsDefault ? ', set as your default model' : '');

  return { chosenId, setAsDefault, summaryLine };
}

module.exports = { runProviderDefaultFlow, formatPrice, formatRow };
