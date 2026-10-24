import { useEffect, useMemo, useState } from 'react';
import { formatRial, parseRial, type Product } from '@majora/domain';
import { normalizeSearch, type ChequeEntry, type FinanceOverview, type InvoiceReceipt, type PaymentStatus, type ReturnLineInput, type ShopRepository } from '@majora/database';
import './finance-ui.css';

export const paymentLabels: Record<PaymentStatus, string> = {
  settled: 'تسویه‌شده', partial: 'دارای مانده', unpaid: 'تسویه‌نشده', proforma: 'پیش‌فاکتور'
};
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className={`payment-badge status-${status}`}>{paymentLabels[status]}</span>;
}
const latin = (value: string) => value.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632));
const moneyText = (value: string) => {
  const digits = latin(value).replace(/\D/g, '');
  return digits && Number.isSafeInteger(Number(digits)) ? formatRial(Number(digits)) : '';
};
const dateKey = (value: string) => latin(value).replace(/[^0-9/]/g, '').split('/').map(part => part.padStart(2, '0')).join('/');
const todayJalali = () => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const balance = (receipt: InvoiceReceipt) => Math.max(0, receipt.balanceRial ?? receipt.totalRial - (receipt.paidRial ?? 0));
const refundDue = (receipt: InvoiceReceipt) => Math.max(0, (receipt.paidRial ?? 0) - (receipt.totalRial - (receipt.returnedRial ?? 0)));

type FinanceProps = {
  repository: ShopRepository | null; overview: FinanceOverview; products: Product[];
  onRefresh: () => Promise<void>; onOpenInvoice: (receipt: InvoiceReceipt) => void;
  onReturn: (receipt: InvoiceReceipt) => void;
};

