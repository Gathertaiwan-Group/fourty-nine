import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CmsError, type Actor } from '@/lib/cms/core';
import * as posts from '@/lib/cms/posts';
import * as terms from '@/lib/cms/terms';
import * as media from '@/lib/cms/media';
import * as site from '@/lib/cms/site';
import { siteUrl } from '@/lib/db';

const ACTOR: Actor = { label: 'mcp' };

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  const msg = e instanceof CmsError ? e.message : `內部錯誤：${(e as Error)?.message ?? e}`;
  if (!(e instanceof CmsError)) console.error('[mcp]', e);
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}
/** Wraps a tool body: JSON result or isError text. */
function h<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return err(e);
    }
  };
}

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const WR = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DEL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const postFields = {
  title: z.string().optional().describe('標題'),
  slug: z.string().optional().describe('網址代稱（留空依標題產生；中文可）'),
  content_html: z.string().optional().describe('內文 HTML'),
  excerpt_html: z.string().optional().describe('摘要 HTML（文章）'),
  status: z.enum(['draft', 'pending', 'publish', 'future', 'private']).optional(),
  date: z.string().optional().describe('發布時間 ISO 8601；status=future 時必填且需為未來時間'),
  author_id: z.number().int().nullable().optional(),
  featured_media_id: z.number().int().nullable().optional().describe('精選圖片的媒體 ID'),
  parent_id: z.number().int().nullable().optional().describe('上層頁面 ID（頁面）'),
  menu_order: z.number().int().optional(),
  seo_title: z.string().nullable().optional().describe('SEO 標題（Yoast），空字串＝清除'),
  seo_description: z.string().nullable().optional().describe('Meta 描述，空字串＝清除'),
  category_ids: z.array(z.number().int()).optional().describe('分類 ID 陣列（文章）；給了就整組取代'),
  tag_ids: z.array(z.number().int()).optional().describe('標籤 ID 陣列（文章）；給了就整組取代'),
};

function blockedHost(u: URL) {
  const h = u.hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) ||
    h === '[::1]' ||
    h.startsWith('[fc') ||
    h.startsWith('[fd')
  );
}

