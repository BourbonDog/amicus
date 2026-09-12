// tests/council-agents-engine.integration.test.js
'use strict';

/**
 * Spec 2026-09-11 §4 — the ENGINE side of the council agents. Everything in
 * council/seat-tools.js is pure; nothing automated would otherwise prove the
 * pinned engine (opencode-ai 1.18.15) still (1) lists its tool ids on
 * /experimental/tool/ids, (2) accepts an agent config whose `tools` map uses the
 * '*' wildcard, (3) renders that map and the permission block as the rule list
 * amicus relies on, (4) tolerates an UNKNOWN tool id at start (so amicus,
 * not the engine, has to refuse it), and (5) places the seat's nested `read`
 * rules AFTER its tools-map `read=allow`, so the engine's `findLast` evaluation
 * denies `.env` reads instead of allowing them (ruling P2-R9). One engine start,
 * no prompt, zero spend.
 * Measured 2026-09-12 as the values pinned below. Runtime shape: `permission`
 * is a rule list [{permission, pattern, action}] — the SDK d.ts still declares
 * an object; assert on the runtime.
 *
 * P2-R21: the measurement itself runs in scripts/probe-council-agents.js, a
 * plain node child process — it does not run inline here. `@opencode-ai/sdk`
 * is ESM-only, and dynamically importing it from inside Jest's vm-sandboxed
 * test process throws "A dynamic import callback was invoked without
 * --experimental-vm-modules"; no such flag is wired into this repo's jest
 * invocations, and P2-R21 rules against adding one just for this. The
 * established precedent is tests/probe-flag-canary.integration.test.js,
 * which spawns scripts/probe-max-tokens.js the same way. This file only
 * spawns the probe and asserts on the one `PROBE_JSON` line it prints; the
 * assertions below are otherwise unchanged from the original design — they
 * take the same `{ mode, permission }` shape per agent that the probe prints
 * (mirroring what `client.app.agents()` returns), so `starRule`/`lastRule`
 * need no adaptation.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const PROBE = path.join(__dirname, '..', 'scripts', 'probe-council-agents.js');

const starRule = (agent, permission) => (Array.isArray(agent.permission) ? agent.permission : [])
  .filter((r) => r.permission === permission && r.pattern === '*').map((r) => r.action);
const last = (arr) => arr[arr.length - 1];
// The LAST rule for (permission, pattern) and WHERE it sits — the engine's
// evaluate() is findLast, so order is the fact under test, not only the action.
const lastRule = (agent, permission, pattern) => {
  const rules = Array.isArray(agent.permission) ? agent.permission : [];
  let index = -1;
  rules.forEach((r, i) => { if (r.permission === permission && r.pattern === pattern) { index = i; } });
  return { index, action: index >= 0 ? rules[index].action : undefined };
};

test('the pinned engine registers council-seat/council-support as amicus expects, and tolerates an unknown id', () => {
  const r = spawnSync(process.execPath, [PROBE], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 120000, env: process.env,
  });
  const out = `${r.stdout || ''}`;
  const line = out.split(/\r?\n/).find((l) => l.startsWith('PROBE_JSON '));
  if (!line) {
    throw new Error(`probe-council-agents.js printed no PROBE_JSON line.\nstatus: ${r.status}\nstderr:\n${r.stderr || '(empty)'}\nstdout:\n${out}`);
  }
  const parsed = JSON.parse(line.slice('PROBE_JSON '.length));
  const byName = parsed.agents;

  expect(Object.keys(byName)).toEqual(expect.arrayContaining(['council-seat', 'council-support', 'council-probe-unknown']));

  const support = byName['council-support'];
  expect(support.mode).toBe('primary');
  expect(last(starRule(support, '*'))).toBe('deny');
  for (const p of ['edit', 'bash', 'webfetch', 'external_directory']) { expect(last(starRule(support, p))).toBe('deny'); }

  const seat = byName['council-seat'];
  expect(last(starRule(seat, '*'))).toBe('deny');
  for (const t of ['grep', 'read', 'webfetch']) { expect(last(starRule(seat, t))).toBe('allow'); }
  expect(last(starRule(seat, 'edit'))).toBe('deny');
  expect(last(starRule(seat, 'bash'))).toBe('deny');
  expect(last(starRule(seat, 'external_directory'))).toBe('deny');

  // (5): the seat's nested read rules land AFTER its tools-map read=allow, so
  // the engine's findLast evaluation DENIES .env reads (ruling P2-R9). Both
  // the action and the ORDER are asserted — the order is what makes deny win.
  const readAllow = lastRule(seat, 'read', '*');
  const envDeny = lastRule(seat, 'read', '*.env');
  const envDotDeny = lastRule(seat, 'read', '*.env.*');
  expect(readAllow.action).toBe('allow');
  expect(envDeny.action).toBe('deny');
  expect(envDotDeny.action).toBe('deny');
  expect(envDeny.index).toBeGreaterThan(readAllow.index);
  expect(envDotDeny.index).toBeGreaterThan(readAllow.index);

  // (4): an unknown id is ACCEPTED by the engine — which is exactly why
  // runCouncil validates --tools against tool.ids() itself.
  expect(last(starRule(byName['council-probe-unknown'], 'bogus_tool'))).toBe('allow');

  expect(parsed.toolIds).toEqual(expect.arrayContaining(['read', 'glob', 'grep', 'bash', 'webfetch', 'websearch', 'task', 'skill', 'edit', 'write']));
  expect(r.status).toBe(0);
}, 180000);
