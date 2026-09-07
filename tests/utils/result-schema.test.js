// tests/utils/result-schema.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCHEMA_VERSION,
  buildRunResult,
  buildWaveResult,
  waveStatusFromLegs,
  waveExitCode,
  buildRunResultFromSession,
  buildWaveResultFromSession,
} = require('../../src/utils/result-schema');

describe('result-schema', () => {
  describe('buildRunResult', () => {
    const baseMeta = {
      model: 'openrouter/deepseek/deepseek-v4',
      agent: 'plan',
      createdAt: '2026-06-09T10:00:00.000Z',
      completedAt: '2026-06-09T10:03:04.211Z',
      status: 'complete',
      opencodeSessionId: 'ses_123',
    };

    it('maps a clean result to status complete with schemaVersion and duration', () => {
      const doc = buildRunResult({
        taskId: 'a1b2c3d4',
        metadata: baseMeta,
        result: { completed: true, timedOut: false, aborted: false },
        summary: 'all good',
        modelInput: 'deepseek',
        sessionDir: 'C:\\x\\a1b2c3d4',
      });
      expect(doc).toMatchObject({
        schemaVersion: SCHEMA_VERSION,
        type: 'run',
        taskId: 'a1b2c3d4',
        waveId: null,
        model: 'openrouter/deepseek/deepseek-v4',
        modelInput: 'deepseek',
        agent: 'plan',
        status: 'complete',
        summary: 'all good',
        error: null,
        opencodeSessionId: 'ses_123',
      });
      expect(doc.durationMs).toBe(184211);
    });

    it('maps result flags: error beats complete, timeout and aborted map to their statuses', () => {
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { error: 'boom' } }).status).toBe('error');
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { timedOut: true } }).status).toBe('timeout');
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { aborted: true } }).status).toBe('aborted');
      // precedence: aborted > timeout > error
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { aborted: true, timedOut: true, error: 'x' } }).status).toBe('aborted');
    });

    it('without a result object, passes through metadata.status (read of a live/legacy session)', () => {
      const doc = buildRunResult({ taskId: 't', metadata: { ...baseMeta, status: 'running', completedAt: null } });
      expect(doc.status).toBe('running');
      expect(doc.durationMs).toBeNull();
    });

    it('error field is null when complete, populated from result.error or metadata.reason otherwise', () => {
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: {} }).error).toBeNull();
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { error: 'boom' } }).error).toBe('boom');
      expect(buildRunResult({ taskId: 't', metadata: { ...baseMeta, status: 'error', reason: 'oops' } }).error).toBe('oops');
    });

    it('inherits waveId from metadata.parentWave when not given explicitly', () => {
      const doc = buildRunResult({ taskId: 't', metadata: { ...baseMeta, parentWave: 'deadbeef' } });
      expect(doc.waveId).toBe('deadbeef');
    });

    it('durationMs is null (not NaN) for malformed timestamps', () => {
      const doc = buildRunResult({
        taskId: 't',
        metadata: { createdAt: 'not-a-date', completedAt: 'also-bad', status: 'complete' },
      });
      expect(doc.durationMs).toBeNull();
    });

    it('attaches an explicit usage block, else falls back to metadata.usage, else null', () => {
      const usage = { tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' } };
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, usage }).usage).toEqual(usage);
      expect(buildRunResult({ taskId: 't', metadata: { ...baseMeta, usage } }).usage).toEqual(usage);
      expect(buildRunResult({ taskId: 't', metadata: baseMeta }).usage).toBeNull();
    });

    it('carries metadata.finish emit-when-set (#218 PR 3)', () => {
      const withFinish = buildRunResult({ taskId: 'f1', metadata: { ...baseMeta, finish: 'length' }, result: { completed: true }, summary: 'cut' });
      expect(withFinish.finish).toBe('length');
      const without = buildRunResult({ taskId: 'f2', metadata: baseMeta, result: { completed: true }, summary: 'ok' });
      expect('finish' in without).toBe(false);
      // Named mutant "FINISHCOERCED": `finish: metadata.finish || null` — the key appears as null.
      const bogus = buildRunResult({ taskId: 'f3', metadata: { ...baseMeta, finish: 7 }, result: { completed: true }, summary: 'ok' });
      expect('finish' in bogus).toBe(false);
    });

    it('carries metadata.variant and variantUnverified emit-when-set (#218 PR 4)', () => {
      const sent = buildRunResult({ taskId: 'v1', metadata: { ...baseMeta, variant: 'low' }, result: { completed: true }, summary: 's' });
      expect(sent.variant).toBe('low');
      expect('variantUnverified' in sent).toBe(false);
      const unverified = buildRunResult({ taskId: 'v2', metadata: { ...baseMeta, variant: 'medium', variantUnverified: true }, result: { completed: true }, summary: 's' });
      expect(unverified.variantUnverified).toBe(true);
      const without = buildRunResult({ taskId: 'v3', metadata: baseMeta, result: { completed: true }, summary: 's' });
      expect('variant' in without).toBe(false);
      expect('variantUnverified' in without).toBe(false);
      // Named mutants "VARIANTCOERCED" (`variant: metadata.variant || null`) and "UNVERIFIEDCOERCED" (`variantUnverified: !!metadata.variantUnverified`).
      const bogus = buildRunResult({ taskId: 'v4', metadata: { ...baseMeta, variant: 7, variantUnverified: 'yes' }, result: { completed: true }, summary: 's' });
      expect('variant' in bogus).toBe(false);
      expect('variantUnverified' in bogus).toBe(false);
    });
  });

  describe('waveStatusFromLegs + waveExitCode', () => {
    const leg = (status) => ({ status });

    it('all complete → complete → exit 0', () => {
      const s = waveStatusFromLegs([leg('complete'), leg('complete')]);
      expect(s).toBe('complete');
      expect(waveExitCode(s)).toBe(0);
    });

    it('some complete → partial → exit 2', () => {
      const s = waveStatusFromLegs([leg('complete'), leg('timeout'), leg('error')]);
      expect(s).toBe('partial');
      expect(waveExitCode(s)).toBe(2);
    });

    it('none complete → error → exit 1', () => {
      const s = waveStatusFromLegs([leg('error'), leg('timeout')]);
      expect(s).toBe('error');
      expect(waveExitCode(s)).toBe(1);
    });

    it('none complete but some aborted → aborted → exit 1', () => {
      const s = waveStatusFromLegs([leg('aborted'), leg('error')]);
      expect(s).toBe('aborted');
      expect(waveExitCode(s)).toBe(1);
    });

    it('empty legs array → error (never complete)', () => {
      expect(waveStatusFromLegs([])).toBe('error');
      expect(waveExitCode(waveStatusFromLegs([]))).toBe(1);
    });
  });

  describe('buildWaveResult', () => {
    it('assembles counts, status, prompt meta and timing', () => {
      const legs = [
        { status: 'complete', taskId: 'w-1' },
        { status: 'timeout', taskId: 'w-2' },
      ];
      const doc = buildWaveResult({
        waveId: 'deadbeef',
        legs,
        promptMeta: { source: 'file', file: 'C:\\b.md', chars: 41230 },
        createdAt: '2026-06-09T10:00:00.000Z',
        completedAt: '2026-06-09T10:05:12.456Z',
      });
      expect(doc).toMatchObject({
        schemaVersion: SCHEMA_VERSION,
        type: 'wave',
        waveId: 'deadbeef',
        status: 'partial',
        counts: { total: 2, complete: 1, error: 0, timeout: 1, aborted: 0 },
        prompt: { source: 'file', file: 'C:\\b.md', chars: 41230 },
      });
      expect(doc.durationMs).toBe(312456);
      expect(doc.legs).toHaveLength(2);
    });

    it('explicit status override wins over leg aggregation', () => {
      const doc = buildWaveResult({ waveId: 'w', legs: [{ status: 'complete' }], status: 'aborted' });
      expect(doc.status).toBe('aborted');
    });

    it('legs defaults to empty array without throwing', () => {
      const doc = buildWaveResult({ waveId: 'w' });
      expect(doc.counts.total).toBe(0);
      expect(doc.status).toBe('error');
    });

    it('aggregates leg usage into a wave usage block', () => {
      const u = (amount, source) => ({ tokens: { input: 5, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount, currency: 'USD', source } });
      const doc = buildWaveResult({ waveId: 'w', legs: [
        { status: 'complete', usage: u(0.1, 'reported') },
        { status: 'complete', usage: u(0.05, 'estimated') },
      ] });
      expect(doc.usage.tokens.input).toBe(10);
      expect(doc.usage.cost.amount).toBeCloseTo(0.15, 6);
      expect(doc.usage.cost.source).toBe('mixed');
    });
  });
});

