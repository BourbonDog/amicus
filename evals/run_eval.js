#!/usr/bin/env node

/**
 * Sidecar Agentic Eval Runner
 *
 * Spawns real Claude Code with sidecar MCP server, runs tasks in sandboxed
 * fixture projects, grades with programmatic checks + LLM-as-judge.
 */

const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./transcript_parser');
const { runProgrammaticChecks, buildJudgePrompt, parseJudgeResponse } = require('./evaluator');
const { buildMcpConfig, createSandbox, runClaude } = require('./claude_runner');
const { writeResults, printSummary } = require('./result_writer');

const EVALS_DIR = __dirname;
const TASKS_FILE = path.join(EVALS_DIR, 'eval_tasks.json');
const WORKSPACE_DIR = path.join(EVALS_DIR, 'workspace');

const MODE_PREFIX_MCP = 'You have access to amicus MCP tools (amicus_start, amicus_read, amicus_status, etc.). Use these MCP tools to delegate work to another model. Do NOT use bash to call amicus or sidecar.\n\n';
const MODE_PREFIX_CLI = 'You have access to the `sidecar` CLI tool via bash. Use commands like:\n  sidecar start --model gemini --prompt "<task>" --no-ui --timeout 3\n  sidecar read <task_id> --summary\nDo NOT use MCP tools. Use bash to run sidecar commands and wait for the results.\n\n';

/** Load eval tasks */
function loadTasks() {
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
}

/** Run LLM-as-judge via Claude CLI (cheap model) */
async function runJudge(rubric, transcript, passThreshold) {
  const prompt = buildJudgePrompt(rubric, transcript);
  try {
    const { lines } = await runClaude({
      prompt,
      model: 'haiku',
      maxBudget: 0.05,
      mcpConfigPath: null,
      sandboxDir: process.cwd(),
    }, 60000);

    // Extract text content from stream-json
    let responseText = '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') { responseText += block.text; }
          }
        }
        if (event.type === 'result' && event.result) {
          responseText += typeof event.result === 'string' ? event.result : '';
        }
      } catch { /* skip */ }
    }

    return parseJudgeResponse(responseText, rubric, passThreshold);
  } catch (err) {
    console.error(`  Judge failed: ${err.message}`);
    return {
      scores: rubric.map(r => ({ rubric: r, score: 0 })),
      average: 0, pass_threshold: passThreshold, passed: false,
    };
  }
}

