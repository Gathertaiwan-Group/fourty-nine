"""Import public content from export/ into Supabase schema site_fortynine via PostgREST (service role).

Usage: python3 -I import_content.py <export_dir> <media_plan.json> <media_results.json> <report.json>
Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
Idempotent: every write is an upsert keyed by the original WordPress ID / natural key.
"""
import html as htmllib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

EXP, PLAN, RESULTS, REPORT = sys.argv[1:5]
SCHEMA = 'site_fortynine'
BUCKET = 'site-fortynine'
SB = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
PUBLIC_BASE = f'{SB}/storage/v1/object/public/{BUCKET}/'
OLD_HOST_RE = r'(?:https?:)?//(?:www\.)?fortynine-days\.com'


def L(rel):
    return json.load(open(os.path.join(EXP, rel), encoding='utf-8'))


def rest(table, rows, on_conflict=None):
    if not rows:
        return 0
    q = f'?on_conflict={on_conflict}' if on_conflict else ''
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        req = urllib.request.Request(
            f'{SB}/rest/v1/{table}{q}', data=json.dumps(chunk).encode(), method='POST',
            headers={'Authorization': f'Bearer {KEY}', 'apikey': KEY, 'Content-Type': 'application/json',
                     'Content-Profile': SCHEMA,
                     'Prefer': 'resolution=merge-duplicates,return=minimal'})
        try:
            urllib.request.urlopen(req).read()
        except urllib.error.HTTPError as e:
            raise SystemExit(f'{table} failed: {e.code} {e.read()[:500]!r}')
    return len(rows)


def norm(u):
    u = u.strip()
    if u.startswith('//'):
        u = 'https:' + u
    u = re.sub(r'^http://', 'https://', u).replace('://www.', '://')
    return urllib.parse.unquote(u)


def public_url(key):
    return PUBLIC_BASE + '/'.join(urllib.parse.quote(s) for s in key.split('/'))


def tz(s):
    return s + '+08:00' if s else None


def tz_gmt(s):
    return s + 'Z' if s else None


def path_of(link):
    p = urllib.parse.urlparse(link).path or '/'
    return urllib.parse.unquote(p)


def unesc(s):
    return htmllib.unescape(s or '')


# ---------------------------------------------------------------- media ----
plan = json.load(open(PLAN, encoding='utf-8'))
results = json.load(open(RESULTS, encoding='utf-8'))
media_json = {m['id']: m for m in L('rest/media.json')}

media_rows, url_map, failed_media = [], {}, []
key_to_ids = {}
for p in plan:
    m = media_json[p['id']]
    r = results.get(p['key'], {})
    ok = bool(r.get('ok'))
    new_url = public_url(p['key']) if ok else None
    if not ok:
        failed_media.append({'id': p['id'], 'old_url': p['old_url'], 'reason': (r.get('error') or 'not uploaded')[:160]})
    md = m.get('media_details') or {}
    media_rows.append({
        'id': m['id'], 'slug': urllib.parse.unquote(m['slug']), 'wp_slug': m['slug'],
        'title': unesc(m['title']['rendered']),
        'caption_html': (m.get('caption') or {}).get('rendered', ''),
        'description_html': (m.get('description') or {}).get('rendered', ''),
        'alt_text': m.get('alt_text') or '', 'media_type': m['media_type'],
        'mime_type': p['content_type'] if ok else m['mime_type'], 'original_mime': m['mime_type'],
        'old_url': m['source_url'], 'storage_path': p['key'] if ok else None, 'url': new_url,
        'width': r.get('width') or md.get('width'), 'height': r.get('height') or md.get('height'),
        'bytes': r.get('bytes') if ok else None, 'original_bytes': p['original_bytes'], 'sha1': p['sha1'],
        'attachment_path': path_of(m['link']) if m.get('link') and m['link'] != m['source_url'] else None,
        'parent_post_id': m.get('post'), 'author_id': m.get('author'), 'status': m.get('status') or 'inherit',
        'date': tz(m.get('date')), 'modified': tz(m.get('modified')),
        'meta': {'duplicate_of': p.get('duplicate_of'), 'wp_file': md.get('file'),
                 'original_width': md.get('width'), 'original_height': md.get('height')},
    })
    key_to_ids.setdefault(p['key'], []).append(p['id'])
    if new_url:
        for u, kind in ((p['orig_url'], 'original'), (norm(p['old_url']), 'scaled' if '-scaled' in p['old_url'] else 'original')):
            if u not in url_map:
                url_map[u] = {'old_url': u, 'media_id': p['id'], 'new_url': new_url,
                              'kind': 'duplicate' if p.get('duplicate_of') else kind}

