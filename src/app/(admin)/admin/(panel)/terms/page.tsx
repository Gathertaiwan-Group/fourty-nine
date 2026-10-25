import { requireAdmin } from '@/lib/admin/auth';
import Link from 'next/link';
import { listTerms } from '@/lib/cms/terms';
import { ActionForm } from '../../components/ActionForm';
import { ConfirmSubmit } from '../../components/ConfirmSubmit';
import { deleteTerm, saveTerm } from '../actions';

export const metadata = { title: '分類與標籤' };

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ tax?: string; edit?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tax = sp.tax === 'post_tag' ? 'post_tag' : 'category';
  const all = await listTerms(tax);
  const editing = sp.edit ? all.find((t) => t.id === Number(sp.edit)) : undefined;
  const label = tax === 'category' ? '分類' : '標籤';
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">分類與標籤</h1>
      <div className="flex gap-3 text-sm">
        <Link href="/admin/terms/?tax=category" className={tax === 'category' ? 'font-semibold' : 'text-[#2271b1]'}>
          分類
        </Link>
        <Link href="/admin/terms/?tax=post_tag" className={tax === 'post_tag' ? 'font-semibold' : 'text-[#2271b1]'}>
          標籤
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <ActionForm key={editing?.id ?? 'new'} action={saveTerm} className="card space-y-3" submit={editing ? `更新${label}` : `新增${label}`} resetOnSuccess={!editing}>
          <h2 className="font-semibold">{editing ? `編輯${label}` : `新增${label}`}</h2>
          <input type="hidden" name="taxonomy" value={tax} />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div>
            <label className="label">名稱</label>
            <input className="input" name="name" defaultValue={editing?.name} required />
          </div>
          <div>
            <label className="label">代稱（網址用，留空自動產生）</label>
            <input className="input" name="slug" defaultValue={editing?.slug} />
          </div>
          {tax === 'category' ? (
            <div>
              <label className="label">上層分類</label>
              <select className="input" name="parent_id" defaultValue={editing?.parent_id ?? ''}>
                <option value="">無</option>
                {all
                  .filter((t) => t.id !== editing?.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className="label">描述</label>
            <textarea className="input h-20" name="description" defaultValue={editing?.description} />
          </div>
          {editing ? (
            <Link href={`/admin/terms/?tax=${tax}`} className="text-xs text-[#2271b1]">
              取消編輯
            </Link>
          ) : null}
        </ActionForm>
        <table className="table">
          <thead>
            <tr>
              <th>名稱</th>
              <th>網址</th>
              <th>數量</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {all.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link className="text-[#2271b1]" href={`/admin/terms/?tax=${tax}&edit=${t.id}`}>
                    {t.name}
                  </Link>
                </td>
                <td className="text-xs">
                  <a href={t.path} target="_blank" className="hover:underline">
                    {t.path}
                  </a>
                </td>
                <td>{t.count}</td>
                <td>
                  <form action={deleteTerm}>
                    <input type="hidden" name="id" value={t.id} />
                    <ConfirmSubmit message={`確定刪除「${t.name}」？文章與此項目的關聯也會一併移除。`} className="text-xs text-red-600">
                      刪除
                    </ConfirmSubmit>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
