"""Phase 3: import private / plugin data from the WordPress DB backup into site_fortynine.

Usage: python3 -I import_private.py <tables_dir>
  tables_dir = ~/gather-migrate/_db/fourty-nine/tables  (one <wp_table>.jsonl per table, contains personal data)
Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Prints counts only, never row contents. Idempotent: upserts keyed by WordPress IDs.
Imports: nav menus + items, wp_block, remaining elementor_library templates, private attachment metadata,
Elementor Pro forms + submissions (+ action log), WPForms form definitions, front-end related wp_options.
The backup has no orders / customers / coupons / discount rules / comments / post passwords for this site.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

TD = sys.argv[1]
SCHEMA = 'site_fortynine'
SB = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
OLD_HOST_RE = re.compile(r'^(?:https?:)?//(?:www\.)?fortynine-days\.com', re.I)


def T(name):
    p = os.path.join(TD, name + '.jsonl')
    return [json.loads(l) for l in open(p, encoding='utf-8')] if os.path.exists(p) else []


def http(method, path, body=None, headers=None):
    h = {'Authorization': f'Bearer {KEY}', 'apikey': KEY, 'Content-Type': 'application/json',
         'Accept-Profile': SCHEMA, 'Content-Profile': SCHEMA}
    h.update(headers or {})
    req = urllib.request.Request(f'{SB}/rest/v1/{path}', data=None if body is None else json.dumps(body).replace('\\u0000', '').encode(),
                                 method=method, headers=h)
    try:
        r = urllib.request.urlopen(req).read()
        return json.loads(r) if r else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path.split("?")[0]} failed: {e.code} {e.read()[:300]!r}')


def upsert(table, rows, on_conflict='id'):
    for i in range(0, len(rows), 200):
        http('POST', f'{table}?on_conflict={on_conflict}', rows[i:i + 200],
             {'Prefer': 'resolution=merge-duplicates,return=minimal'})
    return len(rows)


def select(table, query):
    return http('GET', f'{table}?{query}')


# ---------------------------------------------------------------- PHP unserialize (subset WP uses)
def php_unserialize(s):
    b = s.encode('utf-8')
    pos = 0

    def read_until(ch):
        nonlocal pos
        end = b.index(ch, pos)
        v = b[pos:end]
        pos = end + 1
        return v.decode()

    def val():
        nonlocal pos
        t = chr(b[pos]); pos += 2  # 'x:'
        if t == 'N':
            return None
        if t == 'b':
            return read_until(b';') == '1'
        if t == 'i':
            return int(read_until(b';'))
        if t == 'd':
            return float(read_until(b';'))
        if t == 's':
            n = int(read_until(b':'))
            pos += 1  # "
            v = b[pos:pos + n].decode('utf-8', 'replace'); pos += n + 2  # ";
            return v
        if t == 'a':
            n = int(read_until(b':')); pos += 1  # {
            items = [(val(), val()) for _ in range(n)]
            pos += 1  # }
            if all(isinstance(k, int) for k, _ in items) and [k for k, _ in items] == list(range(n)):
                return [v for _, v in items]
            return {str(k): v for k, v in items}
        if t == 'O':
            read_until(b':'); pos += 0
            n = int(read_until(b':'))  # class name len handled loosely
            raise ValueError('object')
        raise ValueError(t)

    v = val()
    return v


def maybe_unserialize(s):
    if not isinstance(s, str):
        return s
    if re.match(r'^(a|s|i|b|d|N):', s) or s == 'N;':
        try:
            return php_unserialize(s)
        except Exception:
            return s
    if s[:1] in '[{':
        try:
            return json.loads(s)
        except Exception:
            return s
    return s


def tz_gmt(s):
    return s.replace(' ', 'T') + 'Z' if s and not s.startswith('0000') else None


def tz_local(s):
    return s.replace(' ', 'T') + '+08:00' if s and not s.startswith('0000') else None


# ---------------------------------------------------------------- load
posts = {p['ID']: p for p in T('wp_posts')}
meta = {}
for m in T('wp_postmeta'):
    meta.setdefault(m['post_id'], {})[m['meta_key']] = m['meta_value']
terms = {t['term_id']: t for t in T('wp_terms')}
tax = T('wp_term_taxonomy')
tt_by_id = {x['term_taxonomy_id']: x for x in tax}
rels = {}
for r in T('wp_term_relationships'):
    rels.setdefault(r['object_id'], []).append(r['term_taxonomy_id'])
report = {}

existing_posts = {p['id']: p for p in select('posts', 'select=id,path,title,post_type&limit=10000')}
existing_terms = {t['id']: t for t in select('terms', 'select=id,path,name&limit=10000')}
author_ids = {a['id'] for a in select('authors', 'select=id')}

# ---------------------------------------------------------------- menus
menus_src = [x for x in tax if x['taxonomy'] == 'nav_menu']
# Elementor's nav-menu widget in the header template (11732) has no "menu" setting, so it falls back to
# the first menu returned by wp_get_nav_menus() (ordered by name) -> term 18 "456". Blocksy has no menu locations.
first_menu = sorted(menus_src, key=lambda x: terms[x['term_id']]['name'])[0]['term_id']
menu_rows = []
for x in menus_src:
    t = terms[x['term_id']]
    menu_rows.append({'id': t['term_id'], 'slug': urllib.parse.unquote(t['slug']), 'name': t['name'],
                      'location': 'header' if t['term_id'] == first_menu else None,
                      'source': f'wp nav_menu term {t["term_id"]} (wp_terms/nav_menu_item)'})
item_rows = []
for pid, p in posts.items():
    if p['post_type'] != 'nav_menu_item':
        continue
    mm = meta.get(pid, {})
    menu_tt = [tt_by_id[t] for t in rels.get(pid, []) if tt_by_id.get(t, {}).get('taxonomy') == 'nav_menu']
    if not menu_tt:
        continue
    kind = mm.get('_menu_item_type', 'custom')
    obj = mm.get('_menu_item_object') or 'custom'
    oid = int(mm.get('_menu_item_object_id') or 0) or None
    title = p['post_title']
    url = mm.get('_menu_item_url') or ''
    if kind == 'post_type' and oid:
        ep = existing_posts.get(oid)
        src = posts.get(oid, {})
        url = ep['path'] if ep else '/' + urllib.parse.unquote(src.get('post_name', '')) + '/'
        title = title or (ep['title'] if ep else src.get('post_title', ''))
    elif kind == 'taxonomy' and oid:
        et = existing_terms.get(oid)
        url = et['path'] if et else url
        title = title or (et['name'] if et else terms.get(oid, {}).get('name', ''))
    else:
        obj = 'custom'
        url = OLD_HOST_RE.sub('', url) or '/'
    classes = maybe_unserialize(mm.get('_menu_item_classes') or '')
    classes = [c for c in (classes if isinstance(classes, list) else []) if c]
    parent = int(mm.get('_menu_item_menu_item_parent') or 0) or None
    item_rows.append({'id': pid, 'menu_id': menu_tt[0]['term_id'], 'parent_id': parent, 'position': p['menu_order'],
                      'title': title, 'url': url, 'object_type': obj, 'object_id': oid,
                      'target': mm.get('_menu_item_target') or None, 'attr_title': p['post_excerpt'] or None,
                      'classes': classes})
# parents first so the self-FK holds
item_rows.sort(key=lambda r: (r['parent_id'] is not None, r['id']))
src_ids = [r['id'] for r in menu_rows]
# drop menus that are not WordPress menus (the HTML-inferred one), cascades to its items
stale = [m['id'] for m in select('menus', 'select=id') if m['id'] not in src_ids]
if stale:
    http('DELETE', f'menus?id=in.({",".join(map(str, stale))})', headers={'Prefer': 'return=minimal'})
upsert('menus', menu_rows)
upsert('menu_items', item_rows)
report['menus'] = (len(menu_rows), len(item_rows))

# ---------------------------------------------------------------- wp_block (reusable blocks)
blocks = []
for pid, p in posts.items():
    if p['post_type'] != 'wp_block':
        continue
    slug = urllib.parse.unquote(p['post_name']) or f'wp-block-{pid}'
    blocks.append({'id': pid, 'post_type': 'wp_block', 'slug': slug, 'wp_slug': p['post_name'] or slug,
                   'path': f'/{slug}/', 'title': p['post_title'], 'content_html': p['post_content'],
                   'content_raw': p['post_content'], 'status': p['post_status'] if p['post_status'] in (
                       'publish', 'draft', 'pending', 'private', 'future', 'trash') else 'draft',
                   'author_id': int(p['post_author']) if int(p['post_author']) in author_ids else None,
                   'date': tz_local(p['post_date']), 'date_gmt': tz_gmt(p['post_date_gmt']),
                   'modified': tz_local(p['post_modified']), 'modified_gmt': tz_gmt(p['post_modified_gmt']),
                   'meta': {'source': 'wp_block'}})
upsert('posts', blocks)
report['wp_block'] = len(blocks)

# ---------------------------------------------------------------- elementor_library templates
lib_type = {}
for oid, tts in rels.items():
    for t in tts:
        x = tt_by_id.get(t)
        if x and x['taxonomy'] == 'elementor_library_type':
            lib_type[oid] = terms[x['term_id']]['slug']
have_tpl = {t['id'] for t in select('templates', 'select=id')}
tpls = []
for pid, p in posts.items():
    if p['post_type'] != 'elementor_library' or pid in have_tpl:
        continue
    mm = meta.get(pid, {})
    data = {}
    for k in ('_elementor_data', '_elementor_page_settings'):
        if mm.get(k):
            data[k.lstrip('_')] = maybe_unserialize(mm[k])
    for k in ('_elementor_template_type', '_elementor_conditions', '_elementor_version'):
        if mm.get(k):
            data[k.lstrip('_')] = maybe_unserialize(mm[k])
    tpls.append({'id': pid, 'template_type': 'elementor_library', 'slug': urllib.parse.unquote(p['post_name']) or f'tpl-{pid}',
                 'title': p['post_title'], 'location': lib_type.get(pid) or mm.get('_elementor_template_type'),
                 'content_html': '', 'data': data,
                 'status': 'publish' if p['post_status'] == 'publish' else 'draft'})
upsert('templates', tpls)
report['elementor_library_total'] = sum(1 for p in posts.values() if p['post_type'] == 'elementor_library')

# ---------------------------------------------------------------- private attachments (metadata only)
priv = []
for pid, p in posts.items():
    if p['post_type'] != 'attachment' or p['post_status'] != 'private':
        continue
    mm = meta.get(pid, {})
    slug = urllib.parse.unquote(p['post_name']) or f'attachment-{pid}'
    priv.append({'id': pid, 'slug': slug, 'wp_slug': p['post_name'] or slug, 'title': p['post_title'],
                 'media_type': 'image' if (p['post_mime_type'] or '').startswith('image/') else 'file',
                 'mime_type': p['post_mime_type'] or 'application/octet-stream',
                 'original_mime': p['post_mime_type'] or 'application/octet-stream',
                 'old_url': p['guid'], 'storage_path': None, 'url': None,
                 'parent_post_id': p['post_parent'] or None, 'author_id': int(p['post_author']) or None,
                 'status': 'private', 'date': tz_local(p['post_date']), 'modified': tz_local(p['post_modified']),
                 'meta': {'wp_attached_file': mm.get('_wp_attached_file'), 'wp_attachment_context': mm.get('_wp_attachment_context'),
                          'note': 'private attachment on the old site; file not uploaded (metadata only)'}})
upsert('media', priv)
report['private_attachments'] = len(priv)

# ---------------------------------------------------------------- forms
def find_widget(o, eid):
    if isinstance(o, dict):
        if o.get('id') == eid:
            return o
        for v in o.values():
            r = find_widget(v, eid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find_widget(v, eid)
            if r:
                return r
    return None


subs = T('wp_e_submissions')
vals = T('wp_e_submissions_values')
logs = T('wp_e_submissions_actions_log')
form_keys = sorted({(s['element_id'], s['post_id'], s['form_name']) for s in subs})
existing_forms = {f['slug']: f['id'] for f in select('forms', 'select=id,slug')}
form_rows, form_id_by_el = [], {}
next_id = max([0] + list(existing_forms.values())) + 1
for eid, post_id, name in form_keys:
    src = posts.get(post_id, {})
    w = None
    if meta.get(post_id, {}).get('_elementor_data'):
        w = find_widget(json.loads(meta[post_id]['_elementor_data']), eid)
    st = (w or {}).get('settings', {})
    fields = [{'id': f.get('custom_id'), 'label': f.get('field_label') or f.get('placeholder') or f.get('custom_id'),
               'type': f.get('field_type') or 'text', 'required': f.get('required') == 'true',
               'placeholder': f.get('placeholder') or ''} for f in st.get('form_fields', [])]
    slug = f'elementor-{eid}'
    fid = existing_forms.get(slug) or next_id
    if fid == next_id:
        next_id += 1
    form_id_by_el[eid] = fid
    form_rows.append({'id': fid, 'slug': slug, 'name': f'{st.get("form_name") or name}（{src.get("post_title", post_id)}）',
                      'fields': fields,
                      'settings': {k: st.get(k) for k in ('success_message', 'button_text', 'email_to', 'email_subject', 'submit_actions') if st.get(k) is not None}
                      | {'wp_post_id': post_id, 'wp_post_status': src.get('post_status'), 'element_id': eid},
                      'is_active': False, 'source': f'elementor_pro (wp post {post_id})'})
for pid, p in posts.items():
    if p['post_type'] != 'wpforms':
        continue
    try:
        d = json.loads(p['post_content'])
    except Exception:
        d = {}
    fields = [{'id': str(f.get('id')), 'label': f.get('label') or '', 'type': f.get('type') or 'text',
               'required': f.get('required') == '1'} for f in (d.get('fields') or {}).values()]
    slug = f'wpforms-{pid}'
    fid = existing_forms.get(slug) or next_id
    if fid == next_id:
        next_id += 1
    form_rows.append({'id': fid, 'slug': slug, 'name': p['post_title'], 'fields': fields,
                      'settings': {'wp_post_id': pid, 'note': 'WPForms Lite form; Lite does not store entries'},
                      'is_active': False, 'source': f'wpforms (wp post {pid})'})
upsert('forms', form_rows)
report['forms'] = len(form_rows)

vals_by_sub = {}
for v in sorted(vals, key=lambda v: v['id']):
    vals_by_sub.setdefault(v['submission_id'], []).append(v)
logs_by_sub = {}
for a in logs:
    logs_by_sub.setdefault(a['submission_id'], []).append(a)
sub_rows = []
for s in subs:
    ref = s['referer'] or ''
    path = urllib.parse.unquote(urllib.parse.urlparse(ref).path) if ref else None
    sub_rows.append({'form_id': form_id_by_el[s['element_id']], 'wp_id': s['id'],
                     'data': {v['key']: v['value'] for v in vals_by_sub.get(s['id'], [])},
                     'page_path': path, 'ip': s['user_ip'] or None, 'user_agent': s['user_agent'] or None,
                     'status': 'read' if str(s['is_read']) == '1' else 'new',
                     'created_at': tz_gmt(s['created_at_gmt']),
                     'meta': {'referer': ref, 'referer_title': s['referer_title'], 'element_id': s['element_id'],
                              'wp_post_id': s['post_id'], 'hash_id': s['hash_id'], 'wp_status': s['status'],
                              'actions': [{'name': a['action_name'], 'label': a['action_label'], 'status': a['status'],
                                           'log': a['log'], 'at': tz_gmt(a['created_at_gmt'])} for a in logs_by_sub.get(s['id'], [])]}})
upsert('form_submissions', sub_rows, on_conflict='wp_id')
report['form_submissions'] = len(sub_rows)
report['form_submission_values'] = sum(len(r['data']) for r in sub_rows)
report['form_submission_actions'] = sum(len(r['meta']['actions']) for r in sub_rows)

# ---------------------------------------------------------------- options (front-end related settings only)
CORE = {'siteurl', 'home', 'blogname', 'blogdescription', 'admin_email_lifespan', 'start_of_week', 'date_format',
        'time_format', 'posts_per_page', 'posts_per_rss', 'rss_use_excerpt', 'permalink_structure', 'category_base',
        'tag_base', 'show_on_front', 'page_on_front', 'page_for_posts', 'WPLANG', 'timezone_string', 'gmt_offset',
        'default_comment_status', 'default_ping_status', 'comment_registration', 'comments_per_page', 'thread_comments',
        'thread_comments_depth', 'page_comments', 'comment_order', 'default_comments_page', 'show_avatars',
        'avatar_default', 'avatar_rating', 'sticky_posts', 'blog_public', 'template', 'stylesheet', 'current_theme',
        'site_icon', 'thumbnail_size_w', 'thumbnail_size_h', 'medium_size_w', 'medium_size_h', 'large_size_w',
        'large_size_h', 'medium_large_size_w', 'medium_large_size_h', 'uploads_use_yearmonth_folders',
        'sidebars_widgets', 'nav_menu_options', 'theme_mods_blocksy', 'show_comments_cookies_opt_in', 'wp_page_for_privacy_policy'}
PREFIX = ('woocommerce_', 'wc_', 'wpseo', 'elementor_', 'blocksy', 'cht_', 'chaty', 'widget_', 'wpforms_settings')
SECRET = re.compile(r'(key|secret|token|licen[sc]e|pass|salt|nonce|hash|api|auth|cookie|session|private|webhook|tracker|tracking|email_from|_admin_email)', re.I)
opt_rows, opt_skipped_secret = [], 0
for o in T('wp_options'):
    n = o['option_name']
    if not (n in CORE or n.startswith(PREFIX)):
        continue
    if n not in CORE and SECRET.search(n):
        opt_skipped_secret += 1
        continue
    src = 'wp_core' if n in CORE else n.split('_')[0].lower().rstrip('-')
    opt_rows.append({'option_name': n, 'option_value': maybe_unserialize(o['option_value']),
                     'autoload': str(o['autoload']).lower() in ('yes', 'on', 'auto', 'auto-on', '1', 'true'),
                     'source': src})
upsert('options', opt_rows, on_conflict='option_name')
report['options'] = len(opt_rows)
report['options_skipped_secret_like'] = opt_skipped_secret

# ---------------------------------------------------------------- source counts that have no target (expected 0)
report['source_zero'] = {
    'shop_order_posts': sum(1 for p in posts.values() if p['post_type'] in ('shop_order', 'shop_order_placehold')),
    'hpos_orders': len(T('wp_wc_orders')),
    'shop_coupon': sum(1 for p in posts.values() if p['post_type'] == 'shop_coupon'),
    'ywdpd_discount': sum(1 for p in posts.values() if p['post_type'] == 'ywdpd_discount'),
    'product': sum(1 for p in posts.values() if p['post_type'] in ('product', 'product_variation')),
    'wc_customer_lookup': len(T('wp_wc_customer_lookup')),
    'non_admin_users': None,
    'comments': len(T('wp_comments')),
    'post_passwords': sum(1 for p in posts.values() if p['post_password'] and p['post_type'] in ('post', 'page')),
    'chaty_leads': len(T('wp_chaty_contact_form_leads')),
}
caps = [m for m in T('wp_usermeta') if m['meta_key'].endswith('capabilities')]
report['source_zero']['non_admin_users'] = sum(1 for m in caps if 'administrator' not in (m['meta_value'] or ''))
print(json.dumps(report, ensure_ascii=False))
