import { NextResponse } from 'next/server';
import { actorOf, currentAdmin } from '@/lib/admin/auth';
import { CmsError } from '@/lib/cms/core';
import { listMedia, registerDirectUpload, signDirectUpload, uploadMedia } from '@/lib/cms/media';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function fail(e: unknown) {
  if (e instanceof CmsError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: (e as Error).message }, { status: 500 });
}

/** Media library listing for the pickers (JSON). */
export async function GET(req: Request) {
  if (!(await currentAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const u = new URL(req.url);
  try {
    const r = await listMedia({
      q: u.searchParams.get('q') || undefined,
      type: (u.searchParams.get('type') as 'image' | 'file' | null) || undefined,
      limit: Number(u.searchParams.get('limit') || 40),
      offset: Number(u.searchParams.get('offset') || 0),
    });
    return NextResponse.json(r);
  } catch (e) {
    return fail(e);
  }
}

/**
 * multipart/form-data  file=<File>          -> server converts raster images to WebP and stores it
 * application/json     {op:'sign', ...}     -> signed upload URL for big videos / PDFs (browser -> Storage)
 * application/json     {op:'register', ...} -> creates the media row after a direct upload
 * Response for uploads includes `location` (TinyMCE images_upload_handler contract).
 */
export async function POST(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const actor = actorOf(admin);
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await req.json();
      if (body.op === 'sign') return NextResponse.json(await signDirectUpload(String(body.filename), String(body.mime || ''), Number(body.size || 0)));
      if (body.op === 'register') {
        const m = await registerDirectUpload({ path: String(body.path), filename: String(body.filename), mime: String(body.mime || '') }, actor);
        return NextResponse.json({ ...m, location: m.url });
      }
      return NextResponse.json({ error: 'unknown op' }, { status: 400 });
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: '缺少檔案' }, { status: 400 });
    const m = await uploadMedia(
      {
        buffer: Buffer.from(await file.arrayBuffer()),
        filename: String(form.get('filename') || file.name || 'upload'),
        mime: String(form.get('original_mime') || file.type || ''),
        title: form.get('title') ? String(form.get('title')) : undefined,
        alt_text: form.get('alt_text') ? String(form.get('alt_text')) : undefined,
      },
      actor,
    );
    return NextResponse.json({ ...m, location: m.url });
  } catch (e) {
    return fail(e);
  }
}
