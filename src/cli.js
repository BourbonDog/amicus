/**
 * CLI Argument Parser
 *
 * Spec Reference: §4 CLI Interface
 * Parses command line arguments for all sidecar commands.
 */

const {
  validatePromptContent,
  validateCwdPath,
  validateExplicitSession,
  validateAgentMode,
  validateHeadlessAgent,
  validateMcpSpec,
  validateMcpConfigFile,
  validateApiKey,
  validateThinkingLevel
} = require('./utils/validators');
const { resolvePromptSource } = require('./utils/prompt-source');
const { logger } = require('./utils/logger');
const { GATEWAY_MODES } = require('./utils/model-descriptor');

/**
 * Default values per spec §4.1
 */
const DEFAULTS = {
  'session-id': 'current',
  cwd: process.cwd(),
  'context-turns': 50,
   'context-max-tokens': 80000,
   timeout: 15,
   'no-ui': false,
   'summary-length': 'normal', // Default summary length
   position: 'right' // Default window position
};

/**
 * Parse command line arguments
 * @param {string[]} argv - Command line arguments (without node and script name)
 * @returns {object} Parsed arguments
 */
function parseArgs(argv) {
  const result = {
    _: [],
    ...DEFAULTS
  };
  result.__explicit = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      let key = arg.slice(2);
      const next = argv[i + 1];

      // Handle --key=value syntax
      let inlineValue;
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        inlineValue = key.slice(eqIdx + 1);
        key = key.slice(0, eqIdx);
      }

      // Boolean flags (no value expected)
      if (isBooleanFlag(key)) {
        result[key] = true;
        result.__explicit.add(key);
        continue;
      }

      // If --key=value was used, use the inline value directly
      if (inlineValue !== undefined) {
        result[key] = parseValue(key, inlineValue);
        result.__explicit.add(key);
        continue;
      }

      // Array accumulation flags
      if ((key === 'exclude-mcp' || key === 'var') && next && !next.startsWith('--')) {
        result[key] = result[key] || [];
        result[key].push(next);
        result.__explicit.add(key);
        i++;
        continue;
      }

      // Unknown negation flags: known --no-* flags are already handled by
      // isBooleanFlag() above; treat any *unregistered* --no-* token as a
      // boolean so it can never swallow the following positional as a value.
      if (key.startsWith('no-')) {
        result[key] = true;
        result.__explicit.add(key);
        continue;
      }

      // Options with values
      if (next && !next.startsWith('--')) {
        result[key] = parseValue(key, next);
        i++;
      } else {
        result[key] = true;
      }
      result.__explicit.add(key);
    } else if (arg === '-o') {
      // Single short-flag alias, scoped to exactly '-o' (council verdict's
      // --out shorthand). No general short-flag support is implemented —
      // any other leading-dash token still falls through to positionals.
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        result.out = next;
        i++;
      } else {
        result.out = true;
      }
      result.__explicit.add('out');
    } else {
      result._.push(arg);
    }
  }

  return result;
}

/**
 * Flags that take no value. Module-level (not rebuilt per call) so
 * `getBooleanFlags()` can hand the same list to src/utils/known-flags.js —
 * which needs it to tell a real boolean flag from an unknown token, and must
 * not keep a second copy that can rot out of sync with this one.
 */
