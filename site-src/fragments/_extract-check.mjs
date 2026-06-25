import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const checks = [
  ['hero.html',  /pd-hero/],
  ['demo.html',  /id="demo"/],
  ['badges.html',/pd-badges/],
  ['custom.css', /@keyframes\s+pulse-run/],
  ['custom.css', /\.pd-custom\s/],
  ['demo.js',    /__amicusRunDemo/],
  ['head-assets.html', /rel=["']icon["']/],
  ['head-assets.html', /og:title/],
];
let ok = true;
for (const [file, re] of checks) {
  const pass = re.test(read(file));
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${file} ~ ${re}`);
}
// Var integrity: every var(--x) used in custom.css must be defined in custom.css
const css = read('custom.css');
const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map(m => m[1].toLowerCase()));
const defined = new Set([...css.matchAll(/(^|[;{]\s*)(--[a-z0-9-]+)\s*:/gim)].map(m => m[2].toLowerCase()));
const undef = [...used].filter(v => !defined.has(v));
const varOk = undef.length === 0;
if (!varOk) ok = false;
console.log(`${varOk ? 'PASS' : 'FAIL'}  custom.css var integrity${varOk ? '' : ' — undefined: ' + undef.join(', ')}`);
process.exit(ok ? 0 : 1);