# base (original) url -> map entry, used to resolve -WxH variants
base_index = {}
for u, e in url_map.items():
    base_index.setdefault(re.sub(r'-scaled(\.\w+)$', r'\1', u), e)
failed_old = {norm(f['old_url']) for f in failed_media}


def resolve_upload(u):
    """normalized old uploads URL -> new URL (or None)."""
    if u in url_map:
        return url_map[u]['new_url']
    m = re.match(r'^(.*?)-(\d+)x(\d+)(\.\w+)$', u)
    cands = []
    if m:
        cands.append(m.group(1) + m.group(4))
    cands.append(re.sub(r'-scaled(\.\w+)$', r'\1', u))
    for c in cands:
        e = base_index.get(c) or base_index.get(re.sub(r'(\.\w+)$', r'-scaled\1', c))
        if e:
            if u not in url_map:
                url_map[u] = {'old_url': u, 'media_id': e['media_id'], 'new_url': e['new_url'], 'kind': 'variant'}
            return e['new_url']
    return None


# register every variant URL that was seen on the old site (html scan) so the map is complete
for it in L('media/index.json')['items']:
    if it['status'] == 200 and '/wp-content/uploads/' in it['url']:
        resolve_upload(norm(it['url']))

# ---------------------------------------------------------------- rewrite --
unresolved = {}


def rewrite(s, where):
    if not s:
        return s

    def sub(mo):
        raw = mo.group(0)
        u = norm(raw if raw.startswith('http') or raw.startswith('//') else 'https:' + raw)
        path = urllib.parse.urlparse(u).path
        if path.startswith('/wp-content/uploads/'):
            new = resolve_upload(u.split('?')[0].split('#')[0])
            if new:
                return new
            unresolved.setdefault(u, set()).add(where)
            return raw
        if path.startswith('/wp-content/') or path.startswith('/wp-includes/'):
            unresolved.setdefault(u, set()).add(where)
            return raw
        tail = raw.split('fortynine-days.com', 1)[1]
        return tail if tail.startswith('/') else '/' + tail

    s = re.sub(OLD_HOST_RE + r'''(?:/[^"'\s<>)\\]*)?''', sub, s)
    # every resized variant now points at one optimized file -> srcset/sizes are redundant
    s = re.sub(r'\s(?:srcset|sizes)="[^"]*"', lambda mo: '' if PUBLIC_BASE in mo.group(0) or 'sizes=' in mo.group(0)[:8] else mo.group(0), s)
    return s


def rewrite_json(obj, where):
    if obj is None:
        return None
    return json.loads(rewrite(json.dumps(obj, ensure_ascii=False), where))


# ---------------------------------------------------------------- settings -
root = L('rest/_root.json')
features = L('features.json')
pages = L('rest/pages.json')
posts = L('rest/posts.json')
front = next((p for p in pages if path_of(p['link']) == '/'), None)
icon = media_json.get(root.get('site_icon'))
logo = media_json.get(root.get('site_logo'))


def media_url(mid):
    return next((r['url'] for r in media_rows if r['id'] == mid), None)


settings = {
    'blogname': unesc(root.get('name')),
    'blogdescription': unesc(root.get('description')),
    'old_siteurl': root.get('url'),
    'language': 'zh-TW',
    'gmt_offset': root.get('gmt_offset'),
    'timezone_string': root.get('timezone_string') or 'Asia/Taipei',
    'show_on_front': 'page',
    'page_on_front': front['id'] if front else None,
    'site_logo': {'media_id': root.get('site_logo'), 'url': media_url(root.get('site_logo'))} if logo else {'media_id': root.get('site_logo'), 'url': None},
    'site_icon': {'media_id': root.get('site_icon'), 'url': media_url(root.get('site_icon'))} if icon else {'media_id': root.get('site_icon'), 'url': None},
    'tracking': features.get('summary', {}).get('tracking'),
    'social_links': features.get('summary', {}).get('social_links'),
    'floating_buttons': features.get('summary', {}).get('floating_buttons'),
    'permalink_structure': '/%postname%/',
}
settings_rows = [{'key': k, 'value': v, 'is_public': True} for k, v in settings.items() if v is not None]

