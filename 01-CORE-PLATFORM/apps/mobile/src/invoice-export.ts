import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { nativeDevice } from './native-db';
import type { PaperSize } from './invoice-document';

export type InvoiceExportFormat = 'pdf' | 'png';
const nativePrinter = registerPlugin<{ print(options: { uri: string; paper: PaperSize; title: string }): Promise<{ opened: boolean }> }>('InvoicePrint');
const nativeMedia = registerPlugin<{ saveImages(options: { uris: string[] }): Promise<{ saved: number }> }>('InvoiceMedia');

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function base64FromDataUrl(dataUrl: string): string { return dataUrl.slice(dataUrl.indexOf(',') + 1); }

async function captureInvoice(root: HTMLElement, scale: number): Promise<HTMLCanvasElement[]> {
  await document.fonts.ready;
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-invoice-page]'));
  if (!pages.length) throw new Error('صفحهٔ فاکتور برای خروجی پیدا نشد.');
  const canvases: HTMLCanvasElement[] = [];
  for (const page of pages) {
    const host = document.createElement('div');
    // html2canvas needs a laid-out node; place it outside the viewport so it never flashes over the app.
    host.style.cssText = 'position:fixed;left:-100000px;top:0;z-index:-1;pointer-events:none;background:#fff;overflow:visible;';
    const wrapper = document.createElement('div');
    wrapper.className = page.closest('.invoice-document')?.className || 'invoice-document a4';
    const copy = page.cloneNode(true) as HTMLElement;
    wrapper.appendChild(copy); host.appendChild(wrapper); document.body.appendChild(host);
    await Promise.all(Array.from(copy.querySelectorAll('img')).map(image => image.decode().catch(() => undefined)));
    try { canvases.push(await html2canvas(copy, { backgroundColor: '#ffffff', scale, useCORS: false, logging: false,
      width: copy.offsetWidth, height: copy.offsetHeight, scrollX: 0, scrollY: 0 })); }
    finally { host.remove(); }
  }
  return canvases;
}

function pdfFor(canvases: HTMLCanvasElement[], paper: PaperSize): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: paper, compress: true });
  const width = paper === 'a4' ? 210 : 148;
  const height = paper === 'a4' ? 297 : 210;
  canvases.forEach((canvas, index) => {
    if (index) pdf.addPage(paper, 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, width, height);
  });
  return pdf;
}

export async function createInvoicePdf(root: HTMLElement, paper: PaperSize, scale = 2): Promise<Blob> {
  return pdfFor(await captureInvoice(root, scale), paper).output('blob');
}

export async function exportInvoice(number: number | string, format: InvoiceExportFormat, paper: PaperSize, root: HTMLElement, action: 'share' | 'print' | 'gallery' = 'share'): Promise<number> {
  const canvases = await captureInvoice(root, 2);
  const base = `classicbag-invoice-${number}-${paper}`;
  if (format === 'pdf') {
    const pdf = pdfFor(canvases, paper);
    if (nativeDevice) {
      const path = `exports/${base}.pdf`;
      await Filesystem.writeFile({ path, directory: Directory.Cache, data: base64FromDataUrl(pdf.output('datauristring')), recursive: true });
      const file = await Filesystem.getUri({ path, directory: Directory.Cache });
      if (action === 'print' && Capacitor.getPlatform() === 'android') await nativePrinter.print({ uri: file.uri, paper, title: `MAJORA Invoice ${number}` });
      else await Share.share({ title: `فاکتور ${number} · ${paper.toUpperCase()}`, files: [file.uri], dialogTitle: 'ذخیره یا ارسال فاکتور' });
    } else if (action === 'print') window.print(); else download(pdf.output('blob'), `${base}.pdf`);
  } else {
    if (nativeDevice) {
      const files: string[] = [];
      for (const [index, canvas] of canvases.entries()) {
        const path = `exports/${base}-page-${index + 1}.png`;
        await Filesystem.writeFile({ path, directory: Directory.Cache, data: base64FromDataUrl(canvas.toDataURL('image/png')), recursive: true });
        files.push((await Filesystem.getUri({ path, directory: Directory.Cache })).uri);
      }
      if (action === 'gallery' && Capacitor.getPlatform() === 'android') {
        const result = await nativeMedia.saveImages({ uris: files });
        if (result.saved !== files.length) throw new Error('همهٔ صفحه‌های تصویر در گالری ذخیره نشدند.');
      } else await Share.share({ title: `تصویر فاکتور ${number}`, files, dialogTitle: 'اشتراک‌گذاری تصاویر فاکتور' });
    } else canvases.forEach((canvas, index) => canvas.toBlob(blob => { if (blob) download(blob, `${base}-page-${index + 1}.png`); }, 'image/png'));
  }
  return canvases.length;
}
