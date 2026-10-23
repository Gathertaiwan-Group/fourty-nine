import type { Metadata } from 'next';
import { Shell } from '@/components/Shell';
import { getTemplate } from '@/lib/content';
import { SITE_NAME } from '@/lib/seo';

export const metadata: Metadata = {
  title: { absolute: `找不到頁面 | ${SITE_NAME}` },
  robots: { index: false, follow: true },
};

export default async function NotFound() {
  const tpl = await getTemplate('error-404');
  const css = (tpl?.data?.css as string | undefined) || '';
  return (
    <Shell path="" bodyClass="error404 elementor-page-11705 ct-elementor-default-template" prefix="" head={css ? [{ type: 'style', id: 'elementor-post-11705-css', css }] : []}>
      <main id="main" className="site-main hfeed" dangerouslySetInnerHTML={{ __html: tpl?.content_html || '<h1>404</h1>' }} />
    </Shell>
  );
}
