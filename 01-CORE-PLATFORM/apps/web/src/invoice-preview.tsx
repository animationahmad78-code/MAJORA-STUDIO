import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { InvoiceReceipt } from '@majora/database';
import { InvoiceDocument, type InvoiceBrand, type PaperSize } from '../../mobile/src/invoice-document';
import { api, type InvoiceBrand as BrandView } from './api';
import { makeInvoiceFiles, saveBlob, type ExportKind } from './invoice-export';
import './invoice-print.css';

export type InvoiceRecord = {
  id: string; number: number; revision?: number; issuedAt: string; customerName: string; customerPhone: string;
  paymentStatus: string; totalRial: number; paidRial: number; returnedRial: number; refundedRial: number; brandSnapshotJson: string;
  lines: { id: string; productId?: string; nameSnapshot: string; quantity: number; unitPriceRial: number; totalRial: number }[];
};
type InvoiceCheque = { id: string; serial: string; bank: string; amountRial: number; dueAt: string; sayadId: string;
  issuerNationalId: string; beneficiaryNationalId: string; registrationStatus: 'unknown' | 'unregistered' | 'registered' | 'confirmed';
  status: 'open' | 'cleared' | 'returned' | 'cancelled'; showDetails: boolean; showImage: boolean; hasPhoto: boolean };

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

