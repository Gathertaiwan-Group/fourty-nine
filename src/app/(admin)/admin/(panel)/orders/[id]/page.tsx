import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrder, ORDER_STATUS_LABEL, ORDER_STATUSES } from '@/lib/cms/site';
import { setOrderStatus } from '../../actions';

export const metadata = { title: '訂單內容' };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—');

function Address({ a }: { a: Record<string, string> | null }) {
  if (!a || !Object.values(a).some(Boolean)) return <span className="text-gray-500">—</span>;
  return (
    <div className="text-sm leading-6">
      {[a.first_name, a.last_name].filter(Boolean).join(' ')}
      {a.company ? <div>{a.company}</div> : null}
      <div>{[a.postcode, a.state, a.city, a.address_1, a.address_2].filter(Boolean).join(' ')}</div>
      {a.phone ? <div>{a.phone}</div> : null}
      {a.email ? <div>{a.email}</div> : null}
    </div>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o: any = await getOrder(Number(id));
  if (!o) notFound();
  const n = (v: number | string) => `${o.currency} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return (
    <div className="space-y-4">
      <Link href="/admin/orders/" className="text-sm text-[#2271b1]">
        ‹ 訂單列表
      </Link>
      <h1 className="text-2xl font-normal">
        訂單 #{o.order_number || o.id} <span className="badge align-middle">{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
      </h1>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <h2 className="mb-2 font-semibold">一般</h2>
          <div className="text-sm leading-6">
            建立：{fmt(o.date_created)}
            <br />
            付款：{o.payment_method_title || '—'} {o.date_paid ? `（${fmt(o.date_paid)}）` : ''}
            <br />
            顧客：
            {o.customer_id ? (
              <Link className="text-[#2271b1]" href={`/admin/customers/?id=${o.customer_id}`}>
                #{o.customer_id}
              </Link>
            ) : (
              '訪客'
            )}
          </div>
          {o.customer_note ? <p className="mt-2 text-sm">顧客備註：{o.customer_note}</p> : null}
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">帳單</h2>
          <Address a={o.billing} />
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">運送</h2>
          <Address a={o.shipping} />
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>項目</th>
            <th>類型</th>
            <th className="text-right">數量</th>
            <th className="text-right">金額</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i: any) => (
            <tr key={i.id}>
              <td>{i.name}</td>
              <td className="text-xs">{i.item_type}</td>
              <td className="text-right">{i.item_type === 'line_item' ? i.quantity : ''}</td>
              <td className="text-right">{n(i.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="text-right">小計</td>
            <td className="text-right">{n(o.subtotal)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="text-right">折扣</td>
            <td className="text-right">-{n(o.discount_total)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="text-right">運費</td>
            <td className="text-right">{n(o.shipping_total)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="text-right font-semibold">總計</td>
            <td className="text-right font-semibold">{n(o.total)}</td>
          </tr>
        </tfoot>
      </table>
      <form action={setOrderStatus} className="card flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={o.id} />
        <label className="text-sm">
          狀態
          <select className="input !w-40" name="status" defaultValue={o.status}>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <input className="input !w-72" name="note" placeholder="備註（選填）" />
        <button className="btn btn-primary">更新狀態</button>
        <span className="text-xs text-gray-500">只更改狀態並記錄備註，不會觸發任何金流。</span>
      </form>
      <div className="card">
        <h2 className="mb-2 font-semibold">訂單備註</h2>
        {o.notes.length ? (
          <ul className="space-y-2 text-sm">
            {o.notes.map((x: any) => (
              <li key={x.id}>
                <div className="whitespace-pre-wrap">{x.note}</div>
                <div className="text-xs text-gray-500">
                  {fmt(x.created_at)} {x.added_by ? `· ${x.added_by}` : ''} {x.is_customer_note ? '· 給顧客' : ''}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">沒有備註。</p>
        )}
      </div>
    </div>
  );
}
