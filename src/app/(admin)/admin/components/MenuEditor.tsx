'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveMenu } from '../(panel)/actions';

type Row = { key: string; id: number | null; depth: number; title: string; url: string; object_type: string | null; object_id: number | null; target: string | null; attr_title: string | null; classes: string[] };
type Src = { id: number; parent_id: number | null; position: number; title: string; url: string; object_type: string | null; object_id: number | null; target: string | null; attr_title: string | null; classes: string[] };
type Linkable = { id: number; title: string; url: string; type: 'page' | 'post' | 'category' };

function flatten(items: Src[]): Row[] {
  const out: Row[] = [];
  const walk = (pid: number | null, depth: number) => {
    for (const i of items.filter((x) => x.parent_id === pid).sort((a, b) => a.position - b.position)) {
      out.push({ key: String(i.id), id: i.id, depth, title: i.title, url: i.url, object_type: i.object_type, object_id: i.object_id, target: i.target, attr_title: i.attr_title, classes: i.classes ?? [] });
      walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function MenuEditor({ menu, linkables }: { menu: { id: number; name: string; items: Src[] }; linkables: Linkable[] }) {
  const router = useRouter();
  const [name, setName] = useState(menu.name);
  const [rows, setRows] = useState<Row[]>(() => flatten(menu.items));
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({ title: '', url: '' });
  const [q, setQ] = useState('');

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  // a block = item plus its descendants
  const blockEnd = (r: Row[], i: number) => {
    let j = i + 1;
    while (j < r.length && r[j].depth > r[i].depth) j++;
    return j;
  };
  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const end = blockEnd(r, i);
      const block = r.slice(i, end);
      const rest = [...r.slice(0, i), ...r.slice(end)];
      if (dir === -1) {
        let k = i - 1;
        while (k > 0 && rest[k].depth > block[0].depth) k--;
        if (k < 0 || rest[k]?.depth < block[0].depth) return r;
        rest.splice(k, 0, ...block);
      } else {
        const k = i;
        if (k >= rest.length || rest[k].depth < block[0].depth) return r;
        const nextEnd = blockEnd(rest, k);
        rest.splice(nextEnd, 0, ...block);
      }
      return rest;
    });
  const indent = (i: number, d: -1 | 1) =>
    setRows((r) => {
      if (d === 1 && (i === 0 || r[i - 1].depth < r[i].depth)) return r;
      if (d === -1 && r[i].depth === 0) return r;
      const end = blockEnd(r, i);
      return r.map((x, j) => (j >= i && j < end ? { ...x, depth: x.depth + d } : x));
    });
  const remove = (i: number) => setRows((r) => [...r.slice(0, i), ...r.slice(blockEnd(r, i))]);
  const add = (row: Omit<Row, 'key' | 'id' | 'depth' | 'classes' | 'attr_title' | 'target'>) =>
    setRows((r) => [...r, { ...row, key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, id: null, depth: 0, classes: [], attr_title: null, target: null }]);

  async function save() {
    setBusy(true);
    setMsg(null);
    const stack: Row[] = [];
    const items = rows.map((r) => {
      while (stack.length > r.depth) stack.pop();
      const parent = stack[stack.length - 1];
      stack.push(r);
      return { key: r.key, id: r.id, parent_key: parent?.key ?? null, title: r.title, url: r.url, object_type: r.object_type, object_id: r.object_id, target: r.target, attr_title: r.attr_title, classes: r.classes };
    });
    const res = await saveMenu(menu.id, name, items);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: '選單已儲存，網站已更新。' });
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <div className="card space-y-2">
          <h2 className="font-semibold">加入頁面／文章／分類</h2>
          <input className="input" placeholder="搜尋" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-72 overflow-auto text-sm">
            {linkables
              .filter((l) => !q || l.title.toLowerCase().includes(q.toLowerCase()))
              .slice(0, 80)
              .map((l) => (
                <button key={`${l.type}-${l.id}`} className="flex w-full justify-between px-1 py-1 text-left hover:bg-gray-100" onClick={() => add({ title: l.title, url: l.url, object_type: l.type, object_id: l.id })}>
                  <span>{l.title}</span>
                  <span className="text-xs text-gray-500">{l.type === 'page' ? '頁面' : l.type === 'post' ? '文章' : '分類'}</span>
                </button>
              ))}
          </div>
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold">自訂連結</h2>
          <input className="input" placeholder="網址（/path/ 或 https://…）" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} />
          <input className="input" placeholder="連結文字" value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} />
          <button
            className="btn"
            onClick={() => {
              if (!custom.title || !custom.url) return;
              add({ title: custom.title, url: custom.url, object_type: 'custom', object_id: null });
              setCustom({ title: '', url: '' });
            }}
          >
            加入選單
          </button>
        </div>
      </div>
      <div className="card space-y-3">
        {msg ? <div className={`notice ${msg.ok ? '' : 'notice-error'}`}>{msg.text}</div> : null}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label">選單名稱</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? '儲存中…' : '儲存選單'}
          </button>
        </div>
        <p className="text-xs text-gray-500">用 ↑ ↓ 調整順序，→ 設為上一項的子項目，← 取消子項目。</p>
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={r.key} style={{ marginLeft: r.depth * 28 }} className="rounded border bg-gray-50">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button className="flex-1 truncate text-left font-medium" onClick={() => setOpen(open === r.key ? null : r.key)}>
                  {r.title} <span className="text-xs font-normal text-gray-500">{r.url}</span>
                </button>
                <span className="text-xs text-gray-500">{r.object_type === 'page' ? '頁面' : r.object_type === 'post' ? '文章' : r.object_type === 'category' ? '分類' : '自訂'}</span>
                <button className="px-1" title="上移" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="px-1" title="下移" onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="px-1" title="取消子項目" onClick={() => indent(i, -1)}>
                  ←
                </button>
                <button className="px-1" title="設為子項目" onClick={() => indent(i, 1)}>
                  →
                </button>
              </div>
              {open === r.key ? (
                <div className="grid gap-2 border-t bg-white p-2 sm:grid-cols-2">
                  <div>
                    <label className="label">導覽標籤</label>
                    <input className="input" value={r.title} onChange={(e) => update(i, { title: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">網址</label>
                    <input className="input" value={r.url} onChange={(e) => update(i, { url: e.target.value })} />
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={r.target === '_blank'} onChange={(e) => update(i, { target: e.target.checked ? '_blank' : null })} />
                    在新分頁開啟
                  </label>
                  <div className="text-right">
                    <button className="text-xs text-red-600 underline" onClick={() => remove(i)}>
                      移除（含子項目）
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
