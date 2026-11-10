import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import './global-search.css';

export type SearchHit = { kind: 'product' | 'customer' | 'invoice' | 'cheque' | 'reminder' | 'purchase' | 'expense'; id: string; title: string; subtitle: string };
const labels: Record<SearchHit['kind'], string> = { product: 'کالا', customer: 'مشتری', invoice: 'فاکتور', cheque: 'چک', reminder: 'یادآور', purchase: 'خرید', expense: 'هزینه' };

export function GlobalSearch({ onPick }: { onPick: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchHit['kind'] | 'all'>('all');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    const term = query.trim();
    if (!term) { setHits([]); setBusy(false); setError(''); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true); setError('');
      void api<SearchHit[]>(`/merchant/search?q=${encodeURIComponent(term)}`).then(value => { if (active) setHits(value); })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : 'جست‌وجو انجام نشد.'); })
        .finally(() => { if (active) setBusy(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  const visible = kind === 'all' ? hits : hits.filter(hit => hit.kind === kind);
  return <div className="global-search" ref={root} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    <input type="search" value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} maxLength={100} placeholder="جست‌وجو در کل فروشگاه…" aria-label="جست‌وجوی همگانی" aria-expanded={open && !!query} aria-controls="global-search-results" />
    {open && query.trim() && <div id="global-search-results" className="global-search-results" role="region" aria-label="نتایج جست‌وجو"><div className="global-search-head"><strong>نتایج جست‌وجو</strong><select aria-label="فیلتر نوع نتیجه" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="all">همه</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {busy ? <p role="status">در حال جست‌وجو…</p> : error ? <p role="alert" className="field-error">{error}</p> : visible.length ? visible.map(hit => <button type="button" key={`${hit.kind}-${hit.id}`} onClick={() => { onPick(hit); setOpen(false); setQuery(''); }}><span className="global-search-kind">{labels[hit.kind]}</span><span><strong>{hit.title}</strong><small>{hit.subtitle}</small></span><b aria-hidden="true">↖</b></button>) : <p>موردی پیدا نشد. عبارت یا فیلتر را تغییر دهید.</p>}
    </div>}
  </div>;
}
