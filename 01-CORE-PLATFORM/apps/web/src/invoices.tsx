import { useEffect, useRef, useState } from 'react';
import { api, dateFa, rial, receivable, refundDue, type Invoice } from './api';
import { InvoicePreview } from './invoice-preview';
import { InvoiceRevisionEditor } from './invoice-revision';
import { PaymentBadge } from './payment-badge';
import { RialInput } from './rial-input';
import './invoices.css';

export function Invoices({ run, onReturn, onCheque, initialId, onInitialViewed }: { run: (action: () => Promise<unknown>, success?: string) => Promise<void>; onReturn: (id: string) => void; onCheque: () => void; initialId?: string | null; onInitialViewed?: () => void }) {
  const [items, setItems] = useState<Invoice[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [revising, setRevising] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [paying, setPaying] = useState(false);
  const paymentKey = useRef(crypto.randomUUID());
  const load = () => api<Invoice[]>(`/merchant/invoices?q=${encodeURIComponent(query)}`).then(setItems);
  useEffect(() => { void load().catch(() => {}); }, [query]);
  useEffect(() => { if (initialId) { setPreview(initialId); onInitialViewed?.(); } }, [initialId]);
  return <><div className="page-intro"><h2>فاکتورها و مانده‌ها</h2><p>شماره، نام یا تلفن مشتری را جست‌وجو کنید؛ دریافت وجه و مرجوعی از همین فهرست در دسترس‌اند.</p></div>
    <section className="card"><div className="card-head"><h2>فهرست فاکتورها</h2><input className="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="شماره، نام یا تلفن" aria-label="جست‌وجوی فاکتور"/></div>
      {items.length ? <div className="list">{items.map(invoice => <div className="list-row invoice-list-row" key={invoice.id}>
        <div className={'status-dot ' + invoice.paymentStatus} aria-hidden="true"/>
        <div><strong>{invoice.paymentStatus === 'proforma' ? 'پیش‌فاکتور' : 'فاکتور'} {invoice.number} · {invoice.customerName}</strong> <PaymentBadge status={invoice.paymentStatus}/><small>{dateFa(invoice.issuedAt)}{invoice.revision > 1 ? ` · نسخهٔ ${invoice.revision}` : ''}</small></div>
        <div className="money"><b>{rial(invoice.totalRial - invoice.returnedRial)}</b><small>{invoice.paymentStatus === 'proforma' ? 'بدون بدهی؛ هنوز فروش قطعی نشده است' : `مانده: ${rial(receivable(invoice))}${refundDue(invoice) > 0 ? ` · بازپرداخت: ${rial(refundDue(invoice))}` : ''}`}</small></div>
        <div className="invoice-row-actions"><button onClick={() => setPreview(invoice.id)}>نمایش / چاپ</button>
          {invoice.status === 'issued' && invoice.paymentStatus !== 'cheque' && invoice.returnedRial === 0 && invoice.refundedRial === 0 && <button onClick={() => setRevising(invoice.id)}>ویرایش فاکتور</button>}
          {invoice.status === 'issued' && invoice.paymentStatus === 'proforma' && <button onClick={() => { if (!window.confirm(`پیش‌فاکتور ${invoice.number} با همان قیمت‌ها به فروش قطعیِ تسویه‌نشده تبدیل شود؟ موجودی کالاها اکنون بررسی و کسر می‌شود.`)) return; void run(async () => { await api(`/merchant/invoices/${invoice.id}/convert`, 'POST'); await load(); }, 'پیش‌فاکتور به فروش قطعی تبدیل شد.'); }}>تبدیل به فروش</button>}
          {invoice.status === 'issued' && (invoice.paymentStatus === 'proforma' || (receivable(invoice) === 0 && refundDue(invoice) === 0)) && <button onClick={() => { if (!window.confirm(`فاکتور ${invoice.number} بایگانی شود؟ سابقهٔ مالی حفظ می‌شود.`)) return; void run(async () => { await api(`/merchant/archive/invoices/${invoice.id}`, 'POST'); await load(); }, 'فاکتور بایگانی شد.'); }}>بایگانی</button>}
          {invoice.status === 'issued' && invoice.paymentStatus !== 'proforma' && invoice.paymentStatus !== 'cheque' && <button onClick={() => onReturn(invoice.id)}>مرجوعی / بازپرداخت</button>}
          {invoice.paymentStatus === 'cheque' && <button onClick={onCheque}>پیگیری چک</button>}
          {invoice.status === 'issued' && invoice.paymentStatus !== 'proforma' && invoice.paymentStatus !== 'cheque' && receivable(invoice) > 0 && <button onClick={() => { paymentKey.current = crypto.randomUUID(); setSelected(invoice); setAmount(''); }}>ثبت دریافت</button>}
          {invoice.customerPhone && <a href={`tel:${invoice.customerPhone.replace(/[^+\d]/g, '')}`}>تماس با مشتری</a>}
        </div>
      </div>)}</div> : <div className="empty">فاکتوری پیدا نشد.</div>}</section>
    {selected && <div className="modal-backdrop" onClick={() => !paying && setSelected(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="ثبت دریافت" onClick={e => e.stopPropagation()}><h2>دریافت فاکتور {selected.number}</h2><p>ماندهٔ قابل دریافت: {rial(receivable(selected))}</p><label>مبلغ دریافتی (ریال)<RialInput value={amount} onValueChange={setAmount} placeholder="مبلغ دریافتی" required/></label><label>روش دریافت<select value={method} onChange={e => setMethod(e.target.value)}><option value="transfer">واریز بانکی</option><option value="cash">نقد</option><option value="card">کارت‌به‌کارت</option></select></label><div className="form-actions"><button className="primary" disabled={paying || !Number.isSafeInteger(Number(amount)) || Number(amount) < 1 || Number(amount) > receivable(selected)} onClick={() => { if (paying) return; setPaying(true); void run(async () => { await api(`/merchant/invoices/${selected.id}/payments`, 'POST', { idempotencyKey: paymentKey.current, amountRial: Number(amount), method }); paymentKey.current = crypto.randomUUID(); setSelected(null); await load(); }, 'دریافت ثبت شد.').finally(() => setPaying(false)); }}>{paying ? 'در حال ثبت…' : 'ثبت دریافت واقعی'}</button><button disabled={paying} onClick={() => setSelected(null)}>انصراف</button></div></div></div>}
    {preview && <InvoicePreview id={preview} close={() => setPreview(null)}/>}
    {revising && <InvoiceRevisionEditor id={revising} close={() => setRevising(null)} saved={() => { setRevising(null); void load(); }}/>}
  </>;
}
