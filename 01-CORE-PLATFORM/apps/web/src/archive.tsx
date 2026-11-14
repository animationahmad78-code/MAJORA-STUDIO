import { useEffect, useState } from 'react';
import { api, dateFa, rial, type Customer, type Invoice, type Product } from './api';
import { InvoicePreview } from './invoice-preview';
import { PaymentBadge } from './payment-badge';

type Kind = 'products' | 'customers' | 'invoices';
const labels: Record<Kind, string> = { products: 'کالاها', customers: 'مشتریان', invoices: 'فاکتورها' };

export function Archive({ run }: { run: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [kind, setKind] = useState<Kind>('invoices');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<(Product | Customer | Invoice)[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [purging, setPurging] = useState(false);
  const [purgeSummary, setPurgeSummary] = useState('');
  const load = () => api<(Product | Customer | Invoice)[]>(`/merchant/archive/${kind}?q=${encodeURIComponent(query)}&page=${page}`).then(setItems);
  useEffect(() => { void load().catch(() => setItems([])); }, [kind, query, page]);
  const chooseKind = (next: Kind) => { setKind(next); setPage(1); setQuery(''); setSelected([]); setPurgeSummary(''); };
  const purge = async (scope: Kind | 'all', all: boolean, ids: string[] = []) => {
    const description = scope === 'all' ? 'همهٔ گروه‌ها' : all ? `همهٔ ${labels[scope]}ی بایگانی‌شده` : `${ids.length} مورد انتخاب‌شده`;
    if (!window.confirm(`پاک‌سازی ${description}؟ کالا و مشتریِ بدون سابقه برای همیشه حذف می‌شوند. فاکتورها و موارد دارای سابقهٔ مالی حفظ می‌شوند.`)) return;
    setPurging(true); setPurgeSummary('');
    try {
      await run(async () => {
        const result = await api<{ deleted: number; retained: number }>('/merchant/archive/purge', 'POST', { kind: scope, all, ids });
        setPurgeSummary(`${result.deleted} مورد حذف شد؛ ${result.retained} موردِ دارای وابستگی یا سابقه حفظ شد.`);
        setSelected([]);
        await load();
      }, 'پاک‌سازی بایگانی انجام شد.');
    } finally { setPurging(false); }
  };
  const toggle = (id: string) => setSelected(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  return <><div className="page-intro"><h2>بایگانی</h2><p>اقلام بایگانی‌شده در عملیات روزمره پنهان‌اند و از اینجا بازگردانده می‌شوند. سوابق مالی فاکتورها حفظ می‌ماند.</p></div>
    <section className="card archive-purge-head"><div><strong>مدیریت فضای بایگانی</strong><p>فاکتورهای صادرشده و کالا یا مشتریِ دارای سابقهٔ مرتبط حذف نمی‌شوند؛ این موارد برای پیگیری و صحت گزارش‌ها باقی می‌مانند.</p></div><button disabled={purging} onClick={() => void purge('all', true)}>پاک‌سازی همهٔ گروه‌ها</button></section>
    <section className="card"><div className="archive-tabs" role="tablist" aria-label="نوع بایگانی">{(Object.keys(labels) as Kind[]).map(x => <button role="tab" aria-selected={kind === x} className={kind === x ? 'active' : ''} key={x} onClick={() => chooseKind(x)}>{labels[x]}</button>)}</div>
      <div className="card-head"><h2>{labels[kind]}ی بایگانی‌شده</h2><input className="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="جست‌وجو در بایگانی" aria-label="جست‌وجو در بایگانی"/></div>
      {purgeSummary && <p role="status" className="notice">{purgeSummary}</p>}
      {kind !== 'invoices' && <div className="archive-bulk"><label><input type="checkbox" checked={items.length > 0 && items.every(item => selected.includes(item.id))} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...items.map(item => item.id)])] : selected.filter(id => !items.some(item => item.id === id)))} /> انتخاب صفحهٔ فعلی</label><button disabled={purging || !selected.length} onClick={() => void purge(kind, false, selected)}>حذف {selected.length} مورد انتخابی</button><button disabled={purging} onClick={() => void purge(kind, true)}>پاک‌سازی همهٔ {labels[kind]}</button></div>}
      {items.length ? <div className="list">{items.map(item => <div className="list-row" key={item.id}>{kind !== 'invoices' && <input type="checkbox" aria-label={`انتخاب ${kind === 'products' ? (item as Product).name : (item as Customer).name}`} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />}<div><strong>{kind === 'products' ? (item as Product).name : kind === 'customers' ? (item as Customer).name : `فاکتور ${(item as Invoice).number} · ${(item as Invoice).customerName}`}</strong> {kind === 'invoices' && <PaymentBadge status={(item as Invoice).paymentStatus}/>}<small>{kind === 'products' ? `${(item as Product).sku} · ${rial((item as Product).priceRial)}` : kind === 'customers' ? (item as Customer).phone : `${dateFa((item as Invoice).issuedAt)} · ${rial((item as Invoice).totalRial)}`}</small></div><div className="archive-row-actions">{kind === 'invoices' && <button onClick={() => setPreview(item.id)}>مشاهده / چاپ</button>}<button onClick={() => void run(async () => { await api(`/merchant/archive/${kind}/${item.id}/restore`, 'POST'); setSelected(old => old.filter(x => x !== item.id)); await load(); }, 'از بایگانی بازگردانده شد.')}>بازگردانی</button>{kind !== 'invoices' && <button disabled={purging} onClick={() => void purge(kind, false, [item.id])}>حذف کامل</button>}</div></div>)}</div> : <div className="empty">موردی در این بخش پیدا نشد.</div>}
      <div className="price-pager"><button disabled={page === 1} onClick={() => setPage(page - 1)}>صفحهٔ قبل</button><span>صفحهٔ {page}</span><button disabled={items.length < 50} onClick={() => setPage(page + 1)}>صفحهٔ بعد</button></div>
    </section>{preview && <InvoicePreview id={preview} close={() => setPreview(null)}/>}</>;
}
