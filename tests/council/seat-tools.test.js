// tests/council/seat-tools.test.js
'use strict';
const st = require('../../src/council/seat-tools');

const DECLARED = ['invalid', 'question', 'bash', 'read', 'glob', 'grep', 'edit', 'write', 'task',
  'webfetch', 'todowrite', 'websearch', 'skill', 'apply_patch'];

describe('parseToolsFlag', () => {
  test('splits, trims, lowercases and de-duplicates a comma list', () => {
    expect(st.parseToolsFlag(' Read, grep ,read ')).toEqual({ ok: true, ids: ['read', 'grep'] });
  });
  test('refuses an empty value and a non-string', () => {
    expect(st.parseToolsFlag('').ok).toBe(false);
    expect(st.parseToolsFlag(true).ok).toBe(false);
    expect(st.parseToolsFlag(' , ').ok).toBe(false);
  });
  test('refuses anything that is not a tool id shape', () => {
    const r = st.parseToolsFlag('read,../x');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('../x');
  });
});

describe('resolveSeatTools', () => {
  test('review default is no tools; task default is webfetch (spec §2.1)', () => {
    expect(st.resolveSeatTools({ intent: undefined })).toEqual({ ok: true, tools: [], local: false });
    expect(st.resolveSeatTools({ intent: 'task' })).toEqual({ ok: true, tools: ['webfetch'], local: false });
  });
  test('opt-in unions with the default and sorts; a local id flips local', () => {
    expect(st.resolveSeatTools({ intent: 'task', optIn: ['read', 'webfetch'] }))
      .toEqual({ ok: true, tools: ['read', 'webfetch'], local: true });
    expect(st.resolveSeatTools({ intent: undefined, optIn: ['websearch'] }))
      .toEqual({ ok: true, tools: ['websearch'], local: false });
  });
  test('task and skill are refused with a Notice naming the --agent escape hatch (spec §4)', () => {
    for (const id of ['task', 'skill']) {
      const r = st.resolveSeatTools({ intent: 'task', optIn: [id] });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('BAD_ARGS');
      expect(r.message).toContain(id);
      expect(r.message).toContain('--agent Build');
    }
  });
  test('the mutating and interactive ids are refused too (edit, write, apply_patch, question, invalid)', () => {
    for (const id of ['edit', 'write', 'apply_patch', 'question', 'invalid']) {
      expect(st.resolveSeatTools({ intent: undefined, optIn: [id] }).ok).toBe(false);
    }
  });
  test('an id the engine does not declare is refused, and the message lists what it declares', () => {
    const r = st.resolveSeatTools({ intent: undefined, optIn: ['grepp'], declaredIds: DECLARED });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('grepp');
    expect(r.message).toContain('read');
    expect(r.message).not.toContain('task'); // refused ids are not offered
  });
  test('with the declared list, every accepted id passes', () => {
    expect(st.resolveSeatTools({ intent: 'task', optIn: ['read', 'grep', 'glob', 'bash', 'websearch'], declaredIds: DECLARED }))
      .toEqual({ ok: true, tools: ['bash', 'glob', 'grep', 'read', 'webfetch', 'websearch'], local: true });
  });
  test('a case-variant refused id is caught without the engine list (review r1 P2-R7)', () => {
    const r = st.resolveSeatTools({ intent: 'task', optIn: ['Task'], declaredIds: null });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_ARGS');
    expect(r.message).toContain('task');
  });
  test('optIn is normalized like the flag: whitespace and case do not change the result (review r1 P2-R7)', () => {
    expect(st.resolveSeatTools({ intent: 'task', optIn: [' Grep '], declaredIds: ['grep', 'webfetch'] }))
      .toEqual({ ok: true, tools: ['grep', 'webfetch'], local: true });
  });
  test('an opted-in id with a bad shape is refused without the engine list (review r1 P2-R7)', () => {
    const r = st.resolveSeatTools({ intent: 'task', optIn: ['../x'], declaredIds: null });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_ARGS');
    expect(r.message).toContain('../x');
  });
  test('todowrite is a tool that never touches the tree — opting it in does not flip local (B2/D6)', () => {
    expect(st.isLocal(['todowrite'])).toBe(false);
    expect(st.resolveSeatTools({ intent: 'task', optIn: ['todowrite'], declaredIds: DECLARED }))
      .toEqual({ ok: true, tools: ['todowrite', 'webfetch'], local: false });
  });
});

