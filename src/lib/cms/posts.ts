import 'server-only';
import { adminDb } from '@/lib/db';
import { audit, CmsError, must, nowIso, revalidateSite, slugify, wpSlug, type Actor } from './core';

export const EDITABLE_TYPES = ['post', 'page'] as const;
export type PostType = (typeof EDITABLE_TYPES)[number];
export const STATUSES = ['publish', 'draft', 'pending', 'private', 'future', 'trash'] as const;
export type PostStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  publish: '已發布',
  draft: '草稿',
  pending: '待審',
  private: '私密',
  future: '已排程',
  trash: '回收桶',
};

export type PostInput = {
  title?: string;
  slug?: string;
  content_html?: string;
  excerpt_html?: string;
  status?: PostStatus;
  date?: string | null; // ISO; required in the future for status 'future'
  author_id?: number | null;
  featured_media_id?: number | null;
  parent_id?: number | null;
  menu_order?: number;
  comment_status?: 'open' | 'closed';
  sticky?: boolean;
  template?: string;
  seo_title?: string | null;
  seo_description?: string | null;
  category_ids?: number[];
  tag_ids?: number[];
};

export type PostRow = {
  id: number;
  post_type: string;
  slug: string;
  wp_slug: string;
  path: string;
  title: string;
  content_html: string;
  excerpt_html: string;
  status: string;
  author_id: number | null;
  featured_media_id: number | null;
  parent_id: number | null;
  menu_order: number;
  comment_status: string;
  sticky: boolean;
  template: string;
  date: string | null;
  modified: string | null;
  meta: Record<string, unknown>;
  seo: Record<string, unknown> | null;
};

const LIST_COLS = 'id,post_type,slug,path,title,status,author_id,featured_media_id,date,modified';

function assertType(t: string): asserts t is PostType {
  if (!(EDITABLE_TYPES as readonly string[]).includes(t)) throw new CmsError(`post_type 必須是 ${EDITABLE_TYPES.join(' / ')}`);
}

export async function listPosts(opts: {
  post_type?: string;
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const type = opts.post_type || 'post';
  assertType(type);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = adminDb().from('posts').select(LIST_COLS, { count: 'exact' }).eq('post_type', type);
  if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
  else q = q.neq('status', 'trash');
  if (opts.q) q = q.ilike('title', `%${opts.q.replace(/[%_]/g, (m) => '\\' + m)}%`);
  const res = await q.order('date', { ascending: false, nullsFirst: true }).range(offset, offset + limit - 1);
  return { items: must(res, 'posts') ?? [], total: res.count ?? 0 };
}

export async function statusCounts(type: string) {
  assertType(type);
  const res = await adminDb().from('posts').select('status').eq('post_type', type);
  const rows = must(res, 'posts') ?? [];
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.status] = (out[r.status] ?? 0) + 1;
    if (r.status !== 'trash') out.all++;
  }
  return out;
}

export async function getPost(id: number) {
  const post = must(await adminDb().from('posts').select('*').eq('id', id).maybeSingle(), 'posts') as PostRow | null;
  if (!post) return null;
  const links = must(await adminDb().from('post_terms').select('term_id,terms(id,taxonomy,name,slug)').eq('post_id', id), 'post_terms') ?? [];
  const terms = links.map((l: any) => l.terms).filter(Boolean) as { id: number; taxonomy: string; name: string; slug: string }[];
  return {
    ...post,
    category_ids: terms.filter((t) => t.taxonomy === 'category').map((t) => t.id),
    tag_ids: terms.filter((t) => t.taxonomy === 'post_tag').map((t) => t.id),
    terms,
  };
}

export async function getPostByPathAdmin(path: string) {
  const row = must(await adminDb().from('posts').select('id').eq('path', path).in('post_type', [...EDITABLE_TYPES]).limit(1).maybeSingle(), 'posts');
  return row ? getPost(row.id) : null;
}

async function uniqueSlug(type: string, base: string, selfId?: number) {
  for (let i = 1; i < 200; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const res = await adminDb().from('posts').select('id,post_type,path').or(`slug.eq.${JSON.stringify(slug)},path.eq.${JSON.stringify('/' + slug + '/')}`);
    const clash = (must(res, 'posts') ?? []).filter((r) => r.id !== selfId && (r.post_type === type || ['post', 'page'].includes(r.post_type)));
    if (!clash.length) return slug;
  }
  throw new CmsError('無法產生唯一的網址代稱');
}

