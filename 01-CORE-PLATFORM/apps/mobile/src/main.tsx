import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPriceIncrease, changedPrice, formatRial, parseRial, undoPriceBatch, type PriceBatch, type PriceEvent, type Product } from '@majora/domain';
import { normalizeSearch, type CustomerSummary, type InvoiceHistoryEntry, type InvoiceInputLine, type InvoiceReceipt, type ShopRepository } from '@majora/database';
import { Browser } from '@capacitor/browser';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { nativeDevice, openNativeShop } from './native-db';
import { prepareProductPhoto, productPhotoUrl, removeProductPhoto, storeProductPhoto } from './product-photo';
import './style.css';
const majoraLogo = '/brand/majora-logo.png';
const storeLogo = '/brand/store-logo.png';

type Page = 'home' | 'sale' | 'products' | 'customers' | 'prices' | 'invoice' | 'settings' | 'support';
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
const jalaliToday = () => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type UiPreferences = { compactCards: boolean; showStock: boolean; showCardNumber: boolean; confirmIssue: boolean };
const initialPreferences: UiPreferences = { compactCards: true, showStock: true, showCardNumber: true, confirmIssue: true };
function loadPreferences(): UiPreferences { try { return { ...initialPreferences, ...JSON.parse(localStorage.getItem('majora-ui-preferences-v1') || '{}') }; } catch { return initialPreferences; } }
function ProductImage({ product }: { product: Product }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => { let current = true; productPhotoUrl(product.imagePath).then(url => { if (current) setSrc(url); }).catch(() => { if (current) setSrc(undefined); }); return () => { current = false; }; }, [product.imagePath]);
  return src ? <img className="tile-photo" src={src} alt="" loading="lazy"/> : <span className="tile-placeholder" aria-hidden="true">{product.name.slice(0, 1)}</span>;
}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [preferences, setPreferences] = useState<UiPreferences>(loadPreferences);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(40);
  const [categoryPath, setCategoryPath] = useState('');
  const [expandedCategory, setExpandedCategory] = useState('');
  const [shortcutProductId, setShortcutProductId] = useState<string | null>(null);
  const [inspectedProductId, setInspectedProductId] = useState<string | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [model, setModel] = useState(''); const [color, setColor] = useState(''); const [price, setPrice] = useState(''); const [stock, setStock] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]); const [percent, setPercent] = useState('');
  const [customerFirst, setCustomerFirst] = useState(''); const [customerLast, setCustomerLast] = useState(''); const [customerPhone, setCustomerPhone] = useState(''); const [invoiceDate, setInvoiceDate] = useState(''); const [invoiceNo, setInvoiceNo] = useState('پیش‌نمایش'); const [quantity, setQuantity] = useState('1'); const [mono, setMono] = useState(false);
  const customer = [customerFirst.trim(), customerLast.trim()].filter(Boolean).join(' ');
  const [customerStepDone, setCustomerStepDone] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [invoicePercent, setInvoicePercent] = useState('');
  const [invoiceSelectedLines, setInvoiceSelectedLines] = useState<number[]>([]);
  const [manualName, setManualName] = useState(''); const [manualPrice, setManualPrice] = useState('');
  const [draftLines, setDraftLines] = useState<InvoiceInputLine[]>([]);
  const [receipt, setReceipt] = useState<InvoiceReceipt | null>(null);
  const [invoices, setInvoices] = useState<InvoiceHistoryEntry[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<InvoiceHistoryEntry[]>([]);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [templateVersion, setTemplateVersion] = useState<number | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const issueLock = useRef(false);
  const booted = useRef(false);
  useEffect(() => { if (!nativeDevice || booted.current) return; booted.current = true; openNativeShop().then(async repo => {
    setRepository(repo);
    const [products, history, savedInvoices, savedCustomers] = await Promise.all([repo.listProducts(), repo.listPriceHistory(), repo.listInvoiceHistory(), repo.listCustomers()]);
    let template = await repo.loadTemplate();
    if (!template) { await repo.saveTemplate(templateFields(defaults)); template = await repo.loadTemplate(); }
    setData(current => applyTemplate({ ...current, products, batches: history.batches, events: history.events }, template?.fields ?? {}));
    setInvoices(savedInvoices);
    setCustomers(savedCustomers);
    setTemplateVersion(template?.version ?? null);
  }).catch(error => setStartupError((error as Error).message)); }, []);
  useEffect(() => { if (!repository || !selectedCustomerId) { setCustomerInvoices([]); return; } let current = true; repository.listCustomerInvoices(selectedCustomerId).then(entries => { if (current) setCustomerInvoices(entries); }); return () => { current = false; }; }, [repository, selectedCustomerId, invoices]);
  const save = (next: Data) => { setData(next); if (!nativeDevice) localStorage.setItem('majora-prototype-v1', JSON.stringify(next)); };
  const refreshNative = async (repo: ShopRepository) => {
    const [products, history] = await Promise.all([repo.listProducts(), repo.listPriceHistory()]);
    setData(current => ({ ...current, products, batches: history.batches, events: history.events }));
  };
  const alert = (s: string) => { setMessage(s); window.setTimeout(() => setMessage(''), 5000); };
  const active = data.products.filter(p => !p.archived);
  const inspectedProduct = data.products.find(p => p.id === inspectedProductId);
  const categories = useMemo(() => Array.from(new Set(active.map(p => p.category))).sort((a, b) => a.localeCompare(b, 'fa')), [data.products]);
  const categoryRoots = useMemo(() => Array.from(new Set(categories.map(c => c.split('/')[0].trim()))), [categories]);
  const childCategories = useMemo(() => expandedCategory ? categories.filter(c => c.startsWith(`${expandedCategory}/`)) : [], [categories, expandedCategory]);
  const filtered = useMemo(() => active.filter(p => {
    const matchesCategory = !categoryPath || p.category === categoryPath || p.category.startsWith(`${categoryPath}/`);
    return matchesCategory && normalizeSearch(`${p.name} ${p.model ?? ''} ${p.color ?? ''} ${p.category}`).includes(normalizeSearch(search));
  }), [data.products, search, categoryPath]);
  useEffect(() => { setVisibleCount(40); }, [search, categoryPath, page]);
  const qty = Number(latinDigits(quantity)) || 0;
  const draftDisplayLines = draftLines.map(line => {
    const price = line.unitPriceRial ?? 0;
    return { name: line.name ?? data.products.find(p => p.id === line.productId)?.name ?? 'کالای حذف‌شده', quantity: line.quantity, unitPriceRial: price, totalRial: price * line.quantity };
  });
  const draftTotal = draftDisplayLines.reduce((sum, line) => sum + line.totalRial, 0);
  const displayTotal = receipt?.totalRial ?? draftTotal;
  const displayLines = receipt?.lines ?? draftDisplayLines;
  const displayData = receipt?.templateFields ? applyTemplate(data, receipt.templateFields) : data;
  const selectedInvoiceStatus = invoices.find(entry => entry.receipt.id === receipt?.id)?.status;
  const invoiceQuery = normalizeSearch(latinDigits(invoiceSearch.trim()));
  const visibleInvoices = invoiceQuery ? invoices.filter(({ receipt: saved }) =>
    normalizeSearch(latinDigits([saved.number, saved.customerName, saved.at, new Date(saved.at).toLocaleDateString('fa-IR'), ...saved.lines.map(line => line.name)].join(' '))).includes(invoiceQuery)
  ) : invoices;
  const resetInvoicePreview = () => { setReceipt(null); setInvoiceNo('پیش‌نمایش'); };
  function newInvoice() {
    setReceipt(null); setInvoiceNo('پیش‌نمایش'); setCustomerFirst(''); setCustomerLast(''); setCustomerPhone(''); setInvoiceDate(''); setDraftLines([]); setCartOpen(false); setCustomerStepDone(false); setPage('sale');
    setQuantity('1'); setManualName(''); setManualPrice('');
    requestId.current = crypto.randomUUID();
  }
  function addProductToCart(product: Product) {
    const currentQuantity = draftLines.filter(line => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0);
    if (currentQuantity >= product.stock) { alert(`موجودی «${product.name}» کافی نیست. موجودی فعلی: ${formatRial(product.stock)}`); return; }
    setDraftLines(current => {
      const index = current.findIndex(line => line.productId === product.id && line.unitPriceRial === product.priceRial);
      if (index < 0) return [...current, { productId: product.id, name: [product.name, product.model, product.color].filter(Boolean).join(' · '), unitPriceRial: product.priceRial, quantity: 1 }];
      return current.map((line, i) => i === index ? { ...line, quantity: line.quantity + 1 } : line);
    });
    resetInvoicePreview();
  }
  function updateCartQuantity(index: number, raw: string) {
    const value = Number(latinDigits(raw));
    if (!Number.isSafeInteger(value) || value < 1) { alert('تعداد باید عدد صحیح و دست‌کم یک باشد.'); return; }
    const line = draftLines[index];
    const product = data.products.find(p => p.id === line.productId);
    const otherQuantity = draftLines.reduce((sum, item, i) => sum + (i !== index && item.productId === line.productId ? item.quantity : 0), 0);
    if (product && value + otherQuantity > product.stock) { alert(`موجودی «${product.name}» فقط ${formatRial(product.stock)} عدد است.`); return; }
    setDraftLines(current => current.map((item, i) => i === index ? { ...item, quantity: value } : item));
    resetInvoicePreview();
  }
  function updateCartPrice(index: number, raw: string) {
    try { const next = parseRial(raw); setDraftLines(current => current.map((item, i) => i === index ? { ...item, unitPriceRial: next } : item)); resetInvoicePreview(); }
    catch (error) { alert((error as Error).message); }
  }
  function applyInvoicePercent() {
    try {
      const normalized = latinDigits(invoicePercent.trim()).replace('٫', '.');
      if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('درصد را با حداکثر دو رقم اعشار وارد کنید.');
      const [whole, fraction = ''] = normalized.split('.');
      const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0) throw new Error('درصد باید مثبت باشد.');
      if (!draftLines.length) throw new Error('ابتدا کالا را به فاکتور اضافه کنید.');
      const targets = invoiceSelectedLines.length ? invoiceSelectedLines : draftLines.map((_, index) => index);
      setDraftLines(current => current.map((line, index) => targets.includes(index) ? { ...line, unitPriceRial: changedPrice(line.unitPriceRial ?? 0, basisPoints) } : line));
      setInvoicePercent(''); setInvoiceSelectedLines([]); resetInvoicePreview();
      alert(`قیمت ${targets.length} ردیف در همین فاکتور تغییر کرد؛ قیمت کاتالوگ ثابت ماند.`);
    } catch (error) { alert((error as Error).message); }
  }
  function setPreference<K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) {
    const next = { ...preferences, [key]: value }; setPreferences(next); localStorage.setItem('majora-ui-preferences-v1', JSON.stringify(next));
  }
  async function openProductSearch(product: Product, kind: 'torob' | 'digikala' | 'details') {
    const title = [product.name, product.model, product.color].filter(Boolean).join(' ');
    const query = kind === 'torob' ? `قیمت ${title} در ترب` : kind === 'digikala' ? `قیمت ${title} در دیجیکالا` : `مشخصات فنی و کامل ${title}`;
    try { await Browser.open({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` }); }
    catch { window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer'); }
  }
  async function exportCustomersCsv() {
    try {
      if (!customers.length) throw new Error('فهرست مشتریان خالی است.');
      const quote = (value: string | number) => `"${String(value).replace(/^[=+@\-]/, "'$&").replaceAll('"', '""')}"`;
      const csv = '\uFEFF' + ['نام,نام خانوادگی,شماره همراه,تعداد فاکتور,آخرین خرید', ...customers.map(item =>
        [item.firstName || item.name, item.lastName, item.phone, item.invoiceCount, item.lastPurchaseAt ? new Date(item.lastPurchaseAt).toLocaleDateString('fa-IR-u-ca-persian') : ''].map(quote).join(',')
      )].join('\r\n');
      const filename = `majora-customers-${new Date().toISOString().slice(0, 10)}.csv`;
      if (nativeDevice) {
        const path = `exports/${filename}`;
        await Filesystem.writeFile({ path, directory: Directory.Cache, data: csv, encoding: Encoding.UTF8, recursive: true });
        const file = await Filesystem.getUri({ path, directory: Directory.Cache });
        await Share.share({ title: 'خروجی مشتریان', files: [file.uri], dialogTitle: 'ذخیره یا اشتراک فایل مشتریان' });
      } else {
        const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = href; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
      }
    } catch (error) { alert((error as Error).message); }
  }
  function textForInvoice(saved: InvoiceReceipt): string {
    const fields = applyTemplate(data, saved.templateFields ?? {});
    return [fields.storeName, `فاکتور شماره ${saved.number}`, `تاریخ: ${saved.dateJalali || new Date(saved.at).toLocaleDateString('fa-IR-u-ca-persian')}`,
      `مشتری: ${saved.customerName || 'خریدار حضوری'}`, saved.customerPhone ? `تماس: ${saved.customerPhone}` : '',
      'اقلام:', ...saved.lines.map((line, index) => `${index + 1}. ${line.name} × ${line.quantity} — ${formatRial(line.totalRial)} ریال`),
      `جمع کل: ${formatRial(saved.totalRial)} ریال`, (saved.showCardNumber ?? true) ? `شماره کارت: ${fields.card} به نام ${fields.cardHolder}` : '', fields.note
    ].filter(Boolean).join('\n');
  }
  async function shareInvoiceText(saved: InvoiceReceipt) {
    try { await Share.share({ title: `فاکتور ${saved.number} ${data.storeName}`, text: textForInvoice(saved), dialogTitle: 'ارسال متن فاکتور' }); }
    catch (error) { alert((error as Error).message); }
  }
  async function copyInvoiceText(saved: InvoiceReceipt) {
    try { await navigator.clipboard.writeText(textForInvoice(saved)); alert('متن فاکتور کپی شد.'); }
    catch { alert('کپی متن در این دستگاه ممکن نشد.'); }
  }
  function addInvoiceLine() {
    try {
      if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error('تعداد کالا نامعتبر است.');
      const line: InvoiceInputLine = { name: manualName.trim(), unitPriceRial: parseRial(manualPrice), quantity: qty };
      if (!line.name || line.unitPriceRial === undefined) throw new Error('کالا یا شرح ردیف را انتخاب کنید.');
      if (!Number.isSafeInteger(line.unitPriceRial * qty) || !Number.isSafeInteger(draftTotal + line.unitPriceRial * qty)) throw new Error('مبلغ فاکتور بیش از حد مجاز است.');
      setDraftLines(current => [...current, line]);
      setQuantity('1'); setManualName(''); setManualPrice(''); resetInvoicePreview();
    } catch (error) { alert((error as Error).message); }
  }
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
    if (preferences.confirmIssue && !window.confirm(`فاکتور با ${draftLines.length} ردیف و جمع ${formatRial(draftTotal)} ریال ثبت و موجودی کسر شود؟`)) return;
    issueLock.current = true; setIssuing(true);
    try {
      if (!nativeDevice || !repository) throw new Error('صدور قطعی فقط در برنامهٔ نصب‌شده با پایگاه داده فعال است.');
      if (!draftLines.length) throw new Error('دست‌کم یک ردیف به فاکتور اضافه کنید.');
      const issued = await repository.issueInvoice(requestId.current, customer, draftLines, customerPhone, invoiceDate, customerFirst, customerLast, preferences.showCardNumber);
      setReceipt(issued); setInvoiceNo(String(issued.number));
      setInvoices(await repository.listInvoiceHistory());
      setCustomers(await repository.listCustomers());
      await refreshNative(repository);
      requestId.current = crypto.randomUUID();
      setDraftLines([]);
      alert(`فاکتور شمارهٔ ${issued.number} ثبت شد.`);
    } catch (error) { alert((error as Error).message); }
    finally { issueLock.current = false; setIssuing(false); }
  }
  async function voidSelectedInvoice() {
    if (!repository || !receipt || selectedInvoiceStatus !== 'issued') return;
    const reason = window.prompt(`دلیل ابطال فاکتور شمارهٔ ${receipt.number} را وارد کنید. موجودی کالاهای آن بازگردانده می‌شود.`);
    if (reason === null) return;
    try {
      await repository.voidInvoice(receipt.id, reason);
      setInvoices(await repository.listInvoiceHistory());
      await refreshNative(repository);
      alert(`فاکتور شمارهٔ ${receipt.number} باطل شد. نسخهٔ اصلی در تاریخچه باقی ماند.`);
    } catch (error) { alert((error as Error).message); }
  }
  function clearProductForm() { setEditingId(null); setName(''); setCategory(''); setModel(''); setColor(''); setPrice(''); setStock(''); setPhotoDataUrl(''); setProductFormOpen(false); }
  function startProductEdit(product: Product) {
    setEditingId(product.id); setName(product.name); setCategory(product.category === 'بدون دسته' ? '' : product.category);
    setModel(product.model ?? ''); setColor(product.color ?? ''); setPhotoDataUrl(''); setPrice(String(product.priceRial)); setStock(String(product.stock)); setProductFormOpen(true);
  }
  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    let createdImagePath: string | undefined;
    try {
      if (!name.trim()) throw new Error('نام کالا را وارد کنید.');
      const priceRial = parseRial(price);
      const stockQuantity = stock.trim() ? parseRial(stock) : 0;
      if (!Number.isSafeInteger(stockQuantity * 1000)) throw new Error('موجودی بیش از حد مجاز است.');
      const previous = editingId ? data.products.find(item => item.id === editingId) : undefined;
      createdImagePath = photoDataUrl ? await storeProductPhoto(photoDataUrl) : undefined;
      const imagePath = createdImagePath ?? previous?.imagePath;
      const p: Product = { id: editingId ?? crypto.randomUUID(), name: name.trim(), category: category.trim() || 'بدون دسته', model: model.trim(), color: color.trim(), imagePath, priceRial, stock: stockQuantity };
      if (!Number.isSafeInteger(p.stock) || p.stock < 0) throw new Error('موجودی نامعتبر است.');
      if (nativeDevice) { if (!repository) throw new Error('پایگاه داده آماده نیست.'); if (editingId) await repository.updateProduct(p); else await repository.addProduct(p); await refreshNative(repository); }
      else save({ ...data, products: editingId ? data.products.map(x => x.id === editingId ? p : x) : [...data.products, p] });
      if (photoDataUrl && previous?.imagePath) await removeProductPhoto(previous.imagePath).catch(() => undefined);
      clearProductForm(); alert(editingId ? 'کالا و موجودی ویرایش شد.' : 'کالا ثبت شد.');
    } catch (error) { await removeProductPhoto(createdImagePath).catch(() => undefined); alert((error as Error).message); }
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
  const nav: { key: Page; label: string; icon: string }[] = [
    { key: 'home', label: 'خانه', icon: '⌂' }, { key: 'sale', label: 'فروش تازه', icon: '＋' }, { key: 'products', label: 'کالاها', icon: '▦' },
    { key: 'invoice', label: 'فاکتورها', icon: '▤' }, { key: 'customers', label: 'مشتریان', icon: '♧' }, { key: 'prices', label: 'قیمت گروهی', icon: '٪' },
    { key: 'settings', label: 'تنظیمات', icon: '⚙' }, { key: 'support', label: 'پشتیبانی ماژورا', icon: '◉' }
  ];
  function changePage(next: Page) { setPage(next); setMenuOpen(false); setShortcutProductId(null); setSearch(''); setCategoryPath(''); window.scrollTo(0, 0); }
  const catalog = (mode: 'sale' | 'browse') => <>
    <div className="catalog-tools">
      <label className="catalog-search"><span className="sr-only">جست‌وجوی کالا</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="جست‌وجوی نام، مدل، رنگ یا دسته…" type="search"/></label>
      <span className="catalog-count">{formatRial(filtered.length)} کالا</span>
    </div>
    <div className="category-roots" aria-label="دسته‌های کالا"><button className={!categoryPath ? 'selected' : ''} onClick={() => { setCategoryPath(''); setExpandedCategory(''); }}>همه</button>{categoryRoots.map(root => <button key={root} className={categoryPath === root ? 'selected' : ''} onClick={() => { setCategoryPath(root); setExpandedCategory(expandedCategory === root ? '' : root); }}>{root} {categories.some(item => item.startsWith(`${root}/`)) ? '⌄' : ''}</button>)}</div>
    {!!childCategories.length && <div className="category-children" aria-label="زیردسته‌ها"><button onClick={() => setCategoryPath(expandedCategory)} className={categoryPath === expandedCategory ? 'selected' : ''}>همهٔ {expandedCategory}</button>{childCategories.map(child => <button key={child} className={categoryPath === child ? 'selected' : ''} onClick={() => setCategoryPath(child)}>{child.slice(expandedCategory.length + 1).replaceAll('/', ' › ')}</button>)}</div>}
    {filtered.length ? <div className={`catalog-grid ${preferences.compactCards ? 'compact' : ''} ${mode === 'browse' ? 'browse' : ''}`}>{filtered.slice(0, visibleCount).map(product => <article className="catalog-tile" key={product.id}>
      <button className="tile-inspect" onClick={() => setInspectedProductId(product.id)} aria-label={`نمایش جزئیات ${product.name}`}></button>
      <ProductImage product={product}/><strong title={[product.name, product.model, product.color].filter(Boolean).join(' · ')}>{product.name}</strong>
      <small className="tile-detail">{[product.model, product.color].filter(Boolean).join(' · ') || product.category.replaceAll('/', ' › ')}</small>
      <b className="tile-price">{formatRial(product.priceRial)} <span>ریال</span></b>
      {preferences.showStock && <span className={`tile-stock ${product.stock === 0 ? 'zero' : ''}`}>موجودی {formatRial(product.stock)}</span>}
      {mode === 'sale' ? <button className="tile-add" onClick={() => addProductToCart(product)} aria-label={`افزودن ${product.name} به فاکتور`} disabled={product.stock < 1}>+ افزودن</button> : <div className="tile-actions"><button onClick={() => startProductEdit(product)}>ویرایش</button><button aria-label={`میانبرهای ${product.name}`} aria-expanded={shortcutProductId === product.id} onClick={() => setShortcutProductId(shortcutProductId === product.id ? null : product.id)}>⋯</button></div>}
      {mode === 'browse' && shortcutProductId === product.id && <div className="shortcut-menu"><button onClick={() => openProductSearch(product, 'torob')}>ترب</button><button onClick={() => openProductSearch(product, 'digikala')}>دیجیکالا</button><button onClick={() => openProductSearch(product, 'details')}>مشخصات کالا</button></div>}
    </article>)}</div> : <div className="empty-catalog"><strong>کالایی در این بخش پیدا نشد</strong><p>نام، رنگ یا دسته را تغییر دهید.{mode === 'browse' ? ' برای شروع می‌توانید کالا اضافه کنید.' : ''}</p></div>}
    {filtered.length > visibleCount && <button className="load-more" onClick={() => setVisibleCount(count => count + 40)}>نمایش ۴۰ کالای بعدی</button>}
  </>;
  if (nativeDevice && (!repository || startupError)) return <div className="boot" dir="rtl"><img src={storeLogo} alt="نشان فروشگاه"/><h1>کیف و کمربند کلاسیک</h1><p>{startupError || 'در حال آماده‌سازی داده‌های آفلاین…'}</p></div>;
  return <div className="shell" dir="rtl">
    <aside className="sidebar"><div className="brand"><img src={storeLogo} alt="نشان فروشگاه"/><span>{data.storeName}</span></div><nav aria-label="دسترسی سریع">{nav.slice(0, 4).map(n => <button key={n.key} className={page===n.key?'active':''} onClick={() => changePage(n.key)}><span aria-hidden="true">{n.icon}</span>{n.label}</button>)}</nav><div className="side-note">ساخته‌شده با MAJORA<br/>نسخهٔ آزمایشی آفلاین</div></aside>
    {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)}><aside className="menu-drawer" onClick={event => event.stopPropagation()} aria-label="منوی کامل"><div className="menu-header"><strong>همهٔ بخش‌ها</strong><button aria-label="بستن منو" onClick={() => setMenuOpen(false)}>×</button></div>{nav.map(n => <button key={n.key} className={page===n.key?'active':''} onClick={() => changePage(n.key)}><span aria-hidden="true">{n.icon}</span>{n.label}</button>)}</aside></div>}
    <div className="main"><header className="topbar"><button className="menu-trigger" aria-label="باز کردن منوی کامل" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>☰</button><div className="topbar-title"><strong>{data.storeName}</strong><small>{page === 'sale' ? 'انتخاب سریع کالا' : page === 'products' ? 'فهرست و مدیریت کالا' : 'فضای کار فروشگاه'}</small></div><span className="offline">{nativeDevice?'آفلاین':'نمونه'}</span></header>
    <main>
      {message && <div className="notice" role="status">{message}</div>}
       {page==='home' && <><section className="home-hero"><div><span className="eyebrow">امروز در فروشگاه</span><h1>فروش را سریع شروع کنید</h1><p>مشتری را ثبت کنید، کالاها را از فهرست انتخاب کنید و فاکتور را بازبینی کنید.</p></div><button className="primary" onClick={() => { newInvoice(); }}>فاکتور جدید ←</button></section><div className="stats"><article><span>کالاهای فعال</span><strong>{formatRial(active.length)}</strong></article><article><span>دسته‌ها</span><strong>{formatRial(categories.length)}</strong></article><article><span>فاکتورهای ثبت‌شده</span><strong>{formatRial(invoices.length)}</strong></article></div><section className="home-actions"><button onClick={() => changePage('products')}><span>▦</span><strong>مرور کالاها</strong><small>جست‌وجو، ویرایش و میانبرها</small></button><button onClick={() => changePage('invoice')}><span>▤</span><strong>تاریخچهٔ فاکتورها</strong><small>بازبینی و پیگیری فروش</small></button><button onClick={() => changePage('prices')}><span>٪</span><strong>تغییر قیمت گروهی</strong><small>با تاریخچه و بازگردانی</small></button></section></>}
       {page==='products' && <><div className="section-heading catalog-heading"><div><span className="eyebrow">کاتالوگ فروشگاه</span><h1>کالاها</h1></div><button className="primary" onClick={() => { clearProductForm(); setProductFormOpen(true); }}>+ کالای تازه</button></div>{catalog('browse')}{productFormOpen && <div className="sheet-backdrop" onClick={clearProductForm}><section className="editor-sheet" onClick={event => event.stopPropagation()} aria-label={editingId ? 'ویرایش کالا' : 'افزودن کالا'}><div className="sheet-header"><h2>{editingId ? 'ویرایش کالا' : 'کالای تازه'}</h2><button aria-label="بستن" onClick={clearProductForm}>×</button></div><form onSubmit={saveProduct} className="form"><p className="field-hint">نام و مدل را دقیق بنویسید تا میانبر جست‌وجوی اینترنتی نتیجهٔ بهتری بدهد.</p><label>نام کالا<input value={name} onChange={e => setName(e.target.value)} required placeholder="مثلاً کیف دستی چرم"/></label><div className="form-pair"><label>مدل<input value={model} onChange={e => setModel(e.target.value)} placeholder="کد یا مدل"/></label><label>رنگ<input value={color} onChange={e => setColor(e.target.value)} placeholder="مثلاً قهوه‌ای"/></label></div><label>دسته / زیردسته<input value={category} onChange={e => setCategory(e.target.value)} placeholder="مثلاً کیف/دستی/چرم"/><small>برای زیردسته از / استفاده کنید.</small></label><div className="form-pair"><label>قیمت (ریال)<input inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} required placeholder="۱٬۲۵۰٬۰۰۰"/></label><label>موجودی<input inputMode="numeric" value={stock} onChange={e => setStock(e.target.value)} placeholder="۰"/></label></div><label>عکس کالا، اختیاری<input type="file" accept="image/*" onChange={async event => { const file = event.target.files?.[0]; if (file) try { setPhotoDataUrl(await prepareProductPhoto(file)); } catch (error) { alert((error as Error).message); } }}/></label>{photoDataUrl && <img className="photo-preview" src={photoDataUrl} alt="پیش‌نمایش عکس کالا"/>}<button className="primary" type="submit">{editingId ? 'ذخیرهٔ تغییرها' : 'ثبت کالا'}</button>{editingId && <div className="editor-secondary"><button type="button" onClick={() => editPrice(data.products.find(item => item.id === editingId)!)}>تغییر سریع قیمت</button><button type="button" onClick={() => archiveProduct(data.products.find(item => item.id === editingId)!)}>بایگانی کالا</button></div>}</form></section></div>}</>}
       {page==='customers' && <><div className="section-heading"><div><span className="eyebrow">باشگاه مشتریان</span><h1>مشتریان</h1></div><button className="primary" disabled={!customers.length} onClick={exportCustomersCsv}>خروجی CSV</button></div><div className="customer-layout"><section className="card"><label className="catalog-search">جست‌وجوی نام یا شماره<input type="search" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="نام یا شمارهٔ همراه"/></label><div className="customer-list">{customers.filter(item => normalizeSearch(`${item.name} ${item.phone}`).includes(normalizeSearch(customerSearch))).map(item => <button key={item.id} className={selectedCustomerId === item.id ? 'active' : ''} onClick={() => setSelectedCustomerId(item.id)}><strong>{item.name}</strong><span dir="ltr">{item.phone || 'بدون شماره'}</span><small>{formatRial(item.invoiceCount)} فاکتور</small></button>)}{!customers.length && <p className="empty">با ثبت نخستین فاکتور به نام مشتری، پروندهٔ او اینجا ساخته می‌شود.</p>}</div></section><section className="card"><h2>{customers.find(item => item.id === selectedCustomerId)?.name || 'پروندهٔ مشتری'}</h2>{selectedCustomerId ? <div className="saved-invoices">{customerInvoices.map(entry => <button key={entry.receipt.id} onClick={() => { setReceipt(entry.receipt); setInvoiceNo(String(entry.receipt.number)); changePage('invoice'); }}>فاکتور {formatRial(entry.receipt.number)} · {new Date(entry.receipt.at).toLocaleDateString('fa-IR-u-ca-persian')} · {formatRial(entry.receipt.totalRial)} ریال</button>)}{!customerInvoices.length && <p className="empty">فاکتوری برای این مشتری ثبت نشده است.</p>}</div> : <p className="empty">برای دیدن خریدهای قبلی، نام یک مشتری را انتخاب کنید.</p>}</section></div></>}
       {page==='sale' && <><div className="sale-header"><div><span className="eyebrow">۱ از ۲ · انتخاب کالا</span><h1>فاکتور جدید</h1></div><button className="text-button" onClick={newInvoice}>شروع دوباره</button></div>
         {!customerStepDone ? <section className="customer-start card"><h2>مشخصات مشتری</h2><p className="muted">برای ثبت در باشگاه مشتریان، نام و شمارهٔ همراه را وارد کنید.</p><div className="customer-strip"><label>نام<input value={customerFirst} onChange={event => setCustomerFirst(event.target.value)} placeholder="نام"/></label><label>نام خانوادگی<input value={customerLast} onChange={event => setCustomerLast(event.target.value)} placeholder="نام خانوادگی"/></label><label>شمارهٔ همراه<input value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} inputMode="tel" dir="ltr" placeholder="09…"/></label></div><div className="customer-actions"><button className="primary" onClick={() => { const mobile = latinDigits(customerPhone).replace(/[\s-]/g, ''); if (!customerFirst.trim() || !customerLast.trim()) return alert('نام و نام خانوادگی مشتری را وارد کنید.'); if (!/^09\d{9}$/.test(mobile)) return alert('شمارهٔ همراه را به صورت ۰۹ و ۱۱ رقم وارد کنید.'); setCustomerPhone(mobile); setCustomerStepDone(true); }}>ادامه و انتخاب کالا ←</button><button className="text-button" onClick={() => { setCustomerFirst(''); setCustomerLast(''); setCustomerPhone(''); setCustomerStepDone(true); }}>فروش به خریدار حضوری</button></div></section> : <><div className="customer-summary"><span>{customer || 'خریدار حضوری'} {customerPhone && `· ${customerPhone}`}</span><button onClick={() => setCustomerStepDone(false)}>ویرایش مشتری</button></div>{catalog('sale')}<div className="cart-dock"><button className="cart-toggle" onClick={() => setCartOpen(true)}><span>سبد · {formatRial(draftLines.reduce((sum, line) => sum + line.quantity, 0))} کالا</span><strong>{formatRial(draftTotal)} ریال</strong></button><button className="primary" onClick={() => changePage('invoice')} disabled={!draftLines.length}>بازبینی فاکتور ←</button></div></>}
         {cartOpen && <div className="sheet-backdrop" onClick={() => setCartOpen(false)}><section className="cart-sheet" onClick={event => event.stopPropagation()} aria-label="سبد فاکتور"><div className="sheet-header"><h2>سبد این مشتری</h2><button aria-label="بستن سبد" onClick={() => setCartOpen(false)}>×</button></div>{draftLines.length ? draftLines.map((line, index) => <div className="cart-row" key={`${line.productId || line.name}-${index}`}><div><strong>{line.name}</strong><small>{formatRial(line.unitPriceRial ?? 0)} ریال × {formatRial(line.quantity)}</small></div><div className="quantity-stepper"><button aria-label={`کاهش ${line.name}`} onClick={() => line.quantity > 1 ? updateCartQuantity(index, String(line.quantity - 1)) : setDraftLines(current => current.filter((_, i) => i !== index))}>−</button><input aria-label={`تعداد ${line.name}`} type="number" min="1" defaultValue={line.quantity} key={`${index}-${line.quantity}`} onBlur={event => updateCartQuantity(index, event.target.value)} inputMode="numeric"/><button aria-label={`افزایش ${line.name}`} onClick={() => updateCartQuantity(index, String(line.quantity + 1))}>+</button></div></div>) : <p className="empty">هنوز کالایی انتخاب نشده است.</p>}<button className="primary" disabled={!draftLines.length} onClick={() => changePage('invoice')}>بازبینی فاکتور · {formatRial(draftTotal)} ریال</button></section></div>}</>}
       {page==='prices' && <><div className="section-heading"><div><span className="eyebrow">کنترل قیمت</span><h1>افزایش گروهی</h1></div></div><div className="two-col"><section className="card"><h2>انتخاب کالا و درصد</h2><p className="muted">اگر کالایی تیک نخورد، همهٔ کالاهای فعال انتخاب می‌شوند.</p><label className="form">درصد افزایش<input inputMode="decimal" value={percent} onChange={e=>setPercent(e.target.value)} placeholder="مثلاً ۱۰"/></label><div className="checks">{active.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...selected,p.id]:selected.filter(x=>x!==p.id))}/><span>{p.name}</span><small>{formatRial(p.priceRial)} ریال</small></label>)}</div><button className="primary" onClick={applyBatch} disabled={!active.length}>اعمال به {selected.length || active.length} کالا</button></section><section className="card"><h2>تاریخچهٔ گروهی</h2>{data.batches.length? data.batches.map(b=><article className="batch" key={b.id}><div><strong>{formatPercent(b.percentBasisPoints)}٪ افزایش</strong><small>{new Date(b.at).toLocaleString('fa-IR')} · {b.productIds.length} کالا {b.undoneAt?'· بازگردانی‌شده':''}</small></div><button onClick={()=>undo(b)} disabled={!!b.undoneAt}>{b.undoneAt?'بازگردانی شد':'بازگردانی'}</button></article>):<p className="empty">هنوز تغییری ثبت نشده است.</p>}<p className="muted">در صورت تغییر مستقل قیمت پس از این عملیات، بازگردانی آن کالا را دست‌نخورده نگه می‌دارد.</p></section></div></>}
      {page==='invoice' && <>
         <div className="section-heading"><div><span className="eyebrow">۲ از ۲ · بازبینی</span><h1>{receipt ? `فاکتور شمارهٔ ${receipt.number}` : 'پیش‌نمایش فاکتور'}</h1></div><div className="toolbar"><label><input type="checkbox" checked={mono} onChange={e=>setMono(e.target.checked)}/> سیاه‌وسفید</label><button className="primary" onClick={()=>window.print()} disabled={nativeDevice} title={nativeDevice ? 'چاپ بومی هنوز آماده نیست' : undefined}>چاپ آزمایشی</button></div></div>
        <div className="invoice-layout">
           <section className="card controls invoice-editor">
             <h2>{receipt ? (selectedInvoiceStatus === 'void' ? 'سند باطل‌شده' : 'سند ثبت‌شده') : 'تنظیمات این فاکتور'}</h2>
             {receipt ? <><button onClick={newInvoice}>+ فاکتور تازه</button><button onClick={() => shareInvoiceText(receipt)}>اشتراک متن فاکتور / پیامک</button><button onClick={() => copyInvoiceText(receipt)}>کپی متن فاکتور</button>{nativeDevice && selectedInvoiceStatus === 'issued' && <button onClick={voidSelectedInvoice}>ابطال فاکتور و بازگردانی موجودی</button>}</> : <>
               <button className="text-button" onClick={() => changePage('sale')}>← بازگشت به انتخاب کالا</button>
               <div className="form-pair"><label>نام خریدار<input value={customerFirst} onChange={e => setCustomerFirst(e.target.value)}/></label><label>نام خانوادگی<input value={customerLast} onChange={e => setCustomerLast(e.target.value)}/></label></div>
               <label>شمارهٔ تماس<input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} inputMode="tel" dir="ltr"/></label>
               <label>تاریخ شمسی فاکتور<input value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} placeholder={jalaliToday()}/><small>خالی بماند تا هنگام ثبت از ساعت گوشی خوانده شود.</small></label>
               <div className="draft-lines" aria-label="ردیف‌های فاکتور">{draftDisplayLines.map((line,index) => <div className="draft-edit-line" key={index}><label className="line-select"><input type="checkbox" checked={invoiceSelectedLines.includes(index)} onChange={event => setInvoiceSelectedLines(event.target.checked ? [...invoiceSelectedLines, index] : invoiceSelectedLines.filter(item => item !== index))}/>{line.name}</label><div className="line-inputs"><label>تعداد<input type="number" min="1" defaultValue={line.quantity} key={`${index}-${line.quantity}`} onBlur={event => updateCartQuantity(index, event.target.value)} inputMode="numeric"/></label><label>فی (ریال)<input defaultValue={line.unitPriceRial} key={`${index}-${line.unitPriceRial}`} onBlur={event => updateCartPrice(index, event.target.value)} inputMode="numeric"/></label><button aria-label={`حذف ${line.name}`} onClick={() => setDraftLines(current => current.filter((_, i) => i !== index))}>حذف</button></div><small>جمع ردیف: {formatRial(line.totalRial)} ریال</small></div>)}</div>
               <details className="manual-entry"><summary>افزودن ردیف دستی</summary><label>شرح کالا یا خدمت<input value={manualName} onChange={e => setManualName(e.target.value)}/></label><div className="form-pair"><label>قیمت (ریال)<input inputMode="numeric" value={manualPrice} onChange={e => setManualPrice(e.target.value)}/></label><label>تعداد<input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)}/></label></div><button onClick={addInvoiceLine} disabled={!manualName.trim() || !manualPrice.trim()}>افزودن ردیف</button></details>
               <div className="invoice-percent"><label>افزایش درصدی همین فاکتور<input inputMode="decimal" value={invoicePercent} onChange={e => setInvoicePercent(e.target.value)} placeholder="مثلاً ۱۰"/></label><button onClick={applyInvoicePercent} disabled={!draftLines.length}>اعمال به {invoiceSelectedLines.length || draftLines.length} ردیف</button></div>
               <strong className="invoice-grand-total">جمع: {formatRial(draftTotal)} ریال</strong>
               {nativeDevice ? <><button className="primary" onClick={issue} disabled={!draftLines.length || issuing}>{issuing ? 'در حال ثبت…' : 'ثبت نهایی و کسر موجودی'}</button><p className="muted">شمارهٔ فاکتور هنگام ثبت قطعی تخصیص می‌یابد.</p></> : <p className="muted">این مرورگر فقط پیش‌نمایش است. ثبت قطعی در برنامهٔ نصب‌شده انجام می‌شود.</p>}
             </>}
             {nativeDevice && <details className="history-panel"><summary>تاریخچهٔ فاکتورها ({formatRial(invoices.length)})</summary><label>جست‌وجوی شماره، خریدار، کالا یا تاریخ<input value={invoiceSearch} onChange={event => setInvoiceSearch(event.target.value)} placeholder="شماره یا نام یا تاریخ"/></label><div className="saved-invoices">{visibleInvoices.map(entry => <button key={entry.receipt.id} onClick={() => { setReceipt(entry.receipt); setInvoiceNo(String(entry.receipt.number)); }}>{`شمارهٔ ${entry.receipt.number} · ${entry.status === 'void' ? 'باطل‌شده' : 'صادرشده'} · ${entry.receipt.customerName || 'خریدار حضوری'} · ${formatRial(entry.receipt.totalRial)} ریال`}</button>)}{!visibleInvoices.length && <p className="empty">فاکتوری پیدا نشد.</p>}</div></details>}
           </section>
          <section className={`invoice ${mono?'mono':''}`} aria-label="پیش‌نمایش فاکتور">
            <div className="invoice-top"><img src={storeLogo} alt="نشان فروشگاه"/><div><h2>{displayData.storeName}</h2><strong>{displayData.slogan}</strong><p>{displayData.phone}<br/>{displayData.address}</p></div></div>
            {(receipt?.showCardNumber ?? (receipt ? true : preferences.showCardNumber)) && <div className="invoice-cardline">شماره کارت <b dir="ltr">{displayData.card}</b> · {displayData.cardHolder}</div>}
            <div className="invoice-note">{displayData.note}</div>
            <div className="invoice-meta"><span>شماره فاکتور: <b>{invoiceNo}</b></span><span>تاریخ شمسی: <b>{receipt?.dateJalali || invoiceDate || jalaliToday()}</b></span><span>ساعت: <b>{new Date(receipt?.at ?? Date.now()).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</b></span><span>خریدار: <b>{receipt?.customerName || customer || '—'}</b></span><span>تماس: <b dir="ltr">{receipt?.customerPhone || customerPhone || '—'}</b></span></div>
            <table><thead><tr><th>ردیف</th><th>شرح کالا</th><th>تعداد</th><th>فی (ریال)</th><th>مبلغ کل (ریال)</th></tr></thead><tbody>{displayLines.length ? displayLines.map((line,index)=><tr key={index}><td>{formatRial(index+1)}</td><td>{line.name}</td><td>{formatRial(line.quantity)}</td><td>{formatRial(line.unitPriceRial)}</td><td>{formatRial(line.totalRial)}</td></tr>) : <tr><td colSpan={5}>کالا انتخاب نشده است</td></tr>}</tbody></table>
            <div className="invoice-bottom"><div className="invoice-terms"><h3>شرایط فروش و تحویل کالا</h3><ol>{displayData.conditions.map((c,i)=><li key={i}>{c}</li>)}</ol></div><div className="invoice-totals"><div>جمع کل <b>{formatRial(displayTotal)}</b></div><div>مبلغ نهایی <b>{formatRial(displayTotal)} ریال</b></div><div className="signatures"><span>امضای خریدار</span><span>امضای فروشنده</span></div></div></div>
          </section>
        </div>
      </>}
       {page==='settings' && <><div className="section-heading"><div><span className="eyebrow">شخصی‌سازی</span><h1>تنظیمات</h1></div></div><section className="card preference-card"><h2>نحوهٔ کار برنامه</h2>{([['compactCards','نمایش فشردهٔ کالاها'],['showStock','نمایش موجودی روی کارت کالا'],['showCardNumber','نمایش شماره کارت در فاکتور'],['confirmIssue','تأیید دوباره پیش از ثبت فاکتور']] as const).map(([key,label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={event => setPreference(key, event.target.checked)}/></label>)}</section><section className="card"><h2>اطلاعات فروشگاه و متن فاکتور</h2><p className="muted">هر تغییر در پیش‌نمایش دیده می‌شود. {nativeDevice ? 'برای حفظ آن، نسخهٔ جدید قالب را ذخیره کنید.' : 'قالب نسخه‌دار در برنامهٔ نصب‌شده ذخیره می‌شود.'}</p><div className="settings-grid">{([['storeName','نام فروشگاه'],['slogan','شعار'],['phone','تلفن‌ها'],['address','نشانی'],['card','شماره کارت'],['cardHolder','نام صاحب کارت'],['note','یادآوری پرداخت']] as const).map(([key,label]) => <label key={key}>{label}<input value={data[key]} onChange={e => changeField(key,e.target.value)}/></label>)}</div><details><summary>ویرایش شش بند شرایط فروش</summary>{data.conditions.map((c,i) => <label className="condition-field" key={i}>بند {i+1}<textarea value={c} rows={3} onChange={e => save({ ...data, conditions: data.conditions.map((x,j) => j === i ? e.target.value : x) })}/></label>)}</details>{nativeDevice && <button className="primary" onClick={persistTemplate}>ذخیرهٔ نسخهٔ جدید قالب {templateVersion ? `(فعلی: ${templateVersion})` : ''}</button>}</section></>}
       {page==='support' && <div className="support card"><img src={majoraLogo} alt="لوگوی MAJORA"/><span className="eyebrow">توسعه و پشتیبانی</span><h1>ماژورا</h1><p>شرکت نرم‌افزاری و توسعهٔ کسب‌وکار ماژورا</p><strong>نرم‌افزار به سبک کار شما</strong><p>برای راهنمایی برنامه یا درخواست توسعهٔ اختصاصی:</p><div className="support-links"><a href="tel:09105796971">تماس: ۰۹۱۰-۵۷۹-۶۹۷۱</a><a href="tel:09019990440">تماس: ۰۹۰۱-۹۹۹-۰۴۴۰</a><a href="https://www.instagram.com/majora_app/" target="_blank" rel="noreferrer">اینستاگرام: ‎@majora_app</a></div></div>}
       {inspectedProduct && <div className="sheet-backdrop" onClick={() => setInspectedProductId(null)}><section className="product-detail-sheet" onClick={event => event.stopPropagation()} aria-label={`جزئیات ${inspectedProduct.name}`}><div className="sheet-header"><h2>جزئیات کالا</h2><button aria-label="بستن جزئیات" onClick={() => setInspectedProductId(null)}>×</button></div><div className="detail-photo"><ProductImage product={inspectedProduct}/></div><h2>{inspectedProduct.name}</h2><p>{[inspectedProduct.model, inspectedProduct.color, inspectedProduct.category.replaceAll('/', ' › ')].filter(Boolean).join(' · ')}</p><p><strong>{formatRial(inspectedProduct.priceRial)} ریال</strong> · موجودی {formatRial(inspectedProduct.stock)}</p>{page === 'sale' ? <button className="primary" onClick={() => { addProductToCart(inspectedProduct); setInspectedProductId(null); }}>+ افزودن به فاکتور</button> : <button className="primary" onClick={() => { startProductEdit(inspectedProduct); setInspectedProductId(null); }}>ویرایش کالا</button>}</section></div>}
     </main><footer className="mobile-nav">{nav.slice(0, 4).map(n => <button key={n.key} className={page===n.key?'active':''} onClick={() => changePage(n.key)}><span aria-hidden="true">{n.icon}</span>{n.label}</button>)}<button onClick={() => setMenuOpen(true)}><span aria-hidden="true">☰</span>بیشتر</button></footer></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
