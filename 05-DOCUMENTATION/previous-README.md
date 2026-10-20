# MAJORA Merchant Workspace

فضای کاری محصول «فروشگاه آفلاین ماژورا» برای طراحی، ساخت و تحویل به Codex. مسیر این پوشه از مسیر واقعی Desktop ویندوز به دست آمده است. فایل‌های مرجع پروژهٔ ChatGPT و تصاویر اصلی دستکاری نشده‌اند.

## وضعیت

- `assets/originals`: کپی بایت‌به‌بایت هفت تصویر پیوست؛ فهرست و SHA-256 در `docs/asset-register.md`.
- `docs`: brief، PRD، معماری، برنامه، پرسش‌های باز و راهنمای Codex.
- `packages/database/migrations`: طرح SQLite و مرز تراکنش‌ها.
- `packages/domain`: منطق مستقل محاسبهٔ ریال و تغییر گروهی قیمت.
- `apps/mobile`: نمونهٔ مرورگری React/TypeScript قابل اجرا برای گردش محصول، قیمت و پیش‌نمایش فاکتور. ذخیرهٔ نمونه در localStorage است؛ اتصال SQLite بومی، Android build و خروجی PDF/PNG هنوز در برنامهٔ توسعه‌اند.
- `samples/invoice-gallery.html`: پنج چیدمان واقعی A4 برای مقایسه و چاپ آزمایشی؛ شماره و اقلام عمداً خالی‌اند.

## اجرا

Node.js 20+ و npm لازم است. در PowerShell:

```powershell
cd 'D:\desktop\MAJORA Workspace'
npm install
npm run dev
```

آدرس محلیِ نمایش‌داده‌شده را باز کنید. `npm test` منطق پولی را می‌سنجد و `npm run build` خروجی نمونه را می‌سازد. این نمونه برای دادهٔ واقعی کسب‌وکار یا تحویل نهایی اندروید آماده نیست.

## راهنمای ورود Codex

ابتدا `docs/open-questions.md` و `docs/PRD-fa.md` را بخواند. سپس `docs/architecture.md` و `docs/roadmap.md` را دنبال کند. قبل از هر تغییر، وضعیت گیت و تست‌ها بررسی شود. فایل‌های `assets/originals` فقط خواندنی تلقی شوند. مبلغ‌ها در کل مسیر عدد صحیح ریال‌اند؛ تغییر فاکتور یا موجودی باید در یک تراکنش SQLite باشد.
