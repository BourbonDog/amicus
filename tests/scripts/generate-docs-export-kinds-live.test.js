/**
 * The module table's Key Exports column, checked against the REAL tree.
 *
 * The generator proves values from source text and never runs a module, so
 * its own tests can only use fixtures. Council finding C5 on PR 291 asked
 * what pins the output for the live tree. This file does it two ways:
 * - Soundness: every export the table shows without () is loaded and must
 *   not be a function. It runs in a child process, so the modules' load-time
 *   side effects stay out of jest.
 * - Pins: the rows that motivated the change keep their values bare.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildModuleIndex } = require('../../scripts/generate-docs');

const ROOT = path.resolve(__dirname, '../..');

// Loads each [module under src/, export] pair and reports the functions.
// Modules may print while loading, so the result follows a marker.
const PROBE = `
const path = require('node:path');
const pairs = JSON.parse(process.argv[1]);
const functions = [];
const failed = [];
for (const [rel, name] of pairs) {
  let mod;
  try { mod = require(path.resolve('src', rel)); } catch (e) { failed.push(rel); continue; }
  if (typeof mod[name] === 'function') { functions.push(rel + ' ' + name); }
}
process.stdout.write('\\n@@RESULT@@' + JSON.stringify({ functions, failed }));
process.exit(0);
`;

let table;

beforeAll(() => {
  table = buildModuleIndex(ROOT);
});

/** The Key Exports cell of the row for src/<rel>. */
function cellOf(rel) {
  const row = table.split('\n').find((l) => l.startsWith(`| \`${rel}\` |`));
  expect(row).toBeDefined();
  const cells = row.split('|');
  return cells[cells.length - 2];
}

/** [module under src/, export] for every export the table shows without (). */
function bareExports() {
  const pairs = [];
  for (const row of table.split('\n').slice(2)) {
    const cells = row.split('|');
    const rel = cells[1].trim().replace(/`/g, '');
    for (const m of cells[cells.length - 2].matchAll(/`([A-Za-z_$][\w$]*)(\(\))?`/g)) {
      if (!m[2]) { pairs.push([rel, m[1]]); }
    }
  }
  return pairs;
}

it('no export shown without () is a function when its module loads', () => {
  const pairs = bareExports();
  // More than a handful, so an empty table cannot pass this vacuously.
  expect(pairs.length).toBeGreaterThan(100);
  const out = execFileSync(process.execPath, ['-e', PROBE, JSON.stringify(pairs)], {
    cwd: ROOT, encoding: 'utf-8', timeout: 60000,
  });
  const { functions, failed } = JSON.parse(out.slice(out.lastIndexOf('@@RESULT@@') + '@@RESULT@@'.length));
  expect(failed).toEqual([]);
  expect(functions).toEqual([]);
});

describe('the rows that motivated the change', () => {
  it.each([
    // A string constant re-exported through a destructured require, beside an alias of a function.
    ['utils/api-key-validation.js', ['OPENROUTER_NO_CREDIT_WARNING'], ['validateApiKey', 'validateOpenRouterKey']],
    ['utils/openrouter-credit.js', ['OPENROUTER_NO_CREDIT_WARNING', 'OPENROUTER_FREE_TIER_WARNING'], ['checkOpenRouterCredit']],
    // An array literal and an Object.fromEntries over it.
    ['utils/provider-registry.js', ['PROVIDERS', 'PROVIDER_ENV_MAP'], ['getProvider']],
    // Prompt text joined from an array literal, and from other joined constants.
    ['council/briefings.js', ['FINDINGS_TWO_PART_FRAMING', 'FINDINGS_CONTRACT'], ['buildSeatBriefing']],
    // Re-exports through a namespace require (`NAME: chair.NAME`).
    ['council/briefings-stage2.js', ['CHAIR_VERDICT_VALUES', 'VERDICT_SCALE_ADDENDUM'], []],
  ])('%s', (rel, values, functions) => {
    const cell = cellOf(rel);
    for (const v of values) { expect(cell).toContain(`\`${v}\``); }
    for (const f of functions) { expect(cell).toContain(`\`${f}()\``); }
  });
});