const BOOLEAN_FLAGS = [
     'no-ui',
     'no-mcp',
     'no-context',
     'setup',
     'all',
     // 'summary', // summary is now an option with a value
     'conversation',
     'json',
     'version',
     'help',
     'api-keys',
     'validate-model',
     'no-validate-model',
     'remove',               // used by 'key' command only; other handlers ignore it
     'no-cost-gate',         // disable the budget gate for this run
     'debate',               // council run: enable the Stage-2.5 rebuttal round
     'no-ledger',            // council tally: compute the record without appending to the reliability ledger
     'html',                 // council report: emit a self-contained HTML page
     'md',                   // council report: emit Markdown (default)
     'fix',                  // doctor: self-heal fixable checks in place (#56)
     'strict',               // models --check: exit non-zero on curated per-gateway drift (#gwid Task 6)
     'live',                 // models --check: opt-in probe of stored aliases with real engine legs (v4.6.2 PR3, spec §6)
     'render',               // council verdict: also refresh report.html next to the decided verdict
     'claude',               // init: register for Claude Code only (Task 15)
     'desktop',              // init: register for Claude Desktop only (Task 15)
     'failed',               // spend: only non-complete (wasted) rows (v4.3 Task 4, spec §7.3)
     'rows',                 // spend: include matching raw rows, capped at 1000 (v4.3 Task 4)
     'plain',                // watch: milestone log lines instead of the refresh table (v4.3 Task 11)
     'ui',                   // watch: open the Council Workspace window; v4.4 seam (v4.3 Task 11)
     'follow',               // fanout / council run: stream this run's own events to stderr (v4.3 Task 13)
     'fallback',             // fanout / council run: opt-in cheaper-model substitution (v4.3 Task 18, spec 6.2); --no-fallback negates via the generic no-* catch-all below
];

/**
 * Check if a flag is boolean (doesn't take a value)
 */
function isBooleanFlag(key) {
  return BOOLEAN_FLAGS.includes(key);
}

/**
 * The boolean-flag names, for the unknown-flag check.
 * @returns {string[]} copy — callers must not mutate the source list
 */
function getBooleanFlags() {
  return [...BOOLEAN_FLAGS];
}

/**
 * Parse a value to the appropriate type
 */
function parseValue(key, value) {
  // max-cost is a float (dollars), not an integer
  if (key === 'max-cost') { return parseFloat(value); }

  // Numeric options
  const numericOptions = ['context-turns', 'context-max-tokens', 'timeout', 'opencode-port'];
   if (numericOptions.includes(key)) {
     return parseInt(value, 10);
   }

   // Specific string options
   if (key === 'summary-length') {
     const validLengths = ['brief', 'normal', 'verbose'];
     if (!validLengths.includes(value.toLowerCase())) {
       logger.warn('Invalid summary-length value, using default', { value, default: 'normal' });
       return DEFAULTS['summary-length'];
     }
     return value.toLowerCase();
   }

   return value;
}

/**
 * Validate arguments for the 'start' command
 * @param {object} args - Parsed arguments
 * @returns {{ valid: boolean, error?: string }}
 */
