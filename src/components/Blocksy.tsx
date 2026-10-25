import { Fragment, type ReactNode } from 'react';
import type { Card, Post } from '@/lib/content';
import { deferScripts, wpDate, wpDateIso } from '@/lib/render';
import { responsiveHtml, sizesFor, srcsetOf } from '@/lib/images';
import type { Media } from '@/lib/content';

const html = (s: string) => ({ __html: s });

/** srcset/sizes props for a featured image (variants recorded in media.variants). */
function respProps(m: Media, displayWidth: number) {
  const set = m.url ? srcsetOf({ url: m.url, width: m.width, height: m.height, variants: m.variants ?? [] }) : null;
  return set ? { srcSet: set, sizes: sizesFor(displayWidth, true) } : {};
}

function CardMeta1({ card }: { card: Card }) {
  const cats = card.terms.filter((t) => t.taxonomy === 'category');
  if (!cats.length) return null;
  return (
    <ul className="entry-meta" data-type="simple:slash" data-id="meta_1">
      <li className="meta-categories" data-type="simple">
        {cats.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 ? ', ' : null}
            <a href={t.path} rel="tag" className={`ct-term-${t.id}`}>
              {t.name}
            </a>
          </Fragment>
        ))}
      </li>
    </ul>
  );
}

export function EntryCard({ card }: { card: Card }) {
  const cls = [
    'entry-card',
    'card-content',
    `post-${card.id}`,
    card.post_type,
    `type-${card.post_type}`,
    'status-publish',
    'format-standard',
    card.featured_media_id ? 'has-post-thumbnail' : '',
    'hentry',
    ...card.terms.filter((t) => t.taxonomy === 'category').map((t) => `category-${/^[a-z0-9-]+$/.test(t.slug) ? t.slug : t.id}`),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <article className={cls}>
      <CardMeta1 card={card} />
      <h2 className="entry-title">
        <a href={card.path} rel="bookmark">
          {card.title}
        </a>
      </h2>
      {card.media?.url ? (
        <a className="ct-media-container boundless-image" href={card.path} aria-label={card.title}>
          <img
            loading="lazy"
            width={card.media.width ?? undefined}
            height={card.media.height ?? undefined}
            src={card.media.url}
            {...respProps(card.media, 768)}
            className="attachment-medium_large size-medium_large wp-post-image"
            alt={card.media.alt_text || ''}
            decoding="async"
            itemProp="image"
            style={{ aspectRatio: '4/3' }}
          />
        </a>
      ) : null}
      {card.excerpt_html ? <div className="entry-excerpt" dangerouslySetInnerHTML={html(card.excerpt_html)} /> : null}
      <ul className="entry-meta" data-type="simple:slash" data-id="meta_2">
        {card.author ? (
          <li className="meta-author" itemProp="author" itemScope itemType="https://schema.org/Person">
            <a className="ct-meta-element-author" href={`/author/${card.author.slug}/`} title={`作者 ${card.author.display_name}`} rel="author" itemProp="url">
              <span itemProp="name">{card.author.display_name}</span>
            </a>
          </li>
        ) : null}
        <li className="meta-date" itemProp="datePublished">
          <time className="ct-meta-element-date" dateTime={wpDateIso(card.date)}>
            {wpDate(card.date)}
          </time>
        </li>
      </ul>
    </article>
  );
}

const ARROW = 'M4.1,15c0.2,0,0.4-0.1,0.6-0.2L11.4,8c0.3-0.3,0.3-0.8,0-1.1L4.8,0.2C4.5-0.1,4-0.1,3.7,0.2C3.4,0.5,3.4,1,3.7,1.3l6.1,6.1l-6.2,6.2c-0.3,0.3-0.3,0.8,0,1.1C3.7,14.9,3.9,15,4.1,15z';

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (n: number) => string }) {
  if (pages < 2) return null;
  const nums: (number | '…')[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) nums.push(n);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <nav className="ct-pagination" data-pagination="simple">
      {page > 1 ? (
        <a className="prev page-numbers" rel="prev" href={href(page - 1)}>
          <svg width="9px" height="9px" viewBox="0 0 15 15" fill="currentColor" style={{ transform: 'rotate(180deg)' }}>
            <path d={ARROW} />
          </svg>{' '}
          上一頁
        </a>
      ) : null}
      <div className="ct-hidden-sm">
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`d${i}`} className="page-numbers dots">
              …
            </span>
          ) : n === page ? (
            <span key={n} aria-current="page" className="page-numbers current">
              {n}
            </span>
          ) : (
            <a key={n} className="page-numbers" href={href(n)}>
              {n}
            </a>
          ),
        )}
      </div>
      {page < pages ? (
        <a className="next page-numbers" rel="next" href={href(page + 1)}>
          下一頁{' '}
          <svg width="9px" height="9px" viewBox="0 0 15 15" fill="currentColor">
            <path d={ARROW} />
          </svg>
        </a>
      ) : null}
    </nav>
  );
}

