import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/admin/auth';
import { publishDue } from '@/lib/cms/posts';
import { logout } from '../login/actions';
import { Nav } from './Nav';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  // scheduled posts whose time has come are published on any admin visit (plus the cron job)
  await publishDue().catch(() => null);
  return (
    <div className="flex min-h-screen">
      <aside className="w-48 shrink-0 bg-[#1d2327] text-gray-200 max-md:hidden">
        <div className="px-4 py-4 text-sm font-semibold text-white">四拾九天 後台</div>
        <Nav />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-2 bg-[#1d2327] px-4 py-2 text-xs text-gray-200">
          <div className="flex items-center gap-3">
            <details className="md:hidden">
              <summary className="cursor-pointer">選單</summary>
              <div className="absolute z-50 mt-2 w-48 bg-[#1d2327]">
                <Nav />
              </div>
            </details>
            <a href="/" target="_blank" className="hover:text-white">
              🏠 查看網站
            </a>
          </div>
          <form action={logout} className="flex items-center gap-3">
            <span>{admin.email}</span>
            <button className="hover:text-white">登出</button>
          </form>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
