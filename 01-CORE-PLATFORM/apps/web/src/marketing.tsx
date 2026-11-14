import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import './marketing.css';

type Slide = { slot:number; altText:string; targetUrl:string; linkEnabled:boolean; enabled?:boolean; imageUrl:string };
type Feature = { group:string; title:string; summary:string; benefit:string; route:string; icon:string };
const features:Feature[] = [
  {group:'فروش و فاکتور',title:'فروش از فهرست کالا',summary:'مشتری را انتخاب کن، کالاها را پیدا کن و تعداد را پیش از ثبت بازبینی کن.',benefit:'ثبت فروش با گام‌های روشن و خطای کمتر',route:'sale',icon:'▦'},
  {group:'فروش و فاکتور',title:'فاکتور قابل پیگیری',summary:'فاکتورهای ثبت‌شده را جست‌وجو، بازبینی و در صورت مجاز ویرایش کن.',benefit:'دسترسی سریع به سابقه هر فروش',route:'invoices',icon:'▤'},
  {group:'فروش و فاکتور',title:'خروجی و چاپ فاکتور',summary:'پیش‌نمایش فاکتور و گزینه‌های PDF، تصویر و چاپ را از جزئیات فاکتور ببین.',benefit:'تحویل خوانای سند به مشتری',route:'invoices',icon:'▧'},
  {group:'فروش و فاکتور',title:'قالب و مشخصات فاکتور',summary:'اطلاعات عملیاتی مجاز فروشگاه، شرایط فروش و راه‌های ارتباطی فاکتور را تنظیم کن.',benefit:'هماهنگی فاکتور با شیوه کار فروشگاه',route:'invoice-brand',icon:'◩'},
  {group:'فروش و فاکتور',title:'مرجوعی و بازپرداخت',summary:'مرجوعی را به فاکتور اصلی وصل کن و وضعیت بازپرداخت را جداگانه پیگیری کن.',benefit:'کاهش مغایرت فروش و موجودی',route:'returns',icon:'↶'},
  {group:'فروش و فاکتور',title:'تخفیف روی اقلام انتخابی',summary:'هنگام فروش، درصد تخفیف را برای همه اقلام یا فقط کالاهای انتخابی تعیین کن و جمع را پیش از ثبت ببین.',benefit:'پیشنهاد قیمت دقیق‌تر به مشتری',route:'sale',icon:'٪'},
  {group:'فروش و فاکتور',title:'پیش‌فاکتور',summary:'پیش‌فاکتور را از فروش قطعی جدا ثبت کن و در صورت تصمیم مشتری، بعداً به فروش تبدیل کن.',benefit:'کسر نشدن موجودی پیش از خرید قطعی',route:'invoices',icon:'◧'},
  {group:'کالا و انبار',title:'فهرست کالا و عکس',summary:'کالاها، قیمت، موجودی و تصویر هر محصول را در فهرست مدیریت کن.',benefit:'پیدا کردن کالا و موجودی در لحظه',route:'products',icon:'▦'},
  {group:'کالا و انبار',title:'جست‌وجو و دسته‌بندی',summary:'برای رسیدن به کالای موردنظر از نام، دسته و زیر‌دسته کمک بگیر.',benefit:'انتخاب سریع‌تر در زمان فروش',route:'products',icon:'⌕'},
  {group:'کالا و انبار',title:'ویرایش قیمت',summary:'قیمت یک کالا را سریع تغییر بده یا تغییر درصدی را روی کالاهای انتخابی اعمال کن.',benefit:'به‌روزرسانی کنترل‌شده قیمت‌ها',route:'price-batches',icon:'↗'},
  {group:'کالا و انبار',title:'بایگانی',summary:'موارد بایگانی‌شده را از فضای کار روزانه جدا کن و در بخش مستقل ببین.',benefit:'فهرست روزمره خلوت‌تر',route:'archive',icon:'▣'},
  {group:'کالا و انبار',title:'عکس‌گرفتن از کالا',summary:'در فرم کالا می‌توانی دوربین دستگاه را باز کنی یا تصویری از فایل‌ها انتخاب کنی.',benefit:'شناخت بصری سریع‌تر کالا',route:'products',icon:'▧'},
  {group:'کالا و انبار',title:'میانبر بررسی قیمت و مشخصات',summary:'روی هر کالا میانبر جست‌وجوی ترب، دیجیکالا و مشخصات فنی وجود دارد؛ نتیجه به اینترنت مرورگر وابسته است.',benefit:'جست‌وجوی آماده بدون تایپ دوباره نام کالا',route:'products',icon:'⌕'},
  {group:'کالا و انبار',title:'تاریخچه تغییر قیمت',summary:'نوبت‌های افزایش قیمت و قیمت قدیم و جدید را ببین؛ اگر بعداً قیمت کالا تغییر نکرده باشد، نوبت را برگردان.',benefit:'اصلاح قابل ردگیری قیمت‌گذاری',route:'price-batches',icon:'◷'},
  {group:'مشتری و همکار',title:'پرونده مشتری',summary:'اطلاعات تماس، فاکتورها و سابقه مرتبط با مشتری را از پرونده او دنبال کن.',benefit:'شناخت بهتر سابقه خرید مشتری',route:'customers',icon:'♙'},
  {group:'مشتری و همکار',title:'جست‌وجوی سراسری',summary:'کالا، مشتری، فاکتور و دیگر موارد ثبت‌شده را از جست‌وجوی بالای اپ پیدا کن.',benefit:'زمان کمتر برای پیدا کردن اطلاعات',route:'dashboard',icon:'⌕'},
  {group:'مشتری و همکار',title:'حساب همکاران',summary:'برای اعضای تیم حساب جدا با نقش مناسب بساز و دسترسی‌هایشان را مدیریت کن.',benefit:'ثبت روشن‌تر مسئول هر فعالیت',route:'staff',icon:'♧'},
  {group:'مشتری و همکار',title:'پرونده و خروجی PDF مشتری',summary:'فاکتور، پرداخت، مرجوعی و چک‌های مرتبط را در پرونده مشتری ببین و گزارش آن را به PDF تبدیل کن.',benefit:'سابقه مشتری در یک گزارش قابل اشتراک',route:'customers',icon:'▤'},
  {group:'مشتری و همکار',title:'خروجی Excel و CSV مشتریان',summary:'فهرست مشتریان را برای کارهای مجاز فروشگاه در قالب Excel یا CSV دریافت کن.',benefit:'استفاده منظم از اطلاعات ثبت‌شده',route:'customers',icon:'▥'},
  {group:'مالی و پیگیری',title:'خرید و هزینه',summary:'خرید کالا و هزینه‌های فروشگاه را در بخش مالی ثبت و پیگیری کن.',benefit:'دید منظم‌تر به خروج پول',route:'accounting',icon:'◈'},
  {group:'مالی و پیگیری',title:'مطالبات و پرداخت‌ها',summary:'مانده فاکتورها و دریافت‌ها را در کنار فروش بررسی کن.',benefit:'کمتر از دست رفتن طلب‌ها',route:'accounting',icon:'◎'},
  {group:'مالی و پیگیری',title:'چک‌ها',summary:'اطلاعات چک، سررسید و وضعیت آن را ثبت و دنبال کن.',benefit:'پیگیری سررسید در یک جا',route:'cheques',icon:'▧'},
  {group:'مالی و پیگیری',title:'تصویر و اصلاح وضعیت چک',summary:'تصویر چک را ضمیمه کن و اگر وضعیت ثبت‌شده اشتباه بود، با درج دلیل آن را اصلاح کن.',benefit:'پرونده کامل‌تر و سابقه قابل پیگیری',route:'cheques',icon:'◩'},
  {group:'مالی و پیگیری',title:'ورود موجودی از خرید',summary:'در ثبت خرید می‌توانی کالای تازه بسازی و تعیین کنی چه مقدار از خرید به موجودی اضافه شود.',benefit:'کاهش ثبت دوباره کالا و موجودی',route:'accounting',icon:'＋'},
  {group:'مالی و پیگیری',title:'یادآورها',summary:'برای کارها و پیگیری‌های مهم تاریخ و ساعت ثبت کن.',benefit:'کمتر فراموش شدن کارهای مهم',route:'reminders',icon:'◷'},
  {group:'مدیریت کسب‌وکار',title:'داشبورد روزانه',summary:'نمایی از فروش، دریافت‌ها، مطالبات و کارهای نیازمند توجه را در خانه ببین.',benefit:'اولویت‌های روز در یک نگاه',route:'dashboard',icon:'◫'},
  {group:'مدیریت کسب‌وکار',title:'تحلیل کسب‌وکار',summary:'در صورت اتصال سرویس هوش مصنوعی، درباره داده‌های کسب‌وکار پرسش و تحلیل دریافت کن.',benefit:'کمک به تصمیم‌گیری با داده‌های ثبت‌شده',route:'advisor',icon:'✦'},
  {group:'مدیریت کسب‌وکار',title:'اشتراک و دسترسی',summary:'پلن، مهلت اشتراک و راه تمدید را در بخش اشتراک من ببین.',benefit:'شفافیت وضعیت دسترسی فروشگاه',route:'subscription',icon:'◇'},
  {group:'مدیریت کسب‌وکار',title:'پشتیبانی ماژورا',summary:'راه‌های ارتباط با تیم ماژورا را در صفحه اختصاصی آن پیدا کن.',benefit:'دسترسی روشن به سازنده محصول',route:'majora-support',icon:'✦'},
  {group:'مدیریت کسب‌وکار',title:'اعلان‌های ماژورا',summary:'خبرهای تغییر نسخه و پیام‌های مهم ماژورا را بخوان؛ پیام‌های تازه با نشان خوانده‌نشده مشخص می‌شوند.',benefit:'باخبر ماندن از تغییرات محصول',route:'announcements',icon:'🔔'}
];

