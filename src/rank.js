// 排序与去重: 相关度评分 + 书名/作者双键跨源合并
// 评分 = 直链数×3 + 命中源数×1.5 + 相关度(精确4/包含3/部分≤2)

const normT = s => (s || '').toLowerCase().replace(/[《》【】\[\]()（）·:：,，.。!！?？\-—_'’"“”\s]/g, '');

function relevance(title, q) {
  const t = normT(title), nq = normT(q);
  if (!nq) return 0;
  if (t === nq) return 4;
  if (t.includes(nq)) return 3;
  let hit = 0;
  if (/[\u4e00-\u9fff]/.test(nq)) {
    const grams = [...nq].map((c, i, a) => i < a.length - 1 ? c + a[i + 1] : null).filter(Boolean);
    for (const g of grams) if (t.includes(g)) hit++;
    return grams.length ? Math.min(2, hit / grams.length * 2) : 0;
  }
  const toks = nq.split(/\s+/).filter(w => w.length > 1);
  for (const w of toks) if (t.includes(w)) hit++;
  return toks.length ? Math.min(2, hit / toks.length * 2) : 0;
}

export function buildMerged(q, results) {
  const groups = new Map();
  for (const src of results) {
    for (const it of (src.items || [])) {
      const tKey = normT(it.title);
      if (!tKey) continue;
      const aKey = normT(it.author);
      let g = null;
      for (const gr of groups.values()) {
        if (gr.tKey !== tKey) continue;
        const ga = gr.aKey;
        if (!ga || !aKey || ga === aKey || ga.includes(aKey) || aKey.includes(ga)) { g = gr; break; }
      }
      if (!g) {
        g = { tKey, aKey, title: it.title, author: it.author || '', extra: it.extra || '', srcs: [], langs: {}, downloads: [], pageUrls: [] };
        groups.set(tKey + '|' + (aKey || Math.random().toString(36).slice(2)), g);
      }
      if (!g.author && it.author) { g.author = it.author; g.aKey = aKey; }
      if (it.title.length > g.title.length && it.author) g.title = it.title;
      if (!g.extra && it.extra) g.extra = it.extra;
      if (g.srcs.indexOf(src.name) < 0) g.srcs.push(src.name);
      if (src.lang) g.langs[src.lang] = 1;
      for (const d of (it.downloads || [])) {
        if (/^https?:\/\//i.test(d.url || '') && !g.downloads.some(x => x.url === d.url)) g.downloads.push(d);
      }
      if (it.pageUrl && /^https?:\/\//i.test(it.pageUrl) && g.pageUrls.indexOf(it.pageUrl) < 0) g.pageUrls.push(it.pageUrl);
    }
  }
  const arr = [...groups.values()].map(g => ({
    title: g.title, author: g.author, extra: g.extra,
    downloads: g.downloads, pageUrls: g.pageUrls,
    srcs: g.srcs, langs: Object.keys(g.langs),
    score: Math.round((g.downloads.length * 3 + g.srcs.length * 1.5 + relevance(g.title, q)) * 10) / 10,
  }));
  arr.sort((a, b) => b.score - a.score || b.srcs.length - a.srcs.length || b.downloads.length - a.downloads.length);
  return arr.slice(0, 30);
}
