// tests/helpers/read-if-present.js
'use strict';

const fs = require('fs');

/**
 * readIfPresent(file) -> string | null
 *
 * Read a source file during a repo-tree scan, tolerating a file that vanishes
 * between the directory listing and the read. Returns null when it is gone.
 *
 * WHY THIS EXISTS. Three suites walk `src/` by listing a directory and then
 * reading every `.js` that listing named: no-phantom-dependencies.test.js,
 * cli-template-args.test.js and council/degrade-invariant.test.js. A fourth,
 * scripts/check-file-sizes.test.js, writes a REAL `src/__sizecheck_tmp__.js`
 * and unlinks it a few milliseconds later. That writer cannot move its fixture
 * to a tmpdir: checkAllTracked() filters its input through the anchored
 * 'src/**\/*.js' include glob and only then resolves it against process.cwd(),
 * so nothing outside a genuine repo-relative `src/` path ever reaches the size
 * check — it would silently assert on an empty violation list instead.
 *
 * Jest runs those suites in parallel workers. When the listing happens while
 * the temp file exists and the read happens after the unlink, readFileSync
 * throws ENOENT. In no-phantom-dependencies.test.js the walk runs in the
 * describe body, so the whole file dies with "Test suite failed to run" —
 * observed on roughly 1 full `npm test` run in 2.
 *
 * Skipping a file that is no longer on disk is sound for all three callers:
 * the only files that can vanish mid-walk are another worker's temp files,
 * which are by definition not the shipped source these guards assert about.
 *
 * Only ENOENT is absorbed. Any other read failure still throws, so a genuinely
 * unreadable source file stays loud rather than silently dropping out of a scan
 * that exists to be exhaustive.
 *
 * @param {string} file - Absolute or cwd-relative path to read.
 * @returns {string | null} UTF-8 contents, or null if the file no longer exists.
 */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') { return null; }
    throw err;
  }
}

module.exports = { readIfPresent };
