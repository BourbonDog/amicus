'use strict';

/**
 * @module progress-fields
 * Derived, agent-facing progress fields shared by the MCP status/list
 * handlers, the `amicus status` CLI, and readProgress(): a sanitized preview
 * of the newest assistant text, and a coarse lifecycle stage.
 */

/** Coarse stages surfaced to agents. */
const COARSE_STAGES = ['starting', 'generating', 'folding', 'terminal'];

/**
 * Collapse whitespace and defang fence/tag characters so the preview can be
 * embedded in a one-line JSON status without opening a code fence or tag
 * (prompt-injection hygiene: the FULL text is only available via amicus_read,
 * which wraps it in the untrusted-output fence).
 * @param {string} text @param {number} [max=120] @returns {string}
 */
function sanitizePreview(text, max = 120) {
  const collapsed = String(text).replace(/[`<>]/g, '').replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed;
}

/**
 * The newest assistant TEXT content from parsed conversation.jsonl entries,
 * sanitized to ~120 chars. Tool-use/result lines are skipped. Null when no
 * assistant text exists yet.
 * @param {object[]} entries @returns {string|null}
 */
function latestAssistantPreview(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.role === 'assistant' && typeof e.content === 'string' && e.content.trim()) {
      return sanitizePreview(e.content);
    }
  }
  return null;
}

/**
 * Map (metadata.status, progress.stage) to the coarse agent-facing stage.
 *  - terminal metadata status -> 'terminal'
 *  - progress 'receiving' -> 'generating'
 *  - progress 'complete' while metadata still says running -> 'folding'
 *    (mirror stopped; summary/conflict finalize in flight)
 *  - anything else -> 'starting'
 * @param {string|undefined} metadataStatus @param {string|undefined} progressStage
 * @returns {string}
 */
function deriveStage(metadataStatus, progressStage) {
  if (metadataStatus && metadataStatus !== 'running' && metadataStatus !== 'unknown') {
    return 'terminal';
  }
  if (progressStage === 'receiving') { return 'generating'; }
  if (progressStage === 'complete') { return 'folding'; }
  return 'starting';
}

module.exports = { sanitizePreview, latestAssistantPreview, deriveStage, COARSE_STAGES };
