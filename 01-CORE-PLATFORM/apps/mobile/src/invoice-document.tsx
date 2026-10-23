import { formatRial } from '@majora/domain';
import type { InvoiceReceipt } from '@majora/database';
import './invoice-document.css';

export type PaperSize = 'a4' | 'a5';
export type InvoiceBrand = {
  storeName: string; slogan: string; phone: string; address: string; card: string; cardHolder: string;
  note: string; conditions: string[]; socialTelegram: string; socialInstagram: string; socialContact: string;
};
type Props = { brand: InvoiceBrand; receipt: InvoiceReceipt; mono: boolean; paper: PaperSize; logo: string };

function pageLines<T>(lines: T[], paper: PaperSize): T[][] {
  const lastCapacity = paper === 'a4' ? 10 : 5;
  const earlierCapacity = paper === 'a4' ? 21 : 12;
  if (lines.length <= lastCapacity) return [lines];
  const pages: T[][] = [];
  let offset = 0;
  while (lines.length - offset > lastCapacity) {
    const remaining = lines.length - offset;
    const count = Math.min(earlierCapacity, Math.max(lastCapacity, remaining - lastCapacity));
    pages.push(lines.slice(offset, offset + count));
    offset += count;
  }
  pages.push(lines.slice(offset));
  return pages;
}

export function InvoiceDocument({ brand, receipt, mono, paper, logo }: Props) {
  const chunks = pageLines(receipt.lines, paper);
  const discount = receipt.discountRial ?? receipt.lines.reduce((sum, line) => sum + (line.discountRial ?? 0), 0);
  const subtotal = receipt.subtotalRial ?? receipt.totalRial + discount;
  return <div className={`invoice-document ${paper} ${mono ? 'mono' : ''}`} dir="rtl">
    {chunks.map((lines, pageIndex) => {
      const last = pageIndex === chunks.length - 1;
      const before = chunks.slice(0, pageIndex).reduce((sum, chunk) => sum + chunk.length, 0);
      return <section className="invoice-paper" data-invoice-page key={pageIndex} aria-label={`فاکتور ${receipt.number}، صفحه ${pageIndex + 1}`}>
        <header className="inv-header">
          <img src={logo} alt="نشان فروشگاه"/>
          <div className="inv-identity"><h2>{brand.storeName}</h2><strong>{brand.slogan}</strong>
            <div className="inv-phones" dir="ltr">{brand.phone.split('|').map((phone, i) => <span key={i}>☎ {phone.trim()}</span>)}</div>
            <p>◆ {brand.address}</p></div>
        </header>
        {(receipt.showCardNumber ?? true) && <div className="inv-payment"><span>▣ شماره کارت <b dir="ltr">{brand.card}</b></span><span>♟ {brand.cardHolder}</span></div>}
        <div className="inv-note">➤ {brand.note}</div>
        <div className="inv-meta">
          <span>شماره فاکتور: <b>{formatRial(receipt.number)}</b></span>
          <span>تاریخ: <b>{receipt.dateJalali || new Date(receipt.at).toLocaleDateString('fa-IR-u-ca-persian')}</b></span>
          <span>نام خریدار: <b>{receipt.customerName || 'خریدار حضوری'}</b></span>
          <span>شماره تماس: <b dir="ltr">{receipt.customerPhone || '—'}</b></span>
          <span>آدرس: <b>{receipt.customerAddress || '—'}</b></span><span>نحوه پرداخت: <b>{receipt.paymentMethod || '—'}</b></span>
          <span>تاریخ سررسید: <b>{receipt.dueDateJalali || '—'}</b></span><span>صفحه: <b>{formatRial(pageIndex + 1)} از {formatRial(chunks.length)}</b></span>
        </div>
        {pageIndex > 0 && <div className="inv-continuation">ادامهٔ فاکتور شمارهٔ {formatRial(receipt.number)} · صفحهٔ {formatRial(pageIndex + 1)}</div>}
        <table className="inv-table"><thead><tr><th>ردیف</th><th>کد</th><th>شرح کالا / دسته‌بندی</th><th>رنگ</th><th>تعداد</th><th>فی</th><th>تخفیف</th><th>مبلغ کل</th></tr></thead>
          <tbody>{lines.length ? lines.map((line, index) => <tr key={`${line.productId || line.name}-${index}`}><td>{formatRial(before + index + 1)}</td><td>—</td><td>{line.name}</td><td>{line.color || '—'}</td><td>{formatRial(line.quantity)}</td><td>{formatRial(line.unitPriceRial)}</td><td>{formatRial(line.discountRial ?? 0)}</td><td>{formatRial(line.totalRial)}</td></tr>) : <tr><td colSpan={8}>هنوز کالایی انتخاب نشده است.</td></tr>}</tbody></table>
        {last && <div className="inv-final">
          <div className="inv-summary"><div><span>جمع کل</span><b>{formatRial(subtotal)}</b></div><div><span>تخفیف</span><b>{formatRial(discount)}</b></div><div><span>هزینه ارسال</span><b>{formatRial(receipt.shippingRial ?? 0)}</b></div><div className="inv-grand"><span>مبلغ نهایی</span><b>{formatRial(receipt.totalRial)}</b></div><div><span>مبلغ پرداختی</span><b>{formatRial(receipt.paidRial ?? 0)}</b></div><div><span>مانده</span><b>{formatRial(receipt.balanceRial ?? receipt.totalRial)}</b></div><div className="inv-sign">امضای خریدار</div><div className="inv-sign">امضای فروشنده</div></div>
          <div className="inv-conditions"><h3>شرایط فروش و تحویل کالا</h3><ol>{brand.conditions.map((text, index) => <li key={index}>{text}</li>)}</ol><strong>لطفاً پیش از تأیید سفارش، مشخصات و تعداد کالاها را بررسی فرمایید.</strong><p>با تشکر از اعتماد و همکاری شما.</p></div>
        </div>}
        <footer className="inv-social"><span>➤ {brand.socialTelegram}</span><span>◎ {brand.socialInstagram}</span><span>➤ {brand.socialContact}</span></footer>
      </section>;
    })}
  </div>;
}
