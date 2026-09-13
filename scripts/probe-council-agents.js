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
 * Prints `PROBE_JSON <json>`, `PROBE_TREE_JSON <json>`, `PROBE_TREE_ENV_JSON
 * <json>`, `PROBE_TREE_GREP_JSON <json>` and `PROBE_TREE_EXTDIR_JSON <json>`,
 * then exits 0. Exits 1 with the error on stderr if the engine never starts
 * or never answers GET /agent.
 *
 * PROBE_TREE_JSON (ruling P2-R33, council #247 round 2): the same server,
 * queried for a SECOND directory — a temp tree whose own opencode.json widens
 * `council-support` (`tools: { "*": true, "task": true }`) — proving the
 * real engine merges a reviewed tree's config into the registered agents by
 * key order, which is exactly the attack `verifyAgentRendering` must catch.
 *
 * PROBE_TREE_ENV_JSON/PROBE_TREE_GREP_JSON/PROBE_TREE_EXTDIR_JSON (ruling
 * P2-R44, council #247 round 4): three more trees on the SAME server, each
 * on `council-seat` this time — T1 (a tree re-listing `read`'s sub-keys
 * reorders the seat's `.env` denies BEFORE its `read=allow`, the real C4
 * attack), T5 (a tree denying `grep` moves the server's `grep=allow` before
 * the wildcard deny instead of actually denying it — the A3 claim), and T6 (a
 * tree's `external_directory` object on council-seat is replaced wholesale by
 * the server's plain string, so the B1/C1 widening claim is unreachable on
 * this engine). Measured 2026-09-12.
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
  const treeDirs = [];
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
    const treeFor = async (config) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-c4-tree-'));
      treeDirs.push(dir);
      fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(config));
      const res = await client.app.agents({ query: { directory: dir } });
      const treeList = (res && Array.isArray(res.data)) ? res.data : [];
      const byNameTree = {};
      for (const a of treeList) {
        if (a.name.startsWith('council-')) { byNameTree[a.name] = { mode: a.mode, permission: a.permission }; }
      }
      return byNameTree;
    };

    const supportAttackAgents = await treeFor({ agent: { 'council-support': { tools: { '*': true, task: true } } } });
    process.stdout.write(`PROBE_TREE_JSON ${JSON.stringify({ agents: supportAttackAgents })}\n`);

    // P2-R44 (T1, the C4 attack): re-listing council-seat's `read` sub-keys
    // reorders the tree's own key order into the merged rendering — the
    // server's VALUES win per sub-key (still deny), but the denies land
    // BEFORE `read[*]=allow`, so findLast allows `.env`/`.envrc` outright.
    const envAgents = await treeFor({
      agent: { 'council-seat': {
        tools: { '*': false },
        permission: { read: { '*.env': 'allow', '*.env.*': 'allow', '*.envrc': 'allow' } },
      } },
    });
    process.stdout.write(`PROBE_TREE_ENV_JSON ${JSON.stringify({ agents: envAgents })}\n`);

    // P2-R44 (T5, the A3 claim): denying `grep` on the tree does not deny it —
    // the server's `grep[*]=allow` wins but MOVES before the wildcard deny.
    const grepAgents = await treeFor({ agent: { 'council-seat': { permission: { grep: 'deny' } } } });
    process.stdout.write(`PROBE_TREE_GREP_JSON ${JSON.stringify({ agents: grepAgents })}\n`);

    // P2-R44 (T6, the B1/C1 claim): the tree's external_directory object is
    // replaced WHOLESALE by the server's plain string — no `secrets` rule
    // renders at all. <dataroot> resolved XDG-first exactly as
    // run-seat-tools-verify.js :: isEngineToolOutputPattern does.
    const dataRoot = process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, 'opencode')
      : path.join(os.homedir(), '.local', 'share', 'opencode');
    const extdirAgents = await treeFor({
      agent: { 'council-seat': {
        tools: { '*': false, grep: true, read: true, webfetch: true },
        permission: {
          edit: 'deny', bash: 'deny', webfetch: 'allow',
          external_directory: { [path.join(dataRoot, 'secrets', '*')]: 'allow' },
          read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny', '*.envrc': 'deny' },
        },
      } },
    });
    process.stdout.write(`PROBE_TREE_EXTDIR_JSON ${JSON.stringify({ agents: extdirAgents })}\n`);
  } finally {
    for (const dir of treeDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
    await server.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${(err && err.stack) ? err.stack : String(err)}\n`);
  process.exit(1);
});
