import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import JsPdf from 'jspdf';
import { api, dateFa, rial } from './api';
import { InvoicePreview } from './invoice-preview';
import { PaymentBadge } from './payment-badge';
import './customer-dossier.css';

type Customer = { id: string; name: string; phone: string; address: string; occupation: string; acquisitionSource: string; referrerPhone: string; notes: string; createdAt: string; archived: boolean };
type Invoice = { id: string; number: number; revision: number; issuedAt: string; status: string; paymentStatus: string; archived: boolean; totalRial: number; paidRial: number; returnedRial: number; refundedRial: number };
type InvoiceLine = { id: string; invoiceId: string; position: number; nameSnapshot: string; quantity: number; returnedQuantity: number; unitPriceRial: number; totalRial: number };
type Payment = { id: string; invoiceId: string; amountRial: number; method: string; reference: string; receivedAt: string };
type SalesReturn = { id: string; invoiceId: string; amountRial: number; reason: string; createdAt: string };
type Refund = { id: string; invoiceId: string; amountRial: number; method: string; reference: string; refundedAt: string };
type Cheque = { id: string; invoiceId: string; serial: string; bank: string; amountRial: number; dueAt: string; createdAt: string; status: string; registrationStatus: string; sayadId: string; issuerNationalId: string; beneficiaryNationalId: string; hasPhoto: boolean };
type Reminder = { id: string; invoiceId: string; title: string; dueAt: string; done: boolean };
type Dossier = { customer: Customer; status: string; receivableRial: number; refundDueRial: number; invoiceCount: number; invoices: Invoice[]; invoiceLines: InvoiceLine[]; payments: Payment[]; returns: SalesReturn[]; refunds: Refund[]; cheques: Cheque[]; reminders: Reminder[] };
type Event = { id: string; at: string; title: string; detail: string; amount?: number; invoiceId?: string; kind: string };

