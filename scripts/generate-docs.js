#!/usr/bin/env node

/**
 * Auto-generate CLAUDE.md sections from source code.
 *
 * Two modes:
 * - Default (write): Regenerates AUTO markers in CLAUDE.md, writes plans index, auto-stages.
 * - --check: Compares generated vs current, validates cross-links, exits 1 if stale.
 *
 * Usage:
 *   node scripts/generate-docs.js          # Write mode (regenerate + stage)
 *   node scripts/generate-docs.js --check  # Check mode (validate only)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  extractJSDocDescription,
  extractExports,
  buildDirectoryTree,
  buildModuleIndex,
} = require('./generate-docs-helpers');

const TREE_DIRS = ['bin/', 'src/', 'electron/', 'scripts/', 'evals/'];

// ---------------------------------------------------------------------------
// Marker Replacement
// ---------------------------------------------------------------------------

/**
 * Replace content between AUTO markers in a document.
 * Markers: `<!-- AUTO:name -->` ... `<!-- /AUTO:name -->`
 * @param {string} content - Full document content
 * @param {string} markerName - Marker identifier
 * @param {string} newContent - Replacement content
 * @returns {string} Updated document
 */
function replaceMarkers(content, markerName, newContent) {
  const open = `<!-- AUTO:${markerName} -->`;
  const close = `<!-- /AUTO:${markerName} -->`;
  const openIdx = content.indexOf(open);
  const closeIdx = content.indexOf(close);

  if (openIdx === -1 || closeIdx === -1) {
    return content;
  }

  const before = content.slice(0, openIdx + open.length);
  const after = content.slice(closeIdx);
  return `${before}\n${newContent}\n${after}`;
}

// ---------------------------------------------------------------------------
// Cross-Link Validation
// ---------------------------------------------------------------------------

/**
 * Validate that markdown cross-links point to existing files.
 * Skips http/https URLs and anchor-only links.
 * @param {string} markdown - Markdown content
 * @param {string} rootDir - Project root for resolving relative paths
 * @returns {string[]} Array of error messages for broken links
 */
function validateCrossLinks(markdown, rootDir) {
  const errors = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRe.exec(markdown)) !== null) {
    const target = match[2];
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) {
      continue;
    }
    const filePart = target.split('#')[0];
    if (!filePart) {
      continue;
    }
    const resolved = path.resolve(rootDir, filePart);
    if (!fs.existsSync(resolved)) {
      errors.push(`Broken link: [${match[1]}](${target}) -> ${filePart} not found`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Plans Index Builder
// ---------------------------------------------------------------------------

/**
 * Generate a markdown index of plan files.
 * Scans docs/plans/ and docs/archive/plans/.
 * @param {string} rootDir - Project root directory
 * @returns {string} Markdown listing of plan files
 */
function buildPlansIndex(rootDir) {
  const activePath = path.join(rootDir, 'docs', 'plans');
  const archivePath = path.join(rootDir, 'docs', 'archive', 'plans');
  const active = listMdFiles(activePath);
  const archived = listMdFiles(archivePath);

  if (active.length === 0 && archived.length === 0) {
    return 'No plan files found.';
  }

  const sections = [];
  if (active.length > 0) {
    sections.push('## Active Plans\n');
    for (const f of active) {
      sections.push(`- [${f}](docs/plans/${f})`);
    }
  }
  if (archived.length > 0) {
    if (sections.length > 0) {
      sections.push('');
    }
    sections.push('## Archive Plans\n');
    for (const f of archived) {
      sections.push(`- [${f}](docs/archive/plans/${f})`);
    }
  }
  return sections.join('\n');
}

/** @param {string} dirPath @returns {string[]} Sorted .md filenames */
function listMdFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath).filter(f => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Staleness Check
// ---------------------------------------------------------------------------

/**
 * Compare current marker content against freshly generated content.
 * @param {string} docContent - Current document content
 * @param {Object<string, string>} generated - Map of markerName -> generated content
 * @returns {string[]} Names of stale markers
 */
function checkMarkersAreCurrent(docContent, generated) {
  const stale = [];
  for (const [name, expected] of Object.entries(generated)) {
    const open = `<!-- AUTO:${name} -->`;
    const close = `<!-- /AUTO:${name} -->`;
    const openIdx = docContent.indexOf(open);
    const closeIdx = docContent.indexOf(close);

    if (openIdx === -1 || closeIdx === -1) {
      stale.push(name);
      continue;
    }
    const current = docContent.slice(openIdx + open.length, closeIdx).trim();
    if (current !== expected.trim()) {
      stale.push(name);
    }
  }
  return stale;
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/** Main: regenerate or check CLAUDE.md auto-generated sections. */
function main() {
  const rootDir = path.resolve(__dirname, '..');
  const docPath = path.join(rootDir, 'CLAUDE.md');
  const checkMode = process.argv.includes('--check');

  const tree = buildDirectoryTree(rootDir, TREE_DIRS);
  const modules = buildModuleIndex(rootDir);
  const plans = buildPlansIndex(rootDir);
  const generated = { tree, modules };

  if (checkMode) {
    runCheckMode(docPath, rootDir, generated);
    return;
  }

  runWriteMode(docPath, rootDir, generated, plans);
}

/** Check mode: validate markers and cross-links, exit 1 if stale. */
function runCheckMode(docPath, rootDir, generated) {
  let doc;
  try {
    doc = fs.readFileSync(docPath, 'utf-8');
  } catch {
    console.error('Cannot read CLAUDE.md');
    process.exit(1);
  }

  const stale = checkMarkersAreCurrent(doc, generated);
  const linkErrors = validateCrossLinks(doc, rootDir);

  if (stale.length > 0) {
    console.error(`Stale markers: ${stale.join(', ')}`);
  }
  for (const err of linkErrors) {
    console.error(err);
  }
  if (stale.length > 0 || linkErrors.length > 0) {
    console.error('\nRun `node scripts/generate-docs.js` to regenerate.');
    process.exit(1);
  }
  console.log('All markers are current.');
}

/** Write mode: regenerate markers, write plans index, auto-stage. */
function runWriteMode(docPath, rootDir, generated, plans) {
  let doc;
  try {
    doc = fs.readFileSync(docPath, 'utf-8');
  } catch {
    console.error('Cannot read CLAUDE.md');
    process.exit(1);
  }

  doc = replaceMarkers(doc, 'tree', generated.tree);
  doc = replaceMarkers(doc, 'modules', generated.modules);
  fs.writeFileSync(docPath, doc);

  const plansIndexPath = path.join(rootDir, 'docs', 'plans', 'index.md');
  if (fs.existsSync(path.dirname(plansIndexPath))) {
    fs.writeFileSync(plansIndexPath, `# Plans Index\n\n${plans}\n`);
  }

  try {
    execFileSync('git', ['add', docPath], { stdio: 'ignore' });
    if (fs.existsSync(plansIndexPath)) {
      execFileSync('git', ['add', plansIndexPath], { stdio: 'ignore' });
    }
  } catch {
    // Not in a git repo - that's fine
  }

  console.log('CLAUDE.md markers regenerated.');
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDirectoryTree,
  buildModuleIndex,
  replaceMarkers,
  validateCrossLinks,
  buildPlansIndex,
  checkMarkersAreCurrent,
  extractJSDocDescription,
  extractExports,
  TREE_DIRS,
};
