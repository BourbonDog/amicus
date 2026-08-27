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
    'quotes': ['error', 'single', { avoidEscape: true }],
    // issue 214: hand-rolled `openrouter/` prefix stripping is how a direct
    // model id gets FABRICATED for a namespace that does not serve it. The
    // wizard renderer carried a hand-copy of toCanonicalDefault that dropped
    // both of the real primitive's guards and would have been caught here.
    // Derive direct forms through src/utils/model-canonicalization.js
    // (directFormIfSafe / directFormIfProven), and classify a gateway with
    // gatewayOf() from src/utils/gateway-router.js.
    'no-restricted-syntax': ['error', {
      selector: "MemberExpression[object.value='openrouter/'][property.name='length']",
      message: "Don't hand-roll `openrouter/` prefix stripping - it fabricates direct ids for namespaces that may not serve them (issue 214). Use directFormIfSafe/directFormIfProven (model-canonicalization.js) or gatewayOf (gateway-router.js). If this file legitimately owns that policy, add it to the allowlist override in .eslintrc.js."
    }]
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
      // issue 214 allowlist for the `openrouter/` prefix-stripping ban above.
      // Each entry was READ before being listed, not grandfathered wholesale:
      //
      //  - curated-models.js: OWNS the operation. :159 is toCanonicalDefault
      //    itself (the primitive the ban points callers away from); :201 is
      //    vendorOf. This is the one file that legitimately derives an
      //    executable id by stripping.
      //  - fallback-chains.js :36 (vendorOf), model-tiers.js :83
      //    (buildGatewayOnlyAliasMap), route-launch.js :100
      //    (normalizeForModelIndex) and :131 (splitVendorAndModel): all four
      //    strip in order to PARSE -- they return a vendor segment, an index
      //    key, or a {vendor, bareModel} pair. None emits a model id that is
      //    ever sent to a provider, which is the failure the ban exists to
      //    prevent.
      //
      // A NEW file reaching for this idiom should not be added here without the
      // same check: if it produces an id that gets CALLED, it belongs behind
      // directFormIfSafe/directFormIfProven instead.
      files: [
        'src/utils/curated-models.js',
        'src/sidecar/fallback-chains.js',
        'src/utils/model-tiers.js',
        'src/utils/route-launch.js',
        // Added for council #216 A2/B1's fix: `vendorOfId` parses the vendor
        // segment so both guards stop trusting a caller-supplied vendor that
        // the JSDoc marks optional. Same PARSE-not-derive test as the four
        // above -- it returns a vendor segment, never an id that is called.
        // NOTE: vendor-from-id parsing now exists here, in fallback-chains,
        // route-launch and model-classification. That duplication deserves one
        // low-level home; deliberately not done in a review-fix commit.
        'src/utils/model-canonicalization.js',
      ],
      rules: {
        'no-restricted-syntax': 'off'
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
