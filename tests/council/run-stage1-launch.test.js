// tests/council/run-stage1-launch.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launchStage1 } = require('../../src/council/run-stage1-launch');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-stage1-launch-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('launchStage1 seat roster passthrough (v4.8 R5 T4.1)', () => {
  // v4.8 R5 T4.1: `seats` must reach every Stage-1 launch object, index-parallel
  // with `models`, so T4.2 (fanout-wave-io.js's stampLegAttribution) can stamp a
  // seat id onto each leg. PROBE (task-1-report.md) measured — by executing the
  // unmodified launchStage1 — that seated[i].models and seated[i].roster stay
  // index-parallel across the lens, seat-wave and critic-solo shapes, including
  // a non-adjacent repeated alias and a critic that is also a bench alias.
  test('launchStage1 forwards a seats[] index-parallel with models on every launch', async () => {
    const calls = [];
    const launchers = {
      launchWave: async (o) => { calls.push(o); return { wave: { legs: [] }, exitCode: 0 }; },
      launchSolo: async (o) => { calls.push(o); return { wave: { legs: [] }, exitCode: 0, leg: null }; },
    };
    const o = { runId: 'r1', runDir: dir, models: ['a', 'b', 'a'], critic: null, briefing: 'b', date: 'd' };
    await launchStage1({ o, launchers, addWave() {} });
    const seatWave = calls.find((c) => c.waveId === 'r1-s1');
    expect(seatWave.seats).toHaveLength(seatWave.models.length);
    expect(seatWave.seats.map((s) => s.alias)).toEqual(seatWave.models);
    // The point of the whole plan: a repeated alias yields DISTINCT seat ids.
    expect(new Set(seatWave.seats.map((s) => s.id)).size).toBe(3);
  });
});
