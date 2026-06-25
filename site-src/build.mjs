import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse } from './inject.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ENGINE = 'C:/Users/sendt/code/portable-docs/plugins/portable-docs/engine/scripts/build-doc.js';
const SRC = resolve(__dir, 'amicus-landing.md');
const CONTENT = resolve(__dir, 'build/amicus-content.html');
const OUT = resolve(__dir, '../site/index.html');

execFileSync('node', [ENGINE, '--input', SRC, '--type', 'landing', '--theme', 'dark', '--out', CONTENT, '--no-open'],
  { stdio: 'inherit', env: { ...process.env, PD_ACCENT: '#D97757' } });

fuse(CONTENT, OUT);
console.log('Wrote', OUT);
