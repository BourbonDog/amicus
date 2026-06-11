# DeepSeek Direct API Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete DeepSeek direct-API support so users can add a `DEEPSEEK_API_KEY` via the Electron setup wizard or a new `amicus key` CLI command and use DeepSeek models directly (not only through OpenRouter).

**Architecture:** Four focused changes to existing config-driven modules (`model-fetcher`, `setup-ui-keys`, `curated-models`, `cli-handlers`/`amicus.js`) plus a new `amicus key` command for headless key management. No new abstractions — every change follows the existing pattern of adding an entry to the relevant config object.

**Tech Stack:** Node.js 18+, Jest 29, HTTPS module (no SDK), Electron IPC (existing), readline (existing).

---

## Gap Analysis (Current State)

These are the only things missing — everything else (env map, validation, save/remove, key store) already works:

| File | Gap |
|------|-----|
| `src/utils/model-fetcher.js` | `deepseek` absent from `PROVIDER_FETCH_CONFIG` and `PROVIDER_FAMILY_NAMES` — models cannot be fetched |
| `electron/setup-ui-keys.js` | `deepseek` absent from `PROVIDERS` array — Electron wizard has no DeepSeek option |
| `src/utils/curated-models.js` | `deepseek` CARD has no direct `deepseek:` route — can't route sessions to the DeepSeek API |
| `src/cli-handlers.js` + `bin/amicus.js` | No `amicus key` command — headless key management requires the Electron wizard |
| `tests/model-fetcher.test.js` | File does not exist — zero test coverage for model fetching |

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/utils/model-fetcher.js` | Add deepseek to `PROVIDER_FETCH_CONFIG` and `PROVIDER_FAMILY_NAMES` |
| Modify | `electron/setup-ui-keys.js` | Add deepseek to `PROVIDERS` array |
| Modify | `src/utils/curated-models.js` | Add direct `deepseek` route to deepseek CARD |
| Modify | `src/cli-handlers.js` | Add `handleKey(args)` function |
| Modify | `bin/amicus.js` | Add `key` case to the command switch |
| Modify | `src/cli.js` | Register `key` boolean flag and add usage text |
| Create | `tests/model-fetcher.test.js` | Unit tests for model fetching (all providers) |

---

## Task 1: Add DeepSeek to model-fetcher.js

**Files:**
- Modify: `src/utils/model-fetcher.js:19-24` (PROVIDER_FAMILY_NAMES)
- Modify: `src/utils/model-fetcher.js:27-72` (PROVIDER_FETCH_CONFIG)
- Create: `tests/model-fetcher.test.js`

DeepSeek's `/models` endpoint returns an OpenAI-compatible payload:
`{"object":"list","data":[{"id":"deepseek-chat","object":"model"},{"id":"deepseek-reasoner","object":"model"}]}`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/model-fetcher.test.js`:

