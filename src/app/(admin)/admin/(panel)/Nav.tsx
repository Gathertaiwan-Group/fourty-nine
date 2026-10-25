'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const ITEMS = [
  { href: '/admin/', label: '控制台' },
  { href: '/admin/posts/?type=post', label: '文章' },
  { href: '/admin/terms/', label: '分類與標籤' },
  { href: '/admin/posts/?type=page', label: '頁面' },
  { href: '/admin/media/', label: '媒體庫' },
  { href: '/admin/menus/', label: '選單' },
  { href: '/admin/forms/', label: '表單提交' },
  { href: '/admin/orders/', label: '訂單' },
  { href: '/admin/customers/', label: '顧客' },
  { href: '/admin/coupons/', label: '優惠券' },
  { href: '/admin/redirects/', label: '轉址管理' },
  { href: '/admin/settings/', label: '網站設定' },
  { href: '/admin/audit/', label: '稽核紀錄' },
];

export function Nav() {
  const path = usePathname();
  const sp = useSearchParams();
  const isActive = (href: string) => {
    const [p, q] = href.split('?');
    if (p === '/admin/') return path === '/admin' || path === '/admin/';
    if (!path.startsWith(p.replace(/\/$/, ''))) return false;
    if (q) {
      const type = new URLSearchParams(q).get('type');
      return (sp.get('type') || 'post') === type;
    }
    return true;
  };
  return (
    <nav className="flex flex-col text-sm">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={`px-4 py-2 hover:bg-[#2c3338] hover:text-[#72aee6] ${isActive(i.href) ? 'bg-[#2271b1] text-white' : ''}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
