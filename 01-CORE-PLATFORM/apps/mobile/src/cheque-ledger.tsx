import { useEffect, useMemo, useState } from 'react';
import { Camera } from '@capacitor/camera';
import { formatRial, parseRial } from '@majora/domain';
import type { ChequeEntry, FinanceOverview, InvoiceReceipt, ShopRepository } from '@majora/database';
import { JalaliDateField } from './jalali-date';
import { prepareChequePhoto, readChequePhoto, removeChequePhoto, storeChequePhoto } from './cheque-photo';
import './cheque-ledger.css';

const latin = (value: string) => value.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632));
type Draft = { direction: ChequeEntry['direction']; party: string; serial: string; bank: string; amount: string; due: string; sayad: string; issuerId: string; beneficiaryId: string; registration: NonNullable<ChequeEntry['registrationStatus']>; note: string; showDetails: boolean; showImage: boolean; photoPath: string };
const blank = (): Draft => ({ direction: 'received', party: '', serial: '', bank: '', amount: '', due: '', sayad: '', issuerId: '', beneficiaryId: '', registration: 'unknown', note: '', showDetails: false, showImage: false, photoPath: '' });
const statusText: Record<ChequeEntry['status'], string> = { open: 'در انتظار وصول', cleared: 'وصول‌شده', returned: 'برگشتی', cancelled: 'باطل‌شده' };
const registrationText: Record<NonNullable<ChequeEntry['registrationStatus']>, string> = { unknown: 'بررسی‌نشده', unregistered: 'ثبت‌نشده', registered: 'ثبت‌شده توسط صادرکننده', confirmed: 'تأییدشده توسط گیرنده' };
type Props = { repository: ShopRepository | null; overview: FinanceOverview; onRefresh: () => Promise<void>; onOpenInvoice: (receipt: InvoiceReceipt) => void };

