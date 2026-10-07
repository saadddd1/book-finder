// 找书聚合服务器 —— 搜一次，直接拿下载链接
// 用法:  node aggregate.js
// 开代理: $env:HTTPS_PROXY="http://127.0.0.1:7890"; node aggregate.js   (启用安娜的档案/Open Library)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 7788;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------- HTTP 层: curl 封装(自动跟随跳转/解压, 可走 HTTPS_PROXY) ----------
function curl(url, opts = {}) {
  const { method = 'GET', body = null, jar = {}, headers = {}, timeout = 25 } = opts;
  return new Promise((resolve, reject) => {
    const hdrFile = path.join(os.tmpdir(), 'bh-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
    const args = ['-s', '--compressed', '--max-time', String(timeout), '-A', UA, '-D', hdrFile, '-L', '-w', '\n__META__%{http_code}\t%{url_effective}'];
    if (method === 'POST') { args.push('-X', 'POST'); if (body != null) args.push('--data', body); }
    if (process.env.HTTPS_PROXY) args.push('-x', process.env.HTTPS_PROXY);
    const hs = { ...headers };
    const cookies = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    if (cookies) hs['Cookie'] = cookies;
    if (body != null && !hs['Content-Type']) hs['Content-Type'] = 'application/x-www-form-urlencoded';
    for (const [k, v] of Object.entries(hs)) args.push('-H', k + ': ' + v);
    args.push(url);
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      try {
        let hdrTxt = '';
        try { hdrTxt = fs.readFileSync(hdrFile, 'utf8'); } catch {}
        fs.unlink(hdrFile, () => {});
        if (err && !stdout) return reject(new Error('网络错误(curl exit ' + (err.code || '?') + ')'));
        for (const m of hdrTxt.matchAll(/set-cookie:\s*([^\r\n]+)/gi)) {
          const kv = m[1].split(';')[0]; const i = kv.indexOf('=');
          if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
        }
        const mi = stdout.lastIndexOf('\n__META__');
        const bodyStr = mi > -1 ? stdout.slice(0, mi) : stdout;
        const meta = mi > -1 ? stdout.slice(mi + 9) : '200\t' + url;
        const [status, finalUrl] = meta.trim().split('\t');
        resolve({ status: +status, url: finalUrl || url, body: bodyStr });
      } catch (e) { reject(e); }
    });
  });
}
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// ---------- 适配器 ----------
// 1. Gutenberg: 英文公版, 搜索页直接解析出直链
async function gutenberg(q) {
  const r = await curl('https://www.gutenberg.org/ebooks/search/?query=' + encodeURIComponent(q));
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
      pageUrl: `https://www.gutenberg.org/ebooks/${id}`
    });
  }
  return { items };
}

// 2. Standard Ebooks: 精校公版, 从结果卡直接构造下载直链
async function standardebooks(q) {
  const r = await curl('https://standardebooks.org/ebooks?query=' + encodeURIComponent(q));
  const items = [];
  const re = /<li typeof="schema:Book" about="([^"]+)"[\s\S]*?schema:name">([^<]+)<\/span>[\s\S]*?class="author"[\s\S]*?schema:name">([^<]+)<\/span>/g;
  let m;
  while ((m = re.exec(r.body)) && items.length < 10) {
    const about = m[1];                       // /ebooks/author-slug/book-slug
    const parts = about.split('/');
    const slug = parts[2] + '_' + parts[3];
    const base = 'https://standardebooks.org' + about + '/downloads/' + slug;
    items.push({
      title: strip(m[2]), author: strip(m[3]), extra: '精校公版',
      downloads: [
        { label: 'EPUB', url: base + '.epub?source=download' },
        { label: 'Kindle', url: base + '.azw3?source=download' },
      ],
      pageUrl: 'https://standardebooks.org' + about
    });
  }
  return { items };
}