# ---------------------------------------------------------------- authors --
authors = {}
for p in posts:
    for g in (p.get('yoast_head_json') or {}).get('schema', {}).get('@graph', []):
        if g.get('@type') == 'Person' and g.get('url'):
            slug = path_of(g['url']).strip('/').split('/')[-1]
            authors[p['author']] = {'id': p['author'], 'slug': slug, 'display_name': g.get('name') or slug,
                                    'description': g.get('description'),
                                    'avatar_url': (g.get('image') or {}).get('url'), 'website': None}
for p in posts + pages:
    authors.setdefault(p['author'], {'id': p['author'], 'slug': f"user-{p['author']}", 'display_name': f"user-{p['author']}"})

# ---------------------------------------------------------------- terms ----
term_rows = []
for f, tax in (('rest/tax_categories.json', 'category'), ('rest/tax_tags.json', 'post_tag')):
    for t in L(f):
        term_rows.append({
            'id': t['id'], 'taxonomy': tax, 'slug': urllib.parse.unquote(t['slug']), 'wp_slug': t['slug'],
            'name': unesc(t['name']), 'description': t.get('description') or '',
            'parent_id': t.get('parent') or None, 'count': t.get('count') or 0,
            'path': path_of(t['link']), 'old_url': t['link'],
            'seo': rewrite_json(t.get('yoast_head_json'), f'term:{t["id"]}'), 'meta': {}})
term_rows.sort(key=lambda r: (r['parent_id'] is not None, r['id']))

# ---------------------------------------------------------------- posts ----
post_rows, post_terms = [], []
for p in posts + pages + L('rest/navigation.json') + L('rest/blocks.json'):
    where = f"{p['type']}:{p['id']}"
    post_rows.append({
        'id': p['id'], 'post_type': p['type'], 'slug': urllib.parse.unquote(p['slug']), 'wp_slug': p['slug'],
        'path': path_of(p['link']), 'old_url': p['link'],
        'title': unesc(p['title']['rendered']),
        'content_html': rewrite((p.get('content') or {}).get('rendered', ''), where),
        'excerpt_html': rewrite((p.get('excerpt') or {}).get('rendered', ''), where),
        'status': p['status'], 'author_id': p.get('author'),
        'featured_media_id': p.get('featured_media') or None,
        'parent_id': p.get('parent') or None, 'menu_order': p.get('menu_order') or 0,
        'comment_status': p.get('comment_status') or 'closed', 'ping_status': p.get('ping_status') or 'closed',
        'sticky': bool(p.get('sticky')), 'format': p.get('format') or 'standard', 'template': p.get('template') or '',
        'date': tz(p.get('date')), 'date_gmt': tz_gmt(p.get('date_gmt')),
        'modified': tz(p.get('modified')), 'modified_gmt': tz_gmt(p.get('modified_gmt')),
        'meta': {k: v for k, v in {'wp_meta': p.get('meta'), 'class_list': p.get('class_list'),
                                    'blocksy_meta': p.get('blocksy_meta') or None}.items() if v},
        'seo': rewrite_json(p.get('yoast_head_json'), where),
    })
    for i, tid in enumerate((p.get('categories') or []) + (p.get('tags') or [])):
        post_terms.append({'post_id': p['id'], 'term_id': tid, 'term_order': i})
media_ids = {r['id'] for r in media_rows}
missing_featured = [r['id'] for r in post_rows if r['featured_media_id'] and r['featured_media_id'] not in media_ids]
for r in post_rows:
    if r['featured_media_id'] not in media_ids:
        r['featured_media_id'] = None
post_rows.sort(key=lambda r: (r['parent_id'] is not None, r['id']))