```javascript
'use strict';
const https = require('https');
const { EventEmitter } = require('events');
jest.mock('https');

const {
  fetchModelsFromProvider,
  fetchAllModels,
  groupModelsByFamily,
  PROVIDER_FETCH_CONFIG,
  PROVIDER_FAMILY_NAMES,
  ANTHROPIC_MODELS,
} = require('../src/utils/model-fetcher');

function mockHttpsGet(statusCode, body) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  https.get.mockImplementation((_url, _opts, cb) => {
    const req = new EventEmitter();
    req.destroy = jest.fn();
    setTimeout(() => {
      cb(res);
      res.emit('data', body);
      res.emit('end');
    }, 0);
    return req;
  });
  return res;
}

describe('PROVIDER_FETCH_CONFIG', () => {
  test('deepseek entry exists', () => {
    expect(PROVIDER_FETCH_CONFIG.deepseek).toBeDefined();
    expect(PROVIDER_FETCH_CONFIG.deepseek.url).toBe('https://api.deepseek.com/models');
  });

  test('deepseek authHeader returns Bearer header', () => {
    const headers = PROVIDER_FETCH_CONFIG.deepseek.authHeader('sk-test');
    expect(headers).toEqual({ Authorization: 'Bearer sk-test' });
  });

  test('deepseek normalize maps OpenAI-compatible response', () => {
    const body = JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-chat', object: 'model' },
        { id: 'deepseek-reasoner', object: 'model' },
      ],
    });
    const result = PROVIDER_FETCH_CONFIG.deepseek.normalize(body);
    expect(result).toEqual([
      { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', contextLength: null, pricing: null },
      { id: 'deepseek/deepseek-reasoner', name: 'deepseek-reasoner', contextLength: null, pricing: null },
    ]);
  });

  test('deepseek normalize returns [] on empty data array', () => {
    const result = PROVIDER_FETCH_CONFIG.deepseek.normalize(JSON.stringify({ data: [] }));
    expect(result).toEqual([]);
  });
});

describe('PROVIDER_FAMILY_NAMES', () => {
  test('deepseek family name is "DeepSeek"', () => {
    expect(PROVIDER_FAMILY_NAMES.deepseek).toBe('DeepSeek');
  });
});

describe('fetchModelsFromProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  test('fetches deepseek models on 200', async () => {
    mockHttpsGet(200, JSON.stringify({
      data: [{ id: 'deepseek-chat', object: 'model' }],
    }));
    const models = await fetchModelsFromProvider('deepseek', 'sk-test');
    expect(models).toEqual([
      { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', contextLength: null, pricing: null },
    ]);
  });

  test('returns [] for deepseek on 401', async () => {
    mockHttpsGet(401, '{"error":"unauthorized"}');
    const models = await fetchModelsFromProvider('deepseek', 'bad-key');
    expect(models).toEqual([]);
  });

  test('returns [] for deepseek on network error', async () => {
    https.get.mockImplementation((_url, _opts, _cb) => {
      const req = new EventEmitter();
      req.destroy = jest.fn();
      setTimeout(() => req.emit('error', new Error('ECONNREFUSED')), 0);
      return req;
    });
    const models = await fetchModelsFromProvider('deepseek', 'sk-test');
    expect(models).toEqual([]);
  });

  test('returns ANTHROPIC_MODELS for anthropic (hardcoded)', async () => {
    const models = await fetchModelsFromProvider('anthropic', '');
    expect(models).toEqual(ANTHROPIC_MODELS);
    expect(https.get).not.toHaveBeenCalled();
  });
});

describe('groupModelsByFamily', () => {
  test('labels deepseek group as "DeepSeek"', () => {
    const models = [
      { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', contextLength: null, pricing: null },
    ];
    const groups = groupModelsByFamily(models);
    expect(groups).toEqual([
      { family: 'DeepSeek', models },
    ]);
  });
});

describe('fetchAllModels', () => {
  beforeEach(() => jest.clearAllMocks());

  test('includes deepseek when deepseek key is present', async () => {
    mockHttpsGet(200, JSON.stringify({
      data: [{ id: 'deepseek-chat', object: 'model' }],
    }));
    const result = await fetchAllModels({ deepseek: 'sk-test' });
    const ids = result.map(m => m.id);
    expect(ids).toContain('deepseek/deepseek-chat');
  });
});
```

