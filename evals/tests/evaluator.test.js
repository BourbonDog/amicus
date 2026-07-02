const fs = require('fs');
const path = require('path');
const os = require('os');
const { runProgrammaticChecks } = require('../evaluator');

describe('runProgrammaticChecks', () => {
  test('tool_called passes when tool was called', () => {
    const transcript = {
      toolCalls: [{ tool: 'amicus_start', params: { model: 'gemini' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_called', tool: 'amicus_start' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('tool_called fails when tool was not called', () => {
    const transcript = { toolCalls: [], errors: [] };
    const criteria = [{ type: 'tool_called', tool: 'amicus_start' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });

  test('tool_param passes when param matches expected value', () => {
    const transcript = {
      toolCalls: [{ tool: 'amicus_start', params: { agent: 'Build' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_param', tool: 'amicus_start', param: 'agent', expected: 'Build' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('tool_param_matches passes on regex match', () => {
    const transcript = {
      toolCalls: [{ tool: 'amicus_start', params: { model: 'openrouter/google/gemini-2.5-flash' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_param_matches', tool: 'amicus_start', param: 'model', pattern: 'gemini' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('file_changed passes when file was modified', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const filePath = path.join(tmpDir, 'src', 'auth.js');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'modified content');

    const criteria = [{ type: 'file_changed', path: 'src/auth.js' }];
    const results = runProgrammaticChecks(criteria, { toolCalls: [], errors: [] }, tmpDir);
    expect(results[0].passed).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('file_created passes when file matching pattern exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const filePath = path.join(tmpDir, 'tests', 'todo.test.js');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'test content');

    const criteria = [{ type: 'file_created', pattern: 'tests/.*\\.js$' }];
    const results = runProgrammaticChecks(criteria, { toolCalls: [], errors: [] }, tmpDir);
    expect(results[0].passed).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('file_contains passes when file has matching content', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const filePath = path.join(tmpDir, 'src', 'auth.js');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'const result = await refreshToken(old);');

    const criteria = [{ type: 'file_contains', path: 'src/auth.js', pattern: 'await.*refresh' }];
    const results = runProgrammaticChecks(criteria, { toolCalls: [], errors: [] }, tmpDir);
    expect(results[0].passed).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('no_errors passes when transcript has no errors', () => {
    const transcript = { toolCalls: [], errors: [] };
    const criteria = [{ type: 'no_errors' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('no_errors fails when transcript has errors', () => {
    const transcript = { toolCalls: [], errors: ['Something broke'] };
    const criteria = [{ type: 'no_errors' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });

  test('bash_command_matches passes when command matches pattern', () => {
    const transcript = {
      toolCalls: [],
      bashCommands: ['sidecar start --model gemini --briefing "debug auth"'],
      errors: [],
    };
    const criteria = [{ type: 'bash_command_matches', pattern: 'sidecar\\s+start\\s+--model' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
    expect(results[0].detail).toContain('sidecar start');
  });

  test('bash_command_matches fails when no command matches', () => {
    const transcript = {
      toolCalls: [],
      bashCommands: ['ls -la', 'cat foo.txt'],
      errors: [],
    };
    const criteria = [{ type: 'bash_command_matches', pattern: 'sidecar\\s+start' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });

  test('bash_command_matches fails when bashCommands is empty', () => {
    const transcript = {
      toolCalls: [],
      bashCommands: [],
      errors: [],
    };
    const criteria = [{ type: 'bash_command_matches', pattern: 'sidecar\\s+start' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });

  test('tool_called matches MCP-prefixed tool names', () => {
    const transcript = {
      toolCalls: [{ tool: 'mcp__amicus__amicus_start', params: { model: 'gemini' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_called', tool: 'amicus_start' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
    expect(results[0].detail).toBe('Called');
  });

  test('tool_called matches pipe-separated alternatives', () => {
    const transcript = {
      toolCalls: [{ tool: 'mcp__amicus__amicus_status', params: {}, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_called', tool: 'amicus_read|amicus_status' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('tool_param matches MCP-prefixed tool names', () => {
    const transcript = {
      toolCalls: [{ tool: 'mcp__amicus__amicus_start', params: { agent: 'Build' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_param', tool: 'amicus_start', param: 'agent', expected: 'Build' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('tool_param_matches matches MCP-prefixed tool names', () => {
    const transcript = {
      toolCalls: [{ tool: 'mcp__amicus__amicus_start', params: { model: 'openrouter/google/gemini-2.5-flash' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_param_matches', tool: 'amicus_start', param: 'model', pattern: 'gemini' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });
  test('tool_result_matches passes when result contains matching pattern', () => {
    const transcript = {
      toolCalls: [{ tool: 'mcp__amicus__amicus_read', params: { taskId: 'abc' }, result: '## Summary\nFound missing await on refreshToken call' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_result_matches', tool: 'amicus_read', pattern: '(await|bug|fix|issue|error|missing)' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
    expect(results[0].detail).toContain('Matched');
  });

  test('tool_result_matches fails when result is empty or no output', () => {
    const transcript = {
      toolCalls: [{ tool: 'mcp__amicus__amicus_read', params: { taskId: 'abc' }, result: '## Sidecar Results: No Output\n\nHeadless mode completed without summary.' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_result_matches', tool: 'amicus_read', pattern: '(await|bug|fix|issue|error|missing)' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });

  test('bash_result_matches passes when bash command output matches pattern', () => {
    const transcript = {
      toolCalls: [{
        tool: 'Bash', params: { command: 'sidecar read abc123 --summary' },
        result: '## Summary\nFound missing await on refreshToken in server.js',
      }],
      bashCommands: ['sidecar read abc123 --summary'],
      errors: [],
    };
    const criteria = [{ type: 'bash_result_matches', command_pattern: 'sidecar\\s+read', pattern: '(refresh|token|server\\.js)' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('bash_result_matches fails when output does not match', () => {
    const transcript = {
      toolCalls: [{
        tool: 'Bash', params: { command: 'sidecar read abc123 --summary' },
        result: 'No summary available.',
      }],
      bashCommands: ['sidecar read abc123 --summary'],
      errors: [],
    };
    const criteria = [{ type: 'bash_result_matches', command_pattern: 'sidecar\\s+read', pattern: '(express|token|auth)' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });

  test('bash_result_matches fails when command not found', () => {
    const transcript = {
      toolCalls: [{ tool: 'Bash', params: { command: 'ls -la' }, result: 'files...' }],
      bashCommands: ['ls -la'],
      errors: [],
    };
    const criteria = [{ type: 'bash_result_matches', command_pattern: 'sidecar\\s+read', pattern: 'anything' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
    expect(results[0].detail).toContain('No matching');
  });

  test('tool_result_matches fails when tool was never called', () => {
    const transcript = {
      toolCalls: [{ tool: 'mcp__amicus__amicus_status', params: {}, result: '{"status":"complete"}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_result_matches', tool: 'amicus_read', pattern: 'anything' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
    expect(results[0].detail).toContain('not called');
  });
});

const { buildJudgePrompt, parseJudgeResponse } = require('../evaluator');

describe('buildJudgePrompt', () => {
  test('includes rubric items and transcript summary', () => {
    const rubric = ['Was the model choice appropriate? (1-5)', 'Was the briefing good? (1-5)'];
    const transcript = {
      toolCalls: [{ tool: 'amicus_start', params: { model: 'gemini' }, result: '{"taskId":"abc"}' }],
      errors: [],
    };
    const prompt = buildJudgePrompt(rubric, transcript);
    expect(prompt).toContain('model choice');
    expect(prompt).toContain('briefing');
    expect(prompt).toContain('amicus_start');
    expect(prompt).toContain('gemini');
    expect(prompt).toContain('JSON');
  });
});

describe('parseJudgeResponse', () => {
  test('extracts scores from JSON response', () => {
    const response = '{"scores": [4, 3, 5, 4]}';
    const rubric = ['Q1', 'Q2', 'Q3', 'Q4'];
    const result = parseJudgeResponse(response, rubric, 3.5);
    expect(result.scores).toHaveLength(4);
    expect(result.scores[0].score).toBe(4);
    expect(result.average).toBe(4.0);
    expect(result.passed).toBe(true);
  });

  test('fails when average below threshold', () => {
    const response = '{"scores": [1, 2, 1, 2]}';
    const rubric = ['Q1', 'Q2', 'Q3', 'Q4'];
    const result = parseJudgeResponse(response, rubric, 3.5);
    expect(result.passed).toBe(false);
    expect(result.average).toBe(1.5);
  });

  test('handles JSON embedded in text', () => {
    const response = 'Here are my scores:\n{"scores": [5, 4, 5, 4]}\nDone.';
    const rubric = ['Q1', 'Q2', 'Q3', 'Q4'];
    const result = parseJudgeResponse(response, rubric, 3.5);
    expect(result.scores).toHaveLength(4);
    expect(result.passed).toBe(true);
  });
});
