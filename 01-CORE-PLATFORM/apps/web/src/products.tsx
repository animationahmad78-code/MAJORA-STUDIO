import { useEffect, useRef, useState } from 'react';
import { api, rial, type Product } from './api';
import { CategoryTree } from './category-tree';
import { RialInput } from './rial-input';
import './products.css';

type ProductForm = { name: string; sku: string; category: string; subcategory: string; priceRial: string; stock: string; averageCostRial: string; photoDataUrl: string | null };
const emptyForm = (): ProductForm => ({ name: '', sku: '', category: '', subcategory: '', priceRial: '', stock: '', averageCostRial: '', photoDataUrl: null });
const parseRial = (value: string) => value.replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[^0-9]/g, '');
const photoUrl = (p: Product) => `/api/merchant/products/${p.id}/photo?v=${encodeURIComponent(p.updatedAt)}`;

async function imageData(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('فایل انتخابی تصویر نیست.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('پردازش تصویر در این مرورگر ممکن نیست.');
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', .8);
    if (data.length > 1_400_000) throw new Error('تصویر پس از فشرده‌سازی هنوز بزرگ است؛ تصویر کوچک‌تری انتخاب کنید.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export function ProductsCatalog({ initialQuery = '' }: { initialQuery?: string }) {
  const [items, setItems] = useState<Product[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const load = () => Promise.all([
    api<Product[]>(`/merchant/products?q=${encodeURIComponent(query)}&category=${encodeURIComponent(categoryFilter)}&page=${page}`).then(setItems),
    api<{ categories: string[] }>('/merchant/products/meta').then(x => setCategories(x.categories)),
  ]);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'دریافت کالاها ناموفق بود.')); }, [query, categoryFilter, page]);
  useEffect(() => { if (initialQuery) { setQuery(initialQuery); setCategoryFilter(''); setPage(1); } }, [initialQuery]);
  const chooseImage = async (file?: File) => {
    if (!file) return;
    try { setError(''); const data = await imageData(file); setForm(old => ({ ...old, photoDataUrl: data })); }
    catch (e) { setError(e instanceof Error ? e.message : 'تصویر خوانده نشد.'); }
  };
  const save = async () => {
    const price = Number(form.priceRial), stock = Number(form.stock), cost = form.averageCostRial ? Number(form.averageCostRial) : null;
    if (!form.name.trim() || !form.sku.trim() || !Number.isSafeInteger(price) || !Number.isSafeInteger(stock) || price < 0 || stock < 0 || (cost !== null && (!Number.isSafeInteger(cost) || cost < 0))) { setError('نام، کد، قیمت و موجودی را درست وارد کنید.'); return; }
    const category = [form.category.trim(), form.subcategory.trim()].filter(Boolean).join(' / ');
    setSaving(true); setError(''); setNotice('');
    try {
      await api(`/merchant/products${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', { name: form.name.trim(), sku: form.sku.trim(), category, priceRial: price, stock, averageCostRial: cost, photoDataUrl: form.photoDataUrl });
      setNotice(editing ? 'کالا و تصویرش به‌روز شد.' : 'کالا ثبت شد.'); setForm(emptyForm()); setEditing(null); setShowForm(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'ثبت کالا ناموفق بود.'); }
    finally { setSaving(false); }
  };
  const startEdit = (product: Product) => {
    const parts = product.category.split(' / ');
    setEditing(product);
    setShowForm(true);
    setForm({ name: product.name, sku: product.sku, category: parts[0] ?? '', subcategory: parts.slice(1).join(' / '), priceRial: String(product.priceRial), stock: String(product.stock), averageCostRial: product.costKnown ? String(product.averageCostRial) : '', photoDataUrl: null });
    setMenu(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const archiveProduct = async (product: Product) => {
    if (!window.confirm(`«${product.name}» بایگانی شود؟ این کالا در فروش جدید دیده نمی‌شود و از بایگانی قابل بازگردانی است.`)) return;
    try { setError(''); await api(`/merchant/archive/products/${product.id}`, 'POST'); if (editing?.id === product.id) { setEditing(null); setForm(emptyForm()); setShowForm(false); } setNotice('کالا بایگانی شد.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'بایگانی کالا ناموفق بود.'); }
  };
  const photoPreview = form.photoDataUrl === '' ? null : form.photoDataUrl || (editing?.hasPhoto ? photoUrl(editing) : null);
  const searchLink = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return <div onClick={() => menu && setMenu(null)}><div className="page-intro catalog-intro"><div><h2>کالاها</h2><p>عکس، دسته، قیمت و موجودی هر کالا را از همین صفحه مدیریت کنید.</p></div><button className="primary" onClick={() => { setEditing(null); setForm(emptyForm()); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>＋ کالای جدید</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="product-notice" role="status">{notice}</p>}
    <div className={showForm ? 'two-col wide-right' : 'catalog-only'}>{showForm && <section className="card"><div className="card-head"><h2>{editing ? 'ویرایش کالا' : 'کالای جدید'}</h2><button onClick={() => { setShowForm(false); setEditing(null); setForm(emptyForm()); }} aria-label="بستن فرم کالا">×</button></div><form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>نام و مدل کامل کالا<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={300}/></label><p className="hint">نام دقیق، میانبر مقایسهٔ قیمت و مشخصات کالا را دقیق‌تر می‌کند.</p>
      <div className="form-grid"><label>کد کالا<input dir="ltr" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required/></label><label>موجودی<input inputMode="numeric" value={form.stock} onChange={e => setForm({ ...form, stock: parseRial(e.target.value) })} required/></label></div>
      <div className="form-grid"><label>دستهٔ اصلی<input list="majora-product-categories" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="مثلاً کیف"/></label><label>زیر‌دسته<input value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} placeholder="مثلاً چرم"/></label></div><datalist id="majora-product-categories">{[...new Set(categories.map(x => x.split(' / ')[0]).filter(Boolean))].map(x => <option value={x} key={x}/>)}</datalist>
      <div className="form-grid"><label>قیمت فروش (ریال)<RialInput value={form.priceRial} onValueChange={value => setForm(current => ({ ...current, priceRial: value }))} required/></label><label>بهای خرید هر واحد (ریال)<RialInput value={form.averageCostRial} onValueChange={value => setForm(current => ({ ...current, averageCostRial: value }))}/></label></div>
      <div className="product-photo-edit"><div className="product-photo-preview">{photoPreview ? <img src={photoPreview} alt="پیش‌نمایش عکس کالا"/> : <span>بدون عکس</span>}</div><div><strong>تصویر کالا</strong><p className="hint">تصویر در پروندهٔ این کالا روی سرور نگهداری می‌شود.</p><div className="product-photo-actions"><button type="button" onClick={() => gallery.current?.click()}>انتخاب عکس</button><button type="button" onClick={() => camera.current?.click()}>عکاسی</button>{photoPreview && <button type="button" onClick={() => setForm({ ...form, photoDataUrl: '' })}>حذف عکس</button>}</div></div><input ref={gallery} type="file" accept="image/*" hidden onChange={e => { void chooseImage(e.target.files?.[0]); e.target.value = ''; }}/><input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => { void chooseImage(e.target.files?.[0]); e.target.value = ''; }}/></div>
      <div className="form-actions"><button className="primary" disabled={saving}>{saving ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : 'افزودن کالا'}</button><button type="button" onClick={() => { setShowForm(false); setEditing(null); setForm(emptyForm()); }}>انصراف</button></div>
    </form></section>}<section className="card"><div className="card-head"><h2>فهرست کالاها</h2></div><div className="price-filters"><label>جست‌وجو<input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="نام یا کد کالا"/></label><CategoryTree categories={categories} value={categoryFilter} onChange={value => { setCategoryFilter(value); setPage(1); }}/></div>
      {items.length ? <div className="catalog-grid">{items.map(p => <article className="catalog-card" key={p.id}><div className="catalog-image">{p.hasPhoto ? <img loading="lazy" src={photoUrl(p)} alt={`تصویر ${p.name}`}/> : <span aria-hidden="true">بدون عکس</span>}</div><div className="catalog-body"><strong>{p.name}</strong><small>{p.category || 'بدون دسته'} · موجودی {p.stock}</small><b>{rial(p.priceRial)}</b></div><div className="catalog-actions"><button onClick={() => startEdit(p)}>ویرایش</button><div className="catalog-menu-wrap" onClick={e => e.stopPropagation()}><button aria-label={`میانبرهای ${p.name}`} aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? null : p.id)}>⋮</button>{menu === p.id && <div className="catalog-popover"><a target="_blank" rel="noopener noreferrer" href={searchLink(`قیمت ${p.name} در ترب`)}>قیمت در ترب</a><a target="_blank" rel="noopener noreferrer" href={searchLink(`قیمت ${p.name} در دیجیکالا`)}>قیمت در دیجیکالا</a><a target="_blank" rel="noopener noreferrer" href={searchLink(`مشخصات فنی و کامل ${p.name}`)}>مشخصات کالا</a><button onClick={() => void archiveProduct(p)}>بایگانی کالا</button></div>}</div></div></article>)}</div> : <div className="empty">کالایی پیدا نشد.</div>}
      <div className="price-pager"><button disabled={page === 1} onClick={() => setPage(page - 1)}>صفحهٔ قبل</button><span>صفحهٔ {page}</span><button disabled={items.length < 50} onClick={() => setPage(page + 1)}>صفحهٔ بعد</button></div>
    </section></div>
  </div>;
}
