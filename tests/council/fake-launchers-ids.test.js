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
