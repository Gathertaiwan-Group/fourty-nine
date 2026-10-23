// Build step: snapshot site_fortynine.redirects (old attachment pages etc.) into a JSON map
// that the proxy can answer with a real 301 without a database round-trip.
// New rows added later are still honoured at request time by the page (DB lookup).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const out = new URL('../../src/generated/redirects.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  if (!existsSync(out)) writeFileSync(out, JSON.stringify({ paths: {}, ids: {} }));
  console.warn('[gen-redirects] SUPABASE_URL / SUPABASE_ANON_KEY missing — keeping existing map');
  process.exit(0);
}
async function all(table, select) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${select}&order=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'site_fortynine', Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${table} fetch failed: ${res.status} ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < 1000) return rows;
  }
}
const paths = {};
for (const r of await all('redirects', 'source_path,target,status_code')) paths[r.source_path] = [r.target, r.status_code];
// ?attachment_id=N -> file, ?p=N / ?page_id=N -> permalink (WordPress query-string links)
const ids = {};
for (const m of await all('media', 'id,url')) if (m.url) ids[m.id] = m.url;
for (const p of await all('posts', 'id,path,post_type')) if (p.post_type === 'post' || p.post_type === 'page') ids[p.id] = p.path;
writeFileSync(out, JSON.stringify({ paths, ids }));
console.log(`[gen-redirects] ${Object.keys(paths).length} path redirects, ${Object.keys(ids).length} id links`);
