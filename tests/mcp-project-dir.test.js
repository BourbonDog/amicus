const os = require('os');
const fs = require('fs');
const path = require('path');
const { canonicalProjectPath } = require('../src/utils/project-path');

describe('getProjectDir', () => {
  let savedEnv;
  beforeEach(() => {
    jest.resetModules();
    // Resolution now consults AMICUS_PROJECT_DIR before cwd; isolate these tests.
    savedEnv = process.env.AMICUS_PROJECT_DIR;
    delete process.env.AMICUS_PROJECT_DIR;
  });
  afterEach(() => {
    if (savedEnv === undefined) { delete process.env.AMICUS_PROJECT_DIR; }
    else { process.env.AMICUS_PROJECT_DIR = savedEnv; }
  });

  test('returns explicit project path (canonicalized) when valid directory', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir(os.tmpdir());
    expect(result).toBe(canonicalProjectPath(os.tmpdir()));
  });

  test('ignores explicit project path when directory does not exist', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir('/nonexistent/path/that/does/not/exist');
    expect(result).not.toBe('/nonexistent/path/that/does/not/exist');
  });

  test('falls back to $HOME when cwd is root /', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir();
      expect(result).toBe(canonicalProjectPath(os.homedir()));
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('uses cwd when it is a valid writable directory', () => {
    const originalCwd = process.cwd;
    process.cwd = () => os.tmpdir();
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir();
      expect(result).toBe(canonicalProjectPath(os.tmpdir()));
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('returns $HOME when no explicit project and cwd is root', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir(undefined);
      expect(result).toBe(canonicalProjectPath(os.homedir()));
    } finally {
      process.cwd = originalCwd;
    }
  });
});

describe('MCP handler dispatch passes input.project', () => {
  test('amicus_list uses input.project when provided', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'test1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'test1', status: 'complete', model: 'gemini',
      createdAt: new Date().toISOString(),
    }));

    try {
      const { handlers } = require('../src/mcp-server');
      // Pass project via input (simulating MCP tool call with no 2nd arg)
      const result = await handlers.amicus_list({ project: tmpDir });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('test1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('amicus_status uses input.project when no 2nd arg', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'stat1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'stat1', status: 'running', model: 'gemini',
      createdAt: new Date().toISOString(),
    }));

    try {
      const { handlers } = require('../src/mcp-server');
      const result = await handlers.amicus_status({ taskId: 'stat1', project: tmpDir });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe('stat1');
      expect(parsed.status).toBe('running');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
