// tests/ci-council-bench-config.test.js
'use strict';

/**
 * v4.9.7 BENCH lane — the CI council bench's OUTPUT RESERVATION, pinned on the
 * CONFIG rather than on the code that reads it.
 *
 * WHY THIS FILE EXISTS. `.github/amicus-ci-aliases.json` is copied verbatim to
 * `$AMICUS_CONFIG_DIR/config.json` by council-review.yml's provisioning step, and
 * `config.js :: getOutputBudget` reads `outputBudget` out of it. Every gate that
 * already reads that map iterates `map.aliases` ONLY —
 * tests/scripts/council-review-workflow.test.js ('every pin in the map is a
 * fully-qualified, non-floating model id' / 'the default bench and chair are all
 * covered by the map'), tests/alias-shadow.test.js and scripts/check-ci-alias-pins.js
 * — and the workflow's own `validate-map.js` heredoc does too. A sibling top-level
 * key is invisible to all four, so nothing today would notice if `outputBudget`
 * were deleted, stringified, zeroed or raised past the engine's ceiling.
 *
 * WHAT THE NUMBER IS. Without the key the engine's own 32000 default governs every
 * leg of a run (one shared engine serves Stage 1, its retry, Stage 2 and the chair
 * alike), and 4 of the 6 seats lost across the FIVE paid v4.9.6 council runs died
 * against it with `finish: 'length'` and 0–651 usable output tokens.
 *
 * ⚠️ THE BOUND IS NOT "THE CHAIR'S ROW". 65536 is the lowest COLD engine ceiling on
 * this bench, and cold it is shared by TWO rows: the chair
 * `google/gemini-3.1-pro-preview` AND `deepseek/deepseek-v4-flash-0731`. Measured
 * on the wire against opencode-ai 1.18.15 with the bare `{}` descriptors CI
 * registers (one probe case per process, so each read is served by a fresh
 * engine): the flag at 100000 arrives as `max_tokens 65536` on the chair (4 of 4
 * reads) and on deepseek on every COLD read (4 of 5 — the one warm read served the
 * live row, 943718, and passed 100000 through). Attributing the bound to the chair
 * alone invites "the chair moved, so the bound can move", and that reading would
 * silently clamp deepseek.
 *
 * A STATIC bound on purpose: a runner never writes `model-catalog.json`, so a test
 * that consulted a catalog would prove something CI never sees.
 */

const fs = require('fs');
const path = require('path');

const MAP_PATH = path.join(__dirname, '..', '.github', 'amicus-ci-aliases.json');
const WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'council-review.yml');

/**
 * The lowest COLD engine ceiling on the CI bench, shared by two rows (see the
 * file docblock). Written here as a literal rather than derived, because the
 * thing being pinned is a MEASUREMENT, not a computation.
 */
const COLD_CEILING = 65536;

describe('CI council bench config (.github/amicus-ci-aliases.json)', () => {
  const map = () => JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'));

  test('declares an outputBudget as a SIBLING of aliases, where loadConfig can see it', () => {
    const m = map();
    // MUTANT "BUDGETMISSING": delete the key. Every existing map gate still
    // passes (all four read `map.aliases`), getOutputBudget() returns null, no
    // engine flag is set, and the bench silently returns to the 32000 default
    // that killed 4 of the 6 lost seats.
    expect(Object.prototype.hasOwnProperty.call(m, 'outputBudget')).toBe(true);
    // MUTANT "BUDGETNESTED": move the key inside `aliases`. loadConfig() would
    // still parse the file, getOutputBudget() would still read `undefined`, and
    // the misplacement would be invisible — while config.js :: saveConfig's alias
    // validation treats every `aliases` member as a model id.
    expect(Object.keys(m).sort()).toEqual(['$comment', 'aliases', 'outputBudget']);
    expect(m.aliases).not.toHaveProperty('outputBudget');
  });

  test('the declared budget survives amicus\'s own acceptance rule unchanged', () => {
    const { normalizeOutputBudget } = require('../src/utils/model-output-limit');
    const declared = map().outputBudget;
    // MUTANT "BUDGETSTRING": write "64000" (a numeric STRING), or 64000.7, or
    // true. normalizeOutputBudget rejects the first and third outright and FLOORS
    // the second, so the value amicus honours stops being the value the file
    // declares. Delegated to the shipped primitive rather than re-implemented, so
    // the pin cannot drift from the code that enforces it.
    expect(normalizeOutputBudget(declared)).toBe(declared);
    expect(typeof declared).toBe('number');
    expect(Number.isInteger(declared)).toBe(true);
  });

  test('the budget is at or under the lowest COLD engine ceiling on the bench', () => {
    // MUTANT "CHAIRCLAMP" / "DEEPSEEKCLAMP": raise the map to 100000. glm, qwen and
    // gpt reserve 100000 while the chair AND deepseek are silently clamped to
    // 65536 — measured on the wire, both rows — and a run stops reserving one
    // number. The reason is "the lowest COLD engine ceiling on the bench, shared
    // by two rows", NOT "the chair's row".
    expect(map().outputBudget).toBeLessThanOrEqual(COLD_CEILING);
  });

  test('the budget is above the engine default, so the key is not a decorative no-op', () => {
    const { ENGINE_DEFAULT_OUTPUT_TOKENS } = require('../src/utils/engine-output-flag');
    // MUTANT "BUDGETNOOP": set the map to 32000 (or lower) after a cost scare. The
    // file then LOOKS configured, the pre-flight prints a budget, and the bench
    // reserves exactly what it reserves today — or less. A budget that cannot
    // change the wire is worse than an absent one, because it reads as a fix.
    expect(map().outputBudget).toBeGreaterThan(ENGINE_DEFAULT_OUTPUT_TOKENS);
  });

  test('council-review.yml still pre-flights the budget, on the same ceiling', () => {
    const y = fs.readFileSync(WF_PATH, 'utf-8');
    // MUTANT "GUARDDROPPED": delete the budget branch from the `preflight.js`
    // heredoc. A malformed or over-ceiling budget then degrades in complete
    // silence again — the exact class the alias-shape validation was added to
    // remove, one key over.
    expect(y).toContain('cfg.getOutputBudget()');
    expect(y).toContain('::error::outputBudget ');
    // MUTANT "CEILINGDRIFT": raise the guard's own constant without re-measuring.
    // Two hand-maintained surfaces carry this number (the guard that stops a run
    // and the pin that fails a test); asserting they agree is a drift check, not
    // a read-back — neither writes the other.
    const m = /^\s*const COLD_CEILING = (\d+);\s*$/m.exec(y);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(COLD_CEILING);
  });
});
