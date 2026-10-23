import type { Metadata } from 'next';
import type { Seo } from './content';
import { siteUrl } from './db';

export const SITE_NAME = '四拾九天數位整合行銷';
export const RSS = { 'application/rss+xml': [{ url: '/feed/', title: `訂閱《${SITE_NAME}》» 資訊提供` }] };

export function abs(u: string | undefined | null): string | undefined {
  if (!u) return undefined;
  if (/^https?:\/\//.test(u)) return u;
  if (u.startsWith('/')) {
    const m = u.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/)!;
    return siteUrl() + m[1] + (m[2] || '') + (m[3] || '');
  }
  return u;
}

/** Make every root-relative URL inside the Yoast schema graph absolute again. */
export function absolutizeSchema(v: unknown): unknown {
  if (typeof v === 'string') return v.startsWith('/') && !v.startsWith('//') ? abs(v) : v;
  if (Array.isArray(v)) return v.map(absolutizeSchema);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, absolutizeSchema(x)]));
  return v;
}

function robots(seo: Seo | null | undefined, noindex = false): Metadata['robots'] {
  if (noindex) return { index: false, follow: true };
  const r = seo?.robots || {};
  return {
    index: r.index !== 'noindex',
    follow: r.follow !== 'nofollow',
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  };
}

export function seoMetadata(seo: Seo | null | undefined, opts: { path: string; fallbackTitle: string; ogType?: 'website' | 'article'; noindex?: boolean; author?: string }): Metadata {
  const title = seo?.title || `${opts.fallbackTitle} | ${SITE_NAME}`;
  const url = abs(seo?.canonical || seo?.og_url || opts.path)!;
  const mime = (u: string, t?: string) => {
    const ext = u.split('?')[0].split('.').pop()?.toLowerCase();
    return ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : /jpe?g/.test(ext || '') ? 'image/jpeg' : t;
  };
  const images = (seo?.og_image || []).map((i) => ({ url: abs(i.url)!, width: i.width, height: i.height, type: mime(i.url, i.type) }));
  const other: Record<string, string> = {};
  const misc = seo?.twitter_misc || {};
  Object.entries(misc).forEach(([k, v], i) => {
    other[`twitter:label${i + 1}`] = k;
    other[`twitter:data${i + 1}`] = v;
  });
  const ogType = opts.ogType || (opts.path === '/' ? 'website' : (seo?.og_type as 'article' | 'website') || 'article');
  return {
    title: { absolute: title },
    description: seo?.description || seo?.og_description,
    alternates: { ...(opts.noindex ? {} : { canonical: url }), types: RSS },
    robots: robots(seo, opts.noindex),
    authors: opts.author ? [{ name: opts.author }] : undefined,
    openGraph: {
      locale: seo?.og_locale || 'zh_TW',
      type: ogType,
      title: seo?.og_title || title,
      description: seo?.og_description || seo?.description,
      url,
      siteName: seo?.og_site_name || SITE_NAME,
      images,
      ...(ogType === 'article' && seo?.article_published_time ? { publishedTime: seo.article_published_time } : {}),
      ...(ogType === 'article' && seo?.article_modified_time ? { modifiedTime: seo.article_modified_time } : {}),
    },
    twitter: { card: (seo?.twitter_card as 'summary_large_image') || 'summary_large_image' },
    other,
  };
}
