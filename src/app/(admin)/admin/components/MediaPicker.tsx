'use client';
import { useCallback, useEffect, useState } from 'react';
import { uploadFile } from './upload';

type Item = { id: number; url: string | null; title: string; mime_type: string; width: number | null; height: number | null };

export function MediaPicker({ open, onClose, onSelect, type = 'image' }: { open: boolean; onClose: () => void; onSelect: (m: Item) => void; type?: 'image' | 'file' | '' }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(
    async (offset = 0) => {
      setBusy(true);
      const r = await fetch(`/admin/api/media/?type=${type}&q=${encodeURIComponent(q)}&offset=${offset}&limit=40`).then((r) => r.json());
      setItems((prev) => (offset ? [...prev, ...(r.items || [])] : r.items || []));
      setTotal(r.total || 0);
      setBusy(false);
    },
    [q, type],
  );

  useEffect(() => {
    if (open) load(0);
  }, [open, load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="font-semibold">選擇媒體</h2>
          <button className="text-xl" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <input className="input w-60" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋媒體" onKeyDown={(e) => e.key === 'Enter' && load(0)} />
          <button className="btn" onClick={() => load(0)}>
            搜尋
          </button>
          <label className="btn btn-primary cursor-pointer">
            上傳檔案
            <input
              type="file"
              className="hidden"
              accept={type === 'image' ? 'image/*' : undefined}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setErr('');
                setBusy(true);
                try {
                  const m = await uploadFile(f);
                  onSelect(m as unknown as Item);
                } catch (x) {
                  setErr((x as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {busy ? <span className="text-xs text-gray-500">處理中…</span> : null}
          {err ? <span className="text-xs text-red-600">{err}</span> : null}
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2 overflow-auto p-3 sm:grid-cols-5 md:grid-cols-6">
          {items.map((m) => (
            <button key={m.id} className="group relative aspect-square overflow-hidden rounded border bg-gray-50 hover:ring-2 hover:ring-[#2271b1]" onClick={() => onSelect(m)} title={m.title}>
              {m.mime_type.startsWith('image/') && m.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.title} loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span className="p-2 text-xs break-all">{m.title}</span>
              )}
            </button>
          ))}
        </div>
        {items.length < total ? (
          <div className="border-t p-3 text-center">
            <button className="btn" onClick={() => load(items.length)} disabled={busy}>
              載入更多（{items.length}/{total}）
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
