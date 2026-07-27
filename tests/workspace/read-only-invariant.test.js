'use strict';

/**
 * TST-4 — the Council Workspace is READ-ONLY against council run directories.
 *
 * This is the central safety property of the whole v4.4 workspace layer (spec §6.2,
 * restated in electron/ipc-workspace.js's own header) and until this file it was
 * asserted NOWHERE. Six of the seven `workspace:` IPC channels never write at all;
 * the seventh, `workspace:abort-run`, is the ONE verb that legitimately causes a
 * write — and even it does not perform that write in workspace code. It delegates
 * to the engine, and the checkpoint lands in `src/mcp-council-awareness.js`.
 *
 * ⚠️ WHY THIS IS AN AST WALK AND NOT A SOURCE GREP.
 * The obvious implementation — regex-scan the file text for `writeFileSync` and
 * friends — is wrong here, and would have been actively harmful. These directories
 * are unusually comment-dense ABOUT writes: several council rounds left explanatory
 * annotations at exactly the sites where a write was considered and rejected
 * ("finalize() writes error: null", "seeded on run.json's FIRST write", "the
 * proposed clearing-arm write would HIDE the button", "chair-output.md not written
 * yet"). Any of those, reworded slightly, is a false positive for a text scan. A
 * guard that goes red for a comment gets weakened rather than fixed — and this is
 * the most valuable structural guard in the GUI, so it must never cry wolf.
 *
 * So the source is PARSED (espree, the parser eslint already brings in) and only
 * the resulting syntax tree is inspected. Comments are structurally absent from
 * that tree, so a comment can never trip it, and a real call can never hide in one.
 * String literals are matched by EXACT EQUALITY only — that closes the
 * `fs['writeFileSync']` computed-member escape hatch without matching prose.
 * `guardSource` below is exercised directly by the "the guard itself" describe
 * block: it must ignore comments AND still catch every real spelling of a write.
 */

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Filesystem write APIs, by the name they appear under in code — `fs.x`,
 * `fs.promises.x`, a destructured `{ x }`, or a computed `fs['x']`. Deliberately
 * excludes generic names that are not filesystem-specific (`open`, `write`, `read`):
 * `details.open = true` and `process.stdout.write(...)` are both legitimate and
 * neither touches a run directory.
 */
const WRITE_APIS = new Set([
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'mkdirSync', 'mkdir', 'mkdtempSync', 'mkdtemp',
  'rmSync', 'rm', 'rmdirSync', 'rmdir', 'unlinkSync', 'unlink',
  'renameSync', 'rename', 'copyFileSync', 'copyFile', 'cpSync', 'cp',
  'truncateSync', 'truncate', 'ftruncateSync', 'writeSync', 'openSync',
  'chmodSync', 'chmod', 'chownSync', 'chown',
  'symlinkSync', 'symlink', 'linkSync', 'utimesSync', 'utimes',
  'createWriteStream',
]);

/** The complete `workspace:` IPC surface (electron/ipc-workspace.js). */
const WORKSPACE_CHANNELS = [
  'workspace:abort-run',
  'workspace:fold',
  'workspace:get-live',
  'workspace:get-run',
  'workspace:list-runs',
  'workspace:open-report',
  'workspace:read-artifact',
];

/**
 * ⚠️ THE ONE EXCEPTION, EXCLUDED BY NAME. `workspace:abort-run` is the only verb
 * whose invocation legitimately ends in a write to a run directory (run.json gets
 * `status: 'aborted'`). It is excluded from READ_ONLY_CHANNELS deliberately, not by
 * oversight — and the two tests at the bottom of this file pin WHERE that write
 * actually happens, which is NOT in workspace code.
 */
const WRITING_CHANNEL = 'workspace:abort-run';
const READ_ONLY_CHANNELS = WORKSPACE_CHANNELS.filter((c) => c !== WRITING_CHANNEL);

const parse = (src) => espree.parse(src, {
  ecmaVersion: 2022, sourceType: 'script', loc: true,
});

/** Depth-first walk of an ESTree node, skipping position metadata. */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') { return; }
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') { continue; }
    const value = node[key];
    if (Array.isArray(value)) { value.forEach((child) => walk(child, visit)); }
    else if (value && typeof value.type === 'string') { walk(value, visit); }
  }
}

/**
 * Every reference to a filesystem write API in `src`, as {name, line}.
 * Comments never appear (espree does not attach them unless asked), so a write API
 * discussed in prose is invisible here — which is the entire point of this helper.
 * @param {string} src JavaScript source text
 * @returns {Array<{name: string, line: number}>} deduped by name+position
 */
