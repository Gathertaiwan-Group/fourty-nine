import { NextResponse } from 'next/server';
import { publishDue } from '@/lib/cms/posts';

export const dynamic = 'force-dynamic';

/** Vercel Cron: publishes scheduled posts whose time has passed (also done on every admin / MCP request). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rows = await publishDue({ label: 'cron' });
  return NextResponse.json({ published: rows.map((r) => ({ id: r.id, path: r.path })) });
}
