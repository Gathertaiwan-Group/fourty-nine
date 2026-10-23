import 'server-only';
import { adminDb } from '@/lib/db';
import { audit, CmsError, must, nowIso, revalidateSite, type Actor } from './core';

/* ------------------------------------------------------------------ settings */

const TRACKING_RE = /^(GTM|GT|G|AW|UA|DC)-[A-Z0-9-]{3,20}$/i;

export const SETTING_KEYS = ['blogname', 'blogdescription', 'site_logo', 'site_icon', 'contact', 'tracking_ids', 'chaty'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export async function getAllSettings() {
  const rows = must(await adminDb().from('settings').select('key,value,is_public,updated_at').order('key'), 'settings') ?? [];
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, any>;
}

function validateSetting(key: string, value: unknown): unknown {
  if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new CmsError(`不可修改的設定：${key}（可修改：${SETTING_KEYS.join(', ')}）`);
  switch (key) {
    case 'blogname':
    case 'blogdescription':
      if (typeof value !== 'string') throw new CmsError(`${key} 必須是文字`);
      return value.trim().slice(0, 500);
    case 'site_logo':
    case 'site_icon': {
      const v = value as { url?: string; media_id?: number } | null;
      if (!v || typeof v.url !== 'string' || !/^https:\/\//.test(v.url)) throw new CmsError(`${key} 需要 { url: https://..., media_id }`);
      return { url: v.url, media_id: v.media_id ?? null };
    }
    case 'contact': {
      const v = (value ?? {}) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const k of ['phone', 'email', 'address', 'line']) out[k] = typeof v[k] === 'string' ? (v[k] as string).trim().slice(0, 300) : '';
      if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new CmsError('Email 格式不正確');
      if (out.line && !/^https?:\/\//.test(out.line)) throw new CmsError('LINE 連結需為 http(s) 網址');
      return out;
    }
    case 'tracking_ids': {
      const v = (value ?? {}) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const k of ['gtm', 'google_tag', 'ga4']) {
        const s = typeof v[k] === 'string' ? (v[k] as string).trim() : '';
        if (s && !TRACKING_RE.test(s)) throw new CmsError(`追蹤碼 ${k} 格式不正確：${s}`);
        if (s) out[k] = s;
      }
      return out;
    }
    case 'chaty':
      if (!value || typeof value !== 'object') throw new CmsError('chaty 必須是物件');
      return value;
  }
  return value;
}

/** Key-order independent JSON (jsonb re-orders object keys). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export async function updateSettings(values: Record<string, unknown>, actor: Actor) {
  const current = await getAllSettings();
  const changed: Record<string, unknown> = {};
  const prev: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(values)) {
    const v = validateSetting(k, raw);
    if (canon(v) === canon(current[k])) continue;
    must(await adminDb().from('settings').upsert({ key: k, value: v, is_public: true }, { onConflict: 'key' }), 'settings');
    changed[k] = v;
    prev[k] = current[k] ?? null;
  }
  if (Object.keys(changed).length) {
    await audit(actor, 'update', 'settings', Object.keys(changed).join(','), prev, changed);
    revalidateSite();
  }
  return { changed: Object.keys(changed), settings: await getAllSettings() };
}

/* ------------------------------------------------------------------ menus */

export type MenuItemInput = {
  key: string;
  id?: number | null;
  parent_key?: string | null;
  title: string;
  url: string;
  object_type?: string | null;
  object_id?: number | null;
  target?: string | null;
  attr_title?: string | null;
  classes?: string[];
};

export async function listMenus() {
  return must(await adminDb().from('menus').select('id,slug,name,location,updated_at').order('id'), 'menus') ?? [];
}

export async function getMenuWithItems(id: number) {
  const menu = must(await adminDb().from('menus').select('id,slug,name,location').eq('id', id).maybeSingle(), 'menus');
  if (!menu) return null;
  const items = must(
    await adminDb().from('menu_items').select('id,parent_id,position,title,url,object_type,object_id,target,attr_title,classes').eq('menu_id', id).order('position'),
    'menu_items',
  );
  return { ...menu, items: items ?? [] };
}

function validUrl(u: string) {
  return u === '#' || /^\/[^\s]*$/.test(u) || /^https?:\/\/[^\s]+$/.test(u) || /^(mailto|tel):[^\s]+$/.test(u);
}

/** Replace all items of a menu. Items must be in tree order (parents first). */
export async function saveMenu(id: number, items: MenuItemInput[], actor: Actor, name?: string) {
  const before = await getMenuWithItems(id);
  if (!before) throw new CmsError('找不到選單', 404);
  const keys = new Set<string>();
  for (const it of items) {
    if (!it.key) throw new CmsError('每個項目都需要 key');
    if (!it.title?.trim()) throw new CmsError('選單項目標題必填');
    if (!validUrl(it.url?.trim() || '')) throw new CmsError(`網址不正確：${it.url}`);
    if (it.parent_key && !keys.has(it.parent_key)) throw new CmsError(`項目「${it.title}」的上層必須排在它前面`);
    if (it.target && it.target !== '_blank') throw new CmsError('target 只能是 _blank 或空白');
    keys.add(it.key);
  }
  if (name && name.trim() && name.trim() !== before.name) must(await adminDb().from('menus').update({ name: name.trim() }).eq('id', id), 'menus');
  const res = await adminDb().rpc('replace_menu_items', {
    p_menu_id: id,
    p_items: items.map((i) => ({ ...i, title: i.title.trim(), url: i.url.trim(), classes: i.classes ?? [] })),
  });
  must(res, 'replace_menu_items');
  const after = await getMenuWithItems(id);
  await audit(actor, 'update', 'menus', id, before, after);
  revalidateSite();
  return after!;
}

/* ------------------------------------------------------------------ forms */

export async function listForms() {
  const forms = must(await adminDb().from('forms').select('id,slug,name,fields,is_active,created_at').order('id'), 'forms') ?? [];
  const counts = must(await adminDb().from('form_submissions').select('form_id,status'), 'form_submissions') ?? [];
  return forms.map((f) => ({
    ...f,
    total: counts.filter((c) => c.form_id === f.id).length,
    unread: counts.filter((c) => c.form_id === f.id && c.status === 'new').length,
  }));
}

export async function listSubmissions(opts: { form_id?: number; status?: string; limit?: number; offset?: number; q?: string }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 1000);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = adminDb().from('form_submissions').select('id,form_id,wp_id,data,page_path,ip,user_agent,status,created_at,forms(name,slug)', { count: 'exact' });
  if (opts.form_id) q = q.eq('form_id', opts.form_id);
  if (opts.status) q = q.eq('status', opts.status);
  const res = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  let items = (must(res, 'form_submissions') ?? []) as any[];
  if (opts.q) {
    const needle = opts.q.toLowerCase();
    items = items.filter((i) => JSON.stringify(i.data).toLowerCase().includes(needle));
  }
  return { items, total: res.count ?? 0 };
}

