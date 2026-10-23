"""Extract the front-end theme (Blocksy + Elementor Pro output) from the old-site snapshot.

Usage: python3 -I extract_theme.py <export_dir> <repo_dir>
Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Writes
  <repo>/public/wp/**              theme/plugin CSS + fonts (code assets only, no content)
  <repo>/src/theme/head.json       ordered global <head> styles (links + inline css)
  <repo>/src/theme/head-post.json  extra styles used by block-editor (Gutenberg) posts
  site_fortynine.templates         header / footer / error-404 Elementor templates (HTML, URLs rewritten)
  site_fortynine.settings          chaty (floating LINE button), tracking ids
  site_fortynine.posts.meta.head   per-page Elementor CSS + per-page inline CSS
Idempotent (upserts).
"""
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request

EXP, REPO = sys.argv[1:3]
SCHEMA = 'site_fortynine'
SB = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
OLD = 'https://fortynine-days.com'
UA = 'GatherMigrator/1.0'
HTML = os.path.join(EXP, 'html')


def api(method, path, body=None, extra=None):
    h = {'Authorization': f'Bearer {KEY}', 'apikey': KEY, 'Content-Type': 'application/json',
         'Accept-Profile': SCHEMA, 'Content-Profile': SCHEMA}
    h.update(extra or {})
    req = urllib.request.Request(f'{SB}/rest/v1/{path}', method=method, headers=h,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req) as r:
        t = r.read()
        return json.loads(t) if t else None


def get_all(table, select):
    out, off = [], 0
    while True:
        rows = api('GET', f'{table}?select={select}&order=old_url&offset={off}&limit=1000')
        out += rows
        if len(rows) < 1000:
            return out
        off += 1000


# ------------------------------------------------------------ URL rewriting
url_map = {r['old_url']: r['new_url'] for r in get_all('media_url_map', 'old_url,new_url')}
base_index = {}
for u, n in url_map.items():
    base_index.setdefault(re.sub(r'-scaled(\.\w+)$', r'\1', u), n)
unresolved = set()


def norm(u):
    u = u.strip()
    if u.startswith('//'):
        u = 'https:' + u
    u = re.sub(r'^http://', 'https://', u).replace('://www.', '://')
    return urllib.parse.unquote(u)


def resolve_upload(u):
    if u in url_map:
        return url_map[u]
    m = re.match(r'^(.*?)-(\d+)x(\d+)(\.\w+)$', u)
    cands = [m.group(1) + m.group(4)] if m else []
    cands.append(re.sub(r'-scaled(\.\w+)$', r'\1', u))
    for c in cands:
        n = base_index.get(c) or base_index.get(re.sub(r'(\.\w+)$', r'-scaled\1', c))
        if n:
            return n
    return None


def rewrite(s):
    def sub(mo):
        raw = mo.group(0)
        u = norm(raw)
        path = urllib.parse.urlparse(u).path
        if path.startswith('/wp-content/uploads/'):
            new = resolve_upload(u.split('?')[0].split('#')[0])
            if new:
                return new
            unresolved.add(u)
            return raw
        if path.startswith('/wp-content/') or path.startswith('/wp-includes/'):
            return '/wp' + raw.split('fortynine-days.com', 1)[1]
        tail = raw.split('fortynine-days.com', 1)[1]
        return tail if tail.startswith('/') else '/' + tail

    s = re.sub(r'''(?:https?:)?//(?:www\.)?fortynine-days\.com(?:/[^"'\s<>)\\]*)?''', sub, s)
    # resized variants all point at one optimized file -> drop srcset/sizes
    s = re.sub(r'\s(?:srcset|sizes)="[^"]*"', '', s)
    return s


# ------------------------------------------------------------ static assets
pub = os.path.join(REPO, 'public', 'wp')
for sub_dir in ('css', 'fonts'):
    src = os.path.join(EXP, 'design', sub_dir)
    for top in ('wp-content', 'wp-includes'):
        if os.path.isdir(os.path.join(src, top)):
            shutil.copytree(os.path.join(src, top), os.path.join(pub, top), dirs_exist_ok=True)
# per-post elementor CSS is content: it goes to the DB, not to public/
shutil.rmtree(os.path.join(pub, 'wp-content', 'uploads'), ignore_errors=True)
os.makedirs(os.path.join(pub, 'wp-content', 'uploads', 'elementor', 'css'), exist_ok=True)
for kit in ('11694', '11724', '11732'):  # kit + header + footer: site-wide theme CSS
    shutil.copy(os.path.join(EXP, 'design/css/wp-content/uploads/elementor/css', f'post-{kit}.css'),
                os.path.join(pub, 'wp-content/uploads/elementor/css', f'post-{kit}.css'))


def fetch(url):
    time.sleep(0.2)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req) as r:
        return r.read()


missing = {
    '/wp-content/plugins/elementor/assets/lib/animations/styles/e-animation-shrink.min.css': None,
    '/wp-content/themes/blocksy/static/bundle/non-critical-styles.min.css': None,
}
for rel in missing:
    dst = os.path.join(REPO, 'public', 'wp', rel.lstrip('/'))
    if not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(fetch(OLD + rel))


