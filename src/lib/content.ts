import 'server-only';
import { cache } from 'react';
import { db } from './db';

export type HeadEntry =
  | { type: 'link'; id?: string | null; href: string; noscript?: boolean }
  | { type: 'style'; id?: string | null; css: string };

export type Post = {
  id: number;
  post_type: string;
  slug: string;
  path: string;
  title: string;
  content_html: string;
  excerpt_html: string;
  status: string;
  author_id: number | null;
  featured_media_id: number | null;
  template: string;
  date: string | null;
  modified: string | null;
  meta: { head?: HeadEntry[]; body_class?: string; class_list?: string[]; [k: string]: unknown } | null;
  seo: Seo | null;
};

export type Seo = {
  title?: string;
  description?: string;
  canonical?: string;
  og_url?: string;
  og_type?: string;
  og_title?: string;
  og_description?: string;
  og_locale?: string;
  og_site_name?: string;
  og_image?: { url: string; width?: number; height?: number; type?: string }[];
  article_published_time?: string;
  article_modified_time?: string;
  author?: string;
  twitter_card?: string;
  twitter_misc?: Record<string, string>;
  robots?: Record<string, string>;
  schema?: unknown;
};

export type Term = {
  id: number;
  taxonomy: string;
  slug: string;
  name: string;
  description: string;
  path: string;
  count: number;
  seo: Seo | null;
};

export type Media = { id: number; url: string | null; width: number | null; height: number | null; alt_text: string; title: string };
export type Author = { id: number; slug: string; display_name: string; description: string | null };
export type MenuItem = { id: number; parent_id: number | null; position: number; title: string; url: string; object_type: string | null; object_id: number | null; target: string | null; classes: string[] };

const POST_COLS = 'id,post_type,slug,path,title,content_html,excerpt_html,status,author_id,featured_media_id,template,date,modified,meta,seo';
const CARD_COLS = 'id,post_type,slug,path,title,excerpt_html,author_id,featured_media_id,date,modified';
export const PER_PAGE = 10;

export const getSettings = cache(async (): Promise<Record<string, any>> => {
  const { data, error } = await db().from('settings').select('key,value');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
});

export const getPostByPath = cache(async (path: string): Promise<Post | null> => {
  const { data, error } = await db()
    .from('posts')
    .select(POST_COLS)
    .eq('path', path)
    .eq('status', 'publish')
    .in('post_type', ['post', 'page'])
    .maybeSingle();
  if (error) throw error;
  return data as Post | null;
});

export const getPostById = cache(async (id: number): Promise<Post | null> => {
  const { data, error } = await db().from('posts').select(POST_COLS).eq('id', id).eq('status', 'publish').maybeSingle();
  if (error) throw error;
  return data as Post | null;
});

export const getTemplate = cache(async (slug: string): Promise<{ content_html: string; data: any } | null> => {
  const { data, error } = await db().from('templates').select('content_html,data').eq('slug', slug).eq('status', 'publish').maybeSingle();
  if (error) throw error;
  return data;
});

export const getMenu = cache(async (slug: string): Promise<MenuItem[]> => {
  const { data: menu, error } = await db().from('menus').select('id').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!menu) return [];
  const { data, error: e2 } = await db()
    .from('menu_items')
    .select('id,parent_id,position,title,url,object_type,object_id,target,classes')
    .eq('menu_id', menu.id)
    .order('position');
  if (e2) throw e2;
  return (data ?? []) as MenuItem[];
});

export const getTerm = cache(async (taxonomy: string, slug: string): Promise<Term | null> => {
  const { data, error } = await db()
    .from('terms')
    .select('id,taxonomy,slug,name,description,path,count,seo')
    .eq('taxonomy', taxonomy)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data as Term | null;
});

export const getAllTerms = cache(async (): Promise<Term[]> => {
  const { data, error } = await db().from('terms').select('id,taxonomy,slug,name,description,path,count,seo');
  if (error) throw error;
  return (data ?? []) as Term[];
});

export const getAuthors = cache(async (): Promise<Author[]> => {
  const { data, error } = await db().from('authors').select('id,slug,display_name,description');
  if (error) throw error;
  return (data ?? []) as Author[];
});

export type Card = Omit<Post, 'content_html' | 'meta' | 'seo' | 'status' | 'template'> & {
  media?: Media | null;
  author?: Author | null;
  terms: Term[];
};

async function postTermsFor(ids: number[]): Promise<Map<number, Term[]>> {
  const map = new Map<number, Term[]>();
  if (!ids.length) return map;
  const [{ data, error }, terms] = await Promise.all([
    db().from('post_terms').select('post_id,term_id,term_order').in('post_id', ids).order('term_order'),
    getAllTerms(),
  ]);
  if (error) throw error;
  const byId = new Map(terms.map((t) => [t.id, t]));
  for (const r of data ?? []) {
    const t = byId.get(r.term_id);
    if (!t) continue;
    if (!map.has(r.post_id)) map.set(r.post_id, []);
    map.get(r.post_id)!.push(t);
  }
  return map;
}

