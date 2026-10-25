import type { ReactNode } from 'react';
import { getMenu, getSettings, getTemplate, type HeadEntry } from '@/lib/content';
import { applyBranding, deferScripts, fillHeader } from '@/lib/render';
import { HeadStyles } from './HeadStyles';
import { WpRuntime } from './WpRuntime';
import { responsiveHtml } from '@/lib/images';

type Chaty = {
  enabled: boolean;
  position: 'right' | 'left';
  side_spacing: number;
  bottom_spacing: number;
  size: number;
  channels: { channel: string; url: string; hover_text: string; svg_icon: string }[];
};

function ChatyButton({ chaty }: { chaty?: Chaty }) {
  if (!chaty?.enabled || !chaty.channels?.length) return null;
  const style = {
    [chaty.position === 'left' ? 'left' : 'right']: `${chaty.side_spacing}px`,
    bottom: `${chaty.bottom_spacing}px`,
    ['--fd-chaty-size' as string]: `${chaty.size}px`,
  } as React.CSSProperties;
  return (
    <div className="fd-chaty" data-position={chaty.position} style={style}>
      {chaty.channels.map((c) => (
        <a key={c.channel} className="fd-chaty-channel" href={c.url} target="_blank" rel="noopener nofollow" aria-label={c.hover_text} data-hover={c.hover_text}>
          <span className="fd-chaty-icon" dangerouslySetInnerHTML={{ __html: c.svg_icon }} />
        </a>
      ))}
    </div>
  );
}

export async function Shell({
  path,
  bodyClass,
  prefix,
  head,
  itemType,
  children,
}: {
  path: string;
  bodyClass: string;
  prefix: string;
  head?: HeadEntry[];
  itemType?: string;
  children: ReactNode;
}) {
  const [header, footer, menu, settings] = await Promise.all([getTemplate('header'), getTemplate('footer'), getMenu('header'), getSettings()]);
  // header images (logo) are first-screen: keep them eager; footer images lazy
  const [headerHtml, footerHtml] = await Promise.all([
    responsiveHtml(deferScripts(applyBranding(fillHeader(header?.content_html || '', menu, path), settings)), { eager: 99 }),
    responsiveHtml(deferScripts(applyBranding(footer?.content_html || '', settings))),
  ]);
  return (
    <div
      id="wp-body"
      className={bodyClass}
      data-link="type-2"
      data-prefix={prefix}
      data-footer="type-1"
      {...(itemType ? { itemScope: true, itemType } : {})}
    >
      {head?.length ? <HeadStyles entries={head} /> : null}
      <a className="skip-link screen-reader-text" href="#main">
        跳至主要內容
      </a>
      <div id="main-container">
        <div className="fd-contents" dangerouslySetInnerHTML={{ __html: headerHtml }} />
        {children}
        <div className="fd-contents" dangerouslySetInnerHTML={{ __html: footerHtml }} />
      </div>
      <ChatyButton chaty={settings.chaty} />
      <WpRuntime />
    </div>
  );
}
