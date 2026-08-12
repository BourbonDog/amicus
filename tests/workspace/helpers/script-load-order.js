'use strict';

/**
 * Canonical electron/workspace-ui/*.js script load order (index.html script tags, bottom to
 * top: md-lite → live-model → workspace-render → workspace-matrix → workspace-seats →
 * workspace-panels → workspace-verbs → workspace-app). ⚠️ CODE REVIEW (round 2, finding 5):
 * this list used to be hand-duplicated in both tests/electron/workspace-ui-static.test.js
 * (which asserts index.html matches it) and tests/workspace/workspace-app-boundary.test.js
 * (which requires the files in this order) — two copies with no cross-check can silently
 * drift apart. Base names, no `.js` suffix, so each consumer can adapt it to its own need (a
 * `src="./${name}.js"` substring match vs. a bare `require()` path).
 *
 * ⚠️ D8 extraction (Task 1, v4.6.2 PR4): added 'workspace-seats' between 'workspace-matrix'
 * and 'workspace-panels' — panels.js's renderSeatsPanel now delegates to it, so it must load
 * first. Updating this one shared list is sufficient for every consumer above; none of them
 * needed a direct edit.
 *
 * ⚠️ v4.7 PR7 extraction (Task 1): added 'workspace-lazy' between 'workspace-seats' and
 * 'workspace-panels' — panels.js's wireLazyPanels/proseLoader now delegate to it, so it must
 * load first. Same one-list-updates-both-consumers property as the D8 note above.
 */
const SCRIPT_LOAD_ORDER = [
  'md-lite',
  'live-seats',
  'live-model',
  'workspace-render',
  'workspace-matrix',
  'workspace-seats',
  'workspace-lazy',
  'workspace-panels',
  'workspace-verbs',
  'workspace-app',
];

module.exports = { SCRIPT_LOAD_ORDER };
