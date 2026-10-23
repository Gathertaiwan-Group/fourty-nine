import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import headEntries from '@/theme/head.json';
import { HeadStyles } from '@/components/HeadStyles';
import type { HeadEntry } from '@/lib/content';
import { getSettings } from '@/lib/content';
import { siteUrl } from '@/lib/db';
import '../globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const icon = s.site_icon?.url as string | undefined;
  return {
    metadataBase: new URL(siteUrl()),
    applicationName: s.blogname,
    icons: icon ? { icon: [{ url: icon, sizes: '32x32' }, { url: icon, sizes: '192x192' }], apple: icon } : undefined,
    alternates: { types: { 'application/rss+xml': [{ url: '/feed/', title: `訂閱《${s.blogname}》» 資訊提供` }] } },
    other: { 'msapplication-TileImage': icon || '' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const s = await getSettings();
  const t = (s.tracking_ids || {}) as { gtm?: string; google_tag?: string };
  return (
    <html lang="zh-TW" dir="ltr" data-scroll-behavior="smooth">
      <head>
        <link rel="profile" href="https://gmpg.org/xfn/11" />
        <link rel="preconnect" href="https://fonts.gstatic.com/" crossOrigin="" />
        <HeadStyles entries={headEntries as HeadEntry[]} />
        {t.google_tag ? (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${t.google_tag}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("set","linker",{"domains":["fortynine-days.com"]});gtag("js",new Date());gtag("set","developer_id.dZTNiMT",true);gtag("config","${t.google_tag}");`,
              }}
            />
          </>
        ) : null}
        {t.gtm ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${t.gtm}');`,
            }}
          />
        ) : null}
      </head>
      <body className="wp-custom-logo wp-embed-responsive wp-theme-blocksy elementor-default elementor-kit-11694">
        {t.gtm ? (
          <noscript>
            <iframe src={`https://www.googletagmanager.com/ns.html?id=${t.gtm}`} height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} />
          </noscript>
        ) : null}
        {children}
      </body>
    </html>
  );
}