- [ ] **Step 1.2: Run the tests to confirm they fail**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/model-fetcher.test.js --no-coverage
```

Expected: FAIL — "deepseek entry exists" fails because PROVIDER_FETCH_CONFIG has no deepseek key.

- [ ] **Step 1.3: Add deepseek to `PROVIDER_FAMILY_NAMES` and `PROVIDER_FETCH_CONFIG`**

In `src/utils/model-fetcher.js`, replace lines 19-24 (PROVIDER_FAMILY_NAMES):

```javascript
const PROVIDER_FAMILY_NAMES = {
  openrouter: 'OpenRouter',
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek'
};
```

In `src/utils/model-fetcher.js`, replace the closing `}` of the `PROVIDER_FETCH_CONFIG` block (after the openai entry, currently line 71-72) to add:

```javascript
  // ... existing openai entry ends here ...
  ,
  deepseek: {
    url: 'https://api.deepseek.com/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `deepseek/${m.id}`,
        name: m.id,
        contextLength: null,
        pricing: null
      }));
    }
  }
};
```

The full `PROVIDER_FETCH_CONFIG` block after the edit (lines 27-73):

```javascript
/** Provider API configs for fetching model lists */
const PROVIDER_FETCH_CONFIG = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    authHeader: (key) => (key ? { 'Authorization': `Bearer ${key}` } : {}),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `openrouter/${m.id}`,
        name: m.name || m.id,
        contextLength: m.context_length ?? null,
        pricing: m.pricing
          ? { prompt: m.pricing.prompt ?? null,
              completion: m.pricing.completion ?? null }
          : null
      }));
    }
  },
  google: {
    url: null,
    authHeader: () => ({}),
    buildUrl: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.models || []).map(m => ({
        id: `google/${m.name.replace('models/', '')}`,
        name: m.displayName || m.name.replace('models/', ''),
        contextLength: m.inputTokenLimit ?? null,
        pricing: null
      }));
    }
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `openai/${m.id}`,
        name: m.id,
        contextLength: null,
        pricing: null
      }));
    }
  },
  deepseek: {
    url: 'https://api.deepseek.com/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `deepseek/${m.id}`,
        name: m.id,
        contextLength: null,
        pricing: null
      }));
    }
  }
};
```

- [ ] **Step 1.4: Run the tests to confirm they pass**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/model-fetcher.test.js --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 1.5: Run the full test suite to check for regressions**

```
cd /c/Users/sendt/dev/amicus && npm test
```

Expected: All existing tests still PASS.

- [ ] **Step 1.6: Commit**

```bash
git add src/utils/model-fetcher.js tests/model-fetcher.test.js
git commit -m "feat: add DeepSeek to model-fetcher PROVIDER_FETCH_CONFIG and tests"
```

---

## Task 2: Add DeepSeek to Electron Setup Wizard

**Files:**
- Modify: `electron/setup-ui-keys.js:10-47` (PROVIDERS array)

- [ ] **Step 2.1: Write the failing test**

Add to `tests/model-fetcher.test.js` a new describe block at the bottom (no new file needed):

Actually, the UI is HTML-generating code. Add a test file for the setup-ui:

Create `tests/electron/setup-ui-keys.test.js`:

```javascript
'use strict';
const { buildKeysStepHTML, PROVIDERS } = require('../../electron/setup-ui-keys');

describe('PROVIDERS', () => {
  test('deepseek provider is in the list', () => {
    const ds = PROVIDERS.find(p => p.id === 'deepseek');
    expect(ds).toBeDefined();
    expect(ds.name).toBe('DeepSeek');
    expect(ds.placeholder).toMatch(/^sk-/);
    expect(ds.helpUrl).toContain('deepseek');
    expect(ds.recommended).toBe(false);
  });

  test('PROVIDERS has exactly 5 entries', () => {
    expect(PROVIDERS).toHaveLength(5);
  });
});

describe('buildKeysStepHTML', () => {
  test('renders deepseek provider button', () => {
    const html = buildKeysStepHTML(PROVIDERS);
    expect(html).toContain('data-provider="deepseek"');
    expect(html).toContain('DeepSeek');
  });
});
```

- [ ] **Step 2.2: Run to confirm failure**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-keys.test.js --no-coverage
```

Expected: FAIL — deepseek not found in PROVIDERS.

- [ ] **Step 2.3: Add deepseek to PROVIDERS in `electron/setup-ui-keys.js`**

Replace lines 10-47 (the entire PROVIDERS array):

```javascript
/** Provider metadata for the setup form */
const PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access all models (Gemini, GPT, Claude, etc.) with one key',
    placeholder: 'sk-or-v1-...',
    helpUrl: 'https://openrouter.ai/keys',
    helpLabel: 'openrouter.ai/keys',
    recommended: true
  },
  {
    id: 'google',
    name: 'Google AI (Gemini)',
    description: 'Direct access to Gemini models',
    placeholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
    helpLabel: 'aistudio.google.com/apikey',
    recommended: false
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Direct access to GPT models',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    helpLabel: 'platform.openai.com/api-keys',
    recommended: false
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Direct access to Claude models',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpLabel: 'console.anthropic.com/settings/keys',
    recommended: false
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Direct access to DeepSeek-V3 and DeepSeek-R1 models',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    helpLabel: 'platform.deepseek.com/api_keys',
    recommended: false
  }
];
```

