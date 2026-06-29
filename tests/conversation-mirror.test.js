// tests/conversation-mirror.test.js
'use strict';
const { createMirrorState, mirrorMessages } = require('../src/sidecar/conversation-mirror');
const NOW = () => '2026-06-23T00:00:00.000Z';

const asstText = (id, text, completed) => ({ info: { role: 'assistant', id, time: completed ? { completed: 1 } : {} }, parts: [{ id: `${id}:t`, type: 'text', text }] });

describe('mirrorMessages', () => {
  test('appends only the new text delta across polls', () => {
    const st = createMirrorState();
    const r1 = mirrorMessages([asstText('m1', 'Hello')], st, { now: NOW });
    expect(r1.appendLines).toEqual([{ role: 'assistant', content: 'Hello', timestamp: NOW() }]);
    const r2 = mirrorMessages([asstText('m1', 'Hello world')], st, { now: NOW });
    expect(r2.appendLines).toEqual([{ role: 'assistant', content: ' world', timestamp: NOW() }]);
    expect(st.output).toBe('Hello world');
  });

  test('first text emits a receiving progress update', () => {
    const st = createMirrorState();
    const r = mirrorMessages([asstText('m1', 'hi')], st, { now: NOW });
    expect(r.progressUpdates[0]).toEqual({ stage: 'receiving', extra: { messagesReceived: 1 } });
  });

  test('tool_use appended once, with a Calling-tool progress update', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [{ id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } }] };
    const r1 = mirrorMessages([msg], st, { now: NOW });
    expect(r1.appendLines).toEqual([{ role: 'assistant', type: 'tool_use', toolCall: { id: 'tc1', name: 'Bash', input: { cmd: 'ls' } }, timestamp: NOW() }]);
    expect(r1.progressUpdates.find(p => p.extra.latestTool === 'Bash')).toBeTruthy();
    const r2 = mirrorMessages([msg], st, { now: NOW });
    expect(r2.appendLines).toEqual([]); // not re-appended
  });

  test('tool_result appended once (dedup by partId)', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [{ id: 'tr1', type: 'tool_result', tool_use_id: 'tc1', is_error: false, content: 'ok' }] };
    const r1 = mirrorMessages([msg], st, { now: NOW });
    expect(r1.appendLines).toEqual([{ role: 'tool', type: 'tool_result', toolUseId: 'tc1', isError: false, content: 'ok', timestamp: NOW() }]);
    const r2 = mirrorMessages([msg], st, { now: NOW });
    expect(r2.appendLines).toEqual([]);
  });

  test('captures usage and surfaces completion signals', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, tokens: { input: 10, output: 5 }, cost: 0.001 }, parts: [{ id: 'm1:t', type: 'text', text: 'done' }] };
    const r = mirrorMessages([msg], st, { now: NOW });
    expect(st.usageByMsg.get('m1')).toEqual({ tokens: { input: 10, output: 5 }, cost: 0.001 });
    expect(r.currentAssistantMsgId).toBe('m1');
    expect(r.assistantFinished).toBe(true);
    expect(r.messageCount).toBe(1);
  });

  test('captures model error from msg.info.error', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {}, error: { name: 'RateLimit', data: { message: 'slow down' } } }, parts: [] };
    const r = mirrorMessages([msg], st, { now: NOW });
    expect(r.sessionError).toBe('slow down');
  });

  test('ignores user-role messages', () => {
    const st = createMirrorState();
    const r = mirrorMessages([{ info: { role: 'user', id: 'u1' }, parts: [{ id: 'x', type: 'text', text: 'hi' }] }], st, { now: NOW });
    expect(r.appendLines).toEqual([]);
  });

  test('promotes reasoning to output when a finished message has no text part (Gemini direct path)', () => {
    const st = createMirrorState();
    const streaming = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'PONG' }] };
    const r1 = mirrorMessages([streaming], st, { now: NOW });
    expect(st.output).toBe('');                  // not promoted while still streaming
    expect(st.reasoningOutput).toBe('PONG');
    expect(r1.assistantFinished).toBe(false);
    const done = { info: { role: 'assistant', id: 'm1', time: { completed: 1 } }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'PONG' }] };
    const r2 = mirrorMessages([done], st, { now: NOW });
    expect(st.output).toBe('PONG');              // promoted to output on completion
    expect(r2.appendLines).toEqual([{ role: 'assistant', content: 'PONG', timestamp: NOW() }]);
    const r3 = mirrorMessages([done], st, { now: NOW });
    expect(r3.appendLines).toEqual([]);          // promoted only once
  });

  test('reasoning never pollutes output when a text part is also present', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: { completed: 1 } }, parts: [
      { id: 'm1:r', type: 'reasoning', text: 'let me think hard about this' },
      { id: 'm1:t', type: 'text', text: 'PONG' },
    ] };
    const r = mirrorMessages([msg], st, { now: NOW });
    expect(st.output).toBe('PONG');              // text wins; thinking stays out of the answer
    expect(st.reasoningOutput).toBe('let me think hard about this');
    expect(r.appendLines).toEqual([{ role: 'assistant', content: 'PONG', timestamp: NOW() }]);
  });
});

describe('logMessage', () => {
  const { logMessage } = require('../src/sidecar/conversation-mirror');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  test('appends one JSON line per call', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-log-'));
    const p = path.join(dir, 'conversation.jsonl');
    logMessage(p, { role: 'assistant', content: 'a', timestamp: 't' });
    logMessage(p, { role: 'tool', content: 'b', timestamp: 't' });
    const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(JSON.parse);
    expect(lines).toHaveLength(2);
    expect(lines[0].content).toBe('a');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
