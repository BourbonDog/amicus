// tests/conversation-mirror.test.js
'use strict';
const { createMirrorState, mirrorMessages, mirrorUsageOnly } = require('../src/sidecar/conversation-mirror');
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

  test('caps toolCalls at the most-recent-N without breaking dedup', () => {
    const st = createMirrorState();
    const parts = Array.from({ length: 2100 }, (_, i) => ({ id: `tc${i}`, type: 'tool_use', name: 'Bash', input: { i } }));
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts };
    const r = mirrorMessages([msg], st, { now: NOW });
    // Cap holds: the array retains only the most-recent 2000 payloads.
    expect(st.toolCalls.length).toBe(2000);
    expect(st.toolCalls[0].id).toBe('tc100');                       // oldest dropped
    expect(st.toolCalls[st.toolCalls.length - 1].id).toBe('tc2099'); // newest kept
    // Append is not capped — every distinct tool call is logged exactly once.
    expect(r.appendLines.filter(l => l.type === 'tool_use')).toHaveLength(2100);
    // Dedup survives the cap: re-mirroring the same message re-appends nothing and
    // does not re-grow the array (a dropped-oldest entry is NOT re-added).
    const r2 = mirrorMessages([msg], st, { now: NOW });
    expect(r2.appendLines).toEqual([]);
    expect(st.toolCalls.length).toBe(2000);
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

  test("records the LAST assistant message's finish on both mirror passes (#218 PR 3)", () => {
    const st = createMirrorState();
    expect(st.lastAssistantFinish).toBeNull();
    const done = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'length', tokens: { input: 5, output: 0, reasoning: 32000 } }, parts: [] };
    const streaming = { info: { role: 'assistant', id: 'm2', time: {} }, parts: [] };
    mirrorMessages([done], st, { now: NOW });
    expect(st.lastAssistantFinish).toBe('length');
    // A later message still streaming (no finish yet) is the last one — it wins, as null.
    mirrorMessages([done, streaming], st, { now: NOW });
    expect(st.lastAssistantFinish).toBeNull();
    // Named mutant "NOFINISH": stop recording finish in captureMsgUsage — stays null here.
    mirrorUsageOnly([done, { ...streaming, info: { ...streaming.info, finish: 'stop', tokens: { input: 1, output: 1 } } }], st);
    expect(st.lastAssistantFinish).toBe('stop');
  });

  test('records whether the LAST assistant message carries answer text / reasoning, on both passes (council #232 r1 B2/D1)', () => {
    const st = createMirrorState();
    expect(st.lastAssistantHasText).toBe(false);
    expect(st.lastAssistantHasReasoning).toBe(false);
    const m1 = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'stop' }, parts: [{ id: 'm1:t', type: 'text', text: 'Let me look at the file.' }] };
    const m2 = { info: { role: 'assistant', id: 'm2', time: { completed: 2 }, finish: 'length' }, parts: [{ id: 'm2:r', type: 'reasoning', text: 'thinking…' }] };
    mirrorMessages([m1, m2], st, { now: NOW });
    // Named mutant "TEXTOFFOUTPUT": derive lastAssistantHasText from state.output.length > 0 —
    // m1's text is already in `output`, so this reads true.
    expect(st.lastAssistantHasText).toBe(false);
    expect(st.lastAssistantHasReasoning).toBe(true);
    const m3 = { info: { role: 'assistant', id: 'm3', time: { completed: 3 }, finish: 'stop' }, parts: [{ id: 'm3:t', type: 'text', text: 'ok' }] };
    mirrorMessages([m1, m2, m3], st, { now: NOW });
    expect(st.lastAssistantHasText).toBe(true);
    expect(st.lastAssistantHasReasoning).toBe(false);
    // Whitespace-only text is not an answer.
    const blank = { info: { role: 'assistant', id: 'm4', time: { completed: 4 }, finish: 'length' }, parts: [{ id: 'm4:t', type: 'text', text: '  \n' }] };
    mirrorMessages([m1, m2, m3, blank], st, { now: NOW });
    expect(st.lastAssistantHasText).toBe(false);
    // The usage-only pass records the same two facts.
    mirrorUsageOnly([blank, m3], st);
    expect(st.lastAssistantHasText).toBe(true);
    expect(st.lastAssistantHasReasoning).toBe(false);
  });

  test('a reasoning-only finished message is still promoted to output (#218 PR 3)', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'length' }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] };
    mirrorMessages([msg], st, { now: NOW });
    expect(st.output).toBe('thinking…');
    expect(st.lastAssistantHasText).toBe(false);
    expect(st.lastAssistantHasReasoning).toBe(true);
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

  test('real answer text on a later message REPLACES reasoning promoted earlier (council #232 r1 breakage)', () => {
    const st = createMirrorState();
    const m1 = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'stop' }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] };
    mirrorMessages([m1], st, { now: NOW });
    expect(st.output).toBe('thinking…');         // the stand-in for an answer that had not come
    expect(st.promotedOutput).toBe('thinking…');
    const m2 = { info: { role: 'assistant', id: 'm2', time: { completed: 1 }, finish: 'length' }, parts: [{ id: 'm2:t', type: 'text', text: 'Partial review' }] };
    const r2 = mirrorMessages([m1, m2], st, { now: NOW });
    // Named mutant "KEEPPROMOTED": drop the reset in the text branch — `output` reads
    // 'thinking…Partial review' and the chair adjudicates the thinking beside the answer.
    expect(st.output).toBe('Partial review');
    expect(st.promotedOutput).toBe('');
    expect(r2.appendLines).toEqual([{ role: 'assistant', content: 'Partial review', timestamp: NOW() }]);
    const grown = { ...m2, parts: [{ id: 'm2:t', type: 'text', text: 'Partial review, continued' }] };
    mirrorMessages([m1, grown], st, { now: NOW });
    expect(st.output).toBe('Partial review, continued'); // further growth appends normally
  });
});

