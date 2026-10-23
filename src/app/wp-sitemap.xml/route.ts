// Yoast replaces the core WP sitemap: /wp-sitemap.xml -> /sitemap_index.xml (301)
export function GET(req: Request) {
  return Response.redirect(new URL('/sitemap_index.xml', req.url), 301);
}
