import { formatRial } from '@majora/domain';
import type { InvoiceReceipt } from '@majora/database';
import { siInstagram, siTelegram, siWhatsapp, siX } from 'simple-icons';
import baleIcon from './assets/social-icons/bale.svg';
import eitaaIcon from './assets/social-icons/eitaa.svg';
import rubikaIcon from './assets/social-icons/rubika.svg';
import './invoice-document.css';

export type PaperSize = 'a4' | 'a5';
export type InvoiceBrand = {
  storeName: string; slogan: string; phone: string; address: string; card: string; cardHolder: string;
  note: string; conditions: string[]; socialTelegram: string; socialInstagram: string; socialContact: string;
  socialLinks?: { platform: string; text: string; enabled: boolean }[];
};
type Props = { brand: InvoiceBrand; receipt: InvoiceReceipt; mono: boolean; paper: PaperSize; logo: string; chequePhoto?: string; revisionLabel?: string };

const socialSymbols: Record<string, { label: string; path?: string; image?: string; short: string }> = {
  telegram: { label: 'تلگرام', path: siTelegram.path, short: 'ت' },
  instagram: { label: 'اینستاگرام', path: siInstagram.path, short: 'ا' },
  whatsapp: { label: 'واتساپ', path: siWhatsapp.path, short: 'و' },
  bale: { label: 'بله', image: baleIcon, short: 'ب' }, rubika: { label: 'روبیکا', image: rubikaIcon, short: 'ر' },
  eitaa: { label: 'ایتا', image: eitaaIcon, short: 'ای' }, linkedin: { label: 'لینکدین', short: 'in' },
  x: { label: 'ایکس', path: siX.path, short: 'X' },
  website: { label: 'وب‌سایت', short: '🌐' }, phone: { label: 'تلفن', short: '☎' }
};

function SocialIcon({ platform }: { platform: string }) {
  const symbol = socialSymbols[platform] ?? { label: 'راه ارتباطی', short: '●' };
  return symbol.image ? <img className="inv-social-icon" src={symbol.image} alt={symbol.label} />
    : symbol.path ? <svg className="inv-social-icon" viewBox="0 0 24 24" aria-label={symbol.label} role="img"><path fill="currentColor" d={symbol.path}/></svg>
    : <span className="inv-social-icon inv-social-letter" aria-label={symbol.label} role="img">{symbol.short}</span>;
}

function finalRowBudget(paper: PaperSize, extraSummaryRows: number) {
  return Math.max(40, (paper === 'a4' ? 300 : 165) - extraSummaryRows * (paper === 'a4' ? 24 : 16));
}

function invoiceRowHeight(name: string, paper: PaperSize) {
  const charactersPerLine = paper === 'a4' ? 38 : 30;
  const linesOfText = Math.max(1, Math.ceil([...name].length / charactersPerLine));
  return paper === 'a4' ? Math.max(30, 11 + linesOfText * 18) : Math.max(23, 8 + linesOfText * 13);
}

export function pageLines<T extends { name: string }>(lines: T[], paper: PaperSize, extraSummaryRows = 0): T[][] {
  // Reserve the bottom of the last sheet for terms, totals and signatures.
  // Long names consume extra row height; balance sheets so the final page is
  // never left with one orphan row while earlier sheets are packed full.
  const finalBudget = finalRowBudget(paper, extraSummaryRows);
  const continuationBudget = paper === 'a4' ? 600 : 390;
  const prefix = [0];
  for (const line of lines) prefix.push(prefix[prefix.length - 1] + invoiceRowHeight(line.name, paper));
  if (prefix.at(-1)! <= finalBudget) return [lines];
  const n = lines.length;
  for (let pageCount = 2; pageCount <= n; pageCount++) {
    const target = n / pageCount;
    const costs = Array.from({ length: pageCount + 1 }, () => Array<number>(n + 1).fill(Infinity));
    const boundaries = Array.from({ length: pageCount + 1 }, () => Array<number>(n + 1).fill(-1));
    costs[0][0] = 0;
    for (let page = 1; page <= pageCount; page++) {
      const budget = page === pageCount ? finalBudget : continuationBudget;
      for (let end = page; end <= n - (pageCount - page); end++) {
        for (let start = page - 1; start < end; start++) {
          if (prefix[end] - prefix[start] > budget) continue;
          const cost = costs[page - 1][start] + (end - start - target) ** 2;
          if (cost < costs[page][end]) { costs[page][end] = cost; boundaries[page][end] = start; }
        }
      }
    }
    if (!Number.isFinite(costs[pageCount][n])) continue;
    const pages: T[][] = [];
    let end = n;
    for (let page = pageCount; page > 0; page--) {
      const start = boundaries[page][end];
      pages.unshift(lines.slice(start, end));
      end = start;
    }
    return pages;
  }
  // A single extraordinarily long item must still remain visible to the
  // editor; it cannot be silently dropped from the invoice.
  return [lines];
}

