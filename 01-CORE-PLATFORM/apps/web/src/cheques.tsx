import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { JalaliDateField, isoToJalaliDate, jalaliToIsoDate } from '../../mobile/src/jalali-date';
import { api, dateFa, rial } from './api';
import { rialDigits } from './invoice-quote';
import { InvoicePreview } from './invoice-preview';
import './cheques.css';

export type ChequeRecord = {
  id: string; invoiceId?: string; invoiceNumber?: number; direction: 'received' | 'issued'; party: string;
  serial: string; bank: string; amountRial: number; dueAt: string; sayadId: string;
  issuerNationalId: string; beneficiaryNationalId: string; registrationStatus: Registration;
  status: 'open' | 'cleared' | 'returned' | 'cancelled'; note: string;
  showDetails: boolean; showImage: boolean; hasPhoto: boolean; createdAt: string;
};
type Registration = 'unknown' | 'unregistered' | 'registered' | 'confirmed';
export type ChequeDraft = {
  direction: 'received' | 'issued'; party: string; serial: string; bank: string; amount: string; due: string;
  sayadId: string; issuerNationalId: string; beneficiaryNationalId: string; registrationStatus: Registration;
  note: string; showDetails: boolean; showImage: boolean; photoDataUrl: string | null;
};
export const blankCheque = (party = ''): ChequeDraft => ({ direction: 'received', party, serial: '', bank: '', amount: '', due: '',
  sayadId: '', issuerNationalId: '', beneficiaryNationalId: '', registrationStatus: 'unknown', note: '',
  showDetails: false, showImage: false, photoDataUrl: null });
const registrationLabels: Record<Registration, string> = { unknown: 'بررسی‌نشده', unregistered: 'ثبت‌نشده', registered: 'ثبت‌شده به اعلام صادرکننده', confirmed: 'تأییدشده به اعلام گیرنده' };
const statusLabels: Record<ChequeRecord['status'], string> = { open: 'در انتظار وصول', cleared: 'وصول‌شده', returned: 'برگشتی', cancelled: 'باطل‌شده' };
const toDigits = (value: string) => rialDigits(value).slice(0, 16);

export function chequePayload(draft: ChequeDraft, invoiceTotal?: number, existingPhoto = false) {
  const amountRial = Number(draft.amount);
  const iso = jalaliToIsoDate(draft.due);
  if (!draft.party.trim() || !draft.serial.trim() || !draft.bank.trim() || !iso || !Number.isSafeInteger(amountRial) || amountRial < 1 || invoiceTotal !== undefined && amountRial > invoiceTotal)
    throw new Error('نام طرف حساب، شماره، بانک، مبلغ و سررسید چک را درست وارد کنید.');
  if (draft.sayadId && draft.sayadId.length !== 16) throw new Error('شناسهٔ صیادی در صورت ورود باید ۱۶ رقم باشد.');
  if (draft.issuerNationalId && draft.issuerNationalId.length !== 10 || draft.beneficiaryNationalId && draft.beneficiaryNationalId.length !== 10)
    throw new Error('کد ملی در صورت ورود باید ۱۰ رقم باشد.');
  if (draft.showImage && !draft.photoDataUrl && !existingPhoto) throw new Error('برای نمایش تصویر در ضمیمه، ابتدا عکس چک را انتخاب کنید.');
  return { direction: draft.direction, party: draft.party.trim(), serial: draft.serial.trim(), bank: draft.bank.trim(), amountRial,
    dueAt: new Date(`${iso}T12:00:00`).toISOString(), sayadId: draft.sayadId, issuerNationalId: draft.issuerNationalId,
    beneficiaryNationalId: draft.beneficiaryNationalId, registrationStatus: draft.registrationStatus,
    note: draft.note.trim(), showDetails: draft.showDetails, showImage: draft.showImage, photoDataUrl: draft.photoDataUrl };
}

