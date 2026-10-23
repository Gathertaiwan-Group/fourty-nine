import Link from 'next/link';
import { listAuthors, listPosts, STATUS_LABEL, statusCounts } from '@/lib/cms/posts';
import { deletePostForever, restorePost, trashPost } from '../actions';
import { ConfirmSubmit } from '../../components/ConfirmSubmit';

export const metadata = { title: '文章' };
const PER = 20;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—');

export default async function PostsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const type = sp.type === 'page' ? 'page' : 'post';
  const status = sp.status || 'all';
  const page = Math.max(1, Number(sp.p || 1));
  const [{ items, total }, counts, authors] = await Promise.all([
    listPosts({ post_type: type, status, q: sp.q, limit: PER, offset: (page - 1) * PER }),
    statusCounts(type),
    listAuthors(),
  ]);
  const label = type === 'page' ? '頁面' : '文章';
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const all = { type, status, q: sp.q, ...o };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== '' && !(k === 'status' && v === 'all')) u.set(k, String(v));
    return `/admin/posts/?${u}`;
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-normal">{label}</h1>
        <Link className="btn" href={`/admin/posts/new/?type=${type}`}>
          新增{label}
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-sm">
          {['all', 'publish', 'future', 'draft', 'pending', 'private', 'trash'].map((s) =>
            s === 'all' || counts[s] ? (
              <Link key={s} href={qs({ status: s, p: undefined })} className={status === s ? 'font-semibold text-black' : 'text-[#2271b1]'}>
                {s === 'all' ? '全部' : STATUS_LABEL[s]} ({counts[s] ?? 0})
              </Link>
            ) : null,
          )}
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="type" value={type} />
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          <input className="input w-56" name="q" defaultValue={sp.q} placeholder={`搜尋${label}`} />
          <button className="btn">搜尋</button>
        </form>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>標題</th>
            {type === 'post' ? <th className="max-md:hidden">作者</th> : null}
            <th>狀態</th>
            <th className="max-md:hidden">日期</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="group">
              <td>
                <Link href={`/admin/posts/${p.id}/`} className="font-semibold text-[#2271b1] hover:underline">
                  {p.title || '(無標題)'}
                </Link>
                <div className="text-xs text-gray-500">{p.path}</div>
                <div className="mt-1 flex gap-3 text-xs opacity-80 group-hover:opacity-100">
                  {p.status === 'trash' ? (
                    <>
                      <form action={restorePost}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-[#2271b1]">還原</button>
                      </form>
                      <form action={deletePostForever}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="type" value={type} />
                        <ConfirmSubmit message="永久刪除後無法復原，確定嗎？" className="text-red-600">
                          永久刪除
                        </ConfirmSubmit>
                      </form>
                    </>
                  ) : (
                    <>
                      <Link href={`/admin/posts/${p.id}/`} className="text-[#2271b1]">
                        編輯
                      </Link>
                      <form action={trashPost}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-red-600">移至回收桶</button>
                      </form>
                      {p.status === 'publish' ? (
                        <a href={p.path} target="_blank" className="text-[#2271b1]">
                          檢視
                        </a>
                      ) : (
                        <a href={`/admin/preview/${p.id}/`} target="_blank" className="text-[#2271b1]">
                          預覽
                        </a>
                      )}
                    </>
                  )}
                </div>
              </td>
              {type === 'post' ? <td className="max-md:hidden">{authors.find((a) => a.id === p.author_id)?.display_name ?? '—'}</td> : null}
              <td>
                <span className="badge">{STATUS_LABEL[p.status] ?? p.status}</span>
              </td>
              <td className="text-xs max-md:hidden">
                {p.status === 'publish' ? '已發布' : p.status === 'future' ? '排程於' : '最後修改'}
                <br />
                {fmt(p.status === 'publish' || p.status === 'future' ? p.date : p.modified)}
              </td>
            </tr>
          ))}
          {!items.length ? (
            <tr>
              <td colSpan={4} className="text-gray-500">
                找不到{label}。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-sm">
        <span>共 {total} 項</span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link className="btn" href={qs({ p: page - 1 })}>
              ‹ 上一頁
            </Link>
          ) : null}
          <span className="px-2 py-1.5">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link className="btn" href={qs({ p: page + 1 })}>
              下一頁 ›
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
