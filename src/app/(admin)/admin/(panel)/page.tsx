import { requireAdmin } from '@/lib/admin/auth';
import Link from 'next/link';
import { dashboardCounts, listAudit } from '@/lib/cms/site';
import { listPosts } from '@/lib/cms/posts';

export const metadata = { title: '控制台' };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—');

export default async function Dashboard() {
  await requireAdmin();
  const [c, recent, drafts] = await Promise.all([dashboardCounts(), listAudit({ limit: 10 }), listPosts({ post_type: 'post', status: 'draft', limit: 5 })]);
  const stats = [
    { label: '已發布文章', value: c.posts, href: '/admin/posts/?type=post&status=publish' },
    { label: '已發布頁面', value: c.pages, href: '/admin/posts/?type=page&status=publish' },
    { label: '草稿', value: c.drafts, href: '/admin/posts/?type=post&status=draft' },
    { label: '已排程', value: c.scheduled, href: '/admin/posts/?type=post&status=future' },
    { label: '媒體檔案', value: c.media, href: '/admin/media/' },
    { label: '未讀表單提交', value: c.subsNew, href: '/admin/forms/?status=new' },
    { label: '轉址規則', value: c.redirects, href: '/admin/redirects/' },
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-normal">控制台</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card hover:border-[#2271b1]">
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs text-gray-600">{s.label}</div>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">快速草稿</h2>
            <Link className="btn btn-primary" href="/admin/posts/new/?type=post">
              新增文章
            </Link>
          </div>
          {drafts.items.length ? (
            <ul className="space-y-1">
              {drafts.items.map((d) => (
                <li key={d.id}>
                  <Link className="text-[#2271b1] hover:underline" href={`/admin/posts/${d.id}/`}>
                    {d.title || '(無標題)'}
                  </Link>{' '}
                  <span className="text-xs text-gray-500">{fmt(d.modified)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">目前沒有草稿。</p>
          )}
        </section>
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">最近活動</h2>
            <Link className="text-[#2271b1] hover:underline" href="/admin/audit/">
              全部稽核紀錄 →
            </Link>
          </div>
          <ul className="space-y-1 text-xs">
            {recent.items.map((r: any) => (
              <li key={r.id}>
                <span className="text-gray-500">{fmt(r.created_at)}</span> · {r.actor} · {r.action} {r.entity} #{r.entity_id}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
