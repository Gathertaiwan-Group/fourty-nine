import { redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/admin/auth';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: '登入' };

export default async function LoginPage() {
  if (await currentAdmin()) redirect('/admin/');
  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      <h1 className="mb-6 text-center text-xl font-semibold">四拾九天數位整合行銷 · 後台登入</h1>
      <LoginForm />
      <p className="mt-4 text-center text-xs text-gray-500">
        <a href="/" className="underline">
          ← 回到網站
        </a>
      </p>
    </main>
  );
}
