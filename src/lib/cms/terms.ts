import 'server-only';
import { adminDb } from '@/lib/db';
import { audit, CmsError, must, revalidateSite, slugify, wpSlug, type Actor } from './core';

export const TAXONOMIES = ['category', 'post_tag'] as const;
export type Taxonomy = (typeof TAXONOMIES)[number];

function base(t: Taxonomy) {
  return t === 'category' ? 'category' : 'tag';
}

function assertTax(t: string): asserts t is Taxonomy {
  if (!(TAXONOMIES as readonly string[]).includes(t)) throw new CmsError('taxonomy 必須是 category 或 post_tag');
}

export async function listTerms(taxonomy?: string) {
  let q = adminDb().from('terms').select('id,taxonomy,slug,name,description,parent_id,count,path').in('taxonomy', [...TAXONOMIES]);
  if (taxonomy) {
    assertTax(taxonomy);
    q = q.eq('taxonomy', taxonomy);
  }
  return (must(await q.order('name'), 'terms') ?? []) as {
    id: number;
    taxonomy: Taxonomy;
    slug: string;
    name: string;
    description: string;
    parent_id: number | null;
    count: number;
    path: string;
  }[];
}

async function termPath(taxonomy: Taxonomy, slug: string, parentId: number | null) {
  // WordPress category permalinks include ancestors: /category/parent/child/
  const chain: string[] = [slug];
  let pid = taxonomy === 'category' ? parentId : null;
  for (let i = 0; pid && i < 10; i++) {
    const p = must(await adminDb().from('terms').select('slug,parent_id').eq('id', pid).maybeSingle(), 'terms');
    if (!p) break;
    chain.unshift(p.slug);
    pid = p.parent_id;
  }
  return `/${base(taxonomy)}/${chain.join('/')}/`;
}

export async function createTerm(input: { taxonomy: string; name: string; slug?: string; description?: string; parent_id?: number | null }, actor: Actor) {
  assertTax(input.taxonomy);
  const name = input.name.trim();
  if (!name) throw new CmsError('名稱必填');
  let slug = slugify(input.slug || name);
  const exists = must(await adminDb().from('terms').select('id').eq('taxonomy', input.taxonomy).eq('slug', slug).maybeSingle(), 'terms');
  if (exists) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const parent_id = input.taxonomy === 'category' ? (input.parent_id ?? null) : null;
  const row = {
    taxonomy: input.taxonomy,
    slug,
    wp_slug: wpSlug(slug),
    name,
    description: input.description ?? '',
    parent_id,
    count: 0,
    path: await termPath(input.taxonomy, slug, parent_id),
  };
  const created = must(await adminDb().from('terms').insert(row).select('*').single(), 'terms');
  await audit(actor, 'create', 'terms', created.id, null, created);
  revalidateSite();
  return created;
}

export async function updateTerm(id: number, input: { name?: string; slug?: string; description?: string; parent_id?: number | null }, actor: Actor) {
  const before = must(await adminDb().from('terms').select('*').eq('id', id).maybeSingle(), 'terms');
  if (!before) throw new CmsError('找不到分類／標籤', 404);
  assertTax(before.taxonomy);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.parent_id !== undefined && before.taxonomy === 'category') {
    if (input.parent_id === id) throw new CmsError('上層分類不可為自己');
    patch.parent_id = input.parent_id;
  }
  if (input.slug !== undefined && slugify(input.slug) !== before.slug) {
    patch.slug = slugify(input.slug);
    patch.wp_slug = wpSlug(patch.slug as string);
  }
  if (patch.slug || patch.parent_id !== undefined) {
    patch.path = await termPath(before.taxonomy, (patch.slug as string) ?? before.slug, (patch.parent_id as number | null | undefined) ?? before.parent_id);
  }
  const after = must(await adminDb().from('terms').update(patch).eq('id', id).select('*').single(), 'terms');
  if (after.path !== before.path) {
    await adminDb().from('redirects').upsert({ source_path: before.path, target: after.path, status_code: 301, kind: 'legacy' }, { onConflict: 'source_path' });
  }
  await audit(actor, 'update', 'terms', id, before, after);
  revalidateSite();
  return after;
}

export async function deleteTerm(id: number, actor: Actor) {
  const before = must(await adminDb().from('terms').select('*').eq('id', id).maybeSingle(), 'terms');
  if (!before) throw new CmsError('找不到分類／標籤', 404);
  assertTax(before.taxonomy);
  must(await adminDb().from('terms').delete().eq('id', id), 'terms');
  await audit(actor, 'delete', 'terms', id, before, null);
  revalidateSite();
  return { id, deleted: true };
}
