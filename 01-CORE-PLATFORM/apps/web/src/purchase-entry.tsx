import { useRef, useState } from 'react';
import { api, rial, type Product } from './api';
import { JalaliDateField, jalaliToIsoDate } from '../../mobile/src/jalali-date';
import { RialInput } from './rial-input';

type Row = { productId: string; name: string; sku: string; category: string; priceRial: string; quantity: number; unitCostRial: string; stockQuantity: string };
const emptyRow = (): Row => ({ productId: '', name: '', sku: '', category: '', priceRial: '', quantity: 1, unitCostRial: '', stockQuantity: '1' });

export function PurchaseEntry({ products, reload, run }: { products: Product[]; reload: () => Promise<void>; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const [supplier, setSupplier] = useState(''); const [reference, setReference] = useState('');
  const [paid, setPaid] = useState(''); const [due, setDue] = useState(''); const [purchasedAt, setPurchasedAt] = useState('');
  const [stockMode, setStockMode] = useState<'received' | 'purchase-only' | ''>('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const key = useRef(crypto.randomUUID());
  const change = (index: number, patch: Partial<Row>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  const total = rows.reduce((sum, row) => sum + row.quantity * Number(row.unitCostRial || 0), 0);
  const submit = async () => {
    const dueIso = due ? jalaliToIsoDate(due) : null;
    if (due && !dueIso) throw new Error('تاریخ پیگیری شمسی معتبر نیست.');
    const purchaseIso = purchasedAt ? jalaliToIsoDate(purchasedAt) : null;
    if (purchasedAt && !purchaseIso) throw new Error('تاریخ خرید شمسی معتبر نیست.');
    if (!stockMode) throw new Error('ابتدا وضعیت ورود کالا به موجودی را مشخص کنید.');
    if (rows.some(row => stockMode === 'received' && (!Number.isSafeInteger(Number(row.stockQuantity)) || Number(row.stockQuantity) < 0 || Number(row.stockQuantity) > row.quantity)))
      throw new Error('تعداد ورود به انبار باید بین صفر و تعداد خرید باشد.');
    const lines = rows.map(row => row.productId === 'new'
      ? { productId: null, newProduct: { name: row.name, sku: row.sku, category: row.category, priceRial: Number(row.priceRial || 0) }, quantity: row.quantity, unitCostRial: Number(row.unitCostRial || 0), stockQuantity: stockMode === 'received' ? Number(row.stockQuantity) : 0 }
      : { productId: row.productId, newProduct: null, quantity: row.quantity, unitCostRial: Number(row.unitCostRial || 0), stockQuantity: stockMode === 'received' ? Number(row.stockQuantity) : 0 });
    await api('/merchant/accounting/purchases', 'POST', { idempotencyKey: key.current, supplierName: supplier, supplierInvoiceNumber: reference, paidRial: Number(paid || 0),
      dueAt: dueIso ? new Date(`${dueIso}T12:00:00`).toISOString() : null, purchasedAt: purchaseIso ? new Date(`${purchaseIso}T12:00:00`).toISOString() : null, lines });
    key.current = crypto.randomUUID(); setSupplier(''); setReference(''); setPaid(''); setDue(''); setPurchasedAt(''); setStockMode(''); setRows([emptyRow()]); await reload();
  };
  return <section className="card"><div className="card-head"><h2>ثبت خرید و ورود کالا</h2></div>
    <form onSubmit={e => { e.preventDefault(); void run(submit, stockMode === 'received' ? 'خرید ثبت شد و تعداد دریافتی به موجودی اضافه شد.' : 'خرید ثبت شد؛ موجودی تغییر نکرد.'); }}>
      <div className="form-grid"><label>تأمین‌کننده<input value={supplier} onChange={e => setSupplier(e.target.value)} required /></label><label>شماره سند تأمین‌کننده<input value={reference} onChange={e => setReference(e.target.value)} /></label></div>
      <JalaliDateField label="تاریخ خرید (شمسی؛ خالی = امروز)" value={purchasedAt} onChange={setPurchasedAt} optional />
      {rows.map((row, index) => <div className="purchase-row" key={index}>
        <label>کالا<select value={row.productId} onChange={e => change(index, { productId: e.target.value })} required><option value="">انتخاب کنید</option><option value="new">＋ کالای جدید؛ همین‌جا در انبار ثبت شود</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {row.productId === 'new' && <div className="purchase-new-product"><label>نام کالا<input value={row.name} onChange={e => change(index, { name: e.target.value })} required /></label><label>شناسه یکتا<input dir="ltr" value={row.sku} onChange={e => change(index, { sku: e.target.value })} required /></label><label>دسته<input value={row.category} onChange={e => change(index, { category: e.target.value })} /></label><label>قیمت فروش (ریال)<RialInput value={row.priceRial} onValueChange={value => change(index, { priceRial: value })} placeholder="مبلغ فروش" required /></label></div>}
        <label>تعداد<input type="number" min="1" value={row.quantity} onChange={e => change(index, { quantity: Number(e.target.value), stockQuantity: e.target.value })} required /></label>
        <label>فی خرید (ریال)<RialInput className="purchase-money-input" value={row.unitCostRial} onValueChange={value => change(index, { unitCostRial: value })} placeholder="مبلغ هر کالا" required /></label>
        {stockMode === 'received' && <label>تعداد تحویل‌شده به انبار<input type="number" min="0" max={row.quantity} value={row.stockQuantity} onChange={e => change(index, { stockQuantity: e.target.value })} required /><button type="button" onClick={() => change(index, { stockQuantity: String(row.quantity) })}>همهٔ {row.quantity} عدد</button></label>}
        {rows.length > 1 && <button type="button" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>حذف ردیف</button>}
      </div>)}
      <button type="button" onClick={() => setRows(current => [...current, emptyRow()])}>＋ ردیف دیگر</button>
      <p className="purchase-total">جمع خرید: <strong>{rial(total)}</strong></p>
      <div className="form-grid"><label>پرداخت‌شده (ریال)<RialInput value={paid} onValueChange={setPaid} placeholder="خالی = پرداخت نشده" /></label><JalaliDateField label="تاریخ پیگیری مانده (شمسی)" value={due} onChange={setDue} optional /></div>
      <fieldset className="purchase-stock-choice"><legend>وضعیت ورود کالا به موجودی (الزامی)</legend><label><input type="radio" name="stock-mode" checked={stockMode === 'received'} onChange={() => setStockMode('received')} /> تعداد تحویل‌شده را هم‌زمان به انبار اضافه کن</label><label><input type="radio" name="stock-mode" checked={stockMode === 'purchase-only'} onChange={() => setStockMode('purchase-only')} /> فقط خرید ثبت شود؛ هنوز به موجودی اضافه نشود</label></fieldset>
      <button className="primary full" disabled={!supplier.trim() || rows.some(row => !row.productId) || !stockMode}>ثبت خرید</button>
    </form>
  </section>;
}
