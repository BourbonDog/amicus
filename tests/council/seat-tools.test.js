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
    expect(a.permission).toEqual({ edit: 'deny', bash: 'allow', webfetch: 'deny', external_directory: 'deny' });
  });
  test('never emits a chat key (buildServerOptions merges after chat)', () => {
    expect(Object.keys(st.buildCouncilAgents({ tools: [], local: false })).sort())
      .toEqual(['council-seat', 'council-support']);
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
});
