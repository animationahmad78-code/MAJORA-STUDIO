# MAJORA-STUDIO

فضای کاری دائمی شرکت ماژورا در مسیر واقعی دسکتاپ ویندوز. پروژهٔ نخست: اپ اندرویدی «کیف و کمربند کلاسیک». پروژهٔ پیشین `D:\desktop\MAJORA Workspace` بدون جابه‌جایی یا حذف باقی مانده است.

## نقشهٔ پوشه‌ها

- `00-COMPANY`: هویت و اطلاعات پشتیبانی ماژورا؛ دارایی‌های اصلی خصوصی‌اند.
- `01-CORE-PLATFORM`: مونوریپوی React/TypeScript/Capacitor و منطق مشترک.
- `02-CLIENT-PROJECTS/classic-bag-belt`: اطلاعات، تصاویر اصلی، فونت، قالب و آزمون مشتری اول.
- `05-DOCUMENTATION`: PRD، معماری، پرسش‌های باز و گزارش‌های نسخه.
- `06-BUILDS-AND-RELEASES`: خروجی نصب و بسته‌های تحویل؛ `07-BACKUPS`: پشتیبان‌های محلی.

## وضعیت واقعی

سند ورودی، دارایی‌ها و فونت‌ها ثبت شده‌اند. پروژه‌های Android و iOS با شناسهٔ `ir.majora.classicbag` از همین سورس همگام می‌شوند. اتصال کالا، قیمت، صدور و ابطال فاکتور و متن قالب به SQLite پیاده‌سازی شده، اما روی دستگاه واقعی هنوز آزموده نشده است؛ نسخهٔ مرورگری فقط پیش‌نمایش است. ۱۳ آزمون خودکار، build وب، sync دو پلتفرم و اعتبارسنجی ۱۷ جدول گذرانده شده‌اند. مخزن خصوصی GitHub به سورس متصل است و بستهٔ دارایی در prerelease داخلی آن ثبت شده است. **Debug APK واقعی و دارای امضای v2 برای آزمون ساخته شده است؛ نسخهٔ Release تجاری و IPA امضاشده هنوز وجود ندارند.** مسیر، هش و دستور نصب در `05-DOCUMENTATION/qa-debug-apk-2026-10-21.md` است. کامپایل بدون امضای شبیه‌ساز iOS نیز در CI موفق شد. وضعیت جزئی در `PROJECT_AUDIT.md`، `REQUIREMENTS-TRACEABILITY.md` و `05-DOCUMENTATION/production-progress.md` است.

## اجرا برای توسعه

```powershell
cd 'D:\desktop\MAJORA-STUDIO\01-CORE-PLATFORM'
npm ci
npm run dev
npm test
npm run build
cd apps/mobile
npx cap sync android
npm run sync:ios -w @majora/mobile
```

برای ساخت محلی Android از `tooling/build-android-debug.ps1` با مسیر واقعی Java و SDK استفاده کنید. مسیر دیگر workflow خصوصی `.github/workflows/android-debug.yml` است. اسکریپت آماده‌سازی برند دارایی‌های خصوصی مشتری را به `apps/mobile/public/brand` کپی می‌کند؛ این پوشه در Git نادیده گرفته می‌شود. بستهٔ خصوصی دارایی‌ها فقط باید در اختیار افراد مجاز قرار گیرد. الزامات و محدودیت‌ها در `05-DOCUMENTATION/android-build-readiness.md` و `05-DOCUMENTATION/ios-build-readiness.md` ثبت شده‌اند.
