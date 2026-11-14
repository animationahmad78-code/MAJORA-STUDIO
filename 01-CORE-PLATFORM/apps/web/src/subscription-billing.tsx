import { useEffect, useRef, useState } from 'react';
import { api, dateFa, rial, type Plan } from './api';
import { JalaliDateField } from '../../mobile/src/jalali-date';
import { RialInput } from './rial-input';
import { promoDateBounds, promoJalaliDate } from './promo-dates';
import './subscription-billing.css';

type Promo = { id: string; code: string; percent: number; startsAt: string; expiresAt: string; enabled: boolean };
type Billing = { cardNumber: string; cardHolder: string };
type Order = { id: string; tenantName?: string; planNameSnapshot: string; promoCodeSnapshot: string; months: number; termDiscountPercentSnapshot: number; basePriceRial: number; totalRial: number; status: string; paymentMethod: string; hasReceipt?: boolean; createdAt: string };
type Quote = { months: number; basePriceRial: number; termDiscountPercent: number; discountPercent: number; totalRial: number; promoCode: string };
const statusLabel: Record<string, string> = { pending_approval: 'در انتظار تأیید ماژورا', paid: 'تأیید و فعال شد', rejected: 'رد شد', awaiting_receipt: 'در انتظار رسید' };
const periodLabel: Record<string, string> = { active: 'فعال', trial: 'دموی رایگان فعال', expired: 'منقضی', scheduled: 'شروع در آینده', pending_payment: 'در انتظار پرداخت' };
const features = (plan: Plan): string[] => { try { const parsed: unknown = JSON.parse(plan.featuresJson || '[]'); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
const discounts = (plan: Plan): Record<string, number> => { try { return JSON.parse(plan.prepayDiscountsJson || '{}') as Record<string, number>; } catch { return {}; } };
const fileData = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('خواندن تصویر رسید انجام نشد.')); reader.readAsDataURL(file); });

