// 共享 HTTP 层: fetch 封装(cookie jar/超时/编码自适应) + 缓存助手 + 通用工具
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function http(url, opts = {}) {
  const { method = 'GET', body = null, jar = null, headers = {}, timeoutMs = 20000, decode = null } = opts;
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
  let text;
  if (decode === 'auto') {
    // 老站点常见 GBK: 先按 utf-8 解, 依 meta charset 或乱码比例切换 gbk
    const buf = await res.arrayBuffer();
    let t = new TextDecoder('utf-8').decode(buf);
    if (/charset=['"]?gb/i.test(t.slice(0, 2000)) || (t.match(/\uFFFD/g) || []).length > 20) {
      try { t = new TextDecoder('gbk').decode(buf); } catch { /* 保底 utf-8 */ }
    }
    text = t;
  } else {
    text = await res.text();
  }
  return { status: res.status, url: res.url, body: text };
}

export const strip = s => s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// Cache API JSON 缓存: 同 key 在 ttl 秒内直接命中(省上游请求与 CPU)
export async function cachedJson(key, ttl, fn) {
  const ck = new Request('https://cache.local/' + key);
  const hit = await caches.default.match(ck);
  if (hit) return hit;
  const data = await fn();
  const res = new Response(JSON.stringify(data), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + ttl } });
  await caches.default.put(ck, res.clone());
  return res;
}

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
