# JSDoc + TypeScript Declarations

This project uses **JSDoc comments** to provide TypeScript type information without converting to TypeScript. This gives npm consumers autocomplete and type checking.

## JSDoc Pattern for Public APIs

```javascript
/**
 * Start a new Amicus session
 * @param {Object} options - Amicus configuration
 * @param {string} options.model - LLM model identifier (e.g., 'google/gemini-2.5-flash')
 * @param {string} options.briefing - Task description for the Amicus session
 * @param {string} [options.sessionId] - Optional Claude Code session ID
 * @param {boolean} [options.headless=false] - Run without GUI
 * @param {number} [options.timeout=15] - Headless timeout in minutes
 * @returns {Promise<AmicusResult>} Session result with summary
 */
async function startAmicus(options) {
  // ...
}

/**
 * @typedef {Object} AmicusResult
 * @property {string} taskId - Unique session identifier
 * @property {string} summary - Fold summary from Amicus
 * @property {string} status - Session status (completed|timeout|error)
 * @property {string[]} [conflicts] - Files with potential conflicts
 */
```

## Generating .d.ts Files

Add to `package.json`:

```json
{
  "scripts": {
    "build:types": "tsc --declaration --emitDeclarationOnly --allowJs --outDir types"
  },
  "types": "types/index.d.ts",
  "files": ["bin/", "src/", "electron/", "types/"]
}
```

Create `jsconfig.json`:

```json
{
  "compilerOptions": {
    "checkJs": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "allowJs": true,
    "outDir": "types",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "target": "ES2022"
  },
  "include": ["src/**/*.js", "bin/**/*.js"],
  "exclude": ["node_modules", "tests"]
}
```

## Pre-publish Workflow

```bash
# Generate types before publishing
npm run build:types

# Verify types are generated
ls types/

# Publish with types
npm publish
```