export function ChequeFields({ draft, setDraft, standalone = false, existingPhoto = false }: {
  draft: ChequeDraft; setDraft: Dispatch<SetStateAction<ChequeDraft>>; standalone?: boolean; existingPhoto?: boolean;
}) {
  const set = <K extends keyof ChequeDraft>(key: K, value: ChequeDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const selectPhoto = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20_000_000) { window.alert('عکس JPG، PNG یا WebP با حجم کمتر از ۲۰ مگابایت انتخاب کنید.'); return; }
    try {
      const photo = await createImageBitmap(file);
      let width = Math.min(photo.width, 1600); let height = Math.round(photo.height * width / photo.width);
      if (height > 1600) { width = Math.round(width * 1600 / height); height = 1600; }
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('پردازش تصویر در این مرورگر ممکن نیست.');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(photo, 0, 0, width, height);
      let encoded = ''; let quality = .84;
      for (let attempt = 0; attempt < 5; attempt++) {
        encoded = canvas.toDataURL('image/jpeg', quality);
        if (encoded.length * .75 < 950_000) break;
        quality -= .12;
        canvas.width = Math.round(canvas.width * .8); canvas.height = Math.round(canvas.height * .8);
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(photo, 0, 0, canvas.width, canvas.height);
      }
      photo.close();
      if (encoded.length * .75 >= 1_000_000) throw new Error('اندازهٔ تصویر پس از فشرده‌سازی هنوز زیاد است.');
      set('photoDataUrl', encoded);
    } catch (error) { window.alert(error instanceof Error ? error.message : 'خواندن عکس انجام نشد.'); }
  };
  return <div className="cheque-fields">
    {standalone && <label>نوع چک<select value={draft.direction} onChange={e => set('direction', e.target.value as ChequeDraft['direction'])}><option value="received">دریافتی</option><option value="issued">پرداختی</option></select></label>}
    <div className="form-grid"><label>طرف حساب<input value={draft.party} maxLength={200} onChange={e => set('party', e.target.value)}/></label><label>شماره چک<input value={draft.serial} maxLength={80} onChange={e => set('serial', e.target.value)}/></label><label>بانک<input value={draft.bank} maxLength={120} onChange={e => set('bank', e.target.value)}/></label><label>مبلغ چک (ریال)<input inputMode="numeric" dir="ltr" value={draft.amount ? Number(draft.amount).toLocaleString('en-US') : ''} onChange={e => set('amount', toDigits(e.target.value))}/></label></div>
    <JalaliDateField label="سررسید چک (شمسی)" value={draft.due} onChange={value => set('due', value)}/>
    <div className="form-grid"><label>شناسه صیادی ۱۶ رقمی<input inputMode="numeric" dir="ltr" value={draft.sayadId} onChange={e => set('sayadId', toDigits(e.target.value))} maxLength={16}/></label><label>کد ملی صادرکننده<input inputMode="numeric" dir="ltr" value={draft.issuerNationalId} onChange={e => set('issuerNationalId', toDigits(e.target.value).slice(0, 10))} maxLength={10}/></label><label>کد ملی ذی‌نفع<input inputMode="numeric" dir="ltr" value={draft.beneficiaryNationalId} onChange={e => set('beneficiaryNationalId', toDigits(e.target.value).slice(0, 10))} maxLength={10}/></label><label>وضعیت ثبت، طبق اعلام کاربر<select value={draft.registrationStatus} onChange={e => set('registrationStatus', e.target.value as Registration)}>{Object.entries(registrationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
    <label>یادداشت<input value={draft.note} maxLength={500} onChange={e => set('note', e.target.value)}/></label>
    <div className="cheque-photo-inputs"><label>انتخاب تصویر چک<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => selectPhoto(e.target.files?.[0])}/></label><label>عکاسی با دوربین<input type="file" accept="image/*" capture="environment" onChange={e => selectPhoto(e.target.files?.[0])}/></label></div>
    {draft.photoDataUrl ? <img className="cheque-photo-preview" src={draft.photoDataUrl} alt="پیش‌نمایش تصویر چک"/> : existingPhoto ? <p className="hint">تصویر قبلی در پرونده محفوظ است.</p> : null}
    {!standalone && <div className="cheque-options"><label className="check-label"><input type="checkbox" checked={draft.showDetails} onChange={e => set('showDetails', e.target.checked)}/>نمایش مشخصات چک در ضمیمهٔ فاکتور</label><label className="check-label"><input type="checkbox" checked={draft.showImage} onChange={e => set('showImage', e.target.checked)}/>نمایش عکس چک در ضمیمهٔ فاکتور</label></div>}
    <p className="hint">ثبت این اطلاعات در برنامه به معنی تأیید بانکی شناسهٔ صیادی یا وصول وجه نیست. تصویر چک فقط برای کاربران مجاز همین فروشگاه در دسترس است.</p>
  </div>;
}

