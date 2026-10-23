import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import postHead from '@/theme/head-post.json';
import { Shell } from '@/components/Shell';
import { Archive, ElementorPage, Pagination, SinglePost } from '@/components/Blocksy';
import type { HeadEntry } from '@/lib/content';
import { getAuthors, POST_LIST_WIDGETS, stripDynamicWidgets } from '@/lib/content';
import { resolvePath, type Resolved } from '@/lib/resolve';
import { absolutizeSchema, seoMetadata, SITE_NAME } from '@/lib/seo';

export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ path?: string[] }> };

function pathOf(r: Resolved, segs: string[]) {
  return '/' + segs.map((s) => decodeURIComponent(s)).join('/') + (segs.length ? '/' : '');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const segs = (await params).path ?? [];
  const r = await resolvePath(segs);
  const path = pathOf(r, segs);
  switch (r.kind) {
    case 'page':
    case 'single': {
      const authors = await getAuthors();
      const author = r.kind === 'single' ? authors.find((a) => a.id === r.post.author_id)?.display_name : undefined;
      return seoMetadata(r.post.seo, { path: r.post.path, fallbackTitle: r.post.title, author });
    }
    case 'term': {
      const base = r.term.path;
      const m = seoMetadata(r.term.seo, { path: base, fallbackTitle: `${r.term.name} 彙整` });
      if (r.page > 1) {
        m.title = { absolute: `${r.term.name} 彙整 - 第 ${r.page} 頁，共 ${r.pages} 頁 | ${SITE_NAME}` };
        m.alternates = { ...m.alternates, canonical: `${base}page/${r.page}/` };
      }
      return m;
    }
    case 'author':
      return seoMetadata(null, { path: `/author/${r.author.slug}/`, fallbackTitle: `${r.author.display_name}, 作者 ${SITE_NAME}`, noindex: true });
    case 'search':
      return {
        ...seoMetadata(null, { path, fallbackTitle: `您正在找 ${r.q}`, noindex: true }),
        title: { absolute: r.page > 1 ? `您正在找 ${r.q} | 第 ${r.page} 頁，總計 ${r.pages} 頁 | ${SITE_NAME}` : `您正在找 ${r.q} | ${SITE_NAME}` },
      };
    default:
      return { title: { absolute: `找不到頁面 | ${SITE_NAME}` }, robots: { index: false, follow: true } };
  }
}

function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;
  return <script type="application/ld+json" className="yoast-schema-graph" dangerouslySetInnerHTML={{ __html: JSON.stringify(absolutizeSchema(data)).replace(/</g, '\\u003c') }} />;
}

export default async function WpRoute({ params }: Props) {
  const segs = (await params).path ?? [];
  const r = await resolvePath(segs);
  const path = pathOf(r, segs);

  if (r.kind === 'redirect') permanentRedirect(r.to);
  if (r.kind === 'notfound') notFound();

  if (r.kind === 'page') {
    const n = r.paged;
    const p = n ? { ...r.post, content_html: stripDynamicWidgets(r.post.content_html, POST_LIST_WIDGETS) } : r.post;
    const isFront = p.path === '/';
    let bodyClass =
      p.meta?.body_class ||
      `${isFront ? 'home ' : ''}wp-singular page-template page-template-elementor_header_footer page page-id-${p.id} elementor-template-full-width elementor-page elementor-page-${p.id}`;
    if (n) bodyClass = bodyClass.replace('wp-singular', 'paged wp-singular').replace('wp-embed-responsive', `wp-embed-responsive paged-${n} page-paged-${n}`);
    return (
      <Shell path={p.path} bodyClass={bodyClass} prefix="single_page" head={p.meta?.head} itemType="https://schema.org/WebPage">
        <JsonLd data={p.seo?.schema} />
        <ElementorPage post={p} />
      </Shell>
    );
  }

  if (r.kind === 'single') {
    const p = r.post;
    const bodyClass =
      p.meta?.body_class ||
      `wp-singular post-template-default single single-post postid-${p.id} single-format-standard ct-elementor-default-template`;
    return (
      <Shell path={p.path} bodyClass={bodyClass} prefix="single_blog_post" head={[...(postHead as HeadEntry[]), ...(p.meta?.head || [])]} itemType="https://schema.org/Blog">
        <JsonLd data={p.seo?.schema} />
        <SinglePost post={p} related={r.related} catIds={r.catIds} />
      </Shell>
    );
  }

  if (r.kind === 'term') {
    const t = r.term;
    const isCat = t.taxonomy === 'category';
    const slugClass = /^[a-z0-9-]+$/.test(t.slug) ? t.slug : encodeURIComponent(t.slug).toLowerCase();
    const bodyClass = `archive ${isCat ? 'category' : 'tag'} ${isCat ? 'category' : 'tag'}-${slugClass} ${isCat ? 'category' : 'tag'}-${t.id} ct-elementor-default-template`;
    return (
      <Shell path={path} bodyClass={bodyClass} prefix="categories">
        <JsonLd data={t.seo?.schema} />
        <Archive
          title={
            <>
              <span className="ct-title-label">{isCat ? '分類' : '標籤'}</span> {t.name}
            </>
          }
          description={t.description || undefined}
          cards={r.cards}
          pagination={<Pagination page={r.page} pages={r.pages} href={(n) => (n === 1 ? t.path : `${t.path}page/${n}/`)} />}
        />
      </Shell>
    );
  }

  if (r.kind === 'author') {
    const a = r.author;
    const base = `/author/${a.slug}/`;
    return (
      <Shell path={path} bodyClass={`archive author author-${a.slug} author-${a.id} ct-elementor-default-template`} prefix="author">
        <Archive
          title={
            <>
              <span className="ct-title-label">作者</span> {a.display_name}
            </>
          }
          cards={r.cards}
          pagination={<Pagination page={r.page} pages={r.pages} href={(n) => (n === 1 ? base : `${base}page/${n}/`)} />}
        />
      </Shell>
    );
  }

  // search
  const q = r.q;
  const sHref = (n: number) => (n === 1 ? `/?s=${encodeURIComponent(q)}` : `/page/${n}/?s=${encodeURIComponent(q)}`);
  return (
    <Shell path={path} bodyClass={`search ${r.total ? 'search-results' : 'search-no-results'} ct-elementor-default-template`} prefix="search">
      <Archive title={`「${q}」的搜尋結果`} cards={r.cards} pagination={<Pagination page={r.page} pages={r.pages} href={sHref} />} />
    </Shell>
  );
}
