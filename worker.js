// 找书聚合 API —— Cloudflare Worker 版
// 从 CF 边缘出网, 无墙: Open Library 直接可用, 安娜的档案仍可能被人机验证拦(自动降级为浏览器入口)
// 部署: npx wrangler deploy   本地调试: npx wrangler dev
// API: GET /api/search?q=书名  →  { q, results: [{ name, desc, lang, ok, ms, items, error? }] }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------- HTTP 层: fetch 封装(手动管理 cookie jar + 超时) ----------
async function http(url, opts = {}) {
  const { method = 'GET', body = null, jar = null, headers = {}, timeoutMs = 20000 } = opts;
  const hs = { ...headers, 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' };
  if (jar && Object.keys(jar).length) hs['Cookie'] = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  if (body != null && !hs['Content-Type']) hs['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(url, {
    method, body: body != null ? body : undefined, headers: hs,
    redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
  });
  if (jar) for (const c of res.headers.getSetCookie()) {
    const kv = c.split(';')[0]; const i = kv.indexOf('=');
    if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  return { status: res.status, url: res.url, body: await res.text() };
}

const strip = s => s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// ---------- 适配器 ----------
// 1. Gutenberg: 英文公版, 搜索页直接解析出直链
async function gutenberg(q) {
  const r = await http('https://www.gutenberg.org/ebooks/search/?query=' + encodeURIComponent(q));
  const items = [];
  const re = /href="\/ebooks\/(\d+)"[\s\S]*?class="title">([^<]*)<\/span>[\s\S]*?class="subtitle">([^<]*)<\/span>[\s\S]*?class="extra">([\d,]+) downloads/g;
  let m;
  while ((m = re.exec(r.body)) && items.length < 10) {
    const id = m[1];
    items.push({
      title: strip(m[2]), author: strip(m[3]), extra: m[4] + ' 次下载',
      downloads: [
        { label: 'EPUB', url: `https://www.gutenberg.org/ebooks/${id}.epub3.images` },
        { label: 'Kindle', url: `https://www.gutenberg.org/ebooks/${id}.kf8.images` },
        { label: 'TXT', url: `https://www.gutenberg.org/ebooks/${id}.txt.utf-8` },
      ],
      pageUrl: `https://www.gutenberg.org/ebooks/${id}`,
    });
  }
  return { items };
}

// 2. Standard Ebooks: 精校公版, 从结果卡直接构造下载直链(必须带 ?source=download, 否则返回中间页)
async function standardebooks(q) {
  const r = await http('https://standardebooks.org/ebooks?query=' + encodeURIComponent(q));
  const items = [];
  const re = /<li typeof="schema:Book" about="([^"]+)"[\s\S]*?schema:name">([^<]+)<\/span>[\s\S]*?class="author"[\s\S]*?schema:name">([^<]+)<\/span>/g;
  let m;
  while ((m = re.exec(r.body)) && items.length < 10) {
    const about = m[1];
    const parts = about.split('/');
    const slug = parts[2] + '_' + parts[3];
    const base = 'https://standardebooks.org' + about + '/downloads/' + slug;
    items.push({
      title: strip(m[2]), author: strip(m[3]), extra: '精校公版',
      downloads: [
        { label: 'EPUB', url: base + '.epub?source=download' },
        { label: 'Kindle', url: base + '.azw3?source=download' },
      ],
      pageUrl: 'https://standardebooks.org' + about,
    });
  }
  return { items };
}

// 3. 苦瓜书盘: 中文, POST 搜索, 结果给书页(页内点下载)
async function kgbook(q) {
  const r = await http('https://kgbook.com/e/search/index.php', {
    method: 'POST',
    body: 'keyboard=' + encodeURIComponent(q) + '&show=title&tempid=1',
    headers: { Referer: 'https://kgbook.com/' },
  });
  const items = [];
  const re = /<li><h1><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h1>(?:[\s\S]*?class="text">([\s\S]*?)<\/span>)?/g;
  let m;
  while ((m = re.exec(r.body)) && items.length < 10) {
    items.push({ title: strip(m[2]), author: '', extra: strip(m[3] || '').slice(0, 60), downloads: [], pageUrl: m[1] });
  }
  return { items };
}

// 4. Sobooks: 中文, 自动解算术验证码后搜索
async function sobooks(q) {
  const url = 'https://sobooks.cc/?s=' + encodeURIComponent(q);
  const jar = {};
  let r = await http(url, { jar });
  if (r.body.includes('esc_captcha_result')) {
    const math = r.body.match(/(\d+)\s*([+*-])\s*(\d+)\s*=/);
    if (math) {
      const a = +math[1], b = +math[3];
      const ans = math[2] === '+' ? a + b : math[2] === '-' ? a - b : a * b;
      await http(url, { method: 'POST', body: 'esc_captcha_result=' + ans, jar, headers: { Referer: url } });
      r = await http(url, { jar });
    }
  }
  const items = [];
  const re = /<h3>\s*<a href="(https?:\/\/sobooks\.cc\/books\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<\/h3>\s*(?:<p>([^<]*)<\/p>)?/g;
  let m;
  while ((m = re.exec(r.body)) && items.length < 10) {
    items.push({ title: strip(m[2]), author: strip(m[3] || ''), extra: 'Kindle/EPUB', downloads: [], pageUrl: m[1] });
  }
  return { items };
}

