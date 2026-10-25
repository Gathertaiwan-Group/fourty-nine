import { listCoupons } from '@/lib/cms/site';

export const metadata = { title: '優惠券' };
const TYPE: Record<string, string> = { percent: '百分比折扣', fixed_cart: '購物車固定折扣', fixed_product: '商品固定折扣' };

export default async function CouponsPage() {
  const { items, total } = await listCoupons({ limit: 200 });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">優惠券</h1>
      {!total ? <div className="notice">舊網站資料庫中沒有任何 WooCommerce 優惠券或數量折扣規則。</div> : null}
      <table className="table">
        <thead>
          <tr>
            <th>代碼</th>
            <th>類型</th>
            <th className="text-right">金額</th>
            <th>使用 / 上限</th>
            <th>到期</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c: any) => (
            <tr key={c.id}>
              <td className="font-mono">{c.code}</td>
              <td className="text-sm">{TYPE[c.discount_type] ?? c.discount_type}</td>
              <td className="text-right">{Number(c.amount).toLocaleString('en-US')}</td>
              <td className="text-sm">
                {c.usage_count} / {c.usage_limit ?? '∞'}
              </td>
              <td className="text-xs">{c.date_expires ? new Date(c.date_expires).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—'}</td>
              <td className="text-xs">{c.status}</td>
            </tr>
          ))}
          {!items.length ? (
            <tr>
              <td colSpan={6} className="text-gray-500">
                沒有優惠券。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="text-sm">共 {total} 張</div>
    </div>
  );
}
