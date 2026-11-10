import { useEffect, useState } from 'react';
import { api, rial } from './api';
import { PaymentBadge } from './payment-badge';

type CustomerRecord = { id: string; name: string; phone: string; address: string; occupation: string; acquisitionSource: string; referrerPhone: string; notes: string; status: string; receivableRial: number };
type Form = Pick<CustomerRecord, 'name' | 'phone' | 'address' | 'occupation' | 'acquisitionSource' | 'referrerPhone' | 'notes'>;
const blank = (): Form => ({ name: '', phone: '', address: '', occupation: '', acquisitionSource: '', referrerPhone: '', notes: '' });
export function Customers() {
  const [items, setItems] = useState<CustomerRecord[]>([]); const [query, setQuery] = useState('');
  const [form, setForm] = useState<Form>(blank()); const [editing, setEditing] = useState<string | null>(null);
  const [more, setMore] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = () => api<CustomerRecord[]>(`/merchant/customers/with-status?q=${encodeURIComponent(query)}`).then(setItems);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [query]);
  const save = async () => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await api(`/merchant/customers${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', form);
      setForm(blank()); setEditing(null); setMore(false); await load(); setNotice(editing ? 'اطلاعات مشتری به‌روزرسانی شد.' : 'مشتری ثبت شد.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'ثبت مشتری انجام نشد.'); } finally { setBusy(false); }
  };
  const archive = async (id: string) => { if (!window.confirm('مشتری بایگانی شود؟ فاکتورهای قبلی حفظ می‌شوند.')) return;
    setBusy(true); setError(''); try { await api(`/merchant/archive/customers/${id}`, 'POST'); await load(); setNotice('مشتری بایگانی شد.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'بایگانی انجام نشد.'); } finally { setBusy(false); } };
  return <div className="customers-page"><div className="page-intro"><h2>مشتریان</h2><p>ثبت سریع نام و تلفن؛ جزئیات بیشتر را وقتی فرصت دارید تکمیل کنید.</p></div>
    {error && <div className="field-error" role="alert">{error}</div>}{notice && <div className="field-success" role="status">{notice}</div>}
    <div className="two-col wide-right"><section className="card"><div className="card-head"><h2>{editing ? 'ویرایش مشتری' : 'مشتری جدید'}</h2></div><form className="form-grid" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>نام و نام خانوادگی<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={200} /></label><label>شماره تماس<input dir="ltr" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} maxLength={30} /></label>
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'بستن جزئیات اختیاری' : 'افزودن جزئیات اختیاری'}</button>
      {more && <div className="customer-extra"><label>نشانی<input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} maxLength={500} /></label><label>شغل<input value={form.occupation} onChange={e => setForm({ ...form, occupation: e.target.value })} maxLength={120} /></label><label>نحوهٔ آشنایی<input value={form.acquisitionSource} onChange={e => setForm({ ...form, acquisitionSource: e.target.value })} maxLength={120} /></label><label>شماره معرف<input dir="ltr" value={form.referrerPhone} onChange={e => setForm({ ...form, referrerPhone: e.target.value })} maxLength={30} /></label><label>یادداشت<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} maxLength={1000} /></label></div>}
      <button className="primary" disabled={busy}>{busy ? 'در حال ذخیره…' : editing ? 'ذخیره تغییرات' : 'ثبت مشتری'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(blank()); setMore(false); }}>انصراف</button>}
    </form></section><section className="card"><div className="card-head"><h2>فهرست مشتریان</h2><div className="form-actions"><a className="button-link" href="/api/merchant/customers/export.xlsx" download>خروجی Excel</a><a className="button-link" href="/api/merchant/customers/export.csv" download>CSV</a></div></div><label>جست‌وجوی نام یا تلفن<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="list">{items.map(item => <div className="list-row" key={item.id}><div><strong>{item.name}</strong><small dir="ltr">{item.phone}</small>{item.receivableRial > 0 && <small>مانده: {rial(item.receivableRial)}</small>}</div><PaymentBadge status={item.status}/>{item.phone && <a href={`tel:${item.phone}`}>تماس</a>}<button onClick={() => { setEditing(item.id); setForm({ name: item.name, phone: item.phone, address: item.address, occupation: item.occupation, acquisitionSource: item.acquisitionSource, referrerPhone: item.referrerPhone, notes: item.notes }); setMore(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>ویرایش</button><button disabled={busy} onClick={() => void archive(item.id)}>بایگانی</button></div>)}{!items.length && <p className="empty">مشتری‌ای پیدا نشد.</p>}</div>
    </section></div>
  </div>;
}