export function MerchantSubscription() {
  const [plans, setPlans] = useState<Plan[]>([]); const [orders, setOrders] = useState<Order[]>([]);
  const [history, setHistory] = useState<{ id: string; plan: string; startsAt: string; endsAt: string; paymentStatus: string; effectiveStatus: string; priceRialSnapshot: number }[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null); const [selected, setSelected] = useState<Plan | null>(null); const [months, setMonths] = useState(1);
  const [promo, setPromo] = useState(''); const [quote, setQuote] = useState<Quote | null>(null); const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const key = useRef(crypto.randomUUID());
  const quoteRequest = useRef(0);
  const load = async () => { const [p, o, h, b] = await Promise.all([api<Plan[]>('/merchant/plans'), api<Order[]>('/merchant/subscription/orders'), api<typeof history>('/merchant/subscription'), api<Billing>('/merchant/billing')]); setPlans(p); setOrders(o); setHistory(h); setBilling(b); };
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const current = history.find(item => item.effectiveStatus === 'active' || item.effectiveStatus === 'trial');
  let accessEnd = current ? Date.parse(current.endsAt) : 0;
  if (current) {
    for (const period of [...history].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
      if ((period.paymentStatus === 'paid' || period.paymentStatus === 'trial') &&
          Date.parse(period.startsAt) <= accessEnd && Date.parse(period.endsAt) > accessEnd)
        accessEnd = Date.parse(period.endsAt);
    }
  }
  const daysLeft = current ? Math.max(0, Math.ceil((accessEnd - now) / 86_400_000)) : 0;
  const price = async () => {
    if (!selected) return;
    const request = ++quoteRequest.current;
    const planId = selected.id;
    const code = promo.trim();
    const selectedMonths = months;
    setError(''); setQuote(null);
    try { const result = await api<Quote>(`/merchant/subscription/quote?planId=${planId}&months=${selectedMonths}&code=${encodeURIComponent(code)}`); if (request === quoteRequest.current) setQuote(result); }
    catch (e) { if (request === quoteRequest.current) setError(e instanceof Error ? e.message : 'کد تخفیف بررسی نشد.'); }
  };
  const submit = async () => {
    if (!selected || !receipt || busy) return;
    if (!quote || quote.promoCode !== promo.trim().toUpperCase() || quote.months !== months) { setError('مبلغ نهایی را برای مدت و کد تخفیف فعلی دوباره بررسی کنید.'); return; }
    if (receipt.size > 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(receipt.type)) { setError('تصویر رسید باید JPEG، PNG یا WebP و کمتر از یک مگابایت باشد.'); return; }
    if (!window.confirm(`رسید پرداخت طرح ${selected.name} برای بررسی ماژورا ثبت شود؟`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const receiptDataUrl = await fileData(receipt);
      await api('/merchant/subscription/orders', 'POST', { planId: selected.id, months, idempotencyKey: key.current, promoCode: promo.trim(), receiptDataUrl, expectedTotalRial: quote?.totalRial });
      key.current = crypto.randomUUID(); setSelected(null); setMonths(1); setReceipt(null); setQuote(null); setPromo(''); await load();
      setNotice('رسید ثبت شد. تا تأیید ماژورا اشتراک جدید فعال نمی‌شود.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ثبت درخواست انجام نشد.'); }
    finally { setBusy(false); }
  };
  return <div className="billing-page"><div className="page-intro"><h2>اشتراک من</h2><p>طرح مناسب را ببینید و درخواست پرداخت کارت‌به‌کارت را برای تأیید ارسال کنید.</p></div>
    {error && <div className="field-error" role="alert">{error}</div>}{notice && <div className="field-success" role="status">{notice}</div>}
    <section className="card subscription-countdown" aria-live="polite"><div><small>وضعیت دسترسی</small><h3>{current ? current.effectiveStatus === 'trial' ? 'دموی رایگان شما فعال است' : 'اشتراک شما فعال است' : 'اشتراک فعال ندارید'}</h3><p>{current ? `دسترسی تا ${dateFa(new Date(accessEnd).toISOString())} · ${daysLeft.toLocaleString('fa-IR')} روز باقی‌مانده` : 'برای ادامهٔ کار طرحی را انتخاب و رسید پرداخت را ثبت کنید.'}</p></div><strong>{current ? daysLeft.toLocaleString('fa-IR') : '۰'} <small>روز</small></strong>{current && daysLeft <= 3 && <p className="field-error" role="alert">اعتبار این فروشگاه رو به پایان است؛ درخواست تمدید را پیش از پایان ثبت کنید.</p>}</section>
    <div className="plan-grid">{plans.map(plan => <section className="card plan-card" key={plan.id}><h3>{plan.name}</h3><strong>{rial(plan.monthlyRial)} <small>/ ماه</small></strong><p>{plan.description}</p><ul>{features(plan).map((feature, i) => <li key={i}>{feature}</li>)}<li>تا {plan.maxUsers} کاربر</li><li>تا {plan.maxDevices} مرورگر فعال هم‌زمان</li></ul><button className="primary" onClick={() => { quoteRequest.current++; setSelected(plan); setMonths(1); setQuote(null); setReceipt(null); setPromo(''); }}>انتخاب این طرح</button></section>)}</div>
    {selected && <section className="card checkout-card"><div className="card-head"><h2>پرداخت طرح {selected.name}</h2><button onClick={() => setSelected(null)}>بستن</button></div>
      <p>قیمت ماهانه: {rial(selected.monthlyRial)} · دوره پس از تأیید به انتهای اعتبار فعلی افزوده می‌شود.</p><label>مدت تمدید<select value={months} onChange={e => { quoteRequest.current++; setMonths(Number(e.target.value)); setQuote(null); }}>{Array.from({ length: selected.maxPrepayMonths }, (_, i) => i + 1).map(count => <option key={count} value={count}>{count.toLocaleString('fa-IR')} ماه{discounts(selected)[String(count)] ? ` · ${discounts(selected)[String(count)]}٪ تخفیف دوره` : ''}</option>)}</select></label>
      <label>کد تخفیف<input dir="ltr" value={promo} onChange={e => { quoteRequest.current++; setPromo(e.target.value); setQuote(null); }} placeholder="کد اختیاری" /></label><button type="button" onClick={() => void price()}>بررسی مبلغ نهایی</button>
      {quote && <p className="checkout-total">مبلغ پایه {rial(quote.basePriceRial)} · تخفیف دوره {quote.termDiscountPercent}٪ · کد تخفیف {quote.discountPercent}٪ · مبلغ قابل پرداخت: <strong>{rial(quote.totalRial)}</strong></p>}
      {billing?.cardNumber ? <div className="bank-card"><strong>کارت‌به‌کارت به نام {billing.cardHolder}</strong><b dir="ltr">{billing.cardNumber}</b><small>تنها پس از واریز واقعی، تصویر رسید را ثبت کنید.</small></div> : <p className="field-error">اطلاعات کارت ماژورا هنوز تنظیم نشده است؛ ثبت درخواست پرداخت فعلاً ممکن نیست.</p>}
      <label>تصویر رسید واریز<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setReceipt(e.target.files?.[0] ?? null)} /></label>
      <button className="primary" disabled={busy || !billing?.cardNumber || !receipt || !quote} onClick={() => void submit()}>{busy ? 'در حال ثبت…' : 'ثبت رسید و درخواست تأیید'}</button>
      <small>درگاه پرداخت پس از انتخاب و اتصال ارائه‌دهندهٔ معتبر فعال می‌شود؛ این فرم فقط کارت‌به‌کارت و تأیید دستی را ثبت می‌کند.</small>
    </section>}
    <section className="card"><div className="card-head"><h2>درخواست‌های پرداخت</h2><button onClick={() => void load().catch(e => setError(e.message))}>تازه‌سازی</button></div><div className="list">{orders.map(order => <div className="list-row" key={order.id}><div><strong>{order.planNameSnapshot} · {order.months} ماه</strong><small>{dateFa(order.createdAt)} · {order.promoCodeSnapshot || 'بدون کد تخفیف'}</small></div><b>{rial(order.totalRial)}</b><span className={'badge ' + (order.status === 'paid' ? 'green' : 'amber')}>{statusLabel[order.status] ?? order.status}</span></div>)}{!orders.length && <p className="empty">درخواستی ثبت نشده است.</p>}</div></section>
    <section className="card"><h2>سوابق اشتراک</h2><div className="list">{history.map(item => <div className="list-row" key={item.id}><div><strong>{item.plan}</strong><small>از {dateFa(item.startsAt)} تا {dateFa(item.endsAt)}</small></div><b>{rial(item.priceRialSnapshot)}</b><span className={'badge ' + (item.effectiveStatus === 'active' ? 'green' : 'amber')}>{periodLabel[item.effectiveStatus] ?? 'وضعیت نامشخص'}</span></div>)}{!history.length && <p className="empty">اشتراکی ثبت نشده است.</p>}</div></section>
  </div>;
}