async function computePath(type: PostType, slug: string, parentId: number | null | undefined) {
  if (type === 'page' && parentId) {
    const parent = must(await adminDb().from('posts').select('path').eq('id', parentId).maybeSingle(), 'posts');
    if (!parent) throw new CmsError('找不到上層頁面');
    return `${parent.path.replace(/\/?$/, '/')}${slug}/`;
  }
  return `/${slug}/`;
}

function normalizeStatus(status: PostStatus | undefined, date: string | null | undefined): { status: PostStatus; date: string | null } {
  const s = status ?? 'draft';
  if (!(STATUSES as readonly string[]).includes(s)) throw new CmsError(`status 必須是 ${STATUSES.join(' / ')}`);
  let d = date ? new Date(date) : null;
  if (d && isNaN(d.getTime())) throw new CmsError('日期格式錯誤');
  if (s === 'future') {
    if (!d) throw new CmsError('排程發布需要指定日期時間');
    if (d.getTime() <= Date.now()) throw new CmsError('排程時間必須在未來（要立即發布請用 status=publish）');
  }
  if (s === 'publish' && d && d.getTime() > Date.now() + 60_000) return { status: 'future', date: d.toISOString() };
  if ((s === 'publish' || s === 'private') && !d) d = new Date();
  return { status: s, date: d ? d.toISOString() : null };
}

function seoPatch(prev: Record<string, unknown> | null, title?: string | null, description?: string | null) {
  if (title === undefined && description === undefined) return undefined;
  const seo = { ...(prev ?? {}) } as Record<string, unknown>;
  if (title !== undefined) {
    if (title) {
      seo.title = title;
      seo.og_title = title;
    } else {
      delete seo.title;
      delete seo.og_title;
    }
  }
  if (description !== undefined) {
    if (description) {
      seo.description = description;
      seo.og_description = description;
    } else {
      delete seo.description;
      delete seo.og_description;
    }
  }
  return Object.keys(seo).length ? seo : null;
}

async function setTerms(postId: number, categoryIds?: number[], tagIds?: number[]) {
  const db = adminDb();
  for (const [taxonomy, ids] of [
    ['category', categoryIds],
    ['post_tag', tagIds],
  ] as const) {
    if (!ids) continue;
    const existing = must(await db.from('post_terms').select('term_id,terms!inner(taxonomy)').eq('post_id', postId).eq('terms.taxonomy', taxonomy), 'post_terms') ?? [];
    const old = existing.map((e: any) => e.term_id as number);
    const del = old.filter((id) => !ids.includes(id));
    if (del.length) must(await db.from('post_terms').delete().eq('post_id', postId).in('term_id', del), 'post_terms');
    const valid = ids.length ? (must(await db.from('terms').select('id').eq('taxonomy', taxonomy).in('id', ids), 'terms') ?? []).map((t) => t.id) : [];
    const missing = ids.filter((id) => !valid.includes(id));
    if (missing.length) throw new CmsError(`${taxonomy} 不存在：${missing.join(', ')}`);
    const add = ids.filter((id) => !old.includes(id)).map((term_id, i) => ({ post_id: postId, term_id, term_order: i }));
    if (add.length) must(await db.from('post_terms').insert(add), 'post_terms');
  }
}

async function defaultAuthor(): Promise<number | null> {
  const r = must(await adminDb().from('posts').select('author_id').eq('post_type', 'post').not('author_id', 'is', null).order('date', { ascending: false }).limit(1).maybeSingle(), 'posts');
  return r?.author_id ?? null;
}

