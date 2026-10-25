import { requireAdmin } from '@/lib/admin/auth';
import { notFound } from 'next/navigation';
import { getPost } from '@/lib/cms/posts';
import { getMediaItem } from '@/lib/cms/media';
import { PostEditor } from '../../../components/PostEditor';
import { editorContext } from '../editorData';

export const metadata = { title: '編輯' };

export default async function EditPost({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const post = await getPost(id);
  if (!post || (post.post_type !== 'post' && post.post_type !== 'page')) notFound();
  const [ctx, featured] = await Promise.all([editorContext(), post.featured_media_id ? getMediaItem(post.featured_media_id) : null]);
  const seo = (post.seo ?? {}) as { title?: string; description?: string };
  return (
    <PostEditor
      key={`${post.id}-${post.modified}`}
      {...ctx}
      initial={{
        id: post.id,
        post_type: post.post_type,
        title: post.title,
        slug: post.slug,
        path: post.path,
        content_html: post.content_html,
        excerpt_html: post.excerpt_html,
        status: post.status,
        date: post.date,
        author_id: post.author_id,
        featured_media_id: post.featured_media_id,
        featured_url: featured?.url ?? null,
        parent_id: post.parent_id,
        menu_order: post.menu_order,
        seo_title: seo.title ?? '',
        seo_description: seo.description ?? '',
        category_ids: post.category_ids,
        tag_ids: post.tag_ids,
      }}
    />
  );
}
