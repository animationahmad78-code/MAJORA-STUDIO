# MAJORA-STUDIO

فضای کاری دائمی شرکت ماژورا در مسیر واقعی دسکتاپ ویندوز. پروژهٔ نخست: اپ اندرویدی «کیف و کمربند کلاسیک». پروژهٔ پیشین `D:\desktop\MAJORA Workspace` بدون جابه‌جایی یا حذف باقی مانده است. فاز نخست وب چندفروشگاهی نیز در همان مونوریپو آغاز شده است.

## نقشهٔ پوشه‌ها

- `00-COMPANY`: هویت و اطلاعات پشتیبانی ماژورا؛ دارایی‌های اصلی خصوصی‌اند.
- `01-CORE-PLATFORM`: مونوریپوی React/TypeScript/Capacitor و منطق مشترک.
- `01-CORE-PLATFORM/apps/web`: رابط وب فارسی/واکنش‌گرا؛ `apps/web-api`: ASP.NET Core 10 و SQL Server.
- `02-CLIENT-PROJECTS/classic-bag-belt`: اطلاعات، تصاویر اصلی، فونت، قالب و آزمون مشتری اول.
- `05-DOCUMENTATION`: PRD، معماری، پرسش‌های باز و گزارش‌های نسخه.
- `06-BUILDS-AND-RELEASES`: خروجی نصب و بسته‌های تحویل؛ `07-BACKUPS`: پشتیبان‌های محلی.

## وضعیت واقعی

سند ورودی، دارایی‌ها و فونت‌ها ثبت شده‌اند. Android با شناسهٔ `ir.majora.classicbag` از همین سورس ساخته می‌شود؛ خروجی نصب‌شدهٔ iOS هنوز تولید نشده است. وضعیت نسخهٔ Android در [گزارش ۱.۰.۳](05-DOCUMENTATION/release-1.0.3-2026-10-25.md) است. طبق آخرین تصمیم مالک، پشتیبان‌گیری و بازیابی از خود اپ حذف شده است؛ گزارش‌های ۲۲ اکتبر فقط سابقهٔ نسخه‌های پیشین‌اند. وب جدید هنوز جایگزین کامل اپ Android نیست. [گزارش واقعی فاز وب](05-DOCUMENTATION/web-saas-foundation-2026-11-04.md)، [بسته و شواهد انتشار نخست](05-DOCUMENTATION/web-release-2026-11-05.md)، [گزارش تکمیل قالب فاکتور وب](05-DOCUMENTATION/web-invoice-parity-2026-11-05.md)، [راهنمای استقرار](05-DOCUMENTATION/web-deployment.md) و [ردیابی نیازمندی‌ها](REQUIREMENTS-TRACEABILITY.md) وضعیت ادامهٔ کار را روشن می‌کنند.

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

برای توسعهٔ وب، پس از `npm ci` ابتدا `npm run build -w @majora/web` و سپس `dotnet run --project apps/web-api/Majora.WebApi.csproj` را اجرا کنید. پیش‌نیازها، متغیرهای محیطی و شرایط هاست در راهنمای استقرار وب هستند. آزمون API با `tooling/test-web-api.ps1` و ساخت بستهٔ Windows/Linux و اسکریپت SQL Server با `tooling/build-web-release.ps1` در PowerShell 7 انجام می‌شود. [گزارش اصلاح نسخه‌دار فاکتور](05-DOCUMENTATION/web-progress-2026-11-09-invoice-revision.md) و [گزارش پروندهٔ چک وب](05-DOCUMENTATION/web-progress-2026-11-09-cheques.md) شواهد و کارهای باز را ثبت می‌کنند.

برای ساخت محلی Android از `tooling/build-android-debug.ps1` با مسیر واقعی Java و SDK استفاده کنید. workflowهای `.github/workflows/android-debug.yml`، `.github/workflows/android-release.yml` و `.github/workflows/ios-compile.yml` از همین مخزن عمومی و فایل‌های برند موجود در آن استفاده می‌کنند. اسکریپت آماده‌سازی برند فایل‌های اصلی را بدون تغییر به `apps/mobile/public/brand` کپی می‌کند؛ این پوشهٔ تولیدی در Git نادیده گرفته می‌شود. دیتابیس عملیاتی، پشتیبان و کلید امضا همچنان خارج از Git نگهداری می‌شوند. الزامات و محدودیت‌ها در `05-DOCUMENTATION/android-build-readiness.md` و `05-DOCUMENTATION/ios-build-readiness.md` ثبت شده‌اند.