export async function createPost(type: string, input: PostInput, actor: Actor) {
  assertType(type);
  const title = (input.title ?? '').trim();
  const { status, date } = normalizeStatus(input.status, input.date);
  const slug = await uniqueSlug(type, slugify(input.slug?.trim() || title || 'untitled'));
  const path = await computePath(type, slug, input.parent_id);
  const now = nowIso();
  const row = {
    post_type: type,
    slug,
    wp_slug: wpSlug(slug),
    path,
    title,
    content_html: input.content_html ?? '',
    excerpt_html: input.excerpt_html ?? '',
    status,
    author_id: input.author_id === undefined ? await defaultAuthor() : input.author_id,
    featured_media_id: input.featured_media_id ?? null,
    parent_id: type === 'page' ? (input.parent_id ?? null) : null,
    menu_order: input.menu_order ?? 0,
    comment_status: input.comment_status ?? 'closed',
    sticky: input.sticky ?? false,
    template: input.template ?? '',
    date: date ?? now,
    date_gmt: date ?? now,
    modified: now,
    modified_gmt: now,
    meta: { created_via: actor.label === 'mcp' ? 'mcp' : 'admin' },
    seo: seoPatch(null, input.seo_title, input.seo_description) ?? null,
  };
  const created = must(await adminDb().from('posts').insert(row).select('*').single(), 'posts') as PostRow;
  if (type === 'post') await setTerms(created.id, input.category_ids, input.tag_ids);
  await audit(actor, 'create', 'posts', created.id, null, { ...created, content_html: undefined, content_length: created.content_html.length, category_ids: input.category_ids, tag_ids: input.tag_ids });
  if (type === 'post') await adminDb().rpc('recount_terms');
  if (status === 'publish') revalidateSite();
  return (await getPost(created.id))!;
}

export async function updatePost(id: number, input: PostInput, actor: Actor) {
  const before = await getPost(id);
  if (!before) throw new CmsError('找不到文章', 404);
  const type = before.post_type;
  assertType(type);
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.content_html !== undefined) patch.content_html = input.content_html;
  if (input.excerpt_html !== undefined) patch.excerpt_html = input.excerpt_html;
  if (input.author_id !== undefined) patch.author_id = input.author_id;
  if (input.featured_media_id !== undefined) patch.featured_media_id = input.featured_media_id;
  if (input.menu_order !== undefined) patch.menu_order = input.menu_order;
  if (input.comment_status !== undefined) patch.comment_status = input.comment_status;
  if (input.sticky !== undefined) patch.sticky = input.sticky;
  if (input.template !== undefined) patch.template = input.template;
  if (input.status !== undefined || input.date !== undefined) {
    const goingLive = input.status === 'publish' && !['publish', 'future', 'private'].includes(before.status);
    if (input.status === 'future' && input.date === undefined && before.status !== 'future') throw new CmsError('排程發布需要指定 date（未來的時間）');
    const dateIn = input.date === undefined ? (goingLive ? null : before.date) : input.date;
    const ns = normalizeStatus(input.status ?? (before.status as PostStatus), dateIn);
    patch.status = ns.status;
    if (ns.date) {
      patch.date = ns.date;
      patch.date_gmt = ns.date;
    }
    if (ns.status === 'trash' && before.status !== 'trash') patch.meta = { ...before.meta, _wp_trash_meta_status: before.status, _wp_trash_meta_time: nowIso() };
  }
  const seo = seoPatch(before.seo, input.seo_title, input.seo_description);
  if (seo !== undefined) patch.seo = seo;

  // slug / parent change => new path; keep the old public URL working with a 301 like WP's _wp_old_slug
  // An empty slug field means "automatic" (same as MCP create_post): keep the current slug, except a
  // placeholder slug ("untitled", from a draft saved before it had a title) which WordPress would still
  // derive from the title as long as the post has never been published.
  const slugIn = input.slug?.trim();
  const titleNow = (input.title ?? before.title ?? '').trim();
  const placeholder = /^untitled(-\d+)?$/.test(before.slug) && before.status !== 'publish';
  const wantSlug = slugIn ? slugify(slugIn) : placeholder && titleNow ? slugify(titleNow) : undefined;
  const slugChanged = wantSlug !== undefined && wantSlug !== 'untitled' && wantSlug !== before.slug;
  const parentChanged = type === 'page' && input.parent_id !== undefined && input.parent_id !== before.parent_id;
  if (parentChanged && input.parent_id === id) throw new CmsError('上層頁面不可為自己');
  if (slugChanged || parentChanged) {
    const slug = slugChanged ? await uniqueSlug(type, wantSlug!, id) : before.slug;
    patch.slug = slug;
    patch.wp_slug = wpSlug(slug);
    if (parentChanged) patch.parent_id = input.parent_id;
    patch.path = await computePath(type, slug, parentChanged ? input.parent_id : before.parent_id);
  }
  patch.modified = nowIso();
  patch.modified_gmt = patch.modified;

  const after = must(await adminDb().from('posts').update(patch).eq('id', id).select('*').single(), 'posts') as PostRow;
  if (patch.path && patch.path !== before.path && before.status === 'publish') {
    await adminDb().from('redirects').upsert({ source_path: before.path, target: after.path, status_code: 301, kind: 'legacy' }, { onConflict: 'source_path' });
    // child pages keep their own stored path; fix them up
    if (type === 'page') await rewriteChildPaths(id, after.path);
  }
  if (type === 'post') await setTerms(id, input.category_ids, input.tag_ids);
  const diff: Record<string, unknown> = {};
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    if (k === 'modified' || k === 'modified_gmt') continue;
    const b = (before as any)[k];
    const a = (after as any)[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (k === 'content_html') {
      prev.content_length = String(b ?? '').length;
      diff.content_length = String(a ?? '').length;
      prev.content_html = String(b ?? '').slice(0, 20000);
      continue;
    }
    prev[k] = b;
    diff[k] = a;
  }
  if (input.category_ids) (prev.category_ids = before.category_ids), (diff.category_ids = input.category_ids);
  if (input.tag_ids) (prev.tag_ids = before.tag_ids), (diff.tag_ids = input.tag_ids);
  await audit(actor, 'update', 'posts', id, prev, diff);
  if (type === 'post') await adminDb().rpc('recount_terms');
  if (before.status === 'publish' || after.status === 'publish') revalidateSite();
  return (await getPost(id))!;
}

