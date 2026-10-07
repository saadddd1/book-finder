// 找书聚合 API —— Cloudflare Worker 入口
// 从 CF 边缘出网, 无墙: Open Library 直接可用, 安娜的档案仍可能被人机验证拦(自动降级为浏览器入口)
// 部署: npx wrangler deploy   本地调试: npx wrangler dev
// API: GET /api/search?q=书名                       → { q, results, merged }
//      GET /api/novel/search?q=网文书名              → { q, sources }
//      GET /api/novel/toc?u=&s=  /  /api/novel/chapter?u=&s=

import { CORS, cachedJson, json } from './http.js';
import { ADAPTERS } from './sources/book.js';
import { buildMerged } from './rank.js';
import { findSource, safeSourceUrl, novelSearch, novelToc, novelChapter } from './novel/api.js';
import { MINI_UI } from './ui.js';

const normQ = q => q.replace(/\s+/g, ' ').toLowerCase();

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
  return { q, results, merged: buildMerged(q, results) };
}

export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // ---- 电子书聚合搜索 (缓存 15 分钟) ----
    if (u.pathname === '/api/search') {
      const q = (u.searchParams.get('q') || '').trim();
      if (!q) return json({ error: '缺少 q' }, 400);
      return cachedJson('api/search?q=' + encodeURIComponent(normQ(q)), 900, () => handleSearch(q));
    }

    // ---- 网文: 搜索 (缓存 15 分钟) ----
    if (u.pathname === '/api/novel/search') {
      const q = (u.searchParams.get('q') || '').trim();
      if (!q) return json({ error: '缺少 q' }, 400);
      return cachedJson('api/novel/search?q=' + encodeURIComponent(normQ(q)), 900, () => novelSearch(q));
    }

    // ---- 网文: 目录 (缓存 1 小时) ----
    if (u.pathname === '/api/novel/toc') {
      const src = findSource(u.searchParams.get('s') || '');
      const target = src ? safeSourceUrl(src, u.searchParams.get('u') || '') : null;
      if (!target) return json({ error: '参数错误' }, 400);
      return cachedJson('api/novel/toc?u=' + encodeURIComponent(target), 3600, () => novelToc(src, target));
    }

    // ---- 网文: 单章 (内容不可变, 缓存 1 天) ----
    if (u.pathname === '/api/novel/chapter') {
      const src = findSource(u.searchParams.get('s') || '');
      const target = src ? safeSourceUrl(src, u.searchParams.get('u') || '') : null;
      if (!target) return json({ error: '参数错误' }, 400);
      return cachedJson('api/novel/chapter?u=' + encodeURIComponent(target), 86400, () => novelChapter(src, target));
    }

    if (u.pathname === '/') return new Response(MINI_UI, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response('Not Found', { status: 404, headers: CORS });
  },
};
