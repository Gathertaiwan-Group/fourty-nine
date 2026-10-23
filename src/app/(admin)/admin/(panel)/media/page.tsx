import Link from 'next/link';
import { getMediaItem, listMedia } from '@/lib/cms/media';
import { ActionForm } from '../../components/ActionForm';
import { ConfirmSubmit } from '../../components/ConfirmSubmit';
import { Uploader } from '../../components/Uploader';
import { deleteMedia, saveMedia } from '../actions';

export const metadata = { title: '媒體庫' };
const PER = 60;
const kb = (n: number | null) => (n == null ? '—' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p || 1));
  const type = sp.type === 'image' || sp.type === 'file' ? sp.type : '';
  const [{ items, total }, sel] = await Promise.all([listMedia({ q: sp.q, type, limit: PER, offset: (page - 1) * PER }), sp.id ? getMediaItem(Number(sp.id)) : null]);
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, type, p: page, ...o })) if (v !== undefined && v !== '' && v !== 1) u.set(k, String(v));
    return `/admin/media/?${u}`;
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">媒體庫</h1>
      <Uploader />
      <form className="flex flex-wrap gap-2">
        <select name="type" defaultValue={type} className="input !w-32">
          <option value="">全部</option>
          <option value="image">圖片</option>
          <option value="file">影片／文件</option>
        </select>
        <input className="input !w-56" name="q" defaultValue={sp.q} placeholder="搜尋媒體" />
        <button className="btn">篩選</button>
        <span className="self-center text-xs text-gray-500">共 {total} 個項目</span>
      </form>
      <div className={`grid gap-4 ${sel ? 'lg:grid-cols-[1fr_340px]' : ''}`}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-8">
          {items.map((m) => (
            <Link key={m.id} href={qs({ id: m.id })} scroll={false} className={`aspect-square overflow-hidden rounded border bg-white ${sel?.id === m.id ? 'ring-2 ring-[#2271b1]' : ''}`} title={m.title}>
              {m.mime_type.startsWith('image/') && m.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.alt_text || m.title} loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center p-2 text-center text-xs break-all">
                  {m.mime_type}
                  <br />
                  {m.title}
                </span>
              )}
            </Link>
          ))}
        </div>
        {sel ? (
          <div className="card h-fit space-y-3">
            {sel.mime_type.startsWith('image/') && sel.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sel.url} alt="" className="w-full rounded border" />
            ) : sel.mime_type.startsWith('video/') && sel.url ? (
              <video src={sel.url} controls className="w-full" />
            ) : null}
            <dl className="grid grid-cols-[80px_1fr] gap-1 text-xs">
              <dt className="text-gray-500">ID</dt>
              <dd>{sel.id}</dd>
              <dt className="text-gray-500">類型</dt>
              <dd>{sel.mime_type}</dd>
              <dt className="text-gray-500">尺寸</dt>
              <dd>{sel.width ? `${sel.width} × ${sel.height}` : '—'}</dd>
              <dt className="text-gray-500">大小</dt>
              <dd>{kb(sel.bytes)}</dd>
              <dt className="text-gray-500">網址</dt>
              <dd className="break-all">
                <a href={sel.url ?? '#'} target="_blank" className="text-[#2271b1]">
                  {sel.url}
                </a>
              </dd>
            </dl>
            <ActionForm key={sel.id} action={saveMedia} className="space-y-2">
              <input type="hidden" name="id" value={sel.id} />
              <div>
                <label className="label">替代文字（alt）</label>
                <input className="input" name="alt_text" defaultValue={sel.alt_text} />
              </div>
              <div>
                <label className="label">標題</label>
                <input className="input" name="title" defaultValue={sel.title} />
              </div>
              <div>
                <label className="label">說明文字</label>
                <textarea className="input h-16" name="caption_html" defaultValue={sel.caption_html} />
              </div>
            </ActionForm>
            <form action={deleteMedia} className="border-t pt-2">
              <input type="hidden" name="id" value={sel.id} />
              <ConfirmSubmit message="永久刪除此檔案？已使用此檔案的頁面將無法顯示它。" className="text-xs text-red-600 underline">
                永久刪除
              </ConfirmSubmit>
            </form>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-sm">
        {page > 1 ? (
          <Link className="btn" href={qs({ p: page - 1, id: undefined })}>
            ‹ 上一頁
          </Link>
        ) : null}
        <span>
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link className="btn" href={qs({ p: page + 1, id: undefined })}>
            下一頁 ›
          </Link>
        ) : null}
      </div>
    </div>
  );
}
