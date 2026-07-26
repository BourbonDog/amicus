'use strict';

/**
 * v4.4 B4 part 1 — the OpenCode tool-part SHAPE, established empirically.
 *
 * The diagnosis (§7.4 #1) proposed gating leg completion on
 * `pendingToolCalls.length === 0`, where `pendingToolCalls` clears on a
 * `tool_result` part carrying `tool_use_id`. Measured against the machine's
 * whole OpenCode database (`~/.local/share/opencode/opencode.db`, read from a
 * copy) and the 35 recorded legs of `council-wsgate01/`..`council-wsgate04/`:
 *
 *   - part `type` values across 5,129 persisted parts:
 *       text (1197), step-start (949), reasoning (662), step-finish (906),
 *       tool (1307), patch (108)
 *     There is NO `tool_result` part type, and no `tool_use` either.
 *   - the 35 recorded legs' conversation.jsonl: 36 `tool_use` records,
 *     **ZERO** `tool_result` records — so a counter waiting on one NEVER clears
 *     and gating completion on it would hang every tool-using leg to its full
 *     `--timeout`.
 *
 * The real shape is `{type:'tool', id, callID, tool:<name>, state:{status,…}}`.
 * TOOL-STATUS VOCABULARY, derived (not assumed):
 *   - DECLARED by the installed SDK (@opencode-ai/sdk 1.1.36
 *     `dist/gen/types.gen.d.ts` `ToolState` union): 'pending' | 'running' |
 *     'completed' | 'error'.
 *   - OBSERVED across all 1,307 persisted tool parts: completed 1148,
 *     error 150, running 9. ('pending' is declared but never persisted — it
 *     carries only `{input, raw}` and no `time` at all, i.e. it is the
 *     pre-execution transient.)
 *   - TERMINAL = 'completed' | 'error'. Verified structurally: all 1,298
 *     terminal parts carry `state.time.end`; all 9 non-terminal parts carry
 *     `state.time.start` and NO `end`. The two sets are disjoint and exhaustive.
 *   - The 9 `running` leftovers all have `time_updated ≈ time_created` and
 *     belong to three killed sessions — proof that a stale non-terminal status
 *     can persist forever, which is why the completion wait MUST be bounded.
 */

const {
  createMirrorState, mirrorMessages,
  TERMINAL_TOOL_STATUSES, LIVE_TOOL_STATUSES, isToolPartSettled, isToolPartLive,
  toolPartName, getPendingToolCalls, getLiveToolCalls,
} = require('../../src/sidecar/conversation-mirror');

/** A real-shape SDK tool part. */
const toolPart = (id, tool, status, extra = {}) => ({
  id,
  callID: `call_${id}`,
  type: 'tool',
  tool,
  state: {
    status,
    input: { pattern: '**/*.js' },
    ...(status === 'completed' ? { output: 'ok', title: tool, time: { start: 1, end: 2 } } : {}),
    ...(status === 'error' ? { error: 'boom', time: { start: 1, end: 2 } } : {}),
    ...(status === 'running' ? { time: { start: 1 } } : {}),
    ...extra,
  },
});

const asstMsg = (id, parts, completed) => ({
  info: { role: 'assistant', id, time: completed ? { created: 1, completed: 2 } : { created: 1 } },
  parts,
});

