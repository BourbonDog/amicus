# WS-4 Surfaces & Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Amicus's default surface observable (interactive runs persist to disk), first-run diagnosable (`amicus doctor`), and discoverable (Claude Code plugin manifest) — plus the deferred homepage/README quick-wins.

**Architecture:** Four independent units. A new pure transform `mirrorMessages` is shared by headless and a new interactive mirror poller (#7). A new `amicus doctor` one-shot command composes existing health helpers behind a `buildDoctorDoc` envelope (#11). A `skill/` → `skills/sidecar/` reorg + `.claude-plugin/plugin.json` + `marketplace.json` + a postinstall env-guard make Amicus an installable plugin without double-registering (#8). Docs edits point npm at the live site and add a prerequisites/cost block (#D).

**Tech Stack:** Node ≥18 (CommonJS), Jest, ESLint, OpenCode SDK (`getMessages`/`getSessionStatus`), Electron (interactive GUI).

## Global Constraints

- **Base:** local `main` `6bb33d1` (WS-0/1/2/3 + this spec merged, local-only). Build in worktree `amicus-ws4`, branch `ws4/surfaces-adoption`, node_modules junctioned so husky hooks fire.
- **Git policy:** LOCAL-ONLY. No push / PR / publish / `gh repo edit` / site deploy until the owner OKs a milestone.
- **Gates (every task before commit):** `npm test` green, `npm run lint` clean, `npm run check:secrets` clean, `npm run check:sizes` clean. New/modified source files stay **< 300 lines** (size gate).
- **TDD:** failing test first, minimal impl, green, commit. Frequent commits.
- **No new user-facing "sidecar" strings** (WS-0 swept them; do not regress). The skill NAME `sidecar` and the deprecated bin/MCP shims stay.
- **Schema:** reuse `SCHEMA_VERSION` (currently `2`) from `src/utils/result-schema.js` for any new `--json` doc; do not bump it (additive only).
- **Commit message convention:** match the repo — `feat(ws4): …` / `refactor(ws4): …` / `docs(ws4): …` / `test(ws4): …`, no `Co-Authored-By` trailer (the whole history omits it).

---

## Task 1: Unit D — npm homepage + README/site prerequisites & cost block

**Files:**
- Modify: `package.json:27` (homepage)
- Modify: `README.md` (insert block after the Install section, ~line 69, before `**Configure:**`)
- Modify: `site/index.html` (insert a prerequisites/cost `<section>` after the hero, before `<section id="demo">`)
- Test: `tests/ws4-quickwins.test.js`

**Interfaces:**
- Produces: nothing consumed by later tasks (docs/metadata only). Task 3's version-sync test reads `package.json` but not `homepage`.

- [ ] **Step 1: Write the failing test**

```js
// tests/ws4-quickwins.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

describe('WS-4 quick-wins', () => {
  test('package.json homepage points at the live landing page', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.homepage).toBe('https://bourbondog.github.io/amicus/');
  });

  test('README has a Prerequisites & cost block with the council-call estimate', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    expect(readme).toMatch(/##\s*Prerequisites/i);
    expect(readme).toMatch(/Node.*18/);
    expect(readme).toMatch(/Claude Code/);
    expect(readme).toMatch(/5[–-]8 paid model calls/);
  });

  test('landing page has a parallel prerequisites/cost section', () => {
    const site = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf-8');
    expect(site).toMatch(/id="prerequisites"/);
    expect(site).toMatch(/5[–-]8 paid model calls/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ws4-quickwins.test.js -v`
Expected: FAIL (homepage still `#readme`; no Prerequisites block).

- [ ] **Step 3: Update `package.json` homepage**

Change line 27 from:
```json
  "homepage": "https://github.com/BourbonDog/amicus#readme",
```
to:
```json
  "homepage": "https://bourbondog.github.io/amicus/",
```

- [ ] **Step 4: Insert the README block**

After the Install section (the bullet list ending at `…the chat skill).` ~line 68) and **before** `**Configure:**` (~line 70), insert:

```markdown
## Prerequisites & what it costs you

Before your first run:

- **Node.js ≥ 18** — `node --version` to check.
- **An active Claude Code or Cowork session** — Amicus is orchestrated by Claude; it is not a standalone chatbot.
- **At least one paid model API key** — OpenRouter (covers the most models) or a direct Google / OpenAI / Anthropic / DeepSeek key. Add one with `amicus setup` or `amicus key <provider> <key>`.

**What a run costs.** A sidecar is a single model call. A full council is typically **~5–8 paid model calls** (e.g. 3 reviewers across 2 fan-out waves + 1 chair). Amicus shows an estimate before each council and enforces a built-in budget gate that refuses ultra-expensive models (o3-pro class) unless you opt in with `--no-cost-gate`. You pay your providers directly for the tokens; Amicus itself is free and open-source.

```

(Keep a blank line before `## Prerequisites` and after the block so the existing `**Configure:**` heading stays separated. Place it as a top-level `##` section; if that disrupts the Quick-start flow, a `###` under Quick start is acceptable — the test only requires a `Prerequisites` heading.)

- [ ] **Step 5: Insert the site block**

In `site/index.html`, immediately before `<section class="demo-section" id="demo">` (~line 448), insert a section that matches THIS page's real idiom. The page does NOT use a `container` wrapper class — sections use a section-level class (e.g. `class="demo-section"`) and/or inline `style="background:var(--s1)…"`. Open the file, copy the wrapper + heading markup from a neighboring section (e.g. `#demo` at line 448 or `#works-with` at ~722), and adapt:

```html
    <section class="demo-section" id="prerequisites">
      <h2>Before You Start</h2>
      <p>Node.js 18+, an active Claude Code or Cowork session, and at least one paid model API key (OpenRouter, or a direct Google / OpenAI / Anthropic / DeepSeek key).</p>
      <p>A sidecar is one model call. A full council is typically <strong>~5–8 paid model calls</strong> — Amicus estimates the cost up front and a budget gate blocks runaway spend. You pay your providers for tokens; Amicus is free and open-source.</p>
    </section>
```

Use the actual class/heading markup the neighboring sections use so the block inherits the page styling — do NOT invent a `container` div. The test only asserts `id="prerequisites"` and the `5–8 paid model calls` phrase are present, so it passes regardless of exact styling.

- [ ] **Step 6: Run the test + gates**

Run: `npx jest tests/ws4-quickwins.test.js -v`
Expected: PASS (all 3).
Run: `npm run lint && npm run check:sizes`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md site/index.html tests/ws4-quickwins.test.js
git commit -m "docs(ws4): homepage→live site + prerequisites & cost block (README+site)"
```

---

## Task 2: Unit C — reorg `skill/` → `skills/sidecar/`

**Files:**
- Move: `skill/SKILL.md` → `skills/sidecar/SKILL.md` (via `git mv`)
- Modify: `scripts/postinstall.js:16` (`SKILL_SOURCE`)
- Modify: `package.json:38-47` (`files` — drop `"skill/"`)
- Test: `tests/postinstall-skill-source.test.js`

**Interfaces:**
- Produces: chat skill source now at `skills/sidecar/SKILL.md`. Task 3's manifest declares `./skills/sidecar`. `installSkill()` (unchanged signature) reads the new `SKILL_SOURCE`.

- [ ] **Step 1: Write the failing test**

```js
// tests/postinstall-skill-source.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installSkill } = require('../scripts/postinstall');

describe('postinstall installs the chat skill from skills/sidecar/', () => {
  test('repo source lives at skills/sidecar/SKILL.md (not skill/)', () => {
    const root = path.join(__dirname, '..');
    expect(fs.existsSync(path.join(root, 'skills', 'sidecar', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'skill', 'SKILL.md'))).toBe(false);
  });

  test('installSkill copies to ~/.claude/skills/sidecar/', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-home-'));
    const prevHome = process.env.HOME;
    const prevProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    try {
      installSkill();
      const dest = path.join(fakeHome, '.claude', 'skills', 'sidecar', 'SKILL.md');
      expect(fs.existsSync(dest)).toBe(true);
    } finally {
      process.env.HOME = prevHome;
      process.env.USERPROFILE = prevProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/postinstall-skill-source.test.js -v`
Expected: FAIL (source still at `skill/SKILL.md`; `skills/sidecar/SKILL.md` absent).

- [ ] **Step 3: Move the file (preserve history)**

```bash
mkdir -p skills/sidecar
git mv skill/SKILL.md skills/sidecar/SKILL.md
rmdir skill 2>/dev/null || true
```

- [ ] **Step 4: Update `scripts/postinstall.js` SKILL_SOURCE**

Change line 16 from:
```js
const SKILL_SOURCE = path.join(__dirname, '..', 'skill', 'SKILL.md');
```
to:
```js
const SKILL_SOURCE = path.join(__dirname, '..', 'skills', 'sidecar', 'SKILL.md');
```

- [ ] **Step 5: Update `package.json` files array**

Remove the `"skill/",` line (line 42) from the `files` array. `"skills/",` (now covering both `sidecar/` and `second-opinion/`) stays.

- [ ] **Step 6: Sweep for stragglers**

Run: `git grep -n -- "skill/SKILL\|'skill'\|\"skill\"\|/skill/" -- ':!docs/' ':!skills/' ':!CHANGELOG.md'`
Expected: no remaining references to the old singular `skill/` path in src/tests/scripts/config. Fix any that appear (e.g. eslintignore, jest config, other scripts). Do NOT rewrite occurrences of the word "skill" in prose/docs.

- [ ] **Step 7: Run tests + gates**

Run: `npx jest tests/postinstall-skill-source.test.js -v`
Expected: PASS.
Run: `npm test`
Expected: full suite green (catches any test that referenced the old path).
Run: `npm run lint && npm run check:sizes && npm run check:secrets`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(ws4): reorg skill/ -> skills/sidecar/ for plugin discovery"
```

---

## Task 3: Unit C — plugin manifest + marketplace + version-sync test

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json` (NOT repo root — the loader resolves it from `.claude-plugin/`)
- Modify: `package.json:38-47` (`files` — add `".claude-plugin/"`, which covers both manifests)
- Test: `tests/plugin-manifest.test.js`

**Interfaces:**
- Consumes: `skills/sidecar` + `skills/second-opinion` (from Task 2).
- Produces: a manifest whose MCP `env` carries `AMICUS_SKIP_POSTINSTALL: "1"` (Task 4 honors it).

- [ ] **Step 1: Write the failing test**

```js
// tests/plugin-manifest.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

describe('Claude Code plugin manifest', () => {
  const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf-8'));

  test('plugin.json parses and has required fields', () => {
    const m = manifest();
    expect(m.name).toBe('amicus');
    expect(typeof m.description).toBe('string');
    expect(m.author && m.author.name).toBeTruthy();
  });

  test('version is kept in sync with package.json', () => {
    expect(manifest().version).toBe(pkg.version);
  });

  test('declares both skills under skills/', () => {
    expect(manifest().skills.sort()).toEqual(['./skills/second-opinion', './skills/sidecar']);
  });

  test('declares the amicus MCP with the skip-postinstall guard', () => {
    const mcp = manifest().mcpServers.amicus;
    expect(mcp.command).toBe('npx');
    expect(mcp.args).toEqual(['-y', 'amicus@latest', 'mcp']);
    expect(mcp.env.AMICUS_SKIP_POSTINSTALL).toBe('1');
  });

  test('.claude-plugin/marketplace.json lists the amicus plugin from this repo', () => {
    const mk = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf-8'));
    expect(Array.isArray(mk.plugins)).toBe(true);
    expect(mk.plugins.some(p => p.name === 'amicus')).toBe(true);
  });

  test('the .claude-plugin/ dir ships in the npm tarball (covers manifest + marketplace)', () => {
    expect(pkg.files).toContain('.claude-plugin/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/plugin-manifest.test.js -v`
Expected: FAIL (no `.claude-plugin/plugin.json`).

- [ ] **Step 3: Create `.claude-plugin/plugin.json`**

Use the CURRENT `package.json` `version` (read it; at base it is `1.1.0`) and the same description string:

```json
{
  "name": "amicus",
  "version": "1.1.0",
  "description": "Multi-model LLM Council + parallel AI window for Claude Code. Run structured council reviews across Gemini, GPT, DeepSeek and more — or fork a conversation to any model and fold the results back.",
  "author": { "name": "Christian Wagner" },
  "homepage": "https://bourbondog.github.io/amicus/",
  "repository": "https://github.com/BourbonDog/amicus",
  "bugs": "https://github.com/BourbonDog/amicus/issues",
  "license": "MIT",
  "keywords": ["claude-code", "multi-model", "llm", "council", "second-opinion", "sidecar", "gemini", "gpt", "deepseek"],
  "skills": ["./skills/sidecar", "./skills/second-opinion"],
  "mcpServers": {
    "amicus": {
      "command": "npx",
      "args": ["-y", "amicus@latest", "mcp"],
      "env": { "AMICUS_SKIP_POSTINSTALL": "1" }
    }
  }
}
```

- [ ] **Step 4: Create `.claude-plugin/marketplace.json`**

The marketplace manifest lives in `.claude-plugin/` (same dir as `plugin.json`) — verified against all installed marketplaces under `~/.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json`; a repo-root `marketplace.json` is NOT where the loader looks. Keep the plugin entry **thin** — `plugin.json` (resolved via `source: "./"`) is the single source of truth for `skills`/`mcpServers`, so do not duplicate them here (avoids drift). Omit `metadata.version` (optional; omitting it removes a second version that would drift from `package.json`).

```json
{
  "name": "bourbondog-amicus",
  "owner": { "name": "Christian Wagner", "url": "https://github.com/BourbonDog" },
  "metadata": { "description": "Amicus — multi-model LLM Council + parallel AI window for Claude Code." },
  "plugins": [
    {
      "name": "amicus",
      "source": "./",
      "description": "Multi-model LLM Council + parallel AI window. Run structured council reviews across Gemini, GPT, DeepSeek and more — or fork a conversation to any model and fold the results back.",
      "author": { "name": "Christian Wagner" },
      "keywords": ["claude-code", "multi-model", "llm", "council", "second-opinion"]
    }
  ]
}
```

- [ ] **Step 5: Add the plugin dir to `package.json` files**

In the `files` array add one entry (the dir covers both `plugin.json` and `marketplace.json`):
```json
    ".claude-plugin/",
```

- [ ] **Step 6: Run the test + gates**

Run: `npx jest tests/plugin-manifest.test.js -v`
Expected: PASS (all 6).
Run: `npm run lint && npm run check:secrets`
Expected: clean. (Verified: `scripts/check-secrets.js` patterns match only real key shapes — `sk-ant-`/`AKIA`/`ghp_`/`AIza`/`sk-proj-`/`sk-[A-Za-z0-9]{32,}`/key blocks — none of which the manifest's `npx`/`amicus@latest`/`mcp` strings hit. No allowlist change needed.)

- [ ] **Step 7: Verify against the real loader (manual, non-blocking)**

Run: `/plugin marketplace add <path-to-worktree>` then `/plugin install amicus` in a scratch Claude Code session (or inspect an installed plugin's `.claude-plugin/plugin.json` under `~/.claude/plugins/` to confirm the `skills` array + `mcpServers` shape match what the loader expects). Record the result in the task notes. If the loader rejects the explicit `skills` array, fall back to convention discovery (skills auto-found under `skills/`) and drop the `skills` key — the reorg already makes that work.

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json tests/plugin-manifest.test.js
git commit -m "feat(ws4): Claude Code plugin manifest + in-repo marketplace (#8)"
```

---

## Task 4: Unit C — postinstall skip-on-plugin guard

**Files:**
- Modify: `scripts/postinstall.js` (`main()` ~line 175; export `main`)
- Test: `tests/postinstall-skip-guard.test.js`

**Interfaces:**
- Consumes: the `AMICUS_SKIP_POSTINSTALL` env the manifest sets (Task 3).
- Produces: `main()` is now exported and early-returns when the env is set.

**Why:** when a plugin user's MCP launches via `npx -y amicus@latest mcp`, npx's install phase runs this postinstall, which would re-register the MCP and re-copy skills the plugin framework already provides. The manifest sets `AMICUS_SKIP_POSTINSTALL=1`; honoring it makes the plugin channel a no-op while the plain `npm i -g amicus` path is unchanged.

- [ ] **Step 1: Write the failing test**

```js
// tests/postinstall-skip-guard.test.js
'use strict';
const postinstall = require('../scripts/postinstall');

describe('postinstall honors AMICUS_SKIP_POSTINSTALL', () => {
  test('main() is exported', () => {
    expect(typeof postinstall.main).toBe('function');
  });

  test('main() no-ops (installs nothing) when AMICUS_SKIP_POSTINSTALL=1', () => {
    const calls = [];
    const prev = process.env.AMICUS_SKIP_POSTINSTALL;
    process.env.AMICUS_SKIP_POSTINSTALL = '1';
    try {
      // deps injection: main() must accept overridable side-effect fns
      postinstall.main({
        installSkill: () => calls.push('skill'),
        installCouncilSkill: () => calls.push('council'),
        registerClaudeCode: () => calls.push('code'),
        registerClaudeDesktop: () => calls.push('desktop'),
      });
      expect(calls).toEqual([]);
    } finally {
      if (prev === undefined) { delete process.env.AMICUS_SKIP_POSTINSTALL; }
      else { process.env.AMICUS_SKIP_POSTINSTALL = prev; }
    }
  });

  test('main() runs all side effects when the env is unset', () => {
    const calls = [];
    const prev = process.env.AMICUS_SKIP_POSTINSTALL;
    delete process.env.AMICUS_SKIP_POSTINSTALL;
    try {
      postinstall.main({
        installSkill: () => calls.push('skill'),
        installCouncilSkill: () => calls.push('council'),
        registerClaudeCode: () => calls.push('code'),
        registerClaudeDesktop: () => calls.push('desktop'),
      });
      expect(calls).toEqual(['skill', 'council', 'code', 'desktop']);
    } finally {
      if (prev !== undefined) { process.env.AMICUS_SKIP_POSTINSTALL = prev; }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/postinstall-skip-guard.test.js -v`
Expected: FAIL (`postinstall.main` is not exported; no guard).

- [ ] **Step 3: Refactor `main()` to accept injected deps + honor the env**

Replace the `function main() { … }` body (lines 175-186) with:

```js
function main(deps = {}) {
  if (process.env.AMICUS_SKIP_POSTINSTALL === '1') {
    console.log('[amicus] AMICUS_SKIP_POSTINSTALL set — skipping global setup (plugin channel handles registration).');
    return;
  }
  const _installSkill = deps.installSkill || installSkill;
  const _installCouncilSkill = deps.installCouncilSkill || installCouncilSkill;
  const _registerClaudeCode = deps.registerClaudeCode || registerClaudeCode;
  const _registerClaudeDesktop = deps.registerClaudeDesktop || registerClaudeDesktop;

  console.log('[amicus] Installing...');
  _installSkill();
  _installCouncilSkill();
  _registerClaudeCode();
  _registerClaudeDesktop();

  console.log('');
  console.log('[amicus] Setup:');
  console.log('  - Configure API: Run `amicus setup` or set API keys directly');
  console.log('  - API keys: OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY, etc.');
}
```

- [ ] **Step 4: Export `main`**

Change the export (line 193) to add `main`:
```js
module.exports = { main, addMcpToConfigFile, installSkill, installCouncilSkill, COUNCIL_FILES };
```
(The `if (require.main === module) { main(); }` block at line 189 stays — direct invocation still runs the real side effects.)

- [ ] **Step 5: Run the test + gates**

Run: `npx jest tests/postinstall-skip-guard.test.js -v`
Expected: PASS (all 3).
Run: `npm run lint && npm run check:sizes`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/postinstall.js tests/postinstall-skip-guard.test.js
git commit -m "feat(ws4): postinstall skips global setup under AMICUS_SKIP_POSTINSTALL (#8)"
```

---

## Task 5: Unit B — `buildDoctorDoc` in result-schema

**Files:**
- Modify: `src/utils/result-schema.js` (add builder + export)
- Test: `tests/result-schema-doctor.test.js`

**Interfaces:**
- Produces: `buildDoctorDoc({ version, timestamp, checks }) → { schemaVersion, type:'doctor', ok, version, timestamp, checks }`. `ok === checks.every(c => c.status !== 'error')`. Consumed by Task 7's `handleDoctor`.

- [ ] **Step 1: Write the failing test**

```js
// tests/result-schema-doctor.test.js
'use strict';
const { buildDoctorDoc, SCHEMA_VERSION } = require('../src/utils/result-schema');

describe('buildDoctorDoc', () => {
  test('ok=true when no error checks', () => {
    const doc = buildDoctorDoc({
      version: '1.1.0', timestamp: '2026-06-23T00:00:00.000Z',
      checks: [{ id: 'node', name: 'Node', status: 'ok', message: 'v20', hint: null }],
    });
    expect(doc).toEqual({
      schemaVersion: SCHEMA_VERSION,
      type: 'doctor',
      ok: true,
      version: '1.1.0',
      timestamp: '2026-06-23T00:00:00.000Z',
      checks: [{ id: 'node', name: 'Node', status: 'ok', message: 'v20', hint: null }],
    });
  });

  test('ok=false when any check is error; warn does not flip ok', () => {
    const warn = buildDoctorDoc({ version: 'x', timestamp: 't', checks: [{ id: 'a', name: 'A', status: 'warn', message: 'm', hint: null }] });
    expect(warn.ok).toBe(true);
    const err = buildDoctorDoc({ version: 'x', timestamp: 't', checks: [{ id: 'b', name: 'B', status: 'error', message: 'm', hint: 'fix' }] });
    expect(err.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/result-schema-doctor.test.js -v`
Expected: FAIL (`buildDoctorDoc is not a function`).

- [ ] **Step 3: Add the builder**

In `src/utils/result-schema.js`, after `buildAuditDoc` (before `module.exports`), add:

```js
/**
 * Build a doctor health-check document (`doctor --json`).
 * @param {{version: string, timestamp: string, checks: Array<{id,name,status,message,hint}>}} opts
 */
function buildDoctorDoc({ version, timestamp, checks }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'doctor',
    ok: checks.every(c => c.status !== 'error'),
    version,
    timestamp,
    checks,
  };
}
```

Add `buildDoctorDoc,` to the `module.exports` object.

- [ ] **Step 4: Run the test + gates**

Run: `npx jest tests/result-schema-doctor.test.js -v`
Expected: PASS.
Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/result-schema.js tests/result-schema-doctor.test.js
git commit -m "feat(ws4): buildDoctorDoc result-schema envelope (#11)"
```

---

## Task 6: Unit B — `runDoctorChecks` (composable, dependency-injected)

**Files:**
- Create: `src/cli-handlers-doctor.js`
- Test: `tests/cli-handlers-doctor.test.js`

**Interfaces:**
- Consumes: existing helpers — `readApiKeys()`/`readApiKeyHints()` (`api-key-store`), `getConfigDir()`/`resolveModel()` (`config`), `readCache()` (`model-catalog`), `collectAliasSources()`/`findStaleAliases()` (`alias-audit`), `ensureNodeModulesBinInPath()` (`path-setup`), `getElectronPath()` (`sidecar/interactive`), `discoverClaudeCodeMcps()`/`discoverCoworkMcps()` (`mcp-discovery`).
- Produces: `runDoctorChecks(deps = {}) → Array<{id, name, status:'ok'|'warn'|'error', message, hint}>` — pure-ish, never throws. `deps` lets tests inject every helper. Consumed by Task 7's `handleDoctor`.

**Design:** each check is wrapped so a thrown helper becomes an `error` line, not a crash. `deps` defaults to the real helpers; tests pass fakes. Catalog freshness uses `readCache()` (NO network — never triggers a refresh).

- [ ] **Step 1: Write the failing test**

```js
// tests/cli-handlers-doctor.test.js
'use strict';
const { runDoctorChecks } = require('../src/cli-handlers-doctor');

const allGood = {
  nodeVersion: 'v20.0.0',
  readApiKeys: () => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false }),
  getConfigDir: () => '/cfg',
  resolveModel: () => 'openrouter/google/gemini-3.5-flash',
  readCache: () => ({ fetchedAt: Date.now(), models: [{ id: 'openrouter/google/gemini-3.5-flash' }] }),
  collectAliasSources: () => [{ alias: 'gemini', model: 'openrouter/google/gemini-3.5-flash', source: 'defaults' }],
  findStaleAliases: () => [],
  hasOpencodeBinary: () => true,
  getElectronPath: () => '/path/to/electron',
  discoverClaudeCodeMcps: () => ({ amicus: {} }),
  discoverCoworkMcps: () => ({ amicus: {} }),
  skillInstalled: () => true,
};

const byId = (checks) => Object.fromEntries(checks.map(c => [c.id, c]));

describe('runDoctorChecks', () => {
  test('all healthy → every check ok', () => {
    const checks = runDoctorChecks(allGood);
    for (const c of checks) { expect(c.status).toBe('ok'); }
    expect(byId(checks).keys.status).toBe('ok');
  });

  test('zero provider keys → keys is an error with the amicus key hint', () => {
    const checks = runDoctorChecks({ ...allGood,
      readApiKeys: () => ({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: false }) });
    const keys = byId(checks).keys;
    expect(keys.status).toBe('error');
    expect(keys.hint).toMatch(/amicus key/);
  });

  test('missing OpenCode binary → error', () => {
    const checks = runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
    expect(byId(checks)['opencode-bin'].status).toBe('error');
  });

  test('missing Electron → warn only (headless still works)', () => {
    const checks = runDoctorChecks({ ...allGood, getElectronPath: () => null });
    expect(byId(checks).electron.status).toBe('warn');
  });

  test('stale catalog (older than 24h) → warn', () => {
    const checks = runDoctorChecks({ ...allGood,
      readCache: () => ({ fetchedAt: Date.now() - 25 * 60 * 60 * 1000, models: [{ id: 'x' }] }) });
    expect(byId(checks).catalog.status).toBe('warn');
  });

  test('a throwing helper degrades to an error line, never throws', () => {
    const checks = runDoctorChecks({ ...allGood, resolveModel: () => { throw new Error('no default'); } });
    expect(byId(checks)['default-model'].status).toBe('error');
    expect(() => runDoctorChecks({ ...allGood, readApiKeys: () => { throw new Error('boom'); } })).not.toThrow();
  });

  test('unregistered MCP → warn with install hint', () => {
    const checks = runDoctorChecks({ ...allGood, discoverClaudeCodeMcps: () => null });
    expect(byId(checks).mcp.status).toBe('warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/cli-handlers-doctor.test.js -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `runDoctorChecks`**

```js
// src/cli-handlers-doctor.js
'use strict';

const MAX_CATALOG_AGE_MS = 24 * 60 * 60 * 1000; // 24h (mirrors model-catalog DEFAULT_MAX_AGE_MS)

/** Default real helpers; tests override via deps. */
function realDeps() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  return {
    nodeVersion: process.version,
    readApiKeys: () => require('./utils/api-key-store').readApiKeys(),
    getConfigDir: () => require('./utils/config').getConfigDir(),
    resolveModel: () => require('./utils/config').resolveModel(),
    readCache: () => require('./utils/model-catalog').readCache(),
    collectAliasSources: () => require('./utils/alias-audit').collectAliasSources(),
    findStaleAliases: (s, c) => require('./utils/alias-audit').findStaleAliases(s, c),
    hasOpencodeBinary: () => {
      const { ensureNodeModulesBinInPath } = require('./utils/path-setup');
      ensureNodeModulesBinInPath();
      const root = path.join(__dirname, '..', 'node_modules');
      const candidates = process.platform === 'win32'
        ? [path.join(root, `opencode-windows-${os.arch() === 'arm64' ? 'arm64' : 'x64'}`, 'bin', 'opencode.exe'),
           path.join(root, `opencode-windows-${os.arch() === 'arm64' ? 'arm64' : 'x64'}-baseline`, 'bin', 'opencode.exe')]
        : [path.join(root, '.bin', 'opencode')];
      return candidates.some(p => fs.existsSync(p));
    },
    getElectronPath: () => require('./sidecar/interactive').getElectronPath(),
    discoverClaudeCodeMcps: () => require('./utils/mcp-discovery').discoverClaudeCodeMcps(),
    discoverCoworkMcps: () => require('./utils/mcp-discovery').discoverCoworkMcps(),
    skillInstalled: () => {
      const dir = path.join(os.homedir(), '.claude', 'skills');
      return fs.existsSync(path.join(dir, 'sidecar', 'SKILL.md'))
        && fs.existsSync(path.join(dir, 'second-opinion', 'SKILL.md'));
    },
  };
}

/** Run one guarded check; a thrown fn becomes an error line. */
function guard(id, name, fn) {
  try { return fn(); }
  catch (e) { return { id, name, status: 'error', message: e.message, hint: null }; }
}

/**
 * Compose the health checks. Never throws.
 * @param {object} [depsOverride]
 * @returns {Array<{id,name,status,message,hint}>}
 */
function runDoctorChecks(depsOverride = {}) {
  const d = { ...realDeps(), ...depsOverride };
  const checks = [];

  checks.push(guard('node', 'Node.js', () => {
    const major = parseInt(String(d.nodeVersion).replace(/^v/, '').split('.')[0], 10);
    return major >= 18
      ? { id: 'node', name: 'Node.js', status: 'ok', message: d.nodeVersion, hint: null }
      : { id: 'node', name: 'Node.js', status: 'error', message: `${d.nodeVersion} (need >=18)`, hint: 'Install Node 18 or newer from https://nodejs.org' };
  }));

  checks.push(guard('config-dir', 'Config directory', () => (
    { id: 'config-dir', name: 'Config directory', status: 'ok', message: d.getConfigDir(), hint: null }
  )));

  checks.push(guard('keys', 'API keys', () => {
    const keys = d.readApiKeys();
    const set = Object.keys(keys).filter(k => keys[k]);
    return set.length > 0
      ? { id: 'keys', name: 'API keys', status: 'ok', message: `configured: ${set.join(', ')}`, hint: null }
      : { id: 'keys', name: 'API keys', status: 'error', message: 'no provider keys configured', hint: 'amicus key <provider> <key>  (or run: amicus setup)' };
  }));

  checks.push((() => {
    try {
      const model = d.resolveModel();
      return { id: 'default-model', name: 'Default model', status: 'ok', message: model, hint: null };
    } catch (e) {
      return { id: 'default-model', name: 'Default model', status: 'error', message: e.message || 'no default model', hint: 'amicus setup' };
    }
  })());

  checks.push(guard('catalog', 'Model catalog', () => {
    const cache = d.readCache();
    if (!cache || !cache.fetchedAt) {
      return { id: 'catalog', name: 'Model catalog', status: 'warn', message: 'no cache yet', hint: 'amicus models --refresh' };
    }
    const ageMs = Date.now() - cache.fetchedAt;
    const fresh = ageMs <= MAX_CATALOG_AGE_MS;
    const hrs = Math.round(ageMs / 3600000);
    return fresh
      ? { id: 'catalog', name: 'Model catalog', status: 'ok', message: `${cache.models.length} models, ${hrs}h old`, hint: null }
      : { id: 'catalog', name: 'Model catalog', status: 'warn', message: `stale (${hrs}h old)`, hint: 'amicus models --refresh' };
  }));

  checks.push(guard('aliases', 'Model aliases', () => {
    const cache = d.readCache();
    const catalog = (cache && cache.models) || [];
    const stale = d.findStaleAliases(d.collectAliasSources(), catalog);
    return stale.length === 0
      ? { id: 'aliases', name: 'Model aliases', status: 'ok', message: catalog.length ? 'all resolve' : 'catalog empty — not checked', hint: null }
      : { id: 'aliases', name: 'Model aliases', status: 'warn', message: `${stale.length} stale: ${stale.map(s => s.alias).join(', ')}`, hint: 'amicus models --check' };
  }));

  checks.push(guard('opencode-bin', 'OpenCode binary', () => (
    d.hasOpencodeBinary()
      ? { id: 'opencode-bin', name: 'OpenCode binary', status: 'ok', message: 'found', hint: null }
      : { id: 'opencode-bin', name: 'OpenCode binary', status: 'error', message: 'not found', hint: 'npm install -g amicus' }
  )));

  checks.push(guard('electron', 'Electron (interactive GUI)', () => (
    d.getElectronPath()
      ? { id: 'electron', name: 'Electron (interactive GUI)', status: 'ok', message: 'installed', hint: null }
      : { id: 'electron', name: 'Electron (interactive GUI)', status: 'warn', message: 'not installed — headless still works', hint: 'npm install -g amicus  (reinstall to add Electron)' }
  )));

  checks.push(guard('skills', 'Skills installed', () => (
    d.skillInstalled()
      ? { id: 'skills', name: 'Skills installed', status: 'ok', message: '~/.claude/skills/{sidecar,second-opinion}', hint: null }
      : { id: 'skills', name: 'Skills installed', status: 'warn', message: 'one or both skills missing', hint: 'npm install -g amicus  (re-runs the skill install)' }
  )));

  checks.push(guard('mcp', 'MCP registration', () => {
    const code = d.discoverClaudeCodeMcps();
    const cowork = d.discoverCoworkMcps();
    const inCode = !!(code && code.amicus);
    const inCowork = !!(cowork && cowork.amicus);
    return (inCode || inCowork)
      ? { id: 'mcp', name: 'MCP registration', status: 'ok', message: `registered: ${[inCode && 'Claude Code', inCowork && 'Cowork/Desktop'].filter(Boolean).join(', ')}`, hint: null }
      : { id: 'mcp', name: 'MCP registration', status: 'warn', message: 'not registered', hint: 'npm install -g amicus  (or install the amicus plugin)' };
  }));

  return checks;
}

module.exports = { runDoctorChecks, MAX_CATALOG_AGE_MS };
```

Note on the `discoverClaudeCodeMcps` check: the real helper deletes the `sidecar` key (recursion guard) but keeps `amicus`, so `code.amicus` is the correct presence signal.

- [ ] **Step 4: Run the test + gates**

Run: `npx jest tests/cli-handlers-doctor.test.js -v`
Expected: PASS (all 7).
Run: `npm run lint && npm run check:sizes`
Expected: clean (file < 300 lines).

- [ ] **Step 5: Commit**

```bash
git add src/cli-handlers-doctor.js tests/cli-handlers-doctor.test.js
git commit -m "feat(ws4): runDoctorChecks health composition (#11)"
```

---

## Task 7: Unit B — `handleDoctor` + CLI wiring

**Files:**
- Modify: `src/cli-handlers-doctor.js` (add `handleDoctor` + human/JSON render)
- Modify: `bin/amicus.js` (add `case 'doctor'`)
- Modify: `src/utils/lifecycle.js:15` (add `'doctor'` to `ONE_SHOT_COMMANDS`)
- Modify: `src/cli.js` (`getUsage()` — add a doctor line)
- Test: `tests/doctor-handler.test.js`

**Interfaces:**
- Consumes: `runDoctorChecks` (Task 6), `buildDoctorDoc` (Task 5).
- Produces: `handleDoctor(args) → Promise<number>` (exit code; 0 if no error checks, 1 otherwise). `--json` → `buildDoctorDoc` on stdout; human → ✓/⚠/✗ checklist.

- [ ] **Step 1: Write the failing test**

```js
// tests/doctor-handler.test.js
'use strict';
const path = require('path');
const doctor = require('../src/cli-handlers-doctor');

function capture(fn) {
  const out = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve(fn()).then((code) => { process.stdout.write = orig; return { code, out: out.join('') }; })
    .catch((e) => { process.stdout.write = orig; throw e; });
}

describe('handleDoctor', () => {
  test('--json emits a doctor doc on stdout and returns 0 when healthy', async () => {
    const checks = [{ id: 'node', name: 'Node.js', status: 'ok', message: 'v20', hint: null }];
    const { code, out } = await capture(() => doctor.handleDoctor({ _: ['doctor'], json: true }, () => checks));
    const doc = JSON.parse(out);
    expect(doc.type).toBe('doctor');
    expect(doc.ok).toBe(true);
    expect(code).toBe(0);
  });

  test('returns 1 when any check is an error', async () => {
    const checks = [{ id: 'keys', name: 'API keys', status: 'error', message: 'none', hint: 'amicus key' }];
    const { code } = await capture(() => doctor.handleDoctor({ _: ['doctor'], json: true }, () => checks));
    expect(code).toBe(1);
  });

  test('human output shows ✓/⚠/✗ marks and hints', async () => {
    const checks = [
      { id: 'a', name: 'Node.js', status: 'ok', message: 'v20', hint: null },
      { id: 'b', name: 'API keys', status: 'error', message: 'none', hint: 'amicus key <provider> <key>' },
    ];
    const { out } = await capture(() => doctor.handleDoctor({ _: ['doctor'] }, () => checks));
    expect(out).toMatch(/Node\.js/);
    expect(out).toMatch(/amicus key/);
    expect(out).toMatch(/[✓✗]/);
  });

  test('doctor is a one-shot command', () => {
    const { ONE_SHOT_COMMANDS } = require('../src/utils/lifecycle');
    expect(ONE_SHOT_COMMANDS.has('doctor')).toBe(true);
  });

  test('usage text mentions doctor', () => {
    const { getUsage } = require('../src/cli');
    expect(getUsage()).toMatch(/doctor/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/doctor-handler.test.js -v`
Expected: FAIL (`handleDoctor` undefined; `doctor` not one-shot; usage lacks doctor).

- [ ] **Step 3: Add `handleDoctor` + renderers to `src/cli-handlers-doctor.js`**

Append before `module.exports` (and update the export):

```js
const MARK = { ok: '✓', warn: '⚠', error: '✗' }; // ✓ ⚠ ✗

function renderHuman(checks) {
  let out = 'amicus doctor\n\n';
  for (const c of checks) {
    out += `${MARK[c.status] || '?'} ${c.name}: ${c.message}\n`;
    if (c.hint && c.status !== 'ok') { out += `    → ${c.hint}\n`; }
  }
  const errors = checks.filter(c => c.status === 'error').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  out += `\n${errors} error(s), ${warns} warning(s).\n`;
  return out;
}

/**
 * `amicus doctor [--json]`. Injectable `runChecks` for tests.
 * @param {{_:string[], json?:boolean}} args
 * @param {(deps?:object)=>Array} [runChecks]
 * @returns {Promise<number>} exit code
 */
async function handleDoctor(args, runChecks = runDoctorChecks) {
  const useJson = !!args.json;
  const checks = runChecks();
  if (useJson) {
    const { buildDoctorDoc } = require('./utils/result-schema');
    const VERSION = require('../package.json').version;
    const doc = buildDoctorDoc({ version: VERSION, timestamp: new Date().toISOString(), checks });
    process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
    return doc.ok ? 0 : 1;
  }
  process.stdout.write(renderHuman(checks));
  return checks.some(c => c.status === 'error') ? 1 : 0;
}
```

Update the export line to:
```js
module.exports = { runDoctorChecks, handleDoctor, MAX_CATALOG_AGE_MS };
```

- [ ] **Step 4: Wire the command in `bin/amicus.js`**

After the `case 'council': { … }` block (line 103), add:
```js
      case 'doctor': {
        const { handleDoctor } = require('../src/cli-handlers-doctor');
        exitCode = await handleDoctor(args);
        break;
      }
```

- [ ] **Step 5: Register as one-shot in `src/utils/lifecycle.js`**

Change line 15 to include `'doctor'`:
```js
const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'read', 'abort', 'fanout', 'models', 'key', 'council', 'doctor' /* local-only: no OpenCode server, no stray handles */]);
```

- [ ] **Step 6: Add a usage line in `src/cli.js`**

Open `src/cli.js`, find the `getUsage()` command list (where `council` / `models` / `key` lines live), and add a line in the same column style, e.g.:
```
  doctor                    Check your setup: keys, catalog, binary, skills, MCP (--json)
```
(Match the existing indentation/alignment of the neighboring command lines exactly.)

- [ ] **Step 7: Run the test + full suite + gates**

Run: `npx jest tests/doctor-handler.test.js -v`
Expected: PASS (all 5).
Run: `npm test`
Expected: full suite green.
Run: `npm run lint && npm run check:sizes && npm run check:secrets`
Expected: clean.

- [ ] **Step 8: Live smoke (manual)**

Run: `node bin/amicus.js doctor` then `node bin/amicus.js doctor --json`
Expected: a readable checklist; valid JSON with `type:"doctor"`. Record the output in task notes.

- [ ] **Step 9: Commit**

```bash
git add src/cli-handlers-doctor.js bin/amicus.js src/utils/lifecycle.js src/cli.js tests/doctor-handler.test.js
git commit -m "feat(ws4): amicus doctor command + --json (#11)"
```

---

## Task 8: Unit A — extract the pure `mirrorMessages` transform

**Files:**
- Create: `src/sidecar/conversation-mirror.js`
- Test: `tests/conversation-mirror.test.js`

**Interfaces:**
- Produces:
  ```
  createMirrorState() → { seenTextParts:Map, toolCalls:[], seenToolResultIds:Set, receivingReported:false, output:'', usageByMsg:Map }
  mirrorMessages(messages, state, { now }) → {
    appendLines: Array<object>,           // JSONL objects to append to conversation.jsonl, in order
    progressUpdates: Array<{stage, extra}>,// writeProgress payloads, in order
    state,                                 // mutated-in-place + returned (same ref)
    currentAssistantMsgId: string|null,
    assistantFinished: boolean,
    sessionError: string|null,
    messageCount: number
  }
  ```
  `now` defaults to `() => new Date().toISOString()`. Also exports `logMessage(conversationPath, message)` (relocated here from headless — see below). Consumed by Task 9 (headless) and Task 10 (interactive).

**Behavior of `mirrorMessages` must produce byte-identical on-disk session files** (`conversation.jsonl` + `progress.json`) **vs the current headless loop** (`src/headless.js:363-475`): text parts appended only on growth (sliced delta); tool_use appended once per `part.id`; tool_result appended once per computed `partId`; usage captured when `msg.info.tokens || typeof msg.info.cost === 'number'`; the exact JSONL shapes; the same progress payloads. (Logger output ordering/frequency is NOT part of this contract.)

- [ ] **Step 1: Write the failing test**

```js
// tests/conversation-mirror.test.js
'use strict';
const { createMirrorState, mirrorMessages } = require('../src/sidecar/conversation-mirror');
const NOW = () => '2026-06-23T00:00:00.000Z';

const asstText = (id, text, completed) => ({ info: { role: 'assistant', id, time: completed ? { completed: 1 } : {} }, parts: [{ id: `${id}:t`, type: 'text', text }] });

describe('mirrorMessages', () => {
  test('appends only the new text delta across polls', () => {
    const st = createMirrorState();
    const r1 = mirrorMessages([asstText('m1', 'Hello')], st, { now: NOW });
    expect(r1.appendLines).toEqual([{ role: 'assistant', content: 'Hello', timestamp: NOW() }]);
    const r2 = mirrorMessages([asstText('m1', 'Hello world')], st, { now: NOW });
    expect(r2.appendLines).toEqual([{ role: 'assistant', content: ' world', timestamp: NOW() }]);
    expect(st.output).toBe('Hello world');
  });

  test('first text emits a receiving progress update', () => {
    const st = createMirrorState();
    const r = mirrorMessages([asstText('m1', 'hi')], st, { now: NOW });
    expect(r.progressUpdates[0]).toEqual({ stage: 'receiving', extra: { messagesReceived: 1 } });
  });

  test('tool_use appended once, with a Calling-tool progress update', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [{ id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } }] };
    const r1 = mirrorMessages([msg], st, { now: NOW });
    expect(r1.appendLines).toEqual([{ role: 'assistant', type: 'tool_use', toolCall: { id: 'tc1', name: 'Bash', input: { cmd: 'ls' } }, timestamp: NOW() }]);
    expect(r1.progressUpdates.find(p => p.extra.latestTool === 'Bash')).toBeTruthy();
    const r2 = mirrorMessages([msg], st, { now: NOW });
    expect(r2.appendLines).toEqual([]); // not re-appended
  });

  test('tool_result appended once (dedup by partId)', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {} }, parts: [{ id: 'tr1', type: 'tool_result', tool_use_id: 'tc1', is_error: false, content: 'ok' }] };
    const r1 = mirrorMessages([msg], st, { now: NOW });
    expect(r1.appendLines).toEqual([{ role: 'tool', type: 'tool_result', toolUseId: 'tc1', isError: false, content: 'ok', timestamp: NOW() }]);
    const r2 = mirrorMessages([msg], st, { now: NOW });
    expect(r2.appendLines).toEqual([]);
  });

  test('captures usage and surfaces completion signals', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: { completed: 1 }, tokens: { input: 10, output: 5 }, cost: 0.001 }, parts: [{ id: 'm1:t', type: 'text', text: 'done' }] };
    const r = mirrorMessages([msg], st, { now: NOW });
    expect(st.usageByMsg.get('m1')).toEqual({ tokens: { input: 10, output: 5 }, cost: 0.001 });
    expect(r.currentAssistantMsgId).toBe('m1');
    expect(r.assistantFinished).toBe(true);
    expect(r.messageCount).toBe(1);
  });

  test('captures model error from msg.info.error', () => {
    const st = createMirrorState();
    const msg = { info: { role: 'assistant', id: 'm1', time: {}, error: { name: 'RateLimit', data: { message: 'slow down' } } }, parts: [] };
    const r = mirrorMessages([msg], st, { now: NOW });
    expect(r.sessionError).toBe('slow down');
  });

  test('ignores user-role messages', () => {
    const st = createMirrorState();
    const r = mirrorMessages([{ info: { role: 'user', id: 'u1' }, parts: [{ id: 'x', type: 'text', text: 'hi' }] }], st, { now: NOW });
    expect(r.appendLines).toEqual([]);
  });
});

describe('logMessage', () => {
  const { logMessage } = require('../src/sidecar/conversation-mirror');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  test('appends one JSON line per call', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-log-'));
    const p = path.join(dir, 'conversation.jsonl');
    logMessage(p, { role: 'assistant', content: 'a', timestamp: 't' });
    logMessage(p, { role: 'tool', content: 'b', timestamp: 't' });
    const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(JSON.parse);
    expect(lines).toHaveLength(2);
    expect(lines[0].content).toBe('a');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/conversation-mirror.test.js -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the transform**

```js
// src/sidecar/conversation-mirror.js
'use strict';

/**
 * @module conversation-mirror
 * Pure transform of an OpenCode getMessages() snapshot into conversation.jsonl
 * append-lines + progress.json updates. Extracted from the headless poll loop so
 * the interactive GUI path can mirror the same way (WS-4 #7). No I/O, no clock
 * except the injectable `now`.
 */

/** Fresh cursor for a session's mirror. */
function createMirrorState() {
  return {
    seenTextParts: new Map(),   // partId -> last captured text length
    toolCalls: [],              // [{id,name,input}]
    seenToolResultIds: new Set(),
    receivingReported: false,
    output: '',                 // accumulated assistant text
    usageByMsg: new Map(),      // msgId -> {tokens, cost}
  };
}

/**
 * @param {Array} messages getMessages() snapshot
 * @param {object} state from createMirrorState() (mutated + returned)
 * @param {{now?: () => string}} [opts]
 */
function mirrorMessages(messages, state, opts = {}) {
  const now = opts.now || (() => new Date().toISOString());
  const appendLines = [];
  const progressUpdates = [];
  let currentAssistantMsgId = null;
  let assistantFinished = false;
  let sessionError = null;
  const list = Array.isArray(messages) ? messages : [];
  const messageCount = list.length;

  for (const msg of list) {
    const role = msg.info && msg.info.role;
    if (role === 'assistant') {
      currentAssistantMsgId = msg.info.id;
      if (msg.info.tokens || typeof msg.info.cost === 'number') {
        state.usageByMsg.set(msg.info.id, { tokens: msg.info.tokens, cost: msg.info.cost });
      }
      if (msg.info.error) {
        sessionError = (msg.info.error.data && msg.info.error.data.message)
          || msg.info.error.name || 'Unknown model error';
      }
    }
    if (role !== 'assistant' || !msg.parts) { continue; }

    for (const part of msg.parts) {
      const partId = part.id || `${msg.info.id}:${part.type}:${msg.parts.indexOf(part)}`;

      if (part.type === 'text' && part.text) {
        const prevLen = state.seenTextParts.get(partId) || 0;
        if (part.text.length > prevLen) {
          const newText = part.text.slice(prevLen);
          state.output += newText;
          state.seenTextParts.set(partId, part.text.length);
          appendLines.push({ role: 'assistant', content: newText, timestamp: now() });
          if (!state.receivingReported) {
            state.receivingReported = true;
            progressUpdates.push({ stage: 'receiving', extra: { messagesReceived: 1 } });
          }
        }
      } else if ((part.type === 'tool_use' || part.type === 'tool') && !state.toolCalls.find(t => t.id === part.id)) {
        const toolCall = { id: part.id, name: part.name, input: part.input };
        state.toolCalls.push(toolCall);
        appendLines.push({ role: 'assistant', type: 'tool_use', toolCall, timestamp: now() });
        progressUpdates.push({
          stage: 'receiving',
          extra: {
            messagesReceived: state.toolCalls.length,
            latestTool: part.name || undefined,
            stageLabel: part.name ? `Calling tool: ${part.name}` : 'Executing tool call...',
          },
        });
        state.receivingReported = true;
      } else if (part.type === 'tool_result') {
        if (!state.seenToolResultIds.has(partId)) {
          state.seenToolResultIds.add(partId);
          appendLines.push({
            role: 'tool', type: 'tool_result', toolUseId: part.tool_use_id,
            isError: part.is_error || false, content: part.content, timestamp: now(),
          });
        }
      }
    }
  }

  const lastAssistant = list.filter(m => m.info && m.info.role === 'assistant').pop();
  assistantFinished = !!(lastAssistant && lastAssistant.info.time && lastAssistant.info.time.completed);

  return { appendLines, progressUpdates, state, currentAssistantMsgId, assistantFinished, sessionError, messageCount };
}

const fs = require('fs');

/**
 * Append one JSONL record to conversation.jsonl (0o600). Relocated here from
 * headless.js so BOTH the headless loop and the interactive mirror import it from
 * one place (no cross-module coupling to headless's 750-line surface).
 * @param {string} conversationPath @param {object} message
 */
function logMessage(conversationPath, message) {
  fs.appendFileSync(conversationPath, JSON.stringify(message) + '\n', { mode: 0o600 });
}

module.exports = { createMirrorState, mirrorMessages, logMessage };
```

> **Why `logMessage` lives here:** it was a private function in `headless.js` (NOT exported). Both Task 9 (headless) and Task 10 (interactive-mirror) need it; putting it in this module — which both already import — is the single-source fix the hardening review recommended, and avoids interactive-mirror depending on the whole headless module.

> **Fidelity note vs current headless:** today headless appends a tool_result line *unconditionally* (`headless.js:457-464` — the dedup `seenToolResultIds` guard at :450-452 only gates the Set add, NOT the `logMessage` call). That is a latent double-log bug on repeated polls. This transform appends only on first sight (dedup'd) — the *correct* behavior. **Verified (hardening review): no existing test asserts duplicate tool_result lines** — the only tool_result fixture (`tests/headless.test.js:1098-1119`) asserts solely `result.completed === true`. So the dedup fix breaks no test; Task 9 needs no test edit for this.

- [ ] **Step 4: Run the test + gates**

Run: `npx jest tests/conversation-mirror.test.js -v`
Expected: PASS (all 7).
Run: `npm run lint && npm run check:sizes`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/conversation-mirror.js tests/conversation-mirror.test.js
git commit -m "feat(ws4): pure mirrorMessages transform (shared persistence) (#7)"
```

---

## Task 9: Unit A — refactor headless to use `mirrorMessages`

**Files:**
- Modify: `src/headless.js` — the message/parts loop (~366-475); the orphaned state declarations (`output`~298, `toolCalls`~303, `usageByMsg`~304, `seenToolResultIds`~322, `receivingReported`~324, `seenTextParts`~325); the private `logMessage` definition (~736-738); the final `sumPerMessageUsage` consumer.
- Test: existing `tests/headless*.test.js` (must stay green); no new behavior.

**Interfaces:**
- Consumes: `createMirrorState`, `mirrorMessages`, **and `logMessage` — ALL from `./sidecar/conversation-mirror`** (Task 8 relocated `logMessage` there); existing `writeProgress`, `sumPerMessageUsage`.
- Produces: identical on-disk session files (modulo the tool_result dedup fix from Task 8).

**Goal:** zero on-disk behavior change (the existing headless suite is the acceptance bar). A pure refactor routing persistence through the shared transform.

- [ ] **Step 1: Run the existing headless suite (baseline, must be green)**

Run: `npx jest tests/headless -v 2>&1 | tail -20`
Expected: green. Record pass count.

- [ ] **Step 2: Wire in the shared transform + DELETE the now-dead declarations**

(a) Add near the top of the run body (replacing headless's reliance on its private `logMessage`):
```js
  const { createMirrorState, mirrorMessages, logMessage } = require('./sidecar/conversation-mirror');
  const mirror = createMirrorState();
```
(b) **DELETE the private `logMessage` function** in headless (~736-738) — it now comes from the import. Headless's other `logMessage(...)` call sites (e.g. logging the system/user message at session start) keep working via the imported one (same name + signature).
(c) **DELETE the now-orphaned per-poll declarations** that `mirror` replaces — `.eslintrc.js` sets `no-unused-vars: error`, so leaving ANY of these dead FAILS the lint gate:
```
let output = '';                 // ~298
const toolCalls = [];            // ~303
const usageByMsg = new Map();    // ~304
const seenToolResultIds = new Set(); // ~322
let receivingReported = false;   // ~324
const seenTextParts = new Map(); // ~325
```
KEEP the loop-control vars: `lastOutputLength`, `lastToolCallCount`, `lastToolResultCount`, `lastMessageCount`, `lastAssistantMsgId`, `stablePolls`.

- [ ] **Step 3: Replace the message/parts loop, then reroute every reference to `mirror.*`**

Replace the block from `let currentAssistantMsgId = null;` (~366) through the parts loop and the `assistantFinished` computation (~475) with:

```js
        const mr = mirrorMessages(messages, mirror);
        mr.appendLines.forEach(line => logMessage(conversationPath, line));
        mr.progressUpdates.forEach(p => writeProgress(sessionDir, p.stage, p.extra));
        const currentAssistantMsgId = mr.currentAssistantMsgId;
        const assistantFinished = mr.assistantFinished;
        if (mr.sessionError) {
          sessionError = mr.sessionError;
          logger.error('Session error detected in assistant message', { sessionId, message: mr.sessionError });
        }
```

There is **no aliasing** — every remaining read of a deleted local must be hand-edited to `mirror.*`. The full list (line numbers are pre-edit; the loop body shifts after the deletions — locate by code, not line):
- `output` → `mirror.output`: the `[SIDECAR_FOLD]` regex test, `sessionError && !output`, the `output.length > 0` idle gate, `outputGrew = output.length > lastOutputLength`, the stable-poll `output.length` guard, the `logger.debug` `outputLength` fields, and the **returned** `output` in the result object. (≈ lines 481, 488, 495, 505, 526, 541, 550, 584, 627, 629, 641.)
- `toolCalls` → `mirror.toolCalls`: `toolActivity` (528/529), the **tool-call summary** block (~610-616), and the **returned** `toolCalls` (634/646).
- `usageByMsg` → `mirror.usageByMsg`: the `sumPerMessageUsage(usageByMsg)` call (625).
- `seenToolResultIds.size` → `mirror.seenToolResultIds.size`: the result-activity check (530/531).

Then verify nothing was missed:
```bash
git grep -nE '\b(output|toolCalls|usageByMsg|seenToolResultIds|seenTextParts|receivingReported)\b' -- src/headless.js
```
Expected: every remaining hit is `mirror.<name>` or a loop-control var (`lastOutputLength`, etc.) — NO bare `output`/`toolCalls`/`usageByMsg`/`seenToolResultIds`/`seenTextParts`/`receivingReported`.

> On-disk `conversation.jsonl` + `progress.json` are byte-identical to before. (The session-error logger line now fires once per poll instead of once per erroring message — that is log output, not part of the on-disk contract.)

- [ ] **Step 4: Confirm the final usage consumer**

The `sumPerMessageUsage(usageByMsg)` call should now read `sumPerMessageUsage(mirror.usageByMsg)` (folded into Step 3's reroute — confirm it here).

- [ ] **Step 5: Run the headless suite + full suite**

Run: `npx jest tests/headless -v 2>&1 | tail -20`
Expected: green, **same pass count** (no test edits needed — the dedup fix breaks no test per Task 8's verified note).
Run: `npm test`
Expected: full suite green.

- [ ] **Step 6: Gates + commit**

Run: `npm run lint && npm run check:sizes`
Expected: clean. (`headless.js` shrinks but stays in the size-gate grandfather list — `scripts/check-file-sizes.js`; leave the entry, do not delist in this task.)

```bash
git add src/headless.js src/sidecar/conversation-mirror.js
git commit -m "refactor(ws4): headless persistence via shared mirrorMessages (#7)"
```
(`conversation-mirror.js` is included only if Step 2's `logMessage` relocation wasn't already committed in Task 8 — if Task 8 already shipped `logMessage`, commit just `src/headless.js`.)

---

## Task 10: Unit A — mirror the interactive GUI session to disk

**Files:**
- Create: `src/sidecar/interactive-mirror.js`
- Modify: `src/sidecar/interactive.js` (start the mirror poller; stop+flush on close; return `result.usage`)
- Test: `tests/interactive-mirror.test.js`

**Interfaces:**
- Consumes: `createMirrorState`/`mirrorMessages`/`logMessage` (ALL from `./conversation-mirror`, Task 8), `writeProgress` (from `progress`), `getMessages` (`opencode-client`), `sumPerMessageUsage` (`../utils/pricing` — verified exported there, the same helper headless uses), `getSessionDir` (`session-manager`).
- Produces: `startInteractiveMirror({ getMessages, sessionDir, intervalMs, onActivity, now }) → { stop: () => Promise<{usage}>, }`. On `stop()` it does a final poll, writes `progress.json stage='complete'`, and returns accumulated `usage` totals.

**Design:** a 2s poll loop in the parent `runInteractive` process (runs concurrently with the GUI renderer — both are clients of the same local OpenCode server; WS-1's status poller already proves concurrent parent polling is safe). It mirrors live, so the heartbeat/`read`/`status` work and a close-without-fold keeps the transcript.

- [ ] **Step 1: Write the failing test**

```js
// tests/interactive-mirror.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startInteractiveMirror } = require('../src/sidecar/interactive-mirror');

function tmpSessionDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-sess-'));
  fs.writeFileSync(path.join(d, 'conversation.jsonl'), '');
  return d;
}

const msg = (id, text, completed, usage) => ({ info: { role: 'assistant', id, time: completed ? { completed: 1 } : {}, ...(usage || {}) }, parts: [{ id: `${id}:t`, type: 'text', text }] });

describe('startInteractiveMirror', () => {
  test('mirrors messages to conversation.jsonl live and writes progress', async () => {
    const dir = tmpSessionDir();
    let snapshot = [msg('m1', 'Hello')];
    const mirror = startInteractiveMirror({
      getMessages: async () => snapshot,
      sessionDir: dir,
      intervalMs: 5,
    });
    await new Promise(r => setTimeout(r, 30));
    snapshot = [msg('m1', 'Hello world', true, { tokens: { input: 4, output: 2 }, cost: 0.001 })];
    await new Promise(r => setTimeout(r, 30));
    const res = await mirror.stop();

    const lines = fs.readFileSync(path.join(dir, 'conversation.jsonl'), 'utf-8').split('\n').filter(Boolean).map(JSON.parse);
    expect(lines.map(l => l.content).join('')).toContain('Hello world');
    const progress = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf-8'));
    expect(progress.stage).toBe('complete');
    expect(res.usage).toBeTruthy(); // usageTotals object
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('onActivity fires when new lines are mirrored', async () => {
    const dir = tmpSessionDir();
    let hits = 0;
    let snapshot = [];
    const mirror = startInteractiveMirror({
      getMessages: async () => snapshot, sessionDir: dir, intervalMs: 5, onActivity: () => { hits++; },
    });
    snapshot = [msg('m1', 'hi')];
    await new Promise(r => setTimeout(r, 30));
    await mirror.stop();
    expect(hits).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('getMessages errors are swallowed (best-effort)', async () => {
    const dir = tmpSessionDir();
    const mirror = startInteractiveMirror({ getMessages: async () => { throw new Error('boom'); }, sessionDir: dir, intervalMs: 5 });
    await new Promise(r => setTimeout(r, 20));
    await expect(mirror.stop()).resolves.toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/interactive-mirror.test.js -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `startInteractiveMirror`**

```js
// src/sidecar/interactive-mirror.js
'use strict';

const path = require('path');
const { createMirrorState, mirrorMessages, logMessage } = require('./conversation-mirror');
const { writeProgress } = require('./progress');
const { sumPerMessageUsage } = require('../utils/pricing');
const { logger } = require('../utils/logger');

/**
 * Poll the OpenCode session and mirror it to conversation.jsonl + progress.json
 * live, exactly like headless. Best-effort and non-blocking — a poll/write error
 * never throws into the GUI session.
 *
 * @param {object} opts
 * @param {() => Promise<Array>} opts.getMessages
 * @param {string} opts.sessionDir
 * @param {number} [opts.intervalMs=2000]
 * @param {() => void} [opts.onActivity]
 * @param {() => string} [opts.now]
 * @returns {{ stop: () => Promise<{usage: object|null}> }}
 */
function startInteractiveMirror({ getMessages, sessionDir, intervalMs = 2000, onActivity, now }) {
  const state = createMirrorState();
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');
  let timer = null;
  let stopped = false;

  async function pollOnce() {
    try {
      const messages = await getMessages();
      const mr = mirrorMessages(messages, state, { now });
      mr.appendLines.forEach(line => logMessage(conversationPath, line));
      mr.progressUpdates.forEach(p => writeProgress(sessionDir, p.stage, p.extra));
      if (mr.appendLines.length > 0 && onActivity) { onActivity(); }
    } catch (err) {
      logger.debug('Interactive mirror poll failed (best-effort)', { error: err.message });
    }
  }

  const schedule = () => {
    if (stopped) { return; }
    timer = setTimeout(tick, intervalMs);
    if (timer.unref) { timer.unref(); }
  };
  async function tick() {
    if (stopped) { return; }
    await pollOnce();
    schedule();
  }
  schedule();

  return {
    async stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      await pollOnce(); // final flush
      try { writeProgress(sessionDir, 'complete'); } catch { /* best-effort */ }
      let usage = null;
      try { usage = sumPerMessageUsage(state.usageByMsg); } catch { /* best-effort */ }
      return { usage };
    },
  };
}

module.exports = { startInteractiveMirror };
```

> `sumPerMessageUsage` is exported from `src/utils/pricing.js` (verified) — the same helper headless uses to turn `usageByMsg` into `result.usage`. Do not reimplement. The 2s cadence is intentional (vs the WS-1 activity poller's 30s); a transiently-hung `getMessages` parks only that one tick (best-effort, swallowed) — acceptable for a non-blocking mirror.

- [ ] **Step 4: Wire it into `runInteractive`**

In `src/sidecar/interactive.js`:

1. Add imports near the top:
```js
const { startInteractiveMirror } = require('./interactive-mirror');
const { getMessages } = require('../opencode-client');
const { getSessionDir } = require('../session-manager');
```

2. After the activity poller is created (~line 174) and before the `return new Promise(...)`, start the mirror (it needs the session dir; `project` + `taskId` are in scope):
```js
  const sessionDir = getSessionDir(project, taskId);
  const mirror = startInteractiveMirror({
    getMessages: () => getMessages(ocClient, sessionId),
    sessionDir,
    onActivity: () => watchdog.touch(),
  });
```

3. In the close handler passed to `handleElectronProcess` (~line 201), stop the mirror and thread usage into the result **before** resolving:
```js
    handleElectronProcess(electronProcess, taskId, async (result) => {
      watchdog.cancel();
      activityPoller.stop();
      try {
        const { usage } = await mirror.stop();
        if (usage) { result.usage = usage; }
      } catch (err) { logger.debug('mirror stop failed', { error: err.message }); }
      server.close();
      logger.debug('OpenCode server closed after Electron exit');
      result.opencodeSessionId = sessionId;
      resolve(result);
    });
```
(Note: `handleElectronProcess`'s callback is now async — that is fine; its `resolve` is still called exactly once.)

- [ ] **Step 5: Run tests**

Run: `npx jest tests/interactive-mirror.test.js -v`
Expected: PASS (all 3) — in particular the 'mirrors messages to conversation.jsonl live' test must show a **populated** file. The mirror's `pollOnce` swallows all errors (best-effort), so a wiring bug (e.g. a bad import) surfaces only as an EMPTY conversation.jsonl and a failed content assertion, not an exception. If that test fails with an empty file, suspect a swallowed import error first (confirm `logMessage`/`writeProgress`/`sumPerMessageUsage` resolve), not a logic bug.
Run: `npx jest tests/interactive -v 2>&1 | tail -20`
Expected: existing interactive tests green (no test invokes `handleElectronProcess` directly — verified by the hardening review — so the sync→async callback change breaks none).
Run: `npm test`
Expected: full suite green.

- [ ] **Step 6: Gates + commit**

Run: `npm run lint && npm run check:sizes && npm run check:secrets`
Expected: clean (interactive.js stays < 300 lines — if the additions push it over, move `buildElectronEnv`/`handleElectronProcess` is NOT needed; the mirror logic already lives in its own file, so the net add to interactive.js is ~12 lines).

```bash
git add src/sidecar/interactive-mirror.js src/sidecar/interactive.js tests/interactive-mirror.test.js
git commit -m "feat(ws4): mirror interactive GUI session to disk + usage (#7)"
```

---

## Task 11: Real-LLM smoke + whole-branch review

**Files:** none (verification only) — plus any fixes the review surfaces.

- [ ] **Step 1: Interactive live-mirror smoke (this machine)**

With a real key configured, run a short interactive session (foreground), e.g.:
```bash
node bin/amicus.js start --model gemini --prompt "Say hello in one sentence."
```
While it runs (or right after), in another shell verify:
- `node bin/amicus.js list` shows the session with a non-"Starting up… | 0 messages" heartbeat / progress.
- `cat .claude/amicus_sessions/<taskId>/conversation.jsonl` is populated.
- `cat .claude/amicus_sessions/<taskId>/progress.json` shows a real stage (`receiving` → `complete`).
- `node bin/amicus.js read <taskId> --conversation` renders the transcript.
- **Close the window WITHOUT folding** on a second run → the transcript is still on disk (the #7 win).
- `metadata.json` has a non-null `usage` block (the bonus).

Record outcomes. If any fails, debug against `src/sidecar/interactive-mirror.js` / `interactive.js`, fix, re-run.

- [ ] **Step 2: doctor smoke**

Run `node bin/amicus.js doctor` and `node bin/amicus.js doctor --json`; confirm the real config produces a sensible report and valid JSON.

- [ ] **Step 3: Plugin manifest validation**

`/plugin marketplace add <worktree>` + `/plugin install amicus` in a scratch Claude Code session (or inspect the installed manifest). Confirm both skills + the MCP register once, and that the MCP launch with `AMICUS_SKIP_POSTINSTALL=1` does not double-register. Record the result.

- [ ] **Step 4: Full gates**

Run: `npm test && npm run lint && npm run check:secrets && npm run check:sizes && npm run generate-docs:check && npm run validate-docs`
Expected: all green/clean.

- [ ] **Step 5: Whole-branch Opus review**

Dispatch a holistic review of the full `ws4/surfaces-adoption` diff vs `main` against the spec's acceptance criteria (4 units, no regressions, no new user-facing "sidecar", concurrency safety of the interactive mirror, manifest correctness). Address any Critical/Important findings; re-run gates.

- [ ] **Step 6: Merge to LOCAL main (fast-forward), clean up the worktree**

After review = ready: fast-forward `main` to the branch, remove the worktree JUNCTION-SAFE (verify `LinkType=Junction` on node_modules → `Remove-Item -Force` WITHOUT `-Recurse` → `git worktree remove --force`), confirm the main-clone node_modules is intact, delete the branch. **Do NOT push** (program local-only policy) — report the new local `main` HEAD and the commit count ahead of origin, and ask the owner before any push/publish/site-deploy/`gh` step.

---

## Self-Review (completed) + hardening pass

**Spec coverage:** #7 → Tasks 8/9/10/11; #11 → Tasks 5/6/7; #8 → Tasks 2/3/4 (+ double-registration via Task 4's env guard); quick-wins → Task 1; reorg → Task 2; real-LLM smoke + review + local-only merge → Task 11. Out-of-scope items (official marketplace, bundled plugin, push/`gh`) are excluded.

**Type consistency:** `mirrorMessages` returns `{appendLines, progressUpdates, state, currentAssistantMsgId, assistantFinished, sessionError, messageCount}` and is consumed identically in Tasks 9 and 10. `logMessage` is exported from `conversation-mirror.js` (Task 8) and imported there by BOTH Task 9 (headless) and Task 10 (interactive-mirror) — single source. `runDoctorChecks(deps) → check[]`, `buildDoctorDoc({version,timestamp,checks})`, and `handleDoctor(args, runChecks?)` line up across Tasks 5/6/7. `startInteractiveMirror({...}).stop() → Promise<{usage}>` matches the Task 10 wiring that sets `result.usage` (which `start.js:236` already threads into metadata). The manifest's `AMICUS_SKIP_POSTINSTALL` (Task 3) is the exact env Task 4 reads.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the one manual step (plugin-loader validation) is a verification with a concrete fallback.

**Hardening pass (5-lens adversarial workflow vs the live repo):** fixed 3 blockers — (1) `logMessage` was not exported from `headless.js` → relocated into `conversation-mirror.js`, imported by both paths; (2) Task 9 now explicitly DELETES the six orphaned declarations and enumerates every `mirror.*` reroute site (the `no-unused-vars` gate would otherwise fail); (3) `marketplace.json` moved to `.claude-plugin/marketplace.json` (all 10 real installed marketplaces resolve it there, not repo root). Also: de-drifted the marketplace entry (dropped `metadata.version` + duplicated skills/mcpServers), removed the dead `|| {}` in the doctor default-model check, dropped the won't-fire check-secrets allowlist hedge, fixed the `-- --all` gate redundancy, corrected the site `container`→`demo-section` idiom, and aligned the spec's catalog row to `readCache`. Confirmed-sound by the review (no change needed): the tool_result double-log is a real latent bug the dedup fix corrects; concurrent 2s parent polling is safe (WS-1 precedent); `AMICUS_SKIP_POSTINSTALL` reaches the npx-triggered postinstall; `getSessionDir(project,taskId)` is the dir `start.js` created; `require('../headless')` was not side-effectful (now moot — coupling removed).
