// tests/utils/result-schema.test.js
'use strict';

const {
  SCHEMA_VERSION,
  buildRunResult,
  buildWaveResult,
  waveStatusFromLegs,
  waveExitCode,
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
  });
});
