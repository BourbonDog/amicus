/**
 * Helper script: starts a real OpenCode server and prints connection info.
 *
 * Outputs a single JSON line to stdout: { "port": <number>, "sessionId": "<string>" }
 * Then stays alive so the server keeps running. Kill this process to stop the server.
 *
 * This runs outside Jest to avoid the --experimental-vm-modules limitation
 * with dynamic ESM imports in the OpenCode SDK.
 */

// Ensure the SDK can spawn the opencode binary. The shared util also adds the
// Windows platform sub-package bin dirs (opencode.exe) — spawn() can't execute
// the .bin/*.cmd shims without shell:true, so the hand-rolled .bin-only PATH
// prepend this replaced was ENOENT-ing on Windows.
const { ensureNodeModulesBinInPath } = require('../../src/utils/path-setup');
ensureNodeModulesBinInPath();

async function main() {
  // Dynamic import to handle ESM SDK
  const { startServer, createSession, checkHealth } = require('../../src/opencode-client');

  // waitForServer is a simple polling loop, safe to import
  const { waitForServer } = require('../../src/headless');

  const { client, server } = await startServer({ port: 0 });

  const ready = await waitForServer(client, checkHealth);
  if (!ready) {
    server.close();
    process.stderr.write('Server health check failed\n');
    process.exit(1);
  }

  const sessionId = await createSession(client);
  const port = parseInt(new URL(server.url).port, 10);

  // Output connection info as JSON (single line)
  process.stdout.write(JSON.stringify({ port, sessionId }) + '\n');

  // Keep the process alive so the server stays running.
  // The parent test process will kill us when done.
  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`start-server.js error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