export function FinanceView({ repository, overview, products, onRefresh, onOpenInvoice, onReturn }: FinanceProps) {
  const [status, setStatus] = useState<PaymentStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [working, setWorking] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('کارت');
  const [paymentMode, setPaymentMode] = useState<'receive' | 'refund'>('receive');
  const [supplier, setSupplier] = useState(''); const [purchaseDue, setPurchaseDue] = useState(''); const [purchaseNote, setPurchaseNote] = useState('');
  const [purchasePaid, setPurchasePaid] = useState(''); const [purchaseProductSearch, setPurchaseProductSearch] = useState('');
  const [purchaseProduct, setPurchaseProduct] = useState(''); const [purchaseQuantity, setPurchaseQuantity] = useState('1');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [purchaseLines, setPurchaseLines] = useState<{ productId: string; name: string; quantity: number; unitCostRial: number }[]>([]);
  const [purchasePaymentId, setPurchasePaymentId] = useState(''); const [purchasePayment, setPurchasePayment] = useState('');
  const [expenseCategory, setExpenseCategory] = useState(''); const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState(''); const [expensePaid, setExpensePaid] = useState(true); const [expenseDue, setExpenseDue] = useState('');
  const [chequeDirection, setChequeDirection] = useState<ChequeEntry['direction']>('received'); const [chequeParty, setChequeParty] = useState('');
  const [chequeSerial, setChequeSerial] = useState(''); const [chequeBank, setChequeBank] = useState(''); const [chequeAmount, setChequeAmount] = useState('');
  const [chequeDue, setChequeDue] = useState(''); const [chequeNote, setChequeNote] = useState('');
  const today = dateKey(todayJalali());
  const visible = useMemo(() => overview.invoices.filter(receipt =>
    (status === 'all' || (receipt.paymentStatus ?? 'unpaid') === status) &&
    normalizeSearch(`${receipt.number} ${receipt.customerName} ${receipt.customerPhone ?? ''} ${receipt.dateJalali ?? ''}`).includes(normalizeSearch(latin(query)))
  ).sort((a, b) => b.at.localeCompare(a.at)), [overview.invoices, status, query]);
  const totals = useMemo(() => ({
    receivable: overview.invoices.filter(item => item.paymentStatus !== 'proforma').reduce((sum, item) => sum + balance(item), 0),
    received: overview.invoices.filter(item => item.paymentStatus !== 'proforma').reduce((sum, item) => sum + (item.paidRial ?? 0), 0),
    proforma: overview.invoices.filter(item => item.paymentStatus === 'proforma').reduce((sum, item) => sum + item.totalRial, 0),
    refund: overview.invoices.reduce((sum, item) => sum + refundDue(item), 0),
    payable: overview.purchases.reduce((sum, item) => sum + item.totalRial - item.paidRial, 0) + overview.expenses.filter(item => !item.settled).reduce((sum, item) => sum + item.amountRial, 0)
  }), [overview]);
  const dueCount = overview.invoices.filter(item => item.paymentStatus !== 'proforma' && balance(item) > 0 && item.dueDateJalali && dateKey(item.dueDateJalali) <= today).length +
    overview.purchases.filter(item => item.totalRial > item.paidRial && item.dueJalali && dateKey(item.dueJalali) <= today).length +
    overview.expenses.filter(item => !item.settled && item.dueJalali && dateKey(item.dueJalali) <= today).length +
    overview.cheques.filter(item => item.status === 'open' && dateKey(item.dueJalali) <= today).length;
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    if (!repository || working) return false;
    setWorking(true); setFeedback('');
    try { await action(); await onRefresh(); setFeedback(success); return true; }
    catch (error) { setFeedback((error as Error).message); return false; }
    finally { setWorking(false); }
  }
  async function submitPayment(receipt: InvoiceReceipt) {
    if (!repository) return;
    const done = await run(() => paymentMode === 'receive'
      ? repository.recordInvoicePayment(receipt.id, parseRial(paymentAmount), paymentMethod)
      : repository.refundInvoicePayment(receipt.id, parseRial(paymentAmount), paymentMethod), 'گردش وجه و مانده ثبت شد.');
    if (done) { setEditingInvoice(''); setPaymentAmount(''); }
  }
  function addPurchaseLine() {
    try {
      const product = products.find(item => item.id === purchaseProduct);
      const quantity = Number(latin(purchaseQuantity)); const unitCostRial = parseRial(purchaseCost);
      if (!product || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('کالا و تعداد خرید را درست انتخاب کنید.');
      setPurchaseLines(lines => [...lines, { productId: product.id, name: product.name, quantity, unitCostRial }]);
      setPurchaseProduct(''); setPurchaseCost(''); setPurchaseQuantity('1'); setPurchaseProductSearch(''); setFeedback('');
    } catch (error) { setFeedback((error as Error).message); }
  }
  async function submitPurchase() {
    if (!repository) return;
    const done = await run(() => repository.createPurchase(supplier, purchaseLines, purchasePaid ? parseRial(purchasePaid) : 0, purchaseDue, purchaseNote), 'خرید و افزایش موجودی ثبت شد.');
    if (done) { setPurchaseLines([]); setSupplier(''); setPurchasePaid(''); setPurchaseDue(''); setPurchaseNote(''); }
  }
  const matchedProducts = products.filter(item => normalizeSearch(`${item.name} ${item.model ?? ''} ${item.color ?? ''}`).includes(normalizeSearch(purchaseProductSearch))).slice(0, 25);
  return <div className="finance-page">
    <div className="section-heading"><div><span className="eyebrow">حساب‌های روزانه</span><h1>وضعیت پرداخت و حساب‌ها</h1></div></div>
    <p className="muted">همهٔ مبلغ‌ها ریال‌اند. دریافت وجه، خرید، هزینه و مرجوعی جدا ثبت می‌شوند تا ماندهٔ هر فاکتور روشن بماند.</p>
    {feedback && <p className="finance-feedback" role="status">{feedback}</p>}
    <div className="finance-metrics">
      <button onClick={() => setStatus('all')}><small>طلب مشتریان</small><strong>{formatRial(totals.receivable)}</strong><span>ریال</span></button>
      <button onClick={() => setStatus('settled')}><small>دریافت‌شده</small><strong>{formatRial(totals.received)}</strong><span>ریال</span></button>
      <button onClick={() => setStatus('proforma')}><small>پیش‌فاکتورها</small><strong>{formatRial(totals.proforma)}</strong><span>ریال</span></button>
      <div><small>بدهی خرید و هزینه</small><strong>{formatRial(totals.payable)}</strong><span>ریال</span></div>
      {totals.refund > 0 && <div className="warning"><small>بازپرداخت به مشتری</small><strong>{formatRial(totals.refund)}</strong><span>ریال</span></div>}
    </div>
    {dueCount > 0 && <div className="finance-reminder"><strong>{formatRial(dueCount)} مورد سررسیددار نیازمند رسیدگی</strong><span>تا ثبت پرداخت یا تعیین تکلیف، این یادآوری باقی می‌ماند.</span></div>}
    <section className="card finance-section"><div className="finance-section-head"><h2>فاکتورها و دریافت‌ها</h2><span>{formatRial(visible.length)} مورد</span></div>
      <div className="finance-filters"><label>جست‌وجوی نام، شماره یا تاریخ<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label><label>وضعیت<select value={status} onChange={event => setStatus(event.target.value as PaymentStatus | 'all')}><option value="all">همه</option>{(Object.keys(paymentLabels) as PaymentStatus[]).map(key => <option key={key} value={key}>{paymentLabels[key]}</option>)}</select></label></div>
      <div className="finance-list">{visible.map(item => {
        const remainder = balance(item); const refund = refundDue(item); const current = editingInvoice === item.id;
        return <article className="finance-row" key={item.id}><div className="finance-row-top"><strong>فاکتور {formatRial(item.number)} · {item.customerName || 'خریدار حضوری'}</strong><PaymentBadge status={item.paymentStatus ?? 'unpaid'}/></div>
          <small>{item.dateJalali || new Date(item.at).toLocaleDateString('fa-IR-u-ca-persian')} · مبلغ {formatRial(item.totalRial - (item.returnedRial ?? 0))} ریال · مانده {formatRial(remainder)} ریال</small>
          {item.dueDateJalali && remainder > 0 && <small className={dateKey(item.dueDateJalali) <= today ? 'overdue' : ''}>سررسید: {item.dueDateJalali}</small>}
          {refund > 0 && <small className="overdue">طلب مشتری برای بازپرداخت: {formatRial(refund)} ریال</small>}
          <div className="finance-actions"><button onClick={() => onOpenInvoice(item)}>مشاهده</button>{item.customerPhone && <a href={`tel:${latin(item.customerPhone).replace(/[^0-9+]/g, '')}`}>تماس با {item.customerName || 'مشتری'}</a>}
            {item.paymentStatus === 'proforma' ? <button disabled={working} onClick={() => run(() => repository!.convertProforma(item.id), 'پیش‌فاکتور به فروش قطعی تبدیل شد.')}>تبدیل به فروش</button> : <>
              {remainder > 0 && <><button disabled={working} onClick={() => run(() => repository!.recordInvoicePayment(item.id, remainder, 'کارت'), 'فاکتور تسویه شد.')}>تسویه کامل</button><button onClick={() => { setEditingInvoice(item.id); setPaymentMode('receive'); setPaymentAmount(''); }}>دریافت بخشی</button></>}
              {refund > 0 && <button onClick={() => { setEditingInvoice(item.id); setPaymentMode('refund'); setPaymentAmount(''); }}>ثبت بازپرداخت</button>}
              <button onClick={() => onReturn(item)}>مرجوعی</button>
            </>}</div>
          {current && <div className="finance-inline"><label>مبلغ {paymentMode === 'receive' ? 'دریافت' : 'بازپرداخت'} (ریال)<input inputMode="numeric" value={paymentAmount} onChange={event => setPaymentAmount(moneyText(event.target.value))}/></label><label>روش<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}><option>کارت</option><option>نقد</option><option>واریز</option><option>سایر</option></select></label><button className="primary" disabled={working || !paymentAmount} onClick={() => void submitPayment(item)}>ثبت</button><button onClick={() => setEditingInvoice('')}>انصراف</button></div>}
        </article>;
      })}{!visible.length && <p className="empty">فاکتوری با این فیلتر پیدا نشد.</p>}</div>
    </section>
    <details className="card finance-section"><summary>خرید کالا و بدهی تأمین‌کنندگان ({formatRial(overview.purchases.length)})</summary>
      <div className="finance-list">{overview.purchases.map(item => <article className="finance-row" key={item.id}><strong>{item.supplier}</strong><small>{new Date(item.createdAt).toLocaleDateString('fa-IR-u-ca-persian')} · کل {formatRial(item.totalRial)} · مانده {formatRial(item.totalRial - item.paidRial)} ریال</small>{item.dueJalali && item.totalRial > item.paidRial && <small className={dateKey(item.dueJalali) <= today ? 'overdue' : ''}>سررسید {item.dueJalali}</small>}{item.totalRial > item.paidRial && <button onClick={() => { setPurchasePaymentId(item.id); setPurchasePayment(''); }}>ثبت پرداخت خرید</button>}{purchasePaymentId === item.id && <div className="finance-inline"><label>مبلغ (ریال)<input inputMode="numeric" value={purchasePayment} onChange={event => setPurchasePayment(moneyText(event.target.value))}/></label><button disabled={!purchasePayment || working} onClick={() => { void run(() => repository!.recordPurchasePayment(item.id, parseRial(purchasePayment), 'کارت'), 'پرداخت خرید ثبت شد.'); setPurchasePaymentId(''); }}>ثبت</button></div>}</article>)}</div>
      <div className="finance-form"><h3>ثبت خرید تازه</h3><label>تأمین‌کننده<input value={supplier} onChange={event => setSupplier(event.target.value)}/></label><label>جست‌وجوی کالای موجود<input type="search" value={purchaseProductSearch} onChange={event => setPurchaseProductSearch(event.target.value)}/></label><div className="finance-product-options">{matchedProducts.map(item => <button className={purchaseProduct === item.id ? 'selected' : ''} key={item.id} onClick={() => { setPurchaseProduct(item.id); setPurchaseProductSearch(item.name); }}>{item.name} · {item.model}</button>)}</div><div className="finance-inline"><label>تعداد<input inputMode="numeric" value={purchaseQuantity} onChange={event => setPurchaseQuantity(latin(event.target.value).replace(/\D/g, ''))}/></label><label>فی خرید (ریال)<input inputMode="numeric" value={purchaseCost} onChange={event => setPurchaseCost(moneyText(event.target.value))}/></label><button onClick={addPurchaseLine}>افزودن کالا</button></div>
        {purchaseLines.map((line, index) => <div className="finance-row" key={index}>{line.name} · {formatRial(line.quantity)} × {formatRial(line.unitCostRial)} <button onClick={() => setPurchaseLines(lines => lines.filter((_, i) => i !== index))}>حذف ردیف</button></div>)}
        <strong>جمع خرید: {formatRial(purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitCostRial, 0))} ریال</strong><label>پرداخت اکنون (ریال)<input inputMode="numeric" value={purchasePaid} onChange={event => setPurchasePaid(moneyText(event.target.value))}/></label><label>سررسید مانده<input value={purchaseDue} onChange={event => setPurchaseDue(event.target.value)} placeholder="۱۴۰۵/۰۸/۳۰"/></label><label>یادداشت<input value={purchaseNote} onChange={event => setPurchaseNote(event.target.value)}/></label><button className="primary" disabled={!purchaseLines.length || !supplier.trim() || working} onClick={() => void submitPurchase()}>ثبت خرید و افزودن موجودی</button></div>
    </details>
    <details className="card finance-section"><summary>هزینه‌ها ({formatRial(overview.expenses.length)})</summary><div className="finance-list">{overview.expenses.map(item => <article className="finance-row" key={item.id}><strong>{item.category} · {item.description}</strong><small>{formatRial(item.amountRial)} ریال · {item.settled ? 'پرداخت‌شده' : 'در انتظار پرداخت'} {item.dueJalali && `· سررسید ${item.dueJalali}`}</small>{!item.settled && <button disabled={working} onClick={() => void run(() => repository!.settleExpense(item.id), 'هزینه پرداخت شد.')}>ثبت پرداخت</button>}</article>)}</div><div className="finance-form"><h3>هزینهٔ تازه</h3><label>دسته<input value={expenseCategory} onChange={event => setExpenseCategory(event.target.value)} placeholder="اجاره، ارسال، بسته‌بندی…"/></label><label>شرح<input value={expenseDescription} onChange={event => setExpenseDescription(event.target.value)}/></label><label>مبلغ (ریال)<input inputMode="numeric" value={expenseAmount} onChange={event => setExpenseAmount(moneyText(event.target.value))}/></label><label className="toggle-row">پرداخت شده<input type="checkbox" checked={expensePaid} onChange={event => setExpensePaid(event.target.checked)}/></label>{!expensePaid && <label>سررسید<input value={expenseDue} onChange={event => setExpenseDue(event.target.value)} placeholder="۱۴۰۵/۰۸/۳۰"/></label>}<button className="primary" disabled={!expenseAmount || working} onClick={() => void run(async () => { await repository!.createExpense(expenseCategory, expenseDescription, parseRial(expenseAmount), expensePaid, expenseDue); setExpenseCategory(''); setExpenseDescription(''); setExpenseAmount(''); }, 'هزینه ثبت شد.')}>ثبت هزینه</button></div></details>
    <details className="card finance-section"><summary>چک‌های دریافتی و پرداختی ({formatRial(overview.cheques.length)})</summary><div className="finance-list">{overview.cheques.map(item => <article className="finance-row" key={item.id}><strong>{item.direction === 'received' ? 'دریافتی' : 'پرداختی'} · {item.party} · {item.serial}</strong><small>{formatRial(item.amountRial)} ریال · سررسید {item.dueJalali} · {item.status === 'open' ? 'باز' : item.status === 'cleared' ? 'وصول‌شده' : item.status === 'returned' ? 'برگشتی' : 'باطل‌شده'}</small>{item.status === 'open' && <div className="finance-actions"><button disabled={working} onClick={() => void run(() => repository!.setChequeStatus(item.id, 'cleared'), 'وضعیت چک ثبت شد.')}>وصول شد</button><button disabled={working} onClick={() => void run(() => repository!.setChequeStatus(item.id, 'returned'), 'چک برگشتی ثبت شد.')}>برگشت خورد</button><button disabled={working} onClick={() => void run(() => repository!.setChequeStatus(item.id, 'cancelled'), 'چک باطل شد.')}>ابطال</button></div>}</article>)}</div><div className="finance-form"><h3>ثبت چک</h3><label>نوع<select value={chequeDirection} onChange={event => setChequeDirection(event.target.value as ChequeEntry['direction'])}><option value="received">دریافتی</option><option value="issued">پرداختی</option></select></label><label>طرف حساب<input value={chequeParty} onChange={event => setChequeParty(event.target.value)}/></label><label>شماره چک<input value={chequeSerial} onChange={event => setChequeSerial(event.target.value)}/></label><label>بانک<input value={chequeBank} onChange={event => setChequeBank(event.target.value)}/></label><label>مبلغ (ریال)<input inputMode="numeric" value={chequeAmount} onChange={event => setChequeAmount(moneyText(event.target.value))}/></label><label>تاریخ سررسید شمسی<input value={chequeDue} onChange={event => setChequeDue(event.target.value)} placeholder="۱۴۰۵/۰۸/۳۰"/></label><label>یادداشت<input value={chequeNote} onChange={event => setChequeNote(event.target.value)}/></label><button className="primary" disabled={!chequeAmount || working} onClick={() => void run(async () => { await repository!.createCheque({ direction: chequeDirection, party: chequeParty, serial: chequeSerial, bank: chequeBank, amountRial: parseRial(chequeAmount), dueJalali: chequeDue, note: chequeNote }); setChequeParty(''); setChequeSerial(''); setChequeAmount(''); setChequeDue(''); setChequeNote(''); }, 'چک و یادآوری سررسید ثبت شد.')}>ثبت چک</button></div></details>
  </div>;
}

