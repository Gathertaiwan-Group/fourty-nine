'use client';
import { useState } from 'react';
import { MediaPicker } from './MediaPicker';

export function ImageField({ name, label, initial }: { name: string; label: string; initial?: { url?: string; media_id?: number | null } | null }) {
  const [v, setV] = useState({ url: initial?.url ?? '', media_id: initial?.media_id ?? null });
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span className="label">{label}</span>
      <input type="hidden" name={`${name}.url`} value={v.url} />
      <input type="hidden" name={`${name}.media_id`} value={v.media_id ?? ''} />
      <div className="flex items-center gap-3">
        {v.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.url} alt="" className="h-16 w-auto rounded border bg-white p-1" />
        ) : (
          <span className="text-xs text-gray-500">未設定</span>
        )}
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          選擇圖片
        </button>
      </div>
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(m) => {
          setV({ url: m.url ?? '', media_id: m.id });
          setOpen(false);
        }}
      />
    </div>
  );
}