function validateStartArgs(args) {
  // Resolve the prompt source (--prompt XOR --prompt-file) here so validation
  // is self-contained and order-independent: a caller need not have run
  // resolvePromptSource() first. Skipped when args.prompt is already a plain
  // string (the classic path / already-resolved by handleStart), so the empty
  // '' case still falls through to the presence/content checks below.
  if (args['prompt-file'] !== undefined || args.prompt === undefined || args.prompt === true) {
    const res = resolvePromptSource(args);
    if (res.error) {
      return { valid: false, code: 'MISSING_PROMPT', error: res.error };
    }
    args.prompt = res.prompt;
  }

  // Required: --prompt (presence check)
  if (!args.prompt) {
    return { valid: false, error: 'Error: --prompt is required' };
  }

  // Validate prompt content (not empty/whitespace-only)
  const promptCheck = validatePromptContent(args.prompt);
  if (!promptCheck.valid) {
    return promptCheck;
  }

  // Validate model format if model is present (model is resolved externally via resolveModel)
  if (args.model && !isValidModelFormat(args.model)) {
    return { valid: false, code: 'BAD_MODEL', error: 'Error: --model must be in format provider/model (e.g., google/gemini-2.5-flash) or openrouter/provider/model' };
  }

  // Validate cwd path exists (if provided)
  const cwdCheck = validateCwdPath(args.cwd);
  if (!cwdCheck.valid) {
    return cwdCheck;
  }

  // Validate explicit session ID exists (if not 'current')
  const sessionCheck = validateExplicitSession(args['session-id'], args.cwd);
  if (!sessionCheck.valid) {
    return sessionCheck;
  }

  // Validate agent mode (if provided)
  const agentCheck = validateAgentMode(args.agent);
  if (!agentCheck.valid) {
    return agentCheck;
  }

  // Validate agent is headless-safe when --no-ui is set
  let headlessWarning;
  if (args['no-ui']) {
    const headlessCheck = validateHeadlessAgent(args.agent);
    if (!headlessCheck.valid) {
      return headlessCheck;
    }
    if (headlessCheck.warning) {
      logger.warn('Custom agent headless warning', { warning: headlessCheck.warning });
      headlessWarning = headlessCheck.warning;
    }
  }

  // Validate --client (if provided)
  if (args.client) {
    const validClients = ['code-local', 'code-web', 'cowork'];
    if (!validClients.includes(args.client)) {
      return { valid: false, error: `Error: --client must be one of: ${validClients.join(', ')}` };
    }
    // Require --session-dir when client is code-web
    if (args.client === 'code-web' && !args['session-dir']) {
      return { valid: false, error: 'Error: --session-dir is required when --client is code-web' };
    }
  }

  // Validate --gateway (if provided) — #61 Task 7.1. resolveGatewayMode()
  // already treats any non-'direct'/'openrouter' string as a pass-through
  // (effectively silent auto fallback), so this pre-flight check exists
  // purely to catch typos with a clear error instead of letting them slip
  // through unnoticed.
  if (args.gateway !== undefined && !GATEWAY_MODES.includes(args.gateway)) {
    return { valid: false, error: `Error: --gateway must be one of: ${GATEWAY_MODES.join(', ')}` };
  }

  // Validate MCP spec format (if provided)
  const mcpCheck = validateMcpSpec(args.mcp);
  if (!mcpCheck.valid) {
    return mcpCheck;
  }

  // Validate MCP config file (if provided)
  const mcpConfigCheck = validateMcpConfigFile(args['mcp-config']);
  if (!mcpConfigCheck.valid) {
    return mcpConfigCheck;
  }

  // Validate timeout is positive
  if (args.timeout !== undefined && args.timeout <= 0) {
    return { valid: false, error: 'Error: --timeout must be a positive number' };
  }

  // Validate context-turns is positive
  if (args['context-turns'] !== undefined && args['context-turns'] <= 0) {
    return { valid: false, error: 'Error: --context-turns must be a positive number' };
  }

  // Validate context-since format if provided
  if (args['context-since'] && !isValidDurationFormat(args['context-since'])) {
    return { valid: false, error: 'Error: --context-since must be in format like 30m, 2h, or 1d' };
  }

  // Validate summary-length
  const validSummaryLengths = ['brief', 'normal', 'verbose'];
  if (args['summary-length'] && !validSummaryLengths.includes(args['summary-length'])) {
    return { valid: false, error: `Error: --summary-length must be one of: ${validSummaryLengths.join(', ')}` };
  }

  // Validate thinking effort level (if provided), with model-specific support check
  const thinkingCheck = validateThinkingLevel(args.thinking, args.model);
  if (!thinkingCheck.valid) {
    return thinkingCheck;
  }
  // If model doesn't support the level, adjust it and warn
  if (thinkingCheck.warning) {
    logger.warn('Thinking level adjusted', { warning: thinkingCheck.warning, adjustedLevel: thinkingCheck.adjustedLevel });
    args.thinking = thinkingCheck.adjustedLevel;
  }

  // Validate API key is present for the model's provider
  const apiKeyCheck = validateApiKey(args.model);
  if (!apiKeyCheck.valid) {
    return apiKeyCheck;
  }

  const result = { valid: true };
  if (headlessWarning) {
    result.warning = headlessWarning;
  }
  return result;
}

/**
 * Check if model format is valid
 * Supports:
 *   - Direct API: provider/model (e.g., google/gemini-2.5-flash)
 *   - OpenRouter: openrouter/provider/model (e.g., openrouter/google/gemini-2.5-flash)
 */
function isValidModelFormat(model) {
  const parts = model.split('/');
  // Must have at least 2 parts (provider/model) and at most 3 (openrouter/provider/model)
  if (parts.length < 2 || parts.length > 3) {
    return false;
  }
  // All parts must be non-empty
  return parts.every(part => part.length > 0);
}

/**
 * Check if duration format is valid (e.g., 30m, 2h, 1d)
 */
