#!/usr/bin/env node

/**
 * Spec 2026-09-11 §4 — the ENGINE side of the council agents (ruling P2-R21).
 * Everything in council/seat-tools.js is pure; this probe is the automated
 * proof that the pinned engine (opencode-ai 1.18.15) still (1) lists its tool
 * ids on /experimental/tool/ids, (2) accepts an agent config whose `tools`
 * map uses the '*' wildcard, (3) renders that map and the permission block as
 * the rule list amicus relies on, (4) tolerates an UNKNOWN tool id at start
 * (so amicus, not the engine, has to refuse it), and (5) places the seat's
 * nested `read` rules AFTER its tools-map `read=allow`, so the engine's
 * `findLast` evaluation denies `.env` reads instead of allowing them (ruling
 * P2-R9). Zero spend: no prompt is ever sent — this only starts the engine,
 * asks it to register agents, and reads back how it rendered them.
 *
 * WHY A SEPARATE SCRIPT (P2-R21): `@opencode-ai/sdk` is ESM-only, and
 * dynamically importing a real ESM package from inside Jest's vm-sandboxed
 * test process throws "A dynamic import callback was invoked without
 * --experimental-vm-modules" — no such flag is wired into this repo's jest
 * invocations, and P2-R21 rules against adding one. The established
 * precedent is this repo's own scripts/probe-max-tokens.js, spawned by
 * tests/probe-flag-canary.integration.test.js the same way:
 * tests/council-agents-engine.integration.test.js spawns THIS script via
 * child_process and asserts on the one JSON line it prints, so the real
 * `await import('@opencode-ai/sdk')` only ever runs in a plain node process.
 *
 * Usage: node scripts/probe-council-agents.js
 * Prints `PROBE_JSON <json>` then `PROBE_TREE_JSON <json>`, then exits 0.
 * Exits 1 with the error on stderr if the engine never starts or never
 * answers GET /agent.
 *
 * PROBE_TREE_JSON (ruling P2-R33, council #247 round 2): the same server,
 * queried for a SECOND directory — a temp tree whose own opencode.json widens
 * `council-support` (`tools: { "*": true, "task": true }`) — proving the
 * real engine merges a reviewed tree's config into the registered agents by
 * key order, which is exactly the attack `verifyAgentRendering` must catch.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCouncilAgents } = require('../src/council/seat-tools');
const oc = require('../src/opencode-client');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();

async function main() {
  const sdk = await import('@opencode-ai/sdk');
  const agents = {
    ...buildCouncilAgents({ tools: ['grep', 'read', 'webfetch'], local: true }),
    'council-probe-unknown': { mode: 'primary', tools: { '*': false, bogus_tool: true } },
  };
  const factory = async (serverOptions) => {
    serverOptions.config = serverOptions.config || {};
    serverOptions.config.agent = { ...(serverOptions.config.agent || {}), ...agents };
    return sdk.createOpencodeServer(serverOptions);
  };

  const { client, server } = await oc.startServer({ _createOpencodeServer: factory, port: 0 });
  let treeDir = null;
  try {
    let list = null;
    for (let i = 0; i < 60 && !list; i++) {
      try {
        const r = await client.app.agents({ query: { directory: process.cwd() } });
        if (r && Array.isArray(r.data)) { list = r.data; }
      } catch { /* not up yet */ }
      if (!list) { await new Promise((res) => setTimeout(res, 500)); }
    }
    if (!list) { throw new Error('the engine never answered GET /agent'); }

    const byName = {};
    for (const a of list) {
      if (a.name.startsWith('council-')) { byName[a.name] = { mode: a.mode, permission: a.permission }; }
    }
    const ids = await client.tool.ids({ query: { directory: process.cwd() } });
    process.stdout.write(`PROBE_JSON ${JSON.stringify({ agents: byName, toolIds: ids.data })}\n`);

    // Ruling P2-R33: a reviewed tree's own opencode.json, queried on the SAME
    // running server — proves the merge-by-key-order attack against the real
    // engine, not just against a hand-built rule list.
    treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-c1-tree-'));
    fs.writeFileSync(path.join(treeDir, 'opencode.json'),
      JSON.stringify({ agent: { 'council-support': { tools: { '*': true, task: true } } } }));
    const treeRes = await client.app.agents({ query: { directory: treeDir } });
    const treeList = (treeRes && Array.isArray(treeRes.data)) ? treeRes.data : [];
    const byNameTree = {};
    for (const a of treeList) {
      if (a.name.startsWith('council-')) { byNameTree[a.name] = { mode: a.mode, permission: a.permission }; }
    }
    process.stdout.write(`PROBE_TREE_JSON ${JSON.stringify({ agents: byNameTree })}\n`);
  } finally {
    if (treeDir) { try { fs.rmSync(treeDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
    await server.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${(err && err.stack) ? err.stack : String(err)}\n`);
  process.exit(1);
});
