import { requireAdmin } from '@/lib/admin/auth';
import Link from 'next/link';
import { listAudit } from '@/lib/cms/site';

export const metadata = { title: '稽核紀錄' };
const PER = 50;
const fmt = (d: string) => new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const ENTITIES = ['posts', 'terms', 'media', 'menus', 'settings', 'redirects', 'form_submissions', 'orders', 'admins'];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p || 1));
  const { items, total } = await listAudit({ entity: sp.entity, actor: sp.actor, entity_id: sp.entity_id, limit: PER, offset: (page - 1) * PER });
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ entity: sp.entity, actor: sp.actor, entity_id: sp.entity_id, p: page, ...o })) if (v !== undefined && v !== '' && v !== 1) u.set(k, String(v));
    return `/admin/audit/?${u}`;
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">稽核紀錄</h1>
      <form className="flex flex-wrap gap-2">
        <select className="input !w-44" name="entity" defaultValue={sp.entity ?? ''}>
          <option value="">所有項目</option>
          {ENTITIES.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
        <input className="input !w-48" name="actor" defaultValue={sp.actor} placeholder="操作者（email／mcp）" />
        <input className="input !w-32" name="entity_id" defaultValue={sp.entity_id} placeholder="ID" />
        <button className="btn">篩選</button>
        <span className="self-center text-xs text-gray-500">共 {total} 筆</span>
      </form>
      <table className="table">
        <thead>
          <tr>
            <th>時間</th>
            <th>操作者</th>
            <th>動作</th>
            <th>項目</th>
            <th>變更</th>
          </tr>
        </thead>
        <tbody>
          {(items as any[]).map((r) => (
            <tr key={r.id}>
              <td className="text-xs whitespace-nowrap">{fmt(r.created_at)}</td>
              <td className="text-xs">{r.actor}</td>
              <td>
                <span className="badge">{r.action}</span>
              </td>
              <td className="text-xs">
                {r.entity} #{r.entity_id}
              </td>
              <td className="max-w-xl">
                {r.before || r.after ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-[#2271b1]">查看</summary>
                    <div className="mt-1 grid gap-2 md:grid-cols-2">
                      <pre className="max-h-64 overflow-auto bg-red-50 p-2 text-[11px] whitespace-pre-wrap">{r.before ? JSON.stringify(r.before, null, 1).slice(0, 4000) : '—'}</pre>
                      <pre className="max-h-64 overflow-auto bg-green-50 p-2 text-[11px] whitespace-pre-wrap">{r.after ? JSON.stringify(r.after, null, 1).slice(0, 4000) : '—'}</pre>
                    </div>
                  </details>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 text-sm">
        {page > 1 ? (
          <Link className="btn" href={qs({ p: page - 1 })}>
            ‹ 上一頁
          </Link>
        ) : null}
        <span>
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link className="btn" href={qs({ p: page + 1 })}>
            下一頁 ›
          </Link>
        ) : null}
      </div>
    </div>
  );
}