// 3. 苦瓜书盘: 中文, POST 搜索, 结果给书页(页内点下载)
async function kgbook(q) {
  const r = await curl('https://kgbook.com/e/search/index.php', {
    method: 'POST', body: 'keyboard=' + encodeURIComponent(q) + '&show=title&tempid=1',
    headers: { Referer: 'https://kgbook.com/' }
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
  let r = await curl(url, { jar });
  if (r.body.includes('esc_captcha_result')) {
    const math = r.body.match(/(\d+)\s*([+*-])\s*(\d+)\s*=/);
    if (math) {
      const a = +math[1], b = +math[3];
      const ans = math[2] === '+' ? a + b : math[2] === '-' ? a - b : a * b;
      await curl(url, { method: 'POST', body: 'esc_captcha_result=' + ans, jar, headers: { Referer: url } });
      r = await curl(url, { jar });
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

// 5. 安娜的档案: 全语言最强源(含中文), 有 DDoS-Guard 验证, 服务端爬不到就给浏览器搜索入口
async function annas(q) {
  const searchUrl = 'https://zh.annas-archive.gl/search?q=' + encodeURIComponent(q);
  const r = await curl(searchUrl, { timeout: 30 });
  if (r.body.includes('ddos-guard') || r.body.includes('DDoS-Guard')) {
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
      downloads: [], pageUrl: 'https://zh.annas-archive.gl/md5/' + m[1]
    });
  }
  return { items };
}

// 6. Open Library: 元数据+公版可借, 需代理
async function openlibrary(q) {
  const r = await curl('https://openlibrary.org/search.json?limit=8&fields=key,title,author_name,ia,ebook_access,first_publish_year&q=' + encodeURIComponent(q), { timeout: 30 });
  const data = JSON.parse(r.body);
  const items = (data.docs || []).map(d => {
    const pub = d.ia && d.ebook_access === 'public';
    return {
      title: d.title, author: (d.author_name || []).join(', '), extra: d.first_publish_year ? String(d.first_publish_year) : '',
      downloads: pub ? [{ label: 'PDF', url: `https://archive.org/download/${d.ia}/${d.ia}.pdf` }] : [],
      pageUrl: 'https://openlibrary.org' + d.key
    };
  });
  return { items };
}

const ADAPTERS = [
  { name: '安娜的档案', desc: '全语言·中文最强·聚合Z-Lib等大库（有人机验证，走浏览器打开）', needProxy: true, search: annas },
  { name: '苦瓜书盘', desc: '中文·人文社科小说', needProxy: false, search: kgbook },
  { name: 'Sobooks', desc: '中文·Kindle精选', needProxy: false, search: sobooks },
  { name: 'Gutenberg', desc: '英文公版·直链下载', needProxy: false, search: gutenberg },
  { name: 'Standard Ebooks', desc: '英文精校公版·直链下载', needProxy: false, search: standardebooks },
  { name: 'Open Library', desc: '英文书目·公版可借', needProxy: true, search: openlibrary },
];

// ---------- 服务 ----------
const HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>找书聚合</title><style>
:root{--bg:#f5f6f8;--card:#fff;--text:#1a1d21;--muted:#6b7280;--border:#e5e7eb}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;line-height:1.6}
.wrap{max-width:900px;margin:0 auto;padding:20px}
h1{font-size:22px}h1 small{font-size:12px;color:var(--muted);font-weight:400;margin-left:8px}
.searchrow{display:flex;gap:10px;margin:14px 0 8px}
input{flex:1;font-size:16px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;outline:none}
input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.15)}
button{padding:10px 22px;font-size:15px;border:none;border-radius:10px;background:#4f46e5;color:#fff;cursor:pointer}
button:disabled{opacity:.5}
.hint{font-size:12px;color:var(--muted);margin-bottom:16px}
.hint b{color:#92400e}
.src{margin-bottom:22px}
.src-head{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.src-head h2{font-size:15px}
.badge{font-size:11px;padding:1px 8px;border-radius:99px;background:#dcfce7;color:#166534}
.badge.fail{background:#fee2e2;color:#991b1b}
.src-desc{font-size:12px;color:var(--muted)}
.item{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.item .t{flex:1;min-width:200px}
.item .t b{font-size:14px}
.item .t span{font-size:12px;color:var(--muted);margin-left:8px}
a.btn{font-size:12px;padding:5px 12px;border-radius:7px;border:1px solid var(--border);background:#fff;color:var(--text);text-decoration:none;white-space:nowrap}
a.btn.pri{background:#4f46e5;border-color:#4f46e5;color:#fff}
a.btn:hover{opacity:.85}
.err{font-size:12px;color:#991b1b}
footer{font-size:12px;color:var(--muted);padding:20px 0}
code{background:#eef;font-size:11px;padding:1px 5px;border-radius:4px}
</style></head><body><div class="wrap">
<h1>找书聚合<small id="proxy"></small></h1>
<div class="searchrow"><input id="q" placeholder="输入书名，回车或点搜索" autofocus><button id="go">搜索</button></div>
<div class="hint" id="hint">结果按源分组 · <b>EPUB/PDF/Kindle</b> 按钮为直接下载 · 「书页」按钮进入站内下载页</div>
<div id="out"></div>
<footer>已接入源见上方分组。安娜的档案/Open Library 被墙，需开代理后以 <code>$env:HTTPS_PROXY="http://127.0.0.1:7890"; node aggregate.js</code> 启动。资源仅供个人学习，请支持正版。</footer>
</div><script>
var out=document.getElementById('out'),qEl=document.getElementById('q'),go=document.getElementById('go');
document.getElementById('proxy').textContent=' · 代理:'+(DATA_PROXY?'已开启':'未开(安娜档案/Open Library不可用)');
function esc(s){return (s||'').replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
async function run(){
  var q=qEl.value.trim();if(!q)return;
  go.disabled=true;go.textContent='搜索中…';
  out.innerHTML='<div class="hint">正在并发查询 6 个源…</div>';
  try{
    var r=await fetch('/api/search?q='+encodeURIComponent(q)).then(function(x){return x.json()});
    out.innerHTML='';
    r.results.forEach(function(s){
      var d=document.createElement('div');d.className='src';
      var head='<div class="src-head"><h2>'+esc(s.name)+'</h2>';
      if(s.ok)head+='<span class="badge">'+s.items.length+' 条</span>';
      else head+='<span class="badge fail">失败</span>';
      head+='</div><div class="src-desc">'+esc(s.desc)+(s.ok?'':' · <span class="err">'+esc(s.error)+(s.needProxy&&!r.proxy?'（被墙，开代理后可用）':'')+'</span>')+'</div>';
      d.innerHTML=head;
      s.items.forEach(function(it){
        var el=document.createElement('div');el.className='item';
        var btns='';
        (it.downloads||[]).forEach(function(dl,i){btns+='<a class="btn'+(i===0?' pri':'')+'" href="'+dl.url+'" target="_blank" rel="noopener">'+esc(dl.label)+'直下</a>'});
        if(it.pageUrl)btns+='<a class="btn" href="'+it.pageUrl+'" target="_blank" rel="noopener">书页</a>';
        el.innerHTML='<div class="t"><b>'+esc(it.title)+'</b><span>'+esc([it.author,it.extra].filter(Boolean).join(' · '))+'</span></div>'+btns;
        d.appendChild(el);
      });
      out.appendChild(d);
    });
  }catch(e){out.innerHTML='<div class="err">请求失败: '+esc(e.message)+'</div>'}
  go.disabled=false;go.textContent='搜索';
}
go.onclick=run;
qEl.addEventListener('keydown',function(e){if(e.key==='Enter')run()});
var hq=decodeURIComponent((location.hash||'#').slice(1));if(hq){qEl.value=hq;run()}
</script></body></html>`.replace('DATA_PROXY', process.env.HTTPS_PROXY ? 'true' : 'false');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(HTML); }
  if (u.pathname === '/api/search') {
    const q = (u.searchParams.get('q') || '').trim();
    if (!q) { res.writeHead(400); return res.end('{"error":"缺少 q"}'); }
    const results = await Promise.all(ADAPTERS.map(async a => {
      const t0 = Date.now();
      try {
        const r = await Promise.race([
          a.search(q),
          new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 32000))
        ]);
        return { name: a.name, desc: a.desc, needProxy: a.needProxy, ok: true, ms: Date.now() - t0, items: r.items };
      } catch (e) {
        return { name: a.name, desc: a.desc, needProxy: a.needProxy, ok: false, ms: Date.now() - t0, items: [], error: e.message };
      }
    }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ proxy: !!process.env.HTTPS_PROXY, q, results }));
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log('找书聚合已启动: http://localhost:' + PORT);
  console.log('代理状态: ' + (process.env.HTTPS_PROXY ? '已开启 (' + process.env.HTTPS_PROXY + ') — 安娜的档案/Open Library 可用' : '未开启 — 如需中文大库(安娜档案), 用 $env:HTTPS_PROXY="http://127.0.0.1:7890"; node aggregate.js 启动'));
});
