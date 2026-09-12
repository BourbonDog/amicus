# Council Leg Completion — PR 2: council seats run as agents with a per-run tool allowlist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every council leg runs as one of two engine agents registered per run — `council-seat` (stage-1 seats and their retries; tools = the intent's default ∪ `--tools` opt-in) and `council-support` (repair, judges, debate, chair; no tools) — so a seat can no longer wander into `grep`/`task`/`skill` and hang the leg (study classes 2, spec §1), while a task-mode seat keeps `webfetch` and a caller can opt local tools in deliberately.

**Architecture:** One pure policy module (`src/council/seat-tools.js`) decides the tool list and builds the two agent configs. The run's single OpenCode server (`run-server.js`) registers them through a new `agents` option on `startOpenCodeServer` → `buildServerOptions`; the same object rides `launchWave` → fanout → the per-wave fallback server, so a degraded run gets the same agents. `launchWave` picks the agent by a `role` the stage-1 launch sites set. The `--tools` flag has three surfaces on the CLI door (accepted by the usage text, validated in the handler, forwarded to `runCouncil`) and is forwarded verbatim by the MCP door as argv; `runCouncil` re-validates shape and refusals before the server starts and validates the ids against the engine's own `tool.ids()` after it starts and before any leg launches. With a local tool opted in, the engine's tool scope for stage-1 legs becomes the project tree (`directory: o.project`) while their metadata stays in the run dir, the seat agent carries `external_directory: 'deny'`, and the run dir must sit outside the project tree.

**Tech Stack:** Node 24, Jest 29 (`npx jest <file>` per file; `npm test` is the pre-push gate and the only command that writes `.test-passed`), `@opencode-ai/sdk` 1.18.15 / `opencode-ai` 1.18.15 (exact pins), the keyless integration tier (`npm run test:integration`).

**Spec:** `docs/superpowers/specs/2026-09-11-council-leg-completion-design.md` — §4 (this PR), §2 (decisions), §0 (vocabulary), §7 (rollout).

## Global Constraints

