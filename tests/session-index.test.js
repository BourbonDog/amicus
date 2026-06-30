const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  recordSession,
  lookupSessionProject,
  INDEX_FILENAME,
} = require('../src/utils/session-index');

describe('session-index (global taskId -> project map)', () => {
  let configDir;
  let prevConfigDir;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idx-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    process.env.AMICUS_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.AMICUS_CONFIG_DIR;
    } else {
      process.env.AMICUS_CONFIG_DIR = prevConfigDir;
    }
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('records a taskId -> canonical project path and looks it up', () => {
    // Use a non-canonical spelling: backslashes + trailing slash + lowercase drive
    recordSession('task-a', 'c:\\Users\\me\\projA\\');
    expect(lookupSessionProject('task-a')).toBe('C:/Users/me/projA');
  });

  it('returns null for an unknown taskId', () => {
    recordSession('task-a', '/home/me/projA');
    expect(lookupSessionProject('nope')).toBeNull();
  });

  it('persists multiple sessions in the same index file', () => {
    recordSession('task-a', '/home/me/projA');
    recordSession('task-b', '/home/me/projB');
    expect(lookupSessionProject('task-a')).toBe('/home/me/projA');
    expect(lookupSessionProject('task-b')).toBe('/home/me/projB');
    const indexPath = path.join(configDir, INDEX_FILENAME);
    expect(fs.existsSync(indexPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(['task-a', 'task-b']));
  });

  it('does not corrupt the index under many concurrent writes (atomic)', () => {
    const n = 50;
    // Fire all writes "simultaneously": each must land without clobbering others.
    for (let i = 0; i < n; i++) {
      recordSession(`task-${i}`, `/home/me/proj${i}`);
    }
    // Index must remain valid JSON and contain every entry.
    const indexPath = path.join(configDir, INDEX_FILENAME);
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(Object.keys(parsed)).toHaveLength(n);
    for (let i = 0; i < n; i++) {
      expect(lookupSessionProject(`task-${i}`)).toBe(`/home/me/proj${i}`);
    }
    // No stray temp files left behind.
    const leftovers = fs.readdirSync(configDir).filter(f => f !== INDEX_FILENAME);
    expect(leftovers).toEqual([]);
  });

  it('a corrupt index file never throws on lookup (falls back to null)', () => {
    const indexPath = path.join(configDir, INDEX_FILENAME);
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(indexPath, '{ this is not: valid json');
    expect(() => lookupSessionProject('task-a')).not.toThrow();
    expect(lookupSessionProject('task-a')).toBeNull();
  });

  it('a corrupt index file never throws on record (recovers to a fresh map)', () => {
    const indexPath = path.join(configDir, INDEX_FILENAME);
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(indexPath, 'not json at all');
    expect(() => recordSession('task-a', '/home/me/projA')).not.toThrow();
    expect(lookupSessionProject('task-a')).toBe('/home/me/projA');
  });
});
