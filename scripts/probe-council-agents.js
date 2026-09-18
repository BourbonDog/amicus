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
 * THIS SCRIPT DOES NOT SCRUB ITS OWN ENVIRONMENT (unlike scripts/probe-max-
 * tokens.js and scripts/probe-provider-routing.js, which re-exec themselves
 * under buildKeylessEnv). It sends no prompt, so it cannot spend — but it does
 * start a real engine, so run it through the keyless rail
 * (`node scripts/run-integration-keyless.js tests/council-agents-engine.integration.test.js`,
 * which is how CI runs it) or wrap it in buildKeylessEnv by hand.
 *
 * Usage: node scripts/probe-council-agents.js
 * Prints `PROBE_JSON <json>`, `PROBE_TREE_JSON <json>`, `PROBE_TREE_ENV_JSON
 * <json>`, `PROBE_TREE_GREP_JSON <json>`, `PROBE_TREE_EXTDIR_JSON <json>`,
 * `PROBE_TREE_FIELDS_JSON <json>` and `PROBE_TREE_ROUTING_JSON <json>`, then
 * exits 0. Exits 1 with the error on stderr if the engine never starts, never
 * answers GET /agent, or if the routing tree below moves anything.
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
 *
 * PROBE_TREE_FIELDS_JSON (ruling P2-R53, council #247 round 6): one more tree
 * on `council-seat`, printing its FULL rendered agent object (not stripped to
 * {mode, permission} like the others) — a tree can set a council agent's
 * system prompt, model and sampling directly, which `verifyAgentRendering`
 * never checked (it only ever reads `permission`). Measured 2026-09-13.
 *
 * PROBE_TREE_ROUTING_JSON (#202 Lever 2, 2026-09-17): the case that pays for
 * the CI experiment. council-review.yml now writes an opencode.json into its
 * run directory carrying ONLY
 * `provider.openrouter.models.<id>.options.provider` — PR #265 measured that
 * shape reaching the OpenRouter request body (cases R12/R14: a file in the
 * per-call directory is live, because the engine walks up from the session
 * directory). That file therefore lands inside exactly the surface the three
 * rulings above police, so the invariant "PR code is never executed, and the
 * council agents are what this run registered" has to be MEASURED here, not
 * argued in the PR body: the routed rendering of `council-seat` and
 * `council-support` is diffed against a no-tree baseline on the SAME server —
 * the permission rule list with its ORDER intact (the engine evaluates by
 * findLast, so order IS the fact) plus every field `verifyAgentFields` reads.
 * ⚠️ ONE SEGMENT OF THAT ORDER IS THE ENGINE'S OWN COIN FLIP, not a fact about
 * any file: its global `external_directory` ALLOW rules (one per skill
 * directory it scans) come back in a different order on every query. That is
 * why this case carries a CONTROL arm — a SECOND no-tree directory — and
 * compares through probe-council-agents-canon.js :: canonicaliseRules, which
 * sorts each contiguous run of those rules and touches nothing else. Both
 * `controlMovedNothing` and `routingTreeMovedNothing` are printed, and the
 * script exits 1 if EITHER is false: a false control means the normalisation
 * no longer matches the engine and the routing verdict is worthless.
 * That reordering leaves every row ABOVE this one, and the production tripwire,
 * untouched — they assert relationally and read only past the last `*`/`*`
 * rule, which sits after the reordered run. The evidence is in
 * probe-council-agents-canon.js's canonicaliseRules docblock; read it before
 * concluding anything here is order-flaky.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCouncilAgents } = require('../src/council/seat-tools');
const oc = require('../src/opencode-client');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();

const { canonicaliseRules, extAllowRunShape } = require('./probe-council-agents-canon');

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
    // `full` (ruling P2-R53, round 6): PROBE_TREE_FIELDS_JSON below needs the
    // agent's WHOLE rendering (prompt/model/temperature/topP/options/…), not
    // only {mode, permission} — every other tree here only ever cared about
    // permission, so they keep the stripped-down default.
    const treeFor = async (config, { full = false } = {}) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-c4-tree-'));
      treeDirs.push(dir);
      // `config: null` writes NO opencode.json. That is the no-tree BASELINE
      // the #202 routing case diffs against: same server, same kind of fresh
      // empty temp directory, so the FILE is the only difference between the
      // two renderings — a baseline taken at process.cwd() would also differ
      // by the repo tree itself.
      if (config !== null) { fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(config)); }
      const res = await client.app.agents({ query: { directory: dir } });
      const treeList = (res && Array.isArray(res.data)) ? res.data : [];
      const byNameTree = {};
      for (const a of treeList) {
        if (a.name.startsWith('council-')) { byNameTree[a.name] = full ? a : { mode: a.mode, permission: a.permission }; }
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

    // P2-R53 (council #247 round 6, B1): a tree setting council-seat's system
    // prompt, model and sampling directly (not only its permission block) —
    // the FULL agent object is printed (not stripped to {mode, permission})
    // so the test can inspect prompt/model/temperature/topP/options/mode too.
    const fieldsAgents = await treeFor({
      agent: {
        'council-seat': {
          prompt: 'TREE-INJECTED-SYSTEM-PROMPT',
          model: 'openrouter/deepseek/deepseek-v4-flash-0731',
          temperature: 0.9,
          top_p: 0.5,
          description: 'TREE-DESC',
          mode: 'subagent',
          color: '#ff0000',
          options: { reasoning: 'high' },
        },
      },
    }, { full: true });
    process.stdout.write(`PROBE_TREE_FIELDS_JSON ${JSON.stringify({ agents: fieldsAgents })}\n`);

    // #202 Lever 2: the ROUTING-ONLY tree — byte-for-byte the document
    // council-review.yml writes into $RUN_DIR/opencode.json. Three renderings
    // off ONE server: two directories with no opencode.json at all (baseline
    // and CONTROL — see canonicaliseRules for why the control exists), and one
    // carrying the routing document. Compared as JSON.stringify over a FIXED
    // key list rather than over the raw agent objects, so the permission
    // ARRAY's order is pinned (the P2-R44 fact) without the engine's own
    // object key order — no part of the claim — being able to flip the
    // verdict. The field list is exactly what the launch-time tripwire reads:
    // the rule list, plus every field verifyAgentFields inspects.
    const ROUTING_TREE = { provider: { openrouter: { models: { 'qwen/qwen3.8-27b': { options: { provider: { only: ['reka'] } } } } } } };
    const ROUTING_FIELDS = ['mode', 'native', 'model', 'prompt', 'temperature', 'topP',
      'variant', 'steps', 'hidden', 'color', 'options', 'permission'];
    const projectAgents = (rendered) => ['council-seat', 'council-support'].map((name) => {
      const agent = rendered[name];
      const row = { name, present: Boolean(agent) };
      for (const f of ROUTING_FIELDS) { row[f] = (agent && agent[f] !== undefined) ? agent[f] : null; }
      // The offsets and lengths of the runs canonicaliseRules sorts, kept as
      // their own compared field: a rule ADDED to (or removed from) one of
      // those runs, or a run that moved, shows up here even though the sort
      // hides the order WITHIN a run.
      row.extAllowRuns = extAllowRunShape(row.permission);
      row.permission = canonicaliseRules(row.permission);
      return row;
    });
    const baseline = projectAgents(await treeFor(null, { full: true }));
    const control = projectAgents(await treeFor(null, { full: true }));
    const routed = projectAgents(await treeFor(ROUTING_TREE, { full: true }));
    const controlMovedNothing = JSON.stringify(baseline) === JSON.stringify(control);
    const routingTreeMovedNothing = JSON.stringify(baseline) === JSON.stringify(routed);
    process.stdout.write(`PROBE_TREE_ROUTING_JSON ${JSON.stringify({
      routingTreeMovedNothing, controlMovedNothing, tree: ROUTING_TREE, baseline, control, routed,
    })}\n`);
    if (!controlMovedNothing) {
      throw new Error('#202 Lever 2: the CONTROL moved — two directories with NO opencode.json '
        + 'rendered differently even after canonicaliseRules, so this engine\'s nondeterminism is '
        + 'wider than the one run shape that normalisation covers and the routing verdict below '
        + 'means nothing. Re-measure before reading PROBE_TREE_ROUTING_JSON as evidence.');
    }
    if (!routingTreeMovedNothing) {
      throw new Error('#202 Lever 2: the routing-only tree MOVED a council agent rule or field — '
        + 'see the PROBE_TREE_ROUTING_JSON line above for the two renderings. The CI experiment '
        + 'cannot ship in this form; the engine now merges provider blocks into the agents.');
    }
  } finally {
    for (const dir of treeDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
    await server.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${(err && err.stack) ? err.stack : String(err)}\n`);
  process.exit(1);
});
