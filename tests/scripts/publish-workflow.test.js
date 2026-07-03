// tests/scripts/publish-workflow.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'publish.yml');

describe('publish workflow (Phase 11 release-rail hardening — B04 + B05)', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');

  test('tag<->package lockstep is checked before npm publish, with a clear ::error:: on mismatch', () => {
    const y = yml();
    const lockstepIdx = y.indexOf('::error::');
    expect(lockstepIdx).toBeGreaterThan(-1);
    // the lockstep check must reference both the tag-derived VERSION and the
    // package.json version, and must run strictly before `npm publish`
    const checkBlock = y.slice(0, y.indexOf('npm publish --access public'));
    expect(checkBlock).toMatch(/package\.json/);
    expect(checkBlock).toMatch(/VERSION/);
    expect(checkBlock).toContain('::error::');
    expect(checkBlock).toMatch(/exit 1/);
  });

  test('npm publish is gated by a version-exists guard, and the publish invocation stays byte-identical', () => {
    const y = yml();
    // the exact publish command must survive untouched
    expect(y).toContain('npm publish --access public --provenance');
    // guard must check the registry before publishing
    expect(y).toMatch(/npm view "?amicus@\$VERSION"? version/);
    // must emit a ::notice:: when skipping
    expect(y).toContain('::notice::');
  });

  test('ordering: tag-lockstep check < npm publish < mcp-publisher publish', () => {
    const y = yml();
    const lockstepGuardMatch = y.match(/npm view "?amicus@\$VERSION"? version/);
    const lockstepGuardIdx = lockstepGuardMatch ? lockstepGuardMatch.index : -1;
    const npmPublishIdx = y.indexOf('npm publish --access public --provenance');
    const mcpPublishIdx = y.indexOf('./mcp-publisher publish');
    expect(lockstepGuardIdx).toBeGreaterThan(-1);
    expect(npmPublishIdx).toBeGreaterThan(-1);
    expect(mcpPublishIdx).toBeGreaterThan(-1);
    expect(lockstepGuardIdx).toBeLessThan(npmPublishIdx);
    expect(npmPublishIdx).toBeLessThan(mcpPublishIdx);
  });

  test('mcp-publisher login github-oidc has its own 5x20s retry loop and hard-fails after exhaustion', () => {
    const y = yml();
    // literal string pinned by tests/scripts/package-manifest.test.js — must stay intact
    expect(y).toContain('mcp-publisher login github-oidc');

    // isolate the login step's script (between the login step name and the next step name)
    const loginStepIdx = y.indexOf('mcp-publisher login github-oidc');
    const publishCallIdx = y.indexOf('./mcp-publisher publish');
    expect(publishCallIdx).toBeGreaterThan(loginStepIdx);
    const loginBlock = y.slice(loginStepIdx, publishCallIdx);

    // retry loop: attempted up to 5 times
    expect(loginBlock).toMatch(/for i in 1 2 3 4 5/);
    expect(loginBlock).toMatch(/sleep 20/);
    // hard-fail semantics after exhaustion
    expect(loginBlock).toContain('::error::');
    expect(loginBlock).toMatch(/exit 1/);
  });

  test('mcp-publisher publish retains its existing 5x20s retry loop and hard-fail semantics', () => {
    const y = yml();
    // scope to the whole "Publish to MCP Registry" step (through the next
    // step header), so the retry `for` loop that wraps the publish call —
    // which starts BEFORE the call site — is captured regardless of exact
    // byte offsets.
    const stepStart = y.indexOf('- name: Publish to MCP Registry');
    const nextStepIdx = y.indexOf('- name: Create GitHub Release');
    expect(stepStart).toBeGreaterThan(-1);
    expect(nextStepIdx).toBeGreaterThan(stepStart);
    const registryStepBlock = y.slice(stepStart, nextStepIdx);
    expect(registryStepBlock).toContain('./mcp-publisher publish');
    // exactly two retry loops live in this step (login + publish); both use
    // the 5x20s pattern, so at least 2 occurrences confirms both intact.
    const retryLoopCount = (registryStepBlock.match(/for i in 1 2 3 4 5/g) || []).length;
    expect(retryLoopCount).toBeGreaterThanOrEqual(2);
    expect(registryStepBlock).toMatch(/sleep 20/);
    expect(registryStepBlock).toContain('::error::');
    expect(registryStepBlock).toMatch(/exit 1/);
  });

  test('registry publish is idempotent on re-run: pre-check against the registry API before publishing', () => {
    const y = yml();
    // pre-check the MCP Registry for the tag version before calling mcp-publisher publish
    expect(y).toMatch(/registry\.modelcontextprotocol\.io\/v0/);
    expect(y).toContain('::notice::');
  });

  test('GitHub Release creation is guarded by an existence check (gh release view)', () => {
    const y = yml();
    expect(y).toMatch(/gh release view\s+"\$TAG_NAME"/);
    expect(y).toContain('::notice::');
    // the guard must precede the actual release create call
    const viewIdx = y.indexOf('gh release view "$TAG_NAME"');
    const createIdx = y.indexOf('gh release create "$TAG_NAME"');
    expect(viewIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(viewIdx).toBeLessThan(createIdx);
  });

  test('stale "re-run will NOT recover" claim is gone from the workflow comment block', () => {
    const y = yml();
    // tolerant of the comment-wrapped, multi-line phrasing (each line is its
    // own `# ...` comment, so a naive \s+ span misses the `#` + indentation
    // between wrapped words) — strip comment markers/newlines before matching.
    const flattened = y.replace(/^\s*#\s?/gm, ' ').replace(/\s+/g, ' ');
    expect(flattened).not.toMatch(/RE-RUN will NOT recover/i);
  });

  test('docs/DISTRIBUTION.md no longer claims re-run cannot recover; re-run is documented as the primary path', () => {
    const docPath = path.join(__dirname, '..', '..', 'docs', 'DISTRIBUTION.md');
    const doc = fs.readFileSync(docPath, 'utf-8');
    expect(doc).not.toMatch(/re-run\s+will\s+NOT\s+work/i);
    expect(doc.toLowerCase()).toMatch(/re-run/);
  });
});
