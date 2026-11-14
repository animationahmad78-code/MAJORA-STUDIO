const accepted = ['image/jpeg', 'image/png', 'image/webp'];

/** Accepts camera originals and sends a bounded, readable image to the API. */
export async function prepareImage(file: File, maxSide = 3000): Promise<string> {
  if (!accepted.includes(file.type)) throw new Error('فرمت تصویر پشتیبانی نمی‌شود. عکس JPEG، PNG یا WebP انتخاب کنید.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('تصویر باز نشد. فایل دیگری از گالری انتخاب کنید.'); }
  try {
    if (file.size <= 4_000_000) return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('خواندن تصویر انجام نشد. دوباره تلاش کنید.'));
      reader.readAsDataURL(file);
    });
    const canvas = document.createElement('canvas');
    let ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 9; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('پردازش تصویر در این مرورگر ممکن نیست.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/webp', Math.max(.52, .88 - attempt * .045));
      if (result.startsWith('data:image/webp;') && result.length * .75 <= 4_000_000) return result;
      ratio *= .8;
    }
    throw new Error('این تصویر پس از بهینه‌سازی هم قابل بارگذاری نیست. تصویر دیگری انتخاب کنید.');
  } finally { bitmap.close(); }
}
