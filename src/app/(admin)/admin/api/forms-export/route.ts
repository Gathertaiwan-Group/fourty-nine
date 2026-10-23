import { actorOf, currentAdmin } from '@/lib/admin/auth';
import { audit } from '@/lib/cms/core';
import { submissionsCsv } from '@/lib/cms/site';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return new Response('unauthorized', { status: 401 });
  const form = Number(new URL(req.url).searchParams.get('form') || 0) || undefined;
  const csv = await submissionsCsv(form);
  await audit(actorOf(admin), 'export', 'form_submissions', form ?? 'all');
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="form-submissions-${form ?? 'all'}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
