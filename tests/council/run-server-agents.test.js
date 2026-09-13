// tests/council/run-server-agents.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireRunServer, listEngineToolIds } = require('../../src/council/run-server');
const runState = require('../../src/council/run-state');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-server-agents-'));
  runState.initRun(tmp, { schemaVersion: 2, type: 'council-run', runId: 'r1', status: 'running', stages: [] });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const resolveRouteFn = async ({ model }) => ({ kind: 'resolved', executableId: `openrouter/x/${model}` });
const statsFn = () => [];

describe('acquireRunServer registers the council agents (spec 2026-09-11 §4)', () => {
  test('passes o.councilAgents as `agents` and records their names on run.json', async () => {
    const seen = [];
    const startOpenCodeServerFn = async (mcp, options) => { seen.push(options); return { client: {}, server: { url: 'http://127.0.0.1:1', close: async () => {} } }; };
    const agents = { 'council-seat': { mode: 'primary' }, 'council-support': { mode: 'primary' } };
    const o = { runId: 'r1', runDir: tmp, models: ['gemini', 'gpt'], chair: 'deepseek', councilAgents: agents };
    const shared = await acquireRunServer(o, { startOpenCodeServerFn, resolveRouteFn, statsFn });
    expect(shared).not.toBeNull();
    expect(seen[0].agents).toBe(agents);
    expect(runState.readRun(tmp).sharedServer.agents).toEqual(['council-seat', 'council-support']);
  });

  test('without councilAgents the start options carry no agents key (byte-identical to today)', async () => {
    const seen = [];
    const startOpenCodeServerFn = async (mcp, options) => { seen.push(options); return { client: {}, server: { url: 'http://127.0.0.1:1', close: async () => {} } }; };
    const o = { runId: 'r1', runDir: tmp, models: ['gemini', 'gpt'], chair: 'deepseek' };
    await acquireRunServer(o, { startOpenCodeServerFn, resolveRouteFn, statsFn });
    expect('agents' in seen[0]).toBe(false);
    expect(runState.readRun(tmp).sharedServer.agents).toEqual([]);
  });
});

describe('listEngineToolIds', () => {
  test('returns the ids the engine lists, scoped to the directory', async () => {
    const calls = [];
    const shared = { serverClient: { tool: { ids: async (args) => { calls.push(args); return { data: ['read', 'webfetch'] }; } } } };
    expect(await listEngineToolIds(shared, '/proj')).toEqual(['read', 'webfetch']);
    expect(calls[0]).toEqual({ query: { directory: '/proj' } });
  });
  test('returns null (never throws) with no server, no tool namespace, a throw, or a non-array', async () => {
    expect(await listEngineToolIds(null, '/p')).toBeNull();
    expect(await listEngineToolIds({ serverClient: {} }, '/p')).toBeNull();
    expect(await listEngineToolIds({ serverClient: { tool: { ids: async () => { throw new Error('404'); } } } }, '/p')).toBeNull();
    expect(await listEngineToolIds({ serverClient: { tool: { ids: async () => ({ data: 'nope' }) } } }, '/p')).toBeNull();
  });
});