- Branch `feat/council-seat-tools` off `main` (`1bdffbd4`, PR #246 merged); PR targets `main`; carries the `council-review` label; merges only after its council run **completes** (`verdict.json` `overallVerdict` + `seatsReviewed`, never the check colour).
- `docs/superpowers/` is gitignored; plan/spec edits are staged with `git add -f`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` — this is the controller session's attribution; a subagent's own attribution line does not apply.
- Never `python -c`; never `git checkout -- <file>` / `git stash` with other uncommitted edits; never run a live council or anything that spends (a push to the labelled PR spends — the controller gates it).
- **Measured 2026-09-12 on the pinned engine (keyless start, no prompt sent):** `client.tool.ids()` (`GET /experimental/tool/ids`) returns exactly `["invalid","question","bash","read","glob","grep","edit","write","task","webfetch","todowrite","websearch","skill","apply_patch"]`. `GET /agent` is `client.app.agents()` (there is no `client.agent`); its runtime `Agent` objects carry `permission` as a RULE LIST `[{permission, pattern, action}]` (the SDK d.ts declares an older object shape — assert on the runtime) and no `tools` key. An agent config `tools: { '*': false }` renders a `*=deny` rule; `tools: { '*': false, webfetch: true, read: true, grep: true }` renders `*=deny webfetch=allow read=allow grep=allow`; `permission: { edit: 'deny', bash: 'deny', external_directory: 'deny' }` renders `edit=deny bash=deny external_directory=deny` AFTER the engine's defaults (last rule wins). An UNKNOWN tool id in an agent's `tools` map (`bogus_tool: true`) does NOT poison the start — the server comes up and renders `bogus_tool=allow` — so unknown ids must be refused by amicus against `tool.ids()`, the engine will not. The engine's own defaults add `read[*.env]=ask` rules to every agent: a seat with `read` that opens a `.env` file hits an `ask` the headless leg cannot answer and ends by the B53 tool-stall detector (documented as a limitation, not changed here).
- Refused ids (hand-listed on purpose; every other id is validated against the engine): `task`, `skill` (spec §2: spawn/escape), `question` (blocks a headless leg), `invalid` (the engine's error surface, not a tool), `edit`, `write`, `apply_patch` (a council seat never modifies the tree; the seat agent's `edit: 'deny'` would only turn them into refusals inside the model's loop). Remote ids: `webfetch`, `websearch`; every other accepted id is local.
- Defaults (spec §2.1): task mode → `['webfetch']`; review → `[]`. The `--agent Plan|Build` override wins over the computed agents (spec §4) and is the escape hatch the refusal Notice names.
- Out-dir rule (spec §4 vs the v4.7 CLI fence "`--out-dir` must stay inside the project"): with a LOCAL tool opted in, the run dir must be OUTSIDE the project tree AND under an allowed root (`project-root-allowlist.js :: isAllowedProjectRoot`: home, cwd, tmp, `AMICUS_PROJECT_DIR`, `AMICUS_PROJECT_ROOTS`); inside the project it is refused with a Notice. Over MCP the run dir must stay inside the project (`mcp-council-run.js:137-141`), so local tools over MCP are refused with a message that names the CLI; `webfetch`/`websearch` over MCP are fine.
- No new runStats / ledger / verdict field (tally's allowlist strips unknown keys). `run.json` (the run's own record) gains `seatTools` (emit-when-non-empty) and `agentOverride` (emit-when-set) on the existing options checkpoint, and `sharedServer.agents` (the names registered).
- Test hygiene: every new test drives the real code through the suite's existing seams (`fanoutFn`, `startOpenCodeServerFn`, `resolveRouteFn`, `scriptedLaunchers`); named mutants recorded in-source; exact-text briefing pins are updated only where the new tools sentence is the sole difference.

---

### Task 1: `src/council/seat-tools.js` — the policy (test-first)

**Files:**
- Create: `src/council/seat-tools.js`
- Modify: `src/council/briefings-chair.js` (export `CHAIR_NO_TOOLS_LEAD`)
- Test: `tests/council/seat-tools.test.js`

**Interfaces:**
- Consumes: `CHAIR_NO_TOOLS_LEAD` from `./briefings-chair` (currently a module-local const at :18; this task adds it to `module.exports`).
- Produces (exact signatures later tasks rely on):
  - `REFUSED_TOOL_IDS: Object<string,string>` (id → reason), `REMOTE_TOOL_IDS: string[]`
  - `defaultToolsFor(intent: 'task'|undefined): string[]`
  - `parseToolsFlag(value: unknown): { ok: true, ids: string[] } | { ok: false, message: string }`
  - `resolveSeatTools({ intent, optIn?: string[], declaredIds?: string[]|null }): { ok: true, tools: string[], local: boolean } | { ok: false, code: 'BAD_ARGS', message: string }`
  - `buildCouncilAgents({ tools: string[], local: boolean }): { 'council-seat': AgentConfig, 'council-support': AgentConfig }`
  - `seatToolsSentence(tools: string[], kind: 'review'|'answer'): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/council/seat-tools.test.js`:

```js
// tests/council/seat-tools.test.js
'use strict';
const st = require('../../src/council/seat-tools');

const DECLARED = ['invalid', 'question', 'bash', 'read', 'glob', 'grep', 'edit', 'write', 'task',
  'webfetch', 'todowrite', 'websearch', 'skill', 'apply_patch'];

describe('parseToolsFlag', () => {
  test('splits, trims, lowercases and de-duplicates a comma list', () => {
    expect(st.parseToolsFlag(' Read, grep ,read ')).toEqual({ ok: true, ids: ['read', 'grep'] });
  });
  test('refuses an empty value and a non-string', () => {
    expect(st.parseToolsFlag('').ok).toBe(false);
    expect(st.parseToolsFlag(true).ok).toBe(false);
    expect(st.parseToolsFlag(' , ').ok).toBe(false);
  });
  test('refuses anything that is not a tool id shape', () => {
    const r = st.parseToolsFlag('read,../x');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('../x');
  });
});

describe('resolveSeatTools', () => {
  test('review default is no tools; task default is webfetch (spec §2.1)', () => {
    expect(st.resolveSeatTools({ intent: undefined })).toEqual({ ok: true, tools: [], local: false });
    expect(st.resolveSeatTools({ intent: 'task' })).toEqual({ ok: true, tools: ['webfetch'], local: false });
  });
  test('opt-in unions with the default and sorts; a local id flips local', () => {
    expect(st.resolveSeatTools({ intent: 'task', optIn: ['read', 'webfetch'] }))
      .toEqual({ ok: true, tools: ['read', 'webfetch'], local: true });
    expect(st.resolveSeatTools({ intent: undefined, optIn: ['websearch'] }))
      .toEqual({ ok: true, tools: ['websearch'], local: false });
  });
  test('task and skill are refused with a Notice naming the --agent escape hatch (spec §4)', () => {
    for (const id of ['task', 'skill']) {
      const r = st.resolveSeatTools({ intent: 'task', optIn: [id] });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('BAD_ARGS');
      expect(r.message).toContain(id);
      expect(r.message).toContain('--agent Build');
    }
  });
  test('the mutating and interactive ids are refused too (edit, write, apply_patch, question, invalid)', () => {
    for (const id of ['edit', 'write', 'apply_patch', 'question', 'invalid']) {
      expect(st.resolveSeatTools({ intent: undefined, optIn: [id] }).ok).toBe(false);
    }
  });
  test('an id the engine does not declare is refused, and the message lists what it declares', () => {
    const r = st.resolveSeatTools({ intent: undefined, optIn: ['grepp'], declaredIds: DECLARED });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('grepp');
    expect(r.message).toContain('read');
    expect(r.message).not.toContain('task'); // refused ids are not offered
  });
  test('with the declared list, every accepted id passes', () => {
    expect(st.resolveSeatTools({ intent: 'task', optIn: ['read', 'grep', 'glob', 'bash', 'websearch'], declaredIds: DECLARED }))
      .toEqual({ ok: true, tools: ['bash', 'glob', 'grep', 'read', 'websearch', 'webfetch'], local: true });
  });
});

describe('buildCouncilAgents', () => {
  test('support has every tool off and every permission denied', () => {
    const a = st.buildCouncilAgents({ tools: ['webfetch'], local: false })['council-support'];
    expect(a.mode).toBe('primary');
    expect(a.tools).toEqual({ '*': false });
    expect(a.permission).toEqual({ edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' });
  });
  test('seat allows exactly the resolved tools over a wildcard deny', () => {
    const a = st.buildCouncilAgents({ tools: ['webfetch'], local: false })['council-seat'];
    expect(a.tools).toEqual({ '*': false, webfetch: true });
    expect(a.permission).toEqual({ edit: 'deny', bash: 'deny', webfetch: 'allow' });
    expect(a.permission.external_directory).toBeUndefined();
  });
  test('a local seat denies external_directory and allows bash only when bash is in', () => {
    const a = st.buildCouncilAgents({ tools: ['bash', 'read'], local: true })['council-seat'];
    expect(a.tools).toEqual({ '*': false, bash: true, read: true });
    expect(a.permission).toEqual({ edit: 'deny', bash: 'allow', webfetch: 'deny', external_directory: 'deny' });
  });
  test('never emits a chat key (buildServerOptions merges after chat)', () => {
    expect(Object.keys(st.buildCouncilAgents({ tools: [], local: false })).sort())
      .toEqual(['council-seat', 'council-support']);
  });
});

describe('seatToolsSentence', () => {
  test('no tools: the shared no-tools sentence, forked only on its last word', () => {
    expect(st.seatToolsSentence([], 'review'))
      .toBe('Do NOT use any tools or read any files; everything is in this message; begin immediately with the review.');
    expect(st.seatToolsSentence([], 'answer').endsWith('begin immediately with the answer.')).toBe(true);
  });
  test('remote tools only: names them and forbids the local moves', () => {
    expect(st.seatToolsSentence(['webfetch'], 'answer')).toBe(
      'Your tools: webfetch. You have no others — do not attempt to read files, search directories, ' +
      'or run commands; if research is incomplete, say so in the deliverable rather than leave it unwritten.');
  });
  test('local tools present: names them without the forbidding clause', () => {
    expect(st.seatToolsSentence(['grep', 'read', 'webfetch'], 'review')).toBe(
      'Your tools: grep, read, webfetch. You have no others; if research is incomplete, say so in the ' +
      'deliverable rather than leave it unwritten.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/council/seat-tools.test.js`
Expected: FAIL — `Cannot find module '../../src/council/seat-tools'`.

- [ ] **Step 3: Export the shared no-tools lead**

In `src/council/briefings-chair.js`, the `module.exports = { ... CHAIR_NO_TOOLS_PREAMBLE, chairRepairPromptFor, ...}` object: add `CHAIR_NO_TOOLS_LEAD,` beside `CHAIR_NO_TOOLS_PREAMBLE`. Nothing else changes.

- [ ] **Step 4: Write the module**

Create `src/council/seat-tools.js`:

```js
// src/council/seat-tools.js
'use strict';

/**
 * @module council/seat-tools
 * Per-run tool policy for council seats (spec 2026-09-11 §4, PR 2 of 3).
 *
 * The study (§1) found two of the three leg-loss classes share one precondition:
 * a stage-1 seat reached for a tool it did not need (gemini grep/glob over the
 * global install, cohere `task {}`). Tool access is a property of the RUN, set
 * by the caller according to whether the seat must go and get its material
 * (§2.1): task mode defaults to `webfetch`, review to nothing, `--tools` opts
 * more in, and two ids are never available to a headless seat without the
 * `--agent` override. This module is pure: it decides, and builds the two agent
 * configs the run's OpenCode server registers (run-server.js). Nothing here
 * talks to the engine — the engine's declared ids are passed IN (`declaredIds`)
 * by run.js after the server is up, so the accepted set is never hand-listed.
 */

const { CHAIR_NO_TOOLS_LEAD } = require('./briefings-chair');

/**
 * Ids a council seat may never opt into. Hand-listed on purpose: each names why.
 * Everything else is validated against the engine's own `tool.ids()`.
 */
const REFUSED_TOOL_IDS = Object.freeze({
  task: 'spawns child sessions amicus cannot observe',
  skill: 'is where a seat starts reading the harness instead of the brief',
  question: 'asks a human, and a headless leg has none',
  invalid: 'is the engine\'s error surface, not a tool',
  edit: 'a council seat never modifies the tree',
  write: 'a council seat never modifies the tree',
  apply_patch: 'a council seat never modifies the tree',
});

/** Ids that never touch the local tree; every other accepted id is LOCAL. */
const REMOTE_TOOL_IDS = Object.freeze(['webfetch', 'websearch']);

const ESCAPE_HATCH = '--agent Build';
const ID_SHAPE = /^[a-z][a-z0-9_]*$/;

/** @param {'task'|undefined} intent @returns {string[]} */
function defaultToolsFor(intent) {
  return intent === 'task' ? ['webfetch'] : [];
}

/**
 * The `--tools` flag's value → ids. Shape only; refusals and the engine check
 * live in resolveSeatTools so every door reaches them.
 * @param {unknown} value
 * @returns {{ok: true, ids: string[]}|{ok: false, message: string}}
 */
function parseToolsFlag(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: '--tools requires a comma-separated list of tool ids (e.g. --tools webfetch,read)' };
  }
  const ids = [...new Set(value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!ids.length) { return { ok: false, message: '--tools requires at least one tool id' }; }
  const bad = ids.filter((id) => !ID_SHAPE.test(id));
  if (bad.length) { return { ok: false, message: `--tools: not a tool id: ${bad.join(', ')}` }; }
  return { ok: true, ids };
}

/**
 * Decide the seat's tool list: `defaultToolsFor(intent) ∪ optIn`, minus nothing —
 * a refused or unknown id fails the whole run BEFORE any spend.
 * @param {{intent?: 'task'|undefined, optIn?: string[], declaredIds?: string[]|null}} args
 *   `declaredIds` null/absent = the engine has not been asked yet (shape + refusals only).
 * @returns {{ok: true, tools: string[], local: boolean}|{ok: false, code: 'BAD_ARGS', message: string}}
 */
function resolveSeatTools({ intent, optIn = [], declaredIds = null } = {}) {
  const requested = [...new Set([...defaultToolsFor(intent), ...optIn])];
  const refused = requested.filter((id) => Object.prototype.hasOwnProperty.call(REFUSED_TOOL_IDS, id));
  if (refused.length) {
    return {
      ok: false, code: 'BAD_ARGS',
      message: `--tools: ${refused.map((id) => `${id} (${REFUSED_TOOL_IDS[id]})`).join('; ')} — refused for council seats; ` +
        `${ESCAPE_HATCH} runs every leg on the engine's full Build agent instead`,
    };
  }
  if (Array.isArray(declaredIds)) {
    const unknown = requested.filter((id) => !declaredIds.includes(id));
    if (unknown.length) {
      const offered = declaredIds.filter((id) => !Object.prototype.hasOwnProperty.call(REFUSED_TOOL_IDS, id)).sort();
      return {
        ok: false, code: 'BAD_ARGS',
        message: `--tools: the engine does not declare ${unknown.join(', ')}; it declares: ${offered.join(', ')}`,
      };
    }
  }
  const tools = requested.slice().sort();
  const local = tools.some((id) => !REMOTE_TOOL_IDS.includes(id));
  return { ok: true, tools, local };
}

/**
 * The two agents the run's server registers (spec §4). `'*': false` is the
 * engine's wildcard (measured 2026-09-12: renders a `*=deny` rule, and each
 * `true` renders `<id>=allow` after it). Never emits `chat`.
 * @param {{tools: string[], local: boolean}} args
 * @returns {{'council-seat': object, 'council-support': object}}
 */
function buildCouncilAgents({ tools = [], local = false } = {}) {
  const allow = Object.fromEntries(tools.map((id) => [id, true]));
  return {
    'council-support': {
      description: 'Council support role (repair, judge, debate, chair): no tools — the material is in the briefing.',
      mode: 'primary',
      tools: { '*': false },
      permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' },
    },
    'council-seat': {
      description: `Council stage-1 seat: tools ${tools.length ? tools.join(', ') : 'none'}.`,
      mode: 'primary',
      tools: { '*': false, ...allow },
      permission: {
        edit: 'deny',
        bash: tools.includes('bash') ? 'allow' : 'deny',
        webfetch: tools.includes('webfetch') ? 'allow' : 'deny',
        ...(local ? { external_directory: 'deny' } : {}),
      },
    },
  };
}

/**
 * The briefing line a seat gets about its tools (spec §4 "briefing lines").
 * No tools → the shared no-tools sentence (briefings-chair.js), forked only on
 * its last word, exactly like the chair's. Config enforces; this informs (E1:
 * told not to, gemini complied).
 * @param {string[]} tools @param {'review'|'answer'} kind
 */
function seatToolsSentence(tools, kind) {
  if (!tools || !tools.length) { return `${CHAIR_NO_TOOLS_LEAD}${kind}.`; }
  const local = tools.some((id) => !REMOTE_TOOL_IDS.includes(id));
  const forbid = local ? '' : ' — do not attempt to read files, search directories, or run commands';
  return `Your tools: ${tools.join(', ')}. You have no others${forbid}; if research is incomplete, ` +
    'say so in the deliverable rather than leave it unwritten.';
}

module.exports = {
  REFUSED_TOOL_IDS, REMOTE_TOOL_IDS, defaultToolsFor, parseToolsFlag, resolveSeatTools,
  buildCouncilAgents, seatToolsSentence,
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest tests/council/seat-tools.test.js tests/council/briefings-chair.test.js`
Expected: PASS (if `tests/council/briefings-chair.test.js` does not exist, run `npx jest tests/council --testPathPattern briefings` and expect green).

- [ ] **Step 6: Commit**

```bash
git add src/council/seat-tools.js src/council/briefings-chair.js tests/council/seat-tools.test.js
git commit -m "feat(council): seat-tools policy — per-run tool list, refusals, the two agent configs, the briefing line

Spec 2026-09-11 §4 (PR 2 of 3). Pure: task defaults to webfetch, review to
nothing, --tools opts in; task/skill/question/invalid/edit/write/apply_patch are
refused with the --agent Build escape hatch named; anything else is checked
against the engine's own tool.ids() by the caller. Builds council-seat
(wildcard deny + the allowlist; external_directory deny when a local tool is
in) and council-support (everything off). Measured on the pinned engine
2026-09-12: the '*' wildcard renders *=deny, allowlisted ids render =allow.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Register the agents on every server a council run touches

**Files:**
- Modify: `src/opencode-client.js` (`buildServerOptions`, after the `config.agent = {...chat}` block at ~:653-656), `src/sidecar/session-utils.js` (`startOpenCodeServer`, the option-forwarding block at ~:250-260), `src/sidecar/fanout.js` (the own-server start at ~:221), `src/council/run-server.js` (`acquireRunServer`), `src/council/run-launch.js` (`createLaunchers` / `launchWave`)
- Test: `tests/opencode-client-cowork.test.js`, `tests/council/run-launch.test.js`, `tests/council/run-server-agents.test.js` (new)

**Interfaces:**
- Consumes: `buildCouncilAgents` output shape from Task 1.
- Produces:
  - `buildServerOptions(options)` honours `options.agents: Object<string, AgentConfig>` (merged into `config.agent` after `chat`).
  - `startOpenCodeServer(mcpConfig, options)` forwards `options.agents`.
  - `runFanout(options)` honours `options.serverAgents` when it starts its own server.
  - `acquireRunServer(o, deps)` passes `o.councilAgents` as `agents` and records `sharedServer.agents` (names) on run.json.
  - `run-server.js :: listEngineToolIds(shared, directory): Promise<string[]|null>`.
  - `createLaunchers(deps)` gains `deps.councilAgents: () => object|null` and `deps.agentOverride: () => string|undefined`; `launchWave(opts)` honours `opts.role: 'seat'|undefined` and `opts.directory` (defaults to `opts.project`). Agent resolution, in order: `opts.agent` → `agentOverride()` → (`councilAgents()` ? `opts.role === 'seat' ? 'council-seat' : 'council-support'` : `'Plan'`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/opencode-client-cowork.test.js` (inside its top-level `describe` of `buildServerOptions`, after the last `it`):

```js
  it('merges caller-supplied agents after chat (council seat agents, spec 2026-09-11 §4)', () => {
    const agents = {
      'council-seat': { mode: 'primary', tools: { '*': false, webfetch: true }, permission: { edit: 'deny' } },
      'council-support': { mode: 'primary', tools: { '*': false } },
    };
    const opts = buildServerOptions({ agents });
    expect(opts.config.agent['council-seat']).toEqual(agents['council-seat']);
    expect(opts.config.agent['council-support']).toEqual(agents['council-support']);
    expect(opts.config.agent.chat).toBeDefined(); // never displaced
  });

  it('omits every council agent when none are supplied (non-council servers are byte-identical)', () => {
    const opts = buildServerOptions({});
    expect(Object.keys(opts.config.agent)).toEqual(['chat']);
  });
```

Append to `tests/council/run-launch.test.js`'s `describe('launchWave (DI over runFanout)')`:

```js
  test('with council agents: stage-1 role gets council-seat, everything else council-support, and the agents ride to fanout (spec §4)', async () => {
    const seen = [];
    const fanoutFn = async (opts) => { seen.push(opts); return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 }; };
    const agents = { 'council-seat': { mode: 'primary', tools: { '*': false } }, 'council-support': { mode: 'primary', tools: { '*': false } } };
    const { launchWave, launchSolo } = createLaunchers({ fanoutFn, councilAgents: () => agents });
    await launchWave({ models: ['gemini', 'gpt'], prompt: 'p', project: tmp, waveId: 'r-s1', role: 'seat' });
    await launchWave({ models: ['gemini', 'gpt'], prompt: 'p', project: tmp, waveId: 'r-s2' });
    await launchSolo({ model: 'deepseek', prompt: 'p', project: tmp, waveId: 'r-ch1' });
    expect(seen.map((o) => o.agent)).toEqual(['council-seat', 'council-support', 'council-support']);
    expect(seen.every((o) => o.serverAgents === agents)).toBe(true);
  });

  test('the --agent override wins over the computed agents (spec §4 escape hatch)', async () => {
    const seen = [];
    const fanoutFn = async (opts) => { seen.push(opts); return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 }; };
    const { launchWave } = createLaunchers({ fanoutFn, councilAgents: () => null, agentOverride: () => 'Build' });
    await launchWave({ models: ['gemini'], prompt: 'p', project: tmp, waveId: 'r-s1', role: 'seat' });
    expect(seen[0].agent).toBe('Build');
    expect(seen[0].serverAgents).toBeUndefined();
  });

  test('directory can differ from project: a local-tools seat is scoped to the project tree while its metadata stays in the run dir', async () => {
    const seen = [];
    const fanoutFn = async (opts) => { seen.push(opts); return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 }; };
    const { launchWave } = createLaunchers({ fanoutFn });
    const projectTree = path.join(tmp, 'tree');
    await launchWave({ models: ['gemini'], prompt: 'p', project: tmp, directory: projectTree, waveId: 'r-s1' });
    expect(seen[0].project).toBe(tmp);
    expect(seen[0].directory).toBe(projectTree);
  });
```

Create `tests/council/run-server-agents.test.js`:

```js
// tests/council/run-server-agents.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireRunServer, listEngineToolIds } = require('../../src/council/run-server');
const runState = require('../../src/council/run-state');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-server-agents-'));
  runState.initRun(tmp, { schemaVersion: 2, type: 'council-run', runId: 'r1', status: 'running', stages: [] });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const resolveRouteFn = async ({ model }) => ({ kind: 'resolved', executableId: `openrouter/x/${model}` });
const statsFn = () => [];

describe('acquireRunServer registers the council agents (spec 2026-09-11 §4)', () => {
  test('passes o.councilAgents as `agents` and records their names on run.json', async () => {
    const seen = [];
    const startOpenCodeServerFn = async (mcp, options) => { seen.push(options); return { client: {}, server: { url: 'http://127.0.0.1:1', close: async () => {} } }; };
    const agents = { 'council-seat': { mode: 'primary' }, 'council-support': { mode: 'primary' } };
    const o = { runId: 'r1', runDir: tmp, models: ['gemini', 'gpt'], chair: 'deepseek', councilAgents: agents };
    const shared = await acquireRunServer(o, { startOpenCodeServerFn, resolveRouteFn, statsFn });
    expect(shared).not.toBeNull();
    expect(seen[0].agents).toBe(agents);
    expect(runState.readRun(tmp).sharedServer.agents).toEqual(['council-seat', 'council-support']);
  });

  test('without councilAgents the start options carry no agents key (byte-identical to today)', async () => {
    const seen = [];
    const startOpenCodeServerFn = async (mcp, options) => { seen.push(options); return { client: {}, server: { url: 'http://127.0.0.1:1', close: async () => {} } }; };
    const o = { runId: 'r1', runDir: tmp, models: ['gemini', 'gpt'], chair: 'deepseek' };
    await acquireRunServer(o, { startOpenCodeServerFn, resolveRouteFn, statsFn });
    expect('agents' in seen[0]).toBe(false);
    expect(runState.readRun(tmp).sharedServer.agents).toEqual([]);
  });
});

describe('listEngineToolIds', () => {
  test('returns the ids the engine lists, scoped to the directory', async () => {
    const calls = [];
    const shared = { serverClient: { tool: { ids: async (args) => { calls.push(args); return { data: ['read', 'webfetch'] }; } } } };
    expect(await listEngineToolIds(shared, '/proj')).toEqual(['read', 'webfetch']);
    expect(calls[0]).toEqual({ query: { directory: '/proj' } });
  });
  test('returns null (never throws) with no server, no tool namespace, a throw, or a non-array', async () => {
    expect(await listEngineToolIds(null, '/p')).toBeNull();
    expect(await listEngineToolIds({ serverClient: {} }, '/p')).toBeNull();
    expect(await listEngineToolIds({ serverClient: { tool: { ids: async () => { throw new Error('404'); } } } }, '/p')).toBeNull();
    expect(await listEngineToolIds({ serverClient: { tool: { ids: async () => ({ data: 'nope' }) } } }, '/p')).toBeNull();
  });
});
```

(If `runState.readRun` is not the reader's name, use the function `run-state.js` exports that reads `run.json` — `grep -n "^function read" src/council/run-state.js` — and say which in the report.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/opencode-client-cowork.test.js tests/council/run-launch.test.js tests/council/run-server-agents.test.js`
Expected: the six new tests FAIL (`config.agent['council-seat']` undefined; `agent` is `'Plan'`; `serverAgents` undefined; `listEngineToolIds` not a function).

- [ ] **Step 3: `buildServerOptions` — the `agents` option**

In `src/opencode-client.js`, directly after

```js
  config.agent = {
    ...(config.agent || {}),
    chat: chatAgent
  };
```

insert:

```js
  // Council seat agents (spec 2026-09-11 §4, PR 2): a per-run map of extra agents
  // the caller already computed (council/seat-tools.js :: buildCouncilAgents).
  // Merged AFTER `chat`, so a caller can never displace the chat registration;
  // seat-tools.js never emits a `chat` key. Absent → this block is a no-op and
  // every non-council server's config is byte-identical to today.
  if (options.agents && typeof options.agents === 'object') {
    for (const [name, agentConfig] of Object.entries(options.agents)) {
      config.agent[name] = { ...(config.agent[name] || {}), ...agentConfig };
    }
  }
```

Add to the JSDoc above `buildServerOptions`: ` * @param {Object<string, object>} [options.agents] - Extra agent configs to register (council seat agents, spec 2026-09-11 §4)`.

- [ ] **Step 4: `startOpenCodeServer` forwards it**

In `src/sidecar/session-utils.js`, after `if (options.agentName) { serverOptions.agentName = options.agentName; }` add:

```js
  // Spec 2026-09-11 §4: the council's two agents ride into buildServerOptions.
  if (options.agents) { serverOptions.agents = options.agents; }
```

and the JSDoc line ` * @param {Object<string, object>} [options.agents] - Extra agents to register (council seat agents)`.

- [ ] **Step 5: fanout's own server gets them too**

In `src/sidecar/fanout.js`, change the own-server start (currently
`({ client, server } = await startOpenCodeServer(mcpServers, { models: validated.serverModels || okLegs.map(l => l.model) }));`) to:

```js
      ({ client, server } = await startOpenCodeServer(mcpServers, {
        models: validated.serverModels || okLegs.map(l => l.model),
        // Spec 2026-09-11 §4: when a council run lost its shared server and this
        // wave starts its own, the legs still launch as council-seat/-support —
        // so those agents must exist here too. Spread-guarded: every non-council
        // caller's start options stay key-identical.
        ...(options.serverAgents ? { agents: options.serverAgents } : {}),
      }));
```

Add ` *   serverAgents? (spec 2026-09-11 §4: agents to register if this wave starts its own server)` to `runFanout`'s options JSDoc list.

- [ ] **Step 6: `acquireRunServer` + `listEngineToolIds`**

In `src/council/run-server.js`, `acquireRunServer`: change `const { client, server } = await startFn(mcpServers, { models });` to

```js
    const { client, server } = await startFn(mcpServers, {
      models,
      // Spec 2026-09-11 §4: the run's two council agents (run.js computes them
      // from the intent and --tools before this call).
      ...(o.councilAgents ? { agents: o.councilAgents } : {}),
    });
```

and in the `recordServerFate(o, { sharedServer: { ... } })` record add `agents: Object.keys(o.councilAgents || {}),` after `models: models.length,`.

Add the function (before `module.exports`) and export it:

```js
/**
 * The tool ids the run's engine declares (spec 2026-09-11 §4): what `--tools`
 * is validated against, read from the engine itself so the accepted set is
 * never hand-listed. Best-effort and never throws: null means "could not ask"
 * (no shared server, an engine without the endpoint, a transport error), and
 * run.js refuses `--tools` on null rather than launching unvalidated.
 * `/experimental/tool/ids` on the pinned SDK 1.18.15 — the keyless probe
 * (tests/council-agents-engine.integration.test.js) pins its presence.
 * @param {{serverClient: object}|null} shared
 * @param {string} directory the project directory the query is scoped to
 * @returns {Promise<string[]|null>}
 */
async function listEngineToolIds(shared, directory) {
  const client = shared && shared.serverClient;
  if (!client || !client.tool || typeof client.tool.ids !== 'function') { return null; }
  try {
    const res = await client.tool.ids({ query: { directory } });
    return (res && Array.isArray(res.data)) ? res.data.slice() : null;
  } catch { return null; }
}
```

`module.exports = { acquireRunServer, releaseRunServer, resolveRunServerModels, recordServerFate, listEngineToolIds };`

- [ ] **Step 7: `createLaunchers` / `launchWave`**

In `src/council/run-launch.js`:

```js
function createLaunchers(deps = {}) {
  const fanoutFn = deps.fanoutFn || require('../sidecar/fanout').runFanout;
  const remainingBudget = deps.remainingBudget || null;
  const reserveBudget = deps.reserveBudget || null;
  const onBudgetRefusal = deps.onBudgetRefusal || null;
  const sharedServer = deps.sharedServer || null;
  // Spec 2026-09-11 §4: getters, like sharedServer — run.js builds the launchers
  // before it has decided the seat policy.
  const councilAgents = deps.councilAgents || (() => null);
  const agentOverride = deps.agentOverride || (() => undefined);
```

In `launchWave`, before the `fanoutFn({` call:

```js
    const agents = councilAgents();
    // Spec 2026-09-11 §4: stage-1 seats and their retries run as council-seat,
    // every other role as council-support; an explicit agent (the --agent
    // escape hatch) wins. Without council agents (non-council DI, older
    // callers) the pre-§4 default 'Plan' stands.
    const agent = opts.agent || agentOverride()
      || (agents ? (opts.role === 'seat' ? 'council-seat' : 'council-support') : 'Plan');
```

and in the call: `agent: opts.agent || 'Plan',` → `agent,`; after `...(opts.retryOfWaveId ? { retryOfWaveId: opts.retryOfWaveId } : {}),` add `...(agents ? { serverAgents: agents } : {}),`; and `directory: opts.project,` → `directory: opts.directory || opts.project,` with the comment extended: `// Spec 2026-09-11 §4: a local-tools seat is scoped to the PROJECT TREE (opts.directory) while its metadata stays in the run dir (opts.project).`

Update the launchWave JSDoc `opts` type with `role?: 'seat', directory?: string`.

- [ ] **Step 8: Run to verify they pass, plus the neighbours**

Run: `npx jest tests/opencode-client-cowork.test.js tests/council/run-launch.test.js tests/council/run-server-agents.test.js tests/council/run-launch-spend.test.js tests/opencode-client.test.js tests/fanout.test.js tests/council/degrade-channels.test.js tests/council/chair-fallback.test.js`
Expected: all green (the existing `agent Plan` default test still passes — no council agents in that launcher).

- [ ] **Step 9: Commit**

```bash
git add src/opencode-client.js src/sidecar/session-utils.js src/sidecar/fanout.js src/council/run-server.js src/council/run-launch.js tests/opencode-client-cowork.test.js tests/council/run-launch.test.js tests/council/run-server-agents.test.js
git commit -m "feat(council): register council-seat/council-support on the run's server; launch by role

Spec 2026-09-11 §4 (PR 2). buildServerOptions gains an \`agents\` map merged
after chat; startOpenCodeServer and fanout's own-server start forward it, so a
run that lost its shared server still launches legs against agents that exist.
acquireRunServer passes o.councilAgents and records the names on run.json;
listEngineToolIds reads the engine's declared tool ids for run.js to validate
--tools against. launchWave picks council-seat for role 'seat' (stage-1 seats
and retries) and council-support otherwise, an explicit --agent wins, and
\`directory\` may differ from \`project\` for a local-tools seat.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The briefing lines

**Files:**
- Modify: `src/council/briefings.js` (`composeWith`, `compose`, the three builders), `src/council/briefings-task.js` (`buildTaskSeatBriefing`, `buildTaskCriticBriefing`, `buildTaskLensBriefing`)
- Test: `tests/council/briefings-tools.test.js` (new); existing briefing suites re-run

**Interfaces:**
- Consumes: `seatToolsSentence(tools, kind)` from Task 1.
- Produces: `composeWith(role, clause, contract, { briefing, date, tools }, kind = 'review')` — the tools sentence is the SECOND element (after the role); `stage1SeatBriefing(intent, { briefing, date, tools })` and the critic/lens dispatchers pass `tools` through.

- [ ] **Step 1: Write the failing tests**

Create `tests/council/briefings-tools.test.js`:

```js
// tests/council/briefings-tools.test.js
'use strict';
const briefings = require('../../src/council/briefings');

const NO_TOOLS_REVIEW = 'Do NOT use any tools or read any files; everything is in this message; begin immediately with the review.';
const NO_TOOLS_ANSWER = 'Do NOT use any tools or read any files; everything is in this message; begin immediately with the answer.';
const args = (extra = {}) => ({ briefing: 'MATERIAL', date: '2026-09-12', ...extra });

describe('stage-1 briefings carry the seat tools sentence (spec 2026-09-11 §4)', () => {
  test('review seat, critic and lens with no tools get the shared no-tools sentence ending in "review."', () => {
    expect(briefings.stage1SeatBriefing(undefined, args())).toContain(NO_TOOLS_REVIEW);
    expect(briefings.stage1CriticBriefing(undefined, args())).toContain(NO_TOOLS_REVIEW);
    expect(briefings.stage1LensBriefing(undefined, args({ lens: 'security engineer' }))).toContain(NO_TOOLS_REVIEW);
  });
  test('task seat, critic and lens with no tools end in "answer."', () => {
    expect(briefings.stage1SeatBriefing('task', args())).toContain(NO_TOOLS_ANSWER);
    expect(briefings.stage1CriticBriefing('task', args())).toContain(NO_TOOLS_ANSWER);
    expect(briefings.stage1LensBriefing('task', args({ lens: 'security engineer' }))).toContain(NO_TOOLS_ANSWER);
  });
  test('with tools, the line names exactly them and sits right after the role paragraph', () => {
    const text = briefings.stage1SeatBriefing('task', args({ tools: ['webfetch'] }));
    const [role, second] = text.split('\n\n');
    expect(role).toMatch(/^You are/);
    expect(second).toBe('Your tools: webfetch. You have no others — do not attempt to read files, search directories, or run commands; if research is incomplete, say so in the deliverable rather than leave it unwritten.');
    expect(text).not.toContain('Do NOT use any tools');
  });
  test('the repair prompts are untouched (they carry their own no-tools line)', () => {
    const p = briefings.stage1RepairPrompt(undefined, { errors: [{ code: 'X', detail: 'y' }], review: 'r' });
    expect(p.startsWith('Do NOT use any tools or read any files; everything is in this message; begin immediately with the JSON block.')).toBe(true);
    expect(p).not.toContain('Your tools:');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/council/briefings-tools.test.js`
Expected: FAIL — the no-tools sentence is absent from the seat briefing today.

- [ ] **Step 3: Implement**

In `src/council/briefings.js`:

```js
/**
 * @param {string} role @param {string} clause @param {string} contract
 * @param {{briefing: string, date?: string, tools?: string[]}} args
 * @param {'review'|'answer'} [kind] the no-tools sentence's last word (spec §4:
 *   the seat sentence forks exactly where the chair's does)
 */
function composeWith(role, clause, contract, { briefing, date, tools }, kind = 'review') {
  const { seatToolsSentence } = require('./seat-tools'); // lazy: seat-tools requires briefings-chair
  return [
    role,
    seatToolsSentence(tools || [], kind),
    clause,
    dateLine(date),
    contract,
    '--- MATERIAL / BRIEFING ---',
    briefing,
  ].join('\n\n');
}
```

`compose(role, args)` is unchanged (it delegates with the default kind `'review'`). `buildLensBriefing({ lens, briefing, date, tools })` must pass `{ briefing, date, tools }` (it currently drops unknown keys: `{ briefing, date }`).

In `src/council/briefings-task.js`: `buildTaskSeatBriefing(args)` → `composeWith(TASK_SEAT_ROLE, TASK_ANTI_SYCOPHANCY_CLAUSE, TASK_FINDINGS_CONTRACT, args, 'answer')`; same fifth argument `'answer'` for `buildTaskCriticBriefing`; `buildTaskLensBriefing({ lens, briefing, date, tools })` passes `{ briefing, date, tools }` and `'answer'`.

- [ ] **Step 4: Run the briefing suites; update exact-text pins only where the new sentence is the sole difference**

Run: `npx jest tests/council --testPathPattern "briefings"`
Expected: `briefings-tools` green. Any existing pin that now fails must fail ONLY because the second paragraph is the new no-tools sentence — update that pin's expected text (or its split index) and note each in the report. A failure of any other kind stops the task.

- [ ] **Step 5: Commit**

```bash
git add src/council/briefings.js src/council/briefings-task.js tests/council/briefings-tools.test.js tests/council/
git commit -m "feat(council): stage-1 briefings name the seat's tools (or say there are none)

Spec 2026-09-11 §4: a seat with no tools gets the shared no-tools sentence,
forked on its last word exactly like the chair's (review. / answer.); a seat
with tools gets one line naming exactly them. Config enforces (the agents in
the previous commit), the briefing informs (E1: told not to, gemini complied).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `runCouncil` wiring — decide, validate against the engine, register, launch by role, the out-dir rule

**Files:**
- Modify: `src/council/run.js` (before and after `acquireRunServer`; the stage-1 options checkpoint), `src/council/run-stage1-launch.js` (`common` + the three briefing calls), `src/council/run-retry.js` (`common` + `briefingFor`)
- Test: `tests/council/run-tools.test.js` (new), `tests/council/run-intent.test.js` (one added case)

**Interfaces:**
- Consumes: Task 1 (`resolveSeatTools`, `buildCouncilAgents`), Task 2 (`councilAgents`/`agentOverride` getters, `listEngineToolIds`, `role`, `directory`), Task 3 (`tools` on briefing args).
- Produces: `runCouncil(o)` honours `o.tools?: string[]` and `o.agent?: 'Plan'|'Build'`; sets `o.seatTools`, `o.seatToolsLocal`, `o.councilAgents`; run.json gains `seatTools` / `agentOverride`; new test seam `deps.listEngineToolIdsFn`.

- [ ] **Step 1: Write the failing tests**

Create `tests/council/run-tools.test.js` (mirror the harness of `tests/council/run-intent.test.js`: tmp run dir, `scriptedLaunchers` from `./helpers/fake-launchers`, the happy-path script it exports — read that file's top 60 lines first and reuse its `happyScript`/bench names verbatim):

```js
// tests/council/run-tools.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const runState = require('../../src/council/run-state');
const fakes = require('./helpers/fake-launchers');

let tmp; let runDir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tools-'));
  runDir = path.join(tmp, 'council-r1');
  fs.mkdirSync(runDir, { recursive: true });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// The same option bag run-intent.test.js drives runCouncil with, minus intent.
const base = (extra = {}) => ({
  briefing: 'Review this.', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
  project: tmp, runId: 'r1', runDir, timeout: 1, maxCost: null, gateway: 'auto',
  noValidateModel: true, date: '2026-09-12', json: true, ...extra,
});
const launchersFor = () => fakes.scriptedLaunchers(fakes.happyScript ? fakes.happyScript('r1') : fakes.script3('r1'));
const stage1 = (calls) => calls.filter((c) => c.waveId === 'r1-s1')[0];
const others = (calls) => calls.filter((c) => c.waveId !== 'r1-s1');

describe('runCouncil seat tools (spec 2026-09-11 §4)', () => {
  test('review default: stage-1 launches with role seat and the no-tools sentence; support roles have no role', async () => {
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(base(), { launchers });
    expect(exitCode).toBe(0);
    expect(stage1(launchers.calls).role).toBe('seat');
    expect(stage1(launchers.calls).prompt).toContain('begin immediately with the review.');
    expect(others(launchers.calls).every((c) => c.role === undefined)).toBe(true);
    expect(runState.readRun(runDir).seatTools).toBeUndefined(); // emit-when-non-empty
  });

  test('task default: the seat sentence names webfetch and run.json records seatTools', async () => {
    const launchers = launchersFor();
    await runCouncil(base({ intent: 'task' }), { launchers });
    expect(stage1(launchers.calls).prompt).toContain('Your tools: webfetch.');
    expect(runState.readRun(runDir).seatTools).toEqual(['webfetch']);
  });

  test('a refused id is BAD_ARGS before anything launches, naming --agent Build', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: ['task'] }), { launchers });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('--agent Build');
    expect(launchers.calls).toHaveLength(0);
  });

  test('an id the engine does not declare is BAD_ARGS after the server, before any launch', async () => {
    const launchers = launchersFor();
    const listEngineToolIdsFn = async () => ['read', 'webfetch', 'grep'];
    const { exitCode, run } = await runCouncil(base({ tools: ['grepp'], runDir: path.join(tmp, 'outside') }), { launchers, listEngineToolIdsFn });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('grepp');
    expect(launchers.calls).toHaveLength(0);
  });

  test('--tools with no way to ask the engine is refused, never launched unvalidated', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: ['webfetch'] }), { launchers, listEngineToolIdsFn: async () => null });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('could not be validated');
    expect(launchers.calls).toHaveLength(0);
  });

  test('a local tool with the run dir INSIDE the project is refused (spec §4 run-directory placement)', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: ['read'] }), { launchers, listEngineToolIdsFn: async () => ['read'] });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('OUTSIDE the project tree');
    expect(launchers.calls).toHaveLength(0);
  });

  test('a local tool with the run dir outside the project: seats are scoped to the project tree, metadata stays in the run dir', async () => {
    const project = path.join(tmp, 'tree'); fs.mkdirSync(project);
    const outside = path.join(tmp, 'run-outside'); fs.mkdirSync(outside);
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(base({ project, runDir: outside, tools: ['read'] }), { launchers, listEngineToolIdsFn: async () => ['read', 'webfetch'] });
    expect(exitCode).toBe(0);
    const s1 = stage1(launchers.calls);
    expect(s1.role).toBe('seat');
    expect(s1.directory).toBe(project);
    expect(s1.project).toBe(outside);
    expect(s1.prompt).toContain('Your tools: read. You have no others; if research is incomplete');
    expect(others(launchers.calls).every((c) => c.directory === undefined)).toBe(true);
    expect(runState.readRun(outside).seatTools).toEqual(['read']);
  });

  test('--agent Build skips the council agents and records the override', async () => {
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(base({ agent: 'Build', tools: ['task'] }), { launchers });
    expect(exitCode).toBe(0); // no refusal: the override is the escape hatch
    expect(runState.readRun(runDir).agentOverride).toBe('Build');
  });
});
```

Notes for the implementer: (a) `tmp` is under `os.tmpdir()`, which `isAllowedProjectRoot` allows, so the "outside" fixtures pass the allowed-root half of the rule; the "inside" fixture (`runDir` under `project = tmp`) trips the inside half. (b) The fake-launchers helper's exported happy-path script name must be read from the file — use the one `run-intent.test.js` uses, verbatim. (c) `runState.readRun` — use the reader `run-state.js` actually exports.

Append to `tests/council/run-intent.test.js` one case in its main describe: `test('intent task + explicit --tools read is BAD_ARGS when the run dir is inside the project — the task default does not waive the placement rule', ...)` mirroring the "inside" case above with `intent: 'task', tools: ['read']`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/council/run-tools.test.js`
Expected: FAIL — `role` undefined on every launch; no `seatTools`; the refusals return 0.

- [ ] **Step 3: `run.js` — decide before the server, validate after it**

In `src/council/run.js`, replace the launchers construction

```js
  const launchers = deps.launchers
    || createLaunchers({ remainingBudget, reserveBudget, onBudgetRefusal: noteBudgetRefusal, sharedServer: () => sharedServer });
```

with

```js
  const launchers = deps.launchers
    || createLaunchers({ remainingBudget, reserveBudget, onBudgetRefusal: noteBudgetRefusal, sharedServer: () => sharedServer,
      // Spec 2026-09-11 §4: getters — the seat policy is decided below, after these are built.
      councilAgents: () => o.councilAgents || null, agentOverride: () => o.agent });
```

Directly BEFORE the line `if (!deps.launchers) { sharedServer = await require('./run-server').acquireRunServer({ ...o, degrade }, deps); }` insert:

```js
  // ---- Spec 2026-09-11 §4 (PR 2): the seats' tool policy ---------------------
  // Decided BEFORE the run's server starts, because the two council agents are
  // part of that server's config. Shape + refusals need no engine; the engine's
  // own declared ids are checked right after the server is up (below), before
  // any leg launches — zero spend on either refusal. `o.agent` (the --agent
  // escape hatch) wins: no council agents, every leg on the engine's agent.
  const seatTools = require('./seat-tools');
  const seatIntent = o.intent === 'task' ? 'task' : undefined;
  if (o.agent !== undefined && o.agent !== 'Plan' && o.agent !== 'Build') {
    return finalize(1, { code: 'BAD_ARGS', message: `Error: agent must be Plan or Build; got '${o.agent}'` });
  }
  const seatPolicy = o.agent
    ? { ok: true, tools: [], local: false }
    : seatTools.resolveSeatTools({ intent: seatIntent, optIn: Array.isArray(o.tools) ? o.tools : [] });
  if (!seatPolicy.ok) { return finalize(1, { code: seatPolicy.code, message: `Error: ${seatPolicy.message}` }); }
  if (seatPolicy.local) {
    // Run-directory placement (spec §4): a seat that can read the project tree
    // must not be able to read this run's sibling sessions, so the run dir must
    // sit OUTSIDE the tree (and still under a root amicus is willing to write to).
    const { isPathInside, isAllowedProjectRoot } = require('../project-root-allowlist');
    if (isPathInside(o.runDir, o.project) || !isAllowedProjectRoot(o.runDir)) {
      return finalize(1, { code: 'BAD_ARGS', message: 'Error: --tools with a local tool (read, grep, glob, bash) needs --out-dir OUTSIDE the project tree '
        + '(a seat that can read the tree must not be able to read the run\'s sibling sessions) and under your home, tmp or AMICUS_PROJECT_ROOTS' });
    }
  }
  o.seatTools = seatPolicy.tools;
  o.seatToolsLocal = seatPolicy.local;
  o.councilAgents = o.agent ? null : seatTools.buildCouncilAgents({ tools: seatPolicy.tools, local: seatPolicy.local });
```

Directly AFTER the `acquireRunServer` line insert:

```js
  // §4: the opt-in ids are checked against the ENGINE's declaration before any launch.
  if (!o.agent && Array.isArray(o.tools) && o.tools.length) {
    const listIds = deps.listEngineToolIdsFn || require('./run-server').listEngineToolIds;
    const declared = await listIds(sharedServer, o.project);
    if (!declared) {
      return finalize(1, { code: 'BAD_ARGS', message: 'Error: --tools could not be validated: the run\'s engine did not list its tools '
        + '(no shared server, or the tool-ids endpoint failed); nothing was launched' });
    }
    const checked = seatTools.resolveSeatTools({ intent: seatIntent, optIn: o.tools, declaredIds: declared });
    if (!checked.ok) { return finalize(1, { code: checked.code, message: `Error: ${checked.message}` }); }
  }
```

In the stage-1 options checkpoint (`runState.checkpoint(o.runDir, { seats: o.seats, criticSeat: o.criticSeat, ...`) add, inside the same object: `...(o.seatTools && o.seatTools.length ? { seatTools: o.seatTools } : {}), ...(o.agent ? { agentOverride: o.agent } : {}),`.

Add `tools?: string[], agent?: 'Plan'|'Build'` to `runCouncil`'s option JSDoc (the `@param` list near :40).

- [ ] **Step 4: Stage-1 launch sites carry the role, the scope and the tools**

In `src/council/run-stage1-launch.js`, `common` gains, after `fallback: o.fallback, catalog: o.catalog,`:

```js
    // Spec 2026-09-11 §4: stage-1 legs are SEATS (council-seat); with a local
    // tool opted in they are scoped to the project tree while their metadata
    // stays in the run dir (`project: o.runDir` above).
    role: 'seat',
    ...(o.seatToolsLocal ? { directory: o.project } : {}),
```

and the three briefing calls pass `tools: o.seatTools`:
`briefings.stage1LensBriefing(o.intent, { lens: o.lenses[i], briefing: o.briefing, date: o.date, tools: o.seatTools })`,
`briefings.stage1SeatBriefing(o.intent, { briefing: o.briefing, date: o.date, tools: o.seatTools })`,
`briefings.stage1CriticBriefing(o.intent, { briefing: o.briefing, date: o.date, tools: o.seatTools })`.

In `src/council/run-retry.js`, `common` gains the same two lines (`role: 'seat'`, the spread-guarded `directory`), and `briefingFor(o, unit)` passes `tools: o.seatTools` into every `stage1*Briefing` call it makes (read the function; every call gets the key).

- [ ] **Step 5: Run to verify they pass, plus the council driver suites**

Run: `npx jest tests/council/run-tools.test.js tests/council/run-intent.test.js tests/council/run-stage1-launch.test.js tests/council/run-retry.test.js tests/council/run-stages.test.js tests/council/degrade-channels.test.js tests/council/run-state.test.js`
Expected: all green. If a driver suite pins the exact stage-1 `common` shape (a `toEqual` on launch opts), extend the pin with `role: 'seat'` and say so in the report — nothing else.

- [ ] **Step 6: Commit**

```bash
git add src/council/run.js src/council/run-stage1-launch.js src/council/run-retry.js tests/council/run-tools.test.js tests/council/run-intent.test.js tests/council/
git commit -m "feat(council): runCouncil decides the seat tools, validates them against the engine, launches by role

Spec 2026-09-11 §4. Refusals and shape are BAD_ARGS before the server starts;
unknown ids are BAD_ARGS against tool.ids() after it starts and before any
launch; a local tool requires the run dir outside the project tree and under
an allowed root; stage-1 seats and retries launch as role 'seat' with the
tools line in their briefing, scoped to the project tree when a local tool is
in. --agent Plan|Build skips the council agents. run.json records seatTools
(emit-when-non-empty) and agentOverride (emit-when-set).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The CLI door — `--tools` and `--agent` on `council run` (three surfaces)

**Files:**
- Modify: `src/cli.js` (the `council run` usage block, ~:583-621), `src/cli-handlers-council-run.js` (validation near the `--intent` check at ~:197; the `runCouncil({...})` call at ~:240)
- Test: `tests/utils/known-flags.test.js`, `tests/cli-council-run-flags.test.js`

**Interfaces:**
- Consumes: `parseToolsFlag` (Task 1); `runCouncil` options `tools`, `agent` (Task 4).
- Produces: `--tools <a,b,c>` and `--agent <Plan|Build>` accepted (usage-derived, `getKnownFlags`), validated (BAD_ARGS envelopes), forwarded (`tools: string[]`, `agent: 'Plan'|'Build'`, both emit-when-set).

- [ ] **Step 1: Write the failing tests**

Append to `tests/utils/known-flags.test.js` (inside its describe):

```js
  it("'tools' and 'agent' are known flags on council run (spec 2026-09-11 §4)", () => {
    const known = getKnownFlags();
    expect(known.has('tools')).toBe(true);
    expect(known.has('agent')).toBe(true);
  });
```

Append to `tests/cli-council-run-flags.test.js` a describe (reuse its `argsBase` helper and its `runCouncil` mock exactly as the file's other forwarding tests do):

```js
describe('council run --tools / --agent (spec 2026-09-11 §4): accepted, validated, forwarded', () => {
  test('--tools parses as a value flag and reaches runCouncil as a de-duplicated id array', async () => {
    const args = parseArgs(['council', 'run', '--tools', 'read, Grep,read', '--models', 'a,b']);
    expect(args.tools).toBe('read, Grep,read');
    const code = await handleCouncilRun(argsBase({ tools: 'read, Grep,read' }));
    expect(code).toBe(0);
    expect(runCouncil.mock.calls[0][0].tools).toEqual(['read', 'grep']);
  });
  test('an empty or malformed --tools is BAD_ARGS before runCouncil', async () => {
    for (const bad of ['', ' , ', 'read,../x']) {
      runCouncil.mockClear();
      const code = await handleCouncilRun(argsBase({ tools: bad }));
      expect(code).toBe(1);
      expect(runCouncil).not.toHaveBeenCalled();
    }
  });
  test('--agent accepts Plan/Build case-insensitively, forwards normalized, and refuses anything else', async () => {
    let code = await handleCouncilRun(argsBase({ agent: 'build' }));
    expect(code).toBe(0);
    expect(runCouncil.mock.calls[0][0].agent).toBe('Build');
    runCouncil.mockClear();
    code = await handleCouncilRun(argsBase({ agent: 'Chat' }));
    expect(code).toBe(1);
    expect(runCouncil).not.toHaveBeenCalled();
  });
  test('neither key is present on the options when the flags are absent (emit-when-set)', async () => {
    await handleCouncilRun(argsBase({}));
    const opts = runCouncil.mock.calls[0][0];
    expect('tools' in opts).toBe(false);
    expect('agent' in opts).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/utils/known-flags.test.js tests/cli-council-run-flags.test.js`
Expected: the new cases FAIL (`tools`/`agent` not known; nothing forwarded).

- [ ] **Step 3: Usage text (the accepted surface)**

In `src/cli.js`, the `council run` synopsis line `[--pack <name|path>] [--tag <t>] [--intent review|task]` becomes
`[--pack <name|path>] [--tag <t>] [--intent review|task]` followed by a new line
`      [--tools <a,b,c>] [--agent Plan|Build]`
and, after the paragraph ending `review is the default and is never stored.`, add:

```
                                --tools <a,b,c> opts stage-1 seats into tools by the
                                engine's own ids (task mode defaults to webfetch,
                                review to none); task and skill are refused, as
                                are edit/write/apply_patch/question. A local tool
                                (read, grep, glob, bash) needs --out-dir OUTSIDE
                                the project tree. --agent Plan|Build runs every
                                leg on the engine's own agent instead (the
                                escape hatch; no council agents, no allowlist).
```

- [ ] **Step 4: Handler (validated + forwarded)**

In `src/cli-handlers-council-run.js`, directly after the `--intent` validation block (the `if (args.intent !== undefined && ...)` that returns `failJson(... 'Error: --intent must be review or task' ...)`), add:

```js
  // Spec 2026-09-11 §4: --tools (shape here; refusals + the engine check live in
  // runCouncil so MCP, the workflow and direct callers share them) and --agent.
  let toolIds;
  if (explicitKeys.has('tools') || args.tools !== undefined) {
    const parsed = require('./council/seat-tools').parseToolsFlag(args.tools);
    if (!parsed.ok) { return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: ${parsed.message}` }); }
    toolIds = parsed.ids;
  }
  let agentOverride;
  if (explicitKeys.has('agent') || args.agent !== undefined) {
    const a = typeof args.agent === 'string' ? args.agent.toLowerCase() : '';
    if (a !== 'plan' && a !== 'build') {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --agent must be Plan or Build; got '${args.agent}'`,
        hint: 'Chat is not supported headless; omit --agent to run seats on the council agents' });
    }
    agentOverride = a === 'plan' ? 'Plan' : 'Build';
  }
```

and in the `runCouncil({ ... })` call, after the `...(args.intent === 'task' ? { intent: 'task' } : {}),` line: `...(toolIds ? { tools: toolIds } : {}), ...(agentOverride ? { agent: agentOverride } : {}),`.

- [ ] **Step 5: Run to verify they pass, plus the CLI suites**

Run: `npx jest tests/utils/known-flags.test.js tests/cli-council-run-flags.test.js tests/cli-council-run.test.js tests/cli-template-args.test.js tests/cli.test.js`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/cli.js src/cli-handlers-council-run.js tests/utils/known-flags.test.js tests/cli-council-run-flags.test.js
git commit -m "feat(cli): council run --tools <a,b,c> and --agent Plan|Build

Spec 2026-09-11 §4. Three surfaces: accepted (usage text, getKnownFlags),
validated (shape and Plan|Build here; refusals and the engine check in
runCouncil so every door shares them), forwarded emit-when-set.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The MCP door — `tools` and `agent` on `amicus_council_run`

**Files:**
- Modify: `src/mcp-tools.js` (the `amicus_council_run` input schema, ~:556-636), `src/mcp-council-run.js` (input validation near the `timeoutMinutes`/`maxCost` checks at ~:126-134; the argv assembly near `if (input.intent === 'task') { args.push('--intent', 'task'); }` at ~:209)
- Test: `tests/mcp-council-run.test.js`, `tests/mcp-council-run-inputs.test.js`

**Interfaces:**
- Consumes: `parseToolsFlag`, `REMOTE_TOOL_IDS` (Task 1).
- Produces: MCP `tools: string[]` and `agent: 'Plan'|'Build'` → child argv `--tools a,b` / `--agent X` (emit-when-set); local tools over MCP refused with a message naming the CLI.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp-council-run.test.js` (reuse its `helpers`, `input`, `parseFenced`):

```js
describe('amicus_council_run tools / agent (spec 2026-09-11 §4)', () => {
  test('forwards remote tools as --tools and agent as --agent on the child argv', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['webfetch', 'websearch'], agent: 'Plan' }), helpers(spawnCalls), tmp);
    expect(res.isError).toBeFalsy();
    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--tools') + 1]).toBe('webfetch,websearch');
    expect(args[args.indexOf('--agent') + 1]).toBe('Plan');
  });
  test('a local tool over MCP is refused before anything spawns — the MCP run dir must stay inside the project', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['read'] }), helpers(spawnCalls), tmp);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('amicus council run --tools');
    expect(spawnCalls).toHaveLength(0);
  });
  test('a malformed tools entry is refused before anything spawns', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['../x'] }), helpers(spawnCalls), tmp);
    expect(res.isError).toBe(true);
    expect(spawnCalls).toHaveLength(0);
  });
  test('absent tools/agent leave the argv byte-identical (no --tools, no --agent)', async () => {
    const spawnCalls = [];
    await handleCouncilRunTool(input(), helpers(spawnCalls), tmp);
    expect(spawnCalls[0].args).not.toContain('--tools');
    expect(spawnCalls[0].args).not.toContain('--agent');
  });
});
```

(Match `handleCouncilRunTool`'s real parameter order to the file's existing calls — read one existing test in the file and copy its call shape.)

Append to `tests/mcp-council-run-inputs.test.js` a schema case: the `amicus_council_run` tool's zod schema accepts `tools: ['webfetch']` and `agent: 'Build'`, rejects `agent: 'Chat'` and `tools: 'read'` (a string) — using the same `getTools()` schema lookup the file already uses.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/mcp-council-run.test.js tests/mcp-council-run-inputs.test.js`
Expected: the new cases FAIL.

