"""Rebuild posts.seo from the Yoast <head> captured in export/html/*.html.

Why: for some posts the REST `yoast_head_json` was a stale cache copied from another post
(/行銷策略完整指南/), so the imported title / canonical / og:* were wrong. The rendered HTML
head is the source of truth.

Usage: python3 -I fix_seo_from_html.py <export_dir> <post_id> [<post_id> ...]
       add --dry-run to only print the diff.
Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
import glob
import html as htmllib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

args = [a for a in sys.argv[1:] if a != '--dry-run']
DRY = '--dry-run' in sys.argv
EXP, IDS = args[0], [int(x) for x in args[1:]]
SCHEMA = 'site_fortynine'
SB = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
OLD = re.compile(r'^(?:https?:)?//(?:www\.)?fortynine-days\.com', re.I)
H = {'Authorization': f'Bearer {KEY}', 'apikey': KEY, 'Accept-Profile': SCHEMA, 'Content-Profile': SCHEMA}


def get(path):
    """GET with paging (PostgREST caps each response at max-rows=1000)."""
    out, start = [], 0
    while True:
        req = urllib.request.Request(f'{SB}/rest/v1/{path}', headers={**H, 'Range': f'{start}-{start + 999}'})
        rows = json.loads(urllib.request.urlopen(req).read())
        out += rows
        if len(rows) < 1000:
            return out
        start += 1000


def patch(table, id_, body):
    req = urllib.request.Request(f'{SB}/rest/v1/{table}?id=eq.{id_}', data=json.dumps(body).encode(), method='PATCH',
                                 headers={**H, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    urllib.request.urlopen(req).read()


umap = {r['old_url']: r['new_url'] for r in get('media_url_map?select=old_url,new_url&order=old_url')}


def norm(u):
    u = u.strip()
    if u.startswith('//'):
        u = 'https:' + u
    return urllib.parse.unquote(re.sub(r'^http://', 'https://', u).replace('://www.', '://'))


def upload(u):
    n = norm(u).split('?')[0].split('#')[0]
    if n in umap:
        return umap[n]
    m = re.match(r'^(.*?)-(\d+)x(\d+)(\.\w+)$', n)
    for c in ([m.group(1) + m.group(4)] if m else []) + [re.sub(r'-scaled(\.\w+)$', r'\1', n)]:
        for k in (c, re.sub(r'(\.\w+)$', r'-scaled\1', c)):
            if k in umap:
                return umap[k]
    return None


def rw(u):
    """old absolute URL -> new media URL or root-relative path (same convention as import_content.py)."""
    if not isinstance(u, str) or not OLD.match(u):
        return u
    tail = OLD.sub('', u) or '/'
    if tail.startswith('/wp-content/uploads/'):
        return upload(u) or u
    return urllib.parse.unquote(tail)


def deep(v):
    if isinstance(v, str):
        return rw(v)
    if isinstance(v, list):
        return [deep(x) for x in v]
    if isinstance(v, dict):
        return {k: deep(x) for k, x in v.items()}
    return v


def attrs(tag):
    return {k.lower(): htmllib.unescape(v1 or v2) for k, v1, v2 in re.findall(r"""([\w:-]+)=(?:"([^"]*)"|'([^']*)')""", tag)}


def parse_head(doc):
    head = doc.split('</head>', 1)[0]
    t = re.search(r'<title>(.*?)</title>', head, re.S)
    out = {'title': htmllib.unescape(t.group(1).strip()) if t else None}
    meta = {}
    for tag in re.findall(r'<meta\s[^>]*>', head):
        a = attrs(tag)
        k = a.get('property') or a.get('name')
        if k and 'content' in a:
            meta.setdefault(k, []).append(a['content'])
    canon = re.search(r'<link rel="canonical" href="([^"]*)"', head)
    sch = re.search(r'<script type="application/ld\+json" class="yoast-schema-graph">(.*?)</script>', head, re.S)
    one = lambda k: (meta.get(k) or [None])[0]
    robots = {}
    for part in (one('robots') or '').split(','):
        p = part.strip()
        if not p:
            continue
        key = p.split(':')[0]
        robots['index' if key in ('index', 'noindex') else 'follow' if key in ('follow', 'nofollow') else key] = p
    imgs = []
    for i, u in enumerate(meta.get('og:image', [])):
        g = lambda k: (meta.get(k) or [None] * (i + 1))[i] if len(meta.get(k) or []) > i else None
        img = {'url': rw(u)}
        if g('og:image:width'):
            img['width'] = int(g('og:image:width'))
        if g('og:image:height'):
            img['height'] = int(g('og:image:height'))
        if g('og:image:type'):
            img['type'] = g('og:image:type')
        imgs.append(img)
    misc = {}
    n = 1
    while one(f'twitter:label{n}') is not None:
        misc[one(f'twitter:label{n}')] = one(f'twitter:data{n}')
        n += 1
    seo = {
        'title': out['title'],
        'description': one('description'),
        'robots': robots,
        'canonical': rw(canon.group(1)) if canon else None,
        'og_locale': one('og:locale'),
        'og_type': one('og:type'),
        'og_title': one('og:title'),
        'og_description': one('og:description'),
        'og_url': rw(one('og:url')),
        'og_site_name': one('og:site_name'),
        'article_published_time': one('article:published_time'),
        'article_modified_time': one('article:modified_time'),
        'og_image': imgs,
        'author': one('author') or misc.get('作者:'),
        'twitter_card': one('twitter:card'),
        'twitter_misc': misc,
        'schema': deep(json.loads(sch.group(1))) if sch else None,
    }
    return {k: v for k, v in seo.items() if v not in (None, {}, [])}


# canonical path -> export html file
by_path = {}
for f in glob.glob(os.path.join(EXP, 'html', '*.html')):
    doc = open(f, encoding='utf-8').read()
    c = re.search(r'<link rel="canonical" href="([^"]*)"', doc.split('</head>', 1)[0])
    if c:
        by_path[rw(htmllib.unescape(c.group(1)))] = (f, doc)

posts = {p['id']: p for p in get('posts?select=id,path,seo&id=in.(' + ','.join(map(str, IDS)) + ')')}
bad = 0
for pid in IDS:
    p = posts.get(pid)
    if not p or p['path'] not in by_path:
        print(f'{pid}: NO HTML for {p and p["path"]}')
        bad += 1
        continue
    f, doc = by_path[p['path']]
    seo = parse_head(doc)
    old = p['seo'] or {}
    print(f'{pid} {p["path"]}  <- {os.path.basename(f)}')
    for k in ('title', 'canonical', 'og_title', 'og_url'):
        print(f'   {k}: {old.get(k)!r} -> {seo.get(k)!r}')
    if seo.get('canonical') != p['path'] or seo.get('og_url') != p['path']:
        print('   !! canonical/og_url does not equal post path')
        bad += 1
    if not DRY:
        patch('posts', pid, {'seo': seo})
print('done, problems:', bad)
sys.exit(1 if bad else 0)
