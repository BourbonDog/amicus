// tests/sidecar/budget.test.js
'use strict';
const { checkBudget, formatBudgetError, DEFAULT_MAX_COST_PER_MTOK } = require('../../src/sidecar/budget');

const leg = (modelInput, perTok) => ({ modelInput, model: `openrouter/${modelInput}`, pricing: perTok === null ? null : { prompt: perTok, completion: perTok } });

describe('checkBudget — per-$/Mtok threshold (hard, default on)', () => {
  it('refuses a leg far over the default cap', () => {
    const r = checkBudget([leg('o3pro', 0.0002)], {}); // 0.0002/tok = 200 $/Mtok
    expect(r.ok).toBe(false);
    expect(r.offending).toHaveLength(1);
    expect(r.offending[0].modelInput).toBe('o3pro');
  });
  it('allows a leg far under the default cap', () => {
    const r = checkBudget([leg('gemini', 0.0000003)], {}); // 0.3 $/Mtok
    expect(r.ok).toBe(true);
    expect(r.offending).toHaveLength(0);
  });
  it('honors an explicit lower maxCostPerMtok override', () => {
    const r = checkBudget([leg('mid', 0.00001)], { maxCostPerMtok: 5 }); // 10 $/Mtok > 5
    expect(r.ok).toBe(false);
  });
  it('honors a config-style maxCostPerMtok override (as passed from loadConfig)', () => {
    // 10 $/Mtok (0.00001/tok) > threshold of 5 → blocked
    const r = checkBudget([leg('mid', 0.00001)], { maxCostPerMtok: 5 });
    expect(r.ok).toBe(false);
    // 10 $/Mtok < threshold of 15 → allowed
    const r2 = checkBudget([leg('mid', 0.00001)], { maxCostPerMtok: 15 });
    expect(r2.ok).toBe(true);
  });
});

describe('checkBudget — unpriced legs', () => {
  it('surfaces unpriced legs and never counts them as $0 in the estimate', () => {
    const r = checkBudget([leg('directmodel', null)], { maxCost: 0.01, promptChars: 4000 });
    expect(r.breakdown.unpricedCount).toBe(1);
    expect(r.breakdown.totalEstCost).toBe(0); // no priced legs contributed
    expect(r.ok).toBe(true); // unpriced cannot trip the ceiling
  });
});

describe('checkBudget — soft total ceiling (opt-in)', () => {
  it('refuses when the summed estimate exceeds maxCost', () => {
    // 2 legs @ 0.00001/tok, ~1000 input tok + assumed output → > $0.001 ceiling
    const r = checkBudget([leg('a', 0.00001), leg('b', 0.00001)], { maxCost: 0.001, promptChars: 4000 });
    expect(r.overCeiling).toBe(true);
    expect(r.ok).toBe(false);
  });
  it('no ceiling set → never trips on cost total', () => {
    const r = checkBudget([leg('a', 0.0000003)], { promptChars: 4000 });
    expect(r.overCeiling).toBe(false);
  });
});

describe('threshold default', () => {
  it('is a positive number', () => { expect(DEFAULT_MAX_COST_PER_MTOK).toBeGreaterThan(0); });
});

describe('formatBudgetError surfaces (v4.7 PR6)', () => {
  const offendingOnly = { ok: false, offending: [{ modelInput: 'o3', model: 'o3', reason: '$80.00/Mtok exceeds the $10.00/Mtok cap' }], overCeiling: false, breakdown: { totalEstCost: 1, unpricedCount: 0, maxCost: null } };
  const ceilingOnly = { ok: false, offending: [], overCeiling: true, breakdown: { totalEstCost: 12.5, unpricedCount: 0, maxCost: 10 } };

  it('defaults to the CLI surface when no surface is passed (byte-compatible)', () => {
    expect(formatBudgetError(ceilingOnly)).toContain('--max-cost');
    expect(formatBudgetError(ceilingOnly)).toBe(formatBudgetError(ceilingOnly, { kind: 'cli' }));
  });

  it('does NOT tell a CLI user to raise --max-cost when the refusal is threshold-only', () => {
    // budget.js:62 — ok requires offending.length === 0, so raising the ceiling
    // can never clear this branch. The old trailer said it could.
    const text = formatBudgetError(offendingOnly);
    expect(text).not.toMatch(/--max-cost <\$> to raise/);
    expect(text).toContain('--no-cost-gate');
  });

  it('names no CLI flags on the MCP surface', () => {
    const text = formatBudgetError(ceilingOnly, { kind: 'mcp' });
    expect(text).not.toMatch(/--max-cost|--no-cost-gate/);
  });

  it('does not offer dropping the pack as an MCP escape (the gate now always runs)', () => {
    expect(formatBudgetError(ceilingOnly, { kind: 'mcp' })).not.toMatch(/without the .?pack/i);
  });
});

describe('threshold calibration (observed pricing 2026-06-23)', () => {
  // Helper: a single-leg fixture at the given output $/Mtok (input set to 0
  // to test purely against the completion rate, matching the catalog observation).
  const at = (perMtokOut) => ({ modelInput: 'm', model: 'openrouter/m', pricing: { prompt: 0, completion: perMtokOut / 1e6 } });

  it('allows opus-class (25 $/Mtok out) and blocks o3-pro-class (80 $/Mtok out) at the default', () => {
    // opus (claude-opus-4.8): ~$25/Mtok out — should be allowed
    expect(checkBudget([at(25)], {}).ok).toBe(true);
    // o3-pro: ~$80/Mtok out — should be blocked
    expect(checkBudget([at(80)], {}).ok).toBe(false);
  });

  it('o3 regular (8 $/Mtok out) is allowed', () => {
    expect(checkBudget([at(8)], {}).ok).toBe(true);
  });

  it('gemini-pro (12 $/Mtok out) is allowed', () => {
    expect(checkBudget([at(12)], {}).ok).toBe(true);
  });

  it('deepseek-v4-pro (0.87 $/Mtok out) is allowed', () => {
    expect(checkBudget([at(0.87)], {}).ok).toBe(true);
  });
});
