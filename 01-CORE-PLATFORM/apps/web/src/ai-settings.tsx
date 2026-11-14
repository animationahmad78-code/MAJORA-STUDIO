import { useEffect, useState } from 'react';
import { api } from './api';

type Provider = { enabled: boolean; endpoint: string; model: string; hasApiKey: boolean; source: string };
type ConnectionTest = { success: boolean; provider?: string; errorCode?: string; message?: string; upstreamStatus?: number; latencyMs?: number; correlationId: string };

export function AiSettings() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState<ConnectionTest | null>(null);
  useEffect(() => { void api<Provider>('/admin/ai-provider').then(setProvider).catch(e => setError(e.message)); }, []);
  const save = async () => {
    if (!provider || busy) return;
    setBusy(true); setError(''); setNotice(''); setTestResult(null);
    try {
      const updated = await api<Provider>('/admin/ai-provider', 'PUT', { enabled: provider.enabled, endpoint: provider.endpoint.trim(), model: provider.model.trim(), apiKey: apiKey.trim() || null });
      setProvider(updated); setApiKey(''); setNotice('تنظیمات اتصال ذخیره شد. کلید در این صفحه نمایش داده نمی‌شود.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ذخیرهٔ اتصال انجام نشد.'); }
    finally { setBusy(false); }
  };
  const testConnection = async () => {
    if (busy) return;
    setBusy(true); setError(''); setTestResult(null);
    try { setTestResult(await api<ConnectionTest>('/admin/ai-provider/test', 'POST')); }
    catch (e) { setError(e instanceof Error ? e.message : 'آزمایش اتصال انجام نشد.'); }
    finally { setBusy(false); }
  };
  return <><div className="page-intro"><h2>اتصال مشاور هوش مصنوعی</h2><p>تنظیم سراسری ماژورا برای پاسخ تحلیلی به فروشگاه‌ها.</p></div>
    <section className="card"><div className="card-head"><h2>ارائه‌دهندهٔ تحلیل</h2></div>
      <p className="hint">نشانی کامل HTTPS را وارد کنید: OpenAI Chat Completions، مسیر سازگار Gemini با OpenAI یا Gemini Native ‎:generateContent. برای Gemini Native، مدلِ نشانی و فیلد مدل باید یکسان باشند. کلید فقط روی سرور نگهداری می‌شود.</p>
      {error && <div role="alert" className="field-error">{error}</div>}{notice && <div role="status" className="toast success">{notice}</div>}
      {provider ? <form className="form-grid" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>نشانی کامل Chat Completions<input dir="ltr" type="url" value={provider.endpoint} onChange={e => setProvider({ ...provider, endpoint: e.target.value })} placeholder="https://provider.example/v1/chat/completions" required /></label>
        <label>شناسهٔ مدل<input dir="ltr" value={provider.model} maxLength={120} onChange={e => setProvider({ ...provider, model: e.target.value })} placeholder="model-id" required /></label>
        <label>کلید API {provider.hasApiKey ? '(برای تعویض، کلید جدید را وارد کنید)' : ''}<input dir="ltr" type="password" autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider.hasApiKey ? 'کلید ذخیره‌شده محفوظ است' : 'کلید API'} /></label>
        <label className="check-label"><input type="checkbox" checked={provider.enabled} onChange={e => setProvider({ ...provider, enabled: e.target.checked })} />فعال‌کردن پاسخ هوش مصنوعی</label>
        <button className="primary" disabled={busy || (provider.enabled && !provider.hasApiKey && !apiKey.trim())}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ اتصال'}</button>
      </form> : <p>در حال دریافت تنظیمات…</p>}
      <button type="button" disabled={busy || !provider?.hasApiKey} onClick={() => void testConnection()}>آزمایش اتصال ذخیره‌شده</button>
      {testResult && <div className={testResult.success ? 'toast success' : 'field-error'} role="status">
        {testResult.success ? `اتصال ${testResult.provider} موفق بود.` : `${testResult.message} (${testResult.errorCode ?? 'unknown'})`}
        {' '}زمان پاسخ: {testResult.latencyMs ?? '—'} میلی‌ثانیه · شناسه پیگیری: <b dir="ltr">{testResult.correlationId}</b>
      </div>}
      <p className="hint">بدون اتصال، مشاور خلاصهٔ آماری داخلی را نمایش می‌دهد. پاسخ AI با دادهٔ خلاصهٔ ۳۰ روز و پرسش کاربر تولید می‌شود و نباید مبنای ثبت خودکار عملیات مالی باشد.</p>
    </section></>;
}