- [ ] **Step 2.4: Run the tests to confirm they pass**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/electron/setup-ui-keys.test.js --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 2.5: Run the full test suite**

```
cd /c/Users/sendt/dev/amicus && npm test
```

Expected: All tests PASS.

- [ ] **Step 2.6: Commit**

```bash
git add electron/setup-ui-keys.js tests/electron/setup-ui-keys.test.js
git commit -m "feat: add DeepSeek to Electron setup wizard API key step"
```

---

## Task 3: Add Direct DeepSeek Route to Curated Models

**Files:**
- Modify: `src/utils/curated-models.js:33-35` (deepseek CARD routes)

The current deepseek CARD only routes through OpenRouter. Adding a direct route lets the wizard offer DeepSeek as a routing option when a `DEEPSEEK_API_KEY` is configured, and lets `amicus start --model deepseek` work without an OpenRouter key.

DeepSeek's primary chat model ID (as returned by `GET /models`) is `deepseek-chat`.

- [ ] **Step 3.1: Write the failing test**

Add to `tests/model-fetcher.test.js`:

```javascript
const { listCuratedRoutes, toDefaultAliases } = require('../src/utils/curated-models');

describe('curated-models deepseek routes', () => {
  test('deepseek CARD has a direct deepseek route', () => {
    const routes = listCuratedRoutes();
    const direct = routes.find(r => r.alias === 'deepseek' && r.provider === 'deepseek');
    expect(direct).toBeDefined();
    expect(direct.model).toBe('deepseek/deepseek-chat');
  });

  test('toDefaultAliases deepseek still prefers openrouter route', () => {
    const aliases = toDefaultAliases();
    expect(aliases.deepseek).toMatch(/^openrouter\//);
  });
});
```

- [ ] **Step 3.2: Run to confirm failure**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/model-fetcher.test.js --no-coverage -t "curated-models"
```

Expected: FAIL — no direct deepseek route found.

- [ ] **Step 3.3: Add direct deepseek route to the deepseek CARD**

In `src/utils/curated-models.js`, replace lines 33-35 (the deepseek CARD entry):

```javascript
  { alias: 'deepseek', label: 'DeepSeek v3.2', blurb: 'open-source',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v3.2',
              deepseek: 'deepseek/deepseek-chat' } },
```

- [ ] **Step 3.4: Run the tests to confirm they pass**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/model-fetcher.test.js --no-coverage -t "curated-models"
```

Expected: All tests PASS.

- [ ] **Step 3.5: Run the full test suite**

```
cd /c/Users/sendt/dev/amicus && npm test
```

Expected: All tests PASS.

- [ ] **Step 3.6: Commit**

```bash
git add src/utils/curated-models.js tests/model-fetcher.test.js
git commit -m "feat: add direct deepseek route to deepseek curated-models CARD"
```

---

## Task 4: Add `amicus key` CLI Command

**Files:**
- Modify: `src/cli-handlers.js` (add `handleKey`)
- Modify: `bin/amicus.js` (add `key` case)
- Modify: `src/cli.js` (add `--remove` boolean flag, add usage text)
- Create: `tests/cli-key.test.js`

Usage: 
```
amicus key deepseek sk-abc123     # validate and save
amicus key deepseek --remove      # remove
amicus key                        # list all configured providers
```

- [ ] **Step 4.1: Write the failing tests**

Create `tests/cli-key.test.js`:

