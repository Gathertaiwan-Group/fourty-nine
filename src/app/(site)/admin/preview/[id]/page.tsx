import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import postHead from '@/theme/head-post.json';
import { Shell } from '@/components/Shell';
import { ElementorPage, SinglePost } from '@/components/Blocksy';
import type { HeadEntry, Post } from '@/lib/content';
import { currentAdmin } from '@/lib/admin/auth';
import { getPost } from '@/lib/cms/posts';
import { adminDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ autosave?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: { absolute: `預覽 #${(await params).id}` }, robots: { index: false, follow: false } };
}

/** WordPress-style preview: drafts / unsaved edits rendered with the real theme, admins only. */
export default async function Preview({ params, searchParams }: Props) {
  if (!(await currentAdmin())) redirect('/admin/login/');
  const id = Number((await params).id);
  const base = Number.isFinite(id) ? await getPost(id) : null;
  if (!base || (base.post_type !== 'post' && base.post_type !== 'page')) notFound();
  let post: Post = base as unknown as Post;
  let catIds = base.category_ids;
  if ((await searchParams).autosave) {
    const { data } = await adminDb().from('options').select('option_value').eq('option_name', `_preview_${id}`).maybeSingle();
    const draft = data?.option_value as Partial<{ title: string; content_html: string; excerpt_html: string; category_ids: number[] }> | undefined;
    if (draft) {
      post = { ...post, title: draft.title ?? post.title, content_html: draft.content_html ?? post.content_html, excerpt_html: draft.excerpt_html ?? post.excerpt_html };
      catIds = draft.category_ids ?? catIds;
    }
  }
  const banner = (
    <div style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 99999, background: '#1d2327', color: '#fff', padding: '6px 12px', borderRadius: 4, fontSize: 13 }}>
      預覽模式（{base.status}）· 訪客看不到這個畫面
    </div>
  );
  if (post.post_type === 'page') {
    return (
      <Shell path={base.path} bodyClass={post.meta?.body_class || `page page-id-${post.id} elementor-page elementor-page-${post.id}`} prefix="single_page" head={post.meta?.head}>
        <ElementorPage post={post} />
        {banner}
      </Shell>
    );
  }
  return (
    <Shell
      path={base.path}
      bodyClass={post.meta?.body_class || `wp-singular post-template-default single single-post postid-${post.id} single-format-standard ct-elementor-default-template`}
      prefix="single_blog_post"
      head={[...(postHead as HeadEntry[]), ...(post.meta?.head || [])]}
    >
      <SinglePost post={post} related={[]} catIds={catIds} />
      {banner}
    </Shell>
  );
}