- [ ] **Step 3: Schema**

In `src/mcp-tools.js`, inside the `amicus_council_run` input schema, after the `intent` field add:

```js
      tools: z.array(z.string().min(1)).max(12).optional().describe(
        'Tool ids stage-1 seats may use, by the engine\'s own ids (task mode defaults to webfetch, review to none). ' +
        'Over MCP only remote tools (webfetch, websearch) can be opted in: the MCP run directory stays inside the project, ' +
        'and a seat with local tools must not run there — use the CLI with --out-dir outside the project for read/grep/glob/bash. ' +
        'task and skill are always refused.'
      ),
      agent: z.enum(['Plan', 'Build']).optional().describe(
        'Escape hatch: run every leg on the engine\'s own agent instead of the council agents (no tool allowlist).'
      ),
```

- [ ] **Step 4: Handler — refuse local tools over MCP, forward the rest**

In `src/mcp-council-run.js`, after the `maxCost` validation block add:

```js
  // Spec 2026-09-11 §4: over MCP the run dir must stay inside the project (the
  // fence below), so a seat with a LOCAL tool cannot be placed safely here —
  // refused with the CLI named. Remote tools ride to the child as --tools.
  let toolsArg;
  if (input.tools !== undefined) {
    const { parseToolsFlag, REMOTE_TOOL_IDS } = require('./council/seat-tools');
    const parsed = parseToolsFlag(Array.isArray(input.tools) ? input.tools.join(',') : String(input.tools));
    if (!parsed.ok) { return textResult(`${parsed.message}`, true); }
    const local = parsed.ids.filter((id) => !REMOTE_TOOL_IDS.includes(id));
    if (local.length) {
      return textResult(`tools: ${local.join(', ')} are local tools; over MCP the run directory must stay inside the project, ` +
        'and a seat with local tools must not run there. Use `amicus council run --tools ' + parsed.ids.join(',') +
        ' --out-dir <dir outside the project>` from the CLI.', true);
    }
    toolsArg = parsed.ids.join(',');
  }