function guardSource(src) {
  const hits = new Map();
  const record = (name, node) => {
    const line = node.loc ? node.loc.start.line : 0;
    const column = node.loc ? node.loc.start.column : 0;
    hits.set(`${name}:${line}:${column}`, { name, line });
  };
  walk(parse(src), (node) => {
    if (node.type === 'Identifier' && WRITE_APIS.has(node.name)) { record(node.name, node); }
    // `fs['writeFileSync'](…)` — an exact string match, never a prose substring.
    if (node.type === 'Literal' && typeof node.value === 'string' && WRITE_APIS.has(node.value)) {
      record(node.value, node);
    }
  });
  return [...hits.values()].sort((a, b) => a.line - b.line);
}

const readSource = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf-8');

/** Offenders in one repo-relative file, formatted for a readable failure message. */
function offendersIn(relPath) {
  return guardSource(readSource(relPath)).map((h) => `${relPath}:${h.line} ${h.name}`);
}

/** Every `.js` file directly inside a repo-relative directory, repo-relative. */
function jsFilesIn(relDir) {
  return fs.readdirSync(path.join(ROOT, relDir))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `${relDir}/${f}`);
}

// ---------------------------------------------------------------------------
// The guard itself: it must be blind to comments and still catch real writes.
// Without these, a silently-broken scanner would report a green invariant forever.
// ---------------------------------------------------------------------------
describe('the guard is comment-blind but not call-blind', () => {
  test('a write API named in a comment is NOT an offender', () => {
    expect(guardSource('// this used to call fs.writeFileSync here\nvar x = 1;\n')).toEqual([]);
    expect(guardSource('/* mkdirSync / rmSync are never reached from this module */\nvar y = 2;\n')).toEqual([]);
    expect(guardSource('var z = 3; // seeded on run.json\'s FIRST write (writeFileSync)\n')).toEqual([]);
    // A JSDoc block naming several of them at once — the shape these dirs actually carry.
    expect(guardSource('/**\n * appendFileSync, renameSync and createWriteStream are all absent.\n */\nvar q = 4;\n')).toEqual([]);
  });

  test('prose in a STRING is not an offender either — matching is exact, not substring', () => {
    expect(guardSource('var msg = "chair-output.md not written yet (no writeFileSync anywhere)";\n')).toEqual([]);
    expect(guardSource('var t = `the fold write goes to stdout, never writeFileSync`;\n')).toEqual([]);
  });

  test('every real spelling of a write IS an offender', () => {
    expect(guardSource('fs.writeFileSync(p, x);').map((h) => h.name)).toEqual(['writeFileSync']);
    expect(guardSource('require("fs").mkdirSync(d);').map((h) => h.name)).toEqual(['mkdirSync']);
    expect(guardSource('require("fs")["writeFileSync"](p, x);').map((h) => h.name)).toEqual(['writeFileSync']);
    expect(guardSource('const { appendFileSync } = require("fs");').map((h) => h.name)).toEqual(['appendFileSync']);
    expect(guardSource('fs.promises.rm(d, { recursive: true });').map((h) => h.name)).toEqual(['rm']);
    expect(guardSource('const s = fs.createWriteStream(p);').map((h) => h.name)).toEqual(['createWriteStream']);
    // Buried inside a comment-dense function body, which is the realistic shape.
    expect(guardSource([
      '/** Never writes. */',
      'function f() {',
      '  // reading only — see the note about writeFileSync above',
      '  fs.unlinkSync(p);',
      '}',
    ].join('\n')).map((h) => h.name)).toEqual(['unlinkSync']);
  });

  test('POSITIVE CONTROL: the scan is not vacuous — a module that DOES write reports it', () => {
    // Without this, a typo in offendersIn (a bad path, a swallowed read, a walk that
    // never recurses) would make every invariant test below pass by finding nothing at
    // all. src/council/run-state.js is the engine's own run-directory writer — the exact
    // counterpart to everything under src/workspace/ — so it must come back dirty.
    const engineOffenders = offendersIn('src/council/run-state.js');
    expect(engineOffenders.length).toBeGreaterThan(0);
    expect(engineOffenders.join('\n')).toContain('mkdirSync');
  });

  test('read APIs are never offenders (no over-broad matching)', () => {
    expect(guardSource('fs.readFileSync(p); fs.existsSync(p); fs.statSync(p); fs.realpathSync(p); fs.readdirSync(d);')).toEqual([]);
    // The two generic names deliberately left out of WRITE_APIS.
    expect(guardSource('panel.open = true; process.stdout.write(text);')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The invariant.
// ---------------------------------------------------------------------------
describe('the Council Workspace never writes to a run directory', () => {
  test('no src/workspace/ module reaches for a filesystem write API', () => {
    const offenders = jsFilesIn('src/workspace').flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });

  test('no electron/workspace-ui/ module reaches for a filesystem write API', () => {
    // The renderer has no `fs` at all under contextIsolation, but that is a runtime
    // property of the sandbox, not of this source — assert the source too, so a future
    // preload widening cannot quietly make a write reachable.
    const offenders = jsFilesIn('electron/workspace-ui').flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });

  test('electron/ipc-workspace.js reaches for no filesystem write API either', () => {
    expect(offendersIn('electron/ipc-workspace.js')).toEqual([]);
  });

  test('the one write the IPC layer DOES perform goes to our own stdout, not to disk', () => {
    // workspace:fold's payload is relayed to the launching terminal (spec §7). That is a
    // `process.stdout.write`, which is why `write` is not in WRITE_APIS — and it is worth
    // pinning positively so the test above cannot be satisfied by the fold write moving
    // to disk under a name this list happens not to carry.
    let found = false;
    walk(parse(readSource('electron/ipc-workspace.js')), (node) => {
      if (node.type !== 'MemberExpression' || node.computed) { return; }
      const obj = node.object;
      if (node.property.name === 'write' && obj.type === 'MemberExpression'
        && !obj.computed && obj.property.name === 'stdout'
        && obj.object.type === 'Identifier' && obj.object.name === 'process') {
        found = true;
      }
    });
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Channel-by-channel, so a NEW channel cannot be added without being classified.
// ---------------------------------------------------------------------------

/** Map of channel name -> the handler function node registered for it. */
function ipcHandlers() {
  const handlers = new Map();
  walk(parse(readSource('electron/ipc-workspace.js')), (node) => {
    if (node.type !== 'CallExpression') { return; }
    const callee = node.callee;
    if (callee.type !== 'MemberExpression' || callee.computed || callee.property.name !== 'handle') { return; }
    const [channel, handler] = node.arguments;
    if (channel && channel.type === 'Literal' && typeof channel.value === 'string') {
      handlers.set(channel.value, handler);
    }
  });
  return handlers;
}

describe('the seven workspace: channels, classified', () => {
  test('the registered channel set is exactly the classified set', () => {
    // A new channel added without a decision about whether it writes fails HERE first,
    // which is the point: the read-only posture is opt-out by name, never by default.
    expect([...ipcHandlers().keys()].sort()).toEqual(WORKSPACE_CHANNELS);
    expect(READ_ONLY_CHANNELS).toHaveLength(6);
    expect(WORKSPACE_CHANNELS).toContain(WRITING_CHANNEL);
  });

  test.each(READ_ONLY_CHANNELS)('%s is read-only', (channel) => {
    const handler = ipcHandlers().get(channel);
    expect(handler).toBeDefined();
    const hits = [];
    walk(handler, (node) => {
      if (node.type === 'Identifier' && WRITE_APIS.has(node.name)) { hits.push(node.name); }
      // A read-only channel must not reach the engine's abort checkpoint either.
      if (node.type === 'Identifier' && (node.name === 'checkpoint' || node.name === 'amicus_abort')) {
        hits.push(node.name);
      }
    });
    expect(hits).toEqual([]);
  });
});

describe('workspace:abort-run — the one writing verb, and where the write really lives', () => {
  test('the abort handler performs no write itself; it delegates to the engine', () => {
    const handler = ipcHandlers().get(WRITING_CHANNEL);
    expect(handler).toBeDefined();
    const names = [];
    walk(handler, (node) => {
      if (node.type === 'Identifier') { names.push(node.name); }
    });
    // No filesystem write API anywhere in the handler…
    expect(names.filter((n) => WRITE_APIS.has(n))).toEqual([]);
    // …and no checkpoint here either: the handler's whole job is the delegation.
    expect(names).not.toContain('checkpoint');
    expect(names).toContain('amicus_abort');
  });

  test('the write lands in src/mcp-council-awareness.js — named, not hand-waved as "the engine"', () => {
    // ⚠️ Mandatory per the original flag: this test must name the module that actually
    // writes. `abortCouncilRun` is the function amicus_abort routes to, and its
    // runState.checkpoint(runDir, {status:'aborted'}) is the single write the entire
    // workspace surface can cause.
    const ast = parse(readSource('src/mcp-council-awareness.js'));
    let abortFn = null;
    walk(ast, (node) => {
      if (node.type === 'FunctionDeclaration' && node.id && node.id.name === 'abortCouncilRun') {
        abortFn = node;
      }
    });
    expect(abortFn).not.toBeNull();

    const checkpoints = [];
    walk(abortFn, (node) => {
      if (node.type !== 'CallExpression') { return; }
      const callee = node.callee;
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'checkpoint') {
        checkpoints.push(callee.object.name);
      }
    });
    expect(checkpoints).toEqual(['runState']);
  });
});