# ------------------------------------------------------------ head styles
def entries(fname):
    h = open(os.path.join(HTML, fname), encoding='utf-8').read()
    head = h[:h.find('<body')]
    out = []
    for m in re.finditer(r"<link[^>]+rel=['\"]stylesheet['\"][^>]*>|<style[^>]*>.*?</style>", head, re.S):
        t = m.group(0)
        if t.startswith('<link'):
            href = re.search(r"href=['\"]([^'\"]+)", t).group(1).replace('&#038;', '&')
            sid = (re.search(r"id=['\"]([^'\"]+)", t) or [None, None])[1]
            out.append({'type': 'link', 'id': sid, 'href': href})
        else:
            sid = (re.search(r"id=['\"]([^'\"]+)", t[:200]) or [None, None])[1]
            css = t[t.find('>') + 1:-len('</style>')]
            out.append({'type': 'style', 'id': sid, 'css': css})
    return out


def key(e):
    return ('L', e['href'].split('?')[0]) if e['type'] == 'link' else ('S', e['id'], e['css'].strip())


def localize(e):
    e = dict(e)
    if e['type'] == 'link' and e['href'].startswith(OLD):
        e['href'] = '/wp' + e['href'][len(OLD):].split('?')[0]
    if e['type'] == 'style':
        e['css'] = rewrite(e['css'])
    return e


all_pages = [f for f in os.listdir(HTML) if f.endswith('.html')]
E = {f: entries(f) for f in all_pages}
common = set.intersection(*[set(map(key, E[f])) for f in all_pages])
WIDGET_CSS = ('animations/styles/', 'e-gallery', 'swiper', 'widget-icon-box', 'widget-image-carousel')
raw_head = [e for e in E['index.html'] if key(e) in common]
# optional widget CSS (animations, gallery, carousel, icon-box): load site-wide, inserted after the widget css block
seen = {key(e) for e in raw_head}
head = []
for e in raw_head:
    le = localize(e)
    if e['type'] == 'link' and 'no-scripts.min.css' in e['href']:
        le['noscript'] = True  # WP prints it inside <noscript>
    head.append(le)
extra_widgets = []
for f in sorted(all_pages):
    for e in E[f]:
        if e['type'] == 'link' and any(w in e['href'] for w in WIDGET_CSS) and key(e) not in seen:
            seen.add(key(e))
            extra_widgets.append(localize(e))
idx = max(i for i, e in enumerate(head) if e['type'] == 'link' and '/widget-' in e['href']) + 1
head = head[:idx] + extra_widgets + head[idx:]
# Blocksy lazy-loads non-critical CSS from JS; the snapshot head has it as a link only on JS pages -> add it
nc = '/wp/wp-content/themes/blocksy/static/bundle/non-critical-styles.min.css'
if os.path.exists(os.path.join(REPO, 'public', nc.lstrip('/'))):
    head.append({'type': 'link', 'id': 'ct-non-critical', 'href': nc})

post_extra = []
for f in ('kangol.html', 'cat.html', 'seo-and-ux.html', 'body.html', 'aquamax.html'):
    for e in E[f]:
        if e['type'] == 'style' and (e['id'] or '').startswith('wp-block-') and key(e) not in seen:
            seen.add(key(e))
            post_extra.append(localize(e))
for f in all_pages:
    for e in E[f]:
        if e['type'] == 'style' and (e['id'] or '').startswith('wp-block-') and key(e) not in seen:
            seen.add(key(e))
            post_extra.append(localize(e))

