// Responsive WebP variants for every converted image (and animated GIF) in site_fortynine.media.
// Source = the original file in export/media (not the stored 2000px WebP), widths 480/960/1440, quality 75,
// never upscaled. Uploaded to site-fortynine/v/<w>/<storage path>.webp with an immutable 1-year cache,
// then recorded in media.variants. Idempotent: rows that already have variants are skipped.
// Usage: NODE_PATH=<repo>/node_modules node build_variants.mjs <export/media dir> [--limit N] [--ids 1,2]
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.env.NODE_PATH.replace(/\/$/, '') + '/');
const sharp = require('sharp');

const WIDTHS = [480, 960, 1440];
const BUCKET = 'site-fortynine';
const CACHE = 'public, max-age=31536000, immutable';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
const args = process.argv.slice(2);
const mediaDir = args[0];
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const onlyIds = args.includes('--ids') ? new Set(args[args.indexOf('--ids') + 1].split(',').map(Number)) : null;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const index = JSON.parse(fs.readFileSync(path.join(mediaDir, 'index.json'), 'utf8')).items.filter((i) => i.status === 200 && i.local);
const byId = new Map(index.filter((i) => i.id).map((i) => [i.id, i]));
const byUrl = new Map(index.map((i) => [i.url.replace(/^https?:/, ''), i]));

async function allMedia() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/media?select=id,old_url,storage_path,mime_type,original_mime,width,variants&order=id`, {
      headers: { ...H, 'Accept-Profile': 'site_fortynine', Range: `${from}-${from + 999}` },
    });
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error(JSON.stringify(page));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const publicUrl = (p) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${enc(p)}`;

async function upload(key, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc(key)}`, {
      method: 'POST',
      body,
      headers: { ...H, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': CACHE },
    });
    if (res.ok) return;
    const t = await res.text();
    if (attempt === 2) throw new Error(`${res.status} ${t.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}

async function one(m) {
  const src = byId.get(m.id) || byUrl.get(String(m.old_url).replace(/^https?:/, ''));
  if (!src) return { id: m.id, skip: 'no-local' };
  const file = path.join(mediaDir, src.local.replace(/^media\//, ''));
  if (!fs.existsSync(file)) return { id: m.id, skip: 'missing-file' };
  const buf = fs.readFileSync(file);
  // animated GIFs become animated WebP variants (the GIF itself stays the largest srcset candidate)
  const animated = m.mime_type === 'image/gif';
  const open = () => (animated ? sharp(buf, { failOn: 'none', animated: true }) : sharp(buf, { failOn: 'none' }).rotate());
  const meta = await open().metadata();
  // EXIF orientation 5-8 swaps the axes
  const ow = (meta.orientation ?? 1) >= 5 ? meta.height : meta.width;
  const oh = animated ? meta.pageHeight || meta.height : (meta.orientation ?? 1) >= 5 ? meta.width : meta.height;
  const stem = m.storage_path.replace(/\.[^./]+$/, '');
  const variants = [];
  for (const w of WIDTHS) {
    if (!(ow > w)) continue;
    const { data, info } = await open().resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer({ resolveWithObject: true });
    const key = `v/${w}/${stem}.webp`;
    await upload(key, data);
    variants.push({ w: info.width, h: Math.round((info.width * oh) / ow), path: key, url: publicUrl(key), bytes: data.length });
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/media?id=eq.${m.id}`, {
    method: 'PATCH',
    headers: { ...H, 'Content-Profile': 'site_fortynine', 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ variants }),
  });
  if (!res.ok) throw new Error(`patch ${m.id}: ${res.status} ${await res.text()}`);
  return { id: m.id, n: variants.length, bytes: variants.reduce((s, v) => s + v.bytes, 0) };
}

const rows = (await allMedia()).filter(
  (m) => m.storage_path && (m.mime_type === 'image/webp' || m.mime_type === 'image/gif') && !(m.variants?.length) && (!onlyIds || onlyIds.has(m.id)),
);
const todo = rows.slice(0, limit);
console.log(`media needing variants: ${rows.length}, processing ${todo.length}`);
let done = 0, files = 0, bytes = 0;
const skipped = {};
const errors = [];
const queue = [...todo];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const m = queue.shift();
      try {
        const r = await one(m);
        if (r.skip) skipped[r.skip] = (skipped[r.skip] || 0) + 1;
        else { files += r.n; bytes += r.bytes; }
      } catch (e) {
        errors.push(`${m.id}: ${e.message}`);
      }
      if (++done % 50 === 0) console.log(`${done}/${todo.length} files=${files} MB=${(bytes / 1048576).toFixed(1)}`);
    }
  }),
);
console.log(JSON.stringify({ done, files, MB: +(bytes / 1048576).toFixed(2), skipped, errors: errors.length }, null, 1));
if (errors.length) console.log(errors.slice(0, 20).join('\n'));
