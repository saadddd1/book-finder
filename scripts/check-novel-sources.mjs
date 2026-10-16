#!/usr/bin/env node
/**
 * Check the production novel-search endpoint and report each source.
 * Default mode is non-blocking; pass --strict to exit 1 when no source returns hits.
 */
const endpoint = process.env.NOVEL_SEARCH_URL || 'https://book-finder-api.3280244146.workers.dev/api/novel/search';
const query = process.env.NOVEL_SEARCH_QUERY || '斗破苍穹';
const strict = process.argv.includes('--strict');
const timeoutMs = Number(process.env.NOVEL_CHECK_TIMEOUT_MS || 70000);

const url = new URL(endpoint);
url.searchParams.set('q', query);
const started = Date.now();

let response;
try {
  response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
} catch (error) {
  console.warn(`::warning::novel endpoint unavailable: ${error.message}`);
  process.exit(strict ? 1 : 0);
}

let payload;
try {
  payload = await response.json();
} catch (error) {
  console.warn(`::warning::novel endpoint returned invalid JSON (HTTP ${response.status}): ${error.message}`);
  process.exit(strict ? 1 : 0);
}

if (!response.ok || !Array.isArray(payload.sources)) {
  console.warn(`::warning::novel endpoint returned an unexpected response (HTTP ${response.status})`);
  process.exit(strict ? 1 : 0);
}

const sources = payload.sources.map(source => ({
  id: source.id,
  name: source.name,
  ok: source.ok === true,
  items: Array.isArray(source.items) ? source.items.length : 0,
  error: source.error || '',
}));
const healthy = sources.filter(source => source.ok && source.items > 0);

for (const source of sources) {
  const level = source.ok && source.items > 0 ? 'PASS' : 'WARN';
  console.log(`${level} ${source.name}: ${source.items} result(s)${source.error ? ` — ${source.error}` : ''}`);
}

console.log(`novel sources with hits: ${healthy.length}/${sources.length}; elapsed=${Date.now() - started}ms`);
if (healthy.length === 0) {
  console.warn('::warning::No novel source returned results; novel search is degraded but the overall build remains non-blocking.');
  if (strict) process.exitCode = 1;
}
