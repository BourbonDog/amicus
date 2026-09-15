/**
 * @module electron/setup-ui-alias-state
 * Inline page script: what an alias row MEANS (issue 238 D1/D9) and what Finish writes for the Step 2 default (issue 238 Q9).
 * Runs in the wizard page (no require()), in the same <script> as
 * setup-ui.js's wizard script, so it reads the page's `aliasEdits`,
 * `defaultAliases` and `$`, and its function declarations are hoisted for
 * the fragments that call them (setup-ui-alias-script.js's remove handler,
 * setup-ui-alias-review.js, buildReview / Finish in setup-ui.js).
 *
 * THE STATE RULE (one rule, both surfaces): a curated alias FOLLOWS when its
 * effective value equals the shipped id and is PINNED otherwise; a custom
 * alias is always pinned. The CLI encodes the same state as key PRESENCE
 * (src/utils/alias-state.js :: listAliasRows); the two agree the moment a
 * config is saved, because `saveConfig` removes every key equal to its
 * shipped id (D6's no-op proof) — and the page's labels must show what
 * Finish will PRODUCE, not what an un-normalized file happens to hold.
 *
 * Every write here is STAGED into `aliasEdits` (string = set, null = remove
 * the key — Q4's encoding: the shipped id folds to null); nothing reaches
 * disk until Finish (electron/ipc-setup.js, sidecar:save-config). Rows are
 * found by attribute compare, never by interpolating a name into a selector.
 * Text reaches the DOM through textContent only.
 */

'use strict';

/**
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildAliasStateScript() {
  return `
  // issue 238 D1: curated = the name is in the shipped map (own key; a
  // literal toString/constructor name is a custom alias, as everywhere else).
  // Three lines on purpose: the test harnesses extract functions up to the
  // first two-space-indented closing brace.
  function isCuratedAlias(alias) {
    return Object.prototype.hasOwnProperty.call(defaultAliases, alias);
  }

  // { curated, state } for an alias that will hold \`value\` -- THE STATE RULE
  // (module docblock). Exact equality, the same test saveConfig's normalizer
  // applies; a gateway-form twin of the shipped id is a pin here as it is
  // on the CLI list ("same model as shipped, other gateway").
  function aliasStateFor(alias, value) {
    var curated = isCuratedAlias(alias);
    return { curated: curated, state: (curated && value === defaultAliases[alias]) ? 'following' : 'pinned' };
  }

  // The rendered row for \`alias\`, by attribute compare -- never a selector
  // built from the name (a quote in a name would break it).
  function aliasRowFor(alias) {
    var rows = document.querySelectorAll('.alias-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-alias') === alias) { return rows[i]; }
    }
    return null;
  }

  // The value the row WILL hold after Finish: the staged write when there is
  // one (null = the key goes, so a curated name resolves to the shipped id),
  // else what is on screen.
  function stagedValueFor(row) {
    var alias = row.getAttribute('data-alias') || '';
    if (Object.prototype.hasOwnProperty.call(aliasEdits, alias)) {
      return aliasEdits[alias] === null ? (defaultAliases[alias] || '') : aliasEdits[alias];
    }
    var span = row.querySelector('.alias-model');
    return span ? span.textContent : '';
  }

  // Re-label one row from its staged value: data-state, the state label, and
  // the remove control -- a following curated row has no key to remove, so
  // its [unpin] hides (it comes back the moment an edit pins the row).
  function refreshAliasRowState(row) {
    var alias = row.getAttribute('data-alias') || '';
    var s = aliasStateFor(alias, stagedValueFor(row));
    row.setAttribute('data-state', s.state);
    var label = row.querySelector('.alias-state');
    if (label) {
      label.textContent = s.state;
      label.className = 'alias-state alias-state-' + s.state;
    }
    var btn = row.querySelector('.alias-delete');
    if (btn) {
      btn.setAttribute('data-kind', s.curated ? 'unpin' : 'delete');
      btn.textContent = s.curated ? 'unpin' : '\\u00d7';
      btn.title = s.curated ? 'Unpin: go back to following the shipped recommendation' : 'Delete this alias';
      btn.hidden = s.curated && s.state === 'following';
    }
    return s.state;
  }

  // [unpin] on a curated pin: the key goes; the row shows the shipped id it
  // now follows -- NOT a strike-through, the alias still exists (D1).
  function unpinAliasRow(row) {
    var alias = row.getAttribute('data-alias') || '';
    aliasEdits[alias] = null;
    var span = row.querySelector('.alias-model');
    if (span) { span.textContent = defaultAliases[alias] || ''; }
    refreshAliasRowState(row);
  }

  // Stage "alias -> id" the way Q4 encodes it: the shipped id means FOLLOW
  // (remove the key), anything else pins. Updates the list row in place --
  // a struck-out row comes back -- and opens its group so the change is on
  // screen. An alias with no row yet (a notable added this session) just
  // stages. Returns the resulting state.
  function stageAliasWrite(alias, id) {
    var s = aliasStateFor(alias, id);
    aliasEdits[alias] = s.state === 'following' ? null : id;
    var row = aliasRowFor(alias);
    if (row) {
      var span = row.querySelector('.alias-model');
      if (span) { span.textContent = id; }
      row.classList.remove('alias-deleted');
      if (typeof refreshAliasCounts === 'function') { refreshAliasCounts(); }
      refreshAliasRowState(row);
      var group = row.closest('.alias-group');
      if (group) { group.open = true; }
    }
    return s.state;
  }`;
}

module.exports = { buildAliasStateScript };
