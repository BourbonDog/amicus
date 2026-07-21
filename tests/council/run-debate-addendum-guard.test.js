// tests/council/run-debate-addendum-guard.test.js
'use strict';

/**
 * Finding 1's defensive half in isolation: run.js normalizes an EMPTY
 * addendumOutcomes array to null before the chair-packet ternary, because `[]`
 * is truthy in JS and buildDebateAddendum({outcomes: []}) renders a bare
 * "--- Debate round outcomes ---" heading with nothing under it (spec-adjacent
 * to ee447b6's report-renderer fix for the same defect class).
 *
 * The real run-debate.js fix (seeding defenseByRaiser.claude) means this case
 * is no longer reachable through the normal --debate + --claude-review path —
 * debateFindings can no longer come back empty when there was something to
 * debate. This test mocks run-debate.js's runDebate directly so the run.js
 * guard is exercised (and regression-guarded) on its own, independent of
 * whether any current caller can still trigger it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/council/run-debate', () => ({
  nothingToDebate: () => false,
  runDebate: jest.fn(),
}));

const { runCouncil } = require('../../src/council/run');
const { runDebate } = require('../../src/council/run-debate');
const { happyScript, baseOptions, scriptedLaunchers } = require('./helpers/fake-launchers');

test('an empty addendumOutcomes array never renders the "Debate round outcomes" heading', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'debate-addendum-guard-'));
  runDebate.mockImplementation(async (ctx, { tallyInput }) => ({
    debatedInput: tallyInput,        // unchanged — still a valid tally input
    debateFindings: [],
    debateSummary: { enabled: true, outcome: 'ran', contested: 0, disputed: 0, defended: 0,
      amended: 0, withdrawn: 0, noResponse: 0, revoteJudges: 0, revoteApplied: 0, verdictChanges: 0 },
    addendumOutcomes: [],            // the empty-list case under test
    defenseLegs: [], revoteLegs: [], verdictChanges: 0,
    degraded: false, aborted: null,
  }));
  const { exitCode } = await runCouncil(
    baseOptions(tmp, { runDir: path.join(tmp, 'council-abc123'), debate: true }),
    { launchers: scriptedLaunchers(happyScript()), appendRunFn: () => {} });
  expect(exitCode).toBe(0);
  const packet = fs.readFileSync(path.join(tmp, 'council-abc123', 'chair-packet.md'), 'utf-8');
  expect(packet).not.toContain('--- Debate round outcomes ---');
});
