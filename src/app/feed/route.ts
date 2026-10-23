import { getAuthors, getMedia, getPublished, getSettings } from '@/lib/content';
import { siteUrl } from '@/lib/db';
import { encodePath } from '@/lib/render';

export const revalidate = 600;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

export async function GET() {
  const [s, rows, authors] = await Promise.all([getSettings(), getPublished(['post']), getAuthors()]);
  const items = rows.slice(0, 10);
  const media = await getMedia(items.map((r) => r.featured_media_id));
  const base = siteUrl();
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:atom="http://www.w3.org/2005/Atom"
	xmlns:sy="http://purl.org/rss/1.0/modules/syndication/">
<channel>
	<title>${esc(s.blogname || '')}</title>
	<atom:link href="${base}/feed/" rel="self" type="application/rss+xml" />
	<link>${base}</link>
	<description>${esc(s.blogdescription || '')}</description>
	<lastBuildDate>${new Date(rows[0]?.modified || Date.now()).toUTCString().replace('GMT', '+0000')}</lastBuildDate>
	<language>zh-TW</language>
	<sy:updatePeriod>hourly</sy:updatePeriod>
	<sy:updateFrequency>1</sy:updateFrequency>
${items
  .map((r) => {
    const link = base + encodePath(r.path);
    const img = r.featured_media_id ? media.get(r.featured_media_id)?.url : null;
    return `	<item>
		<title>${esc(r.title)}</title>
		<link>${link}</link>
		<dc:creator>${cdata(authors.find((a) => a.id === r.author_id)?.display_name || '')}</dc:creator>
		<pubDate>${new Date(r.date || Date.now()).toUTCString().replace('GMT', '+0000')}</pubDate>
		<guid isPermaLink="false">${base}/?p=${r.id}</guid>
		<description>${cdata((r.excerpt_html || '').replace(/<[^>]+>/g, '').trim())}</description>${img ? `\n		<enclosure url="${esc(img)}" length="0" type="image/webp" />` : ''}
	</item>`;
  })
  .join('\n')}
</channel>
</rss>`;
  return new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=UTF-8' } });
}
