import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, login, rial, dateFa, type User, type Product } from './api';
import { Invoices } from './invoices';
import { InvoiceBrandSettings, AdminInvoiceBrandSettings } from './invoice-brand-settings';
import { Returns } from './returns';
import { AiSettings } from './ai-settings';
import { PriceBatches } from './price-batches';
import { ProductsCatalog } from './products';
import { Archive } from './archive';
import { SaleWorkspace } from './sale';
import { Cheques } from './cheques';
import { UserManagement } from './user-management';
import { Tenants } from './tenants';
import { AdminBilling, MerchantSubscription } from './subscription-billing';
import { PurchaseEntry } from './purchase-entry';
import { MajoraSupport } from './majora-support';
import { AdminFeatures } from './admin-features';
import { Customers } from './customers';
import { GlobalSearch, type SearchHit } from './global-search';
import { RialInput } from './rial-input';
import { JalaliDateField, isoToJalaliDate, jalaliToIsoDate } from '../../mobile/src/jalali-date';
import './style.css';

type Tab = 'dashboard'|'sale'|'products'|'price-batches'|'customers'|'invoices'|'archive'|'returns'|'invoice-brand'|'accounting'|'cheques'|'reminders'|'advisor'|'subscription'|'staff'|'plans'|'tenants'|'admin-brand'|'ai-settings'|'admin-users'|'admin-features'|'majora-support';
const merchantTabs: [Tab,string,string][] = [['dashboard','خانه','◫'],['sale','فروش جدید','＋'],['products','کالاها','▦'],['price-batches','ویرایش قیمت','↗'],['customers','مشتریان','♙'],['invoices','فاکتورها','▤'],['archive','بایگانی','▣'],['returns','مرجوعی‌ها','↶'],['invoice-brand','قالب فاکتور','◩'],['accounting','مالی و خرید','◈'],['cheques','چک‌ها','▧'],['reminders','یادآورها','◷'],['advisor','تحلیل کسب‌وکار','✦'],['subscription','اشتراک من','◇'],['staff','همکاران','♧'],['majora-support','پشتیبانی ماژورا','✦']];
const adminTabs: [Tab,string,string][] = [['dashboard','نمای کلی','◫'],['tenants','فروشگاه‌ها','▦'],['admin-features','قابلیت‌های فروشگاه‌ها','☷'],['admin-users','کاربران و فعالیت‌ها','♙'],['admin-brand','هویت فروشگاه‌ها','◩'],['plans','طرح‌های اشتراک','◇'],['ai-settings','هوش مصنوعی','✦'],['majora-support','دربارهٔ ماژورا','✦']];
const tabFeature: Partial<Record<Tab,string>> = { sale:'sale', products:'products', 'price-batches':'prices', customers:'customers', invoices:'invoices', archive:'archive', returns:'returns', 'invoice-brand':'invoice-brand', accounting:'accounting', cheques:'cheques', reminders:'reminders', advisor:'advisor', staff:'staff' };
const roleSections: Record<string, Tab[]> = {
  cashier: ['dashboard','sale','products','customers','invoices','returns','reminders','majora-support'],
  staff: ['dashboard','sale','products','customers','invoices','returns','reminders','majora-support'],
  warehouse: ['products','majora-support'],
  accountant: ['dashboard','products','customers','invoices','accounting','cheques','reminders','advisor','majora-support'],
  viewer: ['dashboard','products','customers','invoices','majora-support']
};
const visibleMerchantTabs = (role: string, disabled: string[]) => merchantTabs.filter(([id]) =>
  !disabled.includes(tabFeature[id] ?? '') && (!roleSections[role] || roleSections[role].includes(id)));
const defaultTab = (role: string): Tab => role === 'warehouse' ? 'products' : 'dashboard';

