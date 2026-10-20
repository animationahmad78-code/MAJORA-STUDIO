# MAJORA-STUDIO

فضای کاری دائمی شرکت ماژورا در مسیر واقعی دسکتاپ ویندوز. پروژهٔ نخست: اپ اندرویدی «کیف و کمربند کلاسیک». پروژهٔ پیشین `D:\desktop\MAJORA Workspace` بدون جابه‌جایی یا حذف باقی مانده است.

## نقشهٔ پوشه‌ها

- `00-COMPANY`: هویت و اطلاعات پشتیبانی ماژورا؛ دارایی‌های اصلی خصوصی‌اند.
- `01-CORE-PLATFORM`: مونوریپوی React/TypeScript/Capacitor و منطق مشترک.
- `02-CLIENT-PROJECTS/classic-bag-belt`: اطلاعات، تصاویر اصلی، فونت، قالب و آزمون مشتری اول.
- `05-DOCUMENTATION`: PRD، معماری، پرسش‌های باز و گزارش‌های نسخه.
- `06-BUILDS-AND-RELEASES`: خروجی نصب و بسته‌های تحویل؛ `07-BACKUPS`: پشتیبان‌های محلی.

## وضعیت واقعی

سند ورودی، دارایی‌ها و فونت‌ها ثبت شده‌اند. پروژهٔ Android با شناسهٔ `ir.majora.classicbag` ایجاد و با خروجی React همگام شده است. روی Android، کالا/قیمت/فاکتور/متن قالب به SQLite متصل‌اند؛ نسخهٔ مرورگری صرفاً نمایشی است. **APK هنوز ساخته نشده و اپ روی دستگاه آزموده نشده است**، چون Android SDK/JDK در بررسی این میزبان پیدا نشد. وضعیت جزئی در `REQUIREMENTS-TRACEABILITY.md` و `05-DOCUMENTATION/implementation-status.md` است.

## اجرا برای توسعه

```powershell
cd 'D:\desktop\MAJORA-STUDIO\01-CORE-PLATFORM'
npm ci
npm run dev
npm test
npm run build
cd apps/mobile
npx cap sync android
```

ساخت APK پس از نصب Android Studio/JDK/SDK و پذیرش مجوزهای خود ابزار، از پوشهٔ `apps/mobile/android` انجام می‌شود. اسکریپت آماده‌سازی برند دارایی‌های خصوصی مشتری را به `apps/mobile/public/brand` کپی می‌کند؛ این پوشه در Git نادیده گرفته می‌شود. بستهٔ تحویل ZIP شامل منابع خصوصی است و باید فقط در اختیار افراد مجاز قرار گیرد. جزئیات و محدودیت‌ها در `DECISIONS.md` و `05-DOCUMENTATION` است.
