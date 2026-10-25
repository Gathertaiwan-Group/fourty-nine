import 'server-only';
import { db } from './db';

/**
 * Responsive images. Every converted image has WebP variants (480/960/1440 wide, never upscaled) at
 * site-fortynine/v/<w>/<storage path> recorded in media.variants. Stored HTML (Elementor content, header/footer
 * templates, head CSS) still points at the 2000px original, so it is rewritten here at render time:
 * <img> gets srcset/sizes/width/height/loading/decoding, CSS backgrounds get the ≤1440 variant and gallery
 * thumbnails get a data-srcset that WpRuntime resolves against the tile size.
 */

export type Variant = { w: number; h: number; url: string };
export type ImgInfo = { url: string; width: number | null; height: number | null; variants: Variant[] };

const MARK = '/storage/v1/object/public/site-fortynine/';
const URL_RE = /https?:\/\/[a-z0-9.-]+\/storage\/v1\/object\/public\/site-fortynine\/(uploads\/[^"'()\s>?#]+\.(?:webp|png|jpe?g|gif))/gi;

function storagePath(url: string): string | null {
  const i = url.indexOf(MARK);
  if (i < 0) return null;
  const p = url.slice(i + MARK.length).split(/[?#]/)[0];
  if (!p.startsWith('uploads/')) return null;
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** One cached query per distinct set of images (Next data cache, tag "wp", revalidated with the page). */
export async function getImageInfo(urls: Iterable<string>): Promise<Map<string, ImgInfo>> {
  const paths = [...new Set([...urls].map(storagePath).filter((p): p is string => !!p))].sort();
  const out = new Map<string, ImgInfo>();
  for (let i = 0; i < paths.length; i += 60) {
    const chunk = paths.slice(i, i + 60);
    const { data, error } = await db().from('media').select('storage_path,url,width,height,variants').in('storage_path', chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const variants = (Array.isArray(r.variants) ? r.variants : [])
        .filter((v: any) => v?.url && v?.w)
        .map((v: any) => ({ w: v.w, h: v.h, url: v.url }))
        .sort((a: Variant, b: Variant) => a.w - b.w);
      out.set(r.storage_path, { url: r.url, width: r.width, height: r.height, variants });
    }
  }
  return out;
}

export function infoFor(map: Map<string, ImgInfo>, url: string | null | undefined) {
  if (!url) return undefined;
  const p = storagePath(url);
  return p ? map.get(p) : undefined;
}

/** srcset with every variant plus the original (its own width), or null when there is nothing to choose from. */
export function srcsetOf(info: ImgInfo | undefined): string | null {
  if (!info?.variants.length) return null;
  const list = info.variants.map((v) => `${v.url} ${v.w}w`);
  if (info.width && info.width > info.variants[info.variants.length - 1].w) list.push(`${info.url} ${info.width}w`);
  return list.join(', ');
}

/** Largest variant no wider than `max` (CSS backgrounds cannot use srcset). */
export function bestUnder(info: ImgInfo | undefined, max = 1440): string | null {
  if (!info?.variants.length) return null;
  if (info.width && info.width <= max) return null; // original is already small enough
  const fit = info.variants.filter((v) => v.w <= max);
  return fit.length ? fit[fit.length - 1].url : null;
}

export function sizesFor(displayWidth: number | null | undefined, lazy: boolean) {
  const w = displayWidth && displayWidth > 0 ? displayWidth : null;
  const fallback = w ? `(max-width: ${w}px) 100vw, ${w}px` : '100vw';
  // sizes="auto" (lazy images only) lets the browser use the laid-out width; others fall back to the hint.
  return lazy ? `auto, ${fallback}` : fallback;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}
function dropAttr(tag: string, name: string) {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'gi'), '');
}
function addAttrs(tag: string, attrs: string) {
  return attrs ? tag.replace(/^<img\b/i, `<img${attrs}`) : tag;
}
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export type RewriteOpts = {
  /** how many leading <img> stay eager (first-screen hero); the rest get loading="lazy" */
  eager?: number;
};

function rewriteImgs(html: string, map: Map<string, ImgInfo>, opts: RewriteOpts) {
  let eagerLeft = opts.eager ?? 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, 'src');
    if (!src || src.startsWith('data:')) return tag;
    const info = infoFor(map, src);
    const eager = eagerLeft > 0;
    if (eager) eagerLeft--;
    let t = tag;
    let add = '';
    if (info) {
      const set = srcsetOf(info);
      const attrW = Number(attr(tag, 'width')) || null;
      const forced = attr(t, 'data-fd-sizes');
      if (forced !== null) t = dropAttr(t, 'data-fd-sizes');
      if (set) {
        t = dropAttr(dropAttr(t, 'srcset'), 'sizes');
        add += ` srcset="${escAttr(set)}" sizes="${forced || sizesFor(attrW ?? info.width, !eager)}"`;
      }
      if (!attr(t, 'width') && !attr(t, 'height') && info.width && info.height) add += ` width="${info.width}" height="${info.height}"`;
    }
    if (eager) {
      t = dropAttr(t, 'loading');
    } else if (!attr(t, 'loading')) add += ' loading="lazy"';
    if (!attr(t, 'decoding')) add += ' decoding="async"';
    return addAttrs(t, add);
  });
}

