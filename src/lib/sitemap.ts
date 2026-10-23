import 'server-only';
import { getAllTerms, getAuthors, getMedia, getPublished } from './content';
import { siteUrl } from './db';
import { encodePath } from './render';

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const loc = (p: string) => xmlEsc(siteUrl() + encodePath(p));
const XSL = '';

export function xml(body: string) {
  return new Response(body, { headers: { 'content-type': 'text/xml; charset=UTF-8', 'x-robots-tag': 'noindex, follow', 'cache-control': 'public, max-age=0, s-maxage=3600' } });
}

async function lastmod(types: string[]) {
  const rows = await getPublished(types);
  return rows.reduce((m, r) => ((r.modified || '') > m ? r.modified : m), '');
}

export async function sitemapIndex() {
  const [p, pg] = await Promise.all([lastmod(['post']), lastmod(['page'])]);
  const items = [
    ['/post-sitemap.xml', p],
    ['/page-sitemap.xml', pg],
    ['/category-sitemap.xml', p],
    ['/author-sitemap.xml', p],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>${XSL}\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items
    .map(([u, m]) => `\t<sitemap>\n\t\t<loc>${loc(u)}</loc>\n${m ? `\t\t<lastmod>${new Date(m).toISOString().replace(/\.\d{3}Z$/, '+00:00')}</lastmod>\n` : ''}\t</sitemap>`)
    .join('\n')}\n</sitemapindex>`;
}

function urlset(entries: { path: string; mod?: string | null; images?: string[] }[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>${XSL}\n<urlset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd http://www.google.com/schemas/sitemap-image/1.1 http://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(
      (e) =>
        `\t<url>\n\t\t<loc>${loc(e.path)}</loc>\n${e.mod ? `\t\t<lastmod>${new Date(e.mod).toISOString().replace(/\.\d{3}Z$/, '+00:00')}</lastmod>\n` : ''}${(e.images || [])
          .map((i) => `\t\t<image:image>\n\t\t\t<image:loc>${xmlEsc(i)}</image:loc>\n\t\t</image:image>\n`)
          .join('')}\t</url>`,
    )
    .join('\n')}\n</urlset>`;
}

export async function typeSitemap(type: 'post' | 'page') {
  const rows = await getPublished([type]);
  const media = await getMedia(rows.map((r) => r.featured_media_id));
  rows.sort((a, b) => (type === 'page' && a.path === '/' ? -1 : type === 'page' && b.path === '/' ? 1 : (a.modified || '').localeCompare(b.modified || '')));
  return urlset(rows.map((r) => ({ path: r.path, mod: r.modified, images: r.featured_media_id && media.get(r.featured_media_id)?.url ? [media.get(r.featured_media_id)!.url!] : [] })));
}

export async function categorySitemap() {
  const terms = (await getAllTerms()).filter((t) => t.taxonomy === 'category' && t.count > 0);
  return urlset(terms.map((t) => ({ path: t.path })));
}

export async function authorSitemap() {
  const authors = await getAuthors();
  return urlset(authors.map((a) => ({ path: `/author/${a.slug}/` })));
}