type ReturnsProps = { repository: ShopRepository | null; invoices: InvoiceReceipt[]; initialId: string; onRefresh: () => Promise<void>; onOpenInvoice: (receipt: InvoiceReceipt) => void };
export function ReturnsView({ repository, invoices, initialId, onRefresh, onOpenInvoice }: ReturnsProps) {
  const [invoiceId, setInvoiceId] = useState(initialId);
  const [query, setQuery] = useState(''); const [available, setAvailable] = useState<{ index: number; name: string; sold: number; returned: number; available: number }[]>([]);
  const [selection, setSelection] = useState<Record<number, { quantity: number; restock: boolean; partial: boolean }>>({});
  const [includeShipping, setIncludeShipping] = useState(false); const [reason, setReason] = useState('');
  const [history, setHistory] = useState<Awaited<ReturnType<ShopRepository['listSalesReturns']>>>([]);
  const [message, setMessage] = useState(''); const [working, setWorking] = useState(false);
  const selected = invoices.find(item => item.id === invoiceId);
  useEffect(() => { setInvoiceId(initialId); }, [initialId]);
  useEffect(() => {
    if (!repository) return;
    void repository.listSalesReturns().then(setHistory).catch(error => setMessage((error as Error).message));
  }, [repository, invoices]);
  useEffect(() => {
    setSelection({}); setIncludeShipping(false);
    if (!repository || !invoiceId) { setAvailable([]); return; }
    void repository.listReturnableLines(invoiceId).then(setAvailable).catch(error => setMessage((error as Error).message));
  }, [repository, invoiceId]);
  async function submit() {
    if (!repository || !selected || working) return;
    const lines: ReturnLineInput[] = Object.entries(selection).map(([index, value]) => ({ index: Number(index), quantity: value.quantity, restock: value.restock }));
    if (!lines.length || !reason.trim()) { setMessage('ردیف‌های مرجوعی و دلیل را وارد کنید.'); return; }
    if (!window.confirm(`مرجوعی ${lines.length} ردیف از فاکتور ${selected.number} ثبت شود؟ موجودیِ اقلام سالم به انبار برمی‌گردد.`)) return;
    setWorking(true);
    try { const result = await repository.returnInvoice(invoiceId, lines, reason, includeShipping); await onRefresh();
      setAvailable(await repository.listReturnableLines(invoiceId)); setHistory(await repository.listSalesReturns()); setSelection({}); setReason(''); setIncludeShipping(false);
      setMessage(`${formatRial(result.returnedRial)} ریال مرجوع شد؛ ماندهٔ مالی فاکتور به‌روز شد.`);
    } catch (error) { setMessage((error as Error).message); }
    finally { setWorking(false); }
  }
  return <div className="finance-page"><div className="section-heading"><div><span className="eyebrow">پس از فروش</span><h1>مرجوعی‌ها</h1></div></div><p className="muted">مرجوعی به فاکتور اصلی وصل می‌ماند. کالای سالم را به موجودی برگردانید؛ برای کالای معیوب این گزینه را خاموش کنید.</p>
    {message && <p className="finance-feedback" role="status">{message}</p>}
    <section className="card finance-section"><h2>ثبت مرجوعی تازه</h2><label>پیدا کردن فاکتور<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="شماره، نام یا تلفن مشتری"/></label><div className="finance-picker">{invoices.filter(item => item.paymentStatus !== 'proforma' && normalizeSearch(`${item.number} ${item.customerName} ${item.customerPhone ?? ''}`).includes(normalizeSearch(latin(query)))).slice(0, 25).map(item => <button key={item.id} className={invoiceId === item.id ? 'selected' : ''} onClick={() => setInvoiceId(item.id)}>فاکتور {formatRial(item.number)} · {item.customerName || 'خریدار حضوری'} <PaymentBadge status={item.paymentStatus ?? 'unpaid'}/></button>)}</div>
      {selected && <><div className="finance-section-head"><h3>فاکتور {formatRial(selected.number)}</h3><button onClick={() => onOpenInvoice(selected)}>مشاهدهٔ اصل فاکتور</button></div><div className="return-lines">{available.map(item => {
        const value = selection[item.index];
        return <div className="return-line" key={item.index}><label className="toggle-row"><span>{item.name} · قابل مرجوع {formatRial(item.available)} از {formatRial(item.sold)}</span><input type="checkbox" checked={!!value} disabled={item.available <= 0} onChange={event => setSelection(current => { const next = { ...current }; if (event.target.checked) next[item.index] = { quantity: item.available, restock: true, partial: false }; else delete next[item.index]; return next; })}/></label>{value && <div className="finance-inline"><label className="toggle-row">مرجوعی تعدادی<input type="checkbox" checked={value.partial} onChange={event => setSelection(current => ({ ...current, [item.index]: { ...value, partial: event.target.checked, quantity: event.target.checked ? Math.min(value.quantity, item.available) : item.available } }))}/></label>{value.partial && <div className="quantity-stepper"><button onClick={() => setSelection(current => ({ ...current, [item.index]: { ...value, quantity: Math.max(1, value.quantity - 1) } }))}>−</button><input inputMode="numeric" value={value.quantity} onChange={event => { const quantity = Number(latin(event.target.value)); if (Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= item.available) setSelection(current => ({ ...current, [item.index]: { ...value, quantity } })); }}/><button onClick={() => setSelection(current => ({ ...current, [item.index]: { ...value, quantity: Math.min(item.available, value.quantity + 1) } }))}>+</button></div>}<label className="toggle-row">بازگشت به موجودی<input type="checkbox" checked={value.restock} onChange={event => setSelection(current => ({ ...current, [item.index]: { ...value, restock: event.target.checked } }))}/></label></div>}</div>;
      })}</div><div className="finance-actions"><button onClick={() => { setSelection(Object.fromEntries(available.filter(item => item.available > 0).map(item => [item.index, { quantity: item.available, restock: true, partial: false }] ))); setIncludeShipping(true); }}>مرجوع کل باقی‌ماندهٔ فاکتور</button><button onClick={() => { setSelection({}); setIncludeShipping(false); }}>پاک کردن انتخاب</button></div><label className="toggle-row">مرجوعی هزینهٔ ارسال<input type="checkbox" checked={includeShipping} onChange={event => setIncludeShipping(event.target.checked)}/></label><label>دلیل مرجوعی<input value={reason} onChange={event => setReason(event.target.value)} placeholder="مثلاً تعویض رنگ یا ایراد کالا"/></label><button className="primary" disabled={working || !Object.keys(selection).length || !reason.trim()} onClick={() => void submit()}>ثبت قطعی مرجوعی</button></>}
    </section><section className="card finance-section"><h2>سوابق مرجوعی</h2><div className="finance-list">{history.map(item => <article className="finance-row" key={item.id}><strong>فاکتور {formatRial(item.invoiceNumber)} · {item.customer || 'خریدار حضوری'}</strong><small>{new Date(item.at).toLocaleDateString('fa-IR-u-ca-persian')} · {formatRial(item.amountRial)} ریال · {item.reason}</small></article>)}{!history.length && <p className="empty">مرجوعی ثبت نشده است.</p>}</div></section>
  </div>;
}