function rewriteBackgrounds(text: string, map: Map<string, ImgInfo>) {
  return text.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q: string, u: string) => {
    const best = bestUnder(infoFor(map, u.replace(/&quot;|&#039;/g, '')));
    return best ? `url(${q}${best}${q})` : m;
  });
}

/**
 * Elementor image carousels: before Swiper initialises every slide is full width, so sizes="auto" would pick the
 * 1440 variant. Derive sizes from slides_to_show (desktop/tablet/mobile) instead, marked via data-fd-sizes.
 */
function markCarousels(html: string) {
  const re = /<div\b[^>]*\sdata-widget_type="([^"]+)"[^>]*>/gi;
  const hits = [...html.matchAll(re)];
  if (!hits.some((h) => h[1].startsWith('image-carousel'))) return html;
  let out = '';
  let last = 0;
  hits.forEach((h, i) => {
    const start = h.index!;
    const end = i + 1 < hits.length ? hits[i + 1].index! : html.length;
    out += html.slice(last, start);
    let seg = html.slice(start, end);
    if (h[1].startsWith('image-carousel')) {
      let st: Record<string, any> = {};
      try {
        st = JSON.parse((attr(h[0], 'data-settings') || '{}').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      } catch {}
      const n = (v: unknown, d: number) => Math.max(1, Number(v) || d);
      const d = n(st.slides_to_show, 3);
      const t = n(st.slides_to_show_tablet, Math.min(d, 2));
      const m = n(st.slides_to_show_mobile, 1);
      const sizes = `(max-width: 767px) ${Math.ceil(100 / m)}vw, (max-width: 1024px) ${Math.ceil(100 / t)}vw, ${Math.ceil(1440 / d)}px`;
      seg = seg.replace(/<img\b(?![^>]*data-fd-sizes)/gi, `<img data-fd-sizes="${sizes}"`);
    }
    out += seg;
    last = end;
  });
  return out;
}

/**
 * Inline background images (e.g. Elementor call-to-action): the url moves to data-bg-srcset and WpRuntime sets the
 * smallest variant covering the element (× DPR) when it nears the viewport.
 */
function lazyInlineBackgrounds(html: string, map: Map<string, ImgInfo>) {
  return html.replace(/<([a-z]+)\b([^>]*)\sstyle="([^"]*)"([^>]*)>/gi, (tag, name: string, pre: string, style: string, post: string) => {
    if (/\sdata-bg-srcset=/i.test(tag)) return tag;
    const m = /background-image\s*:\s*url\(\s*(?:&quot;|["'])?([^"')&]+)(?:&quot;|["'])?\s*\)\s*;?/i.exec(style);
    if (!m) return tag;
    const set = srcsetOf(infoFor(map, m[1]));
    if (!set) return tag;
    const rest = style.replace(m[0], '').trim();
    return `<${name}${pre}${rest ? ` style="${rest}"` : ''} data-bg-srcset="${escAttr(set)}"${post}>`;
  });
}

/** Elementor gallery tiles: data-thumbnail -> also data-srcset ("url w, ...") for WpRuntime to pick from. */
function rewriteGallery(html: string, map: Map<string, ImgInfo>) {
  return html.replace(/<[a-z]+\b[^>]*\sdata-thumbnail="[^"]*"[^>]*>/gi, (tag) => {
    if (/\sdata-srcset=/i.test(tag)) return tag;
    const set = srcsetOf(infoFor(map, attr(tag, 'data-thumbnail') || ''));
    return set ? tag.replace(/\sdata-thumbnail=/i, ` data-srcset="${escAttr(set)}" data-thumbnail=`) : tag;
  });
}

function urlsIn(...texts: string[]) {
  const urls = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(URL_RE)) urls.add(m[0]);
  return urls;
}

/** Rewrites stored HTML for responsive delivery (see file comment). */
export async function responsiveHtml(html: string, opts: RewriteOpts = {}): Promise<string> {
  if (!html || !html.includes('site-fortynine')) return rewriteImgs(html, new Map(), opts);
  const map = await getImageInfo(urlsIn(html));
  return rewriteGallery(rewriteBackgrounds(lazyInlineBackgrounds(rewriteImgs(markCarousels(html), map, opts), map), map), map);
}

/** CSS (head <style> blocks): background images -> ≤1440 variant. */
export async function responsiveCss(css: string): Promise<string> {
  if (!css || !css.includes('site-fortynine')) return css;
  return rewriteBackgrounds(css, await getImageInfo(urlsIn(css)));
}