export function InvoicePreview({ id, close, snapshot }: { id: string; close: () => void; snapshot?: InvoiceRecord }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [fallbackBrand, setFallbackBrand] = useState<BrandView | null>(null);
  const [brandError, setBrandError] = useState('');
  const [cheque, setCheque] = useState<InvoiceCheque | null>(null);
  const [chequeReady, setChequeReady] = useState(!!snapshot);
  const [loading, setLoading] = useState(!snapshot);
  const [chequeError, setChequeError] = useState('');
  const [retry, setRetry] = useState(0);
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [mono, setMono] = useState(false);
  const [fit, setFit] = useState(true);
  const [availableWidth, setAvailableWidth] = useState(794);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let active = true;
    setInvoice(snapshot ?? null); setCheque(null); setChequeError(''); setError(''); setBrandError('');
    setLoading(!snapshot); setChequeReady(!!snapshot);
    if (!snapshot) {
      void api<InvoiceRecord>(`/merchant/invoices/${id}`).then(record => {
        if (!active) return;
        setInvoice(record);
        setLoading(false);
        if (record.paymentStatus !== 'cheque') { setChequeReady(true); return; }
        void api<InvoiceCheque | null>(`/merchant/invoices/${id}/cheque`)
          .then(value => {
            if (!active) return;
            if (value) setCheque(value);
            else setChequeError('پروندهٔ چک این فاکتور پیدا نشد. برای خروجی کامل، دوباره دریافت کنید.');
          })
          .catch(() => { if (active) setChequeError('مشخصات چک دریافت نشد. برای خروجی کامل دوباره تلاش کنید.'); })
          .finally(() => { if (active) setChequeReady(true); });
      }).catch(reason => {
        if (!active) return;
        setLoading(false);
        setChequeReady(true);
        setError(reason instanceof Error ? reason.message : 'فاکتور دریافت نشد. دوباره تلاش کنید.');
      });
    }
    void api<BrandView>('/merchant/invoice-brand').then(value => { if (active) setFallbackBrand(value); })
      .catch(() => { if (active) setBrandError('قالب فعلی فروشگاه دریافت نشد. اگر این فاکتور هویت ذخیره‌شده ندارد، دریافت دوباره را بزنید.'); });
    return () => { active = false; };
  }, [id, snapshot, retry]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [close, busy]);
  useLayoutEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const measure = () => setAvailableWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(entries => setAvailableWidth(entries[0].contentRect.width));
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [invoice, fallbackBrand]);

  let brandView = fallbackBrand;
  if (invoice?.brandSnapshotJson) {
    try { brandView = JSON.parse(invoice.brandSnapshotJson) as BrandView; }
    catch { brandView = fallbackBrand; }
  }
  const brand: InvoiceBrand | null = brandView ? {
    storeName: brandView.storeName, slogan: brandView.slogan, phone: brandView.phone, address: brandView.address,
    card: brandView.card, cardHolder: brandView.cardHolder, note: brandView.note, conditions: brandView.conditions,
    socialTelegram: brandView.socialTelegram, socialInstagram: brandView.socialInstagram, socialContact: brandView.socialContact,
    socialLinks: brandView.socialLinks
  } : null;
  const receipt: InvoiceReceipt | null = invoice ? {
    id: invoice.id, number: invoice.number, at: invoice.issuedAt,
    dateJalali: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(invoice.issuedAt)),
    customerName: invoice.customerName, customerPhone: invoice.customerPhone,
    paymentStatus: invoice.paymentStatus as InvoiceReceipt['paymentStatus'],
    paymentMethod: cheque ? 'چک' : invoice.paymentStatus === 'paid' ? 'تسویه‌شده' : invoice.paymentStatus === 'partial' ? 'پیش‌پرداخت' : invoice.paymentStatus === 'unpaid' ? 'تسویه‌نشده' : 'پیش‌فاکتور',
    dueDateJalali: cheque ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(cheque.dueAt)) : undefined,
    cheque: cheque ? { serial: cheque.serial, bank: cheque.bank, amountRial: cheque.amountRial,
      dueJalali: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(cheque.dueAt)),
      sayadId: cheque.sayadId, issuerNationalId: cheque.issuerNationalId, beneficiaryNationalId: cheque.beneficiaryNationalId,
      registrationStatus: cheque.registrationStatus, showDetails: cheque.showDetails, showImage: cheque.showImage && cheque.hasPhoto, status: cheque.status } : undefined,
    paidRial: invoice.paidRial, returnedRial: invoice.returnedRial, refundedRial: invoice.refundedRial,
    balanceRial: invoice.paymentStatus === 'proforma' ? 0 : Math.max(0, invoice.totalRial - invoice.returnedRial - invoice.paidRial + invoice.refundedRial),
    totalRial: invoice.totalRial,
    discountRial: invoice.lines.reduce((sum, line) => sum + line.unitPriceRial * line.quantity - line.totalRial, 0),
    subtotalRial: invoice.lines.reduce((sum, line) => sum + line.unitPriceRial * line.quantity, 0),
    lines: invoice.lines.map(line => ({ productId: line.productId, name: line.nameSnapshot, quantity: line.quantity,
      unitPriceRial: line.unitPriceRial, discountRial: line.unitPriceRial * line.quantity - line.totalRial, totalRial: line.totalRial }))
  } : null;
  const text = receipt && brand ? [
    brand.storeName,
    `${invoice?.paymentStatus === 'proforma' ? 'پیش‌فاکتور' : 'فاکتور'} ${receipt.number}`,
    `تاریخ: ${receipt.dateJalali}`,
    `خریدار: ${receipt.customerName}`,
    receipt.customerPhone ? `تلفن: ${receipt.customerPhone}` : '',
    ...receipt.lines.map((x, index) => `${index + 1}. ${x.name} × ${x.quantity} × ${x.unitPriceRial.toLocaleString('fa-IR')} = ${x.totalRial.toLocaleString('fa-IR')} ریال`),
    receipt.discountRial ? `تخفیف: ${receipt.discountRial.toLocaleString('fa-IR')} ریال` : '',
    `جمع: ${receipt.totalRial.toLocaleString('fa-IR')} ریال`,
    receipt.returnedRial ? `مرجوعی: ${receipt.returnedRial.toLocaleString('fa-IR')} ریال` : '',
    receipt.returnedRial ? `خالص فروش: ${(receipt.totalRial - receipt.returnedRial).toLocaleString('fa-IR')} ریال` : '',
    `پرداختی: ${(receipt.paidRial ?? 0).toLocaleString('fa-IR')} ریال`,
    receipt.refundedRial ? `وجه بازپرداخت‌شده: ${receipt.refundedRial.toLocaleString('fa-IR')} ریال` : '',
    invoice?.paymentStatus === 'proforma' ? 'این سند پیش‌فاکتور است و بدهی ایجاد نمی‌کند.' : `مانده: ${(receipt.balanceRial ?? 0).toLocaleString('fa-IR')} ریال`,
    receipt.returnedRial && (receipt.paidRial ?? 0) - (receipt.refundedRial ?? 0) > receipt.totalRial - receipt.returnedRial ? `طلب مشتری از فروشگاه: ${((receipt.paidRial ?? 0) - (receipt.refundedRial ?? 0) - receipt.totalRial + receipt.returnedRial).toLocaleString('fa-IR')} ریال` : '',
    cheque ? `چک ${cheque.serial} · ${cheque.bank} · ${cheque.amountRial.toLocaleString('fa-IR')} ریال · سررسید ${receipt.dueDateJalali}` : '',
    brand.card ? `شماره کارت: ${brand.card}${brand.cardHolder ? ` به نام ${brand.cardHolder}` : ''}` : '',
    brand.phone ? `تلفن فروشگاه: ${brand.phone}` : ''
  ].filter(Boolean).join('\n') : '';

  async function exportFile(kind: ExportKind, action: 'save' | 'share') {
    if (!previewRef.current || !invoice) return;
    setError('');
    setBusy(kind === 'pdf' ? 'در حال ساخت PDF فاکتور…' : 'در حال ساخت تصویر فاکتور…');
    try {
      const files = await makeInvoiceFiles(previewRef.current, paper, invoice.number, kind, snapshot ? invoice.revision : undefined);
      if (action === 'share' && navigator.share && navigator.canShare?.({ files })) {
        await navigator.share({ title: `فاکتور ${invoice.number}`, files });
      } else if (files.length === 1) {
        saveBlob(files[0], files[0].name);
        if (action === 'share') setError('اشتراک فایل در این مرورگر فعال نیست؛ فایل ذخیره شد.');
      } else {
        const archive = new JSZip();
        files.forEach(file => archive.file(file.name, file));
        saveBlob(await archive.generateAsync({ type: 'blob' }), `majora-invoice-${invoice.number}${snapshot ? `-revision-${invoice.revision ?? 'old'}` : ''}-${paper}-images.zip`);
        if (action === 'share') setError('اشتراک چند تصویر در این مرورگر فعال نیست؛ فایل ZIP ذخیره شد.');
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'خروجی فاکتور آماده نشد.');
    } finally { setBusy(''); }
  }
  async function printInvoice() {
    if (!previewRef.current) return;
    setBusy('در حال آماده‌سازی چاپ فاکتور…'); setError('');
    try {
      await document.fonts.ready;
      await Promise.all(Array.from(previewRef.current.querySelectorAll('img')).map(image => image.decode()));
      setBusy(''); print(paper);
    } catch { setError('تصویر فاکتور کامل بارگذاری نشد؛ چاپ را دوباره امتحان کنید.'); setBusy(''); }
  }

  async function shareText() {
    if (!text) return;
    try {
      if (navigator.share) await navigator.share({ title: `فاکتور ${invoice?.number}`, text });
      else { await navigator.clipboard.writeText(text); setError('اشتراک‌گذاری در این مرورگر فعال نیست؛ متن فاکتور کپی شد.'); }
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError('اشتراک‌گذاری متن انجام نشد.'); }
  }
  const previewScale = fit ? Math.min(1, Math.max(0.25, (availableWidth - 16) / (paper === 'a4' ? 794 : 560))) : 1;
  const canExport = !!receipt && !!brand && chequeReady && (!chequeError || invoice?.paymentStatus !== 'cheque') && !busy;

  return <div className="modal-backdrop print-backdrop" onClick={() => { if (!busy) close(); }}>
    <div className="invoice-dialog detailed-invoice-dialog" role="dialog" aria-modal="true" aria-label="پیش‌نمایش فاکتور" onClick={e => e.stopPropagation()}>
      <div className="print-actions">
        <div className="print-heading"><strong>{invoice?.paymentStatus === 'proforma' ? 'پیش‌فاکتور' : 'فاکتور'} {invoice?.number ?? ''}{snapshot ? ` · نسخهٔ ${invoice?.revision ?? 'قدیمی'}` : ''}</strong><button onClick={close} disabled={!!busy}>بستن</button></div>
        <div className="print-settings"><label>کاغذ<select value={paper} onChange={e => setPaper(e.target.value as PaperSize)} disabled={!!busy}><option value="a4">A4</option><option value="a5">A5</option></select></label><label className="print-checkbox"><input type="checkbox" checked={mono} onChange={e => setMono(e.target.checked)} disabled={!!busy}/>سیاه و سفید</label><button onClick={() => setFit(value => !value)} disabled={!!busy}>{fit ? 'نمایش درشت' : 'نمایش کامل'}</button></div>
        <div className="print-main-actions"><button onClick={() => void exportFile('pdf', 'save')} disabled={!canExport}>دریافت PDF</button><button onClick={() => void exportFile('png', 'save')} disabled={!canExport}>ذخیره تصویر</button><button className="primary" onClick={() => void printInvoice()} disabled={!canExport}>چاپ {paper.toUpperCase()}</button></div>
        <details className="print-more"><summary>اشتراک‌گذاری و متن فاکتور</summary><div><button onClick={() => void exportFile('pdf', 'share')} disabled={!canExport}>اشتراک PDF</button><button onClick={() => void exportFile('png', 'share')} disabled={!canExport}>اشتراک تصویر</button><button onClick={() => void navigator.clipboard.writeText(text).catch(() => setError('کپی متن انجام نشد.'))} disabled={!text || !!busy}>کپی متن</button><button onClick={() => void shareText()} disabled={!text || !!busy}>اشتراک متن</button></div></details>
      </div>
      {error && <div role="alert" className="field-error">{error}</div>}
      {brandError && !brand && <div role="alert" className="field-error">{brandError}</div>}
      {chequeError && <div role="alert" className="field-error">{chequeError}</div>}
      {(error || chequeError || brandError && !brand) && <button type="button" onClick={() => setRetry(value => value + 1)} disabled={!!busy}>دریافت دوباره فاکتور</button>}
      {busy && <div className="invoice-export-progress" role="status" aria-live="polite"><span className="invoice-export-spinner" aria-hidden="true"/>{busy}</div>}
      {receipt && brand ? <div ref={previewRef} className="invoice-preview-scroll"><div className="invoice-preview-fit" style={{ zoom: previewScale }}><InvoiceDocument brand={brand} receipt={receipt} mono={mono} paper={paper} logo={brandView?.logoDataUrl || placeholderLogo(brand.storeName)} chequePhoto={cheque?.hasPhoto ? `/api/merchant/accounting/cheques/${cheque.id}/photo` : undefined} revisionLabel={snapshot ? `نسخهٔ ${invoice?.revision ?? 'قدیمی'}` : undefined}/></div></div> : loading ? <div className="empty" role="status">در حال دریافت فاکتور…</div> : !error ? <div className="empty">قالب فاکتور دریافت نشد. دریافت دوباره را انتخاب کنید.</div> : null}
    </div>
  </div>;
}
