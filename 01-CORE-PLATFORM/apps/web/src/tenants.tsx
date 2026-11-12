import { useEffect, useRef, useState } from 'react';
import { api, dateFa, rial, type InvoiceSocialLink, type Plan, type Tenant } from './api';
import { JalaliDateField, isoToJalaliDate, jalaliToIsoDate } from '../../mobile/src/jalali-date';
import './tenants.css';

const classicName = 'کیف و کمربند کلاسیک';
const accessLabels: Record<string, string> = { active: 'دسترسی فعال', suspended: 'تعلیق مدیریتی', scheduled: 'شروع در آینده', pending_payment: 'در انتظار پرداخت', expired: 'اشتراک منقضی', draft: 'بدون اشتراک' };
const accessLabel = (tenant: Tenant) => accessLabels[tenant.subscriptionStatus ?? ''] ?? (tenant.enabled ? 'وضعیت نامشخص' : 'تعلیق مدیریتی');
const stages = ['هویت', 'برند و فاکتور', 'اشتراک', 'حساب مالک', 'بازبینی'];
const blankLink = (): InvoiceSocialLink => ({ platform: 'instagram', text: '', enabled: false });
type Draft = {
  name: string; slug: string; brandColor: string; classicPreset: boolean; slogan: string;
  logoDataUrl: string; phone: string; address: string; card: string; cardHolder: string;
  note: string; conditions: string; links: InvoiceSocialLink[];
  planId: string; startsAt: string; endsAt: string; paymentStatus: 'paid' | 'pending';
  ownerUsername: string; ownerName: string; ownerPassword: string;
};
const fresh = (): Draft => ({
  name: '', slug: '', brandColor: '#0B2B53', classicPreset: false, slogan: '', logoDataUrl: '',
  phone: '', address: '', card: '', cardHolder: '', note: '', conditions: '', links: [blankLink()],
  planId: '', startsAt: isoToJalaliDate(new Date().toISOString()),
  endsAt: isoToJalaliDate(new Date(Date.now() + 30 * 86_400_000).toISOString()),
  paymentStatus: 'pending', ownerUsername: '', ownerName: '', ownerPassword: ''
});
const atNoon = (jalali: string) => {
  const iso = jalaliToIsoDate(jalali);
  if (!iso) throw new Error('تاریخ شمسی را کامل و معتبر وارد کنید.');
  return new Date(`${iso}T12:00:00`).toISOString();
};
const platforms: { key: InvoiceSocialLink['platform']; label: string }[] = [
  { key: 'instagram', label: 'اینستاگرام' }, { key: 'telegram', label: 'تلگرام' },
  { key: 'whatsapp', label: 'واتساپ' }, { key: 'bale', label: 'بله' },
  { key: 'rubika', label: 'روبیکا' }, { key: 'eitaa', label: 'ایتا' },
  { key: 'linkedin', label: 'لینکدین' }, { key: 'x', label: 'ایکس' },
  { key: 'website', label: 'وب‌سایت' }, { key: 'phone', label: 'تلفن' }
];

