/** Setup UI - Shared CSS Styles (clay/gold token-driven) */
const { tokenCss } = require('../src/design/tokens');

/** The wizard's own rules, token-var-driven. No :root here — tokenCss() supplies it. */
function __rawWizardCSS() {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--font-sans);
    display: flex; flex-direction: column; height: 100vh; user-select: none;
    overflow: hidden;
  }

  /* Header */
  .header {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 20px; border-bottom: 1px solid var(--border);
  }
  .header svg { flex-shrink: 0; }
  .header svg path { stroke: var(--accent); }
  .header-title {
    color: var(--accent); font-size: 12px; font-weight: 600;
    letter-spacing: 0.8px; text-transform: uppercase;
  }

  /* Progress bar / stepper */
  .progress-bar {
    display: flex; align-items: center; justify-content: center;
    gap: 14px; padding: 10px 20px; border-bottom: 1px solid var(--border);
  }
  .progress-step {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--text-faint);
  }
  .progress-step.active { color: var(--accent); }
  .progress-step.done { color: var(--ok); }
  .progress-dot {
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid var(--border-strong); display: flex;
    align-items: center; justify-content: center;
    font-size: 9px; font-weight: 600;
  }
  .progress-step.active .progress-dot {
    border-color: var(--accent); background: var(--accent); color: var(--accent-text);
  }
  .progress-step.done .progress-dot {
    border-color: var(--ok); background: var(--ok); color: var(--accent-text);
  }
  .progress-connector { width: 24px; height: 2px; background: var(--border); }

  /* Content area */
  .content { flex: 1; padding: 16px 20px; overflow-y: auto; }
  .wizard-step { display: none; }
  .wizard-step.visible { display: block; }

  /* Shared typography */
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; color: var(--text); }
  .subtitle { color: var(--text-muted); font-size: 13px; margin-bottom: 14px; }

  /* Provider picker (Step 1) */
  .provider-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .provider-btn {
    display: flex; flex-direction: column; gap: 1px; position: relative;
    padding: 8px 12px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-6); cursor: pointer; text-align: left;
    transition: border-color var(--dur-fast), background var(--dur-fast);
  }
  .provider-btn:hover { border-color: var(--border-strong); }
  .provider-btn.selected { border-color: var(--accent); background: var(--surface-sel); }
  .provider-name {
    color: var(--text); font-size: 13px; font-weight: 500;
    display: flex; align-items: center; gap: 6px;
  }
  .provider-desc { color: var(--text-faint); font-size: 11px; }
  .provider-check { position: absolute; top: 8px; right: 12px; font-size: 13px; color: var(--ok); }
  .badge {
    font-size: 9px; background: var(--accent); color: var(--accent-text); padding: 1px 5px;
    border-radius: var(--r-3); font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Key input (Step 1) */
  .key-section { display: none; }
  .key-section.visible { display: block; }
  .field-label {
    display: block; color: var(--text-muted); font-size: 11px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
  }
  .input-row { display: flex; gap: 6px; margin-bottom: 6px; }
  .input-row input {
    flex: 1; padding: 7px 10px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-6); color: var(--text); font-size: 13px;
    font-family: var(--font-mono); outline: none;
    transition: border-color var(--dur-fast);
  }
  .input-row input:focus { border-color: var(--accent); }
  .input-row input::placeholder { color: var(--text-faint); }
  .input-wrap {
    flex: 1; position: relative; display: flex; align-items: center;
  }
  .input-wrap input { width: 100%; padding-right: 34px; }
  .eye-btn {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; color: var(--text-faint);
    padding: 2px; display: flex; align-items: center; transition: color var(--dur-fast);
  }
  .eye-btn:hover { color: var(--text-muted); }
  .eye-btn.active { color: var(--accent); }
  .key-actions {
    display: flex; align-items: center; justify-content: space-between;
    min-height: 18px; margin-bottom: 8px;
  }
  .remove-btn {
    background: none; border: none; color: var(--danger); font-size: 11px;
    cursor: pointer; padding: 0; opacity: 0.8; transition: opacity var(--dur-fast);
  }
  .remove-btn:hover { opacity: 1; text-decoration: underline; }
  .test-btn {
    padding: 7px 12px; background: transparent; border: 1px solid var(--border);
    border-radius: var(--r-6); color: var(--text-muted); font-size: 12px; cursor: pointer;
    white-space: nowrap; transition: border-color var(--dur-fast), color var(--dur-fast);
  }
  .test-btn:hover { border-color: var(--accent); color: var(--accent); }
  .test-btn:disabled { opacity: 0.5; cursor: default; }
  .input-row input.input-valid {
    border-color: var(--ok); background: var(--accent-soft);
  }
  .input-row input.input-invalid {
    border-color: var(--danger); background: var(--accent-soft);
  }
  .input-row input.input-testing {
    border-color: var(--accent);
  }
  #status-msg { font-size: 12px; min-height: 16px; margin-bottom: 8px; }
  .status-valid { color: var(--ok); }
  .status-invalid { color: var(--danger); }
  .status-testing { color: var(--text-muted); }
  .help-link { color: var(--text-faint); font-size: 12px; }
  .help-link a { color: var(--accent); text-decoration: none; }
  .help-link a:hover { text-decoration: underline; }

  /* Model cards (Step 2) */
  .model-list { display: flex; flex-direction: column; gap: 4px; }
  .model-card {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 9px 12px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-6); cursor: pointer;
    transition: border-color var(--dur-fast), background var(--dur-fast);
  }
  .model-card:hover { border-color: var(--border-strong); }
  .model-card:has(input:checked) { border-color: var(--accent); background: var(--surface-sel); }
  .model-card.model-unavailable {
    opacity: 0.45; cursor: not-allowed; border-color: var(--border);
  }
  .model-card.model-unavailable:hover { border-color: var(--border); }
  .model-card input[type="radio"] { accent-color: var(--accent); }
  .model-alias { color: var(--text); font-weight: 500; font-size: 13px; min-width: 80px; font-family: var(--font-mono); }
  .model-label { color: var(--text-muted); font-size: 12px; }
  .no-key-hint {
    margin-left: auto; font-size: 10px; color: var(--text-faint); font-style: italic;
  }

  /* Route toggle / RoutePill (Step 2) */
  .route-toggle {
    display: flex; gap: 0; margin-left: auto;
  }
  .route-pill {
    padding: 3px 8px; font-size: 10px; font-weight: 500;
    font-family: var(--font-sans);
    background: var(--surface); border: 1px solid var(--border);
    color: var(--text-faint); cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast);
  }
  .route-pill:first-child { border-radius: var(--r-4) 0 0 var(--r-4); }
  .route-pill:last-child { border-radius: 0 var(--r-4) var(--r-4) 0; border-left: none; }
  .route-pill:only-child { border-radius: var(--r-4); }
  .route-pill.active {
    background: var(--accent); color: var(--accent-text); border-color: var(--accent);
  }
  .route-pill:hover:not(.active) { border-color: var(--border-strong); color: var(--text-muted); }
  .route-static {
    margin-left: auto; font-size: 11px; color: var(--text-faint); font-style: italic;
  }

  /* Routing example */
  .routing-example {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-8);
    padding: 12px 16px; margin-bottom: 12px;
  }
  .example-label {
    font-size: 10px; color: var(--text-faint); text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 10px; font-weight: 600;
  }
  .example-flow { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .example-step {
    display: flex; align-items: center; gap: 6px; width: 100%;
    background: var(--surface-hover); border: 1px solid var(--border);
    border-radius: var(--r-6); padding: 6px 10px;
  }
  .example-step svg { flex-shrink: 0; }
  .example-connector { display: flex; align-items: center; transform: rotate(90deg); }
  .example-cmd {
    font-family: var(--font-mono); font-size: 12px;
    color: var(--text-muted); overflow: hidden; text-overflow: ellipsis;
  }
  .example-cmd strong { color: var(--accent); }
  .example-model {
    font-family: var(--font-mono); font-size: 11px;
    color: var(--ok); overflow: hidden; text-overflow: ellipsis;
  }

  /* Alias editor (Step 3) */
  .alias-editor { margin-top: 16px; }
  .alias-divider {
    text-align: center; color: var(--text-faint); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;
    border-top: 1px solid var(--border); padding-top: 12px;
  }
  .alias-search {
    width: 100%; padding: 7px 10px; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--r-6); color: var(--text);
    font-size: 12px; font-family: var(--font-mono);
    outline: none; margin-bottom: 8px; transition: border-color var(--dur-fast);
  }
  .alias-search:focus { border-color: var(--accent); }
  .alias-search::placeholder { color: var(--text-faint); }
  .alias-group { margin-bottom: 2px; }
  .alias-group summary {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    cursor: pointer; font-size: 12px; font-weight: 500; color: var(--text-muted);
    border-radius: var(--r-4); transition: color var(--dur-fast); list-style: none;
  }
  .alias-group summary::-webkit-details-marker { display: none; }
  .alias-group summary::before {
    content: '\\25B6'; font-size: 8px; color: var(--text-faint); transition: transform var(--dur-fast);
  }
  .alias-group[open] summary::before { transform: rotate(90deg); }
  .alias-group summary:hover { color: var(--accent); }
  .alias-group summary .alias-count { color: var(--text-faint); font-weight: 400; }
  .alias-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px 3px 22px; font-size: 12px;
  }
  .alias-name {
    font-family: var(--font-mono);
    color: var(--text); min-width: 90px; cursor: pointer;
  }
  .alias-arrow { color: var(--text-faint); font-size: 11px; }
  .alias-model {
    flex: 1; font-family: var(--font-mono);
    color: var(--text-faint); font-size: 11px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
  }
  .alias-delete {
    background: none; border: none; color: var(--text-faint); cursor: pointer;
    font-size: 14px; padding: 0 4px; transition: color var(--dur-fast);
  }
  .alias-delete:hover { color: var(--danger); }
  .alias-name-input, .alias-model-input {
    padding: 2px 6px; background: var(--surface); border: 1px solid var(--accent);
    border-radius: var(--r-3); color: var(--text); font-size: 12px;
    font-family: var(--font-mono); outline: none;
  }
  .alias-name-input { width: 90px; }
  .alias-model-input { flex: 1; }
  .alias-model-select {
    flex: 1; padding: 2px 4px; background: var(--surface);
    border: 1px solid var(--accent); border-radius: var(--r-3);
    color: var(--text); font-size: 11px;
    font-family: var(--font-mono);
    outline: none; cursor: pointer; max-width: 340px;
  }
  .alias-model-select:focus { border-color: var(--accent); }
  .alias-model-select option { background: var(--surface); color: var(--text); }
  .alias-model-select optgroup { color: var(--text-muted); font-style: normal; }
  .alias-add-btn {
    display: block; width: 100%; padding: 6px; margin-top: 8px;
    background: transparent; border: 1px dashed var(--border);
    border-radius: var(--r-6); color: var(--text-faint); font-size: 12px;
    cursor: pointer; transition: border-color var(--dur-fast), color var(--dur-fast);
  }
  .alias-add-btn:hover { border-color: var(--accent); color: var(--accent); }
  .alias-row.alias-deleted { text-decoration: line-through; opacity: 0.4; pointer-events: none; }
  .alias-row.alias-no-key { opacity: 0.45; }
  .alias-row.alias-no-key .alias-model::after {
    content: ' (no key)'; color: var(--text-faint); font-style: italic; font-size: 10px;
  }

  /* Import notice banner */
  .import-notice {
    background: var(--surface-hover); border: 1px solid var(--accent); border-radius: var(--r-6);
    padding: 8px 12px; margin-bottom: 12px; font-size: 11px;
    color: var(--accent); display: flex; align-items: center; gap: 8px;
  }
  .import-notice .dismiss { cursor: pointer; margin-left: auto; opacity: 0.6; }
  .import-notice .dismiss:hover { opacity: 1; }

  /* Review (Step 4) */
  .review-section { margin-bottom: 14px; }
  .review-label { color: var(--text-muted); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .review-value { color: var(--text); font-size: 13px; line-height: 1.5; }

  /* Footer */
  .footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 20px; border-top: 1px solid var(--border);
  }
  .footer-brand {
    color: var(--accent); font-size: 10px; font-weight: 600;
    letter-spacing: 0.8px; text-transform: uppercase;
    display: flex; align-items: center; gap: 6px;
  }
  .footer-brand svg path { stroke: var(--accent); }
  .footer-nav { display: flex; gap: 6px; }
  .nav-btn {
    padding: 6px 16px; border: 1px solid var(--border);
    border-radius: var(--r-6); font-size: 12px; font-weight: 500;
    cursor: pointer; transition: border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast);
    background: transparent; color: var(--text-muted);
  }
  .nav-btn:hover { border-color: var(--accent); color: var(--accent); }
  .nav-btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .nav-btn.primary:hover { background: var(--accent-hover); }
  .nav-btn:disabled { opacity: 0.4; cursor: default; }

  /* Catalog search (Step 2) */
  .search-head { display: flex; gap: 8px; margin: 18px 0 8px; }
  #model-search-input { flex: 1; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--r-6); padding: 8px 10px; font-size: 13px; font-family: var(--font-mono); }
  .search-meta { color: var(--text-faint); font-size: 11px; margin-bottom: 6px; }
  .search-results { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--r-6); }
  .search-results:empty { border: none; }
  .search-row { padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--border); }
  .search-row:hover { background: var(--surface-hover); }
  .search-row.selected { background: var(--surface-sel); outline: 1px solid var(--accent); }
  .search-row-id { color: var(--text); font-size: 12px; font-family: var(--font-mono); }
  .search-row-sub { color: var(--text-muted); font-size: 11px; margin-top: 2px; }
  .icon-btn { background: none; border: 1px solid var(--border); border-radius: var(--r-6); color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 6px 10px; }
  .icon-btn:hover { border-color: var(--accent); color: var(--accent); }
  .icon-btn:disabled { opacity: 0.5; cursor: default; }
  .search-label { margin: 14px 0 6px; font-size: 12px; opacity: 0.75; }
  .pick-badge { font-size: 10px; padding: 1px 5px; border-radius: var(--r-3); background: var(--surface-hover); color: var(--text-muted); margin-left: 6px; }
  .model-resolved { display: block; font-size: 11px; opacity: 0.6; font-family: var(--font-mono); }
  .write-preview { display: none; font-size: 11px; margin-top: 4px; }
  .write-preview-active { display: block; }

  /* Free council picker (Step 2) */
  .council-section { margin-top: 14px; }
  .council-toggle { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); cursor: pointer; }
  .council-results { max-height: 160px; overflow-y: auto; margin-top: 6px; }
  .council-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; color: var(--text); font-family: var(--font-mono); }
  .council-row input[type="checkbox"] { accent-color: var(--accent); }
  .council-note { font-size: 10px; color: var(--text-faint); margin-top: 6px; line-height: 1.4; }

  /* Alias example-icon strokes — driven by class rules (var() is invalid as an SVG attribute) */
  .alias-icon-accent path { stroke: var(--accent); }
  .alias-icon-accent rect { stroke: var(--accent); }
  .alias-icon-accent .alias-icon-faint-path { stroke: var(--text-faint); }
  .alias-icon-faint-path { stroke: var(--text-faint); }
  .alias-icon-ok path { stroke: var(--ok); }
  .alias-icon-ok circle { stroke: var(--ok); }`;
}

function buildWizardCSS() {
  return tokenCss({ absoluteFontUrls: true }) + __rawWizardCSS();
}

module.exports = { buildWizardCSS, __rawWizardCSS };
