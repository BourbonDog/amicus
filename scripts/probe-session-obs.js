#!/usr/bin/env node

/**
 * Wave 3.0 Read D — the observation half of the two Read D probes: what the
 * engine RENDERS for a directory, and what it PERSISTS for a session over time.
 *
 * Every call here is the one amicus itself makes, by the same route:
 *   - `app.agents({query:{directory}})` — src/council/run-seat-tools-verify.js:64-69
 *   - `session.messages({path:{id}, query:{directory}})` — src/opencode-client.js:318-322
 *   - `session.status({path:{id}, query:{directory}})` — src/opencode-client.js:449-455
 * at src/headless.js:110's POLL_INTERVAL_MS of 2000 ms.
 *
 * ⚠️ MEASURED 2026-09-17 (opencode-ai 1.18.15): `session.status` answers with a
 * MAP KEYED BY SESSION ID — `{"ses_x": {"type":"busy"}}` — and with `{}` when
 * nothing is in flight. It is NOT the `{type: …}` object
 * src/utils/session-status.js :: formatSessionStatusSuffix renders, so `own`
 * (this leg's own entry) is recorded beside the map's key count.
 */

'use strict';
const crypto = require('crypto');
const { sleep } = require('./probe-sandbox');

const POLL_MS = 2000;

/** @returns {Promise<object[]|null>} the engine's rendered agents for `directory` */
async function agentsFor(client, directory, keep) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await client.app.agents(directory === undefined ? {} : { query: { directory } });
      if (r && Array.isArray(r.data)) { return keep ? r.data.filter((a) => keep.includes(a.name)) : r.data; }
    } catch { /* engine not up yet */ }
    await sleep(500);
  }
  return null;
}

/** A stable per-agent fingerprint: every field the engine renders, plus permission ORDER. */
function agentDigest(list) {
  if (!list) { return null; }
  const out = {};
  for (const a of list) {
    const perm = Array.isArray(a.permission)
      ? a.permission.map((p) => JSON.stringify(p)) : [JSON.stringify(a.permission)];
    out[a.name] = {
      sha1: crypto.createHash('sha1').update(JSON.stringify(a)).digest('hex'),
      permissionOrder: perm,
      promptChars: a.prompt === null || a.prompt === undefined ? null : String(a.prompt).length,
      model: a.model ?? null, temperature: a.temperature ?? null, topP: a.topP ?? null,
      variant: a.variant ?? null, steps: a.steps ?? null, options: a.options ?? null,
      mode: a.mode ?? null, native: a.native ?? null,
    };
  }
  return out;
}

/**
 * One line per message: role, part types (tool parts carry name + state), finish,
 * error — plus the engine's OWN epoch timestamps, which are what dates a
 * persisted part independently of this probe's poll cadence.
 */
function summarize(msgs) {
  if (!Array.isArray(msgs)) { return { n: -1, text: `(no data array: ${JSON.stringify(msgs).slice(0, 80)})` }; }
  const times = [];
  const rows = msgs.map((m) => {
    const info = m.info || m;
    if (info.time) { times.push({ role: info.role, ...info.time }); }
    const parts = (m.parts || []).map((p) => {
      if (p.time || (p.state && p.state.time)) { times.push({ part: p.type, tool: p.tool, ...(p.time || p.state.time) }); }
      return p.type + (p.type === 'tool' ? `:${p.tool || '?'}:${(p.state && p.state.status) || '?'}` : '');
    });
    return `${info.role || '?'}[${parts.join(',')}]`
      + `${info.finish ? ` finish=${info.finish}` : ''}${info.error ? ' ERROR' : ''}`;
  });
  return { n: msgs.length, text: rows.join(' | '), times };
}

async function statusOf(client, id, directory) {
  try {
    const r = await client.session.status({
      path: { id }, ...(directory === undefined ? {} : { query: { directory } }),
    });
    return r && r.data !== undefined ? r.data : (r || null);
  } catch (err) { return { _threw: err.message }; }
}

/**
 * Poll every leg's messages + status at amicus's 2 s cadence for `totalMs`.
 * Consecutive identical rows collapse into one with `repeat`/`tEnd`.
 * @returns {Promise<Array<Array<object>>>} one row array per leg
 */
async function pollTimeline(client, legs, directory, totalMs, t0) {
  const timeline = legs.map(() => []);
  for (const end = Date.now() + totalMs; Date.now() < end;) {
    for (let i = 0; i < legs.length; i++) {
      if (!legs[i].sessionId) { continue; }
      let msgs = null;
      try {
        const r = await client.session.messages({ path: { id: legs[i].sessionId }, query: { directory } });
        msgs = r && r.data;
      } catch (err) { msgs = { _threw: err.message }; }
      const s = summarize(msgs);
      const st = (await statusOf(client, legs[i].sessionId, directory)) || {};
      const own = st && typeof st === 'object' ? st[legs[i].sessionId] : undefined;
      const row = {
        t: Date.now() - t0, n: s.n, parts: s.text, times: s.times, own: own === undefined ? null : own,
        topLevelType: st && st.type ? st.type : null,
        mapKeys: st && typeof st === 'object' ? Object.keys(st).length : null,
      };
      const prev = timeline[i][timeline[i].length - 1];
      const same = prev && prev.n === row.n && prev.parts === row.parts && prev.mapKeys === row.mapKeys
        && JSON.stringify(prev.own) === JSON.stringify(row.own);
      if (same) { prev.repeat = (prev.repeat || 1) + 1; prev.tEnd = row.t; } else { timeline[i].push(row); }
    }
    await sleep(POLL_MS);
  }
  return timeline;
}

module.exports = { POLL_MS, agentsFor, agentDigest, summarize, statusOf, pollTimeline };
