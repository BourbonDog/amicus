// src/cli-handlers-pack.js
'use strict';

/**
 * @module cli-handlers-pack
 * F5/B7 (v4.5), Task 14: `amicus pack save|list|show|rm` + `--from-run`. The
 * user-facing management CLI on top of the pack subsystem built by Tasks 7-13
 * (pack-store, pack-validate, pack-resolve, --pack on the three run commands).
 * Idiom donor: src/cli-handlers-template.js (doc object -> useJson ?
 * JSON.stringify : render) and src/council/presets-cli.js (list/show render
 * shape, `amicus council show`'s diagnostic-mirror style for `pack show`).
 *
 * `pack save <name> --from-run <id>` builds a pack from an existing council
 * run / fanout wave / solo session instead of flags (buildPackFromRun below).
 * Resolution order: council pointer (run-state.js) -> wave metadata.json ->
 * solo metadata.json. Briefing TEXT is never captured, only a template
 * reference when the source run recorded one.
 */

const { SCHEMA_VERSION } = require('./utils/result-schema');
const { ERROR_CODES, failJson } = require('./utils/error-doc');

/** Build a pack object from `pack save <name> --kind ... <flags>`. */
function buildPackFromFlags(name, args) {
  const kind = args.kind;
  const pack = { schemaVersion: 1, type: 'pack', name, version: args.version || '1.0.0', kind };
  if (args.description) { pack.description = String(args.description); }
  if (kind === 'solo') { pack.model = args.model; }
  else if (typeof args.bench === 'string') {
    // A comma present means an explicit member list; a single comma-less
    // value is a council/bench NAME string (validatePack {mode:'save'} is
    // the net that catches an unresolvable one of either form).
    pack.bench = args.bench.includes(',')
      ? args.bench.split(',').map((s) => s.trim()).filter(Boolean)
      : args.bench.trim();
  }
  if (kind === 'council') {
    if (args.chair) { pack.chair = args.chair; }
    if (args.critic) { pack.critic = args.critic; }
    if (typeof args.lenses === 'string') { pack.lenses = args.lenses.split(',').map((s) => s.trim()).filter(Boolean); }
  }
  const opts = {};
  if (args.__explicit.has('timeout')) { opts.timeout = args.timeout; }
  if (args['max-cost'] !== undefined) { opts.maxCost = args['max-cost']; }
  if (args.gateway) { opts.gateway = args.gateway; }
  if (args.agent) { opts.agent = args.agent; }
  if (args.thinking) { opts.thinking = args.thinking; }
  if (args.__explicit.has('summary-length')) { opts.summaryLength = args['summary-length']; }
  // Task-10 ruling (pack-resolve.js:116): a negatable boolean's "was this
  // explicit" check must test BOTH forms, since __explicit only records the
  // literal typed key (--no-debate never sets args.debate to anything).
  if (args.__explicit.has('debate') || args.__explicit.has('no-debate')) { opts.debate = !!args.debate; }
  if (Object.keys(opts).length) { pack.options = opts; }
  if (args.template) { pack.briefing = { template: String(args.template) }; }
  return pack;
}

/** council branch of buildPackFromRun: a run.json reached via the council pointer. */
function packFromCouncilRun(name, version, run) {
  const opts = {};
  if (run.options && run.options.timeout) { opts.timeout = run.options.timeout; }
  if (run.options && run.options.maxCost !== undefined && run.options.maxCost !== null) { opts.maxCost = run.options.maxCost; }
  if (run.options && run.options.gateway) { opts.gateway = run.options.gateway; }
  if (run.debate && run.debate.enabled) { opts.debate = true; }
  return {
    schemaVersion: 1, type: 'pack', name, version, kind: 'council',
    bench: run.bench.slice(), chair: run.chair,
    ...(run.critic ? { critic: run.critic } : {}),
    ...(run.lenses ? { lenses: run.lenses.slice() } : {}),
    ...(Object.keys(opts).length ? { options: opts } : {}),
    ...(run.template ? { briefing: { template: run.template.name } } : {}),
  };
}

