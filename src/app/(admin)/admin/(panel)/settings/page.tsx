import { getAllSettings } from '@/lib/cms/site';
import { ActionForm } from '../../components/ActionForm';
import { ImageField } from '../../components/ImageField';
import { saveSettings } from '../actions';

export const metadata = { title: '網站設定' };

export default async function SettingsPage() {
  const s = await getAllSettings();
  const c = (s.contact ?? {}) as Record<string, string>;
  const t = (s.tracking_ids ?? {}) as Record<string, string>;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-normal">網站設定</h1>
      <ActionForm action={saveSettings} className="space-y-6" submit="儲存設定">
        <section className="card space-y-3">
          <h2 className="font-semibold">一般</h2>
          <div>
            <label className="label">網站名稱</label>
            <input className="input" name="blogname" defaultValue={s.blogname ?? ''} required />
          </div>
          <div>
            <label className="label">網站說明</label>
            <textarea className="input h-24" name="blogdescription" defaultValue={s.blogdescription ?? ''} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ImageField name="site_logo" label="Logo（頁首／頁尾）" initial={s.site_logo} />
            <ImageField name="site_icon" label="網站圖示（favicon）" initial={s.site_icon} />
          </div>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">聯絡資訊</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">電話</label>
              <input className="input" name="contact.phone" defaultValue={c.phone ?? ''} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" name="contact.email" defaultValue={c.email ?? ''} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">地址</label>
              <input className="input" name="contact.address" defaultValue={c.address ?? ''} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">LINE 官方帳號連結（頁尾 LINE 按鈕）</label>
              <input className="input" name="contact.line" defaultValue={c.line ?? ''} placeholder="https://lin.ee/…" />
            </div>
          </div>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">追蹤碼</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Google Tag Manager</label>
              <input className="input" name="tracking.gtm" defaultValue={t.gtm ?? ''} placeholder="GTM-XXXXXXX" />
            </div>
            <div>
              <label className="label">Google tag（Site Kit）</label>
              <input className="input" name="tracking.google_tag" defaultValue={t.google_tag ?? ''} placeholder="GT-XXXXXXX / G-XXXXXXX" />
            </div>
            <div>
              <label className="label">GA4 評估 ID（透過 GTM 載入，僅紀錄）</label>
              <input className="input" name="tracking.ga4" defaultValue={t.ga4 ?? ''} placeholder="G-XXXXXXXXXX" />
            </div>
          </div>
          <p className="text-xs text-gray-500">清空欄位即停止載入該追蹤碼。儲存後全站約即時生效。</p>
        </section>
      </ActionForm>
    </div>
  );
}
