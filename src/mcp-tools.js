/**
 * MCP Tool Definitions for Amicus
 *
 * Defines all tools exposed by the Amicus MCP server.
 * Uses Zod schemas for input validation (converted to JSON Schema by MCP SDK).
 *
 * @module mcp-tools
 */

const { z } = require('zod');
const { formatAliasNames } = require('./utils/config');
const { READ_CAP_BYTES } = require('./utils/read-slice');
const { GATEWAY_MODES } = require('./utils/model-descriptor');
const { GROUP_DIMS, ROWS_CAP } = require('./spend-query');

/** Zod pattern for safe task IDs (alphanumeric, hyphens, underscores only) */
const safeTaskId = z.string().regex(
  /^[a-zA-Z0-9_-]{1,64}$/,
  'Task ID must be 1-64 alphanumeric, hyphen, or underscore characters'
);

/** Zod pattern for safe model identifiers (must not start with -) */
const safeModel = z.string().regex(
  /^[a-zA-Z0-9_/.@:][a-zA-Z0-9_/.@:-]{0,199}$/,
  'Model must be 1-200 chars, start with alphanumeric, and contain only provider/model characters'
);

/**
 * Build all MCP tools with dynamic descriptions that include live alias names.
 * @returns {Array<{name: string, description: string, inputSchema: object}>}
 */
