import { useEffect, useRef, useState } from 'react';
import { api, dateFa, rial, refundDue, receivable, type Invoice, type InvoiceDetail, type SalesReturn } from './api';
import { PaymentBadge } from './payment-badge';
import './returns.css';

type Selection = { quantity: number; restock: boolean };

export function Returns({ initialId, onTargetUsed }: { initialId: string | null; onTargetUsed: () => void }) {
  const [query, setQuery] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [history, setHistory] = useState<SalesReturn[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundMethod, setRefundMethod] = useState('transfer');
  const [refundReference, setRefundReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const returnKey = useRef(crypto.randomUUID());
  const refundKey = useRef(crypto.randomUUID());

  const refreshLists = async () => {
    const [found, prior] = await Promise.all([
      api<Invoice[]>(`/merchant/invoices?q=${encodeURIComponent(query)}`),
      api<SalesReturn[]>('/merchant/accounting/returns')
    ]);
    setInvoices(found.filter(item => item.paymentStatus !== 'proforma'));
    setHistory(prior);
  };
  useEffect(() => { void refreshLists().catch(e => setError(e.message)); }, [query]);
  useEffect(() => { if (initialId) { setSelectedId(initialId); onTargetUsed(); } }, [initialId, onTargetUsed]);
  useEffect(() => {
    if (!selectedId) { setInvoice(null); return; }
    setSelected({}); setReason('');
    void api<InvoiceDetail>(`/merchant/invoices/${selectedId}`).then(item => {
      setInvoice(item); setRefundAmount(refundDue(item)); setError('');
    }).catch(e => setError(e.message));
  }, [selectedId]);

  const available = invoice?.lines.map(line => ({ ...line, remaining: line.quantity - line.returnedQuantity })) ?? [];
  const picked = available.filter(line => selected[line.id]);
  const returnTotal = picked.reduce((sum, line) => sum + line.unitPriceRial * selected[line.id].quantity, 0);
  const due = invoice ? refundDue(invoice) : 0;
  const selectAll = () => setSelected(Object.fromEntries(available.filter(line => line.remaining > 0).map(line => [line.id, { quantity: line.remaining, restock: !!line.productId }])));

  const saveReturn = async () => {
    if (!invoice || !picked.length || !reason.trim() || busy) return;
    const lines = picked.map(line => ({ invoiceLineId: line.id, quantity: selected[line.id].quantity, restock: selected[line.id].restock }));
    if (lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > (available.find(item => item.id === line.invoiceLineId)?.remaining ?? 0))) {
      setError('تعداد مرجوعی از مقدار قابل برگشت بیشتر است.'); return;
    }
    if (!window.confirm(`مرجوعی ${rial(returnTotal)} از فاکتور ${invoice.number} ثبت شود؟`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/merchant/invoices/${invoice.id}/returns`, 'POST', { idempotencyKey: returnKey.current, reason: reason.trim(), lines });
      returnKey.current = crypto.randomUUID();
      const updated = await api<InvoiceDetail>(`/merchant/invoices/${invoice.id}`);
      setInvoice(updated); setRefundAmount(refundDue(updated)); setSelected({}); setReason('');
      await refreshLists();
      setNotice('مرجوعی ثبت شد. مانده به‌روزرسانی شد؛ فقط کالاهای انتخاب‌شده برای بازگشت به انبار، موجودی را تغییر دادند.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ثبت مرجوعی انجام نشد.'); }
    finally { setBusy(false); }
  };
  const saveRefund = async () => {
    if (!invoice || due === 0 || busy) return;
    if (!Number.isSafeInteger(refundAmount) || refundAmount < 1 || refundAmount > due) {
      setError('مبلغ بازپرداخت باید از صفر بیشتر و حداکثر برابر طلب مشتری باشد.'); return;
    }
    if (!window.confirm('فقط وجهی را ثبت کنید که واقعاً به مشتری بازپرداخت شده است. ادامه می‌دهید؟')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/merchant/invoices/${invoice.id}/refunds`, 'POST', { idempotencyKey: refundKey.current, amountRial: refundAmount, method: refundMethod, reference: refundReference });
      refundKey.current = crypto.randomUUID();
      const updated = await api<InvoiceDetail>(`/merchant/invoices/${invoice.id}`);
      setInvoice(updated); setRefundAmount(refundDue(updated)); setRefundReference('');
      await refreshLists();
      setNotice('بازپرداخت ثبت شد و ماندهٔ مشتری به‌روزرسانی شد.');
    } catch (e) { setError(e instanceof Error ? e.message : 'ثبت بازپرداخت انجام نشد.'); }
    finally { setBusy(false); }
  };

  return <div className="returns-page">
    <div className="page-intro"><h2>مرجوعی و بازپرداخت</h2><p>کالای برگشتی، وضعیت انبار و مبلغ قابل بازپرداخت را به فاکتور اصلی وصل کنید.</p></div>
    {error && <div className="field-error" role="alert">{error}</div>}
    {notice && <div className="toast success" role="status" onClick={() => setNotice('')}>{notice}</div>}
    <div className="return-layout">
      <section className="card return-picker"><div className="card-head"><h2>فاکتور را پیدا کنید</h2></div>
        <label>شمارهٔ فاکتور، نام یا شمارهٔ مشتری<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="جست‌وجوی فاکتور" /></label>
        <div className="return-invoice-list">{invoices.map(item => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
          <strong>فاکتور {item.number} · {item.customerName}</strong><PaymentBadge status={item.paymentStatus}/><small>{dateFa(item.issuedAt)} · {rial(item.totalRial - item.returnedRial)} خالص</small>
        </button>)}{!invoices.length && <p className="empty">فاکتوری پیدا نشد.</p>}</div>
      </section>
      <div>{invoice ? <><section className="card"><div className="card-head"><h2>فاکتور {invoice.number} · {invoice.customerName} <PaymentBadge status={invoice.paymentStatus}/></h2></div>
        <div className="return-totals"><div><small>فروش اولیه</small><strong>{rial(invoice.totalRial)}</strong></div><div><small>مرجوع‌شده</small><strong>{rial(invoice.returnedRial)}</strong></div><div><small>ماندهٔ دریافتنی</small><strong>{rial(receivable(invoice))}</strong></div><div><small>طلب مشتری</small><strong>{rial(due)}</strong></div></div>
        <div className="return-section-title"><h3>اقلام قابل مرجوع</h3><button type="button" onClick={selectAll} disabled={!available.some(line => line.remaining > 0)}>مرجوع کلِ باقی‌مانده</button></div>
        <div className="return-lines">{available.map(line => {
          const value = selected[line.id];
          return <div className="return-line" key={line.id}><label className="return-line-toggle"><input type="checkbox" disabled={line.remaining === 0} checked={!!value} onChange={e => setSelected(current => { const next = { ...current }; if (e.target.checked) next[line.id] = { quantity: line.remaining, restock: !!line.productId }; else delete next[line.id]; return next; })}/><span><strong>{line.nameSnapshot}</strong><small>فروخته‌شده {line.quantity} · قبلاً برگشته {line.returnedQuantity} · قابل مرجوع {line.remaining}</small></span></label>
            {value && <div className="return-line-controls"><label>تعداد برگشتی<div className="return-stepper"><button type="button" aria-label={`کم کردن ${line.nameSnapshot}`} onClick={() => setSelected(current => ({ ...current, [line.id]: { ...value, quantity: Math.max(1, value.quantity - 1) } }))}>−</button><input type="number" min="1" max={line.remaining} value={value.quantity} onChange={e => setSelected(current => ({ ...current, [line.id]: { ...value, quantity: Number(e.target.value) } }))}/><button type="button" aria-label={`افزودن ${line.nameSnapshot}`} onClick={() => setSelected(current => ({ ...current, [line.id]: { ...value, quantity: Math.min(line.remaining, value.quantity + 1) } }))}>＋</button></div></label>{line.productId ? <label className="return-restock"><input type="checkbox" checked={value.restock} onChange={e => setSelected(current => ({ ...current, [line.id]: { ...value, restock: e.target.checked } }))}/>کالا سالم است و به موجودی برگردد</label> : <small className="return-no-stock">این قلم در انبار ثبت نیست؛ مرجوعی بدون تغییر موجودی ثبت می‌شود.</small>}</div>}
          </div>;
        })}</div>
        <label>دلیل مرجوعی<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="مثلاً مغایرت رنگ یا انصراف مشتری"/></label>
        <div className="return-submit"><span>مبلغ این مرجوعی: <strong>{rial(returnTotal)}</strong></span><button className="primary" disabled={busy || !picked.length || !reason.trim()} onClick={() => void saveReturn()}>{busy ? 'در حال ثبت…' : 'ثبت مرجوعی'}</button></div>
      </section>
      {due > 0 && <section className="card refund-card"><h2>بازپرداخت به مشتری</h2><p>این مبلغ فقط پس از پرداخت واقعی ثبت شود. تا آن زمان در پیگیری‌های باز می‌ماند.</p><div className="form-grid"><label>مبلغ بازپرداخت (ریال)<input type="number" min="1" max={due} value={refundAmount} onChange={e => setRefundAmount(Number(e.target.value))}/></label><label>روش پرداخت<select value={refundMethod} onChange={e => setRefundMethod(e.target.value)}><option value="transfer">واریز بانکی</option><option value="cash">نقد</option><option value="card">کارت‌به‌کارت</option></select></label><label>شماره پیگیری (اختیاری)<input value={refundReference} onChange={e => setRefundReference(e.target.value)}/></label></div><button className="primary" disabled={busy} onClick={() => void saveRefund()}>ثبت وجه بازپرداخت‌شده</button></section>}
      </> : <div className="card empty">برای ثبت مرجوعی، فاکتور را از فهرست انتخاب کنید.</div>}</div>
    </div>
    <section className="card"><div className="card-head"><h2>سوابق مرجوعی</h2></div>{history.length ? <div className="list">{history.map(item => <div className="list-row" key={item.id}><div><strong>فاکتور {item.invoiceNumber} · {item.customerName}</strong><small>{dateFa(item.createdAt)} · {item.reason}</small></div><b>{rial(item.amountRial)}</b><button onClick={() => setSelectedId(item.invoiceId)}>دیدن فاکتور</button></div>)}</div> : <p className="empty">هنوز مرجوعی ثبت نشده است.</p>}</section>
  </div>;
}
