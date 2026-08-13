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
// one of the two dispatchers above — scriptedLaunchers's launchWave
// (fake-launchers.js:36) or launchersFromScript's dispatch
// (fake-launchers.js:102) — which stamp `${opts.waveId}-${i+1}`, where `i` is
// the leg's index in the RETURNED legs array (`r.wave.legs`), never its slot
// in the requested roster (`opts.models`). A leg built by calling mkLeg
// directly, skipping a dispatcher, silently keeps whatever the counter was
// at. Asserted with a regex, never a literal number: the tests above already
// advanced legSeq before this one runs.
//
// Fix-wave (item 3, whole-branch review): "roster-correct" is only true for a
// FULL, in-order return — one leg per model, in `opts.models` order, so the
// returned-array index happens to equal the roster slot. For a PARTIAL
// return (fewer legs than models, e.g. a retry script standing in for just
// one lost seat) the two diverge: the returned index restarts at 0
// regardless of which roster slot the leg is standing in for. A PR2b
// fixture author who reads the dispatchers as roster-correct and routes a
// partial-return script through scriptedLaunchers/launchersFromScript gets a
// leg silently stamped with the WRONG slot and bound to the wrong seat — see
// the pin below.
test('a BARE mkLeg(waveId) is NOT roster-correct: taskId rides a module-global counter, not a slot', () => {
  const leg = mkLeg('gemini', 'bare call, no dispatcher', undefined, undefined, 'w-s1');
  expect(leg.taskId).toMatch(/^w-s1-\d+$/);
});

test('PARTIAL return: the dispatcher stamps returned-ARRAY index, not roster slot (the hazard, pinned)', async () => {
  // opts.models names a 2-seat roster ['gemini', 'gpt'], standing in for a
  // retry wave where only gpt (roster slot 2) lost its seat and comes back.
  // The dispatcher never looks at opts.models when it stamps — it only sees
  // the RETURNED array — so this leg (index 0 of the one-element returned
  // array) is stamped `-1`, not `-2`. Trusting the taskId to name gpt's real
  // roster slot here would silently bind it to whatever seat is slot 1.
  const launchers = scriptedLaunchers({ 'r-s1': () => okWave([mkLeg('gpt', review('gpt'))]) });
  const { wave } = await launchers.launchWave({ waveId: 'r-s1', models: ['gemini', 'gpt'] });
  expect(wave.legs[0].taskId).toBe('r-s1-1'); // NOT 'r-s1-2' — returned index, not roster slot
});
