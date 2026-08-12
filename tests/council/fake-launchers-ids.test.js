// tests/council/fake-launchers-ids.test.js
'use strict';
// Fakes must never produce leg documents the real engine cannot: fanout
// ids are `${waveId}-${i+1}`, unique per run (v4.8 PR0).
const { mkLeg, okWave, review, scriptedLaunchers, launchersFromScript, happyScriptMap } = require('./helpers/fake-launchers');
const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

test('twin models in one wave get distinct taskIds', () => {
  const a = mkLeg('gemini', 'first');
  const b = mkLeg('gemini', 'second');
  expect(a.taskId).not.toBe(b.taskId);
  expect(a.taskId).toMatch(TASK_ID_PATTERN);
  expect(b.taskId).toMatch(TASK_ID_PATTERN);
});

test('scriptedLaunchers legs carry engine-shaped ids: `${waveId}-${i+1}`', async () => {
  const launchers = scriptedLaunchers({ 'r-s1': (opts) => okWave(opts.models.map((m) => mkLeg(m, review(m)))) });
  const { wave } = await launchers.launchWave({ waveId: 'r-s1', models: ['gemini', 'gemini'] });
  expect(wave.legs.map((l) => l.taskId)).toEqual(['r-s1-1', 'r-s1-2']);
});

test('launchersFromScript legs carry engine-shaped ids too', async () => {
  const launchers = launchersFromScript(happyScriptMap());
  const { wave } = await launchers.launchWave({ waveId: 'r-s1', models: ['gemini', 'gemini'] });
  expect(wave.legs.map((l) => l.taskId)).toEqual(['r-s1-1', 'r-s1-2']);
});

// v4.8 PR2a Task 1 Step 6: the shared helper's foot-gun. mkLeg's OWN taskId,
// when a waveId is passed directly, is `${waveId}-${++legSeq}` — legSeq is a
// MODULE-GLOBAL counter shared by every mkLeg call in this file, not this
// wave's roster position. It only becomes roster-correct (`${waveId}-${i+1}`)
// once a leg passes through one of the two dispatchers above — scriptedLaunchers's
// launchWave (fake-launchers.js:35-37) or launchersFromScript's dispatch
// (fake-launchers.js:103-105) — which overwrite taskId post hoc. A leg built
// by calling mkLeg directly, skipping a dispatcher, silently keeps whatever
// the counter was at. Asserted with a regex, never a literal number: the
// tests above already advanced legSeq before this one runs.
test('a BARE mkLeg(waveId) is NOT roster-correct: taskId rides a module-global counter, not a slot', () => {
  const leg = mkLeg('gemini', 'bare call, no dispatcher', undefined, undefined, 'w-s1');
  expect(leg.taskId).toMatch(/^w-s1-\d+$/);
});
