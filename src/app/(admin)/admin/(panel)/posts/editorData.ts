import 'server-only';
import { listAuthors, listPagesForParent } from '@/lib/cms/posts';
import { listTerms } from '@/lib/cms/terms';

export async function editorContext() {
  const [terms, authors, pages] = await Promise.all([listTerms(), listAuthors(), listPagesForParent()]);
  return { terms: terms.map((t) => ({ id: t.id, taxonomy: t.taxonomy, name: t.name, parent_id: t.parent_id })), authors, pages };
}