```

and after `if (input.intent === 'task') { args.push('--intent', 'task'); }` add:

```js
  if (toolsArg) { args.push('--tools', toolsArg); }
  if (input.agent) { args.push('--agent', input.agent); }
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest tests/mcp-council-run.test.js tests/mcp-council-run-inputs.test.js tests/mcp-tools.test.js`
Expected: all green (if `tests/mcp-tools.test.js` does not exist, drop it from the command).

- [ ] **Step 6: Commit**

```bash
git add src/mcp-tools.js src/mcp-council-run.js tests/mcp-council-run.test.js tests/mcp-council-run-inputs.test.js
git commit -m "feat(mcp): amicus_council_run tools (remote only) and agent, forwarded to the child argv

Spec 2026-09-11 §4. The MCP run dir must stay inside the project, so a seat
with a local tool cannot be placed there: refused with the CLI named. Remote
tools (webfetch, websearch) and the Plan|Build override ride to the child as
--tools / --agent, emit-when-set.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The keyless engine probe — pin what the pinned engine does with the agents

**Files:**
- Create: `tests/council-agents-engine.integration.test.js`

**Interfaces:**
- Consumes: `buildCouncilAgents` (Task 1); `startServer` + `ensureNodeModulesBinInPath` + the `_createOpencodeServer` seam (`src/opencode-client.js`; the seam wraps the SDK factory so the test injects agents without a keyless-runner change); `client.app.agents()`, `client.tool.ids()`.
- Produces: the record CI re-checks on every push (the keyless job runs every `tests/*.integration.test.js`).

