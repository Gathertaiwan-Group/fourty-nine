import { categorySitemap, xml } from '@/lib/sitemap';

export const revalidate = 3600;

export async function GET() {
  return xml(await categorySitemap());
}
