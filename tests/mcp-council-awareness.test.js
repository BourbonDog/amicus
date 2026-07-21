// tests/mcp-council-awareness.test.js
'use strict';
/**
 * Defensive paths in the council-awareness helpers. A wave's metadata.json is
 * read straight off disk, so a half-written or hand-edited record must not take
 * down a status read or an abort cascade — these pin the shapes that used to
 * throw past their callers.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmp;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cawareness-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  jest.resetModules();
});

const sessionDir = (id) => path.join(tmp, '.claude', 'amicus_sessions', id);

/** Write one session metadata.json verbatim (no shape validation). */
function writeMeta(id, meta) {
  fs.mkdirSync(sessionDir(id), { recursive: true });
  fs.writeFileSync(path.join(sessionDir(id), 'metadata.json'), JSON.stringify(meta));
}

describe('countWaveLegs vs. a malformed legs field', () => {
  test.each([
    ['an object', { a: 1 }],
    ['a number', 5],
    ['a string', 'two'],
  ])('%s does not throw out of the status read', (_label, legs) => {
    writeMeta('w1', { taskId: 'w1', type: 'wave', status: 'running', legs });
    const { countWaveLegs } = require('../src/mcp-council-awareness');
    expect(countWaveLegs(tmp, 'w1')).toEqual({ total: 0, complete: 0 });
  });

  test('a missing legs field still reads as no legs', () => {
    writeMeta('w1', { taskId: 'w1', type: 'wave', status: 'running' });
    const { countWaveLegs } = require('../src/mcp-council-awareness');
    expect(countWaveLegs(tmp, 'w1')).toEqual({ total: 0, complete: 0 });
  });

  test('an absent wave record is still null, not a zero count', () => {
    const { countWaveLegs } = require('../src/mcp-council-awareness');
    expect(countWaveLegs(tmp, 'nope')).toBeNull();
  });

  test('a well-formed record still counts terminal legs', () => {
    writeMeta('w1', { taskId: 'w1', type: 'wave', status: 'running', legs: ['w1-1', 'w1-2'] });
    writeMeta('w1-1', { taskId: 'w1-1', status: 'complete' });
    writeMeta('w1-2', { taskId: 'w1-2', status: 'running' });
    const { countWaveLegs } = require('../src/mcp-council-awareness');
    expect(countWaveLegs(tmp, 'w1')).toEqual({ total: 2, complete: 1 });
  });
});

describe('cascadeWave', () => {
  test('a malformed legs field does not throw, and the wave is still marked', () => {
    const marked = [];
    jest.doMock('../src/utils/session-abort', () => ({
      markAborted: (dir) => { marked.push(path.basename(dir)); return true; },
    }));
    writeMeta('w1', { taskId: 'w1', type: 'wave', status: 'running', legs: { bogus: true } });
    const { cascadeWave } = require('../src/mcp-council-awareness');
    expect(cascadeWave(tmp, 'w1')).toBe(0);
    expect(marked).toEqual(['w1']);
  });

  test('a failing wave-level mark does not discard the legs already counted', () => {
    jest.doMock('../src/utils/session-abort', () => ({
      markAborted: (dir) => {
        if (path.basename(dir) === 'w1') { throw new Error('wave mark failed'); }
        return true;
      },
    }));
    writeMeta('w1', { taskId: 'w1', type: 'wave', status: 'running', legs: ['w1-1', 'w1-2'] });
    const { cascadeWave } = require('../src/mcp-council-awareness');
    // Both legs were really marked; losing that count to a wave-level throw
    // would under-report legsAborted to the caller.
    expect(cascadeWave(tmp, 'w1')).toBe(2);
  });
});
