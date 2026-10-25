import { formatRial } from '@majora/domain';
import type { InvoiceReceipt } from '@majora/database';
import './invoice-document.css';

export type PaperSize = 'a4' | 'a5';
export type InvoiceBrand = {
  storeName: string; slogan: string; phone: string; address: string; card: string; cardHolder: string;
  note: string; conditions: string[]; socialTelegram: string; socialInstagram: string; socialContact: string;
};
type Props = { brand: InvoiceBrand; receipt: InvoiceReceipt; mono: boolean; paper: PaperSize; logo: string; chequePhoto?: string };

export function pageLines<T extends { name: string }>(lines: T[], paper: PaperSize): T[][] {
  // Reserve the bottom of the last sheet for terms, totals and signatures.
  // Long names consume extra row height; a fixed row count would overlap that area.
  const finalBudget = paper === 'a4' ? 300 : 165;
  const continuationBudget = paper === 'a4' ? 690 : 465;
  const rowHeight = (line: T) => {
    const charactersPerLine = paper === 'a4' ? 38 : 30;
    const linesOfText = Math.max(1, Math.ceil([...line.name].length / charactersPerLine));
    return paper === 'a4' ? Math.max(30, 11 + linesOfText * 18) : Math.max(23, 8 + linesOfText * 13);
  };
  const height = (items: T[]) => items.reduce((sum, line) => sum + rowHeight(line), 0);
  if (height(lines) <= finalBudget) return [lines];
  const pages: T[][] = [];
  let offset = 0;
  while (height(lines.slice(offset)) > finalBudget && offset < lines.length - 1) {
    let count = 0;
    let used = 0;
    while (offset + count < lines.length - 1 && used + rowHeight(lines[offset + count]) <= continuationBudget) {
      used += rowHeight(lines[offset + count]);
      count += 1;
    }
    if (!count) count = 1;
    pages.push(lines.slice(offset, offset + count));
    offset += count;
  }
  pages.push(lines.slice(offset));
  return pages;
}