describe('agentToolsConflict (ruling P2-R28, supersedes P2-R25)', () => {
  test('agent set + a non-empty tools array is a conflict, naming the agent', () => {
    const msg = st.agentToolsConflict('Build', ['task']);
    expect(msg).toContain('cannot be combined');
    expect(msg).toContain('Build');
  });
  test('no conflict when agent is absent/null, tools is absent/empty, or both are unset', () => {
    expect(st.agentToolsConflict(undefined, ['read'])).toBeNull();
    expect(st.agentToolsConflict(null, ['read'])).toBeNull();
    expect(st.agentToolsConflict('Build', undefined)).toBeNull();
    expect(st.agentToolsConflict('Build', [])).toBeNull();
    expect(st.agentToolsConflict(undefined, undefined)).toBeNull();
  });
});

// PR 2 Task 6 (spec 2026-09-11 §4, ledger P2-R2/P2-R16): the MCP door's
// remote-only policy. mcp-council-run.js calls this before spawning the CLI
// child — local ids are refused there (the MCP run dir must stay inside the
// project), remote ids ride through as --tools.
describe('resolveRemoteOnlyTools', () => {
  test('a remote-only array is accepted, ids returned in order', () => {
    expect(st.resolveRemoteOnlyTools(['webfetch', 'websearch'])).toEqual({ ok: true, ids: ['webfetch', 'websearch'] });
  });
  test('a local id is refused with a message naming the CLI (MCPLOCALLEAK target)', () => {
    const r = st.resolveRemoteOnlyTools(['read']);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('are local tools');
    expect(r.message).toContain('amicus council run --tools');
  });
  test('a string input is accepted the same way the --tools flag is', () => {
    expect(st.resolveRemoteOnlyTools('webfetch')).toEqual({ ok: true, ids: ['webfetch'] });
  });
  // Review r1 P2-R20: a permanently-refused id (task, skill, ...) is not a
  // placement problem — REMOTE_TOOL_IDS.includes('task') is false, so the
  // local-tools filter used to catch it too and send the out-dir message,
  // which contradicts src/mcp-tools.js's own "task and skill are always
  // refused" schema text and hands the user a command that will also fail.
  test('a permanently-refused id (task) is reported with the refusal reason, not "local tools" (review r1 P2-R20)', () => {
    const r = st.resolveRemoteOnlyTools(['task']);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('refused for council seats');
    expect(r.message).toContain('--agent Build');
    expect(r.message).not.toContain('are local tools');
  });
  // Review r1 P2-R20 minor: the schema allows an empty array (`.min(1)`
  // constrains each STRING element, not the array itself); treat it as
  // absent rather than a shape error a caller never typed.
  test('an empty tools array is treated as absent, not a --tools shape error (review r1 P2-R20 minor)', () => {
    expect(st.resolveRemoteOnlyTools([])).toEqual({ ok: true, ids: [] });
  });
  // Review r1 P2-R20 minor: pin the mixed remote+local case — only the local
  // id is named as the problem, but the suggested CLI command still carries
  // every id the caller asked for (dropping the remote one would silently
  // change what the CLI run does).
  test('a mixed remote+local list names only the local id, but the suggested command carries every id (review r1 P2-R20 minor)', () => {
    const r = st.resolveRemoteOnlyTools(['webfetch', 'read']);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('tools: read are local tools');
    expect(r.message).toContain('--tools webfetch,read');
  });
  test('todowrite rides through like webfetch/websearch (B2/D6): it never touches the tree', () => {
    expect(st.resolveRemoteOnlyTools(['todowrite'])).toEqual({ ok: true, ids: ['todowrite'] });
  });
});

