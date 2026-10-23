import { PostEditor } from '../../../components/PostEditor';
import { editorContext } from '../editorData';

export const metadata = { title: '新增' };

export default async function NewPost({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const type = (await searchParams).type === 'page' ? 'page' : 'post';
  const ctx = await editorContext();
  const defaultAuthor = ctx.authors[0]?.id ?? null;
  return (
    <PostEditor
      key="new"
      {...ctx}
      initial={{
        post_type: type,
        title: '',
        slug: '',
        path: '',
        content_html: '',
        excerpt_html: '',
        status: 'draft',
        date: null,
        author_id: defaultAuthor,
        featured_media_id: null,
        parent_id: null,
        menu_order: 0,
        seo_title: '',
        seo_description: '',
        category_ids: [],
        tag_ids: [],
      }}
    />
  );
}