# ---------------------------------------------------------------- menus ----
class NavParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_nav = False; self.depth = 0; self.stack = []; self.items = []; self.cur = None; self.in_a = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'nav' and 'elementor-nav-menu--main' in (a.get('class') or '') and not self.items:
            self.in_nav = True; self.depth = 0
        if not self.in_nav:
            return
        if tag == 'nav':
            self.depth += 1
        if tag == 'li':
            mid = re.findall(r'menu-item-(\d+)', a.get('class') or '')
            item = {'id': int(mid[-1]) if mid else None, 'parent': self.stack[-1]['id'] if self.stack else None,
                    'title': '', 'url': None, 'target': None, 'classes': (a.get('class') or '').split()}
            self.items.append(item); self.stack.append(item)
        if tag == 'a' and self.stack and self.stack[-1]['url'] is None:
            self.stack[-1]['url'] = a.get('href'); self.stack[-1]['target'] = a.get('target'); self.in_a = True

    def handle_endtag(self, tag):
        if not self.in_nav:
            return
        if tag == 'a':
            self.in_a = False
        if tag == 'li' and self.stack:
            self.stack.pop()
        if tag == 'nav':
            self.depth -= 1
            if self.depth == 0:
                self.in_nav = False

    def handle_data(self, data):
        if self.in_nav and self.in_a and self.stack:
            self.stack[-1]['title'] += data


np_ = NavParser()
np_.feed(open(os.path.join(EXP, 'html/index.html'), encoding='utf-8').read())
path_to_post = {r['path']: r for r in post_rows}
menu_items, pos = [], {}
for it in np_.items:
    url = rewrite(it['url'] or '', 'menu')
    tgt = path_to_post.get(urllib.parse.unquote(url))
    pos[it['parent']] = pos.get(it['parent'], 0) + 1
    menu_items.append({'id': it['id'], 'menu_id': None, 'parent_id': it['parent'], 'position': pos[it['parent']],
                       'title': ' '.join(it['title'].split()), 'url': url,
                       'object_type': tgt['post_type'] if tgt else 'custom', 'object_id': tgt['id'] if tgt else None,
                       'target': it['target'], 'attr_title': None,
                       'classes': [c for c in it['classes'] if c.startswith('menu-item-has-children')]})

# ---------------------------------------------------------------- redirects
redirect_rows = []
seen_paths = {r['path'] for r in post_rows} | {r['path'] for r in term_rows}
for r in media_rows:
    ap = r['attachment_path']
    if not ap or ap in seen_paths:
        continue
    seen_paths.add(ap)
    redirect_rows.append({'source_path': ap, 'target': r['url'] or r['old_url'], 'status_code': 301,
                          'kind': 'attachment', 'media_id': r['id']})

# ---------------------------------------------------------------- write ----
counts = {}
counts['settings'] = rest('settings', settings_rows, 'key')
counts['authors'] = rest('authors', list(authors.values()), 'id')
counts['terms'] = rest('terms', term_rows, 'id')
counts['media'] = rest('media', media_rows, 'id')
counts['media_url_map'] = rest('media_url_map', list(url_map.values()), 'old_url')
counts['posts'] = rest('posts', post_rows, 'id')
counts['post_terms'] = rest('post_terms', post_terms, 'post_id,term_id')
rest('menus', [{'slug': 'primary', 'name': 'Main Menu', 'location': 'header',
                'source': 'Elementor header nav-menu (html/index.html snapshot); classic menus were 401 on REST'}], 'slug')
req = urllib.request.Request(f'{SB}/rest/v1/menus?slug=eq.primary&select=id',
                             headers={'Authorization': f'Bearer {KEY}', 'apikey': KEY, 'Accept-Profile': SCHEMA})
menu_id = json.loads(urllib.request.urlopen(req).read())[0]['id']
for mi in menu_items:
    mi['menu_id'] = menu_id
menu_items.sort(key=lambda m: (m['parent_id'] is not None, m['position']))
counts['menu_items'] = rest('menu_items', menu_items, 'id')
counts['redirects'] = rest('redirects', redirect_rows, 'source_path')
rest('audit_log', [{'actor': 'migration', 'action': 'import', 'entity': 'site_fortynine',
                    'entity_id': None, 'after': {'counts': counts, 'source': 'export/ (public REST + html snapshots)'}}])

report = {'counts_written': counts, 'failed_media': failed_media,
          'missing_featured_media_posts': missing_featured,
          'unresolved_old_urls': {k: sorted(v) for k, v in unresolved.items()},
          'menu_items': [(m['id'], m['parent_id'], m['title'], m['url']) for m in menu_items]}
json.dump(report, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({k: (v if not isinstance(v, (list, dict)) or k == 'counts_written' else len(v)) for k, v in report.items()}, ensure_ascii=False))