describe('tool-part status vocabulary (v4.4 B4 part 1)', () => {
  it('TERMINAL_TOOL_STATUSES is exactly the two statuses that carry state.time.end', () => {
    expect(Array.from(TERMINAL_TOOL_STATUSES).sort()).toEqual(['completed', 'error']);
  });

  it('isToolPartSettled recognises every DECLARED status correctly', () => {
    // The full SDK ToolState union — derived from types.gen.d.ts, not guessed.
    expect(isToolPartSettled(toolPart('p1', 'read', 'completed'))).toBe(true);
    expect(isToolPartSettled(toolPart('p2', 'read', 'error'))).toBe(true);
    expect(isToolPartSettled(toolPart('p3', 'read', 'running'))).toBe(false);
    expect(isToolPartSettled({ id: 'p4', type: 'tool', tool: 'read', state: { status: 'pending', input: {}, raw: '' } })).toBe(false);
  });

  it('isToolPartSettled treats an ABSENT state as NOT settled (legacy tool_use shape)', () => {
    // The pre-v4.4 fixtures/providers that emit `{type:'tool_use', name}` carry
    // no `state` at all. Unknown status must never be read as "finished".
    expect(isToolPartSettled({ id: 'p5', type: 'tool_use', name: 'Bash' })).toBe(false);
    expect(isToolPartSettled({ id: 'p6', type: 'tool', tool: 'read' })).toBe(false);
    expect(isToolPartSettled(null)).toBe(false);
  });

  it('isToolPartSettled does not invent terminality from an unrecognised status', () => {
    expect(isToolPartSettled({ type: 'tool', tool: 'x', state: { status: 'finished' } })).toBe(false);
    expect(isToolPartSettled({ type: 'tool', tool: 'x', state: { status: '' } })).toBe(false);
  });

  it('toolPartName reads the REAL field (part.tool) and falls back to the legacy part.name', () => {
    // The mirror previously read `part.name`, which the real shape never has —
    // every one of the 36 recorded tool records carries an id and NOTHING else,
    // which is why headless.js's `Task`-subagent summary log was permanently empty.
    expect(toolPartName(toolPart('p1', 'task', 'completed'))).toBe('task');
    expect(toolPartName({ id: 'p2', type: 'tool_use', name: 'Bash' })).toBe('Bash');
    expect(toolPartName({ id: 'p3', type: 'tool' })).toBeUndefined();
  });
});

