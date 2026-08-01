// tests/council/run-debate-stage.test.js
const { runDebateStage } = require('../../src/council/run-debate-stage');

test('debate disabled → returns the provisional input untouched, no debate run', async () => {
  const ctx = { o: { debate: false, runDir: '/tmp/x', runId: 'r1' } };
  const res = await runDebateStage(ctx, {
    provisional: { findings: [] },
    provisionalInput: { marker: 'provisional' },
    overBudget: () => false,
    degraded: { value: false },
  });
  expect(res.debatedInput).toEqual({ marker: 'provisional' });
  expect(res.debatedRecord).toEqual({ findings: [] });   // falls through as `provisional`
  expect(res.debateOutcomes).toBeNull();
  expect(res.debateFindings).toBeNull();
  expect(res.debateSummary).toBeNull();
});

test('all five bindings are present on the returned object', async () => {
  // Guards the defect this task exists to avoid: returning a subset compiles fine
  // and breaks the chair packet at run.js:257 at runtime.
  const res = await runDebateStage(
    { o: { debate: false, runDir: '/tmp/x', runId: 'r1' } },
    { provisional: { findings: [] }, provisionalInput: {}, overBudget: () => false,
      degraded: { value: false } },
  );
  expect(Object.keys(res).sort()).toEqual(
    ['debateFindings', 'debateOutcomes', 'debateSummary', 'debatedInput', 'debatedRecord'].sort(),
  );
});
