import { db, siteUrl } from '@/lib/db';
import { getAuthors, getPostByPath, getSettings, getTerm } from '@/lib/content';
import { encodePath } from '@/lib/render';

/**
 * WordPress per-object RSS feeds. The proxy rewrites <path>/feed/ here (internal URL /wp-feed/<path>/):
 *   /comments/feed/            site-wide comments feed
 *   /category/<slug>/feed/     category posts feed (posts_per_rss = 10, full content)
 *   /tag/<slug>/feed/          tag posts feed
 *   /<post-or-page>/feed/      that entry's comments feed
 * The old site has no comments (export comments.json = 0), so comment feeds are valid empty channels, as WP serves them.
 */
export const revalidate = 600;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const rfc = (d: string | number | null | undefined) => new Date(d || Date.now()).toUTCString().replace('GMT', '+0000');
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const NS_COMMENTS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:atom="http://www.w3.org/2005/Atom"
	xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"

	>`;
const NS_POSTS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:wfw="http://wellformedweb.org/CommentAPI/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:atom="http://www.w3.org/2005/Atom"
	xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"
	xmlns:slash="http://purl.org/rss/1.0/modules/slash/"
	>`;

const rss = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=UTF-8', 'x-robots-tag': 'noindex, follow' } });

function commentsFeed(title: string, self: string, link: string, description: string, lastBuild: string | null) {
  return rss(`${NS_COMMENTS}
<channel>
	<title>
	${esc(title)}	</title>
	<atom:link href="${self}" rel="self" type="application/rss+xml" />
	<link>${link}</link>
	<description>${esc(description)}</description>
	<lastBuildDate>${rfc(lastBuild)}</lastBuildDate>
	<sy:updatePeriod>
	hourly	</sy:updatePeriod>
	<sy:updateFrequency>
	1	</sy:updateFrequency>

</channel>
</rss>
`);
}

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const segs = (await ctx.params).path.map(dec).filter(Boolean);
  const base = siteUrl();
  const s = await getSettings();
  const blogname: string = s.blogname || '';
  const blogdesc: string = s.blogdescription || '';
  const notFound = () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=UTF-8' } });
  if (!segs.length) return notFound();

  // site-wide comments feed
  if (segs.length === 1 && segs[0] === 'comments') {
    const { data } = await db().from('posts').select('modified').eq('status', 'publish').in('post_type', ['post', 'page']).order('modified', { ascending: false }).limit(1);
    return commentsFeed(`《${blogname}》的留言`, `${base}/comments/feed/`, `${base}/`, blogdesc, data?.[0]?.modified ?? null);
  }

  // category / tag feeds
  if ((segs[0] === 'category' || segs[0] === 'tag') && segs.length >= 2) {
    const term = await getTerm(segs[0] === 'category' ? 'category' : 'post_tag', segs[segs.length - 1]);
    if (!term) return notFound();
    const { data: links, error } = await db().from('post_terms').select('post_id').eq('term_id', term.id);
    if (error) throw error;
    const ids = (links ?? []).map((l) => l.post_id);
    const rows: any[] = ids.length
      ? ((
          await db()
            .from('posts')
            .select('id,path,title,content_html,excerpt_html,author_id,date,modified')
            .eq('status', 'publish')
            .eq('post_type', 'post')
            .in('id', ids)
            .order('date', { ascending: false })
            .limit(10)
        ).data ?? [])
      : [];
    const authors = await getAuthors();
    // category names per item (WP prints every category/tag of the post)
    const itemTerms = new Map<number, string[]>();
    if (rows.length) {
      const { data: pt } = await db().from('post_terms').select('post_id,term_id').in('post_id', rows.map((r) => r.id));
      const tids = [...new Set((pt ?? []).map((x) => x.term_id))];
      const { data: ts } = tids.length ? await db().from('terms').select('id,name').in('id', tids) : { data: [] as any[] };
      const nameById = new Map((ts ?? []).map((t: any) => [t.id, t.name as string]));
      for (const x of pt ?? []) {
        const n = nameById.get(x.term_id);
        if (n) itemTerms.set(x.post_id, [...(itemTerms.get(x.post_id) ?? []), n]);
      }
    }
    const termLink = base + encodePath(term.path);
    const title = `${term.name} 彙整 | ${blogname}`;
    const lastBuild = rows.reduce<string | null>((m, r) => (!m || (r.modified || '') > m ? r.modified : m), null);
    const items = rows
      .map((r) => {
        const link = base + encodePath(r.path);
        const footer = `<p>這篇文章 <a href="${link}">${esc(r.title)}</a> 最早出現於 <a href="${base}">${esc(blogname)}</a>。</p>\n`;
        const cats = (itemTerms.get(r.id) ?? []).map((n) => `\t\t<category>${cdata(n)}</category>`).join('\n');
        return `	<item>
		<title>${esc(r.title)}</title>
		<link>${link}</link>

		<dc:creator>${cdata(authors.find((a) => a.id === r.author_id)?.display_name || '')}</dc:creator>
		<pubDate>${rfc(r.date)}</pubDate>
${cats}
		<guid isPermaLink="false">${base}/?p=${r.id}</guid>

					<description>${cdata((r.excerpt_html || '').trim() + '\n' + footer)}</description>
										<content:encoded>${cdata((r.content_html || '') + '\n' + footer)}</content:encoded>
			</item>`;
      })
      .join('\n');
    return rss(`${NS_POSTS}

<channel>
	<title>${esc(title)}</title>
	<atom:link href="${termLink}feed/" rel="self" type="application/rss+xml" />
	<link>${termLink}</link>
	<description>${esc(blogdesc)}</description>
	<lastBuildDate>${rfc(lastBuild)}</lastBuildDate>
	<language>zh-TW</language>
	<sy:updatePeriod>
	hourly	</sy:updatePeriod>
	<sy:updateFrequency>
	1	</sy:updateFrequency>

${items}
</channel>
</rss>
`);
  }

  // single post / page -> its (empty) comments feed
  const post = await getPostByPath('/' + segs.join('/') + '/');
  if (!post) return notFound();
  const link = base + encodePath(post.path);
  return commentsFeed(`〈${post.title}〉的留言`, `${link}feed/`, link, blogdesc, post.modified ?? null);
}