function App() {
  const [user,setUser] = useState<User|null>(null); const [loading,setLoading] = useState(true); const [tab,setTab] = useState<Tab>('dashboard');
  const [menuOpen,setMenuOpen]=useState(false);
  const [returnTarget,setReturnTarget]=useState<string|null>(null);
  const [openedInvoiceId,setOpenedInvoiceId]=useState<string|null>(null);
  const [searchTarget,setSearchTarget]=useState<{kind:SearchHit['kind'];id:string;query:string}|null>(null);
  const [error,setError] = useState(''); const [notice,setNotice] = useState(''); const [brand,setBrand] = useState<{ name:string; logoUrl?:string; brandColor:string }|null>(null);
  const [disabledFeatures,setDisabledFeatures] = useState<string[]>([]);
  const [featuresLoadedFor,setFeaturesLoadedFor] = useState<string|null>(null);
  const [featureLoadError,setFeatureLoadError] = useState('');
  const refreshBrand = () => { if (user && user.role !== 'platform_admin') api<{name:string;logoUrl?:string;brandColor:string}>('/merchant/workspace').then(setBrand).catch(()=>{}); };
  useEffect(()=>{ api<User>('/auth/me').then(setUser).catch(()=>{}).finally(()=>setLoading(false)); },[]);
  useEffect(()=>{
    const sync = () => { api<User>('/auth/me').then(next => { setUser(next); setNotice('نشست این مرورگر تغییر کرد؛ هویت فعال به‌روزرسانی شد.'); }).catch(() => { setUser(null); setBrand(null); }); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'majora.session.changed' && event.newValue?.startsWith(`${sessionStorage.getItem('majora.panel') === 'admin' ? 'admin' : 'merchant'}:`)) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('majora:session-changed', sync);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('majora:session-changed', sync); };
  }, []);
  useEffect(refreshBrand,[user]);
  useEffect(() => {
    if (!user || user.role === 'platform_admin') { setDisabledFeatures([]); setFeaturesLoadedFor(user?.id ?? null); return; }
    setFeaturesLoadedFor(null);
    setFeatureLoadError('');
    api<{disabled:string[]}>('/merchant/features').then(x => { setDisabledFeatures(x.disabled); setFeaturesLoadedFor(user.id); })
      .catch(e => setFeatureLoadError(e instanceof Error ? e.message : 'دسترسی بخش‌ها دریافت نشد.'));
  }, [user?.id]);
  useEffect(() => {
    if (!user || user.role === 'platform_admin') return;
    const refresh = () => { if (document.visibilityState === 'visible') api<{disabled:string[]}>('/merchant/features').then(x => setDisabledFeatures(x.disabled)).catch(() => {}); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [user?.id]);
  useEffect(()=>{
    if (!user) return;
    const allowed = user?.role === 'platform_admin' ? adminTabs : visibleMerchantTabs(user.role, disabledFeatures);
    const fromHash = window.location.hash.match(/^#\/([a-z-]+)$/)?.[1] as Tab | undefined;
    const fallback = allowed.some(([id]) => id === defaultTab(user.role)) ? defaultTab(user.role) : allowed[0]?.[0] ?? 'majora-support';
    const next = fromHash && allowed.some(([id]) => id === fromHash) ? fromHash : fallback;
    if (next === fallback && fromHash && fromHash !== fallback) window.history.replaceState(null, '', `#/${fallback}`);
    setTab(next);
  },[user?.id,disabledFeatures]);
  useEffect(()=>{
    const restore = () => {
      if (!user) return;
      const allowed = user?.role === 'platform_admin' ? adminTabs : visibleMerchantTabs(user.role, disabledFeatures);
      const fromHash = window.location.hash.match(/^#\/([a-z-]+)$/)?.[1] as Tab | undefined;
      const fallback = allowed.some(([id]) => id === defaultTab(user.role)) ? defaultTab(user.role) : allowed[0]?.[0] ?? 'majora-support';
      const next = fromHash && allowed.some(([id]) => id === fromHash) ? fromHash : fallback;
      if (next === fallback && fromHash && fromHash !== fallback) window.history.replaceState(null, '', `#/${fallback}`);
      setTab(next);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore); };
  },[user?.role,disabledFeatures]);
  useEffect(()=>{setMenuOpen(false)},[tab]);
  const navigate = (next: Tab, fromSearch = false) => {
    if (disabledFeatures.includes(tabFeature[next] ?? '')) return;
    if (user?.role !== 'platform_admin' && !visibleMerchantTabs(user?.role ?? '', disabledFeatures).some(([id]) => id === next)) return;
    if (!fromSearch) setSearchTarget(null);
    if (next !== tab) { window.history.pushState(null, '', `#/${next}`); setTab(next); window.scrollTo({ top: 0, behavior: 'instant' }); }
  };
  const openSearchHit = (hit: SearchHit) => {
    if (hit.kind === 'invoice') { setOpenedInvoiceId(hit.id); navigate('invoices'); return; }
    setSearchTarget({ kind: hit.kind, id: hit.id, query: hit.kind === 'cheque' ? hit.title.split(' · ').at(-1) ?? hit.title : hit.title });
    navigate(hit.kind === 'product' ? 'products' : hit.kind === 'customer' ? 'customers' : hit.kind === 'cheque' ? 'cheques' : hit.kind === 'reminder' ? 'reminders' : 'accounting', true);
  };
  const run = async (action:()=>Promise<unknown>, success='ذخیره شد.') => { setError(''); setNotice(''); try { await action(); setNotice(success); } catch (e) { setError(e instanceof Error ? e.message : 'خطا در انجام عملیات'); } };
  const tabs = user?.role === 'platform_admin' ? adminTabs : visibleMerchantTabs(user?.role ?? '', disabledFeatures);
  if (loading) return <div className="splash"><img className="splash-orb" src="/majora-mark.png" alt="MAJORA"/><strong>فضای کاری ماژورا</strong><span>در حال آماده‌سازی فضای کسب‌وکار…</span><small>Powered by MAJORA</small></div>;
  if (!user) return <Login onLogin={setUser} error={error} setError={setError}/>;
  if (featureLoadError) return <div className="feature-load-error" role="alert"><h1>دسترسی بخش‌ها دریافت نشد</h1><p>{featureLoadError}</p><div className="form-actions"><button className="primary" onClick={() => { setFeatureLoadError(''); api<{disabled:string[]}>('/merchant/features').then(x => { setDisabledFeatures(x.disabled); setFeaturesLoadedFor(user.id); }).catch(e => setFeatureLoadError(e instanceof Error ? e.message : 'دوباره تلاش کنید.')); }}>تلاش دوباره</button><button onClick={() => { void api('/auth/logout','POST').then(() => { setUser(null); setBrand(null); setFeatureLoadError(''); }).catch(e => setFeatureLoadError(e instanceof Error ? e.message : 'خروج انجام نشد.')); }}>خروج از حساب</button></div></div>;
  if (featuresLoadedFor !== user.id) return <div className="splash"><img className="splash-orb" src={brand?.logoUrl || '/majora-mark.png'} alt={brand?.name || 'MAJORA'}/><strong>{brand?.name || 'در حال آماده‌سازی فروشگاه'}</strong><span>دسترسی بخش‌ها بررسی می‌شود…</span><small>Powered by MAJORA</small></div>;
  return <div className="shell" style={{'--brand':brand?.brandColor??'#0B2B53'} as React.CSSProperties}>
<aside className="sidebar"><div className="brand"><img src={user.role==='platform_admin'?'/majora-mark.png':(brand?.logoUrl || '/store-logo-gold.png')} alt={user.role==='platform_admin'?'نشان ماژورا':'لوگوی فروشگاه'}/><div><b>{brand?.name || 'MAJORA STUDIO'}</b><small>فضای مدیریت کسب‌وکار</small></div></div><nav aria-label="منوی اصلی">{tabs.map(([id,label,icon])=><button key={id} className={tab===id?'active':''} onClick={()=>navigate(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav><div className="sidebar-foot"><small>Powered by <b>MAJORA</b></small><button onClick={()=>run(async()=>{await api('/auth/logout','POST'); setUser(null); setBrand(null)},'')}>خروج از حساب</button></div></aside>
    <div className="main"><header className="topbar"><div><small>سلام، {user.displayName}</small><h1>{tabs.find(x=>x[0]===tab)?.[1]}</h1></div>{user.role!=='platform_admin'&&user.role!=='warehouse'&&<GlobalSearch onPick={openSearchHit}/>}<div className="top-actions"><span className="online-dot"/> داده‌های این فضا روی سرور ثبت می‌شوند <button className="menu-toggle" onClick={()=>setMenuOpen(true)} aria-label="باز کردن منوی کامل">☰ منو</button><button onClick={()=>run(async()=>{await api('/auth/logout','POST'); setUser(null); setBrand(null)},'')}>خروج</button></div></header>
      {error && <div role="alert" className="toast error" onClick={()=>setError('')}>{error} <button aria-label="بستن">×</button></div>}{notice && <div role="status" className="toast success" onClick={()=>setNotice('')}>{notice} <button aria-label="بستن">×</button></div>}
      <main className="content" key={tab}>{tab==='majora-support'?<MajoraSupport/>:user.role==='platform_admin' ? (tab==='plans'?<AdminBilling/>:tab==='admin-users'?<UserManagement admin/>:tab==='tenants'?<Tenants/>:tab==='admin-features'?<AdminFeatures/>:tab==='ai-settings'?<AiSettings/>:tab==='admin-brand'?<AdminInvoiceBrandSettings/>:<AdminDashboard/>) : (tab==='sale'?<SaleWorkspace onDone={id=>{setOpenedInvoiceId(id);navigate('invoices')}}/>:tab==='products'?<ProductsCatalog role={user.role} initialQuery={searchTarget?.kind==='product'?searchTarget.query:''}/>:tab==='price-batches'?<PriceBatches run={run}/>:tab==='customers'?<Customers role={user.role} initialQuery={searchTarget?.kind==='customer'?searchTarget.query:''}/>:tab==='invoices'?<Invoices role={user.role} run={run} initialId={openedInvoiceId} onInitialViewed={()=>setOpenedInvoiceId(null)} onReturn={id=>{setReturnTarget(id);navigate('returns')}} onCheque={()=>navigate('cheques')}/>:tab==='archive'?<Archive run={run}/>:tab==='returns'?<Returns initialId={returnTarget} onTargetUsed={()=>setReturnTarget(null)}/>:tab==='invoice-brand'?<InvoiceBrandSettings editable={false} onSaved={refreshBrand}/>:tab==='accounting'?<Accounting run={run} focusId={searchTarget?.kind==='purchase'||searchTarget?.kind==='expense'?searchTarget.id:undefined}/>:tab==='cheques'?<Cheques initialQuery={searchTarget?.kind==='cheque'?searchTarget.query:''}/>:tab==='reminders'?<Reminders run={run} initialQuery={searchTarget?.kind==='reminder'?searchTarget.query:''}/>:tab==='advisor'?<><Advisor/><AdvisorChat/></>:tab==='subscription'?<MerchantSubscription/>:tab==='staff'?<><Staff run={run} role={user.role}/>{user.role==='owner'&&<UserManagement admin={false}/>}</>:<Dashboard go={navigate} role={user.role} brand={brand?.name??'فروشگاه شما'} logo={brand?.logoUrl} disabledFeatures={disabledFeatures}/>)}</main>
      <footer className="footer">نرم‌افزار به سبک کار شما · Powered by MAJORA</footer>
    </div><nav className="mobile-nav" aria-label="دسترسی سریع">{(user.role==='platform_admin'?adminTabs:tabs.filter(([id])=>['dashboard','sale','products','customers','invoices'].includes(id))).map(([id,label,icon])=><button key={id} className={tab===id?'active':''} onClick={()=>navigate(id)}><span>{icon}</span><small>{label}</small></button>)}</nav>{menuOpen&&<div className="drawer-backdrop" onClick={()=>setMenuOpen(false)}><nav className="drawer" aria-label="منوی کامل" onClick={e=>e.stopPropagation()}><div className="card-head"><h2>همهٔ بخش‌ها</h2><button onClick={()=>setMenuOpen(false)} aria-label="بستن منو">×</button></div>{tabs.map(([id,label,icon])=><button key={id} className={tab===id?'active':''} onClick={()=>navigate(id)}><span>{icon}</span>{label}</button>)}</nav></div>}
  </div>;
}

function Login({onLogin,error,setError}:{onLogin:(u:User)=>void;error:string;setError:(x:string)=>void}) { const [name,setName]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); return <div className="login-page"><div className="login-hero"><img className="logo-letter" src="/majora-mark.png" alt="نشان ماژورا"/><small>MAJORA SOFTWARE STUDIO</small><h1>کسب‌وکارت هوشمنده.<br/><em>تو فقط رشدش بده.</em></h1><p>فروش، موجودی، مشتری و پیگیری مالی در یک فضای کاری منظم.</p><span>Powered by MAJORA</span></div><form className="login-card" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{onLogin(await login(name,password))}catch(x){setError(x instanceof Error?x.message:'خطا در ورود')}finally{setBusy(false)}}}><h2>ورود به فضای کاری</h2><p>با نام کاربری و رمز عبور اختصاصی خود وارد شوید.</p><label>نام کاربری<input value={name} onChange={e=>setName(e.target.value)} autoComplete="username" required/></label><label>رمز عبور<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>{error&&<div role="alert" className="field-error">{error}</div>}<button className="primary" disabled={busy}>{busy?'در حال ورود…':'ورود امن'}</button></form></div> }
function Card({title,children,action}:{title:string;children:React.ReactNode;action?:React.ReactNode}) {return <section className="card"><div className="card-head"><h2>{title}</h2>{action}</div>{children}</section>}
function Empty({text}:{text:string}) {return <div className="empty">{text}</div>}
function Dashboard({go,role,brand,logo,disabledFeatures}:{go:(t:Tab)=>void;role:string;brand:string;logo?:string;disabledFeatures:string[]}) {
  const [data,setData]=useState<{sales30Rial:number|null;received30Rial:number|null;receivable30Rial:number|null;refundDueRial:number|null;invoiceCount30:number|null;customers:number|null;products:number|null;lowStock:number|null;overdue:number|null;openCheques:number|null;dueCheques:number|null}|null>(null);
  useEffect(()=>{api<typeof data>('/merchant/dashboard').then(setData).catch(()=>{})},[]);
  const visible = (feature:string) => !disabledFeatures.includes(feature) && (!roleSections[role] || roleSections[role].includes(feature as Tab));
  return <><div className="hero"><div><span className="eyebrow">فضای کاری {brand}</span><h2>کسب‌وکارت هوشمنده؛ تو فقط رشدش بده.</h2><p>فروش و پیگیری‌هایت همین‌جا کنار هم هستند.</p>{visible('sale') && <button onClick={()=>go('sale')}>＋ فاکتور جدید</button>}</div><img src={logo||"/store-logo-gold.png"} alt="لوگوی فروشگاه"/></div>
    {(visible('invoices') || visible('accounting')) && <div className="kpi-grid">{visible('invoices') && <Kpi label="فروش ۳۰ روز" value={rial(data?.sales30Rial??0)} icon="↗"/>}{visible('accounting') && <Kpi label="دریافت ۳۰ روز" value={rial(data?.received30Rial??0)} icon="✓"/>}{visible('accounting') && <Kpi label="مطالبات باز" value={rial(data?.receivable30Rial??0)} icon="◷"/>}{visible('returns') && <Kpi label="بازپرداخت باز" value={rial(data?.refundDueRial??0)} icon="↶"/>}</div>}
    <div className="two-col">{['reminders','cheques','products','customers'].some(visible) && <Card title="آنچه امروز باید ببینی"><div className="quick-list">{visible('reminders') && <button onClick={()=>go('reminders')}>یادآورهای سررسیده <strong>{data?.overdue??0}</strong></button>}{visible('cheques') && <button onClick={()=>go('cheques')}>چک‌های باز / سررسیده <strong>{data?.openCheques??0} / {data?.dueCheques??0}</strong></button>}{visible('products') && <button onClick={()=>go('products')}>کالاهای کم‌موجودی <strong>{data?.lowStock??0}</strong></button>}{visible('customers') && <button onClick={()=>go('customers')}>مشتریان ثبت‌شده <strong>{data?.customers??0}</strong></button>}</div></Card>}{['sale','products','invoices','cheques'].some(visible) && <Card title="میانبرهای روزمره"><div className="quick-actions">{visible('sale') && <button onClick={()=>go('sale')}>＋ فروش جدید</button>}{visible('products') && <button onClick={()=>go('products')}>▦ مدیریت کالا</button>}{visible('invoices') && <button onClick={()=>go('invoices')}>▤ فاکتورها</button>}{visible('cheques') && <button onClick={()=>go('cheques')}>▧ پیگیری چک‌ها</button>}</div></Card>}</div></>;
}
function Kpi({label,value,icon}:{label:string;value:string;icon:string}) {return <div className="kpi"><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>}
function Reminders({run,initialQuery=''}:{run:(fn:()=>Promise<unknown>,msg?:string)=>Promise<void>;initialQuery?:string}) {
  const [items,setItems]=useState<{id:string;title:string;dueAt:string}[]>([]);
  const [title,setTitle]=useState('');
  const [due,setDue]=useState('');
  const [dueTime,setDueTime]=useState('09:00');
  const [editingId,setEditingId]=useState<string|null>(null);
  const [query,setQuery]=useState(initialQuery);
  const load=()=>api<typeof items>('/merchant/reminders').then(setItems);
  useEffect(()=>{load().catch(()=>{})},[]);
  useEffect(()=>{if(initialQuery)setQuery(initialQuery)},[initialQuery]);
  const reset=()=>{setTitle('');setDue('');setDueTime('09:00');setEditingId(null)};
  const edit=(item:{id:string;title:string;dueAt:string})=>{const date=new Date(item.dueAt);setEditingId(item.id);setTitle(item.title);setDue(isoToJalaliDate(item.dueAt));setDueTime(`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`);window.scrollTo({top:0,behavior:'smooth'})};
  const visible=items.filter(x=>x.title.toLocaleLowerCase('fa-IR').includes(query.toLocaleLowerCase('fa-IR')));
  return <><div className="page-intro"><h2>یادآورها</h2><p>پیگیری‌های مالی و کارهای مهم ثبت‌شده در سامانه.</p></div>
    <div className="two-col wide-right"><Card title={editingId?'ویرایش یادآور':'یادآور جدید'}><form className="form-grid" onSubmit={e=>{e.preventDefault();void run(async()=>{
      const iso=jalaliToIsoDate(due);
      if(!iso) throw new Error('تاریخ یادآور شمسی را کامل و معتبر وارد کنید.');
      await api(editingId?`/merchant/reminders/${editingId}`:'/merchant/reminders',editingId?'PUT':'POST',{title,dueAt:new Date(`${iso}T${dueTime}:00`).toISOString()});
      reset();await load();
    },editingId?'یادآور ویرایش شد.':'یادآور ثبت شد.')}}><label>عنوان<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={300} required/></label><JalaliDateField label="تاریخ یادآور (شمسی)" value={due} onChange={setDue}/><label>ساعت<input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)} required/></label><button className="primary">{editingId?'ذخیرهٔ تغییرات':'ثبت یادآور'}</button>{editingId&&<button type="button" onClick={reset}>انصراف از ویرایش</button>}</form></Card><Card title="پیگیری‌های باز"><label>جست‌وجوی یادآورها<input type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label>{visible.length?<div className="list">{visible.slice(0,5).map(x=><div className="list-row" key={x.id}><div><strong>{x.title}</strong><small>{dateFa(x.dueAt)}</small></div><button onClick={()=>edit(x)}>ویرایش</button><button onClick={()=>void run(async()=>{await api(`/merchant/reminders/${x.id}/done`,'POST');await load()},'انجام شد.')}>انجام شد</button></div>)}{visible.length>5&&<details className="reminder-more"><summary>نمایش {visible.length-5} یادآور دیگر</summary>{visible.slice(5).map(x=><div className="list-row" key={x.id}><div><strong>{x.title}</strong><small>{dateFa(x.dueAt)}</small></div><button onClick={()=>edit(x)}>ویرایش</button><button onClick={()=>void run(async()=>{await api(`/merchant/reminders/${x.id}/done`,'POST');await load()},'انجام شد.')}>انجام شد</button></div>)}</details>}</div>:<Empty text="یادآور بازی مطابق جست‌وجو ندارید."/>}</Card></div></>;
}
function Accounting({run,focusId}:{run:(fn:()=>Promise<unknown>,msg?:string)=>Promise<void>;focusId?:string}) {
  type Overview={revenueRial:number;receivedRial:number;customerReceivableRial:number;purchasesRial:number;supplierPayableRial:number;expensesRial:number;costComplete:boolean;costOfGoodsSoldRial:number|null;estimatedOperatingRial:number|null;note:string};
  type Purchase={id:string;supplierName:string;supplierInvoiceNumber:string;purchasedAt:string;totalRial:number;paidRial:number};
  type Expense={id:string;category:string;description:string;amountRial:number;incurredAt:string};
  const [overview,setOverview]=useState<Overview|null>(null);const [products,setProducts]=useState<Product[]>([]);const [purchases,setPurchases]=useState<Purchase[]>([]);const [expenses,setExpenses]=useState<Expense[]>([]);
  const [category,setCategory]=useState('');const [description,setDescription]=useState('');const [amount,setAmount]=useState('');
  const [expenseDate,setExpenseDate]=useState('');const [expenseId,setExpenseId]=useState<string|null>(null);const [expenseReason,setExpenseReason]=useState('');
  const [focused,setFocused]=useState(focusId);
  useEffect(()=>setFocused(focusId),[focusId]);
  const editExpense=(item:Expense)=>{setExpenseId(item.id);setCategory(item.category);setDescription(item.description);setAmount(String(item.amountRial));setExpenseDate(isoToJalaliDate(item.incurredAt));setExpenseReason('');window.scrollTo({top:0,behavior:'smooth'})};
  const resetExpense=()=>{setExpenseId(null);setCategory('');setDescription('');setAmount('');setExpenseDate('');setExpenseReason('')};
  const reload=async()=>{const [o,p,b,e]=await Promise.all([api<Overview>('/merchant/accounting/overview'),api<Product[]>('/merchant/products'),api<Purchase[]>('/merchant/accounting/purchases'),api<Expense[]>('/merchant/accounting/expenses')]);setOverview(o);setProducts(p);setPurchases(b);setExpenses(e)};
  useEffect(()=>{reload().catch(()=>{})},[]);
  return <><div className="page-intro"><h2>مالی و خرید</h2><p>خرید، هزینه و مانده‌ها را ثبت کنید؛ برآورد سود فقط با بهای تمام‌شدهٔ کامل نمایش داده می‌شود.</p></div>
    <div className="kpi-grid"><Kpi label="فروش ۳۰ روز" value={rial(overview?.revenueRial??0)} icon="↗"/><Kpi label="طلب از مشتری" value={rial(overview?.customerReceivableRial??0)} icon="◷"/><Kpi label="بدهی خرید" value={rial(overview?.supplierPayableRial??0)} icon="◇"/><Kpi label="هزینه‌های ثبت‌شده" value={rial(overview?.expensesRial??0)} icon="−"/></div>
    <Card title="برآورد عملکرد ۳۰ روز"><div className="finance-summary"><div><small>بهای کالای فروش‌رفته</small><strong>{overview?.costOfGoodsSoldRial==null?'نامشخص':rial(overview.costOfGoodsSoldRial)}</strong></div><div><small>برآورد پس از هزینه‌های ثبت‌شده</small><strong>{overview?.estimatedOperatingRial==null?'نامشخص':rial(overview.estimatedOperatingRial)}</strong></div></div><p className="hint">{overview?.costComplete===false?'برای اقلام فروش‌رفته بهای خرید ثبت نشده است؛ عدد سود پنهان شده تا تصمیم اشتباه ایجاد نشود.':''} {overview?.note}</p></Card>
    <div className="two-col"><PurchaseEntry products={products} reload={reload} run={run}/>
    <Card title={expenseId?'اصلاح هزینهٔ ثبت‌شده':'ثبت هزینه'}><form onSubmit={e=>{e.preventDefault();void run(async()=>{const iso=expenseDate?jalaliToIsoDate(expenseDate):null;if(expenseDate&&!iso)throw new Error('تاریخ هزینه شمسی معتبر نیست.');await api(expenseId?`/merchant/accounting/expenses/${expenseId}`:'/merchant/accounting/expenses',expenseId?'PUT':'POST',{category,description,amountRial:Number(amount),incurredAt:iso?new Date(`${iso}T12:00:00`).toISOString():null,reason:expenseId?expenseReason:null});resetExpense();await reload()},expenseId?'هزینه با ثبت سابقه اصلاح شد.':'هزینه ثبت شد.')}}><label>دستهٔ هزینه<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="اجاره، حمل، بسته‌بندی…" required/></label><label>توضیح<input value={description} onChange={e=>setDescription(e.target.value)}/></label><label>مبلغ (ریال)<RialInput value={amount} onValueChange={setAmount} placeholder="مبلغ را وارد کنید" required/></label><JalaliDateField label="تاریخ هزینه (شمسی؛ خالی = امروز)" value={expenseDate} onChange={setExpenseDate} optional/>{expenseId&&<label>دلیل اصلاح<input value={expenseReason} onChange={e=>setExpenseReason(e.target.value)} maxLength={500} required/></label>}<button className="primary full">{expenseId?'ذخیرهٔ اصلاح هزینه':'ثبت هزینه'}</button>{expenseId&&<button type="button" onClick={resetExpense}>انصراف</button>}</form></Card></div>
    {focused&&<div className="card">نتیجهٔ جست‌وجو نمایش داده شده است. <button onClick={()=>setFocused(undefined)}>نمایش همهٔ خریدها و هزینه‌ها</button></div>}
    <div className="two-col"><Card title="خریدهای اخیر">{purchases.length?<div className="list">{purchases.filter(x=>!focused||x.id===focused).slice(0,5).map(x=><div className="list-row" key={x.id}><div><strong>{x.supplierName}</strong><small>{dateFa(x.purchasedAt)} · سند {x.supplierInvoiceNumber||'—'}</small></div><div className="money"><b>{rial(x.totalRial)}</b><small>مانده {rial(x.totalRial-x.paidRial)}</small></div></div>)}{!focused&&purchases.length>5&&<details className="reminder-more"><summary>نمایش خریدهای بیشتر</summary>{purchases.slice(5).map(x=><div className="list-row" key={x.id}><div><strong>{x.supplierName}</strong><small>{dateFa(x.purchasedAt)} · سند {x.supplierInvoiceNumber||'—'}</small></div><b>{rial(x.totalRial)}</b></div>)}</details>}</div>:<Empty text="خریدی ثبت نشده است."/>}</Card><Card title="هزینه‌های اخیر">{expenses.length?<div className="list">{expenses.filter(x=>!focused||x.id===focused).slice(0,5).map(x=><div className="list-row" key={x.id}><div><strong>{x.category}</strong><small>{x.description} · {dateFa(x.incurredAt)}</small></div><b>{rial(x.amountRial)}</b><button onClick={()=>editExpense(x)}>ویرایش</button></div>)}{!focused&&expenses.length>5&&<details className="reminder-more"><summary>نمایش هزینه‌های بیشتر</summary>{expenses.slice(5).map(x=><div className="list-row" key={x.id}><div><strong>{x.category}</strong><small>{x.description} · {dateFa(x.incurredAt)}</small></div><b>{rial(x.amountRial)}</b><button onClick={()=>editExpense(x)}>ویرایش</button></div>)}</details>}</div>:<Empty text="هزینه‌ای ثبت نشده است."/>}</Card></div>
  </>;
}
function Advisor() {const [data,setData]=useState<{periodDays:number;invoices:number;salesRial:number;outstandingRial:number;lowStock:{name:string;stock:number}[];suggestions:string[];note:string}|null>(null);useEffect(()=>{api<typeof data>('/merchant/advisor').then(setData).catch(()=>{})},[]);return <><div className="page-intro"><h2>تحلیل کسب‌وکار</h2><p>نگاه مبتنی بر داده‌های ثبت‌شدهٔ ۳۰ روز اخیر.</p></div><div className="kpi-grid"><Kpi label="فروش ثبت‌شده" value={rial(data?.salesRial??0)} icon="↗"/><Kpi label="ماندهٔ باز" value={rial(data?.outstandingRial??0)} icon="◷"/><Kpi label="فاکتورها" value={String(data?.invoices??0)} icon="▤"/><Kpi label="کالای کم‌موجودی" value={String(data?.lowStock.length??0)} icon="▦"/></div><Card title="پیشنهادهای قابل پیگیری"><div className="insight-list">{data?.suggestions.map((x,i)=><p key={i}><span>✦</span>{x}</p>)}</div><p className="hint">{data?.note}</p></Card></>}
function AdvisorChat(){const [question,setQuestion]=useState('');const [answer,setAnswer]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [warning,setWarning]=useState('');return <Card title="از مشاور کسب‌وکار بپرسید"><p className="hint">پاسخ از آمار خلاصهٔ فروشگاه شما ساخته می‌شود. تصمیم نهایی و ثبت عملیات با خودتان است.</p><form className="advisor-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setWarning('');try{const r=await api<{answer:string;warning?:string;errorCode?:string}>('/merchant/advisor/ask','POST',{question});setAnswer(r.answer);setWarning(r.warning??'')}catch(x){setError(x instanceof Error?x.message:'پاسخ در دسترس نیست')}finally{setBusy(false)}}}><label>پرسش شما<input value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1000} placeholder="مثلاً چه مانده‌هایی را زودتر پیگیری کنم؟" required/></label><button className="primary" disabled={busy}>{busy?'در حال بررسی…':'دریافت پاسخ'}</button></form>{error&&<div role="alert" className="field-error">{error}</div>}{warning&&<div className="field-error" role="status">{warning}</div>}{answer&&<div className="advisor-answer" role="status">{answer}</div>}</Card>}
const staffRoleNames: Record<string,string> = {owner:'مالک',manager:'مدیر',staff:'فروشنده',cashier:'صندوق‌دار',warehouse:'انباردار',accountant:'حسابدار',viewer:'مشاهده‌گر'};
function Staff({run,role}:{run:(fn:()=>Promise<unknown>,msg?:string)=>Promise<void>;role:string}) {const [items,setItems]=useState<{id:string;username:string;displayName:string;role:string;enabled:boolean}[]>([]);const [form,setForm]=useState({username:'',displayName:'',password:'',role:'cashier'});const load=()=>api<typeof items>('/merchant/staff').then(setItems);useEffect(()=>{load().catch(()=>{})},[]);return <><div className="page-intro"><h2>همکاران</h2><p>هر نفر حساب خودش را دارد؛ فعالیت‌ها با نام کاربر ثبت می‌شوند.</p></div><div className="two-col wide-right">{role==='owner'&&<Card title="دعوت همکار"><form className="form-grid" onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/merchant/staff','POST',form);setForm({username:'',displayName:'',password:'',role:'cashier'});await load()})}}><label>نام کاربری<input value={form.username} onChange={e=>setForm({...form,username:e.target.value})} required/></label><label>نام نمایشی<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} required/></label><label>رمز اولیه (حداقل ۱۲ نویسه)<input type="password" minLength={12} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required/></label><label>نقش<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="cashier">صندوق‌دار</option><option value="warehouse">انباردار</option><option value="accountant">حسابدار</option><option value="viewer">مشاهده‌گر</option><option value="manager">مدیر</option><option value="staff">فروشنده (قدیمی)</option></select></label><button className="primary">افزودن همکار</button></form></Card>}<Card title="اعضای فروشگاه"><div className="list">{items.map(x=><div className="list-row" key={x.id}><div><strong>{x.displayName}</strong><small>{x.username} · {staffRoleNames[x.role]??x.role}</small></div><span className={'badge '+(x.enabled?'green':'amber')}>{x.enabled?'فعال':'غیرفعال'}</span>{role==='owner'&&x.role!=='owner'&&<button onClick={()=>void run(async()=>{await api(`/merchant/staff/${x.id}/enabled`,'POST',{enabled:!x.enabled});await load()})}>{x.enabled?'قطع دسترسی':'فعال‌سازی'}</button>}</div>)}</div></Card></div></>}
function AdminDashboard(){const [data,setData]=useState<{tenants:number;activeSubscriptions:number;users:number}|null>(null);useEffect(()=>{api<typeof data>('/admin/overview').then(setData).catch(()=>{})},[]);return <><div className="page-intro"><h2>مرکز مدیریت ماژورا</h2><p>کنترل فروشگاه‌ها، طرح‌ها و دسترسی‌ها.</p></div><div className="kpi-grid"><Kpi label="فروشگاه‌ها" value={String(data?.tenants??0)} icon="▦"/><Kpi label="اشتراک فعال" value={String(data?.activeSubscriptions??0)} icon="◇"/><Kpi label="کاربران" value={String(data?.users??0)} icon="♙"/></div><Card title="مدیریت متمرکز"><p>ابتدا طرح اشتراک بسازید، سپس فروشگاه و مالک آن را ثبت کنید و بازهٔ اشتراک را برایش فعال کنید.</p></Card></>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