/** wave branch: a fanout wave's metadata.json (type:'wave'), plus its first leg. */
function packFromWave(name, version, project, meta) {
  const fs = require('fs');
  const path = require('path');
  const { getSessionDir } = require('./session-manager');

  const opts = {};
  const firstLeg = Array.isArray(meta.legs) ? meta.legs[0] : null;
  if (firstLeg) {
    try {
      const legMeta = JSON.parse(fs.readFileSync(path.join(getSessionDir(project, firstLeg), 'metadata.json'), 'utf-8'));
      if (legMeta.agent) { opts.agent = legMeta.agent; }
      if (legMeta.thinking) { opts.thinking = legMeta.thinking; }
    } catch { /* leg metadata unreadable/absent — omit, never null-stuff */ }
  }
  return {
    schemaVersion: 1, type: 'pack', name, version, kind: 'fanout',
    bench: meta.models.slice(),
    ...(Object.keys(opts).length ? { options: opts } : {}),
    ...(meta.promptMeta && meta.promptMeta.template ? { briefing: { template: meta.promptMeta.template.name } } : {}),
  };
}

/** solo branch: an ordinary (non-wave) session's metadata.json. */
function packFromSolo(name, version, meta) {
  const opts = {};
  if (meta.agent) { opts.agent = meta.agent; }
  if (meta.thinking) { opts.thinking = meta.thinking; }
  return {
    schemaVersion: 1, type: 'pack', name, version, kind: 'solo',
    model: meta.model,
    ...(Object.keys(opts).length ? { options: opts } : {}),
  };
}

/**
 * Build a pack object from `pack save <name> --from-run <id>`. Resolution
 * order: council pointer/run.json -> wave metadata.json -> solo metadata.json.
 * @returns {object} a pack object, or `{error: string}` when `id` resolves to nothing.
 */
function buildPackFromRun(name, id, project, args) {
  const runState = require('./council/run-state');
  const version = args.version || '1.0.0';

  const ptr = runState.readPointer(project, id); // {runId, runDir}|null (run-state.js:156)
  const run = ptr ? runState.readRun(ptr.runDir) : null;
  if (run && run.type === 'council-run') { return packFromCouncilRun(name, version, run); }

  const fs = require('fs');
  const path = require('path');
  const { getSessionDir } = require('./session-manager');
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(getSessionDir(project, id), 'metadata.json'), 'utf-8')); }
  catch { return { error: `Session ${id} not found` }; }

  return meta.type === 'wave' ? packFromWave(name, version, project, meta) : packFromSolo(name, version, meta);
}

function renderPackList(doc) {
  let text = '';
  if (doc.packs.length === 0) {
    text = 'No packs.\n';
  } else {
    const lines = doc.packs.map((p) => {
      const name = String(p.name || '(unnamed)').padEnd(20);
      const kind = String(p.kind || '(unknown)');
      const version = String(p.version || '0.0.0');
      const desc = p.description ? ` — ${p.description}` : '';
      return `  ${name} [${kind}] v${version}${desc}`;
    });
    text = 'Packs:\n' + lines.join('\n') + '\n';
  }
  for (const w of doc.warnings) { text += `Warning: ${w}\n`; }
  return text;
}

