import 'server-only';
import { revalidatePath, revalidateTag } from 'next/cache';
import { adminDb } from '@/lib/db';

/** Who performed a write. `label` is the admin email or 'mcp'. */
export type Actor = { label: string; id?: string | null };

export class CmsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function must<T>(res: { data: T; error: { message: string } | null }, what = 'database'): T {
  if (res.error) throw new CmsError(`${what}: ${res.error.message}`, 500);
  return res.data;
}

/** Every write (admin UI and MCP) goes through here. Audit failures are surfaced, never swallowed. */
export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | number | null,
  before?: unknown,
  after?: unknown,
) {
  const { error } = await adminDb()
    .from('audit_log')
    .insert({
      actor: actor.label,
      actor_id: actor.id ?? null,
      action,
      entity,
      entity_id: entityId == null ? null : String(entityId),
      before: before ?? null,
      after: after ?? null,
    });
  if (error) throw new CmsError(`audit_log: ${error.message}`, 500);
}

/** Purge the public site's cached Supabase reads and ISR pages. */
export function revalidateSite() {
  try {
    revalidateTag('wp', { expire: 0 });
    revalidatePath('/', 'layout');
  } catch {
    // outside a request scope (scripts) there is nothing to revalidate
  }
}

/** WordPress-like sanitize_title: keeps CJK and other letters, lower-cases latin, dashes for separators. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKC')
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z0-9#]+;/gi, '')
      .replace(/[\s_.,，。、！!？?：:；;「」『』（）()\[\]{}《》<>"'`~@#$%^&*+=|\\/]+/g, '-')
      .replace(/[^\p{L}\p{N}-]+/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 190) || 'untitled'
  );
}

/** WordPress stores non-ASCII slugs percent-encoded and lower-cased. */
export function wpSlug(slug: string) {
  return encodeURIComponent(slug).toLowerCase();
}

export function nowIso() {
  return new Date().toISOString();
}

export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
