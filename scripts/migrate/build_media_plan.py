"""Build the media upload plan from export/ (no network). Usage: python3 build_media_plan.py <export_dir> <out.json>"""
import json, re, sys, hashlib, os, urllib.parse
exp, out = sys.argv[1], sys.argv[2]
media = json.load(open(os.path.join(exp, 'rest/media.json')))
idx = json.load(open(os.path.join(exp, 'media/index.json')))['items']

def norm(u):
    u = u.strip()
    if u.startswith('//'): u = 'https:' + u
    u = u.replace('http://', 'https://').replace('://www.', '://')
    return urllib.parse.unquote(u)

by_url = {norm(i['url']): i for i in idx if i['status'] == 200}
SAFE = re.compile(r'^[A-Za-z0-9._()\-]+$')
CONVERT = {'image/jpeg', 'image/png'}

def safe_name(stem, ext):
    if SAFE.match(stem):
        return stem + ext
    ascii_part = re.sub(r'[^A-Za-z0-9._()\-]+', '-', stem).strip('-')
    h = hashlib.md5(stem.encode('utf-8')).hexdigest()[:8]
    return (ascii_part + '-' if ascii_part else '') + h + ext

plan, by_sha, used_keys = [], {}, {}
for m in sorted(media, key=lambda x: x['id']):
    src = norm(m['source_url'])
    orig = re.sub(r'-scaled(\.\w+)$', r'\1', src)
    f = by_url.get(orig) or by_url.get(src)
    if not f:
        plan.append({'id': m['id'], 'error': 'no local file', 'source_url': m['source_url']}); continue
    rel = orig.split('/wp-content/uploads/', 1)[1]
    d, fn = rel.rsplit('/', 1) if '/' in rel else ('', rel)
    stem, ext = os.path.splitext(fn)
    mime = m['mime_type']
    convert = mime in CONVERT
    new_ext = '.webp' if convert else ext.lower()
    key = '/'.join(x for x in ('uploads', d, safe_name(stem, new_ext)) if x)
    entry = {'id': m['id'], 'local': os.path.join(exp, f['local']), 'sha1': f['sha1'],
             'original_bytes': f['bytes'], 'old_url': m['source_url'], 'orig_url': orig,
             'original_mime': mime, 'convert': convert,
             'content_type': 'image/webp' if convert else mime}
    if f['sha1'] in by_sha:
        entry['duplicate_of'] = by_sha[f['sha1']]; entry['key'] = next(p['key'] for p in plan if p['id'] == by_sha[f['sha1']])
    else:
        if key in used_keys:  # e.g. foo.jpg and foo.png in same folder
            key = key[:-len(new_ext)] + '-' + ext.lstrip('.').lower() + new_ext
        used_keys[key] = m['id']; by_sha[f['sha1']] = m['id']; entry['key'] = key
    plan.append(entry)
json.dump(plan, open(out, 'w'), ensure_ascii=False, indent=0)
print('items', len(plan), 'errors', sum(1 for p in plan if 'error' in p),
      'duplicates', sum(1 for p in plan if 'duplicate_of' in p),
      'unique uploads', len(used_keys), 'convert', sum(1 for p in plan if p.get('convert') and 'duplicate_of' not in p))
