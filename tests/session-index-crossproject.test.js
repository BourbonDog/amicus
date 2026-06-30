const fs = require('fs');
const os = require('os');
const path = require('path');

const { safeSessionDir } = require('../src/utils/validators');
const { recordSession } = require('../src/utils/session-index');
const { SESSIONS_DIR } = require('../src/session-manager');

describe('safeSessionDir cross-project lookup via global index (#40)', () => {
  let configDir, projA, projB, prevConfigDir;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idx-cfg-'));
    projA = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-projA-'));
    projB = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-projB-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    process.env.AMICUS_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    for (const d of [configDir, projA, projB]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('finds a session created under project A when looked up under project B', () => {
    const taskId = 'cross-task';
    // Create the real session dir under project A.
    const realDir = path.join(projA, '.claude', SESSIONS_DIR, taskId);
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, 'metadata.json'), JSON.stringify({ taskId }));
    // Index it (this is what session START will do).
    recordSession(taskId, projA);

    // Lookup under project B (the wrong default) must resolve to project A's dir.
    const resolved = safeSessionDir(projB, taskId);
    expect(resolved).toBe(path.resolve(realDir));
    expect(fs.existsSync(path.join(resolved, 'metadata.json'))).toBe(true);
  });

  it('does not consult the index when the session exists under the given project', () => {
    const taskId = 'local-task';
    const realDir = path.join(projB, '.claude', SESSIONS_DIR, taskId);
    fs.mkdirSync(realDir, { recursive: true });
    // Index points elsewhere, but the local dir exists, so it must win.
    recordSession(taskId, projA);
    const resolved = safeSessionDir(projB, taskId);
    expect(resolved).toBe(path.resolve(realDir));
  });

  it('falls back to the canonical local path when the index has no entry', () => {
    const taskId = 'missing-task';
    const resolved = safeSessionDir(projB, taskId);
    expect(resolved).toBe(path.resolve(path.join(projB, '.claude', SESSIONS_DIR, taskId)));
  });

  it('a corrupt index does not break safeSessionDir', () => {
    const taskId = 'corrupt-task';
    const { INDEX_FILENAME } = require('../src/utils/session-index');
    fs.writeFileSync(path.join(configDir, INDEX_FILENAME), 'garbage{');
    expect(() => safeSessionDir(projB, taskId)).not.toThrow();
    const resolved = safeSessionDir(projB, taskId);
    expect(resolved).toBe(path.resolve(path.join(projB, '.claude', SESSIONS_DIR, taskId)));
  });
});
