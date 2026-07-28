// src/cli-handlers-template.js
'use strict';

/**
 * @module cli-handlers-template
 * F9 (v4.5): `amicus template list|show`. No save/rm — templates are a folder
 * of Markdown files; your editor is the manager.
 */

const { SCHEMA_VERSION } = require('./utils/result-schema');
const { ERROR_CODES, failJson } = require('./utils/error-doc');
const { listTemplates, resolveTemplate, templatesDir } = require('./template/store');

async function handleTemplate(args) {
  const useJson = !!args.json;
  const sub = args._[1];

  if (sub === 'list') {
    const templates = listTemplates();
    if (useJson) {
      process.stdout.write(JSON.stringify({ schemaVersion: SCHEMA_VERSION, type: 'template-list', dir: templatesDir(), templates }, null, 2) + '\n');
      return 0;
    }
    if (templates.length === 0) { process.stdout.write('No templates.\n'); return 0; }
    for (const t of templates) {
      const marker = t.builtin ? ' [built-in]' : (t.shadowed ? ' [shadows built-in]' : '');
      process.stdout.write(`${t.name}${marker}\n`);
    }
    return 0;
  }

  if (sub === 'show') {
    const ref = args._[2];
    if (!ref) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: template show requires a <name|path>' });
    }
    const t = resolveTemplate(ref);
    if (t.error) {
      return failJson(useJson, { code: ERROR_CODES.TEMPLATE_NOT_FOUND, message: t.error, hint: 'amicus template list' });
    }
    if (useJson) {
      process.stdout.write(JSON.stringify({ schemaVersion: SCHEMA_VERSION, type: 'template', name: t.name, path: t.path, hash: t.hash, builtin: t.builtin, text: t.text }, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(t.text + (t.text.endsWith('\n') ? '' : '\n'));
    return 0;
  }

  return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
    message: `Error: unknown template subcommand '${sub || ''}'`, hint: 'amicus template list | amicus template show <name|path>' });
}

module.exports = { handleTemplate };
