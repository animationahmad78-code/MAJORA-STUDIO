# آماده‌سازی iOS و ساخت ابری

## وضعیت واقعی

پروژهٔ native iOS با همان شناسهٔ موجود `ir.majora.classicbag` و Capacitor 8.5.3 در `01-CORE-PLATFORM/apps/mobile/ios` ایجاد و `cap sync ios` روی Windows موفق شد. افزونهٔ SQLite در `Package.swift` شناسایی شد. مسیر Windows تولیدشده در SPM با اسکریپت `sync:ios` به جداکنندهٔ قابل استفاده در macOS تبدیل می‌شود. اینها **اثبات کامپایل Xcode، اجرای iPhone یا تولید IPA نیستند**.

Capacitor 8 برای ساخت iOS به macOS و Xcode 26 یا جدیدتر نیاز دارد. فایل `.github/workflows/ios-compile.yml` یک بررسی دستی روی runner `macos-26` برای ساخت **بدون امضای شبیه‌ساز** آماده می‌کند. این workflow هنوز به مخزن GitHub متصل یا اجرا نشده است؛ این پوشه فعلاً Git remote ندارد.

## دارایی‌های خصوصی در CI

دارایی‌های اصلی و فونت‌ها عمداً در Git نیستند. برای اجرای workflow، یک ZIP خصوصی با مسیرهای ریشهٔ زیر در فضای ذخیره‌سازی کنترل‌شدهٔ MAJORA نگه دارید و دو secret زیر را در مخزن GitHub تعریف کنید:

- `MAJORA_ASSET_URL`: URL محدود و امن برای دریافت ZIP در زمان build.
- `MAJORA_ASSETS_SHA256`: هش SHA-256 همان ZIP.

ZIP باید `00-COMPANY/brand-assets/IMG_1137.PNG`، `02-CLIENT-PROJECTS/classic-bag-belt/original-assets/ClassicBag-mark.png`، `02-CLIENT-PROJECTS/classic-bag-belt/design-system/fonts/Estedad-*.woff2` و `02-CLIENT-PROJECTS/classic-bag-belt/brand-config/store.json` را با همین مسیرها داشته باشد. URL یا فایل ZIP و اطلاعات فروشگاه نباید در گزارش عمومی یا commit قرار گیرد.

بستهٔ خصوصی فعلی در `07-BACKUPS/ios-private-assets-2026-10-21.zip` با ۷ فایل و ۲٬۱۵۵٬۳۷۵ بایت ساخته و فهرست آن بررسی شد. SHA-256 آن `1FEBB3ED436FFAA7C3BFD0545313A57B86999F8634E40FB77D3E96CD6F59DB3D` است. این بسته در Git نادیده گرفته می‌شود و هنوز به هیچ سرویس ابری ارسال نشده است.

## گیت‌های بعدی

1. اجرای واقعی workflow و رفع خطاهای احتمالی Xcode/SPM/SQLite؛ سپس تست آفلاین روی iPhone.
2. جایگزینی آیکن پیش‌فرض iOS با نشان تأییدشدهٔ فروشگاه در نسخهٔ قابل انتشار؛ فایل اصلی را تغییر ندهید.
3. تکمیل PDF/چاپ/فایل/بازیابی در iOS و آزمون فونت و راست‌چین روی دستگاه.
4. پس از تکمیل QA، حساب Apple Developer، Team ID، provisioning profile و گواهی توزیع لازم است. اطلاعات امضا در Secrets/خزانهٔ امن نگهداری می‌شود. تا آن زمان IPA امضاشده وجود ندارد.

## روش محلی روی macOS

با پوشهٔ کامل پروژه و دارایی‌های خصوصی در مسیرهای بالا، در ریشهٔ `01-CORE-PLATFORM` اجرا شود:

```sh
npm ci
npm test
npm run build
npm run sync:ios -w @majora/mobile
cd apps/mobile
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

این دستور صرفاً کامپایل شبیه‌ساز را بررسی می‌کند و خروجی قابل نصب روی گوشی یا IPA توزیعی نمی‌سازد.
