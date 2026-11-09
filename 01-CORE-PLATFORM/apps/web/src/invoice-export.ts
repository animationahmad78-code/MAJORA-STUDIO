import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { PaperSize } from '../../mobile/src/invoice-document';

export type ExportKind = 'pdf' | 'png';

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function renderPages(root: HTMLElement): Promise<HTMLCanvasElement[]> {
  await document.fonts.ready;
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-invoice-page]'));
  if (!pages.length) throw new Error('صفحهٔ فاکتور برای خروجی پیدا نشد.');
  const canvases: HTMLCanvasElement[] = [];
  for (const page of pages) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;z-index:-1;pointer-events:none;background:#fff;overflow:visible';
    const wrapper = document.createElement('div');
    wrapper.className = page.closest('.invoice-document')?.className || 'invoice-document a4';
    const copy = page.cloneNode(true) as HTMLElement;
    wrapper.append(copy);
    host.append(wrapper);
    document.body.append(host);
    try {
      await Promise.all(Array.from(copy.querySelectorAll('img')).map(image => image.decode()));
      canvases.push(await html2canvas(copy, {
        backgroundColor: '#ffffff', scale: 2, useCORS: false, logging: false,
        width: copy.offsetWidth, height: copy.offsetHeight, scrollX: 0, scrollY: 0
      }));
    } finally { host.remove(); }
  }
  return canvases;
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('ساخت تصویر فاکتور انجام نشد.')), 'image/png'));
}

export async function makeInvoiceFiles(root: HTMLElement, paper: PaperSize, number: number, kind: ExportKind, revision?: number): Promise<File[]> {
  const canvases = await renderPages(root);
  const basename = `majora-invoice-${number}${revision ? `-revision-${revision}` : ''}-${paper}`;
  if (kind === 'png') return Promise.all(canvases.map(async (canvas, index) => new File([await pngBlob(canvas)], `${basename}-page-${index + 1}.png`, { type: 'image/png' })));

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: paper, compress: true });
  const width = paper === 'a4' ? 210 : 148;
  const height = paper === 'a4' ? 297 : 210;
  canvases.forEach((canvas, index) => {
    if (index) pdf.addPage(paper, 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, width, height);
  });
  return [new File([pdf.output('blob')], `${basename}.pdf`, { type: 'application/pdf' })];
}