```javascript
'use strict';

// We test handleKey by mocking the store and validation dependencies.
jest.mock('../src/utils/api-key-store', () => ({
  readApiKeys: jest.fn(),
  readApiKeyHints: jest.fn(),
  saveApiKey: jest.fn(),
  removeApiKey: jest.fn(),
  PROVIDER_ENV_MAP: {
    openrouter: 'OPENROUTER_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  },
}));
jest.mock('../src/utils/api-key-validation', () => ({
  validateApiKey: jest.fn(),
}));

const { readApiKeys, readApiKeyHints, saveApiKey, removeApiKey } = require('../src/utils/api-key-store');
const { validateApiKey } = require('../src/utils/api-key-validation');
const { handleKey } = require('../src/cli-handlers');

let consoleSpy;
let consoleErrSpy;

beforeEach(() => {
  jest.clearAllMocks();
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleSpy.mockRestore();
  consoleErrSpy.mockRestore();
});

describe('handleKey — list (no provider)', () => {
  test('prints configured providers', async () => {
    readApiKeys.mockReturnValue({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: true });
    readApiKeyHints.mockReturnValue({ openrouter: 'sk-or-v1-', google: false, openai: false, anthropic: false, deepseek: 'sk-abc1' });

    await handleKey({ _: ['key'] });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('openrouter'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('deepseek'));
  });
});

describe('handleKey — save', () => {
  test('validates and saves a valid deepseek key', async () => {
    validateApiKey.mockResolvedValue({ valid: true });
    saveApiKey.mockReturnValue({ success: true });

    await handleKey({ _: ['key', 'deepseek', 'sk-test123'] });

    expect(validateApiKey).toHaveBeenCalledWith('deepseek', 'sk-test123');
    expect(saveApiKey).toHaveBeenCalledWith('deepseek', 'sk-test123');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('saved'));
  });

  test('prints error for invalid key', async () => {
    validateApiKey.mockResolvedValue({ valid: false, error: 'Invalid API key (401)' });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(handleKey({ _: ['key', 'deepseek', 'bad-key'] })).rejects.toThrow('exit');
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid API key'));
    exitSpy.mockRestore();
  });

  test('prints error for unknown provider', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(handleKey({ _: ['key', 'fakeai', 'sk-abc'] })).rejects.toThrow('exit');
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown provider'));
    exitSpy.mockRestore();
  });
});

describe('handleKey — remove', () => {
  test('removes deepseek key', async () => {
    removeApiKey.mockReturnValue({ success: true });

    await handleKey({ _: ['key', 'deepseek'], remove: true });

    expect(removeApiKey).toHaveBeenCalledWith('deepseek');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('removed'));
  });
});
```

- [ ] **Step 4.2: Run to confirm failure**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/cli-key.test.js --no-coverage
```

Expected: FAIL — `handleKey` not exported from cli-handlers.

- [ ] **Step 4.3: Add `handleKey` to `src/cli-handlers.js`**

Add the following function before the `module.exports` at the end of `src/cli-handlers.js`:

```javascript
/**
 * Handle 'amicus key' command
 * Lists, saves, or removes API keys for a provider without opening the Electron wizard.
 *
 * Usage:
 *   amicus key                         -- list all configured providers
 *   amicus key <provider> <apikey>     -- validate and save key
 *   amicus key <provider> --remove     -- remove key
 */
async function handleKey(args) {
  const { readApiKeys, readApiKeyHints, saveApiKey, removeApiKey, PROVIDER_ENV_MAP } = require('./utils/api-key-store');
  const { validateApiKey } = require('./utils/api-key-validation');

  const provider = args._[1];
  const keyArg = args._[2];

  // List mode: no provider given
  if (!provider) {
    const configured = readApiKeys();
    const hints = readApiKeyHints();
    const knownProviders = Object.keys(PROVIDER_ENV_MAP);
    console.log('');
    console.log('Configured API keys:');
    for (const p of knownProviders) {
      const status = configured[p] ? `✓  ${hints[p]}` : '✗  not set';
      console.log(`  ${p.padEnd(12)} ${status}`);
    }
    console.log('');
    return;
  }

  // Validate provider
  if (!PROVIDER_ENV_MAP[provider]) {
    console.error(`Error: Unknown provider "${provider}". Known providers: ${Object.keys(PROVIDER_ENV_MAP).join(', ')}`);
    process.exit(1);
  }

  // Remove mode
  if (args.remove) {
    const result = removeApiKey(provider);
    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
    console.log(`${provider} key removed.`);
    return;
  }

  // Save mode: key required
  if (!keyArg) {
    console.error(`Error: API key is required. Usage: amicus key ${provider} <apikey>`);
    process.exit(1);
  }

  console.log(`Validating ${provider} key...`);
  const validation = await validateApiKey(provider, keyArg);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    process.exit(1);
  }

  const result = saveApiKey(provider, keyArg);
  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
  console.log(`${provider} key validated and saved.`);
}
```

Update `module.exports` at the end of `src/cli-handlers.js`:

```javascript
module.exports = {
  handleSetup,
  handleAbort,
  handleUpdate,
  handleMcp,
  handleKey,
};
```

- [ ] **Step 4.4: Add `key` command to `bin/amicus.js`**

In `bin/amicus.js`, update the import line at the top:

```javascript
const { handleSetup, handleAbort, handleUpdate, handleMcp, handleKey } = require('../src/cli-handlers');
```

Add `key` case to the switch statement (after the `setup` case):

```javascript
      case 'key':
        await handleKey(args);
        break;
