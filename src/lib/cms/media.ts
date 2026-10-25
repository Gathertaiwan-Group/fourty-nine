import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { adminDb } from '@/lib/db';
import { audit, CmsError, must, nowIso, revalidateSite, slugify, type Actor } from './core';

export const BUCKET = 'site-fortynine';
/** Raster images are converted to WebP (longest side 2000, quality 80). */
const CONVERT = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/bmp', 'image/heic', 'image/heif'];
/** Stored as-is. */
const PASSTHROUGH = ['image/gif', 'image/svg+xml', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf', 'text/plain'];
export const ALLOWED_MIME = [...CONVERT, ...PASSTHROUGH];
export const MAX_BYTES = 50 * 1024 * 1024;

const EXT: Record<string, string> = {
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'image/webp': 'webp',
};

export type MediaRow = {
  id: number;
  slug: string;
  title: string;
  alt_text: string;
  caption_html: string;
  description_html: string;
  media_type: string;
  mime_type: string;
  url: string | null;
  storage_path: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  date: string | null;
  status: string;
};

const COLS = 'id,slug,title,alt_text,caption_html,description_html,media_type,mime_type,url,storage_path,width,height,bytes,date,status';

export function publicUrl(path: string) {
  return adminDb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export function guessMime(filename: string, given?: string | null) {
  if (given && given !== 'application/octet-stream') return given;
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

function baseName(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const ascii = stem
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return ascii || `file-${Date.now().toString(36)}`;
}

/** Responsive WebP variants (same as scripts/migrate/build_variants.mjs): 480/960/1440 wide, quality 75, never upscaled. */
const VARIANT_WIDTHS = [480, 960, 1440];
const VARIANT_CACHE = 'public, max-age=31536000, immutable';
type StoredVariant = { w: number; h: number; path: string; url: string; bytes: number };

async function makeVariants(original: Buffer, storagePath: string, animated = false): Promise<StoredVariant[]> {
  const open = () => (animated ? sharp(original, { failOn: 'none', animated: true }) : sharp(original, { failOn: 'none' }).rotate());
  const meta = await open().metadata();
  const ow = (meta.orientation ?? 1) >= 5 ? meta.height : meta.width;
  const oh = animated ? meta.pageHeight || meta.height : (meta.orientation ?? 1) >= 5 ? meta.width : meta.height;
  const stem = storagePath.replace(/\.[^./]+$/, '');
  const out: StoredVariant[] = [];
  for (const w of VARIANT_WIDTHS) {
    if (!ow || ow <= w) continue;
    const { data, info } = await open().resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer({ resolveWithObject: true });
    const key = `v/${w}/${stem}.webp`;
    // storage-js only sends "max-age=<n>"; the REST API keeps a full cache-control header as given
    const url = `${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const key2 = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(url, {
      method: 'POST',
      body: new Uint8Array(data),
      headers: { apikey: key2, Authorization: `Bearer ${key2}`, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': VARIANT_CACHE },
      cache: 'no-store',
    });
    if (!res.ok) throw new CmsError(`storage variant: ${res.status} ${(await res.text()).slice(0, 200)}`, 500);
    out.push({ w: info.width, h: oh && ow ? Math.round((info.width * oh) / ow) : info.height, path: key, url: publicUrl(key), bytes: data.length });
  }
  return out;
}

async function uniquePath(dir: string, stem: string, ext: string) {
  for (let i = 0; i < 100; i++) {
    const p = `${dir}/${i ? `${stem}-${i}` : stem}.${ext}`;
    const hit = must(await adminDb().from('media').select('id').eq('storage_path', p).limit(1), 'media');
    if (!hit?.length) {
      const { data } = await adminDb().storage.from(BUCKET).list(dir, { search: `${i ? `${stem}-${i}` : stem}.${ext}`, limit: 1 });
      if (!data?.some((o) => o.name === `${i ? `${stem}-${i}` : stem}.${ext}`)) return p;
    }
  }
  throw new CmsError('無法產生唯一檔名');
}

function monthDir(d = new Date()) {
  return `uploads/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Upload a file (admin form, editor image button or MCP). Duplicate files (same SHA-1) return the existing item. */
export async function uploadMedia(
  input: { buffer: Buffer; filename: string; mime?: string | null; title?: string; alt_text?: string; parent_post_id?: number | null },
  actor: Actor,
): Promise<MediaRow & { duplicate?: boolean }> {
  const mime = guessMime(input.filename, input.mime);
  if (!ALLOWED_MIME.includes(mime)) throw new CmsError(`不支援的檔案類型：${mime}`);
  if (input.buffer.length > MAX_BYTES) throw new CmsError('檔案超過 50MB');
  const sha1 = createHash('sha1').update(input.buffer).digest('hex');
  const dup = must(await adminDb().from('media').select(COLS).eq('sha1', sha1).limit(1).maybeSingle(), 'media') as MediaRow | null;
  if (dup) return { ...dup, duplicate: true };

  let body: Buffer = input.buffer;
  let storedMime = mime;
  let width: number | null = null;
  let height: number | null = null;
  let ow: number | null = null;
  let oh: number | null = null;
  if (CONVERT.includes(mime)) {
    const img = sharp(input.buffer, { failOn: 'error' }).rotate();
    const meta = await img.metadata();
    ow = meta.width ?? null;
    oh = meta.height ?? null;
    const out = await img.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    body = out.data;
    width = out.info.width;
    height = out.info.height;
    storedMime = 'image/webp';
  } else if (mime === 'image/gif') {
    const meta = await sharp(input.buffer, { animated: true }).metadata().catch(() => null);
    width = ow = meta?.width ?? null;
    height = oh = meta?.pageHeight ?? meta?.height ?? null;
  }
  const ext = EXT[storedMime] || input.filename.split('.').pop()?.toLowerCase() || 'bin';
  const stem = baseName(input.filename);
  const path = await uniquePath(monthDir(), stem, ext);
  const up = await adminDb().storage.from(BUCKET).upload(path, body, { contentType: storedMime, upsert: false, cacheControl: '31536000' });
  if (up.error) throw new CmsError(`storage: ${up.error.message}`, 500);
  const variants = CONVERT.includes(mime) ? await makeVariants(input.buffer, path) : mime === 'image/gif' ? await makeVariants(input.buffer, path, true) : [];
  return insertRow({ variants, path, storedMime, originalMime: mime, bytes: body.length, originalBytes: input.buffer.length, sha1, width, height, ow, oh, filename: input.filename, title: input.title, alt: input.alt_text, parent: input.parent_post_id }, actor);
}

async function insertRow(
  f: {
    path: string;
    storedMime: string;
    originalMime: string;
    bytes: number;
    originalBytes: number;
    sha1: string | null;
    width: number | null;
    height: number | null;
    ow: number | null;
    oh: number | null;
    filename: string;
    title?: string;
    alt?: string;
    parent?: number | null;
    variants?: StoredVariant[];
  },
  actor: Actor,
) {
  const stem = f.filename.replace(/\.[^.]+$/, '');
  const slugBase = slugify(stem);
  const taken = must(await adminDb().from('media').select('id').eq('slug', slugBase).limit(1), 'media');
  const slug = taken?.length ? `${slugBase}-${Date.now().toString(36).slice(-5)}` : slugBase;
  const url = publicUrl(f.path);
  const row = {
    slug,
    wp_slug: encodeURIComponent(slug).toLowerCase(),
    title: f.title?.trim() || stem,
    alt_text: f.alt ?? '',
    media_type: f.storedMime.startsWith('image/') ? 'image' : 'file',
    mime_type: f.storedMime,
    original_mime: f.originalMime,
    old_url: url,
    storage_path: f.path,
    url,
    width: f.width,
    height: f.height,
    bytes: f.bytes,
    original_bytes: f.originalBytes,
    sha1: f.sha1,
    parent_post_id: f.parent ?? null,
    status: 'inherit',
    variants: f.variants ?? [],
    date: nowIso(),
    modified: nowIso(),
    meta: { uploaded_via: actor.label === 'mcp' ? 'mcp' : 'admin', original_filename: f.filename, original_width: f.ow, original_height: f.oh },
  };
  const created = must(await adminDb().from('media').insert(row).select(COLS).single(), 'media') as MediaRow;
  await audit(actor, 'create', 'media', created.id, null, { ...row, meta: undefined });
  return created;
}

/** Large non-image files go straight from the browser to Storage (Vercel request bodies are capped at 4.5MB). */
export async function signDirectUpload(filename: string, mime: string, size: number) {
  const m = guessMime(filename, mime);
  if (!PASSTHROUGH.includes(m) || m.startsWith('image/')) throw new CmsError('只有影片／PDF／文字檔可直接上傳；圖片會由伺服器轉成 WebP');
  if (size > MAX_BYTES) throw new CmsError('檔案超過 50MB');
  const path = await uniquePath(monthDir(), baseName(filename), EXT[m] || 'bin');
  const { data, error } = await adminDb().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new CmsError(`storage: ${error.message}`, 500);
  return { path, token: data.token, signedUrl: data.signedUrl, mime: m };
}

export async function registerDirectUpload(input: { path: string; filename: string; mime: string; title?: string }, actor: Actor) {
  if (!/^uploads\/\d{4}\/\d{2}\/[\w.-]+$/.test(input.path)) throw new CmsError('路徑不正確');
  const dir = input.path.slice(0, input.path.lastIndexOf('/'));
  const name = input.path.slice(input.path.lastIndexOf('/') + 1);
  const { data } = await adminDb().storage.from(BUCKET).list(dir, { search: name, limit: 5 });
  const obj = data?.find((o) => o.name === name);
  if (!obj) throw new CmsError('找不到已上傳的檔案');
  const size = Number((obj.metadata as any)?.size ?? 0);
  const m = guessMime(input.filename, input.mime);
  return insertRow({ path: input.path, storedMime: m, originalMime: m, bytes: size, originalBytes: size, sha1: null, width: null, height: null, ow: null, oh: null, filename: input.filename, title: input.title }, actor);
}

export async function listMedia(opts: { q?: string; type?: 'image' | 'file' | ''; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = adminDb().from('media').select(COLS, { count: 'exact' });
  if (opts.type) q = q.eq('media_type', opts.type);
  if (opts.q) q = q.or(`title.ilike.${JSON.stringify('%' + opts.q + '%')},slug.ilike.${JSON.stringify('%' + opts.q + '%')}`);
  const res = await q.order('date', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  return { items: (must(res, 'media') ?? []) as MediaRow[], total: res.count ?? 0 };
}

export async function getMediaItem(id: number) {
  return must(await adminDb().from('media').select(COLS).eq('id', id).maybeSingle(), 'media') as MediaRow | null;
}

export async function updateMedia(id: number, input: { title?: string; alt_text?: string; caption_html?: string; description_html?: string }, actor: Actor) {
  const before = await getMediaItem(id);
  if (!before) throw new CmsError('找不到媒體', 404);
  const patch: Record<string, unknown> = {};
  for (const k of ['title', 'alt_text', 'caption_html', 'description_html'] as const) if (input[k] !== undefined) patch[k] = input[k];
  patch.modified = nowIso();
  const after = must(await adminDb().from('media').update(patch).eq('id', id).select(COLS).single(), 'media') as MediaRow;
  await audit(actor, 'update', 'media', id, before, after);
  revalidateSite();
  return after;
}

export async function deleteMedia(id: number, actor: Actor) {
  const before = must(await adminDb().from('media').select('*').eq('id', id).maybeSingle(), 'media');
  if (!before) throw new CmsError('找不到媒體', 404);
  if (before.storage_path) {
    const others = must(await adminDb().from('media').select('id').eq('storage_path', before.storage_path).neq('id', id).limit(1), 'media');
    if (!others?.length) {
      const variantPaths = (Array.isArray(before.variants) ? before.variants : []).map((v: any) => v?.path).filter(Boolean);
      const rm = await adminDb().storage.from(BUCKET).remove([before.storage_path, ...variantPaths]);
      if (rm.error) throw new CmsError(`storage: ${rm.error.message}`, 500);
    }
  }
  await adminDb().from('posts').update({ featured_media_id: null }).eq('featured_media_id', id);
  must(await adminDb().from('media').delete().eq('id', id), 'media');
  await audit(actor, 'delete', 'media', id, before, null);
  revalidateSite();
  return { id, deleted: true };
}