function renderPackShow(doc) {
  const { pack, path: file, source, hash, validation } = doc;
  const lines = [`Pack '${pack.name}' v${pack.version} [${pack.kind}] (${source}: ${file})`, `  hash: ${hash}`];
  if (pack.description) { lines.push(`  description: ${pack.description}`); }
  if (pack.kind === 'solo') { lines.push(`  model: ${pack.model}`); }
  else { lines.push(`  bench: ${Array.isArray(pack.bench) ? pack.bench.join(', ') : pack.bench}`); }
  if (pack.chair) { lines.push(`  chair: ${pack.chair}`); }
  if (pack.critic) { lines.push(`  critic: ${pack.critic}`); }
  if (pack.lenses) { lines.push(`  lenses: ${pack.lenses.join(', ')}`); }
  if (pack.options && Object.keys(pack.options).length) { lines.push(`  options: ${JSON.stringify(pack.options)}`); }
  if (pack.briefing && pack.briefing.template) { lines.push(`  briefing.template: ${pack.briefing.template}`); }
  lines.push(validation.ok ? '  validation: ok' : `  validation: INVALID — ${validation.errors.join('; ')}`);
  if (validation.ok && validation.warnings.length) { lines.push(`  warnings: ${validation.warnings.join('; ')}`); }
  return lines.join('\n') + '\n';
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handlePack(args) {
  const useJson = !!args.json;
  const sub = args._[1];
  const { readPack, writePack, listPacks, rmPack, packsDir } = require('./pack/pack-store');
  const { validatePack } = require('./pack/pack-validate');

  if (sub === 'save') {
    const name = args._[2];
    if (!name) { return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: pack save needs a <name>' }); }
    const pack = args['from-run']
      ? buildPackFromRun(name, String(args['from-run']), args.cwd || process.cwd(), args)
      : buildPackFromFlags(name, args);
    if (pack.error) { return failJson(useJson, { code: ERROR_CODES.BAD_SESSION, message: `Error: ${pack.error}` }); }
    const v = validatePack(pack, { mode: 'save' });
    if (!v.ok) { return failJson(useJson, { code: ERROR_CODES.PACK_INVALID, message: `Error: invalid pack: ${v.errors.join('; ')}` }); }
    for (const w of v.warnings) { process.stderr.write(`Warning: ${w}\n`); }
    const res = writePack(pack);
    const doc = { schemaVersion: SCHEMA_VERSION, type: 'pack-save', name, ...res };
    process.stdout.write(useJson ? JSON.stringify(doc, null, 2) + '\n'
      : (res.noop ? `Pack '${name}' unchanged (no-op).\n`
        : `Saved pack '${name}' v${res.version}${res.bumped ? ' (version auto-bumped)' : ''} → ${res.path}\n`));
    return 0;
  }

  if (sub === 'list') {
    const { packs, warnings } = listPacks();
    const doc = { schemaVersion: SCHEMA_VERSION, type: 'pack-list', dir: packsDir(), packs, warnings };
    process.stdout.write(useJson ? JSON.stringify(doc, null, 2) + '\n' : renderPackList(doc));
    return 0;
  }

  if (sub === 'show') {
    const ref = args._[2];
    if (!ref) { return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: pack show needs a <name|path>' }); }
    const r = readPack(ref);
    if (r.error) { return failJson(useJson, { code: ERROR_CODES.PACK_NOT_FOUND, message: r.error, hint: 'amicus pack list' }); }
    // {mode:'save'} semantics per spec §5.3: reports, never fails — the
    // `council show` diagnostic mirror. Run-time-only checks (e.g. an
    // unresolvable briefing.template) are demoted to a warning in this mode.
    const validation = validatePack(r.pack, { mode: 'save' });
    const doc = { schemaVersion: SCHEMA_VERSION, type: 'pack-show', ...r, validation };
    process.stdout.write(useJson ? JSON.stringify(doc, null, 2) + '\n' : renderPackShow(doc));
    return 0;
  }

  if (sub === 'rm') {
    const name = args._[2];
    if (!name) { return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: pack rm needs a <name>' }); }
    const res = rmPack(name);
    if (!res.removed) { return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: pack '${name}' not found` }); }
    const doc = { schemaVersion: SCHEMA_VERSION, type: 'pack-rm', name, removed: true };
    process.stdout.write(useJson ? JSON.stringify(doc, null, 2) + '\n' : `Removed pack '${name}'.\n`);
    return 0;
  }

  return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
    message: `Error: unknown pack subcommand '${sub || ''}'`, hint: 'amicus pack save|list|show|rm' });
}

module.exports = { handlePack };
