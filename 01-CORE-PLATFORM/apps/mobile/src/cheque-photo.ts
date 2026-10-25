import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

export async function prepareChequePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('فقط تصویر چک را انتخاب کنید.');
  if (file.size > 16 * 1024 * 1024) throw new Error('عکس چک باید کوچک‌تر از ۱۶ مگابایت باشد.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('عکس چک قابل خواندن نیست.')); image.src = url; });
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('آماده‌سازی تصویر چک ممکن نشد.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .88);
  } finally { URL.revokeObjectURL(url); }
}
export async function storeChequePhoto(dataUrl: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) return dataUrl;
  const path = `cheque-images/${crypto.randomUUID()}.jpg`;
  await Filesystem.writeFile({ path, directory: Directory.Data, data: dataUrl.split(',')[1], recursive: true });
  return path;
}
export async function readChequePhoto(path?: string): Promise<string | undefined> {
  if (!path) return undefined;
  if (path.startsWith('data:')) return path;
  const file = await Filesystem.readFile({ path, directory: Directory.Data });
  if (typeof file.data !== 'string') throw new Error('تصویر چک قابل خواندن نیست.');
  return `data:image/jpeg;base64,${file.data}`;
}
export async function removeChequePhoto(path?: string): Promise<void> {
  if (path && !path.startsWith('data:') && Capacitor.isNativePlatform()) await Filesystem.deleteFile({ path, directory: Directory.Data });
}
