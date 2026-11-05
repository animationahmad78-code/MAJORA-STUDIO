import { useEffect, useState } from 'react';
import type { InvoiceReceipt } from '@majora/database';
import { InvoiceDocument, type InvoiceBrand, type PaperSize } from '../../mobile/src/invoice-document';
import { api, type InvoiceBrand as BrandView } from './api';
import './invoice-print.css';

type InvoiceRecord = {
  id: string; number: number; issuedAt: string; customerName: string; customerPhone: string;
  paymentStatus: string; totalRial: number; paidRial: number; brandSnapshotJson: string;
  lines: { id: string; productId?: string; nameSnapshot: string; quantity: number; unitPriceRial: number; totalRial: number }[];
};

function placeholderLogo(name: string) {
  const label = (name.trim().slice(0, 1) || 'ک').replace(/[&<>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><circle cx="80" cy="80" r="76" fill="#082d60" stroke="#c89439" stroke-width="5"/><text x="80" y="106" text-anchor="middle" font-family="Tahoma" font-size="78" fill="#eec677">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function print(paper: PaperSize) {
  const style = document.createElement('style');
  style.media = 'print';
  style.textContent = `@page { size: ${paper.toUpperCase()} portrait; margin: 0; }`;
  document.head.append(style);
  const cleanup = () => { style.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 30000);
}

export function InvoicePreview({ id, close }: { id: string; close: () => void }) {
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [fallbackBrand, setFallbackBrand] = useState<BrandView | null>(null);
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [mono, setMono] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<InvoiceRecord>(`/merchant/invoices/${id}`).then(setInvoice).catch(e => setError(e.message));
    api<BrandView>('/merchant/invoice-brand').then(setFallbackBrand).catch(() => {});
  }, [id]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [close]);

  let brandView = fallbackBrand;
  if (invoice?.brandSnapshotJson) {
    try { brandView = JSON.parse(invoice.brandSnapshotJson) as BrandView; }
    catch { brandView = fallbackBrand; }
  }
  const brand: InvoiceBrand | null = brandView ? {
    storeName: brandView.storeName, slogan: brandView.slogan, phone: brandView.phone, address: brandView.address,
    card: brandView.card, cardHolder: brandView.cardHolder, note: brandView.note, conditions: brandView.conditions,
    socialTelegram: brandView.socialTelegram, socialInstagram: brandView.socialInstagram, socialContact: brandView.socialContact
  } : null;
  const receipt: InvoiceReceipt | null = invoice ? {
    id: invoice.id, number: invoice.number, at: invoice.issuedAt,
    dateJalali: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(invoice.issuedAt)),
    customerName: invoice.customerName, customerPhone: invoice.customerPhone,
    paymentStatus: invoice.paymentStatus as InvoiceReceipt['paymentStatus'],
    paidRial: invoice.paidRial, balanceRial: invoice.totalRial - invoice.paidRial,
    totalRial: invoice.totalRial,
    lines: invoice.lines.map(line => ({ productId: line.productId, name: line.nameSnapshot, quantity: line.quantity,
      unitPriceRial: line.unitPriceRial, totalRial: line.totalRial }))
  } : null;
  const text = receipt && brand ? [
    brand.storeName,
    `${invoice?.paymentStatus === 'proforma' ? 'پیش‌فاکتور' : 'فاکتور'} ${receipt.number}`,
    `تاریخ: ${receipt.dateJalali}`,
    `خریدار: ${receipt.customerName}`,
    receipt.customerPhone ? `تلفن: ${receipt.customerPhone}` : '',
    ...receipt.lines.map((x, index) => `${index + 1}. ${x.name} × ${x.quantity} × ${x.unitPriceRial.toLocaleString('fa-IR')} = ${x.totalRial.toLocaleString('fa-IR')} ریال`),
    `جمع: ${receipt.totalRial.toLocaleString('fa-IR')} ریال`,
    `پرداختی: ${(receipt.paidRial ?? 0).toLocaleString('fa-IR')} ریال`,
    `مانده: ${(receipt.balanceRial ?? 0).toLocaleString('fa-IR')} ریال`,
    brand.card ? `شماره کارت: ${brand.card}${brand.cardHolder ? ` به نام ${brand.cardHolder}` : ''}` : '',
    brand.phone ? `تلفن فروشگاه: ${brand.phone}` : ''
  ].filter(Boolean).join('\n') : '';

  return <div className="modal-backdrop print-backdrop" onClick={close}>
    <div className="invoice-dialog detailed-invoice-dialog" role="dialog" aria-modal="true" aria-label="پیش‌نمایش فاکتور" onClick={e => e.stopPropagation()}>
      <div className="print-actions"><button onClick={close}>بستن</button><label>اندازهٔ کاغذ<select value={paper} onChange={e => setPaper(e.target.value as PaperSize)}><option value="a4">A4</option><option value="a5">A5</option></select></label><label className="print-checkbox"><input type="checkbox" checked={mono} onChange={e => setMono(e.target.checked)}/>سیاه و سفید</label><button onClick={() => void navigator.clipboard.writeText(text)} disabled={!text}>کپی متن</button><button className="primary" onClick={() => print(paper)} disabled={!receipt || !brand}>چاپ / ذخیره PDF</button></div>
      {error && <div role="alert" className="field-error">{error}</div>}
      {receipt && brand ? <div className="invoice-preview-scroll"><InvoiceDocument brand={brand} receipt={receipt} mono={mono} paper={paper} logo={brandView?.logoDataUrl || placeholderLogo(brand.storeName)}/></div> : <div className="empty">در حال دریافت فاکتور…</div>}
    </div>
  </div>;
}
