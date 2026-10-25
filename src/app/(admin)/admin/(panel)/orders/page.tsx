import { requireAdmin } from '@/lib/admin/auth';
import Link from 'next/link';
import { listOrders, orderStatusCounts, ORDER_STATUS_LABEL, ORDER_STATUSES } from '@/lib/cms/site';

export const metadata = { title: '訂單' };
const PER = 30;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—');
const money = (n: number | string, cur: string) => `${cur} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p || 1));
  const [{ items, total }, counts] = await Promise.all([
    listOrders({ status: sp.status, q: sp.q, limit: PER, offset: (page - 1) * PER }),
    orderStatusCounts(),
  ]);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: sp.status, q: sp.q, ...o })) if (v !== undefined && v !== '') u.set(k, String(v));
    return `/admin/orders/?${u}`;
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">訂單</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={qs({ status: undefined, p: undefined })} className={!sp.status ? 'font-semibold' : 'text-[#2271b1]'}>
          全部（{all}）
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link key={s} href={qs({ status: s, p: undefined })} className={sp.status === s ? 'font-semibold' : 'text-[#2271b1]'}>
            {ORDER_STATUS_LABEL[s]}（{counts[s] ?? 0}）
          </Link>
        ))}
      </div>
      <form className="flex gap-2">
        {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
        <input className="input !w-56" name="q" defaultValue={sp.q} placeholder="訂單編號" />
        <button className="btn">搜尋</button>
      </form>
      {!all ? <div className="notice">舊網站（四拾九天）不是商店，資料庫備份中沒有任何 WooCommerce 訂單；新的訂單會出現在這裡。</div> : null}
      <table className="table">
        <thead>
          <tr>
            <th>訂單</th>
            <th>日期</th>
            <th>狀態</th>
            <th>付款方式</th>
            <th className="text-right">總計</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o: any) => (
            <tr key={o.id}>
              <td>
                <Link className="text-[#2271b1]" href={`/admin/orders/${o.id}/`}>
                  #{o.order_number || o.id} {[o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ')}
                </Link>
              </td>
              <td className="text-xs whitespace-nowrap">{fmt(o.date_created)}</td>
              <td>
                <span className="badge">{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
              </td>
              <td className="text-xs">{o.payment_method_title || '—'}</td>
              <td className="text-right">{money(o.total, o.currency)}</td>
            </tr>
          ))}
          {!items.length ? (
            <tr>
              <td colSpan={5} className="text-gray-500">
                沒有訂單。
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
