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
  return pagedCards((q) => q.in('id', ids), page);
}

/**
 * One archive page of published posts. PostgREST answers an offset past the end with
 * PGRST103 (HTTP 416); that is "page out of range", not a server error, so we report the
 * real total with an empty page and let the route answer 404 like WordPress does.
 */
async function pagedCards(filter: (q: any) => any, page: number): Promise<{ cards: Card[]; total: number }> {
  const from = (page - 1) * PER_PAGE;
  const base = (sel: string, opts: Record<string, unknown>) =>
    filter(db().from('posts').select(sel, opts).eq('status', 'publish').eq('post_type', 'post'));
  const { data, count, error } = await base(CARD_COLS, { count: 'exact' })
    .order('date', { ascending: false })
    .range(from, from + PER_PAGE - 1);
  if (error) {
    if (error.code !== 'PGRST103') throw error;
    const { count: c, error: e2 } = await base('id', { count: 'exact', head: true });
    if (e2) throw e2;
    return { cards: [], total: c ?? 0 };
  }
  return { cards: await hydrate(data ?? []), total: count ?? 0 };
}

export async function getPostsByAuthor(authorId: number, page: number): Promise<{ cards: Card[]; total: number }> {
  return pagedCards((q) => q.eq('author_id', authorId), page);
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

const DYNAMIC_WIDGETS = /^(posts|portfolio|loop-grid|loop-carousel|archive-posts|nav-menu)\./;
/** Elementor's dynamic widgets (post lists, menus) are rendered at request time and are not part of post_content. */
export const POST_LIST_WIDGETS = /^(posts|portfolio|loop-grid|loop-carousel|archive-posts)\./;
export function stripDynamicWidgets(h: string, which: RegExp = DYNAMIC_WIDGETS): string {
  const open = /<div\b[^>]*data-widget_type="([^"]+)"[^>]*>/g;
  for (let m = open.exec(h); m; m = open.exec(h)) {
    if (!which.test(m[1])) continue;
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = h.length;
    for (let t = tag.exec(h); t; t = tag.exec(h)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    h = h.slice(0, m.index) + h.slice(end);
    open.lastIndex = m.index;
  }
  return h;
}

/** WP_Query::parse_search_terms(): split on spaces / quotes, drop stopword-like single letters, >9 terms = sentence. */
function searchTerms(q: string): string[] {
  const s = q.replace(/\s+/g, ' ').trim();
  const raw = s.match(/".*?("|$)|((?<=[\t ",+])|^)[^\t ",+]+/g) || [];
  const terms = raw
    .map((t) => t.replace(/^["' ]+|["' ]+$/g, ''))
    .filter((t) => t && !(t.length === 1 && /^[a-z-]$/i.test(t)));
  return !terms.length || terms.length > 9 ? [s] : terms;
}

/** mb_strwidth(): East Asian wide / fullwidth code points count 2, everything else 1. */
function charWidth(cp: number) {
  return (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2329 && cp <= 0x232a) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f200 && cp <= 0x1f251) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
    ? 2
    : 1;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * Generated excerpt for posts/pages without a manual one (wp_trim_excerpt on the rendered content, then Blocksy's
 * card trim). The old site's cards cut the stripped text to display width 40 with a "…" marker
 * (mb_strimwidth(text, 0, 40, '…')): e.g. 77:Blog -> 「柒柒Re:branding 關於我的執案紀錄，與行…」.
 */
export function autoExcerpt(html: string, width = 40): string {
  const text = decodeEntities(
    html
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\[\/?[a-z_-]+[^\]]*\]/gi, '') // strip_shortcodes
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[\n\r\t ]+/g, ' ')
    .trim();
  if (!text) return '';
  const chars = Array.from(text);
  const total = chars.reduce((n, c) => n + charWidth(c.codePointAt(0)!), 0);
  let out = text;
  if (total > width) {
    const limit = width - 1; // width of the "…" trim marker
    let w = 0;
    let i = 0;
    for (; i < chars.length; i++) {
      const cw = charWidth(chars[i].codePointAt(0)!);
      if (w + cw > limit) break;
      w += cw;
    }
    out = chars.slice(0, i).join('') + '…';
  }
  const esc = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${esc}</p>`;
}

/**
 * WordPress-native search (WP_Query::parse_search + parse_search_order): every term must appear (LIKE, case-insensitive)
 * in the raw post_title, post_excerpt or post_content; a leading "-" excludes. Ordering: one term -> title hits
 * first, then post_date DESC; several terms -> WP's CASE ranking, then post_date DESC.
 */
export async function search(q: string, page: number): Promise<{ cards: Card[]; total: number }> {
  const terms = searchTerms(q);
  if (!terms.length || !q.trim()) return { cards: [], total: 0 };
  const inc = terms.filter((t) => !(t.startsWith('-') && t.length > 1));
  const exc = terms.filter((t) => t.startsWith('-') && t.length > 1).map((t) => t.slice(1));
  let query = db()
    .from('posts')
    .select(CARD_COLS + ',content_raw,excerpt_raw,content_html')
    .eq('status', 'publish')
    .in('post_type', ['post', 'page']);
  for (const w of inc) {
    const p = `%${escapeLike(w)}%`;
    query = query.or(`title.ilike.${p},excerpt_raw.ilike.${p},content_raw.ilike.${p},content_html.ilike.${p}`);
  }
  const { data, error } = await query.order('date', { ascending: false }).limit(1000);
  if (error) throw error;
  const lc = (x: string | null | undefined) => (x || '').toLowerCase();
  const rows = (data ?? []).map((r: any) => ({
    r,
    t: lc(r.title),
    e: lc(r.excerpt_raw),
    c: lc(stripDynamicWidgets(r.content_raw ?? r.content_html ?? '')),
  }));
  const has = (x: { t: string; e: string; c: string }, w: string) => {
    const k = w.toLowerCase();
    return x.t.includes(k) || x.e.includes(k) || x.c.includes(k);
  };
  const hits = rows.filter((x) => inc.every((w) => has(x, w)) && !exc.some((w) => has(x, w)));
  const sentence = /(?:\s|^)-/.test(q) ? '' : q.toLowerCase();
  const rank = (x: { t: string; e: string; c: string }) => {
    if (terms.length <= 1) return x.t.includes(lc(inc[0] ?? q)) ? 0 : 1;
    if (sentence && x.t.includes(sentence)) return 1;
    const tw = inc.map((w) => x.t.includes(w.toLowerCase()));
    if (inc.length < 7) {
      if (tw.every(Boolean)) return 2;
      if (tw.some(Boolean)) return 3;
    }
    if (sentence && x.e.includes(sentence)) return 4;
    if (sentence && x.c.includes(sentence)) return 5;
    return 6;
  };
  hits.sort((a, b) => rank(a) - rank(b) || (b.r.date || '').localeCompare(a.r.date || ''));
  const total = hits.length;
  const slice = hits
    .slice((page - 1) * PER_PAGE, page * PER_PAGE)
    .map(({ r: { content_raw, excerpt_raw, content_html, ...r } }: any) =>
      (r.excerpt_html || '').trim() ? r : { ...r, excerpt_html: autoExcerpt(content_html || content_raw || '') },
    );
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
