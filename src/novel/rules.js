// 网文书源规则 (v1): 笔尖中文 / 梦书中文
// 结构探测于 2026-10-08, 参考社区项目 so-novel 的书源配置
// parse 函数约定: (html, base) => [{title, tocUrl, author, latest, extra}]

function txt(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export const NOVEL_SOURCES = [
  {
    id: 'bijian',
    name: '笔尖中文',
    base: 'http://www.xbiquwk.com/',
    search: {
      url: 'http://www.xbiquwk.com/modules/article/search.php',
      method: 'POST',
      body: q => 'searchkey=' + encodeURIComponent(q),
      parse(html, base) {
        const out = [];
        const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
        for (const row of rows) {
          const tds = row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
          if (tds.length < 6) continue;
          const a = tds[0].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
          if (!a) continue;
          out.push({
            title: txt(a[2]),
            tocUrl: new URL(a[1], base).href,
            author: txt(tds[2]),
            latest: txt(tds[1]),
            extra: [txt(tds[3]), txt(tds[5])].filter(Boolean).join(' · '),
          });
        }
        return out;
      },
    },
    filters: [/喜欢.*?请大家收藏[：:].*/g, /\(本章完\)/g, /<!--[\s\S]*?-->/g, /www\.[a-z0-9-]+\.(com|net|la|info|cc)[\/\S]{0,30}/gi],
  },
  {
    id: 'mengshu',
    name: '梦书中文',
    base: 'http://www.mcxs.la/',
    search: {
      url: 'http://www.mcxs.la/search.html',
      method: 'POST',
      body: q => 'name=' + encodeURIComponent(q),
      parse(html, base) {
        const out = [];
        const ul = html.match(/class="novelslist2"[\s\S]*?<\/ul>/);
        if (!ul) return out;
        const lis = ul[0].match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];
        for (const li of lis) {
          if (li.includes('<b>')) continue; // 表头行
          const nameA = li.match(/class="s2[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
          if (!nameA) continue;
          const au = li.match(/class="s4[^"]*"[^>]*>([\s\S]*?)<\/span>/);
          const la = li.match(/class="s3[^"]*"[^>]*>\s*<a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);
          const ut = li.match(/class="s6[^"]*"[^>]*>([\s\S]*?)<\/span>/);
          out.push({
            title: txt(nameA[2]),
            tocUrl: new URL(nameA[1], base).href,
            author: txt(au && au[1]),
            latest: txt(la && la[1]),
            extra: txt(ut && ut[1]),
          });
        }
        return out;
      },
    },
    filters: [/天才一秒记住本站地址[：:].*/g, /[《'].+?[》']?高速全文字在线阅读。?/g, /一秒记住【.+?】[，,]精彩无弹窗免费阅读！?/g, /\(本章完\)/g, /<!--[\s\S]*?-->/g],
  },
];

// 通用: 从目录页提取章节列表 (dd>a, 去重保持顺序)
export function parseToc(html, base) {
  const seen = new Set();
  const out = [];
  const re = /<dd>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const u = new URL(m[1], base).href;
    if (seen.has(u)) continue;
    seen.add(u);
    const t = txt(m[2]);
    if (!t) continue;
    out.push({ t, u });
  }
  return out;
}

// 通用: 章节正文清洗 → 段落数组
export function cleanChapter(rawHtml, filters) {
  let s = rawHtml || '';
  for (const re of filters) s = s.replace(re, '');
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  return s.split(/\n+/).map(x => x.trim()).filter(x => x.length > 1);
}
