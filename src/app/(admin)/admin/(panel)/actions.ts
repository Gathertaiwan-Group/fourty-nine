'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { actorOf, requireAdmin } from '@/lib/admin/auth';
import { adminDb } from '@/lib/db';
import { CmsError } from '@/lib/cms/core';
import * as posts from '@/lib/cms/posts';
import * as terms from '@/lib/cms/terms';
import * as media from '@/lib/cms/media';
import * as site from '@/lib/cms/site';

export type Result<T = unknown> = { ok: true; data: T; message?: string } | { ok: false; error: string };

async function run<T>(fn: (actor: ReturnType<typeof actorOf>) => Promise<T>, message?: string): Promise<Result<T>> {
  const admin = await requireAdmin();
  try {
    const data = await fn(actorOf(admin));
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof CmsError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: '發生錯誤：' + (e as Error).message };
  }
}

/* ---------------------------------------------------------------- posts */

export type EditorFields = posts.PostInput & { id?: number; post_type: string };

export async function savePost(fields: EditorFields): Promise<Result<{ id: number; status: string; path: string }>> {
  return run(async (actor) => {
    const { id, post_type, ...input } = fields;
    const p = id ? await posts.updatePost(id, input, actor) : await posts.createPost(post_type, input, actor);
    await clearPreview(p.id);
    revalidatePath('/admin/posts/');
    return { id: p.id, status: p.status, path: p.path };
  });
}

/** Stores unsaved editor changes for /admin/preview/<id>/ without touching the live post (WP autosave). */
export async function savePreview(fields: EditorFields): Promise<Result<{ id: number }>> {
  return run(async (actor) => {
    let id = fields.id;
    if (!id) {
      const { id: _x, post_type, ...input } = fields;
      id = (await posts.createPost(post_type, { ...input, status: 'draft' }, actor)).id;
    }
    const { error } = await adminDb()
      .from('options')
      .upsert({ option_name: `_preview_${id}`, option_value: fields, autoload: false, source: 'admin-preview' }, { onConflict: 'option_name' });
    if (error) throw new CmsError(error.message, 500);
    return { id };
  });
}

async function clearPreview(id: number) {
  await adminDb().from('options').delete().eq('option_name', `_preview_${id}`);
}

export async function trashPost(form: FormData) {
  await run((a) => posts.deletePost(Number(form.get('id')), false, a));
  revalidatePath('/admin/posts/');
}
export async function restorePost(form: FormData) {
  await run((a) => posts.restorePost(Number(form.get('id')), a));
  revalidatePath('/admin/posts/');
}
export async function deletePostForever(form: FormData) {
  const type = String(form.get('type') || 'post');
  await run((a) => posts.deletePost(Number(form.get('id')), true, a));
  revalidatePath('/admin/posts/');
  if (form.get('redirect')) redirect(`/admin/posts/?type=${type}&status=trash`);
}

/* ---------------------------------------------------------------- terms */

export async function saveTerm(_prev: unknown, form: FormData): Promise<Result> {
  const id = Number(form.get('id') || 0);
  const parent = form.get('parent_id') ? Number(form.get('parent_id')) : null;
  const input = {
    name: String(form.get('name') || ''),
    slug: String(form.get('slug') || '') || undefined,
    description: String(form.get('description') || ''),
    parent_id: parent,
  };
  const r = await run((a) => (id ? terms.updateTerm(id, input, a) : terms.createTerm({ ...input, taxonomy: String(form.get('taxonomy')) }, a)), id ? '已更新' : '已新增');
  revalidatePath('/admin/terms/');
  return r;
}
export async function deleteTerm(form: FormData) {
  await run((a) => terms.deleteTerm(Number(form.get('id')), a));
  revalidatePath('/admin/terms/');
}

/* ---------------------------------------------------------------- media */

export async function saveMedia(_prev: unknown, form: FormData): Promise<Result> {
  const r = await run(
    (a) =>
      media.updateMedia(
        Number(form.get('id')),
        { title: String(form.get('title') ?? ''), alt_text: String(form.get('alt_text') ?? ''), caption_html: String(form.get('caption_html') ?? '') },
        a,
      ),
    '已儲存',
  );
  revalidatePath('/admin/media/');
  return r;
}
export async function deleteMedia(form: FormData) {
  await run((a) => media.deleteMedia(Number(form.get('id')), a));
  revalidatePath('/admin/media/');
}

/* ---------------------------------------------------------------- menus */

export async function saveMenu(id: number, name: string, items: site.MenuItemInput[]): Promise<Result> {
  const r = await run((a) => site.saveMenu(id, items, a, name), '選單已儲存');
  revalidatePath('/admin/menus/');
  return r;
}

/* ---------------------------------------------------------------- settings */

export async function saveSettings(_prev: unknown, form: FormData): Promise<Result> {
  const g = (k: string) => String(form.get(k) ?? '').trim();
  const values: Record<string, unknown> = {
    blogname: g('blogname'),
    blogdescription: g('blogdescription'),
    contact: { phone: g('contact.phone'), email: g('contact.email'), address: g('contact.address'), line: g('contact.line') },
    tracking_ids: { gtm: g('tracking.gtm'), google_tag: g('tracking.google_tag'), ga4: g('tracking.ga4') },
  };
  if (g('site_logo.url')) values.site_logo = { url: g('site_logo.url'), media_id: Number(g('site_logo.media_id')) || null };
  if (g('site_icon.url')) values.site_icon = { url: g('site_icon.url'), media_id: Number(g('site_icon.media_id')) || null };
  const r = await run(async (a) => {
    const res = await site.updateSettings(values, a);
    return res.changed;
  }, '設定已儲存');
  revalidatePath('/admin/settings/');
  return r;
}

/* ---------------------------------------------------------------- redirects */

export async function saveRedirect(_prev: unknown, form: FormData): Promise<Result> {
  const r = await run(
    (a) =>
      site.upsertRedirect(
        {
          id: Number(form.get('id') || 0) || undefined,
          source_path: String(form.get('source_path') || ''),
          target: String(form.get('target') || ''),
          status_code: Number(form.get('status_code') || 301),
        },
        a,
      ),
    '轉址已儲存',
  );
  revalidatePath('/admin/redirects/');
  return r;
}
export async function deleteRedirect(form: FormData) {
  await run((a) => site.deleteRedirect(Number(form.get('id')), a));
  revalidatePath('/admin/redirects/');
}

/* ---------------------------------------------------------------- form submissions */

export async function setSubmissionStatus(form: FormData) {
  await run((a) => site.updateSubmissionStatus(String(form.get('id')), String(form.get('status')), a));
  revalidatePath('/admin/forms/');
}
export async function deleteSubmission(form: FormData) {
  await run((a) => site.deleteSubmission(String(form.get('id')), a));
  revalidatePath('/admin/forms/');
}
