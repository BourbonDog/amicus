# Documentation System

Canonical reference for the auto-documentation system that keeps the generated docs in sync with the codebase.

## Overview

CLAUDE.md uses **progressive disclosure**: a slim main file (~400 lines) with auto-generated sections and pointers to deeper topic docs. This replaces a monolithic 875-line file that was too large for effective agent context.

Inspired by [OpenAI's Harness Engineering](https://openai.com/index/harness-engineering/) approach: "give Codex a map, not a 1,000-page instruction manual."

## Auto-Generated Sections

Sections between `<!-- AUTO:name -->` markers are maintained by `scripts/generate-docs.js`. Do NOT edit these by hand.

Each marker is routed to the document that owns it by the `MARKER_TARGETS` table in `scripts/generate-docs.js`. A marker with no entry there defaults to CLAUDE.md. Today both markers live in [architecture-map.md](architecture-map.md), which keeps the ~15k-token generated inventory out of the file loaded into every agent context.

### Marker Format

```markdown
<!-- AUTO:tree -->
(generated content here)
<!-- /AUTO:tree -->
```

### Current Markers

| Marker | Target document | Content | Source |
|--------|-----------------|---------|--------|
| `tree` | `docs/architecture-map.md` | ASCII directory tree with JSDoc annotations | Filesystem scan of `bin/`, `src/`, `electron/`, `scripts/`, `evals/` (note: `tests/` is NOT included) |
| `modules` | `docs/architecture-map.md` | Markdown table of all `src/**/*.js` modules | JSDoc description + `module.exports` extraction |

### How It Works

1. `scripts/generate-docs.js` scans the codebase
2. For each marker, it generates new content from the source of truth (filesystem, JSDoc)
3. It replaces the content between the open/close marker tags, in whichever document `MARKER_TARGETS` routes that marker to
4. It auto-stages every document it wrote with `git add`

### Adding a New Auto-Generated Section

1. Add a new marker pair to the document that should own it (short lowercase name, no hyphens required but keep it terse):
   ```markdown
   <!-- AUTO:my-section -->
   <!-- /AUTO:my-section -->
   ```
2. Add a generator function in `scripts/generate-docs.js` (or `scripts/generate-docs-helpers.js`)
3. Add it to the `generated` map in `main()`
4. If it should NOT live in CLAUDE.md, add `markerName: 'relative/path.md'` to `MARKER_TARGETS`
4. Add tests in `tests/scripts/generate-docs.test.js`

## Cross-Link Validation

When running `--check` mode, the script validates every markdown link in CLAUDE.md:

- `[text](path)` links are resolved relative to the project root
- External URLs (`https://...`) are skipped
- Anchor-only links (`#section`) are skipped
- Broken links cause `--check` to exit 1

## Plans Index

No plans index is generated **today**. `buildPlansIndex()` in `scripts/generate-docs.js` scans
`docs/plans/` and `docs/archive/plans/`, but neither directory exists in this repo, and
`runWriteMode()` writes `docs/plans/index.md` only when `docs/plans/` already exists — so the write
never fires. Note that guard is a runtime `fs.existsSync` check, not a disabled feature: creating
`docs/plans/` would silently reactivate it, emitting a bare list of `- [name](path)` links without
the per-plan first heading or date the old text here promised. Plans actually live in
`docs/superpowers/plans/`, which are working documents pruned at each release cut — specs in `docs/superpowers/specs/` are the permanent record.

## Commands

```bash
node scripts/generate-docs.js          # Regenerate all auto sections
node scripts/generate-docs.js --check  # Verify everything is current (CI mode)
npm run generate-docs                  # Alias for write mode
npm run generate-docs:check            # Alias for check mode
```

## Pre-Commit Integration

The pre-commit hook runs `generate-docs.js` in write mode automatically. If CLAUDE.md changes, it stages the update. Developers never need to run the script manually.

Hook order:
1. lint-staged
2. check-secrets
3. check-file-sizes
4. **generate-docs.js** (auto-stages CLAUDE.md if changed)
5. validate-docs.js (warns about manual drift)

## Troubleshooting

| Problem | Solution |
|---------|---------|
| "Marker not found" error | Ensure `<!-- AUTO:name -->` and `<!-- /AUTO:name -->` exist in CLAUDE.md |
| Stale markers after code change | Run `node scripts/generate-docs.js` manually |
| Cross-link validation failure | Fix the broken link in CLAUDE.md or create the missing file |
