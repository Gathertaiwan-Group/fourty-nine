import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '@/lib/mcp/server';
import { publishDue } from '@/lib/cms/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(req: Request) {
  const expected = process.env.MCP_TOKEN;
  if (!expected || expected.length < 32) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function unauthorized() {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="mcp"' },
  });
}

/** MCP over Streamable HTTP, stateless: a fresh server + transport per request (serverless friendly). */
async function handle(req: Request) {
  if (!authorized(req)) return unauthorized();
  if (req.method === 'POST') await publishDue({ label: 'scheduler' }).catch(() => null);
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON response mode: the reply is complete once handleRequest resolves
    void transport.close().catch(() => null);
    void server.close().catch(() => null);
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
