const os = require('os');
const fs = require('fs');
const path = require('path');
const { canonicalProjectPath } = require('../src/utils/project-path');

describe('getProjectDir — AMICUS_PROJECT_DIR env override', () => {
  let savedEnv;
  beforeEach(() => {
    jest.resetModules();
    savedEnv = process.env.AMICUS_PROJECT_DIR;
    delete process.env.AMICUS_PROJECT_DIR;
  });
  afterEach(() => {
    if (savedEnv === undefined) { delete process.env.AMICUS_PROJECT_DIR; }
    else { process.env.AMICUS_PROJECT_DIR = savedEnv; }
  });

  test('AMICUS_PROJECT_DIR is used when set and explicit project omitted', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apd-'));
    try {
      process.env.AMICUS_PROJECT_DIR = tmp;
      const { getProjectDir } = require('../src/mcp-server');
      expect(getProjectDir()).toBe(canonicalProjectPath(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('AMICUS_PROJECT_DIR takes precedence over cwd', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apd-'));
    const originalCwd = process.cwd;
    process.cwd = () => os.tmpdir();
    try {
      process.env.AMICUS_PROJECT_DIR = tmp;
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      expect(getProjectDir()).toBe(canonicalProjectPath(tmp));
    } finally {
      process.cwd = originalCwd;
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('explicit project arg still wins over AMICUS_PROJECT_DIR', () => {
    const explicit = fs.mkdtempSync(path.join(os.tmpdir(), 'apd-exp-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apd-env-'));
    try {
      process.env.AMICUS_PROJECT_DIR = envDir;
      const { getProjectDir } = require('../src/mcp-server');
      expect(getProjectDir(explicit)).toBe(canonicalProjectPath(explicit));
    } finally {
      fs.rmSync(explicit, { recursive: true });
      fs.rmSync(envDir, { recursive: true });
    }
  });

  test('AMICUS_PROJECT_DIR ignored when it does not exist (falls through)', () => {
    process.env.AMICUS_PROJECT_DIR = '/nonexistent/amicus/project/dir';
    const { getProjectDir } = require('../src/mcp-server');
    expect(getProjectDir()).not.toBe('/nonexistent/amicus/project/dir');
  });

  test('resolved explicit value is canonicalProjectPath-normalized', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apd-canon-'));
    // append a trailing slash + duplicate sep to force normalization to differ
    const messy = `${tmp}/`;
    try {
      const { getProjectDir } = require('../src/mcp-server');
      expect(getProjectDir(messy)).toBe(canonicalProjectPath(messy));
      expect(getProjectDir(messy)).toBe(canonicalProjectPath(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

describe('resolveProjectDir — MCP roots round-trip', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.AMICUS_PROJECT_DIR;
  });

  // Mirror the real McpServer wrapper: a `.server` (core) with getClientCapabilities
  // + listRoots. resolveProjectDir takes the wrapper, not the core.
  function makeFakeServer(roots, capabilities = { roots: {} }) {
    const calls = { listRoots: 0 };
    return {
      calls,
      server: {
        server: {
          getClientCapabilities: () => capabilities,
          listRoots: async () => {
            calls.listRoots += 1;
            return { roots };
          },
        },
      },
    };
  }

  test('uses client first file:// root when project omitted', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'root-'));
    try {
      const { resolveProjectDir } = require('../src/mcp-server');
      const fileUrl = require('url').pathToFileURL(tmp).href;
      const { server } = makeFakeServer([{ uri: fileUrl, name: 'proj' }]);
      const result = await resolveProjectDir(undefined, server);
      expect(result).toBe(canonicalProjectPath(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('skips non-file:// roots and picks first file:// root', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'root-'));
    try {
      const { resolveProjectDir } = require('../src/mcp-server');
      const fileUrl = require('url').pathToFileURL(tmp).href;
      const { server } = makeFakeServer([
        { uri: 'https://example.com/x' },
        { uri: fileUrl },
      ]);
      const result = await resolveProjectDir(undefined, server);
      expect(result).toBe(canonicalProjectPath(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('explicit project still wins over roots (no roots round-trip needed)', async () => {
    const explicit = fs.mkdtempSync(path.join(os.tmpdir(), 'root-exp-'));
    try {
      const { resolveProjectDir } = require('../src/mcp-server');
      const { server, calls } = makeFakeServer([
        { uri: require('url').pathToFileURL(os.tmpdir()).href },
      ]);
      const result = await resolveProjectDir(explicit, server);
      expect(result).toBe(canonicalProjectPath(explicit));
      expect(calls.listRoots).toBe(0);
    } finally {
      fs.rmSync(explicit, { recursive: true });
    }
  });

  test('AMICUS_PROJECT_DIR wins over roots', async () => {
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-env-'));
    try {
      process.env.AMICUS_PROJECT_DIR = envDir;
      const { resolveProjectDir } = require('../src/mcp-server');
      const { server, calls } = makeFakeServer([
        { uri: require('url').pathToFileURL(os.tmpdir()).href },
      ]);
      const result = await resolveProjectDir(undefined, server);
      expect(result).toBe(canonicalProjectPath(envDir));
      expect(calls.listRoots).toBe(0);
    } finally {
      fs.rmSync(envDir, { recursive: true });
    }
  });

  test('falls back to cwd when client has no roots capability', async () => {
    const originalCwd = process.cwd;
    process.cwd = () => os.tmpdir();
    try {
      jest.resetModules();
      const { resolveProjectDir } = require('../src/mcp-server');
      const { server, calls } = makeFakeServer([], null); // no roots capability
      const result = await resolveProjectDir(undefined, server);
      expect(result).toBe(canonicalProjectPath(os.tmpdir()));
      expect(calls.listRoots).toBe(0);
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('caches roots — listRoots called at most once across calls', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'root-cache-'));
    try {
      const { resolveProjectDir } = require('../src/mcp-server');
      const fileUrl = require('url').pathToFileURL(tmp).href;
      const { server, calls } = makeFakeServer([{ uri: fileUrl }]);
      await resolveProjectDir(undefined, server);
      await resolveProjectDir(undefined, server);
      expect(calls.listRoots).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('survives a listRoots failure by falling back to cwd', async () => {
    const originalCwd = process.cwd;
    process.cwd = () => os.tmpdir();
    try {
      jest.resetModules();
      const { resolveProjectDir } = require('../src/mcp-server');
      const server = {
        server: {
          getClientCapabilities: () => ({ roots: {} }),
          listRoots: async () => { throw new Error('client refused'); },
        },
      };
      const result = await resolveProjectDir(undefined, server);
      expect(result).toBe(canonicalProjectPath(os.tmpdir()));
    } finally {
      process.cwd = originalCwd;
    }
  });
});

describe('resolved project flows into session path / context / prompt', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.AMICUS_PROJECT_DIR;
  });

  test('AMICUS_PROJECT_DIR root reaches the session store path used by amicus_list', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-'));
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', 'flow1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'flow1', status: 'complete', model: 'gemini',
      createdAt: new Date().toISOString(),
    }));
    try {
      process.env.AMICUS_PROJECT_DIR = tmpDir;
      const { handlers, getProjectDir } = require('../src/mcp-server');
      // Simulate the dispatch site resolving project from env (no input.project)
      const result = await handlers.amicus_list({}, getProjectDir(undefined));
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('flow1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('buildPrompts embeds the canonical project path in the system prompt', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-'));
    try {
      const { getProjectDir } = require('../src/mcp-server');
      const { buildPrompts } = require('../src/prompt-builder');
      const project = getProjectDir(`${tmp}/`);
      // headless mode now requires a per-run nonce (15b.3/#BL-7); this test
      // only asserts the project path, so any valid nonce suffices.
      const { system } = buildPrompts('hello', null, project, true, undefined, undefined, undefined, '0f1e2d3c4b5a6978');
      expect(system).toContain(`Project: ${canonicalProjectPath(tmp)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});
