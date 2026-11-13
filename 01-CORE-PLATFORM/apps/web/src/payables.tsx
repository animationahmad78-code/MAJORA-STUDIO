import { useEffect, useState } from 'react';
import { api, dateFa, rial } from './api';
import { RialInput } from './rial-input';

type Payable = { id:string; supplierName:string; supplierInvoiceNumber:string; purchasedAt:string; totalRial:number; paidRial:number; remainingRial:number };
type PayablePage = { items:Payable[]; total:number; page:number; pageSize:number };

export function Payables({ run, onPayment }: { run:(fn:()=>Promise<unknown>,msg?:string)=>Promise<void>; onPayment:()=>Promise<void> }) {
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(1);
  const [data,setData]=useState<PayablePage|null>(null);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Payable|null>(null);
  const [amount,setAmount]=useState('');
  const [method,setMethod]=useState('card');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;
    const timer=setTimeout(()=>{
      api<PayablePage>(`/merchant/accounting/payables?q=${encodeURIComponent(query)}&page=${page}`)
        .then(result=>{if(active){setData(result);setError('')}})
        .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'فهرست بدهی‌ها دریافت نشد.')});
    },query?250:0);
    return ()=>{active=false;clearTimeout(timer)};
  },[query,page,revision]);
  const pages=Math.max(1,Math.ceil((data?.total??0)/(data?.pageSize??10)));
  return <section className="card payables-card" aria-label="بدهی‌های باز تأمین‌کنندگان">
    <div className="card-head"><div><h2>بدهی‌های باز تأمین‌کنندگان</h2><p className="hint">ماندهٔ همهٔ خریدها، حتی دوره‌های قبل. قدیمی‌ترین بدهی‌ها ابتدا نمایش داده می‌شوند.</p></div><span className="badge amber">{data?.total??0} خرید باز</span></div>
    <label>جست‌وجو با نام تأمین‌کننده یا شماره سند<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} maxLength={100}/></label>
    {error&&<p role="alert" className="field-error">{error}</p>}
    {!error&&data?.items.length===0&&<p className="empty">بدهی بازی با این جست‌وجو پیدا نشد.</p>}
    <div className="list">{data?.items.map(item=><div className="list-row payable-row" key={item.id}>
      <div><strong>{item.supplierName}</strong><small>{dateFa(item.purchasedAt)} · سند {item.supplierInvoiceNumber||'بدون شماره'}</small></div>
      <div className="money"><b>{rial(item.remainingRial)}</b><small>از کل {rial(item.totalRial)}</small></div>
      <button type="button" aria-label={`ثبت پرداخت برای ${item.supplierName}`} onClick={()=>{setSelected(item);setAmount('')}}>ثبت پرداخت</button>
    </div>)}</div>
    {pages>1&&<nav className="payable-pages" aria-label="صفحات بدهی"><button type="button" disabled={page<=1} onClick={()=>setPage(page-1)}>قبلی</button><span>صفحه {page} از {pages}</span><button type="button" disabled={page>=pages} onClick={()=>setPage(page+1)}>بعدی</button></nav>}
    {selected&&<form className="payable-payment" onSubmit={event=>{event.preventDefault();void run(async()=>{
      const parsed=Number(amount);
      if(!Number.isSafeInteger(parsed)||parsed<1||parsed>selected.remainingRial)throw new Error('مبلغ پرداخت باید مثبت و حداکثر برابر ماندهٔ این خرید باشد.');
      await api(`/merchant/accounting/purchases/${selected.id}/payments`,'POST',{idempotencyKey:crypto.randomUUID(),amountRial:parsed,method});
      setSelected(null);setAmount('');setRevision(value=>value+1);await onPayment();
    },'پرداخت خرید ثبت و مانده به‌روز شد.')}}>
      <h3>پرداخت به {selected.supplierName}</h3><p className="hint">ماندهٔ فعلی: {rial(selected.remainingRial)}</p>
      <div className="form-grid"><label>مبلغ پرداخت (ریال)<RialInput value={amount} onValueChange={setAmount} required/></label>
        <label>روش پرداخت<select value={method} onChange={event=>setMethod(event.target.value)}><option value="card">کارت</option><option value="transfer">انتقال بانکی</option><option value="cash">نقد</option></select></label></div>
      <div className="form-actions"><button className="primary" type="submit">ثبت پرداخت</button><button type="button" onClick={()=>setSelected(null)}>انصراف</button></div>
    </form>}
  </section>;
}
