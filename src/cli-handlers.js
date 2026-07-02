/**
 * CLI Command Handlers
 *
 * Extracted from bin/amicus.js to keep the CLI entry point
 * under the 300-line limit.
 */

const fs = require('fs');
const path = require('path');
const { validateTaskId, safeSessionDir } = require('./utils/validators');

/**
 * Handle 'amicus setup' command
 * Runs interactive setup wizard or adds an alias via --add-alias
 */
async function handleSetup(args) {
  const { addAlias, runInteractiveSetup, runApiKeySetup } = require('./sidecar/setup');

  // Standalone API key window
  if (args['api-keys']) {
    const success = await runApiKeySetup();
    if (success) {
      console.log('API keys configured successfully.');
    } else {
      console.log('API key setup was not completed.');
      process.exit(1);
    }
    return;
  }

  if (args['add-alias']) {
    const spec = args['add-alias'];
    const eqIndex = spec.indexOf('=');
    if (eqIndex === -1) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    const name = spec.slice(0, eqIndex);
    const model = spec.slice(eqIndex + 1);
    if (!name || !model) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    addAlias(name, model);
    console.log(`Alias '${name}' added: ${model}`);
    // F5: warn (never block) when the model is absent from a checkable catalog.
    try {
      const { getCatalog } = require('./utils/model-catalog');
      const { findStaleAliases, suggestReplacements } = require('./utils/alias-audit');
      const catalog = await getCatalog();
      const stale = findStaleAliases([{ alias: name, model, source: 'user-config' }], catalog);
      if (stale.length > 0) {
        const candidates = suggestReplacements(model, catalog);
        console.warn(
          `Warning: '${model}' not found in the model catalog.` +
          (candidates.length > 0 ? ` Did you mean: ${candidates.join(', ')}` : '') +
          `\nDouble-check with: amicus models --search ${model.split('/').pop()}`
        );
      }
    } catch { /* warn-only path */ }
    return;
  }

  await runInteractiveSetup();
}

/**
 * Handle 'sidecar abort' command
 * Marks a running session as aborted
 */
async function handleAbort(args) {
  if (args.all) {
    const project = args.cwd || process.cwd();
    const { enumerateSessions } = require('./sidecar/read');
    const { markAborted } = require('./utils/session-abort');
    const { resolveExistingSessionDir } = require('./session-manager');
    // A session may complete between enumeration and the write (TOCTOU); the
    // window is tiny for a local CLI and markAborted is best-effort, so we count
    // only sessions actually marked aborted.
    const running = enumerateSessions(project, { status: 'running' });
    if (running.length === 0) {
      console.log('No running sessions to abort.');
      return;
    }
    let aborted = 0;
    for (const s of running) {
      if (markAborted(resolveExistingSessionDir(project, s.id), 'abort --all')) {
        aborted++;
        console.log(`Aborted ${s.id}`);
      }
    }
    console.log(`Aborted ${aborted} running session(s).`);
    return;
  }

  const taskId = args._[1];

  if (!taskId) {
    console.error('Error: task_id is required for abort');
    console.error('Usage: amicus abort <task_id>');
    process.exit(1);
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    console.error(taskIdCheck.error);
    process.exit(1);
  }

  const project = args.cwd || process.cwd();
  const sessionDir = safeSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    console.error(`Session ${taskId} not found`);
    process.exit(1);
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (_err) {
    console.error(`Session ${taskId} has malformed metadata`);
    process.exit(1);
  }
  // Guard against a completed/terminal session: without this, metadata.pid
  // still holds a value forever and `amicus abort <completed-task>` would
  // wait the grace window then TerminateProcess whatever unrelated process
  // now owns that (possibly recycled) pid. Mirrors MCP's amicus_abort guard
  // (src/mcp-server.js) — same wording, no re-mark, no kill.
  if (meta.status !== 'running') {
    console.log(`Session ${taskId} is not running (status: ${meta.status}).`);
    return;
  }

  const { markAborted } = require('./utils/session-abort');

  // F4: aborting a wave aborts every still-running leg too.
  if (meta.type === 'wave') {
    const { resolveExistingSessionDir } = require('./session-manager');
    let aborted = 0;
    for (const legId of meta.legs || []) {
      const legDir = resolveExistingSessionDir(project, legId);
      try {
        const legMeta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8'));
        // TOCTOU: a leg may complete between this read and markAborted —
        // best-effort, same contract as abort --all above.
        if (legMeta.status === 'running') {
          if (markAborted(legDir, 'wave abort')) { aborted++; }
        }
      } catch { /* skip unreadable leg */ }
    }
    markAborted(sessionDir, 'manual abort');
    console.log(`Wave ${taskId} marked as aborted (${aborted} running leg(s) aborted).`);
    return;
  }

  markAborted(sessionDir, 'manual abort');
  console.log(`Session ${taskId} marked as aborted.`);

  // Phase 3: fallback direct-kill for a session that does not honor the
  // marker. Headless loops poll the marker every ~2s and the interactive
  // abort watch does too, so the normal outcome is a graceful exit during
  // the grace window; only a wedged/legacy process gets SIGTERM. The wait is
  // awaited on purpose — bin/amicus.js arms its force-exit watchdog only
  // after this handler returns.
  if (meta.pid) {
    const { waitThenKill, abortGraceMs } = require('./utils/abort-coordinator');
    const graceSec = Math.ceil(abortGraceMs() / 1000);
    console.log(`Waiting up to ${graceSec}s for the session process (pid ${meta.pid}) to exit gracefully...`);
    const { killed, exited } = await waitThenKill(meta.pid);
    if (killed.length > 0) {
      console.log(`Process ${meta.pid} did not exit in time — sent SIGTERM (a hard kill on Windows).`);
    } else if (exited.length > 0) {
      console.log('Process exited cleanly.');
    } else {
      // 3.1 contract: an EPERM-unkillable pid lands in NEITHER array —
      // it is still alive and we could not signal it. Say so honestly.
      console.log(`Process ${meta.pid} is still running — could not signal it (insufficient permission). It may require manual termination.`);
    }
  }
}

/**
 * Handle 'amicus update' command
 * Updates amicus to the latest version
 */
async function handleUpdate() {
  const { performUpdate, getUpdateInfo, initUpdateCheck } = require('./utils/updater');
  await initUpdateCheck();
  const info = getUpdateInfo();
  if (info) {
    console.log(`Updating amicus ${info.current} → ${info.latest}...`);
  } else {
    console.log('Updating amicus to latest...');
  }
  const result = await performUpdate();
  if (result.success) {
    console.log("Updated successfully! Run 'amicus --version' to verify.");
  } else {
    console.error(`Update failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Handle 'amicus mcp' command
 * Starts the MCP server on stdio transport
 */
async function handleMcp() {
  const { startMcpServer } = require('./mcp-server');
  await startMcpServer();
}

/**
 * Handle 'amicus key' command
 * Lists, saves, or removes API keys for a provider without opening the Electron wizard.
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

module.exports = {
  handleSetup,
  handleAbort,
  handleUpdate,
  handleMcp,
  handleKey,
};