describe('result-schema session rebuilders', () => {
  let project;

  const writeSession = (taskId, meta, summary) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    if (summary !== undefined) {
      fs.writeFileSync(path.join(dir, 'summary.md'), summary);
    }
    return dir;
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-schema-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('rebuilds a run doc from metadata + summary.md', () => {
    writeSession('aaaa1111', {
      model: 'openrouter/x/y', agent: 'plan', status: 'complete',
      createdAt: '2026-06-09T10:00:00.000Z', completedAt: '2026-06-09T10:01:00.000Z',
    }, 'the summary');
    const doc = buildRunResultFromSession(project, 'aaaa1111');
    expect(doc.type).toBe('run');
    expect(doc.status).toBe('complete');
    expect(doc.summary).toBe('the summary');
    expect(doc.durationMs).toBe(60000);
  });

  it('returns null summary when summary.md is missing', () => {
    writeSession('bbbb2222', { status: 'running', createdAt: '2026-06-09T10:00:00.000Z' });
    const doc = buildRunResultFromSession(project, 'bbbb2222');
    expect(doc.status).toBe('running');
    expect(doc.summary).toBeNull();
  });

  it('throws for a missing session', () => {
    expect(() => buildRunResultFromSession(project, 'nope0000')).toThrow(/not found/);
  });

  it('wave: prefers stored wave.json when present', () => {
    const waveDir = writeSession('cafe0001', { type: 'wave', status: 'complete', legs: ['cafe0001-1'] });
    fs.writeFileSync(path.join(waveDir, 'wave.json'), JSON.stringify({ schemaVersion: 1, type: 'wave', waveId: 'cafe0001', status: 'complete', legs: [] }));
    const doc = buildWaveResultFromSession(project, 'cafe0001');
    expect(doc.waveId).toBe('cafe0001');
    expect(doc.status).toBe('complete');
  });

  it('wave: rebuilds live from leg sessions when wave.json is missing', () => {
    writeSession('cafe0002', {
      type: 'wave', status: 'running', legs: ['cafe0002-1', 'cafe0002-2'],
      createdAt: '2026-06-09T10:00:00.000Z',
      promptMeta: { source: 'inline', file: null, chars: 5 },
    });
    writeSession('cafe0002-1', { model: 'a/b', status: 'complete', parentWave: 'cafe0002', createdAt: '2026-06-09T10:00:01.000Z', completedAt: '2026-06-09T10:01:00.000Z' }, 'leg one');
    writeSession('cafe0002-2', { model: 'c/d', status: 'error', reason: 'boom', parentWave: 'cafe0002', createdAt: '2026-06-09T10:00:01.000Z' });
    const doc = buildWaveResultFromSession(project, 'cafe0002');
    expect(doc.status).toBe('partial');
    expect(doc.counts).toMatchObject({ total: 2, complete: 1, error: 1 });
    expect(doc.legs[0].summary).toBe('leg one');
    expect(doc.legs[1].error).toBe('boom');
    expect(doc.prompt).toEqual({ source: 'inline', file: null, chars: 5 });
  });

  it('throws for a missing wave session', () => {
    expect(() => buildWaveResultFromSession(project, 'dead0000')).toThrow(/not found/);
  });

  it('corrupt wave.json falls back to live rebuild from legs', () => {
    const waveDir = writeSession('cafe0003', {
      type: 'wave', status: 'running', legs: ['cafe0003-1'],
      createdAt: '2026-06-09T10:00:00.000Z',
    });
    fs.writeFileSync(path.join(waveDir, 'wave.json'), '{ this is not valid json');
    writeSession('cafe0003-1', { model: 'a/b', status: 'complete', parentWave: 'cafe0003' }, 'leg ok');
    const doc = buildWaveResultFromSession(project, 'cafe0003');
    expect(doc.status).toBe('complete');
    expect(doc.legs[0].summary).toBe('leg ok');
  });

  it('waveStatusFromLegs: any running leg → running', () => {
    const { waveStatusFromLegs } = require('../../src/utils/result-schema');
    expect(waveStatusFromLegs([{ status: 'complete' }, { status: 'running' }])).toBe('running');
  });
});