- [ ] **Step 1: Write the test**

```js
// tests/council-agents-engine.integration.test.js
'use strict';

/**
 * Spec 2026-09-11 §4 — the ENGINE side of the council agents. Everything in
 * council/seat-tools.js is pure; nothing automated would otherwise prove the
 * pinned engine (opencode-ai 1.18.15) still (1) lists its tool ids on
 * /experimental/tool/ids, (2) accepts an agent config whose `tools` map uses the
 * '*' wildcard, (3) renders that map and the permission block as the rule list
 * amicus relies on, and (4) tolerates an UNKNOWN tool id at start (so amicus,
 * not the engine, has to refuse it). One engine start, no prompt, zero spend.
 * Measured 2026-09-12 as the values pinned below. Runtime shape: `permission`
 * is a rule list [{permission, pattern, action}] — the SDK d.ts still declares
 * an object; assert on the runtime.
 */

const { buildCouncilAgents } = require('../src/council/seat-tools');
const oc = require('../src/opencode-client');
require('../src/utils/path-setup').ensureNodeModulesBinInPath();

const starRule = (agent, permission) => (Array.isArray(agent.permission) ? agent.permission : [])
  .filter((r) => r.permission === permission && r.pattern === '*').map((r) => r.action);
const last = (arr) => arr[arr.length - 1];

async function withAgents(agents, fn) {
  const sdk = await import('@opencode-ai/sdk');
  const factory = async (serverOptions) => {
    serverOptions.config = serverOptions.config || {};
    serverOptions.config.agent = { ...(serverOptions.config.agent || {}), ...agents };
    return sdk.createOpencodeServer(serverOptions);
  };
  const { client, server } = await oc.startServer({ _createOpencodeServer: factory, port: 0 });
  try {
    let list = null;
    for (let i = 0; i < 60 && !list; i++) {
      try { const r = await client.app.agents({ query: { directory: process.cwd() } }); if (r && Array.isArray(r.data)) { list = r.data; } }
      catch { /* not up yet */ }
      if (!list) { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!list) { throw new Error('the engine never answered GET /agent'); }
    return await fn({ client, agents: list });
  } finally { await server.close(); }
}

test('the pinned engine registers council-seat/council-support as amicus expects, and tolerates an unknown id', async () => {
  const agents = {
    ...buildCouncilAgents({ tools: ['grep', 'read', 'webfetch'], local: true }),
    'council-probe-unknown': { mode: 'primary', tools: { '*': false, bogus_tool: true } },
  };
  await withAgents(agents, async ({ client, agents: list }) => {
    const byName = Object.fromEntries(list.map((a) => [a.name, a]));
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

    // (4): an unknown id is ACCEPTED by the engine — which is exactly why
    // runCouncil validates --tools against tool.ids() itself.
    expect(last(starRule(byName['council-probe-unknown'], 'bogus_tool'))).toBe('allow');

    const ids = await client.tool.ids({ query: { directory: process.cwd() } });
    expect(ids.data).toEqual(expect.arrayContaining(['read', 'glob', 'grep', 'bash', 'webfetch', 'websearch', 'task', 'skill', 'edit', 'write']));
  });
}, 120000);
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/council-agents-engine.integration.test.js`
Expected: PASS in 10–30 s (one engine start). If an assertion fails, STOP: the engine's rendering differs from the 2026-09-12 measurement — report the actual rule list; the plan's `buildCouncilAgents` shape is then the thing to revisit, not the assertion.

