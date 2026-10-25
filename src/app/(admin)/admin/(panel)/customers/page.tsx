import Link from 'next/link';
import { getCustomer, listCustomers } from '@/lib/cms/site';

export const metadata = { title: '顧客' };
const PER = 30;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—');

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p || 1));
  const [{ items, total }, one] = await Promise.all([
    listCustomers({ q: sp.q, limit: PER, offset: (page - 1) * PER }),
    sp.id ? getCustomer(Number(sp.id)) : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, ...o })) if (v !== undefined && v !== '') u.set(k, String(v));
    return `/admin/customers/?${u}`;
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">顧客</h1>
      <form className="flex gap-2">
        <input className="input !w-64" name="q" defaultValue={sp.q} placeholder="姓名或 Email" />
        <button className="btn">搜尋</button>
      </form>
      {!total && !sp.q ? (
        <div className="notice">
          舊網站資料庫中沒有任何 WooCommerce 顧客（WordPress 帳號全是管理員，依規範不轉成顧客或新站管理員）。顧客不會預先建立登入帳號；第一次登入時以 Email 驗證後才連結到這裡的紀錄。
        </div>
      ) : null}
      {one ? (
        <div className="card text-sm">
          <h2 className="mb-2 font-semibold">
            #{one.id} {one.display_name || [one.first_name, one.last_name].filter(Boolean).join(' ')}
          </h2>
          <div>{one.email}</div>
          <div className="mt-2">
            訂單：
            {one.orders?.length
              ? one.orders.map((o: any) => (
                  <Link key={o.id} className="mr-2 text-[#2271b1]" href={`/admin/orders/${o.id}/`}>
                    #{o.order_number || o.id}
                  </Link>
                ))
              : '無'}
          </div>
        </div>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>Email</th>
            <th>電話</th>
            <th>註冊日期</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c: any) => (
            <tr key={c.id}>
              <td>
                <Link className="text-[#2271b1]" href={qs({ id: c.id })}>
                  {c.display_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || `#${c.id}`}
                </Link>
              </td>
              <td className="text-sm">{c.email}</td>
              <td className="text-sm">{c.billing?.phone || '—'}</td>
              <td className="text-xs">{fmt(c.date_created)}</td>
            </tr>
          ))}
          {!items.length ? (
            <tr>
              <td colSpan={4} className="text-gray-500">
                沒有顧客。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="flex items-center gap-2 text-sm">
        <span>共 {total} 位</span>
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
