import { useState } from 'react';
import { formatRial } from '@majora/domain';
import type { Dashboard, SalesPeriod } from './dashboard';
import './dashboard-view.css';

type Props = { data: Dashboard; period: SalesPeriod; onPeriod: (period: SalesPeriod) => void; onSale: () => void; onProducts: () => void; onInvoices: () => void };

export function DashboardView({ data, period, onPeriod, onSale, onProducts, onInvoices }: Props) {
  const [showTrend, setShowTrend] = useState(true);
  const [showInventory, setShowInventory] = useState(true);
  const [showTop, setShowTop] = useState(true);
  const max = Math.max(1, ...data.trend.map(item => item.revenueRial));
  return <div className="dashboard">
    <header className="dashboard-hero"><img className="dashboard-store-mark" src="/brand/store-logo-gold.png" alt="لوگوی کیف و کمربند کلاسیک"/><div><span>فروشگاه شما · آفلاین</span><h1>کسب‌وکارت هوشمنده؛<br/>تو فقط رشدش بده!</h1><p>فروش امروز، موجودی و مشتری‌ها زیر نگاه توست.</p></div><button onClick={onSale}>+ فاکتور جدید</button></header>
    <div className="dashboard-filter" role="group" aria-label="بازهٔ گزارش فروش">{([['day','امروز'],['week','این هفته'],['month','این ماه']] as const).map(([key, label]) => <button key={key} className={period === key ? 'selected' : ''} onClick={() => onPeriod(key)}>{label}</button>)}</div>
    <div className="dashboard-kpis"><article><span>فروش قطعی</span><strong>{formatRial(data.revenueRial)}</strong><small>ریال</small></article><article><span>فاکتور</span><strong>{formatRial(data.invoiceCount)}</strong><small>صادرشده</small></article><article><span>تعداد فروش</span><strong>{formatRial(data.itemsSold)}</strong><small>عدد کالا/خدمت</small></article><article><span>مشتری تازه</span><strong>{formatRial(data.newCustomers)}</strong><small>ثبت‌شده</small></article></div>
    <section className="dashboard-insight"><div><strong>میانگین هر فاکتور</strong><span>{formatRial(data.averageInvoiceRial)} ریال</span></div><div><strong>کالاهای کم‌موجود</strong><span>{formatRial(data.lowStock.length)} کالا</span></div></section>
    <div className="dashboard-options"><span>نمایش گزارش‌ها</span><label><input type="checkbox" checked={showTrend} onChange={event => setShowTrend(event.target.checked)}/>روند</label><label><input type="checkbox" checked={showTop} onChange={event => setShowTop(event.target.checked)}/>پرفروش‌ها</label><label><input type="checkbox" checked={showInventory} onChange={event => setShowInventory(event.target.checked)}/>موجودی</label></div>
    {showTrend && <section className="dashboard-panel"><div className="dashboard-panel-head"><div><h2>روند فروش ۷ روز اخیر</h2><p>بر اساس زمان ثبت فاکتور</p></div><button onClick={onInvoices}>همهٔ فاکتورها</button></div><div className="sales-chart" role="img" aria-label="نمودار فروش روزانهٔ هفت روز اخیر">{data.trend.map((item, index) => <div className="sales-column" key={index} title={`${item.label}: ${formatRial(item.revenueRial)} ریال`}><strong>{item.revenueRial ? formatRial(item.revenueRial) : '—'}</strong><div className="sales-bar-track"><div style={{ height: `${Math.max(item.revenueRial ? 5 : 0, item.revenueRial / max * 100)}%` }}/></div><small>{item.label}</small></div>)}</div></section>}
    <div className="dashboard-grid">{showTop && <section className="dashboard-panel"><div className="dashboard-panel-head"><h2>پرفروش‌ترین کالاها</h2><button onClick={onProducts}>دیدن کالاها</button></div>{data.topProducts.length ? data.topProducts.map((product, index) => <div className="dashboard-list-row" key={product.key}><b>{formatRial(index + 1)}</b><span>{product.name}</span><small>{formatRial(product.units)} عدد · {formatRial(product.revenueRial)} ریال</small></div>) : <p className="dashboard-empty">در این بازه فروش ثبت نشده است.</p>}</section>}
      {showInventory && <section className="dashboard-panel"><div className="dashboard-panel-head"><h2>موجودی دسته‌ها</h2><button onClick={onProducts}>مدیریت موجودی</button></div>{data.inventory.length ? data.inventory.map(item => <div className="inventory-row" key={item.category}><div><strong>{item.category}</strong><small>{formatRial(item.units)} عدد · {formatRial(item.products)} کالا</small></div><div className="inventory-track"><span style={{ width: `${item.products ? (item.products - item.lowOrEmpty) / item.products * 100 : 0}%` }}/></div><small>{formatRial(item.lowOrEmpty)} کالای کم‌موجود</small></div>) : <p className="dashboard-empty">هنوز کالایی ثبت نشده است.</p>}</section>}</div>
    {!!data.lowStock.length && showInventory && <section className="dashboard-panel"><h2>نیازمند بررسی موجودی</h2><div className="low-stock-list">{data.lowStock.map(product => <span key={product.id}>{product.name} · {formatRial(product.stock)} عدد</span>)}</div></section>}
  </div>;
}
