import type { HeadEntry } from '@/lib/content';

/** Renders WordPress <head> styles in their original order (links + inline <style> blocks). */
export function HeadStyles({ entries }: { entries: HeadEntry[] }) {
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
          <style key={i} id={e.id || undefined} dangerouslySetInnerHTML={{ __html: e.css }} />
        ),
      )}
    </>
  );
}
