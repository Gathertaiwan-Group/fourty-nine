import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_FIELDS = 50;
const MAX_LEN = 5000;

/**
 * Front-end form submissions (Elementor Pro forms on the old site).
 * Stores into site_fortynine.form_submissions via the service role; the form must exist and be active.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = adminDb();
  const { data: form, error } = await db.from('forms').select('id,fields,settings,is_active').eq('slug', slug).maybeSingle();
  if (error) return NextResponse.json({ success: false, message: '系統忙碌中，請稍後再試。' }, { status: 500 });
  if (!form || !form.is_active) return NextResponse.json({ success: false, message: '找不到表單。' }, { status: 404 });

  let raw: Record<string, unknown> = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) raw = await req.json();
    else Object.assign(raw, Object.fromEntries((await req.formData()).entries()));
  } catch {
    return NextResponse.json({ success: false, message: '資料格式錯誤。' }, { status: 400 });
  }
  // honeypot
  if (raw['fd_hp']) return NextResponse.json({ success: true });
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw).slice(0, MAX_FIELDS)) {
    if (k === 'fd_hp' || typeof v !== 'string') continue;
    data[k.slice(0, 100)] = v.slice(0, MAX_LEN);
  }
  const fields = (Array.isArray(form.fields) ? form.fields : []) as { id: string; label?: string; required?: boolean; type?: string }[];
  const missing = fields.filter((f) => f.required && !data[f.id]?.trim()).map((f) => f.label || f.id);
  if (missing.length) return NextResponse.json({ success: false, message: `請填寫：${missing.join('、')}` }, { status: 422 });
  const badEmail = fields.find((f) => f.type === 'email' && data[f.id] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[f.id]));
  if (badEmail) return NextResponse.json({ success: false, message: `${badEmail.label || badEmail.id} 格式不正確。` }, { status: 422 });

  const page = (data['referer'] || req.headers.get('referer') || '').slice(0, 500);
  delete data['referer'];
  const { error: insErr } = await db.from('form_submissions').insert({
    form_id: form.id,
    data,
    page_path: page ? new URL(page, 'https://x').pathname : null,
    ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
    status: 'new',
  });
  if (insErr) return NextResponse.json({ success: false, message: '送出失敗，請稍後再試。' }, { status: 500 });
  const msg = (form.settings as { success_message?: string } | null)?.success_message || '已成功送出，謝謝！';
  return NextResponse.json({ success: true, message: msg });
}
