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
// wave's roster position. It only gets OVERWRITTEN once a leg passes through
// one of the two dispatchers above — scriptedLaunchers's launchWave or
// launchersFromScript's dispatch — which now look the leg up in
// `opts.models` (by `modelInput || model`) and stamp `${opts.waveId}-${slot}`,
// where `slot` is the leg's 1-based position in the REQUESTED roster,
// consumed WITHOUT replacement so a twin roster still gets distinct slots. A
// leg built by calling mkLeg directly, skipping a dispatcher, silently keeps
// whatever the counter was at. Asserted with a regex, never a literal
// number: the tests above already advanced legSeq before this one runs.
//
// v4.8 PR2b (fix-wave item 3, whole-branch review): the dispatchers used to
// stamp the RETURNED-array index instead of the roster slot — correct only
// for a FULL, in-order return (one leg per model, in `opts.models` order, so
// the returned-array index happened to equal the roster slot). For a
// PARTIAL return (fewer legs than models, e.g. a retry script standing in
// for just one lost seat) the two diverge: the returned index restarts at 0
// regardless of which roster slot the leg is standing in for. That hazard is
// now fixed in fake-launchers.js (both dispatchers look the leg up in
// `opts.models` instead), and the pin below records the fix rather than the
// hazard it used to document.
test('a BARE mkLeg(waveId) is NOT roster-correct: taskId rides a module-global counter, not a slot', () => {
  const leg = mkLeg('gemini', 'bare call, no dispatcher', undefined, undefined, 'w-s1');
  expect(leg.taskId).toMatch(/^w-s1-\d+$/);
});

test('PARTIAL return: the dispatcher stamps the ROSTER slot, not the returned-array index', async () => {
  // opts.models names a 2-seat roster ['gemini', 'gpt'], standing in for a retry
  // wave where only gpt (roster slot 2) lost its seat and comes back. v4.8 PR2b:
  // the dispatcher now looks the leg up in opts.models, so the taskId names gpt's
  // real roster slot and bindSeats resolves it to the right seat.
  const launchers = scriptedLaunchers({ 'r-s1': () => okWave([mkLeg('gpt', review('gpt'))]) });
  const { wave } = await launchers.launchWave({ waveId: 'r-s1', models: ['gemini', 'gpt'] });
  expect(wave.legs[0].taskId).toBe('r-s1-2'); // roster slot, NOT the returned index
});
