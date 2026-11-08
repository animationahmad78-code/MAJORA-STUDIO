import { useEffect, useRef, useState } from 'react';
import { api, dateFa, rial, type Product } from './api';
import './price-batches.css';

type PriceBatch = { id: string; percent: number; createdAt: string; revertedAt: string | null; count: number };
type PriceLine = { id: string; productId: string; nameSnapshot: string; oldPriceRial: number; newPriceRial: number };
type ProductMeta = { count: number; categories: string[] };

export function PriceBatches({ run }: { run: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<ProductMeta>({ count: 0, categories: [] });
  const [batches, setBatches] = useState<PriceBatch[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailQuery, setDetailQuery] = useState('');
  const [detailPage, setDetailPage] = useState(1);
  const [detailLines, setDetailLines] = useState<PriceLine[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, Product>>({});
  const [all, setAll] = useState(false);
  const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const key = useRef(crypto.randomUUID());
  const load = () => Promise.all([
    api<ProductMeta>('/merchant/products/meta').then(setMeta),
    api<PriceBatch[]>('/merchant/price-batches').then(setBatches),
  ]);
  useEffect(() => { void load().catch(() => {}); }, []);
  useEffect(() => {
    let cancelled = false;
    void api<Product[]>(`/merchant/products?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}&page=${page}`)
      .then(value => { if (!cancelled) setItems(value); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [query, category, page]);
  useEffect(() => {
    if (!detailId) return;
    let cancelled = false;
    void api<PriceLine[]>(`/merchant/price-batches/${detailId}/lines?q=${encodeURIComponent(detailQuery)}&page=${detailPage}`)
      .then(value => { if (!cancelled) setDetailLines(value); }).catch(() => { if (!cancelled) setDetailLines([]); });
    return () => { cancelled = true; };
  }, [detailId, detailQuery, detailPage]);
  const count = all ? meta.count : Object.keys(selected).length;
  const validPercent = /^\d+(?:\.\d{1,3})?$/.test(percent) && Number(percent) > 0 && Number(percent) <= 1000;
  const updateFilter = (value: string, type: 'query' | 'category') => { setPage(1); if (type === 'query') setQuery(value); else setCategory(value); };
  const apply = async () => {
    if (!validPercent || !count || busy) return;
    setBusy(true);
    await run(async () => {
      await api('/merchant/price-batches', 'POST', { idempotencyKey: key.current, percent: Number(percent), allProducts: all, productIds: all ? [] : Object.keys(selected) });
      key.current = crypto.randomUUID();
      setSelected({}); setAll(false); setPercent(''); setConfirming(false);
      await load();
    }, 'قیمت‌ها ثبت شدند و تاریخچهٔ بازگردانی ذخیره شد.');
    setBusy(false);
  };
  return <><div className="page-intro"><h2>افزایش قیمت</h2><p>کالاهای دلخواه را جست‌وجو و انتخاب کنید یا افزایش را برای تمام کالاهای فعال اجرا کنید.</p></div>
    <div className="two-col wide-right"><section className="card"><div className="card-head"><h2>افزایش گروهی</h2></div>
      <label>درصد افزایش<input type="text" inputMode="decimal" dir="ltr" value={percent} onChange={e => setPercent(e.target.value.replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))))} placeholder="مثلاً ۱۰" aria-describedby="price-percent-help"/></label>
      <p id="price-percent-help" className="hint">ریال جدید با گرد کردن نیم‌ریال به بالا محاسبه می‌شود. فاکتورهای قبلی تغییر نمی‌کنند.</p>
      <label className="check-label"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)}/>همهٔ {meta.count} کالای فعال انتخاب شوند</label>
      <p className="price-selection-status" role="status">{all ? 'تمام کالاهای فعال، حتی خارج از صفحهٔ جست‌وجو، انتخاب شده‌اند.' : `${count} کالا انتخاب شده است.`}</p>
      {!all && count > 0 && <button type="button" onClick={() => setSelected({})}>پاک کردن انتخاب‌ها</button>}
      <button className="primary full" disabled={!validPercent || !count || busy} onClick={() => setConfirming(true)}>بررسی و اعمال افزایش</button>
    </section><section className="card"><div className="card-head"><h2>انتخاب کالا</h2></div><div className="price-filters"><label>جست‌وجوی نام یا کد<input value={query} onChange={e => updateFilter(e.target.value, 'query')} placeholder="نام یا کد کالا"/></label><label>دسته<select value={category} onChange={e => updateFilter(e.target.value, 'category')}><option value="">همهٔ دسته‌ها</option>{meta.categories.filter(Boolean).map(x => <option key={x} value={x}>{x}</option>)}</select></label></div>
      {items.length ? <div className="price-products">{items.map(product => <label className="price-product" key={product.id}><input type="checkbox" checked={all || !!selected[product.id]} disabled={all} onChange={e => setSelected(old => { const next = { ...old }; if (e.target.checked) next[product.id] = product; else delete next[product.id]; return next; })}/><span><strong>{product.name}</strong><small>{product.category || 'بدون دسته'} · کد {product.sku}</small></span><b>{rial(product.priceRial)}</b></label>)}</div> : <div className="empty">کالایی در این جست‌وجو پیدا نشد.</div>}
      <div className="price-pager"><button disabled={page === 1} onClick={() => setPage(page - 1)}>صفحهٔ قبل</button><span>صفحهٔ {page}</span><button disabled={items.length < 50} onClick={() => setPage(page + 1)}>صفحهٔ بعد</button></div>
    </section></div>
    <section className="card"><div className="card-head"><h2>تاریخچهٔ افزایش قیمت</h2></div>{batches.length ? <div className="list">{batches.map(batch => <div key={batch.id}><div className="list-row price-batch-row"><div><strong>{batch.percent}٪ برای {batch.count} کالا</strong><small>{dateFa(batch.createdAt)} · {batch.revertedAt ? 'بازگردانده شده' : 'فعال'}</small></div><button onClick={() => { setDetailId(detailId === batch.id ? null : batch.id); setDetailPage(1); setDetailQuery(''); }} aria-expanded={detailId === batch.id}>جزئیات قیمت‌ها</button>{!batch.revertedAt && <button disabled={busy} onClick={() => { if (!window.confirm('قیمت‌های این نوبت بازگردانده شوند؟ اگر قیمت کالایی بعداً تغییر کرده باشد، بازگردانی انجام نمی‌شود.')) return; setBusy(true); void run(async () => { await api(`/merchant/price-batches/${batch.id}/revert`, 'POST'); await load(); }, 'قیمت‌های نوبت انتخابی بازگردانده شدند.').finally(() => setBusy(false)); }}>بازگردانی قیمت‌ها</button>}</div>{detailId === batch.id && <div className="price-detail"><label>جست‌وجوی کالا در این نوبت<input value={detailQuery} onChange={e => { setDetailQuery(e.target.value); setDetailPage(1); }}/></label><div className="list">{detailLines.map(line => <div className="list-row" key={line.id}><div><strong>{line.nameSnapshot}</strong><small>{rial(line.oldPriceRial)} ← {rial(line.newPriceRial)}</small></div></div>)}</div><div className="price-pager"><button disabled={detailPage === 1} onClick={() => setDetailPage(detailPage - 1)}>صفحهٔ قبل</button><span>صفحهٔ {detailPage}</span><button disabled={detailLines.length < 50} onClick={() => setDetailPage(detailPage + 1)}>صفحهٔ بعد</button></div></div>}</div>)}</div> : <div className="empty">هنوز نوبت افزایش قیمت ثبت نشده است.</div>}</section>
    {confirming && <div className="modal-backdrop" onClick={() => !busy && setConfirming(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="price-confirm-title" onClick={e => e.stopPropagation()}><h2 id="price-confirm-title">تأیید افزایش قیمت</h2><p>قیمت {count} کالا به اندازهٔ {percent}٪ افزایش می‌یابد. قیمت فاکتورهای قبلی ثابت می‌ماند.</p><div className="form-actions"><button className="primary" disabled={busy} onClick={() => void apply()}>{busy ? 'در حال ثبت…' : 'تأیید و اعمال'}</button><button disabled={busy} onClick={() => setConfirming(false)}>انصراف</button></div></div></div>}
  </>;
}
