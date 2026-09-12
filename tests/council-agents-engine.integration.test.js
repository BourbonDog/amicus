// tests/council-agents-engine.integration.test.js
'use strict';

/**
 * Spec 2026-09-11 §4 — the ENGINE side of the council agents. Everything in
 * council/seat-tools.js is pure; nothing automated would otherwise prove the
 * pinned engine (opencode-ai 1.18.15) still (1) lists its tool ids on
 * /experimental/tool/ids, (2) accepts an agent config whose `tools` map uses the
 * '*' wildcard, (3) renders that map and the permission block as the rule list
 * amicus relies on — including the ORDER rules land in, not merely their
 * actions, since the engine evaluates permissions by findLast (a seat's own
 * `grep`/`webfetch` allows must land after the blanket wildcard deny, and its
 * `.env` denies after its own `read` allow) — (4) tolerates an UNKNOWN tool id
 * at start (so amicus, not the engine, has to refuse it), and (5) places the
 * seat's nested `read` rules AFTER its tools-map `read=allow`, so the engine's
 * `findLast` evaluation denies `.env` reads instead of allowing them (ruling
 * P2-R9). One engine start, no prompt, zero spend.
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
 *
 * Ruling P2-R33 (C1, council #247 round 2): the probe also prints
 * `PROBE_TREE_JSON` — the SAME server, queried for a temp tree whose own
 * opencode.json widens `council-support`. `verifyAgentRendering`
 * (src/council/run-seat-tools.js) is applied to both: ok for the clean
 * server-only agents, NOT ok for the tree-widened one — proving the tripwire
 * catches the real engine's merge-by-key-order behaviour, not just a
 * hand-built rule list.
 *
 * Ruling P2-R34 (B2/C2): a small transcription of the engine's evaluator
 * (`wildcardMatch`/`evaluate` below) is applied to the REAL parsed seat rule
 * list, asserting the `.env` deny/allow split the seat agent depends on.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { verifyAgentRendering } = require('../src/council/run-seat-tools');

const PROBE = path.join(__dirname, '..', 'scripts', 'probe-council-agents.js');

// opencode v1.18.15 packages/opencode/src/util/wildcard.ts (Wildcard.match) and
// src/permission/index.ts (evaluate); transcribed, not imported (P2-R21: the
// SDK is ESM-only) — RE-VERIFY ON AN ENGINE BUMP.
const wildcardMatch = (str, pattern) => {
  const s = String(str).replace(/\\/g, '/');
  let p = String(pattern).replace(/\\/g, '/').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  if (p.endsWith(' .*')) { p = `${p.slice(0, -3)}( .*)?`; }
  return new RegExp(`^${p}$`, process.platform === 'win32' ? 'si' : 's').test(s);
};
const evaluate = (rules, permission, pattern) => {
  const list = Array.isArray(rules) ? rules : [];
  const hit = list.slice().reverse().find((r) => wildcardMatch(permission, r.permission) && wildcardMatch(pattern, r.pattern));
  return hit || { action: 'ask' };
};

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

// Ruling P2-R36: the transcribed trailing-rule literal was wrong — the pinned
// engine's is a SPACE, not a slash (confirmed against opencode.exe:
// endsWith(' .*') -> slice(0,-3)+'( .*)?') — so a command pattern like
// `git *` must also match the bare command with no arguments.
test('wildcardMatch: a trailing space-star is an optional suffix, matching the bare command too', () => {
  expect(wildcardMatch('git', 'git *')).toBe(true);
  expect(wildcardMatch('gitx', 'git *')).toBe(false);
});

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

  // Same P2-R9 shape, one level up: the seat's own `grep`/`webfetch` allows
  // must land AFTER the blanket wildcard rule (`expect(last(starRule(seat,
  // '*'))).toBe('deny')` above only pins the ACTION) — order is what makes the
  // specific allow win under findLast, not merely its presence.
  expect(lastRule(seat, 'grep', '*').index).toBeGreaterThan(lastRule(seat, '*', '*').index);
  expect(lastRule(seat, 'webfetch', '*').index).toBeGreaterThan(lastRule(seat, '*', '*').index);

  // (4): an unknown id is ACCEPTED by the engine — which is exactly why
  // runCouncil validates --tools against tool.ids() itself.
  expect(last(starRule(byName['council-probe-unknown'], 'bogus_tool'))).toBe('allow');

  expect(parsed.toolIds).toEqual(expect.arrayContaining(['read', 'glob', 'grep', 'bash', 'webfetch', 'websearch', 'task', 'skill', 'edit', 'write']));

  // Ruling P2-R33 (C1): verifyAgentRendering on the REAL rendering — clean on
  // the server-only agents, not ok once a reviewed tree widens council-support.
  expect(verifyAgentRendering(seat.permission, ['grep', 'read', 'webfetch'])).toEqual({ ok: true });
  expect(verifyAgentRendering(support.permission, [])).toEqual({ ok: true });

  const treeLine = out.split(/\r?\n/).find((l) => l.startsWith('PROBE_TREE_JSON '));
  if (!treeLine) {
    throw new Error(`probe-council-agents.js printed no PROBE_TREE_JSON line.\nstatus: ${r.status}\nstderr:\n${r.stderr || '(empty)'}\nstdout:\n${out}`);
  }
  const treeParsed = JSON.parse(treeLine.slice('PROBE_TREE_JSON '.length));
  const treeSupport = treeParsed.agents['council-support'];
  const treeVerified = verifyAgentRendering(treeSupport.permission, []);
  expect(treeVerified.ok).toBe(false);
  expect(treeVerified.reason).toContain('task');

  // Ruling P2-R34 (B2/C2): the transcribed evaluator applied to the REAL seat
  // rule list — the `.env` deny/allow split the seat agent depends on.
  expect(evaluate(seat.permission, 'read', '.env').action).toBe('deny');
  expect(evaluate(seat.permission, 'read', 'foo/.env').action).toBe('deny');
  expect(evaluate(seat.permission, 'read', 'config/.env.local').action).toBe('deny');
  // Ruling P2-R41a (A3, round 3): `.envrc` (direnv) joins `.env`/`.env.*` in
  // the seat's read denylist, on the REAL rendered rule list.
  expect(evaluate(seat.permission, 'read', '.envrc').action).toBe('deny');
  expect(evaluate(seat.permission, 'read', 'src/x.js').action).toBe('allow');
  expect(evaluate(seat.permission, 'read', 'README.md').action).toBe('allow');
  expect(evaluate(seat.permission, 'task', '*').action).toBe('deny');
  expect(evaluate(support.permission, 'read', 'src/x.js').action).toBe('deny');

  expect(r.status).toBe(0);
}, 180000);
