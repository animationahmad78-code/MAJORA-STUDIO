import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPriceIncrease, formatRial, parseRial, undoPriceBatch, type PriceBatch, type PriceEvent, type Product } from '@majora/domain';
import { normalizeSearch, type InvoiceReceipt, type ShopRepository } from '@majora/database';
import { nativeDevice, openNativeShop } from './native-db';
import './style.css';
const majoraLogo = '/brand/majora-logo.png';
const storeLogo = '/brand/store-logo.png';

type Page = 'home' | 'products' | 'prices' | 'invoice' | 'settings' | 'support';
type Data = { products: Product[]; batches: PriceBatch[]; events: PriceEvent[]; storeName: string; slogan: string; phone: string; address: string; card: string; cardHolder: string; note: string; conditions: string[] };
const defaults: Data = {
  products: [], batches: [], events: [], storeName: 'کیف و کمربند کلاسیک', slogan: 'استایل کامل از کیف و کمربند',
  phone: '051-33662794  |  051-33662795  |  0910-500-3669',
  address: 'مشهد، بلوار مصلی، بازار مولوی، فاز یک، طبقه فوقانی، پلاک ۱۴۰ و ۱۴۱',
  card: '6219861034642404', cardHolder: 'رضا ابراهیم‌زاده',
  note: 'حتماً فیش واریزی را به شماره همراه فوق در پیامک و یا فضای مجازی ارسال بفرمایید.',
  conditions: [
    'اجناس فوق صحیح و سالم به خریدار تحویل گردید. این فاکتور سند بدهی خریدار بوده و تا تسویه کامل، اجناس نزد وی شرعاً و قانوناً امانت محسوب می‌شود.',
    'خریدار موظف است تعداد، مدل، رنگ و مشخصات کالاهای دریافتی را با فاکتور تطبیق داده و هرگونه مغایرت ظاهری را در اولین فرصت به فروشنده اطلاع دهد.',
    'کالاهای دارای ایراد تولید یا مغایرت با سفارش، پس از بررسی و تأیید، مطابق توافق و مقررات مربوط تعیین تکلیف می‌شوند.',
    'هزینه ارسال و مسئولیت حمل کالا طبق توافق طرفین و روش ارسال درج‌شده در فاکتور تعیین می‌شود.',
    'در فروش اعتباری، خریدار موظف است مانده بدهی را در تاریخ سررسید مندرج در فاکتور تسویه نماید.',
    'قیمت‌ها و تخفیفات این فاکتور مختص همین معامله بوده و شامل سفارش‌های آینده نمی‌شوند.'
  ]
};
const latinDigits = (value: string) => value.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632));
const formatPercent = (basisPoints: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(basisPoints / 100);
function load(): Data { if (nativeDevice) return defaults; try { const stored = localStorage.getItem('majora-prototype-v1'); return stored ? { ...defaults, ...JSON.parse(stored) } : defaults; } catch { return defaults; } }
function templateFields(data: Data): Record<string, string> {
  return { storeName: data.storeName, slogan: data.slogan, phone: data.phone, address: data.address, card: data.card,
    cardHolder: data.cardHolder, note: data.note, ...Object.fromEntries(data.conditions.map((condition, index) => [`condition${index + 1}`, condition])) };
}
function applyTemplate(data: Data, fields: Record<string, string>): Data {
  return { ...data, storeName: fields.storeName ?? data.storeName, slogan: fields.slogan ?? data.slogan,
    phone: fields.phone ?? data.phone, address: fields.address ?? data.address, card: fields.card ?? data.card,
    cardHolder: fields.cardHolder ?? data.cardHolder, note: fields.note ?? data.note,
    conditions: data.conditions.map((condition, index) => fields[`condition${index + 1}`] ?? condition) };
}
function App() {
  const [data, setData] = useState<Data>(load);
  const [repository, setRepository] = useState<ShopRepository | null>(null);
  const [startupError, setStartupError] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [price, setPrice] = useState(''); const [stock, setStock] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]); const [percent, setPercent] = useState('');
  const [customer, setCustomer] = useState(''); const [invoiceNo, setInvoiceNo] = useState('پیش‌نمایش'); const [invoiceProduct, setInvoiceProduct] = useState(''); const [quantity, setQuantity] = useState('1'); const [mono, setMono] = useState(false);
  const [receipt, setReceipt] = useState<InvoiceReceipt | null>(null);
  const [invoices, setInvoices] = useState<InvoiceReceipt[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [templateVersion, setTemplateVersion] = useState<number | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const issueLock = useRef(false);
  const booted = useRef(false);
  useEffect(() => { if (!nativeDevice || booted.current) return; booted.current = true; openNativeShop().then(async repo => {
    setRepository(repo);
    const [products, history, savedInvoices] = await Promise.all([repo.listProducts(), repo.listPriceHistory(), repo.listInvoices()]);
    let template = await repo.loadTemplate();
    if (!template) { await repo.saveTemplate(templateFields(defaults)); template = await repo.loadTemplate(); }
    setData(current => applyTemplate({ ...current, products, batches: history.batches, events: history.events }, template?.fields ?? {}));
    setInvoices(savedInvoices);
    setTemplateVersion(template?.version ?? null);
  }).catch(error => setStartupError((error as Error).message)); }, []);
  const save = (next: Data) => { setData(next); if (!nativeDevice) localStorage.setItem('majora-prototype-v1', JSON.stringify(next)); };
  const refreshNative = async (repo: ShopRepository) => {
    const [products, history] = await Promise.all([repo.listProducts(), repo.listPriceHistory()]);
    setData(current => ({ ...current, products, batches: history.batches, events: history.events }));
  };
  const alert = (s: string) => { setMessage(s); window.setTimeout(() => setMessage(''), 5000); };
  const filtered = useMemo(() => data.products.filter(p => !p.archived && normalizeSearch(`${p.name} ${p.category}`).includes(normalizeSearch(search))), [data.products, search]);
  const active = data.products.filter(p => !p.archived);
  const selectedProduct = data.products.find(p => p.id === invoiceProduct);
  const qty = Number(latinDigits(quantity)) || 0;
  const rawTotal = selectedProduct && Number.isSafeInteger(qty) && qty > 0 ? selectedProduct.priceRial * qty : 0;
  const invoiceTotal = Number.isSafeInteger(rawTotal) ? rawTotal : 0;
  const displayTotal = receipt?.totalRial ?? invoiceTotal;
  const displayLines = receipt?.lines ?? (selectedProduct ? [{ name: selectedProduct.name, quantity: qty, unitPriceRial: selectedProduct.priceRial, totalRial: invoiceTotal }] : []);
  const displayData = receipt?.templateFields ? applyTemplate(data, receipt.templateFields) : data;
  const resetInvoicePreview = () => { setReceipt(null); setInvoiceNo('پیش‌نمایش'); };
  async function persistTemplate() {
    try {
      if (!repository) throw new Error('پایگاه داده آماده نیست.');
      const version = await repository.saveTemplate(templateFields(data));
      setTemplateVersion(version);
      alert(`قالب نسخهٔ ${version} ذخیره شد.`);
    } catch (error) { alert((error as Error).message); }
  }
  async function issue() {
    if (issueLock.current) return;
    issueLock.current = true; setIssuing(true);
    try {
      if (!nativeDevice || !repository) throw new Error('صدور قطعی فقط در نسخهٔ Android با پایگاه داده فعال است.');
      if (!selectedProduct || !Number.isSafeInteger(qty) || qty <= 0) throw new Error('کالا و تعداد معتبر را انتخاب کنید.');
      const issued = await repository.issueInvoice(requestId.current, customer, [{ productId: selectedProduct.id, quantity: qty }]);
      setReceipt(issued); setInvoiceNo(String(issued.number));
      setInvoices(await repository.listInvoices());
      await refreshNative(repository);
      requestId.current = crypto.randomUUID();
      alert(`فاکتور شمارهٔ ${issued.number} ثبت شد.`);
    } catch (error) { alert((error as Error).message); }
    finally { issueLock.current = false; setIssuing(false); }
  }
  function clearProductForm() { setEditingId(null); setName(''); setCategory(''); setPrice(''); setStock(''); }
  function startProductEdit(product: Product) {
    setEditingId(product.id); setName(product.name); setCategory(product.category === 'بدون دسته' ? '' : product.category);
    setPrice(String(product.priceRial)); setStock(String(product.stock));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!name.trim()) throw new Error('نام کالا را وارد کنید.');
      const p: Product = { id: editingId ?? crypto.randomUUID(), name: name.trim(), category: category.trim() || 'بدون دسته', priceRial: parseRial(price), stock: stock.trim() ? parseRial(stock) : 0 };
      if (!Number.isSafeInteger(p.stock) || p.stock < 0) throw new Error('موجودی نامعتبر است.');
      if (nativeDevice) { if (!repository) throw new Error('پایگاه داده آماده نیست.'); if (editingId) await repository.updateProduct(p); else await repository.addProduct(p); await refreshNative(repository); }
      else save({ ...data, products: editingId ? data.products.map(x => x.id === editingId ? p : x) : [...data.products, p] });
      clearProductForm(); alert(editingId ? 'کالا و موجودی ویرایش شد.' : 'کالا ثبت شد.');
    } catch (error) { alert((error as Error).message); }
  }
  async function archiveProduct(product: Product) {
    if (!window.confirm(`«${product.name}» از فهرست فعال کنار گذاشته شود؟ سوابق فاکتور و قیمت حفظ می‌شوند.`)) return;
    try {
      if (nativeDevice) { if (!repository) throw new Error('پایگاه داده آماده نیست.'); await repository.archiveProduct(product.id); await refreshNative(repository); }
      else save({ ...data, products: data.products.map(x => x.id === product.id ? { ...x, archived: true } : x) });
      if (editingId === product.id) clearProductForm();
      setSelected(current => current.filter(id => id !== product.id));
      alert('کالا از فهرست فعال کنار گذاشته شد.');
    } catch (error) { alert((error as Error).message); }
  }
  async function editPrice(p: Product) {
    const value = prompt(`قیمت جدید «${p.name}» به ریال`, String(p.priceRial)); if (value === null) return;
    try { const nextPrice = parseRial(value); if (nativeDevice) { if (!repository) throw new Error('پایگاه داده آماده نیست.'); await repository.updatePrice(p.id, nextPrice); await refreshNative(repository); } else { const at = new Date().toISOString(); const event: PriceEvent = { id: crypto.randomUUID(), batchId: crypto.randomUUID(), productId: p.id, oldPriceRial: p.priceRial, newPriceRial: nextPrice, at, kind: 'raise' }; save({ ...data, products: data.products.map(x => x.id === p.id ? { ...x, priceRial: nextPrice } : x), events: [...data.events, event] }); } alert('قیمت و تاریخچه ثبت شد.'); } catch (error) { alert((error as Error).message); }
  }
  async function applyBatch() {
    try {
      const normalized = latinDigits(percent.trim()).replace('٫', '.');
      if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('درصد مثبت با حداکثر دو رقم اعشار وارد کنید.');
      const [whole, fraction = ''] = normalized.split('.');
      const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0) throw new Error('درصد نامعتبر است.');
      const ids = selected.length ? selected : active.map(p => p.id);
      if (nativeDevice) { if (!repository) throw new Error('پایگاه داده آماده نیست.'); const result = await repository.changePrices(ids, basisPoints); await refreshNative(repository); alert(`قیمت ${result.events.length} کالا تغییر کرد.`); }
      else { const result = applyPriceIncrease(data.products, ids, basisPoints, crypto.randomUUID(), new Date().toISOString()); save({ ...data, products: result.products, batches: [result.batch, ...data.batches], events: [...data.events, ...result.events] }); alert(`قیمت ${result.events.length} کالا تغییر کرد.`); }
      setSelected([]); setPercent('');
    } catch (error) { alert((error as Error).message); }
  }
  async function undo(batch: PriceBatch) {
    try { if (nativeDevice) { if (!repository) throw new Error('پایگاه داده آماده نیست.'); const result = await repository.undoPrices(batch.id); await refreshNative(repository); alert(`${result.restored} قیمت برگشت؛ ${result.conflicts.length} تعارض بدون تغییر باقی ماند.`); }
      else { const at = new Date().toISOString(); const result = undoPriceBatch(data.products, data.events, batch.id, crypto.randomUUID(), at); save({ ...data, products: result.products, events: [...data.events, ...result.events], batches: data.batches.map(x => x.id === batch.id ? { ...x, undoneAt: at } : x) }); alert(`${result.events.length} قیمت برگشت؛ ${result.conflicts.length} تعارض بدون تغییر باقی ماند.`); } } catch (error) { alert((error as Error).message); }
  }
  function changeField(key: keyof Data, value: string) { save({ ...data, [key]: value }); }
  const nav: { key: Page; label: string }[] = [{key:'home',label:'خانه'},{key:'products',label:'کالاها'},{key:'prices',label:'قیمت گروهی'},{key:'invoice',label:'فاکتور'},{key:'settings',label:'قالب و فروشگاه'},{key:'support',label:'پشتیبانی'}];
  if (nativeDevice && (!repository || startupError)) return <div className="boot" dir="rtl"><img src={storeLogo} alt="نشان فروشگاه"/><h1>کیف و کمربند کلاسیک</h1><p>{startupError || 'در حال آماده‌سازی داده‌های آفلاین…'}</p></div>;
  return <div className="shell" dir="rtl">
    <aside className="sidebar"><div className="brand"><img src={majoraLogo} alt="ماژورا"/><span>فضای کار فروشگاه</span></div><nav aria-label="بخش‌های برنامه">{nav.map(n => <button key={n.key} className={page===n.key?'active':''} onClick={() => setPage(n.key)}>{n.label}</button>)}</nav><div className="side-note">نسخهٔ توسعهٔ آفلاین<br/>{nativeDevice?'کالا و قیمت در SQLite محلی ذخیره می‌شوند.':'داده‌های نمونه فقط در همین مرورگر ذخیره می‌شوند.'}</div></aside>
    <div className="main"><header className="topbar"><div><div className="eyebrow">MAJORA / MERCHANT</div><strong>{data.storeName}</strong></div><span className="offline">{nativeDevice?'آفلاین · SQLite محلی':'آفلاین · نمونهٔ اولیه'}</span></header>
    <main>
      {message && <div className="notice" role="status">{message}</div>}
      {page==='home' && <><div className="hero"><div><span className="eyebrow">مدیریت روزانه</span><h1>فروشگاه، همیشه همراه شما</h1><p>کالاها، قیمت‌ها و فاکتور را در یک فضای فارسی و ساده مدیریت کنید.</p><button className="primary" onClick={()=>setPage('products')}>افزودن کالا</button></div><div className="hero-number"><b>{formatRial(active.length)}</b><span>کالای فعال</span></div></div><div className="stats"><article><span>کالاها</span><strong>{formatRial(active.length)}</strong><small>ثبت‌شده در این دستگاه</small></article><article><span>دسته‌ها</span><strong>{formatRial(new Set(active.map(p=>p.category)).size)}</strong><small>برای دسترسی سریع</small></article><article><span>تغییرهای قیمت</span><strong>{formatRial(data.events.length)}</strong><small>رویداد ثبت‌شده</small></article></div><section className="card"><h2>شروع سریع</h2><div className="quick"><button onClick={()=>setPage('products')}>مدیریت کالاها <span>←</span></button><button onClick={()=>setPage('prices')}>افزایش گروهی قیمت <span>←</span></button><button onClick={()=>setPage('invoice')}>پیش‌نمایش فاکتور <span>←</span></button></div></section></>}
      {page==='products' && <><div className="section-heading"><div><span className="eyebrow">کاتالوگ</span><h1>کالاها</h1></div><span className="count">{formatRial(active.length)} کالا</span></div><div className="two-col"><section className="card"><h2>{editingId ? 'ویرایش کالا و موجودی' : 'کالای تازه'}</h2><form onSubmit={saveProduct} className="form"><label>نام کالا<input value={name} onChange={e=>setName(e.target.value)} required/></label><label>دسته<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="مثلاً کیف"/></label><label>قیمت به ریال<input inputMode="numeric" value={price} onChange={e=>setPrice(e.target.value)} required placeholder="۱٬۲۵۰٬۰۰۰"/></label><label>{editingId ? 'موجودی فعلی' : 'موجودی اولیه'}<input inputMode="numeric" value={stock} onChange={e=>setStock(e.target.value)} placeholder="۰"/></label><button className="primary" type="submit">{editingId ? 'ذخیرهٔ تغییرها' : 'ثبت کالا'}</button>{editingId && <button type="button" onClick={clearProductForm}>انصراف از ویرایش</button>}</form></section><section className="card"><div className="card-head"><h2>فهرست کالاها</h2><label className="search-label">جست‌وجو<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="نام یا دسته"/></label></div><div className="product-list">{filtered.length ? filtered.map(p=><article className="product" key={p.id}><div className="product-icon">{p.name.slice(0,1)}</div><div><strong>{p.name}</strong><small>{p.category} · موجودی {formatRial(p.stock)}</small></div><div className="product-actions"><b>{formatRial(p.priceRial)} <small>ریال</small></b><button onClick={()=>startProductEdit(p)}>ویرایش کالا</button><button onClick={()=>editPrice(p)}>قیمت سریع</button><button onClick={()=>archiveProduct(p)}>بایگانی</button></div></article>) : <p className="empty">کالایی پیدا نشد. اولین کالا را از فرم کنار صفحه ثبت کنید.</p>}</div></section></div></>}
      {page==='prices' && <><div className="section-heading"><div><span className="eyebrow">کنترل قیمت</span><h1>افزایش گروهی</h1></div></div><div className="two-col"><section className="card"><h2>انتخاب کالا و درصد</h2><p className="muted">اگر کالایی تیک نخورد، همهٔ کالاهای فعال انتخاب می‌شوند.</p><label className="form">درصد افزایش<input inputMode="decimal" value={percent} onChange={e=>setPercent(e.target.value)} placeholder="مثلاً ۱۰"/></label><div className="checks">{active.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...selected,p.id]:selected.filter(x=>x!==p.id))}/><span>{p.name}</span><small>{formatRial(p.priceRial)} ریال</small></label>)}</div><button className="primary" onClick={applyBatch} disabled={!active.length}>اعمال به {selected.length || active.length} کالا</button></section><section className="card"><h2>تاریخچهٔ گروهی</h2>{data.batches.length? data.batches.map(b=><article className="batch" key={b.id}><div><strong>{formatPercent(b.percentBasisPoints)}٪ افزایش</strong><small>{new Date(b.at).toLocaleString('fa-IR')} · {b.productIds.length} کالا {b.undoneAt?'· بازگردانی‌شده':''}</small></div><button onClick={()=>undo(b)} disabled={!!b.undoneAt}>{b.undoneAt?'بازگردانی شد':'بازگردانی'}</button></article>):<p className="empty">هنوز تغییری ثبت نشده است.</p>}<p className="muted">در صورت تغییر مستقل قیمت پس از این عملیات، بازگردانی آن کالا را دست‌نخورده نگه می‌دارد.</p></section></div></>}
      {page==='invoice' && <><div className="section-heading"><div><span className="eyebrow">فروش و چاپ</span><h1>{receipt ? `فاکتور شمارهٔ ${receipt.number}` : 'پیش‌نمایش فاکتور'}</h1></div><div className="toolbar"><label><input type="checkbox" checked={mono} onChange={e=>setMono(e.target.checked)}/> سیاه‌وسفید</label><button className="primary" onClick={()=>window.print()} disabled={nativeDevice} title={nativeDevice ? 'اتصال چاپ بومی در دست ساخت است' : undefined}>چاپ / ذخیره PDF</button></div></div><div className="invoice-layout"><section className="card controls"><h2>{receipt ? 'سند ثبت‌شده' : 'مشخصات نمونه'}</h2><label>شمارهٔ نمایشی<input value={invoiceNo} readOnly={nativeDevice} onChange={e=>setInvoiceNo(e.target.value)}/></label><label>نام خریدار<input value={customer} onChange={e=>{setCustomer(e.target.value);resetInvoicePreview();}}/></label><label>کالا<select value={invoiceProduct} onChange={e=>{setInvoiceProduct(e.target.value);resetInvoicePreview();}}><option value="">انتخاب کالا</option>{active.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>تعداد<input type="number" min="1" step="1" value={quantity} onChange={e=>{setQuantity(e.target.value);resetInvoicePreview();}}/></label>{nativeDevice ? <><button className="primary" onClick={issue} disabled={!selectedProduct || !!receipt || issuing}>{issuing ? 'در حال ثبت…' : receipt ? 'ثبت شد' : 'ثبت قطعی و کسر موجودی'}</button><p className="muted">شمارهٔ قطعی هنگام ثبت اختصاص می‌یابد. چاپ PDF بومی هنوز فعال نیست.</p><h3>فاکتورهای ثبت‌شده</h3><div className="saved-invoices">{invoices.map(saved=><button key={saved.id} onClick={()=>{setReceipt(saved);setInvoiceNo(String(saved.number));}}>شمارهٔ {saved.number} · {saved.customerName || 'خریدار حضوری'} · {formatRial(saved.totalRial)} ریال</button>)}</div></> : <p className="muted">این صفحه در مرورگر فقط پیش‌نمایش است؛ سند، شمارهٔ قطعی یا تغییر موجودی ثبت نمی‌کند. خروجی PDF از چاپ مرورگر است.</p>}</section><section className={`invoice ${mono?'mono':''}`} aria-label="پیش‌نمایش فاکتور"><div className="invoice-top"><img src={storeLogo} alt="نشان فروشگاه"/><div><h2>{displayData.storeName}</h2><strong>{displayData.slogan}</strong><p>{displayData.phone}<br/>{displayData.address}</p></div></div><div className="invoice-cardline">شماره کارت <b dir="ltr">{displayData.card}</b> · {displayData.cardHolder}</div><div className="invoice-note">{displayData.note}</div><div className="invoice-meta"><span>شماره فاکتور: <b>{invoiceNo}</b></span><span>تاریخ: <b>{new Date(receipt?.at ?? Date.now()).toLocaleDateString('fa-IR')}</b></span><span>خریدار: <b>{receipt?.customerName || customer || '—'}</b></span></div><table><thead><tr><th>ردیف</th><th>شرح کالا</th><th>تعداد</th><th>فی (ریال)</th><th>مبلغ کل (ریال)</th></tr></thead><tbody>{displayLines.length ? displayLines.map((line,index)=><tr key={index}><td>{formatRial(index+1)}</td><td>{line.name}</td><td>{formatRial(line.quantity)}</td><td>{formatRial(line.unitPriceRial)}</td><td>{formatRial(line.totalRial)}</td></tr>) : <tr><td colSpan={5}>کالا انتخاب نشده است</td></tr>}</tbody></table><div className="invoice-bottom"><div className="invoice-terms"><h3>شرایط فروش و تحویل کالا</h3><ol>{displayData.conditions.map((c,i)=><li key={i}>{c}</li>)}</ol></div><div className="invoice-totals"><div>جمع کل <b>{formatRial(displayTotal)}</b></div><div>مبلغ نهایی <b>{formatRial(displayTotal)} ریال</b></div><div className="signatures"><span>امضای خریدار</span><span>امضای فروشنده</span></div></div></div></section></div></>}
      {page==='settings' && <><div className="section-heading"><div><span className="eyebrow">شخصی‌سازی</span><h1>فروشگاه و متن فاکتور</h1></div></div><section className="card"><p className="muted">هر تغییر فوراً در پیش‌نمایش دیده می‌شود. {nativeDevice ? 'برای حفظ تغییرها، دکمهٔ ذخیرهٔ نسخهٔ جدید را بزنید. جای‌گذاری و مرزبندی فیلدها هنوز آماده نیست.' : 'نسخهٔ مرورگر محلی است و قالب نسخه‌دار فقط در Android ذخیره می‌شود.'}</p><div className="settings-grid">{([['storeName','نام فروشگاه'],['slogan','شعار'],['phone','تلفن‌ها'],['address','نشانی'],['card','شماره کارت'],['cardHolder','نام صاحب کارت'],['note','یادآوری پرداخت']] as const).map(([key,label])=><label key={key}>{label}<input value={data[key]} onChange={e=>changeField(key,e.target.value)}/></label>)}</div><h2>شرایط فروش</h2>{data.conditions.map((c,i)=><label className="condition-field" key={i}>بند {i+1}<textarea value={c} rows={3} onChange={e=>save({...data,conditions:data.conditions.map((x,j)=>j===i?e.target.value:x)})}/></label>)}{nativeDevice && <button className="primary" onClick={persistTemplate}>ذخیرهٔ نسخهٔ جدید قالب {templateVersion ? `(فعلی: ${templateVersion})` : ''}</button>}</section></>}
      {page==='support' && <div className="support card"><img src={majoraLogo} alt="لوگوی MAJORA"/><span className="eyebrow">توسعه و پشتیبانی</span><h1>ماژورا</h1><p>شرکت نرم‌افزاری و توسعهٔ کسب‌وکار ماژورا</p><strong>نرم‌افزار به سبک کار شما</strong><p>برای راهنمایی برنامه یا درخواست توسعهٔ اختصاصی:</p><div className="support-links"><a href="tel:09105796971">تماس: ۰۹۱۰-۵۷۹-۶۹۷۱</a><a href="tel:09019990440">تماس: ۰۹۰۱-۹۹۹-۰۴۴۰</a><a href="https://www.instagram.com/majora_app/" target="_blank" rel="noreferrer">اینستاگرام: ‎@majora_app</a></div></div>}
    </main><footer className="mobile-nav">{nav.slice(0,4).map(n=><button key={n.key} className={page===n.key?'active':''} onClick={()=>setPage(n.key)}>{n.label}</button>)}<button onClick={()=>setPage(page==='settings'?'support':'settings')}>بیشتر</button></footer></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
