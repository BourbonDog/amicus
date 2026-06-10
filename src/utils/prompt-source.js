// src/utils/prompt-source.js
'use strict';

/**
 * @module prompt-source
 * Resolve the prompt for start/fanout from --prompt XOR --prompt-file (F4).
 * --prompt-file exists because Windows caps a CLI argument at ~32 KB, which
 * forced fragile `--prompt "$(cat briefing)"` launches.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} args - Parsed CLI args (kebab-case keys, as from parseArgs)
 * @returns {{prompt: string, promptMeta: {source: 'inline'|'file', file: string|null, chars: number}} | {error: string}}
 */
function resolvePromptSource(args) {
  const inline = args.prompt;
  const file = args['prompt-file'];

  if (inline !== undefined && file !== undefined) {
    return { error: 'Error: --prompt and --prompt-file are mutually exclusive' };
  }
  if (inline === undefined && file === undefined) {
    return { error: 'Error: --prompt or --prompt-file is required' };
  }
  if (inline === true || file === true) {
    return { error: 'Error: --prompt/--prompt-file requires a value' };
  }

  if (file !== undefined) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      return { error: `Error: cannot read --prompt-file ${file}: ${err.message}` };
    }
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }
    if (!text.trim()) {
      return { error: `Error: --prompt-file ${file} is empty` };
    }
    return {
      prompt: text,
      promptMeta: { source: 'file', file: path.resolve(file), chars: text.length },
    };
  }

  const text = String(inline);
  return { prompt: text, promptMeta: { source: 'inline', file: null, chars: text.length } };
}

module.exports = { resolvePromptSource };
