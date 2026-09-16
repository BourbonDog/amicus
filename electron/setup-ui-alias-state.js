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
    if (typeof removeProposalRow === 'function') { removeProposalRow(alias); }
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
    if (typeof removeProposalRow === 'function') { removeProposalRow(alias); }
    return s.state;
  }

  // ---- issue 238 Q9: what Finish writes for the Step 2 default ----
  var restoredDefault = null;     // cfg.default as restored by init (setup-ui.js), null on a fresh config
  var defaultTouched = false;     // a radio / route-pill / drill-down interaction happened this session
  var stagedDismissals = [];      // "never ask again" keys the review section staged; Finish writes them

  // A Step 2 touch is a CHOICE only on the checked card (or the radio itself):
  // a drill-down or pill on another card changes nothing Finish writes
  // (collectAliasWrites reads the checked alias only), so it must not turn a
  // restored default into a chosen one (Q9; council review of PR 253, C2).
  // Controls carry data-alias; the checked radio's value is the alias.
  function touchesCheckedDefault(el) {
    var r = document.querySelector('input[name="default-model"]:checked');
    return !!r && el.getAttribute('data-alias') === r.value;
  }
  document.addEventListener('change', function(e) {
    var t = e.target;
    var pick = t && t.closest ? t.closest('.model-pick') : null;
    if (t && (t.name === 'default-model' || (pick && touchesCheckedDefault(pick)))) {
      defaultTouched = true;
      // issue 238 Q9 ruling: setup-ui.js's OWN change handler already called
      // updateWritePreviews() before this listener flips defaultTouched --
      // refresh again now so the note reflects the touch immediately.
      if (typeof updateWritePreviews === 'function') { updateWritePreviews(); }
    }
  });
  document.addEventListener('click', function(e) {
    var t = e.target;
    var pill = t && t.closest ? t.closest('.route-pill') : null;
    // a click on an ALREADY-checked radio fires no change event, so it is recognised here too
    if (t && t.closest && (t.closest('input[name="default-model"]') || (pill && touchesCheckedDefault(pill)))) {
      defaultTouched = true;
      if (typeof updateWritePreviews === 'function') { updateWritePreviews(); }
    }
  });

  // The default was CHOSEN this session when the user touched Step 2's
  // controls, or the checked radio is not the one init restored -- a fresh
  // config restores nothing, so its auto-checked card counts, and its
  // write-preview announces the pin. A restored, untouched default is not a
  // choice: the wizard writes only what the user actively chose (Q9).
  function defaultWasChosen() {
    if (defaultTouched) { return true; }
    var r = document.querySelector('input[name="default-model"]:checked');
    return !!r && r.value !== restoredDefault;
  }

  // Q4's encoding over a whole write map: a write equal to the shipped id
  // becomes null (remove the key = follow). saveConfig would normalize it
  // away anyway; folding HERE keeps the Review step truthful -- "(now
  // follows …)" or nothing, never "1 alias(es) modified" for a write that
  // leaves disk unchanged.
  function foldShippedWrites(writes) {
    var out = Object.create(null);
    Object.keys(writes).forEach(function(alias) {
      var v = writes[alias];
      out[alias] = (typeof v === 'string' && isCuratedAlias(alias) && v === defaultAliases[alias]) ? null : v;
    });
    return out;
  }

  // The Step 2 announcement (Q9, spec §6.5): both ids when the live pick
  // differs from the shipped pin -- the readline wizard's sentence.
  function describeDefaultWrite(alias, routeId) {
    if (!routeId) { return ''; }
    if (!isCuratedAlias(alias)) { return 'pinned'; }
    if (routeId === defaultAliases[alias]) { return 'follows the shipped recommendation'; }
    return 'live flagship differs from the shipped ' + defaultAliases[alias] + ' \\u2014 pinned';
  }

  // issue 238 R-P3-13 on the Step 2 card (council review of PR 253, C1): when
  // Step 3 staged the chosen alias, finishPlan keeps THAT and the route pick
  // here is not applied -- so the card announces the stage, never a write it
  // will not make. null = the key goes: a curated alias then follows the
  // shipped id. Returns null when Step 3 staged nothing for the alias.
  function stagedDefaultPreview(alias) {
    if (!Object.prototype.hasOwnProperty.call(aliasEdits, alias)) { return null; }
    var v = aliasEdits[alias];
    if (v === null) { return { id: defaultAliases[alias] || '', note: 'unpinned on the Routing step \\u2014 follows the shipped recommendation; the route pick here is not applied' }; }
    return { id: v, note: 'set on the Routing step \\u2014 the route pick here is not applied' };
  }

  // Everything Finish sends, computed ONE way for the Review step and the
  // Finish button (F4: the review must never under-report the write).
  // collectAliasWrites is unchanged: it gets NO selected alias when the
  // default was merely restored, so its Step 2 stage does not run.
  function finishPlan() {
    var r = document.querySelector('input[name="default-model"]:checked');
    var isCustom = !!window.customDefaultModel;
    // issue 238 R-P3-13 (owner ruling 2026-09-15): the Routing step is the last
    // word on an alias. The Step 2 route pick is applied to the chosen default
    // ONLY when Step 3 staged nothing for it -- otherwise collectAliasWrites
    // gets no selected alias and the staged entry survives (issue 138's
    // decision #2 now stops at the alias editor).
    var selected = (!isCustom && r && defaultWasChosen() && !Object.prototype.hasOwnProperty.call(aliasEdits, r.value)) ? r.value : null;
    return {
      defaultModel: window.customDefaultModel || (r ? r.value : null),
      selected: selected,
      writes: foldShippedWrites(collectAliasWrites(selected, isCustom)),
      dismissals: stagedDismissals.slice(),
    };
  }`;
}

module.exports = { buildAliasStateScript };