export async function getMedia(ids: number[]): Promise<Map<number, Media>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data, error } = await db().from('media').select('id,url,width,height,alt_text,title').in('id', uniq);
  if (error) throw error;
  return new Map((data ?? []).map((m) => [m.id, m as Media]));
}

async function hydrate(rows: any[]): Promise<Card[]> {
  const [media, terms, authors] = await Promise.all([
    getMedia(rows.map((r) => r.featured_media_id)),
    postTermsFor(rows.map((r) => r.id)),
    getAuthors(),
  ]);
  const aById = new Map(authors.map((a) => [a.id, a]));
  return rows.map((r) => ({
    ...r,
    media: r.featured_media_id ? media.get(r.featured_media_id) ?? null : null,
    author: r.author_id ? aById.get(r.author_id) ?? null : null,
    terms: terms.get(r.id) ?? [],
  }));
}

export async function getTermsForPost(id: number): Promise<Term[]> {
  return (await postTermsFor([id])).get(id) ?? [];
}

export async function getPostsByTerm(termId: number, page: number): Promise<{ cards: Card[]; total: number }> {
  const { data: links, error } = await db().from('post_terms').select('post_id').eq('term_id', termId);
  if (error) throw error;
  const ids = (links ?? []).map((l) => l.post_id);
  if (!ids.length) return { cards: [], total: 0 };
  const from = (page - 1) * PER_PAGE;
  const { data, count, error: e2 } = await db()
    .from('posts')
    .select(CARD_COLS, { count: 'exact' })
    .in('id', ids)
    .eq('status', 'publish')
    .eq('post_type', 'post')
    .order('date', { ascending: false })
    .range(from, from + PER_PAGE - 1);
  if (e2) throw e2;
  return { cards: await hydrate(data ?? []), total: count ?? 0 };
}

export async function getPostsByAuthor(authorId: number, page: number): Promise<{ cards: Card[]; total: number }> {
  const from = (page - 1) * PER_PAGE;
  const { data, count, error } = await db()
    .from('posts')
    .select(CARD_COLS, { count: 'exact' })
    .eq('author_id', authorId)
    .eq('status', 'publish')
    .eq('post_type', 'post')
    .order('date', { ascending: false })
    .range(from, from + PER_PAGE - 1);
  if (error) throw error;
  return { cards: await hydrate(data ?? []), total: count ?? 0 };
}

/** Blocksy "related posts": same category, newest first, max 6, current post excluded. */
export async function getRelated(post: Post): Promise<Card[]> {
  const terms = (await getTermsForPost(post.id)).filter((t) => t.taxonomy === 'category');
  if (!terms.length) return [];
  const { data: links, error } = await db().from('post_terms').select('post_id').in('term_id', terms.map((t) => t.id));
  if (error) throw error;
  const ids = [...new Set((links ?? []).map((l) => l.post_id))].filter((i) => i !== post.id);
  if (!ids.length) return [];
  const { data, error: e2 } = await db()
    .from('posts')
    .select(CARD_COLS)
    .in('id', ids)
    .eq('status', 'publish')
    .eq('post_type', 'post')
    .order('date', { ascending: false })
    .limit(6);
  if (e2) throw e2;
  return hydrate(data ?? []);
}

function escapeLike(s: string) {
  return s.replace(/[\\%_,()]/g, (c) => '\\' + c);
}

/** WordPress-like search: every word must appear in title, excerpt or content. Title hits rank first. */
export async function search(q: string, page: number): Promise<{ cards: Card[]; total: number }> {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return { cards: [], total: 0 };
  let query = db()
    .from('posts')
    .select(CARD_COLS + ',content_html')
    .eq('status', 'publish')
    .in('post_type', ['post', 'page']);
  for (const w of words) {
    const p = `%${escapeLike(w)}%`;
    query = query.or(`title.ilike.${p},excerpt_html.ilike.${p},content_html.ilike.${p}`);
  }
  const { data, error } = await query.order('date', { ascending: false }).limit(500);
  if (error) throw error;
  const strip = (h: string) => h.replace(/<[^>]+>/g, ' ');
  const rows = (data ?? []).filter((r: any) =>
    words.every((w) => [r.title, strip(r.excerpt_html || ''), strip(r.content_html || '')].some((f) => f.toLowerCase().includes(w.toLowerCase()))),
  );
  const titleHit = (r: any) => words.every((w) => r.title.toLowerCase().includes(w.toLowerCase()));
  rows.sort((a: any, b: any) => Number(titleHit(b)) - Number(titleHit(a)) || (b.date || '').localeCompare(a.date || ''));
  const total = rows.length;
  const slice = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(({ content_html, ...r }: any) => r);
  return { cards: await hydrate(slice), total };
}

export async function getPublished(types: string[]) {
  const { data, error } = await db()
    .from('posts')
    .select('id,post_type,path,title,excerpt_html,date,modified,featured_media_id,author_id')
    .eq('status', 'publish')
    .in('post_type', types)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getRedirect(path: string): Promise<{ target: string; status_code: number } | null> {
  const { data, error } = await db().from('redirects').select('target,status_code').eq('source_path', path).maybeSingle();
  if (error) throw error;
  return data;
}
