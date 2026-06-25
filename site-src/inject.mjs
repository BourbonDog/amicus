import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const F = (p) => readFileSync(resolve(__dir, p), 'utf8');
const TITLE = 'Amicus - Multi-Model LLM Council for Claude Code & Cowork';

export function fuse(contentHtmlPath, outPath) {
  let html = readFileSync(contentHtmlPath, 'utf8');

  const headAssets = F('fragments/head-assets.html');
  const customCss  = F('fragments/custom.css');
  const overrides  = F('overrides.css');
  const heroHtml   = F('fragments/hero.html');
  const demoHtml   = F('fragments/demo.html');
  const badgesHtml = F('fragments/badges.html');
  const demoJs     = F('fragments/demo.js');
  const cfg        = JSON.parse(F('inject.config.json'));

  // 1) Head merge: restore favicons/OG/theme-color + override <title>
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${TITLE}</title>`);
  // Strip the portable-docs default data-URI favicon so the Amicus favicons are the only ones
  html = html.replace(/\s*<link\b[^>]*href=["']data:image\/svg\+xml[^>]*>/gi, '');
  html = html.replace(/<\/head>/i, `${headAssets}\n</head>`);

  // 2) Style merge: append custom + override CSS to the existing <style>
  html = html.replace(/<\/style>/i, `\n/* --- amicus custom --- */\n${customCss}\n/* --- overrides --- */\n${overrides}\n</style>`);

  // 3) Injector: runs after React mounts, inserts the three custom sections
  const inject = `
<script>${demoJs}</script>
<script>
(function(){
  var CFG = ${JSON.stringify(cfg)};
  var HERO = ${JSON.stringify(heroHtml)};
  var DEMO = ${JSON.stringify(demoHtml)};
  var BADGES = ${JSON.stringify(badgesHtml)};
  function whenReady(cb){
    var root=document.getElementById('root');
    if(!root) return;
    if(root.children.length) return cb(root);
    var obs=new MutationObserver(function(){ if(root.children.length){ obs.disconnect(); cb(root); } });
    obs.observe(root,{childList:true,subtree:true});
    var n=0;(function poll(){ if(root.children.length) return; if(n++<120) requestAnimationFrame(poll); })();
  }
  function findHeading(re){
    var hs=document.querySelectorAll('#root h1,#root h2,#root h3');
    for(var i=0;i<hs.length;i++){ if(re.test(hs[i].textContent||'')) return hs[i].closest('section')||hs[i]; }
    return null;
  }
  whenReady(function(root){
    var content = (CFG.contentRootSelector && root.querySelector(CFG.contentRootSelector)) || root.firstElementChild || root;
    var ph = root.querySelector(CFG.headerPlaceholderSelector); if(ph) ph.remove();
    content.insertAdjacentHTML('afterbegin', DEMO);
    content.insertAdjacentHTML('afterbegin', HERO);
    var anchor = findHeading(new RegExp(CFG.modelAnchorRegex,'i'));
    if(anchor) anchor.insertAdjacentHTML('beforebegin', BADGES);
    else content.insertAdjacentHTML('beforeend', BADGES);
    if(window.__amicusRunDemo) try{ window.__amicusRunDemo(); }catch(e){ console.error('demo init', e); }
  });
})();
</script>`;
  html = html.replace(/<\/body>/i, `${inject}\n</body>`);

  writeFileSync(outPath, html);
  return outPath;
}
