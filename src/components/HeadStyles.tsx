import type { HeadEntry } from '@/lib/content';
import { responsiveCss } from '@/lib/images';

/** Renders WordPress <head> styles in their original order (links + inline <style> blocks). */
export async function HeadStyles({ entries }: { entries: HeadEntry[] }) {
  // CSS backgrounds (Elementor post CSS) -> ≤1440px WebP variant
  const css = await Promise.all(entries.map((e) => (e.type === 'style' ? responsiveCss(e.css) : Promise.resolve(''))));
  return (
    <>
      {entries.map((e, i) =>
        e.type === 'link' ? (
          e.noscript ? (
            <noscript key={i} dangerouslySetInnerHTML={{ __html: `<link rel="stylesheet" href="${e.href}">` }} />
          ) : (
            <link key={i} rel="stylesheet" id={e.id || undefined} href={e.href} media="all" />
          )
        ) : (
          <style key={i} id={e.id || undefined} dangerouslySetInnerHTML={{ __html: css[i] }} />
        ),
      )}
    </>
  );
}
