'use client';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Editor } from '@tinymce/tinymce-react';
import { savePost, savePreview, trashPost, type EditorFields } from '../(panel)/actions';
import { MediaPicker } from './MediaPicker';
import { uploadFile } from './upload';

const TINYMCE = 'https://cdn.jsdelivr.net/npm/tinymce@8.9.3/tinymce.min.js';
const TINYMCE_LANG = 'https://cdn.jsdelivr.net/npm/tinymce-i18n@26.9.28/langs8/zh-TW.js';

type Term = { id: number; taxonomy: string; name: string; parent_id: number | null };
export type EditorPost = {
  id?: number;
  post_type: 'post' | 'page';
  title: string;
  slug: string;
  path: string;
  content_html: string;
  excerpt_html: string;
  status: string;
  date: string | null;
  author_id: number | null;
  featured_media_id: number | null;
  featured_url?: string | null;
  parent_id: number | null;
  menu_order: number;
  seo_title: string;
  seo_description: string;
  category_ids: number[];
  tag_ids: number[];
};

const STATUS_LABEL: Record<string, string> = { publish: '已發布', draft: '草稿', pending: '待審', private: '私密', future: '已排程', trash: '回收桶' };

/** ISO -> value for <input type="datetime-local"> in Taiwan time. */
function toLocal(iso: string | null) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return d.toISOString().slice(0, 16);
}
function fromLocal(v: string) {
  return v ? new Date(`${v}:00+08:00`).toISOString() : null;
}

