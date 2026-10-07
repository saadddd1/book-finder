// 网文 API: 搜索/目录/单章代理 (整书抓取与打包在浏览器端完成)
import { http, strip } from '../http.js';
import { NOVEL_SOURCES, parseToc, cleanChapter } from './rules.js';

export function findSource(id) { return NOVEL_SOURCES.find(s => s.id === id); }

export function safeSourceUrl(src, u) {
  try {
    const t = new URL(u), b = new URL(src.base);
    return t.origin === b.origin ? t.href : null; // 白名单: 仅书源自己的域名, 防 SSRF
  } catch { return null; }
}

export async function novelSearch(q) {
  const sources = await Promise.all(NOVEL_SOURCES.map(async s => {
    try {
      const r = await http(s.search.url, {
        method: s.search.method || 'GET',
        body: s.search.body ? s.search.body(q) : undefined,
        decode: 'auto', timeoutMs: 15000,
      });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const items = s.search.parse(r.body, s.base);
      return { id: s.id, name: s.name, ok: true, items };
    } catch (e) {
      return { id: s.id, name: s.name, ok: false, error: (e && e.message) || '失败', items: [] };
    }
  }));
  return { q, sources };
}

export async function novelToc(src, target) {
  const r = await http(target, { decode: 'auto', timeoutMs: 20000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const chapters = parseToc(r.body, target).slice(0, 3000);
  const title = strip((r.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || ['', ''])[1]) || strip((r.body.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) || ['', ''])[1]);
  return { total: chapters.length, title, chapters };
}

export async function novelChapter(src, target) {
  const r = await http(target, { decode: 'auto', timeoutMs: 20000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const t = strip((r.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || ['', ''])[1]);
  const raw = (r.body.match(/id="content"[^>]*>([\s\S]*?)<\/div>/) || ['', ''])[1];
  if (!raw) throw new Error('正文解析失败');
  return { t, p: cleanChapter(raw, src.filters || []) };
}