function isValidDurationFormat(duration) {
  return /^\d+[mhd]$/.test(duration);
}

/**
 * Usage text, split into composable parts so 'amicus <cmd> --help' can print
 * only the relevant block while bare 'amicus --help' still composes the full
 * text byte-identically.
 *
 * Each value is a section of the original monolithic template; concatenating
 * USAGE_HEADER + every USAGE_COMMAND_BLOCKS value (in insertion order) +
 * USAGE_TRAILER reproduces the original string exactly.
 */
const USAGE_HEADER = `
Usage: amicus <command> [options]

Commands:
  start       Launch a new amicus session
  fanout      Run N models on the same prompt in parallel (headless)
  list        Show previous sessions
  status      One-shot status for a session or wave (--json)
  resume      Reopen a previous session
  continue    New session building on previous
  read        Output session summary/conversation
  models      List/search the model catalog, refresh it, audit aliases
  council run <briefing.md> (--models a,b,c | --council <name>)   Headless council: reviews → cross-review → tally → chair → verdict
  council tally <input.json> [--json]   Tally council findings → tiers/street-cred
  council stats [--json]                Reviewer-reliability from the ledger
  council report <verdict.json> [--wave <wave.json>] [--md|--html]   Disagreement+verdict report
  council validate <file> [--json]      Validate a Stage-1 findings block (exit 0/2/1)
  council verdict <tally.json> [--decisions <d.json>] [-o <out.json>]   Build + write verdict.json
  doctor      Check your setup: keys, catalog, binary, skills, MCP (--json)
  spend [--since 7d] [--json]           Cross-run cost rollup from the spend ledger
  watch <id> [--json] [--plain] [--interval <sec>] [--ui]   Live-render a run from any terminal
  abort       Abort a running session (or --all)
  setup       Configure default model and aliases
    --api-keys               Open API key setup window
    --add-alias <name=model> Add a model alias without the full wizard
  key         Manage API keys from the command line
    <provider> <apikey>      Validate and save a key
    <provider> --remove      Remove a saved key
    (no args)                List all configured providers
  provider    Add/list/test/remove local OpenAI-compatible providers (--json)
  update      Update to latest version
  mcp         Start MCP server (stdio transport)
  init        Re-run skill install + MCP registration on demand [--claude] [--desktop] [--json]
`;