const fullDate = (value: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const chequeStatus: Record<string, string> = { open: 'باز', cleared: 'وصول‌شده', returned: 'برگشتی', cancelled: 'باطل‌شده' };
const paymentMethod: Record<string, string> = { initial: 'هنگام صدور', cash: 'نقد', transfer: 'واریز بانکی', card: 'کارت‌به‌کارت' };
const invoiceStatus: Record<string, string> = { paid: 'تسویه', partial: 'پیش‌پرداخت / مانده', unpaid: 'تسویه‌نشده', cheque: 'چک در انتظار وصول', proforma: 'پیش‌فاکتور' };
const chequeRegistration: Record<string, string> = { unknown: 'نامشخص', unregistered: 'ثبت‌نشده', registered: 'ثبت‌شده', confirmed: 'تأییدشده' };

function timeline(data: Dossier): Event[] {
  const number = new Map(data.invoices.map(invoice => [invoice.id, invoice.number]));
  const issuedAt = new Map(data.invoices.map(invoice => [invoice.id, invoice.issuedAt]));
  const invoiceLabel = (id: string) => `فاکتور ${number.get(id) ?? '—'}`;
  return [
    { id: `customer-${data.customer.id}`, at: data.customer.createdAt, title: 'ثبت مشتری', detail: data.customer.name, kind: 'customer' },
    ...data.invoices.map(invoice => ({ id: `invoice-${invoice.id}`, at: invoice.issuedAt, title: `${invoice.paymentStatus === 'proforma' ? 'پیش‌فاکتور' : 'صدور فاکتور'} ${invoice.number}`, detail: `${invoice.archived ? 'بایگانی‌شده · ' : ''}وضعیت: ${invoiceStatus[invoice.paymentStatus] ?? 'نامشخص'} · نسخه ${invoice.revision}`, amount: invoice.totalRial, invoiceId: invoice.id, kind: 'invoice' })),
    ...data.invoiceLines.map(item => ({ id: `line-${item.id}`, at: issuedAt.get(item.invoiceId) ?? data.customer.createdAt, title: `قلم ${item.position.toLocaleString('fa-IR')} · ${invoiceLabel(item.invoiceId)}`, detail: `${item.nameSnapshot} · تعداد ${item.quantity.toLocaleString('fa-IR')} · فی ${rial(item.unitPriceRial)}${item.returnedQuantity ? ` · مرجوع ${item.returnedQuantity.toLocaleString('fa-IR')}` : ''}`, amount: item.totalRial, invoiceId: item.invoiceId, kind: 'line' })),
    ...data.payments.map(item => ({ id: `payment-${item.id}`, at: item.receivedAt, title: `دریافت وجه · ${invoiceLabel(item.invoiceId)}`, detail: `${paymentMethod[item.method] ?? item.method}${item.reference ? ` · پیگیری ${item.reference}` : ''}`, amount: item.amountRial, invoiceId: item.invoiceId, kind: 'payment' })),
    ...data.returns.map(item => ({ id: `return-${item.id}`, at: item.createdAt, title: `مرجوعی · ${invoiceLabel(item.invoiceId)}`, detail: item.reason, amount: item.amountRial, invoiceId: item.invoiceId, kind: 'return' })),
    ...data.refunds.map(item => ({ id: `refund-${item.id}`, at: item.refundedAt, title: `بازپرداخت · ${invoiceLabel(item.invoiceId)}`, detail: `${paymentMethod[item.method] ?? item.method}${item.reference ? ` · پیگیری ${item.reference}` : ''}`, amount: item.amountRial, invoiceId: item.invoiceId, kind: 'refund' })),
    ...data.cheques.map(item => ({ id: `cheque-${item.id}`, at: item.createdAt, title: `چک ${item.serial} · ${invoiceLabel(item.invoiceId)}`, detail: `${item.bank} · ${chequeStatus[item.status] ?? 'نامشخص'} · سررسید ${dateFa(item.dueAt)}`, amount: item.amountRial, invoiceId: item.invoiceId, kind: 'cheque' })),
    ...data.reminders.map(item => ({ id: `reminder-${item.id}`, at: item.dueAt, title: `یادآور: ${item.title}`, detail: `${invoiceLabel(item.invoiceId)} · ${item.done ? 'انجام‌شده' : 'باز'}`, invoiceId: item.invoiceId, kind: 'reminder' }))
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function pdfChunks(events: Event[]) {
  const pages: Event[][] = [events.slice(0, 8)];
  for (let index = 8; index < events.length; index += 12) pages.push(events.slice(index, index + 12));
  return pages;
}

export function CustomerDossier({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<Dossier | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const pagesRef = useRef<HTMLDivElement>(null);
  const load = () => api<Dossier>(`/merchant/customers/${id}/dossier`).then(setData);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api<Dossier>(`/merchant/customers/${id}/dossier`)
      .then(value => { if (active) setData(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'پرونده دریافت نشد.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  const events = useMemo(() => data ? timeline(data) : [], [data]);
  const filtered = events.filter(event => (kind === 'all' || event.kind === kind) &&
    (!search.trim() || `${event.title} ${event.detail} ${event.amount ?? ''}`.includes(search.trim())));

  async function downloadPdf() {
    if (!pagesRef.current || !data || busy) return;
    setBusy(true); setError('');
    try {
      await document.fonts.ready;
      const pdf = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pages = Array.from(pagesRef.current.querySelectorAll<HTMLElement>('.dossier-pdf-page'));
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        if (page.scrollHeight > page.clientHeight + 2) throw new Error(`صفحهٔ ${index + 1} پرونده برای PDF جا نمی‌شود؛ داده را بررسی کنید.`);
        const canvas = await html2canvas(page, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
        if (index) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      pdf.save(`majora-customer-${data.customer.id}.pdf`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'PDF پرونده آماده نشد.'); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="card" role="status">در حال دریافت پروندهٔ مشتری…</section>;
  if (!data) return <section className="card"><p className="field-error" role="alert">{error || 'پرونده پیدا نشد.'}</p><button onClick={onBack}>بازگشت به مشتریان</button></section>;
  const customer = data.customer;
  const pages = pdfChunks(events);
  const invoiceNumber = new Map(data.invoices.map(item => [item.id, item.number]));
  return <div className="customer-dossier">
    <div className="page-intro dossier-head"><div><button type="button" onClick={onBack}>← بازگشت به مشتریان</button><h2>پروندهٔ {customer.name}</h2><PaymentBadge status={data.status}/></div><div className="form-actions"><button onClick={() => void load().catch(reason => setError(reason.message))}>تازه‌سازی</button><button className="primary" disabled={busy} onClick={() => void downloadPdf()}>{busy ? 'در حال ساخت PDF…' : 'دریافت PDF کامل'}</button></div></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="dossier-summary"><div><small>فاکتورها</small><strong>{data.invoiceCount.toLocaleString('fa-IR')}</strong></div><div><small>ماندهٔ دریافتنی</small><strong>{rial(data.receivableRial)}</strong></div><div><small>بازپرداخت باز</small><strong>{rial(data.refundDueRial)}</strong></div><div><small>چک‌های مرتبط</small><strong>{data.cheques.length.toLocaleString('fa-IR')}</strong></div></div>
    <section className="card dossier-profile"><h3>مشخصات مشتری</h3><dl><div><dt>تلفن</dt><dd dir="ltr">{customer.phone || 'ثبت نشده'}</dd></div><div><dt>نشانی</dt><dd>{customer.address || 'ثبت نشده'}</dd></div><div><dt>شغل</dt><dd>{customer.occupation || 'ثبت نشده'}</dd></div><div><dt>نحوهٔ آشنایی</dt><dd>{customer.acquisitionSource || 'ثبت نشده'}</dd></div><div><dt>شمارهٔ معرف</dt><dd dir="ltr">{customer.referrerPhone || 'ثبت نشده'}</dd></div><div><dt>تاریخ ثبت</dt><dd>{fullDate(customer.createdAt)}</dd></div></dl>{customer.notes && <p><b>یادداشت:</b> {customer.notes}</p>}{customer.phone && <a className="button-link" href={`tel:${customer.phone}`}>تماس با {customer.name}</a>}</section>
    <section className="card"><div className="card-head"><h3>سابقهٔ فعالیت</h3><span>{events.length.toLocaleString('fa-IR')} رویداد</span></div><div className="dossier-filters"><input type="search" aria-label="جست‌وجوی پرونده" placeholder="جست‌وجو در فعالیت‌ها" value={search} onChange={event => setSearch(event.target.value)}/><select aria-label="نوع فعالیت" value={kind} onChange={event => setKind(event.target.value)}><option value="all">همهٔ فعالیت‌ها</option><option value="invoice">فاکتور</option><option value="line">اقلام فاکتور</option><option value="payment">دریافت</option><option value="return">مرجوعی</option><option value="refund">بازپرداخت</option><option value="cheque">چک</option><option value="reminder">یادآور</option></select></div><div className="dossier-events">{filtered.slice(0, showAll ? undefined : 8).map(event => <article key={event.id}><div><strong>{event.title}</strong><small>{fullDate(event.at)} · {event.detail}</small></div>{event.amount !== undefined && <b>{rial(event.amount)}</b>}{event.invoiceId && <button onClick={() => setInvoiceId(event.invoiceId!)}>فاکتور</button>}</article>)}{!filtered.length && <p className="empty">رویدادی با این فیلتر پیدا نشد.</p>}</div>{filtered.length > 8 && <button onClick={() => setShowAll(!showAll)}>{showAll ? 'نمایش کوتاه' : `نمایش همهٔ ${filtered.length.toLocaleString('fa-IR')} رویداد`}</button>}</section>
    <details className="card dossier-details" open><summary>فاکتورها و پیش‌فاکتورها · {data.invoices.length.toLocaleString('fa-IR')}</summary><div className="dossier-events">{data.invoices.map(item => <article key={item.id}><div><strong>فاکتور {item.number.toLocaleString('fa-IR')} {item.archived ? '· بایگانی‌شده' : ''}</strong><small>{fullDate(item.issuedAt)} · نسخهٔ {item.revision.toLocaleString('fa-IR')}</small></div><PaymentBadge status={item.paymentStatus}/><b>{rial(item.totalRial - item.returnedRial)}</b><button onClick={() => setInvoiceId(item.id)}>نمایش و خروجی</button></article>)}{!data.invoices.length && <p className="empty">فاکتوری ثبت نشده است.</p>}</div></details>
    <details className="card dossier-details"><summary>چک‌ها و پیگیری‌ها · {data.cheques.length.toLocaleString('fa-IR')} چک، {data.reminders.length.toLocaleString('fa-IR')} یادآور</summary><div className="dossier-events">{data.cheques.map(item => <article key={item.id}><div><strong>چک {item.serial} · {item.bank}</strong><small>سررسید {dateFa(item.dueAt)} · {chequeStatus[item.status] ?? 'نامشخص'} · ثبت صیاد: {chequeRegistration[item.registrationStatus] ?? 'نامشخص'}</small></div><b>{rial(item.amountRial)}</b><button onClick={() => setInvoiceId(item.invoiceId)}>فاکتور {invoiceNumber.get(item.invoiceId)}</button></article>)}{data.reminders.map(item => <article key={item.id}><div><strong>{item.title}</strong><small>سررسید {dateFa(item.dueAt)} · {item.done ? 'انجام‌شده' : 'باز'}</small></div><button onClick={() => setInvoiceId(item.invoiceId)}>فاکتور {invoiceNumber.get(item.invoiceId)}</button></article>)}</div></details>
    <div className="dossier-pdf-pages" ref={pagesRef} aria-hidden="true">{pages.map((group, index) => <section className="dossier-pdf-page" key={index} dir="rtl"><header><strong>MAJORA · پروندهٔ مشتری</strong><span>صفحهٔ {(index + 1).toLocaleString('fa-IR')} از {pages.length.toLocaleString('fa-IR')}</span></header><h1>{customer.name}</h1>{index === 0 && <><div className="dossier-pdf-meta"><span>تلفن: {customer.phone || '—'}</span><span>ثبت: {dateFa(customer.createdAt)}</span><span>نشانی: {customer.address || '—'}</span><span>شغل: {customer.occupation || '—'}</span><span>نحوهٔ آشنایی: {customer.acquisitionSource || '—'}</span><span>معرف: {customer.referrerPhone || '—'}</span></div><div className="dossier-pdf-totals"><span>فاکتور: {data.invoiceCount.toLocaleString('fa-IR')}</span><span>مانده: {rial(data.receivableRial)}</span><span>بازپرداخت باز: {rial(data.refundDueRial)}</span></div>{customer.notes && <p>یادداشت: {customer.notes}</p>}</>}<h2>فعالیت‌ها {index ? '· ادامه' : ''}</h2><div className="dossier-pdf-events">{group.map(event => <div key={event.id}><strong>{event.title}</strong><span>{fullDate(event.at)} · {event.detail}</span><b>{event.amount === undefined ? '' : rial(event.amount)}</b></div>)}{!group.length && <p>فعالیتی ثبت نشده است.</p>}</div><footer>این گزارش از داده‌های ثبت‌شدهٔ فروشگاه تهیه شده است · {fullDate(new Date().toISOString())}</footer></section>)}</div>
    {invoiceId && <InvoicePreview id={invoiceId} close={() => setInvoiceId(null)}/>}
  </div>;
}