export function InvoiceDocument({ brand, receipt, mono, paper, logo, chequePhoto }: Props) {
  const chunks = pageLines(receipt.lines, paper);
  const annex = !!receipt.cheque && (receipt.cheque.showDetails || receipt.cheque.showImage);
  const pageTotal = chunks.length + Number(annex);
  const proforma = receipt.paymentStatus === 'proforma';
  const discount = receipt.discountRial ?? receipt.lines.reduce((sum, line) => sum + (line.discountRial ?? 0), 0);
  const subtotal = receipt.subtotalRial ?? receipt.totalRial + discount;
  return <div className={`invoice-document ${paper} ${mono ? 'mono' : ''}`} dir="rtl">
    {chunks.map((lines, pageIndex) => {
      const last = pageIndex === chunks.length - 1;
      const before = chunks.slice(0, pageIndex).reduce((sum, chunk) => sum + chunk.length, 0);
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
          <span>{proforma ? 'شماره پیش‌فاکتور' : 'شماره فاکتور'}: <b>{formatRial(receipt.number)}</b></span>
          <span>تاریخ: <b>{receipt.dateJalali || new Date(receipt.at).toLocaleDateString('fa-IR-u-ca-persian')}</b></span>
          <span>نام خریدار: <b>{receipt.customerName || 'خریدار حضوری'}</b></span>
          <span>شماره تماس: <b dir="ltr">{receipt.customerPhone || '—'}</b></span>
          <span>آدرس: <b>{receipt.customerAddress || '—'}</b></span><span>نحوه پرداخت: <b>{receipt.paymentMethod || '—'}</b></span>
          <span>تاریخ سررسید: <b>{receipt.dueDateJalali || '—'}</b></span><span>صفحه: <b>{formatRial(pageIndex + 1)} از {formatRial(pageTotal)}</b></span>
        </div>
        {pageIndex > 0 && <div className="inv-continuation">ادامهٔ {proforma ? 'پیش‌فاکتور' : 'فاکتور'} شمارهٔ {formatRial(receipt.number)} · صفحهٔ {formatRial(pageIndex + 1)}</div>}
        <table className="inv-table"><thead><tr><th>ردیف</th><th>کد</th><th>شرح کالا / دسته‌بندی</th><th>رنگ</th><th>تعداد</th><th>فی</th><th>تخفیف</th><th>مبلغ کل</th></tr></thead>
          <tbody>{lines.length ? lines.map((line, index) => <tr key={`${line.productId || line.name}-${index}`}><td>{formatRial(before + index + 1)}</td><td>—</td><td>{line.name}</td><td>{line.color || '—'}</td><td>{formatRial(line.quantity)}</td><td>{formatRial(line.unitPriceRial)}</td><td>{formatRial(line.discountRial ?? 0)}</td><td>{formatRial(line.totalRial)}</td></tr>) : <tr><td colSpan={8}>هنوز کالایی انتخاب نشده است.</td></tr>}</tbody></table>
        {last && <div className="inv-final">
          <div className="inv-summary"><div><span>جمع کل</span><b>{formatRial(subtotal)}</b></div><div><span>تخفیف</span><b>{formatRial(discount)}</b></div><div><span>هزینه ارسال</span><b>{formatRial(receipt.shippingRial ?? 0)}</b></div><div className="inv-grand"><span>مبلغ نهایی</span><b>{formatRial(receipt.totalRial)}</b></div><div><span>مبلغ پرداختی</span><b>{formatRial(receipt.paidRial ?? 0)}</b></div><div><span>مانده</span><b>{formatRial(receipt.balanceRial ?? receipt.totalRial)}</b></div><div className="inv-sign">امضای خریدار</div><div className="inv-sign">امضای فروشنده</div></div>
          <div className="inv-conditions">{proforma ? <><h3>پیش‌فاکتور</h3><p>این سند پیشنهاد فروش است. کالا تحویل نشده و پرداختی ثبت نشده است. فروش و کسر موجودی پس از تأیید و تبدیل این سند به فاکتور قطعی انجام می‌شود.</p></> : <><h3>شرایط فروش و تحویل کالا</h3><ol>{brand.conditions.map((text, index) => <li key={index}>{text}</li>)}</ol><strong>لطفاً پیش از تأیید سفارش، مشخصات و تعداد کالاها را بررسی فرمایید.</strong><p>با تشکر از اعتماد و همکاری شما.</p></>}</div>
        </div>}
        <footer className="inv-social"><span>➤ {brand.socialTelegram}</span><span>◎ {brand.socialInstagram}</span><span>➤ {brand.socialContact}</span></footer>
      </section>;
    })}
    {annex && receipt.cheque && <section className="invoice-paper inv-cheque-annex" data-invoice-page aria-label={`ضمیمهٔ چک فاکتور ${receipt.number}`}>
      <header><img src={logo} alt="نشان فروشگاه"/><div><h2>{brand.storeName}</h2><strong>ضمیمهٔ چک فاکتور شمارهٔ {formatRial(receipt.number)}</strong><p>صفحهٔ {formatRial(pageTotal)} از {formatRial(pageTotal)} · تاریخ فاکتور {receipt.dateJalali}</p></div></header>
      {receipt.cheque.showDetails && <div className="inv-cheque-details"><h3>مشخصات چک ثبت‌شده</h3><dl><div><dt>شماره چک</dt><dd>{receipt.cheque.serial}</dd></div><div><dt>بانک</dt><dd>{receipt.cheque.bank}</dd></div><div><dt>مبلغ</dt><dd>{formatRial(receipt.cheque.amountRial)} ریال</dd></div><div><dt>سررسید</dt><dd>{receipt.cheque.dueJalali}</dd></div><div><dt>شناسه صیادی</dt><dd dir="ltr">{receipt.cheque.sayadId}</dd></div><div><dt>وضعیت ثبت اعلام‌شده</dt><dd>{receipt.cheque.registrationStatus === 'confirmed' ? 'تأییدشده توسط گیرنده' : receipt.cheque.registrationStatus === 'registered' ? 'ثبت‌شده توسط صادرکننده' : receipt.cheque.registrationStatus === 'unregistered' ? 'ثبت‌نشده' : 'بررسی‌نشده'}</dd></div></dl></div>}
      {receipt.cheque.showImage && chequePhoto && <div className="inv-cheque-picture"><h3>تصویر ضمیمهٔ چک</h3><img src={chequePhoto} alt="تصویر چک این فاکتور"/></div>}
      <p className="inv-cheque-disclaimer">این ضمیمه ثبت محلی اطلاعات است. وضعیت سامانهٔ صیاد و وصول نهایی فقط با استعلام بانکی تأیید می‌شود.</p>
      <footer>ضمیمهٔ فاکتور {formatRial(receipt.number)} · {brand.storeName}</footer>
    </section>}
  </div>;
}
