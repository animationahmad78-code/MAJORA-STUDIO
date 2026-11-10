import { useEffect, useRef, useState } from 'react';
import { api, rial, type CustomerWithStatus, type Product } from './api';
import { PaymentBadge } from './payment-badge';
import { JalaliDateField, jalaliToIsoDate } from '../../mobile/src/jalali-date';
import { discountedLineRial, percentThousandths, rialDigits } from './invoice-quote';
import { blankCheque, ChequeFields, chequePayload, type ChequeDraft } from './cheques';
import './sale.css';

type Stage = 'customer' | 'products' | 'review';
type CartLine = { product: Product; quantity: number; manual?: boolean };
type ProductMeta = { categories: string[] };

export function SaleWorkspace({ onDone }: { onDone: (invoiceId: string) => void }) {
  const [stage, setStage] = useState<Stage>('customer');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerWithStatus[]>([]);
  const [customer, setCustomer] = useState<CustomerWithStatus | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualQuantity, setManualQuantity] = useState('1');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [cheque, setCheque] = useState<ChequeDraft>(blankCheque);
  const [paid, setPaid] = useState('');
  const [due, setDue] = useState('');
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountPercent, setDiscountPercent] = useState('0');
  const [discountScope, setDiscountScope] = useState<'all' | 'selected'>('all');
  const [discountProducts, setDiscountProducts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    const timer = window.setTimeout(() => { void api<CustomerWithStatus[]>(`/merchant/customers/with-status?q=${encodeURIComponent(customerQuery)}`).then(setCustomers).catch(() => setCustomers([])); }, 180);
    return () => window.clearTimeout(timer);
  }, [customerQuery]);
  useEffect(() => { void api<ProductMeta>('/merchant/products/meta').then(x => setCategories(x.categories)).catch(() => {}); }, []);
  useEffect(() => {
    if (stage !== 'products') return;
    let active = true;
    void api<Product[]>(`/merchant/products?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}&page=${page}`)
      .then(x => { if (active) setItems(x); }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'کالاها دریافت نشدند.'); });
    return () => { active = false; };
  }, [stage, query, category, page]);
  const selected = Object.values(cart).filter(x => x.quantity > 0);
  const discountBasis = percentThousandths(discountPercent);
  const lineBasis = (productId: string) => discountEnabled && discountBasis !== null && (discountScope === 'all' || discountProducts.includes(productId)) ? discountBasis : 0;
  const lineTotal = (line: CartLine) => discountedLineRial(line.product.priceRial, line.quantity, lineBasis(line.product.id));
  const subtotal = selected.reduce((sum, x) => sum + x.quantity * x.product.priceRial, 0);
  const total = selected.reduce((sum, x) => sum + lineTotal(x), 0);
  const discountRial = subtotal - total;
  const count = selected.reduce((sum, x) => sum + x.quantity, 0);
  const quantity = (product: Product, next: number) => {
    if (!Number.isSafeInteger(next) || next < 0) return;
    if (!Number.isSafeInteger(product.priceRial * next)) { setError('مبلغ این ردیف از حد محاسبهٔ دقیق مرورگر فراتر است.'); return; }
    setCart(previous => {
      const updated = { ...previous };
      if (next === 0) delete updated[product.id];
      else updated[product.id] = { product, quantity: Math.min(next, product.stock), manual: previous[product.id]?.manual };
      return updated;
    });
  };
  const addManual = () => {
    const price = Number(manualPrice);
    const count = Number(manualQuantity);
    if (!manualName.trim() || manualName.trim().length > 200 || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(count) || count < 1 || count > 1_000_000 || !Number.isSafeInteger(price * count)) {
      setError('نام، قیمت ریالی و تعداد قلم دستی را درست وارد کنید.'); return;
    }
    const id = `manual-${crypto.randomUUID()}`;
    const product: Product = { id, name: manualName.trim(), sku: '', category: 'قلم دستی', priceRial: price, averageCostRial: 0, costKnown: false, stock: 1_000_000, hasPhoto: false, updatedAt: '' };
    setCart(previous => ({ ...previous, [id]: { product, quantity: count, manual: true } }));
    setManualName(''); setManualPrice(''); setManualQuantity('1'); setError('');
  };
  const issue = async () => {
    if (!paymentStatus || !selected.length || busy) return;
    if (discountEnabled && (discountBasis === null || (discountScope === 'selected' && !discountProducts.some(id => selected.some(line => line.product.id === id))))) { setError('درصد و کالاهای مشمول تخفیف را مشخص کنید.'); return; }
    const paidRial = paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Number(paid) : 0;
    if (paymentStatus === 'partial' && (!Number.isSafeInteger(paidRial) || paidRial < 1 || paidRial >= total)) { setError('پیش‌پرداخت باید بیشتر از صفر و کمتر از جمع فاکتور باشد.'); return; }
    const dueIso = due ? jalaliToIsoDate(due) : null;
    if (due && !dueIso) { setError('تاریخ پیگیری شمسی را کامل و معتبر وارد کنید.'); return; }
    let chequeData: ReturnType<typeof chequePayload> | null = null;
    try { if (paymentStatus === 'cheque') chequeData = chequePayload(cheque, total); }
    catch (e) { setError(e instanceof Error ? e.message : 'مشخصات چک نامعتبر است.'); return; }
    setBusy(true); setError('');
    try {
      const created = await api<{ id: string }>('/merchant/invoices', 'POST', {
        idempotencyKey: requestKey.current, customerId: customer?.id ?? null,
        customerName: customer ? '' : customerName.trim(), customerPhone: customer ? '' : customerPhone.trim(),
        paymentStatus, paidRial, dueAt: dueIso ? new Date(`${dueIso}T12:00:00`).toISOString() : null,
        cheque: chequeData,
        expectedTotalRial: total,
        lines: selected.map(x => x.manual
          ? { productId: null, name: x.product.name, unitPriceRial: x.product.priceRial, quantity: x.quantity, discountPercent: lineBasis(x.product.id) / 1000 }
          : { productId: x.product.id, quantity: x.quantity, expectedUnitPriceRial: x.product.priceRial, discountPercent: lineBasis(x.product.id) / 1000 }),
      });
      requestKey.current = crypto.randomUUID();
      onDone(created.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'فاکتور ثبت نشد.'); }
    finally { setBusy(false); }
  };
  return <><div className="page-intro"><h2>فروش جدید</h2><p>مشتری، کالاها و پرداخت را مرحله به مرحله ثبت کنید.</p></div>
    <div className="sale-steps" aria-label="مراحل فروش"><span className={stage === 'customer' ? 'active' : ''}>۱ · مشتری</span><span className={stage === 'products' ? 'active' : ''}>۲ · کالاها</span><span className={stage === 'review' ? 'active' : ''}>۳ · بررسی و ثبت</span></div>
    {error && <div className="field-error sale-error" role="alert">{error}</div>}
    {stage === 'customer' && <div className="two-col"><section className="card"><h2>مشتری قبلی</h2><label>جست‌وجوی نام یا شماره<input value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} placeholder="نام یا شمارهٔ تماس"/></label><div className="sale-customer-list">{customers.map(x => <button key={x.id} className={customer?.id === x.id ? 'chosen' : ''} onClick={() => { setCustomer(x); setCustomerName(''); setCustomerPhone(''); }}><strong>{x.name}</strong><PaymentBadge status={x.status}/><small dir="ltr">{x.phone}</small></button>)}</div>{customer && <p className="sale-choice">انتخاب‌شده: {customer.name} <PaymentBadge status={customer.status}/>{customer.receivableRial > 0 && <> · ماندهٔ فعلی: {rial(customer.receivableRial)}</>}</p>}</section>
      <section className="card"><h2>مشتری جدید</h2><p className="hint">اگر مشتری قبلی را انتخاب نکردید، نام مشتری تازه را وارد کنید؛ همراه فاکتور به باشگاه مشتریان افزوده می‌شود.</p><label>نام و نام خانوادگی<input value={customerName} onChange={e => { setCustomerName(e.target.value); setCustomer(null); }} maxLength={200}/></label><label>شمارهٔ تماس<input value={customerPhone} onChange={e => { setCustomerPhone(e.target.value); setCustomer(null); }} inputMode="tel" dir="ltr" maxLength={30}/></label><button className="primary full" disabled={!customer && !customerName.trim()} onClick={() => { setError(''); setStage('products'); }}>ادامه به انتخاب کالا</button></section></div>}
    {stage === 'products' && <div className="sale-layout"><section className="card"><div className="card-head"><h2>انتخاب کالا</h2></div><div className="price-filters"><label>جست‌وجوی نام یا کد<input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="نام یا کد کالا"/></label><label>دسته<select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="">همهٔ دسته‌ها</option>{categories.filter(Boolean).map(x => <option key={x} value={x}>{x}</option>)}</select></label></div>
      {items.length ? <div className="product-grid sale-product-grid">{items.map(p => <article className="product-tile" key={p.id}><div className="tile-icon">{p.hasPhoto ? <img loading="lazy" src={`/api/merchant/products/${p.id}/photo?v=${encodeURIComponent(p.updatedAt)}`} alt={`تصویر ${p.name}`}/> : <span>بدون عکس</span>}</div><strong>{p.name}</strong><small>{p.category || 'بدون دسته'} · موجودی {p.stock}</small><b>{rial(p.priceRial)}</b><div className="quantity"><button aria-label={`کم کردن ${p.name}`} disabled={!cart[p.id]} onClick={() => quantity(p, (cart[p.id]?.quantity ?? 0) - 1)}>−</button><input aria-label={`تعداد ${p.name}`} type="number" inputMode="numeric" min="0" max={p.stock} value={cart[p.id]?.quantity ?? 0} onChange={e => quantity(p, Number(e.target.value))}/><button aria-label={`افزودن ${p.name}`} disabled={(cart[p.id]?.quantity ?? 0) >= p.stock} onClick={() => quantity(p, (cart[p.id]?.quantity ?? 0) + 1)}>＋</button></div></article>)}</div> : <div className="empty">کالایی با این جست‌وجو پیدا نشد.</div>}
      <div className="price-pager"><button disabled={page === 1} onClick={() => setPage(page - 1)}>صفحهٔ قبل</button><span>صفحهٔ {page}</span><button disabled={items.length < 50} onClick={() => setPage(page + 1)}>صفحهٔ بعد</button></div>
      <details className="sale-manual"><summary>＋ افزودن قلم دستی بدون ثبت در کالاها</summary><div className="sale-manual-fields"><label>نام قلم<input value={manualName} maxLength={200} onChange={e => setManualName(e.target.value)} placeholder="نام کالا یا خدمت"/></label><label>قیمت هر واحد (ریال)<input inputMode="numeric" dir="ltr" value={manualPrice ? BigInt(manualPrice).toLocaleString('en-US') : ''} onChange={e => setManualPrice(rialDigits(e.target.value))} placeholder="0"/></label><label>تعداد<input inputMode="numeric" type="number" min="1" max="1000000" value={manualQuantity} onChange={e => setManualQuantity(e.target.value)}/></label><button className="primary" onClick={addManual}>افزودن به سبد</button></div><small>قلم دستی در فهرست کالا و موجودی انبار ثبت یا کسر نمی‌شود.</small></details></section>
      <section className="card sale-cart"><h2>سبد فاکتور</h2>{selected.length ? <div className="receipt sale-cart-lines">{selected.map(x => <div className="sale-cart-line" key={x.product.id}><span>{x.product.name}{x.manual ? ' · دستی' : ''}</span><div className="quantity"><button aria-label={`کم کردن ${x.product.name}`} onClick={() => quantity(x.product, x.quantity - 1)}>−</button><input aria-label={`تعداد سبد ${x.product.name}`} type="number" inputMode="numeric" min="0" max={x.product.stock} value={x.quantity} onChange={e => quantity(x.product, Number(e.target.value))}/><button aria-label={`افزودن ${x.product.name}`} disabled={x.quantity >= x.product.stock} onClick={() => quantity(x.product, x.quantity + 1)}>＋</button></div><b>{rial(x.product.priceRial * x.quantity)}</b></div>)}</div> : <div className="empty">هنوز کالایی انتخاب نشده است.</div>}<p className="receipt-total">{count} عدد · {rial(total)}</p><div className="form-actions"><button onClick={() => setStage('customer')}>بازگشت</button><button className="primary" disabled={!selected.length} onClick={() => { setError(''); setStage('review'); }}>بررسی فاکتور</button></div></section></div>}
    {stage === 'review' && <section className="card sale-review"><h2>بررسی نهایی</h2><p><strong>مشتری:</strong> {customer?.name ?? customerName} {customer && <PaymentBadge status={customer.status}/>} · {customer?.phone ?? customerPhone}</p><div className="receipt">{selected.map(x => <div key={x.product.id}><span>{x.product.name} × {x.quantity}</span><b>{rial(lineTotal(x))}</b></div>)}</div>
      <div className="sale-discount"><label className="sale-discount-toggle"><input type="checkbox" checked={discountEnabled} onChange={e => setDiscountEnabled(e.target.checked)}/> اعمال تخفیف در همین فاکتور</label>{discountEnabled && <><div className="sale-discount-controls"><label>درصد تخفیف<input type="text" inputMode="decimal" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} placeholder="مثلاً ۱۰ یا ۲٫۵"/></label><label>روی کالاها<select value={discountScope} onChange={e => setDiscountScope(e.target.value as 'all' | 'selected')}><option value="all">همهٔ اقلام</option><option value="selected">اقلام انتخابی</option></select></label></div>{discountBasis === null && <small className="field-error">درصد بین ۰ تا ۱۰۰ با حداکثر سه رقم اعشار وارد کنید.</small>}{discountScope === 'selected' && <div className="sale-discount-items">{selected.map(x => <label key={x.product.id}><input type="checkbox" checked={discountProducts.includes(x.product.id)} onChange={e => setDiscountProducts(previous => e.target.checked ? [...previous, x.product.id] : previous.filter(id => id !== x.product.id))}/>{x.product.name}</label>)}</div>}</>}</div>
      <p className="receipt-total">{discountEnabled && <><span>جمع پیش از تخفیف: {rial(subtotal)}</span><span>تخفیف: {rial(discountRial)}</span></>}<strong>مبلغ نهایی: {rial(total)}</strong></p>
      <label>وضعیت پرداخت<select value={paymentStatus} onChange={e => { setPaymentStatus(e.target.value); setPaid(''); if (e.target.value === 'cheque') setCheque(blankCheque(customer?.name ?? customerName)); }} required><option value="">انتخاب وضعیت الزامی است</option><option value="paid">تسویه کامل</option><option value="partial">پیش‌پرداخت داده شد</option><option value="unpaid">تسویه نشده</option><option value="cheque">چکی · در انتظار وصول</option><option value="proforma">پیش‌فاکتور</option></select></label>
      {paymentStatus === 'partial' && <label>مبلغ پیش‌پرداخت (ریال)<input type="number" inputMode="numeric" min="1" max={total - 1} value={paid} onChange={e => setPaid(e.target.value)}/></label>}
      {paymentStatus === 'cheque' && <ChequeFields draft={cheque} setDraft={setCheque}/>}
      {(paymentStatus === 'partial' || paymentStatus === 'unpaid') && <JalaliDateField label="تاریخ پیگیری مانده (شمسی)" value={due} onChange={setDue} optional/>}
      <p className="hint">قیمت و موجودی هنگام ثبت دوباره در سرور بررسی می‌شوند. شمارهٔ فاکتور در ثبت نهایی تخصیص می‌یابد.</p><div className="form-actions"><button disabled={busy} onClick={() => setStage('products')}>بازگشت به کالاها</button><button className="primary" disabled={busy || !paymentStatus} onClick={() => void issue()}>{busy ? 'در حال ثبت فاکتور…' : 'ثبت نهایی فاکتور'}</button></div></section>}
  </>;
}
