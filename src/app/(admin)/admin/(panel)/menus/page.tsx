import Link from 'next/link';
import { adminDb } from '@/lib/db';
import { getMenuWithItems, listMenus } from '@/lib/cms/site';
import { MenuEditor } from '../../components/MenuEditor';

export const metadata = { title: '選單' };

export default async function MenusPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const menus = await listMenus();
  const id = Number((await searchParams).id) || menus[0]?.id;
  const menu = id ? await getMenuWithItems(id) : null;
  const [{ data: posts }, { data: terms }] = await Promise.all([
    adminDb().from('posts').select('id,title,path,post_type').in('post_type', ['page', 'post']).eq('status', 'publish').order('post_type', { ascending: false }).order('title'),
    adminDb().from('terms').select('id,name,path').eq('taxonomy', 'category').order('name'),
  ]);
  const linkables = [
    ...(posts ?? []).map((p) => ({ id: p.id, title: p.title || p.path, url: p.path, type: p.post_type as 'page' | 'post' })),
    ...(terms ?? []).map((t) => ({ id: t.id, title: t.name, url: t.path, type: 'category' as const })),
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-normal">選單</h1>
      {menus.length > 1 ? (
        <div className="flex gap-3 text-sm">
          {menus.map((m) => (
            <Link key={m.id} href={`/admin/menus/?id=${m.id}`} className={m.id === id ? 'font-semibold' : 'text-[#2271b1]'}>
              {m.name}
            </Link>
          ))}
        </div>
      ) : null}
      {menu ? (
        <>
          <p className="text-sm text-gray-600">
            位置：{menu.location === 'header' ? '頁首主選單' : menu.location || '—'}
          </p>
          <MenuEditor key={`${menu.id}-${menu.items.length}`} menu={menu as any} linkables={linkables} />
        </>
      ) : (
        <p>尚無選單。</p>
      )}
    </div>
  );
}