- [ ] **Step 3: Run the keyless tier the way CI does**

Run: `npm run test:integration`
Expected: green; the new suite appears in the passed list.

- [ ] **Step 4: Commit**

```bash
git add tests/council-agents-engine.integration.test.js
git commit -m "test(integration): keyless probe — the pinned engine renders the council agents as amicus expects

One engine start, no prompt: /experimental/tool/ids lists the ids, '*' in a
tools map renders *=deny with the allowlist's =allow after it, the permission
block lands as the last rules, and an unknown id is accepted at start — so
amicus, not the engine, refuses it (runCouncil validates against tool.ids()).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Docs, CHANGELOG, SEAT-BRIEFS, spec status

**Files:**
- Modify: `docs/council.md` (the `amicus council run` synopsis at ~:102-117; a new `### Tool access per usage (\`--tools\`)` subsection directly after `### Task mode (\`--intent task\`)`'s body and before `### Debate mode`; the table of contents at ~:20-38), `docs/usage.md` (the flag table row after `--intent` at ~:206), `skills/second-opinion/SEAT-BRIEFS.md` (one paragraph after the v4.9 note), `CHANGELOG.md` (`[Unreleased]`), `docs/superpowers/specs/2026-09-11-council-leg-completion-design.md` (§4 status line)