// Per-command option blocks, keyed by the invoked subcommand. Insertion order
// must match the original template so the composed full usage is unchanged.
const USAGE_COMMAND_BLOCKS = {
  start: `
Options for 'start':
  --model <model>              Optional (uses config default). Model to use:
                               - Short aliases: gemini, opus, gpt (see 'amicus setup')
                               - Direct API: google/gemini-2.5-flash
                               - OpenRouter: openrouter/google/gemini-2.5-flash
  --prompt <text>              Required. Task description
  --prompt-file <path>         Read the prompt from a UTF-8 file (XOR --prompt)
  --json                       With --no-ui: emit the run result as stable JSON
  --agent <agent>              OpenCode agent to use (see Agent Types below)
  --session-id <id|"current">  Session ID to pull context from (default: current)
  --cwd <path>                 Project directory (default: cwd)
  --no-ui                      Run without GUI (autonomous mode)
  --no-context                   Skip parent conversation history context
  --timeout <minutes>          Headless timeout (default: 15)
  --client <type>              Client type: code-local, code-web, cowork
  --session-dir <path>         Explicit session data directory
  --setup                      Force open configuration
  --fold-shortcut <key>        Customize fold shortcut
  --opencode-port <port>       Port override for OpenCode server
  --context-turns <N>          Max conversation turns (default: 50)
  --context-since <duration>   Time filter (e.g., 2h). Overrides turns.
   --context-max-tokens <N>     Max context tokens (default: 80000)
   --summary-length <length>    Summary verbosity: brief, normal (default), verbose
   --thinking <level>           Reasoning effort: none, minimal, low, medium, high, xhigh
   --mcp <spec>                 Add MCP server. Formats:
                                - name=url (remote server)
                                - name=command (local server)
  --mcp-config <path>          Path to opencode.json with MCP config
  --no-mcp                       Don't inherit MCP servers from parent LLM
  --exclude-mcp <name>           Exclude specific MCP server (repeatable)
  --validate-model             (Deprecated: validation is on by default)
  --no-validate-model          Skip model-catalog validation before launch
  --gateway <mode>             Routing: auto (direct-first), direct, or openrouter
  --position <pos>             Window position: right (default), left, center
  --template <name|path>       Render a briefing template ({{prompt}}, {{artifact}}, {{var.*}})
  --artifact <file>            File whose content fills {{artifact}} (256 KB cap; needs --template)
  --var <k=v>                  Template variable, repeatable (needs --template)
  --pack <name|path>           Load a saved pack (model/options/template); explicit flags override it
  --tag <t>                Label this session for list/search/spend grouping (1-64 chars, [A-Za-z0-9_-])
`,
  fanout: `
Options for 'fanout':
  --models <a,b,c>             Required. Comma-separated aliases or provider/model IDs
  --council <name>             Run a saved council instead of --models (e.g. free). Mutually exclusive with --models
  --prompt <text>              Task briefing (or use --prompt-file)
  --prompt-file <path>         Read the briefing from a UTF-8 file (avoids the
                               ~32KB Windows argument cap). Mutually exclusive
                               with --prompt. Also works with 'start'.
  --wave-id <id>               Explicit wave ID (leg IDs become <id>-1..N)
  --retry-failed <waveId>       Relaunch ONLY that wave's failed/timed-out/crashed/
                                aborted legs as a NEW linked wave, using each leg's
                                own saved context (byte-identical retry). Skips
                                --prompt/--models; --models filters which failed
                                legs to retry. wave.json is never modified.
  --json                       Emit the wave result as stable JSON on stdout
  --max-cost <$>               Refuse the wave if the estimated total exceeds $ (soft ceiling)
  --no-cost-gate               Disable the budget gate (per-$/Mtok threshold + ceiling) for this run
  --fallback / --no-fallback   Opt-in cheaper-model substitution on a classified
                               rate-limit/overload leg failure (spec 6.2). Overrides
                               config fallbacks.enabled when passed; default: config, else off.
  --gateway <mode>              Routing: auto (direct-first), direct, or openrouter
  --follow                      Stream this run's events to stderr as they happen (--json -> NDJSON)
  --on-complete <cmd>           Run a shell command once, at terminal state, after
                                wave.json is durable. The command is user-authored
                                on THIS command line (CLI-only — never sourced from
                                config/briefings/model output); payload rides via
                                env only (AMICUS_TASK_ID/TYPE/STATUS/EXIT_CODE/
                                RESULT_FILE/EVENTS_FILE/COST/PROJECT), never model
                                text. Child stdout/stderr go to amicus stderr.
                                Never changes the wave's exit code, docs, or events.
  --template <name|path>       Render a briefing template ({{prompt}}, {{artifact}}, {{var.*}})
  --artifact <file>            File whose content fills {{artifact}} (256 KB cap; needs --template)
  --var <k=v>                  Template variable, repeatable (needs --template)
  --pack <name|path>           Load a saved pack (bench/options/template); explicit flags override it
  --tag <t>                Label this session for list/search/spend grouping (1-64 chars, [A-Za-z0-9_-])
  Shared per-leg knobs: --agent, --thinking, --timeout, --summary-length,
  --no-context, --context-*, --mcp*, --no-validate-model, --cwd
  Exit codes: 0 all legs complete, 2 partial, 1 none complete / hard failure
`,
  models: `
Options for 'models':
  --search <q>                 Filter by substring over model id and name
  --refresh                    Force-refresh the catalog from provider APIs
  --check                      Audit aliases against the catalog (exit = stale count)
  --strict                     With --check: also exit non-zero on curated
                               per-gateway drift (stale/divergent direct or
                               openrouter forms). Informational without it.
  --live                       With --check: probe every stored alias with one real
                               engine leg (spends) — served / accepted-but-silent /
                               error. Requires --check.
  --json                       Machine-readable output
`,
  list: `
Options for 'list':
  --status <filter>            Filter by status (running, complete)
  --all                        Show all projects
  --search <q>                 Case-insensitive substring filter over id, tag, and briefing
  --json                       Output as JSON
`,
  status: `
Options for 'status':
  <task_id>                    Required. Session or wave ID (positional)
  --wave <wave_id>             Alternative to the positional ID for waves
  --json                       Machine-readable output
  --cwd <path>                 Project directory (default: cwd)
`,
  abort: `
Options for 'abort':
  --all                        Abort all running sessions in this project
  --json                       Emit the abort result as stable JSON
`,
  read: `
Options for 'read':
  --summary                    Show summary (default)
  --conversation               Show full conversation
  --metadata                   Show session metadata
  --json                       Emit the run/wave result as stable JSON
`,
  continue: `
Options for 'continue':
  <task_id>                    Required. Session to build on (positional)
  --prompt <text>              Required. Briefing for the new session
  --model <model>              Optional. Override the model (alias or provider/model)
  --gateway <mode>             Routing when --model is given: auto (direct-first), direct, or openrouter
  --cwd <path>                 Project directory (default: cwd)
  --no-ui                      Run without GUI (autonomous mode)
  --json                       With --no-ui: emit the run result as stable JSON
  --timeout <minutes>          Headless timeout (default: 15)
  --context-turns <N>          Max conversation turns (default: 50)
  --context-max-tokens <N>     Max context tokens (default: 80000)
`,
  resume: `
Options for 'resume':
  <task_id>                    Required. Session to reopen (positional)
  --cwd <path>                 Project directory (default: cwd)
  --no-ui                      Run without GUI (autonomous mode)
  --json                       With --no-ui: emit the run result as stable JSON
  --timeout <minutes>          Headless timeout (default: 15)
`,
  council: `
Subcommands for 'council':
  tally <input.json>           Tally findings → tiers/street-cred (appends to ledger)
    --no-ledger                Compute the record without appending to the ledger
    --json                     Machine-readable output
  stats                        Reviewer-reliability aggregates from the ledger
    --json                     Machine-readable output
  report <verdict.json>        Disagreement + verdict report
    --wave <wave.json>         Include per-leg run stats from a wave file
    --md                       Emit Markdown (default)
    --html                     Emit a self-contained HTML page
  validate <file>               Validate a Stage-1 reviewer's findings block
    --json                     Machine-readable output
    Exit codes: 0 ok:true, 2 ok:false (validation failure), 1 BAD_ARGS
                               (missing/unreadable file)
  verdict <tally.json>          Build + write verdict.json (buildVerdict + atomic write)
    --decisions <d.json>       Optional. Stage-4 decisions array (default [])
    -o, --out <out.json>       Output path (default ./verdict.json)
    --json                     Print the full verdict document
    --render                   Also refresh report.html next to the decided verdict
  run --prompt-file <briefing.md> (--models a,b,c | --council <name>)
      [--chair <model>] [--critic <model>] [--lenses s1,s2,...]
      [--out-dir <dir>] [--json] [--max-cost <usd>] [--timeout <min>]
      [--gateway auto|direct|openrouter] [--no-validate-model]
      [--debate] [--claude-review <file>] [--no-cost-gate] [--follow]
      [--fallback] [--no-fallback] [--on-complete <cmd>]
      [--template <name|path>] [--artifact <file>] [--var <k=v>]
      [--pack <name|path>] [--tag <t>]
                                Run the full headless council engine (v4.0).
                                Chair default: deepseek (must NOT be a bench seat).
                                --critic and --lenses are mutually exclusive.
                                --debate adds a Stage-2.5 rebuttal round.
                                --claude-review <file> enters Claude's own review as
                                a judged entry; --no-cost-gate disables the per-leg
                                price gate for the whole run (repairs + chair).
                                --fallback/--no-fallback opts stage legs (Stage-1 +
                                Stage-2) into cheaper-model substitution on a
                                classified rate-limit/overload failure (spec 6.2);
                                the chair never substitutes via chains.
                                --follow streams run events to stderr as they
                                happen (--json -> NDJSON).
                                --on-complete <cmd> runs a shell command once, at
                                terminal state, after run.json is durable. The
                                command is user-authored on THIS command line
                                (CLI-only — never sourced from config/briefings/
                                model output); payload rides via env only
                                (AMICUS_TASK_ID/TYPE/STATUS/EXIT_CODE/RESULT_FILE/
                                EVENTS_FILE/COST/PROJECT), never model text. Child
                                stdout/stderr go to amicus stderr. Never changes
                                the run's exit code, docs, or events.
                                --template <name|path> renders a briefing from
                                {{prompt}}, {{artifact}}, {{var.*}}; --artifact
                                fills {{artifact}} (256 KB cap); --var sets
                                {{var.*}} (repeatable). Both require --template.
                                --pack <name|path> loads a saved pack (bench,
                                chair, critic/lenses, options, template);
                                explicit flags always override the pack's values.
                                Exit: 0 full run, 2 degraded, 1 quorum/cost/validation.
  save <name> --models a,b,c    Save a named council preset (>=2 resolvable members)
    --json                     Machine-readable output
  list                          List saved councils plus the built-in benches
    --json                     Machine-readable output
  show <name>                   Resolve a council by name (saved or built-in)
    --json                     Machine-readable output
`,
  doctor: `
Options for 'doctor':
  --json                       Machine-readable output
  --fix                        Self-heal fixable checks in place (provisions the
                               Electron GUI binary; no global reinstall)
`,
  spend: `
Options for 'spend':
  --since <Nd>                  Restrict to the last N days (e.g. --since 7d)
  --wave <id>                   Only rows from this fan-out wave
  --council <runId|name>        Only rows from this council run (id or preset name)
  --project <path|.>            Only rows from this project ('.' = cwd)
  --model <id-or-prefix>        Only rows whose model starts with this
  --op <start|continue|resume|leg>   Only rows with this operation
  --failed                      Only non-complete (wasted) rows
  --group-by <model|wave|council|project|op|day>   Rollup dimension (default model)
  --rows                        Include matching raw rows (capped at 1000)
  --json                        Machine-readable output (versioned spend doc)
  Reads ~/.config/amicus/spend-ledger.jsonl (one row per completed run/leg).
  Shows remaining OpenRouter credit when a key is configured.
`,
  watch: `
Options for 'watch':
  <id>                          A fan-out wave id, council run id, or session id.
                                Optional with --ui: bare 'amicus watch --ui' opens the
                                project's Council Workspace run list
  --project <path>              Project the run was launched in (default cwd)
  --interval <sec>              Refresh interval (default 2, floor 0.5)
  --plain                       Milestone log lines instead of the refresh table
  --json                        NDJSON: tailed events + composed doc on change + final doc
  --ui                          Open the Council Workspace window (interactive-only)
`,
  setup: `
Options for 'setup':
  (no args)                    Run the interactive setup wizard
  --api-keys                   Open the API key setup window
  --add-alias <name=model>     Add a model alias without the full wizard
`,
  key: `
Usage for 'key':
  key <provider> <apikey>      Validate and save a key
  key <provider> --remove      Remove a saved key
  key                          List all configured providers
`,
  provider: `
Options for 'provider':
  provider add <id> --preset ollama|lmstudio|vllm   Add a local server from a preset
  provider add <id> --url <baseURL> [--bearer-env VAR | --bearer <token>]
                    [--pricing-in <$/tok> --pricing-out <$/tok>]
  provider list | test <id> | remove <id>           Manage local providers (all support --json)
  Local providers run at $0 through Ollama / LM Studio / vLLM / any OpenAI-compatible endpoint.
`,
  mcp: `
Usage for 'mcp':
  mcp                          Start the MCP server (stdio transport)
`,
  init: `
Options for 'init':
  --claude                     Register for Claude Code only (skip Claude Desktop)
  --desktop                    Register for Claude Desktop only (skip Claude Code)
  --json                       Emit per-step status as JSON
  Runs skill install + MCP registration on demand (for plugin-channel /
  --ignore-scripts installs, a failed postinstall, or repairing deleted
  ~/.claude state). No flags registers both Claude Code and Claude Desktop.
`,
  template: `
Options for 'template':
  amicus template list [--json]           List templates (built-ins marked)
  amicus template show <name|path> [--json]  Print a template
`,
  pack: `
Options for 'pack':
  amicus pack save <name> --kind council|fanout|solo [flags]
                                Save a pack built from flags:
                                --bench <a,b,c|name>    council/fanout: comma-
                                                         separated members, or a
                                                         saved council name
                                --model <model>          solo kind only
                                --chair/--critic/--lenses    council kind only
                                --timeout/--max-cost/--gateway   shared run
                                                         options
                                --agent/--thinking/--summary-length   fanout/
                                                         solo kind only
                                --debate / --no-debate   council kind only
                                --template <name|path>   briefing template
                                                         reference (not rendered)
                                --version <semver>       default 1.0.0 (an
                                                         unchanged re-save is a
                                                         no-op; a changed one
                                                         auto-bumps the patch)
                                --description <text>
  amicus pack save <name> --from-run <id>
                                Build a pack from an existing council run /
                                fanout wave / solo session instead of flags
                                (models, options, and a template REFERENCE only
                                — briefing text is never captured)
  amicus pack list [--json]    List saved packs
  amicus pack show <name|path> [--json]
                                Print a pack plus its validation report (never
                                fails on an invalid pack — see 'validation')
  amicus pack rm <name> [--json]   Remove a saved pack
`
};

