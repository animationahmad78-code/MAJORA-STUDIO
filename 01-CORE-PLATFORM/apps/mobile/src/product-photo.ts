import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

export async function prepareProductPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('فقط فایل تصویری انتخاب کنید.');
  if (file.size > 12 * 1024 * 1024) throw new Error('عکس بزرگ‌تر از ۱۲ مگابایت است.');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('عکس قابل خواندن نیست.')); image.src = source;
    });
    const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('آماده‌سازی عکس ممکن نشد.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.78);
  } finally { URL.revokeObjectURL(source); }
}

export async function storeProductPhoto(dataUrl: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) return dataUrl;
  const path = `product-images/${crypto.randomUUID()}.jpg`;
  await Filesystem.writeFile({ path, directory: Directory.Data, data: dataUrl.split(',')[1], recursive: true });
  return path;
}

export async function productPhotoUrl(path?: string): Promise<string | undefined> {
  if (!path) return undefined;
  if (path.startsWith('data:')) return path;
  const result = await Filesystem.getUri({ path, directory: Directory.Data });
  return Capacitor.convertFileSrc(result.uri);
}

export async function removeProductPhoto(path?: string): Promise<void> {
  if (path && !path.startsWith('data:') && Capacitor.isNativePlatform()) {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  }
}
