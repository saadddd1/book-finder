// 用法：编辑 book-sources.json 后运行 `node build.js`，重新生成 book-search.html
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'book-sources.json'), 'utf8');
const data = JSON.parse(raw); // 校验 JSON 合法性

const TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>找书聚合搜索</title>
<style>
  :root { --bg:#f5f6f8; --card:#fff; --text:#1a1d21; --muted:#6b7280; --border:#e5e7eb; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif; line-height:1.6; }
  header { position:sticky; top:0; z-index:10; background:rgba(245,246,248,.93); backdrop-filter:blur(8px); border-bottom:1px solid var(--border); padding:16px 20px 12px; }
  .wrap { max-width:1080px; margin:0 auto; }
  h1 { font-size:20px; }
  h1 small { color:var(--muted); font-weight:400; font-size:12px; margin-left:8px; }
  .searchrow { display:flex; gap:10px; margin-top:10px; }
  input { flex:1; font-size:16px; padding:10px 14px; border:1px solid var(--border); border-radius:10px; outline:none; background:#fff; color:var(--text); }
  input:focus { border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,.15); }
  .status { font-size:12px; color:var(--muted); margin-top:6px; }
  main { padding:20px; }
  section { margin-bottom:30px; }
  .cat-head { display:flex; align-items:baseline; gap:8px; }
  .dot { width:10px; height:10px; border-radius:3px; display:inline-block; flex:none; align-self:center; }
  .cat-head h2 { font-size:16px; }
  .cat-head .count { font-size:12px; color:var(--muted); }
  .cat-desc { font-size:12px; color:var(--muted); margin:2px 0 12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:8px; }
  .card-top { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .name { font-weight:600; font-size:15px; }
  .chip { font-size:11px; padding:1px 7px; border-radius:99px; background:#f3f4f6; color:var(--muted); border:1px solid var(--border); }
  .chip.warn { background:#fef3c7; border-color:#fde68a; color:#92400e; }
  .note { font-size:12px; color:var(--muted); flex:1; }
  .actions { display:flex; gap:8px; margin-top:auto; }
  .btn { flex:1; text-align:center; font-size:13px; padding:8px 10px; border-radius:8px; border:1px solid var(--border); background:#fff; color:var(--text); text-decoration:none; transition:.15s; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .btn:hover { border-color:#6366f1; color:#6366f1; }
  .btn.primary { background:#4f46e5; border-color:#4f46e5; color:#fff; }
  .btn.primary:hover { background:#4338ca; color:#fff; }
  .btn.home { flex:none; width:64px; }
  footer { padding:6px 20px 30px; text-align:center; font-size:12px; color:var(--muted); }
  @media(max-width:640px){ .grid { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>找书聚合搜索<small id="stat"></small></h1>
    <div class="searchrow"><input id="q" type="search" placeholder="输入书名，如：三体" autofocus></div>
    <div class="status" id="hint"></div>
  </div>
</header>
<main class="wrap" id="list"></main>
<footer>数据来自 book-sources.json，修改后运行 node build.js 重新生成 · 资源仅供个人学习，请支持正版</footer>
<script>
var DATA = __DATA__;

var SITES = DATA.sites;
var CATS = DATA.meta.categories;
var COLORS = { search:'#6366f1', direct:'#10b981', library:'#f59e0b', public_domain:'#3b82f6', academic:'#ef4444', niche:'#8b5cf6' };

var listEl = document.getElementById('list');
var qEl = document.getElementById('q');
var statEl = document.getElementById('stat');
var hintEl = document.getElementById('hint');
var directCount = SITES.filter(function(s){ return s.integration && s.integration.search_template; }).length;

function host(u) {
  try { return new URL(u).hostname.replace(/^www\\./, ''); }
  catch (e) { return u.replace(/^https?:\\/\\//, '').split('/')[0]; }
}
function shortQ() {
  var q = qEl.value.trim();
  return q.length > 12 ? q.slice(0, 12) + '…' : q;
}
function urlFor(site) {
  var q = qEl.value.trim();
  if (!q) return { href: site.url, mode: 'home' };
  var t = site.integration && site.integration.search_template;
  if (t) return { href: t.replace('{query}', encodeURIComponent(q)), mode: 'direct' };
  return { href: 'https://www.bing.com/search?q=' + encodeURIComponent('site:' + host(site.url) + ' ' + q), mode: 'bing' };
}

CATS.forEach(function(cat) {
  var sites = SITES.filter(function(s){ return s.category === cat.id; });
  if (!sites.length) return;
  var sec = document.createElement('section');
  sec.innerHTML = '<div class="cat-head"><span class="dot" style="background:' + (COLORS[cat.id] || '#6b7280') + '"></span>'
    + '<h2>' + cat.name + '</h2><span class="count">' + sites.length + ' 个站</span></div>'
    + '<div class="cat-desc">' + cat.desc + '</div><div class="grid"></div>';
  var grid = sec.querySelector('.grid');
  sites.forEach(function(site) {
    var card = document.createElement('div');
    card.className = 'card';
    var chips = '';
    if (site.lang === 'en') chips += '<span class="chip">英文</span>';
    if (site.lang === 'mixed') chips += '<span class="chip">中英</span>';
    if (site.access && site.access.registration) chips += '<span class="chip warn">需注册</span>';
    (site.formats || []).slice(0, 3).forEach(function(f){ chips += '<span class="chip">' + f + '</span>'; });
    card.innerHTML = '<div class="card-top"><span class="name">' + site.name + '</span>' + chips + '</div>'
      + '<div class="note">' + (site.notes || '') + '</div>'
      + '<div class="actions"><a class="btn primary" data-id="' + site.id + '" target="_blank" rel="noopener"><span class="btn-label"></span></a>'
      + '<a class="btn home" href="' + site.url + '" target="_blank" rel="noopener" title="打开主页">主页</a></div>';
    grid.appendChild(card);
  });
  listEl.appendChild(sec);
});

function refresh() {
  var q = qEl.value.trim();
  document.querySelectorAll('a[data-id]').forEach(function(a) {
    var site = SITES.find(function(s){ return s.id === a.dataset.id; });
    var r = urlFor(site);
    a.href = r.href;
    a.querySelector('.btn-label').textContent =
      r.mode === 'direct' ? '搜「' + shortQ() + '」' :
      r.mode === 'bing' ? 'Bing 站内搜「' + shortQ() + '」' : '打开主页';
  });
  statEl.textContent = directCount + ' 站支持直达搜索 · ' + (SITES.length - directCount) + ' 站用 Bing 站内搜';
  hintEl.textContent = q ? '共 ' + SITES.length + ' 个站已生成搜索链接，点按钮直达结果页（回车打开第一个）'
                         : '输入书名后，按钮变成各站直达搜索链接';
  history.replaceState(null, '', q ? '#' + encodeURIComponent(q) : '#');
}

qEl.addEventListener('input', refresh);
qEl.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && qEl.value.trim()) {
    var first = document.querySelector('a[data-id]');
    if (first) window.open(first.href, '_blank');
  }
});
var hq = decodeURIComponent((location.hash || '#').slice(1));
if (hq) qEl.value = hq;
refresh();
</script>
</body>
</html>`;

const html = TEMPLATE.replace('__DATA__', () => raw.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(__dirname, 'book-search.html'), html);
console.log('OK: book-search.html generated,', data.sites.length, 'sites,', data.sites.filter(s => s.integration.search_template).length, 'direct templates');
