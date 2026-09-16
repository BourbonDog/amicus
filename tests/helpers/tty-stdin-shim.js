'use strict';
/**
 * Preloaded with `node -r` by tests/bin/alias-notice-hook.test.js so a spawned
 * bin/amicus.js sees a terminal on stdin (`process.stdin.isTTY`), which a
 * child's piped stdin never is. Test-side only: no production code reads
 * anything this file sets — it is how the #238 D5 exit hook's TTY term is
 * satisfied without a new environment variable (Q8).
 */
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
