import './majora-about.css';

const logo = '/brand/majora-logo.png';
const benefits = [
  { title: 'خطای کمتر', description: 'کاهش خطاهای انسانی و افزایش دقت', icon: '✓', tone: 'mint' },
  { title: 'سرعت بیشتر', description: 'انجام سریع‌تر کارها و صرفه‌جویی در زمان', icon: 'ϟ', tone: 'blue' },
  { title: 'هزینه کمتر', description: 'کاهش هزینه‌های عملیاتی و افزایش بهره‌وری', icon: '▥', tone: 'amber' },
  { title: 'کنترل بهتر', description: 'دسترسی کامل به اطلاعات و گزارش‌های دقیق', icon: '▥', tone: 'violet' }
];
const audiences = [
  { title: 'فروشگاهی', icon: '🛒' }, { title: 'شرکتی', icon: '▦' }, { title: 'تولیدی', icon: '▥' },
  { title: 'خدماتی', icon: '♧' }, { title: 'پروژه‌ای', icon: '▤' }
];
export function MajoraAbout({ onBack }: { onBack: () => void }) {
  return <section className="majora-about" dir="rtl" aria-label="درباره ماژورا">
    <header className="majora-about-head"><h1>درباره ماژورا</h1><button onClick={onBack} aria-label="بازگشت">‹</button></header>
    <div className="majora-about-hero">
      <div className="majora-about-copy"><img src={logo} alt="لوگوی MAJORA ماژورا"/><h2><em>ماژورا،</em> یار هوشمند<br/>کسب‌وکارها</h2><p>اگر در کسب‌وکارت کارهای تکراری، محاسبات زمان‌بر، ثبت اطلاعات، فاکتور، حسابداری یا پیگیری‌های دستی داری، ماژورا برایت یک سیستم اختصاصی روی موبایل طراحی می‌کند تا کارها ساده‌تر، سریع‌تر و دقیق‌تر انجام شود.</p></div>
      <div className="majora-visual" aria-hidden="true"><div className="majora-orbit"/><div className="majora-phone"><div className="majora-phone-camera"/><div className="majora-phone-screen"><strong>◈ MAJORA</strong><div className="majora-screen-chart"><span/><span/><span/><span/><span/><span/></div><div className="majora-screen-line"/><div className="majora-screen-line short"/><div className="majora-screen-tile"/><div className="majora-screen-tile"/></div></div><span className="majora-float float-chart">▂ ▅ ▇</span><span className="majora-float float-doc">▤</span><span className="majora-float float-gear">⚙</span></div>
    </div>
    <div className="majora-benefits">{benefits.map(item => <article key={item.title}><span className={`majora-benefit-icon ${item.tone}`} aria-hidden="true">{item.icon}</span><div><h3>{item.title}</h3><p>{item.description}</p></div></article>)}</div>
    <section className="majora-audiences"><h2>کسب‌وکارهایی که هوشمندشان کردیم</h2><p>از یک مشکل کوچک تا اتوماسیون کامل کسب‌وکار</p><div>{audiences.map(item => <span key={item.title}><b aria-hidden="true">{item.icon}</b>{item.title}</span>)}</div></section>
    <a className="majora-site" href="https://majoraapp.ir" target="_blank" rel="noopener noreferrer"><span className="majora-globe" aria-hidden="true">◎</span><span><strong dir="ltr">majoraapp.ir</strong><small>با ما بیشتر آشنا شوید</small></span><b>مشاهده سایت ماژورا ←</b></a>
    <div className="majora-contact-grid"><a href="tel:09105796971"><span aria-hidden="true">☎</span><small>تماس</small><strong dir="ltr">0910-579-6971</strong></a><a href="tel:09019990440"><span aria-hidden="true">☎</span><small>تماس</small><strong dir="ltr">0901-999-0440</strong></a><a href="https://www.instagram.com/majora_app/" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">◎</span><small>اینستاگرام</small><strong dir="ltr">@majora_app</strong></a></div>
  </section>;
}