async function rewriteChildPaths(parentId: number, parentPath: string) {
  const kids = must(await adminDb().from('posts').select('id,slug').eq('parent_id', parentId).eq('post_type', 'page'), 'posts') ?? [];
  for (const k of kids) {
    const p = `${parentPath}${k.slug}/`;
    await adminDb().from('posts').update({ path: p }).eq('id', k.id);
    await rewriteChildPaths(k.id, p);
  }
}

/** Default: move to trash (recoverable). force=true deletes the row permanently. */
export async function deletePost(id: number, force: boolean, actor: Actor) {
  const before = await getPost(id);
  if (!before) throw new CmsError('找不到文章', 404);
  assertType(before.post_type);
  if (!force) {
    if (before.status === 'trash') return { id, status: 'trash', deleted: false };
    await updatePost(id, { status: 'trash' }, actor);
    return { id, status: 'trash', deleted: false };
  }
  must(await adminDb().from('posts').delete().eq('id', id), 'posts');
  await audit(actor, 'delete', 'posts', id, { ...before, content_html: before.content_html.slice(0, 20000) }, null);
  if (before.post_type === 'post') await adminDb().rpc('recount_terms');
  if (before.status === 'publish') revalidateSite();
  return { id, deleted: true };
}

export async function restorePost(id: number, actor: Actor) {
  const before = await getPost(id);
  if (!before) throw new CmsError('找不到文章', 404);
  const prev = (before.meta?._wp_trash_meta_status as PostStatus | undefined) || 'draft';
  const meta = { ...before.meta };
  delete meta._wp_trash_meta_status;
  delete meta._wp_trash_meta_time;
  await adminDb().from('posts').update({ meta }).eq('id', id);
  return updatePost(id, { status: prev === 'publish' ? 'draft' : prev }, actor);
}

/** Flip scheduled posts whose time has come. Safe to call often. */
export async function publishDue(actor: Actor = { label: 'scheduler' }) {
  const res = await adminDb().rpc('publish_due');
  const rows = (must(res, 'publish_due') ?? []) as { id: number; title: string; path: string }[];
  for (const r of rows) await audit(actor, 'publish', 'posts', r.id, { status: 'future' }, { status: 'publish', path: r.path });
  if (rows.length) {
    await adminDb().rpc('recount_terms');
    revalidateSite();
  }
  return rows;
}

export async function listAuthors() {
  return (must(await adminDb().from('authors').select('id,display_name,slug').order('id'), 'authors') ?? []) as { id: number; display_name: string; slug: string }[];
}

export async function listPagesForParent() {
  return (must(await adminDb().from('posts').select('id,title,path').eq('post_type', 'page').neq('status', 'trash').order('path'), 'posts') ?? []) as {
    id: number;
    title: string;
    path: string;
  }[];
}