- [ ] **Step 1: `docs/council.md`**

Synopsis: after the `[--intent review|task]` line add
`    [--tools <a,b,c>] [--agent Plan|Build]                    # v4.9.8, see Tool access below`.

New subsection (verbatim):

```markdown
### Tool access per usage (`--tools`)

Tool access is a property of the **run**, set by the caller according to whether the seats
must go and get their material — not a property of the mode (spec 2026-09-11 §2). Every
council leg runs as one of two agents the run's own OpenCode server registers:

- **`council-seat`** — stage-1 seats (the bench wave, the critic, the lenses) and their retries.
  Its tools are the intent's default ∪ `--tools`: **task mode** defaults to `webfetch` (the
  co-worker can research); **review mode** defaults to none (the artifact under review arrives
  in the briefing — `--artifact`, `--pack`, or pasted). `--tools read,grep,glob,bash` opts local
  tools in, even for task mode — opt-in is deliberate.
- **`council-support`** — repair re-prompts, the Stage-2 judges, debate legs and the chair.
  No tools, ever: their briefings already say so, and the agent now enforces it.

`task` and `skill` are refused (`task` spawns child sessions amicus cannot observe; `skill` is
where a seat starts reading the harness instead of the brief), as are `edit`, `write`,
`apply_patch` (a seat never modifies the tree), `question` (a headless leg has no human) and
`invalid`. Every other id is validated against the engine's own declared list before any leg
launches; an unknown id is `BAD_ARGS` naming what the engine declares. `--agent Plan|Build`
is the escape hatch: every leg runs on the engine's own agent, no council agents, no
allowlist.

**Run-directory placement with a local tool.** A seat that can read the project tree must
not be able to read this run's sibling sessions, so with any local tool opted in the run dir
must sit **outside** the project tree (`--out-dir`), under your home, tmp or
`AMICUS_PROJECT_ROOTS`; the seats are then scoped to the project tree (`external_directory:
deny`) while their metadata stays in the run dir. Over MCP the run dir stays inside the
project, so local tools are refused there with the CLI named; `webfetch`/`websearch` over MCP
are fine.

**What the seat is told.** With no tools it gets the same no-tools sentence as the chair
(`Do NOT use any tools or read any files; …`), with tools one line naming exactly them. The
config enforces; the sentence informs — study run E1 showed gemini makes zero tool calls when
told not to.

**Known edge.** The engine's own defaults ask before reading `*.env` files; a seat with `read`
that opens one hits an `ask` the headless leg cannot answer and ends by the tool-stall
detector. Keep secrets out of the tree a seat is pointed at.
```

