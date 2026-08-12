module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // IMPORTANT: Use logger from src/utils/logger.js instead of console
    // This ensures structured logging with proper context for debugging
    'no-console': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true }]
  },
  overrides: [
    {
      // Allow console in tests and scripts (not production code)
      files: ['tests/**/*.js', 'scripts/**/*.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // Renderer runs in browser context - no access to Node logger
      // Use console.log/warn/error there (goes to DevTools)
      files: ['electron/ui/**/*.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // ENV-5: the Council Workspace renderer runs in a sandboxed browser page
      // loaded by plain <script> tags (electron/workspace-ui/index.html), not in
      // Node. window/document/NodeFilter are legitimate globals there, and Node
      // globals (require/process/__dirname) are NOT reachable under
      // contextIsolation — so node:false turns an accidental reference into a
      // lint error instead of a runtime bomb. Without this override eslint
      // reported 82 no-undef errors here, which is why electron/ was never put
      // under the lint gate at all (flagged in five task reports across v4.4).
      files: ['electron/workspace-ui/**/*.js'],
      env: { browser: true, node: false },
      globals: {
        // md-lite.js and live-model.js carry a `typeof module !== 'undefined'`
        // dual-export guard so jest can require them directly. `module` is the
        // one Node identifier the renderer legitimately names.
        module: 'readonly',
        // v4.8 PR0: live-model.js bridges to live-seats.js via a conditional
        // `require('./live-seats')` under the same dual-export guard — the
        // one other Node identifier the renderer legitimately names.
        require: 'readonly',
      },
      rules: {
        // No access to the Node logger from a sandboxed page; console goes to
        // DevTools. Same rationale as the electron/ui override above.
        'no-console': 'off',
        // ⚠️ DELIBERATE STYLE, not legacy debt. These files are served raw to a
        // sandboxed page under a strict CSP with no build step and no
        // transpiler, and are written in ES5 IIFE style throughout (159 `var`
        // declarations). Converting them is a large untested rewrite of a GUI
        // that has never been linted — out of scope for a patch release (owner
        // ruling on ENV-5: config + errors only). Tallied and deferred to v4.5;
        // see BACKLOG.md.
        // Left 'off' rather than 'warn' on purpose: lint-staged runs
        // `eslint --fix`, which auto-fixes warnings too, so 'warn' would
        // silently perform at commit time exactly the var→let rewrite this
        // comment defers.
        'no-var': 'off',
      },
    },
    {
      // Electron preload scripts run in the renderer process and legitimately
      // touch the DOM (branding CSS injection, toolbar mount) while still being
      // CommonJS modules that require('electron') — they need BOTH envs.
      files: ['electron/preload*.js'],
      env: { browser: true },
    },
    {
      // Electron main process: last-resort crash reporting. These console.error
      // calls live inside the stdout-error / uncaughtException handlers — i.e.
      // precisely the paths where routing through the Node logger (which itself
      // writes to the stream that just failed) is unsafe. Nothing else in these
      // two files uses console.
      files: ['electron/main.js', 'electron/ipc-guard.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // The logger itself must use console.error to output
      files: ['src/utils/logger.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // CLI output files use console.log for user-facing output (not logging)
      // These display results to the user, not debug info
      files: [
        'src/sidecar/fanout.js', 'src/sidecar/read.js', 'src/sidecar/session-utils.js',
        'src/sidecar/start.js', 'src/sidecar/resume.js', 'src/sidecar/continue.js',
        'src/cli-handlers.js', 'src/cli-handlers-abort.js', 'src/utils/start-helpers.js',
        // Task 15: registration status messages (skill install, MCP
        // registration) the user sees during `npm install -g amicus` /
        // `amicus init` — same "user-facing output, not logging" rationale as
        // the files above. Moved verbatim from scripts/postinstall.js (which
        // is exempted wholesale via the tests/scripts override below).
        'src/utils/claude-register.js',
      ],
      rules: {
        'no-console': 'off'
      }
    }
  ]
};