export function buildServer() {
  const server = new McpServer(
    { name: 'fortynine-days-cms', version: '1.0.0' },
    {
      instructions:
        '四拾九天數位整合行銷（fortynine-days.com）網站管理。內容寫入一律留稽核紀錄。建立內容預設為草稿（status=draft），確認後再以 update_post 設 status=publish。刪除預設移到回收桶（force=true 才永久刪除）。此站不是商店：沒有商品、價格與庫存；訂單資料表待舊站備份匯入。',
    },
  );

  /* ------------------------------------------------------------- site */
  server.registerTool(
    'site_info',
    { title: '網站概況', description: '網站名稱、網址、內容數量統計。', inputSchema: {}, annotations: RO },
    h(async () => ({ url: siteUrl(), settings: await site.getAllSettings(), counts: await site.dashboardCounts(), shop: false })),
  );

  /* ------------------------------------------------------------- posts & pages */
  server.registerTool(
    'list_posts',
    {
      title: '列出文章／頁面',
      description: '依類型、狀態、關鍵字列出文章或頁面（不含內文）。預設排除回收桶。',
      inputSchema: {
        post_type: z.enum(['post', 'page']).default('post'),
        status: z.enum(['all', 'publish', 'draft', 'pending', 'private', 'future', 'trash']).default('all'),
        search: z.string().optional().describe('標題關鍵字'),
        limit: z.number().int().min(1).max(200).default(20),
        offset: z.number().int().min(0).default(0),
      },
      annotations: RO,
    },
    h(async (a: { post_type: string; status: string; search?: string; limit: number; offset: number }) =>
      posts.listPosts({ post_type: a.post_type, status: a.status, q: a.search, limit: a.limit, offset: a.offset }),
    ),
  );
  server.registerTool(
    'get_post',
    {
      title: '讀取文章／頁面',
      description: '以 ID 或網址路徑讀取一篇文章／頁面（含內文 HTML、分類、標籤、SEO）。',
      inputSchema: { id: z.number().int().optional(), path: z.string().optional().describe('例如 /about/ 或完整網址') },
      annotations: RO,
    },
    h(async (a: { id?: number; path?: string }) => {
      let p = null;
      if (a.id) p = await posts.getPost(a.id);
      else if (a.path) {
        let path = a.path;
        try {
          if (/^https?:/.test(path)) path = new URL(path).pathname;
          path = decodeURIComponent(path);
        } catch {}
        if (!path.endsWith('/')) path += '/';
        p = await posts.getPostByPathAdmin(path);
      } else throw new CmsError('需要 id 或 path');
      if (!p) throw new CmsError('找不到文章', 404);
      return p;
    }),
  );
  server.registerTool(
    'create_post',
    {
      title: '新增文章／頁面',
      description: '新增文章或頁面。預設存成草稿；要直接發布請傳 status=publish，排程請傳 status=future 與 date。',
      inputSchema: { post_type: z.enum(['post', 'page']).default('post'), ...postFields },
      annotations: WR,
    },
    h(async (a: { post_type: string } & posts.PostInput) => {
      const { post_type, ...input } = a;
      return posts.createPost(post_type, { status: 'draft', ...input }, ACTOR);
    }),
  );
  server.registerTool(
    'update_post',
    {
      title: '修改文章／頁面',
      description: '只更新有傳入的欄位。改代稱時舊網址自動 301 到新網址。',
      inputSchema: { id: z.number().int(), ...postFields, status: z.enum(['draft', 'pending', 'publish', 'future', 'private', 'trash']).optional() },
      annotations: WR,
    },
    h(async (a: { id: number } & posts.PostInput) => {
      const { id, ...input } = a;
      return posts.updatePost(id, input, ACTOR);
    }),
  );
  server.registerTool(
    'delete_post',
    {
      title: '刪除文章／頁面',
      description: '預設移到回收桶（可用 restore_post 還原）；force=true 永久刪除。',
      inputSchema: { id: z.number().int(), force: z.boolean().default(false) },
      annotations: DEL,
    },
    h(async (a: { id: number; force: boolean }) => posts.deletePost(a.id, a.force, ACTOR)),
  );
  server.registerTool(
    'restore_post',
    { title: '從回收桶還原', description: '還原後為草稿（原本已發布的需再發布）。', inputSchema: { id: z.number().int() }, annotations: WR },
    h(async (a: { id: number }) => posts.restorePost(a.id, ACTOR)),
  );
  server.registerTool(
    'publish_scheduled',
    { title: '發布到期的排程', description: '把發布時間已到的排程文章改為已發布。', inputSchema: {}, annotations: WR },
    h(async () => posts.publishDue(ACTOR)),
  );

  /* ------------------------------------------------------------- terms */
  server.registerTool(
    'list_terms',
    { title: '列出分類／標籤', description: '列出分類（category）或標籤（post_tag）。', inputSchema: { taxonomy: z.enum(['category', 'post_tag']).optional() }, annotations: RO },
    h(async (a: { taxonomy?: string }) => terms.listTerms(a.taxonomy)),
  );
  server.registerTool(
    'create_term',
    {
      title: '新增分類／標籤',
      inputSchema: {
        taxonomy: z.enum(['category', 'post_tag']),
        name: z.string(),
        slug: z.string().optional(),
        description: z.string().optional(),
        parent_id: z.number().int().nullable().optional(),
      },
      annotations: WR,
    },
    h(async (a: { taxonomy: string; name: string; slug?: string; description?: string; parent_id?: number | null }) => terms.createTerm(a, ACTOR)),
  );
  server.registerTool(
    'update_term',
    {
      title: '修改分類／標籤',
      inputSchema: { id: z.number().int(), name: z.string().optional(), slug: z.string().optional(), description: z.string().optional(), parent_id: z.number().int().nullable().optional() },
      annotations: WR,
    },
    h(async (a: { id: number; name?: string; slug?: string; description?: string; parent_id?: number | null }) => {
      const { id, ...input } = a;
      return terms.updateTerm(id, input, ACTOR);
    }),
  );
  server.registerTool(
    'delete_term',
    { title: '刪除分類／標籤', description: '永久刪除，文章關聯一併移除。', inputSchema: { id: z.number().int() }, annotations: DEL },
    h(async (a: { id: number }) => terms.deleteTerm(a.id, ACTOR)),
  );

  /* ------------------------------------------------------------- media */
  server.registerTool(
    'list_media',
    {
      title: '列出媒體',
      inputSchema: {
        search: z.string().optional(),
        type: z.enum(['image', 'file']).optional(),
        limit: z.number().int().min(1).max(200).default(40),
        offset: z.number().int().min(0).default(0),
      },
      annotations: RO,
    },
    h(async (a: { search?: string; type?: 'image' | 'file'; limit: number; offset: number }) => media.listMedia({ q: a.search, type: a.type, limit: a.limit, offset: a.offset })),
  );
  server.registerTool(
    'get_media',
    { title: '讀取媒體', inputSchema: { id: z.number().int() }, annotations: RO },
    h(async (a: { id: number }) => {
      const m = await media.getMediaItem(a.id);
      if (!m) throw new CmsError('找不到媒體', 404);
      return m;
    }),
  );
  server.registerTool(
    'upload_media',
    {
      title: '上傳媒體',
      description: '從網址（url）或 base64 上傳。JPG/PNG 等自動轉 WebP（最長邊 2000、品質 80）；GIF/SVG/影片/PDF 保留原檔。相同檔案（SHA-1）不重複上傳，回傳既有項目。',
      inputSchema: {
        url: z.string().url().optional(),
        base64: z.string().optional(),
        filename: z.string().optional().describe('base64 上傳時必填，例如 photo.jpg'),
        title: z.string().optional(),
        alt_text: z.string().optional(),
      },
      annotations: WR,
    },
    h(async (a: { url?: string; base64?: string; filename?: string; title?: string; alt_text?: string }) => {
      let buffer: Buffer;
      let filename = a.filename;
      let mime: string | null = null;
      if (a.url) {
        const u = new URL(a.url);
        if (!/^https?:$/.test(u.protocol) || blockedHost(u)) throw new CmsError('不允許的網址');
        const res = await fetch(u, { headers: { 'User-Agent': 'GatherMigrator/1.0' }, signal: AbortSignal.timeout(30_000), redirect: 'follow' });
        if (!res.ok) throw new CmsError(`下載失敗：HTTP ${res.status}`);
        const len = Number(res.headers.get('content-length') || 0);
        if (len > media.MAX_BYTES) throw new CmsError('檔案超過 50MB');
        buffer = Buffer.from(await res.arrayBuffer());
        mime = res.headers.get('content-type')?.split(';')[0] || null;
        filename ||= decodeURIComponent(u.pathname.split('/').pop() || 'upload');
      } else if (a.base64) {
        if (!filename) throw new CmsError('base64 上傳需要 filename');
        buffer = Buffer.from(a.base64.replace(/^data:[^,]+,/, ''), 'base64');
      } else throw new CmsError('需要 url 或 base64');
      return media.uploadMedia({ buffer, filename: filename!, mime, title: a.title, alt_text: a.alt_text }, ACTOR);
    }),
  );
  server.registerTool(
    'update_media',
    {
      title: '修改媒體資訊',
      inputSchema: { id: z.number().int(), title: z.string().optional(), alt_text: z.string().optional(), caption_html: z.string().optional(), description_html: z.string().optional() },
      annotations: WR,
    },
    h(async (a: { id: number; title?: string; alt_text?: string; caption_html?: string; description_html?: string }) => {
      const { id, ...input } = a;
      return media.updateMedia(id, input, ACTOR);
    }),
  );
  server.registerTool(
    'delete_media',
    { title: '刪除媒體', description: '永久刪除檔案與紀錄。', inputSchema: { id: z.number().int() }, annotations: DEL },
    h(async (a: { id: number }) => media.deleteMedia(a.id, ACTOR)),
  );

  /* ------------------------------------------------------------- menus */
  server.registerTool(
    'list_menus',
    { title: '列出選單', inputSchema: {}, annotations: RO },
    h(async () => site.listMenus()),
  );
  server.registerTool(
    'get_menu',
    { title: '讀取選單', description: '含所有項目（parent_id 表示階層，position 為順序）。', inputSchema: { id: z.number().int() }, annotations: RO },
    h(async (a: { id: number }) => {
      const m = await site.getMenuWithItems(a.id);
      if (!m) throw new CmsError('找不到選單', 404);
      return m;
    }),
  );
  server.registerTool(
    'save_menu',
    {
      title: '儲存選單',
      description: '以 items 整組取代選單項目。items 依樹狀順序排列（上層在前），每項需唯一 key；沿用既有項目請帶 id；子項目以 parent_key 指向上層的 key。',
      inputSchema: {
        id: z.number().int(),
        name: z.string().optional(),
        items: z.array(
          z.object({
            key: z.string(),
            id: z.number().int().nullable().optional(),
            parent_key: z.string().nullable().optional(),
            title: z.string(),
            url: z.string(),
            object_type: z.string().nullable().optional(),
            object_id: z.number().int().nullable().optional(),
            target: z.enum(['_blank', '']).nullable().optional(),
            attr_title: z.string().nullable().optional(),
            classes: z.array(z.string()).optional(),
          }),
        ),
      },
      annotations: WR,
    },
    h(async (a: { id: number; name?: string; items: site.MenuItemInput[] }) => site.saveMenu(a.id, a.items.map((i) => ({ ...i, target: i.target || null })), ACTOR, a.name)),
  );

  /* ------------------------------------------------------------- forms */
  server.registerTool(
    'list_forms',
    { title: '列出表單', inputSchema: {}, annotations: RO },
    h(async () => site.listForms()),
  );
  server.registerTool(
    'list_form_submissions',
    {
      title: '查詢表單提交',
      inputSchema: {
        form_id: z.number().int().optional(),
        status: z.enum(['new', 'read', 'replied', 'spam', 'trash']).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: RO,
    },
    h(async (a: { form_id?: number; status?: string; search?: string; limit: number; offset: number }) =>
      site.listSubmissions({ form_id: a.form_id, status: a.status, q: a.search, limit: a.limit, offset: a.offset }),
    ),
  );
  server.registerTool(
    'update_form_submission_status',
    { title: '更新表單提交狀態', inputSchema: { id: z.string().uuid(), status: z.enum(['new', 'read', 'replied', 'spam', 'trash']) }, annotations: WR },
    h(async (a: { id: string; status: string }) => site.updateSubmissionStatus(a.id, a.status, ACTOR)),
  );

  /* ------------------------------------------------------------- orders */
  server.registerTool(
    'list_orders',
    {
      title: '查詢訂單',
      description: '舊站訂單待資料庫備份匯入後才會有資料。',
      inputSchema: {
        status: z.enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed']).optional(),
        search: z.string().optional().describe('訂單編號'),
        limit: z.number().int().min(1).max(200).default(20),
        offset: z.number().int().min(0).default(0),
      },
      annotations: RO,
    },
    h(async (a: { status?: string; search?: string; limit: number; offset: number }) => site.listOrders({ status: a.status, q: a.search, limit: a.limit, offset: a.offset })),
  );
  server.registerTool(
    'get_order',
    { title: '讀取訂單', inputSchema: { id: z.number().int() }, annotations: RO },
    h(async (a: { id: number }) => {
      const o = await site.getOrder(a.id);
      if (!o) throw new CmsError('找不到訂單', 404);
      return o;
    }),
  );
  server.registerTool(
    'update_order_status',
    {
      title: '更新訂單狀態',
      description: '只改狀態並加一則訂單備註；不會觸發任何金流。',
      inputSchema: { id: z.number().int(), status: z.enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed']), note: z.string().optional() },
      annotations: WR,
    },
    h(async (a: { id: number; status: string; note?: string }) => site.updateOrderStatus(a.id, a.status, a.note, ACTOR)),
  );

  /* ------------------------------------------------------------- settings */
  server.registerTool(
    'get_settings',
    { title: '讀取網站設定', inputSchema: {}, annotations: RO },
    h(async () => site.getAllSettings()),
  );
  server.registerTool(
    'update_settings',
    {
      title: '修改網站設定',
      description:
        '可修改：blogname（網站名稱）、blogdescription、site_logo {url, media_id}、site_icon {url, media_id}、contact {phone,email,address,line}、tracking_ids {gtm, google_tag, ga4}、chaty。只傳要改的 key。',
      inputSchema: { values: z.record(z.string(), z.unknown()) },
      annotations: WR,
    },
    h(async (a: { values: Record<string, unknown> }) => site.updateSettings(a.values, ACTOR)),
  );

  /* ------------------------------------------------------------- redirects */
  server.registerTool(
    'list_redirects',
    {
      title: '列出轉址',
      inputSchema: {
        search: z.string().optional(),
        kind: z.enum(['attachment', 'manual', 'legacy']).optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: RO,
    },
    h(async (a: { search?: string; kind?: string; limit: number; offset: number }) => site.listRedirects({ q: a.search, kind: a.kind, limit: a.limit, offset: a.offset })),
  );
  server.registerTool(
    'upsert_redirect',
    {
      title: '新增／修改轉址',
      inputSchema: { id: z.number().int().optional(), source_path: z.string(), target: z.string(), status_code: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308), z.literal(410)]).default(301) },
      annotations: WR,
    },
    h(async (a: { id?: number; source_path: string; target: string; status_code: number }) => site.upsertRedirect(a, ACTOR)),
  );
  server.registerTool(
    'delete_redirect',
    { title: '刪除轉址', inputSchema: { id: z.number().int() }, annotations: DEL },
    h(async (a: { id: number }) => site.deleteRedirect(a.id, ACTOR)),
  );

  /* ------------------------------------------------------------- audit */
  server.registerTool(
    'get_audit_log',
    {
      title: '查詢稽核紀錄',
      inputSchema: {
        entity: z.string().optional(),
        entity_id: z.string().optional(),
        actor: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: RO,
    },
    h(async (a: { entity?: string; entity_id?: string; actor?: string; limit: number; offset: number }) => site.listAudit(a)),
  );

  return server;
}