Add the subsection to the table of contents beside the Task mode entry.

- [ ] **Step 2: `docs/usage.md`**

After the `--intent` row add:

```markdown
| `--tools <a,b,c>` | Tool ids stage-1 seats may use, by the engine's own ids (v4.9.8). Task mode defaults to `webfetch`, review to none; `task`/`skill`/`edit`/`write`/`apply_patch`/`question`/`invalid` are refused; anything else is validated against the engine before launch. A local tool (`read`, `grep`, `glob`, `bash`) needs `--out-dir` outside the project tree. Over MCP: the `tools` param (remote tools only). See [docs/council.md § Tool access](./council.md#tool-access-per-usage---tools). |
| `--agent <Plan\|Build>` | Escape hatch: run every leg on the engine's own agent instead of the council agents (no allowlist). Over MCP: the `agent` param. |
```

- [ ] **Step 3: `skills/second-opinion/SEAT-BRIEFS.md`**

After the `**v4.9 — everything below is REVIEW wording.**` paragraph add:

```markdown
**v4.9.8 — tools are per run.** The engine registers two agents per council run (`council-seat`
for stage-1 legs, `council-support` for everything else) and composes the seat's tools sentence
itself: no tools → the shared no-tools sentence; tools → *"Your tools: webfetch. You have no
others — …"* (`src/council/seat-tools.js :: seatToolsSentence`). The manual path copies that
line into each seat's `_tmp-*` briefing; see `docs/council.md § Tool access`.
```

- [ ] **Step 4: CHANGELOG**

Under `## [Unreleased]`, before `### Fixed`, add:

```markdown
### Changed

- **Council legs run as two per-run agents with an explicit tool allowlist.** Stage-1 seats and
  their retries run as `council-seat` — task mode defaults to `webfetch`, review mode to no tools,
  and `--tools <a,b,c>` (MCP: `tools`) opts more in, validated against the engine's own declared
  ids before any leg launches; repair, judge, debate and chair legs run as `council-support` with
  no tools at all. `task` and `skill` are refused (they spawn or escape the session), as are
  `edit`/`write`/`apply_patch`/`question`/`invalid`; `--agent Plan|Build` is the escape hatch. A
  local tool needs `--out-dir` outside the project tree and scopes the seats to the tree with
  `external_directory: deny`. Two of the three leg-loss classes in the 2026-09-11 study shared one
  precondition — a seat reached for a tool it did not need (gemini `grep`/`glob` over the global
  install, cohere `task {}`) — and this closes that door. Previously every leg ran as the engine's
  `Plan` agent with every tool available. (`docs/council.md` § Tool access; spec §4; PR 2 of 3.)
```

- [ ] **Step 5: Spec §4 status**

In `docs/superpowers/specs/2026-09-11-council-leg-completion-design.md`, at the end of §4's **Where.** paragraph append: ` **Implemented (PR 2, 2026-09-12):** measured tool ids on the pinned engine are `invalid, question, bash, read, glob, grep, edit, write, task, webfetch, todowrite, websearch, skill, apply_patch`; refused for seats: `task`, `skill`, and also `edit`, `write`, `apply_patch`, `question`, `invalid`; remote: `webfetch`, `websearch`. `GET /agent` renders `permission` as a rule list and an unknown tool id is accepted at start, so amicus validates against `tool.ids()`. The out-dir rule is applied on the CLI as "outside the project tree and under an allowed root"; over MCP (run dir inside the project) local tools are refused.`

- [ ] **Step 6: Commit**

```bash
git add docs/council.md docs/usage.md skills/second-opinion/SEAT-BRIEFS.md CHANGELOG.md
git add -f docs/superpowers/specs/2026-09-11-council-leg-completion-design.md
git commit -m "docs: tool access per usage — council.md section, usage rows, SEAT-BRIEFS note, changelog, spec §4 status (PR 2 of 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(The pre-commit hook regenerates `docs/architecture-map.md` markers; if it leaves that file modified, `git add docs/architecture-map.md && git commit --amend --no-edit`.)

---

### Task 9: Full gates and the PR

**Files:** none modified.

- [ ] **Step 1: The unit gate**

Run: `cd C:\Users\sendt\code\amicus && npm test`
Expected: all suites green (9,862 at `1bdffbd4` plus this PR's additions). `npm test` — not `npx jest` — is what writes `.test-passed` for the current HEAD. (Known race: `tests/council/run-stats-entry.test.js` was fixed in PR 1; if a different `src/` walker dies on `src/__sizecheck_tmp__.js`, re-run once and name the file.)

- [ ] **Step 2: The keyless integration tier**

Run: `npm run test:integration`
Expected: green, `tests/council-agents-engine.integration.test.js` in the passed list.

- [ ] **Step 3: Confirm with the owner, then push and open the PR with the council-review label**

Do not run this step without the owner's go-ahead in chat (a push to a labelled PR spends).

```bash
git push -u origin feat/council-seat-tools
gh pr create -R BourbonDog/amicus --base main --head feat/council-seat-tools \
  --label council-review \
  --title "feat(council): seats run as per-run agents with a tool allowlist — --tools, council-seat/council-support (leg completion PR 2/3)" \
  --body-file <the PR body the controller writes from this plan's Architecture, the measured facts, and the test list>
```

- [ ] **Step 4: Watch the council run to completion, then read the verdict — not the check**

Read `verdict.json` from the run's `council-run` artifact: `overallVerdict` and `seatsReviewed`. A degraded run is not a review. Merge only on a completed run with the owner's say-so.

---

## Self-review

**Spec coverage (§4):** two agents per council server → Task 1 (configs) + Task 2 (registration on the shared server AND fanout's fallback server); `mode: 'primary'` on both → Task 1; `permission { webfetch: 'allow', edit: 'deny', bash: allow-only-when-opted }` → Task 1 (`webfetch` allow only when in the list — the spec's "webfetch: 'allow'" is unconditional, but a review seat with no `webfetch` in its tools map has the tool off anyway; the permission follows the map so the two never disagree — deliberate, stated); `external_directory: 'deny'` iff a local tool → Task 1; the opt-in lever `--tools` on the CLI + `tools` over MCP → Tasks 5, 6; validated against the engine's declared ids, `task`/`skill` refused with the `agent` override named → Tasks 1, 4; the existing MCP `agent` option "stays as that override" → measured: `amicus_council_run` had no `agent` option (the `Plan|Build` enum at `mcp-tools.js:347` belongs to `amicus_fanout`), so Task 6 adds one and Task 5 its CLI twin; tool ids never hand-listed → the accepted set is `tool.ids()`; only the refusals and the two remote ids are named (Global Constraints); run-directory placement → Task 4 (CLI: outside the tree + allowed root; MCP: local refused); `run-launch.js` role → agent → Tasks 2, 4; `intent` and opt-in plumbed from `run.js` → Task 4; briefing lines computed from the effective allowlist → Task 3; SEAT-BRIEFS.md and council.md → Task 8; error handling: a disabled tool call gets the engine's tool-unavailable result (the probe in Task 7 pins the rule rendering; a live leg is the §7 release ritual); "if the engine stops declaring `tools` on agent config, registration is skipped and a Notice names it" → measured: the config is accepted, and the probe fails loudly on a rendering change — a Notice path for a rejected config rides the existing `sharedServerUnavailable` degrade (Task 2 leaves it intact); unknown id in `--tools` is `BAD_ARGS` before launch, listing the engine's declared ids → Tasks 1, 4. Tests named in §4 → run-launch (Task 2), opencode-client (Task 2), run-intent (Task 4), keyless integration (Task 7).

**Placeholder scan:** none. Every code step carries its code; the two "read the file's helper name" notes (fake-launchers' happy script, run-state's reader) name the exact lookup.

**Type/name consistency:** `resolveSeatTools({ intent, optIn, declaredIds })` (Tasks 1, 4); `buildCouncilAgents({ tools, local })` (Tasks 1, 2 tests, 4, 7); `seatToolsSentence(tools, kind)` (Tasks 1, 3); `councilAgents` / `agentOverride` getters (Tasks 2, 4); `role: 'seat'`, `directory` (Tasks 2, 4); `listEngineToolIds(shared, directory)` + `deps.listEngineToolIdsFn` (Tasks 2, 4); `options.agents` → `serverOptions.agents` → `config.agent` (Task 2); `serverAgents` on the fanout options (Task 2); `o.tools`, `o.agent`, `o.seatTools`, `o.seatToolsLocal`, `o.councilAgents` (Tasks 4, 5, 6); `parseToolsFlag` (Tasks 1, 5, 6); `REMOTE_TOOL_IDS` (Tasks 1, 6).
