'use server';
import { redirect } from 'next/navigation';
import { adminDb } from '@/lib/db';
import { authClient } from '@/lib/admin/auth';
import { audit } from '@/lib/cms/core';

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  if (!email || !password) return { error: '請輸入電子郵件與密碼。' };
  const sb = await authClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: '電子郵件或密碼不正確。' };
  const { data: row } = await adminDb().from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (!row) {
    await sb.auth.signOut();
    return { error: '此帳號沒有本站的管理權限。' };
  }
  await audit({ label: email, id: data.user.id }, 'login', 'admins', data.user.id);
  redirect('/admin/');
}

export async function logout() {
  const sb = await authClient();
  await sb.auth.signOut();
  redirect('/admin/login/');
}
