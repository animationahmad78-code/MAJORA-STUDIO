import { useEffect, useState } from 'react';
import { api, type InvoiceBrand, type InvoiceSocialLink, type Tenant } from './api';
import { prepareImage } from './image-upload';

const socialPlatforms: { value: InvoiceSocialLink['platform']; label: string }[] = [
  { value: 'telegram', label: 'تلگرام' }, { value: 'instagram', label: 'اینستاگرام' },
  { value: 'whatsapp', label: 'واتساپ' }, { value: 'bale', label: 'بله' },
  { value: 'rubika', label: 'روبیکا' }, { value: 'eitaa', label: 'ایتا' },
  { value: 'linkedin', label: 'لینکدین' }, { value: 'x', label: 'ایکس' },
  { value: 'website', label: 'وب‌سایت' }, { value: 'phone', label: 'تلفن' }
];

export function InvoiceBrandSettings({ editable, tenantId, onSaved }: { editable: boolean; tenantId?: string; onSaved?: () => void }) {
  const [profile, setProfile] = useState<InvoiceBrand | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const path = tenantId ? `/admin/tenants/${tenantId}/invoice-brand` : '/merchant/invoice-brand';
  useEffect(() => { setProfile(null); setError(''); api<InvoiceBrand>(path).then(setProfile).catch(e => setError(e.message)); }, [path]);
  const update = (key: keyof InvoiceBrand, value: string) => setProfile(p => p ? { ...p, [key]: value } : p);
  const updateSocial = (index: number, changes: Partial<InvoiceSocialLink>) => setProfile(p => p ? {
    ...p, socialLinks: (p.socialLinks ?? []).map((link, i) => i === index ? { ...link, ...changes } : link)
  } : p);
  const image = async (file?: File) => {
    if (!file) return;
    try {
      update('logoDataUrl', await prepareImage(file)); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'خواندن فایل لوگو انجام نشد؛ فایل دیگری انتخاب کنید.'); }
  };
  if (!profile) return <div className="card">{error || 'در حال دریافت تنظیمات فاکتور…'}</div>;
  return <div className="brand-settings">
    <div className="page-intro"><h2>هویت و قالب فاکتور</h2><p>تغییرات روی فاکتورهای بعدی اعمال می‌شوند؛ فاکتورهای صادرشده همان مشخصات زمان صدور را حفظ می‌کنند.</p></div>
    {!editable && <div className="brand-locked" role="note"><span aria-hidden="true">🔒</span> نام، شعار و لوگوی اصلی توسط ماژورا مدیریت می‌شوند. تلفن، نشانی، کارت، شرایط و راه‌های ارتباطی فاکتور را می‌توانید ویرایش کنید.</div>}
    {error && <div className="field-error" role="alert">{error}</div>}{notice && <div className="toast success" role="status">{notice}</div>}
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(''); setNotice('');
      try { setProfile(await api<InvoiceBrand>(path, 'PUT', tenantId ? { brand: profile, reason } : profile)); setReason(''); onSaved?.(); setNotice('قالب فاکتور ذخیره شد.'); }
      catch (err) { setError(err instanceof Error ? err.message : 'ذخیره انجام نشد.'); }
      finally { setBusy(false); }
    }}>
      <section className="card"><div className="card-head"><h2>نشان و مشخصات فروشگاه</h2><small>نسخه {profile.revision}</small></div>
        <div className="brand-form-layout"><div className="brand-logo-control">{profile.logoDataUrl ? <img src={profile.logoDataUrl} alt="پیش‌نمایش لوگوی فاکتور"/> : <div className="brand-logo-empty">نشان فروشگاه</div>}
          {editable && <label>جایگزینی لوگو<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void image(e.target.files?.[0])}/></label>}</div>
          <div className="form-grid"><label>نام فروشگاه {!editable && '🔒'}<input value={profile.storeName} onChange={e => update('storeName', e.target.value)} maxLength={200} disabled={!editable} required/></label><label>شعار {!editable && '🔒'}<input value={profile.slogan} onChange={e => update('slogan', e.target.value)} disabled={!editable}/></label><label>تلفن‌ها<input value={profile.phone} onChange={e => update('phone', e.target.value)} /></label><label>نشانی<input value={profile.address} onChange={e => update('address', e.target.value)} /></label><label>شماره کارت<input dir="ltr" value={profile.card} onChange={e => update('card', e.target.value)} /></label><label>نام صاحب کارت<input value={profile.cardHolder} onChange={e => update('cardHolder', e.target.value)} /></label></div></div>
      </section>
      <section className="card"><div className="card-head"><h2>متن‌ها و شرایط</h2></div><label>پیام زیر شماره کارت<textarea value={profile.note} onChange={e => update('note', e.target.value)} /></label>
        {profile.conditions.map((condition, index) => <div className="condition-field" key={index}><label>بند {index + 1}<textarea value={condition} onChange={e => setProfile(p => p ? { ...p, conditions: p.conditions.map((x, i) => i === index ? e.target.value : x) } : p)} /></label><button type="button" onClick={() => setProfile(p => p ? { ...p, conditions: p.conditions.filter((_, i) => i !== index) } : p)}>حذف بند</button></div>)}
        {profile.conditions.length < 12 && <button type="button" onClick={() => setProfile(p => p ? { ...p, conditions: [...p.conditions, ''] } : p)}>افزودن بند</button>}
      </section>
      <section className="card"><div className="card-head"><h2>راه‌های ارتباطی پایین فاکتور</h2><small>حداکثر چهار مورد، به ترتیب نمایش</small></div>
        <p className="hint">هر مورد را روشن کنید، نوع آن را برگزینید و شناسه یا شمارهٔ قابل خواندن را بنویسید. این موارد در پایین صفحهٔ فاکتور چاپ می‌شوند.</p>
        <div className="social-link-settings">{(profile.socialLinks ?? []).map((link, index) => <div className="social-link-row" key={index}>
          <label className="check-label"><input type="checkbox" checked={link.enabled} onChange={e => updateSocial(index, { enabled: e.target.checked })}/>نمایش</label>
          <label>نوع<select value={link.platform} onChange={e => updateSocial(index, { platform: e.target.value as InvoiceSocialLink['platform'] })}>{socialPlatforms.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>شناسه یا نشانی<input dir="auto" maxLength={90} value={link.text} onChange={e => updateSocial(index, { text: e.target.value })} placeholder={link.platform === 'website' ? 'example.ir' : link.platform === 'phone' ? '۰۹۱۲…' : '@شناسه'}/></label>
          <button type="button" aria-label={`حذف راه ارتباطی ${index + 1}`} onClick={() => setProfile(p => p ? { ...p, socialLinks: p.socialLinks.filter((_, i) => i !== index) } : p)}>حذف</button>
        </div>)}</div>
        {(profile.socialLinks ?? []).length < 4 && <button type="button" onClick={() => setProfile(p => p ? { ...p, socialLinks: [...(p.socialLinks ?? []), { platform: 'website', text: '', enabled: false }] } : p)}>افزودن راه ارتباطی</button>}
      </section>
      {editable && <label>دلیل تغییر هویت یا قالب<input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} required/></label>}<button className="primary brand-save" disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ تنظیمات فاکتور'}</button>
    </form>
  </div>;
}

export function AdminInvoiceBrandSettings() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api<Tenant[]>('/admin/tenants').then(setTenants).catch(e => setError(e.message)); }, []);
  return <div className="brand-settings">
    <div className="page-intro"><h2>هویت فروشگاه‌ها</h2><p>نام و لوگوی اصلی فقط در پنل مالک ماژورا تغییر می‌کنند.</p></div>
    {error && <div className="field-error" role="alert">{error}</div>}
    <label>انتخاب فروشگاه<select value={tenantId} onChange={e => setTenantId(e.target.value)}><option value="">فروشگاه را انتخاب کنید</option>{tenants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    {tenantId && <InvoiceBrandSettings key={tenantId} tenantId={tenantId} editable onSaved={() => { api<Tenant[]>('/admin/tenants').then(setTenants).catch(e => setError(e.message)); }} />}
  </div>;
}
