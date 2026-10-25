import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { getTemplate } from '@/lib/content';
import { responsiveHtml } from '@/lib/images';
import { deferScripts } from '@/lib/render';

/** The Elementor "error-404" template (11705) inside the Blocksy shell — same markup as the old site's 404. */
export async function NotFoundPage() {
  const tpl = await getTemplate('error-404');
  const css = (tpl?.data?.css as string | undefined) || '';
  const body = await responsiveHtml(deferScripts(tpl?.content_html || '<h1>404</h1>'));
  return (
    <Shell path="" bodyClass="error404 elementor-page-11705 ct-elementor-default-template" prefix="" head={css ? [{ type: 'style', id: 'elementor-post-11705-css', css }] : []}>
      <main id="main" className="site-main hfeed" dangerouslySetInnerHTML={{ __html: body }} />
    </Shell>
  );
}

async function Signal404(): Promise<null> {
  notFound();
}

/**
 * Next 16 renders `notFound()` thrown from a page as an empty `__next_error__` HTML shell and paints the
 * not-found UI only on the client, so crawlers and HTML checks saw a 404 without any content.
 * Render the 404 page in the server HTML and raise notFound() from a Suspense child instead: the response
 * still gets HTTP 404 (ISR waits for the whole tree), and on the client the not-found boundary swaps in
 * not-found.tsx, which renders the same NotFoundPage.
 */
export function InlineNotFound() {
  return (
    <>
      <NotFoundPage />
      <Suspense fallback={null}>
        <Signal404 />
      </Suspense>
    </>
  );
}