describe('buildCouncilAgents', () => {
  test('support has every tool off and every permission denied', () => {
    const a = st.buildCouncilAgents({ tools: ['webfetch'], local: false })['council-support'];
    expect(a.mode).toBe('primary');
    expect(a.tools).toEqual({ '*': false });
    expect(a.permission).toEqual({ edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' });
  });
  test('seat allows exactly the resolved tools over a wildcard deny', () => {
    const a = st.buildCouncilAgents({ tools: ['webfetch'], local: false })['council-seat'];
    expect(a.tools).toEqual({ '*': false, webfetch: true });
    expect(a.permission).toEqual({ edit: 'deny', bash: 'deny', webfetch: 'allow' });
    expect(a.permission.external_directory).toBeUndefined();
  });
  test('a local seat denies external_directory and allows bash only when bash is in', () => {
    const a = st.buildCouncilAgents({ tools: ['bash', 'read'], local: true })['council-seat'];
    expect(a.tools).toEqual({ '*': false, bash: true, read: true });
    // `read` is in tools, so review r1 P2-R9's nested read permission now appears too —
    // updated alongside that fix, not new coverage of its own (see the dedicated P2-R9
    // tests below for that).
    expect(a.permission).toEqual({
      edit: 'deny', bash: 'allow', webfetch: 'deny', external_directory: 'deny',
      read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny' },
    });
  });
  test('never emits a chat key (buildServerOptions merges after chat)', () => {
    expect(Object.keys(st.buildCouncilAgents({ tools: [], local: false })).sort())
      .toEqual(['council-seat', 'council-support']);
  });
  test('external_directory denies even when the caller omits local, if a local tool is in (review r1 P2-R8)', () => {
    const a = st.buildCouncilAgents({ tools: ['read', 'grep'] })['council-seat'];
    expect(a.permission.external_directory).toBe('deny');
  });
  test('a remote-only tool list still has no external_directory key when local is omitted (review r1 P2-R8)', () => {
    const a = st.buildCouncilAgents({ tools: ['webfetch'] })['council-seat'];
    expect(a.permission.external_directory).toBeUndefined();
  });
  test('a read seat gets a nested .env-denying read permission (review r1 P2-R9, measured 2026-09-12)', () => {
    const a = st.buildCouncilAgents({ tools: ['read', 'grep'] })['council-seat'];
    expect(a.permission.read).toEqual({ '*': 'allow', '*.env': 'deny', '*.env.*': 'deny' });
  });
  test('no read in tools means no read permission key at all (review r1 P2-R9)', () => {
    const a = st.buildCouncilAgents({ tools: ['webfetch'] })['council-seat'];
    expect(a.permission).not.toHaveProperty('read');
  });
});

describe('seatToolsSentence', () => {
  test('no tools: the shared no-tools sentence, forked only on its last word', () => {
    expect(st.seatToolsSentence([], 'review'))
      .toBe('Do NOT use any tools or read any files; everything is in this message; begin immediately with the review.');
    expect(st.seatToolsSentence([], 'answer').endsWith('begin immediately with the answer.')).toBe(true);
  });
  test('remote tools only: names them and forbids the local moves', () => {
    expect(st.seatToolsSentence(['webfetch'], 'answer')).toBe(
      'Your tools: webfetch. You have no others — do not attempt to read files, search directories, ' +
      'or run commands; if research is incomplete, say so in the deliverable rather than leave it unwritten.');
  });
  test('local tools present: names them without the forbidding clause', () => {
    expect(st.seatToolsSentence(['grep', 'read', 'webfetch'], 'review')).toBe(
      'Your tools: grep, read, webfetch. You have no others; if research is incomplete, say so in the ' +
      'deliverable rather than leave it unwritten.');
  });
  // Ruling P2-R31 (B1/D1): under --agent there is no computed allowlist to
  // brief, so the override sentence wins regardless of `tools` or `kind`.
  test('agent set: the override sentence wins for both kinds, naming the agent, ignoring tools', () => {
    for (const kind of ['review', 'answer']) {
      const s = st.seatToolsSentence(['read', 'webfetch'], kind, { agent: 'Plan' });
      expect(s).toBe(
        "You run as the engine's Plan agent with its own tool set; use tools only where the " +
        'deliverable needs them; if research is incomplete, say so in the deliverable rather ' +
        'than leave it unwritten.');
      expect(s).not.toContain('Do NOT use any tools');
      expect(s).not.toContain('Your tools:');
    }
  });
  test('agent absent: behaviour is byte-identical to calling with two arguments (P2-R31)', () => {
    expect(st.seatToolsSentence(['read'], 'review', {})).toBe(st.seatToolsSentence(['read'], 'review'));
    expect(st.seatToolsSentence([], 'answer', { agent: null })).toBe(st.seatToolsSentence([], 'answer'));
  });
});
