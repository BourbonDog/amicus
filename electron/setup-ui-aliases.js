/**
 * Setup UI - Alias Editor
 *
 * Builds collapsible alias groups with search, inline editing,
 * delete, and add functionality for the setup wizard Step 3.
 */

const { groupAliases } = require('./setup-ui-alias-groups');

/** Attribute/text-safe rendering of user-controlled alias names and routes. */
function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build the HTML fragment for the alias editor section
 *
 * Issue 213: groups are derived from each alias's ROUTE VENDOR
 * (setup-ui-alias-groups.js), not from a hardcoded list of alias names, so
 * EVERY alias in `aliases` renders exactly once -- the old whitelist silently
 * dropped any name it did not list (12 of 25 in a real config).
 *
 * @param {Object<string,string>} aliases - Map of alias name to model string
 * @returns {string} HTML fragment with search, groups, rows, and add button
 */
function buildAliasEditorHTML(aliases) {
  const searchInput = '<input type="text" id="alias-search" class="alias-search" placeholder="Search aliases..." autocomplete="off" spellcheck="false">';

  const groups = groupAliases(aliases).map(group => {
    const rows = group.keys
      .map(key => {
        const model = aliases[key];
        return `<div class="alias-row" data-alias="${esc(key)}">` +
          `<span class="alias-name">${esc(key)}</span>` +
          '<span class="alias-arrow">\u2192</span>' +
          `<span class="alias-model">${esc(model)}</span>` +
          `<button class="alias-delete" data-alias="${esc(key)}">\u00d7</button>` +
          '</div>';
      }).join('\n        ');

    // data-vendor records WHICH vendor a group holds, for tests and for anyone
    // inspecting the page. The client does not read it to place rows -- see the
    // SHARED-WITH-THE-BROWSER note in setup-ui-alias-groups.js.
    return `<details class="alias-group" data-vendor="${esc(group.vendor)}">
        <summary>${esc(group.label)} <span class="alias-count">(${group.keys.length})</span></summary>
        ${rows}
      </details>`;
  }).join('\n      ');

  // Pick a representative example from actual aliases
  const exampleAlias = 'gemini';
  // Fallback literal kept in sync with curated-models (toDefaultAliases().gemini)
  const exampleModel = aliases[exampleAlias] || 'openrouter/google/gemini-3.1-flash-lite-preview';

  // SVG icons for the example box
  const terminalIcon = '<svg class="alias-icon-accent" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke-width="1.5"/><path d="M4 6l2.5 2L4 10" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 10H11" class="alias-icon-faint-path" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const arrowIcon = '<svg class="alias-icon-accent" width="20" height="12" viewBox="0 0 20 12" fill="none"><path d="M2 6h14" stroke-width="1.5" stroke-linecap="round"/><path d="M13 2l4 4-4 4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const modelIcon = '<svg class="alias-icon-ok" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke-width="1.5"/><path d="M8 8v3" stroke-width="1.5" stroke-linecap="round"/><circle cx="4" cy="13" r="1.5" stroke-width="1.2"/><circle cx="8" cy="13" r="1.5" stroke-width="1.2"/><circle cx="12" cy="13" r="1.5" stroke-width="1.2"/><path d="M4 11.5L8 11M8 11l4 .5" stroke-width="1" stroke-linecap="round"/></svg>';

  const exampleBox = `<div class="routing-example">
        <div class="example-label">How it works</div>
        <div class="example-flow">
          <div class="example-step">
            ${terminalIcon}
            <span class="example-cmd">amicus start --model <strong>${exampleAlias}</strong></span>
          </div>
          <div class="example-connector">${arrowIcon}</div>
          <div class="example-step">
            ${modelIcon}
            <span class="example-model">${exampleModel}</span>
          </div>
        </div>
      </div>`;

  return `<div class="step-content">
      <h1>Model Routing</h1>
      <p class="subtitle">When you ask Amicus for help, you can pick which LLM to collaborate with or offload tasks to. These names on the left route to the specific model on the right.</p>
      ${exampleBox}
      <div class="alias-editor">
        ${searchInput}
        ${groups}
        <button class="alias-add-btn" id="alias-add-btn">+ Add Custom Route</button>
      </div>
    </div>`;
}

module.exports = { buildAliasEditorHTML };