function getTools() {
  const aliasNames = formatAliasNames();
  return [
  {
    name: 'amicus_start',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Spawn an Amicus session with a different LLM. Returns a task ID immediately. ' +
      'Mode selection: use INTERACTIVE (default, noUi: false) for research, ' +
      'exploration, analysis, and any task where the user benefits from watching ' +
      'progress live. It eliminates the polling problem entirely. ' +
      'Use HEADLESS (noUi: true) only for background automation the user does NOT ' +
      'need to monitor. When in doubt, use interactive. ' +
      'EXCEPTION: When spawning multiple sessions simultaneously, ' +
      'ALWAYS use HEADLESS (noUi: true) for all of them unless the user ' +
      'explicitly requests interactive. Opening multiple Electron windows ' +
      'at once is disruptive. ' +
      'For headless mode, prefer calling amicus_wait with the task ID — one ' +
      'blocking call replaces the sleep+status loop; re-call it while it returns ' +
      'timedOut: true. Fallback (no amicus_wait tool available): ALWAYS run ' +
      '`sleep 25` in your shell before each amicus_status call to enforce the ' +
      'polling interval. ' +
      'For interactive mode, do not poll. Wait for the user to tell you ' +
      'they\'ve clicked Fold, then use amicus_read. ' +
      'Call amicus_guide first if you need help choosing a model or writing a good briefing.' +
      ' Pass includeContext: false when the briefing is fully self-contained.',
    inputSchema: {
      model: safeModel.optional().describe(
        `Short alias (${aliasNames}) or full model ID ` +
        '(bare provider/model is canonical and routes direct-first, e.g. anthropic/claude-opus-4-8; ' +
        'openrouter/provider/model forces OpenRouter). ' +
        'If omitted, uses the configured default. Call amicus_guide to see all aliases.'
      ),
      gateway: z.enum(GATEWAY_MODES).optional().describe(
        'Routing preference: auto (direct-first, default), direct (require a ' +
        'direct provider key), or openrouter (force OpenRouter).'
      ),
      prompt: z.string().describe(
        'Detailed task briefing. Include: objective, background, ' +
        'files of interest, success criteria.'
      ),
      agent: z.enum(['Chat', 'Plan', 'Build']).optional()
        .describe(
          'Agent mode. Chat (interactive default; headless runs auto-convert ' +
          'to Build): reads auto, writes ask permission. Plan: read-only ' +
          'analysis. Build: full auto (all operations approved).'
        ),
      noUi: z.boolean().optional().describe(
        'Run headless without GUI. Default false (opens Electron window).'
      ),
      thinking: z.enum([
        'none', 'minimal', 'low', 'medium', 'high', 'xhigh'
      ]).optional().describe(
        'Reasoning effort level. Default: medium.'
      ),
      timeout: z.number().optional().describe(
        'Headless timeout in minutes. Default: 15. Only applies when noUi is true.'
      ),
      contextTurns: z.number().optional().describe(
        'Max conversation turns to include from your Claude session. Default: 50.'
      ),
      contextSince: z.string().optional().describe(
        'Time filter for context — include only turns from the last N minutes/hours/days. ' +
        'Format: 30m, 2h, 1d. Overrides contextTurns when set.'
      ),
      contextMaxTokens: z.number().optional().describe(
        'Cap on context size in tokens. Default: 80000.'
      ),
      summaryLength: z.enum(['brief', 'normal', 'verbose']).optional().describe(
        'Fold summary verbosity. brief: key findings only. normal (default): full ' +
        'structured output. verbose: maximum detail.'
      ),
      includeContext: z.boolean().optional().describe(
        'Whether to include parent conversation history as context. '
        + 'Default: true. Set to false when the briefing is self-contained '
        + 'and does not depend on prior conversation. See amicus_guide for guidance.'
      ),
      coworkProcess: z.string().optional().describe(
        'Cowork VM process name (e.g., "modest-laughing-goodall"). ' +
        'Extract from CWD: /sessions/<name>/. Required for parent context loading.'
      ),
      parentSession: z.string().optional().describe(
        'Claude Code session UUID for exact context matching. ' +
        'Prevents ambiguity when multiple sessions are active in the same project.'
      ),
      windowPosition: z.enum(['right', 'left', 'center']).optional()
        .default('right').describe(
          'Where to place the Amicus window on screen. ' +
          'right (default): flush against the right edge. ' +
          'left: flush against the left edge. center: centered.'
        ),
      pack: z.string().optional().describe('Policy pack name or path — bench/chair/options/template defaults for this run; explicit params override pack values (recorded either way).'),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_status',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Check the status of a running Amicus session. Returns status ' +
      '(running/complete), elapsed time, and progress info. Primarily ' +
      'for headless mode \u2014 in interactive mode, wait for the user to ' +
      'tell you the session is done instead of polling.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID returned by amicus_start.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_wait',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Wait (block inside one tool call) until an Amicus session or fan-out wave ' +
      'reaches a terminal state, or until timeoutMs elapses. Returns the same JSON ' +
      'shape as amicus_status plus {timedOut, waitedMs} (and {hint} on timeout), with ' +
      'next_poll stripped/replaced. PREFER this over sleep+amicus_status polling for ' +
      'headless runs: one call replaces many polls. If it returns timedOut: true the ' +
      'run is still going — simply call amicus_wait again. Works for any session or ' +
      'wave, including ones started by other processes.',
    inputSchema: {
      taskId: safeTaskId.optional().describe('The session task ID (or wave ID) to wait on.'),
      waveId: safeTaskId.optional().describe('Alias for taskId when waiting on a fan-out wave.'),
      timeoutMs: z.number().int().min(1000).max(110000).optional().describe(
        'Max wait in milliseconds. Default 50000; capped at 110000 so the call ' +
        'returns before typical MCP client kill windows. On expiry the tool ' +
        'returns {timedOut: true} instead of erroring.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Read the results of a completed Amicus session. Returns the summary ' +
      'by default, or full conversation history, or session metadata. ' +
      'Every mode is capped at ~50KB by default; when content exceeds the ' +
      'cap and no offset/limit/tail is given, the response is the TAIL of ' +
      'the content with a "[truncated: ...]" notice as the first line — use ' +
      'offset/limit or tail to page through the rest.',
    inputSchema: {
      taskId: safeTaskId.describe('The task ID to read.'),
      mode: z.enum(['summary', 'conversation', 'metadata']).optional()
        .default('summary').describe(
          'What to read. summary (default): the fold summary. ' +
          'conversation: full message history. metadata: session info ' +
          '(always small; offset/limit/tail are ignored in this mode).'
        ),
      offset: z.number().int().min(0).optional().describe(
        'Byte offset to start reading from (0-based). When given, no cap or ' +
        'truncation notice applies — the result is simply bounded by `limit` ' +
        `(default ${READ_CAP_BYTES} bytes). Takes precedence over \`tail\` if ` +
        'both are given. Ignored in mode "metadata".'
      ),
      limit: z.number().int().min(1).max(READ_CAP_BYTES).optional().describe(
        `Max bytes to return, 1-${READ_CAP_BYTES}. Defaults to the ${READ_CAP_BYTES}-byte ` +
        'cap. Ignored in mode "metadata".'
      ),
      tail: z.boolean().optional().describe(
        'Return the last `limit` bytes instead of the start. Ignored if ' +
        '`offset` is also given, and ignored in mode "metadata". This is ' +
        'also the implicit default when content exceeds the cap and neither ' +
        '`offset` nor `tail` is set.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_list',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'List all Amicus sessions for the current project. Shows task ID, ' +
      'model, status, age, and briefing excerpt.',
    inputSchema: {
      status: z.enum(['all', 'running', 'complete']).optional().describe(
        'Filter by status. Default: show all.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_resume',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Reopen a previous Amicus session with full conversation history ' +
      'preserved. The session continues in the same OpenCode session. ' +
      'Returns a task ID immediately — use amicus_wait to block until done ' +
      '(or poll amicus_status).',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID of the session to resume.'
      ),
      noUi: z.boolean().optional().default(false).describe(
        'Resume in headless mode. Default false (opens Electron window).'
      ),
      timeout: z.number().optional().describe(
        'Headless timeout in minutes. Default: 15. Only applies when noUi is true.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_continue',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Start a new Amicus session that inherits a previous session\'s ' +
      'conversation as context. The previous session\'s messages become ' +
      'read-only background for the new task. Returns a task ID ' +
      'immediately — use amicus_wait to block until done (or poll amicus_status).',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID of the previous session to continue from.'
      ),
      prompt: z.string().describe(
        'New task description for the continuation.'
      ),
      model: safeModel.optional().describe(
        `Override model — short alias (${aliasNames}) or full model ID. Bare provider/model routes ` +
        'direct-first (canonical); openrouter/provider/model forces OpenRouter. Defaults to the ' +
        "original session's model."
      ),
      gateway: z.enum(GATEWAY_MODES).optional().describe(
        'Routing preference: auto (direct-first, default), direct (require a ' +
        'direct provider key), or openrouter (force OpenRouter).'
      ),
      noUi: z.boolean().optional().default(false).describe(
        'Run headless. Default false (opens Electron window).'
      ),
      timeout: z.number().optional().describe(
        'Headless timeout in minutes. Default: 15. Only applies when noUi is true.'
      ),
      contextTurns: z.number().optional().describe(
        'Max turns from the previous session\'s conversation to include as context. Default: 80000 tokens.'
      ),
      contextMaxTokens: z.number().optional().describe(
        'Cap on previous session context size in tokens. Default: 80000.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_setup',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Open the Amicus setup wizard to configure API keys and default ' +
      'model. Launches an interactive Electron window for configuration.',
    inputSchema: {},
  },
  {
    name: 'amicus_abort',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description:
      'Abort a running Amicus session. Stops the OpenCode agent ' +
      'immediately. Use when a session is taking too long or is no ' +
      'longer needed.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID of the running session to abort.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_fanout',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Run N models on the SAME prompt in parallel (one shared engine) and ' +
      'aggregate the results. Headless only. Returns {waveId, taskIds[]} ' +
      'immediately. Preferred: call amicus_wait with the waveId — one blocking ' +
      'call replaces polling; re-call it while it returns timedOut: true. ' +
      'Fallback (no amicus_wait tool available): poll amicus_status with the ' +
      'waveId (run `sleep 25` between polls). Either way, amicus_read the waveId ' +
      'when done for the aggregated JSON wave document (per-leg summaries ' +
      'inside). Each leg is also an ordinary session readable by taskId.',
    inputSchema: {
      models: z.array(safeModel).min(1).max(10).optional().describe(
        `1-10 models (2+ for genuine fan-out). Short aliases (${aliasNames}) or full model IDs — ` +
        'bare provider/model routes direct-first (canonical), openrouter/provider/model forces ' +
        "OpenRouter. Duplicates allowed. Omit when using 'council'."
      ),
      council: z.string().optional().describe(
        "Run a saved council, or a built-in bench ('free', 'budget', 'frontier'), instead of 'models'. " +
        "Expands to the council's members; a saved council of the same name shadows a built-in. " +
        'Mutually exclusive with \'models\'.'
      ),
      gateway: z.enum(GATEWAY_MODES).optional().describe(
        'Routing preference: auto (direct-first, default), direct (require a ' +
        'direct provider key), or openrouter (force OpenRouter).'
      ),
      prompt: z.string().describe(
        'The briefing sent to every model. Self-contained briefings work best (set includeContext false).'
      ),
      agent: z.enum(['Plan', 'Build']).optional().describe(
        'Agent mode for every leg. Build (default): full tool access. Plan: read-only analysis. Chat is not supported headless.'
      ),
      thinking: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional().describe(
        'Reasoning effort for every leg. Default: medium.'
      ),
      timeout: z.number().optional().describe(
        'Per-leg timeout in minutes (wall-clock ≈ slowest leg). Default: 15.'
      ),
      summaryLength: z.enum(['brief', 'normal', 'verbose']).optional().describe(
        'Summary verbosity for every leg.'
      ),
      includeContext: z.boolean().optional().describe(
        'Include parent conversation context (built once, shared by all legs). ' +
        'Default: true. Set false for self-contained briefings.'
      ),
      coworkProcess: z.string().optional().describe(
        'Cowork VM process name (e.g., "modest-laughing-goodall"). ' +
        'Extract from CWD: /sessions/<name>/. Required for parent context loading from Cowork.'
      ),
      parentSession: z.string().optional().describe(
        'Claude Code session UUID for exact context matching. ' +
        'Prevents ambiguity when multiple sessions are active in the same project.'
      ),
      onComplete: z.enum(['mcp-notify']).optional().describe(
        'Advisory: send an MCP info notification carrying the terminal event doc when the run ' +
        'finishes (best-effort; amicus_wait remains the reliable completion mechanism). Exec ' +
        'commands are NOT accepted over MCP.'
      ),
      pack: z.string().optional().describe('Policy pack name or path — bench/chair/options/template defaults for this run; explicit params override pack values (recorded either way).'),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_council_tally',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Deterministic council tally over an ASSEMBLED, de-anonymized input ' +
      '(meta + findings + adjudications + rankings). Peers-only tier cascade ' +
      '(Confirmed/Contested/Disputed/Singleton) + street-cred. Pure + synchronous: ' +
      'returns the tally record immediately. No subprocess, no polling. Claude ' +
      'assembles the input and may override margin tiers afterward.',
    inputSchema: {
      meta: z.object({
        runId: z.string(), runType: z.string().optional(), date: z.string().optional(),
        models: z.array(z.string()).min(1), chair: z.string().optional(),
        claudeInCouncil: z.boolean().optional(),
      }).describe('Run metadata; meta.models lists every reviewed model.'),
      findings: z.array(z.object({
        id: z.string(), raiser: z.string(), severity: z.string(), claim: z.string().optional(),
      })).describe('Run-global findings (ids already A1/B2/C3-prefixed by Claude).'),
      adjudications: z.array(z.object({
        judge: z.string(), findingId: z.string(), verdict: z.enum(['agree', 'dispute', 'neutral']),
      })).describe('One row per (judge × finding).'),
      rankings: z.array(z.object({
        judge: z.string(), order: z.array(z.union([z.string(), z.array(z.string())])),
      })).describe("Each judge's preference order over the reviews (ties = nested array)."),
      runStats: z.array(z.record(z.any())).optional().describe('Optional per-model run stats (status/duration/usage).'),
      project: z.string().optional().describe('Optional project directory path.'),
    },
  },
  {
    name: 'amicus_council_stats',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Per-model reviewer reliability derived from the append-only council ledger ' +
      '(avg peers-only street-cred, lifetime confirm/fact-error rates). Read-only; ' +
      'no inputs required.',
    inputSchema: {
      project: z.string().optional().describe('Optional project directory path.'),
    },
  },
  {
    name: 'amicus_verdict',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Merge a tally record with Claude's Stage-4 decisions into the verdict " +
      'object (final tiers after overrides, decisions, applied flags). Pure + ' +
      'synchronous; returns the verdict. Writes nothing unless render:true AND ' +
      'outDir are given — then it also refreshes <outDir>/report.html.',
    inputSchema: {
      record: z.record(z.any()).describe('A tally() output record (from amicus_council_tally).'),
      decisions: z.array(z.object({
        id: z.string(), decision: z.string().optional(), applied: z.boolean().optional(),
        duplicateOf: z.string().nullable().optional(),
        tierOverride: z.object({ from: z.string(), to: z.string(), reason: z.string() }).nullable().optional(),
      })).optional().describe('Stage-4 per-finding decisions (default []).'),
      overallVerdict: z.string().nullable().optional().describe(
        "The chair's VERDICT line, read from the engine-written <runDir>/verdict.json " +
        '(or the closing VERDICT: line of chair-output.md). Pass it through whenever you ' +
        'overwrite verdict.json — it is the only copy, tally.json has none. Omit when the ' +
        'chair was skipped; never author one yourself.'),
      render: z.boolean().optional().describe('Also return the markdown rendering of the decided verdict (and refresh report.html when outDir is given).'),
      outDir: z.string().optional().describe('Dir to write report.html into when render:true — resolved against the project dir and rejected if it escapes it. Omit to write nothing.'),
      project: z.string().optional().describe('Optional project directory path.'),
    },
  },
  {
    name: 'amicus_council_run',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Run the FULL headless council engine: Stage-1 independent reviews → ' +
      'anonymized peer cross-review → deterministic tally → non-bench chair ' +
      'synthesis → verdict.json + report.html, without any orchestrating agent. ' +
      'Returns {runId, runDir} immediately (async). Preferred: call amicus_wait ' +
      'with the runId; re-call while it returns timedOut: true. Artifacts land ' +
      'in runDir. Exit semantics: run.json status complete (full run), partial ' +
      '(degraded: dead leg / thin judging / no chair verdict), error, aborted.',
    inputSchema: {
      briefingFile: z.string().describe(
        'Path to the briefing file (self-contained material + criteria). The file is ' +
        'copied into the run dir; councils always brief via file (no inline prompt).'
      ),
      models: z.array(safeModel).min(2).max(10).optional().describe(
        `2-10 bench seats. Short aliases (${aliasNames}) or full model IDs. Omit when using 'council'.`
      ),
      council: z.string().optional().describe(
        "Run a saved council or built-in bench ('free', 'budget', 'frontier') instead of 'models'."
      ),
      chair: z.string().optional().describe(
        "Chair model (default 'deepseek'). Must NOT be a bench seat; synthesizes the verdict."
      ),
      critic: z.string().optional().describe(
        'Optional critic seat: one bench member swaps to an adversarial brief. Must BE a bench seat. ' +
        'Mutually exclusive with lenses.'
      ),
      lenses: z.array(z.string()).optional().describe(
        'Optional expert lenses, one per seat (count must equal seat count). Forces no-ledger. ' +
        'Mutually exclusive with critic.'
      ),
      outDir: z.string().optional().describe(
        'Run directory (default <project>/council-<runId>/).'
      ),
      maxCost: z.number().optional().describe(
        'Whole-run USD ceiling, checked before each paid stage launch.'
      ),
      timeoutMinutes: z.number().optional().describe(
        'Per-leg timeout in minutes (existing fanout semantics). Default: 15.'
      ),
      gateway: z.enum(GATEWAY_MODES).optional().describe(
        'Routing preference: auto (default), direct, or openrouter.'
      ),
      debate: z.boolean().optional().describe(
        'Add a Stage-2.5 rebuttal round: raisers defend Contested/Disputed findings and ' +
        'disputing judges re-vote before the chair synthesizes.'
      ),
      claudeReviewFile: z.string().optional().describe(
        "Path to Claude's own review file (prose + findings JSON) to include as a judged " +
        'entry. Claude is reviewed and ranked like a seat, but never judges or chairs.'
      ),
      noCostGate: z.boolean().optional().describe(
        'Disable the per-leg price gate for the WHOLE run (repairs and chair included). ' +
        'Use for an intentional o3-class council. Independent of maxCost, which still caps the total.'
      ),
      onComplete: z.enum(['mcp-notify']).optional().describe(
        'Advisory: send an MCP info notification carrying the terminal event doc when the run ' +
        'finishes (best-effort; amicus_wait remains the reliable completion mechanism). Exec ' +
        'commands are NOT accepted over MCP.'
      ),
      pack: z.string().optional().describe('Policy pack name or path — bench/chair/options/template defaults for this run; explicit params override pack values (recorded either way).'),
      ui: z.boolean().optional().describe(
        'Auto-open the Council Workspace window on this run. Default: opens when the client is ' +
        'Claude Code (local), Electron is installed, a display exists, and config workspace.autoOpen is ' +
        'not false. false: never open. true: open even for other clients (still requires Electron + ' +
        'a display; never installs).'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'amicus_spend',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Read-only cross-run cost rollup from the spend ledger (mirrors the CLI ' +
      '`amicus spend` query flags). Filter by since/wave/council/project/model/op, keep ' +
      'only failed (wasted) rows, and group by a dimension. Returns a versioned ' +
      'spend doc (ids/numbers/paths only, never model-generated text) — never fenced.',
    inputSchema: {
      since: z.string().optional().describe(
        "Only rows from the last N days, as an integer followed by 'd' (e.g. '7d')."
      ),
      wave: z.string().optional().describe('Only rows from this fan-out wave id.'),
      council: z.string().optional().describe('Only rows from this council run id or preset name.'),
      filterProject: z.string().optional().describe(
        'Only rows whose recorded project dir matches this absolute path (a ledger-row ' +
        'filter, NOT this tool\'s working-directory selector — the ledger is global, not ' +
        'per-project). Pass \'.\' to mean the current project dir.'
      ),
      model: z.string().optional().describe('Only rows whose model id starts with this.'),
      op: z.enum(['start', 'continue', 'resume', 'leg']).optional().describe('Only rows for this operation.'),
      failed: z.boolean().optional().describe('Only non-complete (wasted) rows.'),
      groupBy: z.enum(GROUP_DIMS).optional().describe(
        `Group the rollup by this dimension (default 'model'). One of: ${GROUP_DIMS.join(', ')}.`
      ),
      rows: z.boolean().optional().describe(`Include matching raw rows in the result, capped at ${ROWS_CAP}.`),
    },
  },
  {
    name: 'amicus_guide',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Get detailed usage instructions for Amicus — when to spawn ' +
      'sessions, how to write good briefings, agent selection guidelines, ' +
      'and the async workflow pattern. Call this first if you haven\'t ' +
      'used Amicus before.',
    inputSchema: {},
  },
  ];
}

/**
 * Returns the guide text for the amicus_guide tool.
 * Includes live alias table from user config.
 * @returns {string} Markdown-formatted guide text
 */
function getGuideText() {
  const { getEffectiveAliases } = require('./utils/config');
  const { RUNNING_VERSION, versionWarning } = require('./utils/version-info');
  const aliases = getEffectiveAliases();
  const aliasRows = Object.entries(aliases)
    .map(([name, model]) => `| ${name} | ${model} |`)
    .join('\n');
  // #33: surface the running version (and a call-time staleness warning) so a
  // post-upgrade agent session can tell it's running old code.
  const warn = versionWarning();
  const versionLine = `**Running amicus version:** ${RUNNING_VERSION}`
    + (warn ? `\n\n> ⚠️ ${warn}` : '');

  return `# Amicus Usage Guide

${versionLine}

## What Is Amicus?
Amicus spawns parallel conversations with different LLMs and folds results back into your context.

## When to Use Amicus
**DO:** Different model's strengths needed, deep exploration, parallel investigation.
**DON'T:** Simple tasks you can handle directly.

## Async Workflow

### Headless Mode (noUi: true)
1. amicus_start with model + prompt + noUi: true -> get task ID
2. **Preferred:** call amicus_wait with the task ID — one blocking call (up to
   ~50s) replaces the sleep+status loop; re-call it while it returns timedOut: true
3. amicus_read to get the summary once complete
4. Act on findings

**Fallback (only if amicus_wait is unavailable):**
1. Run \`sleep 25\` in your shell (this enforces the polling interval)
2. amicus_status to check progress
3. If still running, run \`sleep 25\` again before each subsequent amicus_status call
4. amicus_read to get the summary once complete

**IMPORTANT (fallback path only):** Always run \`sleep 25\` before every amicus_status call. This is not optional. Each premature poll wastes context tokens for zero benefit. The sleep command enforces the wait mechanically.

### Interactive Mode (noUi: false, default)
1. amicus_start with model + prompt -> get task ID
2. Tell the user: "Let me know when you're done with the session and have clicked Fold."
3. Do NOT poll amicus_status. Wait for the user to tell you it's done.
4. If the user starts a new message without mentioning the session, ask if they're done or just call amicus_read
5. Act on findings

### Fan-Out (amicus_fanout)
Run the SAME prompt across 1-10 models in parallel (one shared engine):
1. amicus_fanout with models + prompt -> {waveId, taskIds[]}
2. **Preferred:** call amicus_wait with the waveId (re-call while timedOut: true). **Fallback:** sleep 25, then amicus_status with the waveId (repeat until done)
3. amicus_read the waveId -> aggregated JSON wave document (per-leg summaries inside)
Each leg is an ordinary session: read/resume/continue it by taskId.

## Agent Selection
| Agent | Reads | Writes | Bash | Use When |
|-------|-------|--------|------|----------|
| Chat (interactive default*) | auto | asks | asks | Questions, analysis |
| Plan | auto | denied | denied | Read-only analysis |
| Build | auto | auto | auto | Implementation tasks |

* Headless (\`noUi\`) runs auto-convert Chat to Build — Chat would otherwise stall waiting on write/bash approval with no UI to approve it.

## Writing Good Briefings
Include: Objective, Background, Files of interest, Success criteria, Constraints.

## Available Model Aliases
| Alias | Model |
|-------|-------|
${aliasRows}

Or use a full model ID. Bare \`provider/model\` (e.g. anthropic/claude-opus-4-8) is the canonical,
policy-routed form — it routes direct-first (your direct provider key if configured, else
OpenRouter). \`openrouter/provider/model\` is an explicit override that forces OpenRouter. The
\`gateway\` param (or \`routing.prefer\` in config.json) controls this per call or globally.
Run amicus_setup to configure defaults and add custom aliases.

## Session Matching
Cowork: pass coworkProcess (extract from CWD: /sessions/<name>/).
Claude Code CLI: pass parentSession with your session UUID.

## Context Control (includeContext)

By default, Amicus includes your parent conversation history as context. Set \`includeContext: false\` to skip this and save tokens when the briefing is self-contained.

### MUST Include Context (Red Flags)
- Task references prior conversation ("the code we discussed", "that bug", "the approach you suggested")
- Fact checking or second opinions on recent work
- Code review of changes made in this session
- "Does this look right?" or validation requests
- Continuing a debugging thread
- Any task where the session needs to understand what happened before

### Safe to Skip Context
- Greenfield tasks with explicit file paths and instructions
- General knowledge or research questions
- Tasks fully scoped in the briefing (files, criteria, constraints all specified)
- Independent analysis unrelated to current conversation

### Self-Contained Briefing Template
When setting \`includeContext: false\`, write a richer briefing:

\`\`\`
**Objective:** [Specific goal]
**Files to read:** [Exact paths]
**Relevant code:** [Paste key snippets if needed]
**Success criteria:** [How to know when done]
**Constraints:** [Scope limits, things to avoid]
\`\`\`

The session has NO other context. Everything it needs must be in the briefing.

## Existing Sessions
Call amicus_list before spawning. Use amicus_resume to reopen or amicus_continue to build on previous findings.
`;
}

module.exports = {
  getTools,
  getGuideText,
  safeTaskId,
  safeModel,
};
