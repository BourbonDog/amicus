import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dir, '../site/index.html'), 'utf8');

const must = [
  [/<title>Amicus - Multi-Model LLM Council/i, 'title set'],
  [/rel=["']icon["']/i, 'favicon restored'],
  [/og:title/i, 'OG meta restored'],
  [/@keyframes\s+pulse-run/, 'demo keyframes present'],
  [/id=(?:\\?"demo\\?"|\\"demo\\")/, 'demo fragment embedded'],
  [/pd-badges/, 'badges fragment embedded'],
  [/__amicusRunDemo/, 'demo script embedded'],
  [/react-dom\.production\.min\.js/i, 'ReactDOM inlined'],
  [/ReactDOM\.createRoot/, 'createRoot present'],
];
// Self-contained: no external script/link/img over http(s)
const external = [
  [/<script[^>]+src=["']https?:/i, 'external <script src>'],
  [/<link[^>]+href=["']https?:[^"']*\.(css)/i, 'external stylesheet'],
];
let ok = true;
for (const [re, name] of must) { const p = re.test(html); ok &&= p; console.log(`${p?'PASS':'FAIL'}  ${name}`); }
for (const [re, name] of external) { const bad = re.test(html); ok &&= !bad; console.log(`${bad?'FAIL':'PASS'}  no ${name}`); }
process.exit(ok ? 0 : 1);
