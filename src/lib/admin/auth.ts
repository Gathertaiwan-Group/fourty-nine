import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { adminDb } from '@/lib/db';
import type { Actor } from '@/lib/cms/core';

export type AdminUser = { id: string; email: string; role: string };

/** Supabase Auth client bound to the request cookies (anon key; only used for the session). */
export async function authClient() {
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, path: '/', sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}

/** The signed-in user, only if listed in site_fortynine.admins. getUser() verifies the JWT with Supabase Auth. */
export const currentAdmin = cache(async (): Promise<AdminUser | null> => {
  const sb = await authClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  const { data: row } = await adminDb().from('admins').select('user_id,email,role').eq('user_id', data.user.id).maybeSingle();
  if (!row) return null;
  return { id: row.user_id, email: row.email, role: row.role };
});

export async function requireAdmin(): Promise<AdminUser> {
  const a = await currentAdmin();
  if (!a) redirect('/admin/login/');
  return a;
}

export function actorOf(a: AdminUser): Actor {
  return { label: a.email, id: a.id };
}
