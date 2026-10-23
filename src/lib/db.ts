import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SCHEMA = 'site_fortynine';
export const REVALIDATE = 300;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

let anon: SupabaseClient<any, any, any> | null = null;
let admin: SupabaseClient<any, any, any> | null = null;

/** Read-only client (anon key; RLS exposes published content only). Responses are cached by Next. */
export function db() {
  if (!anon) {
    anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, next: { revalidate: REVALIDATE, tags: ['wp'] } } as RequestInit),
      },
    });
  }
  return anon;
}

/** Server-side writer (service role) — only used by route handlers, never sent to the browser. */
export function adminDb() {
  if (!admin) {
    admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }) },
    });
  }
  return admin;
}

export function siteUrl() {
  return (process.env.SITE_URL || 'https://fortynine-days.com').replace(/\/$/, '');
}
