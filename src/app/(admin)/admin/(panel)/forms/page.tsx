import Link from 'next/link';
import { listForms, listSubmissions, SUBMISSION_STATUSES } from '@/lib/cms/site';
import { ConfirmSubmit } from '../../components/ConfirmSubmit';
import { deleteSubmission, setSubmissionStatus } from '../actions';

export const metadata = { title: '表單提交' };
const PER = 30;
const LABEL: Record<string, string> = { new: '未讀', read: '已讀', replied: '已回覆', spam: '垃圾', trash: '回收桶' };
const fmt = (d: string) => new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

export default async function FormsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const formId = Number(sp.form) || undefined;
  const page = Math.max(1, Number(sp.p || 1));
  const [forms, { items, total }] = await Promise.all([listForms(), listSubmissions({ form_id: formId, status: sp.status, q: sp.q, limit: PER, offset: (page - 1) * PER })]);
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ form: formId, status: sp.status, q: sp.q, ...o })) if (v !== undefined && v !== '') u.set(k, String(v));
    return `/admin/forms/?${u}`;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-normal">表單提交</h1>
        <a className="btn" href={`/admin/api/forms-export/${formId ? `?form=${formId}` : ''}`}>
          匯出 CSV
        </a>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={qs({ form: undefined, p: undefined })} className={!formId ? 'font-semibold' : 'text-[#2271b1]'}>
          全部表單
        </Link>
        {forms.map((f) => (
          <Link key={f.id} href={qs({ form: f.id, p: undefined })} className={formId === f.id ? 'font-semibold' : 'text-[#2271b1]'}>
            {f.name}（{f.total}{f.unread ? `，未讀 ${f.unread}` : ''}）
          </Link>
        ))}
      </div>
      <form className="flex flex-wrap gap-2">
        {formId ? <input type="hidden" name="form" value={formId} /> : null}
        <select className="input !w-32" name="status" defaultValue={sp.status ?? ''}>
          <option value="">所有狀態</option>
          {SUBMISSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABEL[s]}
            </option>
          ))}
        </select>
        <input className="input !w-56" name="q" defaultValue={sp.q} placeholder="搜尋內容" />
        <button className="btn">篩選</button>
      </form>
      {!forms.length ? (
        <div className="notice">舊網站沒有任何 Elementor 表單或提交紀錄；新表單送出的資料（/api/forms/&lt;slug&gt;/）會出現在這裡。</div>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>時間</th>
            <th>表單</th>
            <th>內容</th>
            <th>狀態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((s: any) => (
            <tr key={s.id}>
              <td className="text-xs whitespace-nowrap">{fmt(s.created_at)}</td>
              <td className="text-xs">{s.forms?.name ?? '—'}</td>
              <td>
                <details>
                  <summary className="cursor-pointer text-sm">
                    {Object.values(s.data || {})
                      .slice(0, 3)
                      .map((v) => String(v).slice(0, 30))
                      .join(' · ') || '(空白)'}
                  </summary>
                  <dl className="mt-2 grid grid-cols-[120px_1fr] gap-1 text-xs">
                    {Object.entries(s.data || {}).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-gray-500">{k}</dt>
                        <dd className="whitespace-pre-wrap">{String(v)}</dd>
                      </div>
                    ))}
                    <dt className="text-gray-500">頁面</dt>
                    <dd>{s.page_path ?? '—'}</dd>
                    <dt className="text-gray-500">IP</dt>
                    <dd>{s.ip ?? '—'}</dd>
                  </dl>
                </details>
              </td>
              <td>
                <span className="badge">{LABEL[s.status] ?? s.status}</span>
              </td>
              <td>
                <div className="flex flex-wrap gap-2 text-xs">
                  {SUBMISSION_STATUSES.filter((x) => x !== s.status && x !== 'trash').map((x) => (
                    <form key={x} action={setSubmissionStatus}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="status" value={x} />
                      <button className="text-[#2271b1]">標為{LABEL[x]}</button>
                    </form>
                  ))}
                  <form action={deleteSubmission}>
                    <input type="hidden" name="id" value={s.id} />
                    <ConfirmSubmit message="永久刪除這筆提交？" className="text-red-600">
                      刪除
                    </ConfirmSubmit>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {!items.length ? (
            <tr>
              <td colSpan={5} className="text-gray-500">
                沒有提交紀錄。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="flex items-center gap-2 text-sm">
        <span>共 {total} 筆</span>
        {page > 1 ? (
          <Link className="btn" href={qs({ p: page - 1 })}>
            ‹ 上一頁
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="btn" href={qs({ p: page + 1 })}>
            下一頁 ›
          </Link>
        ) : null}
      </div>
    </div>
  );
}
