// Add 3 missing attachments (12900/12901/12902, parent 11676) to site_fortynine.media.
// Usage: NODE_PATH=<repo>/node_modules node add_missing_media.mjs <dir with f1.png f2.png f3.png fetched once from the old site>
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. These attachments belong to the draft page 11676, so the public REST export never listed them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(process.env.NODE_PATH.replace(/\/$/, '') + '/');
const sharp = require('sharp');

const dir = process.argv[2];
const BUCKET = 'site-fortynine';
const CACHE = 'public, max-age=31536000, immutable';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const pub = (p) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${enc(p)}`;
const OLD = 'https://fortynine-days.com/wp-content/uploads/2023/03/';

const items = [
  { id: 12900, file: 'f1.png', name: '聯絡我們工作區域-1@2x.png', key: 'uploads/2023/03/1-2x-b6c21eba.webp',
    title: '聯絡我們工作區域 1@2x', wp_slug: '%e8%81%af%e7%b5%a1%e6%88%91%e5%80%91%e5%b7%a5%e4%bd%9c%e5%8d%80%e5%9f%9f-12x',
    date: '2023-03-08 14:25:28', wp_file: '2023/03/聯絡我們工作區域-1@2x.png', ow: 2048, oh: 2048 },
  { id: 12901, file: 'f2.png', name: '聯絡我們工作區域-1@2x-1.png', dupOf: 12900,
    title: '聯絡我們工作區域 1@2x', wp_slug: '%e8%81%af%e7%b5%a1%e6%88%91%e5%80%91%e5%b7%a5%e4%bd%9c%e5%8d%80%e5%9f%9f-12x-2',
    date: '2023-03-08 14:26:28', wp_file: '2023/03/聯絡我們工作區域-1@2x-1-e1678256928746.png', ow: 2048, oh: 2048,
    extraUrls: [OLD + '聯絡我們工作區域-1@2x-1-e1678256928746.png'] },
  { id: 12902, file: 'f3.png', name: '聯絡我們工作區域-1.png', key: 'uploads/2023/03/1-81db14d1.webp',
    title: '聯絡我們工作區域 1', wp_slug: '%e8%81%af%e7%b5%a1%e6%88%91%e5%80%91%e5%b7%a5%e4%bd%9c%e5%8d%80%e5%9f%9f-1',
    date: '2023-03-08 14:27:14', wp_file: '2023/03/聯絡我們工作區域-1.png', ow: 1080, oh: 1080 },
];

async function upload(key, body) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc(key)}`, {
    method: 'POST', body, headers: { ...H, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': CACHE },
  });
  if (!res.ok) throw new Error(`upload ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
async function rest(table, rows, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST', body: JSON.stringify(rows),
    headers: { ...H, 'Content-Profile': 'site_fortynine', 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
}

const done = {};
const mediaRows = [];
const mapRows = [];
let uploaded = 0;
for (const it of items) {
  const buf = fs.readFileSync(path.join(dir, it.file));
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
  let r;
  if (it.dupOf) {
    r = done[it.dupOf];
    if (r.sha1 !== sha1) throw new Error(`${it.id} is not identical to ${it.dupOf}`);
  } else {
    const { data, info } = await sharp(buf, { failOn: 'none' }).rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    await upload(it.key, data); uploaded += data.length;
    const stem = it.key.replace(/\.[^./]+$/, '');
    const variants = [];
    for (const w of [480, 960, 1440]) {
      if (!(it.ow > w)) continue;
      const v = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 })
        .toBuffer({ resolveWithObject: true });
      const k = `v/${w}/${stem}.webp`;
      await upload(k, v.data); uploaded += v.data.length;
      variants.push({ w: v.info.width, h: Math.round((v.info.width * it.oh) / it.ow), path: k, url: pub(k), bytes: v.data.length });
    }
    r = { key: it.key, url: pub(it.key), width: info.width, height: info.height, bytes: data.length, variants, sha1 };
  }
  done[it.id] = r;
  const slug = decodeURIComponent(it.wp_slug);
  mediaRows.push({
    id: it.id, slug, wp_slug: it.wp_slug, title: it.title, caption_html: '', description_html: '', alt_text: '',
    media_type: 'image', mime_type: 'image/webp', original_mime: 'image/png', old_url: OLD + it.name,
    storage_path: r.key, url: r.url, width: r.width, height: r.height, bytes: r.bytes, original_bytes: buf.length,
    sha1, attachment_path: null, parent_post_id: 11676, author_id: 1, status: 'inherit',
    date: it.date + '+08:00', modified: it.date + '+08:00',
    meta: { duplicate_of: it.dupOf ?? null, wp_file: it.wp_file, original_width: it.ow, original_height: it.oh, source: 'wp_posts jsonl (draft parent, not in REST export)' },
    variants: r.variants,
  });
  for (const u of [OLD + it.name, ...(it.extraUrls || [])]) {
    mapRows.push({ old_url: u, media_id: it.id, new_url: r.url, kind: it.dupOf ? 'duplicate' : 'original' });
  }
}
await rest('media', mediaRows, 'id');
await rest('media_url_map', mapRows, 'old_url');
console.log(JSON.stringify({ media: mediaRows.map((m) => [m.id, m.storage_path, m.variants.length]), map: mapRows.length, uploadedKB: Math.round(uploaded / 1024) }));