const USAGE_TRAILER = `
OpenCode Agent Types:
    Chat       Reads auto, writes/bash ask permission (interactive default)
    Build      Full tool access (headless default)
    Plan       Read-only analysis and planning

  NOTE: --agent chat is interactive-only (incompatible with --no-ui).
  Headless mode defaults to build agent.

Custom agents defined in ~/.config/opencode/agents/ or
.opencode/agents/ are also supported.

Examples:
  amicus start --model google/gemini-2.5 --prompt "Debug auth issue"
  amicus start --model openai/o3 --prompt "Generate tests" --no-ui
  amicus start --model gemini --prompt "Review code" --agent Plan
  amicus list
  amicus resume abc123
  amicus read abc123 --conversation
`;

// Commands handled directly in bin/amicus.js's switch that have no dedicated
// USAGE_COMMAND_BLOCKS entry (their usage is covered by USAGE_HEADER's command
// list only). Kept minimal and explicit rather than parsing the switch itself.
const SWITCH_ONLY_COMMANDS = ['update'];

/**
 * Canonical list of top-level command names, for did-you-mean suggestions and
 * any other consumer that needs "every command amicus recognizes" without a
 * second hand-maintained list. Derived from USAGE_COMMAND_BLOCKS (the existing
 * per-command help source of truth) plus SWITCH_ONLY_COMMANDS.
 * @returns {string[]}
 */
function getCommandNames() {
  return [...Object.keys(USAGE_COMMAND_BLOCKS), ...SWITCH_ONLY_COMMANDS];
}

/**
 * Get usage text.
 *
 * @param {string} [command] When provided AND it has a dedicated options block,
 *   returns the top-level header plus only that command's block (scoped --help).
 *   When omitted, or when the command has no dedicated block, returns the full
 *   composed usage (byte-identical to the original monolithic string).
 */
function getUsage(command) {
  // Each part carries its own leading/trailing newlines exactly as they sat in
  // the original single template literal, so plain concatenation reproduces the
  // blank-line separators (the header's trailing "\n" + a block's leading "\n"
  // form the blank line between them). Scoped help keeps the header + trailer
  // and substitutes just the one command's block in place of all blocks.
  const block = command && Object.prototype.hasOwnProperty.call(USAGE_COMMAND_BLOCKS, command)
    ? USAGE_COMMAND_BLOCKS[command]
    : Object.values(USAGE_COMMAND_BLOCKS).join('');
  return USAGE_HEADER + block + USAGE_TRAILER;
}

module.exports = {
  parseArgs,
  validateStartArgs,
  getUsage,
  getCommandNames,
  getBooleanFlags,
  DEFAULTS
};
