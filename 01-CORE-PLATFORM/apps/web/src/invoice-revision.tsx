import { useEffect, useState } from 'react';
import { JalaliDateField, isoToJalaliDate, jalaliToIsoDate } from '../../mobile/src/jalali-date';
import { api, rial, type InvoiceDetail, type Product } from './api';
import { rialDigits } from './invoice-quote';
import { InvoicePreview, type InvoiceRecord } from './invoice-preview';
import './invoice-revision.css';

type EditLine = { key: string; lineId: string | null; productId: string | null; name: string; price: string; quantity: string; discount: string };
type Revision = { revisionNo: number; reason: string; recordedAt: string; snapshotJson: string };

const asRial = (value: string) => value ? Number(value).toLocaleString('en-US') : '';

export function InvoiceRevisionEditor({ id, close, saved }: { id: string; close: () => void; saved: () => void }) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<EditLine[]>([]);
  const [history, setHistory] = useState<Revision[]>([]);
  const [historicalPreview, setHistoricalPreview] = useState<InvoiceRecord | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([api<InvoiceDetail>(`/merchant/invoices/${id}`), api<Revision[]>(`/merchant/invoices/${id}/revisions`)]).then(([current, revisions]) => {
      setInvoice(current); setHistory(revisions); setName(current.customerName); setPhone(current.customerPhone);
      setDate(isoToJalaliDate(current.issuedAt));
      setLines(current.lines.map(line => ({ key: line.id, lineId: line.id, productId: line.productId ?? null,
        name: line.nameSnapshot, price: String(line.unitPriceRial), quantity: String(line.quantity),
        discount: String(line.unitPriceRial * line.quantity - line.totalRial) })));
    }).catch(e => setError(e instanceof Error ? e.message : 'فاکتور دریافت نشد.'));
  }, [id]);
  useEffect(() => {
    if (!catalogOpen) return;
    const timer = window.setTimeout(() => {
      void api<Product[]>(`/merchant/products?q=${encodeURIComponent(productQuery)}&page=1`)
        .then(setProducts).catch(() => setProducts([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [catalogOpen, productQuery]);
  const edit = (key: string, part: keyof EditLine, value: string) => setLines(previous => previous.map(line => line.key === key ? { ...line, [part]: value } : line));
  const totals = lines.map(line => Number(line.price) * Number(line.quantity) - Number(line.discount));
  const total = totals.reduce((sum, value) => sum + value, 0);
  const valid = !!invoice && !!name.trim() && !!reason.trim() && !!jalaliToIsoDate(date) && lines.length > 0 &&
    lines.every((line, index) => line.name.trim() && Number.isSafeInteger(Number(line.price)) && Number(line.price) >= 0 &&
      Number.isSafeInteger(Number(line.quantity)) && Number(line.quantity) >= 1 && Number.isSafeInteger(Number(line.discount)) &&
      Number(line.discount) >= 0 && Number.isSafeInteger(totals[index]) && totals[index] >= 0) &&
    Number.isSafeInteger(total) && total >= invoice.paidRial - invoice.refundedRial;
  async function submit() {
    if (!invoice || !valid || busy) return;
    const iso = jalaliToIsoDate(date);
    if (!iso) return;
    setBusy(true); setError('');
    try {
      await api(`/merchant/invoices/${id}/revisions`, 'POST', {
        expectedRevision: invoice.revision, reason: reason.trim(), customerName: name.trim(), customerPhone: phone.trim(),
        issuedAt: date === isoToJalaliDate(invoice.issuedAt) ? null : `${iso}T12:00:00Z`,
        lines: lines.map(line => ({ lineId: line.lineId, productId: line.productId, name: line.name.trim(),
          unitPriceRial: Number(line.price), quantity: Number(line.quantity), discountRial: Number(line.discount) }))
      });
      saved();
    } catch (e) { setError(e instanceof Error ? e.message : 'اصلاح فاکتور ثبت نشد.'); }
    finally { setBusy(false); }
  }
  return <><div className="modal-backdrop" onClick={() => !busy && close()}>
    <div className="invoice-revision-dialog" role="dialog" aria-modal="true" aria-label="ویرایش فاکتور" onClick={e => e.stopPropagation()}>
      <div className="invoice-revision-head"><div><h2>ویرایش فاکتور {invoice?.number ?? ''}</h2><small>نسخهٔ {invoice?.revision ?? '…'} · شماره و نسخه‌های پیشین حفظ می‌شوند</small></div><button onClick={close} disabled={busy} aria-label="بستن ویرایش">بستن</button></div>
      {error && <div className="field-error" role="alert">{error}</div>}
      {invoice ? <div className="invoice-revision-body">
        <div className="invoice-revision-fields"><label>نام مشتری<input value={name} maxLength={200} onChange={e => setName(e.target.value)}/></label><label>شماره تماس<input value={phone} maxLength={30} inputMode="tel" onChange={e => setPhone(e.target.value)}/></label></div>
        <JalaliDateField label="تاریخ فاکتور به شمسی" value={date} onChange={setDate}/>
        <p className="hint">تعداد و قیمت را می‌توانید اصلاح کنید. موجودی کالا و ماندهٔ فاکتور هنگام ثبت دوباره بررسی می‌شوند. فاکتور دارای مرجوعی از این مسیر تغییر نمی‌کند.</p>
        <div className="invoice-revision-lines">{lines.map((line, index) => <div className="invoice-revision-line" key={line.key}>
          <div className="invoice-revision-line-title"><b>ردیف {index + 1}</b><button onClick={() => setLines(previous => previous.filter(item => item.key !== line.key))} disabled={busy || lines.length === 1}>حذف ردیف</button></div>
          <label>شرح کالا<input value={line.name} maxLength={300} onChange={e => edit(line.key, 'name', e.target.value)}/></label>
          <div className="invoice-revision-fields"><label>تعداد<input value={line.quantity} inputMode="numeric" onChange={e => edit(line.key, 'quantity', rialDigits(e.target.value))}/></label><label>قیمت واحد (ریال)<input value={asRial(line.price)} inputMode="numeric" dir="ltr" onChange={e => edit(line.key, 'price', rialDigits(e.target.value))}/></label><label>تخفیف ردیف (ریال)<input value={asRial(line.discount)} inputMode="numeric" dir="ltr" onChange={e => edit(line.key, 'discount', rialDigits(e.target.value))}/></label></div>
          <small>جمع ردیف: {Number.isSafeInteger(totals[index]) && totals[index] >= 0 ? rial(totals[index]) : 'نامعتبر'}</small>
        </div>)}</div>
        <div className="invoice-revision-catalog">
          <button onClick={() => setCatalogOpen(value => !value)} disabled={busy}>{catalogOpen ? 'بستن فهرست کالا' : 'افزودن کالا از فهرست'}</button>
          {catalogOpen && <div><label>جست‌وجوی کالا<input value={productQuery} onChange={e => setProductQuery(e.target.value)} placeholder="نام، کد یا مدل کالا"/></label>
            <div className="invoice-revision-product-list">{products.length ? products.map(product => {
              const alreadyAdded = lines.some(line => line.productId === product.id);
              return <div key={product.id}><span><b>{product.name}</b><small>{rial(product.priceRial)} · موجودی {product.stock.toLocaleString('fa-IR')}</small></span>
                <button disabled={alreadyAdded || product.stock < 1 || busy || lines.length >= 200} onClick={() => setLines(previous => [...previous, {
                  key: crypto.randomUUID(), lineId: null, productId: product.id, name: product.name,
                  price: String(product.priceRial), quantity: '1', discount: '0' }])}>{alreadyAdded ? 'در فاکتور است' : 'افزودن'}</button></div>;
            }) : <p className="hint">کالایی پیدا نشد.</p>}</div></div>}
        </div>
        <button onClick={() => setLines(previous => [...previous, { key: crypto.randomUUID(), lineId: null, productId: null, name: '', price: '0', quantity: '1', discount: '0' }])} disabled={busy || lines.length >= 200}>افزودن قلم دستی</button>
        <label>دلیل اصلاح فاکتور<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="مثلاً اصلاح تعداد یا قیمت"/></label>
        <details className="invoice-revision-history"><summary>سابقهٔ نسخه‌ها ({history.length || 1})</summary>{history.length ? history.map(entry => {
          const snapshot = JSON.parse(entry.snapshotJson) as InvoiceRecord;
          return <div key={entry.revisionNo}><b>نسخهٔ {entry.revisionNo}</b> · {entry.reason}<small>{isoToJalaliDate(entry.recordedAt)} · {rial(snapshot.totalRial)}</small><button onClick={() => setHistoricalPreview(snapshot)}>نمایش و چاپ این نسخه</button></div>;
        }) : <p>نسخهٔ صادرشده پس از نخستین اصلاح در این فهرست ثبت می‌شود.</p>}</details>
      </div> : <div className="empty">در حال دریافت جزئیات فاکتور…</div>}
      <div className="invoice-revision-foot"><strong>جمع جدید: {Number.isSafeInteger(total) ? rial(total) : 'نامعتبر'}</strong><button className="primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'در حال ثبت اصلاح…' : 'ثبت نسخهٔ جدید'}</button></div>
    </div>
  </div>{historicalPreview && <InvoicePreview id={id} snapshot={historicalPreview} close={() => setHistoricalPreview(null)}/>}</>;
}