export function InvoiceDocument({ brand, receipt, mono, paper, logo, chequePhoto, revisionLabel }: Props) {
  const returned = receipt.returnedRial ?? 0;
  const refunded = receipt.refundedRial ?? 0;
  const netTotal = receipt.totalRial - returned;
  const netPaid = (receipt.paidRial ?? 0) - refunded;
  const refundDue = Math.max(0, netPaid - netTotal);
  const extraSummaryRows = returned > 0 ? 2 + Number(refunded > 0) + Number(refundDue > 0) : 0;
  const chunks = pageLines(receipt.lines, paper, extraSummaryRows);
  const annex = !!receipt.cheque && (receipt.cheque.showDetails || receipt.cheque.showImage);
  const pageTotal = chunks.length + Number(annex);
  const proforma = receipt.paymentStatus === 'proforma';
  const discount = receipt.discountRial ?? receipt.lines.reduce((sum, line) => sum + (line.discountRial ?? 0), 0);
  const subtotal = receipt.subtotalRial ?? receipt.totalRial + discount;
  const socialLinks = brand.socialLinks ?? [
    { platform: 'telegram', text: brand.socialTelegram, enabled: true },
    { platform: 'instagram', text: brand.socialInstagram, enabled: true },
    { platform: 'telegram', text: brand.socialContact, enabled: true }
  ];
  return <div className={`invoice-document ${paper} ${mono ? 'mono' : ''}`} dir="rtl">
    {chunks.map((lines, pageIndex) => {
      const last = pageIndex === chunks.length - 1;
      const before = chunks.slice(0, pageIndex).reduce((sum, chunk) => sum + chunk.length, 0);
      const freeRowHeight = finalRowBudget(paper, extraSummaryRows) - lines.reduce((sum, line) => sum + invoiceRowHeight(line.name, paper), 0);
      const blankRows = last ? Math.max(0, Math.min((paper === 'a4' ? 10 : 6) - lines.length,
        Math.floor(freeRowHeight / (paper === 'a4' ? 30 : 23)))) : 0;
      return <section className="invoice-paper" data-invoice-page key={pageIndex} aria-label={`${proforma ? 'پیش‌فاکتور' : 'فاکتور'} ${receipt.number}، صفحه ${pageIndex + 1}`}>
        <header className="inv-header">
          <div className="inv-logo"><img src={logo} alt="نشان فروشگاه"/></div>
          <div className="inv-identity"><h2>{brand.storeName}</h2><strong>{brand.slogan}</strong>
            <div className="inv-phones" dir="ltr">{brand.phone.split('|').map((phone, i) => <span key={i}>☎ {phone.trim()}</span>)}</div>
            <p>◆ {brand.address}</p></div>
        </header>
        {(receipt.showCardNumber ?? true) && <div className="inv-payment"><span>▣ شماره کارت <b dir="ltr">{brand.card}</b></span><span>♟ {brand.cardHolder}</span></div>}
        <div className="inv-note">➤ {brand.note}</div>
        <div className="inv-meta">
          <span>{proforma ? 'شماره پیش‌فاکتور' : 'شماره فاکتور'}: <b>{formatRial(receipt.number)}{revisionLabel ? ` · ${revisionLabel}` : ''}</b></span>
          <span>تاریخ: <b>{receipt.dateJalali || new Date(receipt.at).toLocaleDateString('fa-IR-u-ca-persian')}</b></span>
          <span>نام خریدار: <b>{receipt.customerName || 'خریدار حضوری'}</b></span>
          <span>شماره تماس: <b dir="ltr">{receipt.customerPhone || '—'}</b></span>
          <span>آدرس: <b>{receipt.customerAddress || '—'}</b></span><span>نحوه پرداخت: <b>{receipt.paymentMethod || '—'}</b></span>
          <span>تاریخ سررسید: <b>{receipt.dueDateJalali || '—'}</b></span><span>صفحه: <b>{formatRial(pageIndex + 1)} از {formatRial(pageTotal)}</b></span>
        </div>
        {pageIndex > 0 && <div className="inv-continuation">ادامهٔ {proforma ? 'پیش‌فاکتور' : 'فاکتور'} شمارهٔ {formatRial(receipt.number)} · صفحهٔ {formatRial(pageIndex + 1)}</div>}
        <table className="inv-table"><thead><tr><th>ردیف</th><th>کد</th><th>شرح کالا / دسته‌بندی</th><th>رنگ</th><th>تعداد</th><th>فی</th><th>تخفیف</th><th>مبلغ کل</th></tr></thead>
          <tbody>{lines.length ? lines.map((line, index) => <tr key={`${line.productId || line.name}-${index}`}><td>{formatRial(before + index + 1)}</td><td>—</td><td>{line.name}</td><td>{line.color || '—'}</td><td>{formatRial(line.quantity)}</td><td>{formatRial(line.unitPriceRial)}</td><td>{formatRial(line.discountRial ?? 0)}</td><td>{formatRial(line.totalRial)}</td></tr>) : <tr><td colSpan={8}>هنوز کالایی انتخاب نشده است.</td></tr>}{Array.from({ length: blankRows }, (_, index) => <tr className="inv-empty-row" aria-hidden="true" key={`empty-${index}`}><td>{formatRial(before + lines.length + index + 1)}</td><td/><td/><td/><td/><td/><td/><td/></tr>)}</tbody></table>
        {last && <div className="inv-final">
          <div className="inv-summary"><div><span>جمع کل</span><b>{formatRial(subtotal)}</b></div><div><span>تخفیف</span><b>{formatRial(discount)}</b></div><div><span>هزینه ارسال</span><b>{formatRial(receipt.shippingRial ?? 0)}</b></div><div className="inv-grand"><span>مبلغ نهایی</span><b>{formatRial(receipt.totalRial)}</b></div>{returned > 0 && <><div><span>مرجوعی ثبت‌شده</span><b>{formatRial(returned)}</b></div><div><span>خالص پس از مرجوعی</span><b>{formatRial(netTotal)}</b></div></>}<div><span>مبلغ پرداختی</span><b>{formatRial(receipt.paidRial ?? 0)}</b></div>{refunded > 0 && <div><span>بازپرداخت‌شده</span><b>{formatRial(refunded)}</b></div>}<div><span>مانده</span><b>{formatRial(receipt.balanceRial ?? Math.max(0, netTotal - netPaid))}</b></div>{refundDue > 0 && <div><span>بازپرداخت باز</span><b>{formatRial(refundDue)}</b></div>}<div className="inv-sign">امضای خریدار</div><div className="inv-sign">امضای فروشنده</div></div>
          <div className="inv-conditions">{proforma ? <><h3>پیش‌فاکتور</h3><p>این سند پیشنهاد فروش است. کالا تحویل نشده و پرداختی ثبت نشده است. فروش و کسر موجودی پس از تأیید و تبدیل این سند به فاکتور قطعی انجام می‌شود.</p></> : <><h3>شرایط فروش و تحویل کالا</h3><ol>{brand.conditions.map((text, index) => <li key={index}>{text}</li>)}</ol><strong>لطفاً پیش از تأیید سفارش، مشخصات و تعداد کالاها را بررسی فرمایید.</strong><p>با تشکر از اعتماد و همکاری شما.</p></>}</div>
        </div>}
        <footer className="inv-social">{socialLinks.filter(link => link.enabled && link.text.trim()).slice(0, 4).map((link, index) => <span className="inv-social-entry" key={index}><SocialIcon platform={link.platform}/><b dir="auto">{link.text}</b></span>)}</footer>
      </section>;
    })}
    {annex && receipt.cheque && <section className="invoice-paper inv-cheque-annex" data-invoice-page aria-label={`ضمیمهٔ چک فاکتور ${receipt.number}`}>
      <header><img src={logo} alt="نشان فروشگاه"/><div><h2>{brand.storeName}</h2><strong>ضمیمهٔ چک فاکتور شمارهٔ {formatRial(receipt.number)}</strong><p>صفحهٔ {formatRial(pageTotal)} از {formatRial(pageTotal)} · تاریخ فاکتور {receipt.dateJalali}</p></div></header>
      {receipt.cheque.showDetails && <div className="inv-cheque-details"><h3>مشخصات چک ثبت‌شده</h3><dl><div><dt>شماره چک</dt><dd>{receipt.cheque.serial}</dd></div><div><dt>بانک</dt><dd>{receipt.cheque.bank}</dd></div><div><dt>مبلغ</dt><dd>{formatRial(receipt.cheque.amountRial)} ریال</dd></div><div><dt>سررسید</dt><dd>{receipt.cheque.dueJalali}</dd></div><div><dt>شناسه صیادی</dt><dd dir="ltr">{receipt.cheque.sayadId}</dd></div><div><dt>وضعیت ثبت اعلام‌شده</dt><dd>{receipt.cheque.registrationStatus === 'confirmed' ? 'تأییدشده توسط گیرنده' : receipt.cheque.registrationStatus === 'registered' ? 'ثبت‌شده توسط صادرکننده' : receipt.cheque.registrationStatus === 'unregistered' ? 'ثبت‌نشده' : 'بررسی‌نشده'}</dd></div></dl></div>}
      {receipt.cheque.showImage && chequePhoto && <div className="inv-cheque-picture"><h3>تصویر ضمیمهٔ چک</h3><img src={chequePhoto} alt="تصویر چک این فاکتور"/></div>}
      <p className="inv-cheque-disclaimer">این ضمیمه ثبت اطلاعات در نرم‌افزار است. وضعیت سامانهٔ صیاد و وصول نهایی فقط با استعلام بانکی تأیید می‌شود.</p>
      <footer>ضمیمهٔ فاکتور {formatRial(receipt.number)} · {brand.storeName}</footer>
    </section>}
  </div>;
}
