#!/usr/bin/env python3
"""Fill site_fortynine.posts.content_raw / excerpt_raw (WP-native search index).

WordPress search runs `LIKE` against wp_posts.post_title / post_excerpt / post_content (the *raw* values).
The public REST API only exposes rendered HTML, so the raw value is reconstructed from it:
  * Elementor dynamic widgets (posts / portfolio / loop grids / nav menus) are not part of post_content
    (Elementor's saved plain-text fallback renders them empty) -> removed;
  * srcset / sizes are added by WP at render time -> removed;
  * the old host is dropped (root-relative), file names are kept as they were in post_content.
The column is only used for matching, never rendered.

usage: source ~/.config/gather-migrate/env; python3 -I scripts/migrate/fill_search_raw.py <export_dir>
"""
import html, json, os, re, sys, urllib.request

SB = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
EXPORT = sys.argv[1]
DYN = ('posts.', 'portfolio.', 'loop-grid.', 'loop-carousel.', 'archive-posts.', 'nav-menu.')


def strip_dynamic(h):
    while True:
        m = next((mm for mm in re.finditer(r'<div\b[^>]*data-widget_type="([^"]+)"[^>]*>', h) if mm.group(1).startswith(DYN)), None)
        if not m:
            return h
        i, depth, end = m.end(), 1, len(h)
        for t in re.finditer(r'<(/?)div\b[^>]*>', h[i:]):
            depth += -1 if t.group(1) else 1
            if depth == 0:
                end = i + t.end()
                break
        h = h[:m.start()] + h[end:]


def raw_of(h):
    h = strip_dynamic(h or '')
    h = re.sub(r'\s(?:srcset|sizes)="[^"]*"', '', h)
    return re.sub(r'(?:https?:)?//(?:www\.)?fortynine-days\.com(?=/|")', '', h)


def patch(pid, row):
    req = urllib.request.Request(
        f'{SB}/rest/v1/posts?id=eq.{pid}', data=json.dumps(row).encode(), method='PATCH',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json',
                 'Content-Profile': 'site_fortynine', 'Prefer': 'return=minimal'})
    urllib.request.urlopen(req).read()


n = 0
for f in ('posts.json', 'pages.json'):
    for x in json.load(open(os.path.join(EXPORT, 'rest', f))):
        ex = x['excerpt']['rendered'] if x['type'] == 'post' else ''  # pages have no manual excerpt
        ex = html.unescape(re.sub(r'<[^>]+>', '', ex)).strip()  # wpautop'd manual excerpt -> raw text
        patch(x['id'], {'content_raw': raw_of(x['content']['rendered']), 'excerpt_raw': ex})
        n += 1
print('filled', n)
