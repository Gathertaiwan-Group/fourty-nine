import Link from 'next/link';
import { listRedirects } from '@/lib/cms/site';
import { ActionForm } from '../../components/ActionForm';
import { ConfirmSubmit } from '../../components/ConfirmSubmit';
import { deleteRedirect, saveRedirect } from '../actions';

export const metadata = { title: '轉址管理' };
const PER = 50;
const KIND: Record<string, string> = { attachment: '附件頁', manual: '手動', legacy: '舊網址' };

export default async function RedirectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p || 1));
  const { items, total } = await listRedirects({ q: sp.q, kind: sp.kind, limit: PER, offset: (page - 1) * PER });
  const editing = sp.edit ? (items as any[]).find((r) => r.id === Number(sp.edit)) : undefined;
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, kind: sp.kind, p: page, ...o })) if (v !== undefined && v !== '' && v !== 1) u.set(k, String(v));
    return `/admin/redirects/?${u}`;
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">轉址管理</h1>
      <ActionForm key={editing?.id ?? 'new'} action={saveRedirect} className="card grid gap-3 md:grid-cols-[1fr_1fr_120px]" submit={editing ? '更新轉址' : '新增轉址'} resetOnSuccess={!editing}>
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        <div>
          <label className="label">來源路徑（舊網址）</label>
          <input className="input" name="source_path" defaultValue={editing?.source_path} placeholder="/old-page/" required />
        </div>
        <div>
          <label className="label">目標（路徑或完整網址；410 可留空）</label>
          <input className="input" name="target" defaultValue={editing?.target} placeholder="/new-page/" />
        </div>
        <div>
          <label className="label">狀態碼</label>
          <select className="input" name="status_code" defaultValue={editing?.status_code ?? 301}>
            <option value="301">301 永久</option>
            <option value="302">302 暫時</option>
            <option value="307">307</option>
            <option value="308">308</option>
            <option value="410">410 已移除</option>
          </select>
        </div>
      </ActionForm>
      <form className="flex flex-wrap gap-2">
        <select className="input !w-32" name="kind" defaultValue={sp.kind ?? ''}>
          <option value="">所有類型</option>
          {Object.entries(KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className="input !w-64" name="q" defaultValue={sp.q} placeholder="搜尋路徑" />
        <button className="btn">篩選</button>
        <span className="self-center text-xs text-gray-500">共 {total} 筆</span>
      </form>
      <table className="table">
        <thead>
          <tr>
            <th>來源</th>
            <th>目標</th>
            <th>狀態碼</th>
            <th>類型</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(items as any[]).map((r) => (
            <tr key={r.id}>
              <td className="text-xs break-all">{r.source_path}</td>
              <td className="max-w-xs text-xs break-all">{r.target}</td>
              <td>{r.status_code}</td>
              <td className="text-xs">{KIND[r.kind] ?? r.kind}</td>
              <td className="whitespace-nowrap text-xs">
                <Link href={qs({ edit: r.id })} className="mr-2 text-[#2271b1]">
                  編輯
                </Link>
                <form action={deleteRedirect} className="inline">
                  <input type="hidden" name="id" value={r.id} />
                  <ConfirmSubmit message="刪除這條轉址？舊網址將變成 404。" className="text-red-600">
                    刪除
                  </ConfirmSubmit>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 text-sm">
        {page > 1 ? (
          <Link className="btn" href={qs({ p: page - 1, edit: undefined })}>
            ‹ 上一頁
          </Link>
        ) : null}
        <span>
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link className="btn" href={qs({ p: page + 1, edit: undefined })}>
            下一頁 ›
          </Link>
        ) : null}
      </div>
    </div>
  );
}