export function WhyMajora({onOpen,canOpen}:{onOpen:(route:string)=>void;canOpen:(route:string)=>boolean}) {
  const [group,setGroup]=useState('همه'); const [query,setQuery]=useState('');
  const groups=['همه',...new Set(features.map(x=>x.group))];
  const visible=features.filter(x=>(group==='همه'||x.group===group)&&`${x.title} ${x.summary} ${x.benefit}`.toLocaleLowerCase('fa-IR').includes(query.toLocaleLowerCase('fa-IR')));
  return <div className="why-page" dir="rtl"><section className="why-hero"><div className="why-mark">M<span>✦</span></div><div><span className="eyebrow">MAJORA · نرم‌افزار به سبک کار شما</span><h2>چرا ماژورا؟</h2><p>امکاناتی که پشت کارهای روزانه‌ات هستند را بشناس. هر مورد را باز کن و همان بخش را در فضای کاری خودت ببین.</p><small>دسترسی هر بخش به نقش و اشتراک فروشگاه بستگی دارد.</small></div></section>
    <div className="why-controls"><label>جست‌وجو در امکانات<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="مثلاً چک، فاکتور، کالا"/></label><div className="why-groups" aria-label="دسته‌بندی امکانات">{groups.map(x=><button key={x} type="button" className={group===x?'active':''} onClick={()=>setGroup(x)} aria-pressed={group===x}>{x}</button>)}</div></div>
    <p className="why-count">{visible.length.toLocaleString('fa-IR')} امکان در این فهرست</p><div className="why-grid">{visible.map(x=><details className="why-card" key={`${x.group}-${x.title}`}><summary><span className="why-icon" aria-hidden="true">{x.icon}</span><span><small>{x.group}</small><strong>{x.title}</strong><em>{x.benefit}</em></span><span className="why-chevron" aria-hidden="true">⌄</span></summary><div className="why-detail"><p>{x.summary}</p><div className="why-benefit"><b>چه کمکی می‌کند؟</b><span>{x.benefit}</span></div><button type="button" onClick={()=>onOpen(x.route)} disabled={!canOpen(x.route)}>{canOpen(x.route)?`رفتن به ${x.title} ←`:'این بخش در دسترسی فعلی فعال نیست'}</button></div></details>)}</div>{visible.length===0&&<p className="empty">موردی مطابق جست‌وجو پیدا نشد.</p>}</div>;
}
export function MarketingCarousel() {
  const [slides,setSlides]=useState<Slide[]>([]); const [index,setIndex]=useState(0);
  const [intervalSeconds,setIntervalSeconds]=useState(6); const [paused,setPaused]=useState(false);
  const touchX=useRef<number|null>(null); const swiped=useRef(false);
  useEffect(()=>{let live=true;const load=()=>{if(document.visibilityState==='visible')void Promise.all([api<Slide[]>('/merchant/marketing-slides'),api<{intervalSeconds:number}>('/merchant/marketing-settings')]).then(([items,settings])=>{if(live){setSlides(items);setIntervalSeconds(settings.intervalSeconds)}}).catch(()=>{})};load();const timer=window.setInterval(load,60000);window.addEventListener('focus',load);return()=>{live=false;window.clearInterval(timer);window.removeEventListener('focus',load)}},[]);
  useEffect(()=>{if(slides.length<2||paused||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const timer=window.setTimeout(()=>{if(document.visibilityState==='visible')setIndex(i=>(i+1)%slides.length)},intervalSeconds*1000);return()=>window.clearTimeout(timer)},[slides.length,intervalSeconds,paused,index]);
  if(!slides.length)return null;const active=slides[Math.min(index,slides.length-1)];const move=(delta:number)=>setIndex(i=>(i+delta+slides.length)%slides.length);
  const image=<img key={`${active.slot}-${active.imageUrl}`} src={active.imageUrl} alt={active.altText} draggable={false}/>;
  return <section className="marketing-carousel" aria-label="پیام‌های ماژورا؛ برای دیدن بنر بعدی انگشت را بکشید" tabIndex={slides.length>1?0:undefined}
    onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={()=>setPaused(false)}
    onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?1:-1)}}}
    onTouchStart={e=>{touchX.current=e.touches[0]?.clientX??null}}
    onTouchEnd={e=>{if(touchX.current!==null&&slides.length>1){const delta=e.changedTouches[0]?.clientX-touchX.current;if(Math.abs(delta)>45){swiped.current=true;move(delta>0?1:-1);window.setTimeout(()=>{swiped.current=false},250)}}touchX.current=null}}
    onClickCapture={e=>{if(swiped.current){e.preventDefault();e.stopPropagation();swiped.current=false}}}>
    {active.linkEnabled?<a href={active.targetUrl} target={active.targetUrl.startsWith('https://')?'_blank':undefined} rel={active.targetUrl.startsWith('https://')?'noopener noreferrer':undefined}>{image}</a>:image}
  </section>;
}