export function Archive({ title, description, cards, pagination }: { title: ReactNode; description?: string; cards: Card[]; pagination?: ReactNode }) {
  return (
    <main id="main" className="site-main hfeed" itemScope itemType="https://schema.org/CreativeWork">
      <div className="ct-container" data-vertical-spacing="top:bottom">
        <section>
          <div className="hero-section is-width-constrained" data-type="type-1">
            <header className="entry-header">
              <h1 className="page-title" itemProp="headline">
                {title}
              </h1>
              {description ? <div className="page-description ct-hidden-sm" dangerouslySetInnerHTML={html(description)} /> : null}
            </header>
          </div>
          {cards.length ? (
            <div className="entries" data-archive="default" data-layout="grid" data-cards="boxed">
              {cards.map((c) => (
                <EntryCard key={c.id} card={c} />
              ))}
            </div>
          ) : (
            <div className="entry-content is-layout-constrained">
              <p>找不到符合條件的內容。</p>
            </div>
          )}
          {pagination}
        </section>
      </div>
    </main>
  );
}

export async function SinglePost({ post, related, catIds }: { post: Post; related: Card[]; catIds: number[] }) {
  const body = await responsiveHtml(deferScripts(post.content_html), { eager: 1 });
  const cls = [`post-${post.id}`, 'post', 'type-post', 'status-publish', 'format-standard', post.featured_media_id ? 'has-post-thumbnail' : '', 'hentry', ...catIds.map((i) => `category-${i}`)]
    .filter(Boolean)
    .join(' ');
  return (
    <main id="main" className="site-main hfeed" itemScope itemType="https://schema.org/CreativeWork">
      <div className="ct-container-full" data-content="normal" data-vertical-spacing="top:bottom">
        <article id={`post-${post.id}`} className={cls}>
          <div className="hero-section is-width-constrained" data-type="type-1">
            <header className="entry-header">
              <h1 className="page-title" itemProp="headline">
                {post.title}
              </h1>
              {post.excerpt_html ? <div className="page-description ct-hidden-sm" dangerouslySetInnerHTML={html(post.excerpt_html)} /> : null}
            </header>
          </div>
          <div className="entry-content is-layout-constrained" dangerouslySetInnerHTML={html(body)} />
        </article>
      </div>
      {related.length ? (
        <div className="ct-related-posts-container">
          <div className="ct-container">
            <div className="ct-related-posts">
              <h3 className="ct-module-title">更多案例</h3>
              <div className="ct-related-posts-items" data-layout="grid">
                {related.map((r) => (
                  <article key={r.id} itemScope itemType="https://schema.org/CreativeWork">
                    <div id={`post-${r.id}`} className={`post-${r.id} post type-post status-publish format-standard has-post-thumbnail hentry`}>
                      {r.media?.url ? (
                        <a className="ct-media-container" href={r.path} aria-label={r.title}>
                          <img
                            loading="lazy"
                            width={r.media.width ?? undefined}
                            height={r.media.height ?? undefined}
                            src={r.media.url}
                            {...respProps(r.media, 768)}
                            className="attachment-medium_large size-medium_large wp-post-image"
                            alt={r.media.alt_text || ''}
                            decoding="async"
                            itemProp="image"
                            style={{ aspectRatio: '1/1' }}
                          />
                        </a>
                      ) : null}
                      <h4 className="related-entry-title">
                        <a href={r.path} rel="bookmark">
                          {r.title}
                        </a>
                      </h4>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export async function ElementorPage({ post }: { post: Post }) {
  const body = await responsiveHtml(deferScripts(post.content_html), { eager: 1 });
  return <main id="main" className="site-main hfeed" dangerouslySetInnerHTML={html(body)} />;
}
