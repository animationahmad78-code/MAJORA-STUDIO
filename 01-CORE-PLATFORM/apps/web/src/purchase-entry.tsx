import { useRef, useState } from 'react';
import { api, rial, type Product } from './api';
import { JalaliDateField, jalaliToIsoDate } from '../../mobile/src/jalali-date';

type Row = { productId: string; name: string; sku: string; category: string; priceRial: number; quantity: number; unitCostRial: number };
const emptyRow = (): Row => ({ productId: '', name: '', sku: '', category: '', priceRial: 0, quantity: 1, unitCostRial: 0 });

export function PurchaseEntry({ products, reload, run }: { products: Product[]; reload: () => Promise<void>; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const [supplier, setSupplier] = useState(''); const [reference, setReference] = useState('');
  const [paid, setPaid] = useState(0); const [due, setDue] = useState(''); const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const key = useRef(crypto.randomUUID());
  const change = (index: number, patch: Partial<Row>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  const total = rows.reduce((sum, row) => sum + row.quantity * row.unitCostRial, 0);
  const submit = async () => {
    const dueIso = due ? jalaliToIsoDate(due) : null;
    if (due && !dueIso) throw new Error('تاریخ پیگیری شمسی معتبر نیست.');
    const lines = rows.map(row => row.productId === 'new'
      ? { productId: null, newProduct: { name: row.name, sku: row.sku, category: row.category, priceRial: row.priceRial }, quantity: row.quantity, unitCostRial: row.unitCostRial }
      : { productId: row.productId, newProduct: null, quantity: row.quantity, unitCostRial: row.unitCostRial });
    await api('/merchant/accounting/purchases', 'POST', { idempotencyKey: key.current, supplierName: supplier, supplierInvoiceNumber: reference, paidRial: paid,
      dueAt: dueIso ? new Date(`${dueIso}T12:00:00`).toISOString() : null, lines });
    key.current = crypto.randomUUID(); setSupplier(''); setReference(''); setPaid(0); setDue(''); setRows([emptyRow()]); await reload();
  };
  return <section className="card"><div className="card-head"><h2>ثبت خرید و ورود کالا</h2></div>
    <form onSubmit={e => { e.preventDefault(); void run(submit, 'خرید ثبت شد و موجودی به‌روزرسانی شد.'); }}>
      <div className="form-grid"><label>تأمین‌کننده<input value={supplier} onChange={e => setSupplier(e.target.value)} required /></label><label>شماره سند تأمین‌کننده<input value={reference} onChange={e => setReference(e.target.value)} /></label></div>
      {rows.map((row, index) => <div className="purchase-row" key={index}>
        <label>کالا<select value={row.productId} onChange={e => change(index, { productId: e.target.value })} required><option value="">انتخاب کنید</option><option value="new">＋ کالای جدید؛ همین‌جا در انبار ثبت شود</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {row.productId === 'new' && <div className="purchase-new-product"><label>نام کالا<input value={row.name} onChange={e => change(index, { name: e.target.value })} required /></label><label>شناسه یکتا<input dir="ltr" value={row.sku} onChange={e => change(index, { sku: e.target.value })} required /></label><label>دسته<input value={row.category} onChange={e => change(index, { category: e.target.value })} /></label><label>قیمت فروش (ریال)<input type="number" min="0" value={row.priceRial} onChange={e => change(index, { priceRial: Number(e.target.value) })} required /></label></div>}
        <label>تعداد<input type="number" min="1" value={row.quantity} onChange={e => change(index, { quantity: Number(e.target.value) })} required /></label>
        <label>فی خرید (ریال)<input type="number" min="0" value={row.unitCostRial} onChange={e => change(index, { unitCostRial: Number(e.target.value) })} required /></label>
        {rows.length > 1 && <button type="button" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>حذف ردیف</button>}
      </div>)}
      <button type="button" onClick={() => setRows(current => [...current, emptyRow()])}>＋ ردیف دیگر</button>
      <p className="purchase-total">جمع خرید: <strong>{rial(total)}</strong></p>
      <div className="form-grid"><label>پرداخت‌شده (ریال)<input type="number" min="0" max={total} value={paid} onChange={e => setPaid(Number(e.target.value))} /></label><JalaliDateField label="تاریخ پیگیری مانده (شمسی)" value={due} onChange={setDue} optional /></div>
      <button className="primary full" disabled={!supplier.trim() || rows.some(row => !row.productId)}>ثبت خرید و افزایش موجودی</button>
    </form>
  </section>;
}