export function Cheques() {
  const [items, setItems] = useState<ChequeRecord[]>([]); const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState<ChequeDraft>(blankCheque); const [editing, setEditing] = useState<ChequeRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const formRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [overview, setOverview] = useState<{ groups: { direction: string; status: string; count: number; amountRial: number }[]; overdueCount: number } | null>(null);
  const load = async () => { const [records, totals] = await Promise.all([api<ChequeRecord[]>(`/merchant/accounting/cheques?q=${encodeURIComponent(query)}&status=${filter}`), api<NonNullable<typeof overview>>('/merchant/accounting/cheques/overview')]); setItems(records); setOverview(totals); };
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'چک‌ها دریافت نشدند.')); }, [query, filter]);
  useEffect(() => { if (showForm) formRef.current?.scrollIntoView({ block: 'start' }); }, [showForm, editing?.id]);
  const edit = (item: ChequeRecord) => { setEditing(item); setShowForm(true); setDraft({ direction: item.direction, party: item.party, serial: item.serial, bank: item.bank, amount: String(item.amountRial),
    due: isoToJalaliDate(item.dueAt), sayadId: item.sayadId, issuerNationalId: item.issuerNationalId,
    beneficiaryNationalId: item.beneficiaryNationalId, registrationStatus: item.registrationStatus,
    note: item.note, showDetails: item.showDetails, showImage: item.showImage, photoDataUrl: null }); setError(''); };
  const save = async () => { if (busy) return; setBusy(true); setError(''); setNotice(''); try {
    const payload = chequePayload(draft, undefined, !!editing?.hasPhoto);
    if (editing) await api(`/merchant/accounting/cheques/${editing.id}`, 'PUT', payload);
    else await api('/merchant/accounting/cheques', 'POST', payload);
    setEditing(null); setShowForm(false); setDraft(blankCheque()); await load(); setNotice('پروندهٔ چک ذخیره شد.');
  } catch (e) { setError(e instanceof Error ? e.message : 'ثبت چک انجام نشد.'); } finally { setBusy(false); } };
  const mark = async (item: ChequeRecord, status: ChequeRecord['status']) => {
    if (busy || !window.confirm(status === 'cleared' ? `وصول واقعی چک ${item.serial} تأیید و وجه آن در فاکتور ثبت شود؟` : `وضعیت چک ${item.serial} به «${statusLabels[status]}» تغییر کند؟`)) return;
    setBusy(true); setError(''); setNotice(''); try { await api(`/merchant/accounting/cheques/${item.id}/status`, 'POST', { status }); await load(); setNotice('وضعیت چک ثبت شد.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'تغییر وضعیت انجام نشد.'); } finally { setBusy(false); }
  };
  const totals = (overview?.groups ?? []).reduce((value, item) => { value[item.status as ChequeRecord['status']] += item.amountRial; return value; }, { open: 0, cleared: 0, returned: 0, cancelled: 0 });
  return <><div className="page-intro"><h2>پروندهٔ چک‌ها</h2><p>چک‌های دریافتی و پرداختی را پیگیری کنید. وصول چک مرتبط با فاکتور تنها پس از تأیید شما به‌عنوان دریافت ثبت می‌شود.</p></div>
    {error && <div className="field-error" role="alert">{error}</div>}{notice && <p role="status" className="cheque-notice">{notice}</p>}
    <div className="cheque-summary">{(['open', 'cleared', 'returned'] as const).map(status => <button key={status} className={`cheque-${status}`} onClick={() => setFilter(status)}><small>{statusLabels[status]}{status === 'open' && overview?.overdueCount ? ` · ${overview.overdueCount} سررسیده` : ''}</small><strong>{rial(totals[status])}</strong></button>)}</div>
    <section className="card"><div className="card-head"><h2>فهرست چک‌ها</h2><div className="cheque-search"><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="نام، شماره چک، بانک، شناسه"/><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">همهٔ وضعیت‌ها</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="primary" onClick={() => { setEditing(null); setDraft(blankCheque()); setShowForm(true); }}>＋ چک تازه</button></div></div>
      {items.length ? <div className="cheque-list">{items.map(item => <article key={item.id} className={`cheque-row cheque-${item.status}`}><div><strong>{item.party} · {item.serial}</strong><small>{item.direction === 'received' ? 'دریافتی' : 'پرداختی'} · {item.bank} · سررسید {dateFa(item.dueAt)}</small><small>صیاد: {item.sayadId || 'وارد نشده'} · {registrationLabels[item.registrationStatus]}</small></div><div className="cheque-row-total"><b>{rial(item.amountRial)}</b><span>{statusLabels[item.status]}</span></div><div className="cheque-row-actions">{item.invoiceId && <button onClick={() => setPreview(item.invoiceId!)}>فاکتور {item.invoiceNumber}</button>}{item.hasPhoto && <a href={`/api/merchant/accounting/cheques/${item.id}/photo`} target="_blank" rel="noreferrer">تصویر چک</a>}{item.status === 'open' && <><button onClick={() => edit(item)}>ویرایش</button><button disabled={busy} onClick={() => void mark(item, 'cleared')}>وصول شد</button><button disabled={busy} onClick={() => void mark(item, 'returned')}>برگشتی</button><button disabled={busy} onClick={() => void mark(item, 'cancelled')}>باطل</button></>}</div></article>)}</div> : <div className="empty">پرونده‌ای با این فیلتر پیدا نشد.</div>}
    </section>{preview && <InvoicePreview id={preview} close={() => setPreview(null)}/>}
    {showForm && <section ref={formRef} className="card"><div className="card-head"><h2>{editing ? `ویرایش چک ${editing.serial}` : 'ثبت چک مستقل'}</h2><button onClick={() => { setEditing(null); setDraft(blankCheque()); setShowForm(false); }}>بستن فرم</button></div><ChequeFields draft={draft} setDraft={setDraft} standalone={!editing?.invoiceId} existingPhoto={!!editing?.hasPhoto}/><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? 'در حال ذخیره…' : editing ? 'ذخیره تغییرات چک' : 'ثبت چک'}</button></section>}
  </>;
}
