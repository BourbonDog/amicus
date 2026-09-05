#!/usr/bin/env node
'use strict';

/**
 * A stand-in for the opencode binary. It records the env it was SPAWNED with
 * and speaks the one line @opencode-ai/sdk's createOpencodeServer waits for,
 * then stays alive until the SDK's close() kills it (15 s at most).
 * Used by tests/opencode-client-sdk-spawn-timing.test.js to drive the REAL
 * SDK through the REAL startServer with no engine and no network.
 */
const fs = require('fs');

const out = process.env.FAKE_ENGINE_OUT;
if (out) {
  const flag = process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
  fs.writeFileSync(out, JSON.stringify({
    flag: flag === undefined ? null : flag,
    args: process.argv.slice(2),
    configContent: process.env.OPENCODE_CONFIG_CONTENT ? 'present' : 'absent',
  }));
}
process.stdout.write('opencode server listening on http://127.0.0.1:1\n');
setTimeout(() => process.exit(0), 15000);
