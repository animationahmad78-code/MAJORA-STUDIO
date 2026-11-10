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
  const load = () => api<(Product | Customer | Invoice)[]>(`/merchant/archive/${kind}?q=${encodeURIComponent(query)}&page=${page}`).then(setItems);
  useEffect(() => { void load().catch(() => setItems([])); }, [kind, query, page]);
  const chooseKind = (next: Kind) => { setKind(next); setPage(1); setQuery(''); };
  return <><div className="page-intro"><h2>بایگانی</h2><p>اقلام بایگانی‌شده در عملیات روزمره پنهان‌اند و از اینجا بازگردانده می‌شوند. سوابق مالی فاکتورها حفظ می‌ماند.</p></div>
    <section className="card"><div className="archive-tabs" role="tablist" aria-label="نوع بایگانی">{(Object.keys(labels) as Kind[]).map(x => <button role="tab" aria-selected={kind === x} className={kind === x ? 'active' : ''} key={x} onClick={() => chooseKind(x)}>{labels[x]}</button>)}</div>
      <div className="card-head"><h2>{labels[kind]}ی بایگانی‌شده</h2><input className="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="جست‌وجو در بایگانی" aria-label="جست‌وجو در بایگانی"/></div>
      {items.length ? <div className="list">{items.map(item => <div className="list-row" key={item.id}><div><strong>{kind === 'products' ? (item as Product).name : kind === 'customers' ? (item as Customer).name : `فاکتور ${(item as Invoice).number} · ${(item as Invoice).customerName}`}</strong> {kind === 'invoices' && <PaymentBadge status={(item as Invoice).paymentStatus}/>}<small>{kind === 'products' ? `${(item as Product).sku} · ${rial((item as Product).priceRial)}` : kind === 'customers' ? (item as Customer).phone : `${dateFa((item as Invoice).issuedAt)} · ${rial((item as Invoice).totalRial)}`}</small></div><div className="archive-row-actions">{kind === 'invoices' && <button onClick={() => setPreview(item.id)}>مشاهده / چاپ</button>}<button onClick={() => void run(async () => { await api(`/merchant/archive/${kind}/${item.id}/restore`, 'POST'); await load(); }, 'از بایگانی بازگردانده شد.')}>بازگردانی</button></div></div>)}</div> : <div className="empty">موردی در این بخش پیدا نشد.</div>}
      <div className="price-pager"><button disabled={page === 1} onClick={() => setPage(page - 1)}>صفحهٔ قبل</button><span>صفحهٔ {page}</span><button disabled={items.length < 50} onClick={() => setPage(page + 1)}>صفحهٔ بعد</button></div>
    </section>{preview && <InvoicePreview id={preview} close={() => setPreview(null)}/>}</>;
}