// 5. 安娜的档案: 全语言最强源, 有 DDoS-Guard 验证; 服务端被拦时给浏览器搜索入口
async function annas(q) {
  const searchUrl = 'https://zh.annas-archive.gl/search?q=' + encodeURIComponent(q);
  const r = await http(searchUrl, { timeoutMs: 15000 });
  if (/ddos-guard/i.test(r.body) || r.status === 403) {
    return { items: [{ title: '在浏览器中搜索「' + q + '」（站点有人机验证，浏览器可正常访问）', author: '安娜的档案 · 聚合Z-Lib等大库', extra: '', downloads: [], pageUrl: searchUrl }] };
  }
  const items = [];
  const re = /<a[^>]+href="\/md5\/([a-f0-9]{32})"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(r.body)) && items.length < 10) {
    const block = m[2];
    const t = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const ext = (block.match(/\b(pdf|epub|mobi|azw3|djvu|cbz|cbr|txt)\b/i) || [])[1] || '';
    const size = (block.match(/([\d.]+\s*[KMG]B)/i) || [])[1] || '';
    items.push({
      title: t ? strip(t[1]) : strip(block).slice(0, 80),
      author: '', extra: [ext.toUpperCase(), size].filter(Boolean).join(' · '),
      downloads: [], pageUrl: 'https://zh.annas-archive.gl/md5/' + m[1],
    });
  }
  return { items };
}

// 6. Open Library: 英文书目, 公版书给 archive.org 直链 (Worker 出网不再被墙)
async function openlibrary(q) {
  const r = await http('https://openlibrary.org/search.json?limit=8&fields=key,title,author_name,ia,ebook_access,first_publish_year&q=' + encodeURIComponent(q), { timeoutMs: 20000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const data = JSON.parse(r.body);
  const items = (data.docs || []).map(d => {
    const pub = d.ia && d.ebook_access === 'public';
    return {
      title: d.title, author: (d.author_name || []).join(', '), extra: d.first_publish_year ? String(d.first_publish_year) : '',
      downloads: pub ? [{ label: 'PDF', url: `https://archive.org/download/${d.ia}/${d.ia}.pdf` }] : [],
      pageUrl: 'https://openlibrary.org' + d.key,
    };
  });
  return { items };
}

const ADAPTERS = [
  { name: '安娜的档案', desc: '全语言·中文最强·聚合Z-Lib等大库（常有人机验证，自动给浏览器入口）', lang: 'zh', search: annas },
  { name: '苦瓜书盘', desc: '中文·人文社科小说·EPUB/MOBI', lang: 'zh', search: kgbook },
  { name: 'Sobooks', desc: '中文·Kindle精选', lang: 'zh', search: sobooks },
  { name: 'Gutenberg', desc: '英文公版·EPUB/Kindle/TXT直链', lang: 'en', search: gutenberg },
  { name: 'Standard Ebooks', desc: '英文精校公版·EPUB/AZW3直链', lang: 'en', search: standardebooks },
  { name: 'Open Library', desc: '英文书目·公版可下', lang: 'en', search: openlibrary },
];

async function handleSearch(q) {
  const results = await Promise.all(ADAPTERS.map(async a => {
    const t0 = Date.now();
    try {
      const r = await a.search(q);
      return { name: a.name, desc: a.desc, lang: a.lang, ok: true, ms: Date.now() - t0, items: r.items };
    } catch (e) {
      return { name: a.name, desc: a.desc, lang: a.lang, ok: false, ms: Date.now() - t0, items: [], error: (e && e.message) || '失败' };
    }
  }));
  return { q, results };
}

// ---------- Worker 内置极简 UI (不配前端也能直接用) ----------
const MINI_UI = `<!DOCTYPE html>
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
  out.innerHTML='<p>正在并发查询 6 个源…</p>';
  try{
    var d=await fetch('/api/search?q='+encodeURIComponent(q)).then(function(x){return x.json()});
    out.innerHTML='';
    d.results.forEach(function(s){
      var el=document.createElement('div');el.className='src';
      var h='<div class="src-head"><h2>'+esc(s.name)+'</h2>'+
        (s.ok?'<span class="badge">'+s.items.length+' 条</span>':'<span class="badge fail">失败</span>')+
        '</div><div class="src-desc">'+esc(s.desc)+'</div>';
      el.innerHTML=h;
      s.items.forEach(function(it){
        var b='';(it.downloads||[]).forEach(function(dl,i){b+='<a class="btn'+(i===0?' pri':'')+'" href="'+dl.url+'" target="_blank" rel="noopener">'+esc(dl.label)+'</a>'});
        if(it.pageUrl)b+='<a class="btn" href="'+it.pageUrl+'" target="_blank" rel="noopener">书页</a>';
        var row=document.createElement('div');row.className='item';
        row.innerHTML='<div class="t"><b>'+esc(it.title)+'</b><span>'+esc([it.author,it.extra].filter(Boolean).join(' · '))+'</span></div>'+b;
        el.appendChild(row);
      });
      out.appendChild(el);
    });
  }catch(e){out.innerHTML='<p>请求失败: '+esc(e.message)+'</p>'}
  go.disabled=false;go.textContent='搜索';
}
go.onclick=run;qEl.addEventListener('keydown',function(e){if(e.key==='Enter')run()});
</script></body></html>`;

// ---------- 入口 ----------
export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (u.pathname === '/api/search') {
      const q = (u.searchParams.get('q') || '').trim();
      if (!q) return new Response(JSON.stringify({ error: '缺少 q' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
      const data = await handleSearch(q);
      return new Response(JSON.stringify(data), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (u.pathname === '/') return new Response(MINI_UI, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response('Not Found', { status: 404, headers: CORS });
  },
};
