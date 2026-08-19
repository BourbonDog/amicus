#!/usr/bin/env node

/**
 * Cross-file citation enforcement for the pre-commit hook and the whole-tree
 * CI gate (--all).
 *
 * Comments and tests in this repo cite other files as `path/file.js:NNN`.
 * Those citations rot silently whenever the cited file changes: PR #171
 * produced ~30 review findings and NOT ONE was in the code — they were stale
 * statements ABOUT the code, mostly rotted citations.
 *
 * The citation forms understood, and what each is checked against:
 *
 *   file.js:NNN            line citation  — target resolves unambiguously, NNN in range
 *   file.js:NNN-MMM        range          — as above, and the range runs forwards
 *   file.js :: symbol      SYMBOL ANCHOR  — the symbol (dotted path AS WRITTEN) is in the target
 *   file.js@<ref>:NNN      HISTORICAL     — NNN in range in the file AT <ref>
 *   file.js@<ref> :: sym   HISTORICAL+    — the symbol existed in that file AT <ref>
 *
 * Prefer the SYMBOL ANCHOR. A corrected line number is true until the next
 * edit and then silently false; a symbol anchor survives every move. Use the
 * HISTORICAL form for provenance ("moved verbatim from X") so a statement
 * about a past tree stays machine-checkable instead of reading as rot.
 *
 * SCOPE (the reason this is enforceable rather than a 486-violation backlog):
 * a commit is checked against the union of
 *   IN — citations living in the files the commit changed, and
 *   TO — citations anywhere in live code that POINT AT a file the commit changed.
 * TO is what catches extractions. Measured over PR #171's 38 commits, 119
 * corrected-citation instances split 66 IN-scope / 18 TO-scope-only: a gate
 * scoped to changed files ALONE would have shipped all 18, including every
 * run-retry.js citation in src/headless.js and three test files that the
 * extraction commit never had open.
 *
 * Doc-tree citations (BACKLOG.md, docs/) are deliberately NOT scanned — 3639
 * of the repo's citations live there and are overwhelmingly dated historical
 * record. See docs/CITATIONS.md for the convention that governs them.
 *
 * Usage:
 *   node scripts/check-citations.js          # Scans git staged files (IN u TO)
 *   node scripts/check-citations.js --all    # Scans all tracked live files (CI)
 *   const { checkCitations } = require('./scripts/check-citations');
 */

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { readIndexContent, readIndexFile } = require('./git-index');

const CONFIG = {
  // Live code whose citations are maintained and therefore enforced.
  include: ['src/**/*.js', 'electron/**/*.js', 'tests/**/*.js'],
  exclude: [
    // Carries deliberately-broken citations as test fixtures.
    'tests/scripts/check-citations.test.js',
  ],
  // Cited paths that are real but live outside this repo, so no tracked file
  // can ever resolve them. Keep this list short and justified.
  external: [
    // @opencode-ai/sdk's own build output, cited for its 5000ms default.
    'dist/server.js',
  ],
  // Known-stale citations, grandfathered so the gate can block from day one.
  // Every one of these rotted when v4.8 PR0 split its target file. Fix the
  // citation (prefer a `file.js :: symbol` anchor), then delete the entry.
  grandfathered: [
    { file: 'tests/route-launch-local.test.js', cite: 'route-launch.js:269' },
    { file: 'tests/route-launch-local.test.js', cite: 'route-launch.js:292-294' },
    { file: 'tests/workspace/dead-seat-twins.test.js', cite: 'live-seats.js:209' },
    { file: 'tests/workspace/run-detail.test.js', cite: 'run.js:293' },
    { file: 'tests/workspace/workspace-seats.test.js', cite: 'live-seats.js:170-174' },
    { file: 'tests/workspace/workspace-seats.test.js', cite: 'live-seats.js:234-243' },
    { file: 'tests/workspace/workspace-seats.test.js', cite: 'live-model.js:227-241' },
    // Not a moved-target rot: `createSessionMetadata` is a symbol (it lives in
    // src/sidecar/start-metadata.js), never a file. Malformed since it was written.
    { file: 'tests/start-json.test.js', cite: 'createSessionMetadata.js:50' },
  ],
};

