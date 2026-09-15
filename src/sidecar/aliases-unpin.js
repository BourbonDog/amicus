/**
 * @module sidecar/aliases-unpin
 * `amicus aliases --unpin <name>` (#238 F6, R1) — moved verbatim out of
 * aliases.js in Phase 2 to keep that module under the 300-line gate once the
 * retired-pin flag and the `--owner` dispatch landed. Behaviour and messages
 * are unchanged; tests/sidecar/aliases-command.test.js's --unpin block is the
 * regression net. Requires `safeFragment`/`collapseExcerpt` from
 * utils/text-sanitize.js exactly as the original did.
 */

'use strict';

const { safeFragment, collapseExcerpt } = require('../utils/text-sanitize');

/**
 * `amicus aliases --unpin <name>` (#238 F6, R1): "unpin" and "delete" are one
 * operation -- remove the key -- whose meaning is decided by whether the
 * name is curated (D1). The name is trimmed before every use -- for the
 * `removeAlias` lookup, the `isCurated` check and both success messages --
 * so a padded name neither crashes nor mis-reports which branch fired
 * (#249 r1 R1). Blank/whitespace/literal-'null' names are refused here, and
 * `removeAlias` is called under try/catch so any other throw (its own name
 * guard included) becomes a clean exit 1, never an uncaught crash.
 *
 * R4 (#249 r2 D2): refused BEFORE any write when `name` is also
 * `config.default` and NOT curated -- deleting it would leave the default
 * dangling on a key that no longer resolves (`resolveModel` throws), and
 * silently doing that fails the product principle (never a silent dangling
 * default) as hard as a crash. Precedent: `cli-handlers-provider.js ::
 * doRemove` re-points `config.default` when a provider goes away; here the
 * user is deleting one alias on purpose, so refusing and naming the fix is
 * the transparent choice instead. A CURATED default is unaffected -- it
 * keeps resolving from the shipped table after the unpin, same as any other
 * curated unpin. `config.default` may also be a bare model id rather than
 * an alias name (`start-helpers.js` resolves either); the guard compares
 * against the literal `name` argument, so a default that merely happens to
 * RESOLVE to the same id as this alias is not what it's checking.
 * @param {*} rawName whatever `args.unpin` parsed to
 * @returns {number} exit code
 */
function handleUnpin(rawName) {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name || name === 'null') {
    process.stderr.write('Error: --unpin requires an alias name\n');
    return 1;
  }
  const { removeAlias } = require('../utils/alias-store');
  const { isCurated } = require('../utils/alias-state');
  const config = require('../utils/config');
  const defaults = config.getDefaultAliases();
  const cfg = config.loadConfig();
  if (cfg && cfg.default === name && !isCurated(name, defaults)) {
    process.stderr.write(`Error: '${safeFragment(name)}' is your default model (config.default) — pick another default first (amicus setup)\n`);
    return 1;
  }
  let removed;
  try {
    removed = removeAlias(name);
  } catch (err) {
    process.stderr.write(`Error: ${collapseExcerpt(err.message)}\n`);
    return 1;
  }
  if (!removed) {
    process.stderr.write(`Error: '${safeFragment(name)}' is not pinned (see: amicus aliases)\n`);
    return 1;
  }
  process.stdout.write(isCurated(name, defaults)
    ? `✓ ${safeFragment(name)} now follows the shipped recommendation (${defaults[name]})\n`
    : `✓ ${safeFragment(name)} removed\n`);
  return 0;
}

module.exports = { handleUnpin };
