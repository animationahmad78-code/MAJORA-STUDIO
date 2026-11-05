import { useEffect, useState } from 'react';
import { api, type InvoiceBrand } from './api';

export function InvoiceBrandSettings({ editable, onSaved }: { editable: boolean; onSaved?: () => void }) {
  const [profile, setProfile] = useState<InvoiceBrand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { api<InvoiceBrand>('/merchant/invoice-brand').then(setProfile).catch(e => setError(e.message)); }, []);
  const update = (key: keyof InvoiceBrand, value: string) => setProfile(p => p ? { ...p, [key]: value } : p);
  const image = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_048_576) {
      setError('لوگو باید PNG، JPEG یا WebP و حداکثر یک مگابایت باشد.'); return;
    }
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      update('logoDataUrl', result); setError('');
    } catch { setError('خواندن فایل لوگو انجام نشد؛ فایل دیگری انتخاب کنید.'); }
  };
  if (!profile) return <div className="card">{error || 'در حال دریافت تنظیمات فاکتور…'}</div>;
  return <div className="brand-settings">
    <div className="page-intro"><h2>هویت و قالب فاکتور</h2><p>متن‌ها و لوگوی این بخش برای فاکتورهای بعدی استفاده می‌شوند. نسخهٔ هر فاکتور هنگام صدور ثابت می‌ماند.</p></div>
    {error && <div className="field-error" role="alert">{error}</div>}{notice && <div className="toast success" role="status">{notice}</div>}
    <form onSubmit={async e => {
      e.preventDefault(); if (!editable) return; setBusy(true); setError(''); setNotice('');
      try { setProfile(await api<InvoiceBrand>('/merchant/invoice-brand', 'PUT', profile)); onSaved?.(); setNotice('قالب فاکتور ذخیره شد.'); }
      catch (err) { setError(err instanceof Error ? err.message : 'ذخیره انجام نشد.'); }
      finally { setBusy(false); }
    }}>
      <section className="card"><div className="card-head"><h2>نشان و مشخصات فروشگاه</h2><small>نسخه {profile.revision}</small></div>
        <div className="brand-form-layout"><div className="brand-logo-control">{profile.logoDataUrl ? <img src={profile.logoDataUrl} alt="پیش‌نمایش لوگوی فاکتور"/> : <div className="brand-logo-empty">نشان فروشگاه</div>}
          {editable && <><label>انتخاب لوگو<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void image(e.target.files?.[0])}/></label><button type="button" onClick={() => update('logoDataUrl', '')}>حذف لوگو</button></>}</div>
          <div className="form-grid"><label>نام فروشگاه<input value={profile.storeName} onChange={e => update('storeName', e.target.value)} maxLength={200} disabled={!editable} required/></label><label>شعار<input value={profile.slogan} onChange={e => update('slogan', e.target.value)} disabled={!editable}/></label><label>تلفن‌ها<input value={profile.phone} onChange={e => update('phone', e.target.value)} disabled={!editable}/></label><label>نشانی<input value={profile.address} onChange={e => update('address', e.target.value)} disabled={!editable}/></label><label>شماره کارت<input dir="ltr" value={profile.card} onChange={e => update('card', e.target.value)} disabled={!editable}/></label><label>نام صاحب کارت<input value={profile.cardHolder} onChange={e => update('cardHolder', e.target.value)} disabled={!editable}/></label></div></div>
      </section>
      <section className="card"><div className="card-head"><h2>متن‌ها و شرایط</h2></div><label>پیام زیر شماره کارت<textarea value={profile.note} onChange={e => update('note', e.target.value)} disabled={!editable}/></label>
        {profile.conditions.map((condition, index) => <div className="condition-field" key={index}><label>بند {index + 1}<textarea value={condition} onChange={e => setProfile(p => p ? { ...p, conditions: p.conditions.map((x, i) => i === index ? e.target.value : x) } : p)} disabled={!editable}/></label>{editable && <button type="button" onClick={() => setProfile(p => p ? { ...p, conditions: p.conditions.filter((_, i) => i !== index) } : p)}>حذف بند</button>}</div>)}
        {editable && profile.conditions.length < 12 && <button type="button" onClick={() => setProfile(p => p ? { ...p, conditions: [...p.conditions, ''] } : p)}>افزودن بند</button>}
      </section>
      <section className="card"><div className="card-head"><h2>راه‌های ارتباطی پایین فاکتور</h2></div><div className="form-grid"><label>تلگرام فروشگاه<input value={profile.socialTelegram} onChange={e => update('socialTelegram', e.target.value)} disabled={!editable}/></label><label>اینستاگرام<input value={profile.socialInstagram} onChange={e => update('socialInstagram', e.target.value)} disabled={!editable}/></label><label>شناسهٔ تماس<input value={profile.socialContact} onChange={e => update('socialContact', e.target.value)} disabled={!editable}/></label></div></section>
      {editable && <button className="primary brand-save" disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ تنظیمات فاکتور'}</button>}
    </form>
  </div>;
}