// A citation: a .js path, an optional @ref, then either :NNN[-MMM] or :: symbol.
// The path class allows dots so `run-retry.test.js` is one token, and the
// lookbehind stops the match starting mid-identifier.
const CITATION = new RegExp(
  '(?<![A-Za-z0-9_./-])' +
  '([A-Za-z0-9_./-]*[A-Za-z0-9_-]\\.js)' +
  '(?:@([A-Za-z0-9_./-]+))?' +
  // The symbol is dotted-but-not-dot-terminated, so a sentence-ending period
  // ("… :: materializeDebate.") stays out of the captured name.
  '(?:\\s*::\\s*([A-Za-z0-9_$]+(?:\\.[A-Za-z0-9_$]+)*)|:(\\d+)(?:-(\\d+))?)',
  'g'
);

/**
 * Count lines the way this repo counts them (mirrors check-file-sizes.js, so a
 * citation to the last line of a size-gated file is in range, not off by one).
 * @param {string} content
 * @returns {number}
 */
function countLines(content) {
  const n = content.split('\n').length;
  return content.endsWith('\n') ? n - 1 : n;
}

/**
 * Parse every citation out of one file's content.
 * @param {string} content
 * @returns {Array<{raw: string, path: string, ref: string|null, symbol: string|null,
 *                  start: number|null, end: number|null, line: number}>}
 */
function parseCitations(content) {
  const found = [];
  const lines = content.split('\n');
  lines.forEach((text, i) => {
    CITATION.lastIndex = 0;
    let m;
    while ((m = CITATION.exec(text))) {
      found.push({
        raw: m[0],
        path: m[1],
        ref: m[2] || null,
        symbol: m[3] || null,
        start: m[4] ? Number(m[4]) : null,
        end: m[5] ? Number(m[5]) : (m[4] ? Number(m[4]) : null),
        line: i + 1,
      });
    }
  });
  return found;
}

/**
 * Resolve a cited path to a tracked file: exact path, then path suffix, then
 * basename. The basename fallback is what makes `deriveSeatLoss/verdict.js`
 * and `./run-stages.js` resolve — prose prefixes are common in this repo.
 * @param {string} cited
 * @param {string[]} tracked
 * @returns {string[]} matching tracked paths (0 = unresolved, >1 = ambiguous)
 */
