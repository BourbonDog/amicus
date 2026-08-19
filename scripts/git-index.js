#!/usr/bin/env node

/**
 * Read file content from the git INDEX rather than the working tree, and list
 * staged paths safely.
 *
 * The pre-commit gates (check-secrets, check-file-sizes, check-citations) used
 * to `readFileSync` the working copy. That is not what a commit contains. Stage
 * a file, edit it again, and the hook inspects the edit while git commits the
 * staged version.
 *
 * `git show :<path>` gives index content, but one subprocess per file blows the
 * hook's sub-2s budget on a repo this size. `git cat-file --batch` reads many
 * blobs per process; reads are chunked so one call's buffer stays bounded.
 *
 * TWO protocol details do real security work here:
 *
 * 1. NUL DELIMITING. `git diff --name-only` QUOTES any path it considers
 *    special — non-ASCII, quotes, backslashes, control characters — emitting
 *    `"w\303\251ird.js"` rather than `wéird.js`. Handing that literal string
 *    back to git resolves to nothing, the path reads as absent, and the gates
 *    SKIP it. Measured: a `sk-ant-…` key in a file named `wéird ünicode.js`
 *    passed check-secrets while the identical key in `plain.js` was blocked.
 *    `-z` turns quoting off and delimits with NUL, which no path may contain.
 *
 * 2. FAIL CLOSED. Callers read an absent path as a staged deletion and skip it,
 *    so any silently dropped entry means a file never gets scanned. Every
 *    requested path must come back with content or with git's explicit
 *    `missing`; anything else throws.
 *
 * Sizes in the batch protocol are BYTE counts, so the parse walks the buffer by
 * byte offset — slicing a JS string by those numbers desyncs on the first
 * multi-byte character, and this repo's comments are full of em-dashes.
 */

const { execFileSync } = require('node:child_process');

/** Milliseconds any single git call may take before the hook gives up. */
const GIT_TIMEOUT_MS = 30000;

/** Paths per `git cat-file` invocation, so one call's output stays bounded. */
const BATCH_SIZE = 400;

/**
 * A path that git has no index entry for — a staged deletion. Distinct from a
 * protocol failure ON PURPOSE: callers legitimately skip this one, and must NOT
 * skip the other. A bare `catch` that treats both alike re-opens the fail-open
 * this module exists to close.
 */
class NotInIndex extends Error {
  constructor(path) {
    super(`not in index: ${path}`);
    this.name = 'NotInIndex';
    this.path = path;
  }
}

/** Run a git command, surfacing stderr instead of swallowing it. */
function runGit(args, input) {
  try {
    return execFileSync('git', args, {
      input,
      maxBuffer: 1 << 28,
      timeout: GIT_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    const why = e.signal === 'SIGTERM' ? `timed out after ${GIT_TIMEOUT_MS}ms` : (stderr || e.message);
    throw new Error(`git ${args.join(' ')} failed: ${why}`);
  }
}

/** Run `git cat-file --batch -z`, feeding it NUL-terminated object names. */
function runBatch(input) {
  return runGit(['cat-file', '--batch', '-z'], input);
}

/**
 * Parse `git cat-file --batch` output.
 *
 * Each entry is either `<oid> <type> <size>\n<content>\n` or `<name> missing\n`.
 * Entries come back in request order, so results zip against the input paths.
 *
 * @param {Buffer} buf - raw batch output
 * @param {string[]} paths - the paths requested, in order
 * @returns {Map<string, string>} path -> content; absent only for `missing`
 */
function parseBatch(buf, paths) {
  const out = new Map();
  let off = 0;
  const fail = (why) => { throw new Error(`git cat-file --batch: ${why}`); };

  for (let i = 0; i < paths.length; i++) {
    if (off >= buf.length) {
      fail(`output ended after ${i} of ${paths.length} entries (next: ${paths[i]})`);
    }
    const nl = buf.indexOf(0x0a, off);
    if (nl === -1) { fail(`unterminated header for ${paths[i]}`); }
    const header = buf.toString('utf-8', off, nl);
    off = nl + 1;
    // The ONLY legitimate way for a requested path to carry no content.
    if (header.endsWith(' missing')) { continue; }
    const size = Number(header.split(' ')[2]);
    // Negative or fractional sizes would move `off` backwards or mid-character
    // and desync every later entry, so they are protocol errors, not content.
    if (!Number.isInteger(size) || size < 0) {
      fail(`unparseable size in header '${header}' for ${paths[i]}`);
    }
    if (off + size > buf.length) {
      fail(`truncated output for ${paths[i]} (declared ${size} bytes, ${buf.length - off} available)`);
    }
    out.set(paths[i], buf.toString('utf-8', off, off + size));
    off += size + 1; // content, then the newline the protocol appends
  }
  return out;
}

/**
 * Read many paths' index content, in chunked git calls.
 * @param {string[]} paths
 * @param {(input: string) => Buffer} [batch] - injectable for tests
 * @param {number} [chunkSize]
 * @returns {Map<string, string>} path -> staged content (absent if not in index)
 */
function readIndexContent(paths, batch = runBatch, chunkSize = BATCH_SIZE) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += chunkSize) {
    const slice = paths.slice(i, i + chunkSize);
    // NUL-terminated, so a path containing any character git would otherwise
    // quote still round-trips exactly.
    const got = parseBatch(batch(slice.map(p => `:${p}\0`).join('')), slice);
    for (const [k, v] of got) { out.set(k, v); }
  }
  return out;
}

/**
 * Read one path's index content.
 * @param {string} path
 * @param {(input: string) => Buffer} [batch]
 * @returns {string|null} staged content, or null when the path is not in the index
 */
function readIndexFile(path, batch = runBatch) {
  const got = readIndexContent([path], batch);
  return got.has(path) ? got.get(path) : null;
}

/**
 * Staged paths, NUL-delimited so quoting can never mangle one.
 *
 * `--name-status` is used rather than `--name-only` because a RENAME carries
 * two paths and both matter: the old one is what other files still cite. In -z
 * form each field is its own NUL-terminated record, so `R100`, the old path and
 * the new path arrive as three records.
 *
 * @param {string} [filter] - --diff-filter value
 * @param {string} [raw] - raw -z output, for testing
 * @returns {string[]} every path the staged change touches
 */
function stagedPaths(filter = 'ACMRD',
  raw = runGit(['diff', '--cached', '--name-status', '-z', `--diff-filter=${filter}`]).toString('utf-8')) {
  const fields = raw.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    // R and C carry a similarity score and TWO paths; everything else carries one.
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let n = 0; n < count && i < fields.length; n++) { paths.push(fields[i++]); }
  }
  return paths;
}

module.exports = {
  readIndexContent, readIndexFile, parseBatch, runBatch, runGit,
  stagedPaths, NotInIndex, BATCH_SIZE, GIT_TIMEOUT_MS,
};