export function AdminBilling() {
  const [plans, setPlans] = useState<Plan[]>([]); const [promos, setPromos] = useState<Promo[]>([]); const [orders, setOrders] = useState<Order[]>([]);
  const [billing, setBilling] = useState<Billing>({ cardNumber: '', cardHolder: '' });
  const [planId, setPlanId] = useState<string | null>(null); const [plan, setPlan] = useState({ name: '', description: '', features: '', monthlyRial: '', maxUsers: 3, maxDevices: 6, maxPrepayMonths: 6, prepayDiscounts: {} as Record<string, number>, enabled: true });
  const [promoId, setPromoId] = useState<string | null>(null); const [code, setCode] = useState({ code: '', percent: 10, startsAt: promoJalaliDate(new Date().toISOString()), expiresAt: '', enabled: true });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = async () => { const [p, c, o, b] = await Promise.all([api<Plan[]>('/admin/plans'), api<Promo[]>('/admin/promo-codes'), api<Order[]>('/admin/subscription-orders'), api<Billing>('/admin/billing')]); setPlans(p); setPromos(c); setOrders(o); setBilling(b); };
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  const run = async (action: () => Promise<unknown>, success: string) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await action(); await load(); setNotice(success); } catch (e) { setError(e instanceof Error ? e.message : 'عملیات انجام نشد.'); } finally { setBusy(false); } };
  return <div className="billing-page"><div className="page-intro"><h2>طرح‌ها و پرداخت اشتراک</h2><p>قیمت، امکانات، کد تخفیف، اطلاعات واریز و تأیید رسید از پنل ماژورا مدیریت می‌شوند.</p></div>
    {error && <div className="field-error" role="alert">{error}</div>}{notice && <div className="field-success" role="status">{notice}</div>}
    <div className="two-col"><section className="card"><h2>{planId ? 'ویرایش طرح' : 'طرح جدید'}</h2><form className="form-grid" onSubmit={e => { e.preventDefault(); void run(async () => { await api(`/admin/plans${planId ? `/${planId}` : ''}`, planId ? 'PUT' : 'POST', { ...plan, monthlyRial: Number(plan.monthlyRial), features: plan.features.split('\n').map(x => x.trim()).filter(Boolean) }); setPlanId(null); setPlan({ name: '', description: '', features: '', monthlyRial: '', maxUsers: 3, maxDevices: 6, maxPrepayMonths: 6, prepayDiscounts: {}, enabled: true }); }, 'طرح ذخیره شد.'); }}><label>نام طرح<input value={plan.name} onChange={e => setPlan({ ...plan, name: e.target.value })} required /></label><label>توضیح کوتاه<input value={plan.description} maxLength={500} onChange={e => setPlan({ ...plan, description: e.target.value })} /></label><label>قیمت ماهانه (ریال)<RialInput value={plan.monthlyRial} onValueChange={value => setPlan(current => ({ ...current, monthlyRial: value }))} required /></label><label>سقف کاربران<input type="number" min="1" value={plan.maxUsers} onChange={e => setPlan({ ...plan, maxUsers: Number(e.target.value) })} /></label><label>سقف نشست‌های فعال<input type="number" min="1" max="1000" value={plan.maxDevices} onChange={e => setPlan({ ...plan, maxDevices: Number(e.target.value) })} required /></label><label>حداکثر ماه‌های پیش‌پرداخت<select value={plan.maxPrepayMonths} onChange={e => { const maximum = Number(e.target.value); setPlan({ ...plan, maxPrepayMonths: maximum, prepayDiscounts: Object.fromEntries(Object.entries(plan.prepayDiscounts).filter(([month]) => Number(month) <= maximum)) }); }}>{Array.from({ length: 6 }, (_, i) => i + 1).map(month => <option key={month} value={month}>{month} ماه</option>)}</select></label>{Array.from({ length: Math.max(0, plan.maxPrepayMonths - 1) }, (_, i) => i + 2).map(month => <label key={month}>تخفیف دورهٔ {month} ماهه (درصد)<input type="number" min="0" max="100" step="0.01" value={plan.prepayDiscounts[String(month)] ?? 0} onChange={e => setPlan({ ...plan, prepayDiscounts: { ...plan.prepayDiscounts, [month]: Number(e.target.value) } })} /></label>)}<label>امکانات، هر مورد در یک خط<textarea value={plan.features} onChange={e => setPlan({ ...plan, features: e.target.value })} /></label><label><input type="checkbox" checked={plan.enabled} onChange={e => setPlan({ ...plan, enabled: e.target.checked })} /> فعال باشد</label><button className="primary" disabled={busy}>ذخیره طرح</button></form></section>
      <section className="card"><h2>طرح‌های موجود</h2><div className="list">{plans.map(item => <div className="list-row" key={item.id}><div><strong>{item.name}</strong><small>{item.description} · {item.maxUsers} کاربر · {item.maxDevices} نشست · تا {item.maxPrepayMonths} ماه · {item.enabled ? 'فعال' : 'غیرفعال'}</small></div><b>{rial(item.monthlyRial)}</b><button onClick={() => { setPlanId(item.id); setPlan({ name: item.name, description: item.description, features: features(item).join('\n'), monthlyRial: String(item.monthlyRial), maxUsers: item.maxUsers, maxDevices: item.maxDevices, maxPrepayMonths: item.maxPrepayMonths, prepayDiscounts: discounts(item), enabled: item.enabled }); }}>ویرایش</button></div>)}</div></section></div>
    <div className="two-col"><section className="card"><h2>{promoId ? 'ویرایش کد تخفیف' : 'کد تخفیف جدید'}</h2><form className="form-grid" onSubmit={e => { e.preventDefault(); void run(async () => { await api(`/admin/promo-codes${promoId ? `/${promoId}` : ''}`, promoId ? 'PUT' : 'POST', { ...code, ...promoDateBounds(code.startsAt, code.expiresAt) }); setPromoId(null); setCode({ code: '', percent: 10, startsAt: promoJalaliDate(new Date().toISOString()), expiresAt: '', enabled: true }); }, 'کد تخفیف ذخیره شد.'); }}><label>کد لاتین<input dir="ltr" value={code.code} onChange={e => setCode({ ...code, code: e.target.value.toUpperCase() })} pattern="[A-Z0-9_-]{3,40}" required /></label><label>درصد تخفیف<input type="number" min="0.01" max="100" step="0.01" value={code.percent} onChange={e => setCode({ ...code, percent: Number(e.target.value) })} required /></label><JalaliDateField label="شروع اعتبار (از آغاز روز تهران)" value={code.startsAt} onChange={value => setCode({ ...code, startsAt: value })} /><JalaliDateField label="پایان اعتبار (تا پایان همان روز)" value={code.expiresAt} onChange={value => setCode({ ...code, expiresAt: value })} /><label><input type="checkbox" checked={code.enabled} onChange={e => setCode({ ...code, enabled: e.target.checked })} /> فعال باشد</label><button className="primary" disabled={busy}>ذخیره کد</button></form></section>
      <section className="card"><h2>کدهای تخفیف</h2><div className="list">{promos.map(item => <div className="list-row" key={item.id}><div><strong dir="ltr">{item.code}</strong><small>{item.percent}٪ · تا {promoJalaliDate(item.expiresAt, true)} · {item.enabled ? 'فعال' : 'غیرفعال'}</small></div><button onClick={() => { setPromoId(item.id); setCode({ code: item.code, percent: item.percent, startsAt: promoJalaliDate(item.startsAt), expiresAt: promoJalaliDate(item.expiresAt, true), enabled: item.enabled }); }}>ویرایش</button></div>)}</div></section></div>
    <section className="card"><h2>حساب واریز اشتراک</h2><form className="form-grid billing-form" onSubmit={e => { e.preventDefault(); void run(() => api('/admin/billing', 'PUT', billing), 'اطلاعات کارت ذخیره شد.'); }}><label>شماره کارت<input dir="ltr" value={billing.cardNumber} onChange={e => setBilling({ ...billing, cardNumber: e.target.value })} required /></label><label>نام دارنده<input value={billing.cardHolder} onChange={e => setBilling({ ...billing, cardHolder: e.target.value })} required /></label><button className="primary" disabled={busy}>ذخیره اطلاعات واریز</button></form></section>
    <section className="card"><div className="card-head"><h2>درخواست‌های پرداخت</h2><button onClick={() => void load().catch(e => setError(e.message))}>تازه‌سازی</button></div><div className="list">{orders.map(order => <div className="list-row" key={order.id}><div><strong>{order.tenantName} · {order.planNameSnapshot} · {order.months} ماه</strong><small>{dateFa(order.createdAt)} · کد: {order.promoCodeSnapshot || 'ندارد'} · {statusLabel[order.status] ?? order.status}</small></div><b>{rial(order.totalRial)}</b>{order.hasReceipt && <a href={`/api/admin/subscription-orders/${order.id}/receipt`} target="_blank" rel="noreferrer">دیدن رسید</a>}{order.status === 'pending_approval' && <div className="user-actions"><button className="primary" disabled={busy} onClick={() => { if (window.confirm('پس از بررسی واریز واقعی، پرداخت تأیید شود؟')) void run(() => api(`/admin/subscription-orders/${order.id}/decision`, 'POST', { decision: 'approve' }), 'پرداخت تأیید شد. اگر فروشگاه جداگانه تعلیق شده باشد، دسترسی آن را از بخش فروشگاه‌ها فعال کنید.'); }}>تأیید پرداخت</button><button disabled={busy} onClick={() => { if (window.confirm('رسید و درخواست رد شود؟')) void run(() => api(`/admin/subscription-orders/${order.id}/decision`, 'POST', { decision: 'reject' }), 'درخواست رد شد.'); }}>رد</button></div>}</div>)}{!orders.length && <p className="empty">درخواستی ثبت نشده است.</p>}</div></section>
  </div>;
}
