# MAJORA-STUDIO

فضای کاری دائمی شرکت ماژورا در مسیر واقعی دسکتاپ ویندوز. پروژهٔ نخست: اپ اندرویدی «کیف و کمربند کلاسیک». پروژهٔ پیشین `D:\desktop\MAJORA Workspace` بدون جابه‌جایی یا حذف باقی مانده است.

## نقشهٔ پوشه‌ها

- `00-COMPANY`: هویت و اطلاعات پشتیبانی ماژورا؛ دارایی‌های اصلی خصوصی‌اند.
- `01-CORE-PLATFORM`: مونوریپوی React/TypeScript/Capacitor و منطق مشترک.
- `02-CLIENT-PROJECTS/classic-bag-belt`: اطلاعات، تصاویر اصلی، فونت، قالب و آزمون مشتری اول.
- `05-DOCUMENTATION`: PRD، معماری، پرسش‌های باز و گزارش‌های نسخه.
- `06-BUILDS-AND-RELEASES`: خروجی نصب و بسته‌های تحویل؛ `07-BACKUPS`: پشتیبان‌های محلی.

## وضعیت واقعی

سند ورودی، دارایی‌ها و فونت‌ها ثبت شده‌اند. پروژه‌های Android و iOS با شناسهٔ `ir.majora.classicbag` از همین سورس همگام می‌شوند. جریان تازهٔ «مشتری ← انتخاب سریع کالا ← سبد ← بازبینی فاکتور»، عکس/مدل/رنگ کالا، پروندهٔ مشتری و میانبرهای جست‌وجو در سورس `a636c0f` افزوده شده‌اند. ۱۶ آزمون خودکار، build وب، sync دو پلتفرم، ساخت APK Debug و اجرای شبیه‌ساز Android همراه با SQLite موفق شدند. مخزن کد عمومی است و طبق تصمیم مالک، فایل‌های برند این مشتری در همین مخزن نگهداری می‌شوند. **[APK آزمایشی بازطراحی](https://github.com/animationahmad78-code/MAJORA-STUDIO/releases/tag/qa-ux-debug-2026-10-21) موجود است؛ نسخهٔ Release تجاری و IPA امضاشده هنوز وجود ندارند.** [گزارش APK بازطراحی و نکات نصب](05-DOCUMENTATION/qa-ux-debug-apk-2026-10-21.md)، [ردیابی نیازمندی‌ها](REQUIREMENTS-TRACEABILITY.md) و [گزارش تجربهٔ کاربری](05-DOCUMENTATION/ux-redesign-2026-10-21.md) جزئیات را ثبت می‌کنند.

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

برای ساخت محلی Android از `tooling/build-android-debug.ps1` با مسیر واقعی Java و SDK استفاده کنید. workflowهای `.github/workflows/android-debug.yml` و `.github/workflows/ios-compile.yml` از همین مخزن عمومی و فایل‌های برند موجود در آن استفاده می‌کنند. اسکریپت آماده‌سازی برند فایل‌های اصلی را بدون تغییر به `apps/mobile/public/brand` کپی می‌کند؛ این پوشهٔ تولیدی در Git نادیده گرفته می‌شود. دیتابیس عملیاتی، پشتیبان و کلید امضا همچنان خارج از Git نگهداری می‌شوند. الزامات و محدودیت‌ها در `05-DOCUMENTATION/android-build-readiness.md` و `05-DOCUMENTATION/ios-build-readiness.md` ثبت شده‌اند.
