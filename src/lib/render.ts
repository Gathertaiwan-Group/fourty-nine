import type { MenuItem } from './content';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function samePath(a: string, b: string) {
  const n = (p: string) => {
    try {
      p = decodeURI(p);
    } catch {}
    return p.replace(/\/+$/, '') || '/';
  };
  return n(a) === n(b);
}

/** Re-creates the Elementor Pro nav-menu markup (after SmartMenus init) from site_fortynine.menu_items. */
export function renderMenu(items: MenuItem[], current: string, variant: 'main' | 'dropdown'): string {
  const children = (pid: number | null) => items.filter((i) => i.parent_id === pid).sort((a, b) => a.position - b.position);
  const isCurrent = (i: MenuItem) => samePath(i.url, current);
  const hasCurrentDesc = (i: MenuItem): boolean => children(i.id).some((c) => isCurrent(c) || hasCurrentDesc(c));
  const tab = variant === 'dropdown' ? ' tabindex="-1"' : '';

  const li = (i: MenuItem, depth: number): string => {
    const kids = children(i.id);
    const cur = isCurrent(i);
    const anc = hasCurrentDesc(i);
    const type = i.object_type === 'custom' || !i.object_type ? 'custom' : i.object_type === 'category' || i.object_type === 'post_tag' ? 'taxonomy' : 'post_type';
    const cls = [
      'menu-item',
      `menu-item-type-${type}`,
      `menu-item-object-${i.object_type || 'custom'}`,
      i.url === '/' ? 'menu-item-home' : '',
      cur ? 'current-menu-item' : '',
      cur && type === 'post_type' ? `page_item page-item-${i.object_id} current_page_item` : '',
      anc ? 'current-menu-ancestor current-menu-parent' : '',
      anc && type === 'post_type' ? 'current_page_parent current_page_ancestor' : '',
      kids.length ? 'menu-item-has-children' : '',
      ...i.classes.filter((c) => c !== 'menu-item-has-children'),
      `menu-item-${i.id}`,
    ]
      .filter(Boolean)
      .join(' ');
    const aCls = [depth === 0 ? 'elementor-item' : 'elementor-sub-item', cur || (depth === 0 && anc) ? (depth === 0 ? 'elementor-item-active' : 'elementor-sub-item elementor-item-active') : '', kids.length ? 'has-submenu' : '']
      .join(' ')
      .split(' ')
      .filter((v, idx, arr) => v && arr.indexOf(v) === idx)
      .join(' ');
    const target = i.target ? ` target="${esc(i.target)}"` : '';
    const arrow = kids.length ? '<span class="sub-arrow"><i class="fas fa-caret-down"></i></span>' : '';
    const aria = cur ? ' aria-current="page"' : '';
    const sub = kids.length
      ? `\n<ul class="sub-menu elementor-nav-menu--dropdown">\n${kids.map((k) => '\t' + li(k, depth + 1)).join('\n')}\n</ul>\n`
      : '';
    return `<li class="${cls}"><a href="${esc(i.url)}"${aria}${target} class="${aCls}"${tab}>${esc(i.title)}${arrow}</a>${sub}</li>`;
  };

  const id = variant === 'main' ? 'menu-1-edae281' : 'menu-2-edae281';
  const extra = variant === 'dropdown' ? ' sm-vertical' : '';
  return `<ul id="${id}" class="elementor-nav-menu${extra}">${children(null).map((i) => li(i, 0)).join('\n')}\n</ul>`;
}

export function fillHeader(html: string, items: MenuItem[], current: string) {
  return html
    .replace('{{menu:primary:main}}', renderMenu(items, current, 'main'))
    .replace('{{menu:primary:dropdown}}', renderMenu(items, current, 'dropdown'));
}

/** WordPress shows dates in the site timezone (Asia/Taipei) as Y-m-d. */
export function wpDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p;
}

/** ISO 8601 with +08:00 offset, like WordPress' get_the_date('c'). */
export function wpDateIso(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

export function encodePath(path: string) {
  return path
    .split('/')
    .map((s) => (s ? encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()) : s))
    .join('/');
}

/**
 * Inline <script> tags inside stored HTML (Elementor "HTML" widgets) would run during HTML parsing,
 * before the jQuery they expect exists. Park them; WpRuntime executes them after loading jQuery.
 */
export function deferScripts(html: string): string {
  return html.replace(/<script\b([^>]*)>/gi, (m, attrs: string) => {
    const t = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (t && t !== 'text/javascript' && t !== 'module') return m;
    return `<script type="text/fd-deferred"${attrs.replace(/\btype\s*=\s*["']?[^"'\s>]+["']?/i, '')}>`;
  });
}

/** Original logo attachment and footer LINE link baked into the Elementor header/footer templates. */
const LOGO_MEDIA_ID = 13700;
const DEFAULT_LINE = 'https://lin.ee/IGRmr2r';

/** Applies admin "網站設定" (site logo, LINE contact link) to the header/footer template HTML. */
export function applyBranding(html: string, s: Record<string, any>): string {
  const logo = s.site_logo?.url as string | undefined;
  if (logo) {
    const re = new RegExp(`<img\\b[^>]*\\bwp-image-${LOGO_MEDIA_ID}\\b[^>]*>`, 'g');
    html = html.replace(re, (tag) =>
      tag
        .replace(/\ssrc="[^"]*"/, ` src="${esc(logo)}"`)
        .replace(/\ssrcset="[^"]*"/, '')
        .replace(/\ssizes="[^"]*"/, ''),
    );
  }
  const line = s.contact?.line as string | undefined;
  if (line && line !== DEFAULT_LINE && /^https?:\/\//.test(line)) html = html.split(DEFAULT_LINE).join(esc(line));
  return html;
}
