import 'server-only';
import { cache } from 'react';
import {
  getAuthors,
  getPostByPath,
  getPostsByAuthor,
  getPostsByTerm,
  getRedirect,
  getRelated,
  getSettings,
  getPostById,
  getTerm,
  getTermsForPost,
  search,
  PER_PAGE,
  type Author,
  type Card,
  type Post,
  type Term,
} from './content';

export type Resolved =
  | { kind: 'page'; post: Post }
  | { kind: 'single'; post: Post; related: Card[]; catIds: number[] }
  | { kind: 'term'; term: Term; page: number; pages: number; cards: Card[] }
  | { kind: 'author'; author: Author; page: number; pages: number; cards: Card[] }
  | { kind: 'search'; q: string; page: number; pages: number; total: number; cards: Card[] }
  | { kind: 'redirect'; to: string; status: number }
  | { kind: 'notfound' };

function dec(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function splitPage(segs: string[]): { base: string[]; page: number } | null {
  const n = segs.length;
  if (n >= 2 && segs[n - 2] === 'page' && /^\d+$/.test(segs[n - 1])) {
    const page = Number(segs[n - 1]);
    return page >= 1 ? { base: segs.slice(0, n - 2), page } : null;
  }
  return { base: segs, page: 1 };
}

export const resolvePath = cache(async (rawSegs: string[]): Promise<Resolved> => {
  const segs = rawSegs.map(dec);
  const sp = splitPage(segs);
  if (!sp) return { kind: 'notfound' };
  const { base, page } = sp;

  // front page
  if (base.length === 0 && page === 1) {
    const s = await getSettings();
    const post = s.page_on_front ? await getPostById(Number(s.page_on_front)) : await getPostByPath('/');
    return post ? { kind: 'page', post } : { kind: 'notfound' };
  }

  // search: /?s=q is rewritten to /search/q/ by the proxy (same as WP's own /search/q/ rewrite)
  if (base[0] === 'search' && base.length === 2) {
    const q = base[1];
    const { cards, total } = await search(q, page);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    if (page > pages) return { kind: 'notfound' };
    return { kind: 'search', q, page, pages, total, cards };
  }

  // taxonomy archives (empty archives still answer 200, as on the old site)
  if ((base[0] === 'category' || base[0] === 'tag') && base.length >= 2) {
    const term = await getTerm(base[0] === 'category' ? 'category' : 'post_tag', base[base.length - 1]);
    if (term) {
      const { cards, total } = await getPostsByTerm(term.id, page);
      const pages = Math.max(1, Math.ceil(total / PER_PAGE));
      if (page > pages) return { kind: 'notfound' };
      return { kind: 'term', term, page, pages, cards };
    }
  }

  if (base[0] === 'author' && base.length === 2) {
    const author = (await getAuthors()).find((a) => a.slug === base[1]);
    if (author) {
      const { cards, total } = await getPostsByAuthor(author.id, page);
      const pages = Math.max(1, Math.ceil(total / PER_PAGE));
      if (page > pages) return { kind: 'notfound' };
      return { kind: 'author', author, page, pages, cards };
    }
  }

  if (page === 1 && base.length) {
    const path = '/' + base.join('/') + '/';
    const post = await getPostByPath(path);
    if (post) {
      if (post.post_type === 'page') return { kind: 'page', post };
      const [related, terms] = await Promise.all([getRelated(post), getTermsForPost(post.id)]);
      return { kind: 'single', post, related, catIds: terms.filter((t) => t.taxonomy === 'category').map((t) => t.id) };
    }
    const r = await getRedirect(path);
    if (r) return { kind: 'redirect', to: r.target, status: r.status_code };
  }
  return { kind: 'notfound' };
});
