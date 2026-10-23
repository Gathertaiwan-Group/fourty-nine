import { siteUrl } from '@/lib/db';

export const revalidate = 3600;

export function GET() {
  const body = `# START YOAST BLOCK
# ---------------------------
User-agent: *
Disallow:

Sitemap: ${siteUrl()}/sitemap_index.xml
# ---------------------------
# END YOAST BLOCK`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
