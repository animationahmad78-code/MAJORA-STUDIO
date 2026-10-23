import JSZip from 'jszip';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ShopRepository } from '@majora/database';
import type { InvoiceBrand } from './invoice-document';
import { activateRestoredDatabase, exportNativeDatabase, importVerifiedDatabaseStage } from './native-db';

const iterations = 310_000;
const encoder = new TextEncoder();
const allowedTables = new Set(['schema_migrations','store','category','product','customer','price_batch','price_event','stock_balance','stock_movement','template_version','template_field','invoice','invoice_counter','invoice_revision','invoice_line','payment','audit_event']);

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function sha256(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function keyFor(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function monthFolder(at: string): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return 'unknown-date';
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: '2-digit' })
    .formatToParts(date).map(part => [part.type, part.value]));
  return `${fields.year}/${fields.month}`;
}

export async function createEncryptedBackup(repo: ShopRepository, password: string, brand: InvoiceBrand, logo: string,
  onProgress?: (current: number, total: number) => void): Promise<{ path: string; bytes: number; databaseHash: string }> {
  if (password.length < 12) throw new Error('گذرواژهٔ پشتیبان باید دست‌کم ۱۲ نویسه باشد.');
  const snapshot = await exportNativeDatabase();
  const databaseJson = JSON.stringify(snapshot);
  const databaseHash = await sha256(databaseJson);
  const inner = new JSZip();
  inner.file('database/full-sqlite.json', databaseJson);
  const [products, archivedProducts, customers, archivedCustomers, invoices, archivedInvoices, photos] = await Promise.all([
    repo.listProducts(), repo.listArchivedProducts(), repo.listCustomers(), repo.listArchivedCustomers(),
    repo.listInvoiceHistory(), repo.listArchivedInvoices(), repo.listProductPhotoPaths()
  ]);
  for (const product of [...products, ...archivedProducts]) inner.file(`catalog/${product.archived ? 'archived' : 'active'}/${product.id}.json`, JSON.stringify(product));
  for (const customer of [...customers, ...archivedCustomers]) inner.file(`customers/${monthFolder(customer.createdAt ?? '')}/${customer.id}.json`, JSON.stringify(customer));
  const allInvoices = [...invoices, ...archivedInvoices];
  const { createRoot } = await import('react-dom/client');
  const { createElement } = await import('react');
  const { flushSync } = await import('react-dom');
  const [{ InvoiceDocument }, { createInvoicePdf }] = await Promise.all([import('./invoice-document'), import('./invoice-export')]);
  for (const [index, entry] of allInvoices.entries()) {
    const folder = monthFolder(entry.receipt.at);
    inner.file(`invoices/${folder}/${entry.receipt.number}.json`, JSON.stringify(entry));
    const fields = entry.receipt.templateFields ?? {};
    const snapshotBrand: InvoiceBrand = { ...brand, ...fields,
      conditions: brand.conditions.map((condition, i) => fields[`condition${i + 1}`] ?? condition) };
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;background:#fff;';
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      flushSync(() => root.render(createElement(InvoiceDocument, { brand: snapshotBrand, receipt: entry.receipt, mono: false, paper: 'a4', logo })));
      await Promise.all(Array.from(host.querySelectorAll('img')).map(image => image.decode().catch(() => undefined)));
      const pdf = await createInvoicePdf(host, 'a4', 1.5);
      inner.file(`invoices/${folder}/${entry.receipt.number}.pdf`, pdf);
      const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
      await Filesystem.writeFile({ path: `MAJORA/Invoices/${folder}/${entry.receipt.number}.pdf`, directory: Directory.Documents,
        data: base64(pdfBytes), recursive: true });
    } finally { root.unmount(); host.remove(); }
    onProgress?.(index + 1, allInvoices.length);
  }
  for (const path of photos) {
    const photo = await Filesystem.readFile({ path, directory: Directory.Data });
    if (typeof photo.data !== 'string') throw new Error(`عکس ${path} قابل خواندن نیست؛ پشتیبان ناقص ساخته نشد.`);
    inner.file(`photos/${path}`, photo.data, { base64: true });
  }
  inner.file('manifest.json', JSON.stringify({ format: 'majora-backup-v1', createdAt: new Date().toISOString(), databaseHash,
    products: products.length + archivedProducts.length, customers: customers.length + archivedCustomers.length,
    invoices: allInvoices.length, photos }));
  const plaintext = await inner.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 5 } });
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource));
  const outer = new JSZip();
  outer.file('manifest.json', JSON.stringify({ format: 'majora-encrypted-zip-v1', kdf: 'PBKDF2-SHA256', iterations, cipher: 'AES-256-GCM', salt: base64(salt), iv: base64(iv) }));
  outer.file('payload.enc', encrypted);
  const file = await outer.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const date = new Date();
  const filename = `majora-backup-${date.toISOString().replace(/[:.]/g, '-')}.zip`;
  const path = `MAJORA/Backups/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${filename}`;
  await Filesystem.writeFile({ path, directory: Directory.Documents, data: base64(file), recursive: true });
  const sharePath = `exports/${filename}`;
  await Filesystem.writeFile({ path: sharePath, directory: Directory.Cache, data: base64(file), recursive: true });
  const shareFile = await Filesystem.getUri({ path: sharePath, directory: Directory.Cache });
  await Share.share({ title: 'پشتیبان رمزدار ماژورا', files: [shareFile.uri], dialogTitle: 'اشتراک یا ذخیرهٔ پشتیبان' }).catch(() => undefined);
  return { path, bytes: file.byteLength, databaseHash };
}

