import { useEffect, useState } from 'react';
import { api } from './api';

type Provider = { enabled: boolean; endpoint: string; model: string; hasApiKey: boolean; source: string };

export function AiSettings() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { void api<Provider>('/admin/ai-provider').then(setProvider).catch(e => setError(e.message)); }, []);
  const save = async () => {
    if (!provider || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await api<Provider>('/admin/ai-provider', 'PUT', { enabled: provider.enabled, endpoint: provider.endpoint.trim(), model: provider.model.trim(), apiKey: apiKey.trim() || null });
      setProvider(updated); setApiKey(''); setNotice('تنظیمات اتصال ذخیره شد. کلید در این صفحه نمایش داده نمی‌شود.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ذخیرهٔ اتصال انجام نشد.'); }
    finally { setBusy(false); }
  };
  return <><div className="page-intro"><h2>اتصال مشاور هوش مصنوعی</h2><p>تنظیم سراسری ماژورا برای پاسخ تحلیلی به فروشگاه‌ها.</p></div>
    <section className="card"><div className="card-head"><h2>ارائه‌دهندهٔ سازگار با OpenAI Chat Completions</h2></div>
      <p className="hint">فقط نشانی HTTPS عمومیِ API را وارد کنید. نام مدل را مطابق سرویس خود بنویسید. این تنظیم برای پرسش‌های مشاور فعال می‌شود؛ کلید فقط روی سرور نگهداری می‌شود.</p>
      {error && <div role="alert" className="field-error">{error}</div>}{notice && <div role="status" className="toast success">{notice}</div>}
      {provider ? <form className="form-grid" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>نشانی کامل Chat Completions<input dir="ltr" type="url" value={provider.endpoint} onChange={e => setProvider({ ...provider, endpoint: e.target.value })} placeholder="https://provider.example/v1/chat/completions" required /></label>
        <label>شناسهٔ مدل<input dir="ltr" value={provider.model} maxLength={120} onChange={e => setProvider({ ...provider, model: e.target.value })} placeholder="model-id" required /></label>
        <label>کلید API {provider.hasApiKey ? '(برای تعویض، کلید جدید را وارد کنید)' : ''}<input dir="ltr" type="password" autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider.hasApiKey ? 'کلید ذخیره‌شده محفوظ است' : 'کلید API'} /></label>
        <label className="check-label"><input type="checkbox" checked={provider.enabled} onChange={e => setProvider({ ...provider, enabled: e.target.checked })} />فعال‌کردن پاسخ هوش مصنوعی</label>
        <button className="primary" disabled={busy || (provider.enabled && !provider.hasApiKey && !apiKey.trim())}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ اتصال'}</button>
      </form> : <p>در حال دریافت تنظیمات…</p>}
      <p className="hint">بدون اتصال، مشاور خلاصهٔ آماری داخلی را نمایش می‌دهد. پاسخ AI با دادهٔ خلاصهٔ ۳۰ روز و پرسش کاربر تولید می‌شود و نباید مبنای ثبت خودکار عملیات مالی باشد.</p>
    </section></>;
}
