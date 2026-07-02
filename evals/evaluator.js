const fs = require('fs');
const path = require('path');

/**
 * Run programmatic checks against transcript and sandbox filesystem.
 * @param {Array} criteria - Programmatic criteria from eval task
 * @param {object} transcript - Parsed transcript
 * @param {string} sandboxDir - Path to sandbox directory
 * @returns {Array<{type: string, passed: boolean, detail: string}>}
 */
/**
 * Match tool name allowing MCP prefix and pipe-separated alternatives.
 * Examples:
 *   toolMatches('mcp__amicus__amicus_start', 'amicus_start') -> true
 *   toolMatches('amicus_read', 'amicus_read|amicus_status') -> true
 */
function toolMatches(actualName, criterionName) {
  const alternatives = criterionName.split('|');
  return alternatives.some(alt =>
    actualName === alt || actualName.endsWith(`__${alt}`)
  );
}

function runProgrammaticChecks(criteria, transcript, sandboxDir) {
  return criteria.map(c => {
    switch (c.type) {
      case 'tool_called': {
        const found = transcript.toolCalls.find(tc => toolMatches(tc.tool, c.tool));
        return { type: c.type, tool: c.tool, passed: !!found, detail: found ? 'Called' : 'Not called' };
      }
      case 'tool_param': {
        const call = transcript.toolCalls.find(tc => toolMatches(tc.tool, c.tool));
        if (!call) { return { type: c.type, passed: false, detail: `Tool ${c.tool} not called` }; }
        const actual = call.params[c.param];
        const passed = actual === c.expected;
        return { type: c.type, passed, detail: `${c.param}=${actual} (expected ${c.expected})` };
      }
      case 'tool_param_matches': {
        const call = transcript.toolCalls.find(tc => toolMatches(tc.tool, c.tool));
        if (!call) { return { type: c.type, passed: false, detail: `Tool ${c.tool} not called` }; }
        const actual = String(call.params[c.param] || '');
        const passed = new RegExp(c.pattern).test(actual);
        return { type: c.type, passed, detail: `${c.param}="${actual}" vs /${c.pattern}/` };
      }
      case 'file_changed': {
        const filePath = path.join(sandboxDir, c.path);
        const exists = fs.existsSync(filePath);
        return { type: c.type, path: c.path, passed: exists, detail: exists ? 'File exists' : 'File not found' };
      }
      case 'file_created': {
        const regex = new RegExp(c.pattern);
        const found = findFilesRecursive(sandboxDir).some(f => regex.test(f));
        return { type: c.type, pattern: c.pattern, passed: found, detail: found ? 'Matching file found' : 'No match' };
      }
      case 'file_contains': {
        const filePath = path.join(sandboxDir, c.path);
        if (!fs.existsSync(filePath)) {
          return { type: c.type, passed: false, detail: `File ${c.path} not found` };
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const passed = new RegExp(c.pattern).test(content);
        return { type: c.type, path: c.path, passed, detail: passed ? 'Pattern matched' : 'Pattern not found' };
      }
      case 'no_errors': {
        const passed = transcript.errors.length === 0;
        return { type: c.type, passed, detail: passed ? 'No errors' : `${transcript.errors.length} errors` };
      }
      case 'tool_result_matches': {
        const call = transcript.toolCalls.find(tc => toolMatches(tc.tool, c.tool));
        if (!call) { return { type: c.type, passed: false, detail: `Tool ${c.tool} not called` }; }
        const result = String(call.result || '');
        const passed = new RegExp(c.pattern, 'i').test(result);
        return { type: c.type, tool: c.tool, passed, detail: passed ? `Matched: ${result.slice(0, 100)}` : `No match in: ${result.slice(0, 100)}` };
      }
      case 'bash_result_matches': {
        const cmdRegex = new RegExp(c.command_pattern);
        const matchingCall = transcript.toolCalls.find(tc =>
          tc.params?.command && cmdRegex.test(tc.params.command)
        );
        if (!matchingCall) {
          return { type: c.type, passed: false, detail: 'No matching bash command found' };
        }
        const output = String(matchingCall.result || '');
        const passed = new RegExp(c.pattern, 'i').test(output);
        return { type: c.type, passed, detail: passed ? `Matched: ${output.slice(0, 100)}` : `No match in output (${output.length} chars)` };
      }
      case 'bash_command_matches': {
        const cmds = transcript.bashCommands || [];
        const regex = new RegExp(c.pattern);
        const match = cmds.find(cmd => regex.test(cmd));
        return {
          type: c.type,
          pattern: c.pattern,
          passed: !!match,
          detail: match ? `Matched: ${match.slice(0, 100)}` : 'No matching bash command',
        };
      }
      default:
        return { type: c.type, passed: false, detail: `Unknown criterion type: ${c.type}` };
    }
  });
}

/** Recursively find all files relative to baseDir */
function findFilesRecursive(baseDir, prefix = '') {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(path.join(baseDir, prefix), { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(baseDir, rel));
    } else {
      // Normalize to forward slashes so file_created patterns (which use '/')
      // match on Windows, where path.join produces backslashes. No-op on POSIX.
      results.push(rel.split(path.sep).join('/'));
    }
  }
  return results;
}

/**
 * Build the prompt for LLM-as-judge evaluation.
 * @param {string[]} rubric - Rubric questions
 * @param {object} transcript - Parsed transcript
 * @returns {string}
 */
function buildJudgePrompt(rubric, transcript) {
  const toolSummary = transcript.toolCalls.map(tc => {
    const result = tc.result || '';
    // Show up to 2000 chars to capture full sidecar analysis output
    const truncated = result.length > 2000 ? result.slice(0, 2000) + '...(truncated)' : result;
    return `- ${tc.tool}(${JSON.stringify(tc.params)}) -> ${truncated}`;
  }).join('\n');

  const rubricText = rubric.map((q, i) => `${i + 1}. ${q}`).join('\n');

  return `You are evaluating an LLM's use of the "sidecar" tool (a multi-model subagent system).

## Tool Calls Made
${toolSummary || '(none)'}

## Errors
${transcript.errors.length ? transcript.errors.join('\n') : '(none)'}

## Rubric
Score each item from 1 (poor) to 5 (excellent):
${rubricText}

Respond with ONLY a JSON object: {"scores": [N, N, N, ...]}
One integer per rubric item, in order. No explanation needed.`;
}

/**
 * Parse the LLM judge's response into structured scores.
 * @param {string} response - Raw LLM response text
 * @param {string[]} rubric - Original rubric questions
 * @param {number} passThreshold - Minimum average to pass
 * @returns {{ scores: Array<{rubric: string, score: number}>, average: number, pass_threshold: number, passed: boolean }}
 */
function parseJudgeResponse(response, rubric, passThreshold) {
  const jsonMatch = response.match(/\{[^}]*"scores"\s*:\s*\[[^\]]*\][^}]*\}/);
  if (!jsonMatch) {
    return {
      scores: rubric.map(r => ({ rubric: r, score: 0 })),
      average: 0, pass_threshold: passThreshold, passed: false,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const scores = rubric.map((r, i) => ({
    rubric: r,
    score: parsed.scores[i] || 0,
  }));
  const average = scores.reduce((s, x) => s + x.score, 0) / scores.length;

  return {
    scores,
    average,
    pass_threshold: passThreshold,
    passed: average >= passThreshold,
  };
}

module.exports = { runProgrammaticChecks, findFilesRecursive, buildJudgePrompt, parseJudgeResponse };