export async function restoreEncryptedBackup(file: File, password: string): Promise<void> {
  if (file.size > 512 * 1024 * 1024) throw new Error('فایل پشتیبان بزرگ‌تر از حد قابل بازیابی است.');
  const outer = await JSZip.loadAsync(await file.arrayBuffer());
  const envelopeText = await outer.file('manifest.json')?.async('string');
  const encrypted = await outer.file('payload.enc')?.async('uint8array');
  if (!envelopeText || !encrypted) throw new Error('ساختار ZIP پشتیبان کامل نیست.');
  const envelope = JSON.parse(envelopeText) as { format: string; iterations: number; salt: string; iv: string };
  if (envelope.format !== 'majora-encrypted-zip-v1' || envelope.iterations !== iterations) throw new Error('نسخهٔ پشتیبان پشتیبانی نمی‌شود.');
  let plaintext: ArrayBuffer;
  try { plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
    await keyFor(password, fromBase64(envelope.salt)), encrypted as BufferSource); }
  catch { throw new Error('گذرواژه نادرست است یا فایل آسیب دیده است.'); }
  const inner = await JSZip.loadAsync(plaintext);
  const manifestText = await inner.file('manifest.json')?.async('string');
  const databaseJson = await inner.file('database/full-sqlite.json')?.async('string');
  if (!manifestText || !databaseJson) throw new Error('اطلاعات اصلی پشتیبان ناقص است.');
  const manifest = JSON.parse(manifestText) as { format: string; databaseHash: string; photos: string[] };
  if (manifest.format !== 'majora-backup-v1' || manifest.databaseHash !== await sha256(databaseJson)) throw new Error('یکپارچگی پشتیبان تأیید نشد.');
  const snapshot = JSON.parse(databaseJson) as Awaited<ReturnType<typeof exportNativeDatabase>>;
  if (snapshot.mode !== 'full' || !snapshot.tables?.length || snapshot.tables.some(table => !allowedTables.has(table.name))) throw new Error('پشتیبان با ساختار برنامه سازگار نیست.');
  for (const path of manifest.photos) {
    if (!/^product-images\/[a-f0-9-]+\.jpg$/.test(path) || !inner.file(`photos/${path}`)) throw new Error('فایل عکس در پشتیبان ناقص است.');
  }
  const stage = await importVerifiedDatabaseStage(snapshot);
  for (const path of manifest.photos) {
    const data = await inner.file(`photos/${path}`)!.async('base64');
    await Filesystem.writeFile({ path, directory: Directory.Data, data, recursive: true });
  }
  for (const path of Object.keys(inner.files).filter(path => /^invoices\/[0-9]{4}\/[0-9]{2}\/[0-9]+\.pdf$/.test(path))) {
    const data = await inner.file(path)!.async('base64');
    await Filesystem.writeFile({ path: `MAJORA/Invoices/${path.slice('invoices/'.length)}`, directory: Directory.Documents, data, recursive: true });
  }
  activateRestoredDatabase(stage);
  location.reload();
}