os.makedirs(os.path.join(REPO, 'src', 'theme'), exist_ok=True)
json.dump(head, open(os.path.join(REPO, 'src/theme/head.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(post_extra, open(os.path.join(REPO, 'src/theme/head-post.json'), 'w'), ensure_ascii=False, indent=1)
missing_files = [e['href'] for e in head if e['type'] == 'link' and e['href'].startswith('/wp/')
                 and not os.path.exists(os.path.join(REPO, 'public', e['href'].lstrip('/')))]
print('head entries', len(head), 'post extras', len(post_extra), 'missing local css', missing_files)

# ------------------------------------------------------------ per-page extras -> posts.meta.head
idx_json = json.load(open(os.path.join(HTML, 'index.json'), encoding='utf-8'))
posts = api('GET', 'posts?select=id,path,meta')
by_path = {p['path']: p for p in posts}
elementor_css_dir = os.path.join(EXP, 'design/css/wp-content/uploads/elementor/css')
updated = 0
for it in idx_json:
    if it['status'] != 200 or not it['file'].endswith('.html'):
        continue
    path = urllib.parse.unquote(urllib.parse.urlparse(it['final_url']).path)
    if '?' in it['url'] or path != urllib.parse.unquote(urllib.parse.urlparse(it['url']).path):
        continue
    p = by_path.get(path)
    if not p:
        continue
    extras = []
    for e in E[it['file']]:
        if key(e) in seen:
            continue
        if e['type'] == 'link':
            m = re.search(r'/uploads/elementor/css/post-(\d+)\.css', e['href'])
            if m and m.group(1) not in ('11694', '11724', '11732'):
                fn = os.path.join(elementor_css_dir, f'post-{m.group(1)}.css')
                css = open(fn, encoding='utf-8').read() if os.path.exists(fn) else fetch(e['href']).decode()
                extras.append({'type': 'style', 'id': f'elementor-post-{m.group(1)}-css', 'css': rewrite(css)})
            continue
        extras.append(localize(e))
    meta = dict(p['meta'] or {})
    meta['head'] = extras
    meta['body_class'] = re.search(r'<body class="([^"]*)"', open(os.path.join(HTML, it['file']), encoding='utf-8').read()).group(1)
    api('PATCH', f'posts?id=eq.{p["id"]}', {'meta': meta}, {'Prefer': 'return=minimal'})
    updated += 1
print('posts meta.head updated', updated)


# ------------------------------------------------------------ templates
def outer(h, start_pat, tag):
    s = re.search(start_pat, h).start()
    depth, i = 0, s
    rx = re.compile(rf'<{tag}\b|</{tag}>')
    for m in rx.finditer(h, s):
        depth += 1 if m.group(0).startswith(f'<{tag}') else -1
        if depth == 0:
            return h[s:m.end()]
    raise SystemExit('unbalanced ' + tag)


home = open(os.path.join(HTML, 'index.html'), encoding='utf-8').read()
header = outer(home, r'<header data-elementor-type="header"', 'header')
footer = outer(home, r'<footer data-elementor-type="footer"', 'footer')
e404 = open(os.path.join(HTML, 'this-page-does-not-exist-gm404.html'), encoding='utf-8').read()
tpl404 = outer(e404, r'<div data-elementor-type="error-404"', 'div')

# nav menus -> tokens rendered from site_fortynine.menu_items at request time
header = re.sub(r'<ul id="menu-1-[0-9a-f]+" class="elementor-nav-menu">.*?</ul>\s*</li>\s*(?:<li.*?</li>\s*)*</ul>',
                '{{menu:primary:main}}', header, count=1, flags=re.S)
header = re.sub(r'<ul id="menu-2-[0-9a-f]+" class="elementor-nav-menu">.*?</ul>\s*</li>\s*(?:<li.*?</li>\s*)*</ul>',
                '{{menu:primary:dropdown}}', header, count=1, flags=re.S)
assert '{{menu:primary:main}}' in header and '{{menu:primary:dropdown}}' in header, 'menu tokens'

css404 = rewrite(fetch(OLD + '/wp-content/uploads/elementor/css/post-11705.css?ver=1764088241').decode())
tpls = [
    {'id': 11732, 'template_type': 'elementor_library', 'slug': 'header', 'title': 'Header', 'location': 'header',
     'content_html': rewrite(header), 'data': {'source': 'html/index.html snapshot', 'sticky': 'top'}, 'status': 'publish'},
    {'id': 11724, 'template_type': 'elementor_library', 'slug': 'footer', 'title': 'Footer', 'location': 'footer',
     'content_html': rewrite(footer), 'data': {'source': 'html/index.html snapshot'}, 'status': 'publish'},
    {'id': 11705, 'template_type': 'elementor_library', 'slug': 'error-404', 'title': '404', 'location': 'error-404',
     'content_html': rewrite(tpl404), 'data': {'source': 'html/this-page-does-not-exist-gm404.html snapshot', 'css': css404},
     'status': 'publish'},
]
api('POST', 'templates?on_conflict=id', tpls, {'Prefer': 'resolution=merge-duplicates,return=minimal'})
print('templates upserted', len(tpls))

# ------------------------------------------------------------ settings: chaty + tracking
m = re.search(r'var chaty_settings = (\{.*?\});\n', home, re.S)
cw = json.loads(m.group(1))['chaty_widgets'][0]
st = cw['settings']
chaty = {
    'enabled': True, 'position': st['position'], 'side_spacing': int(st['side_spacing']),
    'bottom_spacing': int(st['bottom_spacing']), 'size': int(st['widget_size']), 'attention_effect': st['attention_effect'],
    'channels': [{'channel': c['channel'], 'url': c['value'], 'hover_text': c['hover_text'], 'svg_icon': c['svg_icon']}
                 for c in cw['channels']],
}
tracking = {'gtm': 'GTM-TLJRV6Z', 'google_tag': 'GT-NFRNJNB', 'ga4': 'G-NFB275X8S9'}
api('POST', 'settings?on_conflict=key', [
    {'key': 'chaty', 'value': chaty, 'is_public': True},
    {'key': 'tracking_ids', 'value': tracking, 'is_public': True},
], {'Prefer': 'resolution=merge-duplicates,return=minimal'})
print('settings upserted: chaty, tracking_ids')
print('unresolved upload urls', sorted(unresolved)[:20], len(unresolved))
