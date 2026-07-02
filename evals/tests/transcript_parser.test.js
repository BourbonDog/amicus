const { parseTranscript } = require('../transcript_parser');

describe('parseTranscript', () => {
  test('extracts MCP tool calls from stream-json lines', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"1","name":"amicus_start","input":{"model":"gemini","prompt":"test","agent":"Build"}}]}}',
      '{"type":"result","subtype":"tool_result","tool_use_id":"1","content":"{\\"taskId\\":\\"abc123\\"}"}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.toolCalls).toHaveLength(1);
    expect(transcript.toolCalls[0].tool).toBe('amicus_start');
    expect(transcript.toolCalls[0].params.model).toBe('gemini');
    expect(transcript.toolCalls[0].result).toContain('abc123');
  });

  test('extracts token usage from usage events', () => {
    const lines = [
      '{"type":"usage","usage":{"input_tokens":1000,"output_tokens":500}}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.inputTokens).toBe(1000);
    expect(transcript.outputTokens).toBe(500);
  });

  test('captures errors from tool results', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"1","name":"amicus_status","input":{"taskId":"bad"}}]}}',
      '{"type":"result","subtype":"tool_result","tool_use_id":"1","content":"Error: Session bad not found.","is_error":true}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.errors).toHaveLength(1);
    expect(transcript.errors[0]).toContain('not found');
  });

  test('handles empty input', () => {
    const transcript = parseTranscript([]);
    expect(transcript.toolCalls).toEqual([]);
    expect(transcript.errors).toEqual([]);
    expect(transcript.inputTokens).toBe(0);
    expect(transcript.outputTokens).toBe(0);
  });

  test('skips malformed JSON lines gracefully', () => {
    const lines = ['not json', '{"type":"usage","usage":{"input_tokens":10,"output_tokens":5}}'];
    const transcript = parseTranscript(lines);
    expect(transcript.inputTokens).toBe(10);
  });

  test('extracts bash commands from Bash tool calls', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"tu1","input":{"command":"sidecar start --model gemini --briefing \\"test\\""}}]}}',
      '{"type":"result","subtype":"tool_result","tool_use_id":"tu1","content":"Task started: abc123"}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.bashCommands).toHaveLength(1);
    expect(transcript.bashCommands[0]).toContain('sidecar start');
  });

  test('extracts bash commands from lowercase bash tool name', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"bash","id":"tu2","input":{"command":"sidecar read abc123 --summary"}}]}}',
      '{"type":"result","subtype":"tool_result","tool_use_id":"tu2","content":"Summary: ..."}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.bashCommands).toHaveLength(1);
    expect(transcript.bashCommands[0]).toContain('sidecar read');
  });

  test('returns empty bashCommands when no bash tool calls', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"amicus_start","id":"tu3","input":{"model":"gemini"}}]}}',
      '{"type":"result","subtype":"tool_result","tool_use_id":"tu3","content":"{}"}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.bashCommands).toEqual([]);
  });

  test('extracts tool calls when results come as user events', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__amicus__amicus_start","id":"toolu_abc","input":{"model":"gemini","prompt":"test"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_abc","content":[{"type":"text","text":"{\\"taskId\\":\\"abc123\\"}"}]}]}}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.toolCalls).toHaveLength(1);
    expect(transcript.toolCalls[0].tool).toBe('mcp__amicus__amicus_start');
    expect(transcript.toolCalls[0].params.model).toBe('gemini');
    expect(transcript.toolCalls[0].result).toContain('abc123');
  });

  test('handles parallel tool calls with user event results', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","id":"tu1","input":{"file_path":"/tmp/a.js"}},{"type":"tool_use","name":"Read","id":"tu2","input":{"file_path":"/tmp/b.js"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"file a content"},{"type":"tool_result","tool_use_id":"tu2","content":"file b content"}]}}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.toolCalls).toHaveLength(2);
    expect(transcript.toolCalls[0].result).toContain('file a');
    expect(transcript.toolCalls[1].result).toContain('file b');
  });

  test('captures errors from user event tool results', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","id":"tu1","input":{"file_path":"/tmp/x.js"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"Permission denied","is_error":true}]}}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.errors).toHaveLength(1);
    expect(transcript.errors[0]).toContain('Permission denied');
  });

  test('extracts token usage from assistant message usage field', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":200,"cache_read_input_tokens":100}}}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.inputTokens).toBe(1000);
    expect(transcript.outputTokens).toBe(500);
  });

  test('extracts token usage from result event usage field', () => {
    const lines = [
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":5000,"usage":{"input_tokens":12,"output_tokens":6079,"cache_creation_input_tokens":37992,"cache_read_input_tokens":156025}}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.inputTokens).toBe(12);
    expect(transcript.outputTokens).toBe(6079);
  });

  test('prefers result event usage over accumulated assistant usage', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":3,"output_tokens":7}}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"bye"}],"usage":{"input_tokens":3,"output_tokens":8}}}',
      '{"type":"result","subtype":"success","usage":{"input_tokens":12,"output_tokens":6079}}',
    ];
    const transcript = parseTranscript(lines);
    // Result event totals should be used, not sum of individual assistant events
    expect(transcript.inputTokens).toBe(12);
    expect(transcript.outputTokens).toBe(6079);
  });
});
