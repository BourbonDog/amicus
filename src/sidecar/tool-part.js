// src/sidecar/tool-part.js
'use strict';

/**
 * @module sidecar/tool-part
 * OpenCode's TOOL-PART shape and its status vocabulary (v4.4 B4 part 1).
 *
 * WHY THIS EXISTS. The mirror used to model a tool call as an Anthropic-style
 * `tool_use` part cleared by a matching `tool_result` part carrying
 * `tool_use_id`. **OpenCode has no such part type.** Established empirically
 * before designing against it (see tests/sidecar/tool-part-status.test.js for
 * the full derivation):
 *
 *   - 5,129 persisted parts in this machine's OpenCode database resolve to
 *     exactly six `type` values: text, step-start, reasoning, step-finish,
 *     tool, patch. No `tool_result`. No `tool_use`.
 *   - The 35 recorded legs of `council-wsgate01/`..`council-wsgate04/` wrote
 *     **36 `tool_use` records and ZERO `tool_result` records**. So the
 *     diagnosis's proposed `pendingToolCalls.length === 0` gate, keyed on a
 *     `tool_result` that never arrives, would have hung every tool-using leg
 *     to its full `--timeout`.
 *
 * THE REAL SHAPE (@opencode-ai/sdk `ToolPart`):
 *   `{id, sessionID, messageID, type:'tool', callID, tool:<name>, state}`
 * where `state` is the `ToolState` union.
 *
 * STATUS VOCABULARY:
 *   - DECLARED by the SDK's `ToolState` union: 'pending' | 'running' |
 *     'completed' | 'error'.
 *   - OBSERVED across all 1,307 persisted tool parts: completed 1148,
 *     error 150, running 9. 'pending' is declared but never persisted — it is
 *     the pre-execution transient (`{input, raw}`, no `time` at all).
 *   - TERMINAL is 'completed' | 'error', verified structurally: all 1,298
 *     terminal parts carry `state.time.end`; all 9 non-terminal parts carry
 *     `state.time.start` and no `end`. Disjoint and exhaustive.
 *
 * The 9 `running` parts are LEFTOVERS — `time_updated` within milliseconds of
 * `time_created`, all from three killed sessions that never wrote a terminal
 * status. A stale non-terminal status can therefore persist forever, which is
 * why any wait keyed on this vocabulary MUST be bounded (headless.js's
 * TOOL_SETTLE_GRACE_MS).
 */

/**
 * The statuses that mean "this tool call is finished and its session is no
 * longer working on it". Anything else — including an unrecognised or absent
 * status — is treated as still live: terminality is never INVENTED, it must be
 * positively observed.
 * @type {Set<string>}
 */
const TERMINAL_TOOL_STATUSES = new Set(['completed', 'error']);

/**
 * The statuses that POSITIVELY tell us OpenCode is still working on a tool call.
 *
 * This is deliberately NOT `!TERMINAL` — the difference is the anti-hang
 * guarantee. A tool part carrying no `state` at all (the legacy `tool_use`
 * shape, which the repo's own fixtures still emit) gives us no evidence in
 * either direction, and deferring a leg's completion on an ABSENCE of evidence
 * is precisely how a completion gate hangs. So:
 *
 *   - `getPendingToolCalls` = not-yet-terminal, INCLUDING unknown shape.
 *     Feeds B53's wedge detector, whose whole job is the no-evidence case, and
 *     whose semantics are therefore unchanged.
 *   - `getLiveToolCalls`    = positively observed 'pending' or 'running'.
 *     Feeds the v4.4 completion gate: it will only ever hold a leg open on
 *     evidence that the session really is still working.
 * @type {Set<string>}
 */
const LIVE_TOOL_STATUSES = new Set(['pending', 'running']);

/**
 * Is this part a tool call at all? Accepts OpenCode's real `'tool'` type and
 * the legacy `'tool_use'` shape that older fixtures/providers emit.
 * @param {object} part
 * @returns {boolean}
 */
function isToolPart(part) {
  return !!part && (part.type === 'tool' || part.type === 'tool_use');
}

/**
 * The tool's name. Reads OpenCode's real field (`part.tool`) and falls back to
 * the legacy `part.name`. The mirror previously read ONLY `part.name`, which
 * the real shape never has — which is why all 36 recorded tool records carry an
 * id and nothing else, and why headless.js's `Task`-subagent summary log was
 * permanently empty.
 * @param {object} part
 * @returns {string|undefined}
 */
