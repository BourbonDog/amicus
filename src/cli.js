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
        continue;
      }

      // If --key=value was used, use the inline value directly
      if (inlineValue !== undefined) {
        result[key] = parseValue(key, inlineValue);
        continue;
      }

      // Array accumulation flags
      if (key === 'exclude-mcp' && next && !next.startsWith('--')) {
        result['exclude-mcp'] = result['exclude-mcp'] || [];
        result['exclude-mcp'].push(next);
        i++;
        continue;
      }

      // Unknown negation flags: known --no-* flags are already handled by
      // isBooleanFlag() above; treat any *unregistered* --no-* token as a
      // boolean so it can never swallow the following positional as a value.
      if (key.startsWith('no-')) {
        result[key] = true;
        continue;
      }

      // Options with values
      if (next && !next.startsWith('--')) {
        result[key] = parseValue(key, next);
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }

  return result;
}

/**
 * Check if a flag is boolean (doesn't take a value)
 */
function isBooleanFlag(key) {
   const booleanFlags = [
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
     'no-ledger',            // council tally: compute the record without appending to the reliability ledger
     'html',                 // council report: emit a self-contained HTML page
     'md',                   // council report: emit Markdown (default)
     'fix',                  // doctor: self-heal fixable checks in place (#56)
   ];
  return booleanFlags.includes(key);
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
  resume      Reopen a previous session
  continue    New session building on previous
  read        Output session summary/conversation
  models      List/search the model catalog, refresh it, audit aliases
  council tally <input.json> [--json]   Tally council findings → tiers/street-cred
  council stats [--json]                Reviewer-reliability from the ledger
  council report <verdict.json> [--wave <wave.json>] [--md|--html]   Disagreement+verdict report
  doctor      Check your setup: keys, catalog, binary, skills, MCP (--json)
  abort       Abort a running session (or --all)
  setup       Configure default model and aliases
    --api-keys               Open API key setup window
    --add-alias <name=model> Add a model alias without the full wizard
  key         Manage API keys from the command line
    <provider> <apikey>      Validate and save a key
    <provider> --remove      Remove a saved key
    (no args)                List all configured providers
  update      Update to latest version
  mcp         Start MCP server (stdio transport)
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
  --position <pos>             Window position: right (default), left, center
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
  --json                       Emit the wave result as stable JSON on stdout
  --max-cost <$>               Refuse the wave if the estimated total exceeds $ (soft ceiling)
  --no-cost-gate               Disable the budget gate (per-$/Mtok threshold + ceiling) for this run
  Shared per-leg knobs: --agent, --thinking, --timeout, --summary-length,
  --no-context, --context-*, --mcp*, --no-validate-model, --cwd
  Exit codes: 0 all legs complete, 2 partial, 1 none complete / hard failure
`,
  models: `
Options for 'models':
  --search <q>                 Filter by substring over model id and name
  --refresh                    Force-refresh the catalog from provider APIs
  --check                      Audit aliases against the catalog (exit = stale count)
  --json                       Machine-readable output
`,
  list: `
Options for 'list':
  --status <filter>            Filter by status (running, complete)
  --all                        Show all projects
  --json                       Output as JSON
`,
  abort: `
Options for 'abort':
  --all                        Abort all running sessions in this project
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
  --cwd <path>                 Project directory (default: cwd)
  --no-ui                      Run without GUI (autonomous mode)
  --timeout <minutes>          Headless timeout (default: 15)
  --context-turns <N>          Max conversation turns (default: 50)
  --context-max-tokens <N>     Max context tokens (default: 80000)
`,
  resume: `
Options for 'resume':
  <task_id>                    Required. Session to reopen (positional)
  --cwd <path>                 Project directory (default: cwd)
  --no-ui                      Run without GUI (autonomous mode)
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
`,
  doctor: `
Options for 'doctor':
  --json                       Machine-readable output
  --fix                        Self-heal fixable checks in place (provisions the
                               Electron GUI binary; no global reinstall)
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
  mcp: `
Usage for 'mcp':
  mcp                          Start the MCP server (stdio transport)
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
  DEFAULTS
};