/** Run a single eval task */
async function runEval(task, opts = {}) {
  const mode = opts.mode || 'mcp';
  const timestamp = Date.now();
  const workDir = path.join(WORKSPACE_DIR, `eval-${task.id}-${mode}-${timestamp}`);

  console.log(`\nRunning Eval ${task.id} (${mode.toUpperCase()}): ${task.name}`);
  console.log(`  Fixture: ${task.fixture}`);
  console.log(`  Model: ${opts.model || task.model}`);

  // 1. Create sandbox
  const sandboxDir = createSandbox(task.fixture);
  console.log(`  Sandbox: ${sandboxDir}`);

  // 2. Write MCP config (MCP mode only)
  let mcpConfigPath = null;
  if (mode === 'mcp') {
    const mcpConfig = buildMcpConfig();
    mcpConfigPath = path.join(sandboxDir, '.mcp-config.json');
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
  }

  // 3. Build prompt with mode prefix
  const prefix = mode === 'cli' ? MODE_PREFIX_CLI : MODE_PREFIX_MCP;
  const fullPrompt = prefix + task.prompt;

  // 4. Dry run?
  if (opts.dryRun) {
    const { buildClaudeCommand } = require('./claude_runner');
    const cmd = buildClaudeCommand({
      prompt: fullPrompt,
      model: opts.model || task.model,
      maxBudget: task.max_budget_usd,
      mcpConfigPath,
      sandboxDir,
    });
    console.log(`  DRY RUN: ${cmd.command} ${cmd.args.join(' ')}`);
    fs.rmSync(sandboxDir, { recursive: true });
    return null;
  }

  // 5. Run Claude
  console.log('  Running Claude Code...');
  let runResult;
  try {
    runResult = await runClaude({
      prompt: fullPrompt,
      model: opts.model || task.model,
      maxBudget: task.max_budget_usd,
      mcpConfigPath,
      sandboxDir,
    }, 600000); // 10 min - sidecar tasks need time for LLM round-trip + polling
  } catch (err) {
    console.error(`  Claude failed: ${err.message}`);
    const failResult = {
      eval_id: task.id, eval_name: task.name, mode, status: 'ERROR',
      score: 0, duration_seconds: 0,
      token_usage: { claude: { input_tokens: 0, output_tokens: 0 } },
      programmatic_results: [], judge_results: null,
      sidecar_calls: [], cli_commands: [],
      error: err.message,
    };
    writeResults(workDir, failResult, []);
    fs.rmSync(sandboxDir, { recursive: true });
    return failResult;
  }

  const durationSec = Math.round(runResult.duration / 1000);
  console.log(`  Completed in ${durationSec}s (exit code: ${runResult.exitCode})`);

  // 6. Parse transcript
  const transcript = parseTranscript(runResult.lines);
  console.log(`  Tool calls: ${transcript.toolCalls.length}, Errors: ${transcript.errors.length}`);
  console.log(`  Tokens: ${transcript.inputTokens} in, ${transcript.outputTokens} out`);

  // 7. Extract amicus calls (MCP) or CLI commands. Transcripts carry either
  // the bare tool name (amicus_start) or the server-prefixed form
  // (mcp__amicus__amicus_start), so match both.
  const sidecarCalls = transcript.toolCalls
    .filter(tc => /(^|__)amicus_/.test(tc.tool))
    .map(tc => ({ tool: tc.tool, params: tc.params }));
  const cliCommands = mode === 'cli'
    ? (transcript.bashCommands || []).filter(c => c.includes('sidecar'))
    : [];

  // 8. Programmatic checks (mode-aware)
  const criteria = mode === 'cli'
    ? task.success_criteria.programmatic_cli
    : task.success_criteria.programmatic;
  const progResults = runProgrammaticChecks(criteria, transcript, sandboxDir);
  const progPassed = progResults.every(r => r.passed);
  console.log(`  Programmatic: ${progResults.filter(r => r.passed).length}/${progResults.length} passed`);
  for (const r of progResults) {
    console.log(`    ${r.passed ? 'PASS' : 'FAIL'} ${r.type}: ${r.detail}`);
  }

  // 9. LLM-as-judge (only if programmatic passed)
  let judgeResults = null;
  if (progPassed && task.success_criteria.llm_judge) {
    console.log('  Running LLM-as-judge...');
    judgeResults = await runJudge(
      task.success_criteria.llm_judge.rubric,
      transcript,
      task.success_criteria.llm_judge.pass_threshold
    );
    console.log(`  Judge avg: ${judgeResults.average.toFixed(1)} (threshold: ${judgeResults.pass_threshold})`);
  }

  // 10. Build result
  const allPassed = progPassed && (!judgeResults || judgeResults.passed);
  const score = progPassed
    ? (judgeResults ? judgeResults.average / 5 : 1.0)
    : progResults.filter(r => r.passed).length / progResults.length;

  const result = {
    eval_id: task.id,
    eval_name: task.name,
    mode,
    status: allPassed ? 'PASS' : 'FAIL',
    score,
    duration_seconds: durationSec,
    token_usage: {
      claude: { input_tokens: transcript.inputTokens, output_tokens: transcript.outputTokens },
    },
    programmatic_results: progResults,
    judge_results: judgeResults,
    sidecar_calls: sidecarCalls,
    cli_commands: cliCommands,
  };

  // 11. Write results
  writeResults(workDir, result, runResult.lines);
  console.log(`  Result: ${result.status} (score: ${result.score.toFixed(2)})`);
  console.log(`  Output: ${workDir}`);

  // 12. Cleanup sandbox
  fs.rmSync(sandboxDir, { recursive: true });

  return result;
}

/** Main CLI */
async function main() {
  const args = process.argv.slice(2);
  const evalId = args.includes('--eval-id') ? parseInt(args[args.indexOf('--eval-id') + 1]) : null;
  const runAll = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const modelOverride = args.includes('--model') ? args[args.indexOf('--model') + 1] : null;
  const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'both';

  if (!evalId && !runAll) {
    console.log('Usage:');
    console.log('  node evals/run_eval.js --eval-id <id>');
    console.log('  node evals/run_eval.js --eval-id <id> --mode mcp|cli|both');
    console.log('  node evals/run_eval.js --all');
    console.log('  node evals/run_eval.js --all --dry-run');
    console.log('  node evals/run_eval.js --eval-id 1 --model opus');
    process.exit(1);
  }

  if (!['mcp', 'cli', 'both'].includes(modeArg)) {
    console.error(`Invalid mode: ${modeArg}. Must be mcp, cli, or both.`);
    process.exit(1);
  }

  const modes = modeArg === 'both' ? ['mcp', 'cli'] : [modeArg];
  const tasks = loadTasks();
  const toRun = runAll ? tasks : tasks.filter(t => t.id === evalId);

  if (toRun.length === 0) {
    console.error(`No eval found with id ${evalId}`);
    process.exit(1);
  }

  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const results = [];
  for (const task of toRun) {
    for (const mode of modes) {
      const result = await runEval(task, { dryRun, model: modelOverride, mode });
      if (result) { results.push(result); }
    }
  }

  if (results.length > 0) {
    printSummary(results);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
