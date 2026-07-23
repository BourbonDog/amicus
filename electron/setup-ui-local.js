/**
 * Setup UI — "Local server" step-1 add-on widget (Task 13, v4.2 §4.6).
 *
 * The Electron-wizard equivalent of Task 12's readline `addLocalProviderInteractive`
 * (src/sidecar/setup-local.js): lets the user point the wizard at a self-hosted
 * OpenAI-compatible server (Ollama, LM Studio, vLLM, or any other) without leaving
 * the GUI. LM Studio leads the chip order and the widget copy — a LOCKED parity
 * constraint (the readline wizard's own preset prompt order is `ollama / lmstudio /
 * vllm`, but this card is not required to mirror that order).
 *
 * RULING B12/D8: `electron/setup-ui-keys.js`'s provider cards (buildKeysStepHTML)
 * are bare id/name/description buttons feeding ONE shared key-section — there is no
 * per-provider card with its own fields to extend, and this widget needs two
 * simultaneous fields (URL + bearer) plus N preset chips plus a differently-behaved
 * Test button. So, per the convention `setup-ui-provider-default.js` and
 * `setup-ui-council.js` already establish, this is its own `setup-ui-*.js` +
 * `*-script.js` pair, spliced into `setup-ui.js`'s step-1 assembly, rather than
 * grown into setup-ui-keys.js / setup-ui-keys-script.js.
 *
 * Consumes (at render time): `PRESETS` (src/utils/local-providers.js, Task 1) for the
 * three built-in chip URLs/flavors — single-sourced rather than re-hardcoded here.
 * The runtime script (setup-ui-local-script.js) additionally consumes the
 * `setup:probe-local` / `setup:save-local-provider` IPC handlers (ipc-setup.js,
 * Task 13) at click time.
 */
'use strict';

const { PRESETS } = require('../src/utils/local-providers');

/** LOCKED parity constraint: LM Studio leads (chip order + widget title/copy). */
const CHIP_ORDER = [
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'vllm', label: 'vLLM' },
];

/**
 * Build the HTML fragment for the Local server widget (spliced into wizard-step-1,
 * beneath the key step and the per-provider default picker section).
 * @returns {string} HTML fragment (not a full document)
 */
function buildLocalSectionHTML() {
  const chips = CHIP_ORDER.map((c) => {
    const preset = PRESETS[c.id];
    return `<button type="button" class="local-chip" data-preset="${c.id}" ` +
      `data-url="${preset.baseURL}" data-flavor="${preset.flavor}">${c.label}</button>`;
  }).join('\n        ');

  return `<div class="local-section" id="local-section">
      <div class="local-divider">Local server &mdash; LM Studio &middot; Ollama &middot; vLLM</div>
      <p class="local-subtitle">Connect a self-hosted OpenAI-compatible server. No API key required for most.</p>
      <div class="local-chips" id="local-chips">
        ${chips}
      </div>
      <label class="field-label" for="local-id-input">Provider ID</label>
      <div class="input-row">
        <input id="local-id-input" type="text" placeholder="lmstudio" autocomplete="off" spellcheck="false">
      </div>
      <label class="field-label" for="local-url-input">Server URL</label>
      <div class="input-row">
        <input id="local-url-input" type="text" placeholder="http://127.0.0.1:1234/v1" autocomplete="off" spellcheck="false">
      </div>
      <label class="field-label" for="local-bearer-input">Bearer token (optional)</label>
      <div class="input-row">
        <input id="local-bearer-input" type="password" placeholder="" autocomplete="off" spellcheck="false">
        <button class="test-btn" id="local-test-btn" type="button">Test connection</button>
      </div>
      <div class="key-actions">
        <span id="local-status-msg"></span>
        <button class="nav-btn" id="local-save-btn" type="button">Save local server</button>
      </div>
    </div>`;
}

module.exports = { buildLocalSectionHTML, CHIP_ORDER };