function toolPartName(part) {
  if (!part) { return undefined; }
  return part.tool !== undefined ? part.tool : part.name;
}

/**
 * The tool's input. Real shape carries it on `state.input`; the legacy shape on
 * `part.input`.
 * @param {object} part
 * @returns {object|undefined}
 */
function toolPartInput(part) {
  if (!part) { return undefined; }
  if (part.state && part.state.input !== undefined) { return part.state.input; }
  return part.input;
}

/**
 * Has this tool call reached a TERMINAL status? A part with no `state` (the
 * legacy shape) is NOT settled — unknown status must never read as "finished",
 * which is what keeps B53's wedge detection working on legacy fixtures.
 * @param {object} part
 * @returns {boolean}
 */
function isToolPartSettled(part) {
  const status = toolPartStatus(part);
  return typeof status === 'string' && TERMINAL_TOOL_STATUSES.has(status);
}

/**
 * The observed `state.status`, or undefined when the part carries no state
 * (legacy shape) — "unknown", which is NOT the same as either terminal or live.
 * @param {object} part
 * @returns {string|undefined}
 */
function toolPartStatus(part) {
  const status = part && part.state && part.state.status;
  return typeof status === 'string' && status !== '' ? status : undefined;
}

/**
 * Is this tool call POSITIVELY observed as still executing? See
 * LIVE_TOOL_STATUSES for why this is not simply `!isToolPartSettled`.
 * @param {object} part
 * @returns {boolean}
 */
function isToolPartLive(part) {
  const status = toolPartStatus(part);
  return status !== undefined && LIVE_TOOL_STATUSES.has(status);
}

/**
 * Is this a SUBAGENT (child-session) tool call? OpenCode names it `task`
 * (lowercase — the pre-existing `t.name === 'Task'` comparison in headless.js
 * could never match, a second bug on top of the missing `part.tool` read).
 *
 * This is the signal for B4: a `task` call spawns a CHILD OpenCode session
 * whose spend is billed separately and is NOT rolled into the parent session's
 * cost, so a leg that made one has cost we cannot claim to know. Verified 1:1
 * on the recorded corpus — exactly 2 `task` calls across 37 sessions, and
 * exactly 2 child sessions, each parented by the calling leg's session
 * (wsgate01-s1-2 → $0.021460, wsgate02-s1-3 → $0.471046).
 * @param {{name?: string}} toolCall a recorded {id,name,input} entry
 * @returns {boolean}
 */
function isSubagentToolCall(toolCall) {
  const name = toolCall && toolCall.name;
  return typeof name === 'string' && name.toLowerCase() === 'task';
}

/**
 * Tool calls that have NOT reached a terminal `state.status` — as far as we can
 * observe, OpenCode may still be working on them and the session may still be
 * billing. INCLUDES the unknown-shape case (no `state` at all). Feeds the
 * headless poll loop's B53 wedge detector, whose whole purpose is that case.
 *
 * v4.4 B4 part 1: this used to clear only on a `tool_result` part carrying
 * `tool_use_id` — a part type OpenCode never emits (0 of 36 recorded tool
 * records) — so it never cleared for any real leg. It is now driven by the real
 * `state.status` vocabulary, with the legacy `tool_result` path kept for
 * back-compat. Returns a fresh array; `state.pendingToolCalls` is the live
 * source of truth.
 * @param {{pendingToolCalls: Map}} state from createMirrorState()
 * @returns {Array<{id:string,name:string,status:string|undefined,firstSeenAt:string}>}
 */
function getPendingToolCalls(state) {
  return Array.from(state.pendingToolCalls.values());
}

/**
 * Tool calls POSITIVELY observed as still executing. A strict SUBSET of
 * getPendingToolCalls — see LIVE_TOOL_STATUSES for why the difference is the
 * anti-hang guarantee. This is what the v4.4 completion gate reads.
 * @param {{pendingToolCalls: Map}} state from createMirrorState()
 * @returns {Array<{id:string,name:string,status:string,firstSeenAt:string}>}
 */
function getLiveToolCalls(state) {
  return getPendingToolCalls(state)
    .filter((t) => t.status !== undefined && LIVE_TOOL_STATUSES.has(t.status));
}

module.exports = {
  TERMINAL_TOOL_STATUSES, LIVE_TOOL_STATUSES, isToolPart, toolPartName, toolPartInput,
  toolPartStatus, isToolPartSettled, isToolPartLive, isSubagentToolCall,
  getPendingToolCalls, getLiveToolCalls,
};
