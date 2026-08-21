'use strict';

/**
 * v4.4 §8 — the workspace must render "cost unknown" differently from "cost $0".
 *
 * Diagnosis §8: every cost string funnels through pricing.formatCost, whose `?`
 * (unknown) / `—` (no data) / `~$0.0000` (a genuinely free priced tier) vocabulary
 * is already the right primitive. What was missing was everything ABOVE it:
 *   - run-detail.js:78 dropped `sumWaveUsage`'s `unpricedLegs` from the total,
 *     so `$1.05` was printed for a run whose real bill was higher;
 *   - the --max-cost gauge (workspace-app.js) read `costAmount` alone, so it
 *     drew "50% of budget" for a run with an unpriced seat — affirmatively
 *     misleading, and the single most dangerous surface in the diagnosis;
 *   - live-normalize.js :: seatOf had the same gap on the live path.
 *
 * `usageError` (from the earlier C3 pass) is a DIFFERENT statement — "pricing
 * resolution threw for this leg" — and is left exactly as it was; the unknown
 * modelled here is the ordinary "provider reported no usage" case, which never
 * throws (diagnosis §1, final paragraph).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getRunDetail } = require('../../src/workspace/run-detail');
const { normalizeLive } = require('../../src/workspace/live-normalize');

function mkRun(tmp, runJson, tallyJson) {
  const runDir = path.join(tmp, 'runs', 'council-r1');
  fs.mkdirSync(path.join(tmp, '.claude', 'amicus_sessions'), { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude', 'amicus_sessions', 'council-r1.json'),
    JSON.stringify({ runId: 'r1', runDir }));
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(runJson));
  if (tallyJson) { fs.writeFileSync(path.join(runDir, 'tally.json'), JSON.stringify(tallyJson)); }
  return runDir;
}

const baseRun = (usage, maxCost) => ({
  schemaVersion: 2, type: 'council-run', runId: 'r1', status: 'complete', exitCode: 0,
  stages: [], bench: ['glm', 'qwen'], chair: 'kimi', labelMap: {},
  options: { maxCost, gateway: 'auto', outDir: 'x' }, usage,
});

let tmp;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cost-unknown-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('run-detail costPanel surfaces unknown legs alongside the known total', () => {
  test('the total names the unpriced legs instead of reading as the whole bill', () => {
    // council-wsgate02 after the B2 fix: $0.3720 known, 3 legs unknown, $0.75 ceiling.
    mkRun(tmp, baseRun({
      cost: { amount: 0.37202345, currency: 'USD', source: 'mixed', reportedLegs: 8, estimatedLegs: 0, unpricedLegs: 3 },
      unknownLegs: 3, costExact: false,
    }, 0.75));
    const d = getRunDetail(tmp, 'r1');
    expect(d.derived.cost.totalDisplay).toMatch(/0\.3720/);
    expect(d.derived.cost.totalDisplay).toMatch(/3 unknown/);
    expect(d.derived.cost.unknownLegs).toBe(3);
    expect(d.derived.cost.costExact).toBe(false);
    expect(d.derived.cost.maxCost).toBe(0.75);
  });

  test('a fully priced run reports costExact true and an untouched total', () => {
    mkRun(tmp, baseRun({
      cost: { amount: 0.1819, currency: 'USD', source: 'reported', reportedLegs: 6, estimatedLegs: 0, unpricedLegs: 0 },
      unknownLegs: 0, costExact: true,
    }, 1));
    const d = getRunDetail(tmp, 'r1');
    expect(d.derived.cost.totalDisplay).toBe('$0.1819');
    expect(d.derived.cost.unknownLegs).toBe(0);
    expect(d.derived.cost.costExact).toBe(true);
  });

  test('a pre-v4.4 run.json (no unknownLegs key) falls back to cost.unpricedLegs', () => {
    mkRun(tmp, baseRun({
      cost: { amount: 1.0517, currency: 'USD', source: 'mixed', reportedLegs: 8, estimatedLegs: 0, unpricedLegs: 3 },
    }, 6));
    const d = getRunDetail(tmp, 'r1');
    expect(d.derived.cost.unknownLegs).toBe(3);
    expect(d.derived.cost.costExact).toBe(false);
    expect(d.derived.cost.totalDisplay).toMatch(/3 unknown/);
  });

  test('a run with no usage block at all still says nothing rather than $0', () => {
    mkRun(tmp, baseRun(null, null));
    const d = getRunDetail(tmp, 'r1');
    expect(d.derived.cost.totalDisplay).toBe('—');
    expect(d.derived.cost.costExact).toBe(true); // nothing unknown because nothing ran
    expect(d.derived.cost.unknownLegs).toBe(0);
  });

  test("a per-seat row whose cost is unknown renders '?', not $0.00", () => {
    mkRun(tmp, baseRun({ cost: { amount: 0.02, source: 'mixed', unpricedLegs: 1 }, unknownLegs: 1, costExact: false }, null), {
      schemaVersion: 1, type: 'council-tally', runStats: [
        { model: 'glm', role: 'seat', status: 'complete', durationMs: 10,
          usage: { cost: { amount: null, currency: 'USD', source: 'unknown' } } },
        { model: 'ollama/llama3.3', role: 'seat', status: 'complete', durationMs: 10,
          usage: { cost: { amount: 0, currency: 'USD', source: 'estimated' } } },
      ],
    });
    const d = getRunDetail(tmp, 'r1');
    const [unknownRow, freeLocalRow] = d.derived.cost.rows;
    expect(unknownRow.costDisplay).toBe('?');
    // The v4.2 free-local promise: a genuinely $0 seat stays visibly $0.
    expect(freeLocalRow.costDisplay).toBe('~$0.0000');
  });
});

describe('live-normalize passes the unknown count through the A1 seam', () => {
  const liveDoc = (usage) => ({
    taskId: 'r1', type: 'council-run', runId: 'r1', status: 'running', view: 'live',
    stages: [{ name: 'stage1', status: 'running', waveId: 'r1-s1' }], legs: [], usage,
  });

  test('costUnknownLegs + costExact ride along with the stage rollup', () => {
    const m = normalizeLive(liveDoc({
      cost: { amount: 0.02, currency: 'USD', source: 'mixed', reportedLegs: 1, estimatedLegs: 0, unpricedLegs: 2 },
    }));
    expect(m.costUnknownLegs).toBe(2);
    expect(m.costExact).toBe(false);
    expect(m.costDisplay).toMatch(/2 unknown/);
  });

  test('a fully priced stage keeps its plain display', () => {
    const m = normalizeLive(liveDoc({
      cost: { amount: 0.02, currency: 'USD', source: 'reported', reportedLegs: 2, estimatedLegs: 0, unpricedLegs: 0 },
    }));
    expect(m.costUnknownLegs).toBe(0);
    expect(m.costExact).toBe(true);
    expect(m.costDisplay).toBe('$0.0200');
  });

  test('no usage on the live doc → nulls, never a fabricated zero', () => {
    const m = normalizeLive(liveDoc(undefined));
    expect(m.costDisplay).toBeNull();
    expect(m.costAmount).toBeNull();
    expect(m.costUnknownLegs).toBe(0);
    expect(m.costExact).toBe(true);
  });

  test('a seat whose cost is unknown carries the ? display, distinct from a free local seat', () => {
    const doc = liveDoc(undefined);
    doc.legs = [
      { taskId: 'l1', model: 'openrouter/z-ai/glm-5.2', status: 'complete',
        usage: { tokens: { input: 0, output: 0 }, cost: { amount: null, currency: 'USD', source: 'unknown' } } },
      { taskId: 'l2', model: 'lmstudio/qwen3', status: 'complete',
        usage: { tokens: { input: 1200, output: 340 }, cost: { amount: 0, currency: 'USD', source: 'estimated' } } },
    ];
    const m = normalizeLive(doc);
    expect(m.seats[0].costDisplay).toBe('?');
    expect(m.seats[1].costDisplay).toBe('~$0.0000');
    expect(m.seats[1].tokensIn).toBe(1200);
  });
});

describe('the --max-cost gauge must not claim a percentage it cannot know', () => {
  const { makeFakeDom } = require('./helpers/fake-workspace-page');

  afterEach(() => { delete global.window; delete global.document; delete global.NodeFilter; jest.resetModules(); });

  function gaugeOf(costAmount, maxCost, totalDisplay, costExact) {
    jest.resetModules();
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.NodeFilter = fake.NodeFilter;
    require('../../electron/workspace-ui/workspace-render'); // eslint-disable-line global-require
    const R = global.window.AmicusRender;
    const fill = fake.document.getElementById('cost-gauge-fill');
    const text = fake.document.getElementById('cost-gauge-text');
    if (costExact === undefined) { R.renderGauge(fill, text, costAmount, maxCost, totalDisplay); }
    else { R.renderGauge(fill, text, costAmount, maxCost, totalDisplay, costExact); }
    return { fill, text, gauge: fill.parentElement };
  }

  test('an unpriced seat marks the gauge indeterminate and prefixes ≥', () => {
    const g = gaugeOf(0.372, 0.75, '~$0.3720 + 3 unknown', false);
    expect(g.gauge.className).toMatch(/unknown/);
    expect(g.text.textContent).toMatch(/≥/);
    expect(g.text.textContent).toMatch(/0\.75/);
  });

  test('a fully priced run keeps the plain gauge (regression guard)', () => {
    const g = gaugeOf(0.372, 0.75, '$0.3720', true);
    expect(g.gauge.className).not.toMatch(/unknown/);
    expect(g.text.textContent).toBe('$0.3720 / $0.75');
  });

  test('costExact omitted defaults to exact — existing 5-arg callers unchanged', () => {
    const g = gaugeOf(0.372, 0.75, '$0.3720');
    expect(g.gauge.className).not.toMatch(/unknown/);
    expect(g.text.textContent).toBe('$0.3720 / $0.75');
  });

  test('an over-budget run with an unknown leg is BOTH over and indeterminate', () => {
    const g = gaugeOf(0.99, 0.75, '~$0.9900 + 1 unknown', false);
    expect(g.gauge.className).toMatch(/over/);
    expect(g.gauge.className).toMatch(/unknown/);
  });
});