export function Tenants() {
  const [items, setItems] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [draft, setDraft] = useState<Draft>(fresh);
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Tenant | null>(null);
  const [sub, setSub] = useState<{ tenantId: string; planId: string; startsAt: string; endsAt: string; paymentStatus: 'paid' | 'pending' } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const load = async () => { const [tenants, availablePlans] = await Promise.all([api<Tenant[]>('/admin/tenants'), api<Plan[]>('/admin/plans')]); setItems(tenants); setPlans(availablePlans); };
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'فروشگاه‌ها دریافت نشدند.')); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const plan = plans.find(item => item.id === draft.planId);
  const fieldError = (message: string) => { setError(message); return false; };
  const valid = (step: number) => {
    if (step === 0 && (!draft.name.trim() || draft.name.length > 200 || !/^[a-z0-9-]{3,40}$/.test(draft.slug)))
      return fieldError('نام فروشگاه و شناسهٔ لاتین ۳ تا ۴۰ نویسه‌ای را بررسی کنید.');
    if (step === 1 && !draft.classicPreset && !draft.logoDataUrl)
      return fieldError('لوگوی اختصاصی این فروشگاه را بارگذاری کنید؛ لوگوی فروشگاه دیگر استفاده نمی‌شود.');
    if (step === 1 && (draft.conditions.split('\n').filter(Boolean).length > 12 || draft.links.some(link => link.enabled && !link.text.trim())))
      return fieldError('حداکثر ۱۲ بند و برای هر راه ارتباطی فعال، متن معتبر وارد کنید.');
    if (step === 2) {
      if (!plan?.enabled) return fieldError('یک طرح اشتراک فعال انتخاب کنید.');
      try { if (atNoon(draft.endsAt) <= atNoon(draft.startsAt)) return fieldError('پایان اشتراک باید پس از شروع آن باشد.'); }
      catch (e) { return fieldError(e instanceof Error ? e.message : 'تاریخ اشتراک نامعتبر است.'); }
    }
    if (step === 3 && (!draft.ownerName.trim() || !draft.ownerUsername.trim() || draft.ownerPassword.length < 12))
      return fieldError('نام مالک، نام کاربری و رمز دست‌کم ۱۲ نویسه‌ای را کامل کنید.');
    setError(''); return true;
  };
  const next = () => { if (valid(stage)) setStage(value => Math.min(4, value + 1)); };
  const logo = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_048_576 || file.size < 100) {
      setError('لوگو باید PNG، JPEG یا WebP معتبر و حداکثر یک مگابایت باشد.'); return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      set('logoDataUrl', data); setError('');
    } catch { setError('فایل لوگو خوانده نشد؛ دوباره انتخاب کنید.'); }
  };
  const create = async () => {
    if (busy) return;
    for (let step = 0; step < 4; step++) {
      if (!valid(step)) { setStage(step); return; }
    }
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/admin/tenants', 'POST', {
        name: draft.name.trim(), slug: draft.slug, brandColor: draft.brandColor,
        classicPreset: draft.classicPreset, ownerUsername: draft.ownerUsername.trim(),
        ownerName: draft.ownerName.trim(), ownerPassword: draft.ownerPassword,
        planId: draft.planId, startsAt: atNoon(draft.startsAt), endsAt: atNoon(draft.endsAt),
        paymentStatus: draft.paymentStatus,
        brand: draft.classicPreset ? null : {
          revision: 1, storeName: draft.name.trim(), slogan: draft.slogan.trim(),
          logoDataUrl: draft.logoDataUrl, phone: draft.phone.trim(), address: draft.address.trim(),
          card: draft.card.trim(), cardHolder: draft.cardHolder.trim(), note: draft.note.trim(),
          conditions: draft.conditions.split('\n').map(x => x.trim()).filter(Boolean),
          socialTelegram: '', socialInstagram: '', socialContact: '',
          socialLinks: draft.links.filter(link => link.enabled).map(link => ({ ...link, text: link.text.trim() }))
        }
      });
      setDraft(fresh()); setStage(0); await load();
      setNotice('فروشگاه، قالب فاکتور، مالک و اشتراک با هم ثبت شدند. وضعیت پرداخت را پیش از بهره‌برداری بررسی کنید.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ساخت فروشگاه انجام نشد؛ اطلاعات فرم حفظ شد.'); }
    finally { setBusy(false); }
  };
  const toggle = async (tenant: Tenant) => {
    const operation = tenant.enabled ? 'تعلیق' : 'فعال‌سازی';
    if (!window.confirm(`${operation} فروشگاه «${tenant.name}» انجام شود؟`)) return;
    setBusy(true); setError('');
    try { await api(`/admin/tenants/${tenant.id}`, 'PUT', { name: tenant.name, enabled: !tenant.enabled, brandColor: tenant.brandColor, logoUrl: tenant.logoUrl }); await load(); setNotice(`${operation} ثبت شد.`); }
    catch (e) { setError(e instanceof Error ? e.message : `${operation} انجام نشد.`); }
    finally { setBusy(false); }
  };
  const approve = async (tenant: Tenant) => {
    if (!tenant.subscription || tenant.subscription.paymentStatus !== 'pending') return;
    if (!window.confirm(`واریز اشتراک فروشگاه «${tenant.name}» واقعاً بررسی و تأیید شد؟`)) return;
    setBusy(true); setError('');
    try {
      await api(`/admin/tenants/${tenant.id}/subscriptions/${tenant.subscription.id}/approve`, 'POST', { reason: 'تأیید پرداخت پس از بررسی توسط مالک ماژورا' });
      await load(); setNotice('پرداخت اشتراک تأیید و دسترسی فروشگاه به‌روز شد.');
    } catch (e) { setError(e instanceof Error ? e.message : 'تأیید اشتراک انجام نشد.'); }
    finally { setBusy(false); }
  };
  const saveSubscription = async () => {
    if (!sub || busy) return;
    setBusy(true); setError('');
    try {
      await api(`/admin/tenants/${sub.tenantId}/subscription`, 'POST', {
        planId: sub.planId, startsAt: atNoon(sub.startsAt), endsAt: atNoon(sub.endsAt), paymentStatus: sub.paymentStatus
      });
      setSub(null); await load(); setNotice('اشتراک ثبت شد.');
    } catch (e) { setError(e instanceof Error ? e.message : 'اشتراک ثبت نشد؛ داده‌های فرم حفظ شد.'); }
    finally { setBusy(false); }
  };
  return <div className="tenant-page">
    <div className="page-intro"><h2>فروشگاه‌ها</h2><p>ساخت مرحله‌ای و کنترل هویت، اشتراک و حساب مالک از پنل ماژورا.</p></div>
    {error && <div className="field-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
    {notice && <div className="field-success" role="status">{notice}</div>}
    <div className="tenant-layout"><section className="card tenant-wizard" aria-label="ساخت فروشگاه جدید">
      <div className="card-head"><h2>فروشگاه جدید</h2><small>مرحلهٔ {stage + 1} از {stages.length}</small></div>
      <ol className="tenant-steps">{stages.map((label, index) => <li key={label} className={index === stage ? 'active' : index < stage ? 'done' : ''}>{index + 1}. {label}</li>)}</ol>
      {stage === 0 && <div className="form-grid"><label>نام رسمی فروشگاه<input value={draft.name} maxLength={200} onChange={e => setDraft(value => ({ ...value, name: e.target.value, classicPreset: e.target.value.trim() === classicName && value.classicPreset }))} required /></label><label>شناسهٔ لاتین یکتا<input dir="ltr" value={draft.slug} maxLength={40} onChange={e => set('slug', e.target.value.toLowerCase())} placeholder="example-shop" required /></label><label>رنگ اصلی برند<input type="color" value={draft.brandColor} onChange={e => set('brandColor', e.target.value)} /></label><p className="tenant-help">شناسه در نشانی فروشگاه به کار می‌رود و پس از ساخت تغییر آن نیازمند بررسی پشتیبانی است.</p></div>}
      {stage === 1 && <div className="tenant-brand-stage"><label className="check-label"><input type="checkbox" checked={draft.classicPreset} disabled={draft.name.trim() !== classicName} onChange={e => set('classicPreset', e.target.checked)} />درج اطلاعات و لوگوی تأییدشدهٔ کیف و کمربند کلاسیک</label><p className="tenant-help">قالب صفحهٔ فاکتور برای همهٔ فروشگاه‌ها یکسان است؛ اطلاعات و لوگوی نمونه فقط برای فروشگاه اصلی مجازند.</p>{!draft.classicPreset && <><div className="tenant-brand-preview" style={{ borderColor: draft.brandColor }}><div>{draft.logoDataUrl ? <img src={draft.logoDataUrl} alt="پیش‌نمایش نشان فروشگاه" /> : <span aria-hidden="true">✦</span>}</div><strong>{draft.name || 'نام فروشگاه'}</strong><small>{draft.slogan || 'شعار فروشگاه'}</small></div><div className="form-grid"><label>لوگوی اختصاصی<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void logo(e.target.files?.[0])} /></label><label>شعار<input value={draft.slogan} onChange={e => set('slogan', e.target.value)} maxLength={200}/></label><label>تلفن‌ها<input value={draft.phone} onChange={e => set('phone', e.target.value)} /></label><label>نشانی<input value={draft.address} onChange={e => set('address', e.target.value)} /></label><label>شماره کارت<input dir="ltr" value={draft.card} onChange={e => set('card', e.target.value)} /></label><label>نام صاحب کارت<input value={draft.cardHolder} onChange={e => set('cardHolder', e.target.value)} /></label><label>پیام زیر کارت<input value={draft.note} onChange={e => set('note', e.target.value)} /></label><label className="tenant-full">شرایط فروش، هر بند در یک خط<textarea value={draft.conditions} onChange={e => set('conditions', e.target.value)} rows={4}/></label></div><div className="tenant-links"><h3>راه‌های ارتباطی پایین فاکتور</h3>{draft.links.map((link, index) => <div className="tenant-link" key={index}><label className="check-label"><input type="checkbox" checked={link.enabled} onChange={e => set('links', draft.links.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item))}/>نمایش</label><select aria-label={`نوع راه ارتباطی ${index + 1}`} value={link.platform} onChange={e => set('links', draft.links.map((item, i) => i === index ? { ...item, platform: e.target.value as InvoiceSocialLink['platform'] } : item))}>{platforms.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select><input aria-label={`شناسهٔ راه ارتباطی ${index + 1}`} value={link.text} onChange={e => set('links', draft.links.map((item, i) => i === index ? { ...item, text: e.target.value } : item))} maxLength={90} placeholder="شناسه یا نشانی"/><button type="button" onClick={() => set('links', draft.links.filter((_, i) => i !== index))}>حذف</button></div>)}{draft.links.length < 4 && <button type="button" onClick={() => set('links', [...draft.links, blankLink()])}>افزودن راه ارتباطی</button>}</div></>}</div>}
      {stage === 2 && <div className="form-grid"><label>طرح اشتراک<select value={draft.planId} onChange={e => set('planId', e.target.value)}><option value="">طرح را انتخاب کنید</option>{plans.filter(x => x.enabled).map(x => <option key={x.id} value={x.id}>{x.name} · {rial(x.monthlyRial)} در ماه</option>)}</select></label>{plan && <p className="tenant-help">{plan.description} · تا {plan.maxUsers} کاربر و {plan.maxDevices} نشست فعال</p>}<JalaliDateField label="شروع اشتراک (شمسی)" value={draft.startsAt} onChange={value => set('startsAt', value)} /><JalaliDateField label="پایان اشتراک (شمسی)" value={draft.endsAt} onChange={value => set('endsAt', value)} /><label>وضعیت پرداخت<select value={draft.paymentStatus} onChange={e => set('paymentStatus', e.target.value as Draft['paymentStatus'])}><option value="pending">در انتظار تأیید</option><option value="paid">پرداخت‌شده پس از بررسی واقعی</option></select></label><p className="tenant-help">انتخاب «پرداخت‌شده» فقط بعد از بررسی واقعی واریز مجاز است. مبلغ از قیمت فعلی طرح ثبت می‌شود.</p></div>}
      {stage === 3 && <div className="form-grid"><label>نام مالک<input value={draft.ownerName} onChange={e => set('ownerName', e.target.value)} maxLength={200} required /></label><label>نام کاربری مالک<input dir="ltr" autoComplete="off" value={draft.ownerUsername} onChange={e => set('ownerUsername', e.target.value)} maxLength={100} required /></label><label>رمز اولیهٔ دستی، حداقل ۱۲ نویسه<input type="password" autoComplete="new-password" value={draft.ownerPassword} onChange={e => set('ownerPassword', e.target.value)} minLength={12} required /></label><p className="tenant-help">رمز پس از ذخیره فقط به‌صورت هش نگهداری می‌شود. برای فراموشی رمز از بازنشانی استفاده کنید.</p></div>}
      {stage === 4 && <div className="tenant-review"><h3>پیش از ساخت بررسی کنید</h3><dl><dt>فروشگاه</dt><dd>{draft.name} · {draft.slug}</dd><dt>نشان</dt><dd>{draft.classicPreset ? 'هویت تأییدشدهٔ کلاسیک' : draft.logoDataUrl ? 'لوگوی اختصاصی انتخاب شد' : 'لوگو ندارد'}</dd><dt>طرح</dt><dd>{plan?.name} · {plan && rial(plan.monthlyRial)}</dd><dt>بازه</dt><dd>{draft.startsAt} تا {draft.endsAt}</dd><dt>پرداخت</dt><dd>{draft.paymentStatus === 'paid' ? 'پرداخت‌شده' : 'در انتظار تأیید'}</dd><dt>مالک</dt><dd>{draft.ownerName} · {draft.ownerUsername}</dd></dl><p className="tenant-help">فروشگاه، قالب، حساب مالک و اشتراک در یک عملیات ثبت می‌شوند. ارسال دوبارهٔ همان درخواست، فروشگاه تکراری ایجاد نمی‌کند.</p></div>}
      <div className="form-actions tenant-actions">{stage > 0 && <button type="button" disabled={busy} onClick={() => { setError(''); setStage(value => value - 1); }}>مرحلهٔ قبل</button>}{stage < 4 ? <button type="button" className="primary" onClick={next}>ادامه</button> : <button type="button" className="primary" disabled={busy} onClick={() => void create()}>{busy ? 'در حال ساخت…' : 'ساخت فروشگاه و اشتراک'}</button>}</div>
    </section><section className="card tenant-list"><div className="card-head"><h2>فروشگاه‌های ثبت‌شده</h2><button type="button" onClick={() => void load().catch(e => setError(e.message))}>تازه‌سازی</button></div><div className="list">{items.map(item => <div className="list-row" key={item.id}><div className="product-avatar">▦</div><div><strong>{item.name}</strong><small>{item.slug} · {item.activeSubscription ? `اعتبار جاری تا ${dateFa(item.activeSubscription.endsAt)}` : 'اشتراک جاری ندارد'}{item.subscription?.paymentStatus === 'pending' ? ' · یک اشتراک در انتظار تأیید' : ''}</small></div><span className={'badge ' + (item.accessActive ? 'green' : 'amber')}>{accessLabel(item)}</span><div className="user-actions"><button type="button" onClick={() => setSelected(item)}>جزئیات</button>{item.subscription?.paymentStatus === 'pending' && <button type="button" className="primary" disabled={busy} onClick={() => void approve(item)}>تأیید پرداخت</button>}<button type="button" onClick={() => setSub({ tenantId: item.id, planId: plans.find(x => x.enabled)?.id ?? '', startsAt: isoToJalaliDate(new Date().toISOString()), endsAt: '', paymentStatus: 'pending' })}>اشتراک</button><button type="button" disabled={busy} onClick={() => void toggle(item)}>{item.enabled ? 'تعلیق' : 'فعال‌سازی'}</button></div></div>)}{!items.length && <p className="empty">فروشگاهی ثبت نشده است.</p>}</div></section></div>
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="جزئیات فروشگاه" onClick={e => e.stopPropagation()}><h2>{selected.name}</h2><p>شناسه: <b dir="ltr">{selected.slug}</b></p><p>وضعیت دسترسی: {accessLabel(selected)}</p><p>اشتراک جاری: {selected.activeSubscription ? `تا ${dateFa(selected.activeSubscription.endsAt)}` : 'ندارد'}</p>{selected.subscription?.paymentStatus === 'pending' && <p>اشتراک در انتظار بررسی: تا {dateFa(selected.subscription.endsAt)}</p>}<p className="tenant-help">لوگو و قالب مادر از بخش «هویت فروشگاه‌ها» و سطح دسترسی از بخش «قابلیت‌های فروشگاه‌ها» کنترل می‌شوند.</p><button type="button" onClick={() => setSelected(null)}>بستن</button></div></div>}
    {sub && <div className="modal-backdrop" onClick={() => !busy && setSub(null)}><form className="modal" role="dialog" aria-modal="true" aria-label="ثبت اشتراک" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void saveSubscription(); }}><h2>ثبت اشتراک</h2><label>طرح<select value={sub.planId} onChange={e => setSub({ ...sub, planId: e.target.value })}>{plans.filter(x => x.enabled).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><JalaliDateField label="شروع اشتراک (شمسی)" value={sub.startsAt} onChange={value => setSub({ ...sub, startsAt: value })}/><JalaliDateField label="پایان اشتراک (شمسی)" value={sub.endsAt} onChange={value => setSub({ ...sub, endsAt: value })}/><label>وضعیت پرداخت<select value={sub.paymentStatus} onChange={e => setSub({ ...sub, paymentStatus: e.target.value as 'paid' | 'pending' })}><option value="pending">در انتظار</option><option value="paid">پرداخت‌شده</option></select></label><div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'در حال ثبت…' : 'ثبت اشتراک'}</button><button type="button" disabled={busy} onClick={() => setSub(null)}>انصراف</button></div></form></div>}
  </div>;
}