```

- [ ] **Step 4.5: Add `--remove` boolean flag and `key` usage text to `src/cli.js`**

In `src/cli.js`, replace lines 100-114 (`isBooleanFlag` body):

```javascript
function isBooleanFlag(key) {
   const booleanFlags = [
     'no-ui',
     'no-mcp',
     'no-context',
     'setup',
     'all',
     // 'summary', // summary is now an option with a value
     'conversation',
     'json',
     'version',
     'help',
     'api-keys',
     'validate-model',
     'no-validate-model',
     'remove'
   ];
  return booleanFlags.includes(key);
}
```

In `src/cli.js` `getUsage()`, replace the `setup` block lines 302-306 with:

```javascript
  setup       Configure default model and aliases
    --api-keys               Open API key setup window
    --add-alias <name=model> Add a model alias without the full wizard
  key         Manage API keys from the command line
    <provider> <apikey>      Validate and save a key
    <provider> --remove      Remove a saved key
    (no args)                List all configured providers
  update      Update to latest version
  mcp         Start MCP server (stdio transport)
```

- [ ] **Step 4.6: Run the tests to confirm they pass**

```
cd /c/Users/sendt/dev/amicus && npx jest tests/cli-key.test.js --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 4.7: Run the full test suite**

```
cd /c/Users/sendt/dev/amicus && npm test
```

Expected: All tests PASS.

- [ ] **Step 4.8: Manual smoke test**

```bash
# List keys (should show deepseek as not set)
node bin/amicus.js key

# Save a real or obviously-invalid key to test the error path
node bin/amicus.js key deepseek invalid-key-test
# Expected: "Validating deepseek key..." then "Error: Invalid API key (401)"

# (With a real key) should print "deepseek key validated and saved."
# node bin/amicus.js key deepseek sk-<real-key>
```

- [ ] **Step 4.9: Commit**

```bash
git add src/cli-handlers.js bin/amicus.js src/cli.js tests/cli-key.test.js
git commit -m "feat: add 'amicus key' CLI command for headless API key management"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Add DeepSeek key via setup wizard | Task 2 (PROVIDERS array) |
| Add DeepSeek key via CLI | Task 4 (`amicus key` command) |
| Use DeepSeek API directly (not just via OpenRouter) | Tasks 1 + 3 (model-fetcher + curated route) |
| Fetch model list from DeepSeek API | Task 1 (PROVIDER_FETCH_CONFIG) |
| Validate key before saving | Task 4 (validation step in handleKey) |
| Remove a DeepSeek key | Task 4 (`--remove` flag) |

### Placeholder Scan

No TBDs, no "implement later", no "add appropriate handling" — every code block is complete.

### Type Consistency

- `PROVIDER_FETCH_CONFIG.deepseek.normalize` returns `{id, name, contextLength, pricing}` — matches the shape used by `fetchModelsFromProvider` and the existing openai/google entries.
- `handleKey` uses `PROVIDER_ENV_MAP` imported directly — same source as `saveApiKey`, no drift.
- `handleKey` is exported and imported by name in `bin/amicus.js` — no mismatch.
