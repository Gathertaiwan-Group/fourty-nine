import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import redirects from '@/generated/redirects.json';

const MAP = (redirects as unknown as { paths: Record<string, [string, number]> }).paths;
const IDS = (redirects as unknown as { ids: Record<string, string> }).ids;

function decode(p: string) {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** Keeps the Supabase Auth session cookie fresh for the admin (Server Components cannot write cookies). */
async function refreshAdminSession(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res;
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, { ...options, path: '/', sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' });
      },
    },
  });
  await sb.auth.getUser();
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  // trailingSlash redirect lives here (next.config skipTrailingSlashRedirect) so that /api/* — excluded by
  // the matcher — answers on both /api/mcp and /api/mcp/: MCP clients POST without following a 308.
  const last = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (!url.pathname.endsWith('/') && !last.includes('.')) {
    const to = new URL(req.url); // plain URL: NextURL would re-normalise the slash away
    to.pathname = url.pathname + '/';
    return NextResponse.redirect(to.toString(), 308);
  }
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return refreshAdminSession(req);
  const path = decode(url.pathname);

  // WordPress search: /?s=q and /page/N/?s=q  ->  internal /search/q/ (WP's own pretty search URL)
  const s = url.searchParams.get('s');
  if (s && s.trim()) {
    const m = path.match(/^\/(?:page\/(\d+)\/?)?$/);
    if (m) {
      const to = url.clone();
      to.pathname = `/search/${encodeURIComponent(s.trim())}/` + (m[1] && m[1] !== '1' ? `page/${m[1]}/` : '');
      to.search = '';
      return NextResponse.rewrite(to);
    }
  }

  // WordPress query-string links on the home URL
  if (path === '/') {
    const id = url.searchParams.get('attachment_id') || url.searchParams.get('p') || url.searchParams.get('page_id');
    if (id && IDS[id]) return NextResponse.redirect(new URL(IDS[id], url), 301);
  }

  // Yoast had author archives disabled: /author/<slug>/ answered 301 -> home page
  if (/^\/author\/[^/]+\/?/.test(path)) {
    const to = url.clone();
    to.pathname = '/';
    to.search = '';
    return NextResponse.redirect(to, 301);
  }

  // old attachment pages -> media file (301), plus any manual redirect rows
  const key = path.endsWith('/') ? path : path + '/';
  const hit = MAP[key];
  if (hit) {
    const [target, status] = hit;
    if (status === 410) return new NextResponse(null, { status: 410 });
    return NextResponse.redirect(new URL(target, url), status as 301 | 302 | 307 | 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|wp/|api/|favicon.ico|robots.txt|sitemap).*)'],
};
