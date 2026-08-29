/**
 * Marker-freshness gate (F-3).
 *
 * Promotes `node scripts/generate-docs.js --check` to a jest assertion so a
 * stale generated doc fails CI, not just a manually-run script. The pre-commit
 * hook runs generate-docs in WRITE mode and self-heals, so --check never runs
 * automatically anywhere else — a stale map can only be caught here.
 *
 * The tree/modules markers live in docs/architecture-map.md (not CLAUDE.md);
 * scripts/generate-docs.js MARKER_TARGETS is the routing table.
 *
 * Calls the exported helpers in-process. Never call `main()` or
 * `runCheckMode()` from generate-docs.js — both call `process.exit`, which
 * would kill the jest worker.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  buildDirectoryTree,
  buildModuleIndex,
  checkMarkersAreCurrent,
  validateCrossLinks,
  TREE_DIRS,
} = require('../../scripts/generate-docs');

const ROOT = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf-8');

const FIX_COMMAND = 'node scripts/generate-docs.js';

describe('generated-doc marker freshness (F-3)', () => {
  it('docs/architecture-map.md AUTO markers are current', () => {
    // ⚠️ Cross-platform hazard (do NOT fix here, do not change the sort): both
    // buildDirectoryTree and buildModuleIndex sort their entries via
    // scripts/generate-docs-helpers.js:157-158 (buildTreeRecursive) and :217-220
    // (collectModules), which both use `localeCompare` — locale-dependent, and
    // this --check path has never run in CI before (F-3 is the first thing to
    // run it there). If this test goes red on exactly ONE OS leg of the unit
    // matrix (ubuntu/windows/macos) while the others stay green, that sort is
    // almost certainly why. Fix: swap both call sites to a plain code-unit sort
    // (e.g. `(a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)`) and
    // run `node scripts/generate-docs.js` once to regenerate the map. Do not
    // chase this locally — it only manifests as a cross-OS divergence.
    const tree = buildDirectoryTree(ROOT, TREE_DIRS);
    const modules = buildModuleIndex(ROOT);
    const stale = checkMarkersAreCurrent(read('docs/architecture-map.md'), { tree, modules });
    if (stale.length > 0) {
      throw new Error(
        `Stale docs/architecture-map.md AUTO marker(s): ${stale.join(', ')}. Run \`${FIX_COMMAND}\` to regenerate, then commit docs/architecture-map.md.`,
      );
    }
  });

  it('CLAUDE.md cross-links all resolve', () => {
    const errors = validateCrossLinks(read('CLAUDE.md'), ROOT);
    if (errors.length > 0) {
      throw new Error(
        `Broken CLAUDE.md cross-link(s):\n${errors.join('\n')}\nRun \`${FIX_COMMAND}\` and fix any remaining broken links by hand.`,
      );
    }
  });
});