export function ChequeLedger({ repository, overview, onRefresh, onOpenInvoice }: Props) {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState<ChequeEntry['status'] | 'all'>('all');
  const [editingId, setEditingId] = useState(''); const [draft, setDraft] = useState<Draft>(blank);
  const [photoData, setPhotoData] = useState(''); const [feedback, setFeedback] = useState(''); const [busy, setBusy] = useState(false);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const selected = overview.cheques.find(item => item.id === editingId);
  const visible = useMemo(() => overview.cheques.filter(item => (filter === 'all' || item.status === filter) &&
    latin(`${item.party} ${item.serial} ${item.bank} ${item.sayadId ?? ''} ${item.invoiceId ? overview.invoices.find(invoice => invoice.id === item.invoiceId)?.number ?? '' : ''}`).toLocaleLowerCase('fa-IR').includes(latin(query).toLocaleLowerCase('fa-IR'))), [overview, filter, query]);
  const totals = useMemo(() => overview.cheques.reduce((acc, item) => ({ ...acc, [item.status]: acc[item.status] + item.amountRial }), { open: 0, cleared: 0, returned: 0, cancelled: 0 }), [overview.cheques]);
  useEffect(() => { let live = true; setPhotoData(''); if (selected?.photoPath) void readChequePhoto(selected.photoPath).then(value => { if (live) setPhotoData(value ?? ''); }).catch(() => undefined); return () => { live = false; }; }, [selected?.photoPath]);
  function edit(item: ChequeEntry) {
    setEditingId(item.id);
    setDraft({ direction: item.direction, party: item.party, serial: item.serial, bank: item.bank, amount: formatRial(item.amountRial), due: item.dueJalali,
      sayad: item.sayadId ?? '', issuerId: item.issuerNationalId ?? '', beneficiaryId: item.beneficiaryNationalId ?? '',
      registration: item.registrationStatus ?? 'unknown', note: item.note, showDetails: !!item.showDetails, showImage: !!item.showImage, photoPath: item.photoPath ?? '' });
    setFeedback('');
  }
  async function camera() {
    try {
      const shot = await Camera.takePhoto({ quality: 90, saveToGallery: false, correctOrientation: true });
      if (!shot.webPath) throw new Error('عکس چک دریافت نشد.');
      const response = await fetch(shot.webPath); const blob = await response.blob();
      setPhotoData(await prepareChequePhoto(new File([blob], 'cheque.jpg', { type: blob.type || 'image/jpeg' })));
    } catch (error) { if (!/cancel|لغو/i.test((error as Error).message)) setFeedback((error as Error).message); }
  }
  async function save() {
    if (!repository || busy) return;
    setBusy(true); setFeedback(''); let newPath = ''; let committed = false;
    try {
      const amountRial = parseRial(draft.amount);
      if (photoData && photoData.startsWith('data:') && photoData !== await readChequePhoto(draft.photoPath).catch(() => undefined)) newPath = await storeChequePhoto(photoData);
      const photoPath = newPath || draft.photoPath;
      if (draft.showImage && !photoPath) throw new Error('ابتدا تصویر چک را ثبت کنید.');
      const common = { direction: draft.direction, party: draft.party, serial: draft.serial, bank: draft.bank, amountRial, dueJalali: draft.due,
        sayadId: latin(draft.sayad).replace(/\D/g, ''), issuerNationalId: latin(draft.issuerId).replace(/\D/g, ''), beneficiaryNationalId: latin(draft.beneficiaryId).replace(/\D/g, ''),
        registrationStatus: draft.registration, note: draft.note, photoPath, showDetails: draft.showDetails, showImage: draft.showImage };
      if (editingId) {
        const oldPhoto = await repository.updateCheque(editingId, common);
        if (oldPhoto) await removeChequePhoto(oldPhoto).catch(() => undefined);
      } else await repository.createCheque(common);
      committed = true;
      await onRefresh(); setFeedback(editingId ? 'پروندهٔ چک به‌روز شد.' : 'چک و سررسید آن ثبت شد.'); setEditingId(''); setDraft(blank()); setPhotoData('');
    } catch (error) { if (newPath && !committed) await removeChequePhoto(newPath).catch(() => undefined); setFeedback((error as Error).message); }
    finally { setBusy(false); }
  }
  async function mark(item: ChequeEntry, status: ChequeEntry['status']) {
    if (!repository || busy) return;
    const message = status === 'cleared' ? 'وصول چک و ثبت دریافت وجه در فاکتور تأیید شود؟' : `وضعیت چک به «${statusText[status]}» تغییر کند؟`;
    if (!window.confirm(message)) return;
    setBusy(true); setFeedback('');
    try { await repository.setChequeStatus(item.id, status); await onRefresh(); setFeedback(`وضعیت چک ${item.serial} ثبت شد.`); }
    catch (error) { setFeedback((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card cheque-ledger" aria-label="پرونده چک‌ها"><div className="cheque-ledger-head"><div><span className="eyebrow">پرونده‌های وصول</span><h2>چک‌ها</h2></div><button onClick={() => { setEditingId(''); setDraft(blank()); setPhotoData(''); }}>+ چک تازه</button></div>
    <div className="cheque-summary">{(['open','cleared','returned'] as const).map(status => <button key={status} className={`cheque-${status}`} onClick={() => setFilter(status)}><small>{statusText[status]}</small><strong>{formatRial(totals[status])}</strong><span>ریال</span></button>)}</div>
    <div className="cheque-tools"><label>جست‌وجوی نام، شماره چک، بانک یا فاکتور<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label><label>وضعیت<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">همه</option>{Object.entries(statusText).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label></div>
    {feedback && <p className="finance-feedback" role="status">{feedback}</p>}
    <div className="cheque-records">{visible.map(item => { const invoice = overview.invoices.find(value => value.id === item.invoiceId); return <article className={`cheque-record cheque-${item.status}`} key={item.id}><div><strong>{item.party} · چک {item.serial}</strong><span>{statusText[item.status]}</span></div><small>{item.bank} · {formatRial(item.amountRial)} ریال · سررسید {item.dueJalali}</small><small>صیاد: {item.sayadId || 'ثبت نشده'} · {registrationText[item.registrationStatus ?? 'unknown']}</small>{invoice && <button onClick={() => onOpenInvoice(invoice)}>فاکتور {formatRial(invoice.number)} را ببینید</button>}{item.photoPath && <small>تصویر چک ضمیمه شده است.</small>}
      <div className="finance-actions">{item.status === 'open' && <><button onClick={() => edit(item)}>ویرایش پرونده</button><button disabled={busy} onClick={() => void mark(item, 'cleared')}>وصول شد</button><button disabled={busy} onClick={() => void mark(item, 'returned')}>برگشت خورد</button><button disabled={busy} onClick={() => void mark(item, 'cancelled')}>باطل شد</button></>}</div></article>; })}{!visible.length && <p className="empty">چکی با این جست‌وجو پیدا نشد.</p>}</div>
    <details className="cheque-edit" open={!!editingId} key={editingId || 'new'}><summary>{editingId ? `ویرایش چک ${selected?.serial ?? ''}` : 'ثبت چک مستقل تازه'}</summary><div className="finance-form">
      {!editingId && <label>نوع چک<select value={draft.direction} onChange={event => update('direction', event.target.value as Draft['direction'])}><option value="received">دریافتی</option><option value="issued">پرداختی</option></select></label>}
      <label>طرف حساب<input value={draft.party} onChange={event => update('party', event.target.value)}/></label><div className="form-pair"><label>شماره چک<input value={draft.serial} onChange={event => update('serial', event.target.value)}/></label><label>بانک<input value={draft.bank} onChange={event => update('bank', event.target.value)}/></label></div>
      <label>مبلغ (ریال)<input inputMode="numeric" value={draft.amount} onChange={event => { const number = latin(event.target.value).replace(/\D/g, ''); update('amount', number ? formatRial(Number(number)) : ''); }}/></label>
      <JalaliDateField label="سررسید شمسی" value={draft.due} onChange={value => update('due', value)}/>
      <div className="form-pair"><label>شناسهٔ صیادی ۱۶ رقمی<input inputMode="numeric" dir="ltr" maxLength={16} value={draft.sayad} onChange={event => update('sayad', latin(event.target.value).replace(/\D/g, '').slice(0,16))}/></label><label>کد ملی صادرکننده<input inputMode="numeric" dir="ltr" maxLength={10} value={draft.issuerId} onChange={event => update('issuerId', latin(event.target.value).replace(/\D/g, '').slice(0,10))}/></label></div>
      <label>کد ملی ذی‌نفع<input inputMode="numeric" dir="ltr" maxLength={10} value={draft.beneficiaryId} onChange={event => update('beneficiaryId', latin(event.target.value).replace(/\D/g, '').slice(0,10))}/></label>
      <label>وضعیت ثبت صیاد<select value={draft.registration} onChange={event => update('registration', event.target.value as Draft['registration'])}>{Object.entries(registrationText).map(([key,text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>یادداشت<input value={draft.note} onChange={event => update('note', event.target.value)}/></label>
      <div className="cheque-photo-actions"><button type="button" onClick={() => void camera()}>عکاسی چک</button><label>انتخاب عکس<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void prepareChequePhoto(file).then(setPhotoData).catch(error => setFeedback(error.message)); }}/></label></div>
      {photoData && <img className="cheque-photo-preview" src={photoData} alt="تصویر ثبت‌شدهٔ چک"/>}
      {!!selected?.invoiceId && <><label className="toggle-row"><span>نمایش اطلاعات چک در ضمیمهٔ فاکتور</span><input type="checkbox" checked={draft.showDetails} onChange={event => update('showDetails', event.target.checked)}/></label><label className="toggle-row"><span>چاپ تصویر چک در ضمیمهٔ فاکتور</span><input type="checkbox" checked={draft.showImage} onChange={event => update('showImage', event.target.checked)}/></label></>}
      <button className="primary" disabled={busy || !draft.party.trim() || !draft.serial.trim() || !draft.bank.trim() || !draft.amount || !draft.due} onClick={() => void save()}>{editingId ? 'ذخیرهٔ تغییرات چک' : 'ثبت پروندهٔ چک'}</button>
    </div></details>
  </section>;
}