function resolveTarget(cited, tracked) {
  const clean = cited.replace(/^\.\//, '');
  if (tracked.includes(clean)) {return [clean];}
  const suffix = tracked.filter(f => f.endsWith('/' + clean));
  if (suffix.length) {return suffix;}
  const base = clean.split('/').pop();
  return tracked.filter(f => f.endsWith('/' + base) || f === base);
}

/**
 * Simple glob match, identical in behaviour to check-file-sizes.js's.
 * @param {string} filePath
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesPattern(filePath, patterns) {
  for (const pattern of patterns) {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '<<GLOBSTAR_DIR>>')
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR_DIR>>/g, '(?:[^/]+/)*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    if (new RegExp(`^${regexStr}$`).test(filePath)) {return true;}
  }
  return false;
}

/**
 * Match an identifier on JS identifier boundaries. `\b` is wrong here: it is
 * defined on [A-Za-z0-9_], so `\b$el\b` can never match `$el` — the boundary
 * before `$` does not exist and a present symbol reads as missing.
 * @param {string} ident
 * @returns {RegExp}
 */
function identifierRegex(ident) {
  const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
}

/**
 * Is a symbol anchor's target present? A dotted path is checked AS WRITTEN —
 * `foo.bar` must appear as `foo.bar`. Checking each segment independently
 * passes whenever an unrelated `foo` and an unrelated `bar` both exist
 * somewhere in the file, which verifies nothing about the chain that was cited.
 * @param {string} symbol
 * @param {string} content
 * @returns {boolean}
 */
function symbolPresent(symbol, content) {
  return identifierRegex(symbol).test(content);
}

/**
 * Check one citation against the tree.
 * @param {object} cite - from parseCitations
 * @param {string} container - path of the file the citation lives in
 * @param {object} ctx - {tracked, readFile, readAtRef, config, shallow, skippedRefs}
 * @returns {null | {file: string, line: number, cite: string, reason: string}}
 */
function checkCitation(cite, container, ctx) {
  const config = ctx.config || CONFIG;
  const fail = reason => ({ file: container, line: cite.line, cite: cite.raw, reason });

  if (config.grandfathered.some(g => g.file === container && g.cite === cite.raw)) {return null;}
  if (config.external.includes(cite.path.replace(/^\.\//, ''))) {return null;}

  // A backwards range is malformed, and checking only its high line would HIDE an
  // out-of-range start: `a.js:200-100` against a 150-line file passes on 100.
  if (cite.start !== null && cite.end !== null && cite.start > cite.end) {
    return fail(`range runs backwards (${cite.start} > ${cite.end})`);
  }
  // Lines are 1-based. Only the END was bounded before, so `a.js:0-50` slipped
  // through on its end while naming a line that does not exist.
  if (cite.start !== null && cite.start < 1) {
    return fail(`line ${cite.start} is not a line (lines are 1-based)`);
  }

  // ONE resolution for BOTH forms. Resolving separately per branch is exactly
  // what let an ambiguous basename through the @ref side after the plain side
  // had started refusing it — fix one site, miss its twin, which is the failure
  // this gate exists to catch. Ambiguity is settled here, before either branch.
  const targets = resolveTarget(cite.path, ctx.tracked);
  if (targets.length > 1) {
    return fail(`'${cite.path}' is ambiguous (${targets.join(', ')}) — qualify the path`);
  }

  // Historical form: resolve the file AT that ref and range-check there.
  if (cite.ref) {
    // Zero targets is legitimate HERE AND ONLY HERE: a historical citation may
    // name a file that no longer exists at HEAD, which is half the point of the
    // form. Hand the cited path over and let `git show <ref>:<path>` decide.
    const at = targets[0] || cite.path.replace(/^\.\//, '');
    let content;
    try {
      content = ctx.readAtRef(cite.ref, at);
    } catch {
      // A shallow clone (actions/checkout defaults to fetch-depth 1) simply does
      // not HAVE the historical commit, which is indistinguishable from a bogus
      // ref. Skipping is the only correct call there — but never silently: main()
      // prints what was skipped, and the `quality` CI job checks out full history
      // so these are really verified exactly once per push.
      if (ctx.shallow) {
        ctx.skippedRefs.push(`${container}:${cite.line}  [${cite.raw}]`);
        return null;
      }
      return fail(`historical ref '${cite.ref}' does not resolve to ${cite.path}`);
    }
    // `file.js@<ref> :: symbol` means "this symbol existed at that ref". Without
    // this branch the hybrid form parsed fine and was checked by NOTHING —
    // cite.end is null, so the range check below fell straight through to pass.
    if (cite.symbol) {
      return symbolPresent(cite.symbol, content)
        ? null
        : fail(`symbol '${cite.symbol}' not in ${cite.path} at ${cite.ref}`);
    }
    const max = countLines(content);
    if (cite.end < 1 || cite.end > max) {
      return fail(`line ${cite.end} is outside ${cite.path} at ${cite.ref} (${max} lines)`);
    }
    return null;
  }

  if (targets.length === 0) {return fail(`no tracked file matches '${cite.path}'`);}
  const target = targets[0];
  let content;
  try {
    content = ctx.readFile(target);
  } catch {
    // Tracked, but not in THIS commit — the target is staged for deletion.
    // That is a finding, not a crash: citing a file the commit removes is
    // exactly the rot this gate exists to catch, at the moment it is created.
    return fail(`'${target}' is not in this commit (staged for deletion?)`);
  }

  // Symbol anchor: every segment must appear in the target. Rot-immune form.
  if (cite.symbol) {
    return symbolPresent(cite.symbol, content)
      ? null
      : fail(`symbol '${cite.symbol}' not found in ${target}`);
  }

  // Line/range citation: the highest cited line must exist in the target.
  const max = countLines(content);
  if (cite.end < 1 || cite.end > max) {
    return fail(`line ${cite.end} is outside ${target} (${max} lines)`);
  }
  return null;
}

/**
 * Check every citation in a set of files.
 * @param {Array<{path: string, content: string}>} files
 * @param {object} ctx - {tracked, readFile, readAtRef, config}
 * @returns {Array<{file: string, line: number, cite: string, reason: string}>}
 */
function checkCitations(files, ctx) {
  const violations = [];
  for (const { path, content } of files) {
    for (const cite of parseCitations(content)) {
      const v = checkCitation(cite, path, ctx);
      if (v) {violations.push(v);}
    }
  }
  return violations;
}

/**
 * The commit's citation scope: files the commit changed (IN), plus every live
 * file holding a citation that points AT a changed file (TO).
 * @param {string[]} changed - paths the commit touched (INCLUDING deletions)
 * @param {string[]} scanned - live files eligible for scanning
 * @param {(p: string) => string} readFile
 * @param {string[]} [tracked] - full tracked set, for resolving cited paths
 * @returns {string[]} files to scan, sorted
 */
function scopeForCommit(changed, scanned, readFile, tracked = scanned) {
  const changedSet = new Set(changed);
  const inScope = new Set(changed.filter(f => scanned.includes(f)));
  const changedBases = new Set(changed.map(f => f.split('/').pop()));
  for (const f of scanned) {
    if (inScope.has(f)) {continue;}
    let content;
    // A staged deletion leaves the path unreadable; that file is gone, not in scope.
    try { content = readFile(f); } catch { continue; }
    // Cheap pre-filter before the regex: the basename must appear at all.
    if (![...changedBases].some(b => content.includes(b))) {continue;}
    for (const cite of parseCitations(content)) {
      const targets = resolveTarget(cite.path, tracked);
      // Resolve before comparing, so touching src/council/run.js does not drag in
      // every file citing electron/ui/run.js. A DELETED target resolves to
      // nothing (git ls-files drops it from the index), so fall back to the
      // basename — otherwise the commit that deletes a file is exactly the one
      // that never checks the citations it just broke.
      const hit = targets.length
        ? targets.some(t => changedSet.has(t))
        : changedBases.has(cite.path.split('/').pop());
      if (hit) { inScope.add(f); break; }
    }
  }
  return [...inScope].sort();
}

/**
 * Every path a staged change touches, INCLUDING both halves of a rename.
 *
 * `--name-only` reports a rename as its NEW path alone, so the old path never
 * enters scope and the renaming commit is the one commit that cannot see the
 * citations it just broke — the same hole deletions had. `--name-status` gives
 * `R100<TAB>old<TAB>new`, and both halves matter: the old path is what other
 * files still cite, the new path is what they must be re-anchored to.
 * @param {string} [raw] - `git diff --cached --name-status` output, for testing
 * @returns {string[]}
 */
function stagedPaths(raw = execFileSync(
  'git', ['diff', '--cached', '--name-status', '--diff-filter=ACMRD'],
  { encoding: 'utf-8' }
)) {
  const paths = [];
  for (const line of raw.trim().split('\n').filter(Boolean)) {
    // status, then 1 path (A/C/D/M) or 2 (R/C with a similarity score).
    paths.push(...line.split('\t').slice(1).map(s => s.trim()).filter(Boolean));
  }
  return paths;
}

/** List git-tracked files. */
function listTrackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf-8' })
    .trim().split('\n').filter(Boolean);
}

/**
 * True when this clone lacks full history, so a historical ref may be absent
 * for reasons that have nothing to do with the citation being wrong.
 */
function isShallowClone() {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'],
      { encoding: 'utf-8' }).trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Build the IO context the pure checkers run against.
 * @param {string[]} [tracked]
 * @param {object} [config]
 * @param {Map<string,string>|null} [staged] - index content. When given, files
 *   are read from the INDEX (what the commit will contain) instead of the
 *   working tree. A path absent from the map is absent from the commit — a
 *   staged deletion — and reading it throws, which callers treat as "skip".
 */
function buildContext(tracked = listTrackedFiles(), config = CONFIG, staged = null) {
  const cache = new Map();
  return {
    tracked,
    config,
    shallow: isShallowClone(),
    skippedRefs: [],
    readFile(p) {
      if (staged) {
        if (staged.has(p)) { return staged.get(p); }
        // The prefetch covers the SCAN set, but a citation TARGET can be any
        // tracked .js — scripts/, bin/ and evals/ are all cited from scanned
        // files. Reading those lazily is what keeps the hook from throwing on a
        // commit that merely touches a file citing scripts/postinstall.js.
        const lazy = readIndexFile(p);
        if (lazy === null) { throw new Error(`not in index: ${p}`); }
        staged.set(p, lazy);
        return lazy;
      }
      if (!cache.has(p)) {cache.set(p, readFileSync(resolve(p), 'utf-8'));}
      return cache.get(p);
    },
    // Pure IO: the caller has already resolved the path through resolveTarget,
    // so this cannot disagree with the plain form about which file is meant.
    readAtRef(ref, path) {
      return execFileSync('git', ['show', `${ref}:${path}`], {
        encoding: 'utf-8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'],
      });
    },
  };
}

/** The live files this gate scans. */
function scanSet(tracked, config = CONFIG) {
  return tracked.filter(f =>
    matchesPattern(f, config.include) && !matchesPattern(f, config.exclude)
  );
}

/** Whole-tree scan (CI / --all). */
function checkAllTracked(tracked = listTrackedFiles(), config = CONFIG,
  ctx = buildContext(tracked, config)) {
  const files = scanSet(tracked, config).map(p => ({ path: p, content: ctx.readFile(p) }));
  return checkCitations(files, ctx);
}

/**
 * Say out loud which historical refs went unverified. A skipped check that
 * reports nothing is indistinguishable from a check that passed.
 */
function noticeSkipped(ctx) {
  if (!ctx.skippedRefs.length) {return;}
  console.error(
    `\n  NOTE: ${ctx.skippedRefs.length} historical @ref citation(s) NOT verified — ` +
    'this is a shallow clone.\n  The `quality` CI job checks out full history and verifies them.'
  );
  for (const s of ctx.skippedRefs) {console.error(`    ${s}`);}
}

/** Report violations and exit non-zero. */
function report(violations) {
  console.error('\n  BLOCKED: stale cross-file citations:');
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  [${v.cite}]  ${v.reason}`);
  }
  console.error(
    '\n  Open the cited line and re-anchor it. Prefer `file.js :: symbolName`\n' +
    '  — a line number is true until the next edit; a symbol anchor survives\n' +
    '  every move. For provenance, use `file.js@<ref>:NNN`.\n'
  );
  process.exit(1);
}

/** Main: staged scope (pre-commit) or whole tree (--all / CI). */
function main() {
  const tracked = listTrackedFiles();

  if (process.argv.includes('--all')) {
    // Whole-tree mode reads the working tree on purpose: it audits the checkout
    // as it stands (CI has no staging area to differ from), and it is also the
    // mode people run by hand to see what a file says right now.
    const allCtx = buildContext(tracked);
    const violations = checkAllTracked(tracked, CONFIG, allCtx);
    noticeSkipped(allCtx);
    if (violations.length > 0) {report(violations);}
    process.exit(0);
  }

  let staged;
  try {
    // D (deletions) is deliberately included, unlike check-file-sizes.js and
    // check-secrets.js which both use ACM. A deleted file needs no size or
    // secret scan — there is nothing left to scan. But deleting or RENAMING a
    // file is one of the surest ways to falsify OTHER files' citations, so both
    // must enter the scope calculation, and a rename must contribute BOTH of
    // its paths — see stagedPaths.
    staged = stagedPaths();
  } catch {
    console.error('Failed to get staged files.');
    process.exit(1);
  }
  if (staged.length === 0) {process.exit(0);}

  // Read the INDEX, not the working tree: the index is what this commit will
  // contain. Batched `git cat-file` reads, a few hundred paths per call —
  // per-file `git show` would cost ~900 subprocesses and blow the time budget.
  //
  // Prefetch every tracked .js, not merely the scan set: a citation TARGET can
  // be any of them (scripts/, bin/ and evals/ are all cited from scanned files),
  // and leaving those to the lazy path spawns one process per target.
  const scan = scanSet(tracked);
  const prefetch = [...new Set([...scan, ...tracked.filter(f => f.endsWith('.js'))])];
  const ctx = buildContext(tracked, CONFIG, readIndexContent(prefetch));

  const scope = scopeForCommit(staged, scan, ctx.readFile, tracked);
  if (scope.length === 0) {process.exit(0);}

  const files = [];
  for (const p of scope) {
    // Absent from the index = absent from the commit (a staged deletion).
    try { files.push({ path: p, content: ctx.readFile(p) }); } catch { /* deleted */ }
  }
  const violations = checkCitations(files, ctx);
  noticeSkipped(ctx);
  if (violations.length > 0) {report(violations);}
}

if (process.argv[1] && process.argv[1].includes('check-citations')) {
  main();
}

module.exports = {
  countLines, parseCitations, resolveTarget, matchesPattern, checkCitation,
  identifierRegex, symbolPresent, stagedPaths,
  checkCitations, scopeForCommit, scanSet, buildContext, checkAllTracked,
  listTrackedFiles, isShallowClone, noticeSkipped, CONFIG,
};