describe('mirrorMessages tracks tool status, not a part type that does not exist', () => {
  it('a running real-shape tool part is PENDING and carries its real name', () => {
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'task', 'running')])], state);
    const pending = getPendingToolCalls(state);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: 't1', name: 'task' });
    expect(state.toolCalls[0]).toMatchObject({ id: 't1', name: 'task' });
    expect(state.toolCalls[0].input).toEqual({ pattern: '**/*.js' });
  });

  it('THE LANDMINE: the same part reaching `completed` clears pending with NO tool_result', () => {
    // This is the whole point. 36 tool_use records / 0 tool_result records across
    // the recorded corpus: a fix keyed on tool_result would hang forever here.
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'task', 'running')])], state);
    expect(getPendingToolCalls(state)).toHaveLength(1);

    const second = mirrorMessages([asstMsg('m1', [toolPart('t1', 'task', 'completed')])], state);
    expect(getPendingToolCalls(state)).toHaveLength(0);
    // …and the tool call was appended to conversation.jsonl exactly ONCE.
    expect(second.appendLines.filter((l) => l.type === 'tool_use')).toHaveLength(0);
    expect(state.toolCalls).toHaveLength(1);
  });

  it('`error` is terminal too — the 3 recorded wsgate03-s1-1 read:error parts must settle', () => {
    const state = createMirrorState();
    const running = ['r1', 'r2', 'r3'].map((id) => toolPart(id, 'read', 'running'));
    mirrorMessages([asstMsg('m1', running)], state);
    expect(getPendingToolCalls(state)).toHaveLength(3);

    const errored = ['r1', 'r2', 'r3'].map((id) => toolPart(id, 'read', 'error'));
    mirrorMessages([asstMsg('m1', errored)], state);
    expect(getPendingToolCalls(state)).toHaveLength(0);
  });

  it('a settle transition is recorded so the poll loop can count it as ACTIVITY', () => {
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'read', 'running')])], state);
    expect(state.settledToolCallIds.size).toBe(0);
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'read', 'completed')])], state);
    expect(state.settledToolCallIds.has('t1')).toBe(true);
  });

  it('a part observed as ALREADY completed on first sight is never pending', () => {
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'glob', 'completed')])], state);
    expect(getPendingToolCalls(state)).toHaveLength(0);
    expect(state.toolCalls).toHaveLength(1);
  });

  it('BACK-COMPAT: the legacy tool_use + tool_result pair still clears pending', () => {
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [{ id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } }])], state);
    expect(getPendingToolCalls(state)).toEqual([expect.objectContaining({ id: 'tc1', name: 'Bash' })]);

    const r = mirrorMessages([asstMsg('m1', [
      { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
      { id: 'tr1', type: 'tool_result', tool_use_id: 'tc1', content: 'done' },
    ])], state);
    expect(getPendingToolCalls(state)).toHaveLength(0);
    expect(r.appendLines.filter((l) => l.type === 'tool_result')).toHaveLength(1);
  });

  it('a legacy tool_use with NO result and NO state stays pending (B53 wedge case intact)', () => {
    const state = createMirrorState();
    for (let i = 0; i < 5; i++) {
      mirrorMessages([asstMsg('m1', [{ id: 'tc1', type: 'tool_use', name: 'Bash' }])], state);
    }
    expect(getPendingToolCalls(state)).toHaveLength(1);
    expect(state.toolCalls).toHaveLength(1); // appended once, not five times
  });

  it('ANTI-HANG: a no-state tool part is PENDING but not LIVE', () => {
    // The load-bearing distinction. The completion gate reads getLiveToolCalls and
    // must never hold a leg open on an absence of evidence; B53's wedge detector
    // reads getPendingToolCalls and still covers that case. The repo's own
    // fixtures (tests/observe/progress-usage-wiring.test.js) emit exactly this
    // shape, and gating completion on it held a finished leg to its full timeout.
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [{ id: 'tc1', type: 'tool_use', name: 'web_search' }])], state);
    expect(getPendingToolCalls(state)).toHaveLength(1); // B53 still sees it
    expect(getLiveToolCalls(state)).toHaveLength(0);    // the gate does NOT
  });

  it('a positively RUNNING part is both pending and live', () => {
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'task', 'running')])], state);
    expect(getPendingToolCalls(state)).toHaveLength(1);
    expect(getLiveToolCalls(state)).toEqual([expect.objectContaining({ id: 't1', status: 'running' })]);
  });

  it('a settled part is neither pending nor live', () => {
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'task', 'completed')])], state);
    expect(getPendingToolCalls(state)).toHaveLength(0);
    expect(getLiveToolCalls(state)).toHaveLength(0);
  });

  it('an UNRECOGNISED status is pending but not live (forward-compatible, never hangs)', () => {
    // If OpenCode ever adds a status we do not know, the safe reading is "no
    // evidence it is running" — B53 keeps watching it, the gate does not block.
    const state = createMirrorState();
    mirrorMessages([asstMsg('m1', [{ id: 't1', type: 'tool', tool: 'x', state: { status: 'queued' } }])], state);
    expect(getPendingToolCalls(state)).toHaveLength(1);
    expect(getLiveToolCalls(state)).toHaveLength(0);
  });

  it('LIVE_TOOL_STATUSES is exactly the two non-terminal statuses the SDK declares', () => {
    expect(Array.from(LIVE_TOOL_STATUSES).sort()).toEqual(['pending', 'running']);
    // The two sets are disjoint — no status is both live and terminal.
    for (const s of LIVE_TOOL_STATUSES) { expect(TERMINAL_TOOL_STATUSES.has(s)).toBe(false); }
    expect(isToolPartLive(toolPart('p', 'read', 'running'))).toBe(true);
    expect(isToolPartLive(toolPart('p', 'read', 'completed'))).toBe(false);
    expect(isToolPartLive({ id: 'p', type: 'tool_use', name: 'Bash' })).toBe(false);
  });

  it('firstSeenAt is captured once and never bumped while the call stays non-terminal', () => {
    const state = createMirrorState();
    let t = 1000;
    const now = () => new Date(t).toISOString();
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'task', 'running')])], state, { now });
    const first = getPendingToolCalls(state)[0].firstSeenAt;
    t = 999000;
    mirrorMessages([asstMsg('m1', [toolPart('t1', 'task', 'running')])], state, { now });
    expect(getPendingToolCalls(state)[0].firstSeenAt).toBe(first);
  });
});
