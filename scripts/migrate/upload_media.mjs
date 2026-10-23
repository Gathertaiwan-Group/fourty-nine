// Convert + upload media from a plan built by build_media_plan.py.
// Usage: NODE_PATH=<dir with sharp> node upload_media.mjs <plan.json> <results.json>
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Bucket: site-fortynine.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.NODE_PATH.replace(/\/$/, '') + '/');
const sharp = require('sharp');

const [planPath, outPath] = process.argv.slice(2);
const BUCKET = 'site-fortynine';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')).filter(p => !p.duplicate_of && !p.error);
const results = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
const save = () => fs.writeFileSync(outPath, JSON.stringify(results, null, 0));

async function one(p) {
  if (results[p.key]?.ok) return;
  let body, width = null, height = null;
  const src = fs.readFileSync(p.local);
  if (p.convert) {
    const img = sharp(src, { failOn: 'none' }).rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    body = data; width = info.width; height = info.height;
  } else {
    body = src;
    if (p.content_type === 'image/gif') {
      try { const md = await sharp(src, { failOn: 'none' }).metadata(); width = md.width; height = md.pageHeight || md.height; } catch {}
    }
  }
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p.key.split('/').map(encodeURIComponent).join('/')}`;
  let res, text;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { method: 'POST', body, headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': p.content_type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' } });
    text = await res.text();
    if (res.ok || res.status === 413 || res.status === 400) break;
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  results[p.key] = { ok: res.ok, status: res.status, error: res.ok ? undefined : text.slice(0, 300),
    bytes: body.length, width, height, content_type: p.content_type };
}

let i = 0, done = 0;
async function worker() {
  while (i < plan.length) {
    const p = plan[i++];
    try { await one(p); } catch (e) { results[p.key] = { ok: false, error: String(e).slice(0, 300) }; }
    if (++done % 25 === 0) { save(); console.log(`${done}/${plan.length}`); }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
save();
const vals = Object.values(results);
console.log('ok', vals.filter(v => v.ok).length, 'failed', vals.filter(v => !v.ok).length,
  'MB', (vals.filter(v => v.ok).reduce((a, v) => a + v.bytes, 0) / 1048576).toFixed(1));
for (const [k, v] of Object.entries(results)) if (!v.ok) console.log('FAIL', k, v.status, v.error);
