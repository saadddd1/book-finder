// 电子书源适配器 (9 源): 每源一个 search(q) => { items }
// item 结构: { title, author, extra, downloads:[{label,url}], pageUrl }
import { http, strip } from '../http.js';

// 1. Gutendex: Gutenberg 官方 JSON API, 失败时降级为搜索页爬虫
async function gutendex(q) {
  try {
    const r = await http('https://gutendex.com/books?search=' + encodeURIComponent(q), { timeoutMs: 15000 });
    const data = JSON.parse(r.body);
    const items = (data.results || []).slice(0, 10).map(b => {
      const f = b.formats || {};
      const dls = [];
      if (f['application/epub+zip']) dls.push({ label: 'EPUB', url: f['application/epub+zip'] });
      if (f['application/x-mobipocket-kindle']) dls.push({ label: 'Kindle', url: f['application/x-mobipocket-kindle'] });
      const txtKey = Object.keys(f).find(k => k.startsWith('text/plain'));
      if (txtKey) dls.push({ label: 'TXT', url: f[txtKey] });
      return {
        title: b.title, author: (b.authors || []).map(a => a.name).join(', '),
        extra: (b.download_count || 0) + ' 次下载', downloads: dls,
        pageUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
      };
    });
    if (items.length) return { items };
    throw new Error('gutendex 无结果');
  } catch (e) {
    return gutenbergScrape(q);
  }
}

// 1b. Gutenberg 爬虫降级: 搜索页直接解析出直链
async function gutenbergScrape(q) {
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
  if (r.status === 422) return { items: [] }; // Open Library 解析不了 CJK 查询, 优雅返回空
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

// 7. Google Books: 元数据大盘, 公版书给 EPUB/PDF 直链
async function gbooks(q) {
  const r = await http('https://www.googleapis.com/books/v1/volumes?maxResults=10&printType=books&country=US&q=' + encodeURIComponent(q), { timeoutMs: 15000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const data = JSON.parse(r.body);
  const items = (data.items || []).map(it => {
    const v = it.volumeInfo || {}, a = it.accessInfo || {};
    const dls = [];
    if (a.epub && a.epub.isAvailable) dls.push({ label: 'EPUB', url: a.epub.downloadLink || a.webReaderLink });
    if (a.pdf && a.pdf.isAvailable) dls.push({ label: 'PDF', url: a.pdf.downloadLink || a.webReaderLink });
    return {
      title: v.title || '(无标题)', author: (v.authors || []).join(', '),
      extra: [v.publishedDate ? String(v.publishedDate).slice(0, 4) : '', 'Google Books'].filter(Boolean).join(' · '),
      downloads: dls, pageUrl: v.infoLink || a.webReaderLink || '',
    };
  });
  return { items };
}

// 8. Internet Archive: 海量公版扫描书, advancedsearch JSON API
async function archiveorg(q) {
  const query = `(${q}) AND mediatype:texts`;
  const r = await http('https://archive.org/advancedsearch.php?q=' + encodeURIComponent(query) + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&rows=8&page=1&output=json', { timeoutMs: 20000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const data = JSON.parse(r.body);
  const docs = ((data.response || {}).docs) || [];
  const items = docs.map(d => ({
    title: d.title || d.identifier, author: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
    extra: [d.year ? String(d.year) : '', '公版扫描'].filter(Boolean).join(' · '),
    downloads: [{ label: 'PDF', url: `https://archive.org/download/${d.identifier}/${d.identifier}.pdf` }],
    pageUrl: 'https://archive.org/details/' + d.identifier,
  }));
  return { items };
}

// 9. 维基文库: 中文公版/古籍全文, MediaWiki API + ws-export 生成 EPUB/PDF
async function wikisource(q) {
  const r = await http('https://zh.wikisource.org/w/api.php?action=query&list=search&srlimit=8&format=json&srsearch=' + encodeURIComponent(q), { timeoutMs: 15000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const data = JSON.parse(r.body);
  const hits = ((data.query || {}).search) || [];
  const items = hits.map(h => {
    const t = h.title.replace(/ /g, '_');
    const ex = 'https://ws-export.wmcloud.org/?lang=zh&title=' + encodeURIComponent(t);
    return {
      title: h.title, author: '',
      extra: '维基文库 · ' + strip(h.snippet || '').slice(0, 40),
      downloads: [
        { label: 'EPUB', url: ex + '&format=epub' },
        { label: 'PDF', url: ex + '&format=pdf' },
      ],
      pageUrl: 'https://zh.wikisource.org/wiki/' + encodeURIComponent(t),
    };
  });
  return { items };
}

export const ADAPTERS = [
  { name: '安娜的档案', desc: '全语言·中文最强·聚合Z-Lib等大库（常有人机验证，自动给浏览器入口）', lang: 'zh', search: annas },
  { name: '苦瓜书盘', desc: '中文·人文社科小说·EPUB/MOBI', lang: 'zh', search: kgbook },
  { name: 'Sobooks', desc: '中文·Kindle精选', lang: 'zh', search: sobooks },
  { name: '维基文库', desc: '中文公版古籍·在线读/导出EPUB', lang: 'zh', search: wikisource },
  { name: 'Gutenberg', desc: '英文公版·EPUB/Kindle/TXT直链', lang: 'en', search: gutendex },
  { name: 'Standard Ebooks', desc: '英文精校公版·EPUB/AZW3直链', lang: 'en', search: standardebooks },
  { name: 'Open Library', desc: '英文书目·公版可下', lang: 'en', search: openlibrary },
  { name: 'Internet Archive', desc: '公版扫描书·海量·PDF直链', lang: 'en', search: archiveorg },
  { name: 'Google Books', desc: '英文大盘·公版EPUB/PDF直链', lang: 'en', search: gbooks },
];