export function PostEditor({
  initial,
  terms,
  authors,
  pages,
}: {
  initial: EditorPost;
  terms: Term[];
  authors: { id: number; display_name: string }[];
  pages: { id: number; title: string; path: string }[];
}) {
  const router = useRouter();
  const [p, setP] = useState<EditorPost>(initial);
  const [dateLocal, setDateLocal] = useState(toLocal(initial.status === 'future' ? initial.date : initial.date && initial.status === 'publish' ? initial.date : null));
  const [dateTouched, setDateTouched] = useState(false);
  const elementor = /elementor-/.test(initial.content_html);
  const [mode, setMode] = useState<'visual' | 'html'>(elementor ? 'html' : 'visual');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<any>(null);
  const label = p.post_type === 'page' ? '頁面' : '文章';
  const isLive = p.status === 'publish' || p.status === 'future' || p.status === 'private';
  const scheduled = !!dateLocal && new Date(fromLocal(dateLocal)!).getTime() > Date.now();

  const set = <K extends keyof EditorPost>(k: K, v: EditorPost[K]) => {
    setP((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const fields = (status?: string): EditorFields => ({
    id: p.id,
    post_type: p.post_type,
    title: p.title,
    slug: p.slug,
    content_html: p.content_html,
    excerpt_html: p.excerpt_html,
    status: (status ?? p.status) as EditorFields['status'],
    date: dateTouched ? fromLocal(dateLocal) : undefined,
    author_id: p.author_id,
    featured_media_id: p.featured_media_id,
    parent_id: p.post_type === 'page' ? p.parent_id : undefined,
    menu_order: p.menu_order,
    seo_title: p.seo_title,
    seo_description: p.seo_description,
    category_ids: p.post_type === 'post' ? p.category_ids : undefined,
    tag_ids: p.post_type === 'post' ? p.tag_ids : undefined,
  });

  async function save(status: string, okText: string) {
    setBusy(true);
    setMsg(null);
    const r = await savePost(fields(status));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setDirty(false);
    setDateTouched(false);
    setP((prev) => ({ ...prev, id: r.data.id, status: r.data.status, path: r.data.path, slug: r.data.slug }));
    setMsg({ ok: true, text: r.data.status === 'future' ? `已排程，將於 ${dateLocal.replace('T', ' ')} 發布。` : okText });
    if (!p.id) router.replace(`/admin/posts/${r.data.id}/`);
    else router.refresh();
  }

  async function preview() {
    const w = window.open('about:blank', 'fd-preview');
    setBusy(true);
    const r = await savePreview(fields());
    setBusy(false);
    if (!r.ok) {
      w?.close();
      return setMsg({ ok: false, text: r.error });
    }
    if (!p.id) setP((prev) => ({ ...prev, id: r.data.id }));
    if (w) w.location.href = `/admin/preview/${r.data.id}/?autosave=1`;
    if (!p.id) router.replace(`/admin/posts/${r.data.id}/`);
  }

  const cats = useMemo(() => {
    const list = terms.filter((t) => t.taxonomy === 'category');
    const out: { t: Term; depth: number }[] = [];
    const walk = (pid: number | null, depth: number) => {
      for (const t of list.filter((x) => x.parent_id === pid)) {
        out.push({ t, depth });
        walk(t.id, depth + 1);
      }
    };
    walk(null, 0);
    for (const t of list) if (!out.some((o) => o.t.id === t.id)) out.push({ t, depth: 0 });
    return out;
  }, [terms]);
  const tags = terms.filter((t) => t.taxonomy === 'post_tag');
  const [tagQ, setTagQ] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-normal">{p.id ? `編輯${label}` : `新增${label}`}</h1>
        {p.id && p.status === 'publish' ? (
          <a className="btn" href={p.path} target="_blank">
            檢視{label}
          </a>
        ) : null}
      </div>
      {msg ? <div className={`notice ${msg.ok ? '' : 'notice-error'}`}>{msg.text}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <input className="input !py-2 !text-xl" placeholder="新增標題" value={p.title} onChange={(e) => set('title', e.target.value)} />
          <div className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
            固定網址：<span>{p.path ? p.path.replace(/[^/]+\/$/, '') : p.post_type === 'page' ? '/' : '/'}</span>
            <input className="input !w-64 !py-0.5 !text-xs" placeholder="(自動依標題產生)" value={p.slug} onChange={(e) => set('slug', e.target.value)} />/
          </div>
          <div className="card !p-0">
            <div className="flex items-center justify-end gap-1 border-b px-2 py-1 text-xs">
              {elementor ? <span className="mr-auto text-amber-700">此內容由 Elementor 產生；建議用 HTML 模式編輯以保留版面結構。</span> : null}
              <button type="button" className={`rounded px-2 py-1 ${mode === 'visual' ? 'bg-gray-200' : ''}`} onClick={() => setMode('visual')}>
                視覺化
              </button>
              <button type="button" className={`rounded px-2 py-1 ${mode === 'html' ? 'bg-gray-200' : ''}`} onClick={() => setMode('html')}>
                HTML
              </button>
            </div>
            {mode === 'visual' ? (
              <Editor
                tinymceScriptSrc={TINYMCE}
                licenseKey="gpl"
                onInit={(_e, ed) => (editorRef.current = ed)}
                value={p.content_html}
                onEditorChange={(v) => set('content_html', v)}
                init={{
                  language: 'zh-TW',
                  language_url: TINYMCE_LANG,
                  height: 620,
                  menubar: 'edit view insert format table tools',
                  plugins: 'advlist autolink lists link image charmap preview anchor searchreplace visualblocks code fullscreen insertdatetime media table wordcount',
                  toolbar:
                    'undo redo | blocks | bold italic underline strikethrough forecolor backcolor | alignleft aligncenter alignright | bullist numlist outdent indent | link image media table | removeformat code fullscreen',
                  promotion: false,
                  branding: false,
                  valid_elements: '*[*]',
                  extended_valid_elements: '*[*]',
                  valid_children: '+body[style|script],+div[style|script]',
                  verify_html: false,
                  convert_urls: false,
                  relative_urls: false,
                  remove_script_host: false,
                  entity_encoding: 'raw',
                  image_advtab: true,
                  image_caption: true,
                  automatic_uploads: true,
                  images_upload_handler: async (blob: any) => {
                    const file = new File([blob.blob()], blob.filename(), { type: blob.blob().type });
                    const m = await uploadFile(file);
                    return m.url;
                  },
                  content_style: 'body{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;font-size:16px;line-height:1.8;max-width:900px;margin:1rem auto} img{max-width:100%;height:auto}',
                }}
              />
            ) : (
              <textarea
                className="block h-[620px] w-full resize-y p-3 font-mono text-xs focus:outline-none"
                value={p.content_html}
                onChange={(e) => set('content_html', e.target.value)}
                spellCheck={false}
              />
            )}
          </div>
          {p.post_type === 'post' ? (
            <div className="card">
              <label className="label">摘要</label>
              <textarea className="input h-24" value={p.excerpt_html} onChange={(e) => set('excerpt_html', e.target.value)} />
            </div>
          ) : null}
          <div className="card space-y-3">
            <h2 className="font-semibold">SEO（Yoast）</h2>
            <div>
              <label className="label">SEO 標題（留空使用預設）</label>
              <input className="input" value={p.seo_title} onChange={(e) => set('seo_title', e.target.value)} />
            </div>
            <div>
              <label className="label">Meta 描述</label>
              <textarea className="input h-20" value={p.seo_description} onChange={(e) => set('seo_description', e.target.value)} />
              <div className="mt-1 text-xs text-gray-500">{p.seo_description.length} 字</div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-semibold">發布</h2>
            <div className="text-sm">
              狀態：<strong>{STATUS_LABEL[p.status] ?? p.status}</strong>
              {dirty ? <span className="ml-2 text-xs text-amber-700">（有未儲存的變更）</span> : null}
            </div>
            <div>
              <label className="label">發布時間（台灣時間；設定未來時間即為排程）</label>
              <input type="datetime-local" className="input" value={dateLocal} onChange={(e) => (setDateLocal(e.target.value), setDateTouched(true), setDirty(true))} />
              {!dateLocal ? <div className="mt-1 text-xs text-gray-500">留空 = 立即發布</div> : null}
            </div>
            {authors.length ? (
              <div>
                <label className="label">作者</label>
                <select className="input" value={p.author_id ?? ''} onChange={(e) => set('author_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">—</option>
                  {authors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.display_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!isLive ? (
                <button className="btn" disabled={busy} onClick={() => save('draft', '草稿已儲存。')}>
                  儲存草稿
                </button>
              ) : null}
              <button className="btn" disabled={busy} onClick={preview}>
                預覽
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              {p.id ? (
                <form
                  action={async (fd) => {
                    if (!confirm(`確定將此${label}移至回收桶？`)) return;
                    await trashPost(fd);
                    router.push(`/admin/posts/?type=${p.post_type}`);
                  }}
                >
                  <input type="hidden" name="id" value={p.id} />
                  <button className="text-xs text-red-600 underline">移至回收桶</button>
                </form>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                {isLive ? (
                  <button className="btn" disabled={busy} onClick={() => save('draft', '已切換為草稿。')}>
                    切換為草稿
                  </button>
                ) : null}
                <button className="btn btn-primary" disabled={busy} onClick={() => save(scheduled ? 'future' : p.status === 'private' ? 'private' : 'publish', isLive ? `${label}已更新。` : `${label}已發布。`)}>
                  {scheduled ? (p.status === 'future' ? '更新排程' : '排程') : isLive ? '更新' : '發布'}
                </button>
              </div>
            </div>
          </div>

          {p.post_type === 'page' ? (
            <div className="card space-y-3">
              <h2 className="font-semibold">頁面屬性</h2>
              <div>
                <label className="label">上層頁面</label>
                <select className="input" value={p.parent_id ?? ''} onChange={(e) => set('parent_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">（無上層）</option>
                  {pages
                    .filter((x) => x.id !== p.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title || x.path}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="label">排序</label>
                <input type="number" className="input" value={p.menu_order} onChange={(e) => set('menu_order', Number(e.target.value) || 0)} />
              </div>
            </div>
          ) : (
            <>
              <div className="card">
                <h2 className="mb-2 font-semibold">分類</h2>
                <div className="max-h-56 space-y-1 overflow-auto text-sm">
                  {cats.map(({ t, depth }) => (
                    <label key={t.id} className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                      <input
                        type="checkbox"
                        checked={p.category_ids.includes(t.id)}
                        onChange={(e) => set('category_ids', e.target.checked ? [...p.category_ids, t.id] : p.category_ids.filter((x) => x !== t.id))}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="card">
                <h2 className="mb-2 font-semibold">標籤</h2>
                <div className="mb-2 flex flex-wrap gap-1">
                  {p.tag_ids.map((id) => (
                    <span key={id} className="badge">
                      {tags.find((t) => t.id === id)?.name ?? id}{' '}
                      <button onClick={() => set('tag_ids', p.tag_ids.filter((x) => x !== id))} aria-label="移除">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <input className="input" placeholder="搜尋標籤後點選加入" value={tagQ} onChange={(e) => setTagQ(e.target.value)} />
                {tagQ ? (
                  <div className="mt-1 max-h-40 overflow-auto rounded border text-sm">
                    {tags
                      .filter((t) => t.name.toLowerCase().includes(tagQ.toLowerCase()) && !p.tag_ids.includes(t.id))
                      .slice(0, 20)
                      .map((t) => (
                        <button key={t.id} className="block w-full px-2 py-1 text-left hover:bg-gray-100" onClick={() => (set('tag_ids', [...p.tag_ids, t.id]), setTagQ(''))}>
                          {t.name}
                        </button>
                      ))}
                  </div>
                ) : null}
                <a className="mt-2 block text-xs text-[#2271b1]" href="/admin/terms/" target="_blank">
                  管理分類與標籤 →
                </a>
              </div>
            </>
          )}

          <div className="card">
            <h2 className="mb-2 font-semibold">精選圖片</h2>
            {p.featured_media_id && p.featured_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.featured_url} alt="" className="mb-2 w-full rounded border" />
            ) : null}
            <div className="flex gap-3 text-sm">
              <button className="text-[#2271b1] underline" onClick={() => setPicker(true)}>
                {p.featured_media_id ? '更換精選圖片' : '設定精選圖片'}
              </button>
              {p.featured_media_id ? (
                <button className="text-red-600 underline" onClick={() => (set('featured_media_id', null), set('featured_url', null))}>
                  移除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <MediaPicker
        open={picker}
        onClose={() => setPicker(false)}
        onSelect={(m) => {
          set('featured_media_id', m.id);
          set('featured_url', m.url);
          setPicker(false);
        }}
      />
    </div>
  );
}