describe('reasoning-delta progress (F6d)', () => {
  const reasoningMsg = (id, text) => ({
    info: { role: 'assistant', id, time: {} },
    parts: [{ id: `${id}:r`, type: 'reasoning', text }],
  });

  test('every reasoning-growth poll emits a Thinking tick; no growth emits nothing', () => {
    const st = createMirrorState();
    const r1 = mirrorMessages([reasoningMsg('m1', 'hmm')], st, { now: NOW });
    expect(r1.progressUpdates).toEqual([
      { stage: 'receiving', extra: { messagesReceived: 1, stageLabel: 'Thinking…' } },
    ]);
    const r2 = mirrorMessages([reasoningMsg('m1', 'hmm, deeper thought')], st, { now: NOW });
    expect(r2.progressUpdates).toHaveLength(1); // growth again → another tick
    const r3 = mirrorMessages([reasoningMsg('m1', 'hmm, deeper thought')], st, { now: NOW });
    expect(r3.progressUpdates).toHaveLength(0); // NO growth → no tick (stall detection intact)
  });

  test('text update wins over the Thinking tick in the same poll', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'm1:r', type: 'reasoning', text: 'thinking' },
      { id: 'm1:t', type: 'text', text: 'PONG' },
    ] };
    const r = mirrorMessages([msg], st, { now: NOW });
    expect(r.progressUpdates).toEqual([{ stage: 'receiving', extra: { messagesReceived: 1 } }]);
  });
});

describe('pending tool-call tracking (B53 stall detector)', () => {
  const { getPendingToolCalls } = require('../src/sidecar/conversation-mirror');

  test('a tool_use with no matching tool_result is pending, with a firstSeenAt timestamp', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
    ] };
    mirrorMessages([msg], st, { now: NOW });
    const pending = getPendingToolCalls(st);
    expect(pending).toEqual([{ id: 'tc1', name: 'Bash', firstSeenAt: NOW() }]);
  });

  test('firstSeenAt is captured once and does not move on subsequent polls', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
    ] };
    mirrorMessages([msg], st, { now: NOW });
    const laterNow = () => '2026-06-23T00:05:00.000Z';
    mirrorMessages([msg], st, { now: laterNow }); // same snapshot polled again
    const pending = getPendingToolCalls(st);
    expect(pending).toEqual([{ id: 'tc1', name: 'Bash', firstSeenAt: NOW() }]);
  });

  test('a matching tool_result clears the pending entry', () => {
    const st = createMirrorState();
    const toolUseMsg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
    ] };
    mirrorMessages([toolUseMsg], st, { now: NOW });
    expect(getPendingToolCalls(st)).toHaveLength(1);

    const resultMsg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
      { id: 'tr1', type: 'tool_result', tool_use_id: 'tc1', is_error: false, content: 'ok' },
    ] };
    mirrorMessages([resultMsg], st, { now: NOW });
    expect(getPendingToolCalls(st)).toEqual([]);
  });

  test('multiple unmatched tool calls all appear pending; only the resolved one clears', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: {} },
      { id: 'tc2', type: 'tool_use', name: 'Read', input: {} },
    ] };
    mirrorMessages([msg], st, { now: NOW });
    expect(getPendingToolCalls(st).map(p => p.id).sort()).toEqual(['tc1', 'tc2']);

    const withResult = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: {} },
      { id: 'tc2', type: 'tool_use', name: 'Read', input: {} },
      { id: 'tr1', type: 'tool_result', tool_use_id: 'tc1', is_error: false, content: 'ok' },
    ] };
    mirrorMessages([withResult], st, { now: NOW });
    expect(getPendingToolCalls(st).map(p => p.id)).toEqual(['tc2']);
  });

  test('aggregate fields (toolCalls, seenToolCallIds, seenToolResultIds) stay byte-compatible', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
      { id: 'tr1', type: 'tool_result', tool_use_id: 'tc1', is_error: false, content: 'ok' },
    ] };
    mirrorMessages([msg], st, { now: NOW });
    expect(st.toolCalls).toEqual([{ id: 'tc1', name: 'Bash', input: { cmd: 'ls' } }]);
    expect(st.seenToolCallIds.has('tc1')).toBe(true);
    expect(st.seenToolResultIds.has('tr1')).toBe(true);
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
