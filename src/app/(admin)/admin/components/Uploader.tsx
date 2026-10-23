'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile } from './upload';

export function Uploader() {
  const router = useRouter();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function handle(files: FileList | File[]) {
    setBusy(true);
    const out: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const m = await uploadFile(f);
        out.push(`✓ ${f.name} → ${m.duplicate ? '已存在相同檔案，沿用 #' + m.id : m.mime_type + ' #' + m.id}`);
      } catch (e) {
        out.push(`✗ ${f.name}：${(e as Error).message}`);
      }
      setLog([...out]);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div
      className={`card border-2 border-dashed text-center ${over ? 'border-[#2271b1] bg-blue-50' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) handle(e.dataTransfer.files);
      }}
    >
      <p className="mb-2">將檔案拖曳到這裡，或</p>
      <label className="btn btn-primary cursor-pointer">
        {busy ? '上傳中…' : '選擇檔案'}
        <input type="file" multiple className="hidden" disabled={busy} onChange={(e) => e.target.files && handle(e.target.files)} />
      </label>
      <p className="mt-2 text-xs text-gray-500">JPG/PNG 等圖片會自動轉成 WebP（最長邊 2000px）；GIF、SVG、影片、PDF 保留原檔。單檔上限 50MB。</p>
      {log.length ? (
        <ul className="mt-3 text-left text-xs">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
