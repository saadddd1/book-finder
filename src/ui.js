// Worker 内置极简 UI (不配前端也能直接用)
export const MINI_UI = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>找书聚合 API</title><style>
:root{--bg:#f5f6f8;--card:#fff;--text:#1a1d21;--muted:#6b7280;--border:#e5e7eb}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Microsoft YaHei',sans-serif;line-height:1.6}
.wrap{max-width:860px;margin:0 auto;padding:20px}
h1{font-size:20px}
.searchrow{display:flex;gap:10px;margin:14px 0}
input{flex:1;font-size:16px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;outline:none}
button{padding:10px 20px;border:none;border-radius:10px;background:#4f46e5;color:#fff;cursor:pointer}
.src{margin-bottom:20px}
.src-head{display:flex;gap:8px;align-items:baseline;margin-bottom:6px}
.src-head h2{font-size:15px}
.badge{font-size:11px;padding:1px 8px;border-radius:99px;background:#dcfce7;color:#166534}
.badge.fail{background:#fee2e2;color:#991b1b}
.src-desc{font-size:12px;color:var(--muted)}
.item{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.item .t{flex:1;min-width:200px}
.item .t span{font-size:12px;color:var(--muted);margin-left:8px}
a.btn{font-size:12px;padding:5px 12px;border-radius:7px;border:1px solid var(--border);background:#fff;color:var(--text);text-decoration:none}
a.btn.pri{background:#4f46e5;border-color:#4f46e5;color:#fff}
footer{font-size:12px;color:var(--muted);padding:16px 0}
</style></head><body><div class="wrap">
<h1>找书聚合 · API 已就绪</h1>
<div class="searchrow"><input id="q" placeholder="输入书名，回车搜索" autofocus><button id="go">搜索</button></div>
<div id="out"></div>
<footer>这是 Worker 内置的极简界面。完整版前端部署在 GitHub Pages，可在其设置里填入本地址。资源仅供个人学习，请支持正版。</footer>
</div><script>
var out=document.getElementById('out'),qEl=document.getElementById('q'),go=document.getElementById('go');
function esc(s){return (s||'').replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
async function run(){
  var q=qEl.value.trim();if(!q)return;
  go.disabled=true;go.textContent='搜索中…';
  out.innerHTML='<p>正在并发查询 9 个源，约需 3~15 秒…</p>';
  try{
    var d=await fetch('/api/search?q='+encodeURIComponent(q)).then(function(x){return x.json()});
    out.innerHTML='';
    var items=d.merged||[];
    items.forEach(function(it){
      var b='';(it.downloads||[]).forEach(function(dl,i){b+='<a class="btn'+(i===0?' pri':'')+'" href="'+dl.url+'" target="_blank" rel="noopener">'+esc(dl.label)+'</a>'});
      (it.pageUrls||[]).forEach(function(p){b+='<a class="btn" href="'+p+'" target="_blank" rel="noopener">书页</a>'});
      var tags=(it.srcs||[]).map(function(s){return '<span class="tag">'+esc(s)+'</span>'}).join('');
      var row=document.createElement('div');row.className='item';
      row.innerHTML='<div class="t"><b>'+esc(it.title)+'</b><span>'+esc([it.author,it.extra].filter(Boolean).join(' · '))+'</span>'+(tags?'<div class="tags">'+tags+'</div>':'')+'</div>'+b;
      out.appendChild(row);
    });
    if(!items.length)out.innerHTML='<p>无结果，试试底部导航站</p>';
  }catch(e){out.innerHTML='<p>请求失败: '+esc(e.message)+'</p>'}
  go.disabled=false;go.textContent='搜索';
}
go.onclick=run;qEl.addEventListener('keydown',function(e){if(e.key==='Enter')run()});
</script></body></html>`;
