"""Import draft pages that the public REST export could not see (WordPress only exposes published content).

Usage: python3 -I import_drafts.py <_db/<repo>/tables dir> <id> [<id> ...]
Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
Rows keep status=draft, so the anon RLS policy (status = 'publish') hides them: the public URL stays a 404
exactly like on the old site, while the admin (service role) can list and edit them.
Old-site upload URLs are rewritten through site_fortynine.media_url_map; other old-site links become relative.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

TABLES, IDS = sys.argv[1], {int(x) for x in sys.argv[2:]}
SB = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
H = {'Authorization': f'Bearer {KEY}', 'apikey': KEY}
OLD_HOST_RE = re.compile(r'(?:https?:)?//(?:www\.)?fortynine-days\.com')
UPLOAD_RE = re.compile(r'(?:https?:)?//(?:www\.)?fortynine-days\.com/wp-content/uploads/[^\s"\'<>)]+')


def http(method, path, body=None, headers=None):
    req = urllib.request.Request(f'{SB}/rest/v1/{path}', method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={**H, 'Accept-Profile': 'site_fortynine', 'Content-Profile': 'site_fortynine',
                                          'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req) as r:
        t = r.read()
        return json.loads(t) if t else None


def rows(name):
    with open(os.path.join(TABLES, f'{name}.jsonl'), encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)


def norm(u):
    if u.startswith('//'):
        u = 'https:' + u
    return urllib.parse.unquote(u.replace('http://', 'https://').replace('://www.', '://'))


def lookup(urls):
    if not urls:
        return {}
    q = ','.join('"' + u.replace('"', '\\"') + '"' for u in urls)
    res = http('GET', 'media_url_map?select=old_url,new_url&old_url=in.(' + urllib.parse.quote(q, safe=',"()') + ')')
    return {r['old_url']: r['new_url'] for r in res}


def tz_local(s):
    return s.replace(' ', 'T') + '+08:00' if s and not s.startswith('0000') else None


def tz_gmt(s):
    return s.replace(' ', 'T') + 'Z' if s and not s.startswith('0000') else None


posts = {p['ID']: p for p in rows('wp_posts') if p['ID'] in IDS}
meta = {}
for m in rows('wp_postmeta'):
    if int(m['post_id']) in IDS:
        meta.setdefault(int(m['post_id']), {})[m['meta_key']] = m['meta_value']
media_ids = {r['id'] for r in http('GET', 'media?select=id&limit=5000')}
author_ids = {r['id'] for r in http('GET', 'authors?select=id')}

out, unresolved = [], []
for pid in sorted(IDS):
    p = posts[pid]
    mm = meta.get(pid, {})
    raw = p['post_content']
    found = {norm(u) for u in UPLOAD_RE.findall(raw)}
    cands = {}
    for u in found:
        cands[u] = [u, re.sub(r'-\d+x\d+(\.\w+)$', r'\1', u), re.sub(r'-scaled(\.\w+)$', r'\1', u),
                    re.sub(r'(\.\w+)$', r'-scaled\1', re.sub(r'-\d+x\d+(\.\w+)$', r'\1', u))]
    m = lookup(sorted({c for cs in cands.values() for c in cs}))
    resolved = {}
    for u, cs in cands.items():
        hit = next((m[c] for c in cs if c in m), None)
        if hit:
            resolved[u] = hit
        else:
            unresolved.append((pid, u))

    def sub_upload(mo):
        return resolved.get(norm(mo.group(0)), mo.group(0))

    html = UPLOAD_RE.sub(sub_upload, raw)
    html = OLD_HOST_RE.sub('', html)
    slug = urllib.parse.unquote(p['post_name'])
    elementor = mm.get('_elementor_data')
    try:
        elementor = json.loads(elementor) if elementor else None
    except ValueError:
        pass
    thumb = int(mm.get('_thumbnail_id') or 0) or None
    out.append({
        'id': pid, 'post_type': p['post_type'], 'slug': slug, 'wp_slug': p['post_name'], 'path': f'/{slug}/',
        'old_url': None, 'title': p['post_title'], 'content_html': html, 'content_raw': raw,
        'excerpt_html': p['post_excerpt'] or '', 'excerpt_raw': p['post_excerpt'] or '',
        'status': 'draft', 'author_id': p['post_author'] if p['post_author'] in author_ids else None,
        'featured_media_id': thumb if thumb in media_ids else None, 'parent_id': p['post_parent'] or None,
        'menu_order': p['menu_order'], 'comment_status': p['comment_status'], 'ping_status': p['ping_status'],
        'template': mm.get('_wp_page_template') or '',
        'date': tz_local(p['post_date']), 'date_gmt': tz_gmt(p['post_date_gmt']),
        'modified': tz_local(p['post_modified']), 'modified_gmt': tz_gmt(p['post_modified_gmt']),
        'meta': {'source': 'wp_posts (draft, not in public REST export)', 'wp_guid': p['guid'],
                 'elementor_data': elementor, 'wp_page_template': mm.get('_wp_page_template'),
                 'body_class': f'wp-singular page-template page-template-elementor_header_footer page page-id-{pid} '
                               f'elementor-template-full-width elementor-page elementor-page-{pid}'},
        'seo': {'description': mm.get('_yoast_wpseo_metadesc')} if mm.get('_yoast_wpseo_metadesc') else None,
    })

http('POST', 'posts?on_conflict=id', out, {'Prefer': 'resolution=merge-duplicates,return=minimal'})
print(json.dumps({'upserted': [(r['id'], r['status'], r['path'], len(r['content_html'])) for r in out],
                  'uploads_rewritten': sum(1 for r in out for _ in UPLOAD_RE.findall(r['content_raw'])) - len(unresolved),
                  'unresolved': len(unresolved)}, ensure_ascii=False))
for pid, u in unresolved[:20]:
    print('UNRESOLVED', pid, u)
