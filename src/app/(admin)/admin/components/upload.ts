'use client';

export type Uploaded = { id: number; url: string; title: string; mime_type: string; width?: number | null; height?: number | null; duplicate?: boolean };

const SERVER_LIMIT = 4 * 1024 * 1024; // Vercel functions accept ~4.5MB request bodies
const RASTER = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/bmp', 'image/tiff'];

/** Shrinks big photos in the browser (still WebP 2000px/q80, same as the server) so they fit the request limit. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('轉檔失敗'))), 'image/webp', 0.8));
}

export async function uploadFile(file: File): Promise<Uploaded> {
  const mime = file.type || 'application/octet-stream';
  if (file.size > SERVER_LIMIT && !RASTER.includes(mime)) {
    // videos / PDFs / large GIFs: signed direct upload to Supabase Storage
    if (mime === 'image/gif') throw new Error('GIF 超過 4MB，請先壓縮後再上傳。');
    const sign = await fetch('/admin/api/media/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'sign', filename: file.name, mime, size: file.size }),
    }).then((r) => r.json());
    if (sign.error) throw new Error(sign.error);
    const put = await fetch(sign.signedUrl, { method: 'PUT', headers: { 'content-type': sign.mime, 'x-upsert': 'false' }, body: file });
    if (!put.ok) throw new Error(`上傳失敗（${put.status}）`);
    const reg = await fetch('/admin/api/media/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'register', path: sign.path, filename: file.name, mime: sign.mime }),
    }).then((r) => r.json());
    if (reg.error) throw new Error(reg.error);
    return reg;
  }
  const fd = new FormData();
  if (file.size > SERVER_LIMIT && RASTER.includes(mime)) {
    fd.append('file', await shrink(file), file.name.replace(/\.[^.]+$/, '') + '.webp');
    fd.append('filename', file.name);
    fd.append('original_mime', 'image/webp');
  } else {
    fd.append('file', file);
    fd.append('filename', file.name);
  }
  const res = await fetch('/admin/api/media/', { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({ error: `上傳失敗（${res.status}）` }));
  if (!res.ok || json.error) throw new Error(json.error || `上傳失敗（${res.status}）`);
  return json;
}