export const SUBMISSION_STATUSES = ['new', 'read', 'replied', 'spam', 'trash'] as const;

export async function updateSubmissionStatus(id: string, status: string, actor: Actor) {
  if (!(SUBMISSION_STATUSES as readonly string[]).includes(status)) throw new CmsError(`status 必須是 ${SUBMISSION_STATUSES.join(' / ')}`);
  const before = must(await adminDb().from('form_submissions').select('id,status').eq('id', id).maybeSingle(), 'form_submissions');
  if (!before) throw new CmsError('找不到表單提交', 404);
  if (before.status === status) return before;
  const after = must(await adminDb().from('form_submissions').update({ status }).eq('id', id).select('id,status').single(), 'form_submissions');
  await audit(actor, 'update', 'form_submissions', id, before, after);
  return after;
}

export async function deleteSubmission(id: string, actor: Actor) {
  const before = must(await adminDb().from('form_submissions').select('*').eq('id', id).maybeSingle(), 'form_submissions');
  if (!before) throw new CmsError('找不到表單提交', 404);
  must(await adminDb().from('form_submissions').delete().eq('id', id), 'form_submissions');
  await audit(actor, 'delete', 'form_submissions', id, before, null);
  return { id, deleted: true };
}

function csvCell(v: unknown) {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function submissionsCsv(formId?: number) {
  const { items } = await listSubmissions({ form_id: formId, limit: 1000 });
  const fieldKeys: string[] = [];
  for (const i of items) for (const k of Object.keys(i.data || {})) if (!fieldKeys.includes(k)) fieldKeys.push(k);
  const head = ['id', 'form', 'created_at', 'status', 'page_path', ...fieldKeys, 'ip', 'user_agent'];
  const lines = [head.map(csvCell).join(',')];
  for (const i of items) {
    lines.push(
      [i.id, i.forms?.name ?? i.form_id, i.created_at, i.status, i.page_path, ...fieldKeys.map((k) => i.data?.[k]), i.ip, i.user_agent].map(csvCell).join(','),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ redirects */

function normPath(p: string) {
  let s = p.trim();
  try {
    if (/^https?:\/\//.test(s)) s = new URL(s).pathname;
    s = decodeURIComponent(s);
  } catch {}
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(s)) s += '/';
  return s;
}

export async function listRedirects(opts: { q?: string; kind?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = adminDb().from('redirects').select('id,source_path,target,status_code,kind,media_id,created_at', { count: 'exact' });
  if (opts.kind) q = q.eq('kind', opts.kind);
  if (opts.q) q = q.or(`source_path.ilike.${JSON.stringify('%' + opts.q + '%')},target.ilike.${JSON.stringify('%' + opts.q + '%')}`);
  const res = await q.order('id', { ascending: false }).range(offset, offset + limit - 1);
  return { items: must(res, 'redirects') ?? [], total: res.count ?? 0 };
}

export async function upsertRedirect(input: { id?: number; source_path: string; target: string; status_code?: number }, actor: Actor) {
  const source_path = normPath(input.source_path);
  const target = input.target.trim();
  const status_code = input.status_code ?? 301;
  if (![301, 302, 307, 308, 410].includes(status_code)) throw new CmsError('狀態碼必須是 301/302/307/308/410');
  if (status_code !== 410 && !(/^\//.test(target) || /^https?:\/\//.test(target))) throw new CmsError('目標需為 / 開頭路徑或 http(s) 網址');
  if (source_path.startsWith('/admin') || source_path.startsWith('/api/')) throw new CmsError('不可轉址後台或 API 路徑');
  if (normPath(target) === source_path) throw new CmsError('來源與目標相同會造成無限轉址');
  const row = { source_path, target: target || '/', status_code };
  let before = null;
  let after;
  if (input.id) {
    before = must(await adminDb().from('redirects').select('*').eq('id', input.id).maybeSingle(), 'redirects');
    if (!before) throw new CmsError('找不到轉址', 404);
    after = must(await adminDb().from('redirects').update(row).eq('id', input.id).select('*').single(), 'redirects');
  } else {
    before = must(await adminDb().from('redirects').select('*').eq('source_path', source_path).maybeSingle(), 'redirects');
    after = must(await adminDb().from('redirects').upsert({ ...row, kind: before?.kind ?? 'manual' }, { onConflict: 'source_path' }).select('*').single(), 'redirects');
  }
  await audit(actor, before ? 'update' : 'create', 'redirects', after.id, before, after);
  revalidateSite();
  return after;
}

export async function deleteRedirect(id: number, actor: Actor) {
  const before = must(await adminDb().from('redirects').select('*').eq('id', id).maybeSingle(), 'redirects');
  if (!before) throw new CmsError('找不到轉址', 404);
  must(await adminDb().from('redirects').delete().eq('id', id), 'redirects');
  await audit(actor, 'delete', 'redirects', id, before, null);
  revalidateSite();
  return { id, deleted: true };
}

/* ------------------------------------------------------------------ orders (filled from the DB backup in phase 3) */

export const ORDER_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'] as const;

export async function listOrders(opts: { status?: string; q?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = adminDb()
    .from('orders')
    .select('id,order_number,status,currency,total,payment_method_title,billing,date_created,customer_id', { count: 'exact' });
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.q && /^\d+$/.test(opts.q)) q = q.eq('id', Number(opts.q));
  const res = await q.order('date_created', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
  return { items: must(res, 'orders') ?? [], total: res.count ?? 0 };
}

export async function getOrder(id: number) {
  const order = must(await adminDb().from('orders').select('*').eq('id', id).maybeSingle(), 'orders');
  if (!order) return null;
  const items = must(await adminDb().from('order_items').select('*').eq('order_id', id).order('id'), 'order_items');
  const notes = must(await adminDb().from('order_notes').select('*').eq('order_id', id).order('created_at'), 'order_notes');
  return { ...order, items, notes };
}

export async function updateOrderStatus(id: number, status: string, note: string | undefined, actor: Actor) {
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) throw new CmsError(`status 必須是 ${ORDER_STATUSES.join(' / ')}`);
  const before = must(await adminDb().from('orders').select('id,status').eq('id', id).maybeSingle(), 'orders');
  if (!before) throw new CmsError('找不到訂單', 404);
  const patch: Record<string, unknown> = { status, date_modified: nowIso() };
  if (status === 'completed') patch.date_completed = nowIso();
  const after = must(await adminDb().from('orders').update(patch).eq('id', id).select('id,status').single(), 'orders');
  const { data: nextId } = await adminDb().from('order_notes').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
  await adminDb()
    .from('order_notes')
    .insert({
      id: (nextId?.id ?? 0) + 1,
      order_id: id,
      note: `訂單狀態由 ${before.status} 變更為 ${status}。${note ? ' ' + note : ''}`,
      is_customer_note: false,
      added_by: actor.label,
      created_at: nowIso(),
    });
  await audit(actor, 'update', 'orders', id, before, after);
  return after;
}

/* ------------------------------------------------------------------ audit log */

export async function listAudit(opts: { entity?: string; actor?: string; entity_id?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = adminDb().from('audit_log').select('id,actor,actor_id,action,entity,entity_id,before,after,created_at', { count: 'exact' });
  if (opts.entity) q = q.eq('entity', opts.entity);
  if (opts.actor) q = q.ilike('actor', `%${opts.actor}%`);
  if (opts.entity_id) q = q.eq('entity_id', opts.entity_id);
  const res = await q.order('id', { ascending: false }).range(offset, offset + limit - 1);
  return { items: must(res, 'audit_log') ?? [], total: res.count ?? 0 };
}

export async function dashboardCounts() {
  const db = adminDb();
  const c = async (table: string, f?: (q: any) => any) => {
    let q = db.from(table).select('*', { count: 'exact', head: true });
    if (f) q = f(q);
    const r = await q;
    return r.count ?? 0;
  };
  const [posts, pages, drafts, scheduled, media, subsNew, redirects] = await Promise.all([
    c('posts', (q) => q.eq('post_type', 'post').eq('status', 'publish')),
    c('posts', (q) => q.eq('post_type', 'page').eq('status', 'publish')),
    c('posts', (q) => q.in('post_type', ['post', 'page']).eq('status', 'draft')),
    c('posts', (q) => q.in('post_type', ['post', 'page']).eq('status', 'future')),
    c('media'),
    c('form_submissions', (q) => q.eq('status', 'new')),
    c('redirects'),
  ]);
  return { posts, pages, drafts, scheduled, media, subsNew, redirects };
}
